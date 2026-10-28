// Left panel: media library (photos & videos) + Music tab.
import { h, toast, beginDrag, modal, confirmBox, contextMenu } from "./ui.js";
import { app, on, emit, change, addMediaItems, mediaUsage, slideForMedia, insertSlides, currentSlide } from "./state.js";
import { api, fileSrc } from "./backend.js";
import { assets } from "./assets.js";
import { fmtTime } from "./model.js";
import { renderMusicPanel } from "./music.js";

let root, tab = "media", filter = "all", sort = "date", lastClicked = null, thumbSize = 96;
let lastSig = "";

export async function importPaths(paths, { silent = false } = {}) {
  if (!paths?.length) return [];
  const t = h("div", { class: "busy" }, h("span", { class: "spinner" }), `Reading ${paths.length > 1 ? paths.length + " items" : "files"}…`);
  document.getElementById("toast-root").append(t);
  try {
    const res = await api.importFiles(paths);
    const items = await addMediaItems(res.items);
    if (res.failed.length) toast(`${res.failed.length} file(s) couldn't be read: ${res.failed.slice(0, 3).join(", ")}${res.failed.length > 3 ? "…" : ""}`, "warn", 6000);
    else if (!silent) toast(`Added ${res.items.length} item(s)`, "ok");
    return items;
  } catch (e) {
    toast(`Import failed: ${e}`, "error", 6000);
    return [];
  } finally {
    t.remove();
  }
}

export function initLibrary(el) {
  root = el;
  on("change", (d) => { if (!d?.light) render(); });
  on("libtab", (t) => { tab = t; lastSig = ""; render(); });
  assets.onLoad(() => updateThumbs());
  render();
}

function visibleMedia() {
  const usage = mediaUsage();
  let list = app.project.media.filter((m) => m.kind !== "audio");
  if (filter === "image") list = list.filter((m) => m.kind === "image");
  if (filter === "video") list = list.filter((m) => m.kind === "video");
  if (filter === "unused") list = list.filter((m) => !usage.get(m.id));
  const by = {
    date: (a, b) => (a.date || 0) - (b.date || 0) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    folder: (a, b) => (a.folder || "").localeCompare(b.folder || "", undefined, { numeric: true }) || (a.date || 0) - (b.date || 0),
  }[sort];
  return { list: list.slice().sort(by), usage };
}

function updateThumbs() {
  if (tab !== "media" || !root) return;
  root.querySelectorAll(".lib-item[data-pending]").forEach((el) => {
    const m = app.mediaById.get(el.dataset.id);
    const p = m && assets.thumbPath(m);
    if (p) {
      el.removeAttribute("data-pending");
      el.querySelector(".lib-thumb").replaceChildren(h("img", { src: fileSrc(p), loading: "lazy", draggable: false }));
    }
  });
}

function render() {
  if (!root) return;
  const sig = `${tab}|${filter}|${sort}|${thumbSize}|${app.project.media.length}|${[...mediaUsage()].join()}|${app.project.music.map((m) => m.id + m.volume + m.trimStart).join()}|${app.project.slides.length}`;
  if (sig === lastSig && tab === "media") return;
  lastSig = sig;
  const prevScroll = root.querySelector(".lib-grid")?.scrollTop || 0;
  const tabs = h("div", { class: "tabs" },
    h("button", { class: `tab ${tab === "media" ? "on" : ""}`, onclick: () => emit("libtab", "media") }, "📷 Photos & Videos"),
    h("button", { class: `tab ${tab === "music" ? "on" : ""}`, onclick: () => emit("libtab", "music") }, "🎵 Music"));
  const body = h("div", { class: "panel-body" });
  root.replaceChildren(tabs, body);
  if (tab === "music") return renderMusicPanel(body);

  const { list, usage } = visibleMedia();
  const counts = { image: 0, video: 0 };
  for (const m of app.project.media) if (counts[m.kind] !== undefined) counts[m.kind]++;
  const tools = h("div", { class: "lib-tools" },
    h("div", { class: "btn-row" },
      h("button", { class: "btn primary", onclick: async () => importPaths(await api.pickFiles("media")) }, "＋ Add photos / videos"),
      h("button", { class: "btn", onclick: async () => { const f = await api.pickFolder(); if (f) importPaths([f]); } }, "＋ Add folder")),
    h("div", { class: "chips" },
      [["all", `All ${counts.image + counts.video}`], ["image", `Photos ${counts.image}`], ["video", `Videos ${counts.video}`], ["unused", "Unused"]].map(([id, l]) =>
        h("button", { class: `chip ${filter === id ? "on" : ""}`, onclick: () => { filter = id; render(); } }, l))),
    h("div", { class: "row tight" },
      h("span", { class: "muted" }, "Sort"),
      h("select", { onchange: (e) => { sort = e.target.value; render(); } },
        [["date", "Date taken"], ["name", "File name"], ["folder", "Folder"]].map(([v, l]) => h("option", { value: v, selected: sort === v }, l))),
      h("input", { type: "range", min: 64, max: 180, value: thumbSize, title: "Thumbnail size", oninput: (e) => { thumbSize = +e.target.value; grid.style.setProperty("--thumb", `${thumbSize}px`); } })));

  const grid = h("div", { class: "lib-grid", style: { "--thumb": `${thumbSize}px` } });
  if (!app.project.media.some((m) => m.kind !== "audio")) {
    grid.append(h("div", { class: "empty" },
      h("div", { class: "big" }, "🖼️"),
      h("p", {}, "Add photos and videos with the buttons above, or drag files and folders from Explorer straight into this window."),
      h("p", { class: "muted" }, "Tip: use ✨ Auto Build to turn a whole folder into a show in one go.")));
  }
  let lastFolder = null;
  for (const m of list) {
    if (sort === "folder" && m.folder !== lastFolder) {
      lastFolder = m.folder;
      grid.append(h("div", { class: "lib-folder" }, m.folder || "(top folder)"));
    }
    const tp = assets.thumbPath(m);
    const n = usage.get(m.id) || 0;
    const item = h("div", {
      class: `lib-item ${app.libSel.has(m.id) ? "sel" : ""}`, "data-id": m.id, "data-pending": tp ? null : "1",
      title: `${m.name}\n${m.width}×${m.height}${m.kind === "video" ? ` · ${fmtTime(m.duration)}` : ""}${m.folder ? `\nFolder: ${m.folder}` : ""}${m.date ? `\n${new Date(m.date).toISOString().slice(0, 16).replace("T", " ")}` : ""}`,
    },
      h("div", { class: "lib-thumb" }, tp ? h("img", { src: fileSrc(tp), loading: "lazy", draggable: false }) : h("span", { class: "spinner" })),
      m.kind === "video" ? h("span", { class: "badge vid" }, `▶ ${fmtTime(m.duration)}`) : null,
      n ? h("span", { class: "badge used", title: `Used ${n}×` }, n > 1 ? `✓${n}` : "✓") : null);
    item.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const ids = app.libSel.has(m.id) ? list.filter((x) => app.libSel.has(x.id)).map((x) => x.id) : [m.id];
      beginDrag(e, { type: "media", ids }, () => h("div", {}, ids.length > 1 ? `${ids.length} items` : m.name));
    });
    item.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) app.libSel.has(m.id) ? app.libSel.delete(m.id) : app.libSel.add(m.id);
      else if (e.shiftKey && lastClicked) {
        const a = list.findIndex((x) => x.id === lastClicked), b = list.findIndex((x) => x.id === m.id);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) app.libSel.add(list[i].id);
      } else { app.libSel.clear(); app.libSel.add(m.id); }
      lastClicked = m.id;
      refreshSelection(list);
    });
    item.addEventListener("dblclick", () => insertSlides([slideForMedia([m.id])]));
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!app.libSel.has(m.id)) { app.libSel.clear(); app.libSel.add(m.id); refreshSelection(list); }
      contextMenu(e.clientX, e.clientY, [
        { label: "Add to show — one per slide", action: () => addSelected(list, 1) },
        { label: "Add to show — as collage(s)…", action: () => addSelected(list, 0) },
        { label: "Show in Explorer", action: () => api.reveal(m.path) },
        "-",
        { label: "Remove from library", action: () => removeSelected() },
      ]);
    });
    grid.append(item);
  }
  const selBar = makeSelBar(list);
  body.append(tools, grid, selBar);
  grid.scrollTop = prevScroll;
}

function refreshSelection(list) {
  root.querySelectorAll(".lib-item").forEach((el) => el.classList.toggle("sel", app.libSel.has(el.dataset.id)));
  const old = root.querySelector(".sel-bar");
  if (old) old.replaceWith(makeSelBar(list));
  lastSig = "";
}

function makeSelBar(list) {
  return app.libSel.size
    ? h("div", { class: "sel-bar" },
      h("span", {}, `${app.libSel.size} selected`),
      h("button", { class: "btn small primary", onclick: () => addSelected(list, 1) }, "Add as slides"),
      h("button", { class: "btn small", onclick: () => addSelected(list, 0) }, "Add as collage"),
      h("button", { class: "btn small ghost", title: "Clear selection", onclick: () => { app.libSel.clear(); refreshSelection(list); } }, "✕"))
    : h("div", { class: "sel-bar hint" }, "Click to select · Ctrl/Shift for many · drag onto a slide or the storyboard");
}

async function addSelected(list, perSlide) {
  const ids = list.filter((m) => app.libSel.has(m.id)).map((m) => m.id);
  if (!ids.length) return;
  if (!perSlide) {
    const sel = h("select", {}, [2, 3, 4, 5, 6, 7, 8, 9].map((n) => h("option", { value: n, selected: n === Math.min(4, Math.max(2, ids.length)) }, `${n} per slide`)));
    const v = await modal({ title: "Add as collage", body: h("div", {}, h("p", {}, `${ids.length} item(s) will be grouped into collage slides. Videos always get their own slide.`), sel), buttons: [{ label: "Cancel", value: null }, { label: "Add", value: () => +sel.value, primary: true }] });
    if (!v) return;
    perSlide = v;
  }
  const slides = [];
  let group = [], prev = null;
  const flush = () => { if (group.length) { const s = slideForMedia(group, { prevLayout: prev }); prev = s.layoutId; slides.push(s); group = []; } };
  for (const id of ids) {
    const m = app.mediaById.get(id);
    if (m.kind === "video") { flush(); slides.push(slideForMedia([id])); continue; }
    group.push(id);
    if (group.length >= perSlide) flush();
  }
  flush();
  insertSlides(slides);
  app.libSel.clear();
  toast(`Added ${slides.length} slide(s)`, "ok");
}

async function removeSelected() {
  const ids = new Set(app.libSel);
  const usage = mediaUsage();
  const used = [...ids].filter((id) => usage.get(id)).length;
  if (used && !(await confirmBox("Remove from library", `${used} of these are used in the show. They'll be removed from their slides too.`, "Remove", true))) return;
  change((p) => {
    p.media = p.media.filter((m) => !ids.has(m.id));
    for (const s of p.slides) for (const t of s.tiles) if (ids.has(t.mediaId)) t.mediaId = null;
    p.music = p.music.filter((t) => !ids.has(t.mediaId));
  });
  app.libSel.clear();
}

export function refreshLibrary() { lastSig = ""; render(); }
export { currentSlide };
