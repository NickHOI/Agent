import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SupabaseAuthForm } from "@/components/auth/supabase-auth-form";
import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  const realAuth = process.env.APP_MODE === "supabase";
  if (!realAuth) {
    return (
      <main className="min-h-screen bg-[#090a0c] px-5 py-16 text-white">
        <div className="mx-auto max-w-xl rounded-[6px] border border-[#2a2e36] bg-[#111318] p-6">
          <Brand />
          <h1 className="mt-8 text-2xl font-semibold">Account creation is not part of Demo mode</h1>
          <p className="mt-3 text-sm leading-6 text-[#969da8]">Use a signed Demo role session, or run the configured Supabase workspace for real Auth.</p>
          <ButtonLink href="/sign-in" className="mt-6">Open Demo sign in</ButtonLink>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-[#090a0c] text-white">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Brand />
        <Link href="/" className="focus-ring flex items-center gap-2 rounded-[4px] text-sm text-[#969da8] hover:text-white"><ArrowLeft className="size-4" /> Back</Link>
      </header>
      <div className="mx-auto grid max-w-6xl items-start gap-12 px-5 pb-16 pt-14 md:grid-cols-[1fr_520px] md:pt-24">
        <div className="max-w-lg">
          <h1 className="text-balance text-4xl font-semibold leading-tight text-white md:text-5xl">Create your trust workspace</h1>
          <p className="mt-5 text-base leading-7 text-[#969da8]">Define Work in plain language, lock acceptance before execution, approve only task-scoped Authority, and return to durable Evidence and Receipt history.</p>
          <div className="mt-8 border-l-2 border-[#2f81f7] pl-4 text-sm leading-6 text-[#b2b8c2]">Your Beta workspace starts empty. Demo results and seed counters are never presented as trust evidence.</div>
        </div>
        <SupabaseAuthForm mode="sign-up" />
      </div>
    </main>
  );
}
