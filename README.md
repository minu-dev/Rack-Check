# RackCheck

서버실의 네트워크 장비와 Windows 서버를 한 번에 점검하고 결과를 CSV로 내보내는 Windows 데스크톱 앱입니다. 장비 상태를 실시간으로 보는 네트워크 맵(NMS)이 포함되어 있습니다.

## 기능

- **점검:** Cisco IOS, Cisco NX-OS, Palo Alto(SSH), Windows Server(WinRM)의 CPU, 메모리, 포트, 디스크 조회
- **CSV 내보내기:** 오늘 점검 결과를 정형화된 CSV로 저장
- **네트워크 맵:** 장비 배치, 링크, 묶음, Ping/TCP 상태 표시, 확대 및 이동
- **방화벽 캡처:** Palo Alto 대시보드 화면 저장

점검은 조회 명령만 실행하며 장비 설정을 바꾸지 않습니다.

## 실행

Windows 10/11, Python 3.14, WebView2 런타임이 필요합니다.

```bash
pip install -r requirements.txt
python Source.py
```

exe 빌드:

```bash
build.bat
```

결과물은 `dist\RackCheck.exe`입니다.

## 설정

장비는 앱 화면에서 추가할 수 있고 exe 옆의 `config.json`에 저장됩니다. 직접 작성하려면 `config.example.json`을 복사하세요. `config.json`은 Git에 올라가지 않습니다.

비밀번호는 파일이 아니라 Windows 자격 증명 관리자에 저장됩니다.

## CSV 형식

UTF-8(BOM), 장비 한 대당 한 줄입니다.

| 열 | 내용 |
|---|---|
| `checked_at` | 점검 시각 (ISO 8601) |
| `name` | 장비 이름 |
| `category` | `network`, `server` |
| `device_type` | `cisco_ios`, `cisco_nxos`, `paloalto_panos`, `windows` |
| `host` | IP 또는 호스트 이름 |
| `status` | `normal`, `abnormal`, `unknown`, `failed`, `skipped` |
| `cpu_percent` | CPU 사용률 |
| `memory_percent` | 메모리 사용률 |
| `ports_up` | UP 포트 요약 |
| `disk_usage` | 드라이브별 사용률 (예: `C:41.2;D:73.5`) |
| `error` | 실패 사유 |

판정 기준은 CPU와 메모리 80% 이상, 디스크 90% 이상이면 `abnormal`입니다.

## 라이선스

[MIT](LICENSE)
