// Main window logic with immediate config persistence
// 설정 즉시 저장 방식의 메인 창 동작

const api = () => window.pywebview.api;
const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = { cisco_ios: "", cisco_nxos: "", paloalto_panos: "", server: "" };
const DEFAULT_PORT = { device: 22, server: 5985 };

const RC = {
  items: [],
  // Inspection state by item id
  // 장비 id별 점검 상태
  status: {},
  busy: false,
  newSeq: 0,

  // Rendering section
  // 그리기 영역
  name(it) { return (LANG === "en" && it.label_en) ? it.label_en : it.label; },

  renderAll() {
    document.documentElement.lang = LANG;
    applyI18n();
    for (const kind of ["device", "server"]) {
      const rows = $(`.card[data-kind="${kind}"] .rows`);
      rows.replaceChildren(...this.items.filter(it => it.kind === kind).map(it => this.makeItem(it)));
      this.updateEmpty(kind);
    }
    this.updateButtons();
    if (MAP.active) MAP.render();
  },

  makeItem(it) {
    const el = document.createElement("div");
    el.className = "item";
    el.dataset.id = it.id;
    el.innerHTML = `
      <div class="row">
        <div class="dev-icon icon"></div>
        <div class="dev-name">
          <div class="name"><span></span><button class="icon-btn icon edit">&#xE70F;</button><button class="icon-btn icon edit cam">&#xE722;</button></div>
          <div class="sub"></div>
        </div>
        <input class="input pw" type="password">
        <div class="status"></div>
      </div>
      <div class="metrics"></div>`;
    const pw = $(".pw", el);
    pw.value = it.password || "";
    pw.addEventListener("input", () => { it.password = pw.value; });
    $(".edit:not(.cam)", el).addEventListener("click", () => this.openEdit(it));
    $(".cam", el).addEventListener("click", () => this.capture(it));
    this.fillItem(el, it);
    return el;
  },

  fillItem(el, it) {
    $(".dev-icon", el).textContent = ICONS[it.kind === "server" ? "server" : it.type] || ICONS.server;
    $(".name span", el).textContent = this.name(it);
    $(".sub", el).textContent = `${it.host}, ${it.username}`;
    $(".edit", el).title = t("tip_edit");
    $(".cam", el).title = t("tip_capture");
    // Capture button for Palo Alto only
    // Palo Alto 전용 캡처 버튼
    $(".cam", el).hidden = !(it.kind === "device" && it.type === "paloalto_panos");
    $(".cam", el).disabled = this.busy || this.capturing;
    $(".pw", el).placeholder = t("pw_ph");
    $(".edit", el).disabled = this.busy;
    $(".pw", el).disabled = this.busy;
    this.fillStatus(el, it);
  },

  fillStatus(el, it) {
    const st = this.status[it.id] || { state: "wait" };
    const box = $(".status", el), m = $(".metrics", el);
    m.replaceChildren();
    // Status icon with tooltip text
    // 툴팁 포함 상태 아이콘
    const icon = (cls, key) => `<span class="status-icon ${cls}" title="${t(key)}"></span>`;
    if (st.state === "running") box.innerHTML = '<span class="ring"></span>';
    else if (st.state === "skip") box.innerHTML = icon("skip", "st_skip");
    else if (st.state === "error") {
      box.innerHTML = icon("fail", "st_fail");
      const err = document.createElement("span"); err.className = "err"; err.textContent = st.error;
      const more = document.createElement("a"); more.textContent = t("details");
      const pre = document.createElement("pre"); pre.textContent = st.detail; pre.hidden = true;
      more.onclick = () => { pre.hidden = !pre.hidden; };
      m.append(err, more, pre);
    } else if (st.state === "done") {
      const v = st.result.verdict;
      box.innerHTML = icon(v === "정상" ? "ok" : v === "이상" ? "bad" : "warn", "v_" + v);
      m.textContent = this.metricsText(st.result);
    } else box.innerHTML = "";
  },

  metricsText(r) {
    const pct = v => (v === null || v === undefined) ? "-" : `${Number(v).toFixed(1)}%`;
    const parts = [`CPU ${pct(r.cpu)}`, `MEM ${pct(r.mem)}`];
    if (r.ports !== undefined) parts.push(r.ports);
    else for (const [d, p] of r.disks) parts.push(`${d}: ${pct(p)}`);
    return parts.join(", ");
  },

  itemEl(id) { return document.querySelector(`.item[data-id="${CSS.escape(id)}"]`); },

  updateEmpty(kind) {
    const card = $(`.card[data-kind="${kind}"]`);
    const has = this.items.some(it => it.kind === kind);
    let empty = $(".empty", card);
    if (!has && !empty) {
      empty = document.createElement("div"); empty.className = "empty";
      // Empty message above add button
      // 추가 버튼 위의 빈 목록 문구
      $(".rows", card).after(empty);
    }
    if (empty) { if (has) empty.remove(); else empty.textContent = t("empty"); }
  },

  updateButtons() {
    $("#runBtn").textContent = this.busy ? t("running") : t("run");
    $("#runBtn").disabled = this.busy || this.items.length === 0;
    document.querySelectorAll(".add-btn, #settingsBtn").forEach(b => { b.disabled = this.busy; });
    $("#savePw").disabled = this.busy;
  },

  // Height animation section
  // 높이 애니메이션 영역
  expand(el) {
    el.style.height = "0px"; el.style.opacity = "0";
    // Layout flush before expansion
    // 펼침 전 레이아웃 확정
    el.offsetHeight;
    el.style.height = el.scrollHeight + "px"; el.style.opacity = "1";
    onTransitionEnd(el, () => { el.style.height = ""; el.style.opacity = ""; });
  },

  collapse(el, done) {
    el.style.height = el.scrollHeight + "px";
    // Layout flush before collapse
    // 접힘 전 레이아웃 확정
    el.offsetHeight;
    el.style.height = "0px"; el.style.opacity = "0";
    onTransitionEnd(el, done);
  },

  // Edit, add, and delete section
  // 편집, 추가, 삭제 영역
  openEdit(it) { this.openItemDialog(it.kind, it); },

  openItemDialog(kind, it = null) {
    const dlg = openDialog("editTpl");
    const f = name => $(`[name="${name}"]`, dlg.root);
    const isNew = !it;
    $(".title", dlg.root).textContent = isNew ? t(kind === "device" ? "dlg_add_net" : "dlg_add_sv") : t("dlg_edit");
    dlg.root.querySelectorAll(kind === "device" ? ".only-server" : ".only-device").forEach(e => e.remove());
    $('[data-act="save"]', dlg.root).textContent = isNew ? t("b_add") : t("b_save");
    if (isNew) $('[data-act="delete"]', dlg.root).remove();

    const src = it || { kind, type: "cisco_ios", label: "", host: "", username: "", port: DEFAULT_PORT[kind],
                        use_ps: true };
    f("label").value = this.name(src);
    f("host").value = src.host;
    f("username").value = src.username;
    f("port").value = src.port ?? DEFAULT_PORT[kind];
    if (kind === "device") { f("type").value = src.type || "cisco_ios"; f("type")._combo.refresh(); }
    else f("use_ps").checked = src.use_ps !== false;
    f("label").focus();

    const validate = () => {
      let ok = true;
      const setErr = (name, msg) => {
        const input = f(name); input.classList.toggle("invalid", !!msg);
        $(".error", input.parentElement).textContent = msg || "";
        if (msg) ok = false;
      };
      for (const name of ["label", "host", "username"]) setErr(name, f(name).value.trim() ? "" : t("err_required"));
      const port = Number(f("port").value);
      setErr("port", Number.isInteger(port) && port >= 1 && port <= 65535 ? "" : t("err_port"));
      return ok;
    };

    dlg.on("save", () => {
      if (!validate()) return;
      const data = {
        host: f("host").value.trim(), username: f("username").value.trim(),
        port: Number(f("port").value),
      };
      const name = f("label").value.trim();
      if (kind === "device") data.type = f("type").value; else data.use_ps = f("use_ps").checked;
      dlg.close();
      if (isNew) this.addItem({ id: `new:${++this.newSeq}`, kind, label: name, password: "", ...data });
      else this.updateItem(it, name, data);
    });
    dlg.on("delete", () => {
      const ask = openDialog("confirmTpl");
      $(".msg", ask.root).textContent = t("del_msg", { name: this.name(it) });
      ask.on("ok", () => { ask.close(); dlg.close(); this.deleteItem(it); });
      ask.on("cancel", () => ask.close());
    });
    dlg.on("cancel", () => dlg.close());
    dlg.root.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") dlg.fire("save"); });
  },

  addItem(it) {
    // Insertion after last item of same kind
    // 같은 종류 마지막 장비 뒤 삽입
    const lastIdx = this.items.map(x => x.kind).lastIndexOf(it.kind);
    this.items.splice(lastIdx + 1, 0, it);
    const el = this.makeItem(it);
    $(`.card[data-kind="${it.kind}"] .rows`).append(el);
    this.updateEmpty(it.kind);
    this.expand(el);
    this.updateButtons();
    this.persist("add", it.kind);
  },

  updateItem(it, name, data) {
    if (LANG === "en" && it.label_en) it.label_en = name; else it.label = name;
    Object.assign(it, data);
    delete this.status[it.id];
    this.fillItem(this.itemEl(it.id), it);
    this.persist("edit", it.kind);
  },

  deleteItem(it) {
    const el = this.itemEl(it.id);
    this.items = this.items.filter(x => x !== it);
    delete this.status[it.id];
    this.updateButtons();
    this.collapse(el, () => { el.remove(); this.updateEmpty(it.kind); });
    this.persist("delete", it.kind);
  },

  // Config save with new id mapping and result notice
  // config 저장, 신규 id 반영, 결과 알림
  async persist(action, kind) {
    const r = await api().save_items(this.items);
    if (!r.ok) { showInfo("bad", t("cfg_error", { msg: r.error })); return; }
    for (const [oldId, newId] of Object.entries(r.ids || {})) {
      const it = this.items.find(x => x.id === oldId);
      if (!it) continue;
      const el = this.itemEl(oldId);
      it.id = newId;
      if (el) el.dataset.id = newId;
      if (this.status[oldId]) { this.status[newId] = this.status[oldId]; delete this.status[oldId]; }
    }
    showInfo("ok", t(`done_${action}_${kind}`), null, 2500);
  },

  // Inspection section
  // 점검 영역
  run() {
    if (this.busy) return;
    if (!this.items.some(it => it.password)) { showInfo("warn", t("need_pw")); return; }
    hideInfo();
    this.busy = true;
    this.status = {};
    $("#saveBtn").disabled = true;
    this.items.forEach(it => this.fillItem(this.itemEl(it.id), it));
    this.updateButtons();
    api().run(this.items, $("#savePw").checked);
  },

  onProgress(p) {
    if (p.state === "finished") {
      this.busy = false;
      this.items.forEach(it => this.fillItem(this.itemEl(it.id), it));
      this.updateButtons();
      $("#saveBtn").disabled = p.count === 0;
      const count = s => Object.values(this.status).filter(s).length;
      showInfo("ok", t("done", {
        ok: count(s => s.state === "done" && s.result.verdict === "정상"),
        bad: count(s => s.state === "done" && s.result.verdict !== "정상"),
        fail: count(s => s.state === "error"),
      }));
      return;
    }
    this.status[p.id] = p;
    const it = this.items.find(x => x.id === p.id), el = this.itemEl(p.id);
    if (it && el) this.fillStatus(el, it);
  },

  async capture(it) {
    if (this.capturing) return;
    if (!it.password) { showInfo("warn", t("cap_no_pw")); return; }
    this.capturing = true;
    const cam = $(".cam", this.itemEl(it.id));
    cam.disabled = true;
    cam.innerHTML = '<span class="ring"></span>';
    showInfo("busy", t("cap_running"), null, 0);
    try {
      const r = await api().capture_dashboard(it);
      if (r.ok) showInfo("ok", t("cap_ok", { file: r.file }), { label: t("cap_show"), run: () => api().show_file(r.path) }, 10000);
      else if (r.code === "no_password") showInfo("warn", t("cap_no_pw"));
      else if (r.code === "login_failed") showInfo("bad", t("cap_login_failed"));
      else showInfo("bad", t("cap_error", { msg: r.error || "" }));
    } finally {
      this.capturing = false;
      const el = this.itemEl(it.id);
      if (el) { $(".cam", el).innerHTML = "&#xE722;"; this.fillItem(el, it); }
    }
  },

  async saveCsv() {
    const r = await api().save_csv();
    if (r.ok) showInfo("ok", t("saved_ok", { file: r.file }), { label: t("cap_show"), run: () => api().show_file(r.path) }, 10000);
    else if (r.code === "locked") showInfo("bad", t("save_locked"));
    else if (r.code === "nothing") showInfo("warn", t("nothing"));
    else if (r.code === "error") showInfo("bad", t("save_error", { msg: r.error }));
  },

  // Settings section
  // 환경 설정 영역
  openSettings() {
    const dlg = openDialog("settingsTpl");
    const lang = $('[name="lang"]', dlg.root), theme = $('[name="theme"]', dlg.root);
    for (const [code, name] of Object.entries(LANG_NAMES)) lang.add(new Option(name, code));
    lang.value = LANG; theme.value = THEME;
    lang._combo.refresh(); theme._combo.refresh();
    const apply = () => {
      LANG = lang.value;
      applyTheme(theme.value, "main");
      api().apply_settings(LANG, THEME);
      this.renderAll();
      applyI18n(dlg.root);
    };
    dlg.on("apply", apply);
    dlg.on("ok", () => { apply(); dlg.close(); });
    dlg.on("cancel", () => dlg.close());
  },
};

// Common helpers section
// 공통 도구 영역
function onTransitionEnd(el, fn) {
  let done = false;
  const finish = () => { if (!done) { done = true; fn(); } };
  el.addEventListener("transitionend", e => { if (e.target === el && e.propertyName === "height") finish(); });
  // Fallback for missing transitionend event
  // transitionend 미발생 대비
  setTimeout(finish, 450);
}

function openDialog(tplId) {
  const root = document.getElementById(tplId).content.firstElementChild.cloneNode(true);
  applyI18n(root);
  document.body.append(root);
  makeCombos(root);
  root.offsetHeight;
  root.classList.add("show");
  const handlers = {};
  const dlg = {
    root,
    on(act, fn) { handlers[act] = fn; },
    fire(act) { if (handlers[act]) handlers[act](); },
    close() {
      root.classList.remove("show");
      document.removeEventListener("keydown", onKey);
      root.querySelectorAll("select.combo").forEach(sel => sel._combo.close());
      setTimeout(() => root.remove(), 200);
    },
  };
  root.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => dlg.fire(b.dataset.act)));
  const onKey = e => { if (e.key === "Escape") dlg.fire("cancel"); };
  document.addEventListener("keydown", onKey);
  return dlg;
}

let infoTimer;
function showInfo(kind, msg, action = null, duration = 6000) {
  const bar = $("#infobar");
  const act = $(".act", bar);
  act.hidden = !action;
  if (action) { act.textContent = action.label; act.onclick = action.run; }
  bar.className = `infobar ${kind} show`;
  const ic = $(".status-icon", bar);
  ic.className = kind === "busy" ? "status-icon" : `status-icon ${kind === "bad" ? "fail" : kind === "warn" ? "bad" : "ok"}`;
  ic.innerHTML = kind === "busy" ? '<span class="ring"></span>' : "";
  $(".msg", bar).textContent = msg;
  clearTimeout(infoTimer);
  if (duration) infoTimer = setTimeout(hideInfo, duration);
}
function hideInfo() { $("#infobar").classList.remove("show"); }

// Startup section
// 시작 영역
$("#runBtn").addEventListener("click", () => RC.run());
$("#saveBtn").addEventListener("click", () => RC.saveCsv());
$("#settingsBtn").addEventListener("click", () => RC.openSettings());
document.querySelectorAll(".card[data-kind]").forEach(card =>
  $(".add-btn", card).addEventListener("click", () => RC.openItemDialog(card.dataset.kind)));

onApiReady(async () => {
  const init = await api().main_init();
  LANG = init.lang;
  RC.items = init.items;
  MAP.init(init.map);
  $("#savePw").checked = init.save_pw;
  applyTheme(init.theme, "main");
  darkQuery.addEventListener("change", () => { if (THEME === "system") applyTheme(THEME, "main"); });
  RC.renderAll();
  api().ready("main");
});
