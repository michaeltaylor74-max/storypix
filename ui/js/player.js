// Preview playback: animates the whole show on the stage with music and video.
import { app, on, emit, currentIndex } from "./state.js";
import { computeTimeline, frameAt, musicEnvelope, musicSchedule, fmtTime } from "./model.js";
import { drawFrame } from "./render.js";
import { stageCanvas, requestDraw } from "./editor.js";
import { assets } from "./assets.js";
import { h } from "./ui.js";

let tl = null, env = null, sched = null;
let t0 = 0, startPerf = 0, raf = 0, endAt = Infinity;
const videos = new Map(); // key -> HTMLVideoElement
const audios = new Map(); // track id -> HTMLAudioElement
let transport, timeLabel, scrub, playBtn;
let keepHead = false;

export function initPlayer(el) {
  playBtn = h("button", { class: "play-btn", title: "Play / pause (Space)", onclick: () => toggle() }, "▶");
  timeLabel = h("span", { class: "time" }, "0:00 / 0:00");
  scrub = h("input", { type: "range", class: "scrub", min: 0, max: 1, step: 0.01, value: 0 });
  scrub.addEventListener("input", () => {
    const t = +scrub.value;
    if (app.playing) { stop(false); }
    app.playhead = t;
    previewStill(t);
  });
  el.append(
    h("button", { class: "icon-btn", title: "Back to start", onclick: () => { stop(); app.playhead = 0; syncUi(); } }, "⏮"),
    playBtn,
    h("button", { class: "icon-btn", title: "Play from the selected slide", onclick: () => playFromCurrent() }, "▶ This slide"),
    scrub, timeLabel);
  transport = el;
  on("change", () => { if (!app.playing) syncUi(); });
  on("select", () => {
    if (app.playing || keepHead) return;
    tl = computeTimeline(app.project);
    const i = currentIndex();
    if (i >= 0) app.playhead = tl.starts[i];
    syncUi();
  });
  on("play-slide", () => playFromCurrent(true));
  syncUi();
}

function syncUi() {
  tl = computeTimeline(app.project);
  scrub.max = Math.max(0.01, tl.total);
  scrub.value = Math.min(app.playhead, tl.total);
  timeLabel.textContent = `${fmtTime(app.playhead)} / ${fmtTime(tl.total)}`;
  playBtn.textContent = app.playing ? "❚❚" : "▶";
}

export function toggle() { app.playing ? stop() : play(app.playhead >= (tl?.total ?? 0) - 0.05 ? 0 : app.playhead); }
export function playFromCurrent(onlyThis = false) {
  tl = computeTimeline(app.project);
  const i = Math.max(0, currentIndex());
  play(tl.starts[i] ?? 0, onlyThis ? tl.starts[i] + app.project.slides[i].duration : Infinity);
}

export function play(from = 0, until = Infinity) {
  if (!app.project.slides.length) return;
  tl = computeTimeline(app.project);
  env = musicEnvelope(app.project, tl, app.mediaById);
  sched = musicSchedule(app.project, app.mediaById);
  t0 = Math.max(0, Math.min(from, tl.total - 0.05));
  endAt = Math.min(until, tl.total);
  startPerf = performance.now();
  app.playing = true;
  document.body.classList.add("is-playing");
  emit("playing", true);
  syncUi();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

export function stop(selectSlideAtPlayhead = true) {
  if (!app.playing) return;
  app.playing = false;
  cancelAnimationFrame(raf);
  for (const v of videos.values()) { v.pause(); v.removeAttribute("src"); v.load(); }
  videos.clear();
  for (const a of audios.values()) a.pause();
  audios.clear();
  document.body.classList.remove("is-playing");
  emit("playing", false);
  if (selectSlideAtPlayhead) {
    const spec = frameAt(app.project, tl, app.playhead);
    if (spec) {
      const id = app.project.slides[spec.b].id;
      app.sel.slides = new Set([id]);
      app.sel.current = id;
      app.sel.tile = app.sel.text = null;
      keepHead = true;
      emit("select");
      keepHead = false;
    }
  }
  syncUi();
  requestDraw();
}

function envAt(t) {
  const x = t * 100, i = Math.floor(x);
  if (!env || i + 1 >= env.length) return env?.[env.length - 1] ?? 1;
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
}

function videoKey(slide, tile) { return `${slide.id}:${tile.id}`; }

function ensureVideo(slide, tile, lt, playing) {
  const key = videoKey(slide, tile);
  const m = app.mediaById.get(tile.mediaId);
  let v = videos.get(key);
  const clipEnd = Math.min(tile.trimEnd ?? m.duration, m.duration);
  const want = tile.trimStart + Math.min(Math.max(0, lt), Math.max(0, clipEnd - tile.trimStart));
  if (!v) {
    v = document.createElement("video");
    v.preload = "auto";
    v.playsInline = true;
    v.src = assets.videoSrc(m);
    v.currentTime = want;
    videos.set(key, v);
  }
  v.muted = tile.muted || !m.hasAudio;
  v.volume = Math.min(1, tile.volume);
  const pastEnd = lt >= clipEnd - tile.trimStart;
  if (playing && !pastEnd) {
    if (v.paused) { v.currentTime = want; v.play().catch(() => {}); }
    else if (Math.abs(v.currentTime - want) > 0.35) v.currentTime = want;
  } else if (!v.paused) v.pause();
  return v;
}

function tick() {
  if (!app.playing) return;
  const t = t0 + (performance.now() - startPerf) / 1000;
  if (t >= endAt) {
    app.playhead = Math.min(endAt, tl.total);
    stop();
    return;
  }
  app.playhead = t;
  const p = app.project;
  const spec = frameAt(p, tl, t);
  // manage videos for active (and upcoming) slides
  const active = new Set();
  const touch = (si, lt, playing) => {
    const s = p.slides[si];
    if (!s) return;
    for (const tile of s.tiles) {
      const m = tile.mediaId && app.mediaById.get(tile.mediaId);
      if (m?.kind === "video") { ensureVideo(s, tile, lt, playing); active.add(videoKey(s, tile)); }
    }
  };
  if (spec) {
    touch(spec.b, spec.bLt, true);
    if (spec.a) touch(spec.a[0], spec.a[1], true);
    const nx = spec.b + 1;
    if (nx < p.slides.length && tl.starts[nx] - t < 2.5) touch(nx, 0, false); // preload videos
    for (let j = spec.b + 1; j < Math.min(p.slides.length, spec.b + 3); j++) {
      for (const tile of p.slides[j].tiles) {
        const m = tile.mediaId && app.mediaById.get(tile.mediaId);
        if (m?.kind === "image") assets.image(m, "proxy"); // warm the image cache
      }
    }
  }
  for (const [k, v] of videos) if (!active.has(k)) { v.pause(); v.removeAttribute("src"); v.load(); videos.delete(k); }

  // music
  const s = p.settings, cf = Math.max(0.01, s.musicCrossfade), fo = Math.max(s.musicFadeOut, s.endFade, 0.1);
  for (const it of sched.items) {
    const local = t - it.start;
    const on = local >= 0 && local < it.len;
    let a = audios.get(it.track.id);
    if (!on) { if (a && !a.paused) a.pause(); continue; }
    if (!a) { a = new Audio(assets.audioSrc(it.media)); a.preload = "auto"; audios.set(it.track.id, a); }
    let g = s.musicVolume * it.track.volume;
    if (!it.first) g *= Math.min(1, local / cf);
    if (!it.last) g *= Math.min(1, (it.len - local) / cf);
    if (t > tl.total - fo) g *= Math.max(0, (tl.total - t) / fo);
    g *= envAt(t);
    a.volume = Math.max(0, Math.min(1, g));
    const want = it.track.trimStart + local;
    if (a.paused) { a.currentTime = want; a.play().catch(() => {}); }
    else if (Math.abs(a.currentTime - want) > 0.3) a.currentTime = want;
  }

  const c = stageCanvas();
  const ctx = c.getContext("2d");
  const videoFor = (slide, tile) => videos.get(videoKey(slide, tile));
  drawFrame(ctx, p, tl, t, c.width, c.height, app.mediaById, videoFor, "play");
  if (spec && spec.b !== tick._last) { tick._last = spec.b; emit("playhead", spec.b); }
  scrub.value = t;
  timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(tl.total)}`;
  raf = requestAnimationFrame(tick);
}

/** Render a still of the show at time t (used while scrubbing). */
function previewStill(t) {
  tl = computeTimeline(app.project);
  const c = stageCanvas();
  drawFrame(c.getContext("2d"), app.project, tl, t, c.width, c.height, app.mediaById, null, "play");
  timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(tl.total)}`;
  const spec = frameAt(app.project, tl, t);
  if (spec) emit("playhead", spec.b);
  clearTimeout(previewStill._t);
  previewStill._t = setTimeout(() => {
    if (app.playing || !spec) return;
    const id = app.project.slides[spec.b].id;
    if (app.sel.current !== id) { app.sel.slides = new Set([id]); app.sel.current = id; app.sel.tile = app.sel.text = null; emit("select"); app.playhead = t; syncUi(); }
  }, 600);
}
