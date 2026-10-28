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
