# Durable Messaging — Plan 2: Disappearing messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-conversation, opt-in disappearing messages (Off / 24h / 7d, either side can set it) — a header timer control, an in-thread confirmation line, a client-side load-time expiry filter, a `set_disappearing` RPC, and a `purge_expired_pings()` function swept daily by `pg_cron`.

**Architecture:** One new additive, idempotent schema section (**12. DISAPPEARING MESSAGES**) adds `contacts.disappearing_ttl interval` (null = off), a `set_disappearing` security-definer RPC authorized to **either** side of the pair (mirroring `dismiss_ping`'s explicit membership check), a `purge_expired_pings()` security-definer function (deletes pings older than their pair's ttl — firing the existing section-8 storage-cleanup trigger), and a `cron.schedule(...)` daily sweep. `purge_expired_pings()` is **NOT** granted to `authenticated` — only the cron/service-role calls it; clients rely on a load-time filter for promptness. Frontend changes are confined to `static/app.js` (a `createPopupMenu`-backed header control, per-pair ttl carried on `selectedContact`, a `set_disappearing` call + `systemLine` confirmation, and an `isExpired()` filter applied in `loadPings`/`loadOlderPings`), `static/index.html` (the header control button + its menu), and `static/style.css` (control + menu styling).

**Tech Stack:** Supabase (Postgres + RLS + Realtime + `pg_cron` via `@supabase/supabase-js`), vanilla HTML/CSS/JS frontend (`static/app.js`, `static/index.html`, `static/style.css`). Backend is FastAPI but is **not touched** by this plan. There is no JS test harness — frontend changes are verified manually against a running app (`uvicorn server:app --reload`) and a scratch Supabase project with two accepted-contact users; the Python tests in `tests/` are backend/link-preview only and are run once at the end to confirm no regression.

**Branching (decided):** This work lands on a **new branch off `main`** named `feat/disappearing-messages`. `main` currently has Plan 1 merged and is several commits ahead of `origin/main` (unpushed — that's fine; branch from `main` as-is). Do not start Task 1 until the branch is cut.

**Two open questions — RESOLVED (do not re-ask):**
1. **`purge_expired_pings()` authorization → cron/service-role only.** Do **NOT** `grant execute … to authenticated`. The client never calls purge directly; it hides expired messages with the load-time filter (Task 4). Smallest attack surface.
2. **`pg_cron` → ship the SQL, defer enabling to the human.** Write `cron.schedule(...)` into schema section 12, but enabling the `pg_cron` extension (Dashboard → Database → Extensions) and applying the cron SQL to the live DB are **deferred human steps** (like Plan 1's REPLICA IDENTITY / live-apply steps). Active users still get prompt expiry via the client filter even before cron runs.

---

## Pre-flight (do once, before Task 1)

- [ ] Confirm you are on `main` with Plan 1 merged. Run: `git checkout main && git log --oneline -3`. Expected: the top commits include the Plan 1 / durable-messaging merge (e.g. `Merge feat/durable-messaging into main`).
- [ ] Cut the working branch. Run: `git checkout -b feat/disappearing-messages`. Expected: `Switched to a new branch 'feat/disappearing-messages'`.
- [ ] Confirm `createPopupMenu` exists (used by Task 6). Run: `grep -n "function createPopupMenu" static/app.js`. Expected: one match around `static/app.js:1933`, returning `{ open, close }`.
- [ ] Confirm `systemLine` exists (used by Task 7). Run: `grep -n "function systemLine" static/app.js`. Expected: one match around `static/app.js:2530`.
- [ ] Confirm schema section 11 is the current tail. Run: `grep -n "12. DISAPPEARING\|11. DURABLE MESSAGING" supabase/schema.sql`. Expected: only the section-11 match (no section 12 yet).

## Environment for verification

Several tasks need a runnable app and a Supabase project with two distinct users who are accepted contacts.

- **App:** `uvicorn server:app --reload`, open <http://localhost:8000>. A `.env` with `SUPABASE_URL` + `SUPABASE_ANON_KEY` must point at the scratch project. The `.venv` already exists.
- **Two sessions:** sign in as user A in a normal window and user B in a private/incognito window (or a second browser). Accept the contact request so A⇄B are accepted contacts. Keep both windows visible side-by-side for the live-timer-change test.
- **SQL:** run schema sections in the Supabase Dashboard → SQL Editor (or `psql`). "Run section twice" means paste-and-run the same block a second time and confirm no error (idempotency).

> **Subagents cannot run the app or apply SQL to Supabase.** A subagent executing a task does the **code + static checks** (`node --check static/app.js`, greps, idempotency reasoning) and marks **live-DB apply** and **two-session runtime checks** as **DEFERRED TO HUMAN**. A subagent must NOT claim it "verified" browser behavior or applied schema to a live project.

---

## File Structure

- **`supabase/schema.sql`** — append a new numbered section **12. DISAPPEARING MESSAGES** after section 11 (which currently ends at `supabase/schema.sql:503`). Holds: the `disappearing_ttl` column add, the `set_disappearing` RPC (security-definer, either-side authorization), the `purge_expired_pings()` function (security-definer, **no** authenticated grant), and the `cron.schedule(...)` registration (wrapped so re-running the section is safe). Mirrors the idempotent, security-definer style of sections 9–11.
- **`static/app.js`** — all client changes:
  - Add `disappearing_ttl` to the `loadContacts()` select and carry it onto `selectedContact`.
  - A `parseTtlSeconds(ttl)` helper (Postgres `interval` → seconds) and an `isExpired(ping, ttlSeconds)` helper.
  - `loadPings` / `loadOlderPings` filter out already-expired rows before rendering.
  - `set_disappearing` call + label refresh + `systemLine` confirmation, wired to a header popup menu built with `createPopupMenu`.
  - A `refreshDisappearingControl()` that renders the control's current-state label, called on chat open and from the contacts realtime path so a remote change reflects live.
- **`static/index.html`** — add the timer control button (`#disappearing-btn`) + its popup menu (`#disappearing-menu`) inside `#chat-header`, immediately before `#gallery-btn` (so it sits at the right edge next to the gallery button).
- **`static/style.css`** — style `#disappearing-btn` (match the `#gallery-btn` icon-button look) and `#disappearing-menu` (reuse the existing popup-menu visual language used by the camera/video menus).
- **`README.md`** — add `set_disappearing` (and a note on `purge_expired_pings` / `pg_cron`) to the setup RPC list; add a feature line. `README.md` adds normally.
- **`FEATURE_IDEAS.md`** — flip "disappearing messages (coming soon)" to shipped. **Gitignored but tracked → `git add -f`.**

> **Docs gitignore convention:** `docs/` (line 37 of `.gitignore`) and `FEATURE_IDEAS.md` (line 47) are gitignored but tracked — commit them with `git add -f`. `supabase/schema.sql` and `README.md` add normally.

> **Note on TDD:** The backend has pytest; the frontend does not. Schema tasks are verified with explicit SQL idempotency + authorization checks (the closest available analog to a failing-then-passing test). Frontend tasks specify exact manual verification steps with expected observed behavior. Follow them literally — do not claim a frontend step passes without performing the described observation. A subagent marks runtime/live-DB steps DEFERRED TO HUMAN.

---

### Task 1: Schema — `disappearing_ttl` column + `set_disappearing` RPC

Add the `contacts.disappearing_ttl` column and the `set_disappearing` security-definer RPC. The RPC must be authorized to **either** side of the pair — unlike Plan 1's `mark_read`/`mark_delivered` (which only needed `receiver_id = auth.uid()`), this needs an explicit membership check because either the requester **or** the addressee may change the timer. This mirrors `dismiss_ping`'s explicit `auth.uid() = v_sender / v_receiver` pattern.

> **Why the RPC is mandatory (the Plan 1 trap):** `contacts` has an UPDATE RLS policy *only* for the addressee changing `status` (`"Addressee can update contact status"`, `supabase/schema.sql:121-125`). A direct client `.update({ disappearing_ttl })` is therefore denied for the requester entirely, and even for the addressee its `with check (addressee_id = auth.uid())` does not authorize a non-addressee. The timer change **must** go through this security-definer RPC — exactly the trap that bit Plan 1's `delivered_at` (`pings` had no UPDATE policy and needed `mark_delivered`).

**Files:**
- Modify: `supabase/schema.sql` (append new section 12 after section 11, which currently ends at `supabase/schema.sql:503`)

- [ ] **Step 1: Append section 12 (column + `set_disappearing`) to the schema**

Add to the end of `supabase/schema.sql`:

```sql
-- ============================================================
-- 12. DISAPPEARING MESSAGES — per-pair TTL + set/purge + pg_cron sweep
-- Idempotent: existing deployments can run just this section.
-- Per-conversation, opt-in disappearing messages: one timer per pair, stored on
-- the single contacts row. disappearing_ttl is a Postgres interval; null = off.
-- Offered values client-side are 24h and 7d. Either side of the pair may change
-- it (set_disappearing, below). Expired messages are hidden client-side at load
-- time (belt) and physically deleted by a daily pg_cron sweep calling
-- purge_expired_pings() (suspenders); deletion fires the section-8 storage
-- cleanup trigger so attached files are removed too.
-- NOTE: contacts has an UPDATE RLS policy ONLY for the addressee changing
-- status, so clients CANNOT update disappearing_ttl directly — it is written
-- exclusively through the set_disappearing security-definer RPC below, matching
-- the dismiss_ping (section 9) mutation pattern with an explicit either-side
-- membership check.
-- ============================================================

alter table public.contacts
  add column if not exists disappearing_ttl interval;  -- null = off

-- set_disappearing: set (or clear) the pair's disappearing-messages timer.
-- p_contact_id is the contacts row id; p_ttl is the new interval (null = off,
-- e.g. '24 hours', '7 days'). Authorized to EITHER side of the pair: the caller
-- must be the requester_id or addressee_id of that row (mirrors dismiss_ping's
-- explicit auth.uid() membership check). Security definer so it can update a row
-- the caller's RLS UPDATE policy would otherwise block.
create or replace function public.set_disappearing(p_contact_id uuid, p_ttl interval)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_requester uuid;
  v_addressee uuid;
begin
  select requester_id, addressee_id
    into v_requester, v_addressee
    from public.contacts
    where id = p_contact_id;

  if not found then
    return;
  end if;

  if auth.uid() <> v_requester and auth.uid() <> v_addressee then
    raise exception 'not authorized';
  end if;

  update public.contacts
    set disappearing_ttl = p_ttl
    where id = p_contact_id;
end;
$$;

grant execute on function public.set_disappearing(uuid, interval) to authenticated;
```

- [ ] **Step 2: Apply the section-12 block (so far) to the scratch Supabase project — DEFERRED TO HUMAN if running as a subagent**

In the Supabase Dashboard → SQL Editor, paste and run the block from Step 1.
Expected: success, no error. `contacts` now has a `disappearing_ttl` column and `set_disappearing` exists.

- [ ] **Step 3: Verify idempotency — run the Step 1 block a second time — DEFERRED TO HUMAN if subagent**

Paste and run the exact same block again.
Expected: success, no error (`add column if not exists` + `create or replace function` are idempotent).

- [ ] **Step 4: Verify the column exists — DEFERRED TO HUMAN if subagent**

Run in SQL Editor:
```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'contacts'
  and column_name = 'disappearing_ttl';
```
Expected: one row — `disappearing_ttl | interval`.

- [ ] **Step 5: Verify `set_disappearing` authorization — DEFERRED TO HUMAN if subagent**

Take an accepted A⇄B `contacts` row id. Authenticated as **A** (a pair member), from the app console run `await sb.rpc('set_disappearing', { p_contact_id: '<row_id>', p_ttl: '24 hours' })`; then:
```sql
select disappearing_ttl from public.contacts where id = '<row_id>';
```
Expected: `24:00:00` (a non-null interval). Run again with `p_ttl: null` → the column is back to null (off). Now, authenticated as a **third user C who is not in the pair**, call `set_disappearing` on that same row id.
Expected: it raises `not authorized` (or the RPC errors) and the row's `disappearing_ttl` is unchanged — a non-member cannot set the timer.

- [ ] **Step 6: Static check — `node --check` is N/A (schema is SQL). Confirm the section parses by eye + grep**

Run: `grep -n "12. DISAPPEARING\|function public.set_disappearing" supabase/schema.sql`
Expected: the section-12 header and the `set_disappearing` function both present.

- [ ] **Step 7: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(schema): add contacts.disappearing_ttl + set_disappearing RPC"
```

> Note: `supabase/` is tracked normally — `git add supabase/schema.sql` (no `-f` needed).

---

### Task 2: Schema — `purge_expired_pings()` + `pg_cron` daily sweep

Add the cleanup function and the cron registration to section 12. `purge_expired_pings()` deletes every ping older than its pair's `disappearing_ttl`. It is **cron/service-role only — do NOT grant execute to `authenticated`** (decided open-question #1). The `cron.schedule(...)` SQL is written here, but **enabling `pg_cron` and applying the cron SQL to the live DB are deferred human steps** (decided open-question #2).

**Files:**
- Modify: `supabase/schema.sql` (continue appending to section 12, after the `set_disappearing` grant from Task 1)

> **How the pair lookup works:** a ping's pair is the unordered `{sender_id, receiver_id}` couple. The matching `contacts` row has `{requester_id, addressee_id}` equal to that couple in either direction. We join on that and delete rows where `now() - created_at > disappearing_ttl`, skipping pairs whose `disappearing_ttl is null` (timer off). Deletion fires the section-8 `on_ping_deleted` trigger, cleaning up any attached storage object.

- [ ] **Step 1: Append `purge_expired_pings()` to section 12**

Add to `supabase/schema.sql`, immediately after the `set_disappearing` grant from Task 1:

```sql
-- purge_expired_pings: physically delete every ping older than its pair's
-- disappearing_ttl. A ping's pair is the unordered {sender_id, receiver_id}
-- couple; the contacts row for that pair has {requester_id, addressee_id} equal
-- to it in either direction. Pairs with a null disappearing_ttl (timer off) are
-- skipped by the inner join + the explicit `is not null` guard. Deletion fires
-- the section-8 on_ping_deleted trigger, so attached storage objects are removed
-- too. Security definer so it can delete across pairs regardless of caller RLS.
-- NOT granted to authenticated: only the daily pg_cron sweep (service role)
-- runs this. Clients rely on the load-time expiry filter for promptness; this
-- function is the suspenders that actually reclaims rows + storage.
create or replace function public.purge_expired_pings()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.pings p
  using public.contacts c
  where c.disappearing_ttl is not null
    and (
      (c.requester_id = p.sender_id and c.addressee_id = p.receiver_id)
      or
      (c.requester_id = p.receiver_id and c.addressee_id = p.sender_id)
    )
    and now() - p.created_at > c.disappearing_ttl;
end;
$$;

-- Intentionally NOT granted to authenticated (open-question #1: cron-only). Only
-- the service role / pg_cron invokes purge_expired_pings(). Do not add a grant.

-- Daily pg_cron sweep. REQUIRES the pg_cron extension to be enabled in the
-- Supabase Dashboard (Database -> Extensions) before this runs — a DEFERRED
-- HUMAN step. The DO block below makes re-running section 12 safe: it unschedules
-- any existing job of the same name first, then schedules a fresh 03:17 UTC daily
-- run. If pg_cron is not yet enabled, this block raises (the `cron` schema does
-- not exist) — that is expected until the human enables the extension; the rest
-- of section 12 (column, set_disappearing, purge_expired_pings) applies fine on
-- its own, and the client-side load-time filter keeps expiry prompt meanwhile.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-expired-pings')
      where exists (select 1 from cron.job where jobname = 'purge-expired-pings');
    perform cron.schedule(
      'purge-expired-pings',
      '17 3 * * *',
      $cron$ select public.purge_expired_pings(); $cron$
    );
  else
    raise notice 'pg_cron not enabled; skipping cron.schedule for purge-expired-pings. Enable the pg_cron extension and re-run section 12.';
  end if;
end;
$$;
```

> **Why the `do $$ … $$` wrapper:** `cron.schedule` errors if the same job name already exists, so a bare re-run of section 12 would fail idempotency. The wrapper unschedules the prior job first. It also tolerates `pg_cron` being disabled (raises a `notice`, not an error), so the rest of section 12 stays idempotent before the human enables the extension. The `$cron$ … $cron$` dollar-quote avoids nesting conflicts with the outer `$$`.

- [ ] **Step 2: Apply the `purge_expired_pings()` + cron block — DEFERRED TO HUMAN if subagent**

With `pg_cron` **enabled** in the Dashboard (Database → Extensions), paste and run the Step 1 block in the SQL Editor.
Expected: success. `purge_expired_pings` exists and a `cron.job` row named `purge-expired-pings` is scheduled. If `pg_cron` is **not** enabled, expect a `NOTICE` ("pg_cron not enabled; skipping …") and the function still created — that is the intended deferred path.

- [ ] **Step 3: Verify idempotency — run the block a second time — DEFERRED TO HUMAN if subagent**

Paste and run it again.
Expected: success, no error (the `do` block unschedules-then-reschedules; `create or replace function` is idempotent). Confirm there is still exactly one job:
```sql
select jobname, schedule, command from cron.job where jobname = 'purge-expired-pings';
```
Expected: exactly one row (no duplicate from the second run). (Skip this sub-check if `pg_cron` is not yet enabled.)

- [ ] **Step 4: Verify `purge_expired_pings()` deletes only expired rows of timer-on pairs — DEFERRED TO HUMAN if subagent**

Set A⇄B's timer to 24h (`set_disappearing` … `'24 hours'`). Seed two A→B pings: one fresh, one back-dated past the ttl:
```sql
-- back-date one existing A->B ping well past 24h:
update public.pings set created_at = now() - interval '2 days'
where id = '<an_A_to_B_ping_id>';
```
Then, **as the service role** (SQL Editor runs as service role by default), run `select public.purge_expired_pings();` and re-query the pair's pings.
Expected: the back-dated ping is **gone**; the fresh ping **remains**. Now set the timer **off** (`set_disappearing` … `null`), back-date another ping past 24h, run `purge_expired_pings()` again.
Expected: that ping **survives** (a null-ttl pair is skipped). If a deleted ping had an attached file, confirm its `storage.objects` row is also gone (section-8 trigger).

- [ ] **Step 5: Verify `purge_expired_pings()` is NOT callable by an ordinary user — DEFERRED TO HUMAN if subagent**

Authenticated as user **A** (an `authenticated` role, not service role), from the app console run `await sb.rpc('purge_expired_pings')`.
Expected: it errors with a permission-denied / function-not-accessible message (no `grant execute … to authenticated` was issued). This confirms the cron-only decision.

- [ ] **Step 6: Static check**

Run: `grep -n "function public.purge_expired_pings\|cron.schedule\|grant execute on function public.purge_expired_pings" supabase/schema.sql`
Expected: the function and the `cron.schedule(...)` call are present; there is **no** `grant execute on function public.purge_expired_pings` line.

- [ ] **Step 7: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(schema): add purge_expired_pings + daily pg_cron sweep (cron-only)"
```

---

### Task 3: Client — carry `disappearing_ttl` from `contacts` onto `selectedContact`

The header control and the load-time filter both need the open pair's current ttl. Load it with the contacts query and stash it on `selectedContact`. `selectContact` is called from `renderContacts`'s click handlers, which only pass `(contactId, recipientId, username, displayName)` — so `selectContact` must look the ttl up from the already-loaded `contacts` array (keyed by the contacts row id) rather than receiving it as a new argument (avoids touching every call site).

**Files:**
- Modify: `static/app.js` — `loadContacts` select (`static/app.js:548-552`); `selectContact` (`static/app.js:773-790`); the `selectedContact` shape comment (`static/app.js:108`)

- [ ] **Step 1: Add `disappearing_ttl` to the `loadContacts` select**

In `loadContacts` (`static/app.js:545`), the select is (`static/app.js:548-552`):

```javascript
    .select(
      `id, status, requester_id, addressee_id, created_at,
       requester:profiles!contacts_requester_id_fkey(username, display_name),
       addressee:profiles!contacts_addressee_id_fkey(username, display_name)`
    )
```

Replace with (add `disappearing_ttl` to the column list):

```javascript
    .select(
      `id, status, requester_id, addressee_id, created_at, disappearing_ttl,
       requester:profiles!contacts_requester_id_fkey(username, display_name),
       addressee:profiles!contacts_addressee_id_fkey(username, display_name)`
    )
```

- [ ] **Step 2: Carry the ttl onto `selectedContact` in `selectContact`**

In `selectContact` (`static/app.js:773-775`), the current head is:

```javascript
async function selectContact(contactId, recipientId, username, displayName) {
  closeFileGallery();
  selectedContact = { contactId, recipientId, username, displayName: displayName || null };
```

Replace with (look the ttl up from the loaded `contacts` array by the contacts row id, default null):

```javascript
async function selectContact(contactId, recipientId, username, displayName) {
  closeFileGallery();
  const contactRow = contacts.find((c) => c.id === contactId);
  selectedContact = {
    contactId,
    recipientId,
    username,
    displayName: displayName || null,
    disappearingTtl: contactRow ? contactRow.disappearing_ttl || null : null,
  };
```

- [ ] **Step 3: Update the `selectedContact` shape comment**

At `static/app.js:108`, the comment is:

```javascript
let selectedContact = null; // { contactId, recipientId, username, displayName }
```

Replace with:

```javascript
let selectedContact = null; // { contactId, recipientId, username, displayName, disappearingTtl }
```

- [ ] **Step 4: Static check**

Run: `node --check static/app.js`
Expected: no output (parses clean).
Run: `grep -n "disappearing_ttl\|disappearingTtl" static/app.js`
Expected: the select now lists `disappearing_ttl`; `selectContact` reads `contactRow.disappearing_ttl` and sets `disappearingTtl`.

- [ ] **Step 5: Manual verification — ttl is carried on chat open — DEFERRED TO HUMAN if subagent**

With A⇄B's timer set to 24h in the DB (`set_disappearing`), run the app as A, open the B chat, and in the console run `selectedContact.disappearingTtl`.
Expected: a truthy interval value (e.g. `"24:00:00"`). With the timer off (null), it reads `null`.

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "feat(disappearing): carry per-pair disappearing_ttl onto selectedContact"
```

---

### Task 4: Client — TTL parsing + load-time expiry filter

Add a `parseTtlSeconds(ttl)` helper that turns a Postgres `interval` (string like `"24:00:00"`, `"7 days"`, or `"1 day 02:00:00"`) into seconds, and an `isExpired(ping, ttlSeconds)` predicate. Filter expired rows out of `loadPings` and `loadOlderPings` before rendering, so expired messages vanish promptly for active users even before the cron runs.

**Files:**
- Modify: `static/app.js` — add `parseTtlSeconds` + `isExpired` near the other small helpers (after `formatDaySeparator`/`dayKey`, e.g. ~`static/app.js` day-separator helper block); `loadPings` (`static/app.js:809-848`); `loadOlderPings` (`static/app.js:874-957`)

> **Interval format note:** PostgREST serializes an `interval` column as a string. For our offered values it will look like `"24:00:00"` (24h) or `"7 days"` (7d); a combined value like `"1 day 02:03:04"` is possible if someone sets an odd value via SQL. `parseTtlSeconds` handles the `Nd days`/`Nd day` prefix plus an optional trailing `HH:MM:SS`. It returns `null` for null/empty (timer off), so callers treat `null` as "never expires."

- [ ] **Step 1: Add `parseTtlSeconds` and `isExpired` helpers**

Add near the day-separator helpers (so it sits with the other render-time utilities). Place this block immediately after the `makeDaySeparator` / `dayKey` helpers in `static/app.js`:

```javascript
// Parses a Postgres interval string (as PostgREST serializes it) into seconds.
// Handles "HH:MM:SS", "N days", "N day", and "N day(s) HH:MM:SS" combos.
// Returns null for null/empty (disappearing timer off → never expires).
function parseTtlSeconds(ttl) {
  if (!ttl) return null;
  let seconds = 0;
  const dayMatch = /(\d+)\s+days?/.exec(ttl);
  if (dayMatch) seconds += parseInt(dayMatch[1], 10) * 86400;
  const timeMatch = /(\d{1,2}):(\d{2}):(\d{2})/.exec(ttl);
  if (timeMatch) {
    seconds +=
      parseInt(timeMatch[1], 10) * 3600 +
      parseInt(timeMatch[2], 10) * 60 +
      parseInt(timeMatch[3], 10);
  }
  return seconds > 0 ? seconds : null;
}

// True if a ping is older than the pair's disappearing TTL (in seconds). A null
// ttlSeconds (timer off) means nothing expires. Compares against created_at.
function isExpired(ping, ttlSeconds) {
  if (!ttlSeconds) return false;
  const ageSeconds = (Date.now() - new Date(ping.created_at).getTime()) / 1000;
  return ageSeconds > ttlSeconds;
}
```

- [ ] **Step 2: Filter expired rows in `loadPings`**

In `loadPings` (`static/app.js:831-835`), after the error guard, the current lines are:

```javascript
  const page = (pings || []).slice().reverse(); // oldest → newest
  hasMoreOlder = (pings || []).length === PINGS_PAGE_SIZE;
  oldestCursor = page.length
    ? { ts: page[0].created_at, id: page[0].id }
    : null;
```

Replace with (filter expired before computing the cursor/hasMore, so the cursor anchors on a *rendered* row):

```javascript
  const ttlSeconds = parseTtlSeconds(selectedContact.disappearingTtl);
  // hasMoreOlder reflects the raw page size (whether the DB had a full page),
  // independent of how many survive the expiry filter — otherwise filtering the
  // whole page to empty would wrongly stop paging.
  hasMoreOlder = (pings || []).length === PINGS_PAGE_SIZE;
  const page = (pings || [])
    .slice()
    .reverse() // oldest → newest
    .filter((ping) => !isExpired(ping, ttlSeconds));
  // Cursor anchors on the oldest RAW row (not the oldest surviving one) so the
  // next page continues from the true page boundary even if the top rows were
  // filtered out as expired.
  const rawOldest = (pings || []).length
    ? (pings || [])[(pings || []).length - 1]
    : null;
  oldestCursor = rawOldest
    ? { ts: rawOldest.created_at, id: rawOldest.id }
    : null;
```

> **Why anchor the cursor on the raw oldest, not the filtered oldest:** the DB returned rows DESC, so `(pings)[length-1]` is the oldest row in the page regardless of filtering. If we anchored on the oldest *surviving* row, an all-expired top slice would make the next "ladda äldre" re-fetch rows we already saw. Anchoring on the raw boundary is correct and dedup-safe.

- [ ] **Step 3: Filter expired rows in `loadOlderPings`**

In `loadOlderPings` (`static/app.js:906-911`), the current lines after the error guard are:

```javascript
    const older = (pings || []).slice().reverse(); // oldest → newest
    hasMoreOlder = (pings || []).length === PINGS_PAGE_SIZE;
    if (!older.length) {
      renderLoadOlderControl(); // removes the button if history is now exhausted
      return;
    }
```

Replace with:

```javascript
    const ttlSeconds = parseTtlSeconds(selectedContact.disappearingTtl);
    hasMoreOlder = (pings || []).length === PINGS_PAGE_SIZE;
    // Advance the cursor to the raw oldest row of THIS fetch before filtering, so
    // paging continues from the true boundary even if every fetched row expired.
    const rawOldest = (pings || []).length
      ? (pings || [])[(pings || []).length - 1]
      : null;
    const older = (pings || [])
      .slice()
      .reverse() // oldest → newest
      .filter((ping) => !isExpired(ping, ttlSeconds));
    if (rawOldest) {
      oldestCursor = { ts: rawOldest.created_at, id: rawOldest.id };
    }
    if (!older.length) {
      renderLoadOlderControl(); // refresh/remove the button per hasMoreOlder
      return;
    }
```

> Note: the existing `loadOlderPings` sets `oldestCursor = { ts: older[0].created_at, id: older[0].id };` later (`static/app.js:939`). Because `older[0]` may now be a *surviving* row rather than the raw oldest, that later assignment must be **removed** to avoid clobbering the correct raw-boundary cursor set above. Do Step 4 next.

- [ ] **Step 4: Remove the now-redundant later cursor assignment in `loadOlderPings`**

Find (`static/app.js:939`):

```javascript
    oldestCursor = { ts: older[0].created_at, id: older[0].id };
```

Delete that single line. (Step 3 already set `oldestCursor` from the raw oldest row, which is correct even when the top of the page was filtered out.) The surrounding comment block referencing `prev` (`static/app.js:940-948`) is unaffected — leave it.

- [ ] **Step 5: Static check**

Run: `node --check static/app.js`
Expected: no output (parses clean).
Run: `grep -n "parseTtlSeconds\|isExpired\|oldestCursor = " static/app.js`
Expected: `parseTtlSeconds`/`isExpired` defined once and used in both `loadPings` and `loadOlderPings`; `oldestCursor` is assigned from `rawOldest` in both functions and the old `older[0]` assignment is gone (no `oldestCursor = { ts: older[0]` match remains).

- [ ] **Step 6: Manual verification — expired messages are hidden on load — DEFERRED TO HUMAN if subagent**

Set A⇄B's timer to 24h. Seed a few A↔B messages, then back-date some past 24h:
```sql
update public.pings set created_at = now() - interval '2 days'
where content like 'old %';   -- adjust to messages you seeded as "old N"
```
As A, open the B chat (do NOT run the cron / purge).
Expected: the back-dated "old" messages are **not rendered** (filtered client-side), while fresh messages show. Click "ladda äldre" if there are >50: expired rows stay hidden in older pages too, no duplicates, scroll anchored. Set the timer **off** (null) and reload.
Expected: all messages (including the back-dated ones) render again — nothing is filtered when the timer is off (and nothing was physically deleted, since the cron didn't run).

- [ ] **Step 7: Commit**

```bash
git add static/app.js
git commit -m "feat(disappearing): client-side load-time expiry filter (parseTtlSeconds/isExpired)"
```

---

### Task 5: HTML + CSS — the header timer control button and its popup menu

Add the control markup (`#disappearing-btn` + `#disappearing-menu`) inside `#chat-header`, immediately before `#gallery-btn`, and style it. Wiring is Task 6. The control is a small text button showing the current state ("av" / "24h" / "7d"); clicking it opens a popup menu of the three options, reusing the same popup pattern as the camera/video menus.

**Files:**
- Modify: `static/index.html` — insert before `#gallery-btn` (`static/index.html:359`)
- Modify: `static/style.css` — `#disappearing-btn` + `#disappearing-menu` styles

- [ ] **Step 1: Add the control markup before `#gallery-btn`**

In `static/index.html`, the header currently has `<h2 id="chat-contact-name"></h2>` (`static/index.html:358`) followed immediately by the `<button id="gallery-btn" …>` (`static/index.html:359`). Insert the following **between** the closing `</h2>` and the `<button id="gallery-btn"`:

```html
            <div class="disappearing-wrap">
              <button
                id="disappearing-btn"
                type="button"
                aria-haspopup="true"
                aria-expanded="false"
                aria-label="Försvinnande meddelanden"
                title="Försvinnande meddelanden"
              >
                <svg
                  class="icon"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <span id="disappearing-label" class="disappearing-label">av</span>
              </button>
              <div id="disappearing-menu" class="popup-menu hidden" role="menu">
                <button type="button" role="menuitem" data-ttl="">Av</button>
                <button type="button" role="menuitem" data-ttl="24 hours">24h</button>
                <button type="button" role="menuitem" data-ttl="7 days">7d</button>
              </div>
            </div>
```

> The clock-with-hand SVG echoes the retro/line-icon style of the existing header icons. The `data-ttl=""` (Av) carries an empty string → the wiring (Task 6) treats `""` as `null` for `set_disappearing`. `data-ttl="24 hours"` / `"7 days"` are valid Postgres interval literals.

- [ ] **Step 2: Confirm the existing popup-menu class name to reuse**

Run: `grep -n "popup-menu\|class=\"popup-menu\|videoMenu\|cameraMenu\|id=\"video-menu\|id=\"camera-menu" static/index.html static/style.css | head`
Expected: the camera/video menus use a shared menu class. **If the project's popup menus use `.popup-menu`**, the markup above is correct as written. **If they use a different class** (e.g. `.menu` or `.composer-menu`), change `class="popup-menu hidden"` in Step 1 to match that class, and skip the bespoke `#disappearing-menu` base styling in Step 3 (keep only the positioning override). Note the actual class found here: ____.

- [ ] **Step 3: Style the control and menu**

Append to `static/style.css`. (Match `#gallery-btn`'s icon-button look; position the menu below the button. If Step 2 found the menus already have a shared base class you reused, drop the redundant base rules and keep the `#disappearing-*` specifics.)

```css
.disappearing-wrap {
  position: relative;
  flex: none;
  display: inline-flex;
}

#disappearing-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--fg-dim);
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
  font: inherit;
  font-size: 0.8rem;
  transition: color 0.15s, background 0.15s;
}
#disappearing-btn:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 10%, transparent);
}
#disappearing-btn .icon {
  width: 18px;
  height: 18px;
}
.disappearing-label {
  letter-spacing: 0.5px;
}
/* Active (timer on) — tint the control so it's visibly engaged. */
#disappearing-btn.active {
  color: var(--accent);
}

#disappearing-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 96px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
#disappearing-menu.hidden {
  display: none;
}
#disappearing-menu button {
  background: none;
  border: none;
  color: var(--fg);
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
}
#disappearing-menu button:hover {
  background: color-mix(in srgb, var(--fg) 12%, transparent);
}
```

> Confirm `--bg`, `--fg`, `--fg-dim`, `--border`, `--accent` all exist. Run `grep -n "\-\-bg:\|--fg:\|--fg-dim:\|--border:\|--accent:" static/style.css | head`. They are used throughout the existing stylesheet, so they should all resolve.

- [ ] **Step 4: Static check**

Run: `grep -n "disappearing-btn\|disappearing-menu\|disappearing-label\|disappearing-wrap" static/index.html static/style.css`
Expected: the button, label span, menu, and wrap appear in `index.html`; the matching styles appear in `style.css`.

- [ ] **Step 5: Manual verification — control appears (inert) — DEFERRED TO HUMAN if subagent**

Run the app, open any chat.
Expected: a small clock-icon control labeled "av" sits at the right of the header, just left of the file-gallery icon. Clicking it does nothing yet (wiring is Task 6) — that's expected at this stage. Confirm it does not break the header layout (name still truncates, gallery button still reachable) on desktop and at a narrow/mobile width.

- [ ] **Step 6: Commit**

```bash
git add static/index.html static/style.css
git commit -m "feat(disappearing): add header timer control markup + styling (inert)"
```

---

### Task 6: Client — wire the control: popup menu, `set_disappearing`, label refresh

Wire `#disappearing-btn`/`#disappearing-menu` with `createPopupMenu`; selecting an option calls `set_disappearing`, updates `selectedContact.disappearingTtl`, and refreshes the label. Add a `refreshDisappearingControl()` that renders the current-state label + active class, called on chat open.

**Files:**
- Modify: `static/app.js` — add DOM refs near the other `document.getElementById` refs (~`static/app.js:36-37`, by `chatContactName`/`galleryBtn`); add `ttlToLabel`, `refreshDisappearingControl`, `setDisappearing`, and the `createPopupMenu` wiring (place the wiring near the other `createPopupMenu` call sites, ~`static/app.js:1966-1985`); call `refreshDisappearingControl()` in `selectContact`

- [ ] **Step 1: Add DOM references**

Near `const galleryBtn = document.getElementById("gallery-btn");` (`static/app.js:37`), add:

```javascript
const disappearingBtn = document.getElementById("disappearing-btn");
const disappearingMenu = document.getElementById("disappearing-menu");
const disappearingLabel = document.getElementById("disappearing-label");
```

- [ ] **Step 2: Add `ttlToLabel` and `refreshDisappearingControl`**

Add near the other small render helpers (e.g. just after `parseTtlSeconds`/`isExpired` from Task 4):

```javascript
// Short label for the header control given a Postgres interval (or null = off).
// Buckets to the offered values; falls back to a compact form for odd values.
function ttlToLabel(ttl) {
  const seconds = parseTtlSeconds(ttl);
  if (!seconds) return "av";
  if (seconds === 86400) return "24h";
  if (seconds === 604800) return "7d";
  // Non-standard value (set via SQL): show whole days if clean, else hours.
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  return `${Math.round(seconds / 3600)}h`;
}

// Renders the header control's label + active state from the open chat's ttl.
// No-op when no chat is open or the control isn't in the DOM.
function refreshDisappearingControl() {
  if (!disappearingBtn || !disappearingLabel || !selectedContact) return;
  const ttl = selectedContact.disappearingTtl;
  disappearingLabel.textContent = ttlToLabel(ttl);
  disappearingBtn.classList.toggle("active", !!parseTtlSeconds(ttl));
}
```

- [ ] **Step 3: Add `setDisappearing` (the RPC call + state/label/confirmation update)**

Add immediately after `refreshDisappearingControl`:

```javascript
// Sets (or clears) the open pair's disappearing timer via the security-definer
// RPC, then reflects the new state locally: updates selectedContact, the header
// label, and drops an in-thread confirmation line. p_ttl is a Postgres interval
// string or null (off). No-op if no chat is open.
async function setDisappearing(ttl) {
  if (!selectedContact) return;
  const p_ttl = ttl || null; // "" (the "Av" option) → null
  const { error } = await sb.rpc("set_disappearing", {
    p_contact_id: selectedContact.contactId,
    p_ttl,
  });
  if (error) {
    console.error("set_disappearing failed:", error);
    systemLine("Kunde inte ändra försvinnande meddelanden.");
    return;
  }
  selectedContact.disappearingTtl = p_ttl;
  // Keep the loaded contacts array in sync so a later re-open reads the new ttl.
  const row = contacts.find((c) => c.id === selectedContact.contactId);
  if (row) row.disappearing_ttl = p_ttl;
  refreshDisappearingControl();
  const label = ttlToLabel(p_ttl);
  systemLine(
    p_ttl
      ? `Försvinnande meddelanden: ${label}`
      : "Försvinnande meddelanden: av"
  );
}
```

- [ ] **Step 4: Wire the popup menu**

Near the other `createPopupMenu` call sites (after the camera-menu wiring, ~`static/app.js:1985`), add:

```javascript
// --- Disappearing-messages header control popup ---
if (disappearingBtn && disappearingMenu) {
  const disappearingMenuCtl = createPopupMenu(disappearingBtn, disappearingMenu);
  disappearingMenu.querySelectorAll("button[data-ttl]").forEach((item) => {
    item.addEventListener("click", () => {
      disappearingMenuCtl.close();
      setDisappearing(item.dataset.ttl);
    });
  });
}
```

> `createPopupMenu` already handles open/close on click, outside-click, and Escape, and initializes `aria-expanded` (`static/app.js:1933-1956`). The `data-ttl` attribute on each `<button>` carries the interval literal (`""`, `"24 hours"`, `"7 days"`).

- [ ] **Step 5: Refresh the control on chat open**

In `selectContact`, after `chatContactName.innerHTML = …` and before `await loadPings();` (`static/app.js:785-787`), add a call so the control shows the right label as soon as the chat opens:

```javascript
  refreshDisappearingControl();
```

So that region of `selectContact` reads:

```javascript
  chatContactName.innerHTML = contactNameHtml(username, selectedContact.displayName);
  refreshDisappearingControl();

  await loadPings();
```

- [ ] **Step 6: Static check**

Run: `node --check static/app.js`
Expected: no output (parses clean).
Run: `grep -n "refreshDisappearingControl\|setDisappearing\|ttlToLabel\|disappearingMenuCtl\|createPopupMenu(disappearingBtn" static/app.js`
Expected: helpers defined; `refreshDisappearingControl()` called in `selectContact`; the popup wired via `createPopupMenu`.

- [ ] **Step 7: Manual verification — set the timer end to end — DEFERRED TO HUMAN if subagent**

Run the app as A, open the B chat (timer off → control shows "av"). Click the control → menu opens (Av / 24h / 7d). Pick **24h**.
Expected: the control label flips to "24h" and goes accent-colored (active); an in-thread line "Försvinnande meddelanden: 24h" appears; in the DB the A⇄B `contacts.disappearing_ttl` is now `24:00:00`. Pick **Av**.
Expected: label back to "av", control un-tints, line "Försvinnande meddelanden: av"; DB ttl back to null. Close the chat and reopen it → the control shows the last-set state (read from the refreshed `contacts` array). Press Escape with the menu open → it closes (via `createPopupMenu`).

- [ ] **Step 8: Commit**

```bash
git add static/app.js
git commit -m "feat(disappearing): wire header control to set_disappearing + confirmation line"
```

---

### Task 7: Client — reflect a remote timer change live

`contacts` UPDATE already triggers `loadContacts()` in `subscribeToRealtime` (`static/app.js:1614-1615` and `:1631-1633`), but `loadContacts()` only re-syncs the contact *name* and re-renders the sidebar — it does not refresh the disappearing-control label or `selectedContact.disappearingTtl`. Extend the contacts realtime path so the other side setting the timer updates the open chat live.

**Files:**
- Modify: `static/app.js` — `loadContacts` (`static/app.js:545-567`); reuse `syncSelectedContactDisplayName`'s match logic for the ttl re-sync

- [ ] **Step 1: Re-sync the open pair's ttl when contacts reload**

`loadContacts` ends with (`static/app.js:561-567`):

```javascript
  contacts = data || [];
  // A contact may have changed their display name since we opened their chat;
  // re-sync the selected contact and its header from the fresh data.
  syncSelectedContactDisplayName();
  renderContacts();
  refreshChatHeader();
}
```

Replace with (add a ttl re-sync + control refresh, mirroring the existing name re-sync):

```javascript
  contacts = data || [];
  // A contact may have changed their display name OR the pair's disappearing
  // timer since we opened the chat; re-sync both from the fresh data.
  syncSelectedContactDisplayName();
  syncSelectedContactDisappearingTtl();
  renderContacts();
  refreshChatHeader();
  refreshDisappearingControl();
}
```

- [ ] **Step 2: Add `syncSelectedContactDisappearingTtl`**

Add immediately after `syncSelectedContactDisplayName` (`static/app.js:572-584`), mirroring its match-by-other-party-id logic:

```javascript
// Re-reads the open pair's disappearing_ttl from the freshly loaded `contacts`
// array (matched by the other party's user id), so a remote timer change shows
// live. No-op when no contact is selected or the contact is no longer listed.
function syncSelectedContactDisappearingTtl() {
  if (!selectedContact) return;
  const match = contacts.find(
    (c) =>
      c.status === "accepted" &&
      (c.requester_id === selectedContact.recipientId ||
        c.addressee_id === selectedContact.recipientId)
  );
  if (!match) return;
  selectedContact.disappearingTtl = match.disappearing_ttl || null;
}
```

> `refreshDisappearingControl()` (Task 6) no-ops when no chat is open, so calling it unconditionally at the end of `loadContacts` is safe — it only does work when a chat is open.

- [ ] **Step 3: Static check**

Run: `node --check static/app.js`
Expected: no output (parses clean).
Run: `grep -n "syncSelectedContactDisappearingTtl\|refreshDisappearingControl()" static/app.js`
Expected: the sync helper defined and called in `loadContacts`; `refreshDisappearingControl()` called at the end of `loadContacts`.

- [ ] **Step 4: Manual verification — remote change reflects live — DEFERRED TO HUMAN if subagent**

Two sessions, A and B, both with the A⇄B chat **open**. As **B**, set the timer to **7d**.
Expected: within a moment, **A's** header control updates to "7d" (active) live — driven by the `contacts` UPDATE → `loadContacts()` → `syncSelectedContactDisappearingTtl()` → `refreshDisappearingControl()` path — without A reloading. As B, set it **Av** → A's control returns to "av" live. Confirm the existing behaviors still work: a contact display-name change still re-syncs, and the sidebar / invite-accept realtime paths are unaffected.

> **Note on expiry-filter freshness:** A remote ttl change updates `selectedContact.disappearingTtl`, so the *next* `loadPings`/`loadOlderPings` filters against the new value. Already-rendered messages are not retroactively swept from the DOM on a live timer change — that's acceptable (the cron + next load handle physical/visual removal). Do not add retroactive DOM pruning; it's out of scope.

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat(disappearing): reflect remote timer changes live via contacts realtime"
```

---

### Task 8: Docs — README RPC list + feature line; FEATURE_IDEAS shipped flip

Add the new RPCs to the README setup list and a feature line; flip FEATURE_IDEAS's "disappearing messages (coming soon)" to shipped.

**Files:**
- Modify: `README.md` — the schema RPC bullet (`README.md:57-58`); the Features list
- Modify: `FEATURE_IDEAS.md` — the intro "coming soon" phrasing (`FEATURE_IDEAS.md:5-6`)

- [ ] **Step 1: Add `set_disappearing` to the README RPC list**

In `README.md`, the setup step currently reads (`README.md:57-58`):

```markdown
   policies, the `ping-files` storage bucket, and the `dismiss_ping`,
   `mark_read`, `mark_delivered`, `create_invite`, and `redeem_invite` RPCs.
```

Replace with:

```markdown
   policies, the `ping-files` storage bucket, and the `dismiss_ping`,
   `mark_read`, `mark_delivered`, `set_disappearing`, `create_invite`, and
   `redeem_invite` RPCs. It also defines `purge_expired_pings()` and a daily
   `pg_cron` sweep for disappearing messages — enable the **pg_cron** extension
   (Database → Extensions) for the sweep to run; without it, expired messages are
   still hidden client-side at load time but not physically purged.
```

- [ ] **Step 2: Add a Features line for disappearing messages**

In `README.md`, find the durable-history / receipts feature lines added by Plan 1 (the "Durable conversation history" / "Read/unread + delivery receipts" / "Delete a message" block — locate it). Run `grep -n "Durable conversation history\|Delete a message\|Read/unread" README.md` to find the block, then add immediately after the "Delete a message" line:

```markdown
- Disappearing messages: per-conversation opt-in timer (av / 24h / 7d, either
  side can set it); expired messages are hidden on load and swept daily
```

> If the exact Plan 1 feature wording differs, place the new line within the same Features list near the delete/history lines; the goal is one bullet introducing disappearing messages in the feature list.

- [ ] **Step 3: Flip FEATURE_IDEAS from "coming soon" to shipped**

In `FEATURE_IDEAS.md`, the intro currently reads (`FEATURE_IDEAS.md:3-8`):

```markdown
Ping is a fast, private, lightweight messaging app with a durable conversation
history. Messages persist by default as a scrollable log with read/unread and
delivery status; ephemerality is opt-in via disappearing messages (off / 24h /
7d, coming soon). The strongest ideas below keep that quick, focused, two-person
feel — Ping stays a lightweight direct-message tool, not a sprawling social
network.
```

Replace the parenthetical `(off / 24h / 7d, coming soon)` so it reads as shipped:

```markdown
Ping is a fast, private, lightweight messaging app with a durable conversation
history. Messages persist by default as a scrollable log with read/unread and
delivery status; ephemerality is opt-in via per-conversation disappearing
messages (off / 24h / 7d). The strongest ideas below keep that quick, focused,
two-person feel — Ping stays a lightweight direct-message tool, not a sprawling
social network.
```

- [ ] **Step 4: Verify no "coming soon" disappearing-messages framing remains**

Run: `grep -rn "coming soon\|disappearing" README.md FEATURE_IDEAS.md`
Expected: disappearing messages are described as a present feature; no "coming soon" qualifier remains on them.

- [ ] **Step 5: Commit**

```bash
git add README.md
git add -f FEATURE_IDEAS.md
git commit -m "docs: document disappearing messages + set_disappearing/purge RPCs"
```

> `FEATURE_IDEAS.md` is gitignored-but-tracked → `git add -f`. `README.md` adds normally.

---

### Task 9: Regression check + branch wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Run the Python test suite (must be unaffected)**

Run: `python -m pytest tests/ -q`
Expected: all pass (these are backend/link-preview tests — 38 tests; this plan does not touch `server.py` or `link_preview.py`).

- [ ] **Step 2: Final static check on the JS**

Run: `node --check static/app.js`
Expected: no output (parses clean).

- [ ] **Step 3: Full manual smoke (two sessions) — DEFERRED TO HUMAN if subagent**

With A and B as accepted contacts, verify end-to-end in one pass:
1. Control shows "av" when the timer is off; opens a menu (Av / 24h / 7d) on click; Escape/outside-click closes it.
2. Setting 24h: label → "24h" + active tint, in-thread "Försvinnande meddelanden: 24h" line, DB `disappearing_ttl = 24:00:00`. Reopen chat → state persists.
3. Setting Av: label → "av", un-tinted, confirmation line, DB null.
4. Remote change: B sets the timer → A's open-chat control updates live (no reload).
5. Expiry filter: with 24h on, back-dated (>24h) messages are hidden on load and across "ladda äldre"; with the timer off, nothing is filtered.
6. Plan 1 regressions intact: date separators, paged scrollback (latest 50 + ladda äldre), durable unread badges, sent/delivered/read receipts, ✕ per-side delete — all still work.
Expected: all six as described.

- [ ] **Step 4: Live-DB apply (deferred human steps)**

Apply `supabase/schema.sql` section 12 to the scratch project, then (for production deploy) to the live project — it's idempotent and additive. **Enable the `pg_cron` extension** (Dashboard → Database → Extensions) and re-run section 12 so the `cron.schedule(...)` registers (open-question #2: deferred to you). Confirm `select jobname, schedule from cron.job where jobname = 'purge-expired-pings';` returns one row.

- [ ] **Step 5: Final review against the spec**

Open `docs/superpowers/specs/2026-06-08-durable-messaging-design.md` and confirm every Plan 2 bullet is implemented: `disappearing_ttl` on `contacts` (T1); `set_disappearing` RPC, either-side auth (T1); `purge_expired_pings()` + `pg_cron` daily sweep, cron-only (T2); header timer control via `createPopupMenu` (T5/T6); in-thread confirmation line (T6); lazy expiry filtering on load (T4); live remote-change reflection (T7); docs (T8). Note that Plan 1 items and the future out-of-scope items (search, reply threading, reactions) remain untouched.

- [ ] **Step 6: Finishing the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide merge/PR. Typical: push `feat/disappearing-messages` and open a PR to `main`. The two deferred DB steps (apply section 12, enable pg_cron) are part of the deploy, not the merge.

---

## Self-Review notes (author)

- **Spec coverage (Plan 2 section of the design + the handoff scope):**
  - Schema: `contacts.disappearing_ttl interval` null=off → **T1**. `set_disappearing(p_contact_id, p_ttl)` security-definer, either-side auth, granted to authenticated → **T1**. `purge_expired_pings()` security-definer, deletes age > pair ttl, fires storage trigger, **cron-only / no authenticated grant** (open-q #1) → **T2**. `cron.schedule(...)` daily sweep written in schema, **enabling pg_cron deferred to human** (open-q #2) → **T2** + **T9 Step 4**.
  - Frontend: header timer control next to `#gallery-btn` via `createPopupMenu`, reflects current state, calls `set_disappearing` → **T5/T6**. Per-pair state on `selectedContact` + `loadContacts` select → **T3**. In-thread `systemLine` confirmation → **T6**. Lazy expiry filter in `loadPings`/`loadOlderPings` → **T4**. Realtime contacts UPDATE reflects a remote change live (the gap that `loadContacts` alone didn't cover) → **T7**.
  - Docs: README RPC list + feature line; FEATURE_IDEAS shipped flip; `git add -f` for the gitignored-but-tracked `FEATURE_IDEAS.md` → **T8**.
- **Type/name consistency across tasks:** `selectedContact.disappearingTtl` (camelCase on the client object) vs `contacts[].disappearing_ttl` (snake_case DB column) used consistently; `parseTtlSeconds(ttl)`, `isExpired(ping, ttlSeconds)`, `ttlToLabel(ttl)`, `refreshDisappearingControl()`, `setDisappearing(ttl)`, `syncSelectedContactDisappearingTtl()`; DOM ids `#disappearing-btn` / `#disappearing-menu` / `#disappearing-label`; `set_disappearing(p_contact_id, p_ttl)` / `purge_expired_pings()` RPC names — used identically across schema, HTML, and JS tasks.
- **Decisions baked in (do not re-litigate):** purge cron-only (no authenticated grant); pg_cron SQL shipped but extension-enable + live-apply deferred to human; the timer change MUST go through `set_disappearing` because `contacts` has no general UPDATE policy (the Plan 1 trap); `systemLine` is the reused in-thread confirmation (it auto-fades after 8s — intentional, it's a transient confirmation, not a stored event).
- **Sequencing caveat:** T5 (markup) before T6 (wiring) — the wiring queries `#disappearing-btn`/`#disappearing-menu`, so the markup must exist first. T4 defines `parseTtlSeconds`, reused by T6's `ttlToLabel` and T6/T7's control refresh — implement T4 before T6. T3 (ttl on `selectedContact`) underpins T4's filter and T6's label — implement first. Numeric order satisfies all of these.
- **Cursor-correctness note (T4):** the expiry filter changes which rows render but NOT the paging boundary — `oldestCursor` is anchored on the raw oldest DB row in both `loadPings` and `loadOlderPings`, so filtering an all-expired top slice can't cause skipped/duplicated pages. The old `oldestCursor = { ts: older[0]… }` line in `loadOlderPings` is removed (T4 Step 4) so it can't clobber the raw-boundary cursor.
