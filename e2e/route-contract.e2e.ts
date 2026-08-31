/**
 * The Step 1 route contract, as executable assertions.
 *
 * Every entry in `ROUTE_CONTRACT` produces one test. Entries whose migration
 * step has not landed are `test.fixme` — reported as pending with a reason,
 * never as a failure. When a later step implements a route it flips `done` to
 * true in `src/lib/contract/routes.ts` and the real assertion starts running.
 *
 * This is the mechanism the plan asks for: "initially marking only genuinely
 * unimplemented SvelteKit behavior as pending".
 */

import { expect, test, type APIResponse } from '@playwright/test';
import {
	ROUTE_CONTRACT,
	SECURITY_HEADERS,
	SECURITY_HEADERS_DONE,
	SECURITY_HEADERS_STEP,
	type BodyExpectation,
	type RouteContract
} from '../src/lib/contract/routes.ts';

async function assertBody(response: APIResponse, expected: BodyExpectation, path: string) {
	switch (expected.kind) {
		case 'html': {
			const text = await response.text();
			expect(text.trim().slice(0, expected.startsWith.length).toLowerCase()).toBe(
				expected.startsWith
			);
			break;
		}
		case 'json': {
			const body = await response.json();
			expect(Object.keys(body).sort(), `${path} must expose exactly these keys`).toEqual(
				[...expected.keys].sort()
			);
			break;
		}
		case 'json-has-keys': {
			const body = await response.json();
			for (const key of expected.keys) {
				expect(body, `${path} must contain "${key}"`).toHaveProperty(key);
			}
			break;
		}
		case 'text': {
			expect((await response.body()).byteLength).toBeGreaterThan(0);
			break;
		}
		case 'any':
			expect(response.status()).toBeGreaterThan(0);
			break;
	}
}

test.describe('route contract', () => {
	for (const route of ROUTE_CONTRACT satisfies RouteContract[]) {
		const title = `${route.path} -> ${route.status} ${route.contentType}`;

		test(title, async ({ request }) => {
			test.fixme(
				!route.done,
				`Pending Step ${route.implementedInStep}. ${route.note ?? ''}`.trim()
			);

			const response = await request.get(route.path, { maxRedirects: 0 });

			expect(response.status(), `${route.path} status`).toBe(route.status);
			expect(
				response.headers()['content-type'] ?? '',
				`${route.path} content-type`
			).toContain(route.contentType);

			await assertBody(response, route.body, route.path);
		});
	}
});

test.describe('security headers', () => {
	for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
		test(`${header} is set on every response`, async ({ request }) => {
			test.fixme(
				!SECURITY_HEADERS_DONE,
				`Pending Step ${SECURITY_HEADERS_STEP}: security headers are not ported yet.`
			);

			const response = await request.get('/');
			expect(response.headers()[header]).toBe(value);
		});
	}

	test('content-security-policy is present and restrictive', async ({ request }) => {
		test.fixme(
			!SECURITY_HEADERS_DONE,
			`Pending Step ${SECURITY_HEADERS_STEP}: security headers are not ported yet.`
		);

		const csp = (await request.get('/')).headers()['content-security-policy'] ?? '';

		// Asserted structurally, not literally: the connect-src origins are
		// derived from SUPABASE_URL and so differ per environment.
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain("base-uri 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
	});
});

test.describe('redirects', () => {
	test('no public route issues an HTTP redirect', async ({ request }) => {
		// True of FastAPI today and cheap to keep true. Runs now because it
		// holds for the current SvelteKit build as well.
		for (const route of ROUTE_CONTRACT.filter((r) => r.done)) {
			const status = (await request.get(route.path, { maxRedirects: 0 })).status();
			expect(status >= 300 && status < 400, `${route.path} must not redirect (got ${status})`).toBe(
				false
			);
		}
	});
});

test.describe('static asset caching', () => {
	test('conditional requests still return 304', async ({ request }) => {
		// Losing this re-downloads every font and icon on each navigation, so
		// it is worth asserting from the very first step that serves assets.
		const first = await request.get('/style.css');
		expect(first.status()).toBe(200);

		const etag = first.headers()['etag'];
		expect(etag, '/style.css must carry an ETag').toBeTruthy();

		const second = await request.get('/style.css', { headers: { 'If-None-Match': etag } });
		expect(second.status()).toBe(304);
	});
});
