import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSession } from "@/lib/auth";
import { postMessage, readMessages, validateBody } from "@/lib/chat";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const since = Number(request.nextUrl.searchParams.get("since") ?? 0);
  const messages = await readMessages(Number.isFinite(since) ? since : 0, session.id);

  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { body?: unknown };
  const validated = validateBody(typeof body.body === "string" ? body.body : "");
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  // The name is taken from the session, never from the request — otherwise
  // anyone could post as anyone, which is the whole identity model here.
  const message = await postMessage(session.id, session.name, validated.body);
  return NextResponse.json({ message });
}
