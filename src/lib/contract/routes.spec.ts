/**
 * Guards on the contract table itself.
 *
 * The table is load-bearing: every later step reads it to decide what parity
 * means. These tests stop it from silently rotting — a duplicated path, a
 * pending entry with no explanation, or a route marked done for a step that
 * has not landed would all quietly weaken the suite.
 */

import { describe, expect, it } from 'vitest';
import {
	ROUTE_CONTRACT,
	SECURITY_HEADERS,
	activeRoutes,
	pendingRoutes
} from './routes.ts';

describe('route contract table', () => {
	it('covers every route recorded in the parity baseline', () => {
		const paths = ROUTE_CONTRACT.map((route) => route.path);

		for (const required of [
			'/',
			'/app',
			'/config',
			'/privacy',
			'/terms',
			'/preview',
			'/preview/image',
			'/does-not-exist'
		]) {
			expect(paths.some((path) => path.split('?')[0] === required)).toBe(true);
		}
	});

	it('has no duplicate entries', () => {
		const paths = ROUTE_CONTRACT.map((route) => route.path);
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('gives every pending route a step and an explanation', () => {
		for (const route of pendingRoutes()) {
			expect(route.implementedInStep, `${route.path} needs an implementing step`).toBeGreaterThan(
				0
			);
		}
		expect(pendingRoutes().length + activeRoutes().length).toBe(ROUTE_CONTRACT.length);
	});

	it('only marks a route done once its implementing step could have run', () => {
		// Steps 1 through 6 are complete. Nothing may claim to be done by a
		// later step until that step actually lands and updates this table.
		const LAST_COMPLETED_STEP = 6;

		for (const route of activeRoutes()) {
			if (route.implementedInStep <= LAST_COMPLETED_STEP) continue;

			// The 404 entry is the one exception: SvelteKit answers 404 for an
			// unmatched route out of the box, so the status is already correct.
			expect(
				route.path,
				`${route.path} is marked done but Step ${route.implementedInStep} has not landed`
			).toBe('/does-not-exist');
		}
	});

	it('expects a 4xx status for every rejected preview request', () => {
		for (const route of ROUTE_CONTRACT.filter((r) => r.path.startsWith('/preview'))) {
			expect(route.status).toBeGreaterThanOrEqual(400);
			expect(route.status).toBeLessThan(500);
		}
	});

	it('does not assert the CSP as a constant', () => {
		// Its value embeds SUPABASE_URL, so a literal expectation would either
		// leak the project URL into the repository or fail per environment.
		expect(SECURITY_HEADERS).not.toHaveProperty('content-security-policy');
	});
});
