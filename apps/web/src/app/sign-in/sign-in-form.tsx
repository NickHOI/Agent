"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, LoaderCircle, ShieldCheck, Wrench } from "lucide-react";
import type { AppRole } from "@/server/auth";

const roles = [
  {
    role: "CUSTOMER" as const,
    title: "Continue as customer",
    name: "Nick Demo",
    description: "Create tasks, inspect evidence and accept delivery.",
    icon: BriefcaseBusiness,
    destination: "/customer"
  },
  {
    role: "PROVIDER" as const,
    title: "Continue as provider",
    name: "Provider Alpha",
    description: "Manage agents, workers, jobs and simulated earnings.",
    icon: Wrench,
    destination: "/provider"
  },
  {
    role: "ADMIN" as const,
    title: "Continue as admin",
    name: "DoneLayer Admin",
    description: "Review operations, security events and disputes.",
    icon: ShieldCheck,
    destination: "/admin"
  }
];

export function SignInForm() {
  const router = useRouter();
  const [loading, setLoading] = useState<AppRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(role: AppRole, destination: string) {
    setLoading(role);
    setError(null);
    try {
      const response = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role })
      });
      if (!response.ok) throw new Error("Unable to start the demo session.");
      router.push(destination);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start the demo session.");
      setLoading(null);
    }
  }

  return (
    <div className="divide-y divide-[#2a2e36] overflow-hidden rounded-[6px] border border-[#2a2e36] bg-[#111318]">
      {roles.map((item) => {
        const Icon = item.icon;
        const active = loading === item.role;
        return (
          <button
            key={item.role}
            type="button"
            className="focus-ring group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-[#171a20] disabled:opacity-60"
            disabled={loading !== null}
            onClick={() => void signIn(item.role, item.destination)}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[5px] border border-[#343944] bg-[#0d0f13] text-[#78b5ff]">
              {active ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">{item.title}</span>
              <span className="mt-1 block text-xs font-medium text-[#b2b8c2]">{item.name}</span>
              <span className="mt-1 block text-xs leading-5 text-[#666e7a]">{item.description}</span>
            </span>
            <span className="text-sm text-[#666e7a] transition-transform group-hover:translate-x-0.5 group-hover:text-white">→</span>
          </button>
        );
      })}
      {error ? <div className="px-4 py-3 text-xs text-[#ff8e88]">{error}</div> : null}
      <div className="bg-[#0d0f13] px-4 py-3 text-xs leading-5 text-[#666e7a]">
        Demo sessions use signed HttpOnly cookies. No production credentials are required.
      </div>
    </div>
  );
}
