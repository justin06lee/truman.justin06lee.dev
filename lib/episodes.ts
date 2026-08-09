import "server-only";

import { db, initDb } from "@/lib/db";
import { clipSeconds, frameCount, SPEED } from "@/lib/timelapse";

/**
 * One row per session, written by the box when the stream ends.
 *
 * The full-rate video never exists — the recorder samples frames as they
 * arrive rather than capturing everything and compressing it afterwards, so
 * there is no original to delete and no window where hours of footage sit on
 * a disk waiting for a cleanup job that may not fire. What lands here is the
 * finished clip and the arithmetic that produced it.
 */

export type Episode = {
  id: string;
  startedAt: number;
  endedAt: number;
  /** Real seconds the session ran. */
  sourceSeconds: number;
  speed: number;
  frames: number;
  bytes: number;
  path: string;
  /** Derived, not stored — see below. */
  clipSeconds: number;
};

function rowToEpisode(row: Record<string, unknown>): Episode {
  const sourceSeconds = Number(row.source_seconds);
  const speed = Number(row.speed);

  return {
    id: String(row.id),
    startedAt: Number(row.started_at),
    endedAt: Number(row.ended_at),
    sourceSeconds,
    speed,
    frames: Number(row.frames),
    bytes: Number(row.bytes ?? 0),
    path: String(row.path),
    // Derived from the stored source duration and the speed that was in force
    // when it was recorded, so changing SPEED later never re-dates old clips.
    clipSeconds: clipSeconds(sourceSeconds, speed),
  };
}

export async function listEpisodes(limit = 60): Promise<Episode[]> {
  await initDb();
  const result = await db().execute({
    sql: `SELECT * FROM truman_episodes ORDER BY started_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map((row) => rowToEpisode(row as Record<string, unknown>));
}

export async function getEpisode(id: string): Promise<Episode | null> {
  await initDb();
  const result = await db().execute({
    sql: "SELECT * FROM truman_episodes WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  return row ? rowToEpisode(row as Record<string, unknown>) : null;
}

export type EpisodeTotals = {
  count: number;
  sourceSeconds: number;
  clipSeconds: number;
  frames: number;
};

export async function episodeTotals(): Promise<EpisodeTotals> {
  await initDb();
  const result = await db().execute(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(source_seconds), 0) AS source_seconds,
            COALESCE(SUM(frames), 0) AS frames
       FROM truman_episodes`,
  );
  const row = result.rows[0];
  const sourceSeconds = Number(row?.source_seconds ?? 0);

  return {
    count: Number(row?.count ?? 0),
    sourceSeconds,
    clipSeconds: clipSeconds(sourceSeconds),
    frames: Number(row?.frames ?? 0),
  };
}

export type RecordedEpisode = {
  id: string;
  startedAt: number;
  endedAt: number;
  path: string;
  bytes?: number;
  frames?: number;
};

/**
 * Written by the box on `runOnNotReady`.
 *
 * `frames` is what ffmpeg actually produced; when the box doesn't report it,
 * it's computed from the span. The two can differ — a dropped connection
 * mid-session loses frames the wall clock still counted — so the reported
 * number always wins.
 */
export async function recordEpisode(episode: RecordedEpisode): Promise<void> {
  await initDb();
  const sourceSeconds = Math.max(
    0,
    Math.round((episode.endedAt - episode.startedAt) / 1000),
  );

  await db().execute({
    sql: `INSERT OR REPLACE INTO truman_episodes
            (id, started_at, ended_at, source_seconds, speed, frames, bytes, path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      episode.id,
      episode.startedAt,
      episode.endedAt,
      sourceSeconds,
      SPEED,
      episode.frames ?? frameCount(sourceSeconds),
      episode.bytes ?? 0,
      episode.path,
    ],
  });
}

export async function deleteEpisode(id: string): Promise<void> {
  await initDb();
  await db().execute({ sql: "DELETE FROM truman_episodes WHERE id = ?", args: [id] });
}
