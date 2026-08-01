"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock3, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Decision = "ACCEPT" | "DECLINE" | "LATER";

export function TaskOfferActions({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: Decision) {
    setBusy(decision);
    setError(null);
    try {
      const response = await fetch(`/api/provider/tasks/${taskId}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to record the decision.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the decision.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void decide("ACCEPT")} disabled={busy !== null}>{busy === "ACCEPT" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Accept</Button>
        <Button size="sm" variant="secondary" onClick={() => void decide("LATER")} disabled={busy !== null}>{busy === "LATER" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Clock3 className="size-3.5" />} Later</Button>
        <Button size="sm" variant="ghost" onClick={() => void decide("DECLINE")} disabled={busy !== null}>{busy === "DECLINE" ? <LoaderCircle className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Decline</Button>
      </div>
      {error ? <div className="mt-2 text-[11px] text-[#ff8e88]">{error}</div> : null}
    </div>
  );
}
