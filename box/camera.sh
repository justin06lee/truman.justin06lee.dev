#!/usr/bin/env bash
#
# The camera. Reads the USB webcam and publishes it to the local MediaMTX.
#
# A wrapper script rather than a bare ExecStart= because the RTSP url carries
# a credential and systemd's quoting rules make that miserable to get right
# inline — and because audio has to be decided at runtime, see below.
#
set -uo pipefail

[[ -n "${TRUMAN_BOX_KEY:-}" ]] || source /etc/truman/box.env

VIDEO="${TRUMAN_VIDEO_DEVICE:-/dev/video0}"
AUDIO="${TRUMAN_AUDIO_DEVICE:-auto}"
SIZE="${TRUMAN_VIDEO_SIZE:-1280x720}"
FPS="${TRUMAN_VIDEO_FPS:-30}"
BITRATE="${TRUMAN_VIDEO_BITRATE:-2500k}"

# Can this device actually be captured from, right now, by this process?
usable() {
  local dev="$1"
  timeout 5 arecord -q -D "$dev" -d 1 -f S16_LE -r 48000 -c 2 /dev/null 2>/dev/null
}

# Audio is optional and must never take the stream down with it.
#
# `default` routes through PipeWire or PulseAudio, which run per-user — this
# unit runs as root, so there is usually no such device and ffmpeg exits with
# "cannot open audio device default (Host is down)". That killed the whole
# capture, video included, and systemd restarted it into the same wall
# forever. A missing microphone is not a reason to have no picture.
pick_audio() {
  [[ "$AUDIO" == "none" || -z "$AUDIO" ]] && return 1

  if [[ "$AUDIO" != "auto" ]]; then
    usable "$AUDIO" && { echo "$AUDIO"; return 0; }
    echo "audio: $AUDIO could not be opened, continuing without sound" >&2
    return 1
  fi

  # auto: try the plain default, then every hardware capture device alsa
  # knows about. Through plughw, not hw — raw hw refuses anything that isn't
  # exactly S16/48k/stereo, which silently skips every mono usb mic; plughw
  # converts.
  usable default && { echo "default"; return 0; }

  # Usb devices before onboard ones: a mic somebody plugged in is more likely
  # the one they meant than the motherboard's line-in, which opens fine and
  # records silence with perfect confidence. A specific mic is still better
  # pinned by name in TRUMAN_AUDIO_DEVICE (see box.env.example).
  local -a usb=() rest=()
  while read -r card device; do
    if [[ -e "/proc/asound/card${card}/usbid" ]]; then
      usb+=("plughw:${card},${device}")
    else
      rest+=("plughw:${card},${device}")
    fi
  done < <(arecord -l 2>/dev/null | sed -nE 's/^card ([0-9]+):.*device ([0-9]+):.*/\1 \2/p')

  local dev
  for dev in "${usb[@]}" "${rest[@]}"; do
    usable "$dev" && { echo "$dev"; return 0; }
  done

  echo "audio: no capture device worked, continuing without sound" >&2
  return 1
}

ARGS=(-nostdin -loglevel warning
      -f v4l2 -input_format mjpeg -video_size "$SIZE" -framerate "$FPS" -i "$VIDEO")

if SOUND=$(pick_audio); then
  echo "audio: using $SOUND" >&2
  # Opus, not AAC: WebRTC cannot carry AAC and MediaMTX does not transcode, so
  # an AAC stream reaches the browser as video with permanently silent audio.
  ARGS+=(-f alsa -ac 2 -i "$SOUND" -c:a libopus -b:a 96k -ar 48000)
else
  ARGS+=(-an)
fi

# -g is two seconds of keyframe interval. Longer saves bitrate and makes a new
# viewer wait that much longer for the first picture.
ARGS+=(-c:v libx264 -preset veryfast -tune zerolatency
       -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize "$BITRATE"
       -pix_fmt yuv420p -g "$((FPS * 2))"
       -f rtsp -rtsp_transport tcp
       "rtsp://box:${TRUMAN_BOX_KEY}@127.0.0.1:8554/live")

exec ffmpeg "${ARGS[@]}"
