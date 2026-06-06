# Invite Links (LAN/AirDrop-ish Discovery) — Design

**Date:** 2026-06-06
**Feature:** Generate a single-use, short-lived invite link + QR code that
instantly connects two people as accepted contacts — the realistic, browser-safe
version of "find nearby users on the same network."
**Source:** FEATURE_IDEAS.md → "LAN/AirDrop-ish discovery: find nearby
users/devices on the same network where browser APIs allow it, with fallback
invite links." (Bigger / Cool Bets.)

## Goal

Let someone connect with a person standing next to them without typing
usernames. Tap **Bjud in**, a modal shows a **QR code + link + live countdown**,
the other person scans/opens it and is **instantly an accepted contact in both
directions**. Links are **single-use** and **expire after 10 minutes**, so a
leaked or forwarded link can't let strangers in. If the opener isn't logged in,
the invite token is held through sign-in/sign-up and redeemed immediately after.

## Honest scope: why not "real" LAN discovery

Browsers deliberately cannot do raw local-network discovery from a web page: no
mDNS/Bonjour, no listening sockets, no LAN scanning, no enumerating peers. These
are blocked for security and privacy and there is no web API that grants them to
an ordinary site like Ping. The feature idea itself hedges with "where browser
APIs allow it, with fallback invite links" — and the fallback **is** the
feature. We deliver the AirDrop-ish *experience* (hold phones together, scan,
connected) without pretending to scan the network.

## Constraints & decisions

Settled during brainstorming:

- **Trust model:** opening a valid invite **auto-accepts** an `accepted` contact
  in both directions — no pending step. The creator pre-consented by generating
  the link; the opener consents by redeeming it.
- **Abuse limit:** every invite is **single-use** and **expires in 10 minutes**.
  A used or expired token does nothing. This is what makes auto-accept safe.
- **Logged-out openers:** the token is stashed in `sessionStorage`, the auth
  screen shows a "someone wants to connect" banner, and the invite is redeemed
  automatically on the next successful `SIGNED_IN` (works for brand-new signups
  too).
- **UI surface:** a **modal** (QR + link + copy + countdown + regenerate),
  opened from a **Bjud in** button near the existing add-contact box.
- **QR generation:** a **small, MIT-licensed QR library vendored** into
  `static/assets/scripts/qrcode.js` and served from our own origin. No CSP
  change, no CDN runtime dependency, works offline in the PWA.
- **Token transport:** the token rides in the URL **fragment**
  (`/app#invite=<token>`), like Supabase recovery tokens, so it never reaches
  server access logs.
- **Trust logic lives in Postgres**, in security-definer RPCs, mirroring the
  existing `dismiss_ping` pattern. No new backend routes; redemption is a pure
  Supabase RPC call from the browser.
- **No CSP / server.py changes** are required — the QR lib is same-origin and
  all data access goes through the already-allowed Supabase `connect-src`.

## Non-goals (YAGNI)

- No real LAN/mDNS scanning or same-network grouping (see "Honest scope").
- No WebRTC / direct peer-to-peer transfer — pings still flow through Supabase.
- No multi-use or revocable invites — single-use + expiry only.
- No "my active invites" management UI — at most one open invite matters at a
  time, and it expires on its own.
- No native Web Share sheet in v1 (copy button + QR cover the use case; can be
  added later behind the same modal).
- No email/SMS delivery of invites — the user shares the link/QR however they
  like.

## Data model

New table `public.invites`. The primary-key UUID **is** the token — UUIDv4 is
unguessable, so no separate secret column is needed.

```
invites
  id          uuid pk default gen_random_uuid()   -- the token in the URL
  creator_id  uuid not null references profiles(id) on delete cascade
  used_by     uuid     references profiles(id) on delete set null
  used_at     timestamptz
  expires_at  timestamptz not null
  created_at  timestamptz not null default now()
```

Index: `invites_creator_idx on (creator_id)`.

### RLS

- `enable row level security`.
- **Select/insert own only:** `creator_id = auth.uid()`. No policy lets a
  redeemer read someone else's invite row directly — redemption is RPC-only, so
  the token holder never needs raw table read. No update/delete policies (state
  changes happen inside the security-definer RPCs).

### RPC: `create_invite()` (security definer)

1. Mark any of the caller's still-open invites as expired
   (`expires_at = now()` where `creator_id = auth.uid()` and not yet used and
   not yet expired) — keeps one active invite per user and invalidates a stale
   QR still on someone's screen.
2. Insert a new row: `creator_id = auth.uid()`,
   `expires_at = now() + interval '10 minutes'`.
3. Return the new `id` (the token) and `expires_at`.

`grant execute ... to authenticated`.

### RPC: `redeem_invite(p_token uuid)` (security definer)

Returns a small result the UI can act on. Rejects (with a distinguishable
reason) when:

- token not found → `not_found`
- `expires_at <= now()` → `expired`
- `used_at is not null` → `used`
- `creator_id = auth.uid()` (self-invite) → `self`
- an `accepted`/`pending` contact already exists between the two → still marks
  the invite used and returns success with the creator's username (idempotent
  "already connected" is a success from the user's view)

On success:

1. Set `used_by = auth.uid()`, `used_at = now()`.
2. Upsert an `accepted` contact between `creator_id` and `auth.uid()`. Because
   the existing `contacts` unique constraint is on
   `(requester_id, addressee_id)` and a pair can pre-exist in either direction,
   the RPC checks both directions first; if a pending row exists it flips it to
   `accepted`, otherwise it inserts `(creator_id, auth.uid(), 'accepted')`.
3. Return `{ status: 'ok', username: <creator username> }`.

`grant execute ... to authenticated`. Running as security definer lets it write
an `accepted` contact and update the invite without the redeemer needing direct
insert/update rights on those rows.

### Schema migration

Add the whole invites feature as a new, **idempotent** section at the end of
`supabase/schema.sql` (using `create table if not exists` / `drop policy if
exists` / `create or replace function`), matching the section-9 dismiss
migration style, so existing deployments can apply just this block.

## Frontend flow

All in `static/app.js`, `static/index.html`, `static/style.css`, plus the
vendored `static/assets/scripts/qrcode.js`.

### Generating (inviter)

- A **Bjud in** button near the add-contact form opens the invite **modal**
  (same modal/overlay pattern as the existing lightbox).
- On open: call `create_invite()`, build
  `url = location.origin + "/app#invite=" + token`, render the QR from `url`
  into a canvas, show the link text + **Kopiera** button.
- A **countdown** ("Giltig i 09:58") ticks from `expires_at`. At 0 it swaps to a
  **Skapa ny länk** button that calls `create_invite()` again.
- Closing the modal stops the countdown timer.

### Redeeming (invitee)

In `init()`, alongside the existing `type=recovery` hash check, parse
`#invite=<token>` from `location.hash`:

- **Logged in:** call `redeem_invite(token)`. On `ok`, show a toast/banner
  "Ansluten till @anna", reload contacts, and strip the hash from the URL. On a
  rejection reason, show a matching message ("Länken har gått ut." / "Länken är
  redan använd." / "Du kan inte bjuda in dig själv.").
- **Not logged in:** stash the token in `sessionStorage`, show the auth screen
  with a banner ("Någon vill ansluta — logga in eller skapa ett konto för att
  acceptera."). In the `onAuthStateChange` handler, on `SIGNED_IN` with a
  stashed token present, redeem it, clear the stash, then show the result.

Stripping the hash after handling prevents a re-redeem attempt on refresh (and
the token is single-use anyway).

## Error handling

- `create_invite` failure → modal shows "Kunde inte skapa länk. Försök igen."
- `redeem_invite` network failure → "Kunde inte ansluta. Försök igen."
- Distinct redemption rejections map to distinct Swedish messages (above).
- QR render is best-effort: if the canvas render throws, still show the copyable
  link (the link is the source of truth; the QR is a convenience).

## Testing

The existing pytest suite (`tests/`) covers `server.py` and `link_preview.py`
only; there is **no SQL/Supabase test harness** in the repo, and this feature
adds no FastAPI routes. So the bulk of the logic (Postgres RPCs + browser JS) is
not reachable by the current Python tests. Plan:

- **Pure-JS unit tests, runnable under Python** where practical: the
  URL/token-parsing helper (extracting `invite=` from a hash, building the
  invite URL) will be factored into a small testable function. If a JS test
  runner is out of scope, this helper is kept tiny and verified manually with
  documented cases.
- **Manual verification checklist** (documented in the plan): generate →
  scan/open on a second account → instant connect; expired token; reused token;
  self-invite; logged-out open → signup → auto-redeem; refresh after redeem is a
  no-op.
- **RPC behavior** is documented as SQL assertions in the plan (happy path,
  expired, used, self, already-contacts, not-found) to be run by hand in the
  Supabase SQL editor, since no automated SQL runner exists. Adding such a
  runner is out of scope for this feature.

If introducing a JS test runner is acceptable, the parsing/URL helpers and a
mocked-`sb` redemption flow would be the first candidates — flagged as an open
option, not a commitment.

## Files touched

- `supabase/schema.sql` — new idempotent invites section (table, RLS, two RPCs).
- `static/assets/scripts/qrcode.js` — vendored MIT QR generator (new file).
- `static/index.html` — Bjud in button + invite modal markup; load qrcode.js.
- `static/app.js` — create/redeem flow, modal, countdown, hash + logged-out
  handling.
- `static/style.css` — modal + QR + countdown styling (terminal aesthetic).
- `static/sw.js` — add `/assets/scripts/qrcode.js` to the `SHELL` precache list
  and bump `CACHE` (`ping-shell-v6` → `ping-shell-v7`) so the new asset is cached
  and stale shells are evicted. (Confirmed: `sw.js` precaches a `SHELL` array and
  versions the cache via the `CACHE` constant.)
- `README.md` — mention invite links in Features and the schema section note.
```
