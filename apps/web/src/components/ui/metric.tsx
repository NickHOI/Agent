import type { ReactNode } from "react";

export function Metric({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0 border-r border-[#2a2e36] px-4 py-4 last:border-r-0">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-[#969da8]">
        <span className="truncate">{label}</span>
        <span className="text-[#666e7a]">{icon}</span>
      </div>
      <div className="mt-2 truncate text-2xl font-semibold leading-none text-white">{value}</div>
      {detail ? <div className="mt-2 truncate text-xs text-[#666e7a]">{detail}</div> : null}
    </div>
  );
}
