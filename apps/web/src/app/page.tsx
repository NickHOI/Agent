import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleDot,
  Clock3,
  FileDiff,
  GitBranch as Github,
  Server,
  ShieldCheck,
  TerminalSquare
} from "lucide-react";
import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status";

const stages = ["Published", "Matched", "Running", "Verifying", "Complete"];

function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-[6px] border border-[#343944] bg-[#0d0f13] shadow-2xl shadow-black/40">
      <div className="flex h-11 items-center justify-between border-b border-[#242831] px-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#b2b8c2]">
          <CircleDot className="size-3.5 text-[#2f81f7]" />
          DL-1042 / Authentication test repair
        </div>
        <StatusBadge label="Verifying" tone="warning" compact />
      </div>
      <div className="border-b border-[#242831] px-5 py-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <h2 className="text-lg font-semibold text-white">Fix failing authentication tests</h2>
            <p className="mt-1.5 text-sm text-[#969da8]">sample-org/react-auth / fix/session-timeout</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="flex items-center gap-1.5 rounded-[4px] border border-[#343944] bg-[#171a20] px-2.5 py-1.5 text-[#b2b8c2]">
              <Server className="size-3.5 text-[#3fb950]" /> Windows Worker 01 / online
            </span>
            <span className="flex items-center gap-1.5 rounded-[4px] border border-[#343944] bg-[#171a20] px-2.5 py-1.5 text-[#b2b8c2]">
              <Clock3 className="size-3.5" /> 08m 42s
            </span>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-5">
          {stages.map((stage, index) => (
            <div key={stage} className="relative flex min-w-0 flex-col items-center gap-2 text-center">
              {index > 0 ? <span className="absolute right-1/2 top-2 h-px w-full bg-[#2f81f7]" /> : null}
              <span className={`relative z-10 flex size-4 items-center justify-center rounded-full border ${index < 4 ? "border-[#2f81f7] bg-[#2f81f7]" : "border-[#3a404b] bg-[#111318]"}`}>
                {index < 4 ? <Check className="size-2.5 text-white" strokeWidth={3} /> : null}
              </span>
              <span className={`truncate text-[11px] font-medium ${index === 3 ? "text-white" : "text-[#666e7a]"}`}>{stage}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid min-h-[300px] md:grid-cols-[1.45fr_1fr]">
        <div className="border-b border-[#242831] p-4 md:border-b-0 md:border-r">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white">
            <TerminalSquare className="size-3.5 text-[#78b5ff]" /> Live execution log
          </div>
          <div className="mono space-y-2 rounded-[5px] border border-[#242831] bg-[#090a0c] p-3 text-[11px] leading-5 text-[#8b949e]">
            <div><span className="text-[#666e7a]">14:32:08</span> Checking out task branch...</div>
            <div><span className="text-[#666e7a]">14:32:11</span> Running approved workflow <span className="text-[#78b5ff]">TEST_AND_FIX</span></div>
            <div><span className="text-[#666e7a]">14:36:44</span> Updated session expiry assertion</div>
            <div><span className="text-[#666e7a]">14:39:02</span> <span className="text-[#72d981]">12 tests passed</span>, 0 failed</div>
            <div className="flex items-center gap-2 text-[#e3b341]"><span className="inline-block size-1.5 animate-pulse rounded-full bg-[#d29922]" /> Building evidence manifest...</div>
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-[#242831] pt-4 text-xs text-[#969da8]">
            <FileDiff className="size-4 text-[#78b5ff]" />
            <span>3 files changed</span>
            <span className="text-[#3fb950]">+42</span>
            <span className="text-[#f85149]">-17</span>
          </div>
        </div>
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <ShieldCheck className="size-3.5 text-[#72d981]" /> Proof-of-Done
            </div>
            <span className="text-xs font-semibold text-[#72d981]">4 / 5 passed</span>
          </div>
          <div className="divide-y divide-[#242831] border-y border-[#242831]">
            {["Build succeeds", "Authentication tests", "Code diff exists", "Evidence hashes verified"].map((check) => (
              <div key={check} className="flex h-10 items-center justify-between text-xs">
                <span className="text-[#b2b8c2]">{check}</span>
                <Check className="size-4 text-[#3fb950]" strokeWidth={2.5} />
              </div>
            ))}
            <div className="flex h-10 items-center justify-between text-xs">
              <span className="text-[#b2b8c2]">Customer approval</span>
              <Clock3 className="size-4 text-[#d29922]" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-[5px] border border-[#343944] bg-[#171a20] p-3">
            <div>
              <div className="text-[11px] text-[#969da8]">Reserved test balance</div>
              <div className="mt-1 text-base font-semibold text-white">$240.00</div>
            </div>
            <span className="text-[11px] font-semibold text-[#e3b341]">Held until accepted</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#090a0c] text-white">
      <header className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 md:px-8">
        <Brand />
        <nav className="hidden items-center gap-7 text-sm font-medium text-[#969da8] md:flex" aria-label="Primary navigation">
          <Link href="/agents" className="hover:text-white">Agent Hall</Link>
          <Link href="/provider" className="hover:text-white">For providers</Link>
          <Link href="/docs" className="hover:text-white">Docs</Link>
        </nav>
        <ButtonLink href="/sign-in" variant="secondary" size="sm">Sign in</ButtonLink>
      </header>

      <section className="mx-auto max-w-[1440px] px-5 pb-14 pt-14 md:px-8 md:pb-20 md:pt-20">
        <div className="max-w-4xl">
          <h1 className="text-balance text-5xl font-semibold leading-[1.02] text-white sm:text-6xl lg:text-7xl">DoneLayer</h1>
          <p className="mt-6 max-w-xl text-lg font-medium leading-7 text-[#b2b8c2]">Get the job finished. Prove it works.</p>
          <p className="mt-8 max-w-2xl text-balance text-xl leading-8 text-[#969da8] md:text-2xl md:leading-9">
            Submit the unfinished project.<br />
            We find the right agent.<br />
            We get it done.<br />
            We prove it works.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/sign-in" className="h-11 px-5">
              Run the full demo <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="/agents" variant="secondary" className="h-11 px-5">Explore verified agents</ButtonLink>
          </div>
        </div>

        <div className="mt-14 md:mt-20">
          <ProductPreview />
        </div>
      </section>

      <section className="border-t border-[#242831] bg-[#0d0f13]">
        <div className="mx-auto grid max-w-[1440px] gap-px bg-[#242831] md:grid-cols-3">
          {[
            { icon: Github, title: "Scoped repository access", copy: "GitHub App permissions stay limited to the selected repository and approved workflow." },
            { icon: Server, title: "Outbound-only workers", copy: "Provider workers poll for accepted jobs and never expose a public inbound port." },
            { icon: ShieldCheck, title: "Independent verification", copy: "Evidence hashes and required checks decide completion, not an agent's claim." }
          ].map(({ icon: Icon, title, copy }) => (
            <div key={title} className="bg-[#0d0f13] px-6 py-8 md:px-8">
              <Icon className="size-5 text-[#78b5ff]" />
              <h2 className="mt-5 text-sm font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#969da8]">{copy}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
