import { notFound } from "next/navigation";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { TaskDetailClient } from "@/components/task-detail/task-detail-client";
import { getActor } from "@/server/auth";
import { canViewTask } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ autorun?: string }>;
}) {
  const actor = await getActor();
  if (!actor) notFound();
  const { taskId } = await params;
  let aggregate;
  try {
    aggregate = getDemoStore().getTaskAggregate(taskId);
  } catch {
    notFound();
  }
  if (!canViewTask(actor, aggregate)) notFound();
  const query = await searchParams;
  return (
    <AppShell currentPath={`/tasks/${taskId}`} title="Task detail" eyebrow={taskId.slice(0, 22)}>
      <TaskDetailClient initial={aggregate} autoRun={query.autorun === "1"} canOperate={actor.role === "CUSTOMER" || actor.role === "ADMIN"} />
    </AppShell>
  );
}
