/**
 * Minimal application smoke path, and the two-user fixture proof.
 *
 * The signed-out smoke test runs today. The two-user test needs fixture
 * credentials and *skips loudly* without them — Step 5 gates it on CI secrets
 * and requires the skip to be visible rather than silent.
 *
 * This file exists mainly to prove the fixture plumbing works end to end
 * before Steps 15 through 27 depend on it. It deliberately tests the fixture
 * contract (two accounts, already contacts, reachable through the anon key),
 * not the UI, which does not exist in SvelteKit yet.
 */

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { loadDotEnv, loadFixtureCredentials } from './fixtures/accounts.ts';

/** Step that gives SvelteKit a real application shell to smoke test. */
const APP_SHELL_STEP = 13;
const APP_SHELL_DONE = false;

test.describe('signed-out smoke path', () => {
	test('the app shell loads and offers a way in', async ({ page }) => {
		test.fixme(
			!APP_SHELL_DONE,
			`Pending Step ${APP_SHELL_STEP}: the SvelteKit app shell does not exist yet.`
		);

		await page.goto('/app');
		// The legacy shell shows the auth view to a signed-out visitor. Swedish
		// strings are preserved verbatim by a migration rule, so they are safe
		// to assert on.
		await expect(page.getByRole('button', { name: /logga in/i })).toBeVisible();
	});
});

test.describe('two-user fixtures', () => {
	loadDotEnv();
	const lookup = loadFixtureCredentials();

	// Skip *loudly*. Playwright's list reporter prints a bare "-" and swallows
	// the skip reason, so an unconfigured CI run would look like a clean pass.
	// Writing to stderr at collection time makes the gap impossible to miss.
	if (!lookup.available) {
		console.warn(`\n⚠ SKIPPING two-user suite — ${lookup.reason}\n`);
	}
	test.skip(!lookup.available, lookup.available ? '' : lookup.reason);

	test('A and B exist, are contacts, and can be reached with the anon key', async () => {
		const { supabaseUrl, supabaseAnonKey, a, b } = lookup.credentials!;

		const clientFor = async (email: string, password: string) => {
			const client = createClient(supabaseUrl, supabaseAnonKey, {
				auth: { persistSession: false, autoRefreshToken: false }
			});
			const { data, error } = await client.auth.signInWithPassword({ email, password });
			expect(error, 'fixture sign-in must succeed; run npm run test:fixtures:seed').toBeNull();
			expect(data.session, 'fixture sign-in must return a session').not.toBeNull();
			return { client, userId: data.user!.id };
		};

		const sessionA = await clientFor(a.email, a.password);
		const sessionB = await clientFor(b.email, b.password);

		try {
			const { data: profiles, error } = await sessionA.client
				.from('profiles')
				.select('id, username')
				.in('id', [sessionA.userId, sessionB.userId]);

			expect(error).toBeNull();
			expect(profiles?.map((p) => p.username).sort()).toEqual([a.username, b.username].sort());

			const { data: contacts } = await sessionA.client
				.from('contacts')
				.select('status, requester_id, addressee_id')
				.or(
					`and(requester_id.eq.${sessionA.userId},addressee_id.eq.${sessionB.userId}),` +
						`and(requester_id.eq.${sessionB.userId},addressee_id.eq.${sessionA.userId})`
				);

			expect(
				contacts?.some((row) => row.status === 'accepted'),
				'A and B must be accepted contacts; run npm run test:fixtures:seed'
			).toBe(true);
		} finally {
			await sessionA.client.auth.signOut();
			await sessionB.client.auth.signOut();
		}
	});
});
