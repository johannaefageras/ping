/**
 * Critical public navigation.
 *
 * These are the pages a signed-out visitor can reach. They must render, must
 * not report console errors, and must not violate their own CSP. Assertions
 * that depend on the legacy shell being served by SvelteKit are pending until
 * Step 10.
 */

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** Step that makes SvelteKit serve the legacy pages. */
const LEGACY_PAGES_STEP = 10;
const LEGACY_PAGES_DONE = false;

/** Collect console errors and CSP violations for the lifetime of a page. */
function watchForErrors(page: Page): string[] {
	const problems: string[] = [];

	page.on('console', (message: ConsoleMessage) => {
		if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
	});
	page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

	return problems;
}

test.describe('public pages', () => {
	test('/ renders without console errors', async ({ page }) => {
		const problems = watchForErrors(page);

		const response = await page.goto('/');
		expect(response?.status()).toBe(200);
		await expect(page.locator('body')).toBeVisible();

		expect(problems, 'no console errors on /').toEqual([]);
	});

	for (const path of ['/privacy', '/terms']) {
		test(`${path} renders without console errors`, async ({ page }) => {
			test.fixme(
				!LEGACY_PAGES_DONE,
				`Pending Step ${LEGACY_PAGES_STEP}: SvelteKit does not serve the legal pages yet.`
			);

			const problems = watchForErrors(page);

			const response = await page.goto(path);
			expect(response?.status()).toBe(200);
			await expect(page.locator('body')).toBeVisible();

			expect(problems, `no console errors on ${path}`).toEqual([]);
		});
	}

	test('an unknown path returns 404', async ({ page }) => {
		const response = await page.goto('/this-route-does-not-exist');
		expect(response?.status()).toBe(404);
	});

	test('/app serves the same shell as /', async ({ page }) => {
		test.fixme(
			!LEGACY_PAGES_DONE,
			`Pending Step ${LEGACY_PAGES_STEP}: /app is not served by SvelteKit yet. ` +
				`Under FastAPI it is byte-identical to /.`
		);

		const root = await (await page.request.get('/')).text();
		const app = await (await page.request.get('/app')).text();
		expect(app).toBe(root);
	});
});

test.describe('progressive web app', () => {
	test('the manifest is reachable and well formed', async ({ request }) => {
		const response = await request.get('/assets/manifest/manifest.webmanifest');
		expect(response.status()).toBe(200);

		const manifest = await response.json();
		expect(manifest.start_url, 'start_url must stay stable across the migration').toBeTruthy();
		expect(Array.isArray(manifest.icons)).toBe(true);
		expect(manifest.icons.length).toBeGreaterThan(0);
	});

	test('the service worker script is served as JavaScript', async ({ request }) => {
		// Step 26 replaces the worker itself; until then it must stay reachable
		// or installed clients break.
		const response = await request.get('/sw.js');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type'] ?? '').toContain('javascript');
	});
});
