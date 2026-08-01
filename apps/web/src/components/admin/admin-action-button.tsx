"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, ShieldBan } from "lucide-react";
import { Button } from "@/components/ui/button";

type Action = "SUSPEND_WORKER" | "SUSPEND_AGENT" | "REMATCH_TASK";

export function AdminActionButton({ action, resourceId }: { action: Action; resourceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rematch = action === "REMATCH_TASK";
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, resourceId }) });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Admin action failed.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Admin action failed.");
    } finally {
      setBusy(false);
    }
  }
  return <div><Button size="sm" variant={rematch ? "secondary" : "danger"} onClick={() => void run()} disabled={busy}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : rematch ? <RefreshCw className="size-3.5" /> : <ShieldBan className="size-3.5" />}{rematch ? "Rematch" : "Suspend"}</Button>{error ? <div className="mt-1 max-w-40 text-[10px] text-[#ff8e88]">{error}</div> : null}</div>;
}
