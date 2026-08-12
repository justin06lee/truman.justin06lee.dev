"use client";

import * as React from "react";

/**
 * WHEP client for the MediaMTX box.
 *
 * Site-local on purpose: the chrome registry stays framework- and
 * backend-agnostic, and this is a transport bound to one media server's
 * endpoint shape. Everything visible around it — the badge, the grain, the
 * empty state — comes from the registry.
 *
 * WebRTC rather than HLS because of chat. At HLS's ten-to-thirty seconds a
 * message about what just happened arrives before the thing it's about;
 * WHEP lands under a second, which is what makes the room feel like one
 * room. Native HLS is kept as a fallback for networks that block UDP.
 *
 * The token is fetched per attempt rather than embedded at render: it lives
 * sixty seconds, so a page left open overnight reconnects with a fresh one
 * instead of a dead one.
 */

type Status = "idle" | "connecting" | "playing" | "failed";

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
 * the connection forever rather than failing over to HLS.
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
  const [status, setStatus] = React.useState<Status>("idle");
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
    if (!live || !server) {
      pcRef.current?.close();
      pcRef.current = null;
      return;
    }

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    async function connect() {
      if (cancelled) return;

      const token = await mintToken();
      if (cancelled) return;
      if (!token) return fail();

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.ontrack = (event) => {
        if (videoRef.current) videoRef.current.srcObject = event.streams[0];
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

        const url = new URL(`${server.replace(/\/$/, "")}/${path}/whep`);
        url.searchParams.set("user", "viewer");
        url.searchParams.set("pass", token);

        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/sdp" },
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

    function fail() {
      pcRef.current?.close();
      pcRef.current = null;
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
      pcRef.current?.close();
      pcRef.current = null;
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
