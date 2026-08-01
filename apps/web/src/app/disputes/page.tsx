import Link from "next/link";
import { ArrowUpRight, FileWarning } from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { formatCurrency, formatRelativeTime, humanize } from "@/lib/format";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function DisputesPage() {
  await requirePageActor(["CUSTOMER", "PROVIDER", "ADMIN"]);
  const store = getDemoStore();
  const disputes = store.listDisputes();
  return <AppShell currentPath="/disputes" title="Disputes" eyebrow="Resolution queue"><Panel className="overflow-hidden"><PanelHeader title="Dispute cases" description={`${disputes.length} recorded case${disputes.length === 1 ? "" : "s"}`} />{disputes.length ? <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left"><thead><tr className="border-b border-[#2a2e36] text-[11px] uppercase text-[#666e7a]"><th className="px-4 py-3">Case</th><th className="px-4 py-3">Task</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Held amount</th><th className="px-4 py-3">Opened</th><th className="px-4 py-3">Open</th></tr></thead><tbody className="divide-y divide-[#242831]">{disputes.map((dispute) => { const task = store.getTask(dispute.taskId); return <tr key={dispute.id} className="hover:bg-[#15181e]"><td className="px-4 py-3"><div className="mono text-[10px] text-[#666e7a]">{dispute.id}</div><div className="mt-1 max-w-xs truncate text-xs text-[#b2b8c2]">{dispute.reason}</div></td><td className="px-4 py-3 text-xs font-semibold text-white">{task?.title ?? dispute.taskId}</td><td className="px-4 py-3"><StatusBadge label={humanize(dispute.status)} tone={dispute.status === "OPEN" ? "danger" : "warning"} compact /></td><td className="px-4 py-3 text-xs text-white">{formatCurrency(dispute.heldAmountCents)}</td><td className="px-4 py-3 text-xs text-[#969da8]">{formatRelativeTime(dispute.createdAt)}</td><td className="px-4 py-3"><Link href={`/tasks/${dispute.taskId}`} className="focus-ring inline-flex items-center gap-1 rounded-[3px] text-xs font-semibold text-[#8fc2ff]">View <ArrowUpRight className="size-3" /></Link></td></tr>; })}</tbody></table></div> : <EmptyState icon={<FileWarning className="size-5" />} title="No disputes" description="A disputed task moves its reserved amount into a test hold and appears here for Admin review." />}</Panel></AppShell>;
}
