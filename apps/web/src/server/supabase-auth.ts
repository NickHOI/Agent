import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Actor, AppRole } from "./auth";

function roleFromAppMetadata(value: unknown): AppRole | null {
  return value === "CUSTOMER" || value === "PROVIDER" || value === "ADMIN" ? value : null;
}

export async function createSupabaseUserClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase mode requires URL and publishable key configuration.");
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          for (const value of values) cookieStore.set(value.name, value.value, value.options);
        } catch {
          // Server Components cannot always update cookies; Route Handlers can.
        }
      }
    }
  });
}

export function createSupabaseCommandClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error("AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE");
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export async function getSupabaseActor(): Promise<Actor | null> {
  const client = await createSupabaseUserClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("display_name, profile_roles(role)")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  if (profileError) return null;
  const roles = Array.isArray(profile?.profile_roles)
    ? profile.profile_roles
        .map((entry) => roleFromAppMetadata((entry as { role?: unknown }).role))
        .filter((role): role is AppRole => role !== null)
    : [];
  const role = roles.includes("CUSTOMER")
    ? "CUSTOMER"
    : roles.includes("PROVIDER")
      ? "PROVIDER"
      : roles.includes("ADMIN")
        ? "ADMIN"
        : roleFromAppMetadata(data.user.app_metadata.role);
  if (!role) return null;
  return {
    id: data.user.id,
    name: typeof profile?.display_name === "string"
      ? profile.display_name
      : data.user.email ?? "DoneLayer user",
    role,
  };
}

export async function hasSupabaseRole(role: AppRole): Promise<boolean> {
  const client = await createSupabaseUserClient();
  const { data, error } = await client
    .from("profile_roles")
    .select("role")
    .eq("role", role)
    .limit(1);
  return !error && Boolean(data?.length);
}
