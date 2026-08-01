import { NextResponse } from "next/server";

export function assertSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const requestHost = request.headers.get("host") ?? requestUrl.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const requestProtocol = forwardedProtocol ? `${forwardedProtocol}:` : requestUrl.protocol;
    if (requestHost === originUrl.host && requestProtocol === originUrl.protocol) return null;
  } catch {
    // A malformed Origin is rejected below.
  }
  return NextResponse.json({ error: "Origin not allowed." }, { status: 403 });
}

export function noStoreJson(data: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
