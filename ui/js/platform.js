// Small platform differences between Windows and macOS (shortcut names, file manager, fonts).
export const IS_MAC = /Mac/i.test(navigator.platform || "") || /Macintosh|Mac OS X/.test(navigator.userAgent || "");
/** Shortcut prefix as people expect to read it: "Ctrl+S" on Windows, "⌘S" on a Mac. */
export const key = (k) => (IS_MAC ? `⌘${k}` : `Ctrl+${k}`);
export const MOD_NAME = IS_MAC ? "⌘" : "Ctrl";
export const FILE_MANAGER = IS_MAC ? "Finder" : "Explorer";
/** Fallback chain used whenever a chosen font isn't installed (e.g. Segoe UI on a Mac). */
export const FONT_FALLBACK = `"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
