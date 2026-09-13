import { NextResponse } from "next/server";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { createSupabaseUserClient } from "@/server/supabase-auth";

export async function POST(request: Request) {
  if (process.env.APP_MODE !== "supabase") {
    return noStoreJson({ error: "Real sign out is unavailable in Demo mode." }, { status: 404 });
  }
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const client = await createSupabaseUserClient();
  await client.auth.signOut({ scope: "local" });
  const response = NextResponse.redirect(new URL("/sign-in", request.url), { status: 303 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
