import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { WorkspaceWorkTable } from "@/components/tasks/workspace-work-table";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { requirePageActor } from "@/server/authorization";
import { listWorkspaceWorks } from "@/server/trust-workspace";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  if (process.env.APP_MODE !== "supabase") redirect("/tasks");
  const actor = await requirePageActor(["CUSTOMER"]);
  const work = await listWorkspaceWorks(actor);
  const receiptCount = work.filter((item) => item.receipt).length;
  return (
    <AppShell currentPath="/history" title="History" eyebrow="Trust workspace">
      <div className="mb-5"><h2 className="text-xl font-semibold text-white">Durable Work history</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#969da8]">Locked Contracts and Authority decisions remain readable before execution. Receipt integrity is checked before any delivery record is shown as valid.</p></div>
      <Panel className="overflow-hidden"><PanelHeader title="All Work" description={`${receiptCount} Receipt${receiptCount === 1 ? "" : "s"} issued`} /><WorkspaceWorkTable work={work} /></Panel>
    </AppShell>
  );
}
