import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GitBranch as Github,
  KeyRound,
  Server,
  ShieldCheck,
  TerminalSquare,
  Workflow
} from "lucide-react";
import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Docs" };

const sections = [
  ["quick-start", "Quick start"],
  ["demo-lifecycle", "Demo lifecycle"],
  ["worker", "Worker"],
  ["authentication", "Authentication"],
  ["integrations", "Integrations"],
  ["security", "Security"],
  ["verification", "Verification"]
] as const;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mono mt-4 overflow-x-auto rounded-[6px] border border-[#2a2e36] bg-[#090a0c] p-4 text-xs leading-6 text-[#b2b8c2]">
      <code>{children}</code>
    </pre>
  );
}

function SectionHeading({ id, title, copy }: { id: string; title: string; copy: string }) {
  return (
    <div id={id} className="scroll-mt-24 border-b border-[#242831] pb-5">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#969da8]">{copy}</p>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#090a0c] text-white">
      <header className="sticky top-0 z-20 border-b border-[#242831] bg-[#0d0f13]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-4">
            <Brand />
            <span className="hidden h-5 w-px bg-[#343944] sm:block" />
            <span className="hidden text-sm font-semibold text-[#b2b8c2] sm:block">Documentation</span>
          </div>
          <div className="flex items-center gap-2">
            <ButtonLink href="/sign-up" variant="ghost" size="sm">Create account</ButtonLink>
            <ButtonLink href="/sign-in" size="sm">Open demo <ArrowRight className="size-4" aria-hidden="true" /></ButtonLink>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-14">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1" aria-label="Documentation sections">
            <Link href="/" className="focus-ring mb-5 flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-xs font-semibold text-[#969da8] hover:text-white">
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Product home
            </Link>
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="focus-ring block rounded-[4px] px-2 py-2 text-sm text-[#969da8] hover:bg-[#171a20] hover:text-white">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 max-w-4xl">
          <div className="border-b border-[#242831] pb-10">
            <div className="text-xs font-semibold uppercase text-[#78b5ff]">DoneLayer MVP</div>
            <h1 className="mt-3 text-balance text-4xl font-semibold leading-tight text-white md:text-5xl">Operate the completion marketplace</h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-[#969da8]">
              Run the complete customer, provider, worker, verification and simulated settlement path locally. External integrations remain optional in Demo Mode.
            </p>
          </div>

          <section className="py-10">
            <SectionHeading id="quick-start" title="Quick start" copy="The repository is an npm workspaces monorepo. Node.js 24 or newer is required." />
            <CodeBlock>{`npm install\nCopy-Item .env.example .env.local\nnpm run dev`}</CodeBlock>
            <p className="mt-4 text-sm leading-6 text-[#969da8]">
              Open <code className="mono text-[#b2b8c2]">http://localhost:3000</code>, select <strong className="text-white">Run the full demo</strong>, then continue as Customer.
            </p>
          </section>

          <section className="border-t border-[#242831] py-10">
            <SectionHeading id="demo-lifecycle" title="Demo lifecycle" copy="Each transition is validated on the server and recorded in the local SQLite Demo Store." />
            <div className="mt-6 grid gap-px overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#2a2e36] sm:grid-cols-4">
              {["Publish and analyze", "Match and accept", "Execute and prove", "Review and release"].map((step, index) => (
                <div key={step} className="bg-[#111318] p-4">
                  <div className="text-[11px] font-semibold text-[#78b5ff]">STEP {index + 1}</div>
                  <div className="mt-2 text-sm font-semibold text-white">{step}</div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm leading-6 text-[#969da8]">
              The flow reaches <code className="mono text-[#72d981]">COMPLETED</code> only after every required acceptance check passes and the Customer accepts delivery. Refreshing the page reads the same persisted task, evidence and ledger entries.
            </p>
          </section>

          <section className="border-t border-[#242831] py-10">
            <SectionHeading id="worker" title="Worker CLI" copy="The cross-platform worker makes outbound requests only and claims jobs after provider acceptance." />
            <div className="mt-6 flex items-start gap-3 text-sm leading-6 text-[#b2b8c2]">
              <Server className="mt-0.5 size-5 shrink-0 text-[#78b5ff]" aria-hidden="true" />
              <p>Create a one-time pairing code in the Provider workspace, exchange it from the worker, then start heartbeat and job polling.</p>
            </div>
            <CodeBlock>{`npm run worker:doctor\nnpm run worker:setup\nnpm run worker:start\nnpm run worker:status`}</CodeBlock>
            <p className="mt-4 text-sm leading-6 text-[#969da8]">
              Demo Executor runs without external tools. Real Codex execution requires the provider's own local authorization and a restricted workspace. Credentials are never uploaded to DoneLayer.
            </p>
          </section>

          <section className="border-t border-[#242831] py-10">
            <SectionHeading id="authentication" title="Authentication" copy="Demo sessions use a signed HttpOnly cookie. Production deployments can switch to Supabase Auth and database-enforced RLS." />
            <div className="mt-6 flex items-start gap-3 text-sm leading-6 text-[#b2b8c2]">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-[#78b5ff]" aria-hidden="true" />
              <p>Set <code className="mono text-white">APP_MODE=supabase</code>, configure the publishable Supabase values, and keep <code className="mono text-white">SUPABASE_SECRET_KEY</code> on the server only. Application roles come from trusted app metadata and durable database relationships.</p>
            </div>
          </section>

          <section className="border-t border-[#242831] py-10">
            <SectionHeading id="integrations" title="Integrations" copy="The MVP remains usable when GitHub, Codex, webhook agents, A2A and MCP servers are not configured." />
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="border-l-2 border-[#2f81f7] pl-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white"><Github className="size-4" aria-hidden="true" /> GitHub App</div>
                <p className="mt-2 text-xs leading-5 text-[#969da8]">Use repository-scoped installation permissions and verify every webhook signature. Setup details live in <code className="mono text-[#b2b8c2]">docs/github-app-setup.md</code>.</p>
              </div>
              <div className="border-l-2 border-[#3fb950] pl-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white"><TerminalSquare className="size-4" aria-hidden="true" /> Codex CLI</div>
                <p className="mt-2 text-xs leading-5 text-[#969da8]">Enable the executor feature flag only after Worker Doctor confirms Codex and the sandbox. See <code className="mono text-[#b2b8c2]">docs/codex-executor.md</code>.</p>
              </div>
            </div>
          </section>

          <section className="border-t border-[#242831] py-10">
            <SectionHeading id="security" title="Security boundaries" copy="Customer text never becomes an unrestricted shell command. Jobs use approved workflow templates and explicit capability checks." />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {["Outbound-only Worker protocol", "Hashed and revocable Worker tokens", "Expiring one-time pairing codes", "HMAC signature and replay protection", "Evidence size, type and hash validation", "Server-side roles and task transitions"].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-[#b2b8c2]">
                  <ShieldCheck className="mt-1 size-4 shrink-0 text-[#3fb950]" aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="border-t border-[#242831] py-10">
            <SectionHeading id="verification" title="Verification and checks" copy="Executor output is converted into evidence. A separate verifier evaluates required checks before customer review." />
            <div className="mt-6 flex items-start gap-3 text-sm leading-6 text-[#b2b8c2]">
              <Workflow className="mt-0.5 size-5 shrink-0 text-[#78b5ff]" aria-hidden="true" />
              <p>Command, tests, build, GitHub checks, file presence, diff, pull request, URL health, screenshots and human approval are modeled as explicit checks.</p>
            </div>
            <CodeBlock>{`npm run lint\nnpm run typecheck\nnpm test\nnpm run test:e2e\nnpm run build`}</CodeBlock>
            <div className="mt-6 flex flex-col justify-between gap-4 border-t border-[#242831] pt-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#72d981]"><CheckCircle2 className="size-4" aria-hidden="true" /> Demo Mode needs no external API key</div>
              <ButtonLink href="/sign-in">Run the full demo <ArrowRight className="size-4" aria-hidden="true" /></ButtonLink>
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}
