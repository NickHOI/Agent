"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CirclePlay, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DemoLaunchButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/start", { method: "POST" });
      const body = (await response.json()) as { taskId?: string; error?: string };
      if (!response.ok || !body.taskId) throw new Error(body.error ?? "Unable to start the demo.");
      router.push(`/tasks/${body.taskId}?autorun=1`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start the demo.");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error ? <span className="text-xs text-[#ff8e88]">{error}</span> : null}
      <Button onClick={() => void launch()} disabled={loading} size="sm">
        {loading ? <LoaderCircle className="size-4 animate-spin" /> : <CirclePlay className="size-4" />}
        Run Full Demo
      </Button>
    </div>
  );
}
