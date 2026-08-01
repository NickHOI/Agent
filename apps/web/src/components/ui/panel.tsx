import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-[6px] border border-[#2a2e36] bg-[#111318]", className)}>{children}</section>;
}

export function PanelHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[#2a2e36] px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
        {description ? <p className="mt-0.5 text-xs leading-5 text-[#969da8]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-4 flex size-10 items-center justify-center rounded-[6px] border border-[#343944] bg-[#171a20] text-[#969da8]">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#969da8]">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
