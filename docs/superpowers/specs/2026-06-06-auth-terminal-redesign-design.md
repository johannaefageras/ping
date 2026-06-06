# Auth screen redesign — "terminal window"

**Date:** 2026-06-06
**Scope:** Visual redesign of the login / signup / forgot-password / reset-password screens in `static/index.html` + `static/style.css`. Minimal, surgical changes to `static/app.js`.

## Goal

The auth screen currently reads as a generic centered form stack — it doesn't carry the confident terminal/CRT personality of the `PING_` brand and the landing page. Redesign it so the four auth states live inside a framed **terminal window**, warmed by a boot/greeting line written in the terminal's own voice, while keeping the existing structure (brand → toggle → form → forgot link → footer) and the green-on-black themed palette.

Chosen from three explored directions: **A · Terminal window** (most on-brand), refined with:
- A **boot/greeting line** for warmth ("warmth in the terminal's own language") — **static** text, not animated.
- A **theme-aware title bar** with recolored dots (palette tints, not mac red/yellow/green) and a shell-path title.
- **Prompt-command switching** between login/signup, styled as clickable bracketed commands but behaving as an obvious toggle.

## Non-goals

- No structural rethink of how the four states relate (user likes current structure).
- No change to auth *logic*, Supabase calls, validation, or error/success copy semantics.
- No animation of the boot line (decided: static; blinking cursor provides the only motion).
- No changes to the main app, settings modal, landing, privacy, or terms pages — except shared CSS variables already in `:root`.

## Constraints (from existing code — must preserve)

`app.js` binds to these and they MUST keep working unchanged:

- IDs: `#auth-screen`, `#auth-box`, `#auth-tabs`, `#login-form`, `#signup-form`, `#forgot-form`, `#reset-form`, `#auth-error`, `#forgot-link`, `#forgot-back-link`, `#auth-footer`, and all input IDs (`#login-email`, `#login-password`, `#signup-email`, `#signup-username`, `#signup-password`, `#forgot-email`, `#reset-password`, `#reset-password-confirm`).
- `#auth-tabs .tab` buttons with `data-tab="login"` / `data-tab="signup"`, toggled via `.active` class. The switch handler (app.js:124-133) and forgot/back handlers (app.js:224-242) toggle `#auth-tabs` visibility and the `.active` class — this stays.
- `#auth-error` toggles a `.success` class for green success messages; `.hidden` utility hides elements.
- Inline SVG icons use `class="icon"` (1em, currentColor) — keep using them in buttons/links.
- Swedish copy and HTML entities (`&ouml;` etc.) — preserved.
- Mobile (`max-width` breakpoint ~640px, see style.css:1089): inputs must keep `font-size:16px` (prevents iOS zoom) and forms go full-width.

## Design

### Structure (index.html)

Wrap the existing `#auth-box` contents in a terminal-window shell. The window has two parts:

1. **Title bar** (`#auth-titlebar`): three dots (`<span class="auth-dot">`×3) + a shell-path title (`ping@web: ~/login`). The path text lives in an element (e.g. `#auth-path`) so it can reflect the active state.
2. **Body** (`#auth-body`): contains, in order:
   - **Boot line** (`#auth-boot`): two lines — a command (`$ ping --auth`) and a status/greeting (`✓ ansluten. välkommen tillbaka.`). The `✓` and command are accent-colored; the greeting is muted. Per-state text (see table). Static.
   - The existing `#auth-tabs` (restyled as the command switcher) — shown for login/signup, hidden for forgot/reset (unchanged JS behavior).
   - The four forms (`#login-form` etc.), one visible at a time (unchanged).
   - `#auth-error`.

The `PING_` wordmark `<h1>` is **removed from inside the box** — the brand is now expressed by the terminal frame + title bar. (Rationale: avoid doubling the brand mark; the title bar carries identity.) The blinking-underscore cursor motif moves to the focused input / boot line.

`#auth-footer` (privacy · terms) stays pinned at the bottom as today.

### Per-state content

| State | Title path | Boot command | Greeting line (muted) |
|-------|-----------|--------------|----------------------|
| Login | `~/login` | `$ ping --auth` | `✓ ansluten. välkommen tillbaka.` |
| Signup | `~/signup` | `$ ping --auth` | `✓ ansluten. skapa ett konto för att börja pinga.` |
| Forgot | `~/recover` | `$ ping --recover` | `ange din e-post så skickar vi en återställningslänk.` |
| Reset | `~/reset` | `$ ping --reset` | `välj ett nytt lösenord.` |

The forgot/reset greeting **replaces** the existing `#forgot-description` / `#reset-description` paragraphs (their copy moves into the boot line). Those `<p>` elements are removed.

**Title-path + boot-line updating:** app.js already has the four transition points (tab click, forgot-link, forgot-back-link, `showResetPasswordScreen`). Add a tiny helper `setAuthState(state)` that sets `#auth-path` text and `#auth-boot` content from a small lookup object, called from those existing points. This is the only meaningful JS addition (~15 lines + a data object). No logic changes.

### Styling (style.css)

Replace the current `#auth-box` / `#auth-tabs` / form-input / button / link rules (style.css:174-345) with the terminal treatment:

- **Window frame:** `#auth-box` becomes a fixed-ish width (~300px desktop, full-width-minus-margin on mobile) bordered container; title bar `#0e0e0e` bg, body `#080808` bg, 9px outer radius, `var(--border)` borders.
- **Dots:** three `var(--fg-dim)` circles at opacity .55 / .8 / 1.0 (graduated), so they tint with the active theme.
- **Title path:** muted gray with the `~/path` segment in `var(--fg-dim)`.
- **Boot line:** `var(--fg-dim)` mono, `✓`/command in `var(--fg)`, greeting in `#555`.
- **Command switcher** (restyled `#auth-tabs .tab`): bracketed `[ logga in ]` look — inactive `#555`, active `var(--fg)` with `var(--fg-dim)` brackets. Must remain visibly clickable (cursor pointer, hover lift) so it reads as a toggle, not a typed-only command.
- **Fields:** `var(--field-bg)`/`#101010` bg, `var(--border)` border, `>` prefix in `var(--fg-dim)` (via `::before` on input wrappers or a leading span — see Open question), focus → `var(--fg-dim)` border + green glow (reuse existing `box-shadow:0 0 0 3px rgba(51,255,153,.09)`; this rgba is green-specific — keep as-is or switch to a `color-mix` of `--fg` if we want it to track themes, see Open question).
- **Submit button:** keep `var(--fg-dim)` bg → `var(--fg)` on hover (current behavior), uppercase letterspaced label with a trailing `→`.
- **Sub-links** (`#forgot-link`, `#forgot-back-link`): muted, accent on hover, lowercase prompt style (`glömt lösenordet?`, `← tillbaka till inloggning`).
- **Stage glow:** `#auth-screen` gets a subtle `radial-gradient` using `var(--self-bg)` at top-center fading to `var(--bg)` — gives the warm halo behind the window. `--self-bg` already exists and is theme-tinted-ish (currently only varies for default; acceptable — see Open question).

### Theme behavior

All accent surfaces use existing CSS variables (`--fg`, `--fg-dim`, `--bg`, `--border`, `--self-bg`), so the redesign automatically tracks the 7 existing themes (green/amber/cyan/pink/red/paper/purple) and the saved-theme pre-paint script in index.html. No new theme code.

### Accessibility

- Title bar dots are decorative → `aria-hidden`.
- Boot line is decorative flavor → fine to leave readable, but it duplicates no essential info (greeting only).
- The command switcher keeps real `<button>`s with text labels → screen-reader accessible as before; ensure focus-visible outline.
- Inputs keep their existing `placeholder`, `autocomplete`, `required`, `pattern`, `minlength` attributes and visible focus state.
- Cursor blink + any glow respect `prefers-reduced-motion` (disable the blink animation under the media query).
- Contrast: muted grays (`#555`) on near-black are decorative only; interactive text uses `--fg`/`--fg-dim`.

## Open questions (resolve during implementation, low-risk defaults chosen)

1. **`>` field prefix** — implement as a leading non-interactive `<span class="field-prefix">&gt;</span>` inside a flex wrapper around each input, OR as a CSS `::before` on a wrapper. Default: wrapper + span (simplest, no input restructuring, keeps placeholder visible). Wrapper must not break the `#login-form input` selectors — scope new rules carefully.
2. **Focus-glow color** — keep hardcoded green `rgba(51,255,153,.09)` (matches today) or make it theme-aware via `color-mix(in srgb, var(--fg) 10%, transparent)`. Default: **theme-aware color-mix**, since the whole point is on-brand theming; fall back is the static green if a browser lacks color-mix (graceful — just no glow tint difference).
3. **`--self-bg` per theme** — currently only the default theme defines a distinct `--self-bg`; other themes inherit the green-ish one. For the stage halo this is a minor mismatch. Default: leave as-is for this task (out of scope to retune every theme's `--self-bg`); revisit only if the halo looks wrong on amber/pink.

## Files touched

- `static/index.html` — restructure `#auth-box` markup (title bar, body, boot line; remove `<h1>` wordmark and the two description `<p>`s). ~40 lines changed.
- `static/style.css` — replace auth block (≈174-345) and the auth part of the mobile media query (≈1089-1103). ~150 lines.
- `static/app.js` — add `setAuthState(state)` helper + a content lookup object; call it from the 4 existing transition points. ~20 lines added, 0 removed logic.

## Testing / verification

Manual (no test harness in repo):
1. Load `/app` logged out → terminal window renders, login state, blinking cursor, footer pinned.
2. Click `[ skapa konto ]` → switches to signup, title `~/signup`, greeting updates, 3 fields. Click back → login.
3. Click `glömt lösenordet?` → `~/recover`, switcher hidden, single email field, back-link returns to login with login tab active.
4. Trigger reset flow (`showResetPasswordScreen`) → `~/reset`, two password fields.
5. Error + success messages still appear in `#auth-error` (red / green).
6. Cycle all 7 themes via the saved-theme mechanism → dots, accents, glow track the theme.
7. Mobile width (≤640px) → window full-width-ish, inputs `font-size:16px` (no iOS zoom), no horizontal scroll.
8. `prefers-reduced-motion` → cursor stops blinking.
9. Keyboard: Tab through switcher + fields + submit; focus visible; Enter submits.
