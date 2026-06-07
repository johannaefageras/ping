# Keyboard shortcuts & Cmd+K contact switcher — design

**Date:** 2026-06-07
**Status:** Approved, ready for implementation plan

## Summary

Add a keyboard-navigation layer to Ping: a `Cmd/Ctrl+K` command-palette
contact switcher, a unified `Esc`-closes-topmost-overlay handler, a small set
of global shortcuts (`/`, `Cmd/Ctrl+,`, `?`, `Alt+↑/↓`), and a `?` cheatsheet
overlay. The work keeps Ping's fast, terminal-style feel and introduces no new
runtime dependencies or build step.

This refines the FEATURE_IDEAS.md line:
> Keyboard shortcuts: `Cmd/Ctrl+K` contact switcher, `Esc` close
> modal/lightbox, and commands like `/theme cyan` or `/mute`.

Slash commands (`/theme`, `/mute`, …) and per-overlay `Esc` already exist, so
this spec covers the *net-new* keyboard layer and consolidates the existing
`Esc` handling.

## Goals

- One global place that knows which overlays exist and which key does what.
- A `Cmd/Ctrl+K` palette to jump to any accepted contact.
- `Esc` reliably closes the topmost open overlay, with no duplicated handlers.
- Discoverability via a `?` cheatsheet.
- Shortcuts never fire while the user is typing a message (except modified
  chords like `Cmd+K` / `Cmd+,`).

## Non-goals (YAGNI)

- Fuzzy matching (substring only).
- Recent-contact ordering / MRU.
- User-remappable keys.
- A send shortcut (plain `Enter` already sends).
- A new JS test harness (verified manually; Playwright noted as a possible
  future add, explicitly out of scope here).

## Architecture

### New module: `static/keyboard.js`

Owns all global keyboard behavior and the overlay registry. Exposes a single
init function called from `app.js` after the app boots and the user is known:

```js
initKeyboard({
  getContacts,     // () => [{ contactId, recipientId, username, displayName, online, unread }]
  selectContact,   // (contactId, recipientId, username, displayName) => void
  getSelectedRecipientId, // () => string | null
  openSettings,    // () => void
  isAppActive,     // () => boolean  (false on auth screen / logged out)
});
```

Rationale: keeps `app.js` (~60k) from growing; gives the palette/shortcuts a
clean accessor interface instead of reaching into DOM or module globals.

### HTML additions (`static/index.html`)

- **Cmd+K palette:** backdrop + panel + input row (`>` prompt, search input,
  `esc` tag) + scrollable list + footer hints. Styled to mirror the existing
  slash-command hint menu (`--accent` border; active row inverts to accent bg).
- **Cheatsheet overlay:** reuses the settings/invite modal chrome (titlebar
  with three dots + close button), grouped shortcut sections, right-aligned
  key caps.

### CSS (`static/style.css`)

New rules for the palette and cheatsheet, placed alongside the existing modal /
hint styles. Reuse existing tokens (`--bg`, `--fg`, `--accent`) so all themes
work automatically.

### Service worker (`static/sw.js`)

Add `keyboard.js` to the precache list and bump the cache version (currently
v8 → v9), matching the established per-asset-change convention.

## Overlay registry & unified Esc

Replace the three document-level `Esc` handlers (lightbox, settings, invite)
with one handler in `keyboard.js` that closes the **topmost** open overlay.

A small ordered registry; each entry is `{ isOpen(), close() }`. On `Esc`, walk
the registry, close the first open overlay, stop. Stacking order (topmost
first):

1. cheatsheet
2. Cmd+K palette
3. lightbox
4. invite modal
5. settings modal

Existing `closeLightbox` / `closeSettings` / `closeInvite` stay as-is — the
registry calls them. Only the three redundant
`document.addEventListener("keydown", …Escape…)` blocks are deleted. Behavior
for today's overlays is identical; the structure is now extensible and
duplication-free.

The composer's command-hint menu keeps its **own** local `Esc` handling: while
the hint menu is open, its keydown handler calls `stopPropagation()` so the
global `Esc` doesn't also fire. `Esc` in the composer therefore dismisses the
hint menu without touching overlays, exactly as today.

## Cmd+K palette behavior

- **Open:** `Cmd/Ctrl+K` → `preventDefault`, show backdrop, clear input, render
  all accepted contacts, highlight first row, focus input. Save
  `document.activeElement` for restore.
- **Data:** from `getContacts()`. Never reads DOM or globals directly.
- **Filter:** case-insensitive **substring** match on `username` +
  `displayName`, re-rendered on every `input`. Empty query → all contacts.
- **Row contents:** presence dot (online/offline), name (display name or
  username), `@handle`, unread badge when unread > 0 — carried from the
  sidebar data.
- **Keys inside palette:**
  - `↑/↓` move highlight, wrapping at ends.
  - `Enter` → `selectContact(...)` for highlighted row, then close.
  - `Esc` → close (via registry).
  - Mouse hover highlights; click selects.
- **Edge cases:**
  - No accepted contacts → dim "Inga kontakter än" line; `Enter` is a no-op.
  - Filter empties list → no active row; `Enter` is a no-op.
- **Close:** hide backdrop, restore saved focus.

## Global shortcuts

All in the one global `keydown` handler. Each **bare-key** shortcut first
checks a typing guard: ignore if focus is in an `<input>`/`<textarea>` or any
overlay is open. Modified chords (`Cmd+K`, `Cmd+,`) are exempt from the
typing guard. All chord handling accepts **either** `metaKey` or `ctrlKey`, so
the Mac and non-Mac chords both work regardless of platform detection. All
chat-acting shortcuts no-op when `isAppActive()` is false.

| Shortcut         | Action |
|------------------|--------|
| `Cmd/Ctrl+K`     | Open contact palette. `preventDefault`. |
| `Cmd/Ctrl+,`     | Open Settings (`openSettings()`). `preventDefault`. |
| `/`              | If not typing and no overlay open: focus composer (`textInput`); existing composer logic then handles slash commands. `preventDefault`. |
| `?` (Shift+/)    | If not typing: open cheatsheet. |
| `Alt+↑` / `Alt+↓`| Move to previous/next accepted contact relative to the current selection and open it (`selectContact`). Wraps at ends. No-op if 0–1 contacts. If none selected, `Alt+↓` selects the first contact. |

## Cheatsheet overlay

Static markup in `index.html`, reusing settings/invite modal chrome. Opened by
`?`; closed by `Esc` (registry), the close button, or backdrop click. Content
groups: **navigering** (jump to contact, prev/next contact, focus composer),
**åtgärder** (settings, close overlay, show shortcuts), **i skrivfältet**
(slash commands, send).

## Platform labels

Detect Mac once at init (`navigator.platform` / `userAgent`). Render `⌘`/`⌥`
on Mac and `Ctrl`/`Alt` elsewhere, in both the cheatsheet and the palette
footer. Detection affects **display only** — key handling accepts both
`metaKey` and `ctrlKey`.

## Error handling

- `keyboard.js` is defensive: if accessors are missing/unwired (e.g. called
  before login), shortcuts no-op rather than throw.
- Chat-acting shortcuts do nothing when logged out / on the auth screen
  (`isAppActive()` guard).
- Palette guards against empty/filtered-empty contact lists.

## Testing

No JS build step or JS test harness exists (tests are pytest/backend only).
This is pure client-side JS, verified manually against the running app:

1. Palette: open via `Cmd/Ctrl+K`, empty shows all contacts, substring filter
   works, `↑/↓` wrap, `Enter` opens the highlighted chat, hover/click select.
2. Each shortcut: `/` focuses composer, `Cmd/Ctrl+,` opens settings, `?` opens
   cheatsheet, `Alt+↑/↓` cycles contacts (incl. wrap and none-selected case).
3. `Esc` stacking: closes topmost overlay only; composer hint menu `Esc` does
   not leak to overlays.
4. Typing guard: bare-key shortcuts (`/`, `?`, `Alt+↑/↓`) do **not** fire while
   typing a message.
5. Logged-out / auth screen: chat shortcuts no-op.
6. SW cache bump loads `keyboard.js`.
7. Platform labels render correctly (spot-check Mac vs. non-Mac via UA, or
   reason about the branch).

Automated Playwright smoke coverage is a possible future addition but is out of
scope here (new dependency/harness).

## Files touched

- `static/keyboard.js` — **new**: registry, palette, global shortcuts, init.
- `static/index.html` — palette + cheatsheet markup; load `keyboard.js`.
- `static/app.js` — call `initKeyboard({...})` with accessors; remove the three
  redundant document-level `Esc` handlers; ensure command-hint `Esc` stops
  propagation.
- `static/style.css` — palette + cheatsheet styles.
- `static/sw.js` — precache `keyboard.js`; bump cache version (v8 → v9).
- `README.md` — document the new keyboard shortcuts (alongside the existing
  slash-command docs).
