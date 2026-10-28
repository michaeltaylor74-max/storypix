# PhotoStory

A photo & video slideshow maker for school end-of-year (and any other) shows.
Built because the commercial options kept crashing and nagging for upgrades.

## Install

Go to **Releases** (right-hand side of the GitHub page) and download the newest
**PhotoStory-Setup.exe**. Run it. That's it — everything it needs (including the
ffmpeg video engine) is inside.

No-install option: download **PhotoStory-portable.zip**, unzip anywhere, run `PhotoStory.exe`
(keep `ffmpeg.exe` and `ffprobe.exe` next to it).

Windows may show a blue "Windows protected your PC" box the first time because the app
isn't code-signed: click **More info → Run anyway**.

**Only download PhotoStory from this repository's Releases page.** Each release lists the
SHA-256 fingerprint of every file. To check yours, run this in PowerShell and compare:
`Get-FileHash .\PhotoStory-Setup.exe`

## Privacy & safety

- The app never connects to the internet and sends nothing anywhere. (The installer may
  download Microsoft's WebView2 component if your PC doesn't already have it.)
- Your photos stay where they are; small preview copies are kept in the app's cache folder
  and deleted automatically after 45 days unused (or straight away via Help → Clear preview copies).
- If a show file refers to photos on another computer or network share, the app asks before
  connecting. Web addresses are never followed.

## Quick start

1. **✨ Auto Build** → *Choose folder…* (sub-folders like `Year 7`, `Year 8` become sections —
   tick / untick / reorder them and rename their title slides).
2. Add your songs. Choose *as long as the music* or a set length.
3. Pick the pace, photos-per-slide mix, transitions, frame style. The summary on the right
   tells you how long each photo will be on screen and suggests what to do if there are
   too many or too few photos.
4. **Build my show**, then tweak anything: drag photos onto boxes, change layouts (1–9 per
   slide), resize / rotate / reposition boxes, add text, trim videos, change transitions.
5. **▶ Preview**, then **⬇ Export video** (MP4, 720p–4K).

Your work autosaves every 15 seconds; if the app or PC dies you'll be offered your show back.
Save with Ctrl+S to keep a `.psproj` file.

## Features

- Photos (JPG, PNG, HEIC*, WebP, TIFF…) and videos (MP4, MOV, AVI, MKV…)
- Layouts with 1–9 photos per slide, free resize / move / rotate, snapping guides
- Frame styles: clean, white frame, rounded, polaroid (tilted), thin line
- 19 transitions, Ken Burns pan & zoom, blurred backgrounds behind portrait photos
- Text boxes with fonts, outline, shadow, backing band, fade / rise animation
- Music playlist with crossfades, trim, per-song volume, "fit show to music"
- Video clips: trim, mute / unmute, volume; music automatically dips under clip sound
  (and you can lower music manually per slide)
- Auto Build with folder ordering, burst-duplicate skipping and pacing advice
- Undo / redo, autosave & crash recovery, relink moved files when opening on another PC

\* HEIC decoding depends on the bundled ffmpeg build.

## For developers

- `engine/` — Rust renderer (tiny-skia compositor, ffmpeg piping, audio mixer)
- `src-tauri/` — Tauri 2 desktop shell
- `ui/` — plain HTML/CSS/JS editor (no build step)

Build locally on Windows: install Rust, put `ffmpeg-x86_64-pc-windows-msvc.exe` and
`ffprobe-x86_64-pc-windows-msvc.exe` in `src-tauri/binaries/`, then
`cd src-tauri && npx @tauri-apps/cli@2 build`. GitHub Actions does this automatically on
every push to `main` (download it from the run's *Artifacts*) and publishes a public
release when a version tag such as `v0.3.0` is pushed. All build tools and the bundled
ffmpeg are pinned to exact versions, and ffmpeg's download is checked against a known
SHA-256 fingerprint.
