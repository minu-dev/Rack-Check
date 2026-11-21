// Windows 11 style ComboBox wrapper for select
// select 기반 Win11 ComboBox 래퍼
// Change event sync and manual refresh through select._combo
// change 이벤트 연동 및 select._combo 수동 갱신

function makeCombo(select) {
  if (select._combo) return select._combo;
  const box = document.createElement("button");
  box.type = "button";
  box.className = "combo-box";
  box.innerHTML = '<span class="combo-text"></span><span class="icon combo-chev">&#xE70D;</span>';
  select.after(box);
  select.hidden = true;

  let popup = null;

  const refresh = () => {
    const opt = select.options[select.selectedIndex];
    box.querySelector(".combo-text").textContent = opt ? opt.textContent : "";
    box.disabled = select.disabled;
  };

  const close = () => {
    if (!popup) return;
    const p = popup; popup = null;
    p.classList.remove("show");
    setTimeout(() => p.remove(), 150);
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", keys, true);
    box.focus({ focusVisible: false });
  };

  const choose = i => {
    if (i !== select.selectedIndex) {
      select.selectedIndex = i;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    refresh();
    close();
  };

  const outside = e => { if (popup && !popup.contains(e.target) && e.target !== box && !box.contains(e.target)) close(); };

  const keys = e => {
    if (!popup) return;
    const items = [...popup.children];
    let cur = items.findIndex(x => x.classList.contains("hot"));
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      cur = Math.max(0, Math.min(items.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
      items.forEach((x, i) => x.classList.toggle("hot", i === cur));
    } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (cur >= 0) choose(cur); }
    else if (e.key === "Tab") close();
  };

  const open = () => {
    if (popup || select.disabled) return;
    popup = document.createElement("div");
    popup.className = "combo-popup";
    [...select.options].forEach((o, i) => {
      const it = document.createElement("div");
      it.className = "combo-item" + (i === select.selectedIndex ? " selected hot" : "");
      it.textContent = o.textContent;
      it.addEventListener("click", () => choose(i));
      it.addEventListener("mousemove", () => [...popup.children].forEach(x => x.classList.toggle("hot", x === it)));
      popup.append(it);
    });
    document.body.append(popup);
    // Popup alignment over selected item within window
    // 창 범위 내 선택 항목 기준 팝업 정렬
    const r = box.getBoundingClientRect();
    const itemH = 36, pad = 4;
    popup.style.minWidth = r.width + "px";
    let top = r.top - pad - select.selectedIndex * itemH - 2;
    const h = select.options.length * itemH + pad * 2;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    popup.style.left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)) + "px";
    popup.style.top = top + "px";
    popup.offsetHeight;
    popup.classList.add("show");
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", keys, true);
  };

  box.addEventListener("click", () => (popup ? close() : open()));
  box.addEventListener("keydown", e => {
    if (!popup && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const i = select.selectedIndex + (e.key === "ArrowDown" ? 1 : -1);
      if (i >= 0 && i < select.options.length) choose(i);
    }
  });
  new MutationObserver(refresh).observe(select, { childList: true, subtree: true, characterData: true, attributes: true });

  select._combo = { refresh, close, box };
  refresh();
  return select._combo;
}

function makeCombos(root = document) {
  root.querySelectorAll("select.combo").forEach(makeCombo);
}
