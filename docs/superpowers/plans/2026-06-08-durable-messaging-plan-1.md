# Durable Messaging — Plan 1: Durable history + read/unread — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Ping's transient pings into a durable conversation log with paged scrollback, date separators, DB-backed read/unread counts, and live sender-side delivery/read receipts — while keeping ✕ as an explicit per-side delete (no more auto-dismiss).

**Architecture:** Additive, idempotent schema changes (`delivered_at`/`read_at` columns + a `mark_read` security-definer RPC) following the existing numbered-section conventions in `supabase/schema.sql`. Frontend changes are confined to `static/app.js`: `loadPings` becomes paged (latest 50, cursor-based "ladda äldre"), render gains day-grouping separators and a per-message status indicator, realtime gains a `pings` UPDATE handler plus a `delivered_at` stamp on INSERT, and unread counts move from a session-only in-memory map to a DB-backed load-time query with the in-memory map kept as a live cache. The auto-dismiss timer and auto-dismiss-after-download behaviors are removed so messages persist by default.

**Tech Stack:** Supabase (Postgres + RLS + Realtime via `@supabase/supabase-js`), vanilla HTML/CSS/JS frontend (`static/app.js`, `static/index.html`, `static/style.css`). Backend is FastAPI but is **not touched** by this plan. There is no JS test harness — frontend changes are verified manually against a running app (`uvicorn server:app --reload`) and a scratch Supabase project; the Python tests in `tests/` are backend/link-preview only and are run once at the end to confirm no regression.

**Branching (decided):** This work lands on a **new branch off `main`** named `feat/durable-messaging`, created **after** `feat/file-gallery` merges to `main` (Plan 1 reuses the `formatDate` helper and overlay/gallery primitives that arrive with file-gallery). Do not start Task 1 until `feat/file-gallery` is on `main` and the new branch is cut from it.

**Docs tone (decided):** Reframe `FEATURE_IDEAS.md` and `README.md` to "durable by default, with opt-in disappearing messages (coming)" while preserving Ping's fast/private/lightweight retro identity. Remove only the framing that now contradicts the code (the "disposable, not a chat product" stance, the per-ping auto-dismiss idea, the both-sides-delete description).

---

## Pre-flight (do once, before Task 1)

- [ ] Confirm `feat/file-gallery` has merged to `main`. Run: `git checkout main && git pull && git log --oneline -5`. Expected: file-gallery commits present on `main`.
- [ ] Cut the working branch. Run: `git checkout -b feat/durable-messaging`. Expected: `Switched to a new branch 'feat/durable-messaging'`.
- [ ] Confirm the `formatDate` helper exists (used by Task 5). Run: `grep -n "function formatDate" static/app.js`. Expected: one match around `static/app.js:1549` returning `dd/mm` via `toLocaleDateString("sv-SE", …)`.

## Environment for verification

Several tasks need a runnable app and a Supabase project with two distinct users who are accepted contacts.

- **App:** `uvicorn server:app --reload`, open <http://localhost:8000>. A `.env` with `SUPABASE_URL` + `SUPABASE_ANON_KEY` must point at the scratch project.
- **Two sessions:** sign in as user A in a normal window and user B in a private/incognito window (or a second browser). Accept the contact request so A⇄B are accepted contacts. Keep both windows visible side-by-side for receipt testing.
- **SQL:** run schema sections in the Supabase Dashboard → SQL Editor (or `psql`). "Run section twice" means paste-and-run the same block a second time and confirm no error (idempotency).

---

## File Structure

- **`supabase/schema.sql`** — append a new numbered section **11. DURABLE MESSAGING (read/delivery state)** holding the two `alter table … add column if not exists` statements and the `mark_read` RPC. Mirrors the idempotent, security-definer style of sections 9 and 10. No other section changes (the existing select policy already governs visibility via the dismiss flags).
- **`static/app.js`** — all client changes:
  - `loadPings` rewritten for paging + a module-level paging-state object.
  - New `renderPingStatus(el, ping)` helper and a status-element slot added to self-sent pings in `renderPing`.
  - New `formatDaySeparator(ts)` helper and a `renderDaySeparatorIfNeeded(ping)` insertion path during render.
  - New `loadUnreadCounts()` (DB-backed) called on app entry; `selectContact` calls `mark_read`; a window `focus` handler calls `mark_read` for the open chat.
  - `subscribeToRealtime` gains a `pings` UPDATE handler (sender-side receipts) and stamps `delivered_at` on the INSERT it already handles.
  - Remove the 20s auto-dismiss timer and the two auto-dismiss-after-download call sites; reframe the ✕ `aria-label`.
- **`static/index.html`** — no structural change required; the status indicator and date separators are created in JS and appended to existing `#board`. (If a CSS hook is needed it goes in `style.css`.)
- **`static/style.css`** — small additions: `.day-separator`, `.ping-status` (and a read-styled modifier). No layout rework.
- **`FEATURE_IDEAS.md`**, **`README.md`** — docs reframing (Task 9).

> **Note on TDD:** The backend has pytest; the frontend does not. Schema tasks are verified with explicit SQL idempotency + authorization checks (the closest available analog to a failing-then-passing test). Frontend tasks specify exact manual verification steps with expected observed behavior. Follow them literally — do not claim a frontend step passes without performing the described observation.

---

### Task 1: Schema — `delivered_at` / `read_at` columns + `mark_read` / `mark_delivered` RPCs

**Files:**
- Modify: `supabase/schema.sql` (append new section 11 after section 10, which currently ends at `supabase/schema.sql:421`)

> **Why two RPCs:** `pings` has RLS enabled with only SELECT and INSERT policies — there is **no UPDATE policy** — so a client `update` on `pings` is denied (affects 0 rows). Both `read_at` and `delivered_at` must therefore be written through security-definer RPCs, exactly like `dismiss_ping`. `mark_delivered(p_id)` is what Task 8 calls when the receiver's client gets a realtime INSERT.

- [ ] **Step 1: Append section 11 to the schema**

Add to the end of `supabase/schema.sql`:

```sql
-- ============================================================
-- 11. DURABLE MESSAGING — read/delivery state + mark_read/mark_delivered RPCs
-- Idempotent: existing deployments can run just this section.
-- Pings now persist as a durable conversation log. Two timestamps track
-- delivery and read state per message:
--   delivered_at: stamped when the receiver's client receives the realtime
--                 INSERT (or on next load if it was offline at send), via the
--                 mark_delivered RPC below.
--   read_at:      stamped when the receiver opens that chat with the tab
--                 focused, via the mark_read RPC below.
-- The per-side dismiss flags (section 9) still govern row visibility; these
-- columns are orthogonal to dismissal. Unread count = pings where
-- receiver_id = me, read_at is null, and not dismissed_by_receiver.
-- NOTE: pings has no UPDATE RLS policy (RLS is enabled with only SELECT/INSERT
-- policies), so clients CANNOT update delivered_at/read_at directly — these
-- stamps are written exclusively through the two security-definer RPCs below,
-- matching the dismiss_ping (section 9) mutation pattern.
-- ============================================================

alter table public.pings add column if not exists delivered_at timestamptz;
alter table public.pings add column if not exists read_at      timestamptz;

-- Partial index: the durable unread-count query filters on
-- (receiver_id, read_at is null) and the receiver's own non-dismissed rows.
create index if not exists pings_unread_idx
  on public.pings (receiver_id)
  where read_at is null;

-- mark_read: stamp read_at = now() on every ping the caller has received from
-- a given counterparty that is still unread. p_other is the counterparty's
-- user id (the "recipientId" the client already tracks per chat). Security
-- definer with an explicit auth check: the caller may only mark their OWN
-- received messages read, so no pair-membership lookup is needed beyond
-- receiver_id = auth.uid(). Mirrors the dismiss_ping (section 9) pattern.
create or replace function public.mark_read(p_other uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.pings
    set read_at = now()
    where receiver_id = auth.uid()
      and sender_id = p_other
      and read_at is null
      and not dismissed_by_receiver;
end;
$$;

grant execute on function public.mark_read(uuid) to authenticated;

-- mark_delivered: stamp delivered_at = now() on a single ping the caller has
-- received, if not already stamped. p_id is the ping's id. The caller may only
-- mark a message delivered when they are its receiver (receiver_id =
-- auth.uid()); the `delivered_at is null` guard makes repeat calls a no-op.
-- This exists because pings has no UPDATE RLS policy — the receiver's client
-- cannot write delivered_at directly, so it goes through this RPC. Mirrors the
-- mark_read / dismiss_ping pattern.
create or replace function public.mark_delivered(p_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.pings
    set delivered_at = now()
    where id = p_id
      and receiver_id = auth.uid()
      and delivered_at is null;
end;
$$;

grant execute on function public.mark_delivered(uuid) to authenticated;
```

- [ ] **Step 2: Apply section 11 to the scratch Supabase project**

In the Supabase Dashboard → SQL Editor, paste and run the section-11 block.
Expected: success, no error. The `pings` table now has `delivered_at` and `read_at` columns.

- [ ] **Step 3: Verify idempotency — run section 11 a second time**

Paste and run the exact same block again.
Expected: success, no error (the `add column if not exists`, `create index if not exists`, and `create or replace function` are all idempotent).

- [ ] **Step 4: Verify columns exist**

Run in SQL Editor:
```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'pings'
  and column_name in ('delivered_at', 'read_at');
```
Expected: two rows — `delivered_at | timestamp with time zone`, `read_at | timestamp with time zone`.

- [ ] **Step 5: Verify `mark_read` authorization (only marks the caller's received messages)**

As user A (the caller), seed one message from B→A and one from A→B, both unread. While authenticated as A, run via the SQL Editor's "Run as" / impersonation, or from the app console: `await sb.rpc('mark_read', { p_other: '<B_user_id>' })`. Then:
```sql
select sender_id, receiver_id, read_at from public.pings
where (sender_id = '<A>' and receiver_id = '<B>')
   or (sender_id = '<B>' and receiver_id = '<A>');
```
Expected: the **B→A** row has a non-null `read_at`; the **A→B** row's `read_at` is still null (the caller cannot mark messages they sent as read). Calling `mark_read('<B>')` again leaves `read_at` unchanged (only `read_at is null` rows are touched).

- [ ] **Step 6: Verify `mark_delivered` authorization (only the receiver can stamp; idempotent)**

As user A, take the id of a B→A message with `delivered_at` null. Authenticated as **A** (the receiver), run `await sb.rpc('mark_delivered', { p_id: '<that_id>' })` from the app console; then re-query that row.
Expected: its `delivered_at` is now non-null. Call it again → unchanged (the `delivered_at is null` guard). Now authenticated as **B** (the sender, not the receiver), call `mark_delivered` on an A→B message id whose `delivered_at` is null — i.e. a message B sent, so B is not the receiver.
Expected: `delivered_at` stays null (the `receiver_id = auth.uid()` guard blocks a non-receiver from stamping).

- [ ] **Step 7: Commit**

```bash
git add -f supabase/schema.sql
git commit -m "feat(schema): add delivered_at/read_at + mark_read/mark_delivered RPCs"
```

> Note: `supabase/` is tracked normally (only `docs/` needs `-f`). Use `git add supabase/schema.sql` if `-f` is rejected as unnecessary; the `-f` is harmless and matches the repo convention of force-adding tracked-but-ignored paths.

---

### Task 2: Remove auto-dismiss behaviors (messages persist by default)

This is the highest-risk behavior change and is done first on the client so all later rendering work is built on the persistent model. Three call sites in `static/app.js`.

**Files:**
- Modify: `static/app.js` — `renderPing` 20s timer (`static/app.js:962-968`), download-button auto-dismiss (`static/app.js:940-944`), video-fallback download auto-dismiss (`static/app.js:906-909`)

- [ ] **Step 1: Remove the 20s auto-dismiss timer at the end of `renderPing`**

Find this block (currently ~`static/app.js:962-968`):

```javascript
  // Auto-remove on timer for freshly-arrived pings only — historical pings
  // loaded on chat open keep until the user dismisses them. Received files
  // also wait for download instead of timing out.
  const isReceivedFile = ping.type === "file" && !isSelf;
  if (animate && !isReceivedFile) {
    el._dismissTimer = setTimeout(() => dismissPing(el, ping), 20000);
  }
```

Delete it entirely. Messages now persist; `renderPing`'s last statement before this block (the inline-video download wiring) becomes the end of the function body.

- [ ] **Step 2: Remove the auto-dismiss in the standard download-button handler**

Find this block (currently ~`static/app.js:936-945`):

```javascript
  const dlBtn = el.querySelector(".download-btn");
  if (dlBtn) {
    dlBtn.addEventListener("click", async () => {
      await downloadFile(dlBtn.dataset.path, dlBtn.dataset.name);
      // Auto-dismiss file pings after download for receiver
      if (!isSelf) {
        dismissPing(el, ping);
      }
    });
  }
```

Replace with:

```javascript
  const dlBtn = el.querySelector(".download-btn");
  if (dlBtn) {
    dlBtn.addEventListener("click", () => {
      downloadFile(dlBtn.dataset.path, dlBtn.dataset.name);
    });
  }
```

- [ ] **Step 3: Remove the auto-dismiss in the video-fallback download handler**

Find this block inside the video-fetch failure fallback (currently ~`static/app.js:905-909`):

```javascript
        const dlFallback = info.querySelector(".download-btn");
        dlFallback.addEventListener("click", async () => {
          await downloadFile(dlFallback.dataset.path, dlFallback.dataset.name);
          if (!isSelf) dismissPing(el, ping);
        });
```

Replace with:

```javascript
        const dlFallback = info.querySelector(".download-btn");
        dlFallback.addEventListener("click", () => {
          downloadFile(dlFallback.dataset.path, dlFallback.dataset.name);
        });
```

- [ ] **Step 4: Confirm no remaining auto-dismiss call sites**

Run: `grep -n "_dismissTimer\|dismissPing(el, ping)" static/app.js`
Expected: matches only inside `dismissPing` itself (`clearTimeout(el._dismissTimer)` at the top is now dead but harmless — leave it, or remove the `clearTimeout` line if you prefer; do not remove the `dismissPing` function) and the ✕-button click handler at `static/app.js:933` (`el.querySelector(".dismiss-btn").addEventListener("click", () => dismissPing(el, ping))`). There must be **no** `setTimeout(... dismissPing ...)` and **no** `if (!isSelf) dismissPing` remaining.

- [ ] **Step 5: Manual verification — messages persist**

Run the app, open A⇄B chat. From B, send A a text message; from A's window, do **not** touch it. Wait 30 seconds.
Expected: the message stays on screen (previously it faded out at 20s). Send a file from B to A, download it from A.
Expected: the file message **stays** after download (previously it auto-dismissed). The ✕ button still removes it when clicked.

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "feat(pings): remove auto-dismiss timers so messages persist by default"
```

---

### Task 3: Reframe ✕ from "dismiss" to explicit "delete"

The mechanism (per-side flag, both-sides-delete via `dismiss_ping`) is unchanged; only the label/meaning changes. The ✕ button's `aria-label` is `"Avfärda"` (dismiss) in three places in `renderPing`.

**Files:**
- Modify: `static/app.js` — three `aria-label="Avfärda"` occurrences in `renderPing` (text ping `static/app.js:802`, video file `static/app.js:815`, image/other file `static/app.js:828`)

- [ ] **Step 1: Re-label all three ✕ buttons to "Ta bort"**

Run: `grep -n 'aria-label="Avfärda"' static/app.js`
Expected: three matches, all inside `renderPing`.

Replace each `aria-label="Avfärda"` with `aria-label="Ta bort"`. (Use a careful find/replace across exactly these three occurrences. Verify none outside `renderPing` are affected — the grep above should show only `renderPing` lines.)

- [ ] **Step 2: Verify the relabel**

Run: `grep -n 'aria-label="Avfärda"' static/app.js && echo "STILL PRESENT" || echo "none remaining"`
Expected: `none remaining`.
Run: `grep -n 'aria-label="Ta bort"' static/app.js`
Expected: three matches in `renderPing`.

- [ ] **Step 3: Manual verification**

Run the app, open a chat with at least one message. Hover/focus the ✕ button.
Expected: the accessible label now reads "Ta bort" (inspect via devtools accessibility pane or the title/aria). Clicking it still removes only the caller's copy (the message reappears for the other side until they also delete it — this is the existing per-side mechanism, unchanged).

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat(pings): reframe ✕ button from dismiss to explicit delete (aria-label)"
```

---

### Task 4: Paged scrollback — load latest 50 with a cursor

Rewrite `loadPings` to fetch the most recent 50 rows (descending in the query, rendered ascending) and add a "ladda äldre" affordance that prepends the previous page using a `created_at` cursor.

**Files:**
- Modify: `static/app.js` — `loadPings` (`static/app.js:751-772`); add module-level paging state near the other app-state vars (`static/app.js:105-114`)
- Modify: `static/style.css` — add `.load-older` button style

- [ ] **Step 1: Add paging-state variables**

Near the existing app-state declarations (after `let onlineUserIds = new Set();` at `static/app.js:114`), add:

```javascript
const PINGS_PAGE_SIZE = 50;
// Paging state for the open chat's scrollback. oldestLoadedAt is the
// created_at of the topmost rendered message, used as the cursor for the next
// older page. hasMoreOlder is false once a page returns fewer than
// PINGS_PAGE_SIZE rows (we've reached the start of history). loadingOlder
// guards against overlapping "ladda äldre" fetches.
let oldestLoadedAt = null;
let hasMoreOlder = false;
let loadingOlder = false;
```

- [ ] **Step 2: Rewrite `loadPings` to load the latest page**

Replace the entire `loadPings` function (`static/app.js:751-772`) with:

```javascript
async function loadPings() {
  if (!selectedContact) return;

  const { recipientId } = selectedContact;
  // Fetch the most recent PINGS_PAGE_SIZE rows: order DESC + limit, then
  // reverse so we render oldest→newest into the board.
  const { data: pings, error } = await sb
    .from("pings")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${recipientId}),` +
        `and(sender_id.eq.${recipientId},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: false })
    .limit(PINGS_PAGE_SIZE);

  if (error) {
    console.error("Failed to load pings:", error);
    return;
  }

  const page = (pings || []).slice().reverse(); // oldest → newest
  hasMoreOlder = (pings || []).length === PINGS_PAGE_SIZE;
  oldestLoadedAt = page.length ? page[0].created_at : null;

  board.innerHTML = "";
  renderLoadOlderControl();
  let prev = null;
  page.forEach((ping) => {
    renderDaySeparatorIfNeeded(ping, prev);
    renderPing(ping, false);
    prev = ping;
  });
  scrollToBottom();
}
```

> `renderDaySeparatorIfNeeded` is defined in Task 5 and `renderLoadOlderControl` in Step 3 below. If executing strictly in order, define stubs that no-op until those tasks land, or sequence Task 5 before running the app. For review simplicity, implement Step 3 + Task 5 before the manual verification step.

- [ ] **Step 3: Add the "ladda äldre" control and its prepend logic**

The load-older button lives at the top of `#board` as the first child. The
prepend anchor is always **the node right after the button** (the current
top-of-history element), so the older page is inserted between the button and
the existing messages. This keeps the button's position stable and makes the
anchor unambiguous. Add these functions immediately after `loadPings`:

```javascript
// Inserts (or refreshes) the "ladda äldre" button as the first child of #board.
// Removed when there is no older history left. Returns the button element (or
// null when there's no more history) so callers can anchor a prepend to it.
function renderLoadOlderControl() {
  let ctl = document.getElementById("load-older");
  if (!hasMoreOlder) {
    if (ctl) ctl.remove();
    return null;
  }
  if (!ctl) {
    ctl = document.createElement("button");
    ctl.id = "load-older";
    ctl.className = "load-older";
    ctl.type = "button";
    ctl.textContent = "ladda äldre";
    ctl.addEventListener("click", loadOlderPings);
  }
  // Always keep it as the first child so it stays at the very top.
  if (board.firstChild !== ctl) board.insertBefore(ctl, board.firstChild);
  return ctl;
}

// Fetches the page of messages older than oldestLoadedAt and prepends them,
// preserving the user's scroll position (so the viewport doesn't jump).
async function loadOlderPings() {
  if (!selectedContact || loadingOlder || !hasMoreOlder || !oldestLoadedAt) return;
  loadingOlder = true;
  const { recipientId } = selectedContact;

  const { data: pings, error } = await sb
    .from("pings")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${recipientId}),` +
        `and(sender_id.eq.${recipientId},receiver_id.eq.${currentUser.id})`
    )
    .lt("created_at", oldestLoadedAt)
    .order("created_at", { ascending: false })
    .limit(PINGS_PAGE_SIZE);

  loadingOlder = false;
  if (error) {
    console.error("Failed to load older pings:", error);
    return;
  }

  const older = (pings || []).slice().reverse(); // oldest → newest
  hasMoreOlder = (pings || []).length === PINGS_PAGE_SIZE;
  if (!older.length) {
    renderLoadOlderControl(); // removes the button if history is now exhausted
    return;
  }

  // Scroll anchoring: capture height/top before prepending, restore after, so
  // the messages the user was looking at stay put instead of jumping.
  const prevHeight = chatMain.scrollHeight;
  const prevTop = chatMain.scrollTop;

  // The button (if present) is board.firstChild; the anchor is the node right
  // after it — i.e. the current top-of-history element the older page slots in
  // front of. If the button isn't present (shouldn't happen here, since we only
  // got here via the button), fall back to board.firstChild.
  const btn = document.getElementById("load-older");
  const anchor = btn ? btn.nextSibling : board.firstChild;

  // `anchor` is the first pre-existing chat node. It is a `.day-separator` iff
  // the existing top message began a day. Remember it so we can dedupe the
  // boundary after inserting (the inserted page may end on that same day).
  const preExistingLeadingSep =
    anchor && anchor.classList && anchor.classList.contains("day-separator")
      ? anchor
      : null;

  let prev = null;
  older.forEach((ping) => {
    renderDaySeparatorIfNeeded(ping, prev, anchor);
    renderPingBefore(ping, anchor);
    prev = ping;
  });

  oldestLoadedAt = older[0].created_at;
  // `prev` is now the last (newest) inserted message. If the pre-existing
  // leading separator is for the same day, it's a duplicate — remove it.
  if (
    preExistingLeadingSep &&
    prev &&
    preExistingLeadingSep.dataset.dayKey === dayKey(prev.created_at)
  ) {
    preExistingLeadingSep.remove();
  }

  renderLoadOlderControl(); // refresh/remove the button per hasMoreOlder
  chatMain.scrollTop = prevTop + (chatMain.scrollHeight - prevHeight);
}
```

> `renderPingBefore`, `renderDaySeparatorIfNeeded` (with optional `beforeNode`),
> and the `dayKey` helper are defined in Task 5. They are referenced here so the
> paging logic reads end-to-end; Task 5 supplies them. **Implement Task 5 before
> running the app for this task's manual verification.** (The boundary-dedupe is
> handled inline above, so the separate `dedupeBoundarySeparator` helper from an
> earlier draft is not needed — Task 5 no longer defines it.)

- [ ] **Step 4: Add the `.load-older` button style**

Append to `static/style.css` (match the retro-terminal aesthetic — borderless, muted, centered):

```css
.load-older {
  display: block;
  margin: 0.5rem auto;
  padding: 0.25rem 0.75rem;
  background: none;
  border: none;
  color: var(--muted, #6b7280);
  font: inherit;
  font-size: 0.85em;
  cursor: pointer;
  opacity: 0.8;
}
.load-older:hover { opacity: 1; text-decoration: underline; }
```

> Verify `--muted` (or the project's muted-text variable) exists in `style.css`. Run `grep -n "\-\-muted\|--text-muted\|--fg-muted" static/style.css` and use whichever the project defines; fall back to a literal color matching nearby `.meta`/timestamp styling if none.

- [ ] **Step 5: Manual verification (requires Task 5 implemented)**

Seed >50 messages between A and B (e.g. paste a short loop into the app console as A: `for (let i=0;i<60;i++){ await sb.from('pings').insert({sender_id: currentUser.id, receiver_id: selectedContact.recipientId, type:'text', content:'seed '+i}); }` — then reload). Open the chat.
Expected: initial load shows the **latest 50** messages, scrolled to the bottom; a "ladda äldre" button sits at the very top. Click it.
Expected: the previous page (older messages) prepends above, the viewport stays anchored (no jump to top), date separators are correct at the boundary with **no duplicate** separator, and no message appears twice. When history is exhausted, "ladda äldre" disappears.

- [ ] **Step 6: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat(history): page scrollback to latest 50 with cursor-based ladda äldre"
```

---

### Task 5: Date separators (day grouping)

Add an "Idag / Igår / 8 juni"-style divider inserted whenever the day changes between consecutive messages, during both initial render and older-page prepend. Provide the `renderPingBefore` insert variant and the separator helpers referenced by Task 4.

**Files:**
- Modify: `static/app.js` — add `formatDaySeparator`, `dayKey`, `makeDaySeparator`, `renderDaySeparatorIfNeeded`, `renderPingBefore`; small refactor of `renderPing` to support a `beforeNode`
- Modify: `static/style.css` — `.day-separator` style

> The boundary-dedupe needed when prepending an older page is handled **inline** in `loadOlderPings` (Task 4 Step 3), using the `dayKey` helper defined here. There is no separate `dedupeBoundarySeparator` function.

- [ ] **Step 1: Add `formatDaySeparator(ts)`**

Add near `formatDate` (`static/app.js:1549`):

```javascript
// Day-separator label for the conversation log: "Idag" / "Igår" / otherwise a
// localized day. Reuses the sv-SE locale conventions of formatDate/formatTime.
function formatDaySeparator(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dayMs = 86400000;
  const diffDays = Math.round((startOf(today) - startOf(d)) / dayMs);
  if (diffDays === 0) return "Idag";
  if (diffDays === 1) return "Igår";
  // Within the current year: "8 juni"; older: include the year.
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Stable yyyy-mm-dd key for comparing two timestamps' calendar day (local).
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Builds a day-separator element for a given timestamp.
function makeDaySeparator(ts) {
  const sep = document.createElement("div");
  sep.className = "day-separator";
  sep.dataset.dayKey = dayKey(ts);
  sep.textContent = formatDaySeparator(ts);
  return sep;
}
```

- [ ] **Step 2: Add `renderDaySeparatorIfNeeded(ping, prev, beforeNode)`**

Add immediately after the helpers above:

```javascript
// Inserts a day separator before `ping` when its calendar day differs from the
// previous rendered message's day (or when prev is null — first message of the
// page). When beforeNode is given, insert before it (prepend path); otherwise
// append to the board (initial-load path).
function renderDaySeparatorIfNeeded(ping, prev, beforeNode = null) {
  if (prev && dayKey(prev.created_at) === dayKey(ping.created_at)) return;
  const sep = makeDaySeparator(ping.created_at);
  if (beforeNode) {
    board.insertBefore(sep, beforeNode);
  } else {
    board.appendChild(sep);
  }
}
```

- [ ] **Step 3: Refactor `renderPing` to accept an optional insert target**

`renderPing` currently always `board.appendChild(el)` (`static/app.js:833`). Generalize it so older-page rendering can insert before an anchor, without duplicating the function.

Change the signature and the single append. Find (`static/app.js:793`):

```javascript
function renderPing(ping, animate = true) {
```

Replace with:

```javascript
function renderPing(ping, animate = true, beforeNode = null) {
```

Find the append (`static/app.js:833`):

```javascript
  board.appendChild(el);
```

Replace with:

```javascript
  if (beforeNode) {
    board.insertBefore(el, beforeNode);
  } else {
    board.appendChild(el);
  }
```

Then add a thin wrapper used by the prepend path (place after `renderPing`):

```javascript
// Convenience: render a ping inserted before an existing node (used when
// prepending an older page). Never animates historical messages.
function renderPingBefore(ping, beforeNode) {
  renderPing(ping, false, beforeNode);
}
```

- [ ] **Step 4: Add `.day-separator` style**

Append to `static/style.css`:

```css
.day-separator {
  text-align: center;
  margin: 0.75rem auto 0.25rem;
  font-size: 0.75em;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted, #6b7280);
  opacity: 0.7;
  user-select: none;
}
```

- [ ] **Step 5: Manual verification**

With seeded messages spanning multiple days (adjust some seeded rows' `created_at` in SQL, e.g. `update pings set created_at = now() - interval '1 day' where content like 'seed 1%';`), open the chat.
Expected: a separator appears at each day boundary — "Idag" for today's block, "Igår" for yesterday, "8 juni"-style for older. Click "ladda äldre".
Expected: separators in the prepended page are correct, and the boundary between the prepended page and the pre-existing top shows exactly **one** separator for that day (no duplicate).

- [ ] **Step 6: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat(history): day separators (Idag/Igår/date) across load and prepend"
```

---

### Task 6: Durable, DB-backed unread counts

Replace the session-only `unreadCounts` source-of-truth with a DB query at load time; keep the in-memory map as a live cache updated by realtime. Also drop the now-meaningless 20s decrement in realtime (handled fully in Task 8, but the count semantics change here).

**Files:**
- Modify: `static/app.js` — add `loadUnreadCounts`; call it in `enterApp` (`static/app.js:454-456`); keep `unreadCounts` map (`static/app.js:111`) as cache

- [ ] **Step 1: Add `loadUnreadCounts()`**

Add near `loadContacts` (after `loadContacts`, ~`static/app.js:546`):

```javascript
// Source of truth for the sidebar unread badges on load: how many messages
// each contact has sent me that I haven't read yet (and haven't deleted).
// Populates the in-memory unreadCounts map keyed by the sender's id (which is
// the contact's recipientId in sidebar terms). Realtime keeps it live after.
async function loadUnreadCounts() {
  const { data, error } = await sb
    .from("pings")
    .select("sender_id")
    .eq("receiver_id", currentUser.id)
    .is("read_at", null)
    .eq("dismissed_by_receiver", false);

  if (error) {
    console.error("Failed to load unread counts:", error);
    return;
  }

  const counts = {};
  (data || []).forEach((row) => {
    counts[row.sender_id] = (counts[row.sender_id] || 0) + 1;
  });
  unreadCounts = counts;
}
```

> This counts client-side from a thin `sender_id`-only projection. With realistic two-person volumes this is fine; if history grows large, a future optimization is a grouped RPC, but YAGNI for now.

- [ ] **Step 2: Call it during app entry, before rendering contacts**

In `enterApp` (`static/app.js:454-456`), the current tail is:

```javascript
  await loadContacts();
  subscribeToRealtime();
  subscribePresence();
```

Replace with:

```javascript
  await loadUnreadCounts();
  await loadContacts();
  subscribeToRealtime();
  subscribePresence();
```

(`loadContacts` calls `renderContacts`, which reads `unreadCounts`; populating counts first means the badges are correct on first paint.)

- [ ] **Step 3: Clear the cache on exit (already present — verify)**

Confirm `exitApp` still resets the map. Run: `grep -n "unreadCounts = {}" static/app.js`
Expected: a match in `exitApp` (`static/app.js:463`). No change needed.

- [ ] **Step 4: Manual verification — badge survives reload**

As B, send A three messages while A's chat with B is **closed** (A is viewing a different contact or no chat). In A's window, observe the sidebar badge shows `3` for B. **Reload A's page.**
Expected: after reload, the badge for B still shows `3` (previously it reset to 0 on reload because counts were session-only). Open the B chat as A (focused) — see Task 7 for the clearing behavior.

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat(unread): DB-backed unread counts that survive reload"
```

---

### Task 7: Mark read on open + on window focus

On `selectContact`, if the tab is focused, call `mark_read(recipientId)` and clear that contact's badge. Also call it on window `focus` while a chat is open. This replaces the old optimistic `unreadCounts[recipientId] = 0` reset with a DB-backed one.

**Files:**
- Modify: `static/app.js` — `selectContact` (`static/app.js:728-749`); add a window `focus` listener near other global listeners

- [ ] **Step 1: Add a `markChatRead` helper**

Add after `selectContact` (~`static/app.js:749`):

```javascript
// Marks the open chat's incoming messages read in the DB (only when the tab is
// focused — an open-but-backgrounded chat shouldn't count as read), then clears
// the local badge for that contact and re-renders the sidebar.
async function markChatRead() {
  if (!selectedContact || !document.hasFocus()) return;
  const { recipientId } = selectedContact;
  const { error } = await sb.rpc("mark_read", { p_other: recipientId });
  if (error) {
    console.error("mark_read failed:", error);
    return;
  }
  if (unreadCounts[recipientId]) {
    unreadCounts[recipientId] = 0;
    renderContacts();
  }
}
```

- [ ] **Step 2: Replace the optimistic reset in `selectContact` with a `mark_read` call**

In `selectContact`, the current block (`static/app.js:732-735`) is:

```javascript
  if (unreadCounts[recipientId]) {
    unreadCounts[recipientId] = 0;
    renderContacts();
  }
```

Remove that block. Then, at the end of `selectContact`, after `await loadPings();` and `textInput.focus();` (`static/app.js:747-748`), add:

```javascript
  await markChatRead();
```

So the tail of `selectContact` reads:

```javascript
  await loadPings();
  textInput.focus();
  await markChatRead();
```

(Clearing the badge now goes through `markChatRead`, which both stamps the DB and updates the cache — keeping the two in sync. If the tab is somehow not focused at selection time, `markChatRead` no-ops and the badge persists, which is correct.)

- [ ] **Step 3: Mark read when the window regains focus while a chat is open**

Add near the other top-level `window.addEventListener` calls (e.g. by the `hashchange` listener at `static/app.js:2188`):

```javascript
// A received message counts as read when its chat is open AND the tab is
// focused. Selecting a contact handles the open case; this handles the
// "chat already open, user tabs back in" case.
window.addEventListener("focus", () => {
  markChatRead();
});
```

- [ ] **Step 4: Manual verification — read clears the badge and persists**

As B, send A two messages while A's B-chat is closed → A's sidebar shows badge `2`. As A, open the B chat with the tab focused.
Expected: badge clears to 0; reloading A keeps it at 0 (the DB now has `read_at` set, so `loadUnreadCounts` returns 0 for B).
Then test the focus path: as A, open the B chat, switch to another app/tab (blurring), have B send a message. The badge should reflect the new unread while blurred (Task 8 increments it). Tab back to A.
Expected: on regaining focus, the new message is marked read and the badge clears.

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat(unread): mark_read on chat open and on window focus"
```

---

### Task 8: Realtime — mark delivered on INSERT, sender-side receipts on UPDATE

Two changes to `subscribeToRealtime`: (1) when the receiver's client gets the INSERT for a message addressed to it, stamp `delivered_at`; (2) add a `pings` UPDATE subscription so a sender sees their message's status change live (sent → delivered → read). Also remove the obsolete 20s unread-decrement.

**Files:**
- Modify: `static/app.js` — `subscribeToRealtime` (`static/app.js:1308-1374`)

- [ ] **Step 1: In the existing INSERT handler, stamp `delivered_at` and drop the 20s decrement**

The current INSERT handler (`static/app.js:1319-1341`) is:

```javascript
      (payload) => {
        const ping = payload.new;
        const chatOpen = selectedContact && ping.sender_id === selectedContact.recipientId;

        if (chatOpen) {
          renderPing(ping);
          scrollToBottom();
        } else {
          // Chat not open: count it as unread and schedule a decrement when the
          // ping would have auto-expired (keeps the badge consistent with the
          // 20s ephemeral lifetime).
          unreadCounts[ping.sender_id] = (unreadCounts[ping.sender_id] || 0) + 1;
          renderContacts();
          setTimeout(() => {
            if (unreadCounts[ping.sender_id] > 0) {
              unreadCounts[ping.sender_id] -= 1;
              renderContacts();
            }
          }, 20000);
        }

        playPing();
      }
```

Replace with:

```javascript
      async (payload) => {
        const ping = payload.new;

        // Record delivery regardless of which chat is open. pings has no UPDATE
        // RLS policy, so we cannot write delivered_at with a direct client
        // update — it goes through the mark_delivered security-definer RPC
        // (Task 1), which stamps now() only when the caller is the receiver and
        // delivered_at is still null. delivered_at is never blocked on the chat
        // being open (read_at is the open-and-focused signal).
        if (ping.delivered_at == null) {
          const { error } = await sb.rpc("mark_delivered", { p_id: ping.id });
          if (error) console.error("mark_delivered failed:", error);
        }

        const chatOpen = selectedContact && ping.sender_id === selectedContact.recipientId;

        if (chatOpen) {
          renderDaySeparatorIfNeeded(ping, lastRenderedPing);
          renderPing(ping);
          lastRenderedPing = ping;
          scrollToBottom();
          // Chat is open; if the tab is focused, mark it read immediately.
          markChatRead();
        } else {
          // Chat not open: it's a durable unread. No timed decrement — the
          // badge persists until the chat is opened (mark_read) or the message
          // is deleted.
          unreadCounts[ping.sender_id] = (unreadCounts[ping.sender_id] || 0) + 1;
          renderContacts();
        }

        playPing();
      }
```

> `lastRenderedPing` is a module-level cursor tracking the last message appended to the open board, so a realtime INSERT can decide whether it needs a fresh day separator (e.g. the first message after midnight). Add it with the Task 4 paging state: `let lastRenderedPing = null;`. Set it in `loadPings` after the `page.forEach` loop: `lastRenderedPing = page.length ? page[page.length - 1] : null;`. Reset it to `null` at the top of `loadPings` before rendering, and in `exitApp` alongside the other state resets. Also set it in the send handler (Step 4) so locally-sent messages advance the cursor.

- [ ] **Step 2: Add a `pings` UPDATE subscription for sender-side receipts**

In `subscribeToRealtime`, after the INSERT `.on(...)` for pings and before (or after) the `contacts` `.on(...)` handlers, add a new `.on(...)`:

```javascript
    .on(
      "postgres_changes",
      {
        // Sender-side read/delivery receipts: when a message WE sent gets its
        // delivered_at / read_at stamped by the receiver, reflect it live. We
        // filter on sender_id = me so we only react to our own outgoing rows.
        event: "UPDATE",
        schema: "public",
        table: "pings",
        filter: `sender_id=eq.${currentUser.id}`,
      },
      (payload) => {
        const ping = payload.new;
        // Only relevant if this message is in the currently open chat.
        const inOpenChat =
          selectedContact && ping.receiver_id === selectedContact.recipientId;
        if (!inOpenChat) return;
        const el = board.querySelector(`[data-ping-id="${ping.id}"]`);
        if (el) renderPingStatus(el, ping);
      }
    )
```

> `data-ping-id` on the message element and `renderPingStatus` come from Task 9. Sequence Task 9 before this task's manual verification (the UPDATE handler is a no-op until message elements carry `data-ping-id` and the status helper exists).

- [ ] **Step 3: Manual verification — delivery stamped, badge no longer self-clears**

With A and B both online, A's chat with B **closed**: B sends A a message.
Expected: A's badge for B increments to 1 and **stays** (no 20s auto-decrement). In the DB, that message's `delivered_at` is now non-null (A's client stamped it on INSERT even though the chat was closed):
```sql
select content, delivered_at, read_at from public.pings
where receiver_id = '<A>' and sender_id = '<B>' order by created_at desc limit 1;
```
Expected: `delivered_at` non-null, `read_at` null.

- [ ] **Step 4: Update the send handler to advance the day-separator cursor**

The separator must be inserted **before** the new message, so `renderDaySeparatorIfNeeded` is called before `renderPing`. In the text send handler, replace the existing `renderPing(data); scrollToBottom();` (`static/app.js:1008-1009`) with:

```javascript
  renderDaySeparatorIfNeeded(data, lastRenderedPing);
  renderPing(data);
  lastRenderedPing = data;
  scrollToBottom();
```

Then apply the same three-line pattern (separator → render → advance cursor) to the file-upload send path wherever it renders a just-inserted ping inline. Run `grep -n "renderPing(" static/app.js` to locate every post-send render call site; each must insert a separator when the day changes and advance `lastRenderedPing`. (The `loadPings` and `loadOlderPings` call sites are not send paths and already manage the cursor/separators themselves — do not double-wrap those.)

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat(realtime): stamp delivered_at on receive, add sender-side receipt UPDATE sub"
```

---

### Task 9: Per-message status indicator (✓ / ✓✓ / read)

Add a status slot to **self-sent** messages and a `renderPingStatus(el, ping)` helper that renders sent → delivered → read. Tag every message element with `data-ping-id` so realtime UPDATE can find it.

**Files:**
- Modify: `static/app.js` — `renderPing` (add `data-ping-id` + a status slot for self pings; call `renderPingStatus` at render time); add `renderPingStatus`
- Modify: `static/style.css` — `.ping-status` + read modifier

- [ ] **Step 1: Tag every message element with its id**

In `renderPing`, right after `const el = document.createElement("div");` (`static/app.js:795`), add:

```javascript
  el.dataset.pingId = ping.id;
```

- [ ] **Step 2: Add a status slot to self-sent messages**

Self pings put the timestamp in `<div class="meta">…</div>`. Add a status span alongside it. For the **text** branch (`static/app.js:799-803`), change the `meta` line from:

```javascript
      <div class="meta">${formatTime(ping.created_at)}</div>
```

to (only meaningful for self, but harmless markup; we populate it conditionally in JS):

```javascript
      <div class="meta">${formatTime(ping.created_at)}<span class="ping-status" aria-hidden="true"></span></div>
```

Apply the same change to the two **file** branches' `<div class="meta">…</div>` lines (`static/app.js:809` and `static/app.js:822`). All three now carry an empty `.ping-status` span after the timestamp.

- [ ] **Step 3: Add `renderPingStatus(el, ping)`**

Add after `renderPing` (near the other render helpers):

```javascript
// Renders the sender-side status indicator on one of MY messages:
//   sent (no delivered_at)      → ✓
//   delivered (delivered_at)    → ✓✓
//   read (read_at)              → ✓✓ with a read style
// No-op for messages I received (only the sender sees receipts).
function renderPingStatus(el, ping) {
  if (ping.sender_id !== currentUser.id) return;
  const slot = el.querySelector(".ping-status");
  if (!slot) return;
  if (ping.read_at) {
    slot.textContent = "✓✓";
    slot.classList.add("read");
    slot.title = "Läst";
  } else if (ping.delivered_at) {
    slot.textContent = "✓✓";
    slot.classList.remove("read");
    slot.title = "Levererad";
  } else {
    slot.textContent = "✓";
    slot.classList.remove("read");
    slot.title = "Skickad";
  }
}
```

- [ ] **Step 4: Call `renderPingStatus` when rendering a self message**

In `renderPing`, after the element is inserted into the board (after the `board.appendChild(el)` / `insertBefore` block from Task 5 Step 3), add:

```javascript
  if (isSelf) renderPingStatus(el, ping);
```

(`isSelf` is already computed at the top of `renderPing` as `ping.sender_id === currentUser.id`.)

- [ ] **Step 5: Add `.ping-status` styling**

Append to `static/style.css`:

```css
.ping-status {
  margin-left: 0.4em;
  font-size: 0.85em;
  opacity: 0.6;
  letter-spacing: -0.05em;
}
.ping-status.read {
  color: var(--accent, #4f9eed);
  opacity: 1;
}
```

> Confirm the accent variable name. Run `grep -n "\-\-accent\|--primary\|--link" static/style.css` and use the project's existing accent/link color so the read state matches the theme.

- [ ] **Step 6: Manual verification — live receipt transitions**

Two sessions, A and B, both online, B's chat with A **closed**. As A, open the A⇄B chat and send B a message.
Expected: immediately shows `✓` (sent). Within a moment B's client (online) stamps `delivered_at` → A's message flips to `✓✓` (delivered) live via the UPDATE subscription. Now as B, open the chat with A focused (marks read).
Expected: A's message flips to read-styled `✓✓` (accent color) live. Reload A.
Expected: the message renders with the correct final state from the DB (`renderPingStatus` is called at render time for self messages).

- [ ] **Step 7: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat(receipts): per-message sent/delivered/read indicator on self messages"
```

---

### Task 10: Docs — reframe philosophy (durable by default)

Reframe `FEATURE_IDEAS.md` and `README.md` to "durable by default, opt-in disappearing messages (coming)" while keeping Ping's fast/private/lightweight retro identity. Remove only contradictory framing.

**Files:**
- Modify: `FEATURE_IDEAS.md` — intro paragraph + the per-ping auto-dismiss idea line
- Modify: `README.md` — the "Per-side dismiss" feature line; optionally the intro

- [ ] **Step 1: Reframe the `FEATURE_IDEAS.md` intro**

Replace the opening paragraph (`FEATURE_IDEAS.md:3`):

```markdown
Ping should stay centered on fast, private, disposable sharing. The strongest ideas below preserve that "quick ping" feel instead of turning the app into a full social/chat product.
```

with:

```markdown
Ping is a fast, private, lightweight messaging app with a durable conversation
history. Messages persist by default as a scrollable log with read/unread and
delivery status; ephemerality is opt-in via disappearing messages (off / 24h /
7d, coming soon). The strongest ideas below keep that quick, focused, two-person
feel — Ping stays a lightweight direct-message tool, not a sprawling social
network.
```

- [ ] **Step 2: Remove the contradictory per-ping auto-dismiss idea**

In `FEATURE_IDEAS.md`, delete the "Per-ping countdown" line (currently `FEATURE_IDEAS.md:9`):

```markdown
- Per-ping countdown: add a tiny expiry bar or timer for text pings before auto-dismiss.
```

(Auto-dismiss is removed in Task 2; the controlled forgetting mechanism is per-conversation disappearing messages, tracked in Plan 2. If a "Download receipt" idea exists at `FEATURE_IDEAS.md:21` — "show whether a received file has been downloaded or opened" — leave it; it's distinct from message read receipts and still a valid future idea.)

- [ ] **Step 3: Reframe the `README.md` "Per-side dismiss" feature line**

In `README.md`, the Features list currently has (around `README.md:24-26`):

```markdown
- Per-side dismiss: each user hides their copy independently; the message and
  any attached file are deleted from storage once both sides dismiss it
```

Replace with:

```markdown
- Durable conversation history: messages persist as a scrollable log with date
  separators and paged scrollback (latest 50, "ladda äldre" for older)
- Read/unread + delivery receipts: per-message sent/delivered/read status, and
  a sidebar unread badge that survives reload
- Delete a message: ✕ removes your copy; the message and any attached file are
  deleted from storage once both sides delete it
```

- [ ] **Step 4: (Optional) tighten the README intro**

The README intro (`README.md:3-6`) describes Ping as a tool to "swap a URL or a file." That remains true and on-brand; leave it unless it reads as contradicting durability. If adjusting, keep it light — e.g. append "Conversations now persist as a durable history." to the first paragraph. Do not over-rewrite.

- [ ] **Step 5: Verify no contradictory framing remains**

Run: `grep -rn "disposable\|auto-dismiss\|not.*chat product\|both sides dismiss" FEATURE_IDEAS.md README.md`
Expected: no matches describing the *old* model as the intended philosophy. (A historical mention is acceptable only if clearly framed as superseded; prefer removal.)

- [ ] **Step 6: Commit**

```bash
git add FEATURE_IDEAS.md README.md
git commit -m "docs: reframe Ping as durable-by-default messaging (keep lightweight identity)"
```

---

### Task 11: Update README schema/setup references for the new RPCs

The README's setup section enumerates the RPCs created by `schema.sql`. Add `mark_read` and `mark_delivered`.

**Files:**
- Modify: `README.md` — the schema bullet in the Supabase setup section (around `README.md:54-57`)

- [ ] **Step 1: Add `mark_read` and `mark_delivered` to the RPC list**

Find (around `README.md:55-56`):

```markdown
   policies, the `ping-files` storage bucket, and the `dismiss_ping`,
   `create_invite`, and `redeem_invite` RPCs.
```

Replace with:

```markdown
   policies, the `ping-files` storage bucket, and the `dismiss_ping`,
   `mark_read`, `mark_delivered`, `create_invite`, and `redeem_invite` RPCs.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: mention mark_read/mark_delivered RPCs in setup instructions"
```

---

### Task 12: Regression check + branch wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Run the Python test suite (must be unaffected)**

Run: `python -m pytest tests/ -q`
Expected: all pass (these are backend/link-preview tests; this plan does not touch `server.py` or `link_preview.py`).

- [ ] **Step 2: Full manual smoke (two sessions)**

With A and B as accepted contacts, verify end-to-end in one pass:
1. Send messages across a day boundary → date separators correct (Idag/Igår/date).
2. >50 messages → latest 50 load, "ladda äldre" prepends correctly with anchored scroll and no duplicate separators.
3. Closed-chat receive → durable badge increments and **survives reload**.
4. Open chat focused → badge clears and stays cleared after reload.
5. Sender sees `✓` → `✓✓` → read-styled `✓✓` live.
6. ✕ deletes only the caller's copy (other side keeps it until they also delete); messages never auto-disappear.
Expected: all six behaviors as described.

- [ ] **Step 3: Final review against the spec**

Open `docs/superpowers/specs/2026-06-08-durable-messaging-design.md` and confirm every Plan 1 bullet (schema cols + `mark_read`; remove auto-dismiss; reframe ✕; DB-backed unread; paged scrollback + separators; sender-side receipts via UPDATE + `renderPingStatus`; docs reframe) is implemented. Note explicitly that Plan 2 items (disappearing_ttl, set_disappearing, purge_expired_pings, header timer control, lazy expiry filter) are **out of scope here**.

- [ ] **Step 4: Finishing the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide merge/PR. Typical: push `feat/durable-messaging` and open a PR to `main`. Apply `schema.sql` section 11 to the production Supabase project as part of the deploy (it's idempotent and additive — safe to run on the live DB).

---

## Self-Review notes (author)

- **Spec coverage:** schema cols + `mark_read` (T1); remove auto-dismiss (T2); reframe ✕ (T3); paged scrollback (T4) + date separators (T5); DB-backed durable unread (T6) + mark-read on open/focus (T7); delivered-on-insert + UPDATE receipt sub (T8) + `renderPingStatus` indicator (T9); docs reframe (T10–T11). All Plan 1 bullets mapped. Plan 2 explicitly excluded.
- **Cross-task type/name consistency:** `renderDaySeparatorIfNeeded(ping, prev, beforeNode?)`, `renderPingBefore(ping, beforeNode)`, `renderPing(ping, animate, beforeNode?)`, `renderPingStatus(el, ping)`, `markChatRead()`, `loadUnreadCounts()`, `mark_read(p_other)`, `data-ping-id` / `dataset.pingId`, `.ping-status`/`.ping-status.read`, `.day-separator[data-day-key]`, `lastRenderedPing`, `oldestLoadedAt`/`hasMoreOlder`/`loadingOlder` — names used identically across tasks.
- **Sequencing caveat (flagged in-task):** T4 references helpers defined in T5; T8's UPDATE handler and T9 are interdependent (`data-ping-id` + `renderPingStatus`). Implement in numeric order; the cross-references are called out at each site. An executor doing strict task isolation should treat T4+T5 as one render-layer unit and T8+T9 as one receipt unit.
