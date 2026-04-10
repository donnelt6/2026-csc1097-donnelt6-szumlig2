import { createClient } from "@supabase/supabase-js";
import { createE2ESupabaseClient } from "./e2eAuth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const e2eTestMode = process.env.NEXT_PUBLIC_E2E_TEST_MODE === "true";

if (!e2eTestMode && (!supabaseUrl || !supabaseAnonKey)) {
  // eslint-disable-next-line no-console
  console.warn("Supabase environment variables are not set. Auth flows will be disabled until configured.");
}

// E2E runs use a tiny in-browser auth shim so the real UI can authenticate without a live Supabase project.
export const supabase = e2eTestMode
  ? createE2ESupabaseClient()
  : supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : undefined;

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return null;
  }
  return data.session?.access_token ?? null;
}
