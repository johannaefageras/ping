import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeEnv = vi.hoisted(() => ({}) as Record<string, string | undefined>);

vi.mock('$env/dynamic/private', () => ({ env: runtimeEnv }));

import { GET } from './+server.ts';

const requestEvent = {} as Parameters<typeof GET>[0];

describe('GET /config', () => {
	beforeEach(() => {
		for (const key of Object.keys(runtimeEnv)) delete runtimeEnv[key];
		Object.assign(runtimeEnv, {
			SUPABASE_URL: 'https://example.supabase.co',
			SUPABASE_ANON_KEY: 'placeholder-anon-key',
			SERVER_ONLY_SECRET: 'must-not-leak'
		});
	});

	it('matches the legacy JSON and cache contract', async () => {
		const response = await GET(requestEvent);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(response.headers.get('cache-control')).toBeNull();
		expect(await response.json()).toEqual({
			supabaseUrl: 'https://example.supabase.co',
			supabaseAnonKey: 'placeholder-anon-key'
		});
	});

	it('fails when runtime configuration is missing even if the test process is configured', () => {
		delete runtimeEnv.SUPABASE_ANON_KEY;

		expect(() => GET(requestEvent)).toThrow('Missing SUPABASE_URL / SUPABASE_ANON_KEY');
	});
});
