"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

const inputClass = "focus-ring h-11 w-full rounded-[5px] border border-[#343944] bg-[#090a0c] pl-10 pr-3 text-sm text-white placeholder:text-[#555d68]";

export function SupabaseAuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(mode === "sign-up" ? { displayName } : {}), email, password }),
      });
      const body = await response.json() as { error?: string; message?: string; destination?: string; confirmationRequired?: boolean };
      if (!response.ok && !body.confirmationRequired) throw new Error(body.error ?? "Authentication failed.");
      if (body.confirmationRequired) {
        setMessage(body.message ?? "Confirm your email, then sign in.");
        return;
      }
      router.replace(body.destination ?? "/customer");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-[6px] border border-[#2a2e36] bg-[#111318] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-white">{mode === "sign-in" ? "Sign in to your workspace" : "Create a private Beta workspace"}</h2>
        <p className="mt-1.5 text-xs leading-5 text-[#969da8]">Your session is issued by Supabase Auth and stored in secure SSR cookies.</p>
      </div>
      <div className="space-y-4">
        {mode === "sign-up" ? (
          <label className="block text-xs font-semibold text-[#b2b8c2]">
            Display name
            <span className="relative mt-2 block">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#666e7a]" />
              <input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className={inputClass} required minLength={2} maxLength={120} />
            </span>
          </label>
        ) : null}
        <label className="block text-xs font-semibold text-[#b2b8c2]">
          Email
          <span className="relative mt-2 block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#666e7a]" />
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} required />
          </span>
        </label>
        <label className="block text-xs font-semibold text-[#b2b8c2]">
          Password
          <span className="relative mt-2 block">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#666e7a]" />
            <input type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} required minLength={mode === "sign-up" ? 12 : 1} />
          </span>
        </label>
      </div>
      {error ? <div role="alert" className="mt-4 rounded-[5px] border border-[#6d2f2f] bg-[#211113] px-3 py-2.5 text-xs leading-5 text-[#ff8e88]">{error}</div> : null}
      {message ? <div role="status" className="mt-4 rounded-[5px] border border-[#365c3d] bg-[#102018] px-3 py-2.5 text-xs leading-5 text-[#8be29a]">{message}</div> : null}
      <Button type="submit" className="mt-5 w-full" disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        {mode === "sign-in" ? "Sign in" : "Create workspace"}
      </Button>
      <p className="mt-5 text-center text-xs text-[#969da8]">
        {mode === "sign-in" ? "New to DoneLayer?" : "Already have a workspace?"}{" "}
        <Link href={mode === "sign-in" ? "/sign-up" : "/sign-in"} className="font-semibold text-[#8fc2ff] hover:text-white">
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
