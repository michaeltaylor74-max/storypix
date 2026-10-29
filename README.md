# StoryPix

**Website: https://getstorypix.com** · [Step-by-step guide](https://getstorypix.com/guide.html)

A photo & video slideshow maker for school end-of-year (and any other) shows.
Built because the commercial options kept crashing and nagging for upgrades.

## Install

Go to **Releases** (right-hand side of the GitHub page) and download the newest
**StoryPix-Setup.exe**. Run it. That's it — everything it needs (including the
ffmpeg video engine) is inside.

No-install option: download **StoryPix-portable.zip**, unzip anywhere, run `StoryPix.exe`
(keep `ffmpeg.exe` and `ffprobe.exe` next to it).

### Mac (beta)

Download **StoryPix-Mac-beta.dmg** (macOS 11 Big Sur or later, Apple Silicon or Intel),
open it and drag **StoryPix** into **Applications**.

The Mac version isn't signed by Apple yet, so the first time you open it macOS says it
can't check StoryPix for malware:

1. Click **Done** (not *Move to Bin*).
2. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**
   next to the StoryPix message. Confirm with your password.

After that it opens normally. If macOS ever says the app *is damaged*, open **Terminal** and run
`xattr -dr com.apple.quarantine /Applications/StoryPix.app`, then open it again.

The Mac version is new — please [report anything odd](https://github.com/michaeltaylor74-max/storypix/issues).

### "isn't commonly downloaded" / "Windows protected your PC"

StoryPix is free and new, and its installer isn't code-signed yet, so Windows and Edge
are cautious about it. This is normal for new free software. To get past the warnings:

1. **In Microsoft Edge**, when the download shows *"StoryPix-Setup.exe isn't commonly
   downloaded"*: hover over it, click **⋯** → **Keep** → **Show more** → **Keep anyway**.
   (Chrome: click **Keep** / **Download anyway** if it asks.)
2. **When you run it**, if a blue *"Windows protected your PC"* box appears:
   click **More info** → **Run anyway**.

**Only download StoryPix from this repository's
[Releases page](https://github.com/michaeltaylor74-max/storypix/releases).**
To check your copy is genuine, compare its SHA-256 fingerprint with the one listed in the
release notes. In PowerShell:

```powershell
Get-FileHash .\StoryPix-Setup.exe
```

On a Mac, in Terminal: `shasum -a 256 ~/Downloads/StoryPix-Mac-beta.dmg`

## Privacy & safety

- The app never connects to the internet and sends nothing anywhere. (The installer may
  download Microsoft's WebView2 component if your PC doesn't already have it.)
- Your photos stay where they are; small preview copies are kept in the app's cache folder
  and deleted automatically after 30 days unused (or straight away via Help → Clear preview copies).
- If a show file refers to photos on another computer or network share, the app asks before
  connecting. Web addresses are never followed.

## Code signing policy

StoryPix has applied to the [SignPath Foundation](https://signpath.org) for free code
signing. **Until that is approved, releases are not code-signed.** Once approved:
free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

- Committers and reviewers: [Michael Taylor](https://github.com/michaeltaylor74-max) (maintainer)
- Approvers: [Michael Taylor](https://github.com/michaeltaylor74-max)

Every release is built automatically from this repository's source code by GitHub Actions
(see `.github/workflows/build.yml`), and each signing request is approved manually.

**Privacy:** this program will not transfer any information to other networked systems
unless specifically requested by the user or the person installing or operating it.
(The installer may download Microsoft's WebView2 runtime if it is missing.)

**Uninstalling:** use Windows *Settings → Apps → Installed apps → StoryPix → Uninstall*.
The portable version can simply be deleted. On a Mac, drag StoryPix from Applications to the Bin.

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
Save with Ctrl+S to keep a `.storypix` file.

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

The Mac build runs on GitHub's macOS machines: ffmpeg and x264 are compiled from source at
pinned commits (`.github/scripts/build-ffmpeg-macos.sh`), the engine is tested by rendering a
short video, and the app is built as a universal (Apple Silicon + Intel) `.dmg`.
