import Link from "next/link";
import { Bot, FileCheck2, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { humanize } from "@/lib/format";
import type { WorkspaceAgent, WorkspaceWork } from "@/server/trust-workspace";

export function WorkspaceAgentDetail({ agent, work }: { agent: WorkspaceAgent; work: WorkspaceWork[] }) {
  const related = work.filter((item) => item.agent?.id === agent.id);
  const receipts = related.flatMap((item) => item.receipt ? [{ work: item, receipt: item.receipt }] : []);
  const authorityReviews = related.filter((item) => item.authority).length;
  return (
    <>
      <section className="flex flex-col justify-between gap-5 border-b border-[#2a2e36] pb-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-[6px] border border-[#343944] bg-[#111318] text-lg font-bold text-[#8fc2ff]">{agent.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-semibold text-white">{agent.name}</h2><StatusBadge label={humanize(agent.verificationStatus)} tone={agent.verificationStatus === "VERIFIED" ? "success" : "warning"} compact /></div><p className="mt-3 max-w-3xl text-sm leading-6 text-[#b2b8c2]">{agent.description}</p></div>
        </div>
        <ButtonLink href={`/tasks/new?agent=${agent.id}`} size="sm"><FileCheck2 className="size-4" /> Create Work</ButtonLink>
      </section>
      <section className="mt-5 grid overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318] sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Identity revision" value={String(agent.identity.revision)} detail="Append-only profile" icon={<Fingerprint className="size-4" />} />
        <Metric label="Work requests" value={String(related.length)} detail="Durable workspace history" icon={<Bot className="size-4" />} />
        <Metric label="Authority reviews" value={String(authorityReviews)} detail="No active Lease implied" icon={<KeyRound className="size-4" />} />
        <Metric label="Verified Work" value={String(receipts.filter((item) => item.receipt.integrity === "VALID" && item.receipt.historyStatus === "VERIFIED_WORK").length)} detail="Gate and Demo receipts excluded" icon={<ShieldCheck className="size-4" />} />
      </section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel><PanelHeader title="Declared capabilities" description="Not yet independently verified" /><div className="p-4"><div className="flex flex-wrap gap-2">{agent.skills.map((skill) => <span key={skill} className="rounded-[4px] border border-[#343944] px-2 py-1 text-xs text-[#b2b8c2]">{skill}</span>)}</div><p className="mt-4 text-xs leading-5 text-[#969da8]">Supported Work: {agent.taskTypes.map(humanize).join(", ") || "None declared"}</p></div></Panel>
          <Panel><PanelHeader title="Receipt history" description="Durable outcomes only" />{receipts.length ? <div className="divide-y divide-[#242831]">{receipts.map(({ work: item, receipt }) => <Link key={receipt.id} href={`/tasks/${item.id}?tab=receipt`} className="focus-ring flex items-center justify-between gap-4 px-4 py-3 hover:bg-[#15181e]"><span className="min-w-0"><span className="block truncate text-sm font-semibold text-white">{item.title}</span><span className="mt-1 block text-xs text-[#969da8]">{humanize(receipt.result)}</span></span><StatusBadge label={receipt.integrity} tone={receipt.integrity === "VALID" ? "success" : "danger"} compact /></Link>)}</div> : <div className="p-4 text-sm leading-6 text-[#969da8]">No Receipt has been issued for this Agent. Demo and Seed data are not shown as verified history.</div>}</Panel>
        </div>
        <div className="space-y-5">
          <Panel><PanelHeader title="Controller" description="Platform relationship" /><div className="divide-y divide-[#242831] px-4"><Row label="Status" value={humanize(agent.identity.status)} /><Row label="Assurance" value="Platform account relationship" /><Row label="Legal identity" value={agent.identity.legallyVerified ? "Verified" : "Not verified"} /></div></Panel>
          <Panel><PanelHeader title="Advanced integrity" description="For audit use" /><details className="p-4 text-xs text-[#969da8]"><summary className="cursor-pointer font-semibold text-[#b2b8c2]">Show identity reference</summary><dl className="mt-4 space-y-3"><div><dt>Agent ID</dt><dd className="mt-1 break-all font-mono text-[11px] text-white">{agent.id}</dd></div><div><dt>Profile hash</dt><dd className="mt-1 break-all font-mono text-[11px] text-white">{agent.identity.profileSha256}</dd></div></dl></details></Panel>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 py-3 text-xs"><span className="text-[#969da8]">{label}</span><span className="max-w-[65%] text-right font-semibold text-white">{value}</span></div>;
}
