# Keyboard Shortcuts & Cmd+K Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Cmd/Ctrl+K` contact-switcher palette, a unified `Esc`-closes-topmost-overlay handler, global shortcuts (`/`, `Cmd/Ctrl+,`, `?`, `Alt+↑/↓`), and a `?` keyboard cheatsheet to the Ping web app.

**Architecture:** One new plain-script module `static/keyboard.js` exposes `window.PingKeyboard.initKeyboard(ctx)`, mirroring the existing `window.PingCommands` pattern. `app.js` calls it once after boot, passing a capability object (accessors for contacts, selection, settings, app-active state) so the keyboard layer never touches globals/DOM directly. An ordered overlay registry centralizes `Esc` handling and replaces three duplicated per-overlay `Esc` listeners. New palette + cheatsheet markup lives in `index.html`, styles in `style.css`, and the service worker precaches the new file.

**Tech Stack:** Vanilla ES (no build step, no modules — plain `<script>` tags), CSS custom properties for theming, Supabase (unchanged), FastAPI static serving (unchanged). No test framework for JS — verification is manual against the running app.

---

## Context for the implementer (read first)

You are working in a small static frontend served by FastAPI. There is **no JS
build step and no JS test runner**. Scripts are plain `<script src>` tags loaded
in order; modules communicate by attaching a single object to `window` (see
`static/commands.js` → `window.PingCommands`, consumed by `static/app.js`). You
will follow that exact pattern for the new keyboard module.

Key facts you'll rely on (already verified in the codebase):

- `static/app.js` holds app state including `let contacts = []` (raw contact
  rows), `let selectedContact = null` (`{ contactId, recipientId, username, displayName }`),
  `let unreadCounts = {}` (recipientId → number), and `let onlineUserIds = new Set()`.
- Accepted contacts are derived as `contacts.filter((c) => c.status === "accepted")`.
  For each, the "other" party is `c.addressee` if `c.requester_id === currentUser.id`,
  else `c.requester`; the other id is `c.addressee_id` / `c.requester_id` respectively.
  See `renderContacts()` in `static/app.js` (~line 549) for the canonical derivation.
- `selectContact(contactId, recipientId, username, displayName)` opens a chat
  (`static/app.js` ~line 688).
- `openSettings()` opens the settings modal (`static/app.js` ~line 1287).
- The app view element is `appEl` (`#app`); it has the `hidden` class while on
  the auth/reset screens. So "app is active" ⇔ `!appEl.classList.contains("hidden")`.
- The composer textarea is `textInput` (`#text-input`).
- `escapeHtml(text)` exists in `static/app.js` (~line 1245) for safe HTML.
- Existing per-overlay `Esc` handlers to REMOVE live at roughly:
  `static/app.js` lines 1278-1282 (lightbox), 1309-1313 (settings),
  1465-1469 (invite). Their `closeLightbox` / `closeSettings` / `closeInvite`
  functions stay; only the three `document.addEventListener("keydown", …Escape…)`
  blocks go away.
- The composer's command-hint keydown handler is at `static/app.js` ~lines
  1702-1721 and already handles `Escape` to dismiss the hint menu.
- Service worker: `static/sw.js` line 1 is `const CACHE = "ping-shell-v8";` and
  the `SHELL` precache array is lines 3-18.
- Scripts are loaded in `static/index.html` ~lines 681-684 in this order:
  `invite-url.js`, `qrcode.js`, `commands.js`, `app.js`.

**Verification is manual.** Each task ends with explicit browser steps. Run the
app with:

```bash
source .venv/bin/activate && uvicorn server:app --reload
```

Then open <http://localhost:8000/app>, log in, and follow the task's checks. A
hard reload (Cmd/Ctrl+Shift+R) is required after editing `sw.js` or to pick up
asset changes, because the service worker is network-first but may serve a
cached shell.

---

## File Structure

- **Create** `static/keyboard.js` — the entire keyboard layer: platform
  detection, overlay registry + unified `Esc`, the Cmd+K palette
  (open/close/filter/render/keys), the cheatsheet open/close, and the global
  shortcut handler. Exposes `window.PingKeyboard = { initKeyboard }`.
- **Modify** `static/index.html` — add palette markup, add cheatsheet markup,
  add `<script src="keyboard.js"></script>` before `app.js`.
- **Modify** `static/app.js` — call `PingKeyboard.initKeyboard({...})` near the
  end of `enterApp`/init wiring; add an `escapeHtml` reference + an accepted-
  contacts accessor to the capability object; remove the three redundant
  `Esc` listeners; add `stopPropagation()` to the command-hint `Esc` branch so
  it doesn't leak to the global handler.
- **Modify** `static/style.css` — palette styles + cheatsheet styles.
- **Modify** `static/sw.js` — add `/keyboard.js` to `SHELL`; bump `CACHE` to v9.
- **Modify** `README.md` — document the keyboard shortcuts.

Implementation order is chosen so the app keeps working after every commit:
registry/Esc consolidation first (pure refactor, no behavior change), then the
module skeleton + wiring, then palette, then the remaining shortcuts, then the
cheatsheet, then SW + docs.

---

### Task 1: Consolidate `Esc` handling into an overlay registry (no behavior change)

This is a pure refactor: identical behavior today, but `Esc` now flows through
one handler so later tasks can register the palette and cheatsheet.

**Files:**
- Create: `static/keyboard.js`
- Modify: `static/index.html` (add script tag)
- Modify: `static/app.js` (remove 3 Esc listeners; wire registry)

- [ ] **Step 1: Create `static/keyboard.js` with the registry + Esc handler**

```js
// ============================================================
// PING — keyboard layer: overlay registry, Esc, palette, shortcuts
// ============================================================
// Loaded as a plain script BEFORE app.js. app.js calls
// window.PingKeyboard.initKeyboard(ctx) with a capability object so this layer
// never touches app globals/DOM directly. Mirrors the window.PingCommands
// pattern in commands.js.

(function () {
  // --- Overlay registry ---------------------------------------------------
  // Ordered topmost-first. Each entry: { isOpen(), close() }. Esc closes the
  // first open overlay and stops. New overlays (palette, cheatsheet) register
  // themselves during initKeyboard.
  const overlays = [];

  function registerOverlay(entry) {
    overlays.push(entry); // pushed in topmost-first order by caller
  }

  function closeTopmostOverlay() {
    for (const o of overlays) {
      if (o.isOpen()) {
        o.close();
        return true;
      }
    }
    return false;
  }

  // --- Public init --------------------------------------------------------
  let ctx = null;

  function initKeyboard(context) {
    ctx = context;

    // Register the existing overlays the app already manages, topmost-first.
    // (Palette + cheatsheet are unshifted onto the front in later tasks.)
    registerOverlay({ isOpen: ctx.isLightboxOpen, close: ctx.closeLightbox });
    registerOverlay({ isOpen: ctx.isInviteOpen, close: ctx.closeInvite });
    registerOverlay({ isOpen: ctx.isSettingsOpen, close: ctx.closeSettings });

    document.addEventListener("keydown", onGlobalKeydown);
  }

  function onGlobalKeydown(e) {
    if (e.key === "Escape") {
      if (closeTopmostOverlay()) {
        e.preventDefault();
      }
      return;
    }
  }

  window.PingKeyboard = { initKeyboard };
})();
```

- [ ] **Step 2: Add the script tag in `static/index.html`**

Find the script block (~lines 681-684) and add `keyboard.js` immediately before
`app.js`:

```html
    <script src="commands.js"></script>
    <script src="keyboard.js"></script>
    <script src="app.js"></script>
```

- [ ] **Step 3: Wire `initKeyboard` from `app.js`**

In `static/app.js`, locate the `// --- Start ---` block at the very bottom
(`init();` ~line 1789). Replace it with a call that wires the keyboard layer
**before** starting, plus the existing `init()` call. The accessor functions
below reference functions/state that already exist in `app.js`
(`lightbox`, `closeLightbox`, `inviteModal`, `closeInvite`, `settingsModal`,
`closeSettings`):

```js
// --- Start ---
window.PingKeyboard.initKeyboard({
  isLightboxOpen: () => !lightbox.classList.contains("hidden"),
  closeLightbox,
  isInviteOpen: () => !inviteModal.classList.contains("hidden"),
  closeInvite,
  isSettingsOpen: () => !settingsModal.classList.contains("hidden"),
  closeSettings,
});

init();
```

Note: `closeLightbox`, `closeInvite`, `closeSettings` are function declarations
in `app.js`, so they are hoisted and safe to reference here. `lightbox`,
`inviteModal`, `settingsModal` are `const`s declared at the top of `app.js`.

- [ ] **Step 4: Remove the three redundant `Esc` listeners in `app.js`**

Delete each of these three blocks (the surrounding `close*`/`open*` functions
and click handlers stay):

Lightbox (~lines 1278-1282):
```js
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.classList.contains("hidden")) {
    closeLightbox();
  }
});
```

Settings (~lines 1309-1313):
```js
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsModal.classList.contains("hidden")) {
    closeSettings();
  }
});
```

Invite (~lines 1465-1469):
```js
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !inviteModal.classList.contains("hidden")) {
    closeInvite();
  }
});
```

- [ ] **Step 5: Add `stopPropagation()` to the command-hint `Esc` branch**

In the composer keydown handler (`static/app.js` ~lines 1717-1720), the
`Escape` branch currently is:

```js
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideCommandHints();
  }
```

Change it to also stop the event so the new global handler doesn't see it while
the hint menu is open:

```js
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    hideCommandHints();
  }
```

(This whole handler already early-returns when the hint menu is hidden, so
`Esc` with no hint menu open still propagates to the global handler — which is
what we want for closing overlays.)

- [ ] **Step 6: Manual verification**

Run the app (`uvicorn server:app --reload`), open <http://localhost:8000/app>,
log in, then hard-reload (Cmd/Ctrl+Shift+R). Verify **unchanged** Esc behavior:

1. Open Settings (gear icon) → press `Esc` → it closes.
2. Open Invite modal → press `Esc` → it closes.
3. Open an image lightbox (click an image ping, or skip if none) → `Esc` closes.
4. Click in the composer, type `/` to show the hint menu, press `Esc` → only the
   hint menu closes (no error). Press `Esc` again with composer focused and no
   menu → nothing breaks.
5. Open DevTools console → no errors on load.

- [ ] **Step 7: Commit**

```bash
git add static/keyboard.js static/index.html static/app.js
git commit -m "refactor: centralize Esc handling in keyboard overlay registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Extend the capability object with contacts + selection accessors

The palette (Task 3) and `Alt+↑/↓` (Task 5) need read access to accepted
contacts and the current selection, plus `selectContact`, `openSettings`,
`escapeHtml`, `focusInput`, and `isAppActive`. Add these to the `initKeyboard`
call now so later tasks just consume them.

**Files:**
- Modify: `static/app.js` (extend the `initKeyboard({...})` call + add a helper)

- [ ] **Step 1: Add an accepted-contacts accessor helper in `app.js`**

Add this function just above the `// --- Start ---` block at the bottom of
`static/app.js`. It returns a normalized, palette-ready list (the same
derivation `renderContacts` uses), newest-registry-order preserved:

```js
// Normalized accepted contacts for the keyboard palette / shortcuts. Mirrors
// the derivation in renderContacts() but returns a flat, render-agnostic shape.
function getAcceptedContactsForKeyboard() {
  if (!currentUser) return [];
  return contacts
    .filter((c) => c.status === "accepted")
    .map((c) => {
      const isRequester = c.requester_id === currentUser.id;
      const recipientId = isRequester ? c.addressee_id : c.requester_id;
      const other = isRequester ? c.addressee : c.requester;
      return {
        contactId: c.id,
        recipientId,
        username: other.username,
        displayName: other.display_name || null,
        online: onlineUserIds.has(recipientId),
        unread: unreadCounts[recipientId] || 0,
      };
    });
}
```

- [ ] **Step 2: Extend the `initKeyboard({...})` call**

Replace the `initKeyboard({...})` object from Task 1 Step 3 with the full
capability object:

```js
window.PingKeyboard.initKeyboard({
  // overlays
  isLightboxOpen: () => !lightbox.classList.contains("hidden"),
  closeLightbox,
  isInviteOpen: () => !inviteModal.classList.contains("hidden"),
  closeInvite,
  isSettingsOpen: () => !settingsModal.classList.contains("hidden"),
  closeSettings,
  // app state / actions
  isAppActive: () => !appEl.classList.contains("hidden"),
  getContacts: getAcceptedContactsForKeyboard,
  getSelectedRecipientId: () => (selectedContact ? selectedContact.recipientId : null),
  selectContact,
  openSettings,
  focusComposer: () => textInput.focus(),
  escapeHtml,
});
```

All referenced names exist in `app.js`: `appEl`, `selectedContact`,
`selectContact` (function), `openSettings` (function), `textInput`,
`escapeHtml` (function). Function declarations are hoisted; `getAcceptedContactsForKeyboard`
is declared in Step 1 above this call.

- [ ] **Step 3: Manual verification**

Reload the app. In the DevTools console, run:

```js
PingKeyboard  // should be an object with initKeyboard
```

Confirm no console errors on load and that Esc still closes overlays (Task 1
behavior intact — the new accessors are not used yet, so this only proves
nothing broke).

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: expose contacts and actions to the keyboard layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Cmd+K contact palette

**Files:**
- Modify: `static/index.html` (palette markup)
- Modify: `static/keyboard.js` (palette logic + register overlay + open chord)
- Modify: `static/style.css` (palette styles)

- [ ] **Step 1: Add palette markup to `static/index.html`**

Add this block just before the closing of the app overlays — put it right after
the lightbox markup and before the settings modal (i.e. just before the
`<!-- Settings modal -->` comment, ~line 443). It must live inside the same
container as the other overlays:

```html
    <!-- Cmd/Ctrl+K contact switcher -->
    <div
      id="kbd-palette"
      class="hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Hoppa till kontakt"
    >
      <div id="kbd-palette-panel">
        <div id="kbd-palette-input-row">
          <span class="kbd-prompt" aria-hidden="true">&gt;</span>
          <input
            id="kbd-palette-input"
            type="text"
            placeholder="Hoppa till kontakt&hellip;"
            autocomplete="off"
            spellcheck="false"
            aria-controls="kbd-palette-list"
          />
          <span class="kbd-esc-tag" aria-hidden="true">esc</span>
        </div>
        <div id="kbd-palette-list" role="listbox" aria-label="Kontakter"></div>
        <div id="kbd-palette-foot" aria-hidden="true">
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigera</span>
          <span><kbd>&crarr;</kbd> &ouml;ppna</span>
          <span><kbd>esc</kbd> st&auml;ng</span>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Add palette styles to `static/style.css`**

Append to the end of `static/style.css`. Styling mirrors `#command-hints` and
the modal backdrops already in the file:

```css
/* --- Cmd/Ctrl+K contact palette --- */
#kbd-palette {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 60;
}
#kbd-palette.hidden { display: none; }
#kbd-palette-panel {
  width: 440px;
  max-width: 90vw;
  background: var(--bg, #0a0a0a);
  border: 1px solid var(--accent);
  border-radius: 6px;
  box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 20%, transparent);
  overflow: hidden;
}
#kbd-palette-input-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 0.9rem;
  border-bottom: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
}
.kbd-prompt { opacity: 0.7; }
#kbd-palette-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--fg);
  font-family: inherit;
  font-size: 0.95rem;
}
.kbd-esc-tag {
  font-size: 0.7rem;
  opacity: 0.5;
  border: 1px solid color-mix(in srgb, var(--fg) 25%, transparent);
  border-radius: 3px;
  padding: 1px 5px;
}
#kbd-palette-list {
  max-height: 40vh;
  overflow-y: auto;
}
.kbd-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.9rem;
  font-size: 0.9rem;
  cursor: pointer;
}
.kbd-row.active,
.kbd-row:hover {
  background: var(--accent);
  color: var(--bg, #0a0a0a);
}
.kbd-row .presence-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--fg) 30%, transparent);
  flex: 0 0 auto;
}
.kbd-row .presence-dot.online {
  background: var(--accent);
  box-shadow: 0 0 5px var(--accent);
}
.kbd-row.active .presence-dot.online { background: var(--bg, #0a0a0a); box-shadow: none; }
.kbd-row .kbd-name { font-weight: bold; }
.kbd-row .kbd-handle { opacity: 0.55; font-size: 0.8rem; }
.kbd-row.active .kbd-handle { opacity: 0.85; }
.kbd-row .kbd-unread {
  margin-left: auto;
  font-size: 0.72rem;
  border: 1px solid currentColor;
  border-radius: 8px;
  padding: 0 6px;
}
.kbd-empty {
  padding: 0.7rem 0.9rem;
  opacity: 0.5;
  font-size: 0.85rem;
}
#kbd-palette-foot {
  display: flex;
  gap: 1.2rem;
  padding: 0.5rem 0.9rem;
  border-top: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
  font-size: 0.72rem;
  opacity: 0.55;
}
#kbd-palette-foot kbd {
  border: 1px solid color-mix(in srgb, var(--fg) 25%, transparent);
  border-radius: 3px;
  padding: 0 5px;
  font-family: inherit;
}
```

Note on `color-mix`: it is already used elsewhere in `style.css`? If unsure,
this is safe — `color-mix` is supported in all current evergreen browsers the
app targets. If you prefer to avoid it, replace each `color-mix(... var(--fg) X%
...)` with a plain `rgba(255,255,255,0.X)` equivalent; the visual difference is
negligible. Pick one approach and keep it consistent.

- [ ] **Step 3: Implement palette logic in `static/keyboard.js`**

Add palette state + functions inside the IIFE in `keyboard.js`, above the
`function initKeyboard` definition. Then register the overlay and the open
chord inside `initKeyboard`.

Add these module-level vars and functions (place after the registry section,
before `let ctx = null;`):

```js
  // --- Cmd/Ctrl+K palette -------------------------------------------------
  let paletteEl, paletteInput, paletteList;
  let paletteRows = [];   // current filtered contacts
  let paletteIndex = -1;  // highlighted row, -1 = none
  let paletteLastFocus = null;

  function isPaletteOpen() {
    return paletteEl && !paletteEl.classList.contains("hidden");
  }

  function openPalette() {
    if (!ctx.isAppActive()) return;
    paletteLastFocus = document.activeElement;
    paletteEl.classList.remove("hidden");
    paletteInput.value = "";
    renderPalette("");
    paletteInput.focus();
  }

  function closePalette() {
    if (!isPaletteOpen()) return;
    paletteEl.classList.add("hidden");
    paletteList.innerHTML = "";
    paletteRows = [];
    paletteIndex = -1;
    if (paletteLastFocus) paletteLastFocus.focus();
  }

  function filterContacts(query) {
    const all = ctx.getContacts();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => {
      const name = (c.displayName || "").toLowerCase();
      const handle = (c.username || "").toLowerCase();
      return name.includes(q) || handle.includes(q);
    });
  }

  function renderPalette(query) {
    paletteRows = filterContacts(query);
    paletteIndex = paletteRows.length > 0 ? 0 : -1;

    if (paletteRows.length === 0) {
      const msg = ctx.getContacts().length === 0 ? "Inga kontakter än" : "Inga träffar";
      paletteList.innerHTML = '<div class="kbd-empty"></div>';
      paletteList.firstChild.textContent = msg;
      return;
    }

    paletteList.innerHTML = paletteRows
      .map((c, i) => {
        const primary = c.displayName ? ctx.escapeHtml(c.displayName) : ctx.escapeHtml(c.username);
        const handle = ctx.escapeHtml(c.username);
        const dot = '<span class="presence-dot' + (c.online ? " online" : "") + '"></span>';
        const unread = c.unread > 0 ? '<span class="kbd-unread">' + c.unread + "</span>" : "";
        return (
          '<div class="kbd-row' + (i === 0 ? " active" : "") + '" role="option" data-index="' + i + '">' +
          dot +
          '<span class="kbd-name">' + primary + "</span>" +
          '<span class="kbd-handle">@' + handle + "</span>" +
          unread +
          "</div>"
        );
      })
      .join("");

    paletteList.querySelectorAll(".kbd-row").forEach((row) => {
      const i = Number(row.dataset.index);
      row.addEventListener("mousemove", () => highlightPalette(i));
      row.addEventListener("click", () => choosePalette(i));
    });
  }

  function highlightPalette(i) {
    if (paletteRows.length === 0) return;
    const n = paletteRows.length;
    paletteIndex = ((i % n) + n) % n; // wrap
    const rows = paletteList.querySelectorAll(".kbd-row");
    rows.forEach((row, idx) => row.classList.toggle("active", idx === paletteIndex));
    const active = rows[paletteIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function choosePalette(i) {
    const c = paletteRows[i];
    if (!c) return;
    closePalette();
    ctx.selectContact(c.contactId, c.recipientId, c.username, c.displayName);
  }

  function onPaletteKeydown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightPalette(paletteIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightPalette(paletteIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (paletteIndex >= 0) choosePalette(paletteIndex);
    }
    // Esc is handled by the global registry handler (palette is registered).
  }
```

- [ ] **Step 4: Register the palette overlay + chord + input listener in `initKeyboard`**

Inside `initKeyboard`, after `ctx = context;` and before registering the
existing overlays, grab the DOM and wire palette events. The palette must be
registered **topmost-first relative to the existing overlays**, so `unshift`
it onto the front of `overlays` (the cheatsheet, added in Task 6, goes in front
of the palette). Adjust `initKeyboard` to:

```js
  function initKeyboard(context) {
    ctx = context;

    // Palette DOM + events
    paletteEl = document.getElementById("kbd-palette");
    paletteInput = document.getElementById("kbd-palette-input");
    paletteList = document.getElementById("kbd-palette-list");
    paletteInput.addEventListener("input", () => renderPalette(paletteInput.value));
    paletteInput.addEventListener("keydown", onPaletteKeydown);
    paletteEl.addEventListener("click", (e) => {
      if (e.target === paletteEl) closePalette(); // backdrop click
    });

    // Register overlays, topmost-first.
    // Palette sits above the app's own modals; cheatsheet (Task 6) goes in front.
    registerOverlay({ isOpen: isPaletteOpen, close: closePalette });
    registerOverlay({ isOpen: ctx.isLightboxOpen, close: ctx.closeLightbox });
    registerOverlay({ isOpen: ctx.isInviteOpen, close: ctx.closeInvite });
    registerOverlay({ isOpen: ctx.isSettingsOpen, close: ctx.closeSettings });

    document.addEventListener("keydown", onGlobalKeydown);
  }
```

- [ ] **Step 5: Add the Cmd/Ctrl+K open chord to `onGlobalKeydown`**

Update `onGlobalKeydown` to open the palette. Chords accept either `metaKey`
(Mac ⌘) or `ctrlKey`. Place the chord check before the `Escape` check:

```js
  function onGlobalKeydown(e) {
    // Cmd/Ctrl+K — contact palette. Exempt from the typing guard (it's a chord).
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (isPaletteOpen()) {
        closePalette();
      } else {
        openPalette();
      }
      return;
    }

    if (e.key === "Escape") {
      if (closeTopmostOverlay()) {
        e.preventDefault();
      }
      return;
    }
  }
```

- [ ] **Step 6: Manual verification**

Reload the app (hard reload), log in with at least one accepted contact:

1. Press `Cmd+K` (Mac) or `Ctrl+K` → palette opens centered, input focused,
   all accepted contacts listed, first row highlighted.
2. Type part of a contact's name → list filters (substring, case-insensitive);
   clear it → all contacts return.
3. `↓`/`↑` move the highlight and wrap at the ends.
4. Hover a row → it highlights; move mouse → highlight follows.
5. `Enter` (or click a row) → that chat opens and the palette closes.
6. Reopen, press `Esc` → palette closes, focus returns to where it was.
7. Click the dimmed backdrop (outside the panel) → palette closes.
8. Press `Cmd/Ctrl+K` again while open → it toggles closed.
9. With an account that has zero accepted contacts → palette shows
   "Inga kontakter än" and `Enter` does nothing.
10. Filter to no matches → shows "Inga träffar", `Enter` does nothing.
11. No console errors.

- [ ] **Step 7: Commit**

```bash
git add static/index.html static/keyboard.js static/style.css
git commit -m "feat: add Cmd/Ctrl+K contact switcher palette

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Typing guard + `/` focus composer + `Cmd/Ctrl+,` settings

**Files:**
- Modify: `static/keyboard.js`

- [ ] **Step 1: Add a typing-guard helper**

In `keyboard.js`, add this helper near the other helpers (e.g. just above
`onGlobalKeydown`). It returns true when the user is typing into a field or any
overlay is open — bare-key shortcuts must be suppressed then:

```js
  // True when a bare-key shortcut should be ignored: focus is in an editable
  // field, or any overlay is open. Modified chords bypass this guard.
  function isTypingOrOverlayOpen() {
    const el = document.activeElement;
    if (el) {
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) return true;
    }
    return overlays.some((o) => o.isOpen());
  }
```

- [ ] **Step 2: Add `/` and `Cmd/Ctrl+,` to `onGlobalKeydown`**

Extend `onGlobalKeydown`. Add the `Cmd/Ctrl+,` chord next to the existing
`Cmd/Ctrl+K` chord (chords are exempt from the typing guard), and add `/` after
the `Escape` block (bare key — guarded). Full handler after this step:

```js
  function onGlobalKeydown(e) {
    // --- Modified chords (exempt from typing guard) ---
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (isPaletteOpen()) closePalette();
      else openPalette();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === ",") {
      if (!ctx.isAppActive()) return;
      e.preventDefault();
      ctx.openSettings();
      return;
    }

    // --- Escape (works regardless of typing, but composer hint menu stops it) ---
    if (e.key === "Escape") {
      if (closeTopmostOverlay()) e.preventDefault();
      return;
    }

    // --- Bare-key shortcuts (suppressed while typing / overlay open) ---
    if (isTypingOrOverlayOpen()) return;
    if (!ctx.isAppActive()) return;

    if (e.key === "/") {
      e.preventDefault();
      ctx.focusComposer();
      return;
    }
  }
```

- [ ] **Step 3: Manual verification**

Reload the app (hard reload):

1. With focus NOT in a field (click empty chat area), press `/` → composer gets
   focus and the field is empty (the `/` itself is not typed). Then type
   `theme` → you can use slash commands as normal.
2. With focus already in the composer, press `/` → a literal `/` is typed (the
   global handler is suppressed by the typing guard) and the command-hint menu
   appears.
3. Press `Cmd+,` (Mac) or `Ctrl+,` → Settings opens. `Esc` closes it.
4. Open the palette (`Cmd/Ctrl+K`), then press `/` → nothing happens (overlay
   open ⇒ bare-key guard). `Cmd/Ctrl+,` while palette open → settings still
   opens (chord is exempt) — that's acceptable; `Esc` twice returns you out.
5. On the auth screen (log out), `/` and `Cmd/Ctrl+,` do nothing (app inactive).
6. No console errors.

- [ ] **Step 4: Commit**

```bash
git add static/keyboard.js
git commit -m "feat: add / focus-composer and Cmd/Ctrl+, settings shortcuts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `Alt+↑/↓` previous/next contact

**Files:**
- Modify: `static/keyboard.js`

- [ ] **Step 1: Add the contact-cycling helper**

In `keyboard.js`, add this helper near the palette helpers:

```js
  // Move selection to the prev/next accepted contact and open it. delta is -1
  // (prev) or +1 (next). Wraps. No-op for 0 contacts. If none selected, picks
  // the first (next) or last (prev).
  function cycleContact(delta) {
    const list = ctx.getContacts();
    if (list.length === 0) return;
    const currentId = ctx.getSelectedRecipientId();
    let idx = list.findIndex((c) => c.recipientId === currentId);
    let next;
    if (idx === -1) {
      next = delta > 0 ? 0 : list.length - 1;
    } else {
      const n = list.length;
      next = (((idx + delta) % n) + n) % n;
    }
    const c = list[next];
    ctx.selectContact(c.contactId, c.recipientId, c.username, c.displayName);
  }
```

- [ ] **Step 2: Add the `Alt+↑/↓` handling to `onGlobalKeydown`**

Add this inside `onGlobalKeydown`, in the bare-key section (after the
`isTypingOrOverlayOpen()` / `isAppActive()` guards, alongside the `/` branch):

```js
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      cycleContact(1);
      return;
    }
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      cycleContact(-1);
      return;
    }
```

Note: these are placed under the typing guard intentionally — `Alt+↑/↓` while
typing in the composer should NOT switch contacts. They also require
`isAppActive()` (already guarded above).

- [ ] **Step 3: Manual verification**

Reload (hard reload). Use an account with ≥2 accepted contacts:

1. With no chat open, press `Alt+↓` → first contact opens.
2. Press `Alt+↓` repeatedly → cycles forward through contacts, wraps to the
   first after the last.
3. `Alt+↑` → cycles backward, wraps to the last from the first.
4. With focus in the composer (typing), `Alt+↑/↓` does NOT switch contacts.
5. With the palette open, `Alt+↑/↓` does NOT switch contacts (it moves the
   palette highlight only if focus is the palette input — that's the palette's
   own ArrowUp/Down, which doesn't use Alt; with Alt held the global handler is
   guarded by the open overlay, so nothing happens). No errors either way.
6. Single-contact account: `Alt+↓`/`Alt+↑` opens that one contact, no error.
7. No console errors.

- [ ] **Step 4: Commit**

```bash
git add static/keyboard.js
git commit -m "feat: add Alt+Up/Down to cycle contacts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `?` keyboard cheatsheet + platform labels

**Files:**
- Modify: `static/index.html` (cheatsheet markup)
- Modify: `static/keyboard.js` (open/close, register overlay, `?` key, platform labels)
- Modify: `static/style.css` (cheatsheet styles)

- [ ] **Step 1: Add cheatsheet markup to `static/index.html`**

Add right after the palette markup (from Task 3 Step 1), before the settings
modal. It reuses the settings/invite modal chrome (titlebar dots + close). Key
caps carry a `data-mac` / `data-other` pair so JS can swap labels at init:

```html
    <!-- Keyboard shortcuts cheatsheet (?) -->
    <div
      id="kbd-cheatsheet"
      class="hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Kortkommandon"
    >
      <div id="kbd-cheatsheet-panel">
        <div id="kbd-cheatsheet-titlebar">
          <span class="tb-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <h2 id="kbd-cheatsheet-title">~/kortkommandon</h2>
          <button id="kbd-cheatsheet-close" aria-label="St&auml;ng">
            <svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div id="kbd-cheatsheet-body">
          <h3 class="kbd-cheatsheet-heading">navigering</h3>
          <div class="kbd-cheatsheet-row"><span>Hoppa till kontakt</span><span class="kbd-keys"><kbd class="kbd-mod"></kbd><kbd>K</kbd></span></div>
          <div class="kbd-cheatsheet-row"><span>F&ouml;reg&aring;ende / n&auml;sta kontakt</span><span class="kbd-keys"><kbd class="kbd-alt"></kbd><kbd>&uarr;</kbd> <kbd class="kbd-alt"></kbd><kbd>&darr;</kbd></span></div>
          <div class="kbd-cheatsheet-row"><span>Fokusera skrivf&auml;ltet</span><span class="kbd-keys"><kbd>/</kbd></span></div>

          <h3 class="kbd-cheatsheet-heading">&aring;tg&auml;rder</h3>
          <div class="kbd-cheatsheet-row"><span>Inst&auml;llningar</span><span class="kbd-keys"><kbd class="kbd-mod"></kbd><kbd>,</kbd></span></div>
          <div class="kbd-cheatsheet-row"><span>St&auml;ng ruta / lightbox</span><span class="kbd-keys"><kbd>esc</kbd></span></div>
          <div class="kbd-cheatsheet-row"><span>Visa kortkommandon</span><span class="kbd-keys"><kbd>?</kbd></span></div>

          <h3 class="kbd-cheatsheet-heading">i skrivf&auml;ltet</h3>
          <div class="kbd-cheatsheet-row"><span>Slash-kommandon (/help, /theme &hellip;)</span><span class="kbd-keys"><kbd>/</kbd></span></div>
          <div class="kbd-cheatsheet-row"><span>Skicka</span><span class="kbd-keys"><kbd>&crarr;</kbd></span></div>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Add cheatsheet styles to `static/style.css`**

Append to the end of `static/style.css`:

```css
/* --- Keyboard cheatsheet (?) --- */
#kbd-cheatsheet {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 65;
}
#kbd-cheatsheet.hidden { display: none; }
#kbd-cheatsheet-panel {
  width: 460px;
  max-width: 92vw;
  background: var(--bg, #0a0a0a);
  border: 1px solid var(--accent);
  border-radius: 6px;
  box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 20%, transparent);
  overflow: hidden;
}
#kbd-cheatsheet-titlebar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.8rem;
  border-bottom: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
}
#kbd-cheatsheet-title {
  font-size: 0.85rem;
  font-weight: normal;
  margin: 0;
  opacity: 0.85;
}
#kbd-cheatsheet-close {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  display: flex;
}
#kbd-cheatsheet-close:hover { opacity: 1; }
#kbd-cheatsheet-body { padding: 0.6rem 0.4rem 0.9rem; }
.kbd-cheatsheet-heading {
  padding: 0.5rem 0.8rem 0.2rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.5;
  margin: 0;
  font-weight: normal;
}
.kbd-cheatsheet-row {
  display: flex;
  align-items: center;
  padding: 0.35rem 0.8rem;
  font-size: 0.88rem;
}
.kbd-cheatsheet-row > span:first-child { flex: 1; }
.kbd-keys { display: flex; gap: 4px; align-items: center; }
.kbd-keys kbd {
  border: 1px solid color-mix(in srgb, var(--fg) 25%, transparent);
  border-radius: 3px;
  padding: 1px 6px;
  font-family: inherit;
  font-size: 0.8rem;
  background: color-mix(in srgb, var(--fg) 6%, transparent);
}
```

- [ ] **Step 3: Add cheatsheet logic + platform labels to `keyboard.js`**

Add cheatsheet vars/functions near the palette section:

```js
  // --- Cheatsheet (?) -----------------------------------------------------
  let cheatsheetEl, cheatsheetClose;
  let cheatsheetLastFocus = null;

  function isCheatsheetOpen() {
    return cheatsheetEl && !cheatsheetEl.classList.contains("hidden");
  }

  function openCheatsheet() {
    if (!ctx.isAppActive()) return;
    cheatsheetLastFocus = document.activeElement;
    cheatsheetEl.classList.remove("hidden");
    cheatsheetClose.focus();
  }

  function closeCheatsheet() {
    if (!isCheatsheetOpen()) return;
    cheatsheetEl.classList.add("hidden");
    if (cheatsheetLastFocus) cheatsheetLastFocus.focus();
  }

  // Replace ⌘ / ⌥ vs Ctrl / Alt labels in the cheatsheet at init (display only;
  // the handlers accept both metaKey and ctrlKey regardless).
  function applyPlatformLabels() {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
    const mod = isMac ? "⌘" : "Ctrl";   // ⌘
    const alt = isMac ? "⌥" : "Alt";    // ⌥
    document.querySelectorAll("#kbd-cheatsheet .kbd-mod").forEach((el) => (el.textContent = mod));
    document.querySelectorAll("#kbd-cheatsheet .kbd-alt").forEach((el) => (el.textContent = alt));
  }
```

- [ ] **Step 4: Register the cheatsheet + `?` key + wire close in `initKeyboard`**

In `initKeyboard`, after the palette wiring and before registering overlays,
add the cheatsheet DOM/events and platform labels; register the cheatsheet as
the **front** (topmost) overlay with `unshift` semantics — i.e. register it
first so it precedes the palette. Update the registration block to:

```js
    // Cheatsheet DOM + events
    cheatsheetEl = document.getElementById("kbd-cheatsheet");
    cheatsheetClose = document.getElementById("kbd-cheatsheet-close");
    cheatsheetClose.addEventListener("click", closeCheatsheet);
    cheatsheetEl.addEventListener("click", (e) => {
      if (e.target === cheatsheetEl) closeCheatsheet(); // backdrop click
    });
    applyPlatformLabels();

    // Register overlays, topmost-first: cheatsheet, palette, then app modals.
    registerOverlay({ isOpen: isCheatsheetOpen, close: closeCheatsheet });
    registerOverlay({ isOpen: isPaletteOpen, close: closePalette });
    registerOverlay({ isOpen: ctx.isLightboxOpen, close: ctx.closeLightbox });
    registerOverlay({ isOpen: ctx.isInviteOpen, close: ctx.closeInvite });
    registerOverlay({ isOpen: ctx.isSettingsOpen, close: ctx.closeSettings });

    document.addEventListener("keydown", onGlobalKeydown);
```

(Remove the old `registerOverlay(...)` block + the final `addEventListener`
from Task 3 Step 4 so they aren't duplicated — there must be exactly one
registration block and one `document.addEventListener("keydown", onGlobalKeydown)`.)

- [ ] **Step 5: Add the `?` key to the bare-key section of `onGlobalKeydown`**

In the bare-key section (after the typing/app-active guards), add:

```js
    if (e.key === "?") {
      e.preventDefault();
      openCheatsheet();
      return;
    }
```

`?` is Shift+/ on most layouts; `e.key` is already `"?"` when shifted, so no
explicit shift check is needed.

- [ ] **Step 6: Manual verification**

Reload (hard reload):

1. With focus NOT in a field, press `?` → cheatsheet opens, showing the grouped
   shortcuts. On a Mac the mod/alt caps show `⌘` / `⌥`; on Windows/Linux they
   show `Ctrl` / `Alt`. (To spot-check the other platform, temporarily set the
   UA via DevTools device toolbar, or trust the branch.)
2. `Esc`, the close (✕) button, and a backdrop click each close it; focus
   returns to where it was.
3. While typing in the composer, `?` types a literal `?` and does NOT open the
   cheatsheet.
4. With the cheatsheet open, `Esc` closes the cheatsheet first (it's topmost).
   Open palette then... (palette and cheatsheet aren't both open at once via UI,
   but if both were, `Esc` closes cheatsheet first).
5. No console errors.

- [ ] **Step 7: Commit**

```bash
git add static/index.html static/keyboard.js static/style.css
git commit -m "feat: add ? keyboard cheatsheet with platform-aware labels

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Precache `keyboard.js` + bump SW cache

**Files:**
- Modify: `static/sw.js`

- [ ] **Step 1: Add `keyboard.js` to the precache list and bump the version**

In `static/sw.js`, change line 1:

```js
const CACHE = "ping-shell-v9";
```

And add `/keyboard.js` to the `SHELL` array (after `/commands.js`):

```js
  "/commands.js",
  "/keyboard.js",
```

- [ ] **Step 2: Manual verification**

1. Hard-reload the app (Cmd/Ctrl+Shift+R) so the new service worker installs.
2. DevTools → Application → Service Workers: confirm the worker activated and
   (Application → Cache Storage) a `ping-shell-v9` cache exists containing
   `/keyboard.js`. Old `ping-shell-v8` should be gone (the activate handler
   deletes non-current caches).
3. Go offline (DevTools → Network → Offline), reload → app shell still loads and
   `Cmd/Ctrl+K` palette still works (keyboard.js served from cache).
4. No console errors.

- [ ] **Step 3: Commit**

```bash
git add static/sw.js
git commit -m "chore: precache keyboard.js and bump SW cache to v9

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Document shortcuts in README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a keyboard-shortcuts bullet to the Features list**

In `README.md`, in the `## Features` list, add a bullet after the slash-commands
bullet (the one ending `with a \`/\` hint menu`):

```markdown
- Keyboard shortcuts: `Cmd/Ctrl+K` contact switcher, `Cmd/Ctrl+,` settings,
  `/` to focus the composer, `Alt+↑/↓` to switch contacts, `Esc` to close the
  topmost overlay, and `?` for a shortcuts cheatsheet
```

- [ ] **Step 2: Manual verification**

```bash
grep -n "Cmd/Ctrl+K contact switcher" README.md
```
Expected: one match in the Features list.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document keyboard shortcuts in README

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final end-to-end verification (after all tasks)

Run the app, hard-reload, log in with an account that has ≥2 accepted contacts,
at least one online and one with unread messages. Confirm:

- [ ] `Cmd/Ctrl+K` opens the palette; empty shows all contacts with presence
      dots + unread badges; substring filtering works; `↑/↓` wrap; `Enter`/click
      opens a chat; `Esc`/backdrop/toggle close it.
- [ ] `/` (not typing) focuses the composer; `/` while typing inserts a literal
      slash and shows the hint menu.
- [ ] `Cmd/Ctrl+,` opens Settings.
- [ ] `Alt+↑/↓` cycles contacts (wraps; opens first when none selected; ignored
      while typing).
- [ ] `?` (not typing) opens the cheatsheet with correct platform labels;
      `Esc`/✕/backdrop close it.
- [ ] `Esc` closes the topmost overlay only; composer hint-menu `Esc` does not
      leak to overlays.
- [ ] Logged out / auth screen: chat shortcuts no-op; no errors.
- [ ] Offline: shell + keyboard.js load from `ping-shell-v9` cache.
- [ ] No console errors at any point.
```
