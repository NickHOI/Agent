import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Server,
  ShieldCheck
} from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { TaskOfferActions } from "@/components/provider/task-offer-actions";
import { Metric } from "@/components/ui/metric";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { formatCurrency, humanize, taskStatusTone } from "@/lib/format";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function ProviderDashboard() {
  const actor = await requirePageActor(["PROVIDER", "ADMIN"]);
  const store = getDemoStore();
  const providerId = actor.role === "PROVIDER" ? actor.id : "provider-alpha";
  const tasks = store.listProviderTasks(providerId);
  const assignments = store.listAssignments(providerId);
  const workers = store.listWorkers(providerId);
  const agents = store.listAgents().filter((agent) => agent.providerId === providerId);
  const available = tasks.filter((task) => task.status === "AWAITING_PROVIDER");
  const running = tasks.filter((task) => task.status === "RUNNING" || task.status === "SUBMITTED");
  const completed = assignments.filter((assignment) => assignment.status === "COMPLETED").length;
  const verifiedRate = agents.length ? Math.round((agents.reduce((sum, agent) => sum + agent.verifiedSuccessRate, 0) / agents.length) * 100) : 0;
  const wallet = store.getWallet(providerId, "PROVIDER");
  const pending = tasks.filter((task) => task.status === "CUSTOMER_REVIEW").reduce((sum, task) => sum + Math.round(task.budgetCents * 0.8), 0);
  return (
    <AppShell currentPath="/provider" title="Provider operations" eyebrow={actor.name}>
      <section className="grid overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318] sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Online workers" value={String(workers.filter((worker) => worker.status === "ONLINE" || worker.status === "BUSY").length)} detail={`${workers.length} registered`} icon={<Server className="size-4" />} />
        <Metric label="Available tasks" value={String(available.length)} detail="Awaiting decision" icon={<Clock3 className="size-4" />} />
        <Metric label="Running jobs" value={String(running.length)} detail="Across all workers" icon={<Activity className="size-4" />} />
        <Metric label="Completion rate" value={`${assignments.length ? Math.round((completed / assignments.length) * 100) : 0}%`} detail={`${completed} released`} icon={<CheckCircle2 className="size-4" />} />
        <Metric label="Verified success" value={`${verifiedRate}%`} detail="Agent average" icon={<ShieldCheck className="size-4" />} />
        <Metric label="Simulated earnings" value={formatCurrency(wallet.availableCents)} detail={`${formatCurrency(pending)} pending`} icon={<CircleDollarSign className="size-4" />} />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_360px]">
        <Panel>
          <PanelHeader title="Available task offers" description="Repository details are revealed only to the matched provider" />
          {available.length ? <div className="divide-y divide-[#242831]">{available.map((task) => {
            const agent = task.matchedAgentId ? store.getAgentById(task.matchedAgentId) : null;
            return <div key={task.id} className="p-4"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link href={`/tasks/${task.id}`} className="focus-ring truncate rounded-[3px] text-sm font-semibold text-white hover:text-[#8fc2ff]">{task.title}</Link><StatusBadge label={humanize(task.securitySensitivity)} tone={task.securitySensitivity === "HIGH" ? "danger" : "warning"} compact /></div><p className="mt-2 max-w-2xl text-xs leading-5 text-[#969da8]">{task.problemDescription}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[#666e7a]"><span>Agent: <strong className="text-[#b2b8c2]">{agent?.name ?? "Matched agent"}</strong></span><span>Tools: <strong className="text-[#b2b8c2]">{task.requiredTools.join(", ")}</strong></span><span>Permissions: <strong className="text-[#b2b8c2]">{task.allowCodeChanges ? "Code changes" : "Read only"}{task.allowPullRequest ? ", PR" : ""}</strong></span></div></div><div className="shrink-0 lg:text-right"><div className="text-[10px] uppercase text-[#666e7a]">Expected income</div><div className="mt-1 text-lg font-semibold text-[#72d981]">{formatCurrency(Math.round(task.budgetCents * 0.8))}</div><div className="mt-3"><TaskOfferActions taskId={task.id} /></div></div></div></div>;
          })}</div> : <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center"><CheckCircle2 className="size-6 text-[#3fb950]" /><h3 className="mt-3 text-sm font-semibold text-white">Offer queue is clear</h3><p className="mt-1 text-xs text-[#969da8]">New privacy-scoped offers will appear here.</p></div>}
        </Panel>

        <Panel>
          <PanelHeader title="Worker fleet" description="Heartbeat-derived status" action={<Link href="/provider/workers" className="focus-ring flex items-center gap-1 text-xs font-semibold text-[#8fc2ff]">Manage <ArrowUpRight className="size-3.5" /></Link>} />
          <div className="divide-y divide-[#242831]">{workers.map((worker) => <div key={worker.id} className="flex items-center gap-3 px-4 py-3"><span className={`flex size-8 items-center justify-center rounded-[5px] border border-[#343944] bg-[#0d0f13] ${worker.status === "ONLINE" || worker.status === "BUSY" ? "text-[#72d981]" : "text-[#666e7a]"}`}><Server className="size-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-white">{worker.name}</div><div className="mt-1 text-[11px] text-[#666e7a]">{humanize(worker.os)} · {worker.executors.join(", ")}</div></div><StatusBadge label={humanize(worker.status)} tone={worker.status === "ONLINE" ? "success" : worker.status === "BUSY" ? "info" : "neutral"} compact /></div>)}</div>
        </Panel>
      </div>

      <Panel className="mt-5 overflow-hidden"><PanelHeader title="Recent provider tasks" description="Assigned or completed by your agents" /><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead><tr className="border-b border-[#2a2e36] text-[11px] uppercase text-[#666e7a]"><th className="px-4 py-3">Task</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Budget</th><th className="px-4 py-3">Provider share</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-[#242831]">{tasks.map((task) => <tr key={task.id} className="hover:bg-[#15181e]"><td className="px-4 py-3 text-xs font-semibold text-white">{task.title}</td><td className="px-4 py-3"><StatusBadge label={humanize(task.status)} tone={taskStatusTone(task.status)} compact /></td><td className="px-4 py-3 text-xs text-[#b2b8c2]">{formatCurrency(task.budgetCents)}</td><td className="px-4 py-3 text-xs text-[#72d981]">{formatCurrency(Math.round(task.budgetCents * 0.8))}</td><td className="px-4 py-3"><Link href={`/tasks/${task.id}`} className="focus-ring inline-flex items-center gap-1 rounded-[3px] text-xs font-semibold text-[#8fc2ff]">Open <ArrowUpRight className="size-3" /></Link></td></tr>)}</tbody></table></div></Panel>
    </AppShell>
  );
}
