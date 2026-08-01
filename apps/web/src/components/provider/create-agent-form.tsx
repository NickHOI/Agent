"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, DownloadCloud, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { humanize } from "@/lib/format";

type EndpointType = "LOCAL_WORKER" | "WEBHOOK" | "A2A";
type ImportedCard = { name: string; description: string; version: string; endpointUrl?: string; skills: string[]; inputModes: string[]; outputModes: string[]; authentication: Record<string, unknown> };

const fieldClass = "focus-ring mt-2 h-10 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 text-sm text-white placeholder:text-[#555d68]";
const labelClass = "block text-xs font-semibold text-[#b2b8c2]";
const split = (value: string) => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];

export function CreateAgentForm() {
  const router = useRouter();
  const [endpointType, setEndpointType] = useState<EndpointType>("LOCAL_WORKER");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState("TypeScript, React");
  const [taskTypes, setTaskTypes] = useState(["TEST_AND_FIX"]);
  const [languages, setLanguages] = useState("TypeScript, JavaScript");
  const [systems, setSystems] = useState(["WINDOWS"]);
  const [tools, setTools] = useState("Git, Node.js, npm");
  const [mcp, setMcp] = useState("");
  const [pricingModel, setPricingModel] = useState("FIXED");
  const [basePrice, setBasePrice] = useState(200);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [authenticationType, setAuthenticationType] = useState("NONE");
  const [cardUrl, setCardUrl] = useState("");
  const [imported, setImported] = useState<ImportedCard | null>(null);
  const [busy, setBusy] = useState<"IMPORT" | "CREATE" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importCard() {
    setBusy("IMPORT");
    setError(null);
    try {
      const response = await fetch("/api/agents/import-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: cardUrl }) });
      const body = (await response.json()) as ImportedCard & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Agent Card import failed.");
      setImported(body);
      setName(body.name);
      setSlug(body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
      setDescription(body.description || "Imported A2A Agent Card pending provider review and verification.");
      setSkills(body.skills.join(", "));
      setEndpointUrl(body.endpointUrl ?? "");
      setAuthenticationType("A2A_METADATA");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent Card import failed.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("CREATE");
    setError(null);
    const body = {
      name,
      slug,
      description,
      skills: split(skills),
      taskTypes,
      languages: split(languages),
      operatingSystems: systems,
      tools: split(tools),
      requiredMcpServers: split(mcp),
      pricingModel,
      basePriceCents: Math.round(basePrice * 100),
      endpointType,
      endpointUrl: endpointType === "LOCAL_WORKER" ? null : endpointUrl,
      authenticationType: endpointType === "LOCAL_WORKER" ? "NONE" : authenticationType,
      inputModes: imported?.inputModes ?? ["application/json"],
      outputModes: imported?.outputModes ?? ["application/json", "text/x-diff"]
    };
    try {
      const response = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as { slug?: string; error?: string };
      if (!response.ok || !result.slug) throw new Error(result.error ?? "Unable to create Agent.");
      router.push(`/agents/${result.slug}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create Agent.");
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <Panel>
        <PanelHeader title="Agent profile" description="New Agents remain paused and pending verification" />
        <div className="space-y-5 p-5">
          <div><div className={labelClass}>Endpoint type</div><div className="mt-2 grid gap-2 sm:grid-cols-3">{(["LOCAL_WORKER", "WEBHOOK", "A2A"] as const).map((type) => <button key={type} type="button" onClick={() => setEndpointType(type)} className={`focus-ring rounded-[5px] border p-3 text-left ${endpointType === type ? "border-[#2f81f7] bg-[#10233e]" : "border-[#343944] bg-[#0d0f13]"}`}><span className="block text-xs font-semibold text-white">{humanize(type)}</span><span className="mt-1 block text-[10px] leading-4 text-[#969da8]">{type === "LOCAL_WORKER" ? "Runs on a paired provider machine" : type === "WEBHOOK" ? "Signed HTTPS task delivery" : "Import discovery metadata only"}</span></button>)}</div></div>
          {endpointType === "A2A" ? <div className="rounded-[5px] border border-[#343944] bg-[#0d0f13] p-4"><label className={labelClass}>A2A Agent Card URL<div className="mt-2 flex gap-2"><input value={cardUrl} onChange={(event) => setCardUrl(event.target.value)} className="focus-ring h-10 min-w-0 flex-1 rounded-[5px] border border-[#343944] bg-[#090a0c] px-3 text-sm text-white" placeholder="https://agent.example/.well-known/agent-card.json" /><Button variant="secondary" onClick={() => void importCard()} disabled={busy !== null}>{busy === "IMPORT" ? <LoaderCircle className="size-4 animate-spin" /> : <DownloadCloud className="size-4" />} Import</Button></div></label>{imported ? <div className="mt-3 flex items-center gap-2 text-xs text-[#72d981]"><Check className="size-4" /> Agent Card validated and normalized</div> : null}</div> : null}
          <div className="grid gap-4 sm:grid-cols-2"><label className={labelClass}>Agent name<input value={name} onChange={(event) => { setName(event.target.value); if (!slug) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} className={fieldClass} /></label><label className={labelClass}>Slug<input value={slug} onChange={(event) => setSlug(event.target.value)} className={fieldClass} /></label></div>
          <label className={labelClass}>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="focus-ring mt-2 min-h-28 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 py-2 text-sm leading-6 text-white" /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className={labelClass}>Skills<input value={skills} onChange={(event) => setSkills(event.target.value)} className={fieldClass} /></label><label className={labelClass}>Languages<input value={languages} onChange={(event) => setLanguages(event.target.value)} className={fieldClass} /></label></div>
          <div><div className={labelClass}>Supported task types</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{["DIAGNOSE_REPOSITORY", "BUILD_RESCUE", "TEST_AND_FIX", "FEATURE_COMPLETION", "PULL_REQUEST_VERIFICATION", "LAUNCH_READINESS"].map((type) => <label key={type} className="flex items-center gap-2 text-xs text-[#b2b8c2]"><input type="checkbox" checked={taskTypes.includes(type)} onChange={(event) => setTaskTypes((current) => event.target.checked ? [...current, type] : current.filter((value) => value !== type))} className="size-4 accent-[#2f81f7]" /> {humanize(type)}</label>)}</div></div>
          <div><div className={labelClass}>Operating systems</div><div className="mt-2 flex gap-4">{["WINDOWS", "MACOS", "LINUX"].map((system) => <label key={system} className="flex items-center gap-2 text-xs text-[#b2b8c2]"><input type="checkbox" checked={systems.includes(system)} onChange={(event) => setSystems((current) => event.target.checked ? [...current, system] : current.filter((value) => value !== system))} className="size-4 accent-[#2f81f7]" /> {humanize(system)}</label>)}</div></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className={labelClass}>Available tools<input value={tools} onChange={(event) => setTools(event.target.value)} className={fieldClass} /></label><label className={labelClass}>Required MCP servers<input value={mcp} onChange={(event) => setMcp(event.target.value)} className={fieldClass} placeholder="github, linear" /></label></div>
          {endpointType !== "LOCAL_WORKER" ? <div className="grid gap-4 sm:grid-cols-2"><label className={labelClass}>HTTPS endpoint<input value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} className={fieldClass} /></label><label className={labelClass}>Authentication<select value={authenticationType} onChange={(event) => setAuthenticationType(event.target.value)} className={fieldClass}><option value="HMAC">HMAC signature</option><option value="API_KEY">API key reference</option><option value="OAUTH">OAuth</option><option value="A2A_METADATA">A2A metadata</option></select></label></div> : null}
          <div className="grid gap-4 sm:grid-cols-2"><label className={labelClass}>Pricing model<select value={pricingModel} onChange={(event) => setPricingModel(event.target.value)} className={fieldClass}><option value="FIXED">Fixed</option><option value="FROM">From</option><option value="HOURLY">Hourly</option></select></label><label className={labelClass}>Base price (USD)<input type="number" min={0} value={basePrice} onChange={(event) => setBasePrice(Number(event.target.value))} className={fieldClass} /></label></div>
          {error ? <div className="rounded-[5px] border border-[#6e2d2b] bg-[#2b1718] px-3 py-2 text-xs text-[#ff8e88]">{error}</div> : null}
          <Button onClick={() => void create()} disabled={busy !== null}>{busy === "CREATE" ? <LoaderCircle className="size-4 animate-spin" /> : <Bot className="size-4" />} Create Agent</Button>
        </div>
      </Panel>
      <aside className="space-y-5">
        <Panel><PanelHeader title="Verification state" /><div className="p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 text-[#d29922]" /><div><div className="text-sm font-semibold text-white">Pending verification</div><p className="mt-1 text-xs leading-5 text-[#969da8]">The Agent cannot accept marketplace work until endpoint and capability metadata are reviewed.</p></div></div></div></Panel>
        <Panel><PanelHeader title="MCP metadata" /><div className="p-4 text-xs leading-5 text-[#969da8]">Record server names, tools and whether they are installed. Never upload provider MCP secrets to DoneLayer.</div></Panel>
        {endpointType === "A2A" ? <Panel><PanelHeader title="A2A scope" /><div className="p-4 text-xs leading-5 text-[#969da8]">The MVP validates and normalizes Agent Cards. Task execution methods intentionally remain unsupported until a stable protocol integration is enabled.</div></Panel> : null}
      </aside>
    </div>
  );
}
