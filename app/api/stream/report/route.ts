import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isBox } from "@/lib/box";
import { reportLive } from "@/lib/stream";

export const dynamic = "force-dynamic";

/** The box's heartbeat: "frames are actually going out" / "they aren't". */
export async function POST(request: NextRequest) {
  if (!isBox(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { live?: unknown };
  await reportLive(body.live === true);

  return NextResponse.json({ ok: true });
}
