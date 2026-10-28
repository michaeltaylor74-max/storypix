//! Timing maths shared with ui/js/render.js. Keep the two in sync.

use crate::model::{Project, Slide, Tile};

pub struct Timeline {
    pub starts: Vec<f64>,
    /// Effective transition length *into* slide i (0 for cut).
    pub trans: Vec<f64>,
    pub total: f64,
}

pub fn effective_transition(slides: &[Slide], i: usize) -> f64 {
    let s = &slides[i];
    if s.transition.kind == "cut" || s.transition.duration <= 0.0 {
        return 0.0;
    }
    let mut t = s.transition.duration.min(s.duration / 2.0);
    if i > 0 {
        t = t.min(slides[i - 1].duration / 2.0);
    }
    t.max(0.0)
}

pub fn compute(project: &Project) -> Timeline {
    let slides = &project.slides;
    let mut starts = Vec::with_capacity(slides.len());
    let mut trans = Vec::with_capacity(slides.len());
    let mut t = 0.0;
    for i in 0..slides.len() {
        let tr = effective_transition(slides, i);
        if i > 0 {
            t = starts[i - 1] + slides[i - 1].duration - tr;
        }
        starts.push(t);
        trans.push(tr);
    }
    let total = if slides.is_empty() { 0.0 } else { starts[slides.len() - 1] + slides[slides.len() - 1].duration };
    Timeline { starts, trans, total }
}

/// What to draw at time t.
pub struct FrameSpec {
    /// Incoming / current slide index and its local time.
    pub b: usize,
    pub b_lt: f64,
    /// Outgoing slide (None = from black at the very start) when in a transition.
    pub a: Option<(usize, f64)>,
    pub in_transition: bool,
    pub q: f64,
    /// Multiplier for the final fade to black.
    pub end_alpha: f64,
}

pub fn frame_at(project: &Project, tl: &Timeline, t: f64) -> Option<FrameSpec> {
    let n = project.slides.len();
    if n == 0 {
        return None;
    }
    // latest slide whose start <= t
    let mut b = 0;
    for i in 0..n {
        if tl.starts[i] <= t + 1e-9 {
            b = i;
        } else {
            break;
        }
    }
    let b_lt = t - tl.starts[b];
    let tr = tl.trans[b];
    let mut spec = FrameSpec { b, b_lt, a: None, in_transition: false, q: 1.0, end_alpha: 1.0 };
    if tr > 0.0 && b_lt < tr {
        spec.in_transition = true;
        spec.q = (b_lt / tr).clamp(0.0, 1.0);
        if b > 0 {
            spec.a = Some((b - 1, t - tl.starts[b - 1]));
        }
    }
    let ef = project.settings.end_fade;
    if ef > 0.0 && t > tl.total - ef {
        spec.end_alpha = ((tl.total - t) / ef).clamp(0.0, 1.0);
    }
    Some(spec)
}

pub fn ease_in_out_sine(p: f64) -> f64 {
    0.5 - 0.5 * (std::f64::consts::PI * p.clamp(0.0, 1.0)).cos()
}
pub fn ease_in_out_cubic(p: f64) -> f64 {
    let p = p.clamp(0.0, 1.0);
    if p < 0.5 {
        4.0 * p * p * p
    } else {
        1.0 - (-2.0 * p + 2.0).powi(3) / 2.0
    }
}

/// Ken Burns parameters: (scale, focus_x, focus_y)
pub fn motion(tile: &Tile, p: f64, is_video: bool) -> (f64, f64, f64) {
    let fx = tile.focus_x;
    let fy = tile.focus_y;
    if is_video {
        return (1.0, fx, fy);
    }
    let e = ease_in_out_sine(p);
    let a = tile.motion_amount.max(0.0);
    let span = 0.8;
    match tile.motion.as_str() {
        "zoomIn" => (1.0 + a * e, fx, fy),
        "zoomOut" => (1.0 + a * (1.0 - e), fx, fy),
        "panLeft" => (1.0 + a, (fx - (e - 0.5) * span).clamp(0.0, 1.0), fy),
        "panRight" => (1.0 + a, (fx + (e - 0.5) * span).clamp(0.0, 1.0), fy),
        "panUp" => (1.0 + a, fx, (fy - (e - 0.5) * span).clamp(0.0, 1.0)),
        "panDown" => (1.0 + a, fx, (fy + (e - 0.5) * span).clamp(0.0, 1.0)),
        _ => (1.0, fx, fy),
    }
}

/// Geometry of media inside a tile, in tile-local pixels.
/// Returns (left, top, drawn_w, drawn_h).
pub fn place_media(tile: &Tile, tw: f64, th: f64, iw: f64, ih: f64, scale: f64, fx: f64, fy: f64) -> (f64, f64, f64, f64) {
    let iw = iw.max(1.0);
    let ih = ih.max(1.0);
    let c = if tile.fit == "fit" { (tw / iw).min(th / ih) } else { (tw / iw).max(th / ih) };
    let s = c * tile.zoom.max(0.1) * scale;
    let dw = iw * s;
    let dh = ih * s;
    let ox = dw - tw;
    let oy = dh - th;
    (-ox * fx, -oy * fy, dw, dh)
}

/// Text animation: (alpha, dy in 1080p px)
pub fn text_anim(kind: &str, lt: f64) -> (f64, f64) {
    if kind == "none" {
        return (1.0, 0.0);
    }
    let a = ((lt - 0.3) / 0.8).clamp(0.0, 1.0);
    let ae = 1.0 - (1.0 - a).powi(3);
    match kind {
        "rise" => (ae, (1.0 - ae) * 40.0),
        _ => (ae, 0.0),
    }
}

/// Music level control signal per slide, smoothed. Returns values at 100 Hz.
pub fn music_envelope(project: &Project, tl: &Timeline) -> Vec<f32> {
    let rate = 100.0;
    let n = (tl.total * rate).ceil() as usize + 1;
    let mut ctrl = vec![1.0f32; n];
    let slides = &project.slides;
    let duck = project.settings.duck_level as f32;
    let levels: Vec<f32> = slides
        .iter()
        .map(|s| {
            let mut l = s.music_volume as f32;
            if project.settings.auto_duck && slide_has_live_audio(project, s) {
                l = l.min(duck);
            }
            l
        })
        .collect();
    let mut b = 0usize;
    for (k, c) in ctrl.iter_mut().enumerate() {
        let t = k as f64 / rate;
        while b + 1 < slides.len() && tl.starts[b + 1] <= t {
            b += 1;
        }
        if !slides.is_empty() {
            *c = levels[b];
        }
    }
    // centred moving average, window 0.6 s
    let w = 30usize;
    let mut pre = vec![0f64; n + 1];
    for i in 0..n {
        pre[i + 1] = pre[i] + ctrl[i] as f64;
    }
    (0..n)
        .map(|i| {
            let lo = i.saturating_sub(w);
            let hi = (i + w + 1).min(n);
            ((pre[hi] - pre[lo]) / (hi - lo) as f64) as f32
        })
        .collect()
}

pub fn slide_has_live_audio(project: &Project, s: &Slide) -> bool {
    s.tiles.iter().any(|t| {
        !t.muted
            && t.volume > 0.0
            && t.media_id
                .as_deref()
                .and_then(|id| project.media(id))
                .map(|m| m.kind == "video" && m.has_audio)
                .unwrap_or(false)
    })
}

/// Integer hash used by the mosaic transition (identical in JS).
pub fn hash32(i: u32) -> f64 {
    let mut h = i;
    h ^= h >> 16;
    h = h.wrapping_mul(0x45d9f3b);
    h ^= h >> 16;
    h = h.wrapping_mul(0x45d9f3b);
    h ^= h >> 16;
    h as f64 / 4294967296.0
}
