import Link from "next/link";
import { ArrowUpRight, FileCheck2 } from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { formatRelativeTime, humanize } from "@/lib/format";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function ProviderJobsPage() {
  const actor = await requirePageActor(["PROVIDER", "ADMIN"]);
  const providerId = actor.role === "PROVIDER" ? actor.id : undefined;
  const store = getDemoStore();
  const jobs = store.listJobRuns(providerId);
  return <AppShell currentPath="/provider/jobs" title="Jobs" eyebrow="Provider operations"><Panel className="overflow-hidden"><PanelHeader title="Job runs" description={`${jobs.length} execution attempt${jobs.length === 1 ? "" : "s"}`} />{jobs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-[#2a2e36] text-[11px] uppercase text-[#666e7a]"><th className="px-4 py-3">Job</th><th className="px-4 py-3">Task</th><th className="px-4 py-3">Executor</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Open</th></tr></thead><tbody className="divide-y divide-[#242831]">{jobs.map((job) => { const task = store.getTask(job.taskId); return <tr key={job.id} className="hover:bg-[#15181e]"><td className="mono px-4 py-3 text-[10px] text-[#666e7a]">{job.id}</td><td className="px-4 py-3 text-xs font-semibold text-white">{task?.title ?? job.taskId}</td><td className="px-4 py-3 text-xs text-[#b2b8c2]">{humanize(job.executor)}</td><td className="px-4 py-3"><StatusBadge label={humanize(job.status)} tone={job.status === "SUCCEEDED" ? "success" : job.status === "FAILED" ? "danger" : job.status === "RUNNING" ? "info" : "warning"} compact /></td><td className="px-4 py-3 text-xs text-[#969da8]">{formatRelativeTime(job.createdAt)}</td><td className="px-4 py-3"><Link href={`/provider/jobs/${job.id}`} className="focus-ring inline-flex items-center gap-1 rounded-[3px] text-xs font-semibold text-[#8fc2ff]">Open <ArrowUpRight className="size-3" /></Link></td></tr>; })}</tbody></table></div> : <EmptyState icon={<FileCheck2 className="size-5" />} title="No job runs" description="A Job Run is created only after a Provider accepts a matched task." />}</Panel></AppShell>;
}
