"use client";

import * as React from "react";

import { Button } from "@/components/chrome/button";
import { useDialog } from "@/components/chrome/dialog";
import { LiveBadge } from "@/components/chrome/live-badge";
import { Switch } from "@/components/chrome/switch";
import { useToast } from "@/hooks/use-toast";
import type { StreamStatus } from "@/lib/stream";

const POLL_MS = 3000;

const BADGE: Record<StreamStatus, "live" | "connecting" | "idle" | "offline"> = {
  live: "live",
  connecting: "connecting",
  stopping: "idle",
  offline: "offline",
};

const EXPLAIN: Record<StreamStatus, string> = {
  live: "the box is sending frames.",
  connecting: "asked for. the box polls every few seconds and hasn't picked it up yet.",
  stopping: "told to stop. the box is still sending until it notices.",
  offline: "the camera is off.",
};

export type StudioClientProps = {
  initialDesired: boolean;
  initialStatus: StreamStatus;
  initialWatching: { id: string; name: string }[];
};

export function StudioClient({
  initialDesired,
  initialStatus,
  initialWatching,
}: StudioClientProps) {
  const [desired, setDesired] = React.useState(initialDesired);
  const [status, setStatus] = React.useState<StreamStatus>(initialStatus);
  const [watching, setWatching] = React.useState(initialWatching);
  const [busy, setBusy] = React.useState(false);
  const { toast } = useToast();
  const { confirm } = useDialog();

  React.useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/stream");
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as {
          status: StreamStatus;
          watching: { id: string; name: string }[];
        };
        if (cancelled) return;
        setStatus(data.status);
        setWatching(data.watching);
      } catch {
        // The next poll is three seconds away.
      }
    }

    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function toggle(next: boolean) {
    // Optimistic: the switch should move under the finger. The poll above
    // corrects it within three seconds if the request didn't land.
    setDesired(next);
    setBusy(true);
    try {
      const response = await fetch("/api/stream/desired", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ live: next }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setDesired(!next);
      toast({ title: "that didn't take", variant: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function wipeChat() {
    const sure = await confirm({
      title: "wipe the chat log?",
      message: "every message goes, for everyone, immediately. there is no undo.",
      confirmText: "wipe it",
      cancelText: "keep it",
      danger: true,
    });
    if (!sure) return;

    setBusy(true);
    try {
      const response = await fetch("/api/chat", { method: "DELETE" });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { cleared: number };
      toast({
        title: data.cleared
          ? `${data.cleared} message${data.cleared === 1 ? "" : "s"} gone`
          : "the log was already empty",
      });
    } catch {
      toast({ title: "that didn't take", variant: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id?: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/sessions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(id ? { id } : { clearChat: false }),
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { revoked: number };
      setWatching((current) => (id ? current.filter((p) => p.id !== id) : []));
      toast({
        title: id ? "they're out" : `${data.revoked} sessions ended`,
        description: id
          ? undefined
          : "change TRUMAN_PASSWORD now and the old word is worthless.",
      });
    } catch {
      toast({ title: "that didn't take", variant: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 space-y-px bg-white/10">
      <section className="bg-black p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
              camera
            </h2>
            <p className="mt-2 text-[15px] text-white/80">
              {desired ? "on air" : "off"}
            </p>
          </div>
          <Switch
            checked={desired}
            onChange={toggle}
            disabled={busy}
            ariaLabel="camera on air"
          />
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-4">
          <LiveBadge status={BADGE[status]} accent="var(--tally)" />
          <p className="text-[13px] text-white/55">{EXPLAIN[status]}</p>
        </div>
      </section>

      <section className="bg-black p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          watching now
        </h2>

        {watching.length === 0 ? (
          <p className="mt-3 text-[13px] text-white/40">nobody.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/10 border-y border-white/10">
            {watching.map((person) => (
              <li
                key={person.id}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="text-[15px] text-white/80">{person.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => revoke(person.id)}
                >
                  remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-black p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          the log
        </h2>
        <p className="mt-2 max-w-prose text-[13px] leading-6 text-white/55">
          chat is a room, not a record. this empties it for everyone at once.
        </p>
        <Button className="mt-4" variant="outline" disabled={busy} onClick={wipeChat}>
          wipe the chat log
        </Button>
      </section>

      <section className="bg-black p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          everyone out
        </h2>
        <p className="mt-2 max-w-prose text-[13px] leading-6 text-white/55">
          ends every session but this one. rotating the password on its own
          changes nothing for anyone already holding a cookie — this is the
          other half of that.
        </p>
        <Button
          className="mt-4"
          variant="outline"
          disabled={busy}
          onClick={() => revoke()}
        >
          end every session
        </Button>
      </section>
    </div>
  );
}
