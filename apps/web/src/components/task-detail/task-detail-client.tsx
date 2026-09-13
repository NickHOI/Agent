"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Code2,
  Download,
  FileCheck2,
  FileDiff,
  FileText,
  GitBranch,
  Hash,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Play,
  ReceiptText,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  UserCheck,
  XCircle
} from "lucide-react";
import type { TaskAggregate } from "@donelayer/database";
import type { TaskStatus } from "@donelayer/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { formatCurrency, formatRelativeTime, humanize, taskStatusTone } from "@/lib/format";

type Tab = "overview" | "contract" | "permissions" | "logs" | "evidence" | "verification" | "receipt" | "payment" | "review";

const lifecycle = [
  { label: "Published", statuses: ["PUBLISHED", "ANALYZING"] },
  { label: "Analyzed", statuses: ["MATCHING"] },
  { label: "Matched", statuses: ["MATCHED", "AWAITING_PROVIDER", "ASSIGNED"] },
  { label: "Running", statuses: ["RUNNING", "SUBMITTED"] },
  { label: "Verifying", statuses: ["VERIFYING", "VERIFICATION_PASSED", "CUSTOMER_REVIEW"] },
  { label: "Completed", statuses: ["COMPLETED"] }
] satisfies Array<{ label: string; statuses: TaskStatus[] }>;

const terminalStatuses: TaskStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED", "DISPUTED", "VERIFICATION_FAILED"];

function lifecycleIndex(status: TaskStatus): number {
  if (status === "DRAFT") return -1;
  return lifecycle.findIndex((stage) => stage.statuses.some((candidate) => candidate === status));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not active";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

function HashLine({ value }: { value: string }) {
  return <span className="mono block break-all text-[11px] leading-5 text-[#969da8]">{value}</span>;
}

function elapsedLabel(start: string | null, end: string | null): string {
  if (!start) return "Not started";
  const elapsedMs = Math.max(0, Date.parse(end ?? new Date().toISOString()) - Date.parse(start));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function Lifecycle({ status }: { status: TaskStatus }) {
  const activeIndex = lifecycleIndex(status);
  return (
    <div className="overflow-x-auto border-y border-[#2a2e36] bg-[#0d0f13] px-4 py-4">
      <div className="mx-auto grid min-w-[620px] max-w-5xl grid-cols-6">
        {lifecycle.map((stage, index) => {
          const complete = index < activeIndex || status === "COMPLETED";
          const active = index === activeIndex && status !== "COMPLETED";
          return (
            <div key={stage.label} className="relative flex flex-col items-center gap-2 text-center">
              {index > 0 ? <span className={cn("absolute right-1/2 top-[9px] h-px w-full", index <= activeIndex ? "bg-[#2f81f7]" : "bg-[#343944]")} /> : null}
              <span className={cn("relative z-10 flex size-5 items-center justify-center rounded-full border", complete ? "border-[#2f81f7] bg-[#2f81f7]" : active ? "border-[#78b5ff] bg-[#10233e]" : "border-[#3a404b] bg-[#111318]")}>
                {complete ? <Check className="size-3 text-white" strokeWidth={3} /> : active ? <span className="size-1.5 rounded-full bg-[#78b5ff]" /> : null}
              </span>
              <span className={cn("text-[11px] font-semibold", active ? "text-white" : complete ? "text-[#8fc2ff]" : "text-[#666e7a]")}>{stage.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JobLog({ aggregate }: { aggregate: TaskAggregate }) {
  const events = aggregate.jobEvents;
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Live execution log"
        description={aggregate.jobRun ? `${aggregate.jobRun.executor} executor · ${aggregate.jobRun.id.slice(0, 18)}` : "Waiting for an accepted job"}
        action={<span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#72d981]"><span className={cn("size-1.5 rounded-full", aggregate.task.status === "RUNNING" ? "animate-pulse bg-[#3fb950]" : "bg-[#666e7a]")} /> {aggregate.task.status === "RUNNING" ? "Live" : "Recorded"}</span>}
      />
      <div className="mono min-h-[290px] overflow-auto bg-[#090a0c] p-4 text-[11px] leading-6">
        {events.length ? events.map((event) => (
          <div key={event.id} className="grid grid-cols-[62px_72px_1fr] gap-2 border-b border-[#171a20] py-1 last:border-0">
            <span className="text-[#555d68]">{formatTime(event.createdAt)}</span>
            <span className={cn("font-semibold", event.level === "SUCCESS" ? "text-[#72d981]" : event.level === "ERROR" ? "text-[#ff8e88]" : event.level === "WARN" ? "text-[#e3b341]" : "text-[#78b5ff]")}>{event.kind}</span>
            <span className="min-w-0 break-words text-[#a7adb7]">{event.message}</span>
          </div>
        )) : (
          <div className="flex min-h-[250px] items-center justify-center text-[#666e7a]">Logs appear after the provider accepts and a worker claims the job.</div>
        )}
      </div>
    </Panel>
  );
}

function TaskTimeline({ aggregate }: { aggregate: TaskAggregate }) {
  return (
    <Panel>
      <PanelHeader title="Task timeline" description={`${aggregate.events.length} immutable task events`} />
      <div className="divide-y divide-[#242831]">
        {[...aggregate.events].reverse().map((event, index) => (
          <div key={event.id} className="grid grid-cols-[24px_1fr_auto] gap-3 px-4 py-3.5">
            <div className="relative flex justify-center">
              {index < aggregate.events.length - 1 ? <span className="absolute bottom-[-14px] top-4 w-px bg-[#2a2e36]" /> : null}
              <span className={cn("relative mt-1 size-2 rounded-full", index === 0 ? "bg-[#2f81f7]" : "bg-[#4a515d]")} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-white">{humanize(event.eventType)}</div>
              <p className="mt-1 text-xs leading-5 text-[#969da8]">{event.reason}</p>
              <div className="mt-1.5 text-[11px] text-[#555d68]">{humanize(event.actorKind)} · {event.actorId}</div>
            </div>
            <time className="text-[11px] text-[#666e7a]">{formatTime(event.createdAt)}</time>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function VerificationPanel({ aggregate, onEvidence }: { aggregate: TaskAggregate; onEvidence: () => void }) {
  const results = new Map(aggregate.verificationResults.map((result) => [result.checkId, result]));
  const required = aggregate.task.acceptanceChecks.filter((check) => check.required);
  const passed = required.filter((check) => results.get(check.id)?.status === "PASSED").length;
  return (
    <Panel>
      <PanelHeader
        title="Proof-of-Done"
        description={`${passed} of ${required.length} required checks passed`}
        action={<ShieldCheck className={cn("size-5", passed === required.length && required.length ? "text-[#3fb950]" : "text-[#d29922]")} />}
      />
      <div className="h-1 bg-[#242831]"><div className="h-full bg-[#3fb950] transition-all" style={{ width: `${required.length ? (passed / required.length) * 100 : 0}%` }} /></div>
      <div className="divide-y divide-[#242831]">
        {aggregate.task.acceptanceChecks.map((check) => {
          const result = results.get(check.id);
          const state = result?.status ?? "PENDING";
          const Icon = state === "PASSED" ? CheckCircle2 : state === "FAILED" ? XCircle : Clock3;
          return (
            <div key={check.id} className="flex items-start gap-3 px-4 py-3">
              <Icon className={cn("mt-0.5 size-4 shrink-0", state === "PASSED" ? "text-[#3fb950]" : state === "FAILED" ? "text-[#f85149]" : "text-[#d29922]")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-semibold text-white">{check.title}</span>
                  <span className="shrink-0 text-[10px] font-semibold text-[#666e7a]">{check.required ? "REQUIRED" : "OPTIONAL"}</span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-[#969da8]">{result?.summary ?? `Waiting for ${humanize(check.type).toLowerCase()} evidence`}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-[#2a2e36] p-3">
        <Button variant="secondary" size="sm" className="w-full" onClick={onEvidence}><FileCheck2 className="size-4" /> Review evidence</Button>
      </div>
    </Panel>
  );
}

function EvidencePanel({ aggregate, full = false }: { aggregate: TaskAggregate; full?: boolean }) {
  const evidence = full ? aggregate.evidence : aggregate.evidence.slice(0, 4);
  const icons: Record<string, typeof FileText> = { GIT_DIFF: FileDiff, TEST_RESULT: CheckCircle2, BUILD_RESULT: Code2, SCREENSHOT: FileCheck2, COMMAND_RESULT: TerminalSquare };
  return (
    <Panel>
      <PanelHeader title={full ? "Evidence and ledger" : "Evidence artifacts"} description={`${aggregate.evidence.length} immutable artifact${aggregate.evidence.length === 1 ? "" : "s"}`} action={<Hash className="size-4 text-[#666e7a]" />} />
      {evidence.length ? (
        <div className="divide-y divide-[#242831]">
          {evidence.map((artifact) => {
            const Icon = icons[artifact.artifactType] ?? FileText;
            return (
              <div key={artifact.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] border border-[#343944] bg-[#0d0f13] text-[#78b5ff]"><Icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white">{artifact.fileName}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-[#666e7a]"><span>{humanize(artifact.artifactType)}</span><span>·</span><span>{artifact.size} B</span></div>
                  <div className="mono mt-1 truncate text-[10px] text-[#555d68]">sha256 {artifact.sha256}</div>
                </div>
                <button disabled className="flex size-8 items-center justify-center rounded-[5px] text-[#555d68]" title="Artifact download is not available in this view" aria-label={`Download ${artifact.fileName}`}><Download className="size-3.5" /></button>
              </div>
            );
          })}
        </div>
      ) : <div className="flex min-h-36 items-center justify-center px-4 text-center text-xs text-[#666e7a]">Evidence appears after the worker submits a result.</div>}
      {full ? (
        <div className="border-t border-[#2a2e36]">
          <div className="flex items-center justify-between gap-3 border-b border-[#242831] px-4 py-3">
            <div>
              <h3 className="text-xs font-semibold text-white">Evidence Ledger</h3>
              <p className="mt-1 text-[11px] text-[#666e7a]">{aggregate.evidenceLedger.length} append-only entries</p>
            </div>
            <StatusBadge label={aggregate.evidenceLedgerVerification.valid ? "Chain valid" : "Chain invalid"} tone={aggregate.evidenceLedgerVerification.valid ? "success" : "danger"} compact />
          </div>
          {aggregate.evidenceLedger.length ? (
            <div className="divide-y divide-[#242831]">
              {aggregate.evidenceLedger.map((entry) => (
                <div key={entry.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[48px_minmax(150px,0.55fr)_minmax(0,1fr)] sm:items-center">
                  <span className="mono text-[11px] text-[#666e7a]">#{entry.sequenceNumber}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-white">{humanize(entry.entryType)}</div>
                    <div className="mt-1 truncate text-[10px] text-[#666e7a]">{entry.sourceRecordType}</div>
                  </div>
                  <div className="min-w-0"><HashLine value={entry.entrySha256} /></div>
                </div>
              ))}
            </div>
          ) : <div className="px-4 py-8 text-center text-xs text-[#666e7a]">No ledger entries have been recorded.</div>}
          {aggregate.evidenceLedgerVerification.chainSha256 ? <div className="border-t border-[#242831] px-4 py-3"><div className="mb-1 text-[10px] font-semibold uppercase text-[#666e7a]">Chain SHA-256</div><HashLine value={aggregate.evidenceLedgerVerification.chainSha256} /></div> : null}
        </div>
      ) : null}
    </Panel>
  );
}

function ContractPanel({ aggregate }: { aggregate: TaskAggregate }) {
  const version = aggregate.taskContract;
  if (!version) {
    return <Panel><PanelHeader title="Task Contract" description="No versioned Contract is attached to this Job." /><div className="px-4 py-10 text-center text-xs text-[#666e7a]">A Contract must be locked before a trusted Worker run can begin.</div></Panel>;
  }
  const contract = version.contract;
  return (
    <Panel>
      <PanelHeader title="Task Contract" description={`Version ${version.version}`} action={<StatusBadge label={humanize(version.status)} tone={version.status === "LOCKED" ? "success" : version.status === "DRAFT" ? "warning" : "neutral"} compact />} />
      <div className="grid gap-px bg-[#242831] sm:grid-cols-3">
        <div className="bg-[#111318] px-4 py-3"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Version</div><div className="mt-1.5 text-xs text-white">{version.version}</div></div>
        <div className="bg-[#111318] px-4 py-3"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Workflow</div><div className="mt-1.5 text-xs text-white">{contract.allowedWorkflow}</div></div>
        <div className="bg-[#111318] px-4 py-3"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Locked At</div><div className="mt-1.5 text-xs text-white">{formatDateTime(version.lockedAt)}</div></div>
      </div>
      <div className="border-t border-[#242831] px-4 py-4"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Contract SHA-256</div><div className="mt-2"><HashLine value={version.contractSha256} /></div></div>
      <div className="border-t border-[#242831] px-4 py-4"><h3 className="text-xs font-semibold text-white">Desired outcome</h3><p className="mt-2 text-sm leading-6 text-[#969da8]">{contract.desiredOutcome}</p></div>
      <div className="grid gap-px border-t border-[#242831] bg-[#242831] lg:grid-cols-2">
        <div className="bg-[#111318] px-4 py-4"><h3 className="text-xs font-semibold text-white">Deliverables</h3><ul className="mt-3 space-y-2">{contract.deliverables.map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-[#b2b8c2]"><FileCheck2 className="mt-0.5 size-3.5 shrink-0 text-[#78b5ff]" />{item}</li>)}</ul></div>
        <div className="bg-[#111318] px-4 py-4"><h3 className="text-xs font-semibold text-white">Acceptance checks</h3><ul className="mt-3 space-y-2">{contract.acceptanceChecks.map((check) => <li key={check.id} className="flex gap-2 text-xs leading-5 text-[#b2b8c2]"><ClipboardCheck className="mt-0.5 size-3.5 shrink-0 text-[#72d981]" /><span>{check.label}<span className="ml-2 text-[10px] font-semibold text-[#666e7a]">{check.required ? "REQUIRED" : "OPTIONAL"}</span></span></li>)}</ul></div>
      </div>
    </Panel>
  );
}

function PermissionsPanel({ aggregate }: { aggregate: TaskAggregate }) {
  const lease = aggregate.permissionLease;
  if (!lease) {
    return <Panel><PanelHeader title="Permission Lease" description="No Permission Lease is attached to this Job." /><div className="px-4 py-10 text-center text-xs text-[#666e7a]">Permission scope is created server-side for trusted Worker runs.</div></Panel>;
  }
  const violations = aggregate.evidenceLedger.filter((entry) => entry.entryType === "PERMISSION_VIOLATION");
  const healthy = lease.status === "ACTIVE" || lease.status === "COMPLETED";
  return (
    <Panel>
      <PanelHeader title="Permission Lease" description={`Version ${lease.version}`} action={<StatusBadge label={humanize(lease.status)} tone={lease.status === "VIOLATED" || lease.status === "REVOKED" ? "danger" : healthy ? "success" : "warning"} compact />} />
      <div className="grid gap-px bg-[#242831] sm:grid-cols-2">
        <div className="bg-[#111318] px-4 py-4"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Effective Time</div><div className="mt-2 text-xs text-white">{formatDateTime(lease.startsAt)}</div></div>
        <div className="bg-[#111318] px-4 py-4"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Expiry</div><div className="mt-2 text-xs text-white">{formatDateTime(lease.expiresAt)}</div></div>
      </div>
      <div className="grid gap-px border-t border-[#242831] bg-[#242831] lg:grid-cols-2">
        <div className="bg-[#111318] px-4 py-4"><h3 className="flex items-center gap-2 text-xs font-semibold text-white"><KeyRound className="size-4 text-[#72d981]" />Allowed Actions</h3><div className="mt-3 flex flex-wrap gap-2">{lease.scope.allowedActions.map((action) => <span key={action} className="rounded-[4px] border border-[#295b34] bg-[#102718] px-2 py-1 text-[11px] text-[#72d981]">{action}</span>)}</div></div>
        <div className="bg-[#111318] px-4 py-4"><h3 className="flex items-center gap-2 text-xs font-semibold text-white"><LockKeyhole className="size-4 text-[#ff8e88]" />Denied Actions</h3><div className="mt-3 flex flex-wrap gap-2">{lease.scope.deniedActions.map((action) => <span key={action} className="rounded-[4px] border border-[#6e2d2b] bg-[#2b1718] px-2 py-1 text-[11px] text-[#ffb4b0]">{action}</span>)}</div></div>
      </div>
      <div className="border-t border-[#242831] px-4 py-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold text-white">Permission Violations</h3><StatusBadge label={violations.length ? `${violations.length} recorded` : "None recorded"} tone={violations.length ? "danger" : "success"} compact /></div>
        {violations.length ? <ul className="mt-3 space-y-2">{violations.map((entry) => <li key={entry.id} className="text-xs text-[#ffb4b0]">Ledger entry #{entry.sequenceNumber} · {formatDateTime(entry.createdAt)}</li>)}</ul> : <p className="mt-2 text-xs leading-5 text-[#969da8]">No blocked or out-of-scope operation was recorded for this Permission Lease.</p>}
      </div>
    </Panel>
  );
}

function receiptTone(result: string): "success" | "warning" | "danger" | "neutral" {
  if (result === "VERIFIED") return "success";
  if (result === "PARTIALLY_VERIFIED" || result === "UNVERIFIED") return "warning";
  if (result === "FAILED" || result === "PERMISSION_VIOLATION" || result === "INVALID_EVIDENCE_CHAIN" || result === "DISPUTED") return "danger";
  return "neutral";
}

function ReceiptPanel({ aggregate }: { aggregate: TaskAggregate }) {
  const record = aggregate.receipt;
  if (!record) {
    return <Panel><PanelHeader title="Verified Job Receipt" description="No Receipt has been issued." action={<StatusBadge label="Not issued" tone="neutral" compact />} /><div className="px-4 py-10 text-center text-xs leading-5 text-[#666e7a]">A Receipt is created only after execution evidence, Permission scope, required checks, and the Evidence Ledger chain are evaluated.</div></Panel>;
  }
  const receipt = record.receipt;
  return (
    <Panel>
      <PanelHeader title="Verified Job Receipt" description="Hash-verifiable DoneLayer execution receipt." action={<StatusBadge label={humanize(record.result)} tone={receiptTone(record.result)} compact />} />
      {record.invalidatedAt ? <div className="border-b border-[#6e2d2b] bg-[#2b1718] px-4 py-3 text-xs font-semibold text-[#ff8e88]">This Receipt was invalidated at {formatDateTime(record.invalidatedAt)}.</div> : null}
      <div className="grid gap-px bg-[#242831] lg:grid-cols-2">
        <div className="bg-[#111318] px-4 py-4"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Public Receipt ID</div><div className="mt-2"><HashLine value={record.receiptPublicId} /></div></div>
        <div className="bg-[#111318] px-4 py-4"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Issued At</div><div className="mt-2 text-xs text-white">{formatDateTime(record.createdAt)}</div></div>
        <div className="bg-[#111318] px-4 py-4"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Receipt SHA-256</div><div className="mt-2"><HashLine value={record.receiptSha256} /></div></div>
        <div className="bg-[#111318] px-4 py-4"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Evidence Chain SHA-256</div><div className="mt-2"><HashLine value={record.evidenceChainSha256} /></div></div>
      </div>
      <div className="grid gap-px border-t border-[#242831] bg-[#242831] lg:grid-cols-2">
        <div className="bg-[#111318] px-4 py-4"><h3 className="text-xs font-semibold text-white">Who requested</h3><dl className="mt-3 space-y-2 text-xs"><div><dt className="text-[#666e7a]">Customer reference</dt><dd className="mt-1 text-[#b2b8c2]">{receipt.whoRequested.customerReference}</dd></div><div><dt className="text-[#666e7a]">Task ID</dt><dd className="mt-1"><HashLine value={receipt.whoRequested.taskId} /></dd></div><div className="flex justify-between gap-3"><dt className="text-[#666e7a]">Ordered</dt><dd className="text-right text-[#b2b8c2]">{formatDateTime(receipt.whoRequested.orderedAt)}</dd></div></dl></div>
        <div className="bg-[#111318] px-4 py-4"><h3 className="text-xs font-semibold text-white">Who executed</h3><dl className="mt-3 space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-[#666e7a]">Agent</dt><dd className="text-right text-[#b2b8c2]">{receipt.whoExecuted.agentPublicIdentity} · v{receipt.whoExecuted.agentVersion}</dd></div><div><dt className="text-[#666e7a]">Agent / Provider IDs</dt><dd className="mt-1"><HashLine value={`${receipt.whoExecuted.agentId} / ${receipt.whoExecuted.providerId}`} /></dd></div><div className="flex justify-between gap-3"><dt className="text-[#666e7a]">Execution node</dt><dd className="text-right text-[#b2b8c2]">{receipt.whoExecuted.workerPublicIdentity} · v{receipt.whoExecuted.workerVersion ?? "n/a"}</dd></div><div><dt className="text-[#666e7a]">Worker ID</dt><dd className="mt-1">{receipt.whoExecuted.workerId ? <HashLine value={receipt.whoExecuted.workerId} /> : <span className="text-[#969da8]">Not applicable to managed execution</span>}</dd></div><div className="flex justify-between gap-3"><dt className="text-[#666e7a]">Runtime / OS / Arch</dt><dd className="text-right text-[#b2b8c2]">{receipt.whoExecuted.runtime} / {receipt.whoExecuted.os} / {receipt.whoExecuted.capabilitySnapshot?.architecture ?? "provider-observed"}</dd></div></dl></div>
        <div className="bg-[#111318] px-4 py-4"><h3 className="text-xs font-semibold text-white">What was agreed</h3><p className="mt-3 text-xs leading-5 text-[#b2b8c2]">{receipt.whatWasAgreed.desiredOutcome}</p><p className="mt-2 text-xs text-[#969da8]">Deliverables: {receipt.whatWasAgreed.deliverables.join(", ")}</p><p className="mt-2 text-[11px] text-[#666e7a]">Contract v{receipt.whatWasAgreed.contractVersion} · {receipt.whatWasAgreed.acceptanceChecks.length} checks</p></div>
        <div className="bg-[#111318] px-4 py-4"><h3 className="text-xs font-semibold text-white">What was permitted</h3><p className="mt-3 text-xs leading-5 text-[#b2b8c2]">Allowed: {receipt.whatWasPermitted.allowedActions.join(", ")}</p><p className="mt-2 text-xs leading-5 text-[#969da8]">Denied: {receipt.whatWasPermitted.deniedActions.join(", ")}</p><p className="mt-2 text-[11px] text-[#666e7a]">{formatDateTime(receipt.whatWasPermitted.effectiveAt)} to {formatDateTime(receipt.whatWasPermitted.expiresAt)} · {receipt.whatWasPermitted.permissionViolations.length} violations</p></div>
        <div className="bg-[#111318] px-4 py-4 lg:col-span-2"><h3 className="text-xs font-semibold text-white">What happened</h3><div className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><div className="text-[#666e7a]">Job Run ID</div><div className="mt-1"><HashLine value={receipt.whatHappened.jobRunId} /></div></div><div className="text-[#b2b8c2]">{formatDateTime(receipt.whatHappened.startedAt)} to {formatDateTime(receipt.whatHappened.finishedAt)}<p className="mt-1 text-[11px] text-[#666e7a]">{receipt.whatHappened.durationMs} ms · Workspace {receipt.whatHappened.workspaceCleaned ? "cleaned" : "not confirmed clean"}</p></div></div>{receipt.whatHappened.artifacts.map((artifact) => <div key={artifact.id} className="mt-3 border-t border-[#242831] pt-3 text-xs"><div className="text-[#b2b8c2]">{artifact.fileName} · {artifact.mimeType} · {artifact.size} bytes</div><div className="mt-1"><HashLine value={artifact.sha256} /></div></div>)}</div>
      </div>
      <div className="border-t border-[#242831] px-4 py-4"><h3 className="text-xs font-semibold text-white">How it was verified</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{receipt.howVerified.checks.map((check) => <div key={check.id} className="flex items-start gap-2 text-xs leading-5"><CheckCircle2 className={cn("mt-0.5 size-3.5 shrink-0", check.status === "PASSED" ? "text-[#72d981]" : "text-[#ff8e88]")} /><span className="text-[#b2b8c2]">{check.summary}</span></div>)}</div></div>
      <div className="flex flex-wrap gap-2 border-t border-[#2a2e36] p-3">
        <ButtonLink href={`/receipts/${encodeURIComponent(record.receiptPublicId)}`} size="sm"><ShieldCheck className="size-4" /> Verify receipt</ButtonLink>
        <ButtonLink href={`/receipts/${encodeURIComponent(record.receiptPublicId)}`} variant="secondary" size="sm"><Link2 className="size-4" /> Public view</ButtonLink>
      </div>
    </Panel>
  );
}

function PaymentPanel({ aggregate }: { aggregate: TaskAggregate }) {
  const released = aggregate.ledgerEntries.some((entry) => entry.entryType === "RELEASE" && entry.amountCents > 0);
  const provider = aggregate.assignment?.providerEarningCents ?? Math.round(aggregate.task.budgetCents * 0.8);
  const fee = aggregate.assignment?.platformFeeCents ?? aggregate.task.budgetCents - provider;
  return (
    <Panel>
      <PanelHeader title="Test ledger" description="Simulation only · no real payment" action={<CircleDollarSign className="size-4 text-[#666e7a]" />} />
      <div className="divide-y divide-[#242831] px-4">
        <div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">Customer reserved</span><span className="font-semibold text-white">{formatCurrency(aggregate.task.budgetCents)}</span></div>
        <div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">Provider share · 80%</span><span className={cn("font-semibold", released ? "text-[#72d981]" : "text-white")}>{formatCurrency(provider)}</span></div>
        <div className="flex items-center justify-between py-3 text-xs"><span className="text-[#969da8]">Platform fee · 20%</span><span className="font-semibold text-white">{formatCurrency(fee)}</span></div>
      </div>
      <div className="border-t border-[#2a2e36] p-3">
        <StatusBadge label={released ? "Released after acceptance" : "Held in test escrow"} tone={released ? "success" : "warning"} />
      </div>
    </Panel>
  );
}

function SummaryPanel({ aggregate }: { aggregate: TaskAggregate }) {
  const summaryFields: Array<[string, string]> = [
    ["Skills", aggregate.task.requiredSkills.join(", ") || "None"],
    ["Operating system", aggregate.task.requiredOperatingSystem ?? "Any"],
    ["Tools", aggregate.task.requiredTools.join(", ") || "None"],
    ["Security", aggregate.task.securitySensitivity]
  ];
  return (
    <Panel>
      <PanelHeader title="Scope and requirements" description={humanize(aggregate.task.taskType)} />
      <div className="grid gap-px bg-[#242831] md:grid-cols-2">
        <div className="bg-[#111318] p-4">
          <h3 className="text-xs font-semibold text-white">Problem</h3>
          <p className="mt-2 text-sm leading-6 text-[#969da8]">{aggregate.task.problemDescription}</p>
        </div>
        <div className="bg-[#111318] p-4">
          <h3 className="text-xs font-semibold text-white">Desired outcome</h3>
          <p className="mt-2 text-sm leading-6 text-[#969da8]">{aggregate.task.desiredOutcome}</p>
        </div>
      </div>
      <div className="grid gap-px border-t border-[#242831] bg-[#242831] sm:grid-cols-2 xl:grid-cols-4">
        {summaryFields.map(([label, value]) => (
          <div key={label} className="min-w-0 bg-[#111318] px-4 py-3"><div className="text-[10px] font-semibold uppercase text-[#666e7a]">{label}</div><div className="mt-1.5 truncate text-xs text-[#b2b8c2]">{humanize(value)}</div></div>
        ))}
      </div>
    </Panel>
  );
}

export function TaskDetailClient({ initial, autoRun, canOperate = true }: { initial: TaskAggregate; autoRun: boolean; canOperate?: boolean }) {
  const [aggregate, setAggregate] = useState(initial);
  const isDemo = initial.task.repository.startsWith("demo://") && (!initial.jobRun || initial.jobRun.executor === "DEMO");
  const isWorkerSmoke = initial.jobRun?.workflowTemplate === "WORKER_SMOKE_V1";
  const [running, setRunning] = useState(canOperate && isDemo && autoRun && !terminalStatuses.includes(initial.task.status));
  const [stepping, setStepping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [disputeReason, setDisputeReason] = useState("");
  const [openingDispute, setOpeningDispute] = useState(false);

  const step = useCallback(async () => {
    if (stepping || !isDemo) return;
    setStepping(true);
    try {
      const response = await fetch(`/api/demo/${aggregate.task.id}/step`, { method: "POST" });
      const body = (await response.json()) as TaskAggregate & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The demo step failed.");
      setAggregate(body);
      if (terminalStatuses.includes(body.task.status)) setRunning(false);
      setError(null);
    } catch (caught) {
      setRunning(false);
      setError(caught instanceof Error ? caught.message : "The demo step failed.");
    } finally {
      setStepping(false);
    }
  }, [aggregate.task.id, isDemo, stepping]);

  useEffect(() => {
    if (!isDemo || !running || stepping || terminalStatuses.includes(aggregate.task.status)) return;
    const timer = window.setTimeout(() => void step(), aggregate.task.status === "RUNNING" ? 900 : 650);
    return () => window.clearTimeout(timer);
  }, [aggregate.task.status, isDemo, running, step, stepping]);

  const activeMatch = aggregate.matches[0];
  const matchReason = activeMatch?.reasons[0];
  const elapsed = elapsedLabel(aggregate.jobRun?.startedAt ?? null, aggregate.jobRun?.endedAt ?? null);
  const released = aggregate.ledgerEntries.some((entry) => entry.entryType === "RELEASE" && entry.amountCents > 0);
  const tabs = useMemo(() => {
    const trustTabs: Array<[Tab, string]> = [
      ["overview", "Summary"],
      ["contract", "Contract"],
      ["permissions", "Permissions"],
      ["evidence", `Evidence ${aggregate.evidence.length ? `(${aggregate.evidence.length})` : ""}`],
      ["receipt", "Receipt"]
    ];
    if (!isDemo) return trustTabs;
    const demoTabs: Array<[Tab, string]> = [["logs", "Live logs"], ["verification", "Verification"], ["payment", "Payment"], ["review", "Review"]];
    return [...trustTabs, ...demoTabs];
  }, [aggregate.evidence.length, isDemo]);

  const taskTypeLabel = isWorkerSmoke ? "Worker Infrastructure Verification" : humanize(aggregate.task.taskType);

  async function openDispute() {
    setOpeningDispute(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${aggregate.task.id}/disputes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: disputeReason }) });
      const body = (await response.json()) as { aggregate?: TaskAggregate; error?: string };
      if (!response.ok || !body.aggregate) throw new Error(body.error ?? "Unable to open dispute.");
      setAggregate(body.aggregate);
      setDisputeReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open dispute.");
    } finally {
      setOpeningDispute(false);
    }
  }

  return (
    <div>
      <section className="mb-5">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#666e7a]"><span>{aggregate.task.id.slice(0, 18)}</span><ChevronRight className="size-3" /><span>{taskTypeLabel}</span><StatusBadge label={humanize(aggregate.task.status)} tone={taskStatusTone(aggregate.task.status)} compact /></div>
            <h2 className="mt-3 max-w-4xl text-2xl font-semibold leading-8 text-white">{aggregate.task.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#969da8]">
              {isWorkerSmoke ? <span className="flex items-center gap-1.5"><Server className="size-3.5" /> Fixed server-side workflow · WORKER_SMOKE_V1</span> : <span className="flex items-center gap-1.5"><GitBranch className="size-3.5" /> {aggregate.task.repository.replace("demo://", "")} · {aggregate.task.targetBranch}</span>}
              <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" /> Updated {formatRelativeTime(aggregate.task.updatedAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {error ? <span className="max-w-xs text-xs text-[#ff8e88]">{error}</span> : null}
            {canOperate && isDemo && !terminalStatuses.includes(aggregate.task.status) ? (
              <Button variant="secondary" size="sm" onClick={() => setRunning((value) => !value)}>
                {running ? <><Circle className="size-3 fill-current" /> Pause demo</> : <><Play className="size-4" /> Continue demo</>}
              </Button>
            ) : null}
            {canOperate && isDemo && !running && !terminalStatuses.includes(aggregate.task.status) ? <Button size="sm" onClick={() => void step()} disabled={stepping}>{stepping ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Advance one step</Button> : null}
            {canOperate && isDemo ? <Button variant="danger" size="sm" onClick={() => setTab("review")}><ShieldAlert className="size-4" /> Open dispute</Button> : null}
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318]">
          <Lifecycle status={aggregate.task.status} />
          <div className="grid gap-px bg-[#242831] sm:grid-cols-2 xl:grid-cols-4">
            <div className="min-w-0 bg-[#111318] px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[#666e7a]"><Bot className="size-3.5" /> Matched agent</div>
              <div className="mt-2 truncate text-sm font-semibold text-white">{aggregate.agent?.name ?? "Matching in progress"}</div>
              <div className="mt-1 truncate text-xs text-[#969da8]">{aggregate.agent?.providerName ?? "No provider selected"}</div>
            </div>
            <div className="min-w-0 bg-[#111318] px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[#666e7a]"><Server className="size-3.5" /> Worker</div>
              <div className="mt-2 truncate text-sm font-semibold text-white">{aggregate.worker?.name ?? "Not assigned"}</div>
              <div className={cn("mt-1 flex items-center gap-1.5 text-xs", aggregate.worker?.status === "ONLINE" || aggregate.worker?.status === "BUSY" ? "text-[#72d981]" : "text-[#969da8]")}><span className="size-1.5 rounded-full bg-current" /> {aggregate.worker ? humanize(aggregate.worker.status) : "Waiting"}</div>
            </div>
            <div className="min-w-0 bg-[#111318] px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[#666e7a]"><Activity className="size-3.5" /> Execution time</div>
              <div className="mono mt-2 text-sm font-semibold text-white">{elapsed}</div>
              <div className="mt-1 text-xs text-[#969da8]">{isDemo ? "Max 30 minutes" : aggregate.permissionLease ? `Max ${aggregate.permissionLease.scope.maxRuntimeSeconds} seconds` : "No runtime permission"}</div>
            </div>
            {isDemo ? <div className="min-w-0 bg-[#111318] px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[#666e7a]"><CircleDollarSign className="size-3.5" /> Test payment</div>
              <div className="mt-2 text-sm font-semibold text-white">{formatCurrency(aggregate.task.budgetCents)}</div>
              <div className={cn("mt-1 text-xs", released ? "text-[#72d981]" : "text-[#e3b341]")}>{released ? "Released" : "Reserved"}</div>
            </div> : <div className="min-w-0 bg-[#111318] px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[#666e7a]"><ReceiptText className="size-3.5" /> Receipt</div>
              <div className="mt-2 truncate text-sm font-semibold text-white">{aggregate.receipt ? humanize(aggregate.receipt.result) : "Not issued"}</div>
              <div className={cn("mt-1 text-xs", aggregate.receipt?.result === "VERIFIED" ? "text-[#72d981]" : aggregate.receipt ? "text-[#ff8e88]" : "text-[#969da8]")}>{aggregate.receipt ? "Evidence-backed result" : "Awaiting verification"}</div>
            </div>}
          </div>
          {matchReason ? <div className="border-t border-[#242831] px-4 py-3 text-xs leading-5 text-[#969da8]"><span className="mr-2 font-semibold text-[#8fc2ff]">Match reason</span>{matchReason}</div> : null}
        </div>
      </section>

      <div className="mb-5 overflow-x-auto border-b border-[#2a2e36]">
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Task views">
          {tabs.map(([value, label]) => (
            <button key={value} role="tab" aria-selected={tab === value} className={cn("focus-ring relative h-10 rounded-t-[4px] px-3 text-xs font-semibold", tab === value ? "text-white after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[#2f81f7]" : "text-[#969da8] hover:text-white")} onClick={() => setTab(value)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === "overview" ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          <div className="min-w-0 space-y-5"><JobLog aggregate={aggregate} /><TaskTimeline aggregate={aggregate} /></div>
          <div className="min-w-0 space-y-5"><VerificationPanel aggregate={aggregate} onEvidence={() => setTab("evidence")} /><EvidencePanel aggregate={aggregate} />{isDemo ? <PaymentPanel aggregate={aggregate} /> : null}</div>
        </div>
      ) : null}
      {tab === "contract" ? <div className="max-w-5xl"><ContractPanel aggregate={aggregate} /></div> : null}
      {tab === "permissions" ? <div className="max-w-5xl"><PermissionsPanel aggregate={aggregate} /></div> : null}
      {tab === "logs" ? <JobLog aggregate={aggregate} /> : null}
      {tab === "evidence" ? <EvidencePanel aggregate={aggregate} full /> : null}
      {tab === "verification" ? <div className="max-w-3xl"><VerificationPanel aggregate={aggregate} onEvidence={() => setTab("evidence")} /></div> : null}
      {tab === "receipt" ? <div className="max-w-5xl"><ReceiptPanel aggregate={aggregate} /></div> : null}
      {isDemo && tab === "payment" ? <div className="max-w-xl"><PaymentPanel aggregate={aggregate} /></div> : null}
      {isDemo && tab === "review" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <SummaryPanel aggregate={aggregate} />
          <Panel>
            <PanelHeader title="Delivery decision" description="Available only after verification" />
            <div className="p-4">
              {aggregate.task.status === "COMPLETED" ? (
                <div className="flex items-start gap-3 text-sm text-[#72d981]"><UserCheck className="mt-0.5 size-5 shrink-0" /><div><div className="font-semibold">Delivery accepted</div><p className="mt-1 text-xs leading-5 text-[#969da8]">The provider share and platform fee were released in the Test Ledger.</p></div></div>
              ) : canOperate && aggregate.task.status === "CUSTOMER_REVIEW" ? (
                <div><p className="text-sm leading-6 text-[#b2b8c2]">All required checks passed. Continue the demo to record customer acceptance and release the simulated payment.</p><Button className="mt-4 w-full" onClick={() => void step()} disabled={stepping}>{stepping ? <LoaderCircle className="size-4 animate-spin" /> : <UserCheck className="size-4" />} Accept verified delivery</Button></div>
              ) : (
                <div className="flex items-start gap-3 text-sm text-[#e3b341]"><CircleAlert className="mt-0.5 size-5 shrink-0" /><div><div className="font-semibold">Verification not complete</div><p className="mt-1 text-xs leading-5 text-[#969da8]">A task cannot be accepted or marked complete before every required check passes.</p></div></div>
              )}
              {canOperate && (aggregate.task.status === "CUSTOMER_REVIEW" || aggregate.task.status === "VERIFICATION_FAILED") ? <div className="mt-4 border-t border-[#2a2e36] pt-4"><label className="text-xs font-semibold text-[#b2b8c2]">Dispute reason<textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} className="focus-ring mt-2 min-h-24 w-full rounded-[5px] border border-[#343944] bg-[#090a0c] px-3 py-2 text-xs leading-5 text-white" placeholder="Explain which requirement or evidence is disputed." /></label><Button variant="danger" className="mt-3 w-full" disabled={openingDispute || disputeReason.trim().length < 10} onClick={() => void openDispute()}>{openingDispute ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />} Open dispute and hold funds</Button></div> : <Button variant="danger" className="mt-3 w-full" disabled><ShieldAlert className="size-4" /> Open dispute</Button>}
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
