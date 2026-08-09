import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { db, initDb } from "@/lib/db";

export const SESSION_COOKIE = "truman_session";

/** A session is forgotten after this long without a request. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Someone is "here" if they've been seen inside this window. */
export const PRESENCE_MS = 45_000;

const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;

export type Session = {
  id: string;
  name: string;
  owner: boolean;
};

/**
 * Constant-time compare of two secrets of unrelated length.
 *
 * `timingSafeEqual` throws unless the buffers match in length, and padding to
 * compare would leak the length through the exception. Hashing both sides
 * first makes every comparison 32 bytes regardless of what was typed.
 */
function secretEquals(a: string, b: string | undefined): boolean {
  if (!b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type Tier = "owner" | "viewer" | null;

/**
 * Which door the password opens.
 *
 * The owner key is checked first so that setting both variables to the same
 * string grants the higher tier rather than the lower one.
 */
export function tierFor(password: string): Tier {
  if (secretEquals(password, process.env.TRUMAN_OWNER_KEY)) return "owner";
  if (secretEquals(password, process.env.TRUMAN_PASSWORD)) return "viewer";
  return null;
}

/** True when no password is configured at all — the site cannot be entered. */
export function authConfigured(): boolean {
  return Boolean(process.env.TRUMAN_PASSWORD || process.env.TRUMAN_OWNER_KEY);
}

export async function checkRateLimit(
  ip: string,
): Promise<{ ok: true } | { ok: false; until: number }> {
  await initDb();
  const now = Date.now();

  const result = await db().execute({
    sql: "SELECT count, first_at, until FROM truman_attempts WHERE ip = ?",
    args: [ip],
  });
  const row = result.rows[0];

  if (row?.until && Number(row.until) > now) {
    return { ok: false, until: Number(row.until) };
  }

  // The window has rolled over, or this ip has never tried — start fresh.
  if (!row || now - Number(row.first_at) > ATTEMPT_WINDOW_MS) {
    await db().execute({
      sql: `INSERT INTO truman_attempts (ip, count, first_at, until) VALUES (?, 0, ?, NULL)
            ON CONFLICT(ip) DO UPDATE SET count = 0, first_at = excluded.first_at, until = NULL`,
      args: [ip, now],
    });
    return { ok: true };
  }

  if (Number(row.count) >= MAX_ATTEMPTS) {
    const until = now + LOCKOUT_MS;
    await db().execute({
      sql: "UPDATE truman_attempts SET until = ? WHERE ip = ?",
      args: [until, ip],
    });
    return { ok: false, until };
  }

  return { ok: true };
}

export async function recordFailure(ip: string): Promise<void> {
  await db().execute({
    sql: "UPDATE truman_attempts SET count = count + 1 WHERE ip = ?",
    args: [ip],
  });
}

export async function clearAttempts(ip: string): Promise<void> {
  await db().execute({ sql: "DELETE FROM truman_attempts WHERE ip = ?", args: [ip] });
}

export async function createSession(name: string, owner: boolean): Promise<string> {
  await initDb();
  const id = randomUUID();
  const now = Date.now();

  await db().execute({
    sql: `INSERT INTO truman_sessions (id, name, owner, created_at, seen_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, name, owner ? 1 : 0, now, now],
  });

  return id;
}

/**
 * The current session, or null.
 *
 * This also stamps `seen_at`, which is what presence is counted from — so
 * "who's watching" is a by-product of reading the page rather than a separate
 * heartbeat to keep alive.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  await initDb();
  const now = Date.now();

  const result = await db().execute({
    sql: "SELECT id, name, owner, seen_at FROM truman_sessions WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;

  if (now - Number(row.seen_at) > SESSION_TTL_MS) {
    await db().execute({ sql: "DELETE FROM truman_sessions WHERE id = ?", args: [id] });
    return null;
  }

  await db().execute({
    sql: "UPDATE truman_sessions SET seen_at = ? WHERE id = ?",
    args: [now, id],
  });

  return {
    id: String(row.id),
    name: String(row.name),
    owner: Number(row.owner) === 1,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("unauthenticated");
  return session;
}

export async function destroySession(id: string): Promise<void> {
  await db().execute({ sql: "DELETE FROM truman_sessions WHERE id = ?", args: [id] });
}

/**
 * Drop every session but the caller's.
 *
 * This is the "everyone out" control in the studio, and it is also what makes
 * rotating the password meaningful: without it, anyone already holding a
 * cookie keeps watching after the word changes.
 */
export async function revokeAllSessions(exceptId: string): Promise<number> {
  const result = await db().execute({
    sql: "DELETE FROM truman_sessions WHERE id != ?",
    args: [exceptId],
  });
  return result.rowsAffected;
}

export async function whoIsWatching(): Promise<{ id: string; name: string }[]> {
  await initDb();
  const result = await db().execute({
    sql: `SELECT id, name FROM truman_sessions WHERE seen_at > ? ORDER BY seen_at DESC`,
    args: [Date.now() - PRESENCE_MS],
  });
  return result.rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}
