import { CheckCircle2, CircleDollarSign, Clock3, Gauge, PlayCircle, ShieldCheck } from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { DemoLaunchButton } from "@/components/dashboard/demo-launch-button";
import { TaskTable } from "@/components/dashboard/task-table";
import { Metric } from "@/components/ui/metric";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { formatCurrency } from "@/lib/format";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function CustomerDashboard() {
  const actor = await requirePageActor(["CUSTOMER", "ADMIN"]);
  const snapshot = getDemoStore().getDashboardSnapshot();
  const completed = snapshot.tasks.filter((task) => task.status === "COMPLETED").length;
  const verified = snapshot.tasks.filter((task) => task.status === "VERIFICATION_PASSED" || task.status === "CUSTOMER_REVIEW" || task.status === "COMPLETED").length;
  const successRate = snapshot.tasks.length ? Math.round((verified / snapshot.tasks.length) * 100) : 0;
  const running = (snapshot.taskCounts.RUNNING ?? 0) + (snapshot.taskCounts.SUBMITTED ?? 0);
  const waiting = (snapshot.taskCounts.MATCHED ?? 0) + (snapshot.taskCounts.AWAITING_PROVIDER ?? 0) + (snapshot.taskCounts.MATCHING ?? 0);
  const verifying = (snapshot.taskCounts.VERIFYING ?? 0) + (snapshot.taskCounts.CUSTOMER_REVIEW ?? 0);

  return (
    <AppShell currentPath="/customer" title={`Good evening, ${actor.name.split(" ")[0]}`} actions={<DemoLaunchButton />}>
      <div className="mb-5">
        <p className="max-w-2xl text-sm leading-6 text-[#969da8]">Track unfinished software work from scope analysis through independent verification and delivery.</p>
      </div>

      <section className="grid overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318] sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Active tasks" value={String(snapshot.tasks.length - completed)} detail={`${completed} completed`} icon={<Gauge className="size-4" />} />
        <Metric label="Waiting for agent" value={String(waiting)} detail="Matching or offer" icon={<Clock3 className="size-4" />} />
        <Metric label="Running" value={String(running)} detail="Worker execution" icon={<PlayCircle className="size-4" />} />
        <Metric label="Verifying" value={String(verifying)} detail="Evidence review" icon={<ShieldCheck className="size-4" />} />
        <Metric label="Test balance" value={formatCurrency(snapshot.customerWallet.availableCents)} detail={`${formatCurrency(snapshot.customerWallet.reservedCents)} reserved`} icon={<CircleDollarSign className="size-4" />} />
        <Metric label="Success rate" value={`${successRate}%`} detail="Verified tasks" icon={<CheckCircle2 className="size-4" />} />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_320px]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Tasks" description="Persisted in the local Demo Store" />
          <TaskTable tasks={snapshot.tasks.slice(0, 8)} />
        </Panel>

        <Panel>
          <PanelHeader title="Proof queue" description="What still needs a decision" />
          <div className="divide-y divide-[#242831]">
            <div className="px-4 py-4">
              <div className="flex items-center justify-between text-sm"><span className="font-medium text-white">Ready for review</span><span className="font-semibold text-[#e3b341]">{verifying}</span></div>
              <p className="mt-1.5 text-xs leading-5 text-[#969da8]">Verified evidence packs waiting for your acceptance.</p>
            </div>
            <div className="px-4 py-4">
              <div className="flex items-center justify-between text-sm"><span className="font-medium text-white">Reserved balance</span><span className="font-semibold text-white">{formatCurrency(snapshot.customerWallet.reservedCents)}</span></div>
              <p className="mt-1.5 text-xs leading-5 text-[#969da8]">Released only after required checks pass and delivery is accepted.</p>
            </div>
            <div className="px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#72d981]"><CheckCircle2 className="size-4" /> No failed verification awaiting action</div>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
