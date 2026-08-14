import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { Grain } from "@/components/chrome/grain";
import { getSession } from "@/lib/auth";
import { getEpisode } from "@/lib/episodes";
import { mintToken } from "@/lib/media-token";
import { formatClock, formatDuration } from "@/lib/timelapse";
import { DeleteEpisodeButton } from "./delete-button";

export const dynamic = "force-dynamic";

export default async function EpisodePage({ params }: PageProps<"/episodes/[id]">) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const episode = await getEpisode(id);
  if (!episode) notFound();

  // The clip lives on the box, behind the same token the live stream uses.
  // Minted here rather than in the client because a short-lived token in the
  // page source is fine — it dies in a minute — and one fewer round trip
  // means the video starts on first paint.
  const secret = process.env.TRUMAN_MEDIA_SECRET;
  const server = process.env.NEXT_PUBLIC_MEDIA_URL ?? "";
  // Reading the clock during render is the point here, not an oversight: the
  // route is force-dynamic and a token minted at build time would be born
  // expired.
  // eslint-disable-next-line react-hooks/purity
  const mintedAt = Date.now();
  const src = secret
    ? `${server.replace(/\/$/, "")}${episode.path}?token=${mintToken(session.id, secret, mintedAt)}`
    : "";
  // The recorder files a poster beside every clip; a 404 here just leaves
  // the element's usual black first-frame, so no fallback is needed.
  const poster = src.replace(/\.mp4\?/, ".jpg?");

  const facts: [string, string][] = [
    ["recorded", formatDuration(episode.sourceSeconds)],
    ["clip", formatClock(episode.clipSeconds)],
    ["speed", `${episode.speed}x`],
    ["frames", episode.frames.toLocaleString()],
  ];

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/episodes"
          className="text-[13px] text-white/55 transition-colors hover:text-white"
        >
          all episodes
        </Link>
        {session.owner && <DeleteEpisodeButton id={episode.id} />}
      </div>

      <h1 className="mt-6 text-2xl tracking-tight">
        {new Date(episode.startedAt).toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      </h1>

      <div className="relative mt-6 border border-white/10">
        {src ? (
          <>
            <video src={src} poster={poster} controls playsInline className="w-full bg-black" />
            <Grain variant="noise" opacity={0.06} fixed={false} />
          </>
        ) : (
          <p className="px-4 py-16 text-center text-[13px] text-white/40">
            the media server isn&apos;t configured, so there is nowhere to play this
            from.
          </p>
        )}
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-px border border-white/10 bg-white/10 sm:grid-cols-4">
        {facts.map(([term, value]) => (
          <div key={term} className="bg-black px-4 py-3">
            <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
              {term}
            </dt>
            <dd className="mt-1 text-[15px] text-white/80">{value}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
