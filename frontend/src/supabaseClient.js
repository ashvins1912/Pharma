import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL || "https://supabase.co",
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "your-anon-key"
);

