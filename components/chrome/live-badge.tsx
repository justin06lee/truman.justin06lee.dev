import { cn } from "@/lib/utils";

export type LiveStatus = "live" | "connecting" | "idle" | "offline";

export type LiveBadgeProps = {
  /** Defaults to "live". */
  status?: LiveStatus;
  /** Overrides the default word for the status. */
  label?: React.ReactNode;
  /** Appended after a middot — a listener count, a bitrate, a room name. */
  detail?: React.ReactNode;
  size?: "sm" | "md";
  /** CSS color of the dot when live. Defaults to white. */
  accent?: string;
  className?: string;
};

const DEFAULT_LABEL: Record<LiveStatus, string> = {
  live: "live",
  connecting: "connecting",
  idle: "idle",
  offline: "offline",
};

const TONE: Record<LiveStatus, { text: string; border: string; dot: string }> = {
  live: { text: "text-white", border: "border-white/25", dot: "bg-white" },
  connecting: { text: "text-white/70", border: "border-white/15", dot: "bg-white/70" },
  idle: { text: "text-white/50", border: "border-white/12", dot: "bg-white/40" },
  offline: { text: "text-white/40", border: "border-white/10", dot: "bg-white/20" },
};

/**
 * "This is happening right now" — a pulsing dot, a word, and an optional count.
 *
 * `badge` is a chip in a row of metadata; it says what a thing *is*. This says
 * what a thing is *doing at this second*, which is why it earns its own
 * component: the dot animates, the four states are fixed rather than free-form
 * variants, and the whole thing carries a `role="status"` so a change from
 * offline to live is announced instead of silently redrawn.
 *
 * The pulse is a ring expanding out of the dot, not the dot itself blinking —
 * a blinking element in the corner of the eye is genuinely unpleasant to sit
 * beside for an hour. Under reduced motion the ring is dropped and the dot
 * stays lit; "live" is information, and it survives without the animation.
 */
export function LiveBadge({
  status = "live",
  label,
  detail,
  size = "md",
  accent = "#fff",
  className,
}: LiveBadgeProps) {
  const tone = TONE[status];
  const animated = status === "live" || status === "connecting";

  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 border font-mono uppercase tracking-[0.18em]",
        size === "sm" ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]",
        tone.border,
        tone.text,
        className,
      )}
    >
      <style precedence="default" href="chrome-live-badge-keyframes">{`
        @keyframes chrome-live-ping {
          0% { transform: scale(1); opacity: 0.55; }
          70%, 100% { transform: scale(2.6); opacity: 0; }
        }
        .chrome-live-ping { animation: chrome-live-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .chrome-live-ping { display: none; }
        }
      `}</style>

      <span aria-hidden className="relative inline-flex size-1.5 shrink-0">
        {animated && (
          <span
            className="chrome-live-ping absolute inset-0"
            style={{ background: status === "live" ? accent : "rgba(255,255,255,0.7)" }}
          />
        )}
        <span
          className={cn("relative inline-block size-full", tone.dot)}
          style={status === "live" ? { background: accent } : undefined}
        />
      </span>

      <span>{label ?? DEFAULT_LABEL[status]}</span>
      {detail !== undefined && detail !== null && (
        <span className="text-white/40 normal-case tracking-normal">· {detail}</span>
      )}
    </span>
  );
}
