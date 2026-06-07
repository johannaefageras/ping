# Mini Terminal Command Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slash-command layer to the Ping message composer (`/theme`, `/font`, `/clear`, `/who`, `/last`, `/mute`, `/unmute`, `/shrug`, `/help`) with a hint menu and local-only "system line" feedback.

**Architecture:** A new plain-script module `static/commands.js` holds a command registry (single source of truth for dispatch, hint menu, and `/help`) plus pure `parseCommand`/`getCommandHints` functions. `app.js` wires it into the composer via a capability context object so commands never touch the DOM or Supabase directly; feedback renders as ephemeral, local-only `.item.system` lines in the chat board.

**Tech Stack:** Vanilla JS (no bundler, plain `<script>`), HTML, CSS, a service worker (`sw.js`). No backend, schema, or build changes. The repo has Python/pytest tests only and intentionally adds **no** JS test runner — JS tasks are verified manually in the browser.

---

## Important context for the implementer

Read these before starting. They are facts about this specific codebase that the tasks rely on:

- **No JS bundler / no ES modules.** `static/app.js` is a plain script. New code must be a plain script exposing a global (`window.PingCommands`), loaded **before** `app.js`.
- **Static serving:** `server.py` mounts `static/` at `/` (line ~199), so `static/commands.js` is served at `/commands.js`. `index.html` references `app.js` relatively as `app.js`.
- **Service worker (`static/sw.js`):** `/app.js` and `/style.css` are **network-first** (so edits show on reload); everything else is **cache-first**. The `SHELL` precache list and the `CACHE` constant (currently `"ping-shell-v7"`) must both be updated when shell assets change — the repo bumps the version each time (last bump: v7).
- **Themes** (from `index.html` swatches): `green` (default, no `data-theme` attr), `amber`, `cyan`, `pink`, `red`, `paper`, `purple`. Applied by `applyTheme(theme, swatches)` in `app.js` (~line 1567); persisted in `localStorage["ping-theme"]`.
- **Fonts** (from `index.html` font picker / `app.js` `applyFont`): `radon` (default, no `data-font` attr), `neon`, `argon`, `xenon`, `krypton`. Persisted in `localStorage["ping-font"]`.
- **Mute:** `localStorage["ping-muted"]` is `"1"`/`"0"`; `muteToggle` checkbox + `initMuteToggle()` (~line 1606). `playPing()` early-returns when muted.
- **State in app.js:** `currentUser` (`{id, username, display_name}`), `selectedContact` (`{contactId, recipientId, username, displayName}`), `contacts[]`, `onlineUserIds` (a `Set` of user ids).
- **Sending text:** `textForm` submit handler (~line 859) trims `textInput.value`, inserts a `pings` row, calls `renderPing(data)`, clears the input.
- **Dismiss:** `dismissPing(el, ping)` (~line 732) fades the element and calls the `dismiss_ping` RPC. The `ping` object is captured only in the dismiss-button click closure (`renderPing` ~line 832: `el.querySelector(".dismiss-btn").addEventListener("click", () => dismissPing(el, ping))`). It is **not** stored as an element property — so `/clear` triggers dismissal by clicking each `.dismiss-btn`.
- **Board:** `#board` holds `.item` elements. `loadPings()` (~line 709) sets `board.innerHTML = ""` then re-renders, so it naturally wipes local system lines on chat switch.
- **UI language is Swedish.** All user-facing strings must be Swedish.

There is no automated JS test harness, so every JS task ends with an explicit **manual verification** step (run the app, observe behavior) plus a commit. Run the app with:

```bash
source .venv/bin/activate && uvicorn server:app --reload
```

Then open <http://localhost:8000/app>, sign in, and select a contact. To force the service worker to pick up changes during testing: DevTools → Application → Service Workers → "Update on reload" (or Unregister + hard reload).

---

## File Structure

- **Create:** `static/commands.js` — command registry, `THEMES`, `FONTS`, `parseCommand`, `getCommandHints`, `runCommand`. The only file that knows the command set. Pure functions (`parseCommand`, `getCommandHints`) plus a thin dispatcher (`runCommand`) that calls capability functions on a passed-in `ctx`.
- **Modify:** `static/app.js` — add `lastSentText` state, `systemLine()`, `clearChat()`, `buildCommandContext()`, wire command dispatch into `textForm` submit, add hint-menu rendering + keyboard handlers.
- **Modify:** `static/index.html` — add `#command-hints` container in the composer footer; add `<script src="commands.js">` before `app.js`.
- **Modify:** `static/style.css` — `.item.system` and `#command-hints` styles.
- **Modify:** `static/sw.js` — add `/commands.js` to network-first branch + `SHELL`; bump `CACHE` to `ping-shell-v8`.

---

## Task 1: Create the command registry module skeleton

**Files:**
- Create: `static/commands.js`

This task builds `commands.js` with the registry, the valid-value lists, and the pure `parseCommand` / `getCommandHints` functions. `run` functions are filled in but only call `ctx` capabilities (defined in Task 2's context builder); since `ctx` is supplied later, this task is verified by checking the pure functions in the browser console.

- [ ] **Step 1: Write the full module**

Create `static/commands.js` with exactly this content:

```javascript
// Mini terminal command layer for Ping.
//
// Plain script (no bundler / no ES modules): everything is exposed on
// window.PingCommands. app.js loads this BEFORE itself and supplies a `ctx`
// capability object to runCommand so commands never touch the DOM or Supabase
// directly. parseCommand and getCommandHints are PURE (no side effects) and are
// the unit-testable core. All user-facing strings are Swedish.
(function () {
  "use strict";

  const THEMES = ["green", "amber", "cyan", "pink", "red", "paper", "purple"];
  const FONTS = ["radon", "neon", "argon", "xenon", "krypton"];

  // Registry: the single source of truth for dispatch, the hint menu, and /help.
  // Each command: { name, aliases?, arg?, summary, run(ctx, args) }.
  // `args` passed to run() is the raw argument string after the command word
  // (already trimmed), or "" when there is none.
  const COMMANDS = [
    {
      name: "help",
      aliases: ["?", "commands"],
      summary: "visa alla kommandon",
      run(ctx) {
        const lines = COMMANDS.map((c) => {
          const usage = "/" + c.name + (c.arg ? " <" + c.arg + ">" : "");
          return usage + " — " + c.summary;
        });
        ctx.systemLine(lines.join("\n"));
      },
    },
    {
      name: "theme",
      arg: "namn",
      summary: "byt färgtema (" + THEMES.join(", ") + ")",
      run(ctx, args) {
        const t = args.trim().toLowerCase();
        if (!THEMES.includes(t)) {
          ctx.systemLine("giltiga teman: " + THEMES.join(", "));
          return;
        }
        ctx.applyTheme(t);
        ctx.systemLine("tema: " + t);
      },
    },
    {
      name: "font",
      arg: "namn",
      summary: "byt typsnitt (" + FONTS.join(", ") + ")",
      run(ctx, args) {
        const f = args.trim().toLowerCase();
        if (!FONTS.includes(f)) {
          ctx.systemLine("giltiga typsnitt: " + FONTS.join(", "));
          return;
        }
        ctx.applyFont(f);
        ctx.systemLine("typsnitt: " + f);
      },
    },
    {
      name: "clear",
      summary: "rensa alla meddelanden i chatten",
      run(ctx) {
        if (!ctx.selectedContact) {
          ctx.systemLine("välj en kontakt först");
          return;
        }
        const n = ctx.clearChat();
        ctx.systemLine("rensade " + n + " meddelande" + (n === 1 ? "" : "n"));
      },
    },
    {
      name: "who",
      summary: "visa info om aktuell kontakt",
      run(ctx) {
        const c = ctx.selectedContact;
        if (!c) {
          ctx.systemLine("välj en kontakt först");
          return;
        }
        const name = c.displayName ? c.displayName + " (@" + c.username + ")" : "@" + c.username;
        const status = ctx.isOnline(c.recipientId) ? "online" : "offline";
        ctx.systemLine(name + " — " + status);
      },
    },
    {
      name: "last",
      summary: "återkalla ditt senaste meddelande",
      run(ctx) {
        if (!ctx.selectedContact) {
          ctx.systemLine("välj en kontakt först");
          return;
        }
        const last = ctx.getLastSent();
        if (!last) {
          ctx.systemLine("inget att återkalla");
          return;
        }
        ctx.setInput(last);
        ctx.focusInput();
      },
    },
    {
      name: "mute",
      summary: "stäng av ljud",
      run(ctx) {
        ctx.setMuted(true);
        ctx.systemLine("ljud av");
      },
    },
    {
      name: "unmute",
      summary: "slå på ljud",
      run(ctx) {
        ctx.setMuted(false);
        ctx.systemLine("ljud på");
      },
    },
    {
      name: "shrug",
      summary: "infoga ¯\\_(ツ)_/¯",
      run(ctx) {
        ctx.appendInput("¯\\_(ツ)_/¯");
        ctx.focusInput();
      },
    },
  ];

  // Look up a command by name or alias (case-insensitive). Returns the command
  // object or null.
  function findCommand(word) {
    const w = word.toLowerCase();
    return (
      COMMANDS.find((c) => c.name === w || (c.aliases && c.aliases.includes(w))) || null
    );
  }

  // PURE. Parse raw input into { name, args, command } if it is a recognised
  // command, else null (so literal slashes fall through to a normal send).
  // A leading "/" followed by a space, or "/" alone, or an unknown /word, all
  // return null EXCEPT unknown /word which we still want to intercept so we can
  // show "okänt kommando". So: return a result for any /word token; let
  // runCommand decide known vs unknown. "/ text" and "/" -> null (send as text).
  function parseCommand(raw) {
    if (typeof raw !== "string") return null;
    const m = raw.match(/^\/([a-z?]+)(?:\s+([\s\S]*))?$/i);
    if (!m) return null; // not "/word..." -> treat as normal text
    const name = m[1];
    const args = (m[2] || "").trim();
    return { name, args, command: findCommand(name) };
  }

  // PURE. Return registry entries matching the partial input for the hint menu.
  // Only active while the input starts with "/" and has no space yet.
  // Empty partial ("/") returns all commands. Returns [] when not applicable.
  function getCommandHints(raw) {
    if (typeof raw !== "string") return [];
    const m = raw.match(/^\/([a-z?]*)$/i);
    if (!m) return [];
    const partial = m[1].toLowerCase();
    if (partial === "") return COMMANDS.slice();
    return COMMANDS.filter(
      (c) =>
        c.name.startsWith(partial) ||
        (c.aliases && c.aliases.some((a) => a.startsWith(partial)))
    );
  }

  // Dispatch. Parses, runs the matched command, or emits an unknown-command
  // system line. No-op (returns false) if raw is not a command at all.
  function runCommand(raw, ctx) {
    const parsed = parseCommand(raw);
    if (!parsed) return false;
    if (!parsed.command) {
      ctx.systemLine("okänt kommando: /" + parsed.name + " — skriv /help");
      return true;
    }
    parsed.command.run(ctx, parsed.args);
    return true;
  }

  window.PingCommands = {
    COMMANDS,
    THEMES,
    FONTS,
    parseCommand,
    getCommandHints,
    runCommand,
  };
})();
```

- [ ] **Step 2: Temporarily load the module to test pure functions**

In `static/index.html`, add this line immediately before `<script src="app.js"></script>` (~line 682):

```html
    <script src="commands.js"></script>
```

(This `<script>` line is also required by Task 4 — leave it in place after this task.)

- [ ] **Step 3: Verify the pure functions in the browser console**

Run the app (`uvicorn server:app --reload`), open <http://localhost:8000/app>, open DevTools console, and run:

```javascript
PingCommands.parseCommand("/theme cyan");      // {name:"theme", args:"cyan", command:{...}}
PingCommands.parseCommand("/help");            // {name:"help", args:"", command:{...}}
PingCommands.parseCommand("/?");               // {name:"?", args:"", command:{name:"help",...}}
PingCommands.parseCommand("/ hello");          // null
PingCommands.parseCommand("/");                // null
PingCommands.parseCommand("just text");        // null
PingCommands.parseCommand("/nope");            // {name:"nope", args:"", command:null}
PingCommands.getCommandHints("/th").map(c=>c.name);   // ["theme"]
PingCommands.getCommandHints("/").length;             // 9
PingCommands.getCommandHints("/theme cyan");          // [] (has a space)
```

Expected: each line matches the comment. Confirm `parseCommand("/ hello")` and `parseCommand("/")` return `null` (so literal slashes still send), and `/nope` returns an object with `command: null` (so it can be intercepted as unknown).

- [ ] **Step 4: Commit**

```bash
git add -f static/commands.js static/index.html
git commit -m "feat: add command registry module and parser (commands.js)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add system lines, clearChat, lastSentText, and the context builder to app.js

**Files:**
- Modify: `static/app.js`

This adds the capability functions that `commands.js` calls through `ctx`. No command dispatch is wired into the composer yet (Task 3) — this task just defines and verifies the building blocks.

- [ ] **Step 1: Add `lastSentText` state**

In `static/app.js`, find the state declarations near the top (~line 70-72):

```javascript
let currentUser = null; // { id, username }
let selectedContact = null; // { contactId, recipientId, username }
let contacts = [];
```

Add below them:

```javascript
let lastSentText = null; // last text the user sent, for /last recall
```

- [ ] **Step 2: Record `lastSentText` on a successful text send**

In the `textForm` submit handler (~line 859-884), find the success tail:

```javascript
  renderPing(data);
  scrollToBottom();
  textInput.value = "";
});
```

Replace it with (adds the `lastSentText = text;` line):

```javascript
  renderPing(data);
  scrollToBottom();
  lastSentText = text;
  textInput.value = "";
});
```

- [ ] **Step 3: Add `systemLine`, `clearChat`, and `buildCommandContext`**

In `static/app.js`, add this block immediately above the `// --- Theme picker ---` comment (~line 1551). It references `applyTheme`/`applyFont` which are defined just below it in the file — that's fine because these functions are only *called* at runtime (after the file fully loads), not at definition time.

```javascript
// --- Terminal command layer ---

// Renders a local-only, ephemeral "system line" in the chat board. Never stored
// in the DB, never sent to the contact, not a real ping. Auto-fades. Used by
// command feedback (/who, /help, /theme, errors, ...). Multi-line text (\n) is
// preserved. Skipped by loadPings (board.innerHTML reset) and by clearChat.
function systemLine(text) {
  if (!board) return;
  const el = document.createElement("div");
  el.className = "item system";
  el.textContent = text; // textContent keeps it XSS-safe and preserves \n via CSS
  board.appendChild(el);
  scrollToBottom();
  el._sysTimer = setTimeout(() => {
    el.classList.add("fade-out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 8000);
}

// Dismisses every real ping in the current chat by triggering each rendered
// dismiss button (reuses dismissPing exactly: RPC, object-URL revocation,
// fade-out). Skips .system lines. Returns the count dismissed.
function clearChat() {
  const items = board.querySelectorAll(".item:not(.system)");
  let n = 0;
  items.forEach((el) => {
    const btn = el.querySelector(".dismiss-btn");
    if (btn) {
      btn.click();
      n++;
    }
  });
  return n;
}

// Wraps applyTheme + the picker UI so /theme keeps the settings panel in sync.
function setThemeFromCommand(theme) {
  const swatches = document.querySelectorAll("#theme-picker .swatch");
  localStorage.setItem("ping-theme", theme);
  applyTheme(theme, swatches);
}

// Wraps applyFont + the picker UI so /font keeps the settings panel in sync.
function setFontFromCommand(font) {
  const buttons = document.querySelectorAll("#font-picker .font-btn");
  localStorage.setItem("ping-font", font);
  applyFont(font, buttons);
}

// Wraps the mute toggle so /mute and /unmute keep the settings panel in sync.
function setMutedFromCommand(muted) {
  localStorage.setItem("ping-muted", muted ? "1" : "0");
  if (muteToggle) muteToggle.checked = muted;
}

// Assembles the capability object handed to commands. Commands call these
// instead of touching globals/DOM/Supabase directly.
function buildCommandContext() {
  return {
    selectedContact,
    isOnline: (id) => onlineUserIds.has(id),
    getLastSent: () => lastSentText,
    systemLine,
    clearChat,
    applyTheme: setThemeFromCommand,
    applyFont: setFontFromCommand,
    setMuted: setMutedFromCommand,
    setInput: (text) => {
      textInput.value = text;
    },
    appendInput: (text) => {
      textInput.value = textInput.value ? textInput.value + " " + text : text;
    },
    focusInput: () => textInput.focus(),
  };
}
```

- [ ] **Step 4: Verify the building blocks in the browser console**

Run the app, sign in, select a contact, then in the console:

```javascript
const ctx = buildCommandContext();
ctx.systemLine("hej\nvärlden");        // a dim "> hej / världen" line appears, fades after 8s
ctx.applyTheme("cyan");                // theme switches to cyan; swatch shows active
ctx.applyFont("neon");                 // font switches
ctx.setMuted(true);                    // mute toggle in settings becomes checked
ctx.setMuted(false);
ctx.isOnline(selectedContact.recipientId); // true/false matching the presence dot
```

Expected: the system line appears in the board and auto-fades; theme/font/mute changes are reflected in the settings panel; `isOnline` matches the contact's presence dot. (Styling is added in Task 5 — the line may look plain for now.)

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat: add system lines, clearChat, and command context to app.js" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire command dispatch into the composer

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Intercept commands in the `textForm` submit handler**

In `static/app.js`, find the start of the `textForm` submit handler (~line 859-863):

```javascript
textForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedContact) return;
  const text = textInput.value.trim();
  if (!text) return;
```

Replace it with (adds the command-dispatch branch after the empty-text guard):

```javascript
textForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;

  // Slash commands run locally and never become pings. parseCommand returns
  // null for plain text and for "/ text" / "/" so literal slashes still send.
  if (window.PingCommands && PingCommands.parseCommand(text)) {
    PingCommands.runCommand(text, buildCommandContext());
    textInput.value = "";
    hideCommandHints();
    return;
  }

  if (!selectedContact) return;
```

Note: the original `if (!selectedContact) return;` moved to *after* the command branch, so commands like `/help` and `/theme` work even before a contact is selected (those that need a contact guard themselves via `ctx.selectedContact`). The `hideCommandHints()` call is defined in Task 4 — it will exist by the time this code runs after Task 4 is complete; if executing Task 3 standalone, temporarily replace `hideCommandHints();` with `/* hints hidden in Task 4 */` and restore it in Task 4. (Recommended: do Tasks 3 and 4 back-to-back.)

- [ ] **Step 2: Verify command dispatch in the browser**

Run the app, sign in. **Before selecting a contact**, type `/help` in the message box and press Enter — but note the board is hidden without a chat. So: select a contact first, then test each command by typing into the input and pressing Enter:

| Type | Expected |
|---|---|
| `/help` | system line listing all 9 commands |
| `/theme cyan` | theme switches to cyan + `tema: cyan` line |
| `/theme bogus` | `giltiga teman: green, amber, ...` line |
| `/font neon` | font switches + `typsnitt: neon` line |
| `/who` | `@<contact> — online`/`offline` line |
| `/mute` then `/unmute` | mute toggle flips; `ljud av` / `ljud på` lines |
| `/shrug` | `¯\_(ツ)_/¯` appears in the input (not sent) |
| send "hello", then `/last` | input refills with "hello" |
| `/clear` (with messages present) | all messages fade; `rensade N meddelanden` line |
| `/nope` | `okänt kommando: /nope — skriv /help` line |
| `/ hi` (slash, space, text) | sent as a normal message "/ hi" |
| `hi /there` | sent as a normal message |

Expected: every row behaves as described. Confirm none of the command inputs create a real ping or get sent to the contact (open a second browser/session as the contact to be sure `/theme`, `/who`, etc. send nothing).

- [ ] **Step 3: Commit**

```bash
git add static/app.js
git commit -m "feat: dispatch slash commands from the composer" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Add the hint menu (markup + render + keyboard nav)

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`

- [ ] **Step 1: Add the hint-menu container to the composer**

In `static/index.html`, find the composer footer (~line 390):

```html
          <footer>
            <form id="text-form">
```

Insert the hint container between `<footer>` and `<form>`:

```html
          <footer>
            <div id="command-hints" class="hidden" role="listbox" aria-label="Kommandon"></div>
            <form id="text-form">
```

- [ ] **Step 2: Add hint-menu logic to app.js**

In `static/app.js`, add this block immediately after the `buildCommandContext()` function added in Task 2 (still above `// --- Theme picker ---`):

```javascript
// --- Command hint menu ---
const commandHints = document.getElementById("command-hints");
let hintItems = []; // current list of matched command objects
let hintIndex = -1; // highlighted row, -1 = none

function hideCommandHints() {
  hintItems = [];
  hintIndex = -1;
  if (commandHints) {
    commandHints.classList.add("hidden");
    commandHints.innerHTML = "";
  }
}

function renderCommandHints() {
  if (!commandHints) return;
  const raw = textInput.value;
  hintItems = window.PingCommands ? PingCommands.getCommandHints(raw) : [];
  if (hintItems.length === 0) {
    hideCommandHints();
    return;
  }
  hintIndex = 0;
  commandHints.innerHTML = "";
  hintItems.forEach((c, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "hint-row" + (i === 0 ? " active" : "");
    row.dataset.index = String(i);
    row.innerHTML =
      `<span class="hint-name">/${c.name}${c.arg ? " &lt;" + c.arg + "&gt;" : ""}</span>` +
      `<span class="hint-summary">${c.summary}</span>`;
    row.addEventListener("mousedown", (e) => {
      // mousedown (not click) so it fires before the input blurs.
      e.preventDefault();
      completeHint(i);
    });
    commandHints.appendChild(row);
  });
  commandHints.classList.remove("hidden");
}

function highlightHint(next) {
  if (hintItems.length === 0) return;
  hintIndex = (next + hintItems.length) % hintItems.length;
  commandHints.querySelectorAll(".hint-row").forEach((row, i) => {
    row.classList.toggle("active", i === hintIndex);
  });
}

// Completes the highlighted command into the input. Commands that take an arg
// get a trailing space (ready for the value); arg-less commands get no space.
function completeHint(i) {
  const c = hintItems[i];
  if (!c) return;
  textInput.value = "/" + c.name + (c.arg ? " " : "");
  hideCommandHints();
  textInput.focus();
}

textInput.addEventListener("input", renderCommandHints);

textInput.addEventListener("keydown", (e) => {
  if (commandHints.classList.contains("hidden") || hintItems.length === 0) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlightHint(hintIndex + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightHint(hintIndex - 1);
  } else if (e.key === "Tab") {
    e.preventDefault();
    completeHint(hintIndex);
  } else if (e.key === "Enter") {
    // Enter with the menu open completes instead of submitting.
    e.preventDefault();
    completeHint(hintIndex);
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideCommandHints();
  }
});
```

Note: this `keydown` listener is attached directly to `textInput`, so it runs before the `textForm` submit handler — when the menu is open, Enter is intercepted and the form does not submit. When the menu is hidden it falls through and the form submits normally.

- [ ] **Step 3: If you stubbed `hideCommandHints()` in Task 3, restore it**

Confirm the `textForm` submit handler (Task 3) calls `hideCommandHints();` (not a stub comment). It is now defined.

- [ ] **Step 4: Verify the hint menu in the browser**

Run the app, sign in, select a contact. In the message input:

| Action | Expected |
|---|---|
| Type `/` | menu shows all 9 commands, first highlighted |
| Type `/th` | menu narrows to `/theme <namn>` |
| `↓` / `↑` | highlight moves, wraps around |
| `Tab` on `/theme` | input becomes `/theme ` (trailing space), menu hides |
| `Enter` with menu open | completes (does NOT send) |
| `Esc` | menu closes, input text unchanged |
| Click a row | completes that command |
| Type `/help` then space | menu hides (has a space) |
| `Enter` with menu hidden | submits normally |

Expected: every row behaves as described. Especially confirm Enter completes (not submits) while the menu is open, and submits normally when it's closed.

- [ ] **Step 5: Commit**

```bash
git add -f static/index.html static/app.js
git commit -m "feat: add slash-command hint menu with keyboard navigation" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Style the system lines and hint menu

**Files:**
- Modify: `static/style.css`

The exact selectors must match what Tasks 2 and 4 produce: `.item.system`, `#command-hints`, `.hint-row`, `.hint-row.active`, `.hint-name`, `.hint-summary`. The retro/terminal look uses the theme accent via the existing `--accent` custom property (confirm the variable name in `style.css` before writing — grep for `--accent` or the color used by `.item`; adjust the variable name in the snippet to match what the file actually uses).

- [ ] **Step 1: Confirm the accent variable name**

Run:

```bash
grep -nE "color:|--accent|--fg|--accent-|var\(--" static/style.css | grep -i accent | head
```

Use whatever accent custom property the file defines (commonly `--accent`). If it differs, substitute it in Step 2.

- [ ] **Step 2: Add the styles**

Append to `static/style.css` (replace `var(--accent)` if Step 1 found a different name):

```css
/* --- Terminal command layer --- */

/* Local-only system lines: terminal-styled, no bubble, dim, monospace. */
.item.system {
  align-self: flex-start;
  max-width: 100%;
  padding: 0.15rem 0;
  background: none;
  border: none;
  color: var(--accent);
  opacity: 0.75;
  font-family: inherit;
  font-size: 0.85em;
  white-space: pre-wrap; /* preserve \n in /help and multi-line lines */
  word-break: break-word;
}
.item.system::before {
  content: "> ";
  opacity: 0.6;
}

/* Hint menu floating above the input. */
#command-hints {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 0.4rem;
  background: var(--bg, #0a0a0a);
  border: 1px solid var(--accent);
  border-radius: 4px;
  overflow: hidden;
  z-index: 20;
  max-height: 40vh;
  overflow-y: auto;
}
#command-hints.hidden {
  display: none;
}
.hint-row {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  width: 100%;
  padding: 0.4rem 0.6rem;
  background: none;
  border: none;
  color: inherit;
  font-family: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
.hint-row.active,
.hint-row:hover {
  background: var(--accent);
  color: var(--bg, #0a0a0a);
}
.hint-name {
  flex: 0 0 auto;
  font-weight: bold;
}
.hint-summary {
  flex: 1 1 auto;
  opacity: 0.7;
}
```

- [ ] **Step 3: Make the footer a positioning context for the menu**

The hint menu uses `position: absolute; bottom: 100%`, so its nearest positioned ancestor must be the composer footer. Find the footer's CSS rule. Run:

```bash
grep -nE "footer|#text-form" static/style.css | head
```

If the `footer` (within the chat view) does not already have `position: relative`, add it. If a `footer` rule exists, add `position: relative;` to it. If not, append:

```css
#chat-view footer {
  position: relative;
}
```

(Verify the chat footer's actual selector from the grep output and use that; the composer footer is inside `#chat-view`.)

- [ ] **Step 4: Verify styling in the browser**

Run the app, sign in, select a contact. Confirm:
- `/help` produces a dim, `> `-prefixed, multi-line accent-colored block.
- Typing `/` shows the menu as a bordered box directly above the input (not clipped, not mis-positioned), with the active row inverted (accent background).
- Switch themes (`/theme amber`, `/theme paper`) and confirm system lines and the hint menu pick up the new accent color, and remain readable on the `paper` (light) theme.

Expected: legible and on-theme across `green`, `amber`, `paper`. If `paper` (light bg) makes the menu unreadable, confirm `var(--bg)` resolves correctly on that theme; adjust the fallback if needed.

- [ ] **Step 5: Commit**

```bash
git add static/style.css
git commit -m "style: terminal system lines and command hint menu" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Register commands.js in the service worker

**Files:**
- Modify: `static/sw.js`

- [ ] **Step 1: Bump the cache version**

In `static/sw.js`, change the first line:

```javascript
const CACHE = "ping-shell-v7";
```

to:

```javascript
const CACHE = "ping-shell-v8";
```

- [ ] **Step 2: Add `/commands.js` to the precache SHELL**

In the `SHELL` array, find:

```javascript
  "/app.js",
```

Add `/commands.js` right after it:

```javascript
  "/app.js",
  "/commands.js",
```

- [ ] **Step 3: Add `/commands.js` to the network-first branch**

Find the network-first guard (~line "Network-first for code/styles"):

```javascript
  if (url.pathname === "/style.css" || url.pathname === "/app.js") {
```

Replace with:

```javascript
  if (
    url.pathname === "/style.css" ||
    url.pathname === "/app.js" ||
    url.pathname === "/commands.js"
  ) {
```

- [ ] **Step 4: Verify the service worker update**

Run the app. In DevTools → Application → Service Workers, click "Update", then reload. Confirm:
- The active SW cache is `ping-shell-v8` (Application → Cache Storage shows `ping-shell-v8`, and the old `ping-shell-v7` is gone after activation).
- `/commands.js` appears in the `ping-shell-v8` cache entries.
- With the network throttled to **Offline** (DevTools → Network → Offline) and a reload, the app still loads and commands still work (proves `commands.js` is precached/served from cache offline).

Expected: cache is v8, contains `/commands.js`, and commands function offline.

- [ ] **Step 5: Commit**

```bash
git add static/sw.js
git commit -m "chore: precache commands.js and bump SW cache to v8" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full end-to-end verification and README update

**Files:**
- Modify: `README.md` (Features list)

- [ ] **Step 1: Run the full command suite end-to-end**

Run the app, sign in as user A in one browser and user B (the contact) in another. As user A, with the chat open, exercise the full matrix from Task 3 Step 2 and Task 4 Step 4 in one sitting. Critically confirm, watching user B's screen: **no command produces a message, ping sound, or any visible change for user B** (commands are entirely local). Confirm `/clear` removes user A's copies (per-side dismiss) — verify user B's copies behave per the existing dismiss rules.

- [ ] **Step 2: Confirm the existing Python tests still pass**

The change is frontend-only, but run the suite to be sure nothing regressed:

```bash
source .venv/bin/activate && pytest -q
```

Expected: all tests pass (same as before the change).

- [ ] **Step 3: Add a Features bullet to the README**

In `README.md`, in the `## Features` list, add a bullet after the "Send text messages, links, and files…" line:

```markdown
- Slash commands in the composer: `/help`, `/theme`, `/font`, `/clear`,
  `/who`, `/last`, `/mute`, `/unmute`, `/shrug`, with a `/` hint menu
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document slash commands in README" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final review of the working tree**

```bash
git status
git log --oneline -8
```

Expected: clean working tree; the feature is implemented across the seven tasks' commits.

---

## Notes on TDD in this codebase

This plan does not use red/green automated tests because the repo has **no JS test runner** and the design spec explicitly rules out adding one (scope creep). The pure functions in `commands.js` (`parseCommand`, `getCommandHints`) are written side-effect-free specifically so they *could* be unit-tested later and are easy to verify by hand in the console (Task 1, Step 3). Every JS task substitutes an explicit, scripted **manual verification** step in place of an automated test, with exact inputs and expected outputs. If a JS test runner is added to this project in the future, the console checks in Task 1 Step 3 translate directly into unit tests.
