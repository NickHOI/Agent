import Link from "next/link";
import { Bot, CircleDollarSign, FileWarning, Server, ShieldCheck, UsersRound } from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AdminActionButton } from "@/components/admin/admin-action-button";
import { AppShell } from "@/components/app-shell";
import { Metric } from "@/components/ui/metric";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { formatCurrency, formatRelativeTime, humanize, taskStatusTone } from "@/lib/format";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requirePageActor(["ADMIN"]);
  const store = getDemoStore();
  const snapshot = store.getDashboardSnapshot();
  const profiles = store.listProfiles();
  const disputes = store.listDisputes();
  const audit = store.listAuditLogs(10);
  const gmv = snapshot.tasks.reduce((sum, task) => sum + task.budgetCents, 0);
  const completed = snapshot.tasks.filter((task) => task.status === "COMPLETED").length;
  const success = snapshot.tasks.length ? Math.round((snapshot.tasks.filter((task) => ["VERIFICATION_PASSED", "CUSTOMER_REVIEW", "COMPLETED"].includes(task.status)).length / snapshot.tasks.length) * 100) : 0;
  return (
    <AppShell currentPath="/admin" title="Platform operations" eyebrow="Admin console">
      <section className="grid overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318] sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Users" value={String(profiles.length)} detail="All roles" icon={<UsersRound className="size-4" />} />
        <Metric label="Agents" value={String(snapshot.agents.length)} detail={`${snapshot.agents.filter((agent) => agent.verificationStatus === "VERIFIED").length} verified`} icon={<Bot className="size-4" />} />
        <Metric label="Workers" value={String(snapshot.workers.length)} detail={`${snapshot.workers.filter((worker) => worker.status === "ONLINE" || worker.status === "BUSY").length} online`} icon={<Server className="size-4" />} />
        <Metric label="Test GMV" value={formatCurrency(gmv)} detail="Simulated volume" icon={<CircleDollarSign className="size-4" />} />
        <Metric label="Success rate" value={`${success}%`} detail={`${completed} completed`} icon={<ShieldCheck className="size-4" />} />
        <Metric label="Open disputes" value={String(disputes.filter((dispute) => dispute.status === "OPEN").length)} detail="Requires review" icon={<FileWarning className="size-4" />} />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_360px]">
        <Panel className="overflow-hidden"><PanelHeader title="All tasks" description="State changes remain server validated" /><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead><tr className="border-b border-[#2a2e36] text-[11px] uppercase text-[#666e7a]"><th className="px-4 py-3">Task</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Budget</th><th className="px-4 py-3">Control</th></tr></thead><tbody className="divide-y divide-[#242831]">{snapshot.tasks.map((task) => <tr key={task.id} className="hover:bg-[#15181e]"><td className="px-4 py-3"><Link href={`/tasks/${task.id}`} className="focus-ring text-xs font-semibold text-white hover:text-[#8fc2ff]">{task.title}</Link><div className="mono mt-1 text-[10px] text-[#555d68]">{task.id}</div></td><td className="px-4 py-3 text-xs text-[#969da8]">Nick Demo</td><td className="px-4 py-3"><StatusBadge label={humanize(task.status)} tone={taskStatusTone(task.status)} compact /></td><td className="px-4 py-3 text-xs text-white">{formatCurrency(task.budgetCents)}</td><td className="px-4 py-3">{["MATCHED", "AWAITING_PROVIDER", "ASSIGNED"].includes(task.status) ? <AdminActionButton action="REMATCH_TASK" resourceId={task.id} /> : <span className="text-[10px] text-[#555d68]">No action</span>}</td></tr>)}</tbody></table></div></Panel>

        <Panel><PanelHeader title="Security events" description="Redacted append-only audit trail" /><div className="divide-y divide-[#242831]">{audit.map((event) => <div key={event.id} className="px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{humanize(event.action)}</div><div className="mt-1 truncate text-[11px] text-[#666e7a]">{event.actorKind} · {event.resourceType}/{event.resourceId.slice(0, 12)}</div></div><time className="shrink-0 text-[10px] text-[#555d68]">{formatRelativeTime(event.createdAt)}</time></div></div>)}</div></Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel className="overflow-hidden"><PanelHeader title="Agent controls" description="Suspend marketplace availability" /><div className="divide-y divide-[#242831]">{snapshot.agents.map((agent) => <div key={agent.id} className="flex items-center justify-between gap-4 px-4 py-3"><div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{agent.name}</div><div className="mt-1 text-[11px] text-[#666e7a]">{agent.providerName} · {humanize(agent.verificationStatus)}</div></div><AdminActionButton action="SUSPEND_AGENT" resourceId={agent.id} /></div>)}</div></Panel>
        <Panel className="overflow-hidden"><PanelHeader title="Worker controls" description="Suspension revokes job availability" /><div className="divide-y divide-[#242831]">{snapshot.workers.map((worker) => <div key={worker.id} className="flex items-center justify-between gap-4 px-4 py-3"><div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{worker.name}</div><div className="mt-1 text-[11px] text-[#666e7a]">{worker.providerId} · {humanize(worker.status)}</div></div><AdminActionButton action="SUSPEND_WORKER" resourceId={worker.id} /></div>)}</div></Panel>
      </div>
    </AppShell>
  );
}
