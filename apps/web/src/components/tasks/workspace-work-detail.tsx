"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Download, FileCheck2, LoaderCircle, LockKeyhole, Play, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge, type StatusTone } from "@/components/ui/status";
import { formatDateTime, humanize } from "@/lib/format";
import type { WorkspaceWork } from "@/server/trust-workspace";

type Tab = "summary" | "contract" | "authority" | "evidence" | "receipt";

const tabs: Array<[Tab, string]> = [
  ["summary", "Summary"],
  ["contract", "Contract"],
  ["authority", "Authority"],
  ["evidence", "Evidence"],
  ["receipt", "Receipt"],
];

export function WorkspaceWorkDetail({ work, initialTab = "summary" }: { work: WorkspaceWork; initialTab?: string | undefined }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(
    tabs.some(([value]) => value === initialTab) ? initialTab as Tab : "summary",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approveAuthority() {
    if (!work.contract) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${work.id}/authority`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractVersion: work.contract.version,
          contractSha256: work.contract.sha256,
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to approve Authority.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to approve Authority.");
    } finally {
      setBusy(false);
    }
  }

  async function executeWork() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${work.id}/execute`, { method: "POST" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to execute Work.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to execute Work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="border-b border-[#2a2e36] pb-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#666e7a]">
          <span>{humanize(work.taskType)}</span>
          <StatusBadge label={humanize(work.status)} tone={work.status === "DRAFT" ? "warning" : "neutral"} compact />
        </div>
        <h2 className="mt-3 max-w-4xl text-2xl font-semibold leading-8 text-white">{work.title}</h2>
        <p className="mt-2 text-sm text-[#969da8]">{work.repository} - {work.targetBranch}</p>
      </section>

      <section className="my-5 grid overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#242831] md:grid-cols-3">
        <OutcomeDimension label="Execution" state={work.execution.state} detail={work.execution.detail} />
        <OutcomeDimension label="Independent verification" state={work.verification.state} detail={work.verification.detail} />
        <OutcomeDimension label="Delivery" state={work.delivery.state} detail={work.delivery.detail} />
      </section>

      <div className="mb-5 overflow-x-auto border-b border-[#2a2e36]">
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Work views">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`focus-ring relative h-10 rounded-t-[4px] px-3 text-xs font-semibold ${tab === value ? "text-white after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[#2f81f7]" : "text-[#969da8] hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "summary" ? <Summary work={work} /> : null}
      {tab === "contract" ? <Contract contract={work.contract} /> : null}
      {tab === "authority" ? (
        <Authority
          work={work}
          confirmed={confirmed}
          onConfirm={setConfirmed}
          busy={busy}
          error={error}
          onApprove={() => void approveAuthority()}
          onExecute={() => void executeWork()}
        />
      ) : null}
      {tab === "evidence" ? <Evidence work={work} /> : null}
      {tab === "receipt" ? <Receipt work={work} /> : null}
    </div>
  );
}

function OutcomeDimension({ label, state, detail }: { label: string; state: string; detail: string }) {
  return (
    <div className="min-w-0 bg-[#111318] p-4 md:min-h-32">
      <div className="text-[11px] font-semibold uppercase text-[#666e7a]">{label}</div>
      <div className="mt-3"><StatusBadge label={humanize(state)} tone={tone(state)} /></div>
      <p className="mt-3 text-xs leading-5 text-[#969da8]">{detail}</p>
    </div>
  );
}

function Summary({ work }: { work: WorkspaceWork }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel>
        <PanelHeader title="Work request" description="Locked user intent" />
        <div className="grid gap-px bg-[#242831] md:grid-cols-2">
          <Section title="Request" text={work.requestDescription} />
          <Section title="Desired outcome" text={work.desiredOutcome} />
        </div>
      </Panel>
      <div className="space-y-5">
        <Panel>
          <PanelHeader title="Selected Agent" />
          {work.agent ? (
            <div className="p-4">
              <Link href={`/agents/${work.agent.slug}`} className="focus-ring text-sm font-semibold text-white hover:text-[#8fc2ff]">{work.agent.name}</Link>
              <p className="mt-2 text-xs text-[#969da8]">Identity revision {work.agent.identity.revision} - {humanize(work.agent.verificationStatus)}</p>
            </div>
          ) : <div className="p-4 text-sm text-[#ff8e88]">The selected Agent is unavailable.</div>}
        </Panel>
        <Panel>
          <PanelHeader title="Authority state" />
          <div className="p-4 text-sm leading-6 text-[#b2b8c2]">
            {work.authority
              ? "Scope approved. No Permission Lease has been issued."
              : "Pending your review. No execution is authorized."}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Contract({ contract }: { contract: WorkspaceWork["contract"] }) {
  if (!contract) return <Empty title="No Contract" text="This Work has no durable Contract and cannot execute." />;
  return (
    <div className="max-w-5xl space-y-5">
      <Panel>
        <PanelHeader title={`Locked Contract v${contract.version}`} description={`Locked ${formatDateTime(contract.lockedAt)}`} />
        <div className="grid gap-px bg-[#242831] md:grid-cols-2">
          <Section title="Desired outcome" text={contract.desiredOutcome} />
          <Section title="Delivery policy" text={humanize(contract.deliveryOutcomePolicy)} />
        </div>
        <ListSection title="Acceptance criteria" values={contract.acceptanceChecks.map((check) => check.label)} icon="check" />
        <ListSection title="Required Evidence" values={contract.requiredEvidence.map(humanize)} />
      </Panel>
      <Panel>
        <PanelHeader title="Lock state" />
        <div className="p-4 text-sm leading-6 text-[#b2b8c2]">
          <LockKeyhole className="mr-2 inline size-4 text-[#8fc2ff]" />
          The request, source reference, Agent identity revision, acceptance criteria, Authority ceiling, and delivery policy are immutable for this version.
          <details className="mt-4 text-xs text-[#969da8]">
            <summary className="cursor-pointer font-semibold text-[#b2b8c2]">Advanced integrity reference</summary>
            <code className="mt-3 block break-all">{contract.sha256}</code>
          </details>
        </div>
      </Panel>
    </div>
  );
}

function Authority({
  work,
  confirmed,
  onConfirm,
  busy,
  error,
  onApprove,
  onExecute,
}: {
  work: WorkspaceWork;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onExecute: () => void;
}) {
  const contract = work.contract;
  if (!contract) return <Empty title="Authority unavailable" text="A locked Contract is required before Authority can be reviewed." />;
  const authority = work.authority;
  const allowed = authority?.allowedActions ?? contract.allowedActions;
  const denied = authority?.deniedActions ?? contract.forbiddenActions;
  const paths = authority?.allowedPaths ?? contract.allowedPaths;
  return (
    <div className="max-w-5xl space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Panel>
          <PanelHeader title="Allowed" description="Maximum scope" />
          <ListSection values={[...allowed.map(humanize), ...paths.map((path) => `Path: ${path}`)]} icon="check" />
        </Panel>
        <Panel>
          <PanelHeader title="Denied" description="Always outside scope" />
          <ListSection values={denied.map(humanize)} icon="denied" />
        </Panel>
      </div>
      <Panel>
        <PanelHeader
          title={authority ? "Authority approved" : "Approve task-scoped Authority"}
          description={authority ? formatDateTime(authority.decidedAt) : "Required before execution"}
        />
        <div className="p-5">
          {authority ? (
            <div className="space-y-3 text-sm leading-6 text-[#b2b8c2]">
              <p><ShieldCheck className="mr-2 inline size-4 text-[#72d981]" />This bounded ceiling is approved and immutable.</p>
              <p className="rounded-[5px] border border-[#5b4b25] bg-[#1d190f] px-3 py-2 text-xs text-[#e3b341]">
                {work.execution.state === "NOT_STARTED"
                  ? "Permission Lease: not issued. Source commit: not resolved. Agent execution: not started."
                  : `Execution: ${humanize(work.execution.state)}. Permission Lease and exact Source are recorded in Evidence.`}
              </p>
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                <Fact label="Repository" value={authority.repository} />
                <Fact label="Branch" value={authority.branch} />
                <Fact label="Runtime limit" value={`${authority.maxRuntimeSeconds} seconds`} />
                <Fact label="Network" value={authority.networkPolicy} />
                <Fact label="Sandbox" value={`${authority.sandboxProvider} / ${authority.executionBackend}`} />
                <Fact label="Persistence" value={authority.persistence} />
              </dl>
              {error ? <div role="alert" className="text-sm text-[#ff8e88]">{error}</div> : null}
              {work.status === "PUBLISHED" && work.execution.state === "NOT_STARTED" ? (
                <Button disabled={busy} onClick={onExecute}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Run bounded Work
                </Button>
              ) : null}
            </div>
          ) : (
            <div>
              <p className="text-sm leading-6 text-[#b2b8c2]">Approval permits a future DoneLayer Server to issue a still-narrower Permission Lease only within the displayed scope. It does not start execution.</p>
              <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-white">
                <input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} className="mt-1 size-4 accent-[#2f81f7]" />
                I reviewed what this Agent may and may not do.
              </label>
              {error ? <div role="alert" className="mt-4 text-sm text-[#ff8e88]">{error}</div> : null}
              <Button className="mt-5" disabled={!confirmed || busy} onClick={onApprove}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Approve Authority
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Evidence({ work }: { work: WorkspaceWork }) {
  return (
    <div className="max-w-5xl">
      <Panel>
        <PanelHeader title="Evidence" description="Human-readable provenance" />
        <div className="divide-y divide-[#242831]">
          {work.evidence.map((item) => (
            <div key={`${item.label}-${item.value}`} className="flex items-start gap-3 px-4 py-4">
              <span className={`mt-1 size-2 shrink-0 rounded-full ${item.tone === "success" ? "bg-[#3fb950]" : item.tone === "danger" ? "bg-[#f85149]" : item.tone === "warning" ? "bg-[#d29922]" : "bg-[#2f81f7]"}`} />
              <div>
                <h3 className="text-xs font-semibold text-white">{item.label}</h3>
                <p className="mt-1 text-sm leading-6 text-[#969da8]">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Receipt({ work }: { work: WorkspaceWork }) {
  const receipt = work.receipt;
  if (!receipt) {
    return <Empty title="No Receipt issued" text="A Verified Work Receipt appears only after real execution, independent verification, and a recorded delivery outcome. This Work has not reached that lifecycle." />;
  }
  if (receipt.integrity === "INVALID") {
    return <div className="max-w-4xl"><Panel><PanelHeader title="Receipt integrity failed" description="Not presented as valid" /><div className="p-5 text-sm leading-6 text-[#ff8e88]">The stored Receipt or Evidence chain did not pass integrity checks. Its delivery claim is withheld.</div></Panel></div>;
  }
  const qualifying = receipt.historyStatus === "VERIFIED_WORK";
  return (
    <div className="max-w-4xl">
      <Panel>
        <PanelHeader title={qualifying ? "Verified Work Receipt" : "Valid non-qualifying Receipt"} description={formatDateTime(receipt.createdAt)} />
        <div className="grid gap-px bg-[#242831] sm:grid-cols-2">
          <Section title="Agent" text={receipt.agentLabel} />
          <Section title="Outcome" text={humanize(receipt.result)} />
          <Section title="Verifier" text={receipt.verifierLabel} />
          <Section title="Integrity" text={qualifying ? "Valid verified-work history" : "Valid Receipt; excluded from verified-work history"} />
        </div>
        <div className="flex flex-wrap gap-2 border-t border-[#2a2e36] p-4">
          <a href={`/api/workspace/receipts/${receipt.id}/download`} className="focus-ring inline-flex h-9 items-center gap-2 rounded-[5px] bg-[#2f81f7] px-3 text-xs font-semibold text-white hover:bg-[#1f6feb]">
            <Download className="size-4" /> Download Receipt
          </a>
        </div>
      </Panel>
    </div>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  return <div className="bg-[#111318] p-4"><h3 className="text-xs font-semibold text-white">{title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#969da8]">{text}</p></div>;
}

function ListSection({ title, values, icon }: { title?: string; values: string[]; icon?: "check" | "denied" }) {
  return (
    <div className="border-t border-[#242831] p-4">
      {title ? <h3 className="text-xs font-semibold text-white">{title}</h3> : null}
      <ul className={`${title ? "mt-3" : ""} space-y-2`}>
        {values.map((value) => (
          <li key={value} className="flex items-start gap-2 text-sm leading-5 text-[#b2b8c2]">
            {icon === "denied"
              ? <span className="mt-1 text-[#ff8e88]">x</span>
              : <Check className="mt-0.5 size-4 shrink-0 text-[#72d981]" />}
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[#666e7a]">{label}</dt><dd className="mt-1 break-words text-white">{humanize(value)}</dd></div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="flex min-h-64 max-w-4xl flex-col items-center justify-center border border-dashed border-[#343944] px-5 text-center"><FileCheck2 className="size-6 text-[#666e7a]" /><h2 className="mt-4 text-sm font-semibold text-white">{title}</h2><p className="mt-2 max-w-lg text-sm leading-6 text-[#969da8]">{text}</p></div>;
}

function tone(state: string): StatusTone {
  if (["SUCCEEDED", "PASSED", "VERIFIED", "VERIFIED_DELIVERY", "VALID"].includes(state)) return "success";
  if (["FAILED", "ERROR", "INVALID_RECEIPT", "INVALID_EVIDENCE"].includes(state)) return "danger";
  if (["RUNNING", "VERIFYING", "QUEUED", "PUBLISHED"].includes(state)) return "warning";
  return "neutral";
}
