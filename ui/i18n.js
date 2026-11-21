// UI text dictionaries by language
// 언어별 화면 문구 사전
const LANG_NAMES = { en: "English", ko: "한국어" };

const STRINGS = {
  ko: {
    lang_msg: "사용할 언어를 선택하세요.",
    lang_remember: "이 설정 기억하기",
    lang_next: "다음",
    loading: "불러오는 중...",


    sec_net: "네트워크 장비",
    sec_sv: "서버",
    pw_ph: "비밀번호",
    tip_edit: "편집",
    tip_capture: "대시보드 캡처",
    cap_running: "방화벽 대시보드를 캡처하는 중입니다. 캡처 창이 저절로 닫힐 때까지 기다리세요.",
    cap_ok: "{file}로 저장했습니다.",
    cap_show: "폴더에서 보기",
    cap_no_pw: "방화벽 비밀번호를 입력하세요.",
    cap_login_failed: "방화벽 웹에 로그인하지 못했습니다. 비밀번호를 확인하세요.",
    cap_error: "캡처하지 못했습니다. {msg}",
    tip_add_net: "네트워크 장비 추가",
    tip_add_sv: "서버 추가",
    tip_settings: "환경 설정",
    empty: "등록된 장비가 없습니다. 오른쪽 아래 + 를 눌러 추가하세요.",

    st_wait: "대기",
    st_skip: "건너뜀",
    st_fail: "실패",
    v_정상: "정상",
    v_이상: "이상",
    v_확인필요: "확인필요",
    details: "자세히",

    save_pw: "비밀번호 저장",
    run: "점검 실행",
    running: "점검 중...",
    save_csv: "CSV로 내보내기",
    need_pw: "비밀번호를 하나 이상 입력하세요.",
    done: "점검을 마쳤습니다. 정상 {ok}, 이상 {bad}, 실패 {fail}",
    saved_ok: "{file}에 저장했습니다.",
    save_locked: "CSV 파일이 열려 있습니다. 파일을 닫고 다시 저장하세요.",
    save_error: "저장하지 못했습니다. {msg}",
    nothing: "저장할 점검 결과가 없습니다.",

    dlg_edit: "장비 편집",
    dlg_add_net: "네트워크 장비 추가",
    dlg_add_sv: "서버 추가",
    f_name: "이름",
    f_type: "종류",
    f_host: "IP 주소",
    f_user: "사용자 이름",
    f_port: "포트",
    f_ps: "PowerShell 사용",
    f_ps_hint: "Windows Server 2008(R2 아님)처럼 PowerShell이 없는 서버는 끄세요. 끄면 wmic으로 조회합니다.",
    type_cisco_ios: "L3 스위치 (Cisco IOS)",
    type_cisco_nxos: "L3 스위치 (Cisco Nexus)",
    type_paloalto_panos: "방화벽 (Palo Alto)",
    done_add_device: "장비가 추가되었습니다.",
    done_add_server: "서버가 추가되었습니다.",
    done_edit_device: "장비가 수정되었습니다.",
    done_edit_server: "서버가 수정되었습니다.",
    done_delete_device: "장비가 삭제되었습니다.",
    done_delete_server: "서버가 삭제되었습니다.",
    cfg_error: "config.json에 저장하지 못했습니다. {msg}",
    del_title: "장비 삭제",
    del_msg: "{name}을(를) 삭제할까요?\n설정 파일과 저장된 비밀번호가 모두 삭제됩니다.",
    err_required: "입력하세요.",
    err_port: "1~65535 사이 숫자를 입력하세요.",

    settings: "환경 설정",
    s_lang: "언어",
    s_theme: "테마",
    theme_system: "Windows 설정 따르기",
    theme_light: "라이트",
    theme_dark: "다크",

    b_ok: "확인",
    b_cancel: "취소",
    b_apply: "적용",
    b_save: "저장",
    b_add: "추가",
    b_delete: "삭제",
    b_close: "닫기",

    nav_check: "기계실 점검",
    nav_map: "네트워크 맵 구성",
    map_menu: "추가",
    map_add_dev: "장비 추가",
    map_add_link: "링크 추가",
    map_empty: "왼쪽 위 + 를 눌러 장비를 추가하세요.",
    map_on_map: "맵에 있음",
    map_all_added: "모든 장비가 맵에 있습니다.",
    map_link_hint: "링크를 연결할 두 장비를 선택하세요",
    map_link_hint2: "{name}와(과) 연결할 장비를 선택하세요",
    map_link_dup: "이미 연결된 장비입니다.",
    map_remove: "맵에서 제거",
    map_link_remove: "링크 삭제",
    map_alive: "응답 있음",
    map_dead: "응답 없음",
    map_checking: "확인 중",
    map_manual: "목록에 없는 장비 추가",
    map_manual_hint: "점검 대상이 아닌 장비를 맵에만 넣습니다. 응답 여부만 확인합니다.",
    map_group: "장비 묶음",
    map_group_count: "장비 {n}대",
    map_group_bad: "응답 없음 {n}대",
    map_ungroup: "묶음 풀기",
    map_take_out: "묶음에서 빼기",
    map_link_group: "묶음에는 링크를 직접 연결할 수 없습니다. 장비를 묶음에서 뺀 뒤 연결하세요.",
    map_side_ok: "정상 {n}",
    map_side_bad: "응답 없음 {n}",
    map_side_wait: "확인 중 {n}",
    b_edit: "편집",
    map_group_edit: "묶음 편집",
    map_group_name: "묶음 이름",
    map_rename_tip: "더블클릭해서 이름 바꾸기",
    map_group_del_title: "묶음 삭제",
    map_group_del_msg: "'{name}'과(와) 안에 있는 장비 {n}대를 맵에서 제거합니다. 점검 목록은 그대로 남습니다.",
    err_host: "IP 주소나 호스트 이름을 입력하세요.",
    ext_l2: "L2 스위치",
    ext_l3: "L3 스위치",
    ext_ap: "무선 AP",
    ext_firewall: "방화벽",
    ext_server: "서버",
    ext_esxi: "가상화 호스트 (ESXi)",
    ext_other: "기타",
  },
  en: {
    lang_msg: "Please select a language.",
    lang_remember: "Remember my choice",
    lang_next: "Next",
    loading: "Loading...",


    sec_net: "Network Devices",
    sec_sv: "Servers",
    pw_ph: "Password",
    tip_edit: "Edit",
    tip_capture: "Capture dashboard",
    cap_running: "Capturing the firewall dashboard. Wait until the capture window closes.",
    cap_ok: "Saved as {file}.",
    cap_show: "Show in folder",
    cap_no_pw: "Enter the firewall password.",
    cap_login_failed: "Could not sign in to the firewall web. Check the password.",
    cap_error: "Could not capture. {msg}",
    tip_add_net: "Add network device",
    tip_add_sv: "Add server",
    tip_settings: "Settings",
    empty: "No devices. Click + at the bottom right to add one.",

    st_wait: "Ready",
    st_skip: "Skipped",
    st_fail: "Failed",
    v_정상: "Normal",
    v_이상: "Abnormal",
    v_확인필요: "Check needed",
    details: "Details",

    save_pw: "Save passwords",
    run: "Run Check",
    running: "Checking...",
    save_csv: "Export CSV",
    need_pw: "Enter at least one password.",
    done: "Check finished. Normal {ok}, Abnormal {bad}, Failed {fail}",
    saved_ok: "Saved to {file}.",
    save_locked: "The CSV file is open. Close it and save again.",
    save_error: "Could not save. {msg}",
    nothing: "There are no results to save.",

    dlg_edit: "Edit device",
    dlg_add_net: "Add network device",
    dlg_add_sv: "Add server",
    f_name: "Name",
    f_type: "Type",
    f_host: "IP address",
    f_user: "User name",
    f_port: "Port",
    f_ps: "Use PowerShell",
    f_ps_hint: "Turn this off for servers without PowerShell, such as Windows Server 2008 (not R2). wmic is used instead.",
    type_cisco_ios: "L3 switch (Cisco IOS)",
    type_cisco_nxos: "L3 switch (Cisco Nexus)",
    type_paloalto_panos: "Firewall (Palo Alto)",
    done_add_device: "Device added.",
    done_add_server: "Server added.",
    done_edit_device: "Device updated.",
    done_edit_server: "Server updated.",
    done_delete_device: "Device deleted.",
    done_delete_server: "Server deleted.",
    cfg_error: "Could not save to config.json. {msg}",
    del_title: "Delete device",
    del_msg: "Delete {name}?\nIts settings and saved password will both be deleted.",
    err_required: "Required.",
    err_port: "Enter a number from 1 to 65535.",

    settings: "Settings",
    s_lang: "Language",
    s_theme: "Theme",
    theme_system: "Use Windows setting",
    theme_light: "Light",
    theme_dark: "Dark",

    b_ok: "OK",
    b_cancel: "Cancel",
    b_apply: "Apply",
    b_save: "Save",
    b_add: "Add",
    b_delete: "Delete",
    b_close: "Close",

    nav_check: "Server Room Check",
    nav_map: "Network Map",
    map_menu: "Add",
    map_add_dev: "Add device",
    map_add_link: "Add link",
    map_empty: "Click + at the top left to add a device.",
    map_on_map: "On the map",
    map_all_added: "All devices are on the map.",
    map_link_hint: "Select two devices to link",
    map_link_hint2: "Select a device to link with {name}",
    map_link_dup: "These devices are already linked.",
    map_remove: "Remove from map",
    map_link_remove: "Delete link",
    map_alive: "Responding",
    map_dead: "Not responding",
    map_checking: "Checking",
    map_manual: "Add a device not in the list",
    map_manual_hint: "Adds a device that is not an inspection target to the map only. Only whether it responds is checked.",
    map_group: "Device group",
    map_group_count: "{n} devices",
    map_group_bad: "{n} not responding",
    map_ungroup: "Ungroup",
    map_take_out: "Remove from group",
    map_link_group: "Links can't be connected to a group. Remove the device from the group first.",
    map_side_ok: "{n} OK",
    map_side_bad: "{n} not responding",
    map_side_wait: "{n} checking",
    b_edit: "Edit",
    map_group_edit: "Edit group",
    map_group_name: "Group name",
    map_rename_tip: "Double-click to rename",
    map_group_del_title: "Delete group",
    map_group_del_msg: "'{name}' and the {n} devices in it will be removed from the map. The check list is not changed.",
    err_host: "Enter an IP address or host name.",
    ext_l2: "L2 switch",
    ext_l3: "L3 switch",
    ext_ap: "Wireless AP",
    ext_firewall: "Firewall",
    ext_server: "Server",
    ext_esxi: "Virtualization host (ESXi)",
    ext_other: "Other",
  },
};

let LANG = "ko";

function t(key, vars = {}, lang = LANG) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.ko[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// Translation binding through data attributes
// data 속성 기반 문구 적용
function applyI18n(root = document, lang = LANG) {
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n, {}, lang); });
  root.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh, {}, lang); });
  root.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle, {}, lang); });
}

// Theme application to page and title bar
// 페이지 및 제목 표시줄 테마 적용
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
let THEME = "system";
function applyTheme(theme, view) {
  THEME = theme || "system";
  const dark = THEME === "dark" || (THEME === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (window.pywebview) window.pywebview.api.titlebar(view, dark);
}

// Focus ring only after Tab key use
// Tab 키 사용 후에만 초점 테두리 표시
document.addEventListener("keydown", e => { if (e.key === "Tab") document.documentElement.classList.add("kbd"); }, true);
document.addEventListener("mousedown", () => document.documentElement.classList.remove("kbd"), true);

function onApiReady(fn) {
  if (window.pywebview && window.pywebview.api) fn();
  else window.addEventListener("pywebviewready", fn, { once: true });
}
