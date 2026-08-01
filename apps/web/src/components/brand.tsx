import Link from "next/link";
import { Layers3 } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="focus-ring inline-flex items-center gap-2 rounded-[4px]" aria-label="DoneLayer home">
      <span className="flex size-8 items-center justify-center rounded-[5px] border border-[#3d4552] bg-[#171a20] text-[#78b5ff]">
        <Layers3 className="size-[18px]" strokeWidth={2} aria-hidden="true" />
      </span>
      {compact ? null : <span className="text-[15px] font-bold text-white">DoneLayer</span>}
    </Link>
  );
}
