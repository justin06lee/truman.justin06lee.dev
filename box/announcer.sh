#!/usr/bin/env bash
#
# The announcer. Speaks each new chat message into the room — "so-and-so
# said: ..." — through piper's danny voice and whatever speakers this box
# has. Viewers can see the room; this is the only direction chat couldn't
# already travel.
#
# Same inversion as everything else here: it polls the site with the box
# key, the site never reaches in. On start it primes from the tail of the
# log without speaking it — a reboot must not recite the last hundred
# messages into the room at 3am.
#
set -uo pipefail

[[ -n "${TRUMAN_BOX_KEY:-}" ]] || source /etc/truman/box.env

if [[ "${TRUMAN_ANNOUNCE:-on}" != "on" ]]; then
  echo "TRUMAN_ANNOUNCE is not 'on' — staying silent"
  exit 0
fi

VOICE="${TRUMAN_VOICE:-/opt/truman/voices/en_US-danny-low.onnx}"
SPEAKER="${TRUMAN_SPEAKER_DEVICE:-auto}"
INTERVAL="${TRUMAN_ANNOUNCE_POLL_SECONDS:-2}"
# A flood is summarized, not recited — five in one poll is a conversation,
# fifty is a backlog nobody wants performed.
MAX_BATCH=5

# The AUR's piper-tts-bin installs the binary as `piper-tts`; upstream calls
# it `piper`. Answer to either.
PIPER=$(command -v piper || command -v piper-tts) \
  || { echo "piper is missing — yay -S piper-tts-bin"; exit 1; }
[[ -r "$VOICE" ]] || { echo "no voice model at $VOICE — re-run sudo ./install.sh"; exit 1; }

# The rate the voice was trained at, from its own config (danny low: 16000).
RATE=$(jq -r '.audio.sample_rate // 16000' "${VOICE}.json" 2>/dev/null || echo 16000)

# Can this device actually play, right now, from this process? A tenth of a
# second of silence answers without anyone hearing the test.
playable() {
  head -c 3200 /dev/zero | aplay -q -t raw -f S16_LE -r 16000 -c 1 -D "$1" 2>/dev/null
}

# The mirror image of camera.sh's mic hunt, with the priority reversed:
# the usb devices on this box are a camera and a microphone, so the onboard
# analog jack is where speakers actually live. Through plughw so the voice's
# 16k mono gets converted to whatever the card demands.
pick_speaker() {
  if [[ "$SPEAKER" != "auto" ]]; then
    playable "$SPEAKER" && { echo "$SPEAKER"; return 0; }
    echo "speaker: $SPEAKER could not be opened" >&2
    return 1
  fi

  playable default && { echo "default"; return 0; }

  local -a onboard=() usb=()
  while read -r card device; do
    if [[ -e "/proc/asound/card${card}/usbid" ]]; then
      usb+=("plughw:${card},${device}")
    else
      onboard+=("plughw:${card},${device}")
    fi
  done < <(aplay -l 2>/dev/null | sed -nE 's/^card ([0-9]+):.*device ([0-9]+):.*/\1 \2/p')

  local dev
  for dev in "${onboard[@]}" "${usb[@]}"; do
    playable "$dev" && { echo "$dev"; return 0; }
  done
  return 1
}

SPK=$(pick_speaker) || { echo "no playback device works — nothing to speak through"; exit 1; }
echo "speaking through $SPK, voice $(basename "$VOICE"), ${RATE}Hz"

speak() {
  # Serial on purpose — one voice in the room, sentences in arrival order.
  printf '%s' "$1" \
    | "$PIPER" --model "$VOICE" --output-raw 2>/dev/null \
    | aplay -q -t raw -f S16_LE -r "$RATE" -c 1 -D "$SPK" 2>/dev/null
}

SINCE=0
PRIMED=0

while true; do
  body=$(curl -fsS -m 10 -H "Authorization: Bearer $TRUMAN_BOX_KEY" \
           "$TRUMAN_SITE/api/chat?since=$SINCE" 2>/dev/null) || {
    # An unreachable site is not news to perform either. Try again shortly.
    sleep "$INTERVAL"
    continue
  }

  last=$(jq -r '.messages | last | .id // empty' <<<"$body" 2>/dev/null)

  if [[ "$PRIMED" == 0 ]]; then
    # The first successful read is history, not news.
    [[ -n "$last" ]] && SINCE="$last"
    PRIMED=1
    sleep "$INTERVAL"
    continue
  fi

  count=$(jq -r '.messages | length' <<<"$body" 2>/dev/null || echo 0)
  if [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )); then
    SINCE="$last"
    while IFS=$'\t' read -r name text; do
      [[ -z "$name" ]] && continue
      # @tsv escapes what would break the line; spoken text wants spaces.
      text="${text//\\n/ }"; text="${text//\\t/ }"; text="${text//\\\\/ }"
      speak "$name said: $text"
    done < <(jq -r ".messages[:$MAX_BATCH][] | [.name, .body] | @tsv" <<<"$body")

    if (( count > MAX_BATCH )); then
      speak "and $((count - MAX_BATCH)) more messages"
    fi
  fi

  sleep "$INTERVAL"
done
