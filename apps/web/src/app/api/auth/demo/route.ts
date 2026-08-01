import { NextResponse } from "next/server";
import { z } from "zod";
import { createDemoSession, demoSessionCookie } from "@/server/auth";
import { assertSameOrigin } from "@/server/http-security";

const schema = z.object({ role: z.enum(["CUSTOMER", "PROVIDER", "ADMIN"]) }).strict();

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Select a valid demo role." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, role: parsed.data.role });
  response.cookies.set(demoSessionCookie.name, createDemoSession(parsed.data.role), demoSessionCookie.options);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(demoSessionCookie.name, "", { ...demoSessionCookie.options, maxAge: 0 });
  return response;
}
