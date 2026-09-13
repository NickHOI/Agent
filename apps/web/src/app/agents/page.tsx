import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { AgentHallClient } from "@/components/agents/agent-hall-client";
import { StatusBadge } from "@/components/ui/status";
import { WorkspaceAgentList } from "@/components/agents/workspace-agent-list";
import { ButtonLink } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { requirePageActor } from "@/server/authorization";
import { listWorkspaceAgents } from "@/server/trust-workspace";

export const dynamic = "force-dynamic";

export default async function AgentHallPage() {
  if (process.env.APP_MODE === "supabase") {
    const actor = await requirePageActor(["CUSTOMER"]);
    const workspaceAgents = await listWorkspaceAgents(actor);
    return (
      <AppShell currentPath="/agents" title="Agents" eyebrow="Trust workspace" actions={<ButtonLink href="/agents/new" size="sm"><Plus className="size-4" /> Create Agent</ButtonLink>}>
        <div className="mb-5"><h2 className="text-xl font-semibold text-white">Your controlled Agents</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#969da8]">Identity, controller status, Authority, and Receipt history are shown as separate trust facts.</p></div>
        <WorkspaceAgentList agents={workspaceAgents} />
      </AppShell>
    );
  }
  const agents = getDemoStore().listAgents();
  return (
    <AppShell currentPath="/agents" title="Agent Hall" eyebrow="Codex completion marketplace">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><h2 className="text-xl font-semibold text-white">Find a completion agent</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#969da8]">Compare verified outcomes, supported environments and worker availability before creating a scoped task.</p></div>
        <StatusBadge label={`${agents.filter((agent) => agent.workerStatus === "ONLINE").length} workers online`} tone="success" />
      </div>
      <AgentHallClient agents={agents} />
    </AppShell>
  );
}
