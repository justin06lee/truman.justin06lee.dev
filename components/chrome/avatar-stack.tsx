"use client";

import * as React from "react";
import { Tooltip } from "@/components/chrome/tooltip";
import { cn } from "@/lib/utils";

export type Person = {
  id: string;
  name: string;
  /** Avatar url. Without one the tile falls back to initials. */
  src?: string;
  href?: string;
};

export type AvatarStackSize = "xs" | "sm" | "md";

export type AvatarStackProps = {
  people: Person[];
  /** How many tiles before the overflow counter. Defaults to 5. */
  max?: number;
  /**
   * True headcount, when `people` is only the slice you fetched. The counter
   * reports `total - shown` instead of `people.length - shown`.
   */
  total?: number;
  size?: AvatarStackSize;
  /** Name pill on hover and keyboard focus. Defaults to true. */
  tooltip?: boolean;
  onSelect?: (person: Person) => void;
  /** Anchor component for internal hrefs (e.g. next/link). Defaults to a plain <a>. */
  linkComponent?: React.ElementType;
  /** Screen-reader summary. Defaults to "N people". */
  ariaLabel?: string;
  className?: string;
};

const SIZE: Record<AvatarStackSize, { tile: string; text: string; overlap: string }> = {
  xs: { tile: "size-5", text: "text-[8px]", overlap: "-ml-1.5" },
  sm: { tile: "size-6", text: "text-[9px]", overlap: "-ml-2" },
  md: { tile: "size-8", text: "text-[11px]", overlap: "-ml-2.5" },
};

/** "ana lee" → "AL", "prince" → "PR". Never more than two glyphs. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Overlapping tiles for "who else is here" — listeners, collaborators, a room.
 *
 * Square, because the library is; the black hairline between tiles is a ring on
 * each one rather than a gap, so the row stays tight and every tile still reads
 * as separate against a photo behind it.
 *
 * The overflow counter is the last tile, not a line of text after the row —
 * it's the same object as the faces it summarises. Give it `total` when
 * `people` is a fetched slice and it counts the ones you never loaded.
 *
 * The stack renders left-to-right but paints right-to-left (each tile sits
 * *under* the one before it) so the leftmost face is the one on top, which is
 * where the eye starts.
 */
export function AvatarStack({
  people,
  max = 5,
  total,
  size = "sm",
  tooltip = true,
  onSelect,
  linkComponent,
  ariaLabel,
  className,
}: AvatarStackProps) {
  const s = SIZE[size];
  const shown = people.slice(0, Math.max(1, max));
  const headcount = total ?? people.length;
  const overflow = Math.max(0, headcount - shown.length);
  const Link = linkComponent ?? "a";

  const tileClass = cn(
    "relative flex items-center justify-center overflow-hidden border border-white/15 bg-[#0a0a0a] ring-2 ring-black",
    s.tile,
  );

  return (
    <div
      className={cn("flex items-center", className)}
      role="group"
      aria-label={ariaLabel ?? `${headcount} ${headcount === 1 ? "person" : "people"}`}
    >
      {shown.map((person, index) => {
        const inner = person.src ? (
          <img
            src={person.src}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <span className={cn("font-mono text-white/55", s.text)}>{initials(person.name)}</span>
        );

        const interactive = Boolean(person.href || onSelect);
        const tile = person.href ? (
          <Link href={person.href} className={cn(tileClass, "hover:border-white/40")} aria-label={person.name}>
            {inner}
          </Link>
        ) : onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(person)}
            className={cn(tileClass, "hover:border-white/40")}
            aria-label={person.name}
          >
            {inner}
          </button>
        ) : (
          <span className={tileClass} title={tooltip ? undefined : person.name}>
            {inner}
          </span>
        );

        return (
          <span
            key={person.id}
            className={cn("inline-flex", index > 0 && s.overlap)}
            // Later tiles paint under earlier ones, so the leftmost face is on top.
            style={{ zIndex: shown.length - index }}
          >
            {tooltip && interactive ? <Tooltip label={person.name}>{tile}</Tooltip> : tile}
          </span>
        );
      })}

      {overflow > 0 && (
        <span
          className={cn(
            "relative inline-flex items-center justify-center border border-white/15 bg-[#0a0a0a] font-mono tabular-nums text-white/55 ring-2 ring-black",
            s.tile,
            s.text,
            s.overlap,
          )}
          style={{ zIndex: 0 }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
