import { notFound } from "next/navigation";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { TaskDetailClient } from "@/components/task-detail/task-detail-client";
import { WorkspaceWorkDetail } from "@/components/tasks/workspace-work-detail";
import { getActor } from "@/server/auth";
import { canViewTask } from "@/server/authorization";
import { toTaskViewAggregate } from "@/server/task-view";
import { getWorkspaceWork } from "@/server/trust-workspace";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ autorun?: string; tab?: string }>;
}) {
  const actor = await getActor();
  if (!actor) notFound();
  const { taskId } = await params;
  const query = await searchParams;
  if (process.env.APP_MODE === "supabase") {
    const work = await getWorkspaceWork(actor, taskId);
    if (!work) notFound();
    return (
      <AppShell currentPath={`/tasks/${taskId}`} title="Work detail" eyebrow={taskId.slice(0, 18)}>
        <WorkspaceWorkDetail work={work} initialTab={query.tab} />
      </AppShell>
    );
  }
  let aggregate;
  try {
    aggregate = getDemoStore().getTaskAggregate(taskId);
  } catch {
    notFound();
  }
  if (!canViewTask(actor, aggregate)) notFound();
  return (
    <AppShell currentPath={`/tasks/${taskId}`} title="Task detail" eyebrow={taskId.slice(0, 22)}>
      <TaskDetailClient initial={toTaskViewAggregate(aggregate)} autoRun={query.autorun === "1"} canOperate={actor.role === "CUSTOMER" || actor.role === "ADMIN"} />
    </AppShell>
  );
}
