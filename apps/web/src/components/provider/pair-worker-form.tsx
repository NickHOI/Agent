"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle, Plus, TerminalSquare } from "lucide-react";
import type { WorkerRecord } from "@donelayer/database";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";

export function PairWorkerForm({ workers }: { workers: WorkerRecord[] }) {
  const [mode, setMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [workerId, setWorkerId] = useState(workers[1]?.id ?? workers[0]?.id ?? "");
  const [name, setName] = useState("Development Worker");
  const [os, setOs] = useState<WorkerRecord["os"]>("WINDOWS");
  const [result, setResult] = useState<{ code: string; expiresAt: string; workerId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function createCode() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/provider/workers/pairing-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "EXISTING" ? { workerId } : { name, os }) });
      const body = (await response.json()) as { code?: string; expiresAt?: string; workerId?: string; error?: string };
      if (!response.ok || !body.code || !body.expiresAt || !body.workerId) throw new Error(body.error ?? "Unable to create pairing code.");
      setResult({ code: body.code, expiresAt: body.expiresAt, workerId: body.workerId });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create pairing code.");
    } finally {
      setBusy(false);
    }
  }
  async function copyCommand() {
    if (!result) return;
    await navigator.clipboard.writeText(`npm.cmd run worker:setup -- --api-url http://localhost:3000 --code ${result.code}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Panel>
        <PanelHeader title="Create a one-time pairing code" description="The Worker connects outbound to the platform and exchanges this code once" />
        <div className="p-5">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("EXISTING")} className={`focus-ring rounded-[5px] border p-3 text-left ${mode === "EXISTING" ? "border-[#2f81f7] bg-[#10233e]" : "border-[#343944] bg-[#0d0f13]"}`}><span className="block text-xs font-semibold text-white">Pair existing node</span><span className="mt-1 block text-[11px] text-[#969da8]">Use a registered worker slot</span></button>
            <button type="button" onClick={() => setMode("NEW")} className={`focus-ring rounded-[5px] border p-3 text-left ${mode === "NEW" ? "border-[#2f81f7] bg-[#10233e]" : "border-[#343944] bg-[#0d0f13]"}`}><span className="block text-xs font-semibold text-white">Create new node</span><span className="mt-1 block text-[11px] text-[#969da8]">Register before pairing</span></button>
          </div>
          {mode === "EXISTING" ? <label className="mt-5 block text-xs font-semibold text-[#b2b8c2]">Worker node<select value={workerId} onChange={(event) => setWorkerId(event.target.value)} className="focus-ring mt-2 h-10 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 text-sm text-white">{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · {worker.os}</option>)}</select></label> : <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-[#b2b8c2]">Worker name<input value={name} onChange={(event) => setName(event.target.value)} className="focus-ring mt-2 h-10 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 text-sm text-white" /></label><label className="text-xs font-semibold text-[#b2b8c2]">Operating system<select value={os} onChange={(event) => setOs(event.target.value as WorkerRecord["os"])} className="focus-ring mt-2 h-10 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 text-sm text-white"><option value="WINDOWS">Windows</option><option value="MACOS">macOS</option><option value="LINUX">Linux</option></select></label></div>}
          <Button className="mt-5" onClick={() => void createCode()} disabled={busy || (mode === "EXISTING" && !workerId)}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : mode === "NEW" ? <Plus className="size-4" /> : <KeyRound className="size-4" />} Generate pairing code</Button>
          {error ? <div className="mt-3 text-xs text-[#ff8e88]">{error}</div> : null}
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Pairing result" description="Code expires after 10 minutes" />
        {result ? <div className="p-5"><div className="mono rounded-[5px] border border-[#26599b] bg-[#10233e] px-4 py-5 text-center text-xl font-bold text-[#8fc2ff]">{result.code}</div><div className="mt-4 rounded-[5px] border border-[#343944] bg-[#090a0c] p-3"><div className="flex items-center gap-2 text-xs font-semibold text-white"><TerminalSquare className="size-4 text-[#78b5ff]" /> Worker setup command</div><code className="mono mt-2 block break-all text-[11px] leading-5 text-[#969da8]">npm.cmd run worker:setup -- --api-url http://localhost:3000 --code {result.code}</code></div><Button variant="secondary" className="mt-3 w-full" onClick={() => void copyCommand()}>{copied ? <Check className="size-4 text-[#3fb950]" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy command"}</Button><p className="mt-3 text-[11px] leading-5 text-[#666e7a]">Only a digest of the pairing code is stored. The returned Worker token is shown only to the CLI and can be revoked.</p></div> : <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><KeyRound className="size-7 text-[#555d68]" /><p className="mt-3 text-xs leading-5 text-[#666e7a]">Generate a pairing code to see the one-time setup command.</p></div>}
      </Panel>
    </div>
  );
}
