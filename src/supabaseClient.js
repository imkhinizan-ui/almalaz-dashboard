import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase env vars missing");
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

export const TRANSACTIONS_TABLE = "transactions";
export const SETTINGS_TABLE = "project_settings";

export async function loginAppUser(username, password) {
  const { data, error } = await supabase.rpc("login_app_user", {
    p_username: username,
    p_password: password,
  });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
}

