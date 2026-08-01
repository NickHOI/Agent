import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { CreateTaskWizard } from "@/components/tasks/create-task-wizard";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function CreateTaskPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  await requirePageActor(["CUSTOMER"]);
  const query = await searchParams;
  const agents = getDemoStore().listAgents();
  return (
    <AppShell currentPath="/tasks/new" title="Create task" eyebrow="Customer workspace">
      <div className="mb-5"><h2 className="text-xl font-semibold text-white">Define a verifiable outcome</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#969da8]">Scope the repository work, select approved capabilities and decide what evidence will count as done.</p></div>
      <CreateTaskWizard agents={agents} preferredAgentId={query.agent} />
    </AppShell>
  );
}
