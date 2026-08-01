import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { AgentHallClient } from "@/components/agents/agent-hall-client";
import { StatusBadge } from "@/components/ui/status";

export const dynamic = "force-dynamic";

export default function AgentHallPage() {
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
