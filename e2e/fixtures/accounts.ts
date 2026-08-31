/**
 * Two-user test fixtures.
 *
 * Steps 15 through 27 need two accounts that are already contacts. This module
 * is the only place that knows how to reach them, so no test invents its own
 * account setup.
 *
 * ## Isolation boundary
 *
 * These accounts live in the **live Supabase project** — the same one the real
 * application uses. There is no separate test project and no local Supabase.
 * Therefore:
 *
 *   - A test must never assume an empty database.
 *   - A test must never read, modify, or delete a row it did not create.
 *   - Every assertion must be scoped to the two fixture accounts.
 *
 * ## Credentials
 *
 * Read from the environment; never committed. Variable names only:
 *
 *   SUPABASE_URL            public project URL (already required by the app)
 *   SUPABASE_ANON_KEY       public anon key   (already required by the app)
 *   PING_E2E_EMAIL_A        email of fixture account A
 *   PING_E2E_PASSWORD_A     password of fixture account A
 *   PING_E2E_EMAIL_B        email of fixture account B
 *   PING_E2E_PASSWORD_B     password of fixture account B
 *
 * ## Why the accounts are created by hand, once
 *
 * The project has Auth *Confirm email* enabled (verified against
 * `/auth/v1/settings`: `mailer_autoconfirm: false`). `signUp` therefore returns
 * no session, so a seed script cannot authenticate as an account it just
 * created. See `docs/SVELTEKIT_PARITY_BASELINE.md`, "Two-user fixture
 * strategy", for the one-time manual setup.
 */

/**
 * Usernames are fixed, not generated.
 *
 * `profiles.username` must match `^[a-z0-9_]{3,20}$` — lowercase, digits and
 * underscore only, no hyphens, 20 characters maximum. Both names below are 10
 * characters, leaving room if a third fixture account is ever needed.
 *
 * They are also permanent: `contacts` has no DELETE policy for accepted rows,
 * so once A and B are contacts they cannot be unlinked. Reusing two durable
 * accounts is the only workable strategy.
 */
export const FIXTURE_USERNAME_A = 'ping_e2e_a';
export const FIXTURE_USERNAME_B = 'ping_e2e_b';

/** Prefix reserved for fixture accounts, so they are recognizable in the data. */
export const FIXTURE_USERNAME_PREFIX = 'ping_e2e_';

export interface FixtureAccount {
	email: string;
	password: string;
	username: string;
}

export interface FixtureCredentials {
	supabaseUrl: string;
	supabaseAnonKey: string;
	a: FixtureAccount;
	b: FixtureAccount;
}

const REQUIRED_VARS = [
	'SUPABASE_URL',
	'SUPABASE_ANON_KEY',
	'PING_E2E_EMAIL_A',
	'PING_E2E_PASSWORD_A',
	'PING_E2E_EMAIL_B',
	'PING_E2E_PASSWORD_B'
] as const;

export type FixtureLookup =
	| { available: true; credentials: FixtureCredentials; reason?: undefined }
	| { available: false; credentials?: undefined; missing: string[]; reason: string };

/**
 * Load fixture credentials from the environment.
 *
 * Returns a discriminated result rather than throwing, so suites can *skip
 * loudly* when credentials are absent instead of failing. Step 5 relies on
 * this: CI without secrets must skip the two-user suite with a visible reason,
 * not go red.
 */
export function loadFixtureCredentials(env: NodeJS.ProcessEnv = process.env): FixtureLookup {
	const missing = REQUIRED_VARS.filter((name) => !env[name]);

	if (missing.length > 0) {
		return {
			available: false,
			missing,
			reason:
				`Two-user fixtures unavailable: missing ${missing.join(', ')}. ` +
				`See docs/SVELTEKIT_PARITY_BASELINE.md > "Two-user fixture strategy" ` +
				`for the one-time account setup.`
		};
	}

	return {
		available: true,
		credentials: {
			supabaseUrl: env.SUPABASE_URL!,
			supabaseAnonKey: env.SUPABASE_ANON_KEY!,
			a: {
				email: env.PING_E2E_EMAIL_A!,
				password: env.PING_E2E_PASSWORD_A!,
				username: env.PING_E2E_USERNAME_A ?? FIXTURE_USERNAME_A
			},
			b: {
				email: env.PING_E2E_EMAIL_B!,
				password: env.PING_E2E_PASSWORD_B!,
				username: env.PING_E2E_USERNAME_B ?? FIXTURE_USERNAME_B
			}
		}
	};
}

/** Load `.env` into `process.env` if present. No-op when the file is absent. */
export function loadDotEnv(path = '.env'): void {
	try {
		process.loadEnvFile(path);
	} catch {
		// Absent or unreadable: the caller reports missing variables instead.
	}
}
