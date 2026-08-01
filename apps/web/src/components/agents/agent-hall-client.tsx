"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  Filter,
  Search,
  SlidersHorizontal,
  Star,
  Wrench
} from "lucide-react";
import type { AgentRecord } from "@donelayer/database";
import { formatCurrency, formatDuration, humanize } from "@/lib/format";

type Sort = "relevance" | "success" | "price" | "speed";

function includes(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function AgentCard({ agent }: { agent: AgentRecord }) {
  const online = agent.workerStatus === "ONLINE" || agent.workerStatus === "BUSY";
  return (
    <article className="group flex min-h-[340px] flex-col rounded-[6px] border border-[#2a2e36] bg-[#111318] transition-colors hover:border-[#3a404b] hover:bg-[#13161b]">
      <div className="flex items-start gap-3 border-b border-[#242831] p-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[6px] border border-[#343944] bg-[#0d0f13] text-sm font-bold text-[#8fc2ff]">{agent.name.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/agents/${agent.slug}`} className="focus-ring block truncate rounded-[3px] text-sm font-semibold text-white group-hover:text-[#8fc2ff]">{agent.name}</Link>
              <div className="mt-1 truncate text-xs text-[#666e7a]">{agent.providerName} · v{agent.version}</div>
            </div>
            {agent.verificationStatus === "VERIFIED" ? <CheckCircle2 className="size-4 shrink-0 text-[#3fb950]" aria-label="Verified agent" /> : null}
          </div>
          <div className={`mt-2 flex items-center gap-1.5 text-[11px] ${online ? "text-[#72d981]" : "text-[#666e7a]"}`}><span className="size-1.5 rounded-full bg-current" /> {online ? humanize(agent.workerStatus) : "Worker offline"}</div>
        </div>
      </div>
      <div className="flex-1 p-4">
        <p className="line-clamp-3 text-sm leading-6 text-[#969da8]">{agent.description}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {agent.skills.slice(0, 4).map((skill) => <span key={skill} className="rounded-[4px] border border-[#343944] bg-[#171a20] px-2 py-1 text-[10px] font-semibold text-[#b2b8c2]">{skill}</span>)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <div><div className="text-[10px] uppercase text-[#666e7a]">Verified success</div><div className="mt-1 font-semibold text-[#72d981]">{Math.round(agent.verifiedSuccessRate * 100)}%</div></div>
          <div><div className="text-[10px] uppercase text-[#666e7a]">Rating</div><div className="mt-1 flex items-center gap-1 font-semibold text-white"><Star className="size-3 fill-[#d29922] text-[#d29922]" /> {agent.rating.toFixed(1)}</div></div>
          <div><div className="text-[10px] uppercase text-[#666e7a]">Average time</div><div className="mt-1 font-semibold text-white">{formatDuration(agent.averageCompletionMinutes)}</div></div>
          <div><div className="text-[10px] uppercase text-[#666e7a]">Completed</div><div className="mt-1 font-semibold text-white">{agent.completedTasks}</div></div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-[#242831] px-4 py-3">
        <div><span className="text-[10px] text-[#666e7a]">From </span><span className="text-sm font-semibold text-white">{formatCurrency(agent.basePriceCents)}</span></div>
        <Link href={`/agents/${agent.slug}`} className="focus-ring flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-semibold text-[#8fc2ff] hover:bg-[#1b2b43]">View agent <ArrowUpRight className="size-3.5" /></Link>
      </div>
    </article>
  );
}

export function AgentHallClient({ agents }: { agents: AgentRecord[] }) {
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("ALL");
  const [taskType, setTaskType] = useState("ALL");
  const [os, setOs] = useState("ALL");
  const [tool, setTool] = useState("ALL");
  const [maxPrice, setMaxPrice] = useState(50000);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("relevance");

  const skills = useMemo(() => [...new Set(agents.flatMap((agent) => agent.skills))].sort(), [agents]);
  const taskTypes = useMemo(() => [...new Set(agents.flatMap((agent) => agent.taskTypes))].sort(), [agents]);
  const systems = useMemo(() => [...new Set(agents.flatMap((agent) => agent.operatingSystems))].sort(), [agents]);
  const tools = useMemo(() => [...new Set(agents.flatMap((agent) => agent.tools))].sort(), [agents]);

  const filtered = useMemo(() => {
    const values = agents.filter((agent) => {
      const matchesSearch = !search || [agent.name, agent.providerName, agent.description, ...agent.skills, ...agent.tools].some((value) => includes(value, search));
      return matchesSearch &&
        (skill === "ALL" || agent.skills.includes(skill)) &&
        (taskType === "ALL" || agent.taskTypes.includes(taskType as AgentRecord["taskTypes"][number])) &&
        (os === "ALL" || agent.operatingSystems.includes(os)) &&
        (tool === "ALL" || agent.tools.includes(tool)) &&
        agent.basePriceCents <= maxPrice &&
        (!onlineOnly || agent.workerStatus === "ONLINE" || agent.workerStatus === "BUSY") &&
        (!verifiedOnly || agent.verificationStatus === "VERIFIED");
    });
    values.sort((left, right) => {
      if (sort === "success") return right.verifiedSuccessRate - left.verifiedSuccessRate;
      if (sort === "price") return left.basePriceCents - right.basePriceCents;
      if (sort === "speed") return left.averageCompletionMinutes - right.averageCompletionMinutes;
      return Number(right.verificationStatus === "VERIFIED") - Number(left.verificationStatus === "VERIFIED") || right.verifiedSuccessRate - left.verifiedSuccessRate;
    });
    return values;
  }, [agents, maxPrice, onlineOnly, os, search, skill, sort, taskType, tool, verifiedOnly]);

  return (
    <div>
      <div className="grid gap-3 rounded-[6px] border border-[#2a2e36] bg-[#111318] p-3 lg:grid-cols-[minmax(260px,1fr)_repeat(4,minmax(130px,0.45fr))]">
        <label className="relative block">
          <span className="sr-only">Search agents</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#666e7a]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agents, skills or tools" className="focus-ring h-10 w-full rounded-[5px] border border-[#343944] bg-[#0d0f13] pl-9 pr-3 text-sm text-white placeholder:text-[#555d68]" />
        </label>
        {[{ label: "Skill", value: skill, onChange: setSkill, options: skills }, { label: "Task type", value: taskType, onChange: setTaskType, options: taskTypes }, { label: "Operating system", value: os, onChange: setOs, options: systems }, { label: "Tool", value: tool, onChange: setTool, options: tools }].map((filter) => (
          <label key={filter.label} className="relative block">
            <span className="sr-only">{filter.label}</span>
            <select value={filter.value} onChange={(event) => filter.onChange(event.target.value)} className="focus-ring h-10 w-full appearance-none rounded-[5px] border border-[#343944] bg-[#0d0f13] px-3 pr-8 text-xs font-medium text-[#b2b8c2]">
              <option value="ALL">All {filter.label.toLowerCase()}s</option>
              {filter.options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}
            </select>
            <Filter className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-[#666e7a]" />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-col justify-between gap-3 border-b border-[#2a2e36] pb-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[#969da8]"><input type="checkbox" checked={onlineOnly} onChange={(event) => setOnlineOnly(event.target.checked)} className="size-4 accent-[#2f81f7]" /> Online only</label>
          <label className="flex items-center gap-2 text-xs text-[#969da8]"><input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} className="size-4 accent-[#2f81f7]" /> Verified only</label>
          <label className="flex items-center gap-3 text-xs text-[#969da8]"><span>Max {formatCurrency(maxPrice)}</span><input type="range" min={10000} max={50000} step={1000} value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} className="w-28 accent-[#2f81f7]" /></label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#666e7a]">{filtered.length} agents</span>
          <SlidersHorizontal className="size-3.5 text-[#666e7a]" />
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="focus-ring h-8 rounded-[5px] border border-[#343944] bg-[#111318] px-2 text-xs text-[#b2b8c2]">
            <option value="relevance">Sort by relevance</option>
            <option value="success">Sort by success rate</option>
            <option value="price">Sort by price</option>
            <option value="speed">Sort by speed</option>
          </select>
        </div>
      </div>

      {filtered.length ? <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{filtered.map((agent) => <AgentCard key={agent.id} agent={agent} />)}</div> : (
        <div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-[6px] border border-dashed border-[#343944] text-center"><Wrench className="size-6 text-[#666e7a]" /><h2 className="mt-4 text-sm font-semibold text-white">No agents match these filters</h2><p className="mt-2 text-xs text-[#969da8]">Broaden the environment, price or availability requirements.</p></div>
      )}
    </div>
  );
}
