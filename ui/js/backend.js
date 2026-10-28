// Thin wrapper over Tauri commands. In a plain browser (testing) a mock can be
// provided as window.__MOCK_BACKEND__.
const T = window.__TAURI__;
const mock = window.__MOCK_BACKEND__;

export const isTauri = !!T;

export function invoke(cmd, args = {}) {
  if (T) return T.core.invoke(cmd, args);
  if (mock && mock[cmd]) return Promise.resolve(mock[cmd](args));
  return Promise.reject(new Error(`No backend for ${cmd}`));
}

export function listen(evt, fn) {
  if (T) return T.event.listen(evt, (e) => fn(e.payload));
  if (mock) (mock.listeners ||= {})[evt] = fn;
  return Promise.resolve(() => {});
}

export function fileSrc(path) {
  if (!path) return "";
  if (T) return T.core.convertFileSrc(path);
  return mock?.fileSrc ? mock.fileSrc(path) : path;
}

export const api = {
  info: () => invoke("app_info"),
  pickFiles: (kind = "media") => invoke("pick_files", { kind }),
  pickFolder: () => invoke("pick_folder"),
  pickSave: (kind, defaultName) => invoke("pick_save", { kind, defaultName }),
  listFolder: (path) => invoke("list_folder", { path }),
  importFiles: (files, folders = null) => invoke("import_files", { files, folders }),
  requestProxies: (items) => invoke("request_proxies", { items }),
  pathsExist: (paths, allowNetwork = false) => invoke("paths_exist", { paths, allowNetwork }),
  writeText: (path, content) => invoke("write_text", { path, content }),
  readText: (path) => invoke("read_text", { path }),
  autosave: (content) => invoke("autosave", { content }),
  loadAutosave: () => invoke("load_autosave"),
  clearAutosave: () => invoke("clear_autosave"),
  saveOverlay: (name, b64) => invoke("save_overlay", { name, b64 }),
  startExport: (req) => invoke("start_export", { req }),
  cancelExport: () => invoke("cancel_export"),
  reveal: (path) => invoke("reveal", { path }),
  openPath: (path) => invoke("open_path", { path }),
  cacheInfo: () => invoke("cache_info"),
  clearCache: () => invoke("clear_cache"),
};
