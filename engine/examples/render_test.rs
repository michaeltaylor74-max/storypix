//! cargo run --release -p storypix-engine --example render_test -- <media dir> <out.mp4>
use storypix_engine::{export, media, model::*};
use std::sync::atomic::AtomicBool;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = std::path::PathBuf::from(&args[1]);
    let out = args[2].clone();
    media::set_tools(media::discover_tools());
    let mut p = Project::default();
    let names = ["land1.jpg", "port1.jpg", "land2.jpg", "sq1.png", "clip1.mp4", "clip2_portrait.mp4", "song1.mp3", "song2.m4a"];
    for (i, n) in names.iter().enumerate() {
        let mut m = media::probe(&dir.join(n)).expect(n);
        m.id = format!("m{i}");
        println!("{} {}x{} dur={:.2} audio={} date={}", m.name, m.width, m.height, m.duration, m.has_audio, m.date);
        let px = media::make_proxies(&m, &dir.join("cache")).unwrap();
        println!("   proxies {:?} {:?}", px.thumb, px.proxy);
        p.media.push(m);
    }
    let tile = |id: &str, x: f64, y: f64, w: f64, h: f64| Tile {
        id: format!("t{id}{x}"),
        rect: Rect { x, y, w, h },
        media_id: Some(id.into()),
        ..Default::default()
    };
    let mut s1 = Slide { id: "s1".into(), duration: 4.0, ..Default::default() };
    s1.tiles.push(Tile { motion: "zoomIn".into(), ..tile("m0", 0.0, 0.0, 1.0, 1.0) });
    s1.transition.kind = "crossfade".into();
    let mut s2 = Slide { id: "s2".into(), duration: 4.0, ..Default::default() };
    s2.tiles.push(Tile { fit: "fit".into(), motion: "panUp".into(), ..tile("m1", 0.0, 0.0, 1.0, 1.0) });
    s2.transition.kind = "pushLeft".into();
    let mut s3 = Slide { id: "s3".into(), duration: 5.0, ..Default::default() };
    s3.style = TileStyle { border: 10.0, border_color: "#ffffff".into(), radius: 16.0, shadow: true };
    s3.tiles.push(Tile { rotation: -4.0, ..tile("m2", 0.03, 0.05, 0.45, 0.42) });
    s3.tiles.push(Tile { rotation: 3.0, ..tile("m3", 0.52, 0.05, 0.45, 0.42) });
    s3.tiles.push(tile("m4", 0.03, 0.52, 0.45, 0.43));
    s3.tiles.push(Tile { fit: "fit".into(), ..tile("m5", 0.52, 0.52, 0.45, 0.43) });
    s3.tiles[2].muted = false;
    s3.transition.kind = "circle".into();
    s3.background = Background { kind: "gradient".into(), color: "#203040".into(), color2: "#a04060".into() };
    let mut s4 = Slide { id: "s4".into(), duration: 4.0, ..Default::default() };
    s4.tiles.push(Tile { muted: false, ..tile("m4", 0.0, 0.0, 1.0, 1.0) });
    s4.transition.kind = "mosaic".into();
    let mut s5 = Slide { id: "s5".into(), duration: 3.0, ..Default::default() };
    s5.tiles.push(Tile { motion: "zoomOut".into(), ..tile("m3", 0.0, 0.0, 1.0, 1.0) });
    s5.transition.kind = "blinds".into();
    p.slides = vec![s1, s2, s3, s4, s5];
    p.music = vec![
        MusicTrack { id: "a".into(), media_id: "m6".into(), ..Default::default() },
        MusicTrack { id: "b".into(), media_id: "m7".into(), ..Default::default() },
    ];
    let req = export::ExportRequest { project: p, out_path: out, ..Default::default() };
    let cancel = AtomicBool::new(false);
    let t = std::time::Instant::now();
    export::export(&req, &cancel, |pr| {
        if pr.frame % 60 == 0 || pr.phase != "Rendering video" {
            println!("{} {:.0}% frame {}/{} eta {:.1}s", pr.phase, pr.frac * 100.0, pr.frame, pr.frames, pr.eta)
        }
    })
    .unwrap();
    println!("took {:.1}s", t.elapsed().as_secs_f64());
}
