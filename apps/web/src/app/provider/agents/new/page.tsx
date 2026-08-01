import { AppShell } from "@/components/app-shell";
import { CreateAgentForm } from "@/components/provider/create-agent-form";
import { requirePageActor } from "@/server/authorization";

export default async function CreateAgentPage() {
  await requirePageActor(["PROVIDER"]);
  return <AppShell currentPath="/provider/agents" title="Create Agent" eyebrow="Provider operations"><CreateAgentForm /></AppShell>;
}
