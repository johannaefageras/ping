# Auth Screen Terminal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the four auth states (login / signup / forgot / reset) so they live inside a framed "terminal window" with a theme-aware title bar, a static boot/greeting line, and the existing tab toggle restyled as a bracketed command switcher — all driven by existing CSS variables.

**Architecture:** Pure front-end. Restructure the `#auth-box` markup in `index.html`, replace the auth CSS block in `style.css`, and add one small `setAuthState()` helper in `app.js` wired into the four existing transition points. No auth logic, Supabase calls, validation, or copy semantics change. All existing IDs and the `#auth-tabs .tab[data-tab]` structure are preserved so `app.js`'s existing handlers keep working.

**Tech Stack:** Static HTML/CSS/vanilla JS. No build step, no framework, no test runner. Verification is manual in the browser (the app is served from `static/`).

**Reference:** Design spec at `docs/superpowers/specs/2026-06-06-auth-terminal-redesign-design.md`. Approved mockup: `.superpowers/brainstorm/91732-1780759609/content/terminal-refined.html`.

---

## How to run / verify (read once before starting)

There is **no test framework**. Every "verify" step means: serve `static/` and look in a browser.

- **Serve:** from the repo root run `python3 -m http.server 8000 --directory static` (or the project's normal dev server if one is running). Open `http://localhost:8000/index.html`.
- **Force the auth screen visible:** `app.js` keeps `#auth-screen` hidden until it decides you're logged out. For pure visual checks without Supabase, temporarily reveal it from the browser devtools console:
  ```js
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  ```
  (Do NOT commit any code change for this — it's a console-only aid.)
- **Switch forms for visual checks** (console): show signup/forgot/reset by toggling `.hidden` on `#signup-form` / `#forgot-form` / `#reset-form` and (for forgot/reset) `#auth-tabs`, exactly as the app does. After Task 5 the `setAuthState()` calls do this automatically when you click.
- **Themes:** `document.documentElement.setAttribute('data-theme','amber')` (also: `cyan`, `pink`, `red`, `paper`, `purple`; remove the attribute for default green).
- **Reduced motion:** in Chrome devtools → Rendering panel → "Emulate CSS prefers-reduced-motion: reduce".

Commit after each task.

---

## File Structure

- `static/index.html` — auth markup only (lines 31–132, the `#auth-screen` block). Restructured into a terminal window: title bar + body. Removes the `<h1>` wordmark and the two `<p>` description elements; wraps each input in a prefix wrapper.
- `static/style.css` — replaces the auth block (≈165–345) and the auth portion of the mobile media query (≈1089–1103).
- `static/app.js` — adds a `AUTH_STATES` lookup object + `setAuthState(state)` helper near the AUTH section (after line 148), and calls it from 4 existing points (tab click ~127, forgot-link ~230, forgot-back ~241, `showResetPasswordScreen` ~298). No existing logic removed.

Order: markup → CSS → JS wiring. Each task leaves the screen in a working (if progressively better-looking) state.

---

## Task 1: Restructure the auth markup into a terminal window

**Files:**
- Modify: `static/index.html:31-132` (the `#auth-screen` block)

**What changes:** Wrap `#auth-box` contents in a title bar + body. Add `#auth-titlebar` (3 dots + `#auth-path`), `#auth-boot` (boot line), keep `#auth-tabs` and all four forms and `#auth-error` inside `#auth-body`. Remove the `<h1>` wordmark (line 33) and the `#forgot-description`/`#reset-description` `<p>`s (lines 59-61, 76). Wrap each text/email/password input in `<div class="field-row"><span class="field-prefix" aria-hidden="true">&gt;</span> …input… </div>`. Keep ALL existing IDs, `data-tab`, `autocomplete`, `required`, `pattern`, `minlength`, placeholders, and the inline SVG icons in buttons/links.

- [ ] **Step 1: Replace the `#auth-screen` block**

Replace lines 31–132 of `static/index.html` (from `<div id="auth-screen" class="hidden">` through its closing `</div>` before `<!-- Main app -->`, including `#auth-footer`) with:

```html
    <!-- Auth screen: login / signup / forgot / reset (terminal window) -->
    <div id="auth-screen" class="hidden">
      <div id="auth-box" role="group" aria-label="Inloggning">
        <div id="auth-titlebar">
          <span class="auth-dots" aria-hidden="true">
            <span class="auth-dot"></span>
            <span class="auth-dot"></span>
            <span class="auth-dot"></span>
          </span>
          <span id="auth-titletext" aria-hidden="true">ping@web: <span id="auth-path">~/login</span></span>
        </div>

        <div id="auth-body">
          <p id="auth-boot" aria-hidden="true">
            <span class="boot-cmd">$ ping --auth</span><br />
            <span class="boot-status">&check; ansluten.</span>
            <span class="boot-greeting">v&auml;lkommen tillbaka.</span>
          </p>

          <div id="auth-tabs">
            <button class="tab active" data-tab="login">logga in</button>
            <button class="tab" data-tab="signup">skapa konto</button>
          </div>

          <form id="login-form">
            <div class="field-row">
              <span class="field-prefix" aria-hidden="true">&gt;</span>
              <input type="email" id="login-email" placeholder="E-post..." autocomplete="email" required />
            </div>
            <div class="field-row">
              <span class="field-prefix" aria-hidden="true">&gt;</span>
              <input type="password" id="login-password" placeholder="L&ouml;senord..." autocomplete="current-password" required />
            </div>
            <button type="submit"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg> LOGGA IN</button>
            <a href="#" id="forgot-link">gl&ouml;mt l&ouml;senordet?</a>
          </form>

          <form id="forgot-form" class="hidden">
            <div class="field-row">
              <span class="field-prefix" aria-hidden="true">&gt;</span>
              <input type="email" id="forgot-email" placeholder="E-post..." autocomplete="email" required />
            </div>
            <button type="submit"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg> SKICKA L&Auml;NK</button>
            <a href="#" id="forgot-back-link"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg> tillbaka till inloggning</a>
          </form>

          <form id="reset-form" class="hidden">
            <div class="field-row">
              <span class="field-prefix" aria-hidden="true">&gt;</span>
              <input type="password" id="reset-password" placeholder="Nytt l&ouml;senord (minst 6 tecken)..." autocomplete="new-password" required minlength="6" />
            </div>
            <div class="field-row">
              <span class="field-prefix" aria-hidden="true">&gt;</span>
              <input type="password" id="reset-password-confirm" placeholder="Bekr&auml;fta l&ouml;senord..." autocomplete="new-password" required minlength="6" />
            </div>
            <button type="submit"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> SPARA L&Ouml;SENORD</button>
          </form>

          <form id="signup-form" class="hidden">
            <div class="field-row">
              <span class="field-prefix" aria-hidden="true">&gt;</span>
              <input type="email" id="signup-email" placeholder="E-post..." autocomplete="email" required />
            </div>
            <div class="field-row">
              <span class="field-prefix" aria-hidden="true">&gt;</span>
              <input type="text" id="signup-username" placeholder="Anv&auml;ndarnamn..." autocomplete="username" required pattern="[a-zA-Z0-9_]{3,20}" title="3&ndash;20 tecken: bokst&auml;ver, siffror, understreck" />
            </div>
            <div class="field-row">
              <span class="field-prefix" aria-hidden="true">&gt;</span>
              <input type="password" id="signup-password" placeholder="L&ouml;senord (minst 6 tecken)..." autocomplete="new-password" required minlength="6" />
            </div>
            <button type="submit"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg> SKAPA KONTO</button>
          </form>

          <div id="auth-error" class="hidden"></div>
        </div>
      </div>

      <footer id="auth-footer">
        <a href="/privacy">Integritetspolicy</a>
        <span aria-hidden="true">&middot;</span>
        <a href="/terms">Anv&auml;ndarvillkor</a>
      </footer>
    </div>
```

Note: form order is login, forgot, reset, signup — matching the original DOM order so nothing else shifts. The `>` prefix spans are `aria-hidden`; inputs keep their own placeholders for screen readers.

- [ ] **Step 2: Verify markup is intact (no styling yet)**

Serve `static/` and open `index.html`. Reveal the auth screen via the console snippet in "How to run / verify". Expected: all four forms still present (unstyled/ugly is fine), the `$ ping --auth` boot text visible, the `ping@web: ~/login` title text visible, three empty dot spans, tabs read "logga in" / "skapa konto". Confirm in devtools that `#login-email`, `#signup-username`, `#forgot-email`, `#reset-password`, `#auth-tabs .tab[data-tab]`, `#forgot-link`, `#forgot-back-link`, `#auth-error` all still exist.

- [ ] **Step 3: Smoke-test that existing JS still binds**

With the page served, in console run:
```js
document.querySelectorAll('#auth-tabs .tab').length
```
Expected: `2`. Then click the "skapa konto" tab in the UI. Expected: signup form shows, login hides (existing app.js:124-133 handler still works against the preserved structure). No console errors.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "Restructure auth markup into terminal-window layout"
```

---

## Task 2: Frame + title bar + boot line styles

**Files:**
- Modify: `static/style.css` — replace the auth block starting at `/* --- Auth Screen --- */` (line 165) through the end of the `#auth-footer a:hover` rule (line 345).

This task replaces the whole desktop auth CSS block in one edit (the rules are interdependent — the old `#auth-box`, `#auth-tabs`, form, input, button, link, error, footer rules all get superseded). Mobile media query is handled in Task 4.

- [ ] **Step 1: Replace the auth CSS block (lines 165–345)**

Replace from `/* --- Auth Screen --- */` (line 165) through line 345 with:

```css
/* --- Auth Screen (terminal window) --- */

#auth-screen {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  /* warm halo behind the window, tinted by the active theme */
  background: radial-gradient(
    130% 100% at 50% -10%,
    var(--self-bg) 0%,
    var(--bg) 62%
  );
}

#auth-box {
  width: 300px;
  max-width: calc(100vw - 32px);
  text-align: left;
}

/* title bar */
#auth-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #0e0e0e;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 9px 9px 0 0;
  padding: 9px 13px;
}

.auth-dots {
  display: flex;
  gap: 6px;
}

.auth-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--fg-dim);
}

.auth-dot:nth-child(1) {
  opacity: 0.55;
}
.auth-dot:nth-child(2) {
  opacity: 0.8;
}
.auth-dot:nth-child(3) {
  background: var(--fg);
}

#auth-titletext {
  font-size: 0.66rem;
  color: #5a5a5a;
  letter-spacing: 0.5px;
}

#auth-path {
  color: var(--fg-dim);
}

/* body */
#auth-body {
  background: #080808;
  border: 1px solid var(--border);
  border-radius: 0 0 9px 9px;
  padding: 18px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* boot / greeting line */
#auth-boot {
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--fg-dim);
}

#auth-boot .boot-cmd,
#auth-boot .boot-status {
  color: var(--fg);
}

#auth-boot .boot-greeting {
  color: #555;
}
```

- [ ] **Step 2: Verify the window frame renders**

Serve, reveal auth screen. Expected: a 300px window with a dark title bar (3 dots — two dim-green at reduced opacity, one full-green), `ping@web:` in gray with `~/login` in dim green, a darker body below with rounded bottom corners, and the boot line showing `$ ping --auth` + `✓ ansluten.` in green and `välkommen tillbaka.` in gray. A faint green halo sits behind the window. Forms below are still unstyled — expected, that's Task 3.

- [ ] **Step 3: Verify theme tracking on the frame**

Console: `document.documentElement.setAttribute('data-theme','amber')`. Expected: dots, `~/login`, and `✓ ansluten.` turn amber; halo warms toward amber. Repeat with `cyan` and `purple`. Remove attribute → back to green.

- [ ] **Step 4: Commit**

```bash
git add static/style.css
git commit -m "Style auth terminal window frame, title bar, and boot line"
```

---

## Task 3: Command switcher, fields, button, and links

**Files:**
- Modify: `static/style.css` — append the remaining auth rules immediately after the `#auth-boot .boot-greeting` rule added in Task 2.

- [ ] **Step 1: Append the form-element styles**

Add directly after the `#auth-boot .boot-greeting { … }` rule:

```css
/* command switcher (restyled #auth-tabs) */
#auth-tabs {
  display: flex;
  gap: 8px;
}

#auth-tabs .tab {
  background: none;
  border: none;
  color: #555;
  font-family: inherit;
  font-size: 0.72rem;
  cursor: pointer;
  padding: 2px 0;
  transition: color 0.15s;
}

/* bracket the labels: [ logga in ] */
#auth-tabs .tab::before {
  content: "[ ";
  color: #333;
}
#auth-tabs .tab::after {
  content: " ]";
  color: #333;
}

#auth-tabs .tab.active {
  color: var(--fg);
}
#auth-tabs .tab.active::before,
#auth-tabs .tab.active::after {
  color: var(--fg-dim);
}

#auth-tabs .tab:hover:not(.active) {
  color: var(--fg-dim);
}

#auth-tabs .tab:focus-visible {
  outline: 1px solid var(--fg-dim);
  outline-offset: 2px;
}

/* forms */
#login-form,
#signup-form,
#forgot-form,
#reset-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* field row: > prefix + input */
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #101010;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 12px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.field-row .field-prefix {
  color: var(--fg-dim);
  font-size: 0.85rem;
}

.field-row input {
  flex: 1;
  background: none;
  border: none;
  color: var(--fg);
  padding: 11px 0;
  font-family: inherit;
  font-size: 0.85rem;
  outline: none;
}

.field-row input::placeholder {
  color: #383838;
}

/* focus moves to the wrapper via :focus-within */
.field-row:focus-within {
  border-color: var(--fg-dim);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg) 10%, transparent);
}

/* submit buttons */
#login-form button[type="submit"],
#signup-form button[type="submit"],
#forgot-form button[type="submit"],
#reset-form button[type="submit"] {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--fg-dim);
  color: var(--bg);
  border: none;
  padding: 11px 18px;
  font-family: inherit;
  font-weight: 550;
  font-size: 0.78rem;
  letter-spacing: 1px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

#login-form button[type="submit"]:hover,
#signup-form button[type="submit"]:hover,
#forgot-form button[type="submit"]:hover,
#reset-form button[type="submit"]:hover {
  background: var(--fg);
}

/* sub-links */
#forgot-link,
#forgot-back-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-dim);
  font-size: 0.7rem;
  text-decoration: none;
  transition: color 0.15s;
  margin-top: 2px;
}

#forgot-link:hover,
#forgot-back-link:hover {
  color: var(--fg);
}

/* error / success */
#auth-error {
  color: #ff5555;
  font-size: 0.78rem;
  line-height: 1.4;
}

#auth-error.success {
  color: var(--fg);
}

/* footer (pinned bottom) */
#auth-footer {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #2a2a2a;
}

#auth-footer a {
  color: #444;
  text-decoration: none;
  transition: color 0.15s;
}

#auth-footer a:hover {
  color: var(--fg-dim);
}
```

- [ ] **Step 2: Verify the full login screen**

Serve, reveal auth screen. Expected: `[ logga in ]` in green with dim-green brackets, `[ skapa konto ]` in gray; two `>`-prefixed fields; a dim-green "LOGGA IN" button with a trailing arrow icon that brightens on hover; "glömt lösenordet?" link in dim green; footer pinned at bottom. Click a field → wrapper border turns dim-green with a soft green glow.

- [ ] **Step 3: Verify the other three states visually**

In console, show each form in turn (toggle `.hidden`; for forgot/reset also hide `#auth-tabs`):
- signup → 3 `>`-fields, "SKAPA KONTO" button.
- forgot → 1 field, "SKICKA LÄNK", "tillbaka till inloggning" link with back-arrow icon. Switcher hidden.
- reset → 2 password fields, "SPARA LÖSENORD". Switcher hidden.

Then trigger an error to confirm `#auth-error` shows red, and set `#auth-error.classList.add('success')` to confirm it turns the theme green.

- [ ] **Step 4: Verify `color-mix` focus glow tracks theme**

Set `data-theme='pink'`, focus a field. Expected: glow is pink-tinted, not green. (If testing in a browser without `color-mix` support, the glow simply won't show — border still highlights; acceptable per spec.)

- [ ] **Step 5: Commit**

```bash
git add static/style.css
git commit -m "Style auth command switcher, fields, buttons, links, footer"
```

---

## Task 4: Mobile + reduced-motion + cursor blink

**Files:**
- Modify: `static/style.css:1089-1103` (auth part of the mobile media query)
- Modify: `static/style.css` — add a blinking cursor on the focused field's prefix and a `prefers-reduced-motion` guard (place near the auth block).

- [ ] **Step 1: Replace the mobile auth rules (lines 1089–1103)**

Replace the block:
```css
  #login-form,
  #signup-form,
  #forgot-form,
  #reset-form {
    width: 100%;
    padding: 0 20px;
  }

  #login-form input,
  #signup-form input,
  #forgot-form input,
  #reset-form input {
    font-size: 16px;
  }
```
with:
```css
  #auth-box {
    width: 100%;
    max-width: 360px;
    padding: 0 16px;
  }

  .field-row input {
    font-size: 16px; /* prevents iOS zoom-on-focus */
  }
```

- [ ] **Step 2: Add the blinking cursor + reduced-motion guard**

Add immediately after the `#auth-footer a:hover` rule (end of the Task 3 additions):

```css
/* blinking cursor on the focused field's prefix */
.field-row:focus-within .field-prefix {
  animation: auth-blink 1.1s steps(1) infinite;
}

@keyframes auth-blink {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .field-row:focus-within .field-prefix {
    animation: none;
  }
}
```

- [ ] **Step 3: Verify mobile**

In devtools, set viewport to 375px wide. Expected: window fills width up to 360px with 16px side padding, no horizontal scroll. Tap a field on a real iOS device or the emulator — the input font is 16px so the page does not zoom.

- [ ] **Step 4: Verify cursor blink + reduced motion**

Focus a field → the `>` prefix blinks. Enable "Emulate prefers-reduced-motion: reduce" → blinking stops, prefix stays solid.

- [ ] **Step 5: Commit**

```bash
git add static/style.css
git commit -m "Add mobile auth layout, blinking field cursor, reduced-motion guard"
```

---

## Task 5: Wire per-state title path + boot line in app.js

**Files:**
- Modify: `static/app.js` — add `AUTH_STATES` + `setAuthState()` after `hideAuthError()` (after line 148); call it from the tab handler (~127), `forgot-link` handler (~230), `forgot-back-link` handler (~241), and `showResetPasswordScreen()` (~298).

The DOM-ref block (app.js:5-22) does not need new constants — `setAuthState` looks up `#auth-path` / `#auth-boot` directly (they're set-once-per-transition, not hot paths).

- [ ] **Step 1: Add the state lookup + helper**

Insert after the `hideAuthError()` function (after app.js:148):

```js
// Per-state terminal chrome: title path + boot/greeting line.
// Updates #auth-path and #auth-boot to match the visible form.
const AUTH_STATES = {
  login: {
    path: "~/login",
    cmd: "$ ping --auth",
    status: "&check; ansluten.",
    greeting: "välkommen tillbaka.",
  },
  signup: {
    path: "~/signup",
    cmd: "$ ping --auth",
    status: "&check; ansluten.",
    greeting: "skapa ett konto för att börja pinga.",
  },
  forgot: {
    path: "~/recover",
    cmd: "$ ping --recover",
    status: "",
    greeting: "ange din e-post så skickar vi en återställningslänk.",
  },
  reset: {
    path: "~/reset",
    cmd: "$ ping --reset",
    status: "",
    greeting: "välj ett nytt lösenord.",
  },
};

function setAuthState(state) {
  const s = AUTH_STATES[state];
  if (!s) return;
  const pathEl = document.getElementById("auth-path");
  const bootEl = document.getElementById("auth-boot");
  if (pathEl) pathEl.textContent = s.path;
  if (bootEl) {
    const statusHtml = s.status
      ? `<span class="boot-status">${s.status}</span> `
      : "";
    bootEl.innerHTML =
      `<span class="boot-cmd">${s.cmd}</span><br />` +
      statusHtml +
      `<span class="boot-greeting">${s.greeting}</span>`;
  }
}
```

Note: `status`/`greeting` contain HTML entities (`&check;`, `ä` etc.) and are injected via `innerHTML`. This is a fixed, developer-authored lookup with no user input, so it is safe — do not switch to `textContent` (it would print the literal `&check;`).

- [ ] **Step 2: Call `setAuthState('login'|'signup')` from the tab handler**

In the `authTabs.forEach` click handler (app.js:124-133), after `signupForm.classList.toggle(...)` and before/after `hideAuthError()`, add a call keyed off `target`:

```js
authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    authTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    loginForm.classList.toggle("hidden", target !== "login");
    signupForm.classList.toggle("hidden", target !== "signup");
    setAuthState(target);
    hideAuthError();
  });
});
```

- [ ] **Step 3: Call `setAuthState('forgot')` / `setAuthState('login')` in the forgot links**

In `forgotLink` handler (app.js:224-231) add `setAuthState("forgot");` after revealing `forgotForm`:

```js
forgotLink.addEventListener("click", (e) => {
  e.preventDefault();
  hideAuthError();
  loginForm.classList.add("hidden");
  signupForm.classList.add("hidden");
  forgotForm.classList.remove("hidden");
  document.getElementById("auth-tabs").classList.add("hidden");
  setAuthState("forgot");
});
```

In `forgotBackLink` handler (app.js:233-242) add `setAuthState("login");` at the end:

```js
forgotBackLink.addEventListener("click", (e) => {
  e.preventDefault();
  hideAuthError();
  forgotForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
  document.getElementById("auth-tabs").classList.remove("hidden");
  authTabs.forEach((t) => t.classList.remove("active"));
  authTabs[0].classList.add("active");
  setAuthState("login");
});
```

- [ ] **Step 4: Call `setAuthState('reset')` in `showResetPasswordScreen`**

In `showResetPasswordScreen()` (starts app.js:292), after `resetForm.classList.remove("hidden")` and the `#auth-tabs` hide, add `setAuthState("reset");`:

```js
function showResetPasswordScreen() {
  authScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
  loginForm.classList.add("hidden");
  signupForm.classList.add("hidden");
  forgotForm.classList.add("hidden");
  resetForm.classList.remove("hidden");
  document.getElementById("auth-tabs").classList.add("hidden");
  setAuthState("reset");
}
```
(Match the exact closing of the existing function; only the `setAuthState("reset");` line is added before the final `}`.)

- [ ] **Step 5: Verify full interactive flow (no console toggling)**

Serve, reveal auth screen. Then drive it by clicking only:
1. Start on login → title `~/login`, greeting `✓ ansluten. välkommen tillbaka.`
2. Click `[ skapa konto ]` → title `~/signup`, greeting `✓ ansluten. skapa ett konto för att börja pinga.`, 3 fields. Click `[ logga in ]` → back to login state.
3. Click `glömt lösenordet?` → title `~/recover`, boot `$ ping --recover` with the recover greeting, switcher hidden, single email field.
4. Click `tillbaka till inloggning` → returns to login state, switcher visible, login tab active.
5. In console run `showResetPasswordScreen()` → title `~/reset`, `$ ping --reset`, two password fields.

Expected: no console errors; `✓` renders as a checkmark (not literal `&check;`); Swedish characters render correctly.

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "Wire per-state title path and boot line into auth transitions"
```

---

## Task 6: Final cross-cutting verification

**Files:** none (verification only).

- [ ] **Step 1: All states × all themes**

For each theme (default green, amber, cyan, pink, red, paper, purple via `data-theme`), eyeball login + one other state. Expected: dots, `~/path`, `✓`, active switcher, focus glow, button all track the theme. `paper` (light gray fg) should still be legible against the dark frame.

- [ ] **Step 2: Keyboard + a11y pass**

Tab from page load: focus should reach the switcher buttons (with visible outline), each field, the submit button, and the sub-link, in order. Enter on a focused form submits it. Confirm `aria-hidden` is on the dots, title text, boot line, and `>` prefixes, and that inputs still expose their placeholders/labels to the accessibility tree (check devtools Accessibility panel).

- [ ] **Step 3: Real auth smoke test (if Supabase env is available)**

If a working Supabase config is present: attempt a bad login → red error in `#auth-error`. Attempt signup with a taken username → existing error copy. Confirm the redesign didn't break the real flows (this exercises the unchanged logic paths).

- [ ] **Step 4: Regression check — landing/privacy/terms unaffected**

Open `/landing.html`, `/privacy.html`, `/terms.html`. Expected: unchanged (they use their own `<style>` blocks / shared `:root` vars we didn't touch). Confirm no auth selectors leaked into them.

- [ ] **Step 5: Final commit (only if any tweak was needed)**

```bash
git add -A
git commit -m "Polish auth terminal redesign after cross-cutting verification"
```
(Skip if nothing changed in this task.)

---

## Self-review notes (author)

- **Spec coverage:** terminal frame (T2), theme-aware dots (T2), boot/greeting per state (T1 markup + T5 JS), prompt-command switching as obvious clickable toggle (T1 buttons + T3 bracket styling + T5 wiring), `>` field prefix (T1+T3), theme-aware focus glow via color-mix (T3, open-q #2 default chosen), removed `<h1>` + description `<p>`s (T1), footer pinned (T3), mobile 16px + full width (T4), reduced-motion (T4), static boot line / blink-only motion (T4 cursor, no boot animation). All spec sections map to a task.
- **Preserved-IDs constraint:** every ID and `data-tab` from the spec's constraints list is retained in T1's markup; `app.js` DOM refs (lines 5-22) all still resolve.
- **Type/name consistency:** class names `boot-cmd`/`boot-status`/`boot-greeting`, `field-row`/`field-prefix`, `auth-dot(s)`, ids `auth-path`/`auth-boot`/`auth-titlebar`/`auth-body` are used identically across markup (T1), CSS (T2/T3/T4), and JS (T5). `setAuthState` signature and `AUTH_STATES` keys (`login`/`signup`/`forgot`/`reset`) match the four call sites.
