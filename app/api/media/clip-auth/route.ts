import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { db, initDb } from "@/lib/db";
import { verifyToken } from "@/lib/media-token";

export const dynamic = "force-dynamic";

/**
 * Caddy's `forward_auth` hook, guarding the finished clips on the box.
 *
 * Same contract as `/api/media/auth`, different shape: MediaMTX posts json,
 * Caddy replays the original request as a GET and only looks at the status
 * code. Without this the clips would be a plain open directory — the live
 * stream would be gated and the archive of it wouldn't.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.TRUMAN_MEDIA_SECRET;
  if (!secret) return new NextResponse(null, { status: 401 });

  const token = request.nextUrl.searchParams.get("token") ?? "";
  const result = verifyToken(token, secret, Date.now());
  if (!result.ok) return new NextResponse(null, { status: 401 });

  await initDb();
  const session = await db().execute({
    sql: "SELECT id FROM truman_sessions WHERE id = ?",
    args: [result.payload.sessionId],
  });
  if (session.rows.length === 0) return new NextResponse(null, { status: 401 });

  return new NextResponse(null, { status: 200 });
}
