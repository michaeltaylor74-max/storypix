// Project model + shared maths. Mirrors engine/src/model.rs and timeline.rs.

let _id = Date.now() % 100000;
export const uid = (p = "x") => `${p}${(_id++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const W0 = 1920, H0 = 1080; // design space

export const TRANSITIONS = [
  { id: "cut", label: "Cut (none)", icon: "│" },
  { id: "crossfade", label: "Crossfade", icon: "◐" },
  { id: "fadeBlack", label: "Fade through black", icon: "●" },
  { id: "fadeWhite", label: "Fade through white", icon: "○" },
  { id: "pushLeft", label: "Push left", icon: "⇠" },
  { id: "pushRight", label: "Push right", icon: "⇢" },
  { id: "pushUp", label: "Push up", icon: "⇡" },
  { id: "pushDown", label: "Push down", icon: "⇣" },
  { id: "wipeLeft", label: "Wipe left", icon: "◧" },
  { id: "wipeRight", label: "Wipe right", icon: "◨" },
  { id: "wipeUp", label: "Wipe up", icon: "⬒" },
  { id: "wipeDown", label: "Wipe down", icon: "⬓" },
  { id: "coverLeft", label: "Slide in from right", icon: "⇤" },
  { id: "coverRight", label: "Slide in from left", icon: "⇥" },
  { id: "circle", label: "Circle reveal", icon: "◎" },
  { id: "zoomIn", label: "Zoom through", icon: "⊕" },
  { id: "zoomOut", label: "Zoom out reveal", icon: "⊖" },
  { id: "blinds", label: "Blinds", icon: "☰" },
  { id: "mosaic", label: "Mosaic", icon: "▦" },
];
export const TRANSITION_SETS = {
  gentle: ["crossfade"],
  mixed: ["crossfade", "crossfade", "crossfade", "pushLeft", "pushUp", "wipeRight", "coverLeft", "zoomIn", "circle", "fadeBlack", "zoomOut"],
  energetic: ["pushLeft", "pushRight", "pushUp", "pushDown", "zoomIn", "zoomOut", "mosaic", "blinds", "circle", "coverLeft", "coverRight", "wipeLeft", "cut"],
};

export const MOTIONS = [
  { id: "none", label: "None (still)" },
  { id: "zoomIn", label: "Slow zoom in" },
  { id: "zoomOut", label: "Slow zoom out" },
  { id: "panLeft", label: "Pan left" },
  { id: "panRight", label: "Pan right" },
  { id: "panUp", label: "Pan up" },
  { id: "panDown", label: "Pan down" },
];

export const FONTS = ["Segoe UI", "Arial", "Arial Black", "Georgia", "Times New Roman", "Verdana", "Trebuchet MS", "Impact", "Comic Sans MS", "Courier New", "Segoe Script", "Gabriola"];

export const STYLE_PRESETS = {
  clean: { label: "Clean", style: { border: 0, borderColor: "#ffffff", radius: 0, shadow: false } },
  frame: { label: "White frame", style: { border: 8, borderColor: "#ffffff", radius: 0, shadow: true } },
  rounded: { label: "Rounded", style: { border: 0, borderColor: "#ffffff", radius: 22, shadow: true } },
  polaroid: { label: "Polaroid (tilted)", style: { border: 14, borderColor: "#fbfbf7", radius: 2, shadow: true }, tilt: true },
  dark: { label: "Thin dark line", style: { border: 4, borderColor: "#111111", radius: 6, shadow: false } },
};

// ---------- layouts: [cols, rows, cells:[col,row,colspan,rowspan]]
const G = (cols, rows, cells) => ({ cols, rows, cells });
const grid = (c, r) => G(c, r, Array.from({ length: c * r }, (_, i) => [i % c, Math.floor(i / c), 1, 1]));
export const LAYOUTS = [
  { id: "full", n: 1, name: "Full screen", full: true, ...grid(1, 1) },
  { id: "framed", n: 1, name: "Framed", margin: 70, ...grid(1, 1) },
  { id: "2col", n: 2, name: "Side by side", ...grid(2, 1) },
  { id: "2row", n: 2, name: "Top & bottom", ...grid(1, 2) },
  { id: "2big", n: 2, name: "Big + small", ...G(3, 1, [[0, 0, 2, 1], [2, 0, 1, 1]]) },
  { id: "3col", n: 3, name: "Three columns", ...grid(3, 1) },
  { id: "3left", n: 3, name: "Big left", ...G(2, 2, [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]]) },
  { id: "3right", n: 3, name: "Big right", ...G(2, 2, [[0, 0, 1, 1], [0, 1, 1, 1], [1, 0, 1, 2]]) },
  { id: "3top", n: 3, name: "Two over one", ...G(2, 2, [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 2, 1]]) },
  { id: "4grid", n: 4, name: "Grid", ...grid(2, 2) },
  { id: "4col", n: 4, name: "Four columns", ...grid(4, 1) },
  { id: "4left", n: 4, name: "Big left", ...G(3, 3, [[0, 0, 2, 3], [2, 0, 1, 1], [2, 1, 1, 1], [2, 2, 1, 1]]) },
  { id: "4top", n: 4, name: "Big top", ...G(3, 3, [[0, 0, 3, 2], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]]) },
  { id: "5a", n: 5, name: "Two over three", ...G(6, 2, [[0, 0, 3, 1], [3, 0, 3, 1], [0, 1, 2, 1], [2, 1, 2, 1], [4, 1, 2, 1]]) },
  { id: "5center", n: 5, name: "Big centre", ...G(4, 2, [[1, 0, 2, 2], [0, 0, 1, 1], [0, 1, 1, 1], [3, 0, 1, 1], [3, 1, 1, 1]]) },
  { id: "5left", n: 5, name: "Big left", ...G(4, 2, [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]]) },
  { id: "6grid", n: 6, name: "Grid 3×2", ...grid(3, 2) },
  { id: "6left", n: 6, name: "Big corner", ...G(3, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]]) },
  { id: "6tall", n: 6, name: "Grid 2×3", ...grid(2, 3) },
  { id: "7center", n: 7, name: "Big centre", ...G(4, 3, [[1, 0, 2, 2], [0, 0, 1, 1], [0, 1, 1, 1], [3, 0, 1, 1], [3, 1, 1, 1], [0, 2, 2, 1], [2, 2, 2, 1]]) },
  { id: "7rows", n: 7, name: "Four over three", ...G(12, 2, [[0, 0, 3, 1], [3, 0, 3, 1], [6, 0, 3, 1], [9, 0, 3, 1], [0, 1, 4, 1], [4, 1, 4, 1], [8, 1, 4, 1]]) },
  { id: "8grid", n: 8, name: "Grid 4×2", ...grid(4, 2) },
  { id: "8rows", n: 8, name: "3 / 2 / 3", ...G(6, 3, [[0, 0, 2, 1], [2, 0, 2, 1], [4, 0, 2, 1], [0, 1, 3, 1], [3, 1, 3, 1], [0, 2, 2, 1], [2, 2, 2, 1], [4, 2, 2, 1]]) },
  { id: "9grid", n: 9, name: "Grid 3×3", ...grid(3, 3) },
  { id: "9left", n: 9, name: "Big corner", ...G(4, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1], [3, 2, 1, 1]]) },
];
export const layoutById = (id) => LAYOUTS.find((l) => l.id === id);

export function layoutRects(layout, opts = {}) {
  if (layout.full) return [{ x: 0, y: 0, w: 1, h: 1 }];
  const m = opts.margin ?? layout.margin ?? 28; // px in 1920x1080 space
  const g = opts.gap ?? 16;
  const cw = (W0 - 2 * m - g * (layout.cols - 1)) / layout.cols;
  const ch = (H0 - 2 * m - g * (layout.rows - 1)) / layout.rows;
  return layout.cells.map(([c, r, cs, rs]) => {
    const x = m + c * (cw + g), y = m + r * (ch + g);
    const w = cs * cw + (cs - 1) * g, h = rs * ch + (rs - 1) * g;
    return { x: x / W0, y: y / H0, w: w / W0, h: h / H0 };
  });
}
export const rectAspect = (r) => (r.w * W0) / (r.h * H0);

// ---------- factories
export function newTile(rect, mediaId = null) {
  return {
    id: uid("t"), rect: { ...rect }, mediaId, fit: "fill", focusX: 0.5, focusY: 0.5, zoom: 1,
    motion: "none", motionAmount: 0.15, rotation: 0, trimStart: 0, trimEnd: null, muted: true, volume: 1,
  };
}
export function newSlide(layoutId = "full", defaults = {}) {
  const layout = layoutById(layoutId) || LAYOUTS[0];
  return {
    id: uid("s"), duration: defaults.duration ?? 5,
    transition: { kind: defaults.transition ?? "crossfade", duration: defaults.transitionDuration ?? 1 },
    background: { kind: "blur", color: "#000000", color2: "#1e3a5f" },
    style: { border: 0, borderColor: "#ffffff", radius: 0, shadow: false },
    tiles: layoutRects(layout).map((r) => newTile(r)),
    texts: [], textAnim: "fade", musicVolume: 1, layoutId: layout.id,
  };
}
export function newText(text = "Your text here", over = {}) {
  return {
    id: uid("x"), text, rect: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, font: "Segoe UI", size: 72, color: "#ffffff",
    bold: true, italic: false, align: "center", valign: "middle", shadow: true, outline: false, bg: "", ...over,
  };
}
export function newTitleSlide(text = "Title", sub = "", defaults = {}) {
  const s = newSlide("full", defaults);
  s.tiles = [];
  s.layoutId = "";
  s.background = { kind: "gradient", color: "#1d2b53", color2: "#7e2553" };
  s.texts.push(newText(text, { rect: { x: 0.06, y: sub ? 0.3 : 0.35, w: 0.88, h: 0.24 }, size: 110 }));
  if (sub) s.texts.push(newText(sub, { rect: { x: 0.1, y: 0.56, w: 0.8, h: 0.14 }, size: 54, bold: false }));
  s.textAnim = "rise";
  s.duration = 4;
  return s;
}
export function defaultProject() {
  return {
    version: 1, name: "Untitled show",
    settings: {
      width: 1920, height: 1080, fps: 30, endFade: 1.5, duckLevel: 0.25, autoDuck: true, musicCrossfade: 2,
      musicVolume: 0.9, musicFadeOut: 3, defaultDuration: 5, defaultTransition: "crossfade", defaultTransitionDuration: 1,
    },
    media: [], slides: [], music: [],
  };
}
export function normalizeProject(p) {
  const d = defaultProject();
  p.settings = { ...d.settings, ...(p.settings || {}) };
  p.media ||= []; p.slides ||= []; p.music ||= [];
  for (const s of p.slides) {
    const n = newSlide("full");
    for (const k of Object.keys(n)) if (s[k] === undefined) s[k] = n[k];
    s.tiles = (s.tiles || []).map((t) => ({ ...newTile(t.rect || { x: 0, y: 0, w: 1, h: 1 }), ...t }));
    s.texts = (s.texts || []).map((t) => ({ ...newText(), ...t }));
  }
  return p;
}

// ---------- timing (same as Rust)
export function effTrans(slides, i) {
  const s = slides[i];
  if (s.transition.kind === "cut" || s.transition.duration <= 0) return 0;
  let t = Math.min(s.transition.duration, s.duration / 2);
  if (i > 0) t = Math.min(t, slides[i - 1].duration / 2);
  return Math.max(0, t);
}
export function computeTimeline(project) {
  const sl = project.slides;
  const starts = [], trans = [];
  for (let i = 0; i < sl.length; i++) {
    const tr = effTrans(sl, i);
    starts.push(i === 0 ? 0 : starts[i - 1] + sl[i - 1].duration - tr);
    trans.push(tr);
  }
  const total = sl.length ? starts[sl.length - 1] + sl[sl.length - 1].duration : 0;
  return { starts, trans, total };
}
export function frameAt(project, tl, t) {
  const n = project.slides.length;
  if (!n) return null;
  let b = 0;
  for (let i = 0; i < n; i++) { if (tl.starts[i] <= t + 1e-9) b = i; else break; }
  const bLt = t - tl.starts[b];
  const tr = tl.trans[b];
  const spec = { b, bLt, a: null, inTransition: false, q: 1, endAlpha: 1 };
  if (tr > 0 && bLt < tr) {
    spec.inTransition = true;
    spec.q = Math.min(1, Math.max(0, bLt / tr));
    if (b > 0) spec.a = [b - 1, t - tl.starts[b - 1]];
  }
  const ef = project.settings.endFade;
  if (ef > 0 && t > tl.total - ef) spec.endAlpha = Math.min(1, Math.max(0, (tl.total - t) / ef));
  return spec;
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const easeSine = (p) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(p, 0, 1));
export const easeCubic = (p) => { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };

export function motion(tile, p, isVideo) {
  const fx = tile.focusX, fy = tile.focusY;
  if (isVideo) return [1, fx, fy];
  const e = easeSine(p), a = Math.max(0, tile.motionAmount), span = 0.8;
  switch (tile.motion) {
    case "zoomIn": return [1 + a * e, fx, fy];
    case "zoomOut": return [1 + a * (1 - e), fx, fy];
    case "panLeft": return [1 + a, clamp(fx - (e - 0.5) * span, 0, 1), fy];
    case "panRight": return [1 + a, clamp(fx + (e - 0.5) * span, 0, 1), fy];
    case "panUp": return [1 + a, fx, clamp(fy - (e - 0.5) * span, 0, 1)];
    case "panDown": return [1 + a, fx, clamp(fy + (e - 0.5) * span, 0, 1)];
    default: return [1, fx, fy];
  }
}
export function placeMedia(tile, tw, th, iw, ih, scale, fx, fy) {
  iw = Math.max(1, iw); ih = Math.max(1, ih);
  const c = tile.fit === "fit" ? Math.min(tw / iw, th / ih) : Math.max(tw / iw, th / ih);
  const s = c * Math.max(0.1, tile.zoom) * scale;
  const dw = iw * s, dh = ih * s;
  return [-(dw - tw) * fx, -(dh - th) * fy, dw, dh];
}
export function textAnim(kind, lt) {
  if (kind === "none") return [1, 0];
  const a = clamp((lt - 0.3) / 0.8, 0, 1);
  const ae = 1 - Math.pow(1 - a, 3);
  return kind === "rise" ? [ae, (1 - ae) * 40] : [ae, 0];
}
export function slideHasLiveAudio(project, s, mediaById) {
  return s.tiles.some((t) => {
    if (t.muted || t.volume <= 0 || !t.mediaId) return false;
    const m = mediaById.get(t.mediaId);
    return m && m.kind === "video" && m.hasAudio;
  });
}
export function musicEnvelope(project, tl, mediaById) {
  const rate = 100, n = Math.ceil(tl.total * rate) + 1;
  const ctrl = new Float32Array(n).fill(1);
  const sl = project.slides, duck = project.settings.duckLevel;
  const levels = sl.map((s) => {
    let l = s.musicVolume;
    if (project.settings.autoDuck && slideHasLiveAudio(project, s, mediaById)) l = Math.min(l, duck);
    return l;
  });
  let b = 0;
  for (let k = 0; k < n; k++) {
    const t = k / rate;
    while (b + 1 < sl.length && tl.starts[b + 1] <= t) b++;
    if (sl.length) ctrl[k] = levels[b];
  }
  const w = 30, pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + ctrl[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w), hi = Math.min(n, i + w + 1);
    out[i] = (pre[hi] - pre[lo]) / (hi - lo);
  }
  return out;
}
export function hash32(i) {
  let h = i >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Music playlist placement: [{track, media, start, len, fadeIn, fadeOut}] (mirrors engine audio.rs) */
export function musicSchedule(project, mediaById) {
  const cf = Math.max(0, project.settings.musicCrossfade);
  const list = project.music.map((t) => ({ t, m: mediaById.get(t.mediaId) })).filter((x) => x.m);
  const out = [];
  let pos = 0;
  for (const { t, m } of list) {
    const end = Math.min(t.trimEnd ?? m.duration, m.duration);
    const len = Math.max(0, end - t.trimStart);
    if (len <= 0.05) continue;
    const delay = Math.max(0, t.delay || 0);
    const prev = out[out.length - 1];
    const cross = !!prev && delay === 0 && cf > 0;
    const base = cross ? pos - Math.min(cf, len / 2, prev.len / 2) : pos;
    const start = base + delay;
    const fadeIn = cross ? pos - base : t.trimStart > 0.3 ? 1 : 0;
    if (cross) prev.fadeOut = pos - base;
    out.push({ track: t, media: m, start, base, len, fadeIn, fadeOut: t.trimEnd != null ? 0.5 : 0 });
    pos = start + len;
  }
  return { items: out, total: pos };
}
export function slideKind(project, s, mediaById) {
  const kinds = s.tiles.map((t) => t.mediaId && mediaById.get(t.mediaId)?.kind).filter(Boolean);
  return { hasVideo: kinds.includes("video"), photos: kinds.filter((k) => k === "image").length, empty: s.tiles.filter((t) => !t.mediaId).length };
}
export function fmtTime(sec, tenths = false) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return tenths ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}
