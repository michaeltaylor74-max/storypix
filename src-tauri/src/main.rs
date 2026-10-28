#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use photostory_engine::{export, media, model::MediaItem};
use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    image_jobs: Mutex<Sender<MediaItem>>,
    video_jobs: Mutex<Sender<MediaItem>>,
    cancel_export: Arc<AtomicBool>,
    exporting: Arc<AtomicBool>,
    cache_dir: PathBuf,
    data_dir: PathBuf,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProxyReady {
    id: String,
    thumb: Option<String>,
    proxy: Option<String>,
    error: Option<String>,
}

fn spawn_workers(app: AppHandle, rx: Receiver<MediaItem>, threads: usize, cache: PathBuf) {
    let rx = Arc::new(Mutex::new(rx));
    for _ in 0..threads {
        let rx = rx.clone();
        let app = app.clone();
        let cache = cache.clone();
        std::thread::spawn(move || loop {
            let job = { rx.lock().unwrap().recv() };
            let Ok(item) = job else { break };
            let res = media::make_proxies(&item, &cache);
            let payload = match res {
                Ok(p) => ProxyReady { id: item.id.clone(), thumb: p.thumb, proxy: p.proxy, error: None },
                Err(e) => ProxyReady { id: item.id.clone(), thumb: None, proxy: None, error: Some(e.to_string()) },
            };
            let _ = app.emit("proxy-ready", payload);
        });
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    ffmpeg: bool,
    ffmpeg_path: String,
    cache_dir: String,
    version: String,
}

#[tauri::command]
fn app_info(state: State<AppState>, app: AppHandle) -> AppInfo {
    let t = media::tools();
    let ok = media::command(&t.ffmpeg).arg("-version").output().map(|o| o.status.success()).unwrap_or(false);
    AppInfo {
        ffmpeg: ok,
        ffmpeg_path: t.ffmpeg.to_string_lossy().into(),
        cache_dir: state.cache_dir.to_string_lossy().into(),
        version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
async fn pick_files(kind: String, window: tauri::WebviewWindow) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = rfd::FileDialog::new().set_parent(&window);
        d = match kind.as_str() {
            "audio" => d.add_filter("Music", media::AUDIO_EXT).add_filter("All files", &["*"]),
            "project" => d.add_filter("PhotoStory project", &["psproj"]),
            _ => {
                let all: Vec<&str> = media::IMAGE_EXT.iter().chain(media::VIDEO_EXT.iter()).copied().collect();
                d.add_filter("Photos & videos", &all)
                    .add_filter("Photos", media::IMAGE_EXT)
                    .add_filter("Videos", media::VIDEO_EXT)
                    .add_filter("All files", &["*"])
            }
        };
        if kind == "project" {
            d.pick_file().map(|p| vec![p.to_string_lossy().to_string()]).unwrap_or_default()
        } else {
            d.pick_files().unwrap_or_default().into_iter().map(|p| p.to_string_lossy().to_string()).collect()
        }
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
async fn pick_folder(window: tauri::WebviewWindow) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || rfd::FileDialog::new().set_parent(&window).pick_folder().map(|p| p.to_string_lossy().to_string()))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn pick_save(kind: String, default_name: String, window: tauri::WebviewWindow) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let d = rfd::FileDialog::new().set_parent(&window).set_file_name(&default_name);
        let d = if kind == "video" {
            d.add_filter("MP4 video", &["mp4"])
        } else {
            d.add_filter("PhotoStory project", &["psproj"])
        };
        d.save_file().map(|p| p.to_string_lossy().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderGroup {
    rel: String,
    files: Vec<String>,
    photos: usize,
    videos: usize,
    audio: usize,
}

#[tauri::command]
async fn list_folder(path: String) -> Vec<FolderGroup> {
    if !media::is_local_media_path(&path) {
        return vec![];
    }
    tauri::async_runtime::spawn_blocking(move || {
        media::list_folder(Path::new(&path))
            .into_iter()
            .map(|(rel, files)| {
                let count = |k: &str| files.iter().filter(|f| media::kind_of(f) == Some(k)).count();
                FolderGroup {
                    rel,
                    photos: count("image"),
                    videos: count("video"),
                    audio: count("audio"),
                    files: files.iter().map(|p| p.to_string_lossy().to_string()).collect(),
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    items: Vec<MediaItem>,
    failed: Vec<String>,
}

/// Probe files (folders are expanded). `folders[i]` tags each file's group.
#[tauri::command]
async fn import_files(files: Vec<String>, folders: Option<Vec<String>>) -> ImportResult {
    tauri::async_runtime::spawn_blocking(move || {
        let mut list: Vec<(PathBuf, String)> = vec![];
        for (i, f) in files.iter().enumerate() {
            if !media::is_local_media_path(f) {
                continue;
            }
            let tag = folders.as_ref().and_then(|v| v.get(i).cloned()).unwrap_or_default();
            let p = PathBuf::from(f);
            if p.is_dir() {
                for (rel, fs) in media::list_folder(&p) {
                    let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    let t = if rel.is_empty() { name } else { rel };
                    for f in fs {
                        list.push((f, t.clone()));
                    }
                }
            } else {
                list.push((p, tag));
            }
        }
        let results: Vec<Result<MediaItem, String>> = list
            .par_iter()
            .map(|(p, tag)| {
                media::probe(p)
                    .map(|mut m| {
                        m.folder = tag.clone();
                        m
                    })
                    .map_err(|e| format!("{}: {}", p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(), e))
            })
            .collect();
        let mut items = vec![];
        let mut failed = vec![];
        for r in results {
            match r {
                Ok(m) => items.push(m),
                Err(e) => failed.push(e),
            }
        }
        ImportResult { items, failed }
    })
    .await
    .unwrap_or(ImportResult { items: vec![], failed: vec!["import crashed".into()] })
}

#[tauri::command]
fn request_proxies(items: Vec<MediaItem>, state: State<AppState>) {
    for it in items {
        let tx = if it.kind == "video" { &state.video_jobs } else { &state.image_jobs };
        let _ = tx.lock().unwrap().send(it);
    }
}

/// Checks whether files exist. Network-share paths are only touched when the
/// user has agreed (allow_network); otherwise they come back as `null` so the
/// UI can ask first. Web addresses are never accepted.
#[tauri::command]
async fn paths_exist(paths: Vec<String>, allow_network: Option<bool>) -> Vec<Option<bool>> {
    let allow = allow_network.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|p| {
                if media::is_url(p) {
                    Some(false)
                } else if media::is_network(p) && !allow {
                    None
                } else {
                    Some(Path::new(p).exists())
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn is_project_path(path: &str) -> bool {
    path.to_lowercase().ends_with(".psproj") && media::is_local_media_path(path)
}

#[tauri::command]
fn write_text(path: String, content: String) -> Result<(), String> {
    if !is_project_path(&path) {
        return Err("Shows can only be saved as .psproj files".into());
    }
    let p = PathBuf::from(&path);
    let tmp = p.with_extension("psproj.tmp_save");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    if !is_project_path(&path) {
        return Err("Only .psproj show files can be opened".into());
    }
    let len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > 64 * 1024 * 1024 {
        return Err("That file is too large to be a show file".into());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn autosave(content: String, state: State<AppState>) -> Result<(), String> {
    let _ = std::fs::create_dir_all(&state.data_dir);
    let p = state.data_dir.join("autosave.json");
    let tmp = state.data_dir.join("autosave.tmp");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_autosave(state: State<AppState>) -> Option<String> {
    std::fs::read_to_string(state.data_dir.join("autosave.json")).ok()
}

#[tauri::command]
fn clear_autosave(state: State<AppState>) {
    let _ = std::fs::remove_file(state.data_dir.join("autosave.json"));
}

fn overlay_dir() -> PathBuf {
    std::env::temp_dir().join(format!("photostory_overlays_{}", std::process::id()))
}

#[tauri::command]
fn save_overlay(name: String, b64: String) -> Result<String, String> {
    use base64::Engine;
    if b64.len() > 200 * 1024 * 1024 {
        return Err("text layer too large".into());
    }
    let dir = overlay_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let data = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()).map_err(|e| e.to_string())?;
    if !data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("text layer is not a PNG image".into());
    }
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let p = dir.join(format!("{safe}.png"));
    std::fs::write(&p, data).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
fn start_export(mut req: export::ExportRequest, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    if !req.out_path.to_lowercase().ends_with(".mp4") || !media::is_local_media_path(&req.out_path) {
        return Err("The video must be saved as a .mp4 file".into());
    }
    // text layers may only come from our own temp folder
    let od = overlay_dir();
    req.overlays.retain(|_, p| Path::new(p).parent() == Some(od.as_path()) && p.to_lowercase().ends_with(".png"));
    if state.exporting.swap(true, Ordering::SeqCst) {
        return Err("An export is already running".into());
    }
    state.cancel_export.store(false, Ordering::SeqCst);
    let cancel = state.cancel_export.clone();
    let exporting = state.exporting.clone();
    std::thread::spawn(move || {
        let app2 = app.clone();
        let res = export::export(&req, &cancel, move |p| {
            let _ = app2.emit("export-progress", p);
        });
        let _ = std::fs::remove_dir_all(overlay_dir());
        match res {
            Ok(()) => {
                let _ = app.emit("export-done", req.out_path.clone());
            }
            Err(e) => {
                let _ = app.emit("export-error", e.to_string());
            }
        }
        exporting.store(false, Ordering::SeqCst);
    });
    Ok(())
}

#[tauri::command]
fn cancel_export(state: State<AppState>) {
    state.cancel_export.store(true, Ordering::SeqCst);
}

/// Only real, existing local files/folders with no quote characters.
fn safe_existing(path: &str) -> bool {
    !path.contains('"') && media::is_local_media_path(path) && Path::new(path).exists()
}

#[tauri::command]
fn reveal(path: String) {
    if !safe_existing(&path) {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", path)).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(Path::new(&path).parent().unwrap_or(Path::new("/")))
            .spawn();
    }
}

/// Opens a finished video in the default player. Nothing else may be launched.
#[tauri::command]
fn open_path(path: String) {
    let ext = Path::new(&path).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !safe_existing(&path) || !Path::new(&path).is_file() || !["mp4", "mov", "m4v"].contains(&ext.as_str()) {
        return;
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(&path).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
    }
}

fn dir_size(d: &Path) -> u64 {
    std::fs::read_dir(d)
        .map(|rd| rd.flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum())
        .unwrap_or(0)
}

/// Delete preview copies that haven't been (re)created for `days` days.
fn prune_cache(d: &Path, days: u64) {
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(days * 86_400);
    if let Ok(rd) = std::fs::read_dir(d) {
        for e in rd.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).map(|t| t < cutoff).unwrap_or(false);
            if old {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

#[tauri::command]
fn cache_info(state: State<AppState>) -> u64 {
    dir_size(&state.cache_dir)
}

#[tauri::command]
fn clear_cache(state: State<AppState>) -> u64 {
    if let Ok(rd) = std::fs::read_dir(&state.cache_dir) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    dir_size(&state.cache_dir)
}

fn main() {
    media::set_tools(media::discover_tools());
    tauri::Builder::default()
        .setup(|app| {
            let cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir().join("photostory")).join("proxies");
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("photostory_data"));
            let _ = std::fs::create_dir_all(&cache_dir);
            let _ = std::fs::create_dir_all(&data_dir);
            {
                let c = cache_dir.clone();
                std::thread::spawn(move || prune_cache(&c, 45));
            }
            let (itx, irx) = channel::<MediaItem>();
            let (vtx, vrx) = channel::<MediaItem>();
            let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
            spawn_workers(app.handle().clone(), irx, cores.saturating_sub(1).clamp(2, 8), cache_dir.clone());
            spawn_workers(app.handle().clone(), vrx, 1, cache_dir.clone());
            app.manage(AppState {
                image_jobs: Mutex::new(itx),
                video_jobs: Mutex::new(vtx),
                cancel_export: Arc::new(AtomicBool::new(false)),
                exporting: Arc::new(AtomicBool::new(false)),
                cache_dir,
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            pick_files,
            pick_folder,
            pick_save,
            list_folder,
            import_files,
            request_proxies,
            paths_exist,
            write_text,
            read_text,
            autosave,
            load_autosave,
            clear_autosave,
            save_overlay,
            start_export,
            cancel_export,
            reveal,
            open_path,
            cache_info,
            clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running PhotoStory");
}
