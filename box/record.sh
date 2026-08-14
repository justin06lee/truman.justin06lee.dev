#!/usr/bin/env bash
#
# The timelapse recorder, driven by systemd (truman-record.service).
#
# It does NOT capture the session and compress it afterwards. ffmpeg discards
# frames in the filter graph and encodes only the survivors, so twelve hours
# of 1080p costs about 20 MB instead of 50 GB, "rendering" is finished the
# moment you stop, and the full-rate video never touches the disk — there is
# no original to delete and no window where hours of the room sit on a drive
# waiting for a cleanup job that might not run.
#
#   setpts=PTS/400  scale the timestamps first: 400x
#   fps=30          then resample to the output rate
#   -an             timelapses have no audio
#   +frag_keyframe  a power cut leaves a playable file, not a corrupt one
#
# The order is not interchangeable. Selecting first and re-stamping after
# (fps=3/40,setpts=N/(30*TB)) picks the right frames and then fails to
# renumber them: measured against a 400s source it produces 13.4s instead of
# 1s. Scaling first is exact at every duration tested. See lib/timelapse.ts.
#
# Three steps, so systemd owns the process lifecycle and we own the bookends:
#
#   begin    stamp the session id and start time      (ExecStartPre)
#   capture  exec ffmpeg in the foreground            (ExecStart)
#   finish   measure the clip and file it with truman (ExecStopPost)
#
set -euo pipefail

# systemd passes these via EnvironmentFile; sourcing is for running by hand.
[[ -n "${TRUMAN_BOX_KEY:-}" ]] || source /etc/truman/box.env

SPEED=400
OUT_FPS=30

CLIPS="${TRUMAN_CLIPS:-/var/lib/truman/clips}"
STATE="/run/truman"
STAMPFILE="$STATE/record.started"
IDFILE="$STATE/record.id"
RTSP="rtsp://box:${TRUMAN_BOX_KEY}@127.0.0.1:8554/live"

mkdir -p "$CLIPS" "$STATE"

begin() {
  date -u +%Y-%m-%dT%H-%M-%SZ > "$IDFILE"
  date +%s%3N > "$STAMPFILE"
  echo "session $(cat "$IDFILE") begins"
}

capture() {
  local id; id="$(cat "$IDFILE")"

  # The agent starts the camera and the recorder together, so the publish may
  # not have landed yet. Wait for it rather than failing into a restart loop.
  local waited=0
  until ffprobe -v quiet -rtsp_transport tcp -i "$RTSP" -show_entries format=duration 2>/dev/null; do
    (( waited += 1 ))
    if (( waited > 30 )); then
      echo "no stream to record after 30s" >&2
      exit 1
    fi
    sleep 1
  done

  # exec, so systemd's KillSignal=SIGINT reaches ffmpeg itself and it gets to
  # write the trailer instead of being killed mid-atom.
  exec ffmpeg -nostdin -loglevel warning \
    -rtsp_transport tcp -i "$RTSP" \
    -an \
    -vf "setpts=PTS/${SPEED},fps=${OUT_FPS}" -r "$OUT_FPS" \
    -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
    -movflags +frag_keyframe+empty_moov \
    "$CLIPS/$id.mp4"
}

finish() {
  [[ -f "$IDFILE" && -f "$STAMPFILE" ]] || { echo "no session to file" >&2; exit 0; }

  local id started ended source_seconds file bytes frames
  id="$(cat "$IDFILE")"
  started="$(cat "$STAMPFILE")"
  ended="$(date +%s%3N)"
  source_seconds=$(( (ended - started) / 1000 ))
  file="$CLIPS/$id.mp4"

  rm -f "$IDFILE" "$STAMPFILE"

  # A session that never got a frame — camera never came up, or it was
  # switched off within a few seconds — is not an episode.
  if [[ ! -s "$file" ]]; then
    echo "no clip was written for $id" >&2
    rm -f "$file"
    exit 0
  fi

  bytes="$(stat -c%s "$file")"
  # What ffmpeg actually produced, which can be fewer than the wall clock
  # implies if the stream dropped mid-session. The site prefers this number
  # over its own arithmetic for exactly that reason.
  frames="$(ffprobe -v error -select_streams v:0 -count_frames \
              -show_entries stream=nb_read_frames -of csv=p=0 "$file" 2>/dev/null || echo "")"

  # A poster for the shelf: one frame from the middle of the clip, which is
  # far more likely to catch the room lived-in than the first frame's empty
  # chair. Same name, .jpg for .mp4 — the site derives the url by convention
  # and simply shows nothing for episodes recorded before posters existed.
  # Best-effort on purpose: an episode without a poster is an episode.
  clip_len="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file" 2>/dev/null || echo "")"
  if [[ -n "$clip_len" ]]; then
    ffmpeg -nostdin -loglevel error -y \
      -ss "$(awk "BEGIN{print $clip_len/2}")" -i "$file" \
      -frames:v 1 -q:v 4 "$CLIPS/$id.jpg" 2>/dev/null || true
  fi

  curl -fsS --retry 3 --retry-delay 2 -X POST "$TRUMAN_SITE/api/episodes/record" \
    -H "Authorization: Bearer $TRUMAN_BOX_KEY" \
    -H 'content-type: application/json' \
    -d "$(printf '{"id":"%s","startedAt":%s,"endedAt":%s,"path":"/clips/%s.mp4","bytes":%s%s}' \
          "$id" "$started" "$ended" "$id" "$bytes" \
          "$([[ -n "$frames" ]] && printf ',"frames":%s' "$frames")")" \
    >/dev/null

  echo "filed $id — ${source_seconds}s of source, $(( source_seconds / SPEED ))s of clip"
}

case "${1:-}" in
  begin)   begin ;;
  capture) capture ;;
  finish)  finish ;;
  *) echo "usage: record.sh begin|capture|finish" >&2; exit 2 ;;
esac
