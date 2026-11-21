// Network map UI
// 네트워크 맵 화면
// Map persistence through save_map
// save_map을 통한 맵 저장
// Liveness polling through map_ping while visible
// 화면 표시 중 map_ping 주기 호출
// Device bundle by dropping a device on another device
// 장비를 다른 장비 위에 놓는 방식의 묶음 생성
// Bundle details in right side bar
// 오른쪽 사이드 바의 묶음 장비 목록
// Bundled devices stored with group id g
// 묶음 장비의 g 필드 저장
// Wheel zoom, Ctrl drag pan, and elastic map edge
// 휠 확대, Ctrl 끌기 이동, 맵 끝 탄성 효과

const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_POLL_MS = 5000;
// Background grid size and Shift snap unit
// 배경 격자 크기 및 Shift 스냅 단위
const GRID = 24;
// Hover time before folder plate for a new bundle
// 새 묶음 폴더 판 표시까지의 대기 시간
const MERGE_NEW_MS = 350;
// Hover time before folder highlight for an existing bundle
// 기존 묶음 폴더 강조까지의 대기 시간
const MERGE_ADD_MS = 350;
// Overlap distance between icon centers
// 겹침 판정용 아이콘 중심 거리
const MERGE_DIST = 44;
// Mini icon count in bundle icon
// 묶음 아이콘 내부 미니 아이콘 수
const MINI_MAX = 9;
const ZOOM_MIN = 0.25, ZOOM_MAX = 2;
// Extra map area around initial viewport
// 초기 화면 주변 추가 맵 영역
const MAP_PAD = 1600;
// Margin beyond outermost devices
// 가장 바깥 장비 밖의 여백
const EDGE = 400;
// Icons for manually added device types
// 수동 추가 장비 종류별 아이콘
const EXT_TYPES = { l2: "", l3: "", ap: "", firewall: "", server: "", esxi: "", other: "" };

// Spring motion section
// 스프링 움직임 영역
// CSS linear() curve from damped spring
// 감쇠 스프링 기반 CSS linear() 곡선
function springCurve(zeta) {
  const w = 4.6 / (zeta * 1.0) * 1.15, wd = w * Math.sqrt(1 - zeta * zeta), pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const x = 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
    pts.push(+x.toFixed(4));
  }
  pts[48] = 1;
  return { css: `linear(${pts.join(", ")})`, at: t => pts[Math.min(48, Math.round(t * 48))] };
}
const HAS_LINEAR = CSS.supports("transition-timing-function", "linear(0, 1)");
const SPRING = springCurve(0.62), SPRING_SOFT = springCurve(0.85);
const EASE_SPRING = HAS_LINEAR ? SPRING.css : "cubic-bezier(.34, 1.56, .64, 1)";
const EASE_SOFT = HAS_LINEAR ? SPRING_SOFT.css : "cubic-bezier(.2, .9, .3, 1.15)";
document.documentElement.style.setProperty("--spring", EASE_SPRING);
document.documentElement.style.setProperty("--spring-soft", EASE_SOFT);

const MAP = {
  // Map nodes with center position and optional group id
  // 중심 좌표와 묶음 id 포함 노드 목록
  nodes: [],
  // Bundle list
  // 묶음 목록
  groups: [],
  // Links between real devices
  // 실제 장비 간 링크 목록
  links: [],
  // Ping status by device id
  // 장비 id별 응답 상태
  status: {},
  // Selected device or bundle id
  // 선택한 장비 또는 묶음 id
  sel: null,
  // Selected visible link key
  // 선택한 화면 링크 키
  selLink: null,
  // First device picked in link mode
  // 링크 모드의 첫 번째 선택 장비
  pick: null,
  // Bundle id open in side bar
  // 사이드 바에 열린 묶음 id
  side: null,
  linkMode: false,
  // Plus menu open state
  // + 메뉴 열림 상태
  open: false,
  // Map view active state
  // 맵 화면 활성 상태
  active: false,
  timer: null,
  gen: 0,
  // Camera transform from map to screen
  // 맵에서 화면으로의 카메라 변환값
  cam: { x: 0, y: 0, z: 1 },
  camAnim: 0,
  settleTimer: 0,

  init(m) {
    this.nodes = (m && m.nodes) || [];
    this.groups = (m && m.groups) || [];
    this.links = (m && m.links) || [];
  },

  // Item lookup from inspection list or manual node
  // 점검 목록 또는 수동 노드의 장비 정보 조회
  item(id) {
    if (id.startsWith("ext:")) {
      const n = this.nodes.find(x => x.id === id);
      return n && { id, kind: "ext", type: n.type, label: n.label, host: n.host };
    }
    return RC.items.find(x => x.id === id);
  },

  icon(it) {
    if (it.kind === "ext") return EXT_TYPES[it.type] || EXT_TYPES.other;
    return ICONS[it.kind === "server" ? "server" : it.type] || ICONS.server;
  },

  isGroup(id) { return typeof id === "string" && id.startsWith("grp:"); },
  node(id) { return this.nodes.find(n => n.id === id); },
  group(id) { return this.groups.find(g => g.id === id); },
  groupName(gr) { return (gr && gr.label) || t("map_group"); },
  members(gid) { return this.nodes.filter(n => n.g === gid); },
  // Icons visible on map
  // 맵에 표시되는 아이콘 목록
  shown() { return [...this.nodes.filter(n => !n.g), ...this.groups]; },
  // Visible icon id for a device
  // 장비가 표시되는 아이콘 id
  visId(id) { const n = this.node(id); return (n && n.g) || id; },

  // Bundle status from member status
  // 구성 장비 기준 묶음 상태
  groupStatus(gid) {
    const ss = this.members(gid).map(n => this.status[n.id]);
    if (ss.some(s => s === false)) return false;
    if (ss.length && ss.every(s => s === true)) return true;
    return undefined;
  },
  stateOf(id) { return this.isGroup(id) ? this.groupStatus(id) : this.status[id]; },
  // Sort rank with failed devices first
  // 응답 없는 장비 우선 정렬 순위
  rank(s) { return s === false ? 0 : s === undefined ? 1 : 2; },

  // Bundle member order from nodes array
  // nodes 배열 기준 묶음 내 장비 순서
  sortedMembers(gid) {
    return this.members(gid).map(n => ({ n, it: this.item(n.id), s: this.status[n.id] }));
  },

  // Bundle member reorder
  // 묶음 내 장비 순서 변경
  reorder(gid, id, beforeId) {
    const n = this.node(id);
    if (!n || id === beforeId) return;
    this.nodes = this.nodes.filter(x => x !== n);
    let i = beforeId ? this.nodes.findIndex(x => x.id === beforeId) : -1;
    // Insertion after last bundle member
    // 묶음 마지막 장비 뒤 삽입 위치
    if (i < 0) {
      const ms = this.members(gid);
      i = ms.length ? this.nodes.indexOf(ms[ms.length - 1]) + 1 : this.nodes.length;
    }
    this.nodes.splice(i, 0, n);
    this.repaint();
    this.save();
  },

  // Cleanup of deleted devices and undersized bundles
  // 삭제 장비 및 1대 이하 묶음 정리
  prune() {
    this.nodes = this.nodes.filter(n => this.item(n.id));
    for (const n of this.nodes) if (n.g && !this.group(n.g)) delete n.g;
    for (const gr of [...this.groups]) {
      const ms = this.members(gr.id);
      if (ms.length >= 2) continue;
      for (const m of ms) { delete m.g; m.x = gr.x; m.y = gr.y; }
      this.groups = this.groups.filter(g => g !== gr);
    }
    const ids = new Set(this.nodes.map(n => n.id));
    this.links = this.links.filter(([a, b]) => ids.has(a) && ids.has(b));
    const vis = new Set(this.shown().map(o => o.id));
    if (this.sel && !vis.has(this.sel)) this.sel = null;
    if (this.pick && !vis.has(this.pick)) this.pick = null;
    if (this.side && !this.group(this.side)) this.side = null;
  },

  // View switch section
  // 화면 전환 영역
  show(on) {
    this.active = on;
    if (on) { this.render(); this.applyCam(); this.startPoll(); }
    else { this.stopPoll(); this.toggleMenu(false); this.closeSide(); closeCtx(); }
  },

  // Rendering section
  // 그리기 영역
  render() {
    this.prune();
    $("#mapNodes").replaceChildren(
      ...this.nodes.filter(n => !n.g).map(n => this.makeNode(n)),
      ...this.groups.map(g => this.makeGroup(g)));
    this.drawLinks();
    this.fitWorld();
    this.updateTools();
    this.renderSide();
    $("#mapFab").title = t(this.open ? "b_close" : "map_menu");
  },

  makeNode(n) {
    const it = this.item(n.id);
    const el = document.createElement("div");
    el.className = "node";
    el.dataset.id = n.id;
    el.innerHTML = `<div class="plate"></div><div class="tile icon"></div><div class="n-name"></div><div class="n-sub"></div>
      <button class="n-del icon">&#xE711;</button>`;
    $(".tile", el).textContent = this.icon(it);
    $(".n-name", el).textContent = RC.name(it);
    $(".n-sub", el).textContent = it.host;
    this.wireNode(el, n, t("map_remove"), () => this.removeNode(n.id));
    this.paintNode(el);
    return el;
  },

  // iOS style bundle icon with mini device grid
  // 미니 장비 격자 포함 iOS식 묶음 아이콘
  makeGroup(gr) {
    const el = document.createElement("div");
    el.className = "node group";
    el.dataset.id = gr.id;
    el.innerHTML = `<div class="tile folder"><div class="minis"></div><span class="badge"></span></div>
      <div class="n-name"></div><div class="n-sub"></div><button class="n-del icon">&#xE711;</button>`;
    this.wireNode(el, gr, t("map_ungroup"), () => this.ungroup(gr.id));
    this.paintNode(el);
    return el;
  },

  wireNode(el, o, delTitle, delFn) {
    const del = $(".n-del", el);
    del.title = delTitle;
    del.addEventListener("pointerdown", e => e.stopPropagation());
    del.addEventListener("click", e => { e.stopPropagation(); delFn(); });
    el.addEventListener("pointerdown", e => this.onDown(e, o, el));
    el.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); this.openCtx(e, o.id); });
    this.place(el, o);
  },

  place(el, n) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; },

  // Status color for devices and bundles
  // 장비 및 묶음의 상태 색상
  paintNode(el) {
    const id = el.dataset.id, s = this.stateOf(id);
    el.classList.toggle("alive", s === true);
    el.classList.toggle("dead", s === false);
    el.classList.toggle("sel", this.sel === id);
    el.classList.toggle("pick", this.pick === id);
    if (this.isGroup(id)) {
      const ms = this.sortedMembers(id), bad = ms.filter(m => m.s === false).length;
      const box = $(".minis", el), shownIds = ms.slice(0, MINI_MAX).map(m => m.n.id);
      // Mini icon rebuild only on order change
      // 순서 변경 시에만 미니 아이콘 재생성
      if (box.dataset.ids !== shownIds.join("|")) {
        box.dataset.ids = shownIds.join("|");
        box.replaceChildren(...ms.slice(0, MINI_MAX).map(m => {
          const c = document.createElement("span");
          c.className = "mini icon";
          c.dataset.mid = m.n.id;
          c.textContent = this.icon(m.it);
          return c;
        }));
      }
      for (const c of box.children) {
        const s1 = this.status[c.dataset.mid];
        c.classList.toggle("alive", s1 === true);
        c.classList.toggle("dead", s1 === false);
      }
      $(".badge", el).textContent = ms.length;
      $(".n-name", el).textContent = this.groupName(this.group(id));
      $(".n-sub", el).textContent = bad ? t("map_group_bad", { n: bad }) : t("map_group_count", { n: ms.length });
      $(".tile", el).title = bad ? t("map_group_bad", { n: bad }) : s === true ? t("map_alive") : t("map_checking");
    } else {
      $(".tile", el).title = s === true ? t("map_alive") : s === false ? t("map_dead") : t("map_checking");
    }
  },

  repaint() {
    document.querySelectorAll("#mapNodes .node").forEach(el => this.paintNode(el));
    this.renderSide();
  },

  // Visible link aggregation by icon pair
  // 아이콘 쌍 기준 화면 링크 통합
  visLinks() {
    const out = new Map();
    for (const [a, b] of this.links) {
      const va = this.visId(a), vb = this.visId(b);
      // Skip for links inside one bundle
      // 같은 묶음 내부 링크 제외
      if (va === vb) continue;
      const key = [va, vb].sort().join("|");
      if (!out.has(key)) out.set(key, { key, a: va, b: vb, ends: new Set() });
      out.get(key).ends.add(a).add(b);
    }
    return [...out.values()];
  },

  drawLinks() {
    const svg = $("#mapLinks"), pos = Object.fromEntries(this.shown().map(o => [o.id, o]));
    svg.replaceChildren();
    document.querySelectorAll("#mapNodes .link-del").forEach(b => b.remove());
    for (const L of this.visLinks()) {
      const A = pos[L.a], B = pos[L.b];
      if (!A || !B) continue;
      const ss = [...L.ends].map(id => this.status[id]);
      const g = document.createElementNS(SVG_NS, "g");
      g.classList.add("link");
      g.classList.toggle("alive", ss.every(s => s === true));
      g.classList.toggle("dead", ss.some(s => s === false));
      g.classList.toggle("sel", this.selLink === L.key);
      for (const cls of ["line", "hit"]) {
        const l = document.createElementNS(SVG_NS, "line");
        l.setAttribute("x1", A.x); l.setAttribute("y1", A.y); l.setAttribute("x2", B.x); l.setAttribute("y2", B.y);
        l.classList.add(cls);
        g.append(l);
      }
      g.addEventListener("pointerdown", e => e.stopPropagation());
      g.addEventListener("click", e => { e.stopPropagation(); this.selectLink(L.key); });
      svg.append(g);
      if (this.selLink === L.key) {
        const btn = document.createElement("button");
        btn.className = "link-del icon";
        btn.innerHTML = "&#xE711;";
        btn.title = t("map_link_remove");
        btn.style.left = (A.x + B.x) / 2 + "px";
        btn.style.top = (A.y + B.y) / 2 + "px";
        btn.addEventListener("pointerdown", e => e.stopPropagation());
        btn.addEventListener("click", e => { e.stopPropagation(); this.removeLink(L.key); });
        $("#mapNodes").append(btn);
      }
    }
  },

  // Camera pan and zoom section
  // 카메라 이동 및 확대 영역
  vp() { return $("#mapScroll"); },

  // Map bounds with extra area and device margin
  // 추가 영역과 장비 여백 포함 맵 경계
  bounds() {
    const v = this.vp(), all = this.shown();
    return {
      x1: Math.min(-MAP_PAD, ...all.map(n => n.x - EDGE)),
      y1: Math.min(-MAP_PAD, ...all.map(n => n.y - EDGE)),
      x2: Math.max(v.clientWidth + MAP_PAD, ...all.map(n => n.x + EDGE)),
      y2: Math.max(v.clientHeight + MAP_PAD, ...all.map(n => n.y + EDGE)),
    };
  },

  // Allowed camera range
  // 카메라 이동 허용 범위
  camRange(z = this.cam.z) {
    const v = this.vp(), b = this.bounds();
    const ax0 = v.clientWidth - b.x2 * z, ax1 = -b.x1 * z, ay0 = v.clientHeight - b.y2 * z, ay1 = -b.y1 * z;
    return { x0: Math.min(ax0, ax1), x1: Math.max(ax0, ax1), y0: Math.min(ay0, ay1), y1: Math.max(ay0, ay1) };
  },

  clampCam(c) {
    const r = this.camRange(c.z);
    return { x: Math.min(r.x1, Math.max(r.x0, c.x)), y: Math.min(r.y1, Math.max(r.y0, c.y)), z: c.z };
  },

  // Elastic resistance past map edge
  // 맵 끝 초과 시 탄성 저항
  rubber(c) {
    const v = this.vp(), k = this.clampCam(c);
    const band = (over, dim) => (1 - 1 / (Math.abs(over) * 0.55 / dim + 1)) * dim * Math.sign(over);
    return { x: k.x + band(c.x - k.x, v.clientWidth), y: k.y + band(c.y - k.y, v.clientHeight), z: c.z };
  },

  applyCam() {
    const { x, y, z } = this.cam, v = this.vp();
    $("#mapWorld").style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    // Minor grid hidden at low zoom
    // 저배율의 작은 격자 숨김
    const minor = GRID * z < 10 ? 120 * z : GRID * z;
    v.style.backgroundSize = `${120 * z}px ${120 * z}px, ${120 * z}px ${120 * z}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
    v.style.backgroundPosition = `${x}px ${y}px`;
    const zl = $("#mapZoom");
    zl.textContent = Math.round(z * 100) + "%";
  },

  // Spring camera animation
  // 카메라 스프링 애니메이션
  animateCam(to, ms = 520) {
    cancelAnimationFrame(this.camAnim);
    const from = { ...this.cam }, t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / ms), e = SPRING_SOFT.at(p);
      this.cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e };
      this.applyCam();
      if (p < 1) this.camAnim = requestAnimationFrame(step);
    };
    this.camAnim = requestAnimationFrame(step);
  },

  settle(delay = 0) {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      const k = this.clampCam(this.cam);
      if (Math.abs(k.x - this.cam.x) > .5 || Math.abs(k.y - this.cam.y) > .5) this.animateCam(k);
    }, delay);
  },

  // Cursor centered wheel zoom
  // 커서 중심 휠 확대 및 축소
  onWheel(e) {
    e.preventDefault();
    closeCtx();
    cancelAnimationFrame(this.camAnim);
    const v = this.vp().getBoundingClientRect(), cx = e.clientX - v.left, cy = e.clientY - v.top;
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const z0 = this.cam.z, z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z0 * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))));
    if (z === z0) { this.settle(120); return; }
    const c = { x: cx - (cx - this.cam.x) * z / z0, y: cy - (cy - this.cam.y) * z / z0, z };
    this.cam = this.rubber(c);
    this.applyCam();
    this.flashZoom();
    this.settle(160);
  },

  flashZoom() {
    const zl = $("#mapZoom");
    zl.classList.add("show");
    clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => zl.classList.remove("show"), 900);
  },

  resetZoom() {
    const v = this.vp(), cx = v.clientWidth / 2, cy = v.clientHeight / 2, z0 = this.cam.z;
    this.animateCam(this.clampCam({ x: cx - (cx - this.cam.x) / z0, y: cy - (cy - this.cam.y) / z0, z: 1 }));
    this.flashZoom();
  },

  // Map pan with Ctrl or middle button drag
  // Ctrl 또는 휠 버튼 끌기 기반 맵 이동
  startPan(e) {
    e.preventDefault(); e.stopPropagation();
    closeCtx();
    cancelAnimationFrame(this.camAnim);
    // Pending settle cancellation during pan
    // 이동 중 예약된 복귀 동작 취소
    clearTimeout(this.settleTimer);
    const v = this.vp();
    v.setPointerCapture(e.pointerId);
    $("#viewMap").classList.add("panning");
    const sx = e.clientX, sy = e.clientY, ox = this.cam.x, oy = this.cam.y;
    const move = ev => {
      this.cam = this.rubber({ x: ox + (ev.clientX - sx), y: oy + (ev.clientY - sy), z: this.cam.z });
      this.applyCam();
    };
    const up = () => {
      v.removeEventListener("pointermove", move);
      v.removeEventListener("pointerup", up);
      v.removeEventListener("pointercancel", up);
      $("#viewMap").classList.remove("panning");
      this.settle(0);
    };
    v.addEventListener("pointermove", move);
    v.addEventListener("pointerup", up);
    v.addEventListener("pointercancel", up);
  },

  // Screen to map coordinate conversion
  // 화면 좌표의 맵 좌표 변환
  toWorld(cx, cy) {
    const v = this.vp().getBoundingClientRect();
    return { x: (cx - v.left - this.cam.x) / this.cam.z, y: (cy - v.top - this.cam.y) / this.cam.z };
  },

  // SVG size fit to map bounds
  // 맵 경계에 맞춘 SVG 크기
  fitWorld() {
    const b = this.bounds(), svg = $("#mapLinks"), w = b.x2 - b.x1, h = b.y2 - b.y1;
    Object.assign(svg.style, { left: b.x1 + "px", top: b.y1 + "px", width: w + "px", height: h + "px" });
    svg.setAttribute("viewBox", `${b.x1} ${b.y1} ${w} ${h}`);
  },

  // Plus menu and link mode section
  // + 메뉴 및 링크 추가 영역
  toggleMenu(open = !this.open) {
    this.open = open;
    $("#mapFab").classList.toggle("open", open);
    $("#mapActs").classList.toggle("open", open);
    $("#mapFab").title = t(open ? "b_close" : "map_menu");
    if (!open && this.linkMode) this.setLinkMode(false);
    else this.updateTools();
  },

  setLinkMode(on) {
    this.linkMode = on;
    this.pick = null;
    if (on) { this.sel = null; this.selLink = null; this.closeSide(); }
    $("#viewMap").classList.toggle("link-mode", on);
    $("#mapAddLink").classList.toggle("accent", on);
    this.updateTools();
    this.repaint();
    this.drawLinks();
  },

  updateTools() {
    // Minimum of two devices for links
    // 링크 생성 최소 장비 수 2대
    const canLink = this.nodes.length >= 2;
    if (!canLink && this.linkMode) { this.setLinkMode(false); return; }
    $("#mapAddLink").hidden = !canLink;
    $("#mapAddDev").disabled = this.linkMode;
    $("#mapEmpty").hidden = this.nodes.length > 0;
    const hint = $("#mapHint");
    hint.hidden = !this.linkMode;
    hint.textContent = this.pick ? t("map_link_hint2", { name: RC.name(this.item(this.pick)) }) : t("map_link_hint");
  },

  // Device picker section
  // 장비 추가 창 영역
  openPicker() {
    const dlg = openDialog("pickTpl");
    const list = $(".pick-list", dlg.root);
    const onMap = new Set(this.nodes.map(n => n.id));
    const avail = RC.items.filter(it => !it.id.startsWith("new:"));
    for (const [kind, key] of [["device", "sec_net"], ["server", "sec_sv"]]) {
      const its = avail.filter(it => it.kind === kind);
      if (!its.length) continue;
      const head = document.createElement("div");
      head.className = "pick-group";
      head.textContent = t(key);
      list.append(head);
      for (const it of its) {
        const b = document.createElement("button");
        b.className = "pick-item";
        b.disabled = onMap.has(it.id);
        b.innerHTML = `<span class="dev-icon icon"></span>
          <span class="pick-text"><span class="pick-name"></span><span class="pick-sub"></span></span>
          <span class="pick-state"></span>`;
        $(".dev-icon", b).textContent = this.icon(it);
        $(".pick-name", b).textContent = RC.name(it);
        $(".pick-sub", b).textContent = it.host;
        $(".pick-state", b).textContent = onMap.has(it.id) ? t("map_on_map") : "";
        b.addEventListener("click", () => { dlg.close(); this.addNode(it.id); });
        list.append(b);
      }
    }
    if (!avail.length || avail.every(it => onMap.has(it.id))) {
      const note = document.createElement("div");
      note.className = "pick-note";
      note.textContent = avail.length ? t("map_all_added") : t("empty");
      list.append(note);
    }
    dlg.root.addEventListener("pointerdown", e => { if (e.target === dlg.root) dlg.fire("cancel"); });
    dlg.on("cancel", () => dlg.close());
    dlg.on("manual", () => { dlg.close(); this.openManual(); });
  },

  // Add or edit dialog for manual devices
  // 수동 장비 추가 및 편집 창
  openManual(edit = null) {
    const dlg = openDialog("manualTpl");
    const f = name => $(`[name="${name}"]`, dlg.root);
    if (edit) {
      $("h3", dlg.root).textContent = t("dlg_edit");
      $('[data-act="save"]', dlg.root).textContent = t("b_save");
    }
    f("label").value = edit ? edit.label : "";
    f("host").value = edit ? edit.host : "";
    f("type").value = edit ? edit.type : "l2";
    f("type")._combo.refresh();
    f("label").focus();
    const setErr = (name, msg) => {
      f(name).classList.toggle("invalid", !!msg);
      $(".error", f(name).parentElement).textContent = msg || "";
      return !msg;
    };
    dlg.on("save", () => {
      const label = f("label").value.trim(), host = f("host").value.trim();
      const ok1 = setErr("label", label ? "" : t("err_required"));
      const ok2 = setErr("host", !host ? t("err_required") : /^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(host) ? "" : t("err_host"));
      if (!ok1 || !ok2) return;
      dlg.close();
      if (!edit) { this.addNode("ext:" + Date.now().toString(36), { label, type: f("type").value, host }); return; }
      const hostChanged = edit.host !== host;
      Object.assign(edit, { label, type: f("type").value, host });
      if (hostChanged) delete this.status[edit.id];
      this.render();
      this.save().then(() => this.startPoll());
    });
    dlg.on("cancel", () => dlg.close());
    dlg.root.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") dlg.fire("save"); });
  },

  // Bundle rename dialog
  // 묶음 이름 변경 창
  openGroupEdit(gid) {
    const gr = this.group(gid);
    if (!gr) return;
    const dlg = openDialog("groupTpl");
    const f = $('[name="label"]', dlg.root);
    f.value = this.groupName(gr);
    f.focus(); f.select();
    dlg.on("save", () => {
      const v = f.value.trim();
      if (!v) { f.classList.add("invalid"); $(".error", f.parentElement).textContent = t("err_required"); return; }
      dlg.close();
      if (v === t("map_group")) delete gr.label; else gr.label = v;
      this.repaint();
      this.save();
    });
    dlg.on("cancel", () => dlg.close());
    dlg.root.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") dlg.fire("save"); });
  },

  // Nearest free spot search
  // 가장 가까운 빈자리 탐색
  freeSpot(cx, cy) {
    if (cx === undefined) {
      const v = this.vp();
      cx = (v.clientWidth / 2 - this.cam.x) / this.cam.z;
      cy = (v.clientHeight / 2 - this.cam.y) / this.cam.z + 20;
    }
    const all = this.shown();
    const taken = (x, y) => all.some(n => Math.abs(n.x - x) < 130 && Math.abs(n.y - y) < 110);
    const tries = [[0, 0]];
    for (let r = 1; r <= 6; r++)
      for (let a = 0; a < 8; a++) tries.push([Math.round(Math.cos(a * Math.PI / 4) * r * 150), Math.round(Math.sin(a * Math.PI / 4) * r * 120)]);
    for (const [dx, dy] of tries) {
      const x = cx + dx, y = cy + dy;
      if (!taken(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
    return { x: Math.round(cx), y: Math.round(cy) };
  },

  async addNode(id, extra = {}) {
    if (this.nodes.some(n => n.id === id)) return;
    const p = this.freeSpot();
    this.nodes.push({ id, x: p.x, y: p.y, ...extra });
    this.toggleMenu(false);
    this.sel = id;
    this.render();
    this.pop(id);
    // Save before ping for manual device address
    // 수동 장비 주소 반영용 선저장
    await this.save();
    // Immediate status check for new device
    // 새 장비 즉시 상태 확인
    this.startPoll();
  },

  pop(id) {
    const el = this.elOf(id);
    if (el) $(".tile", el).animate([{ transform: "scale(.4)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 520, easing: EASE_SPRING });
  },

  // Shrink animation before callback
  // 콜백 전 축소 애니메이션
  vanish(id, fn) {
    const el = this.elOf(id);
    if (!el) { fn(); return; }
    el.style.pointerEvents = "none";
    el.animate([{ transform: "none", opacity: 1 }, { transform: "scale(.3)", opacity: 0 }],
      { duration: 220, easing: "cubic-bezier(.55, 0, 1, .45)", fill: "forwards" }).onfinish = fn;
  },

  removeNode(id) {
    this.vanish(id, () => {
      this.nodes = this.nodes.filter(n => n.id !== id);
      this.links = this.links.filter(l => !l.includes(id));
      delete this.status[id];
      if (this.sel === id) this.sel = null;
      this.selLink = null;
      this.render();
      this.save();
    });
  },

  // Removal of bundle and members from map
  // 묶음 및 구성 장비의 맵 제거
  removeGroup(gid) {
    const ids = new Set(this.members(gid).map(n => n.id));
    this.vanish(gid, () => {
      this.nodes = this.nodes.filter(n => !ids.has(n.id));
      this.links = this.links.filter(([a, b]) => !ids.has(a) && !ids.has(b));
      this.groups = this.groups.filter(g => g.id !== gid);
      ids.forEach(i => delete this.status[i]);
      if (this.side === gid) this.side = null;
      this.sel = null; this.selLink = null;
      this.render();
      this.save();
    });
  },

  removeLink(key) {
    this.links = this.links.filter(([a, b]) => [this.visId(a), this.visId(b)].sort().join("|") !== key);
    this.selLink = null;
    this.drawLinks();
    this.save();
  },

  // iOS folder animation section
  // iOS 폴더 애니메이션 영역
  elOf(id) { return document.querySelector(`#mapNodes .node[data-id="${CSS.escape(id)}"]`); },
  rectOf(id) { const el = this.elOf(id); return el && $(".tile", el).getBoundingClientRect(); },
  miniRects(gid) {
    const el = this.elOf(gid), out = {};
    if (el) el.querySelectorAll(".mini").forEach(c => { out[c.dataset.mid] = c.getBoundingClientRect(); });
    return out;
  },

  // FLIP animation from source rectangle
  // 원본 사각형 기준 FLIP 애니메이션
  flyFrom(el, from, { duration = 560, easing = EASE_SPRING, delay = 0, fade = false } = {}) {
    if (!el || !from) return;
    const to = el.getBoundingClientRect(), z = this.cam.z;
    const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) / z;
    const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) / z;
    const s = from.width / to.width;
    const frames = [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }];
    if (fade) { frames[0].opacity = 0; frames[1].opacity = 1; }
    return el.animate(frames, { duration, easing, delay, fill: "backwards" });
  },

  // Full node FLIP based on tile
  // 아이콘 기준 노드 전체 FLIP
  flyNode(id, from, delay = 0) {
    const el = this.elOf(id);
    if (!el || !from) return;
    const tile = $(".tile", el).getBoundingClientRect(), z = this.cam.z;
    const dx = (from.left + from.width / 2 - (tile.left + tile.width / 2)) / z;
    const dy = (from.top + from.height / 2 - (tile.top + tile.height / 2)) / z;
    const s = from.width / tile.width;
    el.style.zIndex = 3;
    el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }],
      { duration: 620, easing: EASE_SPRING, delay, fill: "backwards" }).onfinish = () => { el.style.zIndex = ""; };
    el.querySelectorAll(".n-name, .n-sub").forEach(x =>
      x.animate([{ opacity: 0 }, { opacity: 0, offset: .35 }, { opacity: 1 }], { duration: 620, delay, fill: "backwards" }));
  },

  // Folder plate fade on bundle release
  // 묶음 해제 시 폴더 판 축소
  ghostFolder(gr, rect) {
    if (!rect) return;
    const g = document.createElement("div");
    g.className = "ghost-folder";
    g.style.left = gr.x + "px"; g.style.top = gr.y + "px";
    $("#mapNodes").prepend(g);
    g.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.55)", opacity: 0 }],
      { duration: 360, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" }).onfinish = () => g.remove();
  },

  // Merge of dragged device into target
  // 끌어온 장비의 대상 병합
  merge(dragId, targetId) {
    const d = this.node(dragId);
    if (!d || d.g) return;
    const fromDrag = this.rectOf(dragId), fromTarget = this.rectOf(targetId);
    let gid = targetId, isNew = false;
    if (!this.isGroup(targetId)) {
      const tn = this.node(targetId);
      if (!tn || tn.g) return;
      gid = "grp:" + Date.now().toString(36);
      this.groups.push({ id: gid, x: tn.x, y: tn.y });
      tn.g = gid;
      isNew = true;
    }
    d.g = gid;
    this.sel = gid; this.selLink = null;
    this.render();
    const el = this.elOf(gid);
    if (el) {
      el.style.zIndex = 3;
      const tile = $(".tile", el);
      // Mini icon FLIP measured before folder animation
      // 폴더 애니메이션 전 측정한 미니 아이콘 FLIP
      const mini = id => el.querySelector(`.mini[data-mid="${CSS.escape(id)}"]`);
      if (isNew) this.flyFrom(mini(targetId), fromTarget, { duration: 600 });
      this.flyFrom(mini(dragId), fromDrag, { duration: 640, delay: isNew ? 60 : 0 });
      // Folder bounce by bundle type
      // 묶음 종류별 폴더 튕김 효과
      tile.animate(isNew ? [{ transform: "scale(1.28)" }, { transform: "none" }]
                         : [{ transform: "scale(1.14)" }, { transform: "none" }],
        { duration: 560, easing: EASE_SPRING });
      $(".badge", el).animate([{ transform: "scale(.2)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 480, delay: 200, easing: EASE_SPRING, fill: "backwards" });
      setTimeout(() => { el.style.zIndex = ""; }, 700);
    }
    this.save();
  },

  // Single device removal with bundle release at one member
  // 장비 한 대 제거 및 1대 남은 묶음 해제
  takeOut(id) {
    const n = this.node(id), gr = n && this.group(n.g);
    if (!gr) return;
    const minis = this.miniRects(gr.id), tileRect = this.rectOf(gr.id);
    const small = r => r && { left: r.left + r.width / 2 - 7, top: r.top + r.height / 2 - 7, width: 14, height: 14 };
    delete n.g;
    const rest = this.members(gr.id);
    let last = null;
    if (rest.length <= 1) {
      for (const m of rest) { delete m.g; m.x = gr.x; m.y = gr.y; last = m; }
      this.groups = this.groups.filter(g => g !== gr);
      this.side = null;
      this.sel = null;
    }
    // Old position exclusion for free spot search
    // 빈자리 탐색 시 기존 위치 제외
    n.x = n.y = -9999;
    const p = this.freeSpot(gr.x, gr.y);
    n.x = p.x; n.y = p.y;
    this.render();
    this.flyNode(id, minis[id] || small(tileRect));
    if (last) {
      this.ghostFolder(gr, tileRect);
      this.flyNode(last.id, minis[last.id] || small(tileRect), 40);
    } else {
      const el = this.elOf(gr.id);
      if (el) $(".tile", el).animate([{ transform: "scale(.92)" }, { transform: "none" }], { duration: 420, easing: EASE_SPRING });
    }
    this.save();
  },

  // Full bundle release
  // 묶음 전체 해제
  ungroup(gid) {
    const gr = this.group(gid);
    if (!gr) return;
    const minis = this.miniRects(gid), tileRect = this.rectOf(gid);
    const small = r => r && { left: r.left + r.width / 2 - 7, top: r.top + r.height / 2 - 7, width: 14, height: 14 };
    const ms = this.sortedMembers(gid).map(m => m.n);
    this.groups = this.groups.filter(g => g !== gr);
    ms.forEach((m, i) => {
      delete m.g;
      m.x = m.y = -9999;
      const p = i === 0 ? { x: gr.x, y: gr.y } : this.freeSpot(gr.x, gr.y);
      m.x = p.x; m.y = p.y;
    });
    if (this.side === gid) this.side = null;
    this.sel = null;
    this.render();
    this.ghostFolder(gr, tileRect);
    ms.forEach((m, i) => this.flyNode(m.id, minis[m.id] || small(tileRect), Math.min(i, 12) * 25));
    this.save();
  },

  // Bundle side bar section
  // 묶음 사이드 바 영역
  openSide(gid) {
    this.side = gid;
    this.sel = gid; this.selLink = null;
    this.repaint(); this.drawLinks();
  },

  closeSide() {
    if (!this.side) return;
    this.side = null;
    this.renderSide();
  },

  renderSide() {
    const box = $("#mapSide"), gid = this.side;
    box.classList.toggle("open", !!gid);
    box.inert = !gid;
    // List rebuild skip during reorder
    // 순서 변경 중 목록 재생성 생략
    if (!gid || this.sideDrag) return;
    const ms = this.sortedMembers(gid);
    const ok = ms.filter(m => m.s === true).length, bad = ms.filter(m => m.s === false).length;
    if (!this.renaming) $("#mapSideTitle").textContent = this.groupName(this.group(gid));
    $("#mapSideCount").textContent = ms.length;
    const sum = [t("map_side_ok", { n: ok })];
    if (bad) sum.push(t("map_side_bad", { n: bad }));
    if (ms.length - ok - bad) sum.push(t("map_side_wait", { n: ms.length - ok - bad }));
    $("#mapSideSum").textContent = sum.join(", ");
    $("#mapSideSum").classList.toggle("bad", bad > 0);
    $("#mapSideList").replaceChildren(...ms.map(({ n, it, s }) => {
      const row = document.createElement("div");
      row.className = "side-row" + (s === true ? " alive" : s === false ? " dead" : "");
      row.innerHTML = `<span class="dev-icon icon"></span>
        <span class="pick-text"><span class="pick-name"></span><span class="pick-sub"></span></span>
        <span class="side-state"></span>
        <button class="icon-btn icon side-out">&#xE8E6;</button>`;
      $(".dev-icon", row).textContent = this.icon(it);
      $(".pick-name", row).textContent = RC.name(it);
      $(".pick-sub", row).textContent = it.host;
      $(".side-state", row).textContent = s === true ? t("map_alive") : s === false ? t("map_dead") : t("map_checking");
      const out = $(".side-out", row);
      out.title = t("map_take_out");
      out.addEventListener("click", () => this.takeOut(n.id));
      row.addEventListener("contextmenu", e => { e.preventDefault(); this.openCtx(e, n.id); });
      row.dataset.id = n.id;
      row.addEventListener("pointerdown", e => this.rowPress(e, row, gid, n.id));
      return row;
    }));
  },

  // Inline bundle rename by double click
  // 더블클릭 기반 묶음 이름 즉시 수정
  renameInline() {
    const gid = this.side, gr = this.group(gid);
    if (!gr || this.renaming) return;
    const h = $("#mapSideTitle"), input = document.createElement("input");
    input.className = "side-rename";
    input.maxLength = 60;
    input.value = this.groupName(gr);
    h.replaceChildren(input);
    this.renaming = true;
    input.focus(); input.select();
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      this.renaming = false;
      const v = input.value.trim();
      if (save && v && v !== this.groupName(gr)) {
        if (v === t("map_group")) delete gr.label; else gr.label = v;
        this.save();
      }
      this.repaint();
    };
    input.addEventListener("keydown", e => {
      // Esc isolation from side bar close
      // Esc의 사이드 바 닫힘 방지
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  },

  // Long press reorder in side bar list
  // 사이드 바 목록의 길게 누르기 순서 변경
  rowPress(e, row, gid, id) {
    if (e.button !== 0 || e.target.closest(".side-out")) return;
    const list = $("#mapSideList"), sx = e.clientX, sy = e.clientY, st0 = list.scrollTop;
    let lifted = false, rows = [], rects = [], idx = 0, target = 0, h = 0;
    row.classList.add("pressing");
    const lift = () => {
      lifted = true;
      this.sideDrag = true;
      rows = [...list.children];
      rects = rows.map(r => r.getBoundingClientRect());
      idx = target = rows.indexOf(row);
      h = rects[idx].height + 2;
      row.classList.remove("pressing");
      row.classList.add("lifted");
      list.classList.add("sorting");
    };
    const timer = setTimeout(lift, 350);
    const move = ev => {
      // Long press cancel on early movement
      // 조기 이동 시 길게 누르기 취소
      if (!lifted) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) end(ev);
        return;
      }
      const lr = list.getBoundingClientRect();
      if (ev.clientY < lr.top + 28) list.scrollTop -= 8;
      else if (ev.clientY > lr.bottom - 28) list.scrollTop += 8;
      const dy = ev.clientY - sy + (list.scrollTop - st0);
      row.style.transform = `translateY(${dy}px) scale(1.02)`;
      const c = rects[idx].top + rects[idx].height / 2 + dy;
      target = idx;
      rows.forEach((r, i) => {
        if (i === idx) return;
        const mid = rects[i].top + rects[i].height / 2;
        let shift = 0;
        if (i < idx && c < mid) { shift = h; target = Math.min(target, i); }
        if (i > idx && c > mid) { shift = -h; target = Math.max(target, i); }
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };
    const end = ev => {
      clearTimeout(timer);
      row.classList.remove("pressing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!lifted) return;
      this.sideDrag = false;
      list.classList.remove("sorting");
      row.classList.remove("lifted");
      rows.forEach(r => { r.style.transform = ""; });
      if (ev.type === "pointerup" && target !== idx) {
        const others = rows.filter(r => r !== row).map(r => r.dataset.id);
        this.reorder(gid, id, others[target] || null);
      } else this.renderSide();
    };
    // Window level pointer handling
    // 창 전체 포인터 이벤트 처리
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  },

  // Context menu section
  // 오른쪽 클릭 메뉴 영역
  openCtx(e, id) {
    if (this.linkMode) return;
    if (!this.isGroup(id) && !this.node(id)?.g) this.select(id);
    else if (this.isGroup(id)) this.select(id);
    showCtx(e.clientX, e.clientY, [
      { icon: "", label: t("b_edit"), run: () => this.editAny(id) },
      { icon: "", label: t("b_delete"), run: () => this.deleteAny(id) },
    ]);
  },

  editAny(id) {
    if (this.isGroup(id)) return this.openGroupEdit(id);
    if (id.startsWith("ext:")) return this.openManual(this.node(id));
    const it = RC.items.find(x => x.id === id);
    // Shared edit dialog for inspection devices
    // 점검 장비 공용 편집 창
    if (it) RC.openEdit(it);
  },

  deleteAny(id) {
    if (this.isGroup(id)) {
      const n = this.members(id).length;
      const ask = openDialog("confirmTpl");
      $("h3", ask.root).textContent = t("map_group_del_title");
      $(".msg", ask.root).textContent = t("map_group_del_msg", { name: this.groupName(this.group(id)), n });
      ask.on("ok", () => { ask.close(); this.removeGroup(id); });
      ask.on("cancel", () => ask.close());
      return;
    }
    const n = this.node(id);
    if (n && n.g) { this.takeOut(id); setTimeout(() => this.removeNode(id), 650); return; }
    this.removeNode(id);
  },

  // Selection and drag section
  // 선택 및 끌기 영역
  select(id) { this.sel = id; this.selLink = null; this.repaint(); this.drawLinks(); },

  selectLink(key) {
    if (this.linkMode) return;
    this.sel = null; this.selLink = key;
    this.closeSide();
    this.repaint(); this.drawLinks();
  },

  clearSel() {
    if (this.linkMode) { this.pick = null; this.updateTools(); }
    this.sel = null; this.selLink = null;
    this.side = null;
    this.repaint(); this.drawLinks();
  },

  clickNode(id) {
    if (this.isGroup(id)) {
      if (this.linkMode) { showInfo("warn", t("map_link_group"), null, 3000); return; }
      this.openSide(id);
      return;
    }
    if (!this.linkMode) { this.side = null; this.select(id); return; }
    if (!this.pick) this.pick = id;
    else if (this.pick === id) this.pick = null;
    else {
      const a = this.pick;
      this.pick = null;
      if (this.links.some(([x, y]) => (x === a && y === id) || (x === id && y === a))) showInfo("warn", t("map_link_dup"), null, 2500);
      else { this.links.push([a, id]); this.save(); }
    }
    this.repaint(); this.drawLinks(); this.updateTools();
  },

  // Drag handling for devices and bundles
  // 장비 및 묶음 끌기 처리
  // Folder plate after hover delay
  // 대기 시간 후 폴더 판 표시
  // Merge only on drop while plate is visible
  // 폴더 판 표시 상태의 놓기에서만 병합
  onDown(e, o, el) {
    if (e.button !== 0 || e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation();
    closeCtx();
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
    const canMerge = !this.isGroup(o.id) && !this.linkMode;
    let moved = false, target = null, armed = false, timer = null;
    const setTarget = id => {
      if (id === target) return;
      clearTimeout(timer);
      if (target) { const t0 = this.elOf(target); if (t0) t0.classList.remove("fold-hint"); }
      target = id; armed = false;
      el.classList.remove("over");
      if (!id) return;
      timer = setTimeout(() => {
        armed = true;
        el.classList.add("over");
        const tel = this.elOf(id);
        if (tel) tel.classList.add("fold-hint");
      }, this.isGroup(id) ? MERGE_ADD_MS : MERGE_NEW_MS);
    };
    const move = ev => {
      const z = this.cam.z, dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      // Small movement treated as click
      // 미세 이동의 클릭 처리
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      el.classList.add("drag");
      let x = ox + dx, y = oy + dy;
      // Grid intersection snap
      // 격자 교차점 스냅
      if (ev.shiftKey) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID; }
      const b = this.bounds();
      o.x = Math.round(Math.min(b.x2 - 80, Math.max(b.x1 + 80, x)));
      o.y = Math.round(Math.min(b.y2 - 90, Math.max(b.y1 + 50, y)));
      this.place(el, o);
      this.drawLinks();
      if (canMerge) {
        let best = null, bd = MERGE_DIST;
        for (const c of this.shown()) {
          if (c.id === o.id) continue;
          const d = Math.hypot(c.x - o.x, c.y - o.y);
          if (d < bd) { bd = d; best = c.id; }
        }
        setTarget(best);
      }
    };
    const cleanup = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.classList.remove("drag", "over");
    };
    const up = ev => {
      const drop = armed && target && ev.type === "pointerup" ? target : null;
      cleanup();
      setTarget(null);
      // Merge on drop over active plate
      // 폴더 판 위 놓기 시 병합
      if (drop) { this.merge(o.id, drop); return; }
      if (moved) { this.fitWorld(); this.save(); }
      else this.clickNode(o.id);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  },

  // Save section
  // 저장 영역
  async save() {
    const r = await api().save_map({ nodes: this.nodes, groups: this.groups, links: this.links });
    if (!r.ok) showInfo("bad", t("cfg_error", { msg: r.error }));
  },

  // Liveness polling section
  // 응답 확인 영역
  startPoll() {
    this.stopPoll();
    const gen = this.gen;
    const loop = async () => {
      if (gen !== this.gen) return;
      if (this.active && !document.hidden && this.nodes.length) {
        try {
          const r = await api().map_ping(this.nodes.map(n => n.id));
          if (gen !== this.gen) return;
          Object.assign(this.status, r);
          this.repaint();
          this.drawLinks();
        // Retry on next poll
        // 다음 주기 재시도
        } catch (e) { }
      }
      if (gen === this.gen) this.timer = setTimeout(loop, MAP_POLL_MS);
    };
    loop();
  },

  stopPoll() { this.gen++; clearTimeout(this.timer); },
};

// Windows 11 context menu section
// Win11 오른쪽 클릭 메뉴 영역
let ctxEl = null;
function showCtx(x, y, items) {
  closeCtx();
  const m = document.createElement("div");
  m.className = "ctx";
  m.setAttribute("role", "menu");
  for (const it of items) {
    const b = document.createElement("button");
    b.className = "ctx-item";
    b.setAttribute("role", "menuitem");
    b.innerHTML = `<span class="icon"></span><span></span>`;
    b.children[0].textContent = it.icon;
    b.children[1].textContent = it.label;
    b.addEventListener("click", () => { closeCtx(); it.run(); });
    m.append(b);
  }
  document.body.append(m);
  // Flip when menu exceeds window
  // 창 초과 시 메뉴 방향 전환
  const r = m.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const up = y + r.height > H - 8;
  m.style.left = Math.max(8, Math.min(x, W - r.width - 8)) + "px";
  m.style.top = (up ? Math.max(8, y - r.height) : y) + "px";
  m.classList.add(up ? "from-bottom" : "from-top");
  m.querySelector("button").focus({ preventScroll: true });
  ctxEl = m;
}
function closeCtx() {
  if (!ctxEl) return;
  const m = ctxEl;
  ctxEl = null;
  m.classList.add("closing");
  setTimeout(() => m.remove(), 120);
}

// Top tab view switch section
// 상단 탭 화면 전환 영역
function showView(view) {
  document.body.dataset.view = view;
  document.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $("#viewCheck").hidden = view !== "check";
  $("#viewMap").hidden = view !== "map";
  hideInfo();
  MAP.show(view === "map");
}

// Map refresh after inspection item edits
// 점검 장비 편집 후 맵 갱신
for (const fn of ["updateItem", "deleteItem"]) {
  const orig = RC[fn];
  RC[fn] = function (...a) { const r = orig.apply(this, a); if (MAP.active) MAP.render(); return r; };
}

document.querySelectorAll(".seg-btn").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
$("#mapFab").addEventListener("click", () => MAP.toggleMenu());
$("#mapAddDev").addEventListener("click", () => MAP.openPicker());
$("#mapAddLink").addEventListener("click", () => MAP.setLinkMode(!MAP.linkMode));
$("#mapScroll").addEventListener("pointerdown", e => {
  // Map pan by Ctrl drag or middle button drag
  // Ctrl 또는 휠 버튼 끌기 기반 맵 이동
  if (e.button === 1 || (e.button === 0 && e.ctrlKey)) MAP.startPan(e);
}, true);
$("#mapScroll").addEventListener("pointerdown", e => { if (e.button === 0) { closeCtx(); MAP.clearSel(); } });
$("#mapScroll").addEventListener("wheel", e => MAP.onWheel(e), { passive: false });
$("#mapScroll").addEventListener("contextmenu", e => e.preventDefault());
$("#mapSideTitle").addEventListener("dblclick", () => MAP.renameInline());
$("#mapSideClose").addEventListener("click", () => { MAP.sel = null; MAP.closeSide(); MAP.repaint(); });
window.addEventListener("resize", () => { if (MAP.active) { MAP.fitWorld(); MAP.settle(0); } closeCtx(); });
window.addEventListener("blur", () => { closeCtx(); $("#viewMap").classList.remove("pan-ready"); });
document.addEventListener("pointerdown", e => { if (ctxEl && !ctxEl.contains(e.target)) closeCtx(); }, true);
document.addEventListener("visibilitychange", () => { if (MAP.active && !document.hidden) MAP.startPoll(); });
document.addEventListener("keyup", e => { if (e.key === "Control") $("#viewMap").classList.remove("pan-ready"); });
document.addEventListener("keydown", e => {
  if (e.key === "Control" && MAP.active) $("#viewMap").classList.add("pan-ready");
  if (ctxEl) {
    const its = [...ctxEl.querySelectorAll(".ctx-item")], i = its.indexOf(document.activeElement);
    if (e.key === "Escape") { closeCtx(); e.preventDefault(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      its[(i + (e.key === "ArrowDown" ? 1 : its.length - 1)) % its.length].focus();
      return;
    }
    return;
  }
  if (!MAP.active || document.querySelector(".smoke") || e.target.tagName === "INPUT") return;
  if (e.ctrlKey && e.key === "0") { e.preventDefault(); MAP.resetZoom(); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (MAP.isGroup(MAP.sel)) MAP.ungroup(MAP.sel);
    else if (MAP.sel) MAP.removeNode(MAP.sel);
    else if (MAP.selLink !== null) MAP.removeLink(MAP.selLink);
  } else if (e.key === "Escape") {
    if (MAP.linkMode) MAP.setLinkMode(false);
    else if (MAP.side) { MAP.sel = null; MAP.closeSide(); MAP.repaint(); }
    else if (MAP.open) MAP.toggleMenu(false);
    else MAP.clearSel();
  }
});
