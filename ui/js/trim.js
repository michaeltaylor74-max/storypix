// ✂ Video trimmer: watch the clip, drag the yellow handles (or type times) to keep just the part you want.
import { h, modal, timeInput, fmtSecs } from "./ui.js";
import { app, change } from "./state.js";
import { assets } from "./assets.js";

export async function openTrim(slide, tile) {
  const m = app.mediaById.get(tile.mediaId);
  if (!m || m.kind !== "video") return;
  const dur = Math.max(0.1, m.duration);
  let start = tile.trimStart || 0;
  let end = Math.min(tile.trimEnd ?? dur, dur);
  const onlyTile = slide.tiles.filter((t) => t.mediaId).length === 1;

  const video = h("video", { class: "trim-video", preload: "auto", playsInline: true });
  video.src = assets.videoSrc(m);
  video.muted = false;
  const strip = h("canvas", { class: "trim-strip", width: 1200, height: 80 });
  const sel = h("div", { class: "trim-sel" });
  const hIn = h("div", { class: "trim-handle in", title: "Drag to set where the clip starts" });
  const hOut = h("div", { class: "trim-handle out", title: "Drag to set where the clip ends" });
  const head = h("div", { class: "trim-head" });
  const bar = h("div", { class: "trim-bar" }, strip, h("div", { class: "trim-shade left" }), h("div", { class: "trim-shade right" }), sel, hIn, hOut, head);
  const now = h("span", { class: "trim-now" }, "0:00.0");
  const lenLbl = h("b", {}, "");
  let startBox, endBox;
  const playBtn = h("button", { class: "btn", onclick: () => togglePlay() }, "▶ Play clip");
  const fitChk = h("input", { type: "checkbox", checked: onlyTile });
  const muteChk = h("input", { type: "checkbox", checked: !!tile.muted });

  const pct = (t) => `${(t / dur) * 100}%`;
  function update() {
    sel.style.left = pct(start); sel.style.width = pct(end - start);
    hIn.style.left = pct(start); hOut.style.left = pct(end);
    bar.querySelector(".left").style.width = pct(start);
    bar.querySelector(".right").style.left = pct(end);
    lenLbl.textContent = fmtSecs(end - start);
    startBox.value = fmtSecs(start);
    endBox.value = fmtSecs(end);
  }
  function setStart(t) { start = Math.max(0, Math.min(t, end - 0.2)); update(); }
  function setEnd(t) { end = Math.min(dur, Math.max(t, start + 0.2)); update(); }
  startBox = timeInput({ value: start, max: dur, onset: (v) => { setStart(v); seek(start); } });
  endBox = timeInput({ value: end, max: dur, onset: (v) => { setEnd(v); seek(Math.max(start, end - 1.5)); } });

  function seek(t) { video.currentTime = Math.max(0, Math.min(dur, t)); }
  function togglePlay() {
    if (video.paused) {
      if (video.currentTime < start - 0.05 || video.currentTime >= end - 0.05) seek(start);
      video.play().catch(() => {});
    } else video.pause();
  }
  video.addEventListener("play", () => { playBtn.textContent = "❚❚ Pause"; });
  video.addEventListener("pause", () => { playBtn.textContent = "▶ Play clip"; });
  let raf = 0;
  const tick = () => {
    const t = video.currentTime || 0;
    head.style.left = pct(t);
    now.textContent = fmtSecs(t);
    if (!video.paused && t >= end) { video.pause(); seek(end); }
    raf = requestAnimationFrame(tick);
  };

  // dragging on the bar
  bar.addEventListener("pointerdown", (e) => {
    const r = bar.getBoundingClientRect();
    const tAt = (x) => Math.max(0, Math.min(dur, ((x - r.left) / r.width) * dur));
    const which = e.target === hIn ? "in" : e.target === hOut ? "out" : "seek";
    const move = (ev) => {
      const t = tAt(ev.clientX);
      if (which === "in") { setStart(t); seek(start); }
      else if (which === "out") { setEnd(t); seek(end); }
      else seek(t);
    };
    move(e);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  const keys = (e) => {
    if (e.target.tagName === "INPUT" && e.target.type === "text") return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    if (e.key.toLowerCase() === "i") setStart(video.currentTime);
    if (e.key.toLowerCase() === "o") setEnd(video.currentTime);
    if (e.key === "ArrowLeft") { e.preventDefault(); seek(video.currentTime - (e.shiftKey ? 1 : 1 / 30)); }
    if (e.key === "ArrowRight") { e.preventDefault(); seek(video.currentTime + (e.shiftKey ? 1 : 1 / 30)); }
  };

  const body = h("div", { class: "trim" },
    h("div", { class: "trim-player" }, video),
    h("div", { class: "trim-controls" },
      playBtn,
      h("button", { class: "btn", title: "Shortcut: I", onclick: () => setStart(video.currentTime) }, "⇤ Start here"),
      h("button", { class: "btn", title: "Shortcut: O", onclick: () => setEnd(video.currentTime) }, "End here ⇥"),
      h("span", { class: "grow" }),
      now, h("span", { class: "muted" }, ` / ${fmtSecs(dur)}`)),
    bar,
    h("div", { class: "trim-fields" },
      h("label", { class: "row" }, h("span", {}, "Start"), startBox),
      h("label", { class: "row" }, h("span", {}, "End"), endBox),
      h("span", { class: "kv" }, h("span", { class: "muted" }, "Clip length "), lenLbl),
      h("button", { class: "btn small ghost", onclick: () => { start = 0; end = dur; update(); } }, "Reset to full video")),
    h("label", { class: "row check" }, fitChk, "Make the slide the same length as the clip"),
    m.hasAudio ? h("label", { class: "row check" }, muteChk, "Mute this clip's sound in the show") : null,
    h("p", { class: "muted small" }, "Drag the yellow handles, or play the video and press I (start) / O (end) at the right moments. Space plays and pauses; ← → step one frame."));

  update();
  document.addEventListener("keydown", keys, true);
  raf = requestAnimationFrame(tick);
  video.addEventListener("loadedmetadata", () => { seek(start); buildStrip(m, strip, dur); }, { once: true });

  const ok = await modal({
    title: `✂ Trim video — ${m.name}`,
    wide: true,
    body,
    buttons: [{ label: "Cancel", value: false }, { label: "Use this part", value: true, primary: true }],
  });
  document.removeEventListener("keydown", keys, true);
  cancelAnimationFrame(raf);
  video.pause();
  video.removeAttribute("src");
  video.load();
  if (!ok) return;
  change(() => {
    tile.trimStart = Math.round(start * 100) / 100;
    tile.trimEnd = end >= dur - 0.05 ? null : Math.round(end * 100) / 100;
    if (m.hasAudio) tile.muted = muteChk.checked;
    if (fitChk.checked) slide.duration = Math.max(0.5, Math.round((end - start) * 10) / 10);
  });
}

/** Draw a filmstrip of frames along the trim bar (best effort). */
async function buildStrip(m, canvas, dur) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#11141a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = assets.videoSrc(m);
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(rej, 8000); });
    const n = 12, w = canvas.width / n, hgt = canvas.height;
    for (let i = 0; i < n; i++) {
      if (!canvas.isConnected) break;
      v.currentTime = Math.min(dur - 0.05, ((i + 0.5) / n) * dur);
      await new Promise((res) => { v.onseeked = res; setTimeout(res, 2500); });
      const iw = v.videoWidth || 16, ih = v.videoHeight || 9;
      const s = Math.max(w / iw, hgt / ih);
      ctx.save();
      ctx.beginPath(); ctx.rect(i * w, 0, w - 1, hgt); ctx.clip();
      ctx.drawImage(v, i * w + (w - iw * s) / 2, (hgt - ih * s) / 2, iw * s, ih * s);
      ctx.restore();
    }
  } catch { /* leave the plain bar */ }
  v.removeAttribute("src");
  v.load();
}
