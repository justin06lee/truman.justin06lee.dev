#!/usr/bin/env bash
#
# The agent. Asks the website whether the camera should be running, makes that
# true, and reports back what is actually happening.
#
# The direction matters: the box reaches out, the site never reaches in. That
# is why none of this needs an inbound connection to the house, why it works
# behind CGNAT, and why the kill switch works from a phone.
#
# It owns both units, which is what makes an episode match a *sitting* rather
# than a stream. Letting MediaMTX start the recorder on first frame would end
# the episode every time the usb blipped and file two clips for one session.
#
set -euo pipefail

[[ -n "${TRUMAN_BOX_KEY:-}" ]] || source /etc/truman/box.env

INTERVAL="${TRUMAN_POLL_SECONDS:-5}"
CAMERA="truman-camera.service"
RECORDER="truman-record.service"

running() { systemctl --quiet is-active "$CAMERA"; }

# Whether frames are actually arriving, which is not the same question as
# whether the camera process is up: ffmpeg crash-looping on a bad pixel format
# leaves the unit "active" while nothing reaches a viewer. Reporting the unit
# would make the badge on the website say "live" over a black screen, which is
# the one thing it exists not to do.
#
# Falls back to the unit when the api is unreachable — an older mediamtx.yml
# without `api: yes` should degrade to the previous behaviour, not to always
# reporting dark.
publishing() {
  local body
  body="$(curl -fsS -m 3 "http://127.0.0.1:9997/v3/paths/get/live" 2>/dev/null)" || {
    running; return
  }
  [[ "$body" == *'"ready":true'* ]]
}

start_session() {
  systemctl start "$CAMERA"
  # Recorder second: it waits for the publish to land, but starting it first
  # would just make it wait longer for no reason.
  systemctl start "$RECORDER"
}

stop_session() {
  # Recorder first, while the stream is still up, so ffmpeg closes cleanly and
  # ExecStopPost can measure a finished file.
  systemctl stop "$RECORDER"
  systemctl stop "$CAMERA"
}

# A clean shutdown should still file the episode rather than orphan it.
trap 'stop_session; exit 0' TERM INT

while true; do
  desired="$(curl -fsS -m 10 \
    -H "Authorization: Bearer $TRUMAN_BOX_KEY" \
    "$TRUMAN_SITE/api/stream/desired" 2>/dev/null \
    | grep -o '"live":[a-z]*' | cut -d: -f2 || echo "")"

  # An unreachable site is not an instruction. Leaving the units as they are
  # means a flaky connection can't switch the camera on, and can't cut a
  # session short either.
  case "$desired" in
    true)  running || start_session ;;
    false) running && stop_session ;;
    *)     ;;
  esac

  live=false
  publishing && live=true

  curl -fsS -m 10 -X POST "$TRUMAN_SITE/api/stream/report" \
    -H "Authorization: Bearer $TRUMAN_BOX_KEY" \
    -H 'content-type: application/json' \
    -d "{\"live\":$live}" >/dev/null 2>&1 || true

  sleep "$INTERVAL"
done
