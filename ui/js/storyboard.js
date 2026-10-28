// Bottom storyboard: slide strip with thumbnails, transitions, reordering, drops.
import { h, beginDrag, contextMenu, toast, modal } from "./ui.js";
import { app, on, emit, change, selectSlide, selectedSlides, insertSlides, deleteSlides, duplicateSlides, slideForMedia, slideDefaults, applyLayout } from "./state.js";
import { drawSlide } from "./render.js";
import { assets } from "./assets.js";
import { openTrim } from "./trim.js";
import { TRANSITIONS, newSlide, newTitleSlide, computeTimeline, fmtTime, slideKind, TRANSITION_SETS, LAYOUTS } from "./model.js";

let root, strip, cardW = 168;
const thumbs = new Map(); // slide id -> {sig, canvas, incomplete}

export function initStoryboard(el) {
  root = el;
  on("change", (d) => { if (!d?.light) render(); else refreshThumbs(); });
  on("select", () => markSelection());
  on("playhead", (i) => markPlaying(i));
  assets.onLoad(() => refreshThumbs(true));
  render();
}

function transIcon(kind) { return TRANSITIONS.find((t) => t.id === kind)?.icon || "◐"; }

function thumbFor(slide) {
  const sig = JSON.stringify(slide);
  let t = thumbs.get(slide.id);
  if (t && t.sig === sig && !t.incomplete) return t.canvas;
  if (!t) {
    const c = document.createElement("canvas");
    c.width = 192; c.height = 108;
    t = { canvas: c };
    thumbs.set(slide.id, t);
  }
  t.sig = sig;
  const ctx = t.canvas.getContext("2d");
  drawSlide(ctx, app.project, slide, 0, 192, 108, "thumb", app.mediaById);
  t.incomplete = slide.tiles.some((tl) => { const m = tl.mediaId && app.mediaById.get(tl.mediaId); return m && !assets.image(m, "thumb"); })
    || (slide.background.kind === "blur" && false);
  return t.canvas;
}

function refreshThumbs(onlyIncomplete = false) {
  if (!strip) return;
  for (const s of app.project.slides) {
    const t = thumbs.get(s.id);
    if (onlyIncomplete && t && !t.incomplete) continue;
    const c = thumbFor(s);
    const holder = strip.querySelector(`.sb-card[data-id="${s.id}"] .sb-thumb`);
    if (holder && holder.firstChild !== c) holder.replaceChildren(c);
  }
}

function markSelection() {
  if (!strip) return;
  strip.querySelectorAll(".sb-card").forEach((c) => {
    c.classList.toggle("sel", app.sel.slides.has(c.dataset.id));
    c.classList.toggle("current", app.sel.current === c.dataset.id);
  });
  const cur = strip.querySelector(".sb-card.current");
  if (cur && !app.playing) {
    const r = cur.getBoundingClientRect(), sr = strip.getBoundingClientRect();
    if (r.left < sr.left || r.right > sr.right) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
function markPlaying(i) {
  if (!strip) return;
  strip.querySelectorAll(".sb-card.playing").forEach((c) => c.classList.remove("playing"));
  const s = app.project.slides[i];
  const c = s && strip.querySelector(`.sb-card[data-id="${s.id}"]`);
  if (c) {
    c.classList.add("playing");
    const r = c.getBoundingClientRect(), sr = strip.getBoundingClientRect();
    if (r.left < sr.left || r.right > sr.right) strip.scrollLeft += r.left - sr.left - 40;
  }
}

function render() {
  if (!root) return;
  const p = app.project;
  const tl = computeTimeline(p);
  const scroll = strip?.scrollLeft || 0;
  const sel = selectedSlides();
  const live = new Set(p.slides.map((s) => s.id));
  for (const id of thumbs.keys()) if (!live.has(id)) thumbs.delete(id);

  const tools = h("div", { class: "sb-tools" },
    h("button", { class: "btn small", onclick: (e) => blankMenu(e) }, "＋ Slide ▾"),
    h("button", { class: "btn small", onclick: () => insertSlides([newTitleSlide("Title", "", slideDefaults())]) }, "＋ Title card"),
    h("span", { class: "sep" }),
    h("button", { class: "btn small", disabled: !sel.length, onclick: () => duplicateSlides(sel.map((s) => s.id)) }, "⧉ Duplicate"),
    h("button", { class: "btn small", disabled: !sel.length, onclick: () => deleteSlides(sel.map((s) => s.id)) }, "🗑 Delete"),
    h("span", { class: "sep" }),
    h("button", { class: "btn small", disabled: !p.slides.length, onclick: (e) => transitionMenu(e) }, "✦ Transitions ▾"),
    h("button", { class: "btn small", disabled: !p.slides.length, onclick: () => timingDialog() }, "⏱ Timing…"),
    h("span", { class: "grow" }),
    h("span", { class: "sb-info" }, `${p.slides.length} slide${p.slides.length === 1 ? "" : "s"}${sel.length > 1 ? ` (${sel.length} selected)` : ""} · ${fmtTime(tl.total)}`),
    h("input", { type: "range", min: 110, max: 260, value: cardW, title: "Card size", oninput: (e) => { cardW = +e.target.value; strip.style.setProperty("--card", `${cardW}px`); } }));

  strip = h("div", { class: "sb-strip", style: { "--card": `${cardW}px` } });
  strip.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  const indicator = h("div", { class: "sb-indicator" });
  p.slides.forEach((s, i) => {
    const k = slideKind(p, s, app.mediaById);
    if (i > 0 || s.transition.kind !== "cut") {
      strip.append(h("div", { class: "sb-trans", title: `${TRANSITIONS.find((t) => t.id === s.transition.kind)?.label} (${s.transition.duration}s) — click to change`, onclick: () => { selectSlide(s.id); emit("focus", "transition"); } }, transIcon(s.transition.kind)));
    }
    const card = h("div", { class: `sb-card ${app.sel.slides.has(s.id) ? "sel" : ""} ${app.sel.current === s.id ? "current" : ""}`, "data-id": s.id },
      h("div", { class: "sb-thumb" }, thumbFor(s)),
      h("div", { class: "sb-meta" },
        h("span", { class: "sb-num" }, i + 1),
        k.hasVideo ? h("span", { title: "Has video" }, "🎬") : null,
        s.texts.length ? h("span", { title: "Has text" }, "T") : null,
        k.empty && s.tiles.length ? h("span", { class: "warn-ic", title: `${k.empty} empty box(es)` }, "⚠") : null,
        h("span", { class: "grow" }),
        h("span", { class: "sb-dur" }, `${s.duration.toFixed(1)}s`)));
    card.addEventListener("click", (e) => selectSlide(s.id, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single"));
    card.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const ids = app.sel.slides.has(s.id) ? p.slides.filter((x) => app.sel.slides.has(x.id)).map((x) => x.id) : [s.id];
      beginDrag(e, { type: "slides", ids }, () => h("div", {}, ids.length > 1 ? `Move ${ids.length} slides` : `Move slide ${i + 1}`));
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!app.sel.slides.has(s.id)) selectSlide(s.id);
      const ids = selectedSlides().map((x) => x.id);
      const vt = s.tiles.find((t) => app.mediaById.get(t.mediaId)?.kind === "video");
      contextMenu(e.clientX, e.clientY, [
        vt ? { label: "✂ Trim video…", action: () => openTrim(s, vt) } : null,
        { label: "Duplicate", action: () => duplicateSlides(ids) },
        { label: "Delete", action: () => deleteSlides(ids) },
        "-",
        { label: "Insert title card before", action: () => insertSlides([newTitleSlide("Title", "", slideDefaults())], p.slides.findIndex((x) => x.id === s.id)) },
        { label: "Insert title card after", action: () => insertSlides([newTitleSlide("Title", "", slideDefaults())], p.slides.findIndex((x) => x.id === s.id) + 1) },
        "-",
        { label: "Use this transition for all slides", action: () => change((p) => p.slides.forEach((x, j) => { if (j > 0 || x.transition.kind !== "cut") x.transition = { ...s.transition }; })) },
        { label: "Use this frame style for all slides", action: () => change((p) => p.slides.forEach((x) => { if (x.tiles.length > 1) { x.style = { ...s.style }; x.stylePreset = s.stylePreset; } })) },
      ]);
    });
    strip.append(card);
  });
  if (!p.slides.length) strip.append(h("div", { class: "sb-empty" }, "Your storyboard is empty. Drag photos here, double-click a photo in the library, or use ✨ Auto Build."));
  strip.append(indicator);

  // drop handling
  let dropIndex = null, dropCard = null;
  const clear = () => { indicator.style.display = "none"; strip.querySelectorAll(".drop-into").forEach((c) => c.classList.remove("drop-into")); dropCard = null; };
  strip._drop = {
    accepts: (pl) => pl.type === "media" || pl.type === "slides",
    over(pl, e) {
      clear();
      const cards = [...strip.querySelectorAll(".sb-card")];
      dropIndex = cards.length;
      for (let j = 0; j < cards.length; j++) {
        const r = cards[j].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) {
          if (pl.type === "media" && e.clientX > r.left + r.width * 0.25 && e.clientY > r.top && e.clientY < r.bottom) { dropCard = cards[j]; break; }
          dropIndex = j; break;
        }
        if (pl.type === "media" && e.clientX < r.right - r.width * 0.25 && e.clientY > r.top && e.clientY < r.bottom) { dropCard = cards[j]; break; }
      }
      if (dropCard) { dropCard.classList.add("drop-into"); return; }
      const sr = strip.getBoundingClientRect();
      let x;
      if (!cards.length) x = 10;
      else if (dropIndex < cards.length) x = cards[dropIndex].getBoundingClientRect().left - sr.left - 6 + strip.scrollLeft;
      else x = cards[cards.length - 1].getBoundingClientRect().right - sr.left + 4 + strip.scrollLeft;
      indicator.style.left = `${x}px`;
      indicator.style.display = "block";
      const edge = 60;
      if (e.clientX < sr.left + edge) strip.scrollLeft -= 20;
      if (e.clientX > sr.right - edge) strip.scrollLeft += 20;
    },
    leave: clear,
    drop(pl) {
      const into = dropCard?.dataset.id;
      clear();
      if (pl.type === "slides") {
        const ids = new Set(pl.ids);
        change((p) => {
          const target = p.slides[dropIndex]?.id;
          const moving = p.slides.filter((s) => ids.has(s.id));
          const rest = p.slides.filter((s) => !ids.has(s.id));
          let at = target ? rest.findIndex((s) => s.id === target) : rest.length;
          if (at < 0) at = rest.length;
          rest.splice(at, 0, ...moving);
          p.slides = rest;
        });
        return;
      }
      if (into) {
        const slide = p.slides.find((s) => s.id === into);
        const existing = slide.tiles.filter((t) => t.mediaId).map((t) => t.mediaId);
        const empties = slide.tiles.filter((t) => !t.mediaId);
        change(() => {
          if (empties.length >= pl.ids.length) pl.ids.forEach((id, j) => { empties[j].mediaId = id; });
          else {
            const all = [...existing, ...pl.ids].slice(0, 9);
            const ns = slideForMedia(all);
            slide.tiles = ns.tiles; slide.layoutId = ns.layoutId;
            if (pl.ids.length + existing.length > 9) toast("A slide holds at most 9 photos", "warn");
          }
        });
        selectSlide(into);
        return;
      }
      const slides = pl.ids.map((id) => slideForMedia([id]));
      insertSlides(slides, dropIndex);
    },
  };
  root.replaceChildren(tools, strip);
  strip.scrollLeft = scroll;
}

function blankMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  contextMenu(r.left, r.top - 10, counts.map((n) => ({
    label: n === 1 ? "1 photo (full screen)" : `${n} photos`,
    action: () => {
      const l = LAYOUTS.find((x) => x.n === n);
      const s = newSlide(l.id, slideDefaults());
      insertSlides([s]);
    },
  })));
}

function transitionMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const sel = selectedSlides();
  const target = () => (sel.length > 1 ? sel : app.project.slides);
  const label = sel.length > 1 ? `${sel.length} selected slides` : "all slides";
  const apply = (fn) => change(() => target().forEach((s, i) => fn(s, i)));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  contextMenu(r.left, r.top - 10, [
    { label: `Applies to ${label}`, disabled: true, action: () => {} },
    { label: "Crossfade everywhere", action: () => apply((s) => { s.transition.kind = "crossfade"; }) },
    { label: "Random — gentle mix", action: () => apply((s) => { s.transition.kind = pick(TRANSITION_SETS.mixed); }) },
    { label: "Random — energetic mix", action: () => apply((s) => { s.transition.kind = pick(TRANSITION_SETS.energetic); }) },
    { label: "No transitions (hard cuts)", action: () => apply((s) => { s.transition.kind = "cut"; }) },
    "-",
    ...[0.5, 1, 1.5, 2].map((d) => ({ label: `Transition length ${d}s`, action: () => apply((s) => { s.transition.duration = d; }) })),
  ]);
}

async function timingDialog() {
  const sel = selectedSlides();
  const scope = h("select", {}, h("option", { value: "all" }, "All photo slides"), sel.length > 1 ? h("option", { value: "sel", selected: true }, `${sel.length} selected slides`) : null);
  const dur = h("input", { type: "number", min: 1, max: 30, step: 0.5, value: app.project.settings.defaultDuration });
  const v = await modal({
    title: "Slide timing",
    body: h("div", { class: "form" },
      h("label", { class: "row" }, h("span", { class: "lbl" }, "Apply to"), scope),
      h("label", { class: "row" }, h("span", { class: "lbl" }, "Seconds per slide"), dur),
      h("p", { class: "muted small" }, "Video slides keep their clip length. To match the music exactly, use ‘Fit show to music’ on the Music tab.")),
    buttons: [{ label: "Cancel", value: null }, { label: "Apply", value: () => ({ scope: scope.value, d: +dur.value }), primary: true }],
  });
  if (!v || !(v.d > 0)) return;
  change((p) => {
    const list = v.scope === "sel" ? selectedSlides() : p.slides;
    for (const s of list) if (!slideKind(p, s, app.mediaById).hasVideo) s.duration = v.d;
    p.settings.defaultDuration = v.d;
  });
}

export { applyLayout };
