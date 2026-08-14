#!/usr/bin/env bash
#
# Opens the three ports viewers need, by asking the router over UPnP.
#
#   sudo ./forward.sh          open them
#   sudo ./forward.sh --list   show what is currently mapped
#   sudo ./forward.sh --close  remove them again
#
# Most home routers accept this. Some have UPnP switched off, and a few refuse
# 80/443 specifically — if that happens the script prints exactly what to click
# instead, with your own addresses filled in, and you do it by hand once.
#
set -uo pipefail

LOCAL=$(ip -4 addr show scope global | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
GATEWAY=$(ip route | awk '/^default/{print $3; exit}')

# port protocol description
PORTS=(
  "443 TCP https-truman"
  "80 TCP acme-truman"
  "8189 UDP webrtc-truman"
)

need_upnpc() {
  command -v upnpc >/dev/null && return 0
  echo "==> installing miniupnpc"
  pacman -S --needed --noconfirm miniupnpc >/dev/null 2>&1 || {
    echo "could not install miniupnpc. run: sudo pacman -S miniupnpc"
    return 1
  }
}

manual() {
  cat <<EOF

────────────────────────────────────────────────────────────────────
UPnP didn't work, so this part has to be done by hand. Once, then
never again.

1. Open your router: http://$GATEWAY
   The password is usually printed on a sticker on the router itself.

2. Find the page called "Port Forwarding" — it may be filed under
   Advanced, NAT, Firewall, Gaming, or Virtual Server.

3. Add three entries, all pointing at this box:

   name        external   internal   protocol   device
   truman-tls  443        443        TCP        $LOCAL
   truman-acme 80         80         TCP        $LOCAL
   truman-rtc  8189       8189       UDP        $LOCAL

   Some routers ask for a "port range" instead of a single port —
   put the same number in both boxes.

4. While you're there, find "DHCP reservation" (or "static lease")
   and pin this box to $LOCAL, so it can't move and quietly break
   all three rules.

Do NOT forward 8889 or 8888. Caddy is the only thing that should be exposed.
────────────────────────────────────────────────────────────────────
EOF
}

case "${1:-}" in
  --list)
    need_upnpc || exit 1
    upnpc -l 2>/dev/null | grep -iE 'truman|^ *[0-9]+ (TCP|UDP)' || echo "no mappings found"
    exit 0
    ;;
  --close)
    need_upnpc || exit 1
    for entry in "${PORTS[@]}"; do
      read -r port proto _ <<<"$entry"
      upnpc -d "$port" "$proto" >/dev/null 2>&1 && echo "  closed $port/$proto"
    done
    exit 0
    ;;
esac

echo "this box is $LOCAL, router is $GATEWAY"
need_upnpc || { manual; exit 1; }

echo "==> looking for a router that speaks UPnP"
if ! upnpc -s >/dev/null 2>&1; then
  echo "    no UPnP router found (it may be switched off in the settings)"
  manual
  exit 1
fi
echo "    found one"

FAILED=0
for entry in "${PORTS[@]}"; do
  read -r port proto name <<<"$entry"
  if upnpc -e "$name" -a "$LOCAL" "$port" "$port" "$proto" >/dev/null 2>&1; then
    echo "  opened $port/$proto"
  else
    echo "  FAILED to open $port/$proto"
    FAILED=1
  fi
done

echo
if [[ $FAILED -eq 0 ]]; then
  echo "all three are open. now run:  ./doctor.sh"
  echo
  echo "note: a router reboot usually forgets UPnP mappings. if the video"
  echo "stops working after a power cut, run this again — or set them by"
  echo "hand from the list in ./forward.sh --help style output below, which"
  echo "survives reboots."
else
  echo "some ports were refused — plenty of routers block 80 and 443 over UPnP."
  manual
  exit 1
fi
