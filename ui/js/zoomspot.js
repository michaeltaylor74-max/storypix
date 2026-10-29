// 🎯 Zoom to a spot: pick a START framing and an END framing on the photo (e.g. the whole
// photo, then a face). The slide glides smoothly from one to the other.
import { h, modal, toast } from "./ui.js";
import { app, change } from "./state.js";
import { assets } from "./assets.js";
import { coverScale, placeAt, clamp, easeSine, W0, H0 } from "./model.js";

const MAXZ = 6;

export async function openZoomSpot(slide, tile) {
  const m = app.mediaById.get(tile.mediaId);
  if (!m) return;
  const img = await loadImage(m);
  if (!img) return toast("The preview of this photo isn't ready yet — try again in a moment.", "warn");
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const tw = tile.rect.w * W0, th = tile.rect.h * H0; // box shape (only the ratio matters)
  const c = coverScale(tile, tw, th, iw, ih);
  // size of the visible window as a fraction of the image, at zoom z
  const win = (z) => ({ w: Math.min(1, tw / (c * z * iw)), h: Math.min(1, th / (c * z * ih)) });
  const clampFrame = (f) => {
    const z = clamp(f.z, 1, MAXZ), ww = win(z);
    return { z, x: clamp(f.x, ww.w / 2, 1 - ww.w / 2), y: clamp(f.y, ww.h / 2, 1 - ww.h / 2) };
  };
  const full = { x: 0.5, y: 0.5, z: 1 };
  let from, to;
  if (tile.motion === "custom" && tile.kb) { from = clampFrame(tile.kb.from); to = clampFrame(tile.kb.to); }
  else { from = clampFrame({ x: tile.focusX, y: tile.focusY, z: 1 }); to = clampFrame({ x: 0.5, y: 0.4, z: 2.5 }); }

  // ---- big picture with two draggable frames
  const pic = h("img", { class: "zs-img", src: img.src, draggable: false });
  const boxA = h("div", { class: "zs-box start" }, h("span", {}, "START"), h("i", { class: "zs-corner" }));
  const boxB = h("div", { class: "zs-box end" }, h("span", {}, "END"), h("i", { class: "zs-corner" }));
  const stage = h("div", { class: "zs-stage" }, pic, boxA, boxB);
  const fitStage = () => {
    const maxW = 760, maxH = 430, s = Math.min(maxW / iw, maxH / ih);
    stage.style.width = `${iw * s}px`;
    stage.style.height = `${ih * s}px`;
  };
  const layoutBox = (box, f) => {
    const ww = win(f.z);
    Object.assign(box.style, { left: `${(f.x - ww.w / 2) * 100}%`, top: `${(f.y - ww.h / 2) * 100}%`, width: `${ww.w * 100}%`, height: `${ww.h * 100}%` });
  };
  const redraw = () => { layoutBox(boxA, from); layoutBox(boxB, to); };
  const drag = (box, which) => {
    box.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const corner = e.target.classList.contains("zs-corner");
      const f0 = { ...(which === "a" ? from : to) };
      const sx = e.clientX, sy = e.clientY;
      const move = (ev) => {
        const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
        let f;
        if (corner) {
          // drag the corner: bigger box = less zoom
          const w0 = win(f0.z).w, nw = Math.max(0.03, w0 + dx * 2);
          f = clampFrame({ ...f0, z: f0.z * (w0 / nw) });
        } else f = clampFrame({ ...f0, x: f0.x + dx, y: f0.y + dy });
        if (which === "a") from = f; else to = f;
        redraw();
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    box.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = which === "a" ? from : to;
      const nf = clampFrame({ ...f, z: f.z * Math.pow(1.1, -e.deltaY / 100) });
      if (which === "a") from = nf; else to = nf;
      redraw();
    }, { passive: false });
  };
  drag(boxA, "a");
  drag(boxB, "b");

  // ---- live preview of the movement
  const pw = 320, ph = Math.round(pw * (th / tw));
  const prev = h("canvas", { class: "zs-preview", width: pw, height: Math.min(ph, 400) });
  let raf = 0, t0 = performance.now();
  const loopLen = Math.max(2, slide.duration) * 1000;
  const anim = () => {
    const ctx = prev.getContext("2d");
    const p = ((performance.now() - t0) % (loopLen + 800)) / loopLen;
    const e = easeSine(Math.min(1, p));
    const z = from.z * Math.pow(to.z / from.z, e);
    const [l, t, dw, dh] = placeAt(tile, prev.width, prev.height, iw, ih, z, from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, prev.width, prev.height);
    ctx.drawImage(img, l, t, dw, dh);
    raf = requestAnimationFrame(anim);
  };

  const preset = (kind) => {
    if (kind === "in") { const spot = to.z > 1.05 ? to : from.z > 1.05 ? from : clampFrame({ x: 0.5, y: 0.4, z: 2.5 }); from = { ...full }; to = clampFrame(spot); }
    if (kind === "out") { const spot = to.z > 1.05 ? to : from.z > 1.05 ? from : clampFrame({ x: 0.5, y: 0.4, z: 2.5 }); from = clampFrame(spot); to = { ...full }; }
    if (kind === "swap") [from, to] = [to, from];
    t0 = performance.now();
    redraw();
  };

  const body = h("div", { class: "zs" },
    h("div", { class: "zs-main" },
      h("div", { class: "zs-wrap" }, stage),
      h("div", { class: "zs-side" },
        h("div", { class: "muted small" }, "Preview"),
        prev,
        h("div", { class: "btn-col" },
          h("button", { class: "btn small", onclick: () => preset("in") }, "🔍 Zoom in to the spot"),
          h("button", { class: "btn small", onclick: () => preset("out") }, "↩ Start close, zoom out"),
          h("button", { class: "btn small", onclick: () => preset("swap") }, "⇄ Swap start and end")))),
    h("p", { class: "muted small" }, "Drag the green START frame and the orange END frame to where you want the camera to begin and finish — for example the whole photo, then a box around someone's face. Drag a frame's corner (or scroll on it) to zoom in or out. The movement takes the whole slide (", `${slide.duration.toFixed(1)}s`, ")."));

  setTimeout(() => { fitStage(); redraw(); raf = requestAnimationFrame(anim); });
  const res = await modal({
    title: "🎯 Zoom to a spot",
    wide: true,
    body,
    buttons: [
      tile.motion === "custom" ? { label: "Turn off", value: "off", danger: true } : null,
      { label: "Cancel", value: null },
      { label: "Use this zoom", value: "ok", primary: true },
    ].filter(Boolean),
  });
  cancelAnimationFrame(raf);
  if (res === "ok") change(() => { tile.motion = "custom"; tile.kb = { from: { ...from }, to: { ...to } }; });
  if (res === "off") change(() => { tile.motion = "none"; tile.kb = null; });
}

function loadImage(m) {
  const ready = assets.image(m, "proxy");
  if (ready) return Promise.resolve(ready);
  return new Promise((res) => {
    let n = 0;
    const iv = setInterval(() => {
      const im = assets.image(m, "proxy");
      if (im || ++n > 30) { clearInterval(iv); res(im || null); }
    }, 100);
  });
}
