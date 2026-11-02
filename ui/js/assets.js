// Image cache for thumbnails / preview proxies. Calls onLoad listeners so views can redraw.
import { fileSrc } from "./backend.js";

const cache = new Map(); // key -> {img, ok}
const listeners = new Set();
let pending = false;
const proxies = new Map(); // mediaId -> {thumb, proxy, error}

function notify() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    for (const f of listeners) f();
  });
}

const stills = new Map(); // `${mediaId}@${t}` -> {c: canvas|null, failed}
const stillQueue = [];
let stillBusy = false;
function pumpStills(self) {
  if (stillBusy || !stillQueue.length) return;
  const job = stillQueue.pop(); // newest first: what the user just changed
  const entry = stills.get(job.key);
  if (!entry || entry.c) { pumpStills(self); return; }
  stillBusy = true;
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    // a server that can't seek lands somewhere else: better the thumbnail than the wrong frame
    if (ok && Math.abs(v.currentTime - Math.min(job.t, (isFinite(v.duration) ? v.duration : job.t + 1) - 0.05)) > 0.6) ok = false;
    if (ok) {
      try {
        const vw = v.videoWidth, vh = v.videoHeight, s = Math.min(1, 960 / Math.max(vw, vh));
        const c = document.createElement("canvas");
        c.width = Math.max(2, Math.round(vw * s));
        c.height = Math.max(2, Math.round(vh * s));
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        entry.c = c;
        notify();
      } catch { entry.failed = true; }
    } else entry.failed = true;
    v.removeAttribute("src");
    try { v.load(); } catch {}
    stillBusy = false;
    setTimeout(() => pumpStills(self), 0);
  };
  const timer = setTimeout(() => finish(false), 8000);
  v.addEventListener("loadedmetadata", () => {
    const d = isFinite(v.duration) ? v.duration : job.t + 1;
    v.currentTime = Math.min(job.t, Math.max(0, d - 0.05));
  }, { once: true });
  v.addEventListener("seeked", () => {
    // make sure the frame is actually painted before copying it
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => finish(true));
    else setTimeout(() => finish(true), 30);
    setTimeout(() => finish(v.readyState >= 2), 600);
  }, { once: true });
  v.addEventListener("error", () => finish(false), { once: true });
  v.src = self.videoSrc(job.m);
  if (!v.src) finish(false);
}

export const assets = {
  onLoad(fn) { listeners.add(fn); },
  setProxy(id, info) { proxies.set(id, { ...(proxies.get(id) || {}), ...info }); notify(); },
  proxyInfo(id) { return proxies.get(id); },
  thumbPath(m) { return proxies.get(m.id)?.thumb || m.thumb || null; },
  proxyPath(m) { return proxies.get(m.id)?.proxy || m.proxy || null; },
  /** Video preview src: proxy if ready else original */
  // Missing / not-approved files are never loaded (that could reach out to a network share).
  videoSrc(m) { return m.missing ? "" : fileSrc(this.proxyPath(m) || m.path); },
  audioSrc(m) { return m.missing ? "" : fileSrc(this.proxyPath(m) || m.path); },
  /** Returns a loaded HTMLImageElement or null (and starts loading). */
  image(m, quality = "proxy") {
    let path = null;
    if (m.kind === "image") path = quality === "thumb" ? this.thumbPath(m) || this.proxyPath(m) : this.proxyPath(m) || this.thumbPath(m);
    else if (m.kind === "video") path = this.thumbPath(m);
    if (!path) return null;
    let e = cache.get(path);
    if (!e) {
      const img = new Image();
      e = { img, ok: false };
      cache.set(path, e);
      img.decoding = "async";
      img.onload = () => { e.ok = true; notify(); };
      img.onerror = () => { e.ok = false; e.failed = true; };
      img.src = fileSrc(path);
      if (cache.size > 1500) {
        for (const [k, v] of cache) { if (k.includes("_p.")) { cache.delete(k); break; } }
      }
      // fall back to the thumbnail while the bigger proxy loads
      if (quality !== "thumb" && m.kind === "image") {
        const t = this.thumbPath(m);
        if (t && t !== path) { const te = cache.get(t); if (te?.ok) return te.img; }
      }
      return null;
    }
    if (e.ok) return e.img;
    if (quality !== "thumb") {
      const t = this.thumbPath(m);
      const te = t && cache.get(t);
      if (te?.ok) return te.img;
    }
    return null;
  },
  /**
   * A still frame of a video at time t (seconds) — e.g. the trimmed start point — as a canvas,
   * or null while it is being made (listeners are notified when it's ready).
   */
  videoStill(m, t = 0) {
    if (m.kind !== "video" || m.missing) return null;
    const q = Math.max(0, Math.round((+t || 0) * 10) / 10);
    if (q < 0.05) return null; // the thumbnail already shows the very start
    const key = `${m.id}@${q}`;
    const e = stills.get(key);
    if (e) { stills.delete(key); stills.set(key, e); return e.c; } // keep recently used
    // only the latest request per video matters (e.g. while dragging the trim slider)
    for (let i = stillQueue.length - 1; i >= 0; i--) {
      if (stillQueue[i].m.id === m.id) { stills.delete(stillQueue[i].key); stillQueue.splice(i, 1); }
    }
    stills.set(key, { c: null });
    stillQueue.push({ key, m, t: q });
    pumpStills(this);
    while (stills.size > 120) stills.delete(stills.keys().next().value);
    return null;
  },
  /** Best picture for a video box when it isn't playing: the frame at its trim start, else the thumbnail. */
  videoPoster(m, t, quality = "proxy") {
    return this.videoStill(m, t) || this.image(m, quality);
  },
  /** Promise of a still (waits up to ~6 s). */
  async videoStillAsync(m, t) {
    for (let i = 0; i < 60; i++) {
      const c = this.videoStill(m, t);
      if (c || Math.round((+t || 0) * 10) / 10 < 0.05) return c;
      if (stills.get(`${m.id}@${Math.round((+t || 0) * 10) / 10}`)?.failed) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  },
  isReady(m) { return m.kind === "audio" || !!this.thumbPath(m); },
};
