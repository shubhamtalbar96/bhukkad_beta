import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Service-role client. Bypasses row-level security, so it is used only for account deletion.
// Requires SUPABASE_SERVICE_ROLE_KEY in the server environment (never NEXT_PUBLIC_).
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !env.supabaseUrl) return null;
  return createClient(env.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
