# truman.justin06lee.dev

A camera pointed at me, for people who have the password. Live video with a
chat beside it, and every session kept as a timelapse.

The whole site is behind one shared word. There is no public surface, no
sign-up, and nothing for a crawler to find.

## the three moving parts

Every other justin06lee.dev site is a Next app on Vercel talking to Turso.
This one started that way and couldn't stay — video breaks that shape (Vercel
can neither carry a live stream nor hold a socket open), and a page whose
whole point is a poll loop is the worst possible serverless tenant: every
chat poll was a billed function call. So all three parts now live on the same
Arch box, behind one Caddy:

| part | where | what |
|---|---|---|
| the camera | Arch box | a USB webcam, ffmpeg, and a systemd unit |
| the media server | Arch box | MediaMTX: RTSP in, WHEP out |
| the site | Arch box | next start behind Caddy — auth, chat, presence, episodes, the on-air switch |

The parts stay separable on purpose — the site still speaks to the box only
through the public API, so it could move back off the box tomorrow without
the box noticing. Everything in `box/` is config that gets copied to the
machine with the camera on it; everything else is the app.

## the switch runs backwards on purpose

The site never reaches into the house. The box polls
`GET /api/stream/desired` every few seconds, starts or stops the camera unit
to match, and reports back what is actually happening with
`POST /api/stream/report`.

That inversion is why none of this needs an inbound connection, why it works
behind CGNAT, and why the kill switch works from a phone.

It also means `desired` and `live` are two different facts, held in two
different columns. They disagree for exactly as long as it takes the box to
notice, which is what lets the badge say **waking up** and **stopping**
instead of guessing.

## 400x, and why there is nothing to delete

Every session is sped up by the same factor. Clip length is whatever that
produces:

| session | clip |
|---|---|
| 1h | 9s |
| 4h | 36s |
| 8h | 1:12 |
| 12h | 1:48 |

Rendering every session to a *fixed* length was the obvious alternative and
it's a lie: it makes a twelve-hour day and a two-hour evening look identical
in the shelf. A longer day should produce a longer clip. `lib/timelapse.ts`
holds that arithmetic, free of any database or environment coupling, so the
part that decides whether the durations are honest can be tested on its own
(`lib/timelapse.test.ts`).

The recorder does **not** capture the session and compress it afterwards.
ffmpeg discards frames in the filter graph and encodes only the survivors:

```
-vf "setpts=PTS/400,fps=30" -r 30
```

The order is load-bearing and the obvious one is wrong. Selecting frames first
and re-stamping them after — `fps=3/40,setpts=N/(30*TB)`, where `3/40` is
`OUT_FPS/SPEED` — picks exactly the right frames and then fails to renumber
them, because after the `fps` filter the stage timebase isn't what the
expression assumes. Measured against a 400-second source it yields a **13.4s**
clip instead of a 1s one. The error scales, so it looks plausible on a short
test and lands a twelve-hour day at 24 minutes.

Scaling the timestamps first and resampling after is exact at every duration
checked against real ffmpeg output — 400s, 1800s, 3600s and 7200s all land on
the frame.

The consequence is the point: twelve hours costs about 20 MB instead of 50 GB,
the clip is finished the instant you stop, and **the full-rate video never
exists**. There is no original to delete, nothing to leak, and no window where
hours of the room sit on a disk waiting for a cleanup job that might not fire.

## the auth boundary is not the pages

Gating the routes is the easy half and it is not where the security is. The
video lives on a different host; an unguarded WHEP or clip url is a permanent
public link to the room regardless of what the website asks for at the front
door.

Three layers, and only the last two are load-bearing:

1. **`proxy.ts`** redirects anyone without a session cookie. It deliberately
   does not *validate* that cookie — Next runs proxy separately from render
   code and may push it to a CDN edge, so it can't reach the database. This is
   a redirect for logged-out people, not a boundary.
2. **The server components** call `getSession()`, which is where an expired,
   revoked or forged cookie is actually turned away.
3. **`/api/media/auth`** is what MediaMTX calls before serving a byte, and
   `/api/media/clip-auth` is the same for Caddy and the finished clips. Both
   verify a 60-second HMAC token *and* re-check that the session still
   exists — which is what makes "everyone out" take effect on the video in
   seconds rather than whenever the last token happens to expire.

`lib/media-token.ts` is pure and tested (`lib/media-token.test.ts`): forged
signatures, swapped session ids, pushed-out expiries and malformed input all
have cases.

## running it

```bash
bun install
cp .env.example .env.local   # optional
bun run dev
bun run test                 # timelapse + token math
bun run typecheck
bun run build
```

Without `TURSO_DATABASE_URL` the app opens `file:.data/truman.db` instead —
same client, same SQL, no second implementation of every query. A fresh clone
runs with no environment at all. Only a *deployed* instance without
credentials degrades further, to `:memory:`, and it says so in the logs.

Tables are namespaced `truman_` because the Turso database is shared with the
other justin06lee.dev sites.

### environment

`.env.example` names every variable. The four that matter:

| variable | what breaks without it |
|---|---|
| `TRUMAN_PASSWORD` | nobody can get in, including you |
| `TRUMAN_OWNER_KEY` | no studio, no on-air switch |
| `TRUMAN_BOX_KEY` | the box can't publish, poll, or file episodes |
| `TRUMAN_MEDIA_SECRET` | the site refuses to mint video tokens at all |

`TRUMAN_BOX_KEY` is deliberately separate from `TRUMAN_PASSWORD` so rotating
the word people watch with never takes the camera offline.

## the box

See [`box/README.md`](box/README.md). Short version: MediaMTX, three systemd
units, a recorder script, and Caddy for TLS.

One thing there is worth repeating because it costs an afternoon: **the camera
publishes over RTSP, not RTMP.** RTMP cannot carry Opus and WebRTC cannot
carry AAC, and MediaMTX does not transcode — so an RTMP publish gives you a
stream whose audio no browser will ever play.

## the ui

Everything visible comes from [chrome](https://chrome.justin06lee.dev):
`live-badge`, `avatar-stack`, `empty-state`, `grain`, `stat-tile`,
`login-form`, `switch`, `card`, `toast`.

Two components were built here because the registry doesn't have them —
`chat-log` and `chat-composer` — and they are written to the registry's bar so
they can be upstreamed rather than left as one-offs. `components/player.tsx`
stays local on purpose: it's a WHEP client bound to one media server's
endpoint shape, not a UI primitive.

`live-badge` and `avatar-stack` were **copied from the local registry
checkout**, not installed by the CLI. The deployed registry at
chrome.justin06lee.dev is thirteen components behind the repo — the whole
audio family that listen.justin06lee.dev contributed, plus these two, are
committed but not served. Once the site is redeployed they can be re-added
the normal way and `chrome diff` will confirm they match.

The site's one accent is `--tally`, lit only while the camera is actually
sending frames, so the colour itself is the information. Nothing else spends
it.
