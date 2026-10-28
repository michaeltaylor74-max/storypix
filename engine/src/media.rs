//! Media probing, decoding and proxy (thumbnail / preview copy) generation.

use crate::model::MediaItem;
use anyhow::{anyhow, Context, Result};
use image::{DynamicImage, ImageDecoder, ImageReader};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

pub const IMAGE_EXT: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif", "jfif"];
pub const VIDEO_EXT: &[&str] = &["mp4", "mov", "m4v", "avi", "mkv", "wmv", "3gp", "mts", "m2ts", "webm", "mpg", "mpeg"];
pub const AUDIO_EXT: &[&str] = &["mp3", "wav", "m4a", "aac", "flac", "ogg", "wma", "aif", "aiff", "opus"];

#[derive(Clone, Debug)]
pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

static TOOLS: OnceLock<Tools> = OnceLock::new();

pub fn set_tools(t: Tools) {
    let _ = TOOLS.set(t);
}
pub fn tools() -> &'static Tools {
    TOOLS.get_or_init(|| Tools { ffmpeg: "ffmpeg".into(), ffprobe: "ffprobe".into() })
}

/// Locate ffmpeg/ffprobe next to the executable, falling back to PATH.
pub fn discover_tools() -> Tools {
    let exe_name = |n: &str| if cfg!(windows) { format!("{n}.exe") } else { n.to_string() };
    let mut dirs = vec![];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            dirs.push(d.to_path_buf());
            dirs.push(d.join("binaries"));
        }
    }
    let find = |n: &str| -> PathBuf {
        for d in &dirs {
            let p = d.join(exe_name(n));
            if p.is_file() {
                return p;
            }
            // dev builds only: the sidecar keeps its target-triple suffix
            #[cfg(debug_assertions)]
            if let Ok(rd) = std::fs::read_dir(d) {
                for e in rd.flatten() {
                    let f = e.file_name().to_string_lossy().to_string();
                    if f.starts_with(&format!("{n}-")) && (f.ends_with(".exe") || !cfg!(windows)) {
                        return e.path();
                    }
                }
            }
        }
        // Release builds only use the copies shipped next to the app.
        if cfg!(debug_assertions) {
            PathBuf::from(n)
        } else {
            dirs.first().map(|d| d.join(exe_name(n))).unwrap_or_else(|| PathBuf::from(exe_name(n)))
        }
    };
    Tools { ffmpeg: find("ffmpeg"), ffprobe: find("ffprobe") }
}

/// Build a Command that never pops up a console window on Windows.
pub fn command(prog: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(prog);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

pub fn ffmpeg() -> Command {
    let mut c = command(&tools().ffmpeg);
    c.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    c
}

/// True for web addresses (http://, ftp://, …) — never valid media paths.
pub fn is_url(p: &str) -> bool {
    p.contains("://")
}

/// True for Windows network-share paths (\\server\share\…).
pub fn is_network(p: &str) -> bool {
    let p = p.trim_start();
    p.starts_with("\\\\") || p.starts_with("//")
}

/// A path we are willing to hand to ffmpeg / read from disk.
pub fn is_local_media_path(p: &str) -> bool {
    !p.is_empty() && !is_url(p) && !p.starts_with('-') && Path::new(p).is_absolute()
}

pub fn kind_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    if IMAGE_EXT.contains(&ext.as_str()) {
        Some("image")
    } else if VIDEO_EXT.contains(&ext.as_str()) {
        Some("video")
    } else if AUDIO_EXT.contains(&ext.as_str()) {
        Some("audio")
    } else {
        None
    }
}

/// Stable FNV-1a hash used for cache file names.
pub fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn cache_key(path: &Path) -> String {
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{:016x}", fnv(&format!("{}|{}|{}", path.to_string_lossy(), size, mtime)))
}

fn naive_ms(dt: chrono::NaiveDateTime) -> f64 {
    dt.and_utc().timestamp_millis() as f64
}

fn file_mtime_local_ms(path: &Path) -> f64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            naive_ms(dt.naive_local())
        })
        .unwrap_or(0.0)
}

struct ExifInfo {
    orientation: u32,
    date: Option<f64>,
}

fn read_exif(path: &Path) -> Option<ExifInfo> {
    let f = std::fs::File::open(path).ok()?;
    let mut r = std::io::BufReader::new(f);
    let ex = exif::Reader::new().read_from_container(&mut r).ok()?;
    let orientation = ex
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1);
    let date = [exif::Tag::DateTimeOriginal, exif::Tag::DateTimeDigitized, exif::Tag::DateTime]
        .iter()
        .find_map(|tag| {
            let f = ex.get_field(*tag, exif::In::PRIMARY)?;
            if let exif::Value::Ascii(v) = &f.value {
                let s = String::from_utf8_lossy(v.first()?).to_string();
                chrono::NaiveDateTime::parse_from_str(s.trim(), "%Y:%m:%d %H:%M:%S").ok().map(naive_ms)
            } else {
                None
            }
        });
    Some(ExifInfo { orientation, date })
}

/// Probe one file into a MediaItem (id left empty).
pub fn probe(path: &Path) -> Result<MediaItem> {
    if !is_local_media_path(&path.to_string_lossy()) {
        return Err(anyhow!("not a local file"));
    }
    let kind = kind_of(path).ok_or_else(|| anyhow!("unsupported file type"))?;
    let mut m = MediaItem {
        path: path.to_string_lossy().to_string(),
        name: path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
        kind: kind.into(),
        ..Default::default()
    };
    match kind {
        "image" => {
            let exif = read_exif(path);
            let dims = ImageReader::open(path)
                .ok()
                .and_then(|r| r.with_guessed_format().ok())
                .and_then(|r| r.into_dimensions().ok());
            let (mut w, mut h) = match dims {
                Some(d) => d,
                None => {
                    let p = ffprobe(path)?;
                    (p.width, p.height)
                }
            };
            if let Some(e) = &exif {
                if (5..=8).contains(&e.orientation) {
                    std::mem::swap(&mut w, &mut h);
                }
            }
            m.width = w;
            m.height = h;
            m.date = exif.and_then(|e| e.date).unwrap_or_else(|| file_mtime_local_ms(path));
        }
        "video" | "audio" => {
            let p = ffprobe(path)?;
            m.width = p.width;
            m.height = p.height;
            m.duration = p.duration;
            m.has_audio = p.has_audio;
            m.date = p.date.unwrap_or_else(|| file_mtime_local_ms(path));
            if kind == "video" && (p.width == 0 || p.duration <= 0.0) {
                return Err(anyhow!("could not read video"));
            }
        }
        _ => {}
    }
    Ok(m)
}

pub struct ProbeInfo {
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub has_audio: bool,
    pub date: Option<f64>,
}

pub fn ffprobe(path: &Path) -> Result<ProbeInfo> {
    let out = command(&tools().ffprobe)
        .args(["-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(path)
        .stdin(Stdio::null())
        .output()
        .context("running ffprobe")?;
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).context("ffprobe output")?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let mut info = ProbeInfo { width: 0, height: 0, duration: 0.0, has_audio: false, date: None };
    for s in &streams {
        match s["codec_type"].as_str() {
            Some("video") if info.width == 0 => {
                // skip attached cover art
                if s["disposition"]["attached_pic"].as_i64() == Some(1) {
                    continue;
                }
                let mut w = s["width"].as_u64().unwrap_or(0) as u32;
                let mut h = s["height"].as_u64().unwrap_or(0) as u32;
                let mut rot = s["tags"]["rotate"].as_str().and_then(|r| r.parse::<i64>().ok()).unwrap_or(0);
                if let Some(sd) = s["side_data_list"].as_array() {
                    for d in sd {
                        if let Some(r) = d["rotation"].as_i64() {
                            rot = r;
                        } else if let Some(r) = d["rotation"].as_f64() {
                            rot = r as i64;
                        }
                    }
                }
                if rot.rem_euclid(180) == 90 {
                    std::mem::swap(&mut w, &mut h);
                }
                info.width = w;
                info.height = h;
            }
            Some("audio") => info.has_audio = true,
            _ => {}
        }
    }
    info.duration = v["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0);
    if let Some(ct) = v["format"]["tags"]["creation_time"].as_str() {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ct) {
            let local = dt.with_timezone(&chrono::Local);
            // Many cameras write 1970/1904 placeholders
            if local.timestamp() > 946_684_800 {
                info.date = Some(naive_ms(local.naive_local()));
            }
        }
    }
    Ok(info)
}

/// Decode an image with EXIF orientation applied. Falls back to ffmpeg for
/// formats the image crate can't read (e.g. HEIC).
pub fn load_image(path: &Path) -> Result<DynamicImage> {
    let direct = (|| -> Result<DynamicImage> {
        let mut dec = ImageReader::open(path)?.with_guessed_format()?.into_decoder()?;
        let orient = dec.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
        let mut img = DynamicImage::from_decoder(dec)?;
        img.apply_orientation(orient);
        Ok(img)
    })();
    match direct {
        Ok(i) => Ok(i),
        Err(e) => {
            let out = ffmpeg()
                .args(["-protocol_whitelist", "file,pipe,fd", "-i"])
                .arg(path)
                .args(["-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"])
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output()?;
            if out.stdout.is_empty() {
                return Err(anyhow!("cannot decode image: {e}"));
            }
            Ok(image::load_from_memory(&out.stdout)?)
        }
    }
}

/// Load an image scaled so it fits within max_w x max_h (never upscales).
pub fn load_image_scaled(path: &Path, max_w: u32, max_h: u32) -> Result<DynamicImage> {
    let img = load_image(path)?;
    if img.width() > max_w || img.height() > max_h {
        Ok(img.resize(max_w.max(1), max_h.max(1), image::imageops::FilterType::Triangle))
    } else {
        Ok(img)
    }
}

/// Mark a cached preview as recently used so the 30-day clean-up keeps it.
fn touch(p: &Path) {
    if let Ok(f) = std::fs::File::options().write(true).open(p) {
        let _ = f.set_modified(std::time::SystemTime::now());
    }
}

pub struct Proxies {
    pub thumb: Option<String>,
    pub proxy: Option<String>,
}

fn save_jpeg(img: &DynamicImage, path: &Path, q: u8) -> Result<()> {
    let rgb = img.to_rgb8();
    let f = std::fs::File::create(path)?;
    let mut w = std::io::BufWriter::new(f);
    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, q);
    rgb.write_with_encoder(enc)?;
    Ok(())
}

/// Create (or reuse) thumbnail and preview proxy files in cache_dir.
pub fn make_proxies(item: &MediaItem, cache_dir: &Path) -> Result<Proxies> {
    if !is_local_media_path(&item.path) {
        return Err(anyhow!("not a local file"));
    }
    std::fs::create_dir_all(cache_dir)?;
    let path = Path::new(&item.path);
    let key = cache_key(path);
    match item.kind.as_str() {
        "image" => {
            let t = cache_dir.join(format!("{key}_t.jpg"));
            let p = cache_dir.join(format!("{key}_p.jpg"));
            if t.exists() && p.exists() {
                touch(&t);
                touch(&p);
            } else {
                let img = load_image(path)?;
                let proxy = if img.width() > 1600 || img.height() > 1600 {
                    img.resize(1600, 1600, image::imageops::FilterType::Triangle)
                } else {
                    img
                };
                save_jpeg(&proxy.thumbnail(360, 360), &t, 80)?;
                save_jpeg(&proxy, &p, 85)?;
            }
            Ok(Proxies { thumb: Some(t.to_string_lossy().into()), proxy: Some(p.to_string_lossy().into()) })
        }
        "video" => {
            let t = cache_dir.join(format!("{key}_t.jpg"));
            let p = cache_dir.join(format!("{key}_p.mp4"));
            if t.exists() {
                touch(&t);
            } else {
                let at = (item.duration / 3.0).min(1.0);
                let st = ffmpeg()
                    .args(["-y", "-ss", &format!("{at:.3}")])
                    .args(["-protocol_whitelist", "file,pipe,fd", "-i"])
                    .arg(path)
                    .args(["-frames:v", "1", "-vf", "scale=360:360:force_original_aspect_ratio=decrease", "-q:v", "4"])
                    .arg(&t)
                    .stdin(Stdio::null())
                    .status()?;
                if !st.success() {
                    return Err(anyhow!("thumbnail failed"));
                }
            }
            if p.exists() {
                touch(&p);
            } else {
                let tmp = cache_dir.join(format!("{key}_p.tmp.mp4"));
                let st = ffmpeg()
                    .arg("-y")
                    .args(["-protocol_whitelist", "file,pipe,fd", "-i"])
                    .arg(path)
                    .args([
                        "-vf",
                        "scale=960:960:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "27",
                        "-g",
                        "15",
                        "-c:a",
                        "aac",
                        "-b:a",
                        "128k",
                        "-ac",
                        "2",
                        "-movflags",
                        "+faststart",
                    ])
                    .arg(&tmp)
                    .stdin(Stdio::null())
                    .status()?;
                if !st.success() {
                    let _ = std::fs::remove_file(&tmp);
                    return Err(anyhow!("video proxy failed"));
                }
                std::fs::rename(&tmp, &p)?;
            }
            Ok(Proxies { thumb: Some(t.to_string_lossy().into()), proxy: Some(p.to_string_lossy().into()) })
        }
        "audio" => {
            let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if ["wma", "aif", "aiff", "opus"].contains(&ext.as_str()) {
                let p = cache_dir.join(format!("{key}_a.m4a"));
                if !p.exists() {
                    let st = ffmpeg()
                        .arg("-y")
                        .args(["-protocol_whitelist", "file,pipe,fd", "-i"])
                        .arg(path)
                        .args(["-vn", "-c:a", "aac", "-b:a", "192k"])
                        .arg(&p)
                        .stdin(Stdio::null())
                        .status()?;
                    if !st.success() {
                        return Err(anyhow!("audio proxy failed"));
                    }
                }
                Ok(Proxies { thumb: None, proxy: Some(p.to_string_lossy().into()) })
            } else {
                Ok(Proxies { thumb: None, proxy: None })
            }
        }
        _ => Ok(Proxies { thumb: None, proxy: None }),
    }
}

/// Decode an audio segment to interleaved stereo f32 at 48 kHz.
pub fn decode_audio(path: &Path, start: f64, dur: Option<f64>) -> Result<Vec<f32>> {
    let mut c = ffmpeg();
    if start > 0.0 {
        c.args(["-ss", &format!("{start:.3}")]);
    }
    c.args(["-protocol_whitelist", "file,pipe,fd", "-i"]).arg(path);
    if let Some(d) = dur {
        c.args(["-t", &format!("{d:.3}")]);
    }
    c.args(["-vn", "-ac", "2", "-ar", "48000", "-f", "f32le", "-"]);
    let mut child = c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
    let mut buf = vec![];
    child.stdout.take().unwrap().read_to_end(&mut buf)?;
    let _ = child.wait();
    let samples = buf
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    Ok(samples)
}

/// Lists a folder: files directly inside the root are group "", files in any
/// sub folder are grouped by their top-level sub folder name.
pub fn list_folder(root: &Path) -> Vec<(String, Vec<PathBuf>)> {
    let mut groups: std::collections::BTreeMap<String, Vec<PathBuf>> = Default::default();
    fn walk(dir: &Path, root: &Path, groups: &mut std::collections::BTreeMap<String, Vec<PathBuf>>, depth: usize) {
        if depth > 12 {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('$') {
                continue;
            }
            if p.is_dir() {
                walk(&p, root, groups, depth + 1);
            } else if kind_of(&p).is_some() {
                let rel = p.strip_prefix(root).ok().and_then(|r| {
                    let mut comps = r.components();
                    let first = comps.next()?;
                    if comps.next().is_some() {
                        Some(first.as_os_str().to_string_lossy().to_string())
                    } else {
                        Some(String::new())
                    }
                });
                groups.entry(rel.unwrap_or_default()).or_default().push(p);
            }
        }
    }
    walk(root, root, &mut groups, 0);
    groups.into_iter().collect()
}
