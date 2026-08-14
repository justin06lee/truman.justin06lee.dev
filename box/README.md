# the box

Everything here runs on the Arch machine with the webcam plugged into it.
Nothing here runs on Vercel.

> **Hardened against real hardware.** This kit has met the actual box, and
> the commit history is the scar tissue: the mic that needed `plughw`, the
> router that won't hairpin, the ICE candidate that had to be a numeric ip,
> the power cut. `doctor.sh` exists because each of those looked identical —
> a black rectangle — until something asked the right question in the right
> order. When a thing breaks, run the doctor before reasoning from scratch.

## what runs

| unit | does | enabled at boot |
|---|---|---|
| `mediamtx` | RTSP in on 8554, WHEP out on 8889, HLS fallback on 8888. Auth via callback to truman. | yes |
| `caddy` | TLS, and serves the finished clips behind the same token auth | yes |
| `truman-agent` | polls the site for the switch, drives the other two, reports back | yes |
| `truman-camera` | ffmpeg: webcam + mic, published to MediaMTX | **no** |
| `truman-record` | ffmpeg: the 400x timelapse | **no** |
| `truman-site` | next.js — the website itself, behind caddy | yes |

The camera and recorder are started by the agent, never by systemd at boot.
That's the whole point — the switch lives on the website.

The site itself moved here from Vercel, where every chat poll was a billed
function call — a page whose whole point is a poll loop is the worst possible
serverless tenant. It runs as `truman-site` (`next start` behind the same
Caddy), with secrets in `.env.local` at the repo root, `0600`. Deploy with
`./site-update.sh` after master moves. Its DNS is an A record to the public
IP, grey cloud, exactly like the media host.

The router will not hairpin, so lan devices asking public dns for either name
would reach nothing. The box therefore runs `dnsmasq` as the house resolver:
both names answer with the box's lan address, everything else forwards to
1.1.1.1. Point the gateway's DHCP at this box (primary dns `192.168.1.253`,
secondary a public resolver) and every device on the wifi just works. The
box's own calls to its public names ride the gateway's one working hairpin
path and need no pinning.

They start and stop **together**, which is what makes an episode match one
sitting. Driving the recorder from MediaMTX's `runOnReady` instead would end
the episode every time the USB blipped and file two clips for one session.

## before you start

The site has to be deployed and reachable first — the box authenticates
against it, and there is nothing to poll until it exists. You'll need the
value of `TRUMAN_BOX_KEY` from the site's environment.

## install

One command, run from this directory, re-runnable after any edit here:

```bash
sudo ./install.sh
```

It installs the packages, copies every script, unit and config to where it
belongs, and prints the next steps. The only thing it can't do is MediaMTX
itself — that is **not in the official repos**, it's in the AUR, and the
script stops and says so until you've run `yay -S mediamtx-bin`. It also
follows wherever the AUR package actually reads its config from
(`systemctl cat mediamtx` shows the path), because the package disagrees
with itself across versions.

Then fill in the environment:

```bash
sudoedit /etc/truman/box.env      # TRUMAN_SITE, TRUMAN_BOX_KEY, the devices
sudo systemctl daemon-reload
sudo systemctl enable --now mediamtx caddy truman-agent
```

`/etc/truman/box.env` stays `0600` root-only. Every unit that needs it reads
it through `EnvironmentFile=`, and they run as root — nothing else on the
box ever needs to read that key.

## find your devices first

```bash
v4l2-ctl --list-devices                      # which /dev/videoN is the webcam
v4l2-ctl -d /dev/video0 --list-formats-ext   # what sizes and rates it really does
arecord -l                                   # the microphone
```

Put the answers in `/etc/truman/box.env`. A webcam that advertises 1080p30
often delivers that only over MJPEG and drops to 5fps on raw YUYV, so read the
format list rather than trusting the box it came in.

## the network question

This decides whether you need a relay, and it's the only thing here that
can't be answered from the box alone.

```bash
curl -s https://api.ipify.org; echo
ip -4 addr show scope global | grep inet
```

If your public address appears on a local interface, you're directly
reachable. If the local address is in `100.64.0.0/10`, you're behind CGNAT,
inbound connections are impossible, and you need the relay.

**Direct.** Three forwards, an A record, and one config line.

| forward | to the box | why |
|---|---|---|
| `443/tcp` | yes | https. Caddy terminates TLS here and proxies to MediaMTX on loopback |
| `80/tcp` | yes | lets Caddy get its certificate over the ACME http challenge |
| `8189/udp` | yes | the video itself. WebRTC media does not go through Caddy |

**Do not forward 8889 or 8888.** Caddy is the only thing that should be
exposed; MediaMTX listens on loopback and is reached through it. Forwarding
either would publish an unencrypted endpoint beside the encrypted one, and a
browser on an https page refuses to talk to it anyway.

Then point `media.justin06lee.dev` at your public IP with an A record, and add
that hostname to `webrtcAdditionalHosts` in `mediamtx.yml`. Without that last
step MediaMTX advertises a `192.168.x` ICE candidate nobody outside the house
can reach, and the page connects and then shows nothing.

If DNS is on Cloudflare the record must be **DNS only** (grey cloud, not
orange). The proxy does not carry WebRTC's UDP, so an orange cloud breaks the
video while making everything else look correct.

Residential IPs move. When the public one changes, the A record needs
changing with it — dynamic DNS, or notice the day it breaks.

The box's *private* address matters too, because the forwards point at it.
AT&T's gateway has no straightforward per-device DHCP reservation — what it
has is inside Subnets & DHCP, which also governs the whole LAN and is not
worth poking for this. Leave it on DHCP; `doctor.sh` remembers the address
and tells you if it ever moves, which is the only thing the reservation was
protecting against.

Two things to know rather than discover: each viewer gets their own copy of
the stream, so five people at 2.5 Mbps is 12.5 Mbps of sustained upload; and
WebRTC hands your home IP to every viewer during ICE negotiation. That is
inherent to the protocol, not a misconfiguration.

**Relayed.** Run the same MediaMTX on a cheap VPS and have the box push one
outbound stream to it instead of listening. Upload cost becomes fixed at one
stream regardless of viewer count, the home IP is never exposed, no ports are
forwarded, and it works behind CGNAT. Point `NEXT_PUBLIC_MEDIA_URL` at the
VPS.

## bring it up one layer at a time

Each step is checkable on its own; do them in order and you'll know which one
broke.

```bash
# 1. does the camera produce anything at all?
ffplay -f v4l2 -i /dev/video0                     # or: ffmpeg -f v4l2 -i /dev/video0 -t 5 /tmp/t.mkv

# 2. does MediaMTX accept the publish?
sudo systemctl start truman-camera
journalctl -u truman-camera -n 30
source /etc/truman/box.env
ffprobe -rtsp_transport tcp "rtsp://box:$TRUMAN_BOX_KEY@127.0.0.1:8554/live"

# 3. does auth actually refuse a stranger?  (expect 401)
ffprobe -rtsp_transport tcp "rtsp://box:wrong@127.0.0.1:8554/live"

# 4. does the recorder attach?
sudo systemctl start truman-record
ls -la /var/lib/truman/clips/

# 5. stop it and confirm the episode is filed
sudo systemctl stop truman-record
journalctl -u truman-record -n 20                 # look for "filed <id>"
#    then check /episodes on the site

# 6. hand control back to the agent
sudo systemctl stop truman-camera
journalctl -u truman-agent -f
```

With step 6 running, flip the switch in `/studio`. The camera should come up
within the poll interval and the badge should go `waking up` then `live`.

## the two things most likely to bite

**RTSP, not RTMP.** RTMP cannot carry Opus and WebRTC cannot carry AAC, and
MediaMTX does not transcode. Publishing over RTMP gives you a stream that
looks perfect in VLC and reaches every browser with permanently silent audio.

**The recorder holds its own connection.** `record.sh` opens a separate RTSP
session to MediaMTX rather than teeing the camera, so it can crash, be
restarted, or be disabled entirely without touching what viewers see.
