"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import type { PublicJobReceipt } from "@donelayer/database";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/format";

function HashValue({ children }: { children: string }) {
  return <span className="mono block break-all text-xs leading-5 text-[#b2b8c2]">{children}</span>;
}

function resultTone(result: PublicJobReceipt["result"]): string {
  if (["VERIFIED", "VERIFIED_DELIVERY", "CONTRACT_VERIFIED", "CONTRACT_VERIFIED_DELIVERY"].includes(result)) return "border-[#285c34] bg-[#122418] text-[#72d981]";
  if (["PARTIALLY_VERIFIED", "UNVERIFIED", "SPEC_TEST_CONFLICT", "TEST_ORACLE_SUSPECT", "ACCEPTANCE_CRITERIA_CONFLICT", "ENGINEERING_REVIEW_REQUIRED", "SUPERSEDED", "INVALIDATED_FOR_SEMANTIC_SUCCESS"].includes(result)) return "border-[#6b5520] bg-[#2a2110] text-[#e3b341]";
  return "border-[#6e2d2b] bg-[#2b1718] text-[#ff8e88]";
}

function SemanticDimension({ label, value }: { label: string; value: string }) {
  const positive = ["VALID", "PASSED", "VERIFIED", "VERIFIED_DELIVERY", "COMPLETED", "ELIGIBLE"].includes(value);
  const pending = ["NOT_RUN", "REVIEW_REQUIRED", "CONFLICT", "ENGINEERING_REVIEW_REQUIRED", "SUPERSEDED", "INCONCLUSIVE", "NO_DELIVERABLE", "NOT_ELIGIBLE", "BLOCKED"].includes(value);
  const Icon = positive ? CheckCircle2 : pending ? ShieldAlert : XCircle;
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 px-5 py-3">
      <dt className="text-xs font-semibold text-[#969da8]">{label}</dt>
      <dd className={cn("flex min-w-0 items-center gap-2 text-right text-xs font-semibold", positive ? "text-[#72d981]" : pending ? "text-[#e3b341]" : "text-[#ff8e88]")}>
        <Icon className="size-4 shrink-0" />
        <span className="break-words">{humanize(value)}</span>
      </dd>
    </div>
  );
}

function commandTone(status: NonNullable<PublicJobReceipt["buildTest"]>["install"]["status"]): string {
  if (status === "PASSED") return "text-[#72d981]";
  if (status === "NOT_PRESENT" || status === "UNPARSABLE") return "text-[#e3b341]";
  return "text-[#ff8e88]";
}

function formatTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

function CommandSummary({
  label,
  summary,
}: {
  label: string;
  summary: NonNullable<PublicJobReceipt["buildTest"]>["install"];
}) {
  return (
    <div className="grid gap-2 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5">
      <dt className="text-xs font-semibold text-[#969da8]">{label}</dt>
      <dd className="min-w-0 text-xs leading-5 text-[#b2b8c2]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn("font-semibold", commandTone(summary.status))}>{humanize(summary.status)}</span>
          <span>Exit {summary.exitCode ?? "not reported"}</span>
          <span>{summary.durationMs} ms</span>
        </div>
        <div className="mono mt-1 break-all text-[#d4d8df]">{summary.command}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] font-semibold uppercase text-[#666e7a]">stdout artifact</div>
            <div className="mt-1 break-all">{summary.stdoutArtifact.fileName}</div>
            <HashValue>{summary.stdoutArtifact.sha256}</HashValue>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-[#666e7a]">stderr artifact</div>
            <div className="mt-1 break-all">{summary.stderrArtifact.fileName}</div>
            <HashValue>{summary.stderrArtifact.sha256}</HashValue>
          </div>
        </div>
      </dd>
    </div>
  );
}

export function PublicReceiptClient({ initial }: { initial: PublicJobReceipt }) {
  const [receipt, setReceipt] = useState(initial);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setVerifying(true);
    setError(null);
    try {
      const response = await fetch(`/api/receipts/${encodeURIComponent(receipt.publicReceiptId)}/verify`, {
        cache: "no-store"
      });
      const body = (await response.json()) as PublicJobReceipt & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Receipt verification failed.");
      setReceipt(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Receipt verification failed.");
    } finally {
      setVerifying(false);
    }
  }

  const integrityValid = receipt.verificationStatus === "VALID";
  const active = integrityValid && !receipt.invalidated && !receipt.disputed;
  const VerificationIcon = active ? CheckCircle2 : XCircle;
  const statusLabel = receipt.invalidated
    ? "Receipt is invalidated"
    : receipt.disputed
      ? "Receipt is disputed"
      : integrityValid
        ? "Receipt integrity is valid"
        : "Receipt integrity is invalid";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <div className={cn("mb-6 flex items-start gap-3 rounded-[6px] border px-4 py-4", active ? "border-[#285c34] bg-[#122418]" : "border-[#6e2d2b] bg-[#2b1718]") }>
        <VerificationIcon className={cn("mt-0.5 size-5 shrink-0", active ? "text-[#72d981]" : "text-[#ff8e88]")} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase text-[#969da8]">Receipt integrity</div>
          <div className={cn("mt-1 text-sm font-semibold", active ? "text-[#72d981]" : "text-[#ff8e88]")}>{statusLabel}</div>
          <p className="mt-1 text-xs leading-5 text-[#b2b8c2]">
            {receipt.invalidated
              ? "This receipt has been invalidated."
              : receipt.disputed
                ? "This receipt is disputed."
                : integrityValid
                  ? "The receipt hash anchor and Evidence Ledger chain verify successfully."
                  : "The receipt hash anchor or Evidence Ledger chain could not be verified."}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void verify()} disabled={verifying}>
          {verifying ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Verify
        </Button>
      </div>

      {error ? <div className="mb-5 flex items-center gap-2 text-xs text-[#ff8e88]"><ShieldAlert className="size-4" />{error}</div> : null}

      <section className="overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318]" aria-labelledby="receipt-heading">
        <div className="border-b border-[#2a2e36] px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase text-[#666e7a]">DoneLayer Receipt</p>
              <h1 id="receipt-heading" className="mt-2 text-xl font-semibold text-white">{receipt.taskType}</h1>
            </div>
            <div className="text-right">
              <div className="mb-1 text-[10px] font-semibold uppercase text-[#666e7a]">Task result</div>
              <span className={cn("inline-flex rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold", resultTone(receipt.result))}>{humanize(receipt.result)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#969da8]">Hash-verifiable DoneLayer execution receipt.</p>
        </div>

        <dl className="divide-y divide-[#242831]">
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Public Receipt ID</dt><dd><HashValue>{receipt.publicReceiptId}</HashValue></dd></div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Agent / Worker</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.agentIdentity} / {receipt.workerIdentity}</dd></div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Contract Hash</dt><dd><HashValue>{receipt.contractSha256}</HashValue></dd></div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Evidence Chain Hash</dt><dd><HashValue>{receipt.evidenceChainSha256}</HashValue></dd></div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Artifact Hash</dt><dd><HashValue>{receipt.artifactSha256}</HashValue></dd></div>
          {receipt.semanticVerification ? <>
            <div className="bg-[#15181e] px-5 py-3 text-[10px] font-semibold uppercase text-[#666e7a]">Independent verification dimensions</div>
            <SemanticDimension label="Execution" value={receipt.semanticVerification.executionIntegrity} />
            <SemanticDimension label="Tests" value={receipt.semanticVerification.testConformity} />
            <SemanticDimension label="Task Contract" value={receipt.semanticVerification.contractConformity} />
            <SemanticDimension label="Delivery" value={receipt.semanticVerification.deliveryIntegrity} />
            <SemanticDimension label="Overall" value={receipt.semanticVerification.overall} />
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Contract assertions</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.semanticVerification.contractAssertionPassedCount} passed · {receipt.semanticVerification.contractAssertionFailedCount} failed<span className="mt-1 block text-[#969da8]">Repository expectations {receipt.semanticVerification.repositoryTestExpectationCount} · Agent calls {receipt.semanticVerification.agentCallCount} · payout {receipt.semanticVerification.payoutReleased ? "released" : "not released"}</span></dd></div>
          </> : null}
          {receipt.verifiedDeliveryOutcomes ? <>
            <div className="bg-[#15181e] px-5 py-3 text-[10px] font-semibold uppercase text-[#666e7a]">Verified delivery outcomes</div>
            <SemanticDimension label="Agent execution" value={receipt.verifiedDeliveryOutcomes.executionOutcome} />
            <SemanticDimension label="Independent work verification" value={receipt.verifiedDeliveryOutcomes.independentVerificationOutcome} />
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Delivery policy</dt><dd className="break-words text-xs font-semibold leading-5 text-[#b2b8c2]">{humanize(receipt.verifiedDeliveryOutcomes.deliveryOutcomePolicy)}</dd></div>
            <SemanticDimension label="Contract delivery" value={receipt.verifiedDeliveryOutcomes.deliveryOutcome} />
            <SemanticDimension label="Candidate eligibility" value={receipt.verifiedDeliveryOutcomes.candidateEligible ? "ELIGIBLE" : "NOT_ELIGIBLE"} />
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Failure attribution</dt><dd className="break-words text-xs font-semibold leading-5 text-[#b2b8c2]">{humanize(receipt.verifiedDeliveryOutcomes.executionFailureAttribution)}</dd></div>
          </> : null}
          {receipt.repository ? <>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Repository</dt><dd className="break-all text-xs leading-5 text-[#b2b8c2]">{receipt.repository.remoteUrl}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Branch</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.repository.branch}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Worker Commit</dt><dd><HashValue>{receipt.repository.workerCommitSha}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Remote Commit</dt><dd><HashValue>{receipt.repository.independentRemoteCommitSha}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Manifest</dt><dd><HashValue>{receipt.repository.manifestSha256}</HashValue><span className="mt-1 block text-xs text-[#666e7a]">{receipt.repository.fileCount} files</span></dd></div>
          </> : null}
          {receipt.managedSandbox ? <>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Execution backend</dt><dd className="text-xs leading-5 text-[#b2b8c2]">Managed remote sandbox · {receipt.managedSandbox.provider}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Sandbox identity</dt><dd><HashValue>{receipt.managedSandbox.sandboxIdentity}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Isolation / lifecycle</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{humanize(receipt.managedSandbox.isolationModel)} · {humanize(receipt.managedSandbox.lifecycleMode)}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Runtime / region</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.managedSandbox.runtime} · {receipt.managedSandbox.region ?? "Provider not reported"}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Network policy</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.managedSandbox.networkPolicy} · external probe {receipt.managedSandbox.networkProbeBlocked === null ? "not run" : receipt.managedSandbox.networkProbeBlocked ? "blocked" : "not blocked"}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Cleanup</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.managedSandbox.cleanupVerified ? "Provider lifecycle cleanup verified" : "Unverified"} · snapshot {receipt.managedSandbox.persistentSnapshotCreated ? "created" : "not created"}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Host execution</dt><dd className="text-xs leading-5 text-[#b2b8c2]">Local host {receipt.managedSandbox.localHostExecutionUsed ? "used" : "not used"} · local Docker {receipt.managedSandbox.localDockerUsed ? "used" : "not used"}</dd></div>
          </> : null}
          {receipt.buildTest ? <>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Source manifest</dt><dd><HashValue>{receipt.buildTest.sourceManifestSha256}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Source package</dt><dd><HashValue>{receipt.buildTest.sourcePackageSha256}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Node / npm</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.buildTest.nodeVersion} / {receipt.buildTest.npmVersion}</dd></div>
            <CommandSummary label="Dependency install" summary={receipt.buildTest.install} />
            <CommandSummary label="Build" summary={receipt.buildTest.build} />
            <CommandSummary label="Tests" summary={receipt.buildTest.test} />
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5">
              <dt className="text-xs font-semibold text-[#969da8]">Test statistics</dt>
              <dd className="text-xs leading-5 text-[#b2b8c2]">
                <div>{receipt.buildTest.testRunner ?? "Test runner not reliably identified"}</div>
                <div className="mt-1 text-[#969da8]">
                  {receipt.buildTest.statisticsStatus === "PARSED" && receipt.buildTest.totalTests !== null && receipt.buildTest.passedTests !== null && receipt.buildTest.failedTests !== null
                    ? `${receipt.buildTest.totalTests} total · ${receipt.buildTest.passedTests} passed · ${receipt.buildTest.failedTests} failed`
                    : "Test counts were not reliably parseable."}
                </div>
              </dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Source integrity</dt><dd className={cn("text-xs font-semibold", receipt.buildTest.sourceMutationDetected ? "text-[#ff8e88]" : "text-[#72d981]")}>{receipt.buildTest.sourceMutationDetected ? "Source mutation detected" : "Source files unchanged"}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Policy violations</dt><dd className="text-xs leading-5 text-[#b2b8c2]">Network {receipt.buildTest.networkViolationCount} · Permission {receipt.buildTest.permissionViolationCount}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Provider payout</dt><dd className={cn("text-xs font-semibold", receipt.buildTest.providerPayoutReleased ? "text-[#ff8e88]" : "text-[#72d981]")}>{receipt.buildTest.providerPayoutReleased ? "Released" : "Not released"}</dd></div>
          </> : null}
          {receipt.agentRepair ? <>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Gateway</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.agentRepair.gateway}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Agent provider</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.agentRepair.agentProviderAdapter}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Model provider</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.agentRepair.modelProvider}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Model ID</dt><dd className="break-all text-xs leading-5 text-[#b2b8c2]">{receipt.agentRepair.modelId}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Authentication</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{humanize(receipt.agentRepair.authentication)}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Gateway credit</dt><dd className="text-xs leading-5 text-[#b2b8c2]">${receipt.agentRepair.freeCreditBalanceBefore} before · {receipt.agentRepair.freeCreditUsed === null ? "usage not reported" : `$${receipt.agentRepair.freeCreditUsed} used`} · ${receipt.agentRepair.freeCreditBalanceAfter} after</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Model usage</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.agentRepair.apiRequestCount} requests · {receipt.agentRepair.inputTokens ?? "unreported"} input · {receipt.agentRepair.outputTokens ?? "unreported"} output · {receipt.agentRepair.cachedTokens ?? "unreported"} cached</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Repair tests</dt><dd className="text-xs leading-5 text-[#b2b8c2]">Baseline exit {receipt.agentRepair.baselineTestExitCode} · repaired exit {receipt.agentRepair.repairedTestExitCode ?? "not completed"}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Patch</dt><dd><HashValue>{receipt.agentRepair.patchSha256}</HashValue><span className="mt-1 block text-xs text-[#666e7a]">{receipt.agentRepair.modifiedFiles.join(", ") || "No modified files"} · {receipt.agentRepair.toolCallCount} tool calls</span></dd></div>
          </> : null}
          {receipt.githubDelivery ? <>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Repair</dt><dd className="text-xs font-semibold text-[#72d981]">{receipt.githubDelivery.repairVerified ? "Verified" : "Unverified"}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Delivered to GitHub</dt><dd className="text-xs font-semibold text-[#72d981]">{receipt.githubDelivery.deliveredToGitHub ? "Verified" : "Unverified"}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Independent clean verification</dt><dd className="text-xs font-semibold text-[#72d981]">{humanize(receipt.githubDelivery.independentCleanVerification)}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Delivery branch</dt><dd className="break-all text-xs leading-5 text-[#b2b8c2]">{receipt.githubDelivery.deliveryBranch}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Delivery commit</dt><dd><HashValue>{receipt.githubDelivery.deliveryCommitSha}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Parent commit</dt><dd><HashValue>{receipt.githubDelivery.parentCommitSha}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Delivery diff</dt><dd><HashValue>{receipt.githubDelivery.deliveryDiffSha256}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Git authentication</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{humanize(receipt.githubDelivery.authenticationMode)}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5">
              <dt className="text-xs font-semibold text-[#969da8]">Pull Request</dt>
              <dd className="min-w-0 text-xs leading-5 text-[#b2b8c2]">
                <a className="break-all font-semibold text-[#70a5ff] hover:text-[#9bc0ff]" href={receipt.githubDelivery.pullRequestUrl} target="_blank" rel="noreferrer">#{receipt.githubDelivery.pullRequestNumber}</a>
                <span className="ml-2">{humanize(receipt.githubDelivery.pullRequestState)} · merged {receipt.githubDelivery.merged ? "Yes" : "No"}</span>
              </dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Verifier</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{humanize(receipt.githubDelivery.verifierType)}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Verification Sandbox</dt><dd><HashValue>{receipt.githubDelivery.verificationSandboxId}</HashValue></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Clean test results</dt><dd className="text-xs leading-5 text-[#b2b8c2]">Install exit {receipt.githubDelivery.installExitCode} · build {humanize(receipt.githubDelivery.buildStatus)} · test exit {receipt.githubDelivery.testExitCode}<span className="mt-1 block text-[#969da8]">{receipt.githubDelivery.totalTests} total · {receipt.githubDelivery.passedTests} passed · {receipt.githubDelivery.failedTests} failed</span></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Anti-tampering</dt><dd className="text-xs leading-5 text-[#b2b8c2]">Tests {receipt.githubDelivery.testsUnchanged ? "unchanged" : "changed"} · test script {receipt.githubDelivery.testScriptUnchanged ? "unchanged" : "changed"} · policy violations {receipt.githubDelivery.policyViolationCount}</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">AI use in delivery Gate</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.githubDelivery.aiCallCount} calls · ${receipt.githubDelivery.aiGatewayUsageUsd} Gateway usage</dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Payment</dt><dd className="text-xs leading-5 text-[#b2b8c2]">Simulation only · {humanize(receipt.githubDelivery.testLedgerState)}<span className="mt-1 block text-[#969da8]">Provider ${(receipt.githubDelivery.simulatedProviderPayoutCents / 100).toFixed(2)} · platform ${(receipt.githubDelivery.simulatedPlatformFeeCents / 100).toFixed(2)}</span></dd></div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Cleanup</dt><dd className="text-xs font-semibold text-[#72d981]">{receipt.githubDelivery.cleanupVerified ? "Verified" : "Unverified"}</dd></div>
          </> : null}
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Verification</dt><dd className="text-xs leading-5 text-[#b2b8c2]">{receipt.verificationSummary}</dd></div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-xs font-semibold text-[#969da8]">Timestamp</dt><dd className="text-xs text-[#b2b8c2]"><time dateTime={receipt.createdAt}>{formatTimestamp(receipt.createdAt)}</time></dd></div>
        </dl>
      </section>

      <p className="mt-5 text-xs leading-5 text-[#666e7a]">{receipt.scopeDisclaimer}</p>
    </main>
  );
}
