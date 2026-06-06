# Invite Links (LAN/AirDrop-ish Discovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-use, 10-minute invite links + QR codes that instantly connect two people as accepted contacts in both directions — the realistic, browser-safe version of "LAN/AirDrop-ish discovery."

**Architecture:** A new `public.invites` table plus two Postgres security-definer RPCs (`create_invite`, `redeem_invite`) hold all trust logic, mirroring the existing `dismiss_ping` pattern. The frontend (vanilla JS) shows an invite modal with a QR code (rendered by a self-hosted vendored MIT library) and a live countdown, and redeems an `#invite=<token>` URL fragment on load — holding the token across sign-in/sign-up for logged-out openers. No FastAPI routes and no CSP changes are needed.

**Tech Stack:** Supabase (Postgres + RLS + RPC), vanilla HTML/CSS/JS, `qrcode-generator` (MIT) vendored as a static asset, FastAPI (unchanged; only the service-worker precache list is touched).

**Reference spec:** `docs/superpowers/specs/2026-06-06-invite-links-design.md`

---

## Testing reality (read first)

The repo's pytest suite (`tests/`) tests `server.py` and `link_preview.py` only. There is **no SQL/Supabase test harness** and **no JS test runner**. This feature adds **no FastAPI routes**, so almost none of its logic is reachable by the existing Python tests. Consequences for this plan:

- **Pure helpers** that can be expressed in Python-testable form are not relevant here (the logic is JS + SQL). Instead, the **one** piece of pure, side-effect-free JS logic — parsing the invite token out of a hash and building the invite URL — is written as a **tiny, self-contained function** and verified with a **Node one-liner** documented in its task (`node -e`). Node is available in this repo (it has `package.json`).
- **SQL RPC behavior** is verified by **copy-paste SQL assertions** run in the Supabase SQL editor, given verbatim in Task 3. These are not automated; that is a known repo limitation, not a gap in this plan.
- **End-to-end behavior** is verified by a **manual checklist** (Task 9) using two browser profiles / two accounts.

Do not skip the SQL assertions or the manual checklist — they are the actual test coverage for this feature.

---

## File structure

- **Create** `static/assets/scripts/qrcode.js` — vendored MIT QR generator (`qrcode-generator@2.0.4`). One file, global `qrcode`, no deps.
- **Create** `static/assets/scripts/invite-url.js` — tiny pure helpers: `parseInviteToken(hash)` and `buildInviteUrl(origin, token)`. Loaded as a classic script (assigns to `window`); kept separate so it is trivially testable with `node -e`.
- **Modify** `supabase/schema.sql` — append idempotent "Section 10: invites" (table, indexes, RLS, `create_invite`, `redeem_invite`, grants, realtime not needed).
- **Modify** `static/index.html` — "Bjud in" button in `#add-contact`; invite modal markup; auth-screen invite banner; `<script>` tags for the two new JS files.
- **Modify** `static/app.js` — invite modal open/close + countdown, `create_invite` call + QR render + copy, `redeem_invite` on load, logged-out token stash + redeem-on-`SIGNED_IN`.
- **Modify** `static/style.css` — invite modal, QR frame, countdown, copy button, auth banner (terminal aesthetic).
- **Modify** `static/sw.js` — add the two new scripts to `SHELL`; bump `CACHE` `ping-shell-v6` → `ping-shell-v7`.
- **Modify** `README.md` — note invite links under Features and the schema section.

UUIDv4 tokens are unguessable, so the invite's primary key *is* the token. The fragment (`#invite=`) keeps the token out of server logs.

---

## Task 1: Vendor the QR library

**Files:**
- Create: `static/assets/scripts/qrcode.js`

- [ ] **Step 1: Download the exact library file**

Run:
```bash
curl -sL --retry 5 \
  "https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/qrcode.js" \
  -o static/assets/scripts/qrcode.js
```

- [ ] **Step 2: Verify it is the real file, not a stub or error page**

Run:
```bash
wc -c static/assets/scripts/qrcode.js
grep -c "Kazuhiko Arase" static/assets/scripts/qrcode.js
grep -c "createImgTag" static/assets/scripts/qrcode.js
```
Expected: byte count **> 50000** (≈56–65 KB); both `grep -c` outputs **≥ 1**. If the byte count is tiny (e.g. 64), the CDN returned a stub — re-run Step 1 (network was flaky during planning). Do not proceed until the file is the real one.

- [ ] **Step 3: Confirm the global API shape**

Run:
```bash
node -e "global.window=global; require('./static/assets/scripts/qrcode.js'); const q=qrcode(0,'M'); q.addData('https://example.com/app#invite=abc'); q.make(); const tag=q.createImgTag(5,2); console.log(tag.slice(0,40), /^<img\b/.test(tag) && tag.includes('data:'));"
```
Expected: prints something like `<img src="data:image/gif;base64,R0lGOD true`. This proves `qrcode(...).addData(...).make()` + `createImgTag(cellSize, margin)` work and produce an `<img>` with a `data:` source — exactly what `renderInviteQr` uses in Task 6. (The lib auto-attaches to `global`/`window`; the require is only for this check.)

- [ ] **Step 4: Commit**

```bash
git add static/assets/scripts/qrcode.js
git commit -m "Vendor qrcode-generator (MIT) for invite QR codes"
```

---

## Task 2: Pure invite-URL helpers (with Node test)

**Files:**
- Create: `static/assets/scripts/invite-url.js`

- [ ] **Step 1: Write the helper file**

`static/assets/scripts/invite-url.js`:
```javascript
// Pure, side-effect-free helpers for invite links. Loaded as a classic
// script in the browser (assigns to window) and require()-able under Node
// for the verification step below. No DOM, no Supabase — keep it that way so
// it stays trivially testable.
(function (root) {
  // Extract the invite token from a URL fragment like "#invite=<uuid>".
  // Returns the token string, or null if absent/empty. Tolerates extra
  // fragment params (e.g. "#a=1&invite=xyz") and a leading "#".
  function parseInviteToken(hash) {
    if (!hash) return null;
    const frag = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    for (const part of frag.split("&")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq) === "invite") {
        const val = decodeURIComponent(part.slice(eq + 1));
        return val.length ? val : null;
      }
    }
    return null;
  }

  // Build the shareable invite URL for a token. Always points at /app so the
  // redirect-friendly route handles it. Token goes in the fragment so it
  // never reaches server access logs.
  function buildInviteUrl(origin, token) {
    return origin.replace(/\/+$/, "") + "/app#invite=" + encodeURIComponent(token);
  }

  root.parseInviteToken = parseInviteToken;
  root.buildInviteUrl = buildInviteUrl;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseInviteToken, buildInviteUrl };
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 2: Run the Node test to verify behavior**

Run:
```bash
node -e '
const {parseInviteToken, buildInviteUrl} = require("./static/assets/scripts/invite-url.js");
const eq = (a,b,m) => { if (JSON.stringify(a)!==JSON.stringify(b)) { console.error("FAIL", m, "got", a, "want", b); process.exit(1);} };
eq(parseInviteToken("#invite=abc123"), "abc123", "basic");
eq(parseInviteToken("invite=abc123"), "abc123", "no-hash");
eq(parseInviteToken("#a=1&invite=xyz&b=2"), "xyz", "among-others");
eq(parseInviteToken("#type=recovery&x=1"), null, "no-invite");
eq(parseInviteToken("#invite="), null, "empty-value");
eq(parseInviteToken(""), null, "empty-hash");
eq(parseInviteToken(null), null, "null-hash");
eq(buildInviteUrl("https://ping.example.com", "tok"), "https://ping.example.com/app#invite=tok", "build");
eq(buildInviteUrl("https://ping.example.com/", "tok"), "https://ping.example.com/app#invite=tok", "build-trailing-slash");
console.log("ALL PASS");
'
```
Expected: prints `ALL PASS`. If any assertion fails the script exits non-zero with a `FAIL ...` line — fix the helper and re-run.

- [ ] **Step 3: Commit**

```bash
git add static/assets/scripts/invite-url.js
git commit -m "Add pure invite-url helpers with node verification"
```

---

## Task 3: Database — invites table + RPCs (idempotent migration)

**Files:**
- Modify: `supabase/schema.sql` (append a new section at the end)

- [ ] **Step 1: Append the migration section to `supabase/schema.sql`**

Add this verbatim at the end of the file:
```sql
-- ============================================================
-- 10. INVITES (single-use, expiring contact-invite links)
-- Idempotent: existing deployments can run just this section.
-- A random UUID primary key serves as the unguessable token; it rides in the
-- URL fragment client-side so it never hits server access logs. Redemption
-- auto-accepts a contact in BOTH directions. All trust logic is in the two
-- security-definer RPCs below (mirrors the section 9 dismiss_ping pattern).
-- ============================================================

create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.profiles(id) on delete cascade,
  used_by     uuid references public.profiles(id) on delete set null,
  used_at     timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists invites_creator_idx on public.invites (creator_id);

alter table public.invites enable row level security;

-- Creators can see and create their own invites. No update/delete policies and
-- no select for other users: redemption goes through redeem_invite (security
-- definer), so a redeemer never needs to read the row directly.
drop policy if exists "Users can view their own invites" on public.invites;
create policy "Users can view their own invites"
  on public.invites for select
  to authenticated
  using (creator_id = auth.uid());

drop policy if exists "Users can create their own invites" on public.invites;
create policy "Users can create their own invites"
  on public.invites for insert
  to authenticated
  with check (creator_id = auth.uid());

-- create_invite: invalidate the caller's other open invites (keeps one active
-- link per user and kills any stale QR still on screen), then mint a fresh
-- 10-minute single-use invite. Returns the token id + its expiry.
create or replace function public.create_invite()
returns table (id uuid, expires_at timestamptz)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_exp timestamptz;
begin
  update public.invites
    set expires_at = now()
    where creator_id = auth.uid()
      and used_at is null
      and expires_at > now();

  v_exp := now() + interval '10 minutes';
  insert into public.invites (creator_id, expires_at)
    values (auth.uid(), v_exp)
    returning invites.id into v_id;

  return query select v_id, v_exp;
end;
$$;

grant execute on function public.create_invite() to authenticated;

-- redeem_invite: validate the token and, on success, auto-accept a contact in
-- both directions. Returns a status the UI maps to a message, plus the
-- creator's username on success.
--   status values: 'ok' | 'not_found' | 'expired' | 'used' | 'self'
-- "already contacts" is treated as success (idempotent): the invite is marked
-- used and we return ok + username, so re-scanning or scanning a known
-- contact's link is a friendly no-op rather than an error.
create or replace function public.redeem_invite(p_token uuid)
returns table (status text, username text)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_creator uuid;
  v_used_at timestamptz;
  v_expires timestamptz;
  v_me uuid := auth.uid();
  v_existing uuid;
  v_username text;
begin
  select creator_id, used_at, expires_at
    into v_creator, v_used_at, v_expires
    from public.invites
    where id = p_token;

  if not found then
    return query select 'not_found'::text, null::text; return;
  end if;
  if v_used_at is not null then
    return query select 'used'::text, null::text; return;
  end if;
  if v_expires <= now() then
    return query select 'expired'::text, null::text; return;
  end if;
  if v_creator = v_me then
    return query select 'self'::text, null::text; return;
  end if;

  -- Mark used up front so a token can never be redeemed twice, even on retry.
  update public.invites
    set used_by = v_me, used_at = now()
    where id = p_token;

  select username into v_username from public.profiles where id = v_creator;

  -- Look for an existing contact row in either direction.
  select id into v_existing
    from public.contacts
    where (requester_id = v_creator and addressee_id = v_me)
       or (requester_id = v_me and addressee_id = v_creator)
    limit 1;

  if v_existing is not null then
    -- Promote a pending row to accepted; leave an already-accepted row alone.
    update public.contacts set status = 'accepted'
      where id = v_existing and status <> 'accepted';
  else
    insert into public.contacts (requester_id, addressee_id, status)
      values (v_creator, v_me, 'accepted');
  end if;

  return query select 'ok'::text, v_username;
end;
$$;

grant execute on function public.redeem_invite(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration in Supabase**

Open the Supabase project → SQL Editor → paste the section 10 block from Step 1 → Run.
Expected: "Success. No rows returned." No errors. (The block is idempotent — safe to run on a fresh schema or an existing deployment.)

- [ ] **Step 3: Verify the RPCs with SQL assertions**

In the SQL editor, run this verification script. It impersonates two real users by temporarily setting `request.jwt.claims`. **Replace `<USER_A_UUID>` and `<USER_B_UUID>` with two real `auth.users` ids from your project** (two test accounts).
```sql
-- Clean slate for the test pair.
delete from public.invites where creator_id in ('<USER_A_UUID>','<USER_B_UUID>');
delete from public.contacts
  where (requester_id = '<USER_A_UUID>' and addressee_id = '<USER_B_UUID>')
     or (requester_id = '<USER_B_UUID>' and addressee_id = '<USER_A_UUID>');

-- Act as USER A: create an invite.
select set_config('request.jwt.claims', '{"sub":"<USER_A_UUID>","role":"authenticated"}', true);
select set_config('role','authenticated', true);
select * from public.create_invite();  -- note the returned id as :TOKEN

-- Self-redeem must fail with 'self' (still acting as A).
select * from public.redeem_invite('<TOKEN>');  -- expect status = 'self'

-- Act as USER B: redeem -> 'ok' + A's username, and a contact appears accepted.
select set_config('request.jwt.claims', '{"sub":"<USER_B_UUID>","role":"authenticated"}', true);
select * from public.redeem_invite('<TOKEN>');  -- expect status = 'ok', username = A
select status from public.contacts
  where (requester_id='<USER_A_UUID>' and addressee_id='<USER_B_UUID>')
     or (requester_id='<USER_B_UUID>' and addressee_id='<USER_A_UUID>');  -- expect 'accepted'

-- Re-redeem the same token -> 'used'.
select * from public.redeem_invite('<TOKEN>');  -- expect status = 'used'

-- Nonexistent token -> 'not_found'.
select * from public.redeem_invite('00000000-0000-0000-0000-000000000000');  -- expect 'not_found'

-- Expired token: mint one then force-expire it, redeem -> 'expired'.
select set_config('request.jwt.claims', '{"sub":"<USER_A_UUID>","role":"authenticated"}', true);
select id from public.create_invite();  -- note as :TOKEN2
update public.invites set expires_at = now() - interval '1 minute' where id = '<TOKEN2>';
select set_config('request.jwt.claims', '{"sub":"<USER_B_UUID>","role":"authenticated"}', true);
select * from public.redeem_invite('<TOKEN2>');  -- expect status = 'expired'
```
Expected results inline above. Each `redeem_invite` call must return exactly the noted `status`. If any differ, fix the function in `supabase/schema.sql`, re-run `create or replace` for it, and re-test.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add invites table + create_invite/redeem_invite RPCs"
```

---

## Task 4: Invite modal + button markup

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Add the "Bjud in" button inside `#add-contact`**

In `static/index.html`, immediately after the `</form>` that closes `#add-contact-form` (currently line 299) and before `<div id="contact-search-result" ...>` (line 300), insert:
```html
          <button type="button" id="invite-open-btn" class="invite-open-btn">
            <svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H5.17L4 17.17z"/><path d="M12 9v4"/><path d="M12 7h.01"/></svg>
            Bjud in via l&auml;nk
          </button>
```

- [ ] **Step 2: Add the invite modal markup**

In `static/index.html`, immediately after the closing `</div>` of `#settings-modal` (find the settings modal block that starts at line 438; insert after it closes), add:
```html
    <!-- Invite modal: QR + link + countdown -->
    <div
      id="invite-modal"
      class="hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Bjud in"
    >
      <div id="invite-panel">
        <div id="invite-titlebar">
          <span class="tb-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <h2 id="invite-title">~/invite</h2>
          <button id="invite-close" aria-label="St&auml;ng">
            <svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div id="invite-body">
          <p class="invite-intro">Skanna eller dela l&auml;nken f&ouml;r att ansluta direkt.</p>
          <div id="invite-qr" aria-hidden="true"></div>
          <div id="invite-link-row">
            <input id="invite-link-input" type="text" readonly aria-label="Inbjudningsl&auml;nk" />
            <button id="invite-copy-btn" type="button">Kopiera</button>
          </div>
          <p id="invite-countdown" class="invite-countdown"></p>
          <button id="invite-regen-btn" type="button" class="hidden">Skapa ny l&auml;nk</button>
          <p id="invite-error" class="invite-error hidden"></p>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Add the auth-screen invite banner**

In `static/index.html`, inside `#auth-body` (opens at line 44), immediately before the `<p id="auth-boot" ...>` element (line 45), insert:
```html
          <div id="auth-invite-banner" class="auth-invite-banner hidden"></div>
```
This puts the banner at the top of the visible auth content, above the boot line and tabs.

- [ ] **Step 4: Load the two new scripts**

Find where `static/app.js` is loaded with a `<script>` tag in `static/index.html` (search for `app.js`). Immediately **before** that tag, add:
```html
    <script src="/assets/scripts/invite-url.js"></script>
    <script src="/assets/scripts/qrcode.js"></script>
```
These must load before `app.js` so `window.parseInviteToken`, `window.buildInviteUrl`, and `window.qrcode` exist when `app.js` runs.

- [ ] **Step 5: Verify markup loads without console errors**

Run the app locally:
```bash
uvicorn server:app --reload
```
Open `http://127.0.0.1:8000/app`, open DevTools console. Expected: no 404s for `/assets/scripts/invite-url.js` or `/assets/scripts/qrcode.js`, no JS errors. The "Bjud in via länk" button is visible in the sidebar (once logged in). Clicking it does nothing yet — that's wired in Task 6. Stop the server (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "Add invite modal, button, banner markup and load QR scripts"
```

---

## Task 5: Invite modal styling

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1: Add styles matching the terminal aesthetic**

Append to `static/style.css`. Reuse the existing modal backdrop/panel look (mirror `#settings-modal` / `#settings-panel`). Add:
```css
/* --- Invite modal --- */
#invite-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 1rem;
}
#invite-modal.hidden { display: none; }

#invite-panel {
  background: var(--bg, #0c0c0c);
  border: 1px solid var(--accent, #3fb950);
  border-radius: 6px;
  width: min(420px, 100%);
  max-height: 90vh;
  overflow: auto;
  font-family: inherit;
}
#invite-titlebar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border, #222);
}
#invite-title { font-size: 0.85rem; margin: 0; flex: 1; opacity: 0.85; }
#invite-close {
  background: none; border: none; color: inherit; cursor: pointer; padding: 0.2rem;
}
#invite-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.invite-intro { margin: 0; font-size: 0.85rem; opacity: 0.85; }

#invite-qr {
  align-self: center;
  background: #fff;            /* QR needs light background to scan reliably */
  padding: 10px;
  border-radius: 4px;
  line-height: 0;
}
#invite-qr img { display: block; width: 200px; height: 200px; image-rendering: pixelated; }

#invite-link-row { display: flex; gap: 0.4rem; }
#invite-link-input {
  flex: 1; min-width: 0;
  background: var(--input-bg, #111);
  border: 1px solid var(--border, #333);
  color: inherit;
  padding: 0.4rem 0.5rem;
  font-family: inherit; font-size: 0.8rem;
  border-radius: 4px;
}
#invite-copy-btn, #invite-regen-btn {
  background: var(--accent, #3fb950);
  color: #000; border: none; cursor: pointer;
  padding: 0.4rem 0.7rem; border-radius: 4px;
  font-family: inherit; font-size: 0.8rem; white-space: nowrap;
}
#invite-copy-btn.copied { background: var(--muted, #6e7681); }

.invite-countdown { margin: 0; font-size: 0.8rem; opacity: 0.75; text-align: center; }
.invite-countdown.expired { color: var(--danger, #f85149); opacity: 1; }
.invite-error { margin: 0; font-size: 0.8rem; color: var(--danger, #f85149); }

.invite-open-btn {
  margin-top: 0.5rem;
  width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
  background: none;
  border: 1px dashed var(--border, #333);
  color: inherit; cursor: pointer;
  padding: 0.45rem 0.5rem; border-radius: 4px;
  font-family: inherit; font-size: 0.8rem;
}
.invite-open-btn:hover { border-color: var(--accent, #3fb950); }

/* Auth-screen banner shown when arriving via an invite link while logged out */
.auth-invite-banner {
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--accent, #3fb950);
  border-radius: 4px;
  font-size: 0.85rem;
}
.auth-invite-banner.hidden { display: none; }
```
Note: the `var(--…)` fallbacks let this work even if a variable name differs; if the project defines theme variables under different names, align these to the existing ones found elsewhere in `style.css`.

- [ ] **Step 2: Verify visually**

Run `uvicorn server:app --reload`, open `/app`, log in, click "Bjud in via länk". The modal still won't populate (Task 6), but temporarily remove the `hidden` class on `#invite-modal` in DevTools to confirm the panel renders centered with the terminal look, the white QR frame area shows, and the link row + buttons are styled. Re-add `hidden`. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add static/style.css
git commit -m "Style invite modal, button, and auth banner"
```

---

## Task 6: Generate invites — modal open/close, QR, countdown, copy

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Add element references**

Near the other `document.getElementById(...)` constants at the top of `static/app.js` (around lines 27–48), add:
```javascript
const inviteOpenBtn = document.getElementById("invite-open-btn");
const inviteModal = document.getElementById("invite-modal");
const inviteClose = document.getElementById("invite-close");
const inviteQr = document.getElementById("invite-qr");
const inviteLinkInput = document.getElementById("invite-link-input");
const inviteCopyBtn = document.getElementById("invite-copy-btn");
const inviteCountdown = document.getElementById("invite-countdown");
const inviteRegenBtn = document.getElementById("invite-regen-btn");
const inviteError = document.getElementById("invite-error");
```

- [ ] **Step 2: Add the invite-generation module**

Add this block near the settings-modal handlers (after `closeSettings`/`showSettingsMsg`, around line 1269):
```javascript
// ============================================================
// INVITE LINKS
// ============================================================
let _inviteCountdownTimer = null;
let _inviteLastFocus = null;

function renderInviteQr(url) {
  inviteQr.innerHTML = "";
  try {
    const qr = window.qrcode(0, "M"); // type 0 = auto-size, M = ~15% ECC
    qr.addData(url);
    qr.make();
    // createImgTag(cellSize, margin) returns an <img> with a data: src.
    // CSP allows img-src 'self' data:, so this renders without a CSP change.
    inviteQr.innerHTML = qr.createImgTag(5, 2);
  } catch (err) {
    console.error("QR render failed:", err);
    // The copyable link below is the source of truth; a missing QR is non-fatal.
  }
}

function startInviteCountdown(expiresAt) {
  clearInterval(_inviteCountdownTimer);
  const tick = () => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      clearInterval(_inviteCountdownTimer);
      inviteCountdown.textContent = "Länken har gått ut.";
      inviteCountdown.classList.add("expired");
      inviteRegenBtn.classList.remove("hidden");
      inviteCopyBtn.disabled = true;
      return;
    }
    const total = Math.ceil(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    inviteCountdown.textContent = `Giltig i ${m}:${s}`;
  };
  tick();
  _inviteCountdownTimer = setInterval(tick, 1000);
}

async function generateInvite() {
  inviteError.classList.add("hidden");
  inviteRegenBtn.classList.add("hidden");
  inviteCountdown.classList.remove("expired");
  inviteCopyBtn.disabled = false;
  inviteCopyBtn.classList.remove("copied");
  inviteCopyBtn.textContent = "Kopiera";
  inviteQr.innerHTML = "";
  inviteLinkInput.value = "";
  inviteCountdown.textContent = "Skapar länk…";

  const { data, error } = await sb.rpc("create_invite");
  // create_invite returns a one-row table; supabase-js gives an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || !row.id) {
    console.error("create_invite failed:", error);
    inviteCountdown.textContent = "";
    inviteError.textContent = "Kunde inte skapa länk. Försök igen.";
    inviteError.classList.remove("hidden");
    inviteRegenBtn.classList.remove("hidden");
    return;
  }

  const url = window.buildInviteUrl(window.location.origin, row.id);
  inviteLinkInput.value = url;
  renderInviteQr(url);
  startInviteCountdown(row.expires_at);
}

function openInvite() {
  _inviteLastFocus = document.activeElement;
  inviteModal.classList.remove("hidden");
  inviteClose.focus();
  generateInvite();
}

function closeInvite() {
  clearInterval(_inviteCountdownTimer);
  inviteModal.classList.add("hidden");
  inviteQr.innerHTML = "";
  inviteLinkInput.value = "";
  inviteCountdown.textContent = "";
  if (_inviteLastFocus) _inviteLastFocus.focus();
}

inviteOpenBtn.addEventListener("click", openInvite);
inviteClose.addEventListener("click", closeInvite);
inviteRegenBtn.addEventListener("click", generateInvite);
inviteModal.addEventListener("click", (e) => {
  if (e.target === inviteModal) closeInvite();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !inviteModal.classList.contains("hidden")) {
    closeInvite();
  }
});

inviteCopyBtn.addEventListener("click", async () => {
  const url = inviteLinkInput.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch (err) {
    // Fallback for browsers without async clipboard / insecure contexts.
    inviteLinkInput.select();
    document.execCommand("copy");
  }
  inviteCopyBtn.textContent = "Kopierad!";
  inviteCopyBtn.classList.add("copied");
  setTimeout(() => {
    inviteCopyBtn.textContent = "Kopiera";
    inviteCopyBtn.classList.remove("copied");
  }, 1500);
});
```

- [ ] **Step 3: Verify generation end-to-end (manual)**

Run `uvicorn server:app --reload`, open `/app`, log in. Click "Bjud in via länk".
Expected: modal opens; within a moment a QR image appears on a white frame; the link input shows `http://127.0.0.1:8000/app#invite=<uuid>`; the countdown ticks down from `09:59`; "Kopiera" copies the URL and flips to "Kopierad!". Esc and backdrop click and the X all close it. Open it again → a *new* token is generated (different uuid). Stop the server.

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "Generate invite links: modal, QR, countdown, copy"
```

---

## Task 7: Redeem invites on load + logged-out hold-and-redeem

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Add the redemption helpers**

Add to the INVITE LINKS section of `static/app.js` (after the generation code from Task 6):
```javascript
const INVITE_STASH_KEY = "ping.pendingInvite";

const INVITE_MESSAGES = {
  ok: (u) => "Ansluten till @" + u + "!",
  used: () => "Länken är redan använd.",
  expired: () => "Länken har gått ut.",
  self: () => "Du kan inte bjuda in dig själv.",
  not_found: () => "Ogiltig länk.",
};

// Show the redemption result. Reuses the existing contact-search-result line in
// the sidebar (visible once inside the app).
function showInviteResult(status, username) {
  const msgFn = INVITE_MESSAGES[status] || INVITE_MESSAGES.not_found;
  contactSearchResult.textContent = msgFn(username);
  contactSearchResult.classList.remove("hidden");
}

// Redeem a token against Supabase and refresh contacts on success.
async function redeemInviteToken(token) {
  const { data, error } = await sb.rpc("redeem_invite", { p_token: token });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    console.error("redeem_invite failed:", error);
    showInviteResult("not_found");
    return;
  }
  showInviteResult(row.status, row.username);
  if (row.status === "ok") {
    await loadContacts();
  }
}

// Strip the invite fragment so a refresh doesn't re-attempt redemption.
function clearInviteHash() {
  if (window.parseInviteToken(window.location.hash)) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
```

- [ ] **Step 2: Handle the token in `init()` and on auth changes**

In `static/app.js`, modify the `init()` flow (around lines 86–112). After the Supabase client is created (`sb = ...`, line 79) and the recovery check, add invite detection. Replace the existing branch that ends with `showAuthScreen();` so it accounts for an invite token. Concretely:

Find:
```javascript
    const isPasswordRecovery = window.location.hash.includes("type=recovery");

    const {
      data: { session },
    } = await sb.auth.getSession();
    if (isPasswordRecovery) {
      showResetPasswordScreen();
    } else if (session) {
      await enterApp(session.user);
    } else {
      showAuthScreen();
    }
```
Replace with:
```javascript
    const isPasswordRecovery = window.location.hash.includes("type=recovery");
    const inviteToken = window.parseInviteToken(window.location.hash);

    const {
      data: { session },
    } = await sb.auth.getSession();
    if (isPasswordRecovery) {
      showResetPasswordScreen();
    } else if (session) {
      await enterApp(session.user);
      if (inviteToken) {
        await redeemInviteToken(inviteToken);
        clearInviteHash();
      }
    } else {
      if (inviteToken) {
        // Hold the token across sign-in/sign-up; redeem on SIGNED_IN below.
        sessionStorage.setItem(INVITE_STASH_KEY, inviteToken);
        showAuthInviteBanner();
      }
      showAuthScreen();
    }
```

- [ ] **Step 3: Redeem a stashed token after sign-in**

In the `sb.auth.onAuthStateChange(...)` handler (around lines 99–112), add handling for `SIGNED_IN` with a stashed invite. Find the handler body and add, as the first check inside it:
```javascript
      if (event === "SIGNED_IN") {
        const stashed = sessionStorage.getItem(INVITE_STASH_KEY);
        if (stashed) {
          sessionStorage.removeItem(INVITE_STASH_KEY);
          hideAuthInviteBanner();
          // enterApp runs via the normal login path; redeem once we're in.
          // Defer slightly so contacts UI exists before refresh.
          setTimeout(async () => {
            await redeemInviteToken(stashed);
            clearInviteHash();
          }, 0);
        }
      }
```
Place this so it does not interfere with the existing `PASSWORD_RECOVERY` / `!session` branches (add it above them; it only acts when a stash exists).

- [ ] **Step 4: Add the auth-banner helpers**

Add near `showAuthScreen` (around line 136) in `static/app.js`:
```javascript
const authInviteBanner = document.getElementById("auth-invite-banner");

function showAuthInviteBanner() {
  if (!authInviteBanner) return;
  authInviteBanner.textContent =
    "Någon vill ansluta — logga in eller skapa ett konto för att acceptera.";
  authInviteBanner.classList.remove("hidden");
}

function hideAuthInviteBanner() {
  if (authInviteBanner) authInviteBanner.classList.add("hidden");
}
```

- [ ] **Step 5: Verify redemption (manual, two accounts)**

Run `uvicorn server:app --reload`. In browser profile 1, log in as account A, open the invite modal, copy the link. In a separate browser profile 2 (or incognito):
- **Logged-in B:** log in as B first, then paste the invite URL → app loads, sidebar shows "Ansluten till @A!", and A appears in B's contacts. Refresh → no duplicate redemption, no error (token already used → silently fine because hash was cleared).
- **Logged-out B:** log out of B, paste a *fresh* invite URL → auth screen shows the banner "Någon vill ansluta…". Log in (or sign up a new account) → after entering the app, "Ansluten till @A!" shows and A is a contact.
- **Self:** as A, paste A's own fresh link → "Du kan inte bjuda in dig själv."
Stop the server.

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "Redeem invite links on load with logged-out hold-and-redeem"
```

---

## Task 8: Service worker precache update

**Files:**
- Modify: `static/sw.js`

- [ ] **Step 1: Add the new scripts to `SHELL` and bump the cache version**

In `static/sw.js`, change line 1:
```javascript
const CACHE = "ping-shell-v6";
```
to:
```javascript
const CACHE = "ping-shell-v7";
```
And in the `SHELL` array (lines 3–15), add these two entries (e.g. after `"/app.js",`):
```javascript
  "/assets/scripts/invite-url.js",
  "/assets/scripts/qrcode.js",
```

- [ ] **Step 2: Verify the SW installs the new version**

Run `uvicorn server:app --reload`, open `/app` in a fresh tab, DevTools → Application → Service Workers. Expected: a new SW activates with cache `ping-shell-v7`; under Cache Storage, `ping-shell-v7` contains `/assets/scripts/invite-url.js` and `/assets/scripts/qrcode.js`; old `ping-shell-v6` is gone (evicted on activate). Stop the server.

- [ ] **Step 3: Commit**

```bash
git add static/sw.js
git commit -m "Precache invite scripts; bump SW cache to v7"
```

---

## Task 9: Docs + full manual acceptance pass

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature in `README.md`**

In the `## Features` list, add a bullet:
```markdown
- Invite links + QR codes: generate a single-use link (valid 10 min) that
  instantly connects you with whoever scans or opens it — no username needed
```
In the schema setup section (where it lists what `schema.sql` creates), add `invites` to the tables/RPCs created, e.g. update the sentence to mention the `invites` table and the `create_invite` / `redeem_invite` RPCs.

- [ ] **Step 2: Run the full manual acceptance checklist**

Run `uvicorn server:app --reload` and walk every row (two browser profiles, accounts A and B):

| # | Scenario | Expected |
|---|----------|----------|
| 1 | A opens invite modal | QR + link + countdown from 09:59; new uuid each open |
| 2 | A clicks Kopiera | URL copied; button shows "Kopierad!" |
| 3 | Let countdown hit 0 | "Länken har gått ut." + "Skapa ny länk" appears; copy disabled |
| 4 | A clicks "Skapa ny länk" | fresh token, countdown restarts |
| 5 | B (logged in) opens A's link | "Ansluten till @A!"; A in B's contacts (accepted) |
| 6 | B refreshes after #5 | no error, no duplicate contact, hash gone from URL |
| 7 | B (logged out) opens fresh link | auth banner shown; after login → "Ansluten till @A!" |
| 8 | Brand-new signup via link | account created, then auto-connected to A |
| 9 | A opens A's own link | "Du kan inte bjuda in dig själv." |
| 10 | Reuse an already-used link | "Länken är redan använd." |
| 11 | Edit URL to a random uuid | "Ogiltig länk." |
| 12 | Esc / backdrop / X on modal | modal closes, countdown timer stops |

All rows must pass. If any fails, fix in the relevant task's files before continuing. Stop the server.

- [ ] **Step 3: Run existing tests to confirm no regressions**

Run:
```bash
.venv/bin/pytest -q
```
Expected: all existing tests pass (this feature adds no Python code, so the suite is unchanged and green).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document invite links feature"
```

---

## Self-review notes (for the implementer)

- **Theme variables:** Task 5 uses `var(--name, fallback)` defensively. Before finalizing styling, grep `static/style.css` for the real theme variable names (background, accent, border, danger) and align the invite styles to them so the modal matches the active theme exactly.
- **`onAuthStateChange` ordering:** the existing handler returns early in some branches. Make sure the new `SIGNED_IN` stash check runs regardless of those early returns (add it at the top of the callback).
- **Token never logged:** keep the token in the URL **fragment** only. Never put it in a query string or send it to `server.py`.
