//! Project data model. Mirrors ui/js/model.js — the JSON produced by the editor
//! is deserialised straight into these structs.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub version: u32,
    pub name: String,
    pub settings: Settings,
    pub media: Vec<MediaItem>,
    pub slides: Vec<Slide>,
    pub music: Vec<MusicTrack>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            version: 1,
            name: "Untitled".into(),
            settings: Settings::default(),
            media: vec![],
            slides: vec![],
            music: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub end_fade: f64,
    pub duck_level: f64,
    pub auto_duck: bool,
    pub music_crossfade: f64,
    pub music_volume: f64,
    pub music_fade_out: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: 30,
            end_fade: 1.5,
            duck_level: 0.25,
            auto_duck: true,
            music_crossfade: 2.0,
            music_volume: 0.9,
            music_fade_out: 3.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaItem {
    pub id: String,
    pub path: String,
    pub name: String,
    /// "image" | "video" | "audio"
    pub kind: String,
    /// Display width/height (EXIF / rotation already applied).
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub has_audio: bool,
    /// Local-time milliseconds since epoch (date taken), 0 if unknown.
    pub date: f64,
    /// Folder group (relative sub folder) used by auto build.
    pub folder: String,
    pub thumb: Option<String>,
    pub proxy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Transition {
    pub kind: String,
    pub duration: f64,
}
impl Default for Transition {
    fn default() -> Self {
        Self { kind: "crossfade".into(), duration: 1.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Background {
    /// "blur" | "color" | "gradient"
    pub kind: String,
    pub color: String,
    pub color2: String,
}
impl Default for Background {
    fn default() -> Self {
        Self { kind: "blur".into(), color: "#000000".into(), color2: "#1e3a5f".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TileStyle {
    pub border: f64,
    pub border_color: String,
    pub radius: f64,
    pub shadow: bool,
}
impl Default for TileStyle {
    fn default() -> Self {
        Self { border: 0.0, border_color: "#ffffff".into(), radius: 0.0, shadow: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tile {
    pub id: String,
    pub rect: Rect,
    pub media_id: Option<String>,
    /// "fill" | "fit"
    pub fit: String,
    pub focus_x: f64,
    pub focus_y: f64,
    pub zoom: f64,
    pub motion: String,
    pub motion_amount: f64,
    pub rotation: f64,
    pub trim_start: f64,
    pub trim_end: Option<f64>,
    pub muted: bool,
    pub volume: f64,
    /// Custom "zoom to a spot" path (used when motion == "custom").
    pub kb: Option<KbPath>,
    /// Colour adjustments for this photo / video (None = unchanged).
    pub grade: Option<Grade>,
}

/// Colour grade. All sliders run -100..100 with 0 = unchanged.
/// look: "none" | "bw" (black & white) | "sepia".
/// Mirrors gradeMatrix() in ui/js/model.js exactly, so preview and export match.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Grade {
    pub look: String,
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub warmth: f64,
}

/// 3x4 colour matrix (row-major: r,g,b,offset per output channel) working on 0..1 sRGB values,
/// or None when the grade changes nothing.
pub fn grade_matrix(g: &Grade) -> Option<[f32; 12]> {
    let cl = |v: f64| v.clamp(-100.0, 100.0);
    let (br, co, sa, wa) = (cl(g.brightness), cl(g.contrast), cl(g.saturation), cl(g.warmth));
    let look = g.look.as_str();
    if br == 0.0 && co == 0.0 && sa == 0.0 && wa == 0.0 && look != "bw" && look != "sepia" {
        return None;
    }
    const LR: f64 = 0.2126;
    const LG: f64 = 0.7152;
    const LB: f64 = 0.0722;
    let ident = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let l: [[f64; 3]; 3] = match look {
        "bw" => [[LR, LG, LB], [LR, LG, LB], [LR, LG, LB]],
        "sepia" => [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]],
        _ => ident,
    };
    let s = 1.0 + sa / 100.0;
    let lum = [LR, LG, LB];
    let mut sm = [[0.0; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            sm[r][c] = (1.0 - s) * lum[c] + if r == c { s } else { 0.0 };
        }
    }
    let w = wa / 100.0 * 0.12;
    let wd = [1.0 + w, 1.0, 1.0 - w];
    let c = 1.0 + co / 100.0;
    let b = br / 100.0 * 0.25;
    let mut out = [0f32; 12];
    for r in 0..3 {
        for k in 0..3 {
            // (W * S * L)[r][k]
            let mut v = 0.0;
            for j in 0..3 {
                v += sm[r][j] * l[j][k];
            }
            out[r * 4 + k] = (c * wd[r] * v) as f32;
        }
        out[r * 4 + 3] = (c * (b - 0.5) + 0.5) as f32;
    }
    Some(out)
}

/// A framing of the photo: centre point (fractions of the image) and zoom (1 = fills the box).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct KbFrame {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
impl Default for KbFrame {
    fn default() -> Self {
        Self { x: 0.5, y: 0.5, z: 1.0 }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KbPath {
    pub from: KbFrame,
    pub to: KbFrame,
}
impl Default for Tile {
    fn default() -> Self {
        Self {
            id: String::new(),
            rect: Rect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
            media_id: None,
            fit: "fill".into(),
            focus_x: 0.5,
            focus_y: 0.5,
            zoom: 1.0,
            motion: "none".into(),
            motion_amount: 0.15,
            rotation: 0.0,
            trim_start: 0.0,
            trim_end: None,
            muted: true,
            volume: 1.0,
            kb: None,
            grade: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Slide {
    pub id: String,
    pub duration: f64,
    pub transition: Transition,
    pub background: Background,
    pub style: TileStyle,
    pub tiles: Vec<Tile>,
    /// Texts are rasterised by the UI into an overlay PNG; we only need to know
    /// whether there are any and how they animate.
    pub texts: Vec<serde_json::Value>,
    pub text_anim: String,
    pub music_volume: f64,
    pub layout_id: String,
}
impl Default for Slide {
    fn default() -> Self {
        Self {
            id: String::new(),
            duration: 4.0,
            transition: Transition::default(),
            background: Background::default(),
            style: TileStyle::default(),
            tiles: vec![],
            texts: vec![],
            text_anim: "fade".into(),
            music_volume: 1.0,
            layout_id: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MusicTrack {
    pub id: String,
    pub media_id: String,
    pub trim_start: f64,
    pub trim_end: Option<f64>,
    pub volume: f64,
    /// Extra seconds of silence before this song starts (first song: offset into the show).
    pub delay: f64,
}
impl Default for MusicTrack {
    fn default() -> Self {
        Self { id: String::new(), media_id: String::new(), trim_start: 0.0, trim_end: None, volume: 1.0, delay: 0.0 }
    }
}

impl Project {
    pub fn media(&self, id: &str) -> Option<&MediaItem> {
        self.media.iter().find(|m| m.id == id)
    }
}

/// Parse "#rrggbb" or "#rrggbbaa" into RGBA bytes.
pub fn parse_color(s: &str) -> [u8; 4] {
    let h = s.trim().trim_start_matches('#');
    let p = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("00"), 16).unwrap_or(0);
    match h.len() {
        6 => [p(0), p(2), p(4), 255],
        8 => [p(0), p(2), p(4), p(6)],
        3 => {
            let q = |i: usize| {
                let v = u8::from_str_radix(h.get(i..i + 1).unwrap_or("0"), 16).unwrap_or(0);
                v * 17
            };
            [q(0), q(1), q(2), 255]
        }
        _ => [0, 0, 0, 255],
    }
}

#[cfg(test)]
mod grade_tests {
    use super::*;
    #[test]
    fn grade_matrices_match_ui() {
        let g = |look: &str, b, c, s, w| Grade { look: look.into(), brightness: b, contrast: c, saturation: s, warmth: w };
        assert!(grade_matrix(&Grade::default()).is_none());
        // Same values the UI's gradeMatrix() gives (ui/js/model.js); keep the two in step.
        for (gr, want) in [
            (g("none", 4.0, 6.0, 8.0, 45.0), include!("../tests/grade_warm.txt")),
            (g("bw", 0.0, 12.0, 0.0, 0.0), include!("../tests/grade_bw.txt")),
            (g("sepia", 10.0, -28.0, -30.0, -40.0), include!("../tests/grade_mix.txt")),
        ] {
            let m = grade_matrix(&gr).unwrap();
            for i in 0..12 {
                assert!((m[i] as f64 - want[i]).abs() < 1e-5, "{gr:?} [{i}] {} vs {}", m[i], want[i]);
            }
        }
    }
}
