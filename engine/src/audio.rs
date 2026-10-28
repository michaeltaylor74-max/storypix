//! Soundtrack mixer: music playlist with crossfades + automatic ducking under
//! video clip audio, plus the clips' own sound.

use crate::media::decode_audio;
use crate::model::Project;
use crate::timeline::{self, Timeline};
use anyhow::Result;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

pub const SR: usize = 48000;

pub fn mix(project: &Project, tl: &Timeline, cancel: &AtomicBool, mut progress: impl FnMut(f64)) -> Result<Vec<f32>> {
    let total = tl.total;
    let n = (total * SR as f64).ceil() as usize;
    let mut buf = vec![0f32; n * 2];
    let env = timeline::music_envelope(project, tl);
    let env_at = |t: f64| -> f32 {
        let x = t * 100.0;
        let i = x.floor() as usize;
        if i + 1 >= env.len() {
            return *env.last().unwrap_or(&1.0);
        }
        let f = (x - i as f64) as f32;
        env[i] * (1.0 - f) + env[i + 1] * f
    };
    let s = &project.settings;
    let fade_out = s.music_fade_out.max(s.end_fade).max(0.1);
    let sched = music_schedule(project);
    let jobs = (sched.len() + 1) as f64;
    for (j, it) in sched.iter().enumerate() {
        if it.start >= total || cancel.load(Ordering::Relaxed) {
            break;
        }
        let want = it.len.min(total - it.start + 0.1);
        if it.path.is_empty() {
            continue;
        }
        let samples = match decode_audio(Path::new(&it.path), it.trim_start, Some(want)) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let frames = samples.len() / 2;
        let g = (s.music_volume * it.volume) as f32;
        let start = (it.start * SR as f64) as usize;
        let flen = frames as f64 / SR as f64;
        for i in 0..frames {
            let o = start + i;
            if o >= n {
                break;
            }
            let t = o as f64 / SR as f64;
            let local = i as f64 / SR as f64;
            let mut a = g;
            if it.fade_in > 0.0 {
                a *= (local / it.fade_in).min(1.0) as f32;
            }
            if it.fade_out > 0.0 {
                a *= ((it.len.min(flen) - local) / it.fade_out).clamp(0.0, 1.0) as f32;
            }
            if t > total - fade_out {
                a *= ((total - t) / fade_out).clamp(0.0, 1.0) as f32;
            }
            a *= env_at(t);
            buf[o * 2] += samples[i * 2] * a;
            buf[o * 2 + 1] += samples[i * 2 + 1] * a;
        }
        progress((j + 1) as f64 / jobs);
    }

    // video clip audio
    for (si, slide) in project.slides.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        for tile in &slide.tiles {
            let Some(m) = tile.media_id.as_deref().and_then(|id| project.media(id)) else { continue };
            if m.kind != "video" || !m.has_audio || tile.muted || tile.volume <= 0.0 {
                continue;
            }
            let clip_end = tile.trim_end.unwrap_or(m.duration).min(m.duration);
            let len = (clip_end - tile.trim_start).min(slide.duration).max(0.0);
            if len < 0.05 {
                continue;
            }
            let samples = match decode_audio(Path::new(&m.path), tile.trim_start, Some(len)) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let frames = samples.len() / 2;
            let start = (tl.starts[si] * SR as f64) as usize;
            let fade = (0.08 * SR as f64) as usize;
            let g = tile.volume as f32;
            for i in 0..frames {
                let o = start + i;
                if o >= n {
                    break;
                }
                let mut a = g;
                if i < fade {
                    a *= i as f32 / fade as f32;
                }
                if frames - i < fade {
                    a *= (frames - i) as f32 / fade as f32;
                }
                buf[o * 2] += samples[i * 2] * a;
                buf[o * 2 + 1] += samples[i * 2 + 1] * a;
            }
        }
    }

    // soft limiter + final fade
    let ef = s.end_fade;
    for (i, v) in buf.iter_mut().enumerate() {
        let t = (i / 2) as f64 / SR as f64;
        let mut x = *v;
        let ax = x.abs();
        if ax > 0.8 {
            x = x.signum() * (0.8 + 0.2 * ((ax - 0.8) / 0.2).tanh());
        }
        if ef > 0.0 && t > total - ef {
            x *= ((total - t) / ef).clamp(0.0, 1.0) as f32;
        }
        *v = x;
    }
    progress(1.0);
    Ok(buf)
}

pub struct ScheduledTrack {
    pub path: String,
    pub trim_start: f64,
    pub volume: f64,
    pub start: f64,
    pub len: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

/// Where each song plays in the show. Mirrors musicSchedule() in ui/js/model.js.
pub fn music_schedule(project: &Project) -> Vec<ScheduledTrack> {
    let cf = project.settings.music_crossfade.max(0.0);
    let mut out: Vec<ScheduledTrack> = vec![];
    let mut pos = 0.0f64;
    for t in &project.music {
        let Some(m) = project.media(&t.media_id) else { continue };
        let end = t.trim_end.unwrap_or(m.duration).min(m.duration);
        let len = (end - t.trim_start).max(0.0);
        if len <= 0.05 {
            continue;
        }
        let delay = t.delay.max(0.0);
        let cross = !out.is_empty() && delay == 0.0 && cf > 0.0;
        let base = if cross {
            let prev_len = out.last().unwrap().len;
            pos - cf.min(len / 2.0).min(prev_len / 2.0)
        } else {
            pos
        };
        let start = base + delay;
        let fade_in = if cross { pos - base } else if t.trim_start > 0.3 { 1.0 } else { 0.0 };
        if cross {
            out.last_mut().unwrap().fade_out = pos - base;
        }
        out.push(ScheduledTrack {
            path: m.path.clone(),
            trim_start: t.trim_start,
            volume: t.volume,
            start,
            len,
            fade_in,
            fade_out: if t.trim_end.is_some() { 0.5 } else { 0.0 },
        });
        pos = start + len;
    }
    out
}

pub fn write_wav(path: &Path, samples: &[f32]) -> Result<()> {
    use std::io::Write;
    let f = std::fs::File::create(path)?;
    let mut w = std::io::BufWriter::new(f);
    let data_len = (samples.len() * 2) as u32;
    w.write_all(b"RIFF")?;
    w.write_all(&(36 + data_len).to_le_bytes())?;
    w.write_all(b"WAVEfmt ")?;
    w.write_all(&16u32.to_le_bytes())?;
    w.write_all(&1u16.to_le_bytes())?; // PCM
    w.write_all(&2u16.to_le_bytes())?;
    w.write_all(&(SR as u32).to_le_bytes())?;
    w.write_all(&((SR * 4) as u32).to_le_bytes())?;
    w.write_all(&4u16.to_le_bytes())?;
    w.write_all(&16u16.to_le_bytes())?;
    w.write_all(b"data")?;
    w.write_all(&data_len.to_le_bytes())?;
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        w.write_all(&v.to_le_bytes())?;
    }
    Ok(())
}
