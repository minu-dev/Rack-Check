import csv
import ctypes
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

# Null stream replacement for windowed exe logging
# 콘솔 없는 exe의 로그 출력 멈춤 방지용 빈 스트림 연결
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import webview

try:
    # Splash screen module for PyInstaller builds
    # PyInstaller 빌드 전용 시작 화면 모듈
    import pyi_splash
except ImportError:
    pyi_splash = None

try:
    from netmiko import ConnectHandler
except Exception:
    ConnectHandler = None

try:
    import urllib3
    urllib3.disable_warnings()
except Exception:
    pass

try:
    import winrm
except Exception:
    winrm = None

try:
    import keyring
except Exception:
    keyring = None


if getattr(sys, "frozen", False):
    HERE = os.path.dirname(sys.executable)
    BUNDLE = sys._MEIPASS
else:
    HERE = os.path.dirname(os.path.abspath(__file__))
    BUNDLE = HERE
UI_DIR = os.path.join(BUNDLE, "ui")
ICON_PATH = os.path.join(BUNDLE, "app.ico")

CONFIG_PATH = os.path.join(HERE, "config.json")
KR_SERVICE = "rackcheck_oss"
SETTINGS_PATH = os.path.join(os.environ.get("APPDATA", HERE), "RackCheck-OSS", "settings.json")

LANGS = ("ko", "en")
LANG = "ko"
WINDOW_TITLES = {
    "ko": {"main": "RackCheck", "lang": "언어 선택", "capture": "방화벽 대시보드 캡처"},
    "en": {"main": "RackCheck", "lang": "Select Language", "capture": "Firewall Dashboard Capture"},
}

# Fallback device type for entries without type
# type 없는 장비 항목의 기본 종류
DEFAULT_DEVICE_TYPE = {"l3": "cisco_ios", "firewall": "paloalto_panos"}


def kr_get(name):
    if keyring is None:
        return ""
    try:
        return keyring.get_password(KR_SERVICE, name) or ""
    except Exception:
        return ""


def kr_set(name, value):
    if keyring is None:
        return
    try:
        keyring.set_password(KR_SERVICE, name, value)
    except Exception:
        pass


def kr_del(name):
    if keyring is None:
        return
    try:
        keyring.delete_password(KR_SERVICE, name)
    except Exception:
        pass


def default_lang():
    try:
        if ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3FF == 0x12:
            return "ko"
    except Exception:
        pass
    return "en"


def load_settings():
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(s):
    try:
        os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(s, f, ensure_ascii=False)
    except Exception:
        pass


def update_settings(**kw):
    s = load_settings()
    s.pop("remember", None)
    s.update(kw)
    save_settings(s)


def saved_language():
    s = load_settings()
    # Legacy setting for disabled language memory
    # 언어 기억 해제 상태의 이전 설정 형식
    if s.get("remember") is False:
        return None
    lang = s.get("language")
    return lang if lang in LANGS else None


def windows_dark():
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                             r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        return winreg.QueryValueEx(key, "AppsUseLightTheme")[0] == 0
    except Exception:
        return False


def is_dark(theme):
    return theme == "dark" or (theme not in ("light", "dark") and windows_dark())


PS_ONELINER = (
    'Get-WmiObject Win32_Processor | Measure-Object -Property LoadPercentage -Average | '
    '%{"CPU=$([math]::Round($_.Average, 1))"}; '
    '$os=Get-WmiObject Win32_OperatingSystem; '
    '"MEM=$([math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/$os.TotalVisibleMemorySize*100, 1))"; '
    'Get-WmiObject Win32_LogicalDisk -Filter "DriveType=3" | '
    '%{"DISK $($_.DeviceID)=$([math]::Round(($_.Size-$_.FreeSpace)/$_.Size*100, 1))"}'
)


def load_config():
    # Empty config for first launch
    # 최초 실행 시 빈 설정
    if not os.path.exists(CONFIG_PATH):
        return {"devices": {}, "servers": []}
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def collect_l3(host, port, username, password):
    conn = ConnectHandler(
        device_type="cisco_ios",
        host=host, port=port, username=username, password=password)
    cpu = conn.send_command("show processes cpu sorted | include CPU")
    memory = conn.send_command("show processes memory sorted | include Total")
    ports = conn.send_command("show ip interface brief")
    conn.disconnect()
    return {"cpu": cpu, "memory": memory, "ports": ports}


def collect_nxos(host, port, username, password):
    conn = ConnectHandler(
        device_type="cisco_nxos",
        host=host, port=port, username=username, password=password)
    res = conn.send_command("show system resources")
    ports = conn.send_command("show interface brief")
    conn.disconnect()
    return {"resources": res, "ports": ports}


def collect_fw(host, port, username, password):
    conn = ConnectHandler(
        device_type="paloalto_panos",
        host=host, port=port, username=username, password=password)
    res = conn.send_command("show system resources")
    cpu = conn.send_command(
        "show system state filter-pretty sys.monitor.s1.mp.exports")
    ports = conn.send_command("show interface all")
    conn.disconnect()
    return {"resources": res, "cpu": cpu, "ports": ports}


POWERSHELL_EXE = r"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
WMIC_EXE = r"%SystemRoot%\System32\wbem\wmic.exe"


def run_ps_fullpath(session, script):
    from base64 import b64encode
    encoded = b64encode(script.encode("utf_16_le")).decode("ascii")
    r = session.run_cmd(f'{POWERSHELL_EXE} -NoProfile -NonInteractive -EncodedCommand {encoded}')
    if len(r.std_err):
        r.std_err = session._clean_error_msg(r.std_err)
    return r


def collect_server(host, port, username, password, use_ps=True):
    s = winrm.Session(
        f"http://{host}:{port}/wsman",
        auth=(username, password),
        transport="ntlm")
    # Full path execution for servers without PowerShell or wmic in PATH
    # PATH에 PowerShell, wmic이 없는 서버 대응용 전체 경로 실행
    if use_ps:
        r = run_ps_fullpath(s, PS_ONELINER)
        return {"text": r.std_out.decode("utf-8", "ignore"), "mode": "ps",
                "err": r.std_err.decode("utf-8", "ignore"), "code": r.status_code}
    out, errs = {}, []
    for key, cmd in (("cpu", f'{WMIC_EXE} cpu get loadpercentage'),
                     ("mem", f'{WMIC_EXE} OS get FreePhysicalMemory,TotalVisibleMemorySize'),
                     ("disk", f'{WMIC_EXE} logicaldisk where drivetype=3 get deviceid,size,freespace')):
        r = s.run_cmd(cmd)
        out[key] = r.std_out.decode("utf-8", "ignore")
        if r.std_err:
            errs.append(f"[{cmd}] " + r.std_err.decode("utf-8", "ignore"))
    return {"text": out, "mode": "wmic", "err": "\n".join(errs), "code": 0}


def parse_l3_cpu(text):
    m = re.search(r"five minutes:\s*(\d+)%", text)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)%/\d+%", text)
    return int(m.group(1)) if m else None


def parse_l3_mem(text):
    m = re.search(r"Total:\s*(\d+)\s+Used:\s*(\d+)", text)
    if m:
        total, used = int(m.group(1)), int(m.group(2))
        return round(used / total * 100, 1)
    return None


def parse_l3_ports(text):
    gi, te = [], []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 6 and parts[-2] == "up" and parts[-1] == "up":
            name = parts[0]
            if name.lower().startswith("vlan"):
                continue
            if name.startswith("Gi"):
                m = re.search(r"1/0/(\d+)$", name)
                if m:
                    gi.append(int(m.group(1)))
            elif name.startswith("Te"):
                mt = re.search(r"1/1/(\d+)$", name)
                if mt:
                    te.append(int(mt.group(1)))
    gi.sort()
    summary = summarize_ranges(gi)
    if te:
        summary += f", Fiber {len(te)}"
    return summary + " UP" if summary else "-"


def summarize_ranges(nums):
    if not nums:
        return ""
    out, start, prev = [], nums[0], nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
            continue
        out.append(f"{start}~{prev}" if start != prev else f"{start}")
        start = prev = n
    out.append(f"{start}~{prev}" if start != prev else f"{start}")
    return ", ".join(out)


def parse_nxos_cpu(text):
    m = re.search(r"^CPU states\s*:.*?([\d.]+)%\s*idle", text, re.M)
    return round(100 - float(m.group(1)), 1) if m else None


def parse_nxos_mem(text):
    m = re.search(r"Memory usage\s*:\s*(\d+)K total,\s*(\d+)K used", text)
    if m:
        total, used = int(m.group(1)), int(m.group(2))
        return round(used / total * 100, 1)
    return None


def parse_nxos_ports(text):
    nums, others = [], []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 5 or not parts[0].startswith("Eth") or parts[4] != "up":
            continue
        m = re.fullmatch(r"Eth1/(\d+)", parts[0])
        if m:
            nums.append(int(m.group(1)))
        else:
            name = parts[0][3:]
            others.append(name[2:] if name.startswith("1/") else name)
    nums.sort()
    s = ", ".join(x for x in [summarize_ranges(nums)] + others if x)
    return s + " UP" if s else "-"


def parse_fw_resources(text):
    m = re.search(r"Mem\s*:\s*([\d.]+)\s*total,.*?([\d.]+)\s*used", text)
    if m:
        total, used = float(m.group(1)), float(m.group(2))
        return round(used / total * 100, 1)
    return None


def parse_fw_cpu(text):
    m = re.search(r"1minavg:\s*(\d+)", text)
    return int(m.group(1)) if m else None

def parse_fw_ports(text):
    ups = []
    for line in text.splitlines():
        m = re.match(r"ethernet1/(\d+)\s+\d+\s+\S*/\S*/up\b", line.strip())
        if m:
            ups.append(int(m.group(1)))
    ups.sort()
    s = summarize_ranges(ups)
    return s + " UP" if s else "-"


def parse_server(raw):
    if raw.get("mode") == "wmic":
        return parse_server_wmic(raw["text"])
    cpu = mem = None
    disks = []
    for line in raw["text"].splitlines():
        line = line.strip()
        m = re.match(r"CPU=([\d.]+)", line)
        if m:
            cpu = float(m.group(1)); continue
        m = re.match(r"MEM=([\d.]+)", line)
        if m:
            mem = float(m.group(1)); continue
        m = re.match(r"DISK\s+([A-Z]):=([\d.]+)", line)
        if m:
            disks.append((m.group(1), float(m.group(2))))
    return {"cpu": cpu, "mem": mem, "disks": disks}


def parse_server_wmic(d):
    cpu = mem = None
    disks = []
    nums = re.findall(r"\d+", d.get("cpu", ""))
    if nums:
        cpu = round(sum(int(x) for x in nums) / len(nums), 1)
    m = re.search(r"(\d+)\s+(\d+)", d.get("mem", ""))
    if m:
        free, total = int(m.group(1)), int(m.group(2))
        mem = round((total - free) / total * 100, 1)
    for line in d.get("disk", "").splitlines():
        m = re.match(r"([A-Z]):\s+(\d+)\s+(\d+)", line.strip())
        if m:
            drive, free, size = m.group(1), int(m.group(2)), int(m.group(3))
            if size > 0:
                disks.append((drive, round((size - free) / size * 100, 1)))
    return {"cpu": cpu, "mem": mem, "disks": disks}


def server_verdict(cpu, mem, disks):
    bad = (cpu is not None and cpu >= 80) or (mem is not None and mem >= 80)
    bad = bad or any(p >= 90 for _, p in disks)
    if cpu is None and mem is None and not disks:
        return "확인필요"
    return "이상" if bad else "정상"


def verdict(cpu, mem):
    vals = [v for v in (cpu, mem) if v is not None]
    if not vals:
        return "확인필요"
    return "이상" if any(v >= 80 for v in vals) else "정상"


# Conversion from config data to UI item list
# config 데이터의 화면 장비 목록 변환
def load_items(cfg):
    items = []
    for key, d in cfg.get("devices", {}).items():
        items.append({
            "id": f"dev:{key}", "kind": "device",
            "type": d.get("type", DEFAULT_DEVICE_TYPE.get(key, "cisco_ios")),
            "label": d["label"], "label_en": d.get("label_en"),
            "host": d["host"], "username": d["username"],
            "port": d.get("port", 22),
        })
    for sv in cfg.get("servers", []):
        items.append({
            "id": f"sv:{sv['key']}", "kind": "server",
            "label": sv["label"], "label_en": sv.get("label_en"),
            "host": sv["host"], "username": sv["username"],
            "port": sv.get("port", 5985),
            "use_ps": sv.get("use_ps", True),
        })
    return items


def _unique(base, used):
    key, n = base, 2
    while key in used:
        key, n = f"{base}_{n}", n + 1
    used.add(key)
    return key


# Conversion from UI item list to config data with new id mapping
# 화면 장비 목록의 config 변환 및 신규 id 매핑
def items_to_config(cfg, items):
    old_dev = cfg.get("devices", {})
    old_sv = {sv["key"]: sv for sv in cfg.get("servers", [])}
    used_dev = {it["id"][4:] for it in items if it["id"].startswith("dev:")}
    used_sv = {it["id"][3:] for it in items if it["id"].startswith("sv:")}
    devices, servers, id_map = {}, [], {}
    for it in items:
        if it["kind"] == "device":
            if it["id"].startswith("dev:"):
                key = it["id"][4:]
            else:
                key = _unique("firewall" if it.get("type") == "paloalto_panos" else "l3", used_dev)
                id_map[it["id"]] = f"dev:{key}"
            d = dict(old_dev.get(key, {}))
            d["label"] = it["label"]
            if it.get("label_en"):
                d["label_en"] = it["label_en"]
            d.update(type=it.get("type", "cisco_ios"), host=it["host"], username=it["username"],
                     port=int(it["port"]))
            devices[key] = d
        else:
            if it["id"].startswith("sv:"):
                key = it["id"][3:]
            else:
                slug = re.sub(r"[^a-z0-9]+", "", it["label"].lower()) or "server"
                key = _unique(slug, used_sv)
                id_map[it["id"]] = f"sv:{key}"
            d = dict(old_sv.get(key, {}))
            d.update(key=key, label=it["label"])
            if it.get("label_en"):
                d["label_en"] = it["label_en"]
            d.update(host=it["host"], username=it["username"], port=int(it["port"]))
            if it.get("use_ps", True):
                # Omission of default use_ps value
                # 기본값인 use_ps 항목 생략
                d.pop("use_ps", None)
            else:
                d["use_ps"] = False
            servers.append(d)
    new = dict(cfg)
    new["devices"], new["servers"] = devices, servers
    return new, id_map


# Readable JSON formatting for config file
# config 파일의 읽기 쉬운 JSON 서식
def dump_config(cfg):
    j = lambda v: json.dumps(v, ensure_ascii=False)
    out = ["{"]
    keys = list(cfg.keys())
    for i, k in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        if k == "devices":
            out.append('  "devices": {')
            devs = list(cfg["devices"].items())
            for di, (dk, dv) in enumerate(devs):
                out.append(f"    {j(dk)}: {{")
                fields = list(dv.items())
                for fi, (fk, fv) in enumerate(fields):
                    out.append(f"      {j(fk)}: {j(fv)}" + ("," if fi < len(fields) - 1 else ""))
                out.append("    }" + ("," if di < len(devs) - 1 else ""))
            out.append("  }" + comma)
        elif k == "map":
            m = cfg["map"]
            parts = [p for p in ("nodes", "groups", "links") if p in m or p != "groups"]
            out.append('  "map": {')
            for pi, part in enumerate(parts):
                rows, tail = m.get(part, []), ("," if pi < len(parts) - 1 else "")
                out.append(f'    "{part}": [' + ("" if rows else "]" + tail))
                for ri, r in enumerate(rows):
                    out.append("      " + json.dumps(r, ensure_ascii=False, separators=(", ", ": "))
                               + ("," if ri < len(rows) - 1 else ""))
                if rows:
                    out.append("    ]" + tail)
            out.append("  }" + comma)
        elif k == "servers":
            out.append('  "servers": [')
            svs = cfg["servers"]
            for si, sv in enumerate(svs):
                out.append("    " + json.dumps(sv, ensure_ascii=False, separators=(", ", ": "))
                           + ("," if si < len(svs) - 1 else ""))
            out.append("  ]" + comma)
        else:
            body = json.dumps(cfg[k], ensure_ascii=False, indent=2).replace("\n", "\n  ")
            out.append(f"  {j(k)}: {body}{comma}")
    out.append("}")
    return "\n".join(out) + "\n"


# Atomic config write with first backup
# 최초 백업 포함 config 원자적 저장
def write_config(cfg):
    bak = CONFIG_PATH + ".bak"
    if not os.path.exists(bak) and os.path.exists(CONFIG_PATH):
        shutil.copy2(CONFIG_PATH, bak)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(dump_config(cfg))
    # Validation of written JSON
    # 저장한 JSON 유효성 확인
    json.load(open(tmp, encoding="utf-8"))
    os.replace(tmp, CONFIG_PATH)


# Inspection of a single device
# 장비 한 대 점검
def inspect(item, password):
    host, port, user = item["host"], int(item["port"]), item["username"]
    if item["kind"] == "device":
        if item.get("type") == "cisco_nxos":
            raw = collect_nxos(host, port, user, password)
            cpu = parse_nxos_cpu(raw["resources"])
            mem = parse_nxos_mem(raw["resources"])
            ports = parse_nxos_ports(raw["ports"])
        elif item.get("type") == "paloalto_panos":
            raw = collect_fw(host, port, user, password)
            cpu = parse_fw_cpu(raw.get("cpu", ""))
            mem = parse_fw_resources(raw["resources"])
            ports = parse_fw_ports(raw.get("ports", ""))
        else:
            raw = collect_l3(host, port, user, password)
            cpu = parse_l3_cpu(raw["cpu"])
            mem = parse_l3_mem(raw["memory"])
            ports = parse_l3_ports(raw["ports"])
        return {"cpu": cpu, "mem": mem, "ports": ports, "verdict": verdict(cpu, mem)}
    raw = collect_server(host, port, user, password, use_ps=item.get("use_ps", True))
    r = parse_server(raw)
    if r["cpu"] is None and r["mem"] is None and not r["disks"]:
        got = raw["text"] if raw["mode"] == "ps" else "\n".join(f"[{k}] {v}" for k, v in raw["text"].items())
        raise RuntimeError("접속은 됐지만 값을 읽지 못했습니다. "
                           + (raw.get("err", "").strip() or got.strip() or f"출력 없음 (종료 코드 {raw.get('code')})")[:500])
    return {"cpu": r["cpu"], "mem": r["mem"], "disks": r["disks"],
            "verdict": server_verdict(r["cpu"], r["mem"], r["disks"])}


# Network map section
# 네트워크 맵 영역
# Map schema with nodes, groups, links, and group id g on bundled nodes
# nodes, groups, links 및 묶음 장비 g 필드로 구성된 맵 구조
MAP_PING_TIMEOUT_MS = 1000
# TCP fallback ports by manual device type
# 수동 추가 장비 종류별 TCP 대체 포트
EXT_TYPES = {"l2": 22, "l3": 22, "ap": 443, "firewall": 443, "server": 3389, "esxi": 443, "other": None}
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,252}$")


# Validation and cleanup of map data from UI
# 화면에서 받은 맵 데이터 검증 및 정리
def clean_map(m, valid_ids):
    nodes, seen = [], set()
    for n in (m or {}).get("nodes", []):
        nid = n.get("id") if isinstance(n, dict) else None
        if not isinstance(nid, str) or nid in seen:
            continue
        node = {"id": nid, "x": round(float(n.get("x", 0))), "y": round(float(n.get("y", 0)))}
        if nid.startswith("ext:"):
            label, typ, host = str(n.get("label", "")).strip(), n.get("type"), str(n.get("host", "")).strip()
            if not label or typ not in EXT_TYPES or not HOST_RE.match(host):
                continue
            node.update(label=label[:60], type=typ, host=host)
        elif nid not in valid_ids:
            continue
        g = n.get("g")
        if isinstance(g, str) and g.startswith("grp:"):
            node["g"] = g
        seen.add(nid)
        nodes.append(node)
    # Group retention rule of two or more members
    # 장비 2대 이상 묶음만 유지 및 1대 남은 묶음 해제
    groups, gseen = {}, set()
    for gr in (m or {}).get("groups", []):
        gid = gr.get("id") if isinstance(gr, dict) else None
        if isinstance(gid, str) and gid.startswith("grp:") and gid not in gseen:
            gseen.add(gid)
            groups[gid] = {"id": gid, "x": round(float(gr.get("x", 0))), "y": round(float(gr.get("y", 0)))}
            label = str(gr.get("label") or "").strip()
            # Custom group name
            # 사용자 지정 묶음 이름
            if label:
                groups[gid]["label"] = label[:60]
    count = {}
    for node in nodes:
        if node.get("g") in groups:
            count[node["g"]] = count.get(node["g"], 0) + 1
    for node in nodes:
        g = node.pop("g", None)
        if g in groups and count[g] >= 2:
            node["g"] = g
        elif g in groups:
            node["x"], node["y"] = groups[g]["x"], groups[g]["y"]
    groups = [gr for gid, gr in groups.items() if count.get(gid, 0) >= 2]
    links, pairs = [], set()
    for ln in (m or {}).get("links", []):
        if isinstance(ln, (list, tuple)) and len(ln) == 2 and ln[0] in seen and ln[1] in seen and ln[0] != ln[1]:
            key = frozenset(ln)
            if key not in pairs:
                pairs.add(key)
                links.append([ln[0], ln[1]])
    return {"nodes": nodes, "groups": groups, "links": links}


# Liveness check by ping with TCP fallback
# 핑 우선, TCP 연결 대체 방식의 응답 확인
def host_alive(host, port):
    try:
        r = subprocess.run(["ping", "-n", "1", "-w", str(MAP_PING_TIMEOUT_MS), host],
                           stdin=subprocess.DEVNULL, capture_output=True, timeout=MAP_PING_TIMEOUT_MS / 1000 + 2,
                           # No console window flag
                           # 콘솔 창 표시 방지 플래그
                           creationflags=0x08000000)
        # TTL based success check for unreachable replies with exit code 0
        # 종료 코드 0인 도달 불가 응답 구분용 TTL 확인
        if b"TTL=" in r.stdout.upper():
            return True
    except Exception:
        pass
    if not port:
        return False
    try:
        with socket.create_connection((host, int(port)), timeout=1):
            return True
    except ConnectionRefusedError:
        return True
    except Exception:
        return False


# CSV section
# CSV 영역
CSV_COLUMNS = ["checked_at", "name", "category", "device_type", "host", "status", "cpu_percent", "memory_percent",
               "ports_up", "disk_usage", "error"]
STATUS_CODES = {"정상": "normal", "이상": "abnormal", "확인필요": "unknown"}


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


# Protection against Excel formula injection
# Excel 수식 주입 방지
def csv_text(v):
    v = "" if v is None else str(v).replace("\r", " ").replace("\n", " ").strip()
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t") else v


def result_row(it, status, res=None, error=""):
    res = res or {}
    ports = res.get("ports")
    return {
        "checked_at": now_iso(), "name": csv_text(it.get("label_en") or it["label"]),
        "category": "server" if it["kind"] == "server" else "network",
        "device_type": "windows" if it["kind"] == "server" else it.get("type", ""),
        "host": csv_text(it["host"]), "status": status,
        "cpu_percent": res.get("cpu"), "memory_percent": res.get("mem"),
        "ports_up": "" if ports in (None, "-") else csv_text(ports),
        "disk_usage": ";".join(f"{d}:{p}" for d, p in res.get("disks", [])),
        "error": csv_text(error),
    }


# Atomic CSV save in UTF-8 with BOM
# UTF-8 BOM 형식의 CSV 원자적 저장
def save_to_csv(path, rows):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, restval="", lineterminator="\r\n")
            w.writeheader()
            w.writerows(rows)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# Screen work area in logical pixels
# 논리 픽셀 기준 화면 작업 영역
def logical_work_area():
    try:
        from ctypes import wintypes
        r = wintypes.RECT()
        ctypes.windll.user32.SystemParametersInfoW(48, 0, ctypes.byref(r), 0)
        scale = ctypes.windll.user32.GetDpiForSystem() / 96
        return (int(r.left / scale), int(r.top / scale),
                int((r.right - r.left) / scale), int((r.bottom - r.top) / scale))
    except Exception:
        return 0, 0, 1280, 720


# Centered window position and size
# 창의 가운데 위치 및 크기
def centered(width, height):
    ax, ay, aw, ah = logical_work_area()
    width, height = min(width, aw), min(height, ah)
    return {"x": ax + (aw - width) // 2, "y": ay + (ah - height) // 2, "width": width, "height": height}


def set_dark_titlebar(window, dark):
    try:
        hwnd = window.native.Handle.ToInt32()
        value = ctypes.c_int(1 if dark else 0)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(value), 4)
    except Exception:
        pass


# Firewall dashboard capture section
# 방화벽 대시보드 캡처 영역
CAPTURE_DIR = os.path.join(HERE, "captures")

# Page state probe for Palo Alto web UI
# Palo Alto 웹 화면 상태 확인 스크립트
PAGE_PROBE = """(() => {
  const vis = el => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  const loading = [...document.querySelectorAll('div, span')].filter(e => vis(e) && e.children.length === 0 && /^loading/i.test(e.textContent.trim())).length;
  const text = document.body ? document.body.innerText : '';
  return JSON.stringify({url: location.href, ready: document.readyState, loading,
    resources: performance.getEntriesByType('resource').length,
    updated: /Last updated\\s+\\d{1,2}:\\d{2}/.test(text)});
})()"""


def page_state(win):
    try:
        return json.loads(win.evaluate_js(PAGE_PROBE))
    except Exception:
        return {}


# Wait for page load completion
# 페이지 로딩 완료 대기
def wait_page(win, timeout, stable_for, need_updated=False):
    t0 = time.time()
    last_res, last_change = -1, time.time()
    while time.time() - t0 < timeout:
        p = page_state(win)
        if p.get("resources") != last_res:
            last_res, last_change = p.get("resources"), time.time()
        if p.get("ready") == "complete" and not p.get("loading") and (p.get("updated") or not need_updated) \
                and time.time() - last_change >= stable_for:
            return True
        time.sleep(0.3)
    return False


def wait_url(win, test, timeout, step=0.3):
    t0 = time.time()
    while time.time() - t0 < timeout:
        url = str(page_state(win).get("url", "")).lower()
        if url and test(url):
            return url
        time.sleep(step)
    return ""


# Client area capture with PrintWindow
# PrintWindow 기반 창 내부 캡처
def capture_window(win, path):
    import clr
    clr.AddReference("System.Drawing")
    from System import IntPtr
    from System.Drawing import Image, Rectangle
    from System.Drawing.Imaging import ImageFormat
    from ctypes import wintypes
    u, g = ctypes.windll.user32, ctypes.windll.gdi32
    hwnd = win.native.Handle.ToInt32()
    wr = wintypes.RECT(); u.GetWindowRect(hwnd, ctypes.byref(wr))
    cr = wintypes.RECT(); u.GetClientRect(hwnd, ctypes.byref(cr))
    pt = wintypes.POINT(0, 0); u.ClientToScreen(hwnd, ctypes.byref(pt))
    hdc = u.GetWindowDC(hwnd)
    mdc = g.CreateCompatibleDC(hdc)
    bmp = g.CreateCompatibleBitmap(hdc, wr.right - wr.left, wr.bottom - wr.top)
    old = g.SelectObject(mdc, bmp)
    # PW_RENDERFULLCONTENT flag
    # PW_RENDERFULLCONTENT 플래그
    u.PrintWindow(hwnd, mdc, 2)
    g.SelectObject(mdc, old)
    full = Image.FromHbitmap(IntPtr(bmp))
    part = full.Clone(Rectangle(pt.x - wr.left, pt.y - wr.top, cr.right, cr.bottom), full.PixelFormat)
    part.Save(path, ImageFormat.Png)
    part.Dispose(); full.Dispose()
    g.DeleteObject(bmp); g.DeleteDC(mdc); u.ReleaseDC(hwnd, hdc)


# Read only dashboard capture flow with login and logout
# 로그인, 캡처, 로그아웃 순서의 조회 전용 대시보드 캡처
def capture_paloalto_dashboard(win, user, password, path):
    if not wait_page(win, 30, stable_for=1.0):
        raise RuntimeError("login page timeout")
    # Simulated input events for login form
    # 로그인 폼 활성화용 입력 이벤트 전송
    win.evaluate_js(f"""(() => {{
        const fill = (id, v) => {{
            const el = document.getElementById(id);
            el.focus(); el.value = v;
            for (const t of ['input', 'keyup', 'change']) el.dispatchEvent(new Event(t, {{bubbles: true}}));
        }};
        fill('user', {json.dumps(user)});
        fill('passwd', {json.dumps(password)});
        const btn = document.getElementById('submit');
        btn.disabled = false;
        btn.click();
    }})()""")
    if not wait_url(win, lambda url: "login" not in url, 20):
        raise PermissionError("login failed")
    # Capture after 30 second timeout
    # 30초 초과 시에도 캡처 진행
    wait_page(win, 30, stable_for=2.0, need_updated=True)
    capture_window(win, path)
    # Logout through dashboard link
    # 대시보드 Logout 링크를 통한 세션 종료
    if win.evaluate_js("(() => { const a = [...document.querySelectorAll('a')].find(e => e.textContent.trim() === 'Logout'); if (a) { a.click(); return true; } return false; })()"):
        wait_url(win, lambda url: "logout" in url or "login" in url, 5, step=0.1)


# Python API exposed to UI
# 화면 JS에 노출되는 Python API
class Api:

    def __init__(self):
        self._cfg = load_config()
        self._items = load_items(self._cfg)
        self._results = []
        self._main = None
        self._lang_win = None
        self._cfg_lock = threading.Lock()

    def _valid_ids(self, cfg=None):
        return {it["id"] for it in load_items(cfg or self._cfg)}

    # Window section
    # 창 영역
    def _title(self, view, lang):
        return WINDOW_TITLES[lang][view]

    def open_language_window(self):
        theme = load_settings().get("theme", "system")
        self._lang_win = webview.create_window(
            self._title("lang", default_lang()), os.path.join(UI_DIR, "lang.html"), js_api=self,
            **centered(460, 262), resizable=False, hidden=True,
            background_color="#202020" if is_dark(theme) else "#f3f3f3")

    def open_main_window(self):
        theme = load_settings().get("theme", "system")
        self._main = webview.create_window(
            self._title("main", LANG), os.path.join(UI_DIR, "main.html"), js_api=self,
            **centered(780, 860), min_size=(640, 520), hidden=True,
            background_color="#202020" if is_dark(theme) else "#f3f3f3")

    # Window display after UI render
    # 화면 렌더링 완료 후 창 표시
    def ready(self, view):
        if pyi_splash:
            try:
                pyi_splash.close()
            except Exception:
                pass
        if view == "lang" and self._lang_win:
            self._lang_win.show()
        elif view == "main" and self._main:
            self._main.show()
            if self._lang_win:
                self._lang_win.destroy()
                self._lang_win = None

    def titlebar(self, view, dark):
        win = self._main if view == "main" else self._lang_win
        if win:
            set_dark_titlebar(win, dark)

    # Settings section
    # 설정 영역
    def lang_init(self):
        return {"lang": saved_language() or default_lang(), "theme": load_settings().get("theme", "system")}

    def choose_language(self, lang, remember):
        global LANG
        LANG = lang if lang in LANGS else "ko"
        if remember:
            update_settings(language=LANG)
        self._lang_win.set_title(self._title("lang", LANG))
        self.open_main_window()

    def set_lang_title(self, lang):
        if self._lang_win and lang in LANGS:
            self._lang_win.set_title(self._title("lang", lang))

    def main_init(self):
        s = load_settings()
        items = [dict(it, password=kr_get(it["id"])) for it in self._items]
        return {"lang": LANG, "theme": s.get("theme", "system"),
                "items": items, "save_pw": bool(kr_get("_saved_flag")),
                "map": clean_map(self._cfg.get("map"), self._valid_ids())}

    # Item list persistence and password cleanup
    # 장비 목록 저장 및 삭제 장비 비밀번호 정리
    def save_items(self, items):
        try:
            items = [{k: v for k, v in it.items() if k != "password"} for it in items]
            with self._cfg_lock:
                new_cfg, id_map = items_to_config(self._cfg, items)
                # Removal of deleted devices from map
                # 삭제 장비의 맵 제거
                if "map" in new_cfg:
                    new_cfg["map"] = clean_map(new_cfg["map"], self._valid_ids(new_cfg))
                write_config(new_cfg)
                self._cfg = new_cfg
        except Exception as e:
            return {"ok": False, "error": str(e) or type(e).__name__}
        kept = {id_map.get(it["id"], it["id"]) for it in items}
        for it in self._items:
            if it["id"] not in kept:
                kr_del(it["id"])
        self._items = load_items(new_cfg)
        return {"ok": True, "ids": id_map}

    # Network map section
    # 네트워크 맵 영역
    # Map persistence
    # 맵 변경 내용 저장
    def save_map(self, m):
        try:
            with self._cfg_lock:
                new_cfg = dict(self._cfg)
                new_cfg["map"] = clean_map(m, self._valid_ids())
                write_config(new_cfg)
                self._cfg = new_cfg
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e) or type(e).__name__}

    # Periodic liveness check for map devices
    # 맵 장비의 주기적 응답 확인
    def map_ping(self, ids):
        want = set(ids or [])
        targets = {it["id"]: (it["host"], it["port"]) for it in self._items if it["id"] in want}
        for n in (self._cfg.get("map") or {}).get("nodes", []):
            if n["id"].startswith("ext:") and n["id"] in want:
                targets[n["id"]] = (n["host"], EXT_TYPES.get(n.get("type")))
        if not targets:
            return {}
        with ThreadPoolExecutor(max_workers=min(16, len(targets))) as ex:
            futs = {i: ex.submit(host_alive, h, p) for i, (h, p) in targets.items()}
            return {i: f.result() for i, f in futs.items()}

    def apply_settings(self, lang, theme):
        global LANG
        LANG = lang if lang in LANGS else LANG
        update_settings(language=LANG, theme=theme)
        if self._main:
            self._main.set_title(self._title("main", LANG))

    # Inspection section
    # 점검 영역
    # Inspection start with password handling
    # 비밀번호 처리 후 점검 시작
    def run(self, items, save_pw):
        saved_ids = [it["id"] for it in items if not it["id"].startswith("new:")]
        if save_pw:
            for it in items:
                if it["id"] in saved_ids:
                    kr_set(it["id"], it.get("password", ""))
            kr_set("_saved_flag", "1")
        else:
            for item_id in saved_ids:
                kr_del(item_id)
            kr_del("_saved_flag")
        threading.Thread(target=self._run_worker, args=(items,), daemon=True).start()

    def _emit(self, payload):
        self._main.evaluate_js(f"RC.onProgress({json.dumps(payload, ensure_ascii=False)})")

    def _run_worker(self, items):
        self._results = []
        for it in items:
            if not it.get("password"):
                self._results.append(result_row(it, "skipped"))
                self._emit({"id": it["id"], "state": "skip"})
                continue
            self._emit({"id": it["id"], "state": "running"})
            try:
                res = inspect(it, it["password"])
                self._results.append(result_row(it, STATUS_CODES.get(res["verdict"], "unknown"), res))
                self._emit({"id": it["id"], "state": "done", "result": res})
            except Exception as e:
                msg = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
                self._results.append(result_row(it, "failed", error=msg))
                self._emit({"id": it["id"], "state": "error", "error": msg, "detail": traceback.format_exc()})
        done = sum(r["status"] != "skipped" for r in self._results)
        self._emit({"state": "finished", "count": done})

    # Firewall dashboard capture request
    # 방화벽 대시보드 캡처 요청 처리
    def capture_dashboard(self, item):
        if not item.get("password"):
            return {"ok": False, "code": "no_password"}
        os.makedirs(CAPTURE_DIR, exist_ok=True)
        now = time.localtime()
        path = os.path.join(CAPTURE_DIR, time.strftime("%y%m%d_%H%M", now) + "_방화벽_대시보드.png")
        win = webview.create_window(self._title("capture", LANG), f"https://{item['host']}/", **centered(1440, 900))
        try:
            capture_paloalto_dashboard(win, item["username"], item["password"], path)
            return {"ok": True, "file": os.path.basename(path), "path": path}
        except PermissionError:
            return {"ok": False, "code": "login_failed"}
        except Exception as e:
            return {"ok": False, "code": "error", "error": str(e) or type(e).__name__}
        finally:
            win.destroy()

    # File selection in Explorer
    # 탐색기의 파일 선택 표시
    def show_file(self, path):
        if os.path.isfile(path):
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])

    def save_csv(self):
        rows = self._results
        if not any(r["status"] != "skipped" for r in rows):
            return {"ok": False, "code": "nothing"}
        picked = self._main.create_file_dialog(webview.FileDialog.SAVE, directory=HERE,
                                               save_filename=f"rackcheck_{time.strftime('%Y%m%d')}.csv",
                                               file_types=("CSV (*.csv)",))
        if not picked:
            return {"ok": False, "code": "cancel"}
        path = picked if isinstance(picked, str) else picked[0]
        if not path.lower().endswith(".csv"):
            path += ".csv"
        try:
            save_to_csv(path, rows)
            return {"ok": True, "file": os.path.basename(path), "path": path}
        except PermissionError:
            return {"ok": False, "code": "locked"}
        except Exception as e:
            return {"ok": False, "code": "error", "error": str(e)}


def main():
    global LANG
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass
    try:
        # Taskbar icon identity for script runs
        # 스크립트 실행 시 작업 표시줄 아이콘 지정
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("RackCheck.OSS")
    except Exception:
        pass
    # SSL warning bypass for self signed firewall certificates
    # 방화벽 자체 서명 인증서의 SSL 경고 무시
    webview.settings["IGNORE_SSL_ERRORS"] = True
    api = Api()
    lang = saved_language()
    if lang:
        LANG = lang
        api.open_main_window()
    else:
        api.open_language_window()
    webview.start(http_server=True, icon=ICON_PATH if os.path.isfile(ICON_PATH) else None)


if __name__ == "__main__":
    main()
