import { redirect } from "next/navigation";
import Link from "next/link";

import { getSession, whoIsWatching } from "@/lib/auth";
import { readStream, statusOf } from "@/lib/stream";
import { StudioClient } from "./studio-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "truman — studio",
  robots: { index: false, follow: false },
};

export default async function StudioPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Not a 403 page: someone who isn't the owner has no business knowing this
  // route resolves to anything.
  if (!session.owner) redirect("/");

  const [state, watching] = await Promise.all([readStream(), whoIsWatching()]);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            truman
          </p>
          <h1 className="mt-2 text-2xl tracking-tight">studio</h1>
        </div>
        <Link
          href="/"
          className="text-[13px] text-white/55 transition-colors hover:text-white"
        >
          back to live
        </Link>
      </header>

      <StudioClient
        initialDesired={state.desired}
        initialStatus={statusOf(state)}
        initialWatching={watching}
      />
    </main>
  );
}
