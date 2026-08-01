import { CheckCircle2, CircleAlert, CircleDot, Clock3, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const tones: Record<StatusTone, string> = {
  success: "border-[#295b34] bg-[#102718] text-[#72d981]",
  warning: "border-[#65501d] bg-[#2b2312] text-[#e3b341]",
  danger: "border-[#6e2d2b] bg-[#2b1718] text-[#ff8e88]",
  info: "border-[#26599b] bg-[#10233e] text-[#78b5ff]",
  neutral: "border-[#343944] bg-[#171a20] text-[#b2b8c2]"
};

const icons = {
  success: CheckCircle2,
  warning: Clock3,
  danger: XCircle,
  info: CircleDot,
  neutral: CircleAlert
} satisfies Record<StatusTone, typeof CheckCircle2>;

export function StatusBadge({ label, tone = "neutral", compact = false }: { label: string; tone?: StatusTone; compact?: boolean }) {
  const Icon = icons[tone];
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-[4px] border font-semibold",
        compact ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs",
        tones[tone]
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
