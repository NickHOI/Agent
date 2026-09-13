import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { DemoLaunchButton } from "@/components/dashboard/demo-launch-button";
import { TaskTable } from "@/components/dashboard/task-table";
import { WorkspaceWorkTable } from "@/components/tasks/workspace-work-table";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { requirePageActor } from "@/server/authorization";
import { listWorkspaceWorks } from "@/server/trust-workspace";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const actor = await requirePageActor(["CUSTOMER", "ADMIN"]);
  if (process.env.APP_MODE === "supabase") {
    const work = await listWorkspaceWorks(actor);
    return (
      <AppShell currentPath="/tasks" title="Work" eyebrow="Trust workspace" actions={<ButtonLink href="/tasks/new" size="sm">Create Work</ButtonLink>}>
        <Panel className="overflow-hidden"><PanelHeader title="Work history" description={`${work.length} durable request${work.length === 1 ? "" : "s"}`} /><WorkspaceWorkTable work={work} /></Panel>
      </AppShell>
    );
  }
  const tasks = getDemoStore().listTasks(actor.role === "CUSTOMER" ? actor.id : undefined);
  return (
    <AppShell currentPath="/tasks" title="Tasks" eyebrow="Customer workspace" actions={<DemoLaunchButton />}>
      <Panel className="overflow-hidden">
        <PanelHeader title="All tasks" description={`${tasks.length} persisted task${tasks.length === 1 ? "" : "s"}`} />
        <TaskTable tasks={tasks} />
      </Panel>
    </AppShell>
  );
}
