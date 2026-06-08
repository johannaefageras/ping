# Durable messaging — design

**Date:** 2026-06-08
**Status:** Approved

## Goal

Turn Ping from a transient-notification tool into a real messaging app with a
**durable conversation history**. Today a ping is shown, dismissed, and
hard-deleted once both sides dismiss it. We want messages to **persist by
default** as a scrollable conversation log, with **read/unread + delivery
status**, and an **opt-in disappearing-messages timer** as the new, controlled
path to ephemerality.

This is a deliberate philosophy pivot. The current
[FEATURE_IDEAS.md](../../../FEATURE_IDEAS.md) states Ping should stay "fast,
private, disposable" and *not* become "a full social/chat product." That intent
is being changed; updating that doc is part of this work so the codebase does
not carry a contradiction.

## Direction (decisions captured)

- **Move:** full chat with durable history (not just a history view, not
  feel-only).
- **Delete model:** keep everything by default; add **optional disappearing
  messages** (off / 24h / 7d) as the way to forget.
- **Must-haves for v1:** (1) scrollback + date grouping, (2) read/unread +
  delivery status. Reply, reactions, and search are explicitly out of scope.
- **Read trigger:** a received message counts as read when its chat is **open
  and the tab is focused**.
- **Disappearing control:** **per-conversation**, either side can set it.

## Current state

- **Per-pair history already loads.**
  [loadPings()](../../../static/app.js#L750) runs a `.or(...)` query over
  `pings` for current user ⇄ selected contact, ordered `created_at` ascending,
  renders **all** rows into `#board` at once, then scrolls to bottom. No paging.
- **Dismiss = both-sides-delete.** The ✕ button calls
  [dismissPing()](../../../static/app.js#L774) →
  [renderPing()](../../../static/app.js#L792) markup → `dismiss_ping` RPC. The
  RPC (schema section 9) flips a per-side flag and **hard-deletes the row once
  both flags are true**, firing the storage-cleanup trigger (schema section 8).
- **Unread is session-only and ephemeral.**
  [unreadCounts](../../../static/app.js#L111) is an in-memory object, reset on
  reconnect ([app.js:463](../../../static/app.js#L463)). There is **no
  DB-backed read state** today.
- **Realtime listens to INSERT only.**
  [subscribeToRealtime()](../../../static/app.js#L1308) handles `pings` INSERT
  (incrementing `unreadCounts`) and `contacts` changes. No UPDATE handler.
- **Presence already exists.**
  [subscribePresence()](../../../static/app.js#L1378) tracks online dots via a
  shared Realtime presence channel (no DB writes).
- **Reusable UI primitives exist:** `createPopupMenu` (camera/composer menus),
  a `formatDate` helper added for the file gallery, `formatTime`, `formatSize`,
  and the overlay registry used for Escape handling.
- **Schema conventions:** `supabase/schema.sql` uses numbered, **idempotent**
  sections (`add column if not exists`, `drop policy if exists … create`) and
  **security-definer RPCs** with explicit authorization checks
  (`dismiss_ping`, `redeem_invite`, `create_invite`).

## Data model (schema changes)

All additive and idempotent, in the existing numbered-section style.

### `pings` — read/delivery state

```sql
alter table public.pings add column if not exists delivered_at timestamptz;
alter table public.pings add column if not exists read_at      timestamptz;
```

- `delivered_at`: stamped when the receiver's client receives the realtime
  INSERT (or on next load if offline at send time).
- `read_at`: stamped when the receiver opens that chat with the tab focused.
- **Unread count per contact** = `count(*) where receiver_id = me and
  read_at is null` (and not dismissed by me).
- **Per-message receipt:** the sender reads `delivered_at` / `read_at` off the
  row, updated live via a realtime UPDATE subscription.

### `contacts` — disappearing timer

```sql
alter table public.contacts add column if not exists disappearing_ttl interval;  -- null = off
```

One timer per pair, on the single `contacts` row. `null` = off; offered values
are `24h` and `7d`. Either side may change it.

### New RPCs (security definer, pair-membership checks)

- **`mark_read(p_contact_id uuid)`** — stamps `read_at = now()` on all pings
  where `receiver_id = auth.uid()`, the counterparty is `p_contact_id`'s other
  side, and `read_at is null`. One round-trip per chat-open. Mirrors
  `dismiss_ping`. Granted to `authenticated`.
- **`set_disappearing(p_contact_id uuid, p_ttl interval)`** — updates the
  `contacts` row's `disappearing_ttl`. Authorized to either side of the pair.
  Granted to `authenticated`.

### Expired-message cleanup

- **`purge_expired_pings()`** (security definer) — deletes pings whose age
  exceeds their pair's `disappearing_ttl`. Deletion fires the existing
  storage-cleanup trigger (schema section 8), so attached files are removed too.
- **Run strategy: lazy-on-load + daily `pg_cron` sweep.** The client filters
  expired messages out at load time (so they vanish promptly for active users);
  `pg_cron` runs `purge_expired_pings()` daily to actually delete rows and
  reclaim storage. This avoids depending on cron alone for correctness.

### RLS impact

- The `pings` select policy is unchanged — per-side dismiss flags still govern
  visibility.
- New RPCs are security-definer with explicit pair-membership authorization,
  matching the `redeem_invite` / `dismiss_ping` pattern. No new table-level
  policies needed.

## Client changes

### History / scrollback (must-have #1)

- **Paging.** `loadPings` loads the most recent **50** rows (descending in the
  query, rendered ascending), scrolls to bottom. A "ladda äldre" affordance at
  the top of `#board` (scroll-to-top trigger and/or button) fetches the previous
  page using a `created_at` cursor. Keeps initial load fast as history grows.
- **Date separators.** Group rendered messages by day with an "Idag / Igår /
  8 juni"-style divider, reusing the existing `formatDate` helper. Dividers are
  inserted during render whenever the day changes between consecutive messages,
  and when prepending an older page.

### Read/unread + delivery (must-have #2)

- **Mark read.** On `selectContact`, if the tab is focused, call
  `mark_read(contactId)`. Also call it on window `focus` while a chat is open.
  This replaces the session-only `unreadCounts` reset with a DB-backed one.
- **Durable unread counts.** On load, fetch per-contact unread counts from the
  DB (one grouped query) instead of relying on the in-memory `unreadCounts`
  that resets each session, so the sidebar badge survives reload. The in-memory
  map can remain as a live cache updated by realtime, but the source of truth on
  load is the DB query.
- **Sender-side receipts.** Subscribe to `pings` **UPDATE** events (we only
  listen to INSERT today). When `read_at` / `delivered_at` change on a message
  the current user **sent**, update that message's status indicator via a small
  `renderPingStatus(el, ping)` helper: `✓` sent → `✓✓` delivered → read-styled
  `✓✓`.
- **Mark delivered.** When the receiver's client gets the realtime INSERT for a
  message addressed to it, stamp `delivered_at` with a single targeted update
  (`update pings set delivered_at = now() where id = ? and delivered_at is
  null`) — independent of which chat is open, so delivery is recorded even while
  the receiver is viewing another contact. `read_at` is handled separately by
  `mark_read` (open-and-focused only). A message read while focused will have
  both stamped; `delivered_at` is never blocked on the chat being open.

### Disappearing messages (Plan 2)

- **Header control.** A small control in the chat header (next to the
  file-gallery trigger) shows the current timer and opens a `createPopupMenu`
  (Off / 24h / 7d). Selecting calls `set_disappearing`.
- **In-thread confirmation.** A system line ("Försvinnande meddelanden: 24h")
  confirms the change in the conversation.
- **Lazy expiry filter.** The client filters out already-expired messages on
  load, as a belt-and-suspenders complement to the cron sweep.

### Dismiss → delete reframing

- Keep the existing `dismissPing` → `dismiss_ping` code path and mechanism
  (per-side flag, both-sides-delete-the-row). Only the **meaning** changes:
  from ambient auto-cleanup to a deliberate user-initiated delete. Reframe the
  button label (`aria-label="Ta bort"`). Confirmation prompt optional.
- **Critical behavior change:** messages no longer auto-dismiss. Any existing
  auto-dismiss timers / behaviors in the chat stream (e.g. auto-dismiss of a
  received file after download) must be removed so messages persist by default.

## Scope & sequencing

Split into two implementation plans so the first ships the must-haves and the
new/risky pieces are isolated.

### Plan 1 — Durable history + read/unread

- Schema: `delivered_at`, `read_at` columns; `mark_read` RPC.
- Remove auto-dismiss-on-both behaviors; reframe ✕ as explicit delete.
- Durable, DB-backed unread counts (load-time query + realtime cache).
- Paged scrollback with date separators.
- Sender-side read receipts via realtime UPDATE subscription + `renderPingStatus`.
- Update [FEATURE_IDEAS.md](../../../FEATURE_IDEAS.md) philosophy and the
  [README.md](../../../README.md) feature list to reflect durable history.

### Plan 2 — Disappearing messages

- Schema: `disappearing_ttl` on `contacts`; `set_disappearing` RPC;
  `purge_expired_pings()` + `pg_cron` daily sweep.
- Header timer control (Off / 24h / 7d) via `createPopupMenu`.
- In-thread confirmation line.
- Lazy expiry filtering on load.

### Out of scope (future, each its own plan)

- Search across history.
- Reply-to-message threading.
- Emoji reactions.

## Testing

- **Schema:** apply migrations to a scratch Supabase project; verify
  idempotency (run each new section twice). Verify `mark_read`,
  `set_disappearing`, and `purge_expired_pings` authorization (caller must be a
  pair member; non-members rejected).
- **Read state:** open a chat focused → counterparty's sent messages flip to
  read; sidebar unread badge clears and survives reload.
- **Receipts:** with two sessions, sending then reading a message updates the
  sender's indicator live (sent → delivered → read).
- **Scrollback:** seed >50 messages; verify initial load shows the latest 50,
  "ladda äldre" prepends the prior page with correct date separators and no
  duplicates.
- **Disappearing:** set 24h; verify new messages carry the timer, expired
  messages are filtered on load, and `purge_expired_pings` deletes rows and
  their storage objects.
- **Persistence regression:** confirm messages no longer disappear on dismiss
  by one side; ✕ deletes only the caller's copy until both delete.
- **Python tests** (`tests/`) are backend/link-preview focused and unaffected;
  run them to confirm no regression.
