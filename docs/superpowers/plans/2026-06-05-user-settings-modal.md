# User Settings Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single settings modal (display name, change password, mute sounds, relocated theme/font pickers, relocated logout) and render contacts as `display_name` over `@username`.

**Architecture:** A gear button in the sidebar header opens a `role="dialog"` modal that mirrors the existing lightbox pattern (Escape/backdrop/close-button to dismiss). Display name persists to `profiles.display_name` via the existing self-update RLS policy; password uses `sb.auth.updateUser`; mute uses the existing `ping-*` localStorage convention. Theme/font pickers are physically moved into the modal but keep their IDs so existing JS is untouched.

**Tech Stack:** Vanilla JS (`static/app.js`), HTML (`static/index.html`), CSS (`static/style.css`), Supabase (`supabase/schema.sql`). **No automated test harness exists** — each task ends with a manual verification step (exact actions + expected observation).

> **Note on prerequisites:** The `username` case-insensitive/format fixes are already committed (`4aaf4fd`). This plan builds only the settings-modal feature. Work happens on branch `user-settings-modal`.

---

## File Structure

- **`supabase/schema.sql`** — add CHECK constraint to existing `display_name` column.
- **`static/index.html`** — gear button in `#user-info`; new settings modal markup; relocate `#font-picker`, `#theme-picker`, `#logout-btn` into the modal; remove their old sidebar/header locations.
- **`static/app.js`** — modal open/close; display-name save; password change; mute toggle + `playPing` guard; fetch `display_name` in `loadContacts`; two-line rendering in `renderContacts`; pass `display_name` through `selectContact` for the chat header.
- **`static/style.css`** — modal/backdrop styling; two-line contact-row typography.

---

## Task 1: Schema — display_name CHECK constraint

**Files:**
- Modify: `supabase/schema.sql` (profiles table, ~line 9-12)

- [ ] **Step 1: Add the CHECK constraint to the display_name column**

In `supabase/schema.sql`, find the profiles table definition. The `display_name` line currently reads:

```sql
  display_name text,
```

Replace it with:

```sql
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
```

- [ ] **Step 2: Verify the SQL is well-formed**

Run: `grep -n "display_name" supabase/schema.sql`
Expected: one line showing the `check (display_name is null or char_length(display_name) between 1 and 40)` constraint.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add display_name length CHECK constraint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> The schema file is run manually in the Supabase SQL Editor by the user; no automated migration step here. The constraint takes effect on next schema run.

---

## Task 2: HTML — gear button + settings modal, relocate existing controls

**Files:**
- Modify: `static/index.html` (`#user-info` ~line 138-141; sidebar pickers ~line 168-184; new modal near lightbox ~line 232-236)

- [ ] **Step 1: Add the gear button to the header**

Find (`static/index.html` ~line 138-141):

```html
        <div id="user-info">
          <span id="current-username"></span>
          <button id="logout-btn"><i class="pi-arrow-right-from-bracket"></i> Logga ut</button>
        </div>
```

Replace with (logout button removed from here — it moves into the modal in Step 3):

```html
        <div id="user-info">
          <span id="current-username"></span>
          <button id="settings-btn" aria-label="Inställningar" title="Inställningar"><i class="pi-cog"></i></button>
        </div>
```

- [ ] **Step 2: Remove the loose pickers from the sidebar body**

Find and DELETE this entire block (`static/index.html` ~line 168-184):

```html
        <div id="font-picker" role="radiogroup" aria-label="Typsnitt">
          <button class="font-btn" data-font="argon" style="font-family:'Monaspace Argon',ui-monospace,monospace" title="Argon">Aa</button>
          <button class="font-btn" data-font="krypton" style="font-family:'Monaspace Krypton',ui-monospace,monospace" title="Krypton">Aa</button>
          <button class="font-btn" data-font="neon" style="font-family:'Monaspace Neon',ui-monospace,monospace" title="Neon">Aa</button>
          <button class="font-btn" data-font="radon" style="font-family:'Monaspace Radon',ui-monospace,monospace" title="Radon">Aa</button>
          <button class="font-btn" data-font="xenon" style="font-family:'Monaspace Xenon',ui-monospace,monospace" title="Xenon">Aa</button>
        </div>

        <div id="theme-picker" role="radiogroup" aria-label="Färgtema">
          <button class="swatch" data-theme="green" style="--swatch:#33ff99" aria-label="Grön" title="Grön"></button>
          <button class="swatch" data-theme="amber" style="--swatch:#ffb000" aria-label="Amber" title="Amber"></button>
          <button class="swatch" data-theme="cyan" style="--swatch:#33ccff" aria-label="Cyan" title="Cyan"></button>
          <button class="swatch" data-theme="pink" style="--swatch:#ff66cc" aria-label="Rosa" title="Rosa"></button>
          <button class="swatch" data-theme="red" style="--swatch:#ff4444" aria-label="Röd" title="Röd"></button>
          <button class="swatch" data-theme="paper" style="--swatch:#e8e8e8" aria-label="Paper" title="Paper"></button>
          <button class="swatch" data-theme="purple" style="--swatch:#cc99ff" aria-label="Lila" title="Lila"></button>
        </div>
```

> Note: HTML entities like `&auml;` in the original are shown here as their characters for clarity; preserve whatever encoding the surrounding file uses when re-inserting in Step 3.

- [ ] **Step 3: Add the settings modal after the lightbox**

Find (`static/index.html` ~line 232-236):

```html
    <!-- Image preview lightbox (reused for all image pings) -->
    <div id="lightbox" class="hidden" role="dialog" aria-modal="true" aria-label="Bildvisning">
      <button id="lightbox-close" aria-label="Stäng"><i class="pi-close"></i></button>
      <img id="lightbox-img" alt="" />
    </div>
```

Immediately AFTER that closing `</div>`, add:

```html
    <!-- Settings modal -->
    <div id="settings-modal" class="hidden" role="dialog" aria-modal="true" aria-label="Inställningar">
      <div id="settings-panel">
        <div id="settings-header">
          <h2>Inställningar</h2>
          <button id="settings-close" aria-label="Stäng"><i class="pi-close"></i></button>
        </div>

        <section class="settings-section">
          <label for="display-name-input">Visningsnamn</label>
          <input type="text" id="display-name-input" maxlength="40" placeholder="Ditt namn" autocomplete="off" />
          <span id="settings-username" class="settings-subtle"></span>
          <button id="display-name-save">Spara</button>
          <span id="display-name-msg" class="settings-msg hidden"></span>
        </section>

        <section class="settings-section">
          <label>Byt lösenord</label>
          <input type="password" id="new-password" minlength="6" placeholder="Nytt lösenord" autocomplete="new-password" />
          <input type="password" id="new-password-confirm" minlength="6" placeholder="Bekräfta lösenord" autocomplete="new-password" />
          <button id="password-save">Uppdatera</button>
          <span id="password-msg" class="settings-msg hidden"></span>
        </section>

        <section class="settings-section">
          <label class="settings-toggle">
            <input type="checkbox" id="mute-toggle" />
            <span>Tysta ljud</span>
          </label>
        </section>

        <section class="settings-section">
          <label>Utseende</label>
          <div id="font-picker" role="radiogroup" aria-label="Typsnitt">
            <button class="font-btn" data-font="argon" style="font-family:'Monaspace Argon',ui-monospace,monospace" title="Argon">Aa</button>
            <button class="font-btn" data-font="krypton" style="font-family:'Monaspace Krypton',ui-monospace,monospace" title="Krypton">Aa</button>
            <button class="font-btn" data-font="neon" style="font-family:'Monaspace Neon',ui-monospace,monospace" title="Neon">Aa</button>
            <button class="font-btn" data-font="radon" style="font-family:'Monaspace Radon',ui-monospace,monospace" title="Radon">Aa</button>
            <button class="font-btn" data-font="xenon" style="font-family:'Monaspace Xenon',ui-monospace,monospace" title="Xenon">Aa</button>
          </div>
          <div id="theme-picker" role="radiogroup" aria-label="Färgtema">
            <button class="swatch" data-theme="green" style="--swatch:#33ff99" aria-label="Grön" title="Grön"></button>
            <button class="swatch" data-theme="amber" style="--swatch:#ffb000" aria-label="Amber" title="Amber"></button>
            <button class="swatch" data-theme="cyan" style="--swatch:#33ccff" aria-label="Cyan" title="Cyan"></button>
            <button class="swatch" data-theme="pink" style="--swatch:#ff66cc" aria-label="Rosa" title="Rosa"></button>
            <button class="swatch" data-theme="red" style="--swatch:#ff4444" aria-label="Röd" title="Röd"></button>
            <button class="swatch" data-theme="paper" style="--swatch:#e8e8e8" aria-label="Paper" title="Paper"></button>
            <button class="swatch" data-theme="purple" style="--swatch:#cc99ff" aria-label="Lila" title="Lila"></button>
          </div>
        </section>

        <section class="settings-section">
          <button id="logout-btn"><i class="pi-arrow-right-from-bracket"></i> Logga ut</button>
        </section>
      </div>
    </div>
```

> `#font-picker`, `#theme-picker`, and `#logout-btn` keep their original IDs, so `initThemePicker`, `initFontPicker`, and the logout handler in `app.js` continue to work without changes.

- [ ] **Step 4: Verify IDs are present and unique**

Run: `grep -c "id=\"font-picker\"\|id=\"theme-picker\"\|id=\"logout-btn\"" static/index.html`
Expected: `3` (each appears exactly once — they were moved, not duplicated).

Run: `grep -n "id=\"settings-modal\"\|id=\"settings-btn\"" static/index.html`
Expected: one line each.

- [ ] **Step 5: Manual verification (page loads, no JS errors yet expected for unwired button)**

Start the app (`python server.py` or the project's run command), open it, log in. Expected: the gear button shows in the header; theme/font pickers no longer appear loose in the sidebar. (Clicking the gear does nothing yet — wired in Task 3.) No console errors from missing elements.

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat: add settings modal markup, relocate pickers and logout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: JS — modal open/close wiring

**Files:**
- Modify: `static/app.js` (DOM refs ~line 42-45; Escape handler ~line 1017-1021)

- [ ] **Step 1: Add DOM references for the modal**

In `static/app.js`, after the lightbox refs (~line 45, after `const lightboxClose = ...`), add:

```js
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
```

- [ ] **Step 2: Add open/close functions and listeners near the lightbox handlers**

In `static/app.js`, find the lightbox keydown handler (~line 1017-1021):

```js
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.classList.contains("hidden")) {
    closeLightbox();
  }
});
```

Immediately AFTER it, add:

```js
// --- Settings modal ---
let _settingsLastFocus = null;

function openSettings() {
  _settingsLastFocus = document.activeElement;
  settingsModal.classList.remove("hidden");
  settingsClose.focus();
}

function closeSettings() {
  settingsModal.classList.add("hidden");
  if (_settingsLastFocus) _settingsLastFocus.focus();
}

settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsModal.classList.contains("hidden")) {
    closeSettings();
  }
});
```

- [ ] **Step 3: Manual verification**

Reload the app, log in. Click the gear → modal opens, close button focused. Press Escape → closes. Open again, click the dark backdrop outside the panel → closes. Open again, click the × → closes. No console errors.

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: wire settings modal open/close

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: JS — display name load, prefill, and save

**Files:**
- Modify: `static/app.js` (DOM refs ~line 45; `enterApp` ~line 303-312; new save handler)

- [ ] **Step 1: Add DOM references for the display-name controls**

In `static/app.js`, after the settings refs added in Task 3, add:

```js
const displayNameInput = document.getElementById("display-name-input");
const displayNameSave = document.getElementById("display-name-save");
const displayNameMsg = document.getElementById("display-name-msg");
const settingsUsername = document.getElementById("settings-username");
```

- [ ] **Step 2: Store display_name on currentUser and prefill the modal in enterApp**

Find in `enterApp` (~line 303-307):

```js
  currentUser = { id: user.id, username: profile.username };

  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  currentUsernameEl.textContent = "@" + currentUser.username;
```

Replace with:

```js
  currentUser = {
    id: user.id,
    username: profile.username,
    display_name: profile.display_name || null,
  };

  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  currentUsernameEl.textContent = "@" + currentUser.username;
  displayNameInput.value = currentUser.display_name || "";
  settingsUsername.textContent = "@" + currentUser.username;
```

- [ ] **Step 3: Add the save handler after the modal open/close block (from Task 3)**

In `static/app.js`, after the settings open/close listeners, add:

```js
function showSettingsMsg(el, text, ok) {
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("ok", !!ok);
  el.classList.toggle("err", !ok);
}

displayNameSave.addEventListener("click", async () => {
  const raw = displayNameInput.value.trim();
  if (raw.length > 40) {
    showSettingsMsg(displayNameMsg, "Visningsnamn: max 40 tecken.", false);
    return;
  }
  const value = raw === "" ? null : raw;

  const { error } = await sb
    .from("profiles")
    .update({ display_name: value })
    .eq("id", currentUser.id);

  if (error) {
    // DB CHECK is the backstop for the same length rule enforced above.
    showSettingsMsg(displayNameMsg, "Kunde inte spara visningsnamn.", false);
    return;
  }

  currentUser.display_name = value;
  displayNameInput.value = value || "";
  showSettingsMsg(displayNameMsg, "Sparat!", true);
  renderContacts();
});
```

- [ ] **Step 4: Manual verification**

Reload, log in, open settings. The `@username` shows beneath the input. Type a name, click Spara → "Sparat!" appears. Reload the page, reopen settings → the name is prefilled (persisted to DB). Clear the field, Spara → saves as empty (null). Type 41+ chars → input is capped at 40 by `maxlength`; if forced longer, the length message shows.

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat: load and save display name in settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: JS — change password

**Files:**
- Modify: `static/app.js` (DOM refs; new handler after Task 4 block)

- [ ] **Step 1: Add DOM references for password controls**

In `static/app.js`, after the display-name refs, add:

```js
const newPasswordInput = document.getElementById("new-password");
const newPasswordConfirm = document.getElementById("new-password-confirm");
const passwordSave = document.getElementById("password-save");
const passwordMsg = document.getElementById("password-msg");
```

- [ ] **Step 2: Add the password-change handler after the display-name handler**

In `static/app.js`, after the `displayNameSave` listener, add:

```js
passwordSave.addEventListener("click", async () => {
  const pw = newPasswordInput.value;
  const confirm = newPasswordConfirm.value;

  if (pw.length < 6) {
    showSettingsMsg(passwordMsg, "Lösenord: minst 6 tecken.", false);
    return;
  }
  if (pw !== confirm) {
    showSettingsMsg(passwordMsg, "Lösenorden matchar inte.", false);
    return;
  }

  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) {
    showSettingsMsg(passwordMsg, "Kunde inte uppdatera lösenord: " + error.message, false);
    return;
  }

  newPasswordInput.value = "";
  newPasswordConfirm.value = "";
  showSettingsMsg(passwordMsg, "Lösenord uppdaterat!", true);
});
```

- [ ] **Step 3: Manual verification**

Open settings. Enter mismatched passwords → "Lösenorden matchar inte." Enter a 5-char password → "Lösenord: minst 6 tecken." Enter a valid matching new password → "Lösenord uppdaterat!" Log out, log back in with the new password → succeeds.

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: add in-app password change to settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: JS — mute toggle and playPing guard

**Files:**
- Modify: `static/app.js` (DOM refs; `playPing` ~line 1023-1026; new `initMuteToggle`)

- [ ] **Step 1: Add DOM reference for the mute toggle**

In `static/app.js`, after the password refs, add:

```js
const muteToggle = document.getElementById("mute-toggle");
```

- [ ] **Step 2: Guard playPing with the mute setting**

Find (`static/app.js` ~line 1023-1026):

```js
function playPing() {
  pingSound.currentTime = 0;
  pingSound.play().catch(() => {});
}
```

Replace with:

```js
function playPing() {
  if (localStorage.getItem("ping-muted") === "1") return;
  pingSound.currentTime = 0;
  pingSound.play().catch(() => {});
}
```

- [ ] **Step 3: Add initMuteToggle and call it, alongside the other init calls**

Find `initThemePicker();` (~line 1053) in `static/app.js`. After the font-picker init call (`initFontPicker();`, near the end of that section), add:

```js
// --- Mute toggle ---
function initMuteToggle() {
  if (!muteToggle) return;
  muteToggle.checked = localStorage.getItem("ping-muted") === "1";
  muteToggle.addEventListener("change", () => {
    localStorage.setItem("ping-muted", muteToggle.checked ? "1" : "0");
  });
}

initMuteToggle();
```

> If `initFontPicker();` is not yet called at that location, place `initMuteToggle();` immediately after `initThemePicker();` instead — the point is that it runs once at startup like the other pickers.

- [ ] **Step 4: Manual verification**

Open settings, check "Tysta ljud". Have the other account send you a ping → no sound plays. Reload the page, reopen settings → checkbox is still checked (persisted). Uncheck it, receive a ping → sound plays again.

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat: add mute-sounds toggle honored by playPing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: JS — fetch display_name and render two-line contacts

**Files:**
- Modify: `static/app.js` (`loadContacts` ~line 357-365; `renderContacts` ~line 388-439; `selectContact` call ~line 433 and signature ~line 518/532)

- [ ] **Step 1: Fetch display_name in loadContacts**

Find (`static/app.js` ~line 357-363):

```js
    .from("contacts")
    .select(
      `id, status, requester_id, addressee_id, created_at,
       requester:profiles!contacts_requester_id_fkey(username),
       addressee:profiles!contacts_addressee_id_fkey(username)`
    )
```

Replace with:

```js
    .from("contacts")
    .select(
      `id, status, requester_id, addressee_id, created_at,
       requester:profiles!contacts_requester_id_fkey(username, display_name),
       addressee:profiles!contacts_addressee_id_fkey(username, display_name)`
    )
```

- [ ] **Step 2: Add a name-rendering helper near renderContacts**

In `static/app.js`, immediately BEFORE `function renderContacts() {` (~line 376), add:

```js
// Renders a contact label: display name as primary line (when set) with
// @username as a smaller secondary line; @username only when no display name.
// Both values are escaped (display names are free text).
function contactNameHtml(username, displayName) {
  const u = escapeHtml(username);
  if (displayName) {
    return (
      `<span class="name-primary">${escapeHtml(displayName)}</span>` +
      `<span class="name-secondary">@${u}</span>`
    );
  }
  return `<span class="name-primary">@${u}</span>`;
}
```

- [ ] **Step 3: Use the helper for pending (incoming) requests**

Find (`static/app.js`, in `renderContacts`, the pending block ~line 388-397):

```js
  pending.forEach((c) => {
    const username = c.requester.username;
    const el = document.createElement("div");
    el.className = "pending-item";
    el.innerHTML = `
      <span>@${escapeHtml(username)}</span>
      <button class="accept-btn" data-id="${c.id}" aria-label="Acceptera" title="Acceptera"><i class="pi-check"></i></button>
      <button class="reject-btn" data-id="${c.id}" aria-label="Neka" title="Neka"><i class="pi-close"></i></button>
    `;
    pendingList.appendChild(el);
  });
```

Replace with:

```js
  pending.forEach((c) => {
    const el = document.createElement("div");
    el.className = "pending-item";
    el.innerHTML = `
      <span class="contact-name">${contactNameHtml(c.requester.username, c.requester.display_name)}</span>
      <button class="accept-btn" data-id="${c.id}" aria-label="Acceptera" title="Acceptera"><i class="pi-check"></i></button>
      <button class="reject-btn" data-id="${c.id}" aria-label="Neka" title="Neka"><i class="pi-close"></i></button>
    `;
    pendingList.appendChild(el);
  });
```

- [ ] **Step 4: Use the helper for accepted contacts**

Find (`static/app.js`, accepted block ~line 409-430):

```js
  accepted.forEach((c) => {
    const isRequester = c.requester_id === currentUser.id;
    const recipientId = isRequester ? c.addressee_id : c.requester_id;
    const username = isRequester ? c.addressee.username : c.requester.username;
    const el = document.createElement("div");
    el.className =
      "contact-item" +
      (selectedContact && selectedContact.recipientId === recipientId ? " active" : "");
    el.dataset.recipientId = recipientId;
    el.dataset.contactId = c.id;
    el.dataset.username = username;
    const unread = unreadCounts[recipientId] || 0;
    const online = onlineUserIds.has(recipientId);
    el.innerHTML =
      `<span class="contact-left">` +
        `<span class="presence-dot${online ? " online" : ""}" title="${online ? "Online" : "Offline"}"></span>` +
        `<span class="contact-name">@${escapeHtml(username)}</span>` +
      `</span>` +
      (unread > 0 ? `<span class="unread-badge">${unread}</span>` : "");
    el.addEventListener("click", () => selectContact(c.id, recipientId, username));
    contactsList.appendChild(el);
  });
```

Replace with:

```js
  accepted.forEach((c) => {
    const isRequester = c.requester_id === currentUser.id;
    const recipientId = isRequester ? c.addressee_id : c.requester_id;
    const other = isRequester ? c.addressee : c.requester;
    const username = other.username;
    const displayName = other.display_name;
    const el = document.createElement("div");
    el.className =
      "contact-item" +
      (selectedContact && selectedContact.recipientId === recipientId ? " active" : "");
    el.dataset.recipientId = recipientId;
    el.dataset.contactId = c.id;
    el.dataset.username = username;
    const unread = unreadCounts[recipientId] || 0;
    const online = onlineUserIds.has(recipientId);
    el.innerHTML =
      `<span class="contact-left">` +
        `<span class="presence-dot${online ? " online" : ""}" title="${online ? "Online" : "Offline"}"></span>` +
        `<span class="contact-name">${contactNameHtml(username, displayName)}</span>` +
      `</span>` +
      (unread > 0 ? `<span class="unread-badge">${unread}</span>` : "");
    el.addEventListener("click", () => selectContact(c.id, recipientId, username, displayName));
    contactsList.appendChild(el);
  });
```

- [ ] **Step 5: Use the helper for outgoing pending requests**

Find (`static/app.js`, outgoing block ~line 433-438):

```js
  outgoing.forEach((c) => {
    const username = c.addressee.username;
    const el = document.createElement("div");
    el.className = "contact-item outgoing";
    el.innerHTML = `@${escapeHtml(username)} <i class="pi-hourglass" title="Väntar på svar"></i>`;
    contactsList.appendChild(el);
  });
```

Replace with:

```js
  outgoing.forEach((c) => {
    const el = document.createElement("div");
    el.className = "contact-item outgoing";
    el.innerHTML =
      `<span class="contact-name">${contactNameHtml(c.addressee.username, c.addressee.display_name)}</span>` +
      ` <i class="pi-hourglass" title="Väntar på svar"></i>`;
    contactsList.appendChild(el);
  });
```

- [ ] **Step 6: Update selectContact to accept and render display_name in the chat header**

Find (`static/app.js` ~line 518):

```js
async function selectContact(contactId, recipientId, username) {
  selectedContact = { contactId, recipientId, username };
```

Replace with:

```js
async function selectContact(contactId, recipientId, username, displayName) {
  selectedContact = { contactId, recipientId, username, displayName: displayName || null };
```

Then find (`static/app.js` ~line 532):

```js
  chatContactName.textContent = "@" + username;
```

Replace with:

```js
  chatContactName.innerHTML = contactNameHtml(username, selectedContact.displayName);
```

> Note: this switches the chat header from `textContent` to `innerHTML`; safe because `contactNameHtml` escapes both values.

- [ ] **Step 7: Manual verification**

Reload, log in. A contact with no display name set → shows just `@username` (single line). Have that contact set a display name (via their settings) and reload → contact row shows the display name on top, `@username` beneath, in the contact list, in a pending/outgoing request, and in the chat header when selected. Confirm a display name containing `<b>x</b>` renders as literal text, not bold (escaped).

- [ ] **Step 8: Commit**

```bash
git add static/app.js
git commit -m "feat: render contacts as display name over @username

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: CSS — modal and two-line contact styling

**Files:**
- Modify: `static/style.css` (append new rules; reference existing lightbox rules for consistency)

- [ ] **Step 1: Inspect existing lightbox + contact styles to match conventions**

Run: `grep -n "#lightbox\|\.contact-item\|\.contact-name\|\.contact-left\|--swatch\|#user-info\|#font-picker\|#theme-picker" static/style.css`
Expected: a list of existing rules. Read them to reuse color variables, spacing, and the lightbox backdrop approach (`position: fixed`, dark overlay, centered panel).

- [ ] **Step 2: Append settings-modal and two-line name styles**

Add to the end of `static/style.css` (adjust variable names to match those found in Step 1 — the codebase uses CSS custom properties for theme colors):

```css
/* --- Settings modal --- */
#settings-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
#settings-modal.hidden { display: none; }

#settings-panel {
  background: var(--bg, #0a0a0a);
  border: 1px solid var(--accent, #33ff99);
  border-radius: 8px;
  padding: 1.25rem;
  width: min(92vw, 420px);
  max-height: 85vh;
  overflow-y: auto;
}

#settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
#settings-header h2 { margin: 0; font-size: 1.1rem; }

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.settings-section > label { font-weight: bold; }

.settings-subtle { opacity: 0.6; font-size: 0.85rem; }

.settings-toggle {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.settings-msg { font-size: 0.85rem; }
.settings-msg.ok { color: var(--accent, #33ff99); }
.settings-msg.err { color: #ff4444; }
.settings-msg.hidden { display: none; }

#settings-btn {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 1rem;
}

/* --- Two-line contact name --- */
.contact-name { display: inline-flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.name-primary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.name-secondary { font-size: 0.75rem; opacity: 0.55; }
```

- [ ] **Step 3: Manual verification**

Reload, log in. Open settings → panel is centered over a dark backdrop, sections visually separated, theme swatches and font buttons render inside it, logout button present. Set a long (40-char) display name on a contact → the contact row stays within the sidebar (primary line truncates with ellipsis, secondary `@username` beneath), and presence dot + unread badge still align. Switch themes from inside the modal → colors update live.

- [ ] **Step 4: Commit**

```bash
git add static/style.css
git commit -m "feat: style settings modal and two-line contact names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (whole feature)

- [ ] Run the app, log in with two accounts (two browsers/profiles).
- [ ] Account A sets a display name → appears as primary label with `@username` secondary, for A itself and as seen by B (contact list, pending/outgoing, chat header).
- [ ] A clears the display name → B sees `@username` only.
- [ ] 41-char input is capped at 40; DB rejects an over-length value if forced.
- [ ] A changes password → logs out and back in with the new password.
- [ ] A toggles "Tysta ljud" → an incoming ping from B plays no sound; setting persists across reload; unmuting restores sound.
- [ ] Theme and font pickers work from inside the modal; selections persist.
- [ ] A display name containing `<script>`/`&`/`<` renders escaped, not executed.
- [ ] Modal opens via gear, closes via Escape / backdrop / × ; logout works from inside the modal.
- [ ] Final: run the project's run command and confirm no console errors during the above.
