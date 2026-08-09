"use client";

import * as React from "react";
import Link from "next/link";
import { CameraOff } from "lucide-react";

import { AvatarStack } from "@/components/chrome/avatar-stack";
import { ChatComposer } from "@/components/chrome/chat-composer";
import { ChatLog, type ChatMessage } from "@/components/chrome/chat-log";
import { EmptyState } from "@/components/chrome/empty-state";
import { Grain } from "@/components/chrome/grain";
import { LiveBadge } from "@/components/chrome/live-badge";
import { Player } from "@/components/player";
import type { StreamStatus } from "@/lib/stream";

const STREAM_POLL_MS = 3000;
const CHAT_POLL_MS = 1500;

/** The badge only knows four words; "stopping" is ours, not its. */
const BADGE_STATUS: Record<StreamStatus, "live" | "connecting" | "idle" | "offline"> = {
  live: "live",
  connecting: "connecting",
  stopping: "idle",
  offline: "offline",
};

const BADGE_LABEL: Record<StreamStatus, string> = {
  live: "live",
  connecting: "waking up",
  stopping: "stopping",
  offline: "dark",
};

export type WatchProps = {
  initialStatus: StreamStatus;
  initialLiveSince: number | null;
  initialMessages: ChatMessage[];
  mediaServer: string;
  mediaPath: string;
  name: string;
};

function elapsed(since: number, now: number): string {
  const total = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function Watch({
  initialStatus,
  initialLiveSince,
  initialMessages,
  mediaServer,
  mediaPath,
  name,
}: WatchProps) {
  const [status, setStatus] = React.useState<StreamStatus>(initialStatus);
  const [liveSince, setLiveSince] = React.useState<number | null>(initialLiveSince);
  const [watching, setWatching] = React.useState<{ id: string; name: string }[]>([]);
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages);

  // Starts null and fills in after mount: seeding it during render would make
  // the server and the client disagree about what time it is.
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // Stream status + presence.
  React.useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/stream");
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as {
          status: StreamStatus;
          liveSince: number | null;
          watching: { id: string; name: string }[];
        };
        if (cancelled) return;
        setStatus(data.status);
        setLiveSince(data.liveSince);
        setWatching(data.watching);
      } catch {
        // A dropped poll is not news — the next one is 3s away.
      }
    }

    void poll();
    const timer = setInterval(poll, STREAM_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Chat. `since` is the highest id seen, so a slow poll catches up rather
  // than skipping whatever landed while it was in flight.
  const since = React.useRef(
    initialMessages.length ? Number(initialMessages[initialMessages.length - 1].id) : 0,
  );

  React.useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/chat?since=${since.current}`);
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { messages: ChatMessage[] };
        if (cancelled || data.messages.length === 0) return;

        since.current = Number(data.messages[data.messages.length - 1].id);
        setMessages((current) => {
          // The poll can return a message this tab already appended
          // optimistically; keying by id makes that a no-op instead of a
          // duplicate.
          const seen = new Set(current.map((m) => m.id));
          const fresh = data.messages.filter((m) => !seen.has(m.id));
          return fresh.length ? [...current, ...fresh] : current;
        });
      } catch {
        // Same: the next poll is a second and a half away.
      }
    }

    const timer = setInterval(poll, CHAT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function send(body: string) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) throw new Error("send failed");

    const data = (await response.json()) as { message: ChatMessage };
    since.current = Math.max(since.current, Number(data.message.id));
    setMessages((current) => [...current, data.message]);
  }

  const live = status === "live" || status === "stopping";

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
              truman
            </span>
            <LiveBadge
              status={BADGE_STATUS[status]}
              label={BADGE_LABEL[status]}
              accent="var(--tally)"
              detail={
                live && liveSince && now ? elapsed(liveSince, now) : undefined
              }
            />
          </div>

          <div className="flex items-center gap-3">
            {watching.length > 0 && (
              <AvatarStack
                people={watching}
                size="xs"
                ariaLabel={`${watching.length} watching`}
              />
            )}
            <Link
              href="/episodes"
              className="text-[13px] text-white/55 transition-colors hover:text-white"
            >
              episodes
            </Link>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
          {live && mediaServer ? (
            <>
              <Player
                server={mediaServer}
                path={mediaPath}
                live={live}
                className="relative h-full w-full"
              />
              {/* Over the feed, not the ui — it should read as the picture
                  having texture, not the page. */}
              <Grain variant="noise" opacity={0.07} animate fixed={false} />
            </>
          ) : (
            <div className="w-full max-w-md px-6 py-16">
              <EmptyState
                icon={<CameraOff className="size-5" aria-hidden="true" />}
                title={
                  status === "connecting" ? "the box is waking up" : "the camera is off"
                }
                description={
                  status === "connecting"
                    ? "it polls every few seconds, so this shouldn't take long."
                    : "nothing is being recorded right now. chat still works, and the episodes are still there."
                }
              />
            </div>
          )}
        </div>
      </section>

      <aside className="flex min-h-0 w-full flex-col border-t border-white/10 lg:h-full lg:w-80 lg:border-t-0 lg:border-l">
        <div className="flex items-baseline justify-between border-b border-white/10 px-4 py-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            chat
          </h2>
          <span className="text-[13px] text-white/40">{name}</span>
        </div>

        <ChatLog
          messages={messages}
          className="h-[50vh] lg:h-auto"
          empty={
            <p className="py-8 text-center text-[13px] text-white/30">
              nobody has said anything yet.
            </p>
          }
        />

        <ChatComposer onSend={send} />
      </aside>
    </div>
  );
}
