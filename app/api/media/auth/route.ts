import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { db, initDb } from "@/lib/db";
import { verifyToken } from "@/lib/media-token";

export const dynamic = "force-dynamic";

/**
 * MediaMTX's external authentication hook. This is the security boundary for
 * the video itself.
 *
 * MediaMTX posts here before serving any stream and refuses the connection on
 * a non-2xx. Gating the pages without this would leave the WHEP and HLS urls
 * publicly readable — a permanent link to the room for anyone who ever opened
 * a network tab.
 *
 * `publish` is the box pushing its camera in; `read` is someone watching.
 * They authenticate differently on purpose: the box holds a long-lived key
 * and viewers hold sixty-second signed tokens. The box's key is good for
 * reading too — the recorder and the doctor read the stream back over
 * loopback.
 */

type AuthRequest = {
  user?: string;
  password?: string;
  ip?: string;
  action?: "publish" | "read" | "playback" | "api" | "metrics" | "pprof";
  path?: string;
  protocol?: string;
  id?: string;
  query?: string;
};

function deny(reason: string) {
  // MediaMTX only looks at the status code; the body is for our own logs.
  return NextResponse.json({ error: reason }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as AuthRequest;

  if (body.action === "publish") {
    const expected = process.env.TRUMAN_BOX_KEY;
    if (!expected || body.password !== expected) return deny("bad publish key");
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "read" && body.action !== "playback") {
    return deny(`action ${body.action ?? "unknown"} is not allowed`);
  }

  // The box reads its own stream back — the timelapse recorder holds an RTSP
  // connection open on loopback, and the doctor's probe is a read too. The
  // publish key covers those: anyone holding it could already put frames in,
  // so letting it take frames out concedes nothing new.
  const boxKey = process.env.TRUMAN_BOX_KEY;
  if (boxKey && body.password === boxKey) return NextResponse.json({ ok: true });

  const secret = process.env.TRUMAN_MEDIA_SECRET;
  if (!secret) return deny("media auth is not configured");

  const result = verifyToken(body.password ?? "", secret, Date.now());
  if (!result.ok) return deny(result.reason);

  // The signature proves the token was minted for a session; this proves the
  // session still exists. It's what makes "everyone out" and a password
  // rotation take effect on the video within seconds rather than whenever the
  // last token happens to expire. One read per connection, not per frame.
  await initDb();
  const session = await db().execute({
    sql: "SELECT id FROM truman_sessions WHERE id = ?",
    args: [result.payload.sessionId],
  });
  if (session.rows.length === 0) return deny("session revoked");

  return NextResponse.json({ ok: true });
}
