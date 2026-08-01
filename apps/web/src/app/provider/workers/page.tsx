import { Box, HardDrive, Network, Server, ShieldAlert } from "lucide-react";
import { getDemoStore } from "@donelayer/database";
import { AppShell } from "@/components/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { formatRelativeTime, humanize } from "@/lib/format";
import { requirePageActor } from "@/server/authorization";

export const dynamic = "force-dynamic";

export default async function WorkerNodesPage() {
  const actor = await requirePageActor(["PROVIDER", "ADMIN"]);
  const providerId = actor.role === "PROVIDER" ? actor.id : "provider-alpha";
  const workers = getDemoStore().listWorkers(providerId);
  return (
    <AppShell currentPath="/provider/workers" title="Worker nodes" eyebrow="Provider operations" actions={<ButtonLink href="/provider/workers/pair" size="sm">Pair Worker</ButtonLink>}>
      <div className="mb-5 flex items-start gap-3 rounded-[5px] border border-[#65501d] bg-[#2b2312] p-3 text-xs leading-5 text-[#d9bc70]"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><div><strong className="text-[#f0cc72]">Safe execution boundary.</strong> Without Docker, the Worker enables only Demo Executor unless Unsafe Development Mode is explicitly configured. Native mode is not equivalent to container isolation.</div></div>
      <Panel className="overflow-hidden">
        <PanelHeader title="Registered nodes" description={`${workers.length} workers · outbound connections only`} />
        <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left"><thead><tr className="border-b border-[#2a2e36] text-[11px] uppercase text-[#666e7a]"><th className="px-4 py-3">Worker</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Environment</th><th className="px-4 py-3">Tools</th><th className="px-4 py-3">Executors</th><th className="px-4 py-3">Capacity</th><th className="px-4 py-3">Last heartbeat</th></tr></thead><tbody className="divide-y divide-[#242831]">{workers.map((worker) => <tr key={worker.id} className="hover:bg-[#15181e]"><td className="px-4 py-3"><div className="flex items-center gap-3"><span className={`flex size-8 items-center justify-center rounded-[5px] border border-[#343944] bg-[#0d0f13] ${worker.status === "ONLINE" || worker.status === "BUSY" ? "text-[#72d981]" : "text-[#666e7a]"}`}><Server className="size-4" /></span><div><div className="text-xs font-semibold text-white">{worker.name}</div><div className="mono mt-1 text-[10px] text-[#555d68]">{worker.id}</div></div></div></td><td className="px-4 py-3"><StatusBadge label={humanize(worker.status)} tone={worker.status === "ONLINE" ? "success" : worker.status === "BUSY" ? "info" : worker.status === "SUSPENDED" ? "danger" : "neutral"} compact /></td><td className="px-4 py-3 text-xs text-[#b2b8c2]">{humanize(worker.os)}</td><td className="max-w-xs px-4 py-3 text-xs text-[#969da8]">{worker.installedTools.join(", ") || "Not reported"}</td><td className="px-4 py-3 text-xs text-[#b2b8c2]">{worker.executors.join(", ")}</td><td className="px-4 py-3 text-xs text-white">{worker.activeJobs} / {worker.maxConcurrentJobs}</td><td className="px-4 py-3 text-xs text-[#969da8]">{formatRelativeTime(worker.lastHeartbeatAt)}</td></tr>)}</tbody></table></div>
      </Panel>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        {[{ icon: Network, title: "Outbound HTTPS", copy: "Workers poll the platform. No public inbound port is opened." }, { icon: HardDrive, title: "Disposable workspace", copy: "Each job receives a one-time workspace with output and file-size limits." }, { icon: Box, title: "Container preferred", copy: "Real execution requires Docker by default; privileged mode and socket mounts are disabled." }].map(({ icon: Icon, title, copy }) => <Panel key={title}><div className="p-4"><Icon className="size-5 text-[#78b5ff]" /><h2 className="mt-4 text-sm font-semibold text-white">{title}</h2><p className="mt-2 text-xs leading-5 text-[#969da8]">{copy}</p></div></Panel>)}
      </div>
    </AppShell>
  );
}
