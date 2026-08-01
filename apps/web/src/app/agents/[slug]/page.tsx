import { notFound } from "next/navigation";
import {
  CheckCircle2,
  Clock3,
  Code2,
  FileCheck2,
  MonitorCog,
  Server,
  ShieldCheck,
  Star,
  Wrench
} from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { formatCurrency, formatDuration, humanize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = getDemoStore().getAgentBySlug(slug);
  if (!agent) notFound();
  return (
    <AppShell currentPath="/agents" title="Agent detail" eyebrow={agent.slug} actions={<ButtonLink href={`/tasks/new?agent=${agent.id}`} size="sm">Use this agent</ButtonLink>}>
      <section className="flex flex-col justify-between gap-5 border-b border-[#2a2e36] pb-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-[6px] border border-[#343944] bg-[#111318] text-xl font-bold text-[#8fc2ff]">{agent.name.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-semibold text-white">{agent.name}</h2>{agent.verificationStatus === "VERIFIED" ? <StatusBadge label="Verified" tone="success" compact /> : <StatusBadge label="Pending review" tone="warning" compact />}</div><p className="mt-1.5 text-sm text-[#969da8]">{agent.providerName} · Version {agent.version}</p><p className="mt-4 max-w-3xl text-sm leading-6 text-[#b2b8c2]">{agent.description}</p></div>
        </div>
        <div className="shrink-0 text-left lg:text-right"><div className="text-xs text-[#666e7a]">{humanize(agent.pricingModel)} price</div><div className="mt-1 text-2xl font-semibold text-white">{formatCurrency(agent.basePriceCents)}</div><div className={`mt-2 flex items-center gap-1.5 text-xs lg:justify-end ${agent.workerStatus === "ONLINE" ? "text-[#72d981]" : "text-[#969da8]"}`}><span className="size-1.5 rounded-full bg-current" /> {humanize(agent.workerStatus)}</div></div>
      </section>

      <section className="mt-5 grid overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318] sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Verified success" value={`${Math.round(agent.verifiedSuccessRate * 100)}%`} detail={`${agent.completedTasks} completed tasks`} icon={<ShieldCheck className="size-4" />} />
        <Metric label="Customer rating" value={agent.rating.toFixed(1)} detail="Verified customers" icon={<Star className="size-4" />} />
        <Metric label="Average completion" value={formatDuration(agent.averageCompletionMinutes)} detail="Same task category" icon={<Clock3 className="size-4" />} />
        <Metric label="Recent failures" value={String(agent.recentFailures)} detail="Last 30 runs" icon={<FileCheck2 className="size-4" />} />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Panel><PanelHeader title="Capabilities" description="Declared and provider-verified metadata" /><div className="grid gap-px bg-[#242831] md:grid-cols-2"><div className="bg-[#111318] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><Code2 className="size-4 text-[#78b5ff]" /> Skills</div><div className="mt-3 flex flex-wrap gap-2">{agent.skills.map((value) => <span key={value} className="rounded-[4px] border border-[#343944] bg-[#171a20] px-2 py-1 text-xs text-[#b2b8c2]">{value}</span>)}</div></div><div className="bg-[#111318] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><Wrench className="size-4 text-[#78b5ff]" /> Tools</div><div className="mt-3 flex flex-wrap gap-2">{agent.tools.map((value) => <span key={value} className="rounded-[4px] border border-[#343944] bg-[#171a20] px-2 py-1 text-xs text-[#b2b8c2]">{value}</span>)}</div></div><div className="bg-[#111318] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><MonitorCog className="size-4 text-[#78b5ff]" /> Operating systems</div><p className="mt-3 text-sm text-[#969da8]">{agent.operatingSystems.map(humanize).join(", ")}</p></div><div className="bg-[#111318] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><FileCheck2 className="size-4 text-[#78b5ff]" /> Task types</div><p className="mt-3 text-sm leading-6 text-[#969da8]">{agent.taskTypes.map(humanize).join(", ")}</p></div></div></Panel>
          <Panel><PanelHeader title="Recent verified completions" description="Demo performance history" /><div className="divide-y divide-[#242831]">{["Resolve refresh-token race condition", "Repair Vite production build", "Verify password reset pull request"].map((title, index) => <div key={title} className="flex items-center justify-between gap-4 px-4 py-3"><div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{title}</div><div className="mt-1 text-[11px] text-[#666e7a]">{index + 2} days ago · {12 + index * 4} checks</div></div><CheckCircle2 className="size-4 shrink-0 text-[#3fb950]" /></div>)}</div></Panel>
        </div>
        <div className="space-y-5">
          <Panel><PanelHeader title="Endpoint" description={humanize(agent.endpointType)} /><div className="divide-y divide-[#242831] px-4"><div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">Worker status</span><span className="flex items-center gap-1.5 font-semibold text-[#72d981]"><Server className="size-3.5" /> {humanize(agent.workerStatus)}</span></div><div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">MCP required</span><span className="font-semibold text-white">{agent.requiredMcpServers.length ? agent.requiredMcpServers.join(", ") : "None"}</span></div><div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">Availability</span><span className="font-semibold text-white">{agent.acceptingTasks ? "Accepting tasks" : "Paused"}</span></div></div></Panel>
          <Panel><PanelHeader title="Proof history" description="Independent verification outcomes" /><div className="p-4"><div className="flex items-center gap-3"><ShieldCheck className="size-8 text-[#3fb950]" /><div><div className="text-lg font-semibold text-white">{Math.round(agent.verifiedSuccessRate * agent.completedTasks)}</div><div className="text-xs text-[#969da8]">Evidence packs passed</div></div></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#242831]"><div className="h-full bg-[#3fb950]" style={{ width: `${agent.verifiedSuccessRate * 100}%` }} /></div></div></Panel>
        </div>
      </div>
    </AppShell>
  );
}
