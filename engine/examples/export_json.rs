//! cargo run --release -p storypix-engine --example export_json -- request.json [path-prefix-from path-prefix-to]
use storypix_engine::{export, media};
use std::sync::atomic::AtomicBool;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut s = std::fs::read_to_string(&a[1]).unwrap();
    if a.len() > 3 { s = s.replace(&a[2], &a[3]); }
    media::set_tools(media::discover_tools());
    let req: export::ExportRequest = serde_json::from_str(&s).expect("parse request");
    println!("slides {} media {} music {} overlays {} -> {}", req.project.slides.len(), req.project.media.len(), req.project.music.len(), req.overlays.len(), req.out_path);
    let t = std::time::Instant::now();
    export::export(&req, &AtomicBool::new(false), |p| if p.frame % 300 == 0 { println!("{} {:.0}% eta {:.0}s", p.phase, p.frac * 100.0, p.eta) }).unwrap();
    println!("took {:.1}s", t.elapsed().as_secs_f64());
}
