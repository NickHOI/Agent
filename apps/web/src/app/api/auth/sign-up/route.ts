import { z } from "zod";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { createSupabaseUserClient } from "@/server/supabase-auth";

const inputSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email().max(320),
  password: z.string().min(12).max(200),
}).strict();

export async function POST(request: Request) {
  if (process.env.APP_MODE !== "supabase") {
    return noStoreJson({ error: "Real account creation is unavailable in Demo mode." }, { status: 404 });
  }
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "auth-sign-up", 8);
  if (rateError) return rateError;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({ error: "Enter a name, a valid email, and a password of at least 12 characters." }, { status: 400 });
  }

  const client = await createSupabaseUserClient();
  const { data, error } = await client.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.displayName } },
  });
  if (error) {
    console.error("Supabase sign-up failed", {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    return noStoreJson({ error: friendlyAuthError(error.code, error.message) }, { status: 400 });
  }
  if (!data.session) {
    return noStoreJson({
      confirmationRequired: true,
      message: "Check your email to confirm the account, then sign in.",
    }, { status: 202 });
  }

  const { error: bootstrapError } = await client.rpc("rpc_bootstrap_beta_workspace", {
    p_display_name: parsed.data.displayName,
  });
  if (bootstrapError) {
    await client.auth.signOut({ scope: "local" });
    return noStoreJson({ error: "The workspace could not be initialized." }, { status: 503 });
  }
  return noStoreJson({ destination: "/customer" }, { status: 201 });
}

function friendlyAuthError(code: string | undefined, message: string): string {
  if (/already registered|already exists/i.test(message)) return "An account already exists for this email.";
  if (/password/i.test(message)) return "This password does not meet the project security policy.";
  if (code === "email_address_invalid" || /email address.*invalid/i.test(message)) {
    return "Enter an email address accepted by this validation project.";
  }
  if (code === "email_address_not_authorized" || /not authorized/i.test(message)) {
    return "This validation project cannot send a confirmation email to that address.";
  }
  if (/rate/i.test(message)) return "Too many account attempts. Wait a moment and try again.";
  return "Unable to create the account.";
}
