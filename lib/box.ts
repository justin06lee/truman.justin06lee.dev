import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * The Arch box authenticates as itself, not as a browser session.
 *
 * Its endpoints are excluded from the cookie gate in `proxy.ts` — this is
 * what closes them again. A separate key from the viewer password means
 * rotating the word people watch with never takes the camera offline.
 */
export function isBox(request: NextRequest): boolean {
  const expected = process.env.TRUMAN_BOX_KEY;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented) return false;

  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
