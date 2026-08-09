"use client";

import { useRouter } from "next/navigation";

import { LoginForm } from "@/components/chrome/login-form";
import type { LoginCredentials } from "@/hooks/use-login-form";

/**
 * Name and password are collected together.
 *
 * With one shared password the site can't tell two people apart, so the name
 * is self-declared — asking for it at the door rather than after means chat
 * never has to render an "anonymous" that someone has to go and fix.
 */
export function LoginClient({ next }: { next: string }) {
  const router = useRouter();

  async function onSubmit(credentials: LoginCredentials) {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });

    if (response.ok) {
      router.push(next);
      router.refresh();
      return;
    }

    if (response.status === 429) return { rateLimited: true };

    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "that isn't it" };
  }

  return (
    <LoginForm
      onSubmit={onSubmit}
      title="log in"
      submitLabel="come in"
      loadingLabel="opening..."
      fields={[
        {
          name: "name",
          label: "what should people call you",
          placeholder: "name",
          autoComplete: "nickname",
        },
        {
          name: "password",
          label: "password",
          type: "password",
          placeholder: "password",
          autoComplete: "current-password",
        },
      ]}
    />
  );
}
