import "server-only";

import { db, initDb } from "@/lib/db";

/**
 * Chat, over polling.
 *
 * There is no websocket here on purpose. Vercel can't hold a socket open, and
 * for a room of five people a `?since=<id>` poll every couple of seconds is
 * indistinguishable from one — it's the same shape listen.justin06lee.dev
 * uses to keep a room in sync. If it ever needs to be genuinely real-time,
 * that's this one endpoint to swap rather than an architecture.
 */

export const MAX_BODY = 500;
export const PAGE = 100;

export type Message = {
  id: number;
  name: string;
  body: string;
  createdAt: number;
  /** True when this message came from the session asking for it. */
  mine?: boolean;
};

export function validateBody(raw: string): { ok: true; body: string } | { ok: false; error: string } {
  const body = raw.trim();
  if (!body) return { ok: false, error: "say something first" };
  if (body.length > MAX_BODY) return { ok: false, error: `${MAX_BODY} characters max` };
  return { ok: true, body };
}

export async function postMessage(
  sessionId: string,
  name: string,
  body: string,
): Promise<Message> {
  await initDb();
  const createdAt = Date.now();

  const result = await db().execute({
    sql: `INSERT INTO truman_messages (session_id, name, body, created_at)
          VALUES (?, ?, ?, ?) RETURNING id`,
    args: [sessionId, name, body, createdAt],
  });

  return { id: Number(result.rows[0].id), name, body, createdAt, mine: true };
}

/**
 * Messages after `since`, oldest first.
 *
 * `since = 0` means "the tail" — the most recent page — which is what a fresh
 * page load wants. Anything else is a genuine catch-up and returns everything
 * newer, so a poll that was slow to come back never skips messages.
 */
export async function readMessages(
  since: number,
  sessionId?: string,
): Promise<Message[]> {
  await initDb();

  const result = since
    ? await db().execute({
        sql: `SELECT id, session_id, name, body, created_at
                FROM truman_messages WHERE id > ? ORDER BY id ASC`,
        args: [since],
      })
    : await db().execute({
        sql: `SELECT * FROM (
                SELECT id, session_id, name, body, created_at
                  FROM truman_messages ORDER BY id DESC LIMIT ?
              ) ORDER BY id ASC`,
        args: [PAGE],
      });

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    body: String(row.body),
    createdAt: Number(row.created_at),
    mine: sessionId ? String(row.session_id) === sessionId : undefined,
  }));
}

/** Owner-only: wipe the log. */
export async function clearMessages(): Promise<number> {
  await initDb();
  const result = await db().execute("DELETE FROM truman_messages");
  return result.rowsAffected;
}
