"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";

const fieldClass = "focus-ring mt-2 h-10 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 text-sm text-white placeholder:text-[#555d68]";
const labelClass = "block text-xs font-semibold text-[#b2b8c2]";
const split = (value: string) => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];

export function WorkspaceAgentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState("TypeScript, React");
  const [taskTypes, setTaskTypes] = useState(["FEATURE_COMPLETION"]);
  const [languages, setLanguages] = useState("TypeScript, JavaScript");
  const [systems, setSystems] = useState(["LINUX"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeName(value: string) {
    setName(value);
    if (!slug || slug === slugify(name)) setSlug(slugify(value));
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, slug, description,
          skills: split(skills),
          taskTypes,
          languages: split(languages),
          operatingSystems: systems,
          tools: ["Git", "Node.js", "npm"],
          requiredMcpServers: [],
          pricingModel: "FIXED",
          basePriceCents: 0,
          endpointType: "LOCAL_WORKER",
          endpointUrl: null,
          authenticationType: "NONE",
          inputModes: ["application/json"],
          outputModes: ["application/json", "text/x-diff"],
        }),
      });
      const body = await response.json() as { slug?: string; error?: string };
      if (!response.ok || !body.slug) throw new Error(body.error ?? "Unable to create Agent.");
      router.push(`/agents/${body.slug}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create Agent.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void create(event)} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <PanelHeader title="Agent identity" description="Private to this workspace" />
        <div className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>Agent name<input value={name} onChange={(event) => changeName(event.target.value)} className={fieldClass} required minLength={3} maxLength={120} /></label>
            <label className={labelClass}>Slug<input value={slug} onChange={(event) => setSlug(event.target.value)} className={fieldClass} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></label>
          </div>
          <label className={labelClass}>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="focus-ring mt-2 min-h-28 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 py-2 text-sm leading-6 text-white" required minLength={20} maxLength={5000} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>Skills<input value={skills} onChange={(event) => setSkills(event.target.value)} className={fieldClass} required /></label>
            <label className={labelClass}>Languages<input value={languages} onChange={(event) => setLanguages(event.target.value)} className={fieldClass} /></label>
          </div>
          <ChoiceGroup label="Supported Work" values={["DIAGNOSE_REPOSITORY", "BUILD_RESCUE", "TEST_AND_FIX", "FEATURE_COMPLETION", "PULL_REQUEST_VERIFICATION", "LAUNCH_READINESS"]} selected={taskTypes} onChange={setTaskTypes} />
          <ChoiceGroup label="Execution operating systems" values={["WINDOWS", "MACOS", "LINUX"]} selected={systems} onChange={setSystems} />
          {error ? <div role="alert" className="rounded-[5px] border border-[#6d2f2f] bg-[#211113] px-3 py-2.5 text-xs text-[#ff8e88]">{error}</div> : null}
          <Button type="submit" disabled={busy || !taskTypes.length || !systems.length}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Bot className="size-4" />} Create Agent</Button>
        </div>
      </Panel>
      <div className="space-y-5">
        <Panel><PanelHeader title="Initial state" /><div className="p-4 text-sm leading-6 text-[#b2b8c2]">The Agent receives an append-only identity revision and remains <strong className="text-white">Pending verification</strong> with no runtime connected.</div></Panel>
        <Panel><PanelHeader title="Controller" /><div className="p-4 text-sm leading-6 text-[#b2b8c2]">Your signed-in platform account controls this Agent. This relationship is not legal identity verification and grants no task Authority by itself.</div></Panel>
      </div>
    </form>
  );
}

function ChoiceGroup({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (value: string[]) => void }) {
  return <fieldset><legend className={labelClass}>{label}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{values.map((value) => <label key={value} className="flex items-center gap-2 text-xs text-[#b2b8c2]"><input type="checkbox" checked={selected.includes(value)} onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))} className="size-4 accent-[#2f81f7]" />{human(value)}</label>)}</div></fieldset>;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function human(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
