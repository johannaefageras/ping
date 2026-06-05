# User Settings Modal — Design

**Date:** 2026-06-05
**Branch:** `user-settings-modal`
**Status:** Approved, ready for implementation plan

## Summary

Add a single **"Inställningar"** (settings) modal to the Ping app, opened by a
gear button in the sidebar header. It becomes the one home for all
user-account and appearance settings:

- **Display name** (new — editable, optional)
- **Change password** (new — in-app, while logged in)
- **Mute sounds** (new — toggle)
- **Theme** (existing picker, relocated into the modal)
- **Font** (existing picker, relocated into the modal)
- **Logout** (existing button, relocated into the modal)

The headline feature is the editable **display name**: a contact is shown with
their display name as the primary label and their `@username` as a smaller
secondary line, keeping usernames discoverable (the add-contact flow is
username-based).

## Context

This app is static JS (`static/app.js`, `static/index.html`,
`static/style.css`) backed by Supabase (`supabase/schema.sql`). There is no
test harness; verification is manual.

Relevant existing state:

- `profiles.display_name text` already exists in the schema but is currently
  **dead** — nothing reads or writes it.
- The sidebar already has loose `#font-picker` and `#theme-picker` `<div>`s
  pinned at the bottom (`static/index.html` ~lines 168–184), wired by
  `initThemePicker` / `initFontPicker` in `app.js` (~lines 1028–1077). These
  persist via a `ping-*` localStorage convention (`ping-theme`, `ping-font`).
- The header has `#current-username` and a `#logout-btn` in `#user-info`
  (`static/index.html` ~lines 138–141).
- There is an existing modal pattern: the lightbox (`#lightbox`,
  `role="dialog" aria-modal="true"`, `static/index.html` ~line 233) with
  Escape/backdrop close handling in `app.js` (~line 1018).
- `escapeHtml()` is used consistently for all user-supplied strings rendered
  into the DOM (e.g. usernames at app.js ~lines 393, 425).

### Out of scope / already done

This spec covers **only** the settings modal feature. The following related
schema work is **already applied to the working tree** in a prior step and is
not re-specified here:

- `profiles.username` made case-insensitively unique via a `unique` index on
  `lower(username)`, plus a `CHECK (username ~ '^[a-z0-9_]{3,20}$')`.
- `handle_new_user` trigger extended to map `check_violation` /
  `not_null_violation` to a recognizable `invalid_username` error.
- Client signup handler maps `invalid_username` to a friendly Swedish message.

## Design

### 1. Schema — `supabase/schema.sql`

Add a CHECK constraint to the existing nullable `display_name` column:

```sql
display_name text check (display_name is null or char_length(display_name) between 1 and 40),
```

- `NULL` means "no display name set" → UI falls back to `@username`.
- The app stores `null` (not `''`) when the field is blank, keeping the
  `1..40` range and the NULL case clean.
- No trigger change required: `handle_new_user` never sets `display_name`, so
  new profiles start `null`, which is valid.

### 2. HTML — `static/index.html`

- Add a **gear button** in `#user-info`, next to `#current-username`, that
  opens the settings modal.
- Add a **settings modal** (`role="dialog" aria-modal="true"`, mirroring the
  existing lightbox dialog), titled "Inställningar", with sections:
  - **Visningsnamn** — text input + "Spara" button; `@username` shown beneath
    as the secondary label.
  - **Byt lösenord** — new-password input + confirm-password input +
    "Uppdatera" button.
  - **Ljud** — a "Tysta ljud" toggle (checkbox).
  - **Utseende** — the relocated `#font-picker` and `#theme-picker` blocks,
    with their IDs and inner markup unchanged.
  - **Logga ut** — the relocated `#logout-btn`.
- **Remove** the loose `#font-picker` / `#theme-picker` divs from the sidebar
  body and the old header logout button (they now live in the modal).

### 3. JavaScript — `static/app.js`

**Open/close.** Mirror the lightbox pattern: gear click opens; backdrop click,
the close button, and Escape all close. Extend the existing `Escape` keydown
handler (which already handles the lightbox) rather than adding a second one.

**Display name.**

- `enterApp` already does `select("*")`, so `profile.display_name` is
  available — store it on `currentUser` and prefill the input.
- Save handler: trim the value; if empty, send `null`; otherwise validate
  `1..40` client-side, then:
  ```js
  await sb.from("profiles").update({ display_name: value }).eq("id", currentUser.id);
  ```
  The existing `"Users can update own profile"` RLS policy already permits
  this. On success, update `currentUser.display_name`, refresh the header, and
  re-render contacts. A `check_violation` from the DB → show the same length
  message as the client check (server backstop, consistent with the username
  pattern).

**Change password.** Reuses `sb.auth`:

```js
await sb.auth.updateUser({ password: newPassword });
```

- Client-side: confirm both fields match and meet the **minimum length of 6**
  (matching the existing reset-password form's `minlength="6"`) before
  calling. Show success/error **inline in the modal** (not the auth-screen
  error box — the user is logged in).

**Mute sounds.** Follows the existing `ping-*` localStorage convention:

- `initMuteToggle()`: read `localStorage.getItem("ping-muted")`, set the
  checkbox state, persist on change.
- Guard `playPing()` (app.js ~lines 1023–1026): at the top,
  `if (localStorage.getItem("ping-muted") === "1") return;`.

**Theme / font.** `initThemePicker` / `initFontPicker` are unchanged
(ID-based; the elements just live in the modal now).

**Logout.** Handler unchanged; the button just moved into the modal.

### 4. Contact name rendering — `app.js`

This is the cross-cutting change implied by "display name + @username".

- `loadContacts` (~line 357) extends the embedded selects to also fetch
  `display_name`:
  ```
  requester:profiles!contacts_requester_id_fkey(username, display_name),
  addressee:profiles!contacts_addressee_id_fkey(username, display_name)
  ```
- `renderContacts` (~line 376) — for each **accepted contact, pending request,
  and outgoing request**, render **two lines**: `display_name` (when set) as
  the primary label, `@username` as a smaller secondary line. When
  `display_name` is `null`, show only `@username` (no empty primary line).
  Both values go through `escapeHtml()` — display names are free text and
  **must** be escaped.
- The **chat header** for a selected contact gets the same two-line treatment.

### 5. CSS — `static/style.css`

- Modal + backdrop styling, following the existing lightbox modal styling for
  visual consistency.
- Two-line contact row: primary/secondary name typography and sizing so that a
  40-char name plus presence dot plus unread badge does not break the sidebar
  layout.

## Error handling

- **Display name too long / invalid:** blocked client-side; DB CHECK is the
  backstop, surfaced as the same inline length message.
- **Password mismatch / too short (< 6):** blocked client-side before calling
  `sb.auth.updateUser`; inline error in the modal.
- **Network/Supabase errors** on save: inline error message in the relevant
  modal section; no optimistic UI that could desync from the server.
- **XSS:** all rendered display names and usernames pass through
  `escapeHtml()`.

## Testing / verification

No automated test harness exists; verification is manual against the running
app:

1. Set a display name → appears as primary label with `@username` secondary,
   for yourself and as seen by a contact.
2. Clear the display name (blank) → falls back to `@username` only.
3. Enter a 41-char name → blocked with the length message (and DB rejects if
   forced).
4. Change password → succeeds; log out and back in with the new password.
5. Toggle "Tysta ljud" → incoming ping plays no sound while muted; setting
   persists across reload.
6. Theme and font pickers still work from their new home in the modal.
7. A display name containing `<script>`/`&`/`<` renders escaped, not executed.
8. Modal opens via gear, closes via Escape / backdrop / close button; logout
   works from inside the modal.
