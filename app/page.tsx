import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { readMessages } from "@/lib/chat";
import { readStream, statusOf } from "@/lib/stream";
import { Watch } from "./watch";

// The whole point is the picture moving while you look at it.
export const dynamic = "force-dynamic";

export default async function Home() {
  // proxy.ts only checked that a cookie exists. This is where an expired,
  // revoked or forged one is actually turned away.
  const session = await getSession();
  if (!session) redirect("/login");

  const [state, messages] = await Promise.all([readStream(), readMessages(0, session.id)]);

  return (
    <Watch
      initialStatus={statusOf(state)}
      initialLiveSince={state.liveSince}
      initialMessages={messages}
      mediaServer={process.env.NEXT_PUBLIC_MEDIA_URL ?? ""}
      mediaPath={process.env.NEXT_PUBLIC_MEDIA_PATH ?? "live"}
      name={session.name}
    />
  );
}
