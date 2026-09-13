import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { formatCurrency, humanize } from "@/lib/format";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function ProviderAgentsPage() {
  const actor = await requirePageActor(["PROVIDER", "ADMIN"]);
  const providerId = actor.role === "PROVIDER" ? actor.id : "provider-alpha";
  const store = getDemoStore();
  const agents = store.listAgents().filter((agent) => agent.providerId === providerId);
  const identities = new Map(store.listAgentIdentityProfiles(providerId).map((profile) => [profile.agentId, profile]));
  return (
    <AppShell
      currentPath="/provider/agents"
      title="Agents"
      eyebrow="Provider operations"
      actions={<ButtonLink href="/provider/agents/new" size="sm">Create Agent</ButtonLink>}
    >
      <Panel className="overflow-hidden">
        <PanelHeader title="Registered agents" description={`${agents.length} agent profiles`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead>
              <tr className="border-b border-[#2a2e36] text-[11px] uppercase text-[#666e7a]">
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Identity</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3">Marketplace review</th>
                <th className="px-4 py-3">Availability</th>
                <th className="px-4 py-3">Success</th>
                <th className="px-4 py-3">Base price</th>
                <th className="px-4 py-3">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#242831]">
              {agents.map((agent) => {
                const identity = identities.get(agent.id);
                return (
                  <tr key={agent.id} className="hover:bg-[#15181e]">
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold text-white">{agent.name}</div>
                      <div className="mt-1 text-[11px] text-[#666e7a]">v{agent.version} · {agent.skills.slice(0, 3).join(", ")}</div>
                    </td>
                    <td className="px-4 py-3">
                      {identity ? (
                        <div>
                          <StatusBadge label={humanize(identity.status)} tone={identity.status === "ACTIVE" ? "success" : "warning"} compact />
                          <div className="mt-1 font-mono text-[10px] text-[#666e7a]" title={identity.profileSha256}>
                            rev {identity.revision} · {identity.profileSha256.slice(0, 10)}
                          </div>
                        </div>
                      ) : <StatusBadge label="Missing" tone="danger" compact />}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#b2b8c2]">{humanize(agent.endpointType)}</td>
                    <td className="px-4 py-3"><StatusBadge label={humanize(agent.verificationStatus)} tone={agent.verificationStatus === "VERIFIED" ? "success" : "warning"} compact /></td>
                    <td className="px-4 py-3"><StatusBadge label={agent.acceptingTasks ? "Accepting" : "Paused"} tone={agent.acceptingTasks ? "info" : "neutral"} compact /></td>
                    <td className="px-4 py-3 text-xs font-semibold text-[#72d981]">{Math.round(agent.verifiedSuccessRate * 100)}%</td>
                    <td className="px-4 py-3 text-xs text-white">{formatCurrency(agent.basePriceCents)}</td>
                    <td className="px-4 py-3"><Link href={`/agents/${agent.slug}`} className="focus-ring inline-flex items-center gap-1 rounded-[3px] text-xs font-semibold text-[#8fc2ff]">View <ArrowUpRight className="size-3" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
