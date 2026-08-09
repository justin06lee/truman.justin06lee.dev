import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { destroySession, getSession, revokeAllSessions } from "@/lib/auth";
import { clearMessages } from "@/lib/chat";

export const dynamic = "force-dynamic";

/**
 * Owner-only eviction.
 *
 * Rotating `TRUMAN_PASSWORD` alone changes nothing for anyone already
 * holding a cookie — this is the half that makes a rotation mean something,
 * and it's also the panic button. The caller's own session is spared so the
 * studio doesn't lock out the person pressing it.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session?.owner) {
    return NextResponse.json({ error: "not the owner" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    clearChat?: unknown;
  };

  if (typeof body.id === "string") {
    if (body.id === session.id) {
      return NextResponse.json({ error: "that one is yours" }, { status: 400 });
    }
    await destroySession(body.id);
    return NextResponse.json({ ok: true, revoked: 1 });
  }

  const revoked = await revokeAllSessions(session.id);
  if (body.clearChat === true) await clearMessages();

  return NextResponse.json({ ok: true, revoked });
}
