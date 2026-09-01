import { env } from '$env/dynamic/private';

const MISSING_CONFIG_ERROR = 'Missing SUPABASE_URL / SUPABASE_ANON_KEY';

type ConfigEnvironment = Partial<
	Record<'SUPABASE_URL' | 'SUPABASE_ANON_KEY', string | undefined>
>;

export interface PublicSupabaseConfig {
	supabaseUrl: string;
	supabaseAnonKey: string;
}

/**
 * Validate and select only the two public values the legacy client needs.
 * Accepting the source makes missing-config behavior testable even when CI
 * supplies both variables to the process running the suite.
 */
export function readPublicSupabaseConfig(source: ConfigEnvironment): PublicSupabaseConfig {
	const supabaseUrl = source.SUPABASE_URL;
	const supabaseAnonKey = source.SUPABASE_ANON_KEY;

	if (!supabaseUrl?.trim() || !supabaseAnonKey?.trim()) {
		throw new Error(MISSING_CONFIG_ERROR);
	}

	return { supabaseUrl, supabaseAnonKey };
}

/** Read runtime configuration without exposing the rest of the server environment. */
export function getPublicSupabaseConfig(): PublicSupabaseConfig {
	return readPublicSupabaseConfig(env);
}
