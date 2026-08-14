#!/usr/bin/env bash
#
# Repairs what an ISP address change breaks, unattended.
#
# Residential IPs move, and when this one does, two things go stale at once:
# the numeric ICE candidate in mediamtx.yml (every outside viewer connects
# and then sees black) and the public A records (nobody connects at all).
# The doctor *detects* both; this closes the loop by fixing them, every five
# minutes from truman-ipwatch.timer, so the failure window is minutes
# instead of "until someone notices the site is dark from mobile data".
#
# DNS repair needs a Cloudflare API token in /etc/truman/box.env
# (CLOUDFLARE_API_TOKEN, scoped to Zone.DNS edit). Without one this still
# fixes mediamtx and says exactly which record to change by hand.
#
set -uo pipefail

[[ -n "${TRUMAN_BOX_KEY:-}" ]] || source /etc/truman/box.env

NAMES="${TRUMAN_DNS_NAMES:-truman.justin06lee.dev media.justin06lee.dev}"

PUBLIC=$(curl -s -m 10 https://api.ipify.org 2>/dev/null)
if [[ ! "$PUBLIC" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  # No answer is not an instruction — same principle as the agent. An offline
  # box must not rewrite configs based on nothing.
  echo "no public ip answer (offline?) — leaving everything alone"
  exit 0
fi

# ------------------------------------------------- mediamtx's ice candidate
# Same config-location discovery as install.sh: follow whatever the unit
# actually passes, because the AUR package disagrees with itself.
MTX_CONF=$(systemctl cat mediamtx 2>/dev/null | grep -oE '/etc[^ ]*mediamtx\.yml' | head -1)
MTX_CONF=${MTX_CONF:-/etc/mediamtx/mediamtx.yml}

if [[ -r "$MTX_CONF" ]]; then
  ADVERTISED=$(sed -n '/^webrtcAdditionalHosts:/,/^[a-zA-Z]/p' "$MTX_CONF" \
                 | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
  if [[ -z "$ADVERTISED" ]]; then
    echo "no numeric candidate under webrtcAdditionalHosts in $MTX_CONF — nothing to repair"
  elif [[ "$ADVERTISED" != "$PUBLIC" ]]; then
    sed -i "/^webrtcAdditionalHosts:/,/^[a-zA-Z]/ s/\b${ADVERTISED//./\\.}\b/$PUBLIC/" "$MTX_CONF"
    systemctl restart mediamtx
    echo "the isp moved the ip: $ADVERTISED -> $PUBLIC — rewrote the ice candidate, restarted mediamtx"
  fi
fi

# ------------------------------------------------------------------- dns
# Asked over DoH, not the local resolver: dnsmasq on this box answers these
# names with the lan address on purpose, which would make every check here
# a lie.
doh() {
  curl -s -m 10 -H 'accept: application/dns-json' \
    "https://cloudflare-dns.com/dns-query?name=$1&type=A" 2>/dev/null \
    | jq -r '.Answer[]? | select(.type==1) | .data' | head -1
}

for name in $NAMES; do
  CURRENT=$(doh "$name")
  [[ "$CURRENT" == "$PUBLIC" ]] && continue

  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "dns: $name resolves to ${CURRENT:-nothing}, should be $PUBLIC"
    echo "dns: no CLOUDFLARE_API_TOKEN in box.env — change the A record by hand (grey cloud)"
    continue
  fi

  apex=$(awk -F. '{print $(NF-1)"."$NF}' <<<"$name")
  zone=$(curl -s -m 10 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
           "https://api.cloudflare.com/client/v4/zones?name=$apex" \
           | jq -r '.result[0].id // empty')
  if [[ -z "$zone" ]]; then
    echo "dns: cloudflare shows no zone for $apex — token scope, or the domain isn't there"
    continue
  fi

  record=$(curl -s -m 10 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
             "https://api.cloudflare.com/client/v4/zones/$zone/dns_records?type=A&name=$name" \
             | jq -r '.result[0].id // empty')
  if [[ -z "$record" ]]; then
    # Update-only on purpose: creating records means choosing proxy settings,
    # and an orange cloud silently breaks WebRTC. A human makes it once.
    echo "dns: no A record for $name exists to update — create it once by hand (grey cloud)"
    continue
  fi

  ok=$(curl -s -m 10 -X PATCH \
         -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
         -H 'content-type: application/json' \
         -d "{\"content\":\"$PUBLIC\"}" \
         "https://api.cloudflare.com/client/v4/zones/$zone/dns_records/$record" \
         | jq -r '.success')
  if [[ "$ok" == "true" ]]; then
    echo "dns: repointed $name -> $PUBLIC"
  else
    echo "dns: cloudflare refused the update for $name"
  fi
done
