import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-[#090a0c] text-white">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Brand />
        <Link href="/" className="focus-ring flex items-center gap-2 rounded-[4px] text-sm text-[#969da8] hover:text-white">
          <ArrowLeft className="size-4" /> Back
        </Link>
      </header>
      <div className="mx-auto grid max-w-6xl items-start gap-12 px-5 pb-16 pt-14 md:grid-cols-[1fr_520px] md:pt-24">
        <div className="max-w-lg">
          <h1 className="text-balance text-4xl font-semibold leading-tight text-white md:text-5xl">Enter the DoneLayer demo</h1>
          <p className="mt-5 text-base leading-7 text-[#969da8]">
            Choose a role to inspect the same persisted marketplace from each side. Role access is enforced by server commands and the production schema includes Supabase RLS.
          </p>
          <div className="mt-8 border-l-2 border-[#2f81f7] pl-4 text-sm leading-6 text-[#b2b8c2]">
            The full demo begins in the Customer workspace and advances through matching, provider acceptance, worker execution, evidence verification and ledger release.
          </div>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
