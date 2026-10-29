// Right panel: settings for the selected text box, photo box and slide.
import { h, toast, slider, select, field, confirmBox } from "./ui.js";
import { app, on, change, currentSlide, currentTile, currentText, selectedSlides, selectItem, beginGesture, gestureUpdate, endGesture, applyLayout, applyStylePreset, emit } from "./state.js";
import { TRANSITIONS, MOTIONS, FONTS, LAYOUTS, STYLE_PRESETS, layoutRects, fmtTime, slideKind, newText } from "./model.js";
import { bestLayout } from "./layoutfit.js";
import { addTextBox, addPhotoBox } from "./editor.js";
import { fileSrc } from "./backend.js";
import { assets } from "./assets.js";
import { openTrim } from "./trim.js";
import { openZoomSpot } from "./zoomspot.js";

let root, layoutCount = null;

export function initProps(el) {
  root = el;
  on("change", (d) => { if (!d?.light) render(); });
  on("select", () => { layoutCount = null; render(); });
  on("focus", (what) => {
    render();
    requestAnimationFrame(() => {
      if (what === "text") { const ta = root.querySelector("textarea"); ta?.focus(); ta?.select(); }
      if (what === "transition") { const s = root.querySelector("#sec-transition"); s?.scrollIntoView({ block: "center" }); s?.classList.add("flash"); setTimeout(() => s?.classList.remove("flash"), 900); }
    });
  });
  render();
}

const live = (fn) => (v) => { beginGesture(); fn(v); gestureUpdate(); };
const section = (title, ...kids) => h("div", { class: "props-group" }, h("h3", { class: "section" }, title), ...kids);
const seg = (opts, value, onpick) => h("div", { class: "seg" }, opts.map(([v, l, tip]) => h("button", { class: value === v ? "on" : "", title: tip || "", onclick: () => onpick(v) }, l)));

function render() {
  if (!root) return;
  const s = currentSlide();
  const body = h("div", { class: "panel-body props" });
  root.replaceChildren(body);
  if (!s) {
    body.append(h("div", { class: "empty small" }, h("div", { class: "big" }, "🎞️"), h("p", {}, "Select a slide in the storyboard to edit it here.")));
    return;
  }
  const text = currentText();
  const tile = currentTile();
  if (text) body.append(textPanel(s, text));
  if (tile) body.append(tilePanel(s, tile));
  body.append(slidePanel(s));
}

// ---------------- text
function textPanel(s, t) {
  const ta = h("textarea", { rows: 3, value: t.text, oninput: (e) => { beginGesture(); t.text = e.target.value; gestureUpdate(); }, onblur: endGesture });
  const bgVal = !t.bg ? "none" : t.bg.startsWith("rgba(0,0,0") ? "dark" : t.bg.startsWith("rgba(255,255,255") ? "light" : "custom";
  return section("✎ Text",
    ta,
    field("Font", select(FONTS.map((f) => ({ id: f, label: f })), t.font, (v) => change(() => { t.font = v; }))),
    slider({ label: "Size", min: 16, max: 240, step: 1, value: t.size, fmt: (v) => `${v}`, oninput: live((v) => { t.size = v; }), onchange: endGesture }),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Colour"),
      h("input", { type: "color", value: t.color, oninput: live((e) => { t.color = e.target.value; }), onchange: endGesture }),
      h("button", { class: `tog ${t.bold ? "on" : ""}`, onclick: () => change(() => { t.bold = !t.bold; }) }, h("b", {}, "B")),
      h("button", { class: `tog ${t.italic ? "on" : ""}`, onclick: () => change(() => { t.italic = !t.italic; }) }, h("i", {}, "I"))),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Align"),
      seg([["left", "⯇"], ["center", "≡"], ["right", "⯈"]], t.align, (v) => change(() => { t.align = v; })),
      seg([["top", "⤒", "Top"], ["middle", "↕", "Middle"], ["bottom", "⤓", "Bottom"]], t.valign, (v) => change(() => { t.valign = v; }))),
    h("div", { class: "row" },
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: t.shadow, onchange: (e) => change(() => { t.shadow = e.target.checked; }) }), "Shadow"),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: t.outline, onchange: (e) => change(() => { t.outline = e.target.checked; }) }), "Outline")),
    field("Backing", select([{ id: "none", label: "None" }, { id: "dark", label: "Dark band" }, { id: "light", label: "Light band" }, { id: "custom", label: "Custom colour" }], bgVal, (v) =>
      change(() => { t.bg = v === "none" ? "" : v === "dark" ? "rgba(0,0,0,0.5)" : v === "light" ? "rgba(255,255,255,0.75)" : "#1d4ed8cc"; if (v === "light" && t.color === "#ffffff") t.color = "#111111"; }))),
    bgVal === "custom" ? field("Backing colour", h("input", { type: "color", value: t.bg.slice(0, 7), onchange: (e) => change(() => { t.bg = e.target.value + "cc"; }) })) : null,
    h("div", { class: "btn-row" },
      h("button", { class: "btn small", onclick: () => change(() => { t.rect = { x: 0.05, y: t.rect.y, w: 0.9, h: t.rect.h }; }) }, "↔ Full width"),
      h("button", { class: "btn small danger", onclick: () => { change(() => { s.texts = s.texts.filter((x) => x.id !== t.id); }); selectItem(null); } }, "Delete text")));
}

// ---------------- photo / video box
function tilePanel(s, t) {
  const m = t.mediaId ? app.mediaById.get(t.mediaId) : null;
  const isVideo = m?.kind === "video";
  const kids = [];
  if (m) {
    const tp = assets.thumbPath(m);
    kids.push(h("div", { class: "media-chip" }, tp ? h("img", { src: fileSrc(tp) }) : null, h("div", {}, h("div", { class: "name" }, m.name), h("div", { class: "muted small" }, `${m.width}×${m.height}${isVideo ? ` · ${fmtTime(m.duration, true)}` : ""}`))));
  } else kids.push(h("p", { class: "muted" }, "Empty box — drag a photo or video onto it, or select one in the library and press Fill."));
  kids.push(h("div", { class: "btn-row" },
    h("button", { class: "btn small", disabled: !app.libSel.size, title: "Use the photo selected in the library", onclick: () => change(() => { t.mediaId = [...app.libSel][0]; t.focusX = t.focusY = 0.5; t.zoom = 1; }) }, m ? "Replace with selected" : "Fill with selected"),
    m ? h("button", { class: "btn small", onclick: () => change(() => { t.mediaId = null; }) }, "Clear") : null,
    h("button", { class: "btn small danger", onclick: () => { change(() => { s.tiles = s.tiles.filter((x) => x.id !== t.id); }); selectItem(null); } }, "Delete box")));
  if (m) {
    kids.push(field("Fit", seg([["fill", "Fill box", "Crop to fill the box (keeps proportions)"], ["fit", "Whole photo", "Show the entire photo (keeps proportions)"], ["stretch", "Stretch", "Squash/stretch to the box shape — distorts the photo"]], t.fit, async (v) => {
      if (v === "stretch") {
        const ok = await confirmBox("Stretch this photo?", "Stretching changes the photo's proportions so it fills the box exactly. People and objects will look squashed or stretched. Photos are never stretched unless you choose this.", "Stretch it", true);
        if (!ok) return;
      }
      change(() => { t.fit = v; });
    })));
    if (t.fit === "stretch") kids.push(h("div", { class: "note warn" }, "⚠ This photo is stretched to fit and is out of proportion. Choose Fill box or Whole photo to fix it."));
    if (t.fit !== "stretch") {
      kids.push(slider({ label: "Zoom", min: 1, max: 4, step: 0.01, value: t.zoom, fmt: (v) => `${Math.round(v * 100)}%`, oninput: live((v) => { t.zoom = v; }), onchange: endGesture }));
      kids.push(h("div", { class: "btn-row" },
        h("button", { class: `btn small ${app.panMode ? "primary" : ""}`, onclick: () => { app.panMode = !app.panMode; emit("select"); } }, app.panMode ? "✓ Done repositioning" : "✥ Reposition photo"),
        h("button", { class: "btn small", onclick: () => change(() => { t.focusX = t.focusY = 0.5; t.zoom = 1; }) }, "Reset")));
    }
    const motions = isVideo ? MOTIONS.filter((x) => x.id === "none" || x.id === "custom") : MOTIONS;
    kids.push(field("Motion", select(motions, t.motion, (v) => {
      if (v === "custom") openZoomSpot(s, t);
      else change(() => { t.motion = v; });
    })));
    if (t.motion === "custom") kids.push(h("div", { class: "btn-row" }, h("button", { class: "btn small primary", onclick: () => openZoomSpot(s, t) }, "🎯 Edit zoom spot…")));
    else {
      if (t.motion !== "none") kids.push(slider({ label: "Strength", min: 0.05, max: 0.5, step: 0.01, value: t.motionAmount, fmt: (v) => `${Math.round(v * 100)}%`, oninput: live((v) => { t.motionAmount = v; }), onchange: endGesture }));
      kids.push(h("div", { class: "btn-row" }, h("button", { class: "btn small", title: "Zoom in on a face or part of the picture", onclick: () => openZoomSpot(s, t) }, "🎯 Zoom to a spot…")));
    }
  }
  kids.push(slider({ label: "Tilt", min: -30, max: 30, step: 0.5, value: t.rotation, fmt: (v) => `${v}°`, oninput: live((v) => { t.rotation = v; }), onchange: endGesture }));
  if (isVideo) {
    const end = t.trimEnd ?? m.duration;
    kids.push(h("h4", { class: "sub" }, "🎬 Video clip"));
    kids.push(h("button", { class: "btn primary small", onclick: () => openTrim(s, t) }, "✂ Trim video…"));
    kids.push(slider({ label: "Start", min: 0, max: Math.max(0, m.duration - 0.5), step: 0.1, value: t.trimStart, fmt: (v) => fmtTime(v, true), oninput: live((v) => { t.trimStart = Math.min(v, (t.trimEnd ?? m.duration) - 0.3); }), onchange: endGesture }));
    kids.push(slider({ label: "End", min: 0.5, max: m.duration, step: 0.1, value: end, fmt: (v) => fmtTime(v, true), oninput: live((v) => { t.trimEnd = v >= m.duration - 0.05 ? null : Math.max(v, t.trimStart + 0.3); }), onchange: endGesture }));
    const clipLen = Math.max(0.3, (t.trimEnd ?? m.duration) - t.trimStart);
    kids.push(h("div", { class: "row" }, h("span", { class: "muted small" }, `Clip length ${fmtTime(clipLen, true)} · slide shows ${s.duration.toFixed(1)}s`),
      h("button", { class: "btn small", onclick: () => change(() => { s.duration = Math.round(clipLen * 10) / 10; }) }, "Fit slide to clip")));
    if (m.hasAudio) {
      kids.push(h("label", { class: "row check" }, h("input", { type: "checkbox", checked: !t.muted, onchange: (e) => change(() => { t.muted = !e.target.checked; }) }), "Play this clip's sound"));
      if (!t.muted) {
        kids.push(slider({ label: "Clip volume", min: 0, max: 2, step: 0.05, value: t.volume, fmt: (v) => `${Math.round(v * 100)}%`, oninput: live((v) => { t.volume = v; }), onchange: endGesture }));
        if (app.project.settings.autoDuck) kids.push(h("p", { class: "muted small" }, `Music drops to ${Math.round(app.project.settings.duckLevel * 100)}% while this plays (change on the Music tab).`));
      }
    } else kids.push(h("p", { class: "muted small" }, "This clip has no sound."));
  }
  return section(isVideo ? "🎬 Video box" : "▣ Photo box", ...kids);
}

// ---------------- slide
function slidePanel(s) {
  const sel = selectedSlides();
  const multi = sel.length > 1;
  const targets = () => (multi ? selectedSlides() : [s]);
  const applyAll = (fn) => change(() => targets().forEach(fn));
  const idx = app.project.slides.indexOf(s);
  const kind = slideKind(app.project, s, app.mediaById);
  const out = h("div", {});

  out.append(h("div", { class: "slide-head" },
    h("b", {}, multi ? `${sel.length} slides selected` : `Slide ${idx + 1}`),
    multi ? h("span", { class: "muted small" }, "Changes below apply to all selected slides") : null));

  if (!multi) {
    out.append(h("div", { class: "btn-row" },
      h("button", { class: "btn small", onclick: addTextBox }, "＋ Text"),
      h("button", { class: "btn small", onclick: addPhotoBox }, "＋ Photo box"),
      h("button", { class: "btn small", onclick: () => emit("play-slide") }, "▶ Play slide")));
    // layout picker
    const n = layoutCount ?? Math.max(1, s.tiles.length);
    const counts = h("div", { class: "seg counts" }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => h("button", { class: c === n ? "on" : "", onclick: () => { layoutCount = c; render(); } }, c)));
    const grid = h("div", { class: "layout-grid" }, LAYOUTS.filter((l) => l.n === n).map((l) => {
      const mini = h("div", { class: `layout-mini ${s.layoutId === l.id ? "on" : ""}`, title: l.name, onclick: () => {
        let dropped = 0;
        change(() => { dropped = applyLayout(s, l.id); });
        if (dropped) toast(`${dropped} photo(s) didn't fit and were removed from this slide`, "warn");
      } }, layoutRects(l).map((r) => h("i", { style: { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` } })));
      return mini;
    }));
    out.append(section("Layout", counts, grid,
      h("div", { class: "btn-row" },
        h("button", { class: "btn small", disabled: s.tiles.filter((t) => t.mediaId).length < 2, onclick: () => change(() => {
          const ids = s.tiles.filter((t) => t.mediaId).map((t) => t.mediaId);
          const medias = ids.map((id) => app.mediaById.get(id));
          const { layout, order } = bestLayout(medias, s.layoutId);
          applyLayout(s, layout.id);
          s.tiles.forEach((t, i) => { t.mediaId = ids[order[i]]; t.focusX = t.focusY = 0.5; });
        }) }, "✨ Best fit for these photos"))));
  }

  // timing
  out.append(section("Timing",
    slider({ label: "Show for", min: 1, max: 30, step: 0.1, typedMax: 600, value: s.duration, fmt: (v) => `${v.toFixed(1)}s`, oninput: live((v) => targets().forEach((x) => { x.duration = v; })), onchange: endGesture }),
    kind.hasVideo && !multi ? h("p", { class: "muted small" }, "Tip: select the video box for clip trimming and ‘Fit slide to clip’.") : null));

  // transition
  const tr = s.transition;
  const tsec = section("Transition into this slide",
    field("Effect", select(TRANSITIONS.map((t) => ({ id: t.id, label: `${t.icon}  ${t.label}` })), tr.kind, (v) => applyAll((x) => { x.transition.kind = v; }))),
    tr.kind !== "cut" ? slider({ label: "Length", min: 0.2, max: 3, step: 0.1, value: tr.duration, fmt: (v) => `${v.toFixed(1)}s`, oninput: live((v) => targets().forEach((x) => { x.transition.duration = v; })), onchange: endGesture }) : null,
    h("button", { class: "btn small", onclick: () => change((p) => p.slides.forEach((x, i) => { x.transition = { ...tr }; })) }, "Use for every slide"));
  tsec.id = "sec-transition";
  out.append(tsec);

  // frame style (collage)
  const presetBtns = h("div", { class: "preset-row" }, Object.entries(STYLE_PRESETS).map(([k, p]) =>
    h("button", { class: `preset ${s.stylePreset === k ? "on" : ""}`, onclick: () => applyAll((x) => applyStylePreset(x, k)) }, p.label)));
  out.append(section("Photo frames", presetBtns,
    slider({ label: "Border", min: 0, max: 40, step: 1, value: s.style.border, fmt: (v) => `${v}px`, oninput: live((v) => targets().forEach((x) => { x.style.border = v; x.stylePreset = null; })), onchange: endGesture }),
    h("div", { class: "row" }, h("span", { class: "lbl" }, "Border colour"), h("input", { type: "color", value: s.style.borderColor, oninput: live((e) => targets().forEach((x) => { x.style.borderColor = e.target.value; })), onchange: endGesture })),
    slider({ label: "Corners", min: 0, max: 80, step: 1, value: s.style.radius, fmt: (v) => `${v}px`, oninput: live((v) => targets().forEach((x) => { x.style.radius = v; x.stylePreset = null; })), onchange: endGesture }),
    h("label", { class: "row check" }, h("input", { type: "checkbox", checked: s.style.shadow, onchange: (e) => applyAll((x) => { x.style.shadow = e.target.checked; }) }), "Drop shadow")));

  // background
  const bg = s.background;
  out.append(section("Background",
    seg([["blur", "Blurred photo"], ["color", "Colour"], ["gradient", "Gradient"]], bg.kind, (v) => applyAll((x) => { x.background.kind = v; })),
    bg.kind !== "blur" ? h("div", { class: "row" }, h("span", { class: "lbl" }, "Colours"),
      h("input", { type: "color", value: bg.color, oninput: live((e) => targets().forEach((x) => { x.background.color = e.target.value; })), onchange: endGesture }),
      bg.kind === "gradient" ? h("input", { type: "color", value: bg.color2, oninput: live((e) => targets().forEach((x) => { x.background.color2 = e.target.value; })), onchange: endGesture }) : null) : null));

  // text & sound
  out.append(section("Text animation",
    seg([["none", "None"], ["fade", "Fade in"], ["rise", "Rise up"]], s.textAnim, (v) => applyAll((x) => { x.textAnim = v; })),
    !multi && !s.texts.length ? h("button", { class: "btn small", onclick: addTextBox }, "＋ Add a caption") : null));
  out.append(section("Music on this slide",
    slider({ label: "Music level", min: 0, max: 1, step: 0.05, value: s.musicVolume, fmt: (v) => `${Math.round(v * 100)}%`, oninput: live((v) => targets().forEach((x) => { x.musicVolume = v; })), onchange: endGesture }),
    h("p", { class: "muted small" }, "Turn this down to let a speech or a video's sound come through.")));
  return out;
}

export { newText };
