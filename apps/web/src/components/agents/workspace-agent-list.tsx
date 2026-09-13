import Link from "next/link";
import { ArrowUpRight, Bot, Fingerprint, Plus, ShieldCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status";
import { humanize } from "@/lib/format";
import type { WorkspaceAgent } from "@/server/trust-workspace";

export function WorkspaceAgentList({ agents }: { agents: WorkspaceAgent[] }) {
  if (!agents.length) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-[#343944] px-5 text-center">
        <Bot className="size-7 text-[#666e7a]" />
        <h2 className="mt-4 text-base font-semibold text-white">No Agents in this workspace</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-[#969da8]">Create a private Agent identity before defining Work. New Agents remain pending and cannot execute until a later gate connects a runtime.</p>
        <ButtonLink href="/agents/new" className="mt-5"><Plus className="size-4" /> Create Agent</ButtonLink>
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => (
        <article key={agent.id} className="flex min-h-64 flex-col rounded-[6px] border border-[#2a2e36] bg-[#111318]">
          <div className="flex items-start gap-3 border-b border-[#242831] p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[5px] border border-[#343944] bg-[#0d0f13] text-sm font-bold text-[#8fc2ff]">{initials(agent.name)}</span>
            <div className="min-w-0 flex-1">
              <Link href={`/agents/${agent.slug}`} className="focus-ring block truncate rounded-[3px] text-sm font-semibold text-white hover:text-[#8fc2ff]">{agent.name}</Link>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#666e7a]"><Fingerprint className="size-3" /> Identity revision {agent.identity.revision}</div>
            </div>
            <StatusBadge label={humanize(agent.verificationStatus)} tone={agent.verificationStatus === "VERIFIED" ? "success" : "warning"} compact />
          </div>
          <div className="flex-1 p-4">
            <p className="line-clamp-3 text-sm leading-6 text-[#969da8]">{agent.description}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">{agent.skills.slice(0, 5).map((skill) => <span key={skill} className="rounded-[4px] border border-[#343944] px-2 py-1 text-[11px] text-[#b2b8c2]">{skill}</span>)}</div>
          </div>
          <div className="flex items-center justify-between border-t border-[#242831] px-4 py-3">
            <span className="flex items-center gap-1.5 text-xs text-[#969da8]"><ShieldCheck className="size-3.5" /> {humanize(agent.identity.status)}</span>
            <Link href={`/agents/${agent.slug}`} aria-label={`Open ${agent.name}`} className="focus-ring flex size-8 items-center justify-center rounded-[5px] text-[#8fc2ff] hover:bg-[#1b2b43]"><ArrowUpRight className="size-4" /></Link>
          </div>
        </article>
      ))}
    </div>
  );
}

function initials(value: string): string {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
