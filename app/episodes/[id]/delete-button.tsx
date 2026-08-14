"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/chrome/button";
import { useDialog } from "@/components/chrome/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * Owner-only, and the page only renders it for the owner — the route
 * re-checks, this is just the handle. Deleting is the one thing here that
 * can't be walked back (the clip is the only copy that ever existed), so it
 * goes through the registry dialog rather than firing on a stray tap.
 */
export function DeleteEpisodeButton({ id }: { id: string }) {
  const router = useRouter();
  const { confirm } = useDialog();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    const sure = await confirm({
      title: "delete this episode?",
      message:
        "the clip on the box goes with it, and it is the only copy that ever existed. there is no undo.",
      confirmText: "delete it",
      cancelText: "keep it",
      danger: true,
    });
    if (!sure) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/episodes/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      toast({ title: "episode deleted" });
      router.push("/episodes");
      router.refresh();
    } catch {
      toast({ title: "that didn't take", variant: "danger" });
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>
      delete
    </Button>
  );
}
