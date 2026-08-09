import { redirect } from "next/navigation";
import Link from "next/link";
import { Clapperboard } from "lucide-react";

import { Card, CardHeader, CardMeta, CardTitle } from "@/components/chrome/card";
import { EmptyState } from "@/components/chrome/empty-state";
import { StatTile } from "@/components/chrome/stat-tile";
import { getSession } from "@/lib/auth";
import { episodeTotals, listEpisodes } from "@/lib/episodes";
import { formatClock, formatDuration, SPEED } from "@/lib/timelapse";

export const dynamic = "force-dynamic";

export const metadata = { title: "truman — episodes" };

function dayOf(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default async function EpisodesPage() {
  if (!(await getSession())) redirect("/login");

  const [episodes, totals] = await Promise.all([listEpisodes(), episodeTotals()]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            truman
          </p>
          <h1 className="mt-2 text-2xl tracking-tight">episodes</h1>
          <p className="mt-2 max-w-prose text-[15px] leading-7 text-white/55">
            every session, sped up {SPEED} times. the full-rate video is never
            written to disk — what you see is all there ever was.
          </p>
        </div>
        <Link
          href="/"
          className="shrink-0 text-[13px] text-white/55 transition-colors hover:text-white"
        >
          back to live
        </Link>
      </header>

      <div className="mt-10 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-3">
        <StatTile label="episodes" value={totals.count} className="border-0 bg-black" />
        <StatTile
          label="recorded"
          value={formatDuration(totals.sourceSeconds)}
          footnote="real time, in front of the camera"
          className="border-0 bg-black"
        />
        <StatTile
          label="watchable"
          value={formatClock(totals.clipSeconds)}
          footnote={`all of it, at ${SPEED}x`}
          className="border-0 bg-black"
        />
      </div>

      {episodes.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<Clapperboard className="size-5" aria-hidden="true" />}
            title="no episodes yet"
            description="one lands here every time a session ends."
          />
        </div>
      ) : (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {episodes.map((episode) => (
            <li key={episode.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle href={`/episodes/${episode.id}`}>
                    {dayOf(episode.startedAt)}
                  </CardTitle>
                  <CardMeta>
                    {timeOf(episode.startedAt)} until {timeOf(episode.endedAt)}
                  </CardMeta>
                </CardHeader>
                <div className="mt-4 flex items-baseline justify-between border-t border-white/10 pt-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
                    {formatDuration(episode.sourceSeconds)}
                  </span>
                  <span className="font-mono text-[13px] text-white/70">
                    {formatClock(episode.clipSeconds)}
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
