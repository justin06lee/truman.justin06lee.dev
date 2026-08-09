import { redirect } from "next/navigation";

import { Grain } from "@/components/chrome/grain";
import { getSession } from "@/lib/auth";
import { LoginClient } from "./login-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "truman — log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");

  const { next } = await searchParams;

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-6">
      <Grain variant="noise" opacity={0.06} animate />

      <div className="w-full max-w-sm">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          truman
        </p>
        <h1 className="mt-2 text-2xl tracking-tight">a camera, pointed at me.</h1>
        <p className="mt-2 text-[15px] leading-7 text-white/55">
          this one is not public. you either have the word or you don&apos;t.
        </p>

        <div className="mt-8 border border-white/10 p-5">
          <LoginClient next={typeof next === "string" ? next : "/"} />
        </div>
      </div>
    </main>
  );
}
