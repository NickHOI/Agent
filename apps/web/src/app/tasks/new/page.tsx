import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { CreateTaskWizard } from "@/components/tasks/create-task-wizard";
import { WorkspaceCreateWorkForm } from "@/components/tasks/workspace-create-work-form";
import { requirePageActor } from "@/server/authorization";
import { listWorkspaceAgents } from "@/server/trust-workspace";

export const dynamic = "force-dynamic";

export default async function CreateTaskPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const actor = await requirePageActor(["CUSTOMER"]);
  const query = await searchParams;
  if (process.env.APP_MODE === "supabase") {
    const workspaceAgents = await listWorkspaceAgents(actor);
    return (
      <AppShell currentPath="/tasks/new" title="Create Work" eyebrow="Trust workspace">
        <div className="mb-5"><h2 className="text-xl font-semibold text-white">Define a verifiable outcome</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#969da8]">Create a human-readable Work request, lock its acceptance criteria, then review the exact Authority ceiling before anything can execute.</p></div>
        <WorkspaceCreateWorkForm agents={workspaceAgents} preferredAgentId={query.agent} />
      </AppShell>
    );
  }
  const agents = getDemoStore().listAgents();
  return (
    <AppShell currentPath="/tasks/new" title="Create task" eyebrow="Customer workspace">
      <div className="mb-5"><h2 className="text-xl font-semibold text-white">Define a verifiable outcome</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#969da8]">Scope the repository work, select approved capabilities and decide what evidence will count as done.</p></div>
      <CreateTaskWizard agents={agents} preferredAgentId={query.agent} />
    </AppShell>
  );
}
