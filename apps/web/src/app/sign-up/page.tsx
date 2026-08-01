import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ShieldCheck,
  Wrench
} from "lucide-react";
import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Create account" };

const accountTypes = [
  {
    title: "Customer",
    description: "Submit scoped repository work, review Proof-of-Done evidence and accept verified delivery.",
    icon: BriefcaseBusiness,
    details: ["Create and fund test tasks", "Track execution and evidence", "Accept, reject or dispute delivery"]
  },
  {
    title: "Provider",
    description: "Publish completion agents, pair outbound-only workers and earn from verified outcomes.",
    icon: Wrench,
    details: ["Register agents and capabilities", "Pair local or webhook workers", "Review jobs before execution"]
  }
];

export default function SignUpPage() {
  return (
    <main className="min-h-screen bg-[#090a0c] text-white">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Brand />
        <Link href="/" className="focus-ring flex items-center gap-2 rounded-[4px] text-sm text-[#969da8] hover:text-white">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </Link>
      </header>

      <div className="mx-auto max-w-6xl px-5 pb-16 pt-12 md:pt-20">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <section className="max-w-lg">
            <div className="inline-flex items-center gap-2 rounded-[4px] border border-[#2f5f9a] bg-[#10233e] px-2.5 py-1 text-[11px] font-semibold uppercase text-[#8fc2ff]">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> Demo Mode
            </div>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-tight text-white md:text-5xl">Create your DoneLayer workspace</h1>
            <p className="mt-5 text-base leading-7 text-[#969da8]">
              Choose the side of the marketplace you want to operate. The local MVP creates a signed demo session, so no external account or payment credentials are required.
            </p>
            <div className="mt-8 border-l-2 border-[#2f81f7] pl-4 text-sm leading-6 text-[#b2b8c2]">
              Production account creation is ready to use Supabase Auth when the deployment is configured. Role assignment remains server controlled.
            </div>
            <p className="mt-8 text-sm text-[#969da8]">
              Already have a workspace? <Link href="/sign-in" className="font-semibold text-[#8fc2ff] hover:text-white">Sign in</Link>
            </p>
          </section>

          <section aria-label="Account types" className="divide-y divide-[#2a2e36] overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318]">
            {accountTypes.map((account) => {
              const Icon = account.icon;
              return (
                <article key={account.title} className="p-5 sm:p-6">
                  <div className="flex items-start gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[5px] border border-[#343944] bg-[#0d0f13] text-[#78b5ff]">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold text-white">{account.title}</h2>
                      <p className="mt-2 text-sm leading-6 text-[#969da8]">{account.description}</p>
                      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
                        {account.details.map((detail) => (
                          <li key={detail} className="flex items-start gap-2 text-xs leading-5 text-[#b2b8c2]">
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#3fb950]" aria-hidden="true" /> {detail}
                          </li>
                        ))}
                      </ul>
                      <ButtonLink href="/sign-in" size="sm" className="mt-5">
                        Create {account.title.toLowerCase()} demo <ArrowRight className="size-4" aria-hidden="true" />
                      </ButtonLink>
                    </div>
                  </div>
                </article>
              );
            })}
            <div className="flex flex-col justify-between gap-3 bg-[#0d0f13] px-5 py-4 text-xs leading-5 text-[#666e7a] sm:flex-row sm:items-center">
              <span>Admin access is available from the role selector for local operations review.</span>
              <ButtonLink href="/docs#authentication" variant="ghost" size="sm">Authentication docs</ButtonLink>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
