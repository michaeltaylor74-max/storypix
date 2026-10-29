// Canvas renderer for editor, thumbnails and preview. Mirrors engine/src/render.rs.
import { textAnim, frameAt, easeCubic, hash32, clamp, tileFrame } from "./model.js";
import { assets } from "./assets.js";
import { FONT_FALLBACK } from "./platform.js";

function roundRectPath(ctx, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (r < 0.5) ctx.rect(0, 0, w, h);
  else ctx.roundRect(0, 0, w, h, r);
}

function tileTransform(ctx, g, rot, dx = 0, dy = 0) {
  ctx.translate(g.x + g.w / 2 + dx, g.y + g.h / 2 + dy);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-g.w / 2, -g.h / 2);
}

const bgCache = new Map();
function blurredBackground(img, key, W, H) {
  const k = `${key}|${W}x${H}`;
  let c = bgCache.get(k);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = Math.max(32, Math.round(W / 4));
  c.height = Math.max(18, Math.round(H / 4));
  const x = c.getContext("2d");
  const iw = img.videoWidth || img.naturalWidth || img.width, ih = img.videoHeight || img.naturalHeight || img.height;
  const s = Math.max(c.width / iw, c.height / ih) * 1.15;
  x.filter = `blur(${Math.max(2, c.width / 45)}px)`;
  x.drawImage(img, (c.width - iw * s) / 2, (c.height - ih * s) / 2, iw * s, ih * s);
  x.filter = "none";
  x.fillStyle = "rgba(0,0,0,0.35)";
  x.fillRect(0, 0, c.width, c.height);
  if (bgCache.size > 300) bgCache.delete(bgCache.keys().next().value);
  bgCache.set(k, c);
  return c;
}

export function drawBackground(ctx, slide, W, H, mode, mediaById) {
  const bg = slide.background;
  if (bg.kind === "gradient") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, bg.color);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (bg.kind === "blur") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const t = slide.tiles.find((t) => t.mediaId && mediaById.get(t.mediaId));
    if (!t) return;
    const m = mediaById.get(t.mediaId);
    const img = assets.image(m, "thumb");
    if (img) ctx.drawImage(blurredBackground(img, m.id, W, H), 0, 0, W, H);
    return;
  }
  ctx.fillStyle = bg.color || "#000";
  ctx.fillRect(0, 0, W, H);
}

/**
 * Draw one slide.
 * mode: "edit" (static, placeholders), "thumb" (static, small), "play" (animated, live video)
 */
export function drawSlide(ctx, project, slide, lt, W, H, mode, mediaById, videoFor) {
  const k = H / 1080;
  ctx.save();
  drawBackground(ctx, slide, W, H, mode, mediaById);
  const animated = mode === "play";
  const p = slide.duration > 0 ? clamp(lt / slide.duration, 0, 1) : 0;
  const st = slide.style;
  for (const tile of slide.tiles) {
    const g = { x: tile.rect.x * W, y: tile.rect.y * H, w: tile.rect.w * W, h: tile.rect.h * H };
    if (g.w < 1 || g.h < 1) continue;
    const m = tile.mediaId ? mediaById.get(tile.mediaId) : null;
    if (!m) {
      if (mode !== "play") {
        ctx.save();
        tileTransform(ctx, g, tile.rotation);
        roundRectPath(ctx, g.w, g.h, st.radius * k);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fill();
        ctx.setLineDash([8 * k * 1.5, 6 * k * 1.5]);
        ctx.lineWidth = Math.max(1, 2 * k * 1.5);
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.stroke();
        if (mode === "edit") {
          ctx.fillStyle = "rgba(255,255,255,0.6)";
          ctx.font = `${Math.max(10, Math.min(g.w, g.h) * 0.09)}px ${FONT_FALLBACK}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("Drop a photo or video here", g.w / 2, g.h / 2);
        }
        ctx.restore();
      }
      continue;
    }
    const isVideo = m.kind === "video";
    if (st.shadow) {
      for (const [dx, dy, a] of [[1, 3, 40], [3, 7, 30], [6, 12, 22]]) {
        ctx.save();
        tileTransform(ctx, g, tile.rotation, dx * k, dy * k);
        roundRectPath(ctx, g.w, g.h, st.radius * k);
        ctx.fillStyle = `rgba(0,0,0,${a / 255})`;
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    tileTransform(ctx, g, tile.rotation);
    roundRectPath(ctx, g.w, g.h, st.radius * k);
    ctx.save();
    ctx.clip();
    let src = null;
    if (isVideo && animated && videoFor) {
      const v = videoFor(slide, tile);
      if (v && v.readyState >= 2) src = v;
    }
    if (!src) src = assets.image(m, mode === "thumb" ? "thumb" : "proxy");
    if (src) {
      // Proportion guard: always place using the real pixel shape of what is drawn.
      const iw = src.videoWidth || src.naturalWidth || src.width || m.width;
      const ih = src.videoHeight || src.naturalHeight || src.height || m.height;
      const [left, top, dw, dh] = tileFrame(tile, p, isVideo, g.w, g.h, iw, ih, animated);
      ctx.drawImage(src, left, top, dw, dh);
    } else {
      ctx.fillStyle = "#2a2f3a";
      ctx.fillRect(0, 0, g.w, g.h);
    }
    ctx.restore();
    if (st.border > 0) {
      roundRectPath(ctx, g.w, g.h, st.radius * k);
      ctx.lineWidth = st.border * k;
      ctx.lineJoin = "round";
      ctx.strokeStyle = st.borderColor;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (slide.texts.length) {
    const [alpha, dy] = animated ? textAnim(slide.textAnim, lt) : [1, 0];
    if (alpha > 0.001) drawTexts(ctx, slide.texts, W, H, alpha, dy * k);
  }
  ctx.restore();
}

export function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > maxW && line.trim()) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function textFont(t, k) {
  return `${t.italic ? "italic " : ""}${t.bold ? "700" : "400"} ${Math.max(1, t.size * k)}px "${t.font}", ${FONT_FALLBACK}`;
}

export function drawTexts(ctx, texts, W, H, alpha = 1, dy = 0) {
  const k = H / 1080;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, dy);
  for (const t of texts) {
    if (!t.text) continue;
    const r = { x: t.rect.x * W, y: t.rect.y * H, w: t.rect.w * W, h: t.rect.h * H };
    ctx.font = textFont(t, k);
    const pad = 14 * k;
    const lines = wrapLines(ctx, t.text, r.w - pad * 2);
    const lh = t.size * k * 1.2;
    const blockH = lines.length * lh;
    let y0 = r.y + pad;
    if (t.valign === "middle") y0 = r.y + (r.h - blockH) / 2;
    else if (t.valign === "bottom") y0 = r.y + r.h - pad - blockH;
    if (t.bg) {
      let maxW = 0;
      for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
      const bw = Math.min(r.w, maxW + pad * 2.4), bh = blockH + pad * 1.2;
      let bx = r.x + (r.w - bw) / 2;
      if (t.align === "left") bx = r.x;
      if (t.align === "right") bx = r.x + r.w - bw;
      ctx.save();
      ctx.fillStyle = t.bg;
      ctx.beginPath();
      ctx.roundRect(bx, y0 - pad * 0.6, bw, bh, 12 * k);
      ctx.fill();
      ctx.restore();
    }
    ctx.textBaseline = "middle";
    ctx.textAlign = t.align;
    const x = t.align === "left" ? r.x + pad : t.align === "right" ? r.x + r.w - pad : r.x + r.w / 2;
    lines.forEach((l, i) => {
      const y = y0 + lh * (i + 0.5);
      if (t.outline) {
        ctx.save();
        ctx.lineWidth = Math.max(1, t.size * k * 0.09);
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText(l, x, y);
        ctx.restore();
      }
      ctx.save();
      if (t.shadow) {
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 10 * k;
        ctx.shadowOffsetY = 3 * k;
      }
      ctx.fillStyle = t.color;
      ctx.fillText(l, x, y);
      ctx.restore();
    });
  }
  ctx.restore();
}

// ---------- transitions
function clipRects(ctx, rects) {
  ctx.beginPath();
  for (const [x, y, w, h] of rects) if (w > 0 && h > 0) ctx.rect(x, y, w, h);
  ctx.clip();
}
export function composite(ctx, A, B, kind, q, W, H) {
  const qe = easeCubic(q);
  const draw = (c, x = 0, y = 0, a = 1, s = 1) => {
    ctx.save();
    ctx.globalAlpha = a;
    if (s !== 1) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
    }
    if (c) ctx.drawImage(c, x, y, W, H);
    else {
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, W, H);
    }
    ctx.restore();
  };
  ctx.save();
  switch (kind) {
    case "cut": draw(B); break;
    case "fadeBlack":
    case "fadeWhite": {
      const col = kind === "fadeBlack" ? "0,0,0" : "255,255,255";
      if (q < 0.5) draw(A); else draw(B);
      const al = q < 0.5 ? q * 2 : 2 - q * 2;
      ctx.fillStyle = `rgba(${col},${clamp(al, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "pushLeft": case "pushRight": case "pushUp": case "pushDown": {
      const [dx, dy] = { pushLeft: [-1, 0], pushRight: [1, 0], pushUp: [0, -1], pushDown: [0, 1] }[kind];
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      draw(A, dx * qe * W, dy * qe * H);
      draw(B, -dx * (1 - qe) * W, -dy * (1 - qe) * H);
      break;
    }
    case "coverLeft": case "coverRight": {
      const s = kind === "coverLeft" ? 1 : -1;
      draw(A); draw(B, s * (1 - qe) * W, 0);
      break;
    }
    case "wipeLeft": case "wipeRight": case "wipeUp": case "wipeDown": {
      draw(A);
      const r = {
        wipeLeft: [(1 - qe) * W, 0, qe * W, H], wipeRight: [0, 0, qe * W, H],
        wipeUp: [0, (1 - qe) * H, W, qe * H], wipeDown: [0, 0, W, qe * H],
      }[kind];
      ctx.save(); clipRects(ctx, [r]); draw(B); ctx.restore();
      break;
    }
    case "circle": {
      draw(A);
      const rad = (qe * Math.hypot(W, H)) / 2;
      if (rad > 0.5) {
        ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2); ctx.clip(); draw(B); ctx.restore();
      }
      break;
    }
    case "zoomIn": ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); draw(A, 0, 0, 1, 1 + 0.25 * qe); draw(B, 0, 0, qe); break;
    case "zoomOut": draw(A); draw(B, 0, 0, qe, 1.25 - 0.25 * qe); break;
    case "blinds": {
      draw(A);
      const n = 8, sh = H / n;
      ctx.save(); clipRects(ctx, Array.from({ length: n }, (_, i) => [0, i * sh, W, qe * sh + 0.5])); draw(B); ctx.restore();
      break;
    }
    case "mosaic": {
      draw(A);
      const cols = 32, rows = 18, cw = W / cols, ch = H / rows, rects = [];
      for (let i = 0; i < cols * rows; i++) if (hash32(i) < q) rects.push([Math.floor((i % cols) * cw), Math.floor(Math.floor(i / cols) * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1]);
      if (rects.length) { ctx.save(); clipRects(ctx, rects); draw(B); ctx.restore(); }
      break;
    }
    default: draw(A); draw(B, 0, 0, q);
  }
  ctx.restore();
}

/** Render the whole show at time t into ctx (play mode). */
const off = { a: null, b: null };
function offscreen(which, W, H) {
  let c = off[which];
  if (!c) c = off[which] = document.createElement("canvas");
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c;
}
export function drawFrame(ctx, project, tl, t, W, H, mediaById, videoFor, mode = "play") {
  const spec = frameAt(project, tl, t);
  if (!spec) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    return null;
  }
  const sl = project.slides;
  if (spec.inTransition) {
    const cb = offscreen("b", W, H);
    drawSlide(cb.getContext("2d"), project, sl[spec.b], spec.bLt, W, H, mode, mediaById, videoFor);
    let ca = null;
    if (spec.a) {
      ca = offscreen("a", W, H);
      drawSlide(ca.getContext("2d"), project, sl[spec.a[0]], spec.a[1], W, H, mode, mediaById, videoFor);
    }
    composite(ctx, ca, cb, sl[spec.b].transition.kind, spec.q, W, H);
  } else {
    drawSlide(ctx, project, sl[spec.b], spec.bLt, W, H, mode, mediaById, videoFor);
  }
  if (spec.endAlpha < 1) {
    ctx.fillStyle = `rgba(0,0,0,${1 - spec.endAlpha})`;
    ctx.fillRect(0, 0, W, H);
  }
  return spec;
}
