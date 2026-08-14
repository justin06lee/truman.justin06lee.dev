import "server-only";

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createClient, type Client } from "@libsql/client";

/**
 * One client, three possible destinations — but only one code path.
 *
 * The sibling sites fall back to an in-process object when Turso isn't
 * configured. That works when the state is a single row (listen's room) and
 * stops working here, where there are four tables and an append-only chat
 * log: a second implementation of every query is a second place for the two
 * to disagree.
 *
 * libsql speaks `file:` and `:memory:` with the same client and the same SQL,
 * so the fallback is a connection string rather than a parallel store. A
 * fresh clone runs with no env at all and keeps its data between restarts;
 * only the deployed-without-credentials case forgets anything.
 *
 * The client is built on first use rather than at import: Next imports every
 * route to collect page data, and a module-scope client turns a missing
 * credential into a failed build instead of a failed request.
 */
let client: Client | null = null;
let ready: Promise<void> | null = null;

function url(): string {
  const turso = process.env.TURSO_DATABASE_URL;
  if (turso) return turso;

  // A serverless filesystem is read-only outside /tmp, so a file url in that
  // kind of production would fail on the first write rather than degrade. The
  // box runs production too, but with Turso configured this branch never
  // fires there.
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[truman] TURSO_DATABASE_URL unset in production — using an in-memory database. " +
        "chat, episodes and logins will not survive a restart.",
    );
    return ":memory:";
  }

  return "file:.data/truman.db";
}

export function db(): Client {
  if (!client) {
    const target = url();

    // libsql opens the file but won't create the directory holding it, and
    // the failure surfaces as a bare "code: 14" that says nothing about a
    // missing folder.
    if (target.startsWith("file:")) {
      mkdirSync(dirname(target.slice("file:".length)), { recursive: true });
    }

    client = createClient({ url: target, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}

/**
 * Idempotent schema bootstrap, memoized per process.
 *
 * Tables are namespaced `truman_` because the Turso database is shared with
 * every other justin06lee.dev site — the same reason oddjob namespaces its
 * own. Nothing here touches another site's tables.
 */
export async function initDb(): Promise<void> {
  ready ??= (async () => {
    await db().batch(
      [
        `CREATE TABLE IF NOT EXISTS truman_sessions (
           id         TEXT PRIMARY KEY,
           name       TEXT NOT NULL,
           owner      INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER NOT NULL,
           seen_at    INTEGER NOT NULL
         )`,

        `CREATE TABLE IF NOT EXISTS truman_messages (
           id         INTEGER PRIMARY KEY AUTOINCREMENT,
           session_id TEXT NOT NULL,
           name       TEXT NOT NULL,
           body       TEXT NOT NULL,
           created_at INTEGER NOT NULL
         )`,

        `CREATE TABLE IF NOT EXISTS truman_episodes (
           id             TEXT PRIMARY KEY,
           started_at     INTEGER NOT NULL,
           ended_at       INTEGER NOT NULL,
           source_seconds INTEGER NOT NULL,
           speed          INTEGER NOT NULL,
           frames         INTEGER NOT NULL,
           bytes          INTEGER NOT NULL DEFAULT 0,
           path           TEXT NOT NULL
         )`,

        // One row. `desired` is what the studio switch says; `live` is what the
        // box last reported. They disagree for exactly as long as it takes the
        // agent to notice, which is what makes the ui able to say "connecting".
        `CREATE TABLE IF NOT EXISTS truman_stream (
           id         INTEGER PRIMARY KEY CHECK (id = 1),
           desired    INTEGER NOT NULL DEFAULT 0,
           live       INTEGER NOT NULL DEFAULT 0,
           live_since INTEGER,
           updated_at INTEGER NOT NULL DEFAULT 0
         )`,

        `CREATE TABLE IF NOT EXISTS truman_attempts (
           ip       TEXT PRIMARY KEY,
           count    INTEGER NOT NULL DEFAULT 0,
           first_at INTEGER NOT NULL,
           until    INTEGER
         )`,

        `CREATE INDEX IF NOT EXISTS idx_truman_messages_id ON truman_messages(id)`,
        `CREATE INDEX IF NOT EXISTS idx_truman_sessions_seen ON truman_sessions(seen_at)`,
        `CREATE INDEX IF NOT EXISTS idx_truman_episodes_started ON truman_episodes(started_at DESC)`,

        `INSERT OR IGNORE INTO truman_stream (id, desired, live, updated_at)
           VALUES (1, 0, 0, 0)`,
      ],
      "write",
    );
  })();

  return ready;
}
