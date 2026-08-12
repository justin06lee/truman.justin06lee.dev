#!/usr/bin/env bash
#
# Checks the box against the deployed site, in the order things actually fail.
# Run it any time something is wrong; the first FAIL is the one to fix.
#
#   ./doctor.sh
#
set -uo pipefail

pass() { printf "  \033[32mok\033[0m    %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; BAD=1; }
info() { printf "        %s\n" "$1"; }
BAD=0

echo "truman doctor"
echo

# ---------------------------------------------------------------- environment
if [[ -r /etc/truman/box.env ]]; then
  set -a; . /etc/truman/box.env; set +a
  pass "/etc/truman/box.env is readable"
else
  fail "/etc/truman/box.env is missing — run sudo ./install.sh"; exit 1
fi

[[ -n "${TRUMAN_BOX_KEY:-}" ]] && pass "TRUMAN_BOX_KEY is set" \
  || fail "TRUMAN_BOX_KEY is empty — paste it from the site's env"
[[ -n "${TRUMAN_SITE:-}" ]] && pass "TRUMAN_SITE is ${TRUMAN_SITE}" \
  || fail "TRUMAN_SITE is empty"

# --------------------------------------------------------------------- camera
DEV="${TRUMAN_VIDEO_DEVICE:-/dev/video0}"
if [[ -e "$DEV" ]]; then
  pass "camera device $DEV exists"
else
  fail "no camera at $DEV"
  info "cameras present: $(ls /dev/video* 2>/dev/null | tr '\n' ' ' || echo none)"
  info "identify yours with: v4l2-ctl --list-devices"
fi

# ----------------------------------------------------------------------- site
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 \
  -H "Authorization: Bearer $TRUMAN_BOX_KEY" \
  "$TRUMAN_SITE/api/stream/desired" 2>/dev/null)

case "$CODE" in
  200) pass "the site accepts this box's key" ;;
  401) fail "the site rejected the key (401)"
       info "TRUMAN_BOX_KEY here must byte-match the one in the Vercel env" ;;
  000) fail "could not reach $TRUMAN_SITE at all"
       info "check the url, and that this box has internet" ;;
  *)   fail "unexpected response from the site: HTTP $CODE" ;;
esac

# -------------------------------------------------------------------- mediamtx
if systemctl --quiet is-active mediamtx; then
  pass "mediamtx is running"
  if curl -s -o /dev/null -m 5 "http://127.0.0.1:8889"; then
    pass "webrtc port 8889 answers locally"
  else
    fail "nothing listening on 8889 — check: journalctl -u mediamtx -n 30"
  fi
else
  fail "mediamtx is not running — sudo systemctl enable --now mediamtx"
fi

# -------------------------------------------------------------- publish + path
if systemctl --quiet is-active truman-camera; then
  if ffprobe -v quiet -rtsp_transport tcp \
       -i "rtsp://box:${TRUMAN_BOX_KEY}@127.0.0.1:8554/live" \
       -show_entries format=duration >/dev/null 2>&1; then
    pass "the camera is publishing to rtsp://…/live"
    SOUND=$(journalctl -u truman-camera -n 200 --no-pager 2>/dev/null \
              | grep -oE 'audio: (using .*|no capture device worked.*|.* could not be opened.*)' | tail -1)
    [[ -n "$SOUND" ]] && info "$SOUND"
    # Name every capture device in the exact form box.env takes, so choosing
    # the right microphone is a copy-paste rather than an alsa lesson.
    if arecord -l 2>/dev/null | grep -q '^card'; then
      info "mics alsa can see — to pin one: TRUMAN_AUDIO_DEVICE=..."
      arecord -l 2>/dev/null \
        | sed -nE 's/^card [0-9]+: ([^ ]+) \[([^]]*)\].*device ([0-9]+): .*/  plughw:CARD=\1,DEV=\3   (\2)/p' \
        | while IFS= read -r line; do info "$line"; done
    fi
  else
    fail "camera unit is up but nothing is on the 'live' path"
    info "check: journalctl -u truman-camera -n 30"
  fi
else
  info "camera is off — that is normal when the switch is off"
fi

# ------------------------------------------------------------------ the agent
if systemctl --quiet is-active truman-agent; then
  pass "the agent is running"
else
  fail "the agent is not running — sudo systemctl enable --now truman-agent"
fi

# --------------------------------------------------- is anything really live?
READY=$(curl -fsS -m 3 http://127.0.0.1:9997/v3/paths/get/live 2>/dev/null || true)
if [[ -z "$READY" ]]; then
  info "mediamtx api not answering — 'live' on the site will fall back to"
  info "  'is the camera unit up', which can say live over a black screen"
elif [[ "$READY" == *'"ready":true'* ]]; then
  pass "mediamtx has frames on the 'live' path"
else
  if systemctl --quiet is-active truman-camera; then
    fail "camera unit is up but mediamtx has no frames — ffmpeg is failing"
    info "this is the case that looks like 'live' with a black screen"
    info "check: journalctl -u truman-camera -n 40 --no-pager"
    info "a wrong pixel format or size is the usual cause; compare"
    info "  TRUMAN_VIDEO_SIZE/FPS against: v4l2-ctl -d $DEV --list-formats-ext"
  else
    info "nothing publishing — normal while the switch is off"
  fi
fi

# ------------------------------------------------------------------- outward
PUBLIC=$(curl -s -m 5 https://api.ipify.org 2>/dev/null)
MEDIA_HOST=$(grep -oE '^[a-z0-9.-]+\.[a-z]+' /etc/caddy/Caddyfile 2>/dev/null | head -1)
if [[ -n "$MEDIA_HOST" ]]; then
  info "caddy serves: $MEDIA_HOST"
  RESOLVED=$(getent hosts "$MEDIA_HOST" | awk '{print $1}' | head -1)
  [[ -n "$RESOLVED" ]] && info "  resolves to $RESOLVED" \
                       || info "  does not resolve yet — dns not pointed here"
fi
if [[ -n "$MEDIA_HOST" ]]; then
  if systemctl --quiet is-active caddy; then
    pass "caddy is running"
  else
    fail "caddy is not running — viewers have no https endpoint to fetch video from"
    info "this is the black-screen-while-live case. fix: sudo systemctl enable --now caddy"
  fi
  # Caddy itself, reached over loopback. This proves the server and its
  # certificate are good without involving dns or the router at all.
  LOCALCODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 \
    --resolve "$MEDIA_HOST:443:127.0.0.1" "https://$MEDIA_HOST" 2>/dev/null)
  if [[ "$LOCALCODE" == "000" ]]; then
    fail "caddy is not serving https for $MEDIA_HOST on this box"
    info "check: journalctl -u caddy -n 30 --no-pager"
    info "if it can't get a certificate, port 80 usually isn't reaching it"
  else
    pass "caddy serves $MEDIA_HOST locally with a valid cert (HTTP $LOCALCODE)"
  fi

  # And now from outside — except this box usually cannot test that. Most
  # routers don't hairpin, so a request to your own public address from
  # inside the house fails even when the internet reaches it fine. Never
  # report that as broken; it sends you chasing a problem you don't have.
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "https://$MEDIA_HOST" 2>/dev/null)
  if [[ "$CODE" != "000" ]]; then
    pass "and it answers over the public name too (HTTP $CODE)"
  elif [[ -z "$RESOLVED" ]]; then
    fail "$MEDIA_HOST has no dns record yet"
    info "  add an A record:  $MEDIA_HOST  ->  ${PUBLIC:-your public ip}"
    info "  on cloudflare it must be grey cloud, not orange"
  elif [[ "$LOCALCODE" != "000" ]]; then
    info "could not reach $MEDIA_HOST via its public address from in here."
    info "  that is usually your router refusing to loop back on itself, NOT"
    info "  a fault — caddy answered fine over loopback above."
    info "  settle it from a phone on mobile data, not wifi:"
    info "    https://$MEDIA_HOST"
    info "  if that fails too, the forwards are missing. run: sudo ./forward.sh"
  fi

  if grep -qE "^\s*-\s*$MEDIA_HOST" "${MTX_CONF:-/etc/mediamtx/mediamtx.yml}" 2>/dev/null; then
    pass "mediamtx advertises $MEDIA_HOST as an ice candidate"
  else
    fail "webrtcAdditionalHosts does not list $MEDIA_HOST"
    info "the page will connect and then show nothing: mediamtx is handing"
    info "viewers a 192.168.x address they cannot reach"
    info "uncomment it in ${MTX_CONF:-/etc/mediamtx/mediamtx.yml}, then:"
    info "  sudo systemctl restart mediamtx"
  fi
fi

LOCAL=$(ip -4 addr show scope global | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
info "public ip $PUBLIC, this box $LOCAL"

# The router's port-forward rules point at whatever address this box had when
# they were written. AT&T's gateway has no straightforward per-device
# reservation, so rather than fighting it, remember the address and say so
# when it moves — the failure is otherwise silent and looks like every other
# black screen.
SEEN=/var/lib/truman/last-lan-ip
if [[ -r "$SEEN" ]]; then
  WAS=$(cat "$SEEN")
  if [[ "$WAS" != "$LOCAL" ]]; then
    fail "this box moved: $WAS -> $LOCAL"
    info "the router is still forwarding 443/80/8189 to $WAS, so nothing arrives"
    info "repoint the three rules at $LOCAL in Firewall > NAT/Gaming"
  fi
else
  mkdir -p "$(dirname "$SEEN")" 2>/dev/null
fi
echo "$LOCAL" > "$SEEN" 2>/dev/null || true
if [[ "$LOCAL" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\. ]]; then
  info "  that is CGNAT — viewers cannot reach you directly, you need the relay"
fi

echo
[[ $BAD -eq 0 ]] && echo "all good." || echo "fix the first FAIL above, then run me again."
exit $BAD
