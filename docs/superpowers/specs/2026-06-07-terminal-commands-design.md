# Mini Terminal Command Layer — Design

**Date:** 2026-06-07
**Feature:** A slash-command layer in the message composer — type `/theme cyan`,
`/who`, `/clear`, etc. to control the app from the input box, terminal-style,
with a hint menu that appears as you type `/`.
**Source:** FEATURE_IDEAS.md → "Mini terminal command layer" (Bigger / Cool
Bets). Also touches the keyboard-shortcuts idea (`/theme cyan`, `/mute`).

## Goal

Let the user drive common actions by typing commands in the existing message
input, fitting Ping's retro-terminal aesthetic. Commands run locally (no DB
rows, nothing sent to the contact) and give feedback via ephemeral, local-only
"system lines" rendered in the chat board. A hint menu appears when the input
starts with `/`, making the command set discoverable and completable with the
keyboard.

## Command set

All user-facing strings are in **Swedish** to match the app.

| Command | Aliases | Args | Behavior |
|---|---|---|---|
| `/help` | `/?`, `/commands` | — | One system line listing every command + summary (one per line). |
| `/theme` | — | `<name>` | Validate against the 7 themes; apply, persist, confirm. Missing/invalid arg → system line listing valid theme names. |
| `/font` | — | `<name>` | Same as `/theme` for the 5 fonts (radon, neon, argon, xenon, krypton). |
| `/clear` | — | — | Per-side dismiss of every message in the current chat (loops the board calling existing `dismissPing`). Confirms count. Requires an active chat. |
| `/who` | — | — | System line: contact's display name, `@username`, and online/offline. Requires an active chat. |
| `/last` | — | — | Recall your last **sent** text into the input (no auto-send), focus it. Requires an active chat and a prior sent text. |
| `/mute` | — | — | Mute ping sounds; sync the existing mute toggle; confirm. |
| `/unmute` | — | — | Unmute; sync toggle; confirm. |
| `/shrug` | — | — | Insert `¯\_(ツ)_/¯` into the input (append if text exists), focus. Does not send. |

### Valid argument values
- **Themes:** green, amber, cyan, pink, red, paper, purple.
- **Fonts:** radon, neon, argon, xenon, krypton.

These lists mirror the swatches in `index.html` and the font picker. They are
defined once in `commands.js` (the registry); the spec values above must match
what the app actually offers.

## Constraints & decisions

Settled during brainstorming:

- **Command registry pattern.** A single registry (array of command definitions)
  is the source of truth for dispatch, the hint menu, and `/help`. Adding a
  command in one place updates all three.
- **No backend, no schema, no DB rows.** Everything is client-side. Commands
  never insert `pings`, never call Supabase. Fits Ping's disposable ethos and
  keeps the server stateless.
- **Local-only feedback ("system lines").** Feedback renders as a local
  `<div class="item system">` in the board, prefixed `> `, terminal-styled,
  auto-fading. Never stored, never sent to the contact, not a real ping.
- **Hint menu on `/`.** When the input starts with `/` and has no space yet, a
  popup above the input lists matching commands. `↑`/`↓` to move, `Tab`/`Enter`
  to complete (not submit), `Esc` to close, click to complete. When the menu is
  closed, `Enter` submits as normal.
- **Literal slash still sendable.** `/` alone, or `/` followed immediately by a
  space, is treated as ordinary text and sent to the contact — only a
  recognised `/word` pattern is intercepted.
- **No argument-value autocomplete** in this version (e.g. suggesting theme
  names after `/theme `). The hint menu only completes command names.

## Non-goals (YAGNI)

- No `/send @jo file` (cross-contact send with a file picker) in this version —
  it is the most complex command and was deliberately left out.
- No argument-value autocomplete / second-level hints.
- No command history beyond `/last` (no full up-arrow ring buffer).
- No JS unit-test framework — the repo has Python tests only; introducing a JS
  runner for this is scope creep. Pure functions are written to be testable, but
  verification is manual in the browser (see Testing).
- No persistence of command state beyond what the underlying action already
  persists (theme/font/mute already use `localStorage`).

## Architecture

A new client module `static/commands.js` (plain script, not an ES module — the
project has no bundler and `app.js` is a plain script) loaded **before** `app.js`
in `index.html`. It exposes a `window.PingCommands` namespace. `app.js` wires it
into the composer and provides a capability context so commands never touch the
DOM or Supabase directly.

```
#text-input (composer)
   │  input event ──────────────► PingCommands.getCommandHints(value) ──► render hint menu
   │  keydown (↑ ↓ Tab Enter Esc) ─► hint-menu navigation / completion
   │
   └─ form submit
        │  text starts with a known /command?
        │      yes ─► PingCommands.runCommand(text, ctx) ─► command.run(ctx,args)
        │                                                      │
        │                                                      ├─ ctx.applyTheme / applyFont / setMuted
        │                                                      ├─ ctx.systemLine(text)
        │                                                      ├─ ctx.clearChat()
        │                                                      ├─ ctx.setInput(text) / focusInput()
        │                                                      └─ ctx.getWho() / getLastSent()
        │      no  ─► existing send-as-ping path (unchanged)
```

### `static/commands.js` (new) — public surface on `window.PingCommands`

- `COMMANDS` — the registry: array of
  `{ name, aliases?, arg?, summary, run(ctx, args) }`.
- `THEMES`, `FONTS` — the valid argument-value lists.
- `parseCommand(raw)` — returns `{ name, args, command }` if `raw` is a
  recognised command, else `null` (so literal slashes fall through to send).
- `runCommand(raw, ctx)` — parses; if unknown command, emits
  `ctx.systemLine("okänt kommando: /foo — skriv /help")`; otherwise runs it.
- `getCommandHints(raw)` — returns the registry entries whose name/alias matches
  the partial input, for the hint menu. Empty array hides the menu.

`parseCommand` and `getCommandHints` are **pure** (no side effects), so they are
the unit-testable core.

### `static/app.js` (modified)

New helpers / state:
- `let lastSentText = null;` set whenever a **text** ping is sent (in the
  `textForm` submit handler). `getLastSent()` reads it.
- `systemLine(text)` — append `<div class="item system">` to `#board` with a
  `> ` prefix; auto-fade after ~8s; multi-line text rendered with line breaks
  (used by `/help` and `/who`).
- `clearChat()` — iterate `#board .item`, skipping `.system` lines (they are
  local-only and have no associated `ping` object). For each real ping, trigger
  its existing dismiss path by clicking the rendered `.dismiss-btn`
  (`el.querySelector(".dismiss-btn")?.click()`). This reuses `dismissPing`
  exactly — including the `dismiss_ping` RPC, object-URL revocation, and
  fade-out — without `clearChat` needing access to the per-element `ping` object
  (which `renderPing` captures only in the button's click closure, not as an
  element property). Return the count of pings dismissed.
- `buildCommandContext()` — assemble the `ctx` object handed to commands:
  `{ selectedContact, onlineUserIds, systemLine, clearChat, getLastSent,
     setInput, focusInput, applyTheme, applyFont, setMuted, THEMES, FONTS }`.
  `applyTheme`/`applyFont`/`setMuted` wrap the existing functions **and** sync
  the picker/toggle UI + `localStorage` so the settings panel stays consistent.

Integration points:
- **`textForm` submit:** before the current logic, `const parsed =
  PingCommands.parseCommand(text)`. If non-null → `runCommand(text,
  buildCommandContext())`, clear input, hide hint menu, `return` (no ping). Else
  proceed with the existing send path; on a successful text send, set
  `lastSentText`.
- **Hint menu:** add `#command-hints` markup in the `<footer>`; an `input`
  listener on `#text-input` to show/filter/hide it; a `keydown` listener
  (capturing before submit) handling `↑ ↓ Tab Enter Esc` only when the menu is
  visible.

### `static/index.html` (modified)
- Add `<div id="command-hints" class="hidden" role="listbox"></div>` inside the
  composer `<footer>`, above the form (so it can be positioned over the input).
- Add `<script src="commands.js"></script>` immediately **before**
  `<script src="app.js"></script>`.

### `static/style.css` (modified)
- `.item.system` — terminal-styled local line: accent-colored, monospace, no
  bubble background, slightly dimmed, left-aligned; fade animation.
- `#command-hints` — a popup anchored above the input: bordered box, list of
  rows (`name` + dim `summary`), a `.active` highlighted row state.

### `static/sw.js` (modified)
- Add `/commands.js` to the **network-first** branch alongside `/app.js` and
  `/style.css` (so edits show on reload instead of serving a stale cached copy).
- Add `/commands.js` to the `SHELL` precache list.
- Bump the cache name `ping-shell-v7` → `ping-shell-v8` (matches the repo's
  established pattern of bumping the SW version when shell assets change).

## Data flow examples

- `/theme cyan` → `parseCommand` → `theme` command → `ctx.applyTheme("cyan")`
  (applies, persists, syncs swatches) → `ctx.systemLine("tema: cyan")`.
- `/who` (chat open, contact online) →
  `ctx.systemLine("Jo (@jo) — online")`.
- `/clear` (3 messages) → `ctx.clearChat()` returns 3 →
  `ctx.systemLine("rensade 3 meddelanden")`.
- `/last` (prior send "hej") → `ctx.setInput("hej"); ctx.focusInput()`.
- `/nope` → `ctx.systemLine("okänt kommando: /nope — skriv /help")`.
- `/ this is fine` → `parseCommand` returns null → sent as a normal text ping.

## Error handling

- **Unknown command** → system line nudging to `/help`.
- **Command needs a chat but none selected** (`/who`, `/clear`, `/last`) →
  system line: pick a contact first. Because `systemLine` renders in `#board`,
  and the board is hidden until a chat is open, these commands are effectively
  unreachable without a chat anyway; the guard is a belt-and-suspenders check.
- **`/last` with no prior sent text** → system line saying there's nothing to
  recall.
- **`/theme` / `/font` with missing or invalid value** → system line listing the
  valid values.

## Testing

The repo has **Python tests only** (`tests/`, pytest) and no JS test runner.
Per the non-goals, no JS framework is introduced. Verification:

1. `parseCommand` and `getCommandHints` are written as pure functions so they
   *could* be unit-tested and are easy to reason about.
2. Manual verification in the browser (`uvicorn server:app --reload`,
   <http://localhost:8000>): run each command, confirm system-line feedback,
   theme/font/mute side effects + picker sync, `/clear` removal, `/who` accuracy
   (online/offline), `/last` recall, hint-menu keyboard nav and completion,
   unknown-command handling, and that a literal `/ text` still sends.
3. Confirm `commands.js` loads (network tab) and the SW serves the fresh version
   after the v8 bump.

## Files touched

- `static/commands.js` — **new** module (registry, parser, hints, dispatch).
- `static/app.js` — system lines, `clearChat`, `lastSentText`, context builder,
  composer wiring, hint-menu handlers.
- `static/index.html` — hint-menu container, `<script>` for commands.js.
- `static/style.css` — `.item.system`, `#command-hints` styles.
- `static/sw.js` — precache + network-first + cache bump to v8.
