// ✨ Auto Build wizard: turns a folder (with optional sub-folders) into a full show.
import { h, modal, toast, confirmBox } from "./ui.js";
import { app, change, addMediaItems, applyStylePreset, emit } from "./state.js";
import { api } from "./backend.js";
import { uid, newSlide, newTitleSlide, layoutById, fmtTime, TRANSITION_SETS, STYLE_PRESETS, computeTimeline } from "./model.js";
import { bestLayout } from "./layoutfit.js";
import { fitShowTo } from "./music.js";

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const MIX = {
  singles: { label: "Mostly one photo per slide", pref: 1.25, max: 2 },
  balanced: { label: "Balanced mix (1–4 per slide)", pref: 2.2, max: 4 },
  collage: { label: "Lots of collages (3–6 per slide)", pref: 3.6, max: 6 },
};
const TR_LEN = { gentle: 1.2, mixed: 1.0, energetic: 0.7 };
const TITLE_COLORS = [["#1d2b53", "#7e2553"], ["#0f3d3e", "#1b6b5f"], ["#3b1f5e", "#b0306a"], ["#16324f", "#2a6f97"], ["#4a1c1c", "#a8461f"], ["#1f2d1f", "#567d46"]];

let W = null; // wizard state survives between openings in one session

function initState() {
  const year = new Date().getFullYear();
  return {
    source: "folder", folder: null, groups: [], probing: false,
    songs: app.project.music.map((t) => app.mediaById.get(t.mediaId)).filter(Boolean),
    lengthMode: "music", customMin: 5,
    secPerSlide: 4.5, mix: "balanced", maxClip: 10, videoSound: false,
    transitions: "mixed", kenBurns: true, style: "frame", skipDupes: true,
    order: "date", sectionTitles: true,
    openTitle: `Our Year ${year}`, openSub: "", closeTitle: "Thanks for an amazing year!",
    overflow: "pick", underflow: "longer", mode: "replace", seed: 12345,
  };
}

export async function openAutoBuild() {
  if (!W) W = initState();
  if (!W.songs.length) W.songs = app.project.music.map((t) => app.mediaById.get(t.mediaId)).filter(Boolean);
  const left = h("div", { class: "ab-left" });
  const right = h("div", { class: "ab-right" });
  const rerender = () => { renderLeft(left, rerender); renderSummary(right, rerender); };
  rerender();
  const result = await modal({
    title: "✨ Auto Build a show",
    wide: "xl",
    body: h("div", { class: "ab" }, left, right),
    buttons: [
      { label: "Cancel", value: null },
      { label: "Build my show", primary: true, value: () => "build", validate: async () => {
        if (W.probing) { toast("Still reading the photos — one moment", "warn"); return false; }
        if (!gatherSections().some((s) => s.items.length)) { toast("Choose some photos first", "warn"); return false; }
        return true;
      } },
    ],
  });
  if (result === "build") await commit();
}

// ---------------- data gathering
function libraryGroups() {
  const items = (app.libSel.size ? app.project.media.filter((m) => app.libSel.has(m.id)) : app.project.media).filter((m) => m.kind !== "audio");
  const by = new Map();
  for (const m of items) { const k = m.folder || ""; if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([k, items]) => ({ key: k, name: k || "Photos", include: true, items, photos: items.filter((m) => m.kind === "image").length, videos: items.filter((m) => m.kind === "video").length }));
}

async function chooseFolder(rerender) {
  const f = await api.pickFolder();
  if (!f) return;
  W.folder = f;
  W.source = "folder";
  W.probing = true;
  W.groups = [];
  rerender();
  try {
    const groups = (await api.listFolder(f)).filter((g) => g.photos + g.videos > 0);
    const base = f.split(/[\\/]/).filter(Boolean).pop();
    W.groups = groups.map((g) => ({ key: g.rel, name: g.rel || base, include: true, items: [], files: g.files.filter((x) => !/\.(mp3|wav|m4a|aac|flac|ogg|wma|aiff?|opus)$/i.test(x)), photos: g.photos, videos: g.videos }));
    // the root folder's own files go first
    W.groups.sort((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : a.key.localeCompare(b.key, undefined, { numeric: true })));
    rerender();
    const files = W.groups.flatMap((g) => g.files);
    const tags = W.groups.flatMap((g) => g.files.map(() => g.key));
    const res = await api.importFiles(files, tags);
    const byTag = new Map(W.groups.map((g) => [g.key, g]));
    for (const it of res.items) { it.id = uid("tmp"); byTag.get(it.folder)?.items.push(it); }
    for (const g of W.groups) { g.photos = g.items.filter((m) => m.kind === "image").length; g.videos = g.items.filter((m) => m.kind === "video").length; }
    if (res.failed.length) toast(`${res.failed.length} file(s) couldn't be read and were skipped`, "warn");
  } catch (e) {
    toast(`Couldn't read folder: ${e}`, "error");
  }
  W.probing = false;
  rerender();
}

function gatherSections() {
  const groups = W.source === "library" ? (W.libGroups ||= libraryGroups()) : W.groups;
  return groups.filter((g) => g.include).map((g) => {
    let items = g.items.slice();
    if (W.order === "date") items.sort((a, b) => (a.date || 0) - (b.date || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    else items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    let dupes = 0;
    if (W.skipDupes && W.order === "date") {
      const out = [];
      let last = null;
      for (const m of items) {
        if (m.kind === "image" && last && m.date && last.date && Math.abs(m.date - last.date) < 2000) { dupes++; continue; }
        out.push(m);
        if (m.kind === "image") last = m;
      }
      items = out;
    }
    return { name: g.name, items, dupes };
  });
}

function musicTotal() {
  const cf = app.project.settings.musicCrossfade;
  const lens = W.songs.map((m) => m.duration || 0).filter((d) => d > 0);
  return lens.reduce((a, b) => a + b, 0) - Math.max(0, lens.length - 1) * cf;
}

// ---------------- the planner
function plan() {
  const sections = gatherSections();
  const rng = mulberry32(W.seed);
  const d = W.secPerSlide, tr = TR_LEN[W.transitions], titleDur = 4;
  const mix = MIX[W.mix];
  const multi = sections.length > 1;
  const P = sections.reduce((a, s) => a + s.items.filter((m) => m.kind === "image").length, 0);
  const vids = sections.flatMap((s) => s.items.filter((m) => m.kind === "video"));
  const clip = (v) => Math.max(1, Math.min(v.duration || 1, W.maxClip));
  const Tv = vids.reduce((a, v) => a + clip(v), 0);
  const mt = musicTotal();
  const useMusic = W.lengthMode === "music" && mt > 5;
  const T = useMusic ? mt : W.customMin * 60;
  const numTitle = (W.openTitle ? 1 : 0) + (W.closeTitle ? 1 : 0) + (multi && W.sectionTitles ? sections.length : 0);
  const fixedSlides = numTitle + vids.length;
  const fixedTime = numTitle * titleDur + Tv;
  const avail = T - fixedTime + Math.max(0, fixedSlides - 1) * tr;
  const denom = 0.88 * d - tr;
  const sFor = (n) => (avail - 0.12 * d * n) / denom; // photo slides that fit n photos in avail time
  let S = P ? sFor(P) : 0;
  let keep = P, situation = "ok", fit = true;
  const k0 = S > 0 ? P / S : Infinity;
  const minK = { singles: 1, balanced: 1.6, collage: 3 }[W.mix];
  const maxSlideDur = Math.max(d * 1.9, 9);
  if (P && (avail <= d || S < 1 || k0 > mix.max)) {
    situation = avail <= d ? "videos" : "many";
    if (W.overflow === "pick" && avail > d) {
      keep = Math.min(P, Math.max(1, Math.floor((mix.pref * avail) / (denom + mix.pref * 0.12 * d))));
      S = Math.max(1, Math.round(keep / mix.pref));
    } else if (W.overflow === "faster" && avail > d) {
      S = Math.max(Math.ceil(P / 9), Math.round(Math.max(1, sFor(P))));
    } else {
      S = Math.ceil(P / mix.pref);
      fit = false;
    }
  } else if (P) {
    // enough time: honour the preferred photos-per-slide, but don't let slides drag on
    let k = Math.max(k0, minK);
    S = Math.max(1, Math.round(P / k));
    const longest = Math.max(1, Math.ceil(avail / (maxSlideDur - tr)));
    if (S < longest) S = Math.min(P, longest);
    if (k0 < 1) {
      situation = "few";
      if (W.underflow === "shorter") { fit = false; S = Math.max(1, Math.round(P / Math.max(1, minK))); }
    }
  }
  S = Math.min(S, keep);

  // choose which photos to keep (evenly spread within each section)
  const photoCount = sections.map((s) => s.items.filter((m) => m.kind === "image").length);
  const quotas = photoCount.map((n) => (P ? Math.round((keep * n) / P) : 0));
  const secs = sections.map((s, si) => {
    const photos = s.items.filter((m) => m.kind === "image");
    const q = Math.min(photos.length, quotas[si]);
    const chosen = new Set();
    for (let i = 0; i < q; i++) chosen.add(photos[Math.floor(((i + 0.5) * photos.length) / q)]);
    return { ...s, items: s.items.map((m, ord) => ({ m, ord })).filter((x) => x.m.kind === "video" || chosen.has(x.m)) };
  });
  const keptP = secs.reduce((a, s) => a + s.items.filter((x) => x.m.kind === "image").length, 0);

  // build slides
  const slides = [];
  const transSet = TRANSITION_SETS[W.transitions];
  let lastTr = null;
  const pickTr = () => {
    let t;
    for (let i = 0; i < 4; i++) { t = transSet[Math.floor(rng() * transSet.length)]; if (t !== lastTr || transSet.length === 1) break; }
    lastTr = t;
    return t;
  };
  const defaults = { duration: d, transition: "crossfade", transitionDuration: tr };
  let colorI = 0;
  const title = (text, sub = "") => {
    const s = newTitleSlide(text, sub, defaults);
    const [c1, c2] = TITLE_COLORS[colorI++ % TITLE_COLORS.length];
    s.background = { kind: "gradient", color: c1, color2: c2 };
    s.transition = { kind: "fadeBlack", duration: tr };
    s.duration = titleDur;
    return s;
  };
  if (W.openTitle) slides.push(title(W.openTitle, W.openSub));
  let prevLayout = null;
  secs.forEach((sec) => {
    const photos = sec.items.filter((x) => x.m.kind === "image");
    if (multi && W.sectionTitles && sec.items.length) slides.push(title(sec.name));
    const m = photos.length ? Math.max(1, Math.min(photos.length, Math.round((S * photos.length) / Math.max(1, keptP)))) : 0;
    // group sizes
    const sizes = [];
    let rem = photos.length;
    for (let i = 0; i < m; i++) {
      const left = m - i, ideal = rem / left;
      let v = Math.round(ideal + (rng() - 0.5) * (W.mix === "singles" ? 0.8 : 1.6));
      v = Math.max(1, Math.min(9, v, rem - (left - 1)));
      if (rem - v > 9 * (left - 1)) v = rem - 9 * (left - 1);
      sizes.push(v);
      rem -= v;
    }
    const chunks = [];
    let pi = 0;
    for (const n of sizes) { const c = photos.slice(pi, pi + n); pi += n; chunks.push({ ord: c[0].ord, photos: c.map((x) => x.m) }); }
    const units = [...chunks, ...sec.items.filter((x) => x.m.kind === "video").map((x) => ({ ord: x.ord, video: x.m }))].sort((a, b) => a.ord - b.ord);
    let firstInSection = true;
    for (const u of units) {
      let s;
      if (u.video) {
        const v = u.video;
        s = newSlide("full", defaults);
        const t = s.tiles[0];
        t.mediaId = v.id;
        t.fit = v.width < v.height ? "fit" : "fill";
        t.muted = !W.videoSound;
        t.trimStart = 0;
        t.trimEnd = v.duration > W.maxClip ? W.maxClip : null;
        s.duration = Math.round(clip(v) * 10) / 10;
        s.transition = { kind: "crossfade", duration: Math.min(tr, 0.8) };
      } else {
        const { layout, order } = bestLayout(u.photos, prevLayout, rng);
        prevLayout = layout.id;
        s = newSlide(layout.id, defaults);
        s.tiles.forEach((t, i) => {
          const pm = u.photos[order[i]];
          t.mediaId = pm.id;
          if (u.photos.length === 1 && pm.width < pm.height * 1.15) t.fit = "fit";
          if (W.kenBurns) {
            if (u.photos.length === 1) {
              const opts = t.fit === "fit" ? ["zoomIn", "zoomOut"] : ["zoomIn", "zoomOut", "panLeft", "panRight", "zoomIn"];
              t.motion = opts[Math.floor(rng() * opts.length)];
              t.motionAmount = Math.round((0.12 + rng() * 0.08) * 100) / 100;
            } else {
              t.motion = i % 2 ? "zoomOut" : "zoomIn";
              t.motionAmount = 0.08;
            }
          }
        });
        if (u.photos.length > 1 && W.style !== "clean") applyStylePreset(s, W.style);
        s.duration = Math.round(d * (1 + 0.12 * (u.photos.length - 1)) * 10) / 10;
        s.transition = { kind: pickTr(), duration: tr };
      }
      if (firstInSection && multi && !W.sectionTitles) s.transition = { kind: "fadeBlack", duration: tr };
      firstInSection = false;
      slides.push(s);
    }
  });
  if (W.closeTitle) slides.push(title(W.closeTitle));
  if (slides.length) slides[0].transition = { kind: "fadeBlack", duration: Math.min(1.5, tr * 1.5) };

  // fit timings to the target length
  const fake = { slides, settings: app.project.settings, media: [] };
  const mb = new Map(sections.flatMap((s) => s.items).map((m) => [m.id, m]));
  if (fit && T > 0 && keptP) {
    const flexible = slides.filter((s) => s.tiles.length && !s.tiles.some((t) => mb.get(t.mediaId)?.kind === "video"));
    for (let it = 0; it < 8; it++) {
      const tl = computeTimeline(fake);
      const flexSum = flexible.reduce((a, s) => a + s.duration, 0);
      const f = (T - (tl.total - flexSum)) / flexSum;
      if (!isFinite(f) || f <= 0) break;
      for (const s of flexible) s.duration = Math.min(20, Math.max(1.5, Math.round(s.duration * f * 100) / 100));
      if (Math.abs(computeTimeline(fake).total - T) < 0.1) break;
    }
  }
  const total = computeTimeline(fake).total;
  const photoSlides = slides.filter((s) => s.tiles.length && !s.tiles.some((t) => mb.get(t.mediaId)?.kind === "video"));
  const perPhoto = photoSlides.length ? photoSlides.reduce((a, s) => a + s.duration / s.tiles.length, 0) / photoSlides.length : 0;
  const avgPer = photoSlides.length ? keptP / photoSlides.length : 0;
  const avgDur = photoSlides.length ? photoSlides.reduce((a, s) => a + s.duration, 0) / photoSlides.length : 0;
  return {
    slides, total, T, useMusic, P, keptP, V: vids.length, Tv, perPhoto, avgPer, avgDur, situation, numTitle,
    dupes: sections.reduce((a, s) => a + s.dupes, 0), photoSlides: photoSlides.length,
    sections, mb,
  };
}

// ---------------- UI
function renderLeft(el, rr) {
  const set = (k, v, full = true) => { W[k] = v; full ? rr() : null; };
  const radio = (name, val, label, extra) => h("label", { class: "radio" }, h("input", { type: "radio", name, checked: W[name] === val, onchange: () => set(name, val) }), label, extra || null);
  const num = (k, min, max, step, suffix) => h("span", { class: "numwrap" }, h("input", { type: "number", min, max, step, value: W[k], onchange: (e) => set(k, Math.min(max, Math.max(min, +e.target.value || min))) }), suffix);

  const groups = W.source === "library" ? (W.libGroups ||= libraryGroups()) : W.groups;
  const groupList = h("div", { class: "ab-groups" });
  if (W.source === "folder" && !W.folder) groupList.append(h("p", { class: "muted" }, "No folder chosen yet."));
  groups.forEach((g, i) => {
    const mv = (d) => { const a = groups; const [x] = a.splice(i, 1); a.splice(Math.max(0, Math.min(a.length, i + d)), 0, x); rr(); };
    groupList.append(h("div", { class: `ab-group ${g.include ? "" : "off"}` },
      h("input", { type: "checkbox", checked: g.include, title: "Include this folder", onchange: (e) => { g.include = e.target.checked; rr(); } }),
      h("span", { class: "ab-order" }, i + 1),
      h("input", { type: "text", class: "grow", value: g.name, title: "Section title shown in the show", onchange: (e) => { g.name = e.target.value; rr(); } }),
      h("span", { class: "muted small nowrap" }, `📷 ${g.photos}  🎬 ${g.videos}`),
      h("button", { class: "icon-btn", disabled: i === 0, title: "Earlier in the show", onclick: () => mv(-1) }, "↑"),
      h("button", { class: "icon-btn", disabled: i === groups.length - 1, title: "Later in the show", onclick: () => mv(1) }, "↓")));
  });

  const songs = h("div", { class: "ab-songs" });
  W.songs.forEach((m, i) => songs.append(h("div", { class: "ab-song" }, h("span", { class: "grow" }, `🎵 ${m.name}`), h("span", { class: "muted" }, fmtTime(m.duration)),
    h("button", { class: "icon-btn", disabled: i === 0, onclick: () => { const [x] = W.songs.splice(i, 1); W.songs.splice(i - 1, 0, x); rr(); } }, "↑"),
    h("button", { class: "icon-btn danger", onclick: () => { W.songs.splice(i, 1); rr(); } }, "✕"))));
  if (!W.songs.length) songs.append(h("p", { class: "muted small" }, "No songs yet."));

  el.replaceChildren(...[
    h("h3", { class: "step" }, h("span", {}, "1"), "Photos & videos"),
    h("div", { class: "row wrap" },
      radio("source", "folder", "From a folder", null),
      radio("source", "library", app.libSel.size ? `The ${app.libSel.size} items selected in my library` : "Everything in my library")),
    W.source === "folder" ? h("div", { class: "row" },
      h("button", { class: "btn primary", onclick: () => chooseFolder(rr) }, W.folder ? "Choose a different folder…" : "Choose folder…"),
      h("span", { class: "muted small path grow" }, W.folder || "")) : null,
    W.probing ? h("div", { class: "busy inline" }, h("span", { class: "spinner" }), "Reading photo dates and video lengths…") : null,
    groups.length > 1 ? h("p", { class: "muted small" }, "Sub-folders become sections of the show. Untick to leave one out, use the arrows to set the order, and rename the titles if you like.") : null,
    groupList,
    groups.length > 1 ? h("label", { class: "row check" }, h("input", { type: "checkbox", checked: W.sectionTitles, onchange: (e) => set("sectionTitles", e.target.checked) }), "Show a title slide at the start of each section") : null,
    h("div", { class: "row wrap" },
      h("span", { class: "lbl" }, "Order photos by"), radio("order", "date", "Date taken"), radio("order", "name", "File name")),
    h("label", { class: "row check" }, h("input", { type: "checkbox", checked: W.skipDupes, onchange: (e) => set("skipDupes", e.target.checked) }), "Skip near-duplicates (burst shots taken within 2 seconds)"),

    h("h3", { class: "step" }, h("span", {}, "2"), "Music & length"),
    songs,
    h("button", { class: "btn small", onclick: async () => {
      const files = await api.pickFiles("audio");
      if (!files.length) return;
      const res = await api.importFiles(files);
      W.songs.push(...res.items.filter((m) => m.kind === "audio").map((m) => ({ ...m, id: m.id || uid("tmp") })));
      rr();
    } }, "＋ Add songs"),
    h("div", { class: "row wrap" },
      radio("lengthMode", "music", `Make the show as long as the music${W.songs.length ? ` (${fmtTime(musicTotal())})` : ""}`),
      radio("lengthMode", "custom", "Set a length:", num("customMin", 1, 60, 0.5, " minutes"))),

    h("h3", { class: "step" }, h("span", {}, "3"), "Pace & style"),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Time per slide"),
      h("input", { type: "range", min: 2.5, max: 8, step: 0.5, value: W.secPerSlide, oninput: (e) => { W.secPerSlide = +e.target.value; e.target.nextSibling.textContent = `${W.secPerSlide}s`; }, onchange: () => rr() }),
      h("span", { class: "val" }, `${W.secPerSlide}s`)),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Photos per slide"),
      h("select", { onchange: (e) => set("mix", e.target.value) }, Object.entries(MIX).map(([k, v]) => h("option", { value: k, selected: W.mix === k }, v.label)))),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Longest video clip"), num("maxClip", 2, 120, 1, " seconds (longer videos are trimmed)")),
    h("label", { class: "row check" }, h("input", { type: "checkbox", checked: W.videoSound, onchange: (e) => set("videoSound", e.target.checked) }), "Play videos' own sound (music dips underneath)"),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Transitions"),
      h("select", { onchange: (e) => set("transitions", e.target.value) },
        [["gentle", "Gentle — crossfades"], ["mixed", "Mixed — fades, pushes, wipes"], ["energetic", "Energetic — fast & varied"]].map(([v, l]) => h("option", { value: v, selected: W.transitions === v }, l)))),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Collage frames"),
      h("select", { onchange: (e) => set("style", e.target.value) }, Object.entries(STYLE_PRESETS).map(([k, v]) => h("option", { value: k, selected: W.style === k }, v.label)))),
    h("label", { class: "row check" }, h("input", { type: "checkbox", checked: W.kenBurns, onchange: (e) => set("kenBurns", e.target.checked) }), "Slow pan & zoom on photos (Ken Burns effect)"),

    h("h3", { class: "step" }, h("span", {}, "4"), "Titles"),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Opening title"), h("input", { type: "text", class: "grow", value: W.openTitle, placeholder: "(none)", onchange: (e) => set("openTitle", e.target.value) })),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Subtitle"), h("input", { type: "text", class: "grow", value: W.openSub, placeholder: "e.g. Noosa Adventist College", onchange: (e) => set("openSub", e.target.value) })),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Closing slide"), h("input", { type: "text", class: "grow", value: W.closeTitle, placeholder: "(none)", onchange: (e) => set("closeTitle", e.target.value) })),
  ].filter(Boolean));
}

function renderSummary(el, rr) {
  if (W.probing) { el.replaceChildren(h("div", { class: "ab-card" }, h("div", { class: "busy inline" }, h("span", { class: "spinner" }), "Reading your photos…"))); return; }
  const p = plan();
  if (!p.P && !p.V) {
    el.replaceChildren(h("div", { class: "ab-card" }, h("h3", {}, "Your show"), h("p", { class: "muted" }, "Choose your photos on the left and a summary will appear here.")));
    return;
  }
  const pace = p.perPhoto;
  const paceCls = !p.keptP ? "" : pace >= 2 ? "ok" : pace >= 1.2 ? "warn" : "bad";
  const paceText = !p.keptP ? "" : pace >= 2 ? "Comfortable — people can take each photo in" : pace >= 1.2 ? "Quick, but OK for a lively show" : "Too fast — photos will flash past";
  const opts = [];
  if (p.situation === "many" || p.situation === "videos") {
    const msg = p.situation === "videos"
      ? `The videos alone take ${fmtTime(p.Tv)}, which uses up almost all of the ${fmtTime(p.T)}. Shorten the longest video clip, or use fewer videos.`
      : `${p.P} photos is a lot for ${fmtTime(p.T)} at this pace. What would you like to do?`;
    opts.push(h("div", { class: "note warn" }, msg));
    const r = (val, label) => h("label", { class: "radio" }, h("input", { type: "radio", name: "overflow", checked: W.overflow === val, onchange: () => { W.overflow = val; rr(); } }), label);
    opts.push(h("div", { class: "ab-opts" },
      r("pick", `Use a selection of the best-spread photos (keeps the length)`),
      r("faster", "Use them all, with more photos on each slide"),
      r("longer", "Use them all and let the show run longer than the music")));
  } else if (p.situation === "few") {
    opts.push(h("div", { class: "note" }, `There are fewer photos than the length needs at ${W.secPerSlide}s per slide.`));
    const r = (val, label) => h("label", { class: "radio" }, h("input", { type: "radio", name: "underflow", checked: W.underflow === val, onchange: () => { W.underflow = val; rr(); } }), label);
    opts.push(h("div", { class: "ab-opts" },
      r("longer", `Show each photo for longer (~${p.avgDur.toFixed(1)}s) to fill the time`),
      r("shorter", "Keep the pace; the show ends early and the music fades out")));
  }
  const diff = p.total - p.T;
  el.replaceChildren(h("div", { class: "ab-card" },
    h("h3", {}, "Your show"),
    h("div", { class: "kv" }, h("span", {}, "Photos"), h("b", {}, p.keptP < p.P ? `${p.keptP} of ${p.P}` : `${p.P}`)),
    p.dupes ? h("div", { class: "kv sub" }, h("span", {}, "Near-duplicates skipped"), h("span", {}, p.dupes)) : null,
    h("div", { class: "kv" }, h("span", {}, "Videos"), h("b", {}, p.V ? `${p.V} (${fmtTime(p.Tv)})` : "0")),
    h("div", { class: "kv" }, h("span", {}, "Slides"), h("b", {}, p.slides.length)),
    h("div", { class: "kv" }, h("span", {}, p.useMusic ? "Music length" : "Target length"), h("b", {}, fmtTime(p.T))),
    h("div", { class: "kv big" }, h("span", {}, "Show length"), h("b", {}, fmtTime(p.total))),
    Math.abs(diff) > 3 && p.useMusic ? h("div", { class: `note ${diff > 0 ? "warn" : ""}` }, diff > 0 ? `Runs ${fmtTime(diff)} past the end of the music.` : `Music fades out; the show ends ${fmtTime(-diff)} early.`) : null,
    p.keptP ? h("div", { class: `pace ${paceCls}` },
      h("div", { class: "pace-num" }, `${pace.toFixed(1)}s`),
      h("div", {}, h("div", { class: "pace-lbl" }, "on screen per photo (average)"), h("div", { class: "pace-txt" }, paceText),
        h("div", { class: "muted small" }, `about ${p.avgPer.toFixed(1)} photos per slide, ${p.avgDur.toFixed(1)}s per slide`))) : null,
    opts,
    h("div", { class: "ab-mode" },
      app.project.slides.length ? h("div", { class: "row wrap" },
        h("label", { class: "radio" }, h("input", { type: "radio", name: "mode", checked: W.mode === "replace", onchange: () => { W.mode = "replace"; } }), "Replace my current slides"),
        h("label", { class: "radio" }, h("input", { type: "radio", name: "mode", checked: W.mode === "append", onchange: () => { W.mode = "append"; } }), "Add to the end")) : null,
      h("button", { class: "btn small ghost", title: "Try a different arrangement", onclick: () => { W.seed = Math.floor(Math.random() * 1e9); rr(); } }, "🎲 Shuffle the arrangement")),
    h("p", { class: "muted small" }, "Everything stays editable afterwards — change layouts, swap photos, trim videos, add text.")));
}

async function commit() {
  const p = plan();
  if (!p.slides.length) return;
  if (W.mode === "replace" && app.project.slides.length && !(await confirmBox("Replace slides?", `This replaces your current ${app.project.slides.length} slide(s) with the new show. (You can undo with Ctrl+Z.)`, "Replace"))) return;
  // add media to the library and remap temporary ids
  const used = new Set(p.slides.flatMap((s) => s.tiles.map((t) => t.mediaId)).filter(Boolean));
  const items = [...p.mb.values()].filter((m) => used.has(m.id));
  const added = await addMediaItems(items.map(({ id, ...rest }) => rest));
  const remap = new Map(items.map((m, i) => [m.id, added[i].id]));
  // also add the rest of the folder to the library so swaps are easy
  const rest = [...p.mb.values()].filter((m) => !used.has(m.id) && !app.project.media.some((x) => x.path === m.path));
  if (rest.length) await addMediaItems(rest.map(({ id, ...r }) => r));
  for (const s of p.slides) for (const t of s.tiles) if (t.mediaId) t.mediaId = remap.get(t.mediaId) || t.mediaId;
  const songs = await addMediaItems(W.songs.map(({ id, ...r }) => r));
  change((proj) => {
    if (W.mode === "replace") proj.slides = p.slides;
    else proj.slides.push(...p.slides);
    if (songs.length) proj.music = songs.map((m) => ({ id: uid("a"), mediaId: m.id, trimStart: 0, trimEnd: null, volume: 1 }));
    if (W.openTitle && proj.name === "Untitled show") proj.name = W.openTitle;
  });
  W.libGroups = null;
  const first = p.slides[0];
  app.sel.slides = new Set([first.id]); app.sel.current = first.id; app.sel.tile = app.sel.text = null;
  emit("select");
  toast(`Built ${p.slides.length} slides · ${fmtTime(computeTimeline(app.project).total)}. Press ▶ to watch it.`, "ok", 6000);
}

export function resetAutoBuild() { W = null; }
export { layoutById };
