// Global app state, undo/redo, selection and common project operations.
import { defaultProject, normalizeProject, uid, layoutById, layoutRects, newTile, newSlide, STYLE_PRESETS } from "./model.js";
import { api } from "./backend.js";
import { assets } from "./assets.js";
import { bestLayout } from "./layoutfit.js";

// Network shares (\\server\share) the user has approved, remembered on this PC.
const hostOf = (p) => (/^(\\\\|\/\/)/.test(p || "") ? p.replace(/^[\\/]+/, "").split(/[\\/]/)[0].toLowerCase() : null);
export const netHosts = {
  host: hostOf,
  list() { try { return JSON.parse(localStorage.getItem("ps.trustedHosts") || "[]"); } catch { return []; } },
  trust(hosts) { try { localStorage.setItem("ps.trustedHosts", JSON.stringify([...new Set([...this.list(), ...hosts.filter(Boolean)])])); } catch {} },
  trusted(p) { const h = hostOf(p); return !h || this.list().includes(h); },
};

export const app = {
  project: defaultProject(),
  filePath: null,
  dirty: false,
  autosaveDirty: false,
  mediaById: new Map(),
  sel: { slides: new Set(), current: null, tile: null, text: null },
  panMode: false,
  playing: false,
  playhead: 0,
  libSel: new Set(),
};

const listeners = {};
export const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
export const emit = (evt, data) => (listeners[evt] || []).forEach((f) => f(data));

const undoStack = [], redoStack = [];
const MAX_UNDO = 100;

export function reindex() {
  app.mediaById = new Map(app.project.media.map((m) => [m.id, m]));
}
export function snapshot() {
  undoStack.push(JSON.stringify(app.project));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}
export function markDirty() {
  app.dirty = true;
  app.autosaveDirty = true;
  emit("dirty");
}
/** Apply a change to the project with undo support. */
export function change(fn, { undo = true } = {}) {
  if (undo) snapshot();
  fn(app.project);
  reindex();
  markDirty();
  fixSelection();
  emit("change");
}
let gestureOpen = false;
export function beginGesture() { if (!gestureOpen) { snapshot(); gestureOpen = true; } }
export function gestureUpdate() { markDirty(); emit("change", { light: true }); }
export function endGesture() { if (gestureOpen) { gestureOpen = false; emit("change"); } }

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(app.project));
  app.project = JSON.parse(undoStack.pop());
  reindex(); markDirty(); fixSelection(); emit("change");
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(app.project));
  app.project = JSON.parse(redoStack.pop());
  reindex(); markDirty(); fixSelection(); emit("change");
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function setProject(p, filePath = null) {
  app.project = normalizeProject(p);
  app.filePath = filePath;
  undoStack.length = 0; redoStack.length = 0;
  reindex();
  // Never trust preview paths stored in a show file; they are regenerated from the cache.
  for (const m of app.project.media) { m.thumb = null; m.proxy = null; delete m.missing; delete m.error; }
  app.sel = { slides: new Set(), current: app.project.slides[0]?.id || null, tile: null, text: null };
  if (app.sel.current) app.sel.slides.add(app.sel.current);
  app.libSel.clear();
  app.dirty = false;
  app.playhead = 0;
  emit("change");
  emit("select");
  emit("dirty");
}

function fixSelection() {
  const ids = new Set(app.project.slides.map((s) => s.id));
  for (const id of [...app.sel.slides]) if (!ids.has(id)) app.sel.slides.delete(id);
  if (!ids.has(app.sel.current)) {
    app.sel.current = [...app.sel.slides][0] || app.project.slides[0]?.id || null;
    app.sel.tile = app.sel.text = null;
  }
  const s = currentSlide();
  if (s) {
    if (app.sel.tile && !s.tiles.some((t) => t.id === app.sel.tile)) app.sel.tile = null;
    if (app.sel.text && !s.texts.some((t) => t.id === app.sel.text)) app.sel.text = null;
    if (!app.sel.slides.size) app.sel.slides.add(s.id);
  }
  for (const id of [...app.libSel]) if (!app.mediaById.has(id)) app.libSel.delete(id);
}

export const currentSlide = () => app.project.slides.find((s) => s.id === app.sel.current) || null;
export const currentIndex = () => app.project.slides.findIndex((s) => s.id === app.sel.current);
export const currentTile = () => currentSlide()?.tiles.find((t) => t.id === app.sel.tile) || null;
export const currentText = () => currentSlide()?.texts.find((t) => t.id === app.sel.text) || null;
export const selectedSlides = () => app.project.slides.filter((s) => app.sel.slides.has(s.id));

export function selectSlide(id, mode = "single") {
  const sl = app.project.slides;
  if (mode === "toggle") {
    if (app.sel.slides.has(id) && app.sel.slides.size > 1) app.sel.slides.delete(id);
    else app.sel.slides.add(id);
  } else if (mode === "range" && app.sel.current) {
    const a = sl.findIndex((s) => s.id === app.sel.current), b = sl.findIndex((s) => s.id === id);
    app.sel.slides = new Set(sl.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.id));
  } else app.sel.slides = new Set([id]);
  if (mode !== "range") app.sel.current = id;
  else if (!app.sel.slides.has(app.sel.current)) app.sel.current = id;
  app.sel.tile = app.sel.text = null;
  app.panMode = false;
  emit("select");
}
export function selectItem(kind, id) {
  app.sel.tile = kind === "tile" ? id : null;
  app.sel.text = kind === "text" ? id : null;
  if (kind !== "tile") app.panMode = false;
  emit("select");
}

export function slideDefaults() {
  const s = app.project.settings;
  return { duration: s.defaultDuration, transition: s.defaultTransition, transitionDuration: s.defaultTransitionDuration };
}

// ---------- media
export async function addMediaItems(items) {
  const byPath = new Map(app.project.media.map((m) => [m.path, m]));
  netHosts.trust(items.map((it) => hostOf(it.path))); // the user picked these files themselves
  const added = [], all = [];
  for (const it of items) {
    const ex = byPath.get(it.path);
    if (ex) { all.push(ex); continue; }
    const m = { ...it, id: uid("m") };
    byPath.set(m.path, m);
    added.push(m);
    all.push(m);
  }
  if (added.length) {
    change((p) => p.media.push(...added), { undo: false });
    api.requestProxies(added).catch(() => {});
  }
  return all;
}
export function mediaUsage() {
  const u = new Map();
  for (const s of app.project.slides) for (const t of s.tiles) if (t.mediaId) u.set(t.mediaId, (u.get(t.mediaId) || 0) + 1);
  for (const t of app.project.music) u.set(t.mediaId, (u.get(t.mediaId) || 0) + 1);
  return u;
}

// ---------- slide building helpers
export function applyStylePreset(slide, key) {
  const pr = STYLE_PRESETS[key];
  if (!pr) return;
  slide.style = { ...pr.style };
  slide.stylePreset = key;
  const multi = slide.tiles.length > 1;
  const layout = layoutById(slide.layoutId);
  if (layout && !layout.full) {
    const rects = layoutRects(layout);
    slide.tiles.forEach((t, i) => { if (rects[i]) t.rect = { ...rects[i] }; t.rotation = 0; });
  }
  if (pr.tilt && multi) {
    for (const t of slide.tiles) {
      const sh = 0.9;
      const cx = t.rect.x + t.rect.w / 2, cy = t.rect.y + t.rect.h / 2;
      t.rect = { x: cx - (t.rect.w * sh) / 2, y: cy - (t.rect.h * sh) / 2, w: t.rect.w * sh, h: t.rect.h * sh };
      t.rotation = Math.round((Math.random() * 8 - 4) * 10) / 10;
    }
  }
}

/** Change a slide's layout, keeping media in order. Returns number of media dropped. */
export function applyLayout(slide, layoutId) {
  const layout = layoutById(layoutId);
  if (!layout) return 0;
  const rects = layoutRects(layout);
  const old = slide.tiles;
  const withMedia = old.filter((t) => t.mediaId);
  const tiles = rects.map((r, i) => {
    const src = withMedia[i];
    if (src) return { ...src, rect: r, rotation: 0, fit: rects.length === 1 ? src.fit : "fill" };
    return newTile(r);
  });
  slide.tiles = tiles;
  slide.layoutId = layoutId;
  if (rects.length === 1 && tiles[0].mediaId) {
    const m = app.mediaById.get(tiles[0].mediaId);
    if (m && m.width < m.height * 1.15 && !layout.margin) tiles[0].fit = "fit";
  }
  if (slide.stylePreset) applyStylePreset(slide, slide.stylePreset);
  return Math.max(0, withMedia.length - rects.length);
}

/** Build a slide for a set of media using the best-matching layout. */
export function slideForMedia(mediaIds, opts = {}) {
  const medias = mediaIds.map((id) => app.mediaById.get(id)).filter(Boolean);
  const d = slideDefaults();
  if (medias.length === 1 && medias[0].kind === "video") {
    const m = medias[0];
    const s = newSlide("full", d);
    const t = s.tiles[0];
    t.mediaId = m.id;
    t.fit = m.width < m.height ? "fit" : "fill";
    t.muted = opts.muted ?? false;
    const maxClip = opts.maxClip ?? 9999;
    t.trimEnd = m.duration > maxClip ? maxClip : null;
    s.duration = Math.max(1, Math.round(Math.min(m.duration, maxClip) * 10) / 10);
    return s;
  }
  const { layout, order } = bestLayout(medias, opts.prevLayout, opts.rng);
  const s = newSlide(layout.id, d);
  s.tiles.forEach((t, i) => {
    const m = medias[order[i]];
    t.mediaId = m.id;
    if (medias.length === 1 && m.width < m.height * 1.15) t.fit = "fit";
    if (m.kind === "video") t.muted = true;
  });
  if (medias.length > 1) s.duration = Math.round(d.duration * (1 + 0.12 * (medias.length - 1)) * 10) / 10;
  return s;
}

export function insertSlides(slides, index = null) {
  change((p) => {
    const at = index ?? (currentIndex() >= 0 ? currentIndex() + 1 : p.slides.length);
    p.slides.splice(at, 0, ...slides);
  });
  if (slides.length) {
    app.sel.slides = new Set(slides.map((s) => s.id));
    app.sel.current = slides[0].id;
    app.sel.tile = app.sel.text = null;
    emit("select");
  }
}
export function deleteSlides(ids) {
  const set = new Set(ids);
  let idx = app.project.slides.findIndex((s) => set.has(s.id));
  change((p) => { p.slides = p.slides.filter((s) => !set.has(s.id)); });
  const sl = app.project.slides;
  if (sl.length) selectSlide(sl[Math.min(idx, sl.length - 1)].id);
  else emit("select");
}
export function duplicateSlides(ids) {
  const set = new Set(ids);
  const copies = [];
  change((p) => {
    const out = [];
    for (const s of p.slides) {
      out.push(s);
      if (set.has(s.id)) {
        const c = JSON.parse(JSON.stringify(s));
        c.id = uid("s");
        c.tiles.forEach((t) => (t.id = uid("t")));
        c.texts.forEach((t) => (t.id = uid("x")));
        out.push(c);
        copies.push(c);
      }
    }
    p.slides = out;
  });
  if (copies.length) { app.sel.slides = new Set(copies.map((c) => c.id)); app.sel.current = copies[0].id; emit("select"); }
}
