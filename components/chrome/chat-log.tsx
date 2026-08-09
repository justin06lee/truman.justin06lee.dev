"use client";

import * as React from "react";
import { ArrowDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * An append-only log of messages that follows the newest one — unless you
 * have scrolled up to read something, in which case it holds still.
 *
 * Distinct from `track-list` and `article-list`, which render a collection
 * that happens to be ordered: this one is a *stream*. Its whole contract is
 * about what happens when content arrives while you're looking at it, which
 * is a behaviour neither of those has and neither should grow.
 *
 * The non-obvious part is how "was the reader at the bottom" is decided.
 * Appending a message changes scrollHeight, so by the time an effect runs
 * after a commit, the distance from the bottom already reflects the new
 * content and can no longer answer the question. It's tracked in the scroll
 * handler instead, which fires on reader movement and *not* on content
 * growth — so the flag still describes where the reader was when the message
 * landed.
 */

export type ChatMessage = {
  id: number | string;
  name: string;
  body: string;
  /** Epoch ms. */
  createdAt: number;
  /** Marks the viewer's own messages for emphasis. */
  mine?: boolean;
};

export type ChatLogProps = {
  messages: ChatMessage[];
  /** Shown in place of the list when there is nothing yet. */
  empty?: React.ReactNode;
  /**
   * Consecutive messages from one person inside this many ms are grouped
   * under a single name line. 0 disables grouping.
   */
  groupWithinMs?: number;
  /** Accessible name for the live region. */
  ariaLabel?: string;
  className?: string;
};

/** Within this many px of the bottom still counts as "following". */
const PIN_THRESHOLD = 24;

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatLog({
  messages,
  empty,
  groupWithinMs = 120_000,
  ariaLabel = "chat",
  className,
}: ChatLogProps) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const pinned = React.useRef(true);
  const [showJump, setShowJump] = React.useState(false);

  const scrollToEnd = React.useCallback((smooth: boolean) => {
    const el = viewport.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  function onScroll() {
    const el = viewport.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = distance <= PIN_THRESHOLD;
    setShowJump(!pinned.current);
  }

  // Layout effect, not effect: jumping to the bottom after paint shows the
  // reader one frame of the wrong scroll position on every message.
  React.useLayoutEffect(() => {
    if (pinned.current) scrollToEnd(false);
  }, [messages, scrollToEnd]);

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={viewport}
        onScroll={onScroll}
        role="log"
        aria-label={ariaLabel}
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {messages.length === 0
          ? empty
          : messages.map((message, index) => {
              const previous = messages[index - 1];
              const grouped =
                groupWithinMs > 0 &&
                previous?.name === message.name &&
                message.createdAt - previous.createdAt < groupWithinMs;

              return (
                <div key={message.id} className={cn(grouped ? "mt-0.5" : "mt-3 first:mt-0")}>
                  {!grouped && (
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          "text-[13px]",
                          message.mine ? "text-white" : "text-white/70",
                        )}
                      >
                        {message.name}
                      </span>
                      <time
                        dateTime={new Date(message.createdAt).toISOString()}
                        className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30"
                      >
                        {timeOf(message.createdAt)}
                      </time>
                    </div>
                  )}
                  <p className="text-[15px] leading-6 break-words text-white/80">
                    {message.body}
                  </p>
                </div>
              );
            })}
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            scrollToEnd(true);
          }}
          className="absolute inset-x-0 bottom-2 mx-auto flex w-fit items-center gap-1.5 border border-white/20 bg-black px-3 py-1.5 text-[13px] text-white/70 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowDown className="size-3.5" aria-hidden="true" />
          jump to latest
        </button>
      )}
    </div>
  );
}
