import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived tokens for the media path.
 *
 * Gating the pages is not enough. The video lives on a different host, and an
 * unguarded HLS manifest or WHEP endpoint is a permanent public link to the
 * room regardless of what the website asks for at the front door. MediaMTX
 * calls back to `/api/media/auth` before it serves a byte; this module is what
 * that callback checks.
 *
 * Deliberately free of any database or environment coupling so the part that
 * decides who may watch can be tested on its own.
 */

/** Tokens are minted per page load and expire fast; the player re-mints. */
export const TOKEN_TTL_MS = 60_000;

export type TokenPayload = {
  sessionId: string;
  /** Epoch ms after which the token is refused. */
  expiresAt: number;
};

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function mintToken(sessionId: string, secret: string, now: number): string {
  const expiresAt = now + TOKEN_TTL_MS;
  const body = `${sessionId}.${expiresAt}`;
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token: string, secret: string, now: number): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [sessionId, expiresRaw, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!sessionId || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "malformed" };
  }

  const expected = sign(`${sessionId}.${expiresAt}`, secret);

  // Compare before checking expiry, and in constant time: an early return on a
  // stale-but-unsigned token would answer "was this ever a real token" faster
  // than it answers "is this one still good".
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  if (now >= expiresAt) return { ok: false, reason: "expired" };

  return { ok: true, payload: { sessionId, expiresAt } };
}
