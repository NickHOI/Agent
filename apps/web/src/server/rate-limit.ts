import { NextResponse } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function enforceRateLimit(request: Request, scope: string, limit = 30, windowMs = 60_000): NextResponse | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const client = forwarded ?? request.headers.get("x-real-ip") ?? "local";
  const key = `${scope}:${client}`;
  const timestamp = Date.now();
  const existing = buckets.get(key);
  const bucket = !existing || existing.resetAt <= timestamp ? { count: 0, resetAt: timestamp + windowMs } : existing;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));
  return NextResponse.json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } }
  );
}
