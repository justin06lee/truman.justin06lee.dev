import { NextResponse } from "next/server";

import { getSession, sweepExpired, whoIsWatching } from "@/lib/auth";
import { readStream, statusOf } from "@/lib/stream";

export const dynamic = "force-dynamic";

/**
 * What the live page polls: is it on, and who else is here.
 *
 * Presence falls out of `getSession()` stamping `seen_at` — this poll is what
 * keeps the caller counted, so there is no separate heartbeat to run.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Expired-row cleanup rides this poll because it is the one request every
  // open tab is guaranteed to keep making. At most once an hour, and never
  // in the way of the response.
  void sweepExpired().catch(() => {});

  const [state, watching] = await Promise.all([readStream(), whoIsWatching()]);

  return NextResponse.json({
    status: statusOf(state),
    liveSince: state.liveSince,
    watching,
  });
}
