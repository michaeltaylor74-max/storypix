// Export dialog: rasterises text layers, then hands the project to the Rust renderer.
import { h, modal, toast, confirmBox } from "./ui.js";
import { app, netHosts } from "./state.js";
import { api, listen } from "./backend.js";
import { computeTimeline, fmtTime, slideKind, musicSchedule } from "./model.js";
import { drawTexts } from "./render.js";

let handlers = null;
let listening = false;
function ensureListeners() {
  if (listening) return;
  listening = true;
  listen("export-progress", (p) => handlers?.progress(p));
  listen("export-done", (path) => handlers?.done(path));
  listen("export-error", (msg) => handlers?.error(msg));
}

const RES = [
  { id: "1280x720", label: "720p HD (1280×720) — smaller file" },
  { id: "1920x1080", label: "1080p Full HD (1920×1080) — recommended" },
  { id: "2560x1440", label: "1440p (2560×1440)" },
  { id: "3840x2160", label: "4K (3840×2160) — slow" },
];
const QUAL = [
  { id: "good", label: "Good (faster)", crf: 21, preset: "fast" },
  { id: "high", label: "High (recommended)", crf: 18, preset: "medium" },
  { id: "best", label: "Best (slowest, biggest)", crf: 16, preset: "slow" },
];
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export async function openExport() {
  ensureListeners();
  const p = app.project;
  if (!p.slides.length) return toast("Add some slides first", "warn");
  const tl = computeTimeline(p);
  const empties = p.slides.reduce((a, s) => a + slideKind(p, s, app.mediaById).empty, 0);
  const missing = p.media.filter((m) => m.missing).length;
  const sched = musicSchedule(p, app.mediaById);

  const safeName = (p.name || "slideshow").replace(/[\\/:*?"<>|]+/g, "").trim() || "slideshow";
  const pathInp = h("input", { type: "text", class: "grow", placeholder: "Choose where to save…", value: lsGet("ps.lastExport", "") ? lsGet("ps.lastExport", "").replace(/[^\\/]+$/, `${safeName}.mp4`) : "" });
  const choose = h("button", { class: "btn", onclick: async () => { const f = await api.pickSave("video", `${safeName}.mp4`); if (f) pathInp.value = /\.mp4$/i.test(f) ? f : f + ".mp4"; } }, "Choose…");
  const res = h("select", {}, RES.map((r) => h("option", { value: r.id, selected: r.id === lsGet("ps.res", "1920x1080") }, r.label)));
  const fps = h("select", {}, [25, 30, 60].map((f) => h("option", { value: f, selected: String(f) === lsGet("ps.fps", "30") }, `${f} frames/sec${f === 30 ? " (recommended)" : ""}`)));
  const qual = h("select", {}, QUAL.map((q) => h("option", { value: q.id, selected: q.id === lsGet("ps.q", "high") }, q.label)));
  const notes = [];
  if (empties) notes.push(h("div", { class: "note warn" }, `⚠ ${empties} photo box(es) are empty and will show only the background.`));
  if (missing) notes.push(h("div", { class: "note warn" }, `⚠ ${missing} file(s) are missing and will be blank.`));
  if (!p.music.length) notes.push(h("div", { class: "note" }, "No music has been added — the video will only have sound from clips."));
  else if (sched.total < tl.total - 2) notes.push(h("div", { class: "note warn" }, `The music ends ${fmtTime(tl.total - sched.total)} before the show does.`));

  const go = await modal({
    title: "Export video",
    body: h("div", { class: "form" },
      h("div", { class: "row" }, h("span", { class: "lbl" }, "Save as"), pathInp, choose),
      h("label", { class: "row" }, h("span", { class: "lbl" }, "Size"), res),
      h("label", { class: "row" }, h("span", { class: "lbl" }, "Frame rate"), fps),
      h("label", { class: "row" }, h("span", { class: "lbl" }, "Quality"), qual),
      h("div", { class: "kv" }, h("span", {}, "Length"), h("b", {}, fmtTime(tl.total))),
      h("p", { class: "muted small" }, "Creates a standard MP4 (H.264 + AAC) that plays on any TV, projector, laptop or YouTube."),
      notes),
    buttons: [{ label: "Cancel", value: null }, {
      label: "Export", primary: true,
      validate: async () => {
        if (!pathInp.value.trim()) {
          const f = await api.pickSave("video", `${safeName}.mp4`);
          if (!f) return false;
          pathInp.value = /\.mp4$/i.test(f) ? f : f + ".mp4";
        }
        const [exists] = await api.pathsExist([pathInp.value.trim()], true).catch(() => [false]);
        if (exists) {
          const ok = await confirmBox("Replace video?", `${pathInp.value.trim().split(/[\\/]/).pop()} already exists. Replace it with this export?`, "Replace");
          if (!ok) return false;
        }
        return true;
      },
      value: () => ({ path: pathInp.value.trim(), res: res.value, fps: +fps.value, q: qual.value }),
    }],
  });
  if (!go) return;
  lsSet("ps.lastExport", go.path); lsSet("ps.res", go.res); lsSet("ps.fps", String(go.fps)); lsSet("ps.q", go.q);
  const [w, hgt] = go.res.split("x").map(Number);
  const q = QUAL.find((x) => x.id === go.q);
  await runExport({ path: /\.mp4$/i.test(go.path) ? go.path : go.path + ".mp4", w, h: hgt, fps: go.fps, crf: q.crf, preset: q.preset });
}

async function runExport({ path, w, h: hh, fps, crf, preset }) {
  const project = JSON.parse(JSON.stringify(app.project));
  const bar = h("div", { class: "bar-fill" });
  const phase = h("div", { class: "phase" }, "Preparing text…");
  const eta = h("div", { class: "muted small" }, "");
  const actions = h("div", { class: "btn-row right" });
  let cancelBtn;
  const body = h("div", { class: "export-progress" }, phase, h("div", { class: "bar" }, bar), eta, actions);
  let closeFn;
  const started = Date.now();
  const done = modal({ title: "Exporting…", body, buttons: [], closable: false, onMount: (_, close) => { closeFn = close; } });
  cancelBtn = h("button", { class: "btn danger", onclick: () => { api.cancelExport(); cancelBtn.disabled = true; phase.textContent = "Cancelling…"; } }, "Cancel");
  actions.append(cancelBtn);

  // 1. text overlays
  const overlays = {};
  try {
    const c = document.createElement("canvas");
    c.width = w; c.height = hh;
    const ctx = c.getContext("2d");
    const withText = project.slides.filter((s) => s.texts.some((t) => t.text));
    for (let i = 0; i < withText.length; i++) {
      const s = withText[i];
      ctx.clearRect(0, 0, w, hh);
      drawTexts(ctx, s.texts, w, hh, 1, 0);
      const b64 = c.toDataURL("image/png").split(",")[1];
      overlays[s.id] = await api.saveOverlay(`ov_${i}_${s.id}`, b64);
      bar.style.width = `${(i / Math.max(1, withText.length)) * 2}%`;
    }
  } catch (e) {
    closeFn(); toast(`Couldn't prepare text: ${e}`, "error", 8000); return;
  }

  const finished = new Promise((resolve) => {
    handlers = {
      progress: (p) => {
        bar.style.width = `${Math.max(2, p.frac * 100).toFixed(1)}%`;
        phase.textContent = p.phase === "Rendering video" ? `Rendering video — ${Math.round(p.frac * 100)}%` : p.phase;
        if (p.eta > 0) eta.textContent = `Frame ${p.frame} of ${p.frames} · about ${fmtTime(p.eta)} left`;
      },
      done: (out) => resolve({ ok: true, out }),
      error: (msg) => resolve({ ok: false, msg }),
    };
  });
  try {
    const allowNetwork = !!app.networkAllowed || project.media.every((m) => netHosts.trusted(m.path));
    await api.startExport({ project, overlays, outPath: path, width: w, height: hh, fps, crf, preset, allowNetwork });
  } catch (e) {
    closeFn(); toast(`Export failed to start: ${e}`, "error", 8000); return;
  }
  const r = await finished;
  handlers = null;
  closeFn();
  if (r.ok) {
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    await modal({
      title: "✓ Video ready",
      body: h("div", {}, h("p", {}, `Saved to:`), h("p", { class: "path" }, path), h("p", { class: "muted small" }, `Took ${mins} minutes.`)),
      buttons: [
        { label: "Show in folder", value: () => api.reveal(path) },
        { label: "Play it", value: () => api.openPath(path) },
        { label: "Close", value: null, primary: true },
      ],
    });
  } else if (/cancel/i.test(r.msg)) toast("Export cancelled", "info");
  else await modal({ title: "Export failed", body: h("div", {}, h("p", {}, "Something went wrong while making the video:"), h("pre", { class: "err" }, r.msg)), buttons: [{ label: "Close", value: null, primary: true }] });
}
