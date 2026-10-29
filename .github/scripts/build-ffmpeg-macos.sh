#!/usr/bin/env bash
# Builds self-contained ffmpeg + ffprobe for macOS (Apple Silicon and Intel) from pinned sources,
# then joins them into universal binaries. Used by the Mac build in .github/workflows/build.yml.
#
#   build-ffmpeg-macos.sh <output dir>
#
# Sources are fetched by exact commit, so the build is reproducible and can't be swapped:
#   FFmpeg  https://github.com/FFmpeg/FFmpeg  (tag n$FFMPEG_VERSION, commit $FFMPEG_COMMIT)
#   x264    https://github.com/mirror/x264    (stable branch, commit $X264_COMMIT) — mirror of code.videolan.org/videolan/x264
set -euo pipefail
set -x
on_err() {
  set +x
  echo "=== build failed; recent configure logs ==="
  for f in "$WORK"/x264-*/config.log "$WORK"/ff-*/ffbuild/config.log; do
    [ -f "$f" ] && { echo "--- $f"; tail -n 25 "$f"; }
  done
}
trap on_err ERR
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
: "${FFMPEG_COMMIT:?}" "${X264_COMMIT:?}"
MINOS=11.0
WORK="$(pwd)/ffbuild"
export WORK
mkdir -p "$WORK"

fetch() { # repo commit dir
  if [ ! -d "$WORK/$3/.git" ]; then
    git init -q "$WORK/$3"
    git -C "$WORK/$3" remote add origin "$1"
  fi
  git -C "$WORK/$3" fetch -q --depth 1 origin "$2"
  git -C "$WORK/$3" checkout -q --force FETCH_HEAD
  test "$(git -C "$WORK/$3" rev-parse HEAD)" = "$2" || { echo "commit mismatch for $3"; exit 1; }
}
fetch https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_COMMIT" ffmpeg-src
fetch https://github.com/mirror/x264.git "$X264_COMMIT" x264-src
JOBS=$(sysctl -n hw.ncpu)

for ARCH in arm64 x86_64; do
  P="$WORK/prefix-$ARCH"
  rm -rf "$P" && mkdir -p "$P"
  CFL="-arch $ARCH -mmacosx-version-min=$MINOS"
  HOST=$([ "$ARCH" = arm64 ] && echo aarch64-apple-darwin || echo x86_64-apple-darwin)

  # x264 (H.264 encoder used for the finished video)
  rm -rf "$WORK/x264-$ARCH" && cp -R "$WORK/x264-src" "$WORK/x264-$ARCH"
  ( cd "$WORK/x264-$ARCH"
    ./configure --prefix="$P" --host="$HOST" --enable-static --enable-pic --disable-cli \
      --extra-cflags="$CFL" --extra-ldflags="$CFL"
    make -j"$JOBS" && make install )

  # FFmpeg: everything needed to read photos/videos/music and write the MP4.
  rm -rf "$WORK/ff-$ARCH" && mkdir -p "$WORK/ff-$ARCH"
  ( cd "$WORK/ff-$ARCH"
    CROSS=()
    [ "$ARCH" != "$(uname -m)" ] && CROSS=(--enable-cross-compile --target-os=darwin)
    PKG_CONFIG_PATH="$P/lib/pkgconfig" "$WORK/ffmpeg-src/configure" --prefix="$P" --arch="$ARCH" ${CROSS[@]+"${CROSS[@]}"} \
      --cc="clang -arch $ARCH" --extra-cflags="$CFL -I$P/include" --extra-ldflags="$CFL -L$P/lib" \
      --pkg-config-flags="--static" \
      --enable-gpl --enable-libx264 --enable-zlib \
      --disable-autodetect --disable-network --disable-doc --disable-ffplay --disable-debug \
      --enable-videotoolbox --enable-audiotoolbox \
      --disable-shared --enable-static
    make -j"$JOBS" && make install )
  "$P/bin/ffmpeg" -hide_banner -version | head -1 || true   # only runs for the native arch
done

lipo -create "$WORK/prefix-arm64/bin/ffmpeg"  "$WORK/prefix-x86_64/bin/ffmpeg"  -output "$OUT/ffmpeg"
lipo -create "$WORK/prefix-arm64/bin/ffprobe" "$WORK/prefix-x86_64/bin/ffprobe" -output "$OUT/ffprobe"
cp "$WORK/ffmpeg-src/COPYING.GPLv3" "$OUT/FFMPEG-LICENSE.txt"
for b in ffmpeg ffprobe; do
  lipo -info "$OUT/$b"
  # nothing but Apple's own system libraries may be linked
  if otool -L "$OUT/$b" | tail -n +2 | grep -v -E '^\s*(/usr/lib/|/System/Library/)'; then echo "$b links a non-system library"; exit 1; fi
done
"$OUT/ffmpeg" -hide_banner -encoders | grep -q libx264
"$OUT/ffmpeg" -hide_banner -version | head -1
