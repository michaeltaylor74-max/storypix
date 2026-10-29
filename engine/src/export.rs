//! Full video export: renders every frame and pipes it to ffmpeg (H.264 MP4).

use crate::audio;
use crate::media::{self, ffmpeg};
use crate::model::{Project, Slide};
use crate::render::{self, ImgAsset, SlideAssets};
use crate::timeline::{self, FrameSpec};
use anyhow::{anyhow, Context, Result};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tiny_skia::Pixmap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportRequest {
    pub project: Project,
    /// slide id -> PNG path with the rasterised text layer
    pub overlays: HashMap<String, String>,
    pub out_path: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// x264 CRF (lower = better)
    pub crf: u32,
    pub preset: String,
    /// The user has agreed to use files on network shares (\\\\server\\share).
    pub allow_network: bool,
}
impl Default for ExportRequest {
    fn default() -> Self {
        Self {
            project: Project::default(),
            overlays: HashMap::new(),
            out_path: String::new(),
            width: 1920,
            height: 1080,
            fps: 30,
            crf: 19,
            preset: "medium".into(),
            allow_network: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub frac: f64,
    pub frame: u64,
    pub frames: u64,
    pub eta: f64,
}

struct VideoReader {
    child: Child,
    out: ChildStdout,
    w: u32,
    h: u32,
    idx: i64,
    last: Option<Arc<Pixmap>>,
    ended: bool,
}

impl VideoReader {
    fn new(path: &Path, start: f64, dur: f64, w: u32, h: u32, fps: u32) -> Result<Self> {
        let mut c = ffmpeg();
        if start > 0.0 {
            c.args(["-ss", &format!("{start:.3}")]);
        }
        c.args(["-protocol_whitelist", "file,pipe,fd", "-i"]).arg(path);
        c.args(["-t", &format!("{:.3}", dur.max(0.05))]);
        c.args([
            "-an",
            "-vf",
            &format!("fps={fps},scale={w}:{h}:flags=bicubic,setsar=1"),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-",
        ]);
        let mut child = c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
        let out = child.stdout.take().unwrap();
        Ok(Self { child, out, w, h, idx: -1, last: None, ended: false })
    }

    fn advance_to(&mut self, target: i64) -> Option<Arc<Pixmap>> {
        while self.idx < target && !self.ended {
            let mut buf = vec![0u8; (self.w * self.h * 4) as usize];
            match self.out.read_exact(&mut buf) {
                Ok(()) => {
                    for px in buf.chunks_exact_mut(4) {
                        px[3] = 255;
                    }
                    self.last = Pixmap::from_vec(buf, tiny_skia::IntSize::from_wh(self.w, self.h).unwrap()).map(Arc::new);
                    self.idx += 1;
                }
                Err(_) => self.ended = true,
            }
        }
        self.last.clone()
    }
}

impl Drop for VideoReader {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn even(x: f64) -> u32 {
    let v = x.round().max(2.0) as u32;
    v + (v & 1)
}

/// Size a video tile's frames are decoded at.
fn video_size(slide: &Slide, ti: usize, project: &Project, w: u32, h: u32) -> Option<(u32, u32)> {
    let tile = &slide.tiles[ti];
    let m = project.media(tile.media_id.as_deref()?)?;
    let extra = if tile.motion == "custom" { timeline::max_zoom(tile) / tile.zoom.max(1.0) } else { 1.0 };
    let (dw, dh) = render::media_draw_size(tile, m.width as f64, m.height as f64, w as f64, h as f64, extra);
    // cap extreme zooms to keep memory sane
    let cap = 4096.0;
    let s = (cap / dw.max(dh)).min(1.0);
    Some((even(dw * s), even(dh * s)))
}

fn video_frame_for_blur(path: &Path, at: f64) -> Option<image::DynamicImage> {
    let out = ffmpeg()
        .args(["-ss", &format!("{:.3}", at.max(0.0))])
        .args(["-protocol_whitelist", "file,pipe,fd", "-i"])
        .arg(path)
        .args(["-frames:v", "1", "-vf", "scale='trunc(iw*sar/2)*2':ih,setsar=1,scale=400:-2", "-f", "image2pipe", "-vcodec", "png", "-"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    image::load_from_memory(&out.stdout).ok()
}

pub fn load_slide_assets(project: &Project, slide: &Slide, overlay: Option<&String>, w: u32, h: u32) -> SlideAssets {
    let images: Vec<Option<Arc<ImgAsset>>> = slide
        .tiles
        .par_iter()
        .map(|tile| {
            let m = project.media(tile.media_id.as_deref()?)?;
            if m.kind != "image" {
                return None;
            }
            let extra = timeline::max_zoom(tile) / tile.zoom.max(1.0);
            let (dw, dh) = render::media_draw_size(tile, m.width as f64, m.height as f64, w as f64, h as f64, extra);
            let img = media::load_image_scaled(Path::new(&m.path), dw.ceil() as u32 + 2, dh.ceil() as u32 + 2).ok()?;
            let pix = render::pixmap_from_rgba(img.to_rgba8())?;
            Some(Arc::new(ImgAsset { pix }))
        })
        .collect();
    let blur_src = if slide.background.kind == "blur" {
        slide.tiles.iter().find_map(|t| {
            let m = project.media(t.media_id.as_deref()?)?;
            if m.kind == "image" {
                media::load_image_scaled(Path::new(&m.path), 400, 400).ok()
            } else if m.kind == "video" {
                video_frame_for_blur(Path::new(&m.path), t.trim_start + 0.5)
            } else {
                None
            }
        })
    } else {
        None
    };
    let background = Arc::new(render::make_background(&slide.background, blur_src.as_ref(), w, h));
    let overlay = overlay
        .filter(|p| p.to_lowercase().ends_with(".png") && media::is_local_media_path(p))
        .and_then(|p| Pixmap::load_png(p).ok())
        .map(Arc::new);
    SlideAssets { background, images, overlay }
}

pub fn export(req: &ExportRequest, cancel: &AtomicBool, progress: impl Fn(Progress) + Sync) -> Result<()> {
    if !req.out_path.to_lowercase().ends_with(".mp4") || !media::is_local_media_path(&req.out_path) {
        return Err(anyhow!("The video must be saved as a .mp4 file on this computer or a network drive."));
    }
    // Only ever read local files that exist; anything else is treated as missing.
    let mut cleaned = req.project.clone();
    for m in &mut cleaned.media {
        let declined_share = media::is_network(&m.path) && !req.allow_network;
        if declined_share || !media::is_local_media_path(&m.path) || !Path::new(&m.path).is_file() {
            m.path.clear();
        }
    }
    let project = &cleaned;
    let (w, h, fps) = (req.width.clamp(16, 7680) & !1, req.height.clamp(16, 4320) & !1, req.fps.clamp(10, 60));
    let tl = timeline::compute(project);
    if project.slides.is_empty() || tl.total <= 0.0 {
        return Err(anyhow!("The show has no slides."));
    }
    let frames = (tl.total * fps as f64).ceil() as u64;
    let tmp = std::env::temp_dir().join(format!("storypix_export_{}", std::process::id()));
    std::fs::create_dir_all(&tmp)?;
    let wav = tmp.join("mix.wav");

    // ---- audio
    progress(Progress { phase: "Mixing audio".into(), frac: 0.0, frame: 0, frames, eta: 0.0 });
    let mixed = audio::mix(project, &tl, cancel, |f| {
        progress(Progress { phase: "Mixing audio".into(), frac: f * 0.03, frame: 0, frames, eta: 0.0 })
    })?;
    audio::write_wav(&wav, &mixed)?;
    drop(mixed);
    if cancel.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(anyhow!("Export cancelled"));
    }

    // ---- encoder
    let out_path = PathBuf::from(&req.out_path);
    let mut enc = ffmpeg()
        .args(["-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{w}x{h}"), "-r", &fps.to_string(), "-protocol_whitelist", "pipe,fd", "-i", "-"])
        .args(["-protocol_whitelist", "file,pipe,fd", "-i"])
        .arg(&wav)
        .args([
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-preset",
            &req.preset,
            "-crf",
            &req.crf.to_string(),
            "-pix_fmt",
            "yuv420p",
            "-profile:v",
            "high",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-shortest",
        ])
        .arg(&out_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("Could not start ffmpeg, the video engine that comes with StoryPix. Try reinstalling StoryPix.")?;
    let mut stdin = enc.stdin.take().unwrap();
    let mut stderr = enc.stderr.take().unwrap();
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let mut assets: HashMap<usize, Arc<SlideAssets>> = HashMap::new();
    let mut readers: HashMap<(usize, usize), VideoReader> = HashMap::new();
    let started = Instant::now();
    let batch = fps as u64;
    let mut f0 = 0u64;
    let result: Result<()> = (|| {
        while f0 < frames {
            if cancel.load(Ordering::Relaxed) {
                return Err(anyhow!("Export cancelled"));
            }
            let f1 = (f0 + batch).min(frames);
            let specs: Vec<FrameSpec> = (f0..f1)
                .map(|f| timeline::frame_at(project, &tl, f as f64 / fps as f64).unwrap())
                .collect();
            // slides needed in this batch
            let mut needed: Vec<usize> = specs.iter().flat_map(|s| [Some(s.b), s.a.map(|a| a.0)]).flatten().collect();
            needed.sort();
            needed.dedup();
            let min_needed = needed[0];
            assets.retain(|k, _| *k >= min_needed);
            readers.retain(|k, _| k.0 >= min_needed);
            let missing: Vec<usize> = needed.iter().copied().filter(|i| !assets.contains_key(i)).collect();
            let loaded: Vec<(usize, SlideAssets)> = missing
                .par_iter()
                .map(|&i| {
                    let s = &project.slides[i];
                    (i, load_slide_assets(project, s, req.overlays.get(&s.id), w, h))
                })
                .collect();
            for (i, a) in loaded {
                assets.insert(i, Arc::new(a));
            }
            // video frames, sequential per reader
            let mut vframes: Vec<HashMap<usize, Vec<Option<Arc<Pixmap>>>>> = Vec::with_capacity(specs.len());
            for spec in &specs {
                let mut map = HashMap::new();
                for (si, lt) in [Some((spec.b, spec.b_lt)), spec.a].into_iter().flatten() {
                    let slide = &project.slides[si];
                    let mut v = vec![None; slide.tiles.len()];
                    for (ti, tile) in slide.tiles.iter().enumerate() {
                        let Some(m) = tile.media_id.as_deref().and_then(|id| project.media(id)) else { continue };
                        if m.kind != "video" {
                            continue;
                        }
                        if !readers.contains_key(&(si, ti)) {
                            let Some((vw, vh)) = video_size(slide, ti, project, w, h) else { continue };
                            let clip_end = tile.trim_end.unwrap_or(m.duration).min(m.duration);
                            let len = (clip_end - tile.trim_start).max(0.05).min(slide.duration + 0.5);
                            match VideoReader::new(Path::new(&m.path), tile.trim_start, len, vw, vh, fps) {
                                Ok(r) => {
                                    readers.insert((si, ti), r);
                                }
                                Err(_) => continue,
                            }
                        }
                        let r = readers.get_mut(&(si, ti)).unwrap();
                        let target = (lt * fps as f64 + 1e-6).floor().max(0.0) as i64;
                        v[ti] = r.advance_to(target);
                    }
                    map.insert(si, v);
                }
                vframes.push(map);
            }
            // render in parallel
            let rendered: Vec<Pixmap> = specs
                .par_iter()
                .zip(vframes.par_iter())
                .map(|(spec, vf)| {
                    let render_one = |si: usize, lt: f64| {
                        let s = &project.slides[si];
                        let empty = vec![];
                        render::render_slide(project, s, &assets[&si], vf.get(&si).unwrap_or(&empty), lt, w, h)
                    };
                    let b = render_one(spec.b, spec.b_lt);
                    let mut frame = if spec.in_transition {
                        let a = spec.a.map(|(ai, alt)| render_one(ai, alt));
                        render::composite(a.as_ref(), &b, &project.slides[spec.b].transition.kind, spec.q)
                    } else {
                        b
                    };
                    render::apply_fade(&mut frame, spec.end_alpha);
                    frame
                })
                .collect();
            for pm in rendered {
                stdin.write_all(pm.data()).map_err(|e| anyhow!("Encoder stopped: {e}"))?;
            }
            f0 = f1;
            let el = started.elapsed().as_secs_f64();
            let frac = f0 as f64 / frames as f64;
            let eta = if frac > 0.0 { el / frac * (1.0 - frac) } else { 0.0 };
            progress(Progress { phase: "Rendering video".into(), frac: 0.03 + 0.96 * frac, frame: f0, frames, eta });
        }
        Ok(())
    })();
    readers.clear();
    drop(stdin);
    if result.is_err() {
        let _ = enc.kill();
    }
    let status = enc.wait()?;
    let errtext = err_thread.join().unwrap_or_default();
    let _ = std::fs::remove_dir_all(&tmp);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&out_path);
        return Err(e);
    }
    if !status.success() {
        return Err(anyhow!("ffmpeg failed: {}", errtext.lines().rev().take(5).collect::<Vec<_>>().join(" | ")));
    }
    progress(Progress { phase: "Done".into(), frac: 1.0, frame: frames, frames, eta: 0.0 });
    Ok(())
}
