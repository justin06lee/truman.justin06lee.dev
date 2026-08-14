"use client";

import * as React from "react";

import type HlsType from "hls.js";

/**
 * WHEP client for the MediaMTX box, with an HLS fallback.
 *
 * Site-local on purpose: the chrome registry stays framework- and
 * backend-agnostic, and this is a transport bound to one media server's
 * endpoint shape. Everything visible around it — the badge, the grain, the
 * empty state — comes from the registry.
 *
 * WebRTC first because of chat. At HLS's several seconds of latency a
 * message about what just happened arrives before the thing it's about;
 * WHEP lands under a second, which is what makes the room feel like one
 * room. But WebRTC needs a UDP path, and some networks (hotel wifi,
 * corporate proxies) simply don't have one — so after two failed WHEP
 * attempts the player falls back to HLS and *says so* on screen, because a
 * viewer who is a few seconds behind should know the chat will lead the
 * picture rather than wonder why the room is confused.
 *
 * Tokens live sixty seconds. WHEP needs one per connection attempt; HLS
 * needs one per *request*, forever — so the HLS path re-mints on a timer and
 * stamps the current token onto every playlist and segment fetch. That is
 * also what keeps "everyone out" meaningful on the fallback: a revoked
 * session stops minting, and the next segment request is refused.
 */

type Status = "idle" | "connecting" | "playing" | "failed";
type Transport = "whep" | "hls";

/** WHEP failures before conceding the network has no UDP path. */
const WHEP_ATTEMPTS_BEFORE_FALLBACK = 2;

/** Comfortably inside the 60s token TTL, with room for a slow request. */
const TOKEN_REFRESH_MS = 40_000;

export type PlayerProps = {
  /** Base url of the media server, e.g. https://media.example.dev */
  server: string;
  /** MediaMTX path name, e.g. "live". */
  path: string;
  /** Whether the box says it is sending frames. */
  live: boolean;
  className?: string;
};

async function mintToken(): Promise<string | null> {
  const response = await fetch("/api/media/token", { method: "POST" });
  if (!response.ok) return null;
  const data = (await response.json()) as { token?: string };
  return data.token ?? null;
}

/**
 * Wait for ICE gathering to finish before sending the offer.
 *
 * WHEP is a single request/response, so there is no channel to trickle later
 * candidates over — the offer has to be complete when it's posted. The
 * timeout exists because a candidate that never resolves would otherwise hang
 * the connection forever rather than failing over.
 */
function gathered(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export function Player({ server, path, live, className }: PlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const hlsRef = React.useRef<HlsType | null>(null);
  const tokenRef = React.useRef<string>("");
  const [status, setStatus] = React.useState<Status>("idle");
  const [transport, setTransport] = React.useState<Transport>("whep");
  const [muted, setMuted] = React.useState(true);

  /**
   * Derived rather than stored, so nothing has to write state during a
   * render pass to keep it honest: not-live is idle by definition, and a
   * live feed that hasn't reported anything yet is connecting by definition.
   * Every setStatus below happens after an await or inside an event handler.
   */
  const shown: Status =
    !live || !server ? "idle" : status === "idle" ? "connecting" : status;

  React.useEffect(() => {
    const video = videoRef.current;

    function teardown() {
      pcRef.current?.close();
      pcRef.current = null;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    }

    if (!live || !server) {
      teardown();
      return;
    }

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setInterval> | undefined;
    let attempt = 0;
    // Set once the dynamic import proves this browser can't run hls.js —
    // from then on the retry loop stays on WHEP rather than failing into
    // the same wall on every backoff.
    let hlsUnsupported = false;

    // Both transports funnel through the media element eventually, so
    // "playing" is read off the element rather than trusted from either.
    const onPlaying = () => {
      if (cancelled) return;
      attempt = 0;
      setStatus("playing");
    };
    video?.addEventListener("playing", onPlaying);

    async function connect() {
      if (cancelled) return;

      const token = await mintToken();
      if (cancelled) return;
      if (!token) return fail();
      tokenRef.current = token;

      if (attempt >= WHEP_ATTEMPTS_BEFORE_FALLBACK && !hlsUnsupported) {
        return connectHls();
      }
      return connectWhep(token);
    }

    async function connectWhep(token: string) {
      setTransport("whep");

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.ontrack = (event) => {
        if (video) {
          // removeAttribute, not src = "": assigning the empty string points
          // the element at the page url and can fire a spurious error event.
          video.removeAttribute("src");
          video.srcObject = event.streams[0];
        }
      };

      pc.onconnectionstatechange = () => {
        if (cancelled) return;
        if (pc.connectionState === "connected") {
          attempt = 0;
          setStatus("playing");
        }
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          fail();
        }
      };

      try {
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        if (cancelled) return;

        const url = `${server.replace(/\/$/, "")}/${path}/whep`;

        // MediaMTX reads credentials from Basic auth only — ?user=&pass= in
        // the query string never even reaches the auth callback (measured
        // against 1.19: query credentials 401 with zero callback traffic,
        // Basic lands). True for WHEP here and for HLS below alike, and its
        // CORS preflight allows the Authorization header for exactly this.
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/sdp",
            authorization: `Basic ${btoa(`viewer:${token}`)}`,
          },
          body: pc.localDescription?.sdp ?? "",
        });
        if (!response.ok) throw new Error(String(response.status));

        const answer = await response.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch {
        fail();
      }
    }

    async function connectHls() {
      const src = `${server.replace(/\/$/, "")}/${path}/index.m3u8`;

      const { default: Hls } = await import("hls.js");
      if (cancelled) return;

      // hls.js or nothing — no native <video src=m3u8> branch, deliberately.
      // The element can't send an Authorization header and MediaMTX ignores
      // query credentials, so a native fallback would be dead code wearing a
      // feature's name. hls.js covers everything current (desktop via MSE,
      // iOS 17.1+ via ManagedMediaSource); older iOS keeps the honest WHEP
      // failure screen.
      if (!Hls.isSupported()) {
        hlsUnsupported = true;
        return fail();
      }

      setTransport("hls");
      if (video) video.srcObject = null;

      const hls = new Hls({
        // Every playlist and segment request gets the *current* token — the
        // refresh timer below keeps it younger than its 60s TTL, and a
        // revoked session stops refreshing and is refused mid-stream.
        xhrSetup: (xhr, url) => {
          if (xhr.readyState === 0) xhr.open("GET", url, true);
          xhr.setRequestHeader(
            "authorization",
            `Basic ${btoa(`viewer:${tokenRef.current}`)}`,
          );
        },
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!cancelled && data.fatal) fail();
      });

      hls.loadSource(src);
      if (video) {
        hls.attachMedia(video);
        void video.play().catch(() => {
          // Autoplay policy already handled: the element starts muted.
        });
      }

      refresh = setInterval(() => {
        void mintToken().then((fresh) => {
          if (fresh && !cancelled) tokenRef.current = fresh;
        });
      }, TOKEN_REFRESH_MS);
    }

    function fail() {
      pcRef.current?.close();
      pcRef.current = null;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      clearInterval(refresh);
      if (cancelled) return;
      setStatus("failed");

      // Back off rather than hammering a box that may simply be off. Capped so
      // a stream that comes back after an hour is still picked up promptly.
      attempt += 1;
      const delay = Math.min(1000 * 2 ** attempt, 15_000);
      retry = setTimeout(connect, delay);
    }

    void connect();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      clearInterval(refresh);
      video?.removeEventListener("playing", onPlaying);
      teardown();
    };
  }, [live, server, path]);

  // Where the player is trying to reach, for the failure copy. A bare
  // hostname is what someone would actually check.
  let host = server;
  try {
    host = new URL(server).host;
  } catch {
    // Leave it as given; a malformed url is itself the useful thing to show.
  }

  return (
    <div className={className}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="h-full w-full bg-black object-contain"
      />

      {/*
        A live feed that hasn't arrived is a black rectangle, which is
        indistinguishable from a dark room and from a broken deployment. Say
        which it is: the box reporting "live" only means the camera process is
        up, and the video still has to cross the network on its own.
      */}
      {shown !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center">
          {shown === "connecting" ? (
            <p className="text-[15px] text-white/55">connecting to the camera...</p>
          ) : (
            <div className="max-w-sm">
              <p className="text-[15px] text-white">can&apos;t reach the camera</p>
              <p className="mt-2 text-[13px] leading-6 text-white/55">
                the box says it&apos;s live, but no video is arriving from{" "}
                <span className="font-mono text-white/70">{host || "nowhere"}</span>.
                usually dns, a closed port, or caddy not running.
              </p>
              <p className="mt-2 text-[13px] text-white/40">retrying...</p>
            </div>
          )}
        </div>
      )}

      {/* The fallback is honest about its cost: chat will lead the picture
          by a few seconds, and the room only feels broken if nobody says
          why. */}
      {shown === "playing" && transport === "hls" && (
        <span className="absolute bottom-3 right-3 border border-white/15 bg-black/80 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">
          a few seconds behind
        </span>
      )}

      {/* Autoplay with sound is blocked until the page has been interacted
          with, so the feed starts muted and says so rather than appearing
          to be silent. */}
      {shown === "playing" && muted && (
        <button
          type="button"
          onClick={() => {
            setMuted(false);
            void videoRef.current?.play();
          }}
          className="absolute bottom-3 left-3 border border-white/20 bg-black/80 px-3 py-1.5 text-[13px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          unmute
        </button>
      )}
    </div>
  );
}
