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
