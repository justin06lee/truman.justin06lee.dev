import { unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { deleteEpisode, getEpisode } from "@/lib/episodes";

export const dynamic = "force-dynamic";

/**
 * Owner-only: delete an episode, row and file both.
 *
 * The row goes first — once it's gone the clip is unreachable through the
 * site even if the unlink fails, because every clip url is minted from a row.
 * The file itself lives in TRUMAN_CLIPS, which the site can reach directly
 * now that it runs on the same machine as the recorder; a deployment
 * elsewhere just loses the unlink, not the delete, and says so in its logs.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/episodes/[id]">,
) {
  const session = await getSession();
  if (!session?.owner) {
    return NextResponse.json({ error: "not the owner" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const episode = await getEpisode(id);
  if (!episode) {
    return NextResponse.json({ error: "no such episode" }, { status: 404 });
  }

  await deleteEpisode(id);

  // basename(), so a doctored path in the row can never point the unlink
  // outside the clips directory.
  const clips = process.env.TRUMAN_CLIPS ?? "/var/lib/truman/clips";
  const clip = basename(episode.path);
  let removed = 0;

  try {
    await unlink(join(clips, clip));
    removed += 1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `[truman] episode ${id} deleted but its clip was not: ${String(error)}`,
      );
    }
  }

  return NextResponse.json({ ok: true, filesRemoved: removed });
}
