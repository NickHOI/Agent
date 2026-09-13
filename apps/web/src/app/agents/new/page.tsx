import { AppShell } from "@/components/app-shell";
import { WorkspaceAgentForm } from "@/components/agents/workspace-agent-form";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  await requirePageActor(["CUSTOMER"]);
  return (
    <AppShell currentPath="/agents" title="Create Agent" eyebrow="Trust workspace">
      <div className="mb-5"><h2 className="text-xl font-semibold text-white">Create a controlled Agent identity</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#969da8]">Describe what this Agent is intended to do. Runtime verification and task Authority remain separate.</p></div>
      <WorkspaceAgentForm />
    </AppShell>
  );
}
