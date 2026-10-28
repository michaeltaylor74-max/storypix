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
  isReady(m) { return m.kind === "audio" || !!this.thumbPath(m); },
};
