// Music tab: soundtrack playlist + audio settings.
import { h, toast, slider, timeInput } from "./ui.js";
import { app, change, addMediaItems, beginGesture, gestureUpdate, endGesture, currentIndex } from "./state.js";
import { api } from "./backend.js";
import { assets } from "./assets.js";
import { uid, fmtTime, computeTimeline, musicSchedule, slideKind } from "./model.js";

let previewAudio = null;

export async function addMusicFiles(paths) {
  if (!paths?.length) return;
  const res = await api.importFiles(paths);
  const items = await addMediaItems(res.items.filter((m) => m.kind === "audio"));
  if (!items.length) { toast("No music files found", "warn"); return; }
  change((p) => { for (const m of items) p.music.push({ id: uid("a"), mediaId: m.id, trimStart: 0, trimEnd: null, volume: 1, delay: 0 }); });
  toast(`Added ${items.length} song(s)`, "ok");
}

/** Scale photo slide durations so the show length matches `target` seconds. */
export function fitShowTo(p, target) {
  const mb = app.mediaById;
  const flexible = p.slides.filter((s) => !slideKind(p, s, mb).hasVideo);
  if (!flexible.length) return false;
  for (let it = 0; it < 8; it++) {
    const tl = computeTimeline(p);
    const flexSum = flexible.reduce((a, s) => a + s.duration, 0);
    const rest = tl.total - flexSum;
    const f = (target - rest) / flexSum;
    if (!isFinite(f) || f <= 0) return false;
    for (const s of flexible) s.duration = Math.min(20, Math.max(1.5, Math.round(s.duration * f * 100) / 100));
    if (Math.abs(computeTimeline(p).total - target) < 0.05) break;
  }
  return true;
}

export function renderMusicPanel(body) {
  const p = app.project, s = p.settings;
  const sched = musicSchedule(p, app.mediaById);
  const showLen = computeTimeline(p).total;
  const list = h("div", { class: "music-list" });
  p.music.forEach((t, i) => {
    const m = app.mediaById.get(t.mediaId);
    if (!m) return;
    const it = sched.items.find((x) => x.track === t);
    const len = Math.max(0, Math.min(t.trimEnd ?? m.duration, m.duration) - t.trimStart);

    const move = (d) => change((p) => { const a = p.music; const [x] = a.splice(i, 1); a.splice(Math.max(0, Math.min(a.length, i + d)), 0, x); });
    list.append(h("div", { class: "music-card" },
      h("div", { class: "music-head" },
        h("span", { class: "music-num" }, i + 1),
        h("span", { class: "music-name", title: m.path }, m.name.replace(/\.[^.]+$/, "")),
        h("span", { class: "muted" }, fmtTime(len)),
        h("button", { class: "icon-btn", title: "Move up", disabled: i === 0, onclick: () => move(-1) }, "↑"),
        h("button", { class: "icon-btn", title: "Move down", disabled: i === p.music.length - 1, onclick: () => move(1) }, "↓"),
        h("button", { class: "icon-btn danger", title: "Remove from show", onclick: () => change((p) => p.music.splice(i, 1)) }, "✕")),
      h("div", { class: "music-grid" },
        h("span", { class: "muted" }, "Skip the first"),
        timeInput({ value: t.trimStart, max: Math.max(0, m.duration - 1), title: "Start the song this far in (skip its intro). Type seconds or m:ss", onset: (v) => change(() => { t.trimStart = Math.min(v, (t.trimEnd ?? m.duration) - 1); }) }),
        h("button", { class: "icon-btn", title: "Listen from here", onclick: (e) => togglePreview(m, t, e.currentTarget) }, "▶"),
        h("span", { class: "muted" }, "Stop the song at"),
        timeInput({ value: t.trimEnd, allowEmpty: true, placeholder: "the end", max: m.duration, title: "Leave empty to play to the end", onset: (v) => change(() => { t.trimEnd = v === null || v >= m.duration - 0.05 ? null : Math.max(t.trimStart + 1, v); }) }),
        h("span", {}),
        h("span", { class: "muted" }, "Starts in the show at"),
        timeInput({ value: it ? it.start : 0, title: "When this song begins, measured from the start of the show", onset: (v) => change(() => { t.delay = Math.max(0, Math.round((v - (it ? it.base : 0)) * 10) / 10); }) }),
        h("button", { class: "icon-btn", title: "Start this song when the selected slide starts", onclick: () => {
          const idx = currentIndex();
          if (idx < 0) return toast("Select a slide in the storyboard first", "warn");
          const at = computeTimeline(p).starts[idx];
          change(() => { t.delay = Math.max(0, Math.round((at - (it ? it.base : 0)) * 10) / 10); });
          toast(`Song ${i + 1} now starts with slide ${idx + 1} (${fmtTime(at)})`, "ok");
        } }, "⇤")),
      t.delay > 0 ? h("div", { class: "muted small" }, i === 0 ? `Silent for the first ${t.delay}s of the show (videos' own sound still plays).` : `${t.delay}s gap after the previous song.`,
        " ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); change(() => { t.delay = 0; }); } }, "Remove")) : null,
      slider({ label: "Volume", min: 0, max: 1.5, step: 0.05, value: t.volume, fmt: (v) => `${Math.round(v * 100)}%`,
        oninput: (v) => { beginGesture(); t.volume = v; gestureUpdate(); }, onchange: () => endGesture() })));
  });
  if (!p.music.length) list.append(h("div", { class: "empty small" }, h("div", { class: "big" }, "🎵"), h("p", {}, "No music yet. Add one or more songs; they play one after another with a smooth crossfade.")));

  const diff = sched.total - showLen;
  let status = null;
  if (p.music.length && p.slides.length) {
    if (Math.abs(diff) < 1.5) status = h("div", { class: "note ok" }, "✓ The show and the music finish together.");
    else if (diff > 0) status = h("div", { class: "note" }, `Music is ${fmtTime(diff)} longer than the show; it will fade out when the show ends.`);
    else status = h("div", { class: "note warn" }, `The show is ${fmtTime(-diff)} longer than the music, so the end will be silent. Add another song or use "Fit show to music".`);
  }
  body.append(
    h("div", { class: "lib-tools" },
      h("button", { class: "btn primary", onclick: async () => addMusicFiles(await api.pickFiles("audio")) }, "＋ Add music")),
    list,
    h("div", { class: "music-summary" },
      h("div", { class: "kv" }, h("span", {}, "Music ends at"), h("b", {}, fmtTime(sched.total))),
      h("div", { class: "kv" }, h("span", {}, "Show length"), h("b", {}, fmtTime(showLen))),
      status,
      h("button", { class: "btn", disabled: !p.music.length || !p.slides.length, onclick: () => {
        let ok = false;
        change((p) => { ok = fitShowTo(p, sched.total); });
        toast(ok ? `Photo slide timings adjusted so the show runs ${fmtTime(sched.total)}` : "Couldn't fit — try removing some videos", ok ? "ok" : "warn");
      } }, "⇔ Fit show to music")),
    h("h3", { class: "section" }, "Sound settings"),
    h("div", { class: "props-group" },
      slider({ label: "Music volume", min: 0, max: 1.5, step: 0.05, value: s.musicVolume, fmt: (v) => `${Math.round(v * 100)}%`, oninput: (v) => { beginGesture(); s.musicVolume = v; gestureUpdate(); }, onchange: endGesture }),
      slider({ label: "Song crossfade", min: 0, max: 6, step: 0.5, value: s.musicCrossfade, fmt: (v) => `${v}s`, oninput: (v) => { beginGesture(); s.musicCrossfade = v; gestureUpdate(); }, onchange: endGesture }),
      h("label", { class: "row check" }, h("input", { type: "checkbox", checked: s.autoDuck, onchange: (e) => change(() => { s.autoDuck = e.target.checked; }) }), "Lower the music when a video's sound is playing"),
      slider({ label: "Lower music to", min: 0, max: 0.8, step: 0.05, value: s.duckLevel, fmt: (v) => `${Math.round(v * 100)}%`, oninput: (v) => { beginGesture(); s.duckLevel = v; gestureUpdate(); }, onchange: endGesture }),
      slider({ label: "Fade out at end", min: 0, max: 8, step: 0.5, value: s.endFade, fmt: (v) => `${v}s`, oninput: (v) => { beginGesture(); s.endFade = v; gestureUpdate(); }, onchange: endGesture }),
      h("p", { class: "muted small" }, "You can also lower the music for a single slide in its settings (right panel)."))
  );
}

function togglePreview(m, t, btn) {
  if (previewAudio) {
    previewAudio.pause();
    const was = previewAudio._id;
    previewAudio = null;
    document.querySelectorAll(".music-card .icon-btn.playing").forEach((b) => { b.classList.remove("playing"); b.textContent = "▶"; });
    if (was === t.id) return;
  }
  const a = new Audio(assets.audioSrc(m));
  a._id = t.id;
  a.currentTime = t.trimStart;
  a.volume = Math.min(1, t.volume * app.project.settings.musicVolume);
  a.play().catch(() => toast("Can't play this file in preview (it will still export)", "warn"));
  previewAudio = a;
  btn.classList.add("playing");
  btn.textContent = "■";
}
