import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type AppRole = "CUSTOMER" | "PROVIDER" | "ADMIN";

export interface Actor {
  id: string;
  name: string;
  role: AppRole;
}

const COOKIE_NAME = "dl-demo-session";
const DEMO_ACTORS: Record<AppRole, Actor> = {
  CUSTOMER: { id: "customer-nick", name: "Nick Demo", role: "CUSTOMER" },
  PROVIDER: { id: "provider-alpha", name: "Provider Alpha", role: "PROVIDER" },
  ADMIN: { id: "admin-demo", name: "DoneLayer Admin", role: "ADMIN" }
};

function sessionSecret(): string {
  const configured = process.env.DEMO_SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DEMO_SESSION_SECRET must contain at least 32 characters in production.");
  }
  return "donelayer-local-demo-secret-only-do-not-use-in-production";
}

function signature(encodedPayload: string): string {
  return createHmac("sha256", sessionSecret()).update(encodedPayload).digest("base64url");
}

export function createDemoSession(role: AppRole): string {
  const payload = Buffer.from(JSON.stringify({ role, issuedAt: Date.now() }), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function parseDemoSession(value: string | undefined): Actor | null {
  if (!value) return null;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(suppliedSignature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown; issuedAt?: unknown };
    if (typeof decoded.issuedAt !== "number" || Date.now() - decoded.issuedAt > 7 * 24 * 60 * 60 * 1000) return null;
    if (decoded.role !== "CUSTOMER" && decoded.role !== "PROVIDER" && decoded.role !== "ADMIN") return null;
    return DEMO_ACTORS[decoded.role];
  } catch {
    return null;
  }
}

export async function getActor(): Promise<Actor | null> {
  if (process.env.APP_MODE === "supabase") {
    const { getSupabaseActor } = await import("./supabase-auth");
    return getSupabaseActor();
  }
  const cookieStore = await cookies();
  return parseDemoSession(cookieStore.get(COOKIE_NAME)?.value);
}

export function getDemoActor(role: AppRole): Actor {
  return DEMO_ACTORS[role];
}

export const demoSessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  }
};
