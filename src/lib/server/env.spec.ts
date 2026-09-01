import { describe, expect, it } from 'vitest';
import { readPublicSupabaseConfig } from './env.ts';

describe('public Supabase configuration', () => {
	it('selects exactly the two values the browser needs', () => {
		expect(
			readPublicSupabaseConfig({
				SUPABASE_URL: 'https://example.supabase.co',
				SUPABASE_ANON_KEY: 'placeholder-anon-key',
				SERVER_ONLY_SECRET: 'must-not-leak'
			} as Parameters<typeof readPublicSupabaseConfig>[0])
		).toEqual({
			supabaseUrl: 'https://example.supabase.co',
			supabaseAnonKey: 'placeholder-anon-key'
		});
	});

	it.each([
		['SUPABASE_URL', { SUPABASE_ANON_KEY: 'placeholder-anon-key' }],
		['SUPABASE_ANON_KEY', { SUPABASE_URL: 'https://example.supabase.co' }],
		[
			'blank values',
			{ SUPABASE_URL: '   ', SUPABASE_ANON_KEY: 'placeholder-anon-key' }
		]
	])('rejects missing %s configuration', (_label, source) => {
		expect(() => readPublicSupabaseConfig(source)).toThrow(
			'Missing SUPABASE_URL / SUPABASE_ANON_KEY'
		);
	});
});
