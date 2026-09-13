import { z } from "zod";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { createSupabaseUserClient } from "@/server/supabase-auth";

const inputSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
}).strict();

export async function POST(request: Request) {
  if (process.env.APP_MODE !== "supabase") {
    return noStoreJson({ error: "Real sign in is unavailable in Demo mode." }, { status: 404 });
  }
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "auth-sign-in", 12);
  if (rateError) return rateError;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Enter a valid email and password." }, { status: 400 });

  const client = await createSupabaseUserClient();
  const { data, error } = await client.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return noStoreJson({ error: "The email or password is incorrect, or the account is not confirmed." }, { status: 401 });
  }
  const displayName = typeof data.user.user_metadata.display_name === "string"
    ? data.user.user_metadata.display_name
    : data.user.email?.split("@")[0] ?? "DoneLayer user";
  const { error: bootstrapError } = await client.rpc("rpc_bootstrap_beta_workspace", {
    p_display_name: displayName,
  });
  if (bootstrapError) {
    console.error("Supabase workspace bootstrap failed", {
      code: bootstrapError.code,
      details: bootstrapError.details,
      hint: bootstrapError.hint,
      message: bootstrapError.message,
    });
    await client.auth.signOut({ scope: "local" });
    return noStoreJson({ error: "The workspace could not be loaded." }, { status: 503 });
  }
  return noStoreJson({ destination: "/customer" });
}
