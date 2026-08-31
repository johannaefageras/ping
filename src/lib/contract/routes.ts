/**
 * The public route contract, transcribed from `docs/SVELTEKIT_PARITY_BASELINE.md`.
 *
 * This is the single source of truth the Playwright contract suite iterates.
 * Each entry records what FastAPI does today and which migration step makes
 * SvelteKit do the same. Entries whose `implementedInStep` has not landed yet
 * are reported as *pending*, not as failures — that distinction is Step 4's
 * whole point, so a later step can flip `done: true` and immediately see the
 * real assertion run.
 *
 * When a step implements a route, set `done: true` here. Do not weaken an
 * expectation to make a test pass; a genuine difference belongs in the
 * "Approved intentional differences" section of the parity document.
 */

/** Body shape assertions, kept coarse enough to survive content edits. */
export type BodyExpectation =
	| { kind: 'html'; startsWith: string }
	| { kind: 'json'; keys: string[] }
	| { kind: 'json-has-keys'; keys: string[] }
	| { kind: 'text' }
	| { kind: 'any' };

export interface RouteContract {
	/** Request path, including any query string. */
	path: string;
	/** Expected HTTP status from the FastAPI baseline. */
	status: number;
	/** Expected `content-type`, matched as a prefix so charset changes pass. */
	contentType: string;
	body: BodyExpectation;
	/** Migration step that ports this route to SvelteKit. */
	implementedInStep: number;
	/** Flip to true when that step lands; until then the test is pending. */
	done: boolean;
	/** Why it is pending, or which approved difference applies. */
	note?: string;
}

/**
 * Security headers FastAPI sets identically on every response.
 *
 * `content-security-policy` is deliberately absent: its value embeds
 * `SUPABASE_URL` twice (https + wss origins), so it cannot be asserted as a
 * constant. Step 11 asserts its structure instead.
 */
export const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-frame-options': 'DENY',
	'permissions-policy': 'geolocation=(), microphone=(self), camera=(self), interest-cohort=()',
	'strict-transport-security': 'max-age=31536000; includeSubDomains'
};

/** Step that ports the security headers to SvelteKit. */
export const SECURITY_HEADERS_STEP = 11;
export const SECURITY_HEADERS_DONE = false;

export const ROUTE_CONTRACT: RouteContract[] = [
	// --- Pages -------------------------------------------------------------
	{
		path: '/',
		status: 200,
		contentType: 'text/html',
		body: { kind: 'html', startsWith: '<!doctype html>' },
		implementedInStep: 10,
		done: false,
		note: 'SvelteKit currently serves the scaffold placeholder, not the app shell.'
	},
	{
		path: '/app',
		status: 200,
		contentType: 'text/html',
		body: { kind: 'html', startsWith: '<!doctype html>' },
		implementedInStep: 10,
		done: false,
		note: 'Byte-identical to / under FastAPI. Step 28 cuts this route over.'
	},
	{
		path: '/privacy',
		status: 200,
		contentType: 'text/html',
		body: { kind: 'html', startsWith: '<!doctype html>' },
		implementedInStep: 10,
		done: false
	},
	{
		path: '/terms',
		status: 200,
		contentType: 'text/html',
		body: { kind: 'html', startsWith: '<!doctype html>' },
		implementedInStep: 10,
		done: false
	},

	// --- Public configuration ----------------------------------------------
	{
		path: '/config',
		status: 200,
		contentType: 'application/json',
		body: { kind: 'json', keys: ['supabaseAnonKey', 'supabaseUrl'] },
		implementedInStep: 6,
		done: false,
		note: 'Exact key set: no other environment value may leak into this response.'
	},

	// --- Link preview -------------------------------------------------------
	{
		path: '/preview?url=ftp://example.com/x',
		status: 400,
		contentType: 'application/json',
		body: { kind: 'json', keys: ['error'] },
		implementedInStep: 8,
		done: false,
		note: 'Non-HTTP scheme is rejected before any outbound request.'
	},
	{
		path: '/preview?url=http://127.0.0.1/',
		status: 400,
		contentType: 'application/json',
		body: { kind: 'json', keys: ['error'] },
		implementedInStep: 8,
		done: false,
		note: 'Loopback is rejected. This is the core SSRF guard.'
	},
	{
		path: '/preview',
		status: 400,
		contentType: 'application/json',
		body: { kind: 'json', keys: ['error'] },
		implementedInStep: 8,
		done: false,
		note: 'AID-3: FastAPI returns 422 + {detail} from FastAPI validation; SvelteKit returns 400 + {error} for consistency with the other rejections.'
	},
	{
		path: '/preview/image?url=http://127.0.0.1/x.png',
		status: 400,
		contentType: 'application/json',
		body: { kind: 'json', keys: ['error'] },
		implementedInStep: 9,
		done: false
	},
	{
		path: '/preview/image',
		status: 400,
		contentType: 'application/json',
		body: { kind: 'json', keys: ['error'] },
		implementedInStep: 9,
		done: false,
		note: 'AID-3, as above.'
	},

	// --- Static assets ------------------------------------------------------
	// Served from static/ by SvelteKit already, so these are live today.
	{
		path: '/style.css',
		status: 200,
		contentType: 'text/css',
		body: { kind: 'text' },
		implementedInStep: 3,
		done: true
	},
	{
		path: '/app.js',
		status: 200,
		contentType: 'text/javascript',
		body: { kind: 'text' },
		implementedInStep: 3,
		done: true
	},
	{
		path: '/sw.js',
		status: 200,
		contentType: 'text/javascript',
		body: { kind: 'text' },
		implementedInStep: 3,
		done: true,
		note: 'Step 26 replaces the service worker itself; the asset must stay reachable until then.'
	},
	{
		path: '/assets/manifest/manifest.webmanifest',
		status: 200,
		contentType: 'application/manifest+json',
		body: {
			kind: 'json-has-keys',
			keys: ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color']
		},
		implementedInStep: 3,
		done: true
	},
	{
		path: '/sitemap.xml',
		status: 200,
		contentType: 'text/xml',
		body: { kind: 'text' },
		implementedInStep: 3,
		done: true,
		note: 'AID-6: FastAPI sends application/xml, adapter-node sends text/xml. Both are valid XML media types and crawlers accept either.'
	},
	{
		path: '/data/emoji-data.json',
		status: 200,
		contentType: 'application/json',
		body: { kind: 'json', keys: ['categories', 'locale', 'version'] },
		implementedInStep: 3,
		done: true
	},

	// --- Not found ----------------------------------------------------------
	{
		path: '/does-not-exist',
		status: 404,
		contentType: 'text/html',
		body: { kind: 'any' },
		implementedInStep: 10,
		done: true,
		note: 'FastAPI answers JSON {detail}; SvelteKit renders an HTML error page. Only the 404 status is contractual — see AID-5.'
	}
];

/** Routes whose implementing step has landed, so their assertions must pass. */
export const activeRoutes = (): RouteContract[] => ROUTE_CONTRACT.filter((r) => r.done);

/** Routes still awaiting a migration step; reported as pending, never failing. */
export const pendingRoutes = (): RouteContract[] => ROUTE_CONTRACT.filter((r) => !r.done);
