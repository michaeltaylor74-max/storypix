// Small DOM helpers: element builder, modals, toasts, context menus, custom drag.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, kind = "info", ms = 3500) {
  const root = document.getElementById("toast-root");
  const t = h("div", { class: `toast ${kind}` }, msg);
  root.append(t);
  setTimeout(() => t.classList.add("out"), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** Generic modal. buttons: [{label, value, primary, danger}] → resolves with value (or null on close). */
export function modal({ title, body, buttons = [{ label: "OK", value: true, primary: true }], wide = false, onMount, closable = true }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const close = (v) => {
      back.remove();
      document.removeEventListener("keydown", key, true);
      resolve(v);
    };
    const key = (e) => {
      if (e.key === "Escape" && closable) { e.stopPropagation(); close(null); }
    };
    const foot = h("div", { class: "modal-foot" },
      buttons.map((b) => h("button", { class: `btn ${b.primary ? "primary" : ""} ${b.danger ? "danger" : ""}`, onclick: async () => {
        if (b.validate && !(await b.validate())) return;
        close(typeof b.value === "function" ? b.value() : b.value);
      } }, b.label)));
    const box = h("div", { class: `modal ${wide ? "wide" : ""} ${wide === "xl" ? "xl" : ""}` },
      h("div", { class: "modal-head" }, h("h2", {}, title), closable ? h("button", { class: "icon-btn", title: "Close", onclick: () => close(null) }, "✕") : null),
      h("div", { class: "modal-body" }, body),
      buttons.length ? foot : null);
    const back = h("div", { class: "modal-back" }, box);
    root.append(back);
    document.addEventListener("keydown", key, true);
    onMount?.(box, close);
  });
}

export const confirmBox = (title, text, okLabel = "OK", danger = false) =>
  modal({ title, body: h("p", {}, text), buttons: [{ label: "Cancel", value: false }, { label: okLabel, value: true, primary: !danger, danger }] });

export function contextMenu(x, y, items) {
  document.querySelectorAll(".ctx-menu").forEach((m) => m.remove());
  const menu = h("div", { class: "ctx-menu", style: { left: `${x}px`, top: `${y}px` } },
    items.filter(Boolean).map((it) => it === "-" ? h("div", { class: "ctx-sep" }) :
      h("div", { class: `ctx-item ${it.disabled ? "disabled" : ""}`, onclick: () => { menu.remove(); if (!it.disabled) it.action(); } }, it.label)));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > innerWidth) menu.style.left = `${innerWidth - r.width - 6}px`;
  if (r.bottom > innerHeight) menu.style.top = `${innerHeight - r.height - 6}px`;
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("pointerdown", off, true); } };
    document.addEventListener("pointerdown", off, true);
  });
}

// ---------- custom drag & drop (pointer based; works alongside native file drops)
let drag = null;
/** Elements become drop zones by setting el._drop = {accepts(payload), over(payload,e), leave(), drop(payload,e)} */
export function beginDrag(e, payload, ghostContent) {
  const sx = e.clientX, sy = e.clientY;
  let started = false, ghost = null, lastZone = null;
  const move = (ev) => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      started = true;
      ghost = h("div", { class: "drag-ghost" }, ghostContent());
      document.body.append(ghost);
      document.body.classList.add("dragging");
      drag = payload;
    }
    ghost.style.left = `${ev.clientX + 12}px`;
    ghost.style.top = `${ev.clientY + 12}px`;
    let el = document.elementFromPoint(ev.clientX, ev.clientY);
    while (el && !(el._drop && el._drop.accepts(payload))) el = el.parentElement;
    if (lastZone && lastZone !== el) lastZone._drop.leave?.();
    lastZone = el;
    if (el) el._drop.over?.(payload, ev);
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!started) return;
    ghost?.remove();
    document.body.classList.remove("dragging");
    drag = null;
    if (lastZone) {
      lastZone._drop.leave?.();
      lastZone._drop.drop(payload, ev);
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
export const isDragging = () => !!drag;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Labeled slider row helper returning [row, input] */
/** Parse what someone typed: "5", "5s", "80%", "1:05.5", "-3°" … */
export function parseTyped(text, percent) {
  const t = String(text).trim().replace(",", ".");
  if (!t) return NaN;
  if (t.includes(":")) {
    const parts = t.split(":").map((x) => parseFloat(x.replace(/[^0-9.\-]/g, "")));
    if (parts.some((x) => isNaN(x))) return NaN;
    return parts.reduce((a, b) => a * 60 + b, 0);
  }
  const n = parseFloat(t.replace(/[^0-9.\-]/g, ""));
  if (isNaN(n)) return NaN;
  return percent ? n / 100 : n;
}

/** Slider with a type-in box. Returns the row element. */
export function slider({ label, min, max, step = 0.01, value, fmt = (v) => v, oninput, onchange, typedMax, typedMin }) {
  const percent = String(fmt(1)).includes("%");
  const box = h("input", { type: "text", class: "val-input", value: fmt(value), title: "Type a value and press Enter" });
  const inp = h("input", { type: "range", min, max, step, value });
  inp.addEventListener("input", () => { box.value = fmt(+inp.value); oninput?.(+inp.value); });
  inp.addEventListener("change", () => onchange?.(+inp.value));
  const commit = () => {
    let v = parseTyped(box.value, percent);
    if (isNaN(v)) { box.value = fmt(+inp.value); return; }
    v = Math.min(typedMax ?? max, Math.max(typedMin ?? min, v));
    if (step >= 1) v = Math.round(v); else v = Math.round(v * 1000) / 1000;
    inp.value = v;
    box.value = fmt(v);
    oninput?.(v);
    onchange?.(v);
  };
  box.addEventListener("focus", () => box.select());
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); box.blur(); }
    if (e.key === "Escape") { box.value = fmt(+inp.value); box.blur(); }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? step * 10 : step);
      const cur = +inp.value;
      box.value = fmt(Math.min(typedMax ?? max, Math.max(typedMin ?? min, cur + d)));
      commit();
    }
    e.stopPropagation();
  });
  box.addEventListener("change", commit);
  return h("div", { class: "row slider" }, h("span", { class: "lbl" }, label), inp, box);
}

/** A time box (m:ss.s or seconds). value null → shows placeholder. */
export function timeInput({ value, placeholder = "", onset, allowEmpty = false, min = 0, max = Infinity, title = "" }) {
  const show = (v) => (v === null || v === undefined ? "" : fmtSecs(v));
  const box = h("input", { type: "text", class: "time-input", value: show(value), placeholder, title: title || "Type seconds (e.g. 12) or minutes:seconds (e.g. 1:05)" });
  box.addEventListener("focus", () => box.select());
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); box.blur(); } e.stopPropagation(); });
  box.addEventListener("change", () => {
    if (box.value.trim() === "" && allowEmpty) { onset(null); return; }
    const v = parseTyped(box.value, false);
    if (isNaN(v)) { box.value = show(value); return; }
    onset(Math.min(max, Math.max(min, v)));
  });
  return box;
}
export function fmtSecs(v) {
  const m = Math.floor(v / 60), s = v - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function select(options, value, onchange) {
  const s = h("select", { onchange: () => onchange(s.value) },
    options.map((o) => h("option", { value: o.id ?? o.value ?? o, selected: (o.id ?? o.value ?? o) === value }, o.label ?? o)));
  return s;
}

export function field(label, ...ctrl) {
  return h("label", { class: "row" }, h("span", { class: "lbl" }, label), ...ctrl);
}
