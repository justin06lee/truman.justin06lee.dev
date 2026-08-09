import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSession } from "@/lib/auth";
import { isBox } from "@/lib/box";
import { readStream, setDesired } from "@/lib/stream";

export const dynamic = "force-dynamic";

/**
 * The switch, from both sides.
 *
 * GET is what the box agent polls: it asks whether it should be running and
 * starts or kills ffmpeg to match. That inversion — the box reaching out
 * rather than the site reaching in — is why none of this needs an inbound
 * connection to the house, and why the kill switch works from a phone.
 *
 * POST is the studio toggle.
 */
export async function GET(request: NextRequest) {
  if (!isBox(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const state = await readStream();
  return NextResponse.json({ live: state.desired });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.owner) {
    return NextResponse.json({ error: "not the owner" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { live?: unknown };
  if (typeof body.live !== "boolean") {
    return NextResponse.json({ error: "live must be a boolean" }, { status: 400 });
  }

  await setDesired(body.live);
  return NextResponse.json({ ok: true, live: body.live });
}
