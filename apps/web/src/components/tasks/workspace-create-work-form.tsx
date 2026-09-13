"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { humanize } from "@/lib/format";
import type { WorkspaceAgent } from "@/server/trust-workspace";

const fieldClass = "focus-ring mt-2 h-10 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 text-sm text-white placeholder:text-[#555d68]";
const labelClass = "block text-xs font-semibold text-[#b2b8c2]";
const splitLines = (value: string) => [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
const splitComma = (value: string) => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];

export function WorkspaceCreateWorkForm({ agents, preferredAgentId }: { agents: WorkspaceAgent[]; preferredAgentId?: string | undefined }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [requestDescription, setRequestDescription] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [repositoryReference, setRepositoryReference] = useState("");
  const [targetBranch, setTargetBranch] = useState("main");
  const [taskType, setTaskType] = useState("FEATURE_COMPLETION");
  const [agentId, setAgentId] = useState(preferredAgentId && agents.some((agent) => agent.id === preferredAgentId) ? preferredAgentId : agents[0]?.id ?? "");
  const [acceptance, setAcceptance] = useState("Required tests pass\nThe requested behavior matches this Contract");
  const [allowedPaths, setAllowedPaths] = useState("src/**");
  const [deliveryPolicy, setDeliveryPolicy] = useState("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED");
  const [securitySensitivity, setSecuritySensitivity] = useState("STANDARD");
  const [allowCodeChanges, setAllowCodeChanges] = useState(true);
  const [allowPullRequest, setAllowPullRequest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, requestDescription, desiredOutcome, repositoryReference, targetBranch,
          taskType, agentId,
          acceptanceRequirements: splitLines(acceptance),
          allowedPaths: splitComma(allowedPaths),
          deliveryOutcomePolicy: deliveryPolicy,
          securitySensitivity, allowCodeChanges, allowPullRequest,
        }),
      });
      const body = await response.json() as { taskId?: string; error?: string };
      if (!response.ok || !body.taskId) throw new Error(body.error ?? "Unable to create Work.");
      router.push(`/tasks/${body.taskId}?tab=contract`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create Work.");
      setBusy(false);
    }
  }

  if (!agents.length) return <Panel><PanelHeader title="An Agent is required" /><div className="p-5 text-sm text-[#969da8]">Create a private Agent before defining Work.</div></Panel>;
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <Panel>
        <PanelHeader title="Work request" description="Human-readable scope" />
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <label className={labelClass}>Title<input value={title} onChange={(event) => setTitle(event.target.value)} className={fieldClass} required minLength={3} maxLength={180} /></label>
          <label className={labelClass}>Work type<select value={taskType} onChange={(event) => setTaskType(event.target.value)} className={fieldClass}>{["DIAGNOSE_REPOSITORY", "BUILD_RESCUE", "TEST_AND_FIX", "FEATURE_COMPLETION", "PULL_REQUEST_VERIFICATION", "LAUNCH_READINESS"].map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
          <label className={`${labelClass} lg:col-span-2`}>Request<textarea value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} className="focus-ring mt-2 min-h-28 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 py-2 text-sm leading-6 text-white" required minLength={10} /></label>
          <label className={`${labelClass} lg:col-span-2`}>Desired outcome<textarea value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.target.value)} className="focus-ring mt-2 min-h-24 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 py-2 text-sm leading-6 text-white" required minLength={3} /></label>
          <label className={labelClass}>Repository or resource reference<input value={repositoryReference} onChange={(event) => setRepositoryReference(event.target.value)} className={fieldClass} placeholder="https://github.com/org/repository" required /></label>
          <label className={labelClass}>Target branch or reference<input value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} className={fieldClass} required /></label>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Agent" description="Identity selected for this Contract" />
        <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">{agents.map((agent) => <label key={agent.id} className={`flex cursor-pointer items-start gap-3 rounded-[5px] border p-3 ${agentId === agent.id ? "border-[#2f81f7] bg-[#10233e]" : "border-[#343944] bg-[#0d0f13]"}`}><input type="radio" name="agent" value={agent.id} checked={agentId === agent.id} onChange={() => setAgentId(agent.id)} className="mt-1 size-4 accent-[#2f81f7]" /><span><span className="block text-sm font-semibold text-white">{agent.name}</span><span className="mt-1 block text-xs leading-5 text-[#969da8]">Identity revision {agent.identity.revision} - {humanize(agent.verificationStatus)}</span></span></label>)}</div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel><PanelHeader title="Acceptance requirements" description="One required Contract assertion per line" /><div className="p-5"><label className={labelClass}>What must be true<textarea value={acceptance} onChange={(event) => setAcceptance(event.target.value)} className="focus-ring mt-2 min-h-36 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 py-2 text-sm leading-6 text-white" required /></label><p className="mt-3 text-xs leading-5 text-[#969da8]">Each statement is locked into the Contract and must be checked by a DoneLayer-controlled independent verifier.</p></div></Panel>
        <Panel><PanelHeader title="Authority ceiling" description="Reviewed after Contract creation" /><div className="space-y-4 p-5"><label className={labelClass}>Allowed repository paths<input value={allowedPaths} onChange={(event) => setAllowedPaths(event.target.value)} className={fieldClass} required /></label><label className="flex items-center gap-3 text-sm text-[#b2b8c2]"><input type="checkbox" checked={allowCodeChanges} onChange={(event) => { setAllowCodeChanges(event.target.checked); if (!event.target.checked) setAllowPullRequest(false); }} className="size-4 accent-[#2f81f7]" /> Allow changes only within these paths</label><label className="flex items-center gap-3 text-sm text-[#b2b8c2]"><input type="checkbox" checked={allowPullRequest} onChange={(event) => setAllowPullRequest(event.target.checked)} disabled={!allowCodeChanges} className="size-4 accent-[#2f81f7]" /> Allow Pull Request creation after separate approval</label><p className="text-xs leading-5 text-[#969da8]">Merge, deployment, payment, blockchain writes, platform credentials, and unlisted resources remain denied.</p></div></Panel>
      </div>

      <Panel><PanelHeader title="Delivery policy" description="Locked before execution" /><div className="grid gap-4 p-5 md:grid-cols-2"><label className={labelClass}>Outcome policy<select value={deliveryPolicy} onChange={(event) => setDeliveryPolicy(event.target.value)} className={fieldClass}><option value="EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED">Execution and independent acceptance required</option><option value="INDEPENDENT_ACCEPTANCE_SUFFICIENT">Independent acceptance may be sufficient</option></select></label><label className={labelClass}>Security sensitivity<select value={securitySensitivity} onChange={(event) => setSecuritySensitivity(event.target.value)} className={fieldClass}><option value="LOW">Low</option><option value="STANDARD">Standard</option><option value="HIGH">High</option></select></label><div className="md:col-span-2 flex items-start gap-3 border-t border-[#2a2e36] pt-4 text-xs leading-5 text-[#969da8]"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#8fc2ff]" /> The Contract will be locked immediately. Authority remains pending until you review and approve the exact allowed and denied scope on the Work page.</div></div></Panel>
      {error ? <div role="alert" className="rounded-[5px] border border-[#6d2f2f] bg-[#211113] px-4 py-3 text-sm text-[#ff8e88]">{error}</div> : null}
      <div className="flex justify-end"><Button type="submit" disabled={busy || !agentId}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />} Create and lock Contract</Button></div>
    </form>
  );
}
