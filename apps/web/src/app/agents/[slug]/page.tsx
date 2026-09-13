import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Code2,
  FileCheck2,
  Fingerprint,
  KeyRound,
  Link2,
  MonitorCog,
  ScrollText,
  Server,
  ShieldCheck,
  Wrench
} from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { WorkspaceAgentDetail } from "@/components/agents/workspace-agent-detail";
import { ButtonLink } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { formatCurrency, humanize } from "@/lib/format";
import { buildAgentTrustProfile } from "@/server/agent-identity/agent-trust-profile";
import { requirePageActor } from "@/server/authorization";
import { getWorkspaceAgent, listWorkspaceWorks } from "@/server/trust-workspace";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (process.env.APP_MODE === "supabase") {
    const actor = await requirePageActor(["CUSTOMER"]);
    const [workspaceAgent, workspaceWork] = await Promise.all([
      getWorkspaceAgent(actor, slug),
      listWorkspaceWorks(actor),
    ]);
    if (!workspaceAgent) notFound();
    return (
      <AppShell currentPath="/agents" title="Agent detail" eyebrow={workspaceAgent.slug}>
        <WorkspaceAgentDetail agent={workspaceAgent} work={workspaceWork} />
      </AppShell>
    );
  }
  const store = getDemoStore();
  const agent = store.getAgentBySlug(slug);
  if (!agent) notFound();
  const trust = buildAgentTrustProfile(store, agent.id);
  const identity = trust?.identity ?? null;
  return (
    <AppShell currentPath="/agents" title="Agent detail" eyebrow={agent.slug} actions={<ButtonLink href={`/tasks/new?agent=${agent.id}`} size="sm">Use this agent</ButtonLink>}>
      <section className="flex flex-col justify-between gap-5 border-b border-[#2a2e36] pb-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-[6px] border border-[#343944] bg-[#111318] text-xl font-bold text-[#8fc2ff]">{agent.name.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-semibold text-white">{agent.name}</h2>{agent.verificationStatus === "VERIFIED" ? <StatusBadge label="Marketplace verified" tone="success" compact /> : <StatusBadge label="Pending review" tone="warning" compact />}</div><p className="mt-1.5 text-sm text-[#969da8]">{agent.providerName} · Version {agent.version}</p><p className="mt-4 max-w-3xl text-sm leading-6 text-[#b2b8c2]">{agent.description}</p></div>
        </div>
        <div className="shrink-0 text-left lg:text-right"><div className="text-xs text-[#666e7a]">{humanize(agent.pricingModel)} price</div><div className="mt-1 text-2xl font-semibold text-white">{formatCurrency(agent.basePriceCents)}</div><div className={`mt-2 flex items-center gap-1.5 text-xs lg:justify-end ${agent.workerStatus === "ONLINE" ? "text-[#72d981]" : "text-[#969da8]"}`}><span className="size-1.5 rounded-full bg-current" /> {humanize(agent.workerStatus)}</div></div>
      </section>

      <section className="mt-5 grid overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318] sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Verified work receipts" value={String(trust?.verifiedWork.length ?? 0)} detail="Valid, non-invalidated receipts" icon={<ShieldCheck className="size-4" />} />
        <Metric label="Active authority" value={String(trust?.activeAuthorities.length ?? 0)} detail="Unexpired task-scoped leases" icon={<KeyRound className="size-4" />} />
        <Metric label="Identity revision" value={identity ? String(identity.revision) : "None"} detail="Append-only profile history" icon={<Fingerprint className="size-4" />} />
        <Metric label="External links" value={String(identity?.externalIdentities.length ?? 0)} detail="Declared, observed, or verified" icon={<Link2 className="size-4" />} />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Panel><PanelHeader title="Capabilities" description="Declared Marketplace metadata" /><div className="grid gap-px bg-[#242831] md:grid-cols-2"><div className="bg-[#111318] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><Code2 className="size-4 text-[#78b5ff]" /> Skills</div><div className="mt-3 flex flex-wrap gap-2">{agent.skills.map((value) => <span key={value} className="rounded-[4px] border border-[#343944] bg-[#171a20] px-2 py-1 text-xs text-[#b2b8c2]">{value}</span>)}</div></div><div className="bg-[#111318] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><Wrench className="size-4 text-[#78b5ff]" /> Tools</div><div className="mt-3 flex flex-wrap gap-2">{agent.tools.map((value) => <span key={value} className="rounded-[4px] border border-[#343944] bg-[#171a20] px-2 py-1 text-xs text-[#b2b8c2]">{value}</span>)}</div></div><div className="bg-[#111318] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><MonitorCog className="size-4 text-[#78b5ff]" /> Operating systems</div><p className="mt-3 text-sm text-[#969da8]">{agent.operatingSystems.map(humanize).join(", ")}</p></div><div className="bg-[#111318] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><FileCheck2 className="size-4 text-[#78b5ff]" /> Task types</div><p className="mt-3 text-sm leading-6 text-[#969da8]">{agent.taskTypes.map(humanize).join(", ")}</p></div></div></Panel>
          <Panel>
            <PanelHeader title="Verified work receipts" description="Hash-valid, non-invalidated delivery evidence" />
            {trust?.verifiedWork.length ? (
              <div className="divide-y divide-[#242831]">
                {trust.verifiedWork.map((work) => (
                  <div key={work.receiptPublicId} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/receipts/${work.receiptPublicId}`} className="focus-ring block truncate rounded-[3px] text-xs font-semibold text-white hover:text-[#8fc2ff]">{work.taskTitle}</Link>
                      <div className="mt-1 text-[11px] text-[#666e7a]">{work.receiptType} · {humanize(work.result)}</div>
                    </div>
                    <ScrollText className="size-4 shrink-0 text-[#3fb950]" />
                  </div>
                ))}
                <div className="px-4 py-3 text-[11px] leading-5 text-[#666e7a]">Receipt validity does not imply Reputation qualification; classification is evaluated separately.</div>
              </div>
            ) : (
              <div className="p-4 text-xs leading-5 text-[#969da8]">No valid delivery Receipt is currently bound to this Agent. Marketplace counters and Demo history are not treated as proof.</div>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Platform identity" description="Append-only DoneLayer profile binding" />
            {identity ? (
              <div className="divide-y divide-[#242831] px-4">
                <div className="flex items-start justify-between gap-4 py-3 text-xs">
                  <span className="flex items-center gap-2 text-[#969da8]"><Fingerprint className="size-4" /> Agent ID</span>
                  <code className="max-w-[68%] break-all text-right text-[11px] text-white">{identity.agentId}</code>
                </div>
                <div className="flex items-start justify-between gap-4 py-3 text-xs">
                  <span className="text-[#969da8]">Profile revision</span>
                  <span className="text-right font-semibold text-white">{identity.revision}</span>
                </div>
                <div className="flex items-start justify-between gap-4 py-3 text-xs">
                  <span className="text-[#969da8]">Profile hash</span>
                  <code className="max-w-[68%] break-all text-right text-[11px] text-white">{identity.profileSha256}</code>
                </div>
                <div className="flex items-start justify-between gap-4 py-3 text-xs">
                  <span className="text-[#969da8]">Controller assurance</span>
                  <span className="max-w-[68%] text-right text-white">Platform account relationship; legal identity not verified</span>
                </div>
                <div className="flex items-start justify-between gap-4 py-3 text-xs">
                  <span className="text-[#969da8]">External identities</span>
                  <span className="text-right text-white">{identity.externalIdentities.length ? `${identity.externalIdentities.length} declared or observed` : "None linked"}</span>
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-[#ff8e88]">No durable platform identity is bound to this Agent.</div>
            )}
          </Panel>
          <Panel><PanelHeader title="Endpoint" description={humanize(agent.endpointType)} /><div className="divide-y divide-[#242831] px-4"><div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">Worker status</span><span className="flex items-center gap-1.5 font-semibold text-[#72d981]"><Server className="size-3.5" /> {humanize(agent.workerStatus)}</span></div><div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">MCP required</span><span className="font-semibold text-white">{agent.requiredMcpServers.length ? agent.requiredMcpServers.join(", ") : "None"}</span></div><div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">Availability</span><span className="font-semibold text-white">{agent.acceptingTasks ? "Accepting tasks" : "Paused"}</span></div></div></Panel>
          <Panel>
            <PanelHeader title="Active authority" description="Current task-scoped Permission Leases" />
            {trust?.activeAuthorities.length ? (
              <div className="divide-y divide-[#242831]">
                {trust.activeAuthorities.map((authority) => (
                  <div key={authority.leaseId} className="p-4">
                    <div className="text-xs font-semibold text-white">{authority.taskTitle}</div>
                    <div className="mt-1 font-mono text-[10px] text-[#666e7a]">{authority.leaseId}</div>
                    <div className="mt-3 text-[11px] leading-5 text-[#969da8]">{authority.allowedActions.join(", ") || "No allowed actions"}</div>
                  </div>
                ))}
              </div>
            ) : <div className="p-4 text-xs text-[#969da8]">No unexpired task-scoped Authority is active.</div>}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
