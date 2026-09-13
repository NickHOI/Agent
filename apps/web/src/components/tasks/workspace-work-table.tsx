import Link from "next/link";
import { ArrowUpRight, FileCheck2 } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/status";
import { formatRelativeTime, humanize } from "@/lib/format";
import type { WorkspaceWork } from "@/server/trust-workspace";

export function WorkspaceWorkTable({ work }: { work: WorkspaceWork[] }) {
  if (!work.length) {
    return <div className="flex min-h-64 flex-col items-center justify-center border-t border-[#2a2e36] px-5 text-center"><FileCheck2 className="size-6 text-[#666]" /><h2 className="mt-4 text-sm font-semibold text-white">No Work created yet</h2><p className="mt-2 text-xs leading-5 text-[#969da8]">New Work will appear here with Contract, Authority, execution, verification, and delivery kept distinct.</p></div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-left">
        <thead><tr className="border-b border-[#2a2e36] text-[11px] font-semibold uppercase text-[#666e7a]"><th className="px-4 py-3">Work</th><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Execution</th><th className="px-4 py-3">Verification</th><th className="px-4 py-3">Delivery</th><th className="px-4 py-3">Updated</th><th className="w-12 px-4 py-3"><span className="sr-only">Open</span></th></tr></thead>
        <tbody className="divide-y divide-[#242831]">
          {work.map((item) => <tr key={item.id} className="group bg-[#111318] hover:bg-[#15181e]"><td className="max-w-sm px-4 py-3.5"><Link href={`/tasks/${item.id}`} className="focus-ring block rounded-[3px]"><span className="block truncate text-sm font-semibold text-white group-hover:text-[#8fc2ff]">{item.title}</span><span className="mt-1 block truncate text-xs text-[#666e7a]">{item.repository} - {item.targetBranch}</span></Link></td><td className="px-4 py-3.5 text-xs text-[#b2b8c2]">{item.agent?.name ?? "Not selected"}</td><td className="px-4 py-3.5"><Outcome state={item.execution.state} /></td><td className="px-4 py-3.5"><Outcome state={item.verification.state} /></td><td className="px-4 py-3.5"><Outcome state={item.delivery.state} /></td><td className="px-4 py-3.5 text-xs text-[#969da8]">{formatRelativeTime(item.updatedAt)}</td><td className="px-4 py-3.5"><ArrowUpRight className="size-4 text-[#666e7a] group-hover:text-[#8fc2ff]" /></td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function Outcome({ state }: { state: string }) {
  const tone: StatusTone = state === "VERIFIED" || state === "VERIFIED_DELIVERY" || state === "PASSED" || state === "SUCCEEDED" ? "success" : state === "NOT_STARTED" || state === "NOT_DELIVERED" ? "neutral" : state.includes("FAIL") || state.includes("INVALID") ? "danger" : "warning";
  return <StatusBadge label={humanize(state)} tone={tone} compact />;
}
