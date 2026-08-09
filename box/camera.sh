#!/usr/bin/env bash
#
# The camera. Reads the USB webcam and publishes it to the local MediaMTX.
#
# A wrapper script rather than a bare ExecStart= because the RTSP url carries
# a credential and systemd's quoting rules make that miserable to get right
# inline.
#
set -euo pipefail

[[ -n "${TRUMAN_BOX_KEY:-}" ]] || source /etc/truman/box.env

VIDEO="${TRUMAN_VIDEO_DEVICE:-/dev/video0}"
AUDIO="${TRUMAN_AUDIO_DEVICE:-default}"
SIZE="${TRUMAN_VIDEO_SIZE:-1280x720}"
FPS="${TRUMAN_VIDEO_FPS:-30}"
BITRATE="${TRUMAN_VIDEO_BITRATE:-2500k}"

exec ffmpeg -nostdin -loglevel warning \
  -f v4l2 -input_format mjpeg -video_size "$SIZE" -framerate "$FPS" -i "$VIDEO" \
  -f alsa -ac 2 -i "$AUDIO" \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize "$BITRATE" \
  -pix_fmt yuv420p -g "$((FPS * 2))" \
  -c:a libopus -b:a 96k -ar 48000 \
  -f rtsp -rtsp_transport tcp \
  "rtsp://box:${TRUMAN_BOX_KEY}@127.0.0.1:8554/live"

# Opus, not AAC: WebRTC cannot carry AAC and MediaMTX does not transcode, so
# an AAC stream reaches the browser as video with permanently silent audio.
#
# -g is two seconds of keyframe interval. Longer saves bitrate and makes a new
# viewer wait that much longer for the first picture.
