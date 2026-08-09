import "server-only";

import { db, initDb } from "@/lib/db";

/**
 * The single row that says whether the camera should be running, and whether
 * it is.
 *
 * `desired` is set by the studio switch. `live` is set by the box when it
 * reports in. Keeping them apart is what lets the ui distinguish "you asked
 * for it and the box hasn't caught up" (connecting) from "the box says it is
 * sending frames" (live) — and it means the kill switch works from a phone
 * without an ssh session.
 */

/** No word from the box for this long and the stream is treated as dark. */
export const STALE_MS = 30_000;

export type StreamState = {
  desired: boolean;
  live: boolean;
  liveSince: number | null;
  updatedAt: number;
};

export type StreamStatus = "live" | "connecting" | "stopping" | "offline";

export async function readStream(): Promise<StreamState> {
  await initDb();
  const result = await db().execute("SELECT * FROM truman_stream WHERE id = 1");
  const row = result.rows[0];

  if (!row) return { desired: false, live: false, liveSince: null, updatedAt: 0 };

  const updatedAt = Number(row.updated_at ?? 0);

  // A box that stopped reporting is dark, not paused. Treating a stale row as
  // still-live would leave the page claiming a feed that isn't arriving.
  const fresh = Date.now() - updatedAt < STALE_MS;

  return {
    desired: Number(row.desired) === 1,
    live: fresh && Number(row.live) === 1,
    liveSince: row.live_since === null ? null : Number(row.live_since),
    updatedAt,
  };
}

/**
 * Collapse the two flags into the one word the ui shows.
 *
 * Pure, and exported so the badge and the studio can't disagree about what
 * the same row means.
 */
export function statusOf(state: StreamState): StreamStatus {
  if (state.live) return state.desired ? "live" : "stopping";
  return state.desired ? "connecting" : "offline";
}

/** Set by the studio switch. The box learns about it by polling. */
export async function setDesired(desired: boolean): Promise<void> {
  await initDb();
  await db().execute({
    sql: "UPDATE truman_stream SET desired = ? WHERE id = 1",
    args: [desired ? 1 : 0],
  });
}

/**
 * Called by the box agent on every poll.
 *
 * `live_since` is only stamped on the transition into live, so the elapsed
 * timer on the page counts from when frames actually started rather than
 * from the most recent heartbeat.
 */
export async function reportLive(live: boolean): Promise<void> {
  await initDb();
  const now = Date.now();

  await db().execute({
    sql: `UPDATE truman_stream
             SET live = ?,
                 live_since = CASE
                   WHEN ? = 1 AND (live = 0 OR live_since IS NULL) THEN ?
                   WHEN ? = 0 THEN NULL
                   ELSE live_since
                 END,
                 updated_at = ?
           WHERE id = 1`,
    args: [live ? 1 : 0, live ? 1 : 0, now, live ? 1 : 0, now],
  });
}
