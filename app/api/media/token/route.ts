import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { mintToken, TOKEN_TTL_MS } from "@/lib/media-token";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const secret = process.env.TRUMAN_MEDIA_SECRET;
  if (!secret) {
    // Without a secret the media server has nothing to verify against, so it
    // would either refuse everyone or accept everyone. Say so rather than
    // minting a token that means nothing.
    console.error("[truman] TRUMAN_MEDIA_SECRET is unset — the video path is unguarded");
    return NextResponse.json({ error: "media auth is not configured" }, { status: 503 });
  }

  return NextResponse.json({
    token: mintToken(session.id, secret, Date.now()),
    expiresIn: TOKEN_TTL_MS,
  });
}
