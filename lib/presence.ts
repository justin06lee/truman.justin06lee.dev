/**
 * When someone counts as "here", and how often that gets written down.
 *
 * Deliberately free of `server-only`, the database and the environment: these
 * two numbers have to stay in a particular relationship to each other, and
 * the only way to assert that is from a test that can import them.
 */

/** Someone is "here" if they've been seen inside this window. */
export const PRESENCE_MS = 45_000;

/**
 * How stale `seen_at` may get before a request rewrites it.
 *
 * Presence is a by-product of reading a page, so the naive version stamps on
 * every request — and this site polls chat every 1.5s and stream status every
 * 3s per viewer, which turns "who's watching" into roughly one write per
 * second per person against a database shared with every other
 * justin06lee.dev site.
 *
 * Stamping only a stale row cuts that by an order of magnitude and changes
 * nothing visible, because this interval is far shorter than the window
 * presence is judged over.
 */
export const SEEN_STAMP_MS = 15_000;

export function shouldStamp(seenAt: number, now: number): boolean {
  return now - seenAt >= SEEN_STAMP_MS;
}
