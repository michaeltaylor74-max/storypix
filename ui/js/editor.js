// Centre stage: draws the current slide and lets you move / resize / rotate boxes.
import { h, toast } from "./ui.js";
import { app, on, emit, change, currentSlide, selectItem, beginGesture, gestureUpdate, endGesture, insertSlides, slideForMedia } from "./state.js";
import { drawSlide } from "./render.js";
import { assets } from "./assets.js";
import { openTrim } from "./trim.js";
import { newText, newTile, placeMedia, clamp } from "./model.js";
import { FONT_FALLBACK } from "./platform.js";

let wrap, stage, canvas, overlay, banner, cssW = 0, cssH = 0, dpr = 1;
let drawQueued = false;

export const stageCanvas = () => canvas;
export const stageSize = () => ({ W: canvas.width, H: canvas.height });

export function initEditor(el) {
  wrap = el;
  canvas = h("canvas", { class: "stage-canvas" });
  overlay = h("div", { class: "stage-overlay" });
  banner = h("div", { class: "stage-banner" });
  stage = h("div", { class: "stage" }, canvas, overlay, banner);
  wrap.append(stage);
  new ResizeObserver(layout).observe(wrap);
  on("change", () => { requestDraw(); buildOverlay(); });
  on("select", () => { requestDraw(); buildOverlay(); });
  on("playing", () => { buildOverlay(); requestDraw(); });
  assets.onLoad(() => requestDraw());
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) { selectItem(null); }
  });
  overlay.addEventListener("wheel", onWheel, { passive: false });
  setupDrop();
  layout();
}

function layout() {
  const r = wrap.getBoundingClientRect();
  const maxW = Math.max(100, r.width - 24), maxH = Math.max(60, r.height - 24);
  cssW = Math.floor(Math.min(maxW, (maxH * 16) / 9));
  cssH = Math.floor((cssW * 9) / 16);
  dpr = Math.min(2, window.devicePixelRatio || 1);
  stage.style.width = `${cssW}px`;
  stage.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  emit("stage-resize");
  requestDraw();
}

export function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; if (!app.playing) draw(); });
}

function draw() {
  const ctx = canvas.getContext("2d");
  const s = currentSlide();
  const W = canvas.width, H = canvas.height;
  if (!s) {
    ctx.fillStyle = "#0c0d11";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(H / 22)}px ${FONT_FALLBACK}`;
    ctx.fillText("Add photos, then double-click one (or drag it to the storyboard) to start.", W / 2, H / 2 - H / 30);
    ctx.fillText("Or press ✨ Auto Build to make a whole show from a folder.", W / 2, H / 2 + H / 30);
    return;
  }
  drawSlide(ctx, app.project, s, 0, W, H, "edit", app.mediaById);
}

// ---------- overlay boxes
function buildOverlay() {
  overlay.replaceChildren();
  banner.style.display = "none";
  const s = currentSlide();
  if (!s || app.playing) return;
  const mk = (kind, item) => {
    const r = item.rect;
    const sel = (kind === "tile" ? app.sel.tile : app.sel.text) === item.id;
    const box = h("div", {
      class: `box ${kind} ${sel ? "sel" : ""} ${sel && app.panMode ? "pan" : ""}`,
      style: { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, transform: `rotate(${item.rotation || 0}deg)` },
      "data-id": item.id,
    });
    if (sel && !app.panMode) {
      for (const hd of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) box.append(h("div", { class: `hd hd-${hd}`, "data-h": hd }));
      if (kind === "tile") box.append(h("div", { class: "hd-rot", "data-h": "rot", title: "Drag to rotate" }));
    }
    box.addEventListener("pointerdown", (e) => onBoxDown(e, kind, item, box));
    box.addEventListener("dblclick", () => {
      if (kind === "tile" && item.mediaId) {
        if (app.mediaById.get(item.mediaId)?.kind === "video") { openTrim(currentSlide(), item); return; }
        app.panMode = !app.panMode; selectItem("tile", item.id);
      }
      if (kind === "text") emit("focus", "text");
    });
    return box;
  };
  for (const t of s.tiles) overlay.append(mk("tile", t));
  for (const t of s.texts) overlay.append(mk("text", t));
  if (app.panMode && app.sel.tile) {
    banner.textContent = "Drag the photo to reposition it · scroll to zoom · double-click or Esc when done";
    banner.style.display = "block";
  }
}

function onBoxDown(e, kind, item, box) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const s = currentSlide();
  const handle = e.target.dataset?.h;
  if ((kind === "tile" ? app.sel.tile : app.sel.text) !== item.id) {
    selectItem(kind, item.id);
    if (kind === "tile") app.panMode = false;
  }
  const sx = e.clientX, sy = e.clientY;
  const start = { ...item.rect }, startRot = item.rotation || 0, startFx = item.focusX, startFy = item.focusY;
  let moved = false;
  const others = [...s.tiles, ...s.texts].filter((o) => o.id !== item.id).map((o) => o.rect);
  const mediaPan = kind === "tile" && app.panMode && item.mediaId;
  const m = mediaPan ? app.mediaById.get(item.mediaId) : null;
  const move = (ev) => {
    const dx = (ev.clientX - sx) / cssW, dy = (ev.clientY - sy) / cssH;
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
    if (!moved) { beginGesture(); moved = true; }
    clearGuides();
    if (mediaPan) {
      const tw = item.rect.w * cssW, th = item.rect.h * cssH;
      const [, , dw, dh] = placeMedia(item, tw, th, m.width, m.height, 1, 0.5, 0.5);
      const ox = dw - tw, oy = dh - th;
      if (ox > 1) item.focusX = clamp(startFx - (ev.clientX - sx) / ox, 0, 1);
      if (oy > 1) item.focusY = clamp(startFy - (ev.clientY - sy) / oy, 0, 1);
    } else if (handle === "rot") {
      const br = box.getBoundingClientRect();
      const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
      let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      if (a > 180) a -= 360;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      else if (Math.abs(a) < 3) a = 0;
      item.rotation = Math.round(a * 10) / 10;
    } else if (handle) {
      const r = { ...start };
      const min = 0.03;
      if (handle.includes("e")) r.w = Math.max(min, start.w + dx);
      if (handle.includes("s")) r.h = Math.max(min, start.h + dy);
      if (handle.includes("w")) { r.w = Math.max(min, start.w - dx); r.x = start.x + start.w - r.w; }
      if (handle.includes("n")) { r.h = Math.max(min, start.h - dy); r.y = start.y + start.h - r.h; }
      if (ev.shiftKey && handle.length === 2) {
        const asp = start.w / start.h;
        if (r.w / r.h > asp) r.w = r.h * asp; else r.h = r.w / asp;
        if (handle.includes("w")) r.x = start.x + start.w - r.w;
        if (handle.includes("n")) r.y = start.y + start.h - r.h;
      }
      if (!ev.altKey) snapEdges(r, others, handle);
      item.rect = r;
    } else {
      const r = { ...start, x: start.x + dx, y: start.y + dy };
      if (!ev.altKey) snapMove(r, others);
      item.rect = r;
    }
    gestureUpdate();
    syncBox(box, item);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    clearGuides();
    if (moved) { item.rect = roundRect(item.rect); endGesture(); if (kind === "tile" && handle && !mediaPan) { const sl = currentSlide(); if (sl) sl.layoutId = sl.layoutId; } }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

const roundRect = (r) => ({ x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +r.w.toFixed(4), h: +r.h.toFixed(4) });

function syncBox(box, item) {
  const r = item.rect;
  Object.assign(box.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, transform: `rotate(${item.rotation || 0}deg)` });
  requestDraw();
}

function guide(axis, v) {
  overlay.append(h("div", { class: `guide ${axis}`, style: axis === "x" ? { left: `${v * 100}%` } : { top: `${v * 100}%` } }));
}
function clearGuides() { overlay.querySelectorAll(".guide").forEach((g) => g.remove()); }

function snapMove(r, others) {
  const tx = 7 / cssW, ty = 7 / cssH;
  const xs = [0, 0.5, 1, ...others.flatMap((o) => [o.x, o.x + o.w, o.x + o.w / 2])];
  const ys = [0, 0.5, 1, ...others.flatMap((o) => [o.y, o.y + o.h, o.y + o.h / 2])];
  let best = null;
  for (const [off, k] of [[0, "l"], [r.w / 2, "c"], [r.w, "r"]]) for (const x of xs) { const d = Math.abs(r.x + off - x); if (d < tx && (!best || d < best.d)) best = { d, v: x - off, g: x }; }
  if (best) { r.x = best.v; guide("x", best.g); }
  best = null;
  for (const [off] of [[0], [r.h / 2], [r.h]]) for (const y of ys) { const d = Math.abs(r.y + off - y); if (d < ty && (!best || d < best.d)) best = { d, v: y - off, g: y }; }
  if (best) { r.y = best.v; guide("y", best.g); }
}
function snapEdges(r, others, handle) {
  const tx = 7 / cssW, ty = 7 / cssH;
  const xs = [0, 0.5, 1, ...others.flatMap((o) => [o.x, o.x + o.w])];
  const ys = [0, 0.5, 1, ...others.flatMap((o) => [o.y, o.y + o.h])];
  if (handle.includes("e")) for (const x of xs) if (Math.abs(r.x + r.w - x) < tx) { r.w = x - r.x; guide("x", x); break; }
  if (handle.includes("w")) for (const x of xs) if (Math.abs(r.x - x) < tx) { r.w += r.x - x; r.x = x; guide("x", x); break; }
  if (handle.includes("s")) for (const y of ys) if (Math.abs(r.y + r.h - y) < ty) { r.h = y - r.y; guide("y", y); break; }
  if (handle.includes("n")) for (const y of ys) if (Math.abs(r.y - y) < ty) { r.h += r.y - y; r.y = y; guide("y", y); break; }
}

function onWheel(e) {
  const t = currentSlide()?.tiles.find((x) => x.id === app.sel.tile);
  if (!t || !app.panMode) return;
  e.preventDefault();
  beginGesture();
  t.zoom = clamp(t.zoom * Math.pow(1.1, -e.deltaY / 100), 1, 5);
  gestureUpdate();
  clearTimeout(onWheel._t);
  onWheel._t = setTimeout(endGesture, 400);
}

function tileAt(e) {
  const s = currentSlide();
  if (!s) return null;
  const r = overlay.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  for (let i = s.tiles.length - 1; i >= 0; i--) {
    const t = s.tiles[i].rect;
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return s.tiles[i];
  }
  return null;
}

function setupDrop() {
  const zone = stage;
  const clear = () => overlay.querySelectorAll(".drop-target").forEach((b) => b.classList.remove("drop-target"));
  zone._drop = {
    accepts: (pl) => pl.type === "media" && !app.playing,
    over(pl, e) {
      clear();
      const t = tileAt(e);
      if (t) overlay.querySelector(`.box[data-id="${t.id}"]`)?.classList.add("drop-target");
      else zone.classList.add("drop-any");
    },
    leave() { clear(); zone.classList.remove("drop-any"); },
    drop(pl, e) {
      zone.classList.remove("drop-any");
      const s = currentSlide();
      if (!s) { insertSlides(pl.ids.map((id) => slideForMedia([id]))); return; }
      const target = tileAt(e);
      const ids = [...pl.ids];
      change(() => {
        if (target) {
          const m = app.mediaById.get(ids[0]);
          target.mediaId = ids.shift();
          target.focusX = target.focusY = 0.5;
          target.zoom = 1;
          target.trimStart = 0; target.trimEnd = null;
          target.muted = m?.kind === "video" ? s.tiles.length > 1 : true;
          if (m?.kind === "video" && s.tiles.length === 1) s.duration = Math.max(1, Math.round(m.duration * 10) / 10);
        }
        for (const t of s.tiles) if (!t.mediaId && ids.length) t.mediaId = ids.shift();
        let added = 0;
        while (ids.length && s.tiles.length < 9) {
          const t = newTile({ x: 0.33 + added * 0.03, y: 0.3 + added * 0.03, w: 0.34, h: 0.4 }, ids.shift());
          s.tiles.push(t);
          added++;
        }
        if (ids.length) toast("Slide is full — the rest weren't added", "warn");
      });
    },
  };
}

export function addTextBox() {
  const s = currentSlide();
  if (!s) return toast("Select a slide first", "warn");
  const t = newText("Double-click to edit", { size: 64, rect: { x: 0.1, y: 0.75, w: 0.8, h: 0.16 }, bg: "rgba(0,0,0,0.45)" });
  change(() => s.texts.push(t));
  selectItem("text", t.id);
  emit("focus", "text");
}
export function addPhotoBox() {
  const s = currentSlide();
  if (!s) return toast("Select a slide first", "warn");
  const t = newTile({ x: 0.33, y: 0.3, w: 0.34, h: 0.4 });
  change(() => s.tiles.push(t));
  selectItem("tile", t.id);
}
