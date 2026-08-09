"use client";

import * as React from "react";
import { SendHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The line you type into, under a `chat-log`.
 *
 * Split from the log rather than bundled with it because the two have
 * different reasons to re-render — the log repaints on every arriving
 * message, the composer only on your own keystrokes — and because a read-only
 * room is a real state: render the log without this and there is nothing to
 * disable or explain.
 *
 * It owns the draft and nothing else. `onSend` may be async; the draft is
 * cleared optimistically and put back if the send rejects, because losing a
 * typed sentence to a dropped request is the one failure a chat box must not
 * have.
 */

export type ChatComposerProps = {
  onSend: (body: string) => void | Promise<void>;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Explains the disabled state where the reader is looking. */
  disabledHint?: React.ReactNode;
  ariaLabel?: string;
  className?: string;
};

export function ChatComposer({
  onSend,
  placeholder = "say something",
  maxLength = 500,
  disabled = false,
  disabledHint,
  ariaLabel = "message",
  className,
}: ChatComposerProps) {
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState("");

  const body = draft.trim();
  const canSend = body.length > 0 && !disabled && !sending;

  async function send() {
    if (!canSend) return;

    setDraft("");
    setError("");
    setSending(true);
    try {
      await onSend(body);
    } catch {
      // Hand the sentence back rather than making them retype it.
      setDraft(body);
      setError("that didn't send");
    } finally {
      setSending(false);
    }
  }

  if (disabled && disabledHint) {
    return (
      <div
        className={cn(
          "border-t border-white/10 px-4 py-3 text-[13px] text-white/40",
          className,
        )}
      >
        {disabledHint}
      </div>
    );
  }

  return (
    <div className={cn("border-t border-white/10", className)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 px-3 py-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[15px] text-white outline-none placeholder:text-white/30 disabled:text-white/40"
        />

        {/* Only worth showing once the limit is close enough to matter. */}
        {draft.length > maxLength * 0.8 && (
          <span className="font-mono text-[10px] tracking-[0.14em] text-white/40">
            {draft.length} / {maxLength}
          </span>
        )}

        <button
          type="submit"
          disabled={!canSend}
          aria-label="send"
          className="border border-white/20 p-1.5 text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-30"
        >
          <SendHorizontal className="size-3.5" aria-hidden="true" />
        </button>
      </form>

      {error && (
        <p role="alert" className="px-4 pb-2 text-[13px] text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
