import { notFound } from "next/navigation";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { TaskDetailClient } from "@/components/task-detail/task-detail-client";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function ProviderJobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const actor = await requirePageActor(["PROVIDER", "ADMIN"]);
  const { jobId } = await params;
  const store = getDemoStore();
  const job = store.getJobRun(jobId);
  if (!job) notFound();
  const aggregate = store.getTaskAggregate(job.taskId);
  if (actor.role === "PROVIDER" && aggregate.assignment?.providerId !== actor.id) notFound();
  return <AppShell currentPath="/provider/jobs" title="Provider job detail" eyebrow={job.id}><TaskDetailClient initial={aggregate} autoRun={false} canOperate={false} /></AppShell>;
}
