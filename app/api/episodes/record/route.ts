import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isBox } from "@/lib/box";
import { recordEpisode } from "@/lib/episodes";

export const dynamic = "force-dynamic";

/**
 * Posted by the box on `runOnNotReady`, once the clip is finished.
 *
 * The clip itself never comes through here — it stays on the box and is
 * served from there through the same token auth as the live stream. This is
 * only the row that says it exists.
 */
export async function POST(request: NextRequest) {
  if (!isBox(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const id = typeof body.id === "string" ? body.id : "";
  const startedAt = Number(body.startedAt);
  const endedAt = Number(body.endedAt);
  const path = typeof body.path === "string" ? body.path : "";

  if (!id || !path || !Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return NextResponse.json(
      { error: "id, path, startedAt and endedAt are required" },
      { status: 400 },
    );
  }
  if (endedAt < startedAt) {
    return NextResponse.json({ error: "endedAt precedes startedAt" }, { status: 400 });
  }

  await recordEpisode({
    id,
    startedAt,
    endedAt,
    path,
    bytes: Number.isFinite(Number(body.bytes)) ? Number(body.bytes) : undefined,
    frames: Number.isFinite(Number(body.frames)) ? Number(body.frames) : undefined,
  });

  return NextResponse.json({ ok: true });
}
