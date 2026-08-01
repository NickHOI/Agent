"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CircleDollarSign,
  FileCheck2,
  GitBranch as Github,
  LoaderCircle,
  LockKeyhole,
  SearchCheck,
  ShieldCheck,
  Wrench
} from "lucide-react";
import type { AgentRecord } from "@donelayer/database";
import type { AcceptanceCheck, CreateTaskInput, TaskAnalysis } from "@donelayer/shared";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { formatCurrency, humanize } from "@/lib/format";
import { cn } from "@/lib/cn";

interface FormFields {
  title: string;
  problemDescription: string;
  desiredOutcome: string;
  repository: string;
  targetBranch: string;
  taskType: CreateTaskInput["taskType"];
  requiredSkills: string;
  requiredOperatingSystem: "ANY" | "WINDOWS" | "MACOS" | "LINUX";
  requiredTools: string;
  budgetDollars: number;
  deadline: string;
  acceptanceCriteria: string;
  securitySensitivity: "LOW" | "MEDIUM" | "HIGH";
  allowCodeChanges: boolean;
  allowPullRequest: boolean;
  requiresHumanApproval: boolean;
  matchingMode: "AUTO" | "PREFERRED";
  preferredAgentId: string;
}

const steps = [
  { title: "Scope", icon: Github },
  { title: "Requirements", icon: Wrench },
  { title: "Guardrails", icon: LockKeyhole },
  { title: "Analyze", icon: SearchCheck }
];

function values(input: string): string[] {
  return [...new Set(input.split(",").map((value) => value.trim()).filter(Boolean))];
}

function buildChecks(fields: FormFields): AcceptanceCheck[] {
  const checks: AcceptanceCheck[] = [
    { id: "command-test", type: "COMMAND_EXIT", title: "Approved test workflow exits with code 0", required: true, commandId: "NPM_TEST", allowedExitCodes: [0] },
    { id: "tests-pass", type: "TEST", title: fields.acceptanceCriteria || "Required tests pass", required: true, minimumTotal: 1, minimumPassed: 1, maximumFailed: 0 },
    { id: "build-pass", type: "BUILD", title: "Production build succeeds", required: true, commandId: "NPM_BUILD" }
  ];
  if (fields.allowCodeChanges) checks.push({ id: "diff-present", type: "DIFF", title: "A scoped code diff is present", required: true, minimumChangedFiles: 1, requireNonEmptyPatch: true });
  if (fields.allowPullRequest) checks.push({ id: "pull-request", type: "PULL_REQUEST", title: "Pull request is created", required: false, targetBranch: fields.targetBranch, allowedStates: ["OPEN", "MERGED"] });
  if (fields.requiresHumanApproval) checks.push({ id: "human-approval", type: "HUMAN_APPROVAL", title: "Customer approves the evidence pack", required: true, approverKind: "CUSTOMER", allowAdminOverride: true });
  return checks;
}

function toInput(fields: FormFields): CreateTaskInput {
  return {
    title: fields.title.trim(),
    problemDescription: fields.problemDescription.trim(),
    desiredOutcome: fields.desiredOutcome.trim(),
    repository: fields.repository.trim(),
    targetBranch: fields.targetBranch.trim(),
    taskType: fields.taskType,
    requiredSkills: values(fields.requiredSkills),
    requiredOperatingSystem: fields.requiredOperatingSystem,
    requiredTools: values(fields.requiredTools),
    requiredMcpTools: [],
    budgetCents: Math.round(fields.budgetDollars * 100),
    deadline: new Date(`${fields.deadline}T23:59:00.000Z`).toISOString(),
    acceptanceChecks: buildChecks(fields),
    securitySensitivity: fields.securitySensitivity,
    allowCodeChanges: fields.allowCodeChanges,
    allowPullRequest: fields.allowPullRequest,
    requiresHumanApproval: fields.requiresHumanApproval,
    preferredAgentId: fields.matchingMode === "PREFERRED" && fields.preferredAgentId ? fields.preferredAgentId : null
  };
}

const inputClass = "focus-ring mt-2 h-10 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 text-sm text-white placeholder:text-[#555d68]";
const textareaClass = "focus-ring mt-2 min-h-28 w-full resize-y rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 py-2.5 text-sm leading-6 text-white placeholder:text-[#555d68]";
const labelClass = "block text-xs font-semibold text-[#b2b8c2]";

export function CreateTaskWizard({ agents, preferredAgentId }: { agents: AgentRecord[]; preferredAgentId?: string | undefined }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<TaskAnalysis | null>(null);
  const [busy, setBusy] = useState<"ANALYZE" | "CREATE" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const defaultDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { register, watch, trigger, getValues, formState: { errors } } = useForm<FormFields>({
    defaultValues: {
      title: "",
      problemDescription: "",
      desiredOutcome: "",
      repository: "demo://sample-org/react-auth",
      targetBranch: "main",
      taskType: "TEST_AND_FIX",
      requiredSkills: "React, TypeScript",
      requiredOperatingSystem: "ANY",
      requiredTools: "Git, Node.js, npm",
      budgetDollars: 240,
      deadline: defaultDeadline,
      acceptanceCriteria: "All authentication tests pass with zero failures.",
      securitySensitivity: "MEDIUM",
      allowCodeChanges: true,
      allowPullRequest: true,
      requiresHumanApproval: true,
      matchingMode: preferredAgentId ? "PREFERRED" : "AUTO",
      preferredAgentId: preferredAgentId ?? ""
    }
  });
  const matchingMode = watch("matchingMode");

  async function next() {
    const fieldsByStep: Array<Array<keyof FormFields>> = [
      ["title", "problemDescription", "desiredOutcome", "repository", "targetBranch", "taskType"],
      ["requiredSkills", "requiredOperatingSystem", "requiredTools", "budgetDollars", "deadline", "matchingMode"],
      ["acceptanceCriteria", "securitySensitivity", "allowCodeChanges", "allowPullRequest", "requiresHumanApproval"],
      []
    ];
    const valid = await trigger(fieldsByStep[step]);
    if (valid) setStep((value) => Math.min(3, value + 1));
  }

  async function analyze() {
    setBusy("ANALYZE");
    setServerError(null);
    try {
      const response = await fetch("/api/tasks/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toInput(getValues())) });
      const body = (await response.json()) as TaskAnalysis & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Task analysis failed.");
      setAnalysis(body);
    } catch (caught) {
      setServerError(caught instanceof Error ? caught.message : "Task analysis failed.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!analysis) return;
    setBusy("CREATE");
    setServerError(null);
    try {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toInput(getValues())) });
      const body = (await response.json()) as { taskId?: string; error?: string };
      if (!response.ok || !body.taskId) throw new Error(body.error ?? "Task creation failed.");
      router.push(`/tasks/${body.taskId}`);
    } catch (caught) {
      setServerError(caught instanceof Error ? caught.message : "Task creation failed.");
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
      <nav className="space-y-1 xl:sticky xl:top-24 xl:self-start" aria-label="Task creation steps">
        {steps.map((item, index) => {
          const Icon = item.icon;
          return (
            <button key={item.title} type="button" onClick={() => index < step && setStep(index)} className={cn("focus-ring flex h-11 w-full items-center gap-3 rounded-[5px] px-3 text-left text-sm font-semibold", step === index ? "bg-[#1b2b43] text-[#8fc2ff]" : index < step ? "text-[#b2b8c2] hover:bg-[#171a20]" : "cursor-default text-[#555d68]")}>
              <span className={cn("flex size-6 items-center justify-center rounded-[4px] border", index < step ? "border-[#295b34] bg-[#102718] text-[#72d981]" : "border-[#343944]")}>{index < step ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}</span>
              {item.title}
            </button>
          );
        })}
      </nav>

      <Panel className="min-w-0">
        <PanelHeader title={steps[step]?.title ?? "Task"} description={`Step ${step + 1} of ${steps.length}`} />
        <div className="p-5">
          {step === 0 ? (
            <div className="space-y-5">
              <label className={labelClass}>Task title<input {...register("title", { required: true, minLength: 3 })} className={inputClass} placeholder="Fix failing authentication tests" />{errors.title ? <span className="mt-1 block text-[11px] text-[#ff8e88]">Enter a clear task title.</span> : null}</label>
              <label className={labelClass}>Problem description<textarea {...register("problemDescription", { required: true, minLength: 10 })} className={textareaClass} placeholder="Describe what is broken and how to reproduce it." />{errors.problemDescription ? <span className="mt-1 block text-[11px] text-[#ff8e88]">Provide at least 10 characters of context.</span> : null}</label>
              <label className={labelClass}>Desired outcome<textarea {...register("desiredOutcome", { required: true, minLength: 3 })} className={textareaClass} placeholder="Describe the observable result you expect." /></label>
              <div className="grid gap-4 md:grid-cols-2"><label className={labelClass}>Repository<input {...register("repository", { required: true })} className={inputClass} /></label><label className={labelClass}>Target branch<input {...register("targetBranch", { required: true })} className={inputClass} /></label></div>
              <label className={labelClass}>Task category<select {...register("taskType")} className={inputClass}>{["DIAGNOSE_REPOSITORY", "BUILD_RESCUE", "TEST_AND_FIX", "FEATURE_COMPLETION", "PULL_REQUEST_VERIFICATION", "LAUNCH_READINESS"].map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-5">
              <label className={labelClass}>Required skills<input {...register("requiredSkills")} className={inputClass} placeholder="React, TypeScript, Authentication" /><span className="mt-1.5 block text-[11px] font-normal text-[#666e7a]">Comma separated</span></label>
              <div className="grid gap-4 md:grid-cols-2"><label className={labelClass}>Operating system<select {...register("requiredOperatingSystem")} className={inputClass}><option value="ANY">Any supported OS</option><option value="WINDOWS">Windows</option><option value="MACOS">macOS</option><option value="LINUX">Linux</option></select></label><label className={labelClass}>Required tools<input {...register("requiredTools")} className={inputClass} /></label></div>
              <div className="grid gap-4 md:grid-cols-2"><label className={labelClass}>Budget (USD)<input type="number" min={50} max={10000} step={10} {...register("budgetDollars", { required: true, valueAsNumber: true, min: 50 })} className={inputClass} /></label><label className={labelClass}>Deadline<input type="date" {...register("deadline", { required: true })} className={inputClass} /></label></div>
              <div><div className={labelClass}>Agent selection</div><div className="mt-2 grid grid-cols-2 gap-2"><label className={cn("flex cursor-pointer items-center gap-3 rounded-[5px] border p-3", matchingMode === "AUTO" ? "border-[#2f81f7] bg-[#10233e]" : "border-[#343944] bg-[#0d0f13]")}><input type="radio" value="AUTO" {...register("matchingMode")} className="accent-[#2f81f7]" /><span><span className="block text-xs font-semibold text-white">Auto match</span><span className="mt-1 block text-[10px] text-[#969da8]">Rank all eligible agents</span></span></label><label className={cn("flex cursor-pointer items-center gap-3 rounded-[5px] border p-3", matchingMode === "PREFERRED" ? "border-[#2f81f7] bg-[#10233e]" : "border-[#343944] bg-[#0d0f13]")}><input type="radio" value="PREFERRED" {...register("matchingMode")} className="accent-[#2f81f7]" /><span><span className="block text-xs font-semibold text-white">Choose agent</span><span className="mt-1 block text-[10px] text-[#969da8]">Validate a preferred agent</span></span></label></div></div>
              {matchingMode === "PREFERRED" ? <label className={labelClass}>Preferred agent<select {...register("preferredAgentId", { required: matchingMode === "PREFERRED" })} className={inputClass}><option value="">Select an agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {formatCurrency(agent.basePriceCents)}</option>)}</select></label> : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <label className={labelClass}>Acceptance criteria<textarea {...register("acceptanceCriteria", { required: true, minLength: 5 })} className={textareaClass} placeholder="Describe the exact observable check." /></label>
              <label className={labelClass}>Security sensitivity<select {...register("securitySensitivity")} className={inputClass}><option value="LOW">Low · public/demo repository</option><option value="MEDIUM">Medium · private application code</option><option value="HIGH">High · sensitive business logic</option></select></label>
              <div className="divide-y divide-[#242831] rounded-[5px] border border-[#343944] bg-[#0d0f13]">
                {[{ key: "allowCodeChanges" as const, label: "Allow Agent to modify code", copy: "Changes remain scoped to the one-time task workspace." }, { key: "allowPullRequest" as const, label: "Allow Agent to create a pull request", copy: "Requires a configured GitHub App permission." }, { key: "requiresHumanApproval" as const, label: "Require human approval", copy: "Customer or Admin approval becomes a required check." }].map((item) => <label key={item.key} className="flex cursor-pointer items-start justify-between gap-4 p-4"><span><span className="block text-xs font-semibold text-white">{item.label}</span><span className="mt-1 block text-[11px] leading-5 text-[#969da8]">{item.copy}</span></span><input type="checkbox" {...register(item.key)} className="mt-0.5 size-4 accent-[#2f81f7]" /></label>)}
              </div>
              <div className="flex items-start gap-3 rounded-[5px] border border-[#65501d] bg-[#2b2312] p-3 text-xs leading-5 text-[#d9bc70]"><ShieldCheck className="mt-0.5 size-4 shrink-0" /> Customer text never becomes an unrestricted shell command. The MVP only dispatches predefined workflow and command IDs.</div>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              {!analysis ? <div className="flex min-h-80 flex-col items-center justify-center text-center"><SearchCheck className="size-8 text-[#78b5ff]" /><h3 className="mt-4 text-base font-semibold text-white">Analyze the task before publishing</h3><p className="mt-2 max-w-md text-sm leading-6 text-[#969da8]">The RuleBasedTaskAnalyzer produces scope, capabilities, risk, verification and budget guidance without an LLM key.</p><Button className="mt-6" onClick={() => void analyze()} disabled={busy !== null}>{busy === "ANALYZE" ? <LoaderCircle className="size-4 animate-spin" /> : <SearchCheck className="size-4" />} Analyze task</Button></div> : (
                <div className="space-y-5">
                  <div><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Scope summary</div><p className="mt-2 text-sm leading-6 text-[#b2b8c2]">{analysis.scopeSummary}</p></div>
                  <div className="grid gap-px overflow-hidden rounded-[5px] border border-[#2a2e36] bg-[#242831] sm:grid-cols-3"><div className="bg-[#0d0f13] p-3"><div className="text-[10px] uppercase text-[#666e7a]">Risk</div><div className="mt-1.5 text-sm font-semibold text-[#e3b341]">{humanize(analysis.riskLevel)}</div></div><div className="bg-[#0d0f13] p-3"><div className="text-[10px] uppercase text-[#666e7a]">Suggested budget</div><div className="mt-1.5 text-sm font-semibold text-white">{formatCurrency(analysis.suggestedBudgetCents)}</div></div><div className="bg-[#0d0f13] p-3"><div className="text-[10px] uppercase text-[#666e7a]">Estimate</div><div className="mt-1.5 text-sm font-semibold text-white">{analysis.estimatedDurationHours} hours</div></div></div>
                  <div><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Required capabilities</div><div className="mt-2 flex flex-wrap gap-2">{analysis.requiredCapabilities.map((capability) => <span key={capability} className="rounded-[4px] border border-[#343944] bg-[#171a20] px-2 py-1 text-xs text-[#b2b8c2]">{capability}</span>)}</div></div>
                  <div><div className="text-[10px] font-semibold uppercase text-[#666e7a]">Suggested verification</div><div className="mt-2 divide-y divide-[#242831] border-y border-[#242831]">{analysis.suggestedVerificationChecks.map((check) => <div key={check.id} className="flex items-center justify-between py-2.5 text-xs"><span className="text-[#b2b8c2]">{check.title}</span><span className="text-[10px] font-semibold text-[#666e7a]">{check.required ? "REQUIRED" : "OPTIONAL"}</span></div>)}</div></div>
                  <Button className="w-full" onClick={() => void create()} disabled={busy !== null}>{busy === "CREATE" ? <LoaderCircle className="size-4 animate-spin" /> : <CircleDollarSign className="size-4" />} Reserve test balance and create task</Button>
                </div>
              )}
            </div>
          ) : null}
          {serverError ? <div className="mt-4 rounded-[5px] border border-[#6e2d2b] bg-[#2b1718] px-3 py-2 text-xs text-[#ff8e88]">{serverError}</div> : null}
        </div>
        <div className="flex items-center justify-between border-t border-[#2a2e36] px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || busy !== null}><ArrowLeft className="size-4" /> Back</Button>
          {step < 3 ? <Button size="sm" onClick={() => void next()}>Continue <ArrowRight className="size-4" /></Button> : null}
        </div>
      </Panel>

      <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
        <Panel><PanelHeader title="Task preview" description="Reserved only after creation" /><div className="divide-y divide-[#242831] px-4">{[["Template", humanize(watch("taskType"))], ["Budget", formatCurrency((watch("budgetDollars") || 0) * 100)], ["OS", humanize(watch("requiredOperatingSystem"))], ["Checks", String(buildChecks(getValues()).length)]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 py-3 text-xs"><span className="text-[#969da8]">{label}</span><span className="truncate font-semibold text-white">{value}</span></div>)}</div></Panel>
        <Panel><PanelHeader title="Execution boundary" /><div className="space-y-3 p-4 text-xs leading-5 text-[#969da8]"><p className="flex gap-2"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-[#72d981]" /> No arbitrary customer shell commands.</p><p className="flex gap-2"><FileCheck2 className="mt-0.5 size-3.5 shrink-0 text-[#72d981]" /> Required checks run outside the executor claim.</p><p className="flex gap-2"><Bot className="mt-0.5 size-3.5 shrink-0 text-[#72d981]" /> Provider acceptance is required for real jobs.</p></div></Panel>
      </aside>
    </div>
  );
}
