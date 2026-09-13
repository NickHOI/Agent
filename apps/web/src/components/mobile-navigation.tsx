"use client";

import { useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { Bot, BriefcaseBusiness, History, LayoutDashboard, Menu, Store, X } from "lucide-react";

const workspaceItems = [
  { label: "Overview", href: "/customer", icon: LayoutDashboard },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Work", href: "/tasks", icon: BriefcaseBusiness },
  { label: "History", href: "/history", icon: History },
];

const demoItems = [
  { label: "Customer", href: "/customer", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: BriefcaseBusiness },
  { label: "Agent Hall", href: "/agents", icon: Store },
];

export function MobileNavigation({ workspace }: { workspace: boolean }) {
  const [open, setOpen] = useState(false);
  const items = workspace ? workspaceItems : demoItems;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="focus-ring flex size-9 items-center justify-center rounded-[5px] border border-[#343944] text-[#969da8] lg:hidden" aria-label="Open navigation" aria-expanded={open}>
        <Menu className="size-4" />
      </button>
      {open && typeof document !== "undefined" ? createPortal((
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <nav className="absolute inset-y-0 left-0 w-[min(82vw,300px)] border-r border-[#2a2e36] bg-[#0d0f13] p-4" aria-label="Mobile navigation">
            <div className="flex items-center justify-between border-b border-[#2a2e36] pb-4">
              <span className="text-sm font-semibold text-white">DoneLayer</span>
              <button type="button" onClick={() => setOpen(false)} className="focus-ring flex size-9 items-center justify-center rounded-[5px] text-[#969da8]" aria-label="Close navigation"><X className="size-4" /></button>
            </div>
            <div className="mt-4 space-y-1">
              {items.map((item) => {
                const Icon = item.icon;
                return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="focus-ring flex h-11 items-center gap-3 rounded-[5px] px-3 text-sm font-medium text-[#b2b8c2] hover:bg-[#171a20] hover:text-white"><Icon className="size-4" />{item.label}</Link>;
              })}
            </div>
          </nav>
        </div>
      ), document.body) : null}
    </>
  );
}
