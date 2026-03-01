import { createClient } from '@supabase/supabase-js';
import { proxyFetch } from './utils/vscode';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: false // We rely on VS Code SecretStorage
    },
    global: {
        // VERY IMPORTANT: Proxies Supabase REST calls through the Extension Host
        // to bypass Webview Content Security Policy constraints
        fetch: proxyFetch as any
    }
});
