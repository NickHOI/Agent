import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { PairWorkerForm } from "@/components/provider/pair-worker-form";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function WorkerPairingPage() {
  const actor = await requirePageActor(["PROVIDER"]);
  const workers = getDemoStore().listWorkers(actor.id);
  return (
    <AppShell currentPath="/provider/workers" title="Pair Worker" eyebrow="Provider operations">
      <div className="mb-5"><h2 className="text-xl font-semibold text-white">Connect a provider machine</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#969da8]">The code is single-use, expires in 10 minutes and is exchanged for a revocable Worker token.</p></div>
      <PairWorkerForm workers={workers} />
    </AppShell>
  );
}
