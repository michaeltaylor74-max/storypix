# Third-party software

## FFmpeg

The Windows downloads of this app include `ffmpeg.exe` and `ffprobe.exe` from the
[FFmpeg project](https://ffmpeg.org), which the app runs as separate programs to read
photos and videos and to encode the finished video. They are unmodified builds from
[gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (or, as a fallback,
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)).

FFmpeg is licensed under the GNU General Public License version 3 (GPL-3.0) in these
builds. The full licence text is included next to `ffmpeg.exe` as `FFMPEG-LICENSE.txt`.

Source code:
- FFmpeg: https://ffmpeg.org/download.html (and https://github.com/FFmpeg/FFmpeg)
- Build scripts / exact sources for the bundled build: https://www.gyan.dev/ffmpeg/builds/

**Mac version:** the Mac download includes `ffmpeg` and `ffprobe` that this project builds
itself (`.github/scripts/build-ffmpeg-macos.sh`) from:

- FFmpeg n9.0.2 — https://github.com/FFmpeg/FFmpeg, commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`
- x264 (stable) — https://code.videolan.org/videolan/x264 via its GitHub mirror, commit `31e19f92f00c7003fa115047ce50978bc98c3a0d`

configured with `--enable-gpl --enable-version3 --enable-libx264`, so the result is licensed under
the GPL-3.0 (licence text included in the app as `FFMPEG-LICENSE.txt`). The exact source code is
attached to every release that includes the Mac version (`ffmpeg-n9.0.2-source.tar.gz`,
`x264-stable-source.tar.gz`), together with the build script in this repository.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.
This app is not affiliated with or endorsed by the FFmpeg project.

## Rust and JavaScript libraries

The app itself is built with [Tauri](https://tauri.app) (MIT / Apache-2.0),
[tiny-skia](https://github.com/RazrFalcon/tiny-skia) (BSD-3-Clause),
[image](https://github.com/image-rs/image) (MIT / Apache-2.0),
[kamadak-exif](https://github.com/kamadak/exif-rs) (BSD-2-Clause),
[rayon](https://github.com/rayon-rs/rayon), [serde](https://serde.rs),
[chrono](https://github.com/chronotope/chrono), [rfd](https://github.com/PolyMeilex/rfd)
(all MIT / Apache-2.0) and their dependencies.
