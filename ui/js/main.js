// App bootstrap: top bar, file handling, shortcuts, autosave, recovery.
import { h, toast, modal, confirmBox } from "./ui.js";
import { netHosts } from "./state.js";
import { app, on, emit, change, undo, redo, canUndo, canRedo, setProject, currentSlide, currentTile, currentText, selectSlide, selectedSlides, deleteSlides, duplicateSlides, selectItem, reindex } from "./state.js";
import { api, listen, isTauri } from "./backend.js";
import { assets } from "./assets.js";
import { defaultProject, fmtTime, computeTimeline } from "./model.js";
import { initLibrary, importPaths } from "./library.js";
import { initStoryboard } from "./storyboard.js";
import { initEditor, addTextBox, addPhotoBox } from "./editor.js";
import { initProps } from "./props.js";
import { initPlayer, toggle as togglePlay, stop as stopPlay } from "./player.js";
import { openAutoBuild, resetAutoBuild } from "./autobuild.js";
import { openExport } from "./export.js";
import { addMusicFiles } from "./music.js";
import { IS_MAC, key } from "./platform.js";

const AUDIO_RE = /\.(mp3|wav|m4a|aac|flac|ogg|wma|aiff?|opus)$/i;

// ---------- top bar
const nameInput = h("input", { class: "proj-name", value: app.project.name, title: "Show name", onchange: (e) => change((p) => { p.name = e.target.value || "Untitled show"; }) });
const undoBtn = h("button", { class: "icon-btn", title: `Undo (${key("Z")})`, onclick: undo }, "↶");
const redoBtn = h("button", { class: "icon-btn", title: `Redo (${IS_MAC ? "⇧⌘Z" : "Ctrl+Y"})`, onclick: redo }, "↷");
const savedLbl = h("span", { class: "saved muted small" });
document.getElementById("topbar").append(
  h("div", { class: "brand" }, h("span", { class: "logo" }, "▣"), "StoryPix"),
  h("button", { class: "btn ghost", onclick: newShow, title: "New show" }, "New"),
  h("button", { class: "btn ghost", onclick: openShow, title: `Open (${key("O")})` }, "Open…"),
  h("button", { class: "btn ghost", onclick: () => saveShow(), title: `Save (${key("S")})` }, "Save"),
  h("button", { class: "btn ghost", onclick: () => saveShow(true) }, "Save as…"),
  h("span", { class: "sep" }), undoBtn, redoBtn, h("span", { class: "sep" }),
  nameInput, savedLbl,
  h("span", { class: "grow" }),
  h("button", { class: "btn magic", onclick: openAutoBuild, title: "Build a whole show from a folder" }, "✨ Auto Build"),
  h("button", { class: "btn", onclick: () => togglePlay(), title: "Play / pause (Space)" }, "▶ Preview"),
  h("button", { class: "btn primary", onclick: openExport, title: "Make the video file" }, "⬇ Export video"),
  h("button", { class: "icon-btn", title: "Help & shortcuts", onclick: showHelp }, "?"));

document.getElementById("stage-tools").append(
  h("button", { class: "btn small", onclick: addTextBox }, "＋ Text"),
  h("button", { class: "btn small", onclick: addPhotoBox }, "＋ Photo box"),
  h("span", { class: "grow" }),
  h("span", { id: "slide-label", class: "muted small" }));

function refreshChrome() {
  if (document.activeElement !== nameInput) nameInput.value = app.project.name;
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
  document.title = `${app.project.name}${app.dirty ? " •" : ""} — StoryPix`;
  savedLbl.textContent = app.filePath ? (app.dirty ? "unsaved changes" : "saved") : app.project.slides.length ? "not saved yet" : "";
  const s = currentSlide();
  const lbl = document.getElementById("slide-label");
  if (lbl) {
    const i = app.project.slides.indexOf(s);
    lbl.textContent = s ? `Slide ${i + 1} of ${app.project.slides.length} · starts at ${fmtTime(computeTimeline(app.project).starts[i])}` : "";
  }
}
on("change", refreshChrome);
on("dirty", refreshChrome);
on("select", refreshChrome);

// ---------- modules
initLibrary(document.getElementById("left"));
initEditor(document.getElementById("stage-wrap"));
initPlayer(document.getElementById("transport"));
initProps(document.getElementById("right"));
initStoryboard(document.getElementById("storyboard"));

// ---------- backend events
let proxyErrors = 0, proxyErrTimer = null;
listen("proxy-ready", (p) => {
  if (p.error) {
    const m = app.mediaById.get(p.id);
    if (m) m.error = p.error;
    proxyErrors++;
    clearTimeout(proxyErrTimer);
    proxyErrTimer = setTimeout(() => { toast(`${proxyErrors} file(s) couldn't be previewed (they may be damaged or an unusual format)`, "warn", 6000); proxyErrors = 0; }, 1500);
    return;
  }
  assets.setProxy(p.id, { thumb: p.thumb, proxy: p.proxy });
  const m = app.mediaById.get(p.id);
  if (m) { m.thumb = p.thumb; m.proxy = p.proxy; }
});
listen("tauri://drag-drop", async (e) => {
  const paths = e?.paths || [];
  if (!paths.length) return;
  const audio = paths.filter((p) => AUDIO_RE.test(p));
  const other = paths.filter((p) => !AUDIO_RE.test(p));
  if (audio.length) { await addMusicFiles(audio); emit("libtab", "music"); }
  if (other.length) { emit("libtab", "media"); await importPaths(other); }
});

// ---------- files
function serialize() {
  return JSON.stringify(app.project, null, 1);
}
async function confirmDiscard() {
  if (!app.dirty || !app.project.slides.length) return true;
  const v = await modal({ title: "Unsaved changes", body: h("p", {}, "Save your changes to this show first?"), buttons: [{ label: "Cancel", value: null }, { label: "Don't save", value: "discard" }, { label: "Save", value: "save", primary: true }] });
  if (v === "save") return await saveShow();
  return v === "discard";
}
async function newShow() {
  if (!(await confirmDiscard())) return;
  stopPlay(false);
  resetAutoBuild();
  setProject(defaultProject(), null);
  api.clearAutosave().catch(() => {});
}
async function saveShow(as = false) {
  let path = app.filePath;
  if (!path || as) {
    const safe = (app.project.name || "My show").replace(/[\\/:*?"<>|]+/g, "");
    path = await api.pickSave("project", `${safe}.storypix`);
    if (!path) return false;
    if (!/\.(storypix|psproj)$/i.test(path)) path += ".storypix";
  }
  try {
    await api.writeText(path, serialize());
    app.filePath = path;
    app.dirty = false;
    await doAutosave(true);
    emit("dirty");
    toast("Saved", "ok", 1500);
    return true;
  } catch (e) {
    toast(`Couldn't save: ${e}`, "error", 8000);
    return false;
  }
}
async function openShow(pathArg) {
  if (!(await confirmDiscard())) return;
  const path = typeof pathArg === "string" ? pathArg : (await api.pickFiles("project"))[0];
  if (!path) return;
  try {
    const p = JSON.parse(await api.readText(path));
    await loadProject(p, path, false);
  } catch (e) {
    toast(`Couldn't open: ${e}`, "error", 8000);
  }
}
async function loadProject(p, path, dirty) {
  stopPlay(false);
  resetAutoBuild();
  setProject(p, path);
  app.dirty = dirty;
  emit("dirty");
  await checkMissing();
  const items = app.project.media.filter((m) => !m.missing);
  if (items.length) api.requestProxies(items).catch(() => {});
}
async function checkMissing() {
  const media = app.project.media;
  if (!media.length) return;
  const preTrusted = media.length && media.every((m) => netHosts.trusted(m.path));
  let exists = await api.pathsExist(media.map((m) => m.path), preTrusted);
  const net = media.filter((m, i) => exists[i] === null);
  app.networkAllowed = preTrusted;
  if (net.length) {
    const hosts = [...new Set(net.map((m) => m.path.replace(/^[\\/]+/, "").split(/[\\/]/)[0]))];
    const ok = await modal({
      title: "Files on a network location",
      body: h("div", {}, h("p", {}, `${net.length} file(s) in this show are stored on another computer or server: `, h("b", {}, hosts.slice(0, 3).join(", ")), hosts.length > 3 ? "…" : ""),
        h("p", { class: "muted" }, "Only connect if you know and trust where this show came from (for example your school's shared drive).")),
      buttons: [{ label: "Don't connect", value: false }, { label: "Connect", value: true, primary: true }],
    });
    if (ok) {
      exists = await api.pathsExist(media.map((m) => m.path), true);
      netHosts.trust(hosts.map((x) => x.toLowerCase()));
      app.networkAllowed = true;
    }
  }
  let missing = media.filter((m, i) => !exists[i]);
  media.forEach((m, i) => { m.missing = !exists[i]; });
  if (!missing.length) return;
  const v = await modal({
    title: "Some files have moved",
    body: h("div", {}, h("p", {}, `${missing.length} photo(s)/video(s)/song(s) used by this show can't be found where they were (e.g. "${missing[0].name}").`),
      h("p", { class: "muted" }, "If you've copied the show to another computer or moved the folder, point me at the folder that contains them and I'll find them by name.")),
    buttons: [{ label: "Continue without them", value: null }, { label: "Find them in a folder…", value: "find", primary: true }],
  });
  if (v !== "find") return;
  const folder = await api.pickFolder();
  if (!folder) return;
  const groups = await api.listFolder(folder);
  const byName = new Map();
  for (const g of groups) for (const f of g.files) byName.set(f.split(/[\\/]/).pop().toLowerCase(), f);
  let found = 0;
  change((p) => {
    for (const m of missing) {
      const f = byName.get(m.name.toLowerCase());
      if (f) { m.path = f; m.missing = false; m.thumb = m.proxy = null; assets.setProxy(m.id, { thumb: null, proxy: null }); found++; }
    }
  }, { undo: false });
  toast(`Found ${found} of ${missing.length} file(s)`, found === missing.length ? "ok" : "warn", 5000);
  missing = media.filter((m) => m.missing);
}

// ---------- autosave & recovery
async function doAutosave(force = false) {
  if (!force && !app.autosaveDirty) return;
  app.autosaveDirty = false;
  try {
    await api.autosave(JSON.stringify({ filePath: app.filePath, dirty: app.dirty, savedAt: Date.now(), project: app.project }));
  } catch {}
}
setInterval(() => { if (!app.playing) doAutosave(); }, 15000);

async function startup() {
  if (!isTauri && !window.__MOCK_BACKEND__) {
    toast("Running without the desktop backend (preview mode)", "warn", 6000);
    return;
  }
  try {
    const info = await api.info();
    if (!info.ffmpeg) {
      await modal({ title: "Video engine missing", body: h("div", {}, h("p", {}, "StoryPix couldn't find its video engine (ffmpeg), which it needs to read videos and make the final video."), h("p", { class: "muted small" }, `Looked for: ${info.ffmpegPath}`), h("p", {}, "Please reinstall StoryPix using the installer.")), buttons: [{ label: "OK", value: true, primary: true }] });
    }
  } catch {}
  try {
    const raw = await api.loadAutosave();
    if (!raw) return;
    const a = JSON.parse(raw);
    if (!a?.project) return;
    if (a.dirty && a.project.slides?.length) {
      const when = new Date(a.savedAt).toLocaleString();
      const v = await modal({
        title: "Welcome back",
        body: h("div", {}, h("p", {}, `StoryPix has unsaved work from ${when}: “${a.project.name}” (${a.project.slides.length} slides).`), h("p", { class: "muted" }, "Would you like to pick up where you left off?")),
        buttons: [{ label: "Start fresh", value: false }, { label: "Recover my show", value: true, primary: true }],
      });
      if (v) await loadProject(a.project, a.filePath || null, true);
      else api.clearAutosave().catch(() => {});
    } else if (a.filePath) {
      const [ok] = await api.pathsExist([a.filePath], true); // the user saved this show themselves
      if (ok) await openShow(a.filePath);
    }
  } catch (e) {
    console.warn("recovery failed", e);
  }
}

// ---------- shortcuts
document.addEventListener("keydown", (e) => {
  if (document.querySelector(".modal-back")) return;
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); saveShow(e.shiftKey); return; }
  if (ctrl && e.key.toLowerCase() === "o") { e.preventDefault(); openShow(); return; }
  if (ctrl && e.key.toLowerCase() === "e") { e.preventDefault(); openExport(); return; }
  if (typing) return;
  if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (ctrl && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSlides(selectedSlides().map((s) => s.id)); return; }
  if (e.key === " ") { e.preventDefault(); togglePlay(); return; }
  if (e.key === "Escape") { if (app.playing) stopPlay(); else if (app.panMode) { app.panMode = false; emit("select"); } else selectItem(null); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    const s = currentSlide();
    const t = currentText();
    const tile = currentTile();
    if (t) { change(() => { s.texts = s.texts.filter((x) => x.id !== t.id); }); selectItem(null); }
    else if (tile) { change(() => { if (tile.mediaId) tile.mediaId = null; else s.tiles = s.tiles.filter((x) => x.id !== tile.id); }); }
    else if (selectedSlides().length) deleteSlides(selectedSlides().map((x) => x.id));
    e.preventDefault();
    return;
  }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const s = currentSlide();
    const tile = currentTile() || currentText();
    if (tile && !app.panMode) {
      change(() => { tile.rect.x += (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 0.02 : 0.002); });
    } else {
      const sl = app.project.slides, i = sl.indexOf(s);
      const j = Math.max(0, Math.min(sl.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
      if (sl[j]) selectSlide(sl[j].id, e.shiftKey ? "range" : "single");
    }
    e.preventDefault();
  }
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && (currentTile() || currentText())) {
    const tile = currentTile() || currentText();
    change(() => { tile.rect.y += (e.key === "ArrowDown" ? 1 : -1) * (e.shiftKey ? 0.02 : 0.002); });
    e.preventDefault();
  }
});
document.addEventListener("contextmenu", (e) => { if (!e.target.closest("input,textarea")) e.preventDefault(); });

function cacheRow() {
  const lbl = h("span", { class: "muted small" }, "Checking…");
  const btn = h("button", { class: "btn small", onclick: async () => {
    btn.disabled = true;
    const left = await api.clearCache().catch(() => null);
    for (const m of app.project.media) { m.thumb = null; m.proxy = null; assets.setProxy(m.id, { thumb: null, proxy: null }); }
    lbl.textContent = left === null ? "Couldn't clear" : "Cleared. Previews for the open show will be remade.";
    const items = app.project.media.filter((m) => !m.missing);
    if (items.length) api.requestProxies(items).catch(() => {});
  } }, "Clear preview copies");
  api.cacheInfo().then((b) => { lbl.textContent = `Preview copies of photos & videos on this computer: ${(b / 1048576).toFixed(0)} MB (unused ones are deleted automatically after 30 days).`; }).catch(() => { lbl.textContent = ""; });
  return h("div", { class: "row wrap" }, lbl, btn);
}

function showHelp() {
  const rows = [
    ["Space", "Play / pause preview"], [IS_MAC ? "⌘Z / ⇧⌘Z" : "Ctrl+Z / Ctrl+Y", "Undo / redo"], [key("S"), "Save"], [key("O"), "Open"], [key("E"), "Export video"],
    [key("D"), "Duplicate selected slides"], ["Delete", "Remove the selected text / photo / slides"], ["← →", "Previous / next slide (or nudge the selected box)"],
    ["Shift + drag corner", "Resize keeping shape"], ["Alt + drag", "Move without snapping"], ["Double-click photo", "Reposition / zoom the photo inside its box"], ["Esc", "Stop / finish"],
  ];
  modal({
    title: "Help",
    body: h("div", {},
      h("p", {}, "Quick start: ✨ Auto Build → pick your folder and songs → Build. Then tweak any slide, press ▶ Preview, and ⬇ Export video when you're happy."),
      h("table", { class: "keys" }, rows.map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, v)))),
      cacheRow(),
      h("p", { class: "muted small" }, "Uses FFmpeg (ffmpeg.org, GPL-3.0) to read and create video. App code © 2026 Michael Taylor, MIT License."),
      h("p", { class: "muted small" }, `Your work is saved automatically every few seconds in case anything goes wrong. Save (${key("S")}) to keep a .storypix file you can reopen or copy to another computer along with the photos.`)),
    buttons: [{ label: "Close", value: true, primary: true }],
  });
}

reindex();
refreshChrome();
startup();
