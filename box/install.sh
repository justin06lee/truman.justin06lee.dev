#!/usr/bin/env bash
#
# Run this on the Arch box, from inside the repo's box/ directory:
#
#   sudo ./install.sh
#
# Idempotent — re-run it after editing any file here to push the change out.
# It does not start anything and it does not touch /etc/truman/box.env after
# the first run, so your key survives a re-install.
#
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run me with sudo"; exit 1; }
cd "$(dirname "$0")"

echo "==> packages"
# bun installs from bun.lock (npm would ignore it and re-resolve fresh);
# nodejs stays because `next start` itself still runs on node.
pacman -S --needed --noconfirm ffmpeg caddy curl v4l-utils alsa-utils nodejs bun jq dnsmasq

if ! command -v mediamtx >/dev/null; then
  echo
  echo "!! mediamtx is not installed. It lives in the AUR, not the main repos."
  echo "   Install it, then run this script again:"
  echo
  echo "     yay -S mediamtx-bin"
  echo "   (no yay? git clone https://aur.archlinux.org/mediamtx-bin.git"
  echo "            cd mediamtx-bin && makepkg -si)"
  echo
  exit 1
fi

echo "==> scripts and units"
install -Dm755 camera.sh agent.sh record.sh -t /opt/truman/
install -Dm644 truman-camera.service truman-record.service truman-agent.service truman-site.service -t /etc/systemd/system/
install -Dm644 truman.tmpfiles.conf /etc/tmpfiles.d/truman.conf

echo "==> mediamtx config"
# The AUR package disagrees with itself across versions about where the config
# lives, so follow whatever its unit actually passes on the command line.
MTX_CONF=$(systemctl cat mediamtx 2>/dev/null | grep -oE '/etc[^ ]*mediamtx\.yml' | head -1 || true)
MTX_CONF=${MTX_CONF:-/etc/mediamtx/mediamtx.yml}
install -Dm644 mediamtx.yml "$MTX_CONF"
echo "    -> $MTX_CONF"

echo "==> caddy"
install -Dm644 Caddyfile /etc/caddy/Caddyfile

echo "==> dnsmasq"
install -Dm644 dnsmasq.conf /etc/dnsmasq.conf
install -Dm644 dns-hosts /etc/truman/dns-hosts

echo "==> directories"
# The site deletes episodes now, and unlink needs write on the *directory*,
# not the file. The recorder writes as root, so the directory is grouped to
# the site's user (read from its unit) with setgid — every clip stays
# deletable from the site without anything running as anyone new.
SITE_USER=$(grep -oP '^User=\K.*' truman-site.service || echo root)
install -d -m 2775 -o root -g "$SITE_USER" /var/lib/truman/clips
systemd-tmpfiles --create >/dev/null

echo "==> environment"
if [[ -f /etc/truman/box.env ]]; then
  echo "    /etc/truman/box.env already exists — left alone"
else
  install -Dm600 box.env.example /etc/truman/box.env
  echo "    created /etc/truman/box.env — YOU MUST EDIT IT (see below)"
fi

systemctl daemon-reload

echo "==> boot"
# A power cut must not need a human afterwards. The camera and recorder stay
# un-enabled on purpose: the agent starts and stops them with the site's
# switch, and enabling them here would put the room on the air at every boot
# regardless of what the switch says.
systemctl enable mediamtx caddy truman-agent truman-site dnsmasq

echo
echo "done. next:"
echo "  1. sudoedit /etc/truman/box.env      # paste TRUMAN_BOX_KEY, set the camera device"
echo "  2. sudo systemctl start mediamtx caddy truman-agent   # boot-enabled above; start them now"
echo "  3. sudo ./forward.sh                 # opens the router ports (or tells you how)"
echo "  4. ./site-update.sh                  # build and start the site (needs .env.local in the repo root)"
echo "  5. ./doctor.sh                       # checks everything before you trust it"
