"use client";

import * as React from "react";

/**
 * A shelf thumbnail that knows how to be absent.
 *
 * Posters exist by convention (the recorder files a .jpg beside every .mp4),
 * so episodes recorded before posters existed simply don't have one — the
 * request 404s. Rendering that as a broken-image glyph would make old
 * episodes look damaged rather than merely older, so the component removes
 * itself and the card falls back to being the text it always was.
 *
 * A plain img, not next/image: the src carries a short-lived token and lives
 * on another host — an optimizer proxy would cache what must not be cached
 * and strip what must not be stripped.
 */
export function Poster({ src, alt }: { src: string; alt: string }) {
  const [gone, setGone] = React.useState(false);
  if (gone) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setGone(true)}
      className="aspect-video w-full border border-white/10 object-cover"
    />
  );
}
