//! Frame compositor. Mirrors ui/js/render.js so the export matches the preview.

use crate::model::{parse_color, Background, Project, Slide, Tile};
use crate::timeline::{self, ease_in_out_cubic, hash32};
use std::sync::Arc;
use tiny_skia::*;

pub struct ImgAsset {
    pub pix: Pixmap,
}

/// Everything needed to draw one slide that does not change over time.
pub struct SlideAssets {
    pub background: Arc<Pixmap>,
    pub images: Vec<Option<Arc<ImgAsset>>>,
    pub overlay: Option<Arc<Pixmap>>,
}

pub fn color(c: [u8; 4]) -> Color {
    Color::from_rgba8(c[0], c[1], c[2], c[3])
}

pub fn paint_color(c: [u8; 4]) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color(color(c));
    p.anti_alias = true;
    p
}

pub fn rrect(w: f32, h: f32, r: f32) -> Option<Path> {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    if r < 0.5 {
        return PathBuilder::from_rect(Rect::from_xywh(0.0, 0.0, w.max(0.01), h.max(0.01))?).into();
    }
    let k = 0.5523 * r;
    let mut pb = PathBuilder::new();
    pb.move_to(r, 0.0);
    pb.line_to(w - r, 0.0);
    pb.cubic_to(w - r + k, 0.0, w, r - k, w, r);
    pb.line_to(w, h - r);
    pb.cubic_to(w, h - r + k, w - r + k, h, w - r, h);
    pb.line_to(r, h);
    pb.cubic_to(r - k, h, 0.0, h - r + k, 0.0, h - r);
    pb.line_to(0.0, r);
    pb.cubic_to(0.0, r - k, r - k, 0.0, r, 0.0);
    pb.close();
    pb.finish()
}

/// Convert an image::RgbaImage into a premultiplied tiny-skia pixmap.
pub fn pixmap_from_rgba(img: image::RgbaImage) -> Option<Pixmap> {
    let (w, h) = img.dimensions();
    let mut data = img.into_raw();
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a != 255 {
            px[0] = ((px[0] as u32 * a + 127) / 255) as u8;
            px[1] = ((px[1] as u32 * a + 127) / 255) as u8;
            px[2] = ((px[2] as u32 * a + 127) / 255) as u8;
        }
    }
    Pixmap::from_vec(data, IntSize::from_wh(w, h)?)
}

fn box_blur(img: &mut image::RgbaImage, radius: i32) {
    let (w, h) = (img.width() as i32, img.height() as i32);
    for pass in 0..2 {
        let src = img.clone();
        for y in 0..h {
            for x in 0..w {
                let mut acc = [0u32; 4];
                let mut n = 0u32;
                for d in -radius..=radius {
                    let (sx, sy) = if pass == 0 { ((x + d).clamp(0, w - 1), y) } else { (x, (y + d).clamp(0, h - 1)) };
                    let p = src.get_pixel(sx as u32, sy as u32).0;
                    for c in 0..4 {
                        acc[c] += p[c] as u32;
                    }
                    n += 1;
                }
                img.put_pixel(x as u32, y as u32, image::Rgba([(acc[0] / n) as u8, (acc[1] / n) as u8, (acc[2] / n) as u8, 255]));
            }
        }
    }
}

/// Build the static background layer for a slide.
/// `blur_src` is an already-decoded image used for the blurred background.
pub fn make_background(bg: &Background, blur_src: Option<&image::DynamicImage>, w: u32, h: u32) -> Pixmap {
    let mut pm = Pixmap::new(w, h).unwrap();
    let full = Rect::from_xywh(0.0, 0.0, w as f32, h as f32).unwrap();
    match (bg.kind.as_str(), blur_src) {
        ("blur", Some(src)) => {
            // cover-crop to a tiny image, blur, then scale up
            let (sw, sh) = (192u32, 108u32);
            let small = src.resize_to_fill(sw, sh, image::imageops::FilterType::Triangle).to_rgba8();
            let mut small = small;
            box_blur(&mut small, 5);
            box_blur(&mut small, 5);
            let sp = pixmap_from_rgba(small).unwrap();
            let paint = PixmapPaint { quality: FilterQuality::Bilinear, ..Default::default() };
            pm.draw_pixmap(0, 0, sp.as_ref(), &paint, Transform::from_scale(w as f32 / sw as f32, h as f32 / sh as f32), None);
            pm.fill_rect(full, &paint_color([0, 0, 0, 90]), Transform::identity(), None);
        }
        ("gradient", _) => {
            let c1 = color(parse_color(&bg.color));
            let c2 = color(parse_color(&bg.color2));
            if let Some(shader) = LinearGradient::new(
                Point::from_xy(0.0, 0.0),
                Point::from_xy(w as f32, h as f32),
                vec![GradientStop::new(0.0, c1), GradientStop::new(1.0, c2)],
                SpreadMode::Pad,
                Transform::identity(),
            ) {
                let p = Paint { shader, anti_alias: true, ..Default::default() };
                pm.fill_rect(full, &p, Transform::identity(), None);
            }
        }
        _ => {
            let c = if bg.kind == "blur" { [0, 0, 0, 255] } else { parse_color(&bg.color) };
            pm.fill(color([c[0], c[1], c[2], 255]));
        }
    }
    pm
}

pub struct TileGeom {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn tile_geom(tile: &Tile, w: f64, h: f64) -> TileGeom {
    TileGeom { x: tile.rect.x * w, y: tile.rect.y * h, w: tile.rect.w * w, h: tile.rect.h * h }
}

fn tile_transform(g: &TileGeom, rot: f64) -> Transform {
    Transform::from_translate((g.x + g.w / 2.0) as f32, (g.y + g.h / 2.0) as f32)
        .pre_concat(Transform::from_rotate(rot as f32))
        .pre_translate(-(g.w / 2.0) as f32, -(g.h / 2.0) as f32)
}

/// The pixel size a tile's media will be drawn at (used to pre-scale assets).
pub fn media_draw_size(tile: &Tile, iw: f64, ih: f64, w: f64, h: f64, extra: f64) -> (f64, f64) {
    let g = tile_geom(tile, w, h);
    let (_, _, dw, dh) = timeline::place_media(tile, g.w, g.h, iw, ih, extra, 0.5, 0.5);
    (dw, dh)
}

/// Render one slide at local time lt.
pub fn render_slide(
    project: &Project,
    slide: &Slide,
    assets: &SlideAssets,
    video_frames: &[Option<Arc<Pixmap>>],
    lt: f64,
    w: u32,
    h: u32,
) -> Pixmap {
    let mut pm = (*assets.background).clone();
    let k = h as f64 / 1080.0;
    let p = if slide.duration > 0.0 { (lt / slide.duration).clamp(0.0, 1.0) } else { 0.0 };
    let st = &slide.style;
    for (i, tile) in slide.tiles.iter().enumerate() {
        let g = tile_geom(tile, w as f64, h as f64);
        if g.w < 1.0 || g.h < 1.0 {
            continue;
        }
        let tf = tile_transform(&g, tile.rotation);
        let Some(path) = rrect(g.w as f32, g.h as f32, (st.radius * k) as f32) else { continue };
        let media = tile.media_id.as_deref().and_then(|id| project.media(id));
        let Some(media) = media else { continue };
        let is_video = media.kind == "video";

        if st.shadow {
            for (dx, dy, a) in [(1.0, 3.0, 40u8), (3.0, 7.0, 30), (6.0, 12.0, 22)] {
                let t2 = tf.post_translate((dx * k) as f32, (dy * k) as f32);
                pm.fill_path(&path, &paint_color([0, 0, 0, a]), FillRule::Winding, t2, None);
            }
        }
        // tile backing (for "fit" tiles inside multi layouts)
        let mut mask = Mask::new(w, h).unwrap();
        mask.fill_path(&path, FillRule::Winding, true, tf);

        let (scale, fx, fy) = timeline::motion(tile, p, is_video);
        let (left, top, dw, dh) = timeline::place_media(tile, g.w, g.h, media.width as f64, media.height as f64, scale, fx, fy);
        let src: Option<&Pixmap> = if is_video {
            video_frames.get(i).and_then(|f| f.as_deref())
        } else {
            assets.images.get(i).and_then(|a| a.as_deref()).map(|a| &a.pix)
        };
        if let Some(src) = src {
            let sx = dw / src.width() as f64;
            let sy = dh / src.height() as f64;
            let t = tf.pre_translate(left as f32, top as f32).pre_scale(sx as f32, sy as f32);
            let quality = if (sx - 1.0).abs() < 1e-3 && (sy - 1.0).abs() < 1e-3 && tile.rotation == 0.0 {
                FilterQuality::Nearest
            } else {
                FilterQuality::Bilinear
            };
            let paint = PixmapPaint { quality, ..Default::default() };
            pm.draw_pixmap(0, 0, src.as_ref(), &paint, t, Some(&mask));
        }
        if st.border > 0.0 {
            let stroke = Stroke { width: (st.border * k) as f32, line_join: LineJoin::Round, ..Default::default() };
            pm.stroke_path(&path, &paint_color(parse_color(&st.border_color)), &stroke, tf, None);
        }
    }
    if let Some(ov) = &assets.overlay {
        let (alpha, dy) = timeline::text_anim(&slide.text_anim, lt);
        if alpha > 0.001 {
            let sx = w as f32 / ov.width() as f32;
            let sy = h as f32 / ov.height() as f32;
            let exact = dy.abs() < 0.01 && sx == 1.0 && sy == 1.0;
            let paint = PixmapPaint {
                opacity: alpha as f32,
                quality: if exact { FilterQuality::Nearest } else { FilterQuality::Bilinear },
                ..Default::default()
            };
            let t = Transform::from_translate(0.0, (dy * k) as f32).pre_scale(sx, sy);
            pm.draw_pixmap(0, 0, (**ov).as_ref(), &paint, t, None);
        }
    }
    pm
}

fn draw_full(out: &mut Pixmap, src: &Pixmap, t: Transform, opacity: f32, mask: Option<&Mask>) {
    let is_int = t.sx == 1.0 && t.sy == 1.0 && t.kx == 0.0 && t.ky == 0.0 && t.tx.fract() == 0.0 && t.ty.fract() == 0.0;
    let paint = PixmapPaint {
        opacity,
        quality: if is_int { FilterQuality::Nearest } else { FilterQuality::Bilinear },
        ..Default::default()
    };
    out.draw_pixmap(0, 0, src.as_ref(), &paint, t, mask);
}

fn rect_mask(w: u32, h: u32, rects: &[(f32, f32, f32, f32)]) -> Mask {
    let mut m = Mask::new(w, h).unwrap();
    let mut pb = PathBuilder::new();
    for &(x, y, rw, rh) in rects {
        if rw > 0.0 && rh > 0.0 {
            if let Some(r) = Rect::from_xywh(x, y, rw, rh) {
                pb.push_rect(r);
            }
        }
    }
    if let Some(p) = pb.finish() {
        m.fill_path(&p, FillRule::Winding, false, Transform::identity());
    }
    m
}

pub const TRANSITIONS: &[&str] = &[
    "cut", "crossfade", "fadeBlack", "fadeWhite", "pushLeft", "pushRight", "pushUp", "pushDown", "wipeLeft", "wipeRight",
    "wipeUp", "wipeDown", "coverLeft", "coverRight", "circle", "zoomIn", "zoomOut", "blinds", "mosaic",
];

/// Composite a transition between a (outgoing, None = black) and b (incoming).
pub fn composite(a: Option<&Pixmap>, b: &Pixmap, kind: &str, q: f64) -> Pixmap {
    let (w, h) = (b.width(), b.height());
    let (wf, hf) = (w as f32, h as f32);
    let black = || {
        let mut p = Pixmap::new(w, h).unwrap();
        p.fill(Color::BLACK);
        p
    };
    let a_owned;
    let a = match a {
        Some(a) => a,
        None => {
            a_owned = black();
            &a_owned
        }
    };
    let qe = ease_in_out_cubic(q) as f32;
    let q32 = q as f32;
    let id = Transform::identity();
    let mut out = a.clone();
    match kind {
        "cut" => return b.clone(),
        "fadeBlack" | "fadeWhite" => {
            let c = if kind == "fadeBlack" { [0, 0, 0] } else { [255, 255, 255] };
            let (base, al) = if q < 0.5 { (a, q * 2.0) } else { (b, 2.0 - q * 2.0) };
            out = base.clone();
            let full = Rect::from_xywh(0.0, 0.0, wf, hf).unwrap();
            out.fill_rect(full, &paint_color([c[0], c[1], c[2], (al.clamp(0.0, 1.0) * 255.0) as u8]), id, None);
        }
        "pushLeft" | "pushRight" | "pushUp" | "pushDown" => {
            out = Pixmap::new(w, h).unwrap();
            let (dx, dy) = match kind {
                "pushLeft" => (-1.0, 0.0),
                "pushRight" => (1.0, 0.0),
                "pushUp" => (0.0, -1.0),
                _ => (0.0, 1.0),
            };
            let ax = (dx * qe * wf).round();
            let ay = (dy * qe * hf).round();
            let bx = (-dx * (1.0 - qe) * wf).round();
            let by = (-dy * (1.0 - qe) * hf).round();
            draw_full(&mut out, a, Transform::from_translate(ax, ay), 1.0, None);
            draw_full(&mut out, b, Transform::from_translate(bx, by), 1.0, None);
        }
        "coverLeft" | "coverRight" => {
            let s = if kind == "coverLeft" { 1.0 } else { -1.0 };
            draw_full(&mut out, b, Transform::from_translate((s * (1.0 - qe) * wf).round(), 0.0), 1.0, None);
        }
        "wipeLeft" | "wipeRight" | "wipeUp" | "wipeDown" => {
            let r = match kind {
                "wipeLeft" => ((1.0 - qe) * wf, 0.0, qe * wf, hf),
                "wipeRight" => (0.0, 0.0, qe * wf, hf),
                "wipeUp" => (0.0, (1.0 - qe) * hf, wf, qe * hf),
                _ => (0.0, 0.0, wf, qe * hf),
            };
            let m = rect_mask(w, h, &[r]);
            draw_full(&mut out, b, id, 1.0, Some(&m));
        }
        "circle" => {
            let rad = qe * (wf * wf + hf * hf).sqrt() / 2.0;
            if rad > 0.5 {
                let mut m = Mask::new(w, h).unwrap();
                if let Some(p) = PathBuilder::from_circle(wf / 2.0, hf / 2.0, rad) {
                    m.fill_path(&p, FillRule::Winding, true, id);
                }
                draw_full(&mut out, b, id, 1.0, Some(&m));
            }
        }
        "zoomIn" => {
            out = Pixmap::new(w, h).unwrap();
            let s = 1.0 + 0.25 * qe;
            let t = Transform::from_translate(wf / 2.0, hf / 2.0).pre_scale(s, s).pre_translate(-wf / 2.0, -hf / 2.0);
            draw_full(&mut out, a, t, 1.0, None);
            draw_full(&mut out, b, id, qe, None);
        }
        "zoomOut" => {
            let s = 1.25 - 0.25 * qe;
            let t = Transform::from_translate(wf / 2.0, hf / 2.0).pre_scale(s, s).pre_translate(-wf / 2.0, -hf / 2.0);
            draw_full(&mut out, b, t, qe, None);
        }
        "blinds" => {
            let n = 8;
            let sh = hf / n as f32;
            let rects: Vec<_> = (0..n).map(|i| (0.0, i as f32 * sh, wf, qe * sh + 0.5)).collect();
            let m = rect_mask(w, h, &rects);
            draw_full(&mut out, b, id, 1.0, Some(&m));
        }
        "mosaic" => {
            let (cols, rows) = (32u32, 18u32);
            let cw = wf / cols as f32;
            let ch = hf / rows as f32;
            let mut rects = vec![];
            for i in 0..cols * rows {
                if hash32(i) < q {
                    let cx = (i % cols) as f32 * cw;
                    let cy = (i / cols) as f32 * ch;
                    rects.push((cx.floor(), cy.floor(), cw.ceil() + 1.0, ch.ceil() + 1.0));
                }
            }
            let m = rect_mask(w, h, &rects);
            draw_full(&mut out, b, id, 1.0, Some(&m));
        }
        _ => {
            // crossfade
            draw_full(&mut out, b, id, q32, None);
        }
    }
    out
}

pub fn apply_fade(pm: &mut Pixmap, alpha: f64) {
    if alpha >= 1.0 {
        return;
    }
    let full = Rect::from_xywh(0.0, 0.0, pm.width() as f32, pm.height() as f32).unwrap();
    let a = ((1.0 - alpha).clamp(0.0, 1.0) * 255.0) as u8;
    pm.fill_rect(full, &paint_color([0, 0, 0, a]), Transform::identity(), None);
}
