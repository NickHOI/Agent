import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { DemoLaunchButton } from "@/components/dashboard/demo-launch-button";
import { TaskTable } from "@/components/dashboard/task-table";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const actor = await requirePageActor(["CUSTOMER", "ADMIN"]);
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
