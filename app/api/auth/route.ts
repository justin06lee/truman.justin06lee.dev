import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  authConfigured,
  checkRateLimit,
  clearAttempts,
  createSession,
  destroySession,
  getSession,
  recordFailure,
  SESSION_COOKIE,
  tierFor,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_NAME = 24;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  if (!authConfigured()) {
    // Failing closed matters more here than anywhere else on the site: an
    // unset password must never mean an open door.
    console.error("[truman] neither TRUMAN_PASSWORD nor TRUMAN_OWNER_KEY is set");
    return NextResponse.json({ error: "no password is configured" }, { status: 503 });
  }

  const ip = clientIp(request);
  const limit = await checkRateLimit(ip);
  if (!limit.ok) {
    return NextResponse.json({ error: "too many attempts" }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  const rawName = typeof body.name === "string" ? body.name.trim() : "";

  const tier = tierFor(password);
  if (!tier) {
    await recordFailure(ip);
    // Deliberately generic and identical for a wrong password and a missing
    // name, so the response never says which half was wrong.
    return NextResponse.json({ error: "that isn't it" }, { status: 401 });
  }

  const name = (rawName || "someone").slice(0, MAX_NAME);
  await clearAttempts(ip);
  const id = await createSession(name, tier === "owner");

  const response = NextResponse.json({ ok: true, name, owner: tier === "owner" });
  response.cookies.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}

export async function DELETE() {
  const session = await getSession();
  if (session) await destroySession(session.id);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
