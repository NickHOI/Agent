import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Actor, AppRole } from "./auth";

function roleFromAppMetadata(value: unknown): AppRole | null {
  return value === "CUSTOMER" || value === "PROVIDER" || value === "ADMIN" ? value : null;
}

export async function getSupabaseActor(): Promise<Actor | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase mode requires URL and publishable key configuration.");
  const cookieStore = await cookies();
  const client = createServerClient(url, publishableKey, {
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
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const role = roleFromAppMetadata(data.user.app_metadata.role);
  if (!role) return null;
  return { id: data.user.id, name: data.user.email ?? "DoneLayer user", role };
}
