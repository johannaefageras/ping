/**
 * Seed and clean the two-user end-to-end fixtures.
 *
 *   npm run test:fixtures:seed    ensure A and B exist and are contacts
 *   npm run test:fixtures:clean   remove messages exchanged by A and B
 *   npm run test:fixtures:check   report fixture state without changing it
 *
 * Both `seed` and `clean` are idempotent: running either twice in a row
 * succeeds and the second run is a no-op.
 *
 * ## The failure mode this script is written against
 *
 * A PostgREST write blocked by RLS returns **success with zero rows affected**,
 * not an error. Every mutation here is therefore followed by a read that
 * asserts the intended state actually holds. Nothing trusts a 2xx.
 *
 * ## What cleanup cannot remove
 *
 * See `docs/SVELTEKIT_PARITY_BASELINE.md` > "What fixture cleanup cannot
 * remove". In short: `invites`, `file_archive`, and `storage.objects` have no
 * DELETE policy for any authorized client, so invite rows and uploaded files
 * accumulate permanently. Removing them would require a schema change or a
 * service-role key, both barred by the migration rules. Tests must therefore
 * upload only small fixture files.
 */

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import {
	loadDotEnv,
	loadFixtureCredentials,
	type FixtureAccount,
	type FixtureCredentials
} from '../e2e/fixtures/accounts.ts';

interface Session {
	label: string;
	username: string;
	client: SupabaseClient;
	user: User;
}

const log = (message: string) => console.log(message);
const fail = (message: string): never => {
	console.error(`\n✖ ${message}\n`);
	process.exit(1);
};

const MANUAL_SETUP_HELP = `
The fixture accounts must be created by hand, once. Auth *Confirm email* is
enabled on this project, so signUp returns no session and this script cannot
create them unattended.

Use the application's own signup form, which sends the username metadata that
the on_auth_user_created trigger requires. The dashboard's "Add user" dialog
cannot do this: it has no user-metadata field, so accounts created there get
no profile row.

    uvicorn server:app --reload      # then sign up at http://localhost:8000
    #   usernames: ping_e2e_a and ping_e2e_b

Then confirm both in the SQL editor, since the emailed link depends on the
Site URL setting:

    update auth.users set email_confirmed_at = now()
     where email in ('<A>', '<B>') and email_confirmed_at is null;

Then put their credentials in .env (never commit them):

    PING_E2E_EMAIL_A=...
    PING_E2E_PASSWORD_A=...
    PING_E2E_EMAIL_B=...
    PING_E2E_PASSWORD_B=...
`;

/** Sign in as one fixture account. Never logs the email or password. */
async function signIn(
	credentials: FixtureCredentials,
	account: FixtureAccount,
	label: string
): Promise<Session> {
	const client = createClient(credentials.supabaseUrl, credentials.supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});

	const { data, error } = await client.auth.signInWithPassword({
		email: account.email,
		password: account.password
	});

	if (error || !data.session) {
		fail(
			`Could not sign in as fixture account ${label} (${account.username}): ` +
				`${error?.message ?? 'no session returned'}.\n${MANUAL_SETUP_HELP}`
		);
	}

	return { label, username: account.username, client, user: data!.user! };
}

/**
 * Assert the signed-in user's profile carries the expected username.
 *
 * A mismatch means the account was created without the right metadata, which
 * would make every later assertion look at the wrong rows.
 */
async function assertProfile(session: Session): Promise<void> {
	const { data, error } = await session.client
		.from('profiles')
		.select('id, username')
		.eq('id', session.user.id)
		.maybeSingle();

	if (error) fail(`Reading profile for ${session.label} failed: ${error.message}`);
	if (!data) {
		fail(
			`Account ${session.label} has no profiles row. The on_auth_user_created ` +
				`trigger only fires when signup metadata carries a username.\n${MANUAL_SETUP_HELP}`
		);
	}
	if (data!.username !== session.username) {
		fail(
			`Account ${session.label} has username "${data!.username}", expected ` +
				`"${session.username}". Fix the account's metadata or set ` +
				`PING_E2E_USERNAME_${session.label} to match.`
		);
	}

	log(`  ✓ ${session.label}: profile "${data!.username}" present`);
}

/** Return the accepted contact row id between the two users, if any. */
async function acceptedContactId(session: Session, otherId: string): Promise<string | null> {
	const { data, error } = await session.client
		.from('contacts')
		.select('id, status, requester_id, addressee_id')
		.or(
			`and(requester_id.eq.${session.user.id},addressee_id.eq.${otherId}),` +
				`and(requester_id.eq.${otherId},addressee_id.eq.${session.user.id})`
		);

	if (error) fail(`Reading contacts for ${session.label} failed: ${error.message}`);

	const accepted = (data ?? []).find((row) => row.status === 'accepted');
	return accepted ? accepted.id : null;
}

/**
 * Ensure A and B are accepted contacts, using the production invite RPCs.
 *
 * `redeem_invite` already handles every re-run case — it promotes a pending
 * row, leaves an accepted row alone, and treats "already contacts" as success
 * — so this needs no parallel setup path of its own.
 */
async function ensureContact(a: Session, b: Session): Promise<void> {
	if (await acceptedContactId(a, b.user.id)) {
		log('  ✓ contact: already accepted, nothing to do');
		return;
	}

	log('  … contact: not accepted yet, running create_invite / redeem_invite');

	const { data: invite, error: inviteError } = await a.client.rpc('create_invite');
	if (inviteError) fail(`create_invite failed for A: ${inviteError.message}`);

	const token = Array.isArray(invite) ? invite[0]?.id : (invite as { id?: string })?.id;
	if (!token) fail('create_invite returned no token. Check the RPC grant for authenticated.');

	const { data: redeemed, error: redeemError } = await b.client.rpc('redeem_invite', {
		p_token: token
	});
	if (redeemError) fail(`redeem_invite failed for B: ${redeemError.message}`);

	const status = Array.isArray(redeemed)
		? redeemed[0]?.status
		: (redeemed as { status?: string })?.status;
	if (status !== 'ok') fail(`redeem_invite returned status "${status}", expected "ok".`);

	// Do not trust the 2xx: confirm the accepted row is actually visible to both.
	const fromA = await acceptedContactId(a, b.user.id);
	const fromB = await acceptedContactId(b, a.user.id);
	if (!fromA || !fromB) {
		fail(
			`redeem_invite reported ok but no accepted contact row is visible ` +
				`(A sees ${fromA ?? 'none'}, B sees ${fromB ?? 'none'}). ` +
				`This is the RLS "success with zero rows" failure mode.`
		);
	}

	log('  ✓ contact: accepted in both directions');
}

/** Ping rows between the two fixture accounts that this session can still see. */
async function visiblePings(session: Session, otherId: string): Promise<string[]> {
	const { data, error } = await session.client
		.from('pings')
		.select('id')
		.or(
			`and(sender_id.eq.${session.user.id},receiver_id.eq.${otherId}),` +
				`and(sender_id.eq.${otherId},receiver_id.eq.${session.user.id})`
		);

	if (error) fail(`Reading pings for ${session.label} failed: ${error.message}`);
	return (data ?? []).map((row) => row.id as string);
}

/**
 * Dismiss every message between A and B, from both sides.
 *
 * `dismiss_ping` sets one per-side flag and hard-deletes the row only when
 * both are set, so a single-sided pass would leave every row in place and
 * still visible to the other account. The order matters: A's pass hides rows
 * from A, and B's pass then completes the deletion.
 */
async function cleanMessages(a: Session, b: Session): Promise<void> {
	for (const [session, other] of [
		[a, b],
		[b, a]
	] as const) {
		const ids = await visiblePings(session, other.user.id);
		log(`  … ${session.label}: dismissing ${ids.length} message(s)`);

		for (const id of ids) {
			const { error } = await session.client.rpc('dismiss_ping', { p_id: id });
			if (error) fail(`dismiss_ping(${id}) failed for ${session.label}: ${error.message}`);
		}
	}

	// Assert the end state rather than trusting the RPC's success responses.
	const remainingA = await visiblePings(a, b.user.id);
	const remainingB = await visiblePings(b, a.user.id);
	if (remainingA.length > 0 || remainingB.length > 0) {
		fail(
			`Cleanup left messages behind (A sees ${remainingA.length}, ` +
				`B sees ${remainingB.length}). Both sides must dismiss before a row is deleted.`
		);
	}

	log('  ✓ messages: none remain visible to either account');
}

/** Report what cleanup deliberately leaves behind, so it is never a surprise. */
async function reportUncleanable(a: Session, b: Session): Promise<void> {
	const { count: inviteCount } = await a.client
		.from('invites')
		.select('id', { count: 'exact', head: true });

	const { count: archiveCount } = await a.client
		.from('file_archive')
		.select('id', { count: 'exact', head: true })
		.or(`sender_id.eq.${b.user.id},receiver_id.eq.${b.user.id}`);

	log(
		`  ℹ retained by design: ${inviteCount ?? '?'} invite row(s) visible to A, ` +
			`${archiveCount ?? '?'} archived file(s) for the pair.`
	);
	log('    No client-authorized DELETE exists for either. See the parity document.');
}

async function withSessions(fn: (a: Session, b: Session) => Promise<void>): Promise<void> {
	loadDotEnv();
	const lookup = loadFixtureCredentials();
	if (!lookup.available) fail(lookup.reason + '\n' + MANUAL_SETUP_HELP);

	const credentials = lookup.credentials!;
	const a = await signIn(credentials, credentials.a, 'A');
	const b = await signIn(credentials, credentials.b, 'B');

	try {
		await fn(a, b);
	} finally {
		await a.client.auth.signOut();
		await b.client.auth.signOut();
	}
}

const commands: Record<string, () => Promise<void>> = {
	async seed() {
		log('Seeding two-user fixtures…');
		await withSessions(async (a, b) => {
			await assertProfile(a);
			await assertProfile(b);
			await ensureContact(a, b);
		});
		log('\n✓ Fixtures ready.');
	},

	async clean() {
		log('Cleaning two-user fixtures…');
		await withSessions(async (a, b) => {
			await cleanMessages(a, b);
			await reportUncleanable(a, b);
		});
		log('\n✓ Cleanup complete.');
	},

	async check() {
		log('Checking two-user fixtures…');
		await withSessions(async (a, b) => {
			await assertProfile(a);
			await assertProfile(b);
			const contact = await acceptedContactId(a, b.user.id);
			log(`  ${contact ? '✓' : '✖'} contact: ${contact ? 'accepted' : 'NOT accepted — run seed'}`);
			log(`  ℹ messages between the pair: ${(await visiblePings(a, b.user.id)).length} visible to A`);
			await reportUncleanable(a, b);
		});
	}
};

const command = process.argv[2];
if (!command || !(command in commands)) {
	console.error(`Usage: node scripts/e2e-fixtures.ts <${Object.keys(commands).join('|')}>`);
	process.exit(2);
}

await commands[command]();
