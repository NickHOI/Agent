import Link from "next/link";
import type { ReactNode } from "react";
import {
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  CircleDollarSign,
  FileCheck2,
  Gauge,
  History,
  LayoutDashboard,
  Plus,
  ServerCog,
  ShieldCheck,
  Store,
  UsersRound
} from "lucide-react";
import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getActor } from "@/server/auth";

type NavItem = { label: string; href: string; icon: typeof Gauge };

const customerNav: NavItem[] = [
  { label: "Overview", href: "/customer", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: BriefcaseBusiness },
  { label: "Agent Hall", href: "/agents", icon: Store },
  { label: "Spending", href: "/customer#spending", icon: CircleDollarSign }
];

const workspaceNav: NavItem[] = [
  { label: "Overview", href: "/customer", icon: LayoutDashboard },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Work", href: "/tasks", icon: BriefcaseBusiness },
  { label: "History", href: "/history", icon: History },
];

const providerNav: NavItem[] = [
  { label: "Provider", href: "/provider", icon: Gauge },
  { label: "Agents", href: "/provider/agents", icon: Bot },
  { label: "Workers", href: "/provider/workers", icon: ServerCog },
  { label: "Jobs", href: "/provider/jobs", icon: FileCheck2 }
];

const adminNav: NavItem[] = [
  { label: "Admin", href: "/admin", icon: ShieldCheck },
  { label: "Users", href: "/admin#users", icon: UsersRound },
  { label: "Disputes", href: "/disputes", icon: BriefcaseBusiness }
];

function NavGroup({ label, items, currentPath }: { label: string; items: NavItem[]; currentPath: string }) {
  return (
    <div className="mt-5">
      <div className="px-3 text-[11px] font-semibold uppercase text-[#666e7a]">{label}</div>
      <nav className="mt-2 space-y-1" aria-label={label}>
        {items.map((item) => {
          const active = currentPath === item.href || (item.href !== "/customer" && currentPath.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "focus-ring flex h-9 items-center gap-3 rounded-[5px] px-3 text-sm font-medium transition-colors",
                active ? "bg-[#1b2b43] text-[#8fc2ff]" : "text-[#969da8] hover:bg-[#171a20] hover:text-white"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export async function AppShell({
  currentPath,
  title,
  eyebrow,
  children,
  actions
}: {
  currentPath: string;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const actor = await getActor();
  const workspace = process.env.APP_MODE === "supabase";
  const initials = actor?.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "DL";
  return (
    <div className="min-h-screen bg-[#090a0c] text-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] border-r border-[#242831] bg-[#0d0f13] lg:flex lg:flex-col">
        <div className="flex h-16 items-center border-b border-[#242831] px-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {workspace ? <NavGroup label="Trust workspace" items={workspaceNav} currentPath={currentPath} /> : (
            <>
              <NavGroup label="Customer" items={customerNav} currentPath={currentPath} />
              <NavGroup label="Provider" items={providerNav} currentPath={currentPath} />
              <NavGroup label="Operations" items={adminNav} currentPath={currentPath} />
            </>
          )}
        </div>
        <div className="border-t border-[#242831] p-3">
          <div className="flex h-11 items-center justify-between rounded-[5px] px-2">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] bg-[#1e4d32] text-xs font-bold text-[#8be29a]">{initials}</span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-white">{actor?.name ?? "Signed out"}</span>
                <span className="block truncate text-[11px] text-[#666e7a]">{workspace ? "Private Beta" : actor?.role ?? "Demo"}</span>
              </span>
            </span>
            {workspace ? (
              <form action="/api/auth/sign-out" method="post"><button type="submit" className="focus-ring rounded-[4px] px-2 py-1 text-[11px] font-semibold text-[#969da8] hover:text-white">Sign out</button></form>
            ) : <ChevronDown className="size-3.5 text-[#666e7a]" aria-hidden="true" />}
          </div>
        </div>
      </aside>

      <div className="lg:pl-[232px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-[#242831] bg-[#0d0f13]/95 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <MobileNavigation workspace={workspace} />
            <div className="min-w-0">
              {eyebrow ? <div className="truncate text-[11px] font-semibold uppercase text-[#666e7a]">{eyebrow}</div> : null}
              <h1 className="truncate text-base font-semibold text-white">{title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <ButtonLink href="/tasks/new" size="sm">
              <Plus className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{workspace ? "New work" : "New task"}</span>
            </ButtonLink>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
