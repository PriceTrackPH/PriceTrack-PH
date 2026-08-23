import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const hasSupabaseConfig = Boolean(
  supabaseUrl && publishableKey && publishableKey !== "replace_with_your_publishable_key",
);

export const supabase = hasSupabaseConfig
  ? createClient<Database>(supabaseUrl!, publishableKey!, {
      auth: { persistSession: false },
    })
  : null;
