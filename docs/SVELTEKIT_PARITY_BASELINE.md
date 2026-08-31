# SvelteKit parity baseline

The reference for deciding whether the SvelteKit implementation behaves like
the FastAPI application it replaces. Produced by Step 1 of
`docs/SVELTEKIT_MIGRATION_PLAN.md`.

Every later step compares against this document. If the SvelteKit behavior
differs from what is recorded here, that is a parity failure unless it appears
in [Approved intentional differences](#approved-intentional-differences).

Captured on 2026-08-31 against commit `6c13d1c` (working tree clean apart from
`.gitignore`, `.codeclone/`, and the migration docs).

## How this document is maintained

The mechanical parts — statuses, content types, headers, JSON key sets — are
captured from a running FastAPI process rather than transcribed by hand:

```
.venv/bin/python scripts/capture_baseline.py
```

That script boots `server:app` under uvicorn on a free port using placeholder
Supabase values, requests every route that needs no outbound network access,
and prints the Markdown between the two `generated` comments in
[Captured route contract](#captured-route-contract). Re-run it and replace
exactly that region whenever the server changes; everything below the closing
comment is hand-written and must be preserved. Routes that
require a live outbound fetch (`/preview`, `/preview/image` success paths) are
documented from the source and the Python tests instead, and are marked as
such.

The placeholder values are deliberate: this document is committed, so it must
never contain the real project URL or anon key.

## Environment variables

| Name | Required | Used by | Nature |
| --- | --- | --- | --- |
| `SUPABASE_URL` | yes | `server.py` (import time), CSP, `/config` | **Public** client configuration |
| `SUPABASE_ANON_KEY` | yes | `server.py` (import time), `/config` | **Public** client configuration |

Both are public client configuration, **not** service-role secrets. The anon
key is designed to be shipped to browsers; authorization is enforced entirely
by Supabase RLS policies in `supabase/schema.sql`. There is no service-role key
anywhere in this application, and none may be introduced.

`server.py` raises `RuntimeError("Missing SUPABASE_URL / SUPABASE_ANON_KEY")`
at import time if either is absent, so the process fails fast rather than
serving a broken client. `python-dotenv` loads a local `.env` in development.

`.env.example` exists and, since the `!.env.example` negation was added to
`.gitignore`, is no longer ignored and is ready to commit. `.env` itself stays
ignored.

**Verified during Step 4, and the earlier description was slightly wrong.** Local
permission settings deny *reading* any `.env*` file, so Step 3 relied on the
repository owner's description: "the two names only, with no values". A shape
check that reports no file content shows it actually holds two lines, both with
**placeholder values** — 38 and 22 characters, neither matching the real values
in `.env`, neither shaped like a JWT, both matching a placeholder pattern.

That is fine, and arguably better than bare names: it shows the expected format.
The correction matters only so Step 29 checks the right thing. What must stay
true is that **no real credential** appears there, which is verifiable without
reading the file:

```
python3 - <<'EOF'
import re
def parse(p):
    return {m.group(1): m.group(2).strip().strip('"\'')
            for m in (re.match(r'^\s*([A-Za-z_]\w*)\s*=\s*(.*)$', l)
                      for l in open(p).read().splitlines()) if m}
ex, real = parse('.env.example'), parse('.env')
for k in ('SUPABASE_URL', 'SUPABASE_ANON_KEY'):
    print(k, 'LEAKS REAL VALUE' if ex.get(k) == real.get(k) else 'ok (placeholder)')
EOF
```

Also note `PING_E2E_*` (see [Two-user fixture strategy](#two-user-fixture-strategy-step-4))
are read from `.env` locally and from CI secrets. They are **not** added to
`.env.example` as real values and never leave the environment.

`SUPABASE_URL` also determines two CSP `connect-src` origins: the URL itself,
and the same origin with `https://` rewritten to `wss://` for Realtime.

## Supabase Auth URL configuration — currently wrong in production

Found during Step 5 while confirming a fixture account. Recorded here because
two manual checklist items and Step 14 depend on it, and because it is a live
product bug rather than a migration artifact.

**Site URL points at `localhost`.** Confirmation links therefore land on a dev
server that is not running, and the user sees `ERR_CONNECTION_REFUSED`.

The two email flows behave differently, which is why this went unnoticed:

| Flow | Call site | Redirect |
| --- | --- | --- |
| Password reset | [`static/app.js:401`](../static/app.js#L401) | passes `redirectTo: origin + "/app"` explicitly — **works**, as long as the production origin is in the Redirect URLs allowlist |
| Signup confirmation | [`static/app.js:341`](../static/app.js#L341) | passes only `options.data.username`, no `emailRedirectTo` — **falls back to Site URL** |

The failure is quiet in the worst way: verification happens server-side at
`{SUPABASE_URL}/auth/v1/verify` *before* the redirect fires, so the token is
consumed and the account really is confirmed. The user only sees a broken page
and reasonably concludes that signing up failed.

### Required configuration

Authentication → URL Configuration:

- **Site URL:** `https://www.myping.se` — the `www` form, since Cloudflare
  301s the apex to it.
- **Redirect URLs:** `https://www.myping.se/**`, the Render-assigned
  `https://<service>.onrender.com/**`, `http://localhost:8000/**` (FastAPI
  dev), and `http://localhost:5173/**` (Vite dev).

The Render hostname matters for debugging: when the custom domain or Cloudflare
misbehaves, it is how you check whether the app itself is healthy, and auth
would otherwise break exactly when you need it.

### Consequences for later steps

- **Step 14 (auth port) is blocked on this.** The Vite dev server is on 5173,
  not 8000, so no auth flow can be tested locally until that origin is
  allowlisted.
- The SvelteKit signup implementation should pass `emailRedirectTo` explicitly,
  the way password reset already does, so the flow no longer depends on a
  dashboard setting. The legacy `static/app.js` is deliberately **not** patched
  for this — correcting Site URL fixes the bug outright, and the migration
  rules bar unrelated changes to code that is being replaced anyway.
- Two manual checklist items cannot pass meaningfully until this is fixed:
  "Forgotten-password email arrives; its link lands on `/app`", and the new
  signup-confirmation item added below.

## Deployment state (as of Step 5)

`render.yaml` deploys FastAPI to Render, and Cloudflare fronts it at
`myping.se`, redirecting the apex to `www`.

**The service is currently suspended.** Every route returns 503 with
`x-render-routing: suspend`, which is distinct from `no-server` (a deploy in
flight) and `hibernate` (a free instance spun down). Suspension is caused by
exhausted free instance hours, a failed payment, or a manual suspend — never by
a push.

Two consequences worth carrying forward:

- Steps 1 through 5 are on `main` but may never have deployed; Render queues or
  skips deploys for a suspended service. **Step 2's relocation has therefore
  not been exercised on a live server.** It is verified locally — `/` and
  `/app` byte-identical, 38 tests green, and `FileResponse("legacy/index.html")`
  resolves from the repo root exactly as `static/index.html` did — but that is
  not the same as production evidence.
- Step 12 needs a *second* Render service for the SvelteKit build
  (`runtime: node`, `startCommand: node build/index.js`). Running two services
  is what exhausts free instance hours, so if that is what suspended this one,
  Step 12 needs a paid instance or a different preview target.

## Captured route contract

<!-- Generated by scripts/capture_baseline.py. Do not edit by hand. -->

Captured with `SUPABASE_URL=https://example.supabase.co` and
`SUPABASE_ANON_KEY=placeholder-anon-key`.

| Route | Status | Content-Type | Body |
| --- | --- | --- | --- |
| `/` | 200 | `text/html; charset=utf-8` | HTML, 41085 bytes, starts `<!doctype html>` |
| `/app` | 200 | `text/html; charset=utf-8` | HTML, 41085 bytes, starts `<!doctype html>` |
| `/config` | 200 | `application/json` | JSON object, keys: `supabaseAnonKey`, `supabaseUrl` |
| `/privacy` | 200 | `text/html; charset=utf-8` | HTML, 7846 bytes, starts `<!doctype html>` |
| `/terms` | 200 | `text/html; charset=utf-8` | HTML, 7574 bytes, starts `<!doctype html>` |
| `/preview?url=ftp://example.com/x` | 400 | `application/json` | JSON object, keys: `error` |
| `/preview?url=http://127.0.0.1/` | 400 | `application/json` | JSON object, keys: `error` |
| `/preview` | 422 | `application/json` | JSON object, keys: `detail` |
| `/preview/image?url=http://127.0.0.1/x.png` | 400 | `application/json` | JSON object, keys: `error` |
| `/preview/image` | 422 | `application/json` | JSON object, keys: `detail` |
| `/style.css` | 200 | `text/css; charset=utf-8` | 65682 bytes |
| `/app.js` | 200 | `text/javascript; charset=utf-8` | 122530 bytes |
| `/sw.js` | 200 | `text/javascript; charset=utf-8` | 2838 bytes |
| `/assets/manifest/manifest.webmanifest` | 200 | `application/manifest+json` | JSON object, keys: `background_color`, `description`, `display`, `icons`, `lang`, `name`, `orientation`, `scope`, `short_name`, `start_url`, `theme_color` |
| `/sitemap.xml` | 200 | `application/xml` | 464 bytes |
| `/data/emoji-data.json` | 200 | `application/json` | JSON object, keys: `categories`, `locale`, `version` |
| `/does-not-exist` | 404 | `application/json` | JSON object, keys: `detail` |

### Security headers (identical on every response)

- `content-security-policy`: `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'sha256-3JhmKwxKymAV1oveAZwwL+4vLpjxnFXtDbe6eB+elPY='; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://example.supabase.co wss://example.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
- `x-content-type-options`: `nosniff`
- `referrer-policy`: `strict-origin-when-cross-origin`
- `x-frame-options`: `DENY`
- `permissions-policy`: `geolocation=(), microphone=(self), camera=(self), interest-cohort=()`
- `strict-transport-security`: `max-age=31536000; includeSubDomains`

<!-- End generated section. -->

### Per-route cache headers

No route sets `Cache-Control` except `/preview/image` (see below). Static files
are served by Starlette's `StaticFiles`, which sets `etag` and `last-modified`
and answers conditional requests with 304. Verified against a running server:

```
GET /style.css              -> 200, etag "86b40a65…", last-modified set
  + If-None-Match: <etag>   -> 304
  + If-Modified-Since: <lm> -> 304
```

The ETag is content-derived, so it changes whenever the file changes. Any
SvelteKit replacement must keep conditional requests working for static assets;
losing them re-downloads every font and icon on each navigation.

### Redirects

**The server issues no HTTP redirects.** No route returns 3xx, and the static
mount does not redirect directory paths (they 404). Every redirect in the
product is client-side and belongs to Supabase Auth:

- `resetPasswordForEmail(..., { redirectTo: origin + "/app" })` — the recovery
  link returns the user to `/app` with a token in the URL **fragment**.
- OAuth and invite links likewise land on `/app` with fragment data
  (`#type=recovery`, `#invite=…`).

Fragments never reach the server, so this is entirely a client-side contract.
It survives any server rewrite unchanged **provided `/app` keeps serving the
application**, which is why Steps 14 and 28 both guard it.

## Route details

Applied by `server.py`'s `security_headers` middleware with `setdefault`, so a
route may override a header but none currently do. The middleware runs on every
response including 404s and static files.

### `GET /config`

Returns `{"supabaseUrl": ..., "supabaseAnonKey": ...}`. No cache header, no
auth, always 200 when the process is running (the process cannot start without
the values). This is the only thing standing between the browser and its
Supabase client.

### `GET /` and `GET /app`

Both serve `legacy/index.html` byte-for-byte via `FileResponse`.
(Step 2 moved it out of `static/`; the bytes are unchanged, so the CSP
inline-script hash below is still valid.) `/app` exists
because Supabase Auth redirects (`redirectTo: origin + "/app"`) and existing
links point at it. Both must keep working; the OAuth and password-recovery
round trip lands on `/app` with a URL **fragment**, and invite links land with
an `#invite=` fragment.

### `GET /privacy`, `GET /terms`

Serve `static/pages/privacy.html` and `static/pages/terms.html`. These load
their theme bootstrap from `/assets/scripts/theme-init.js` (covered by
`script-src 'self'`), unlike `index.html` which uses a hashed inline block.

### `GET /preview?url=…`

| Condition | Status | Body |
| --- | --- | --- |
| `url` query param absent | 422 | FastAPI validation error, `detail` key |
| URL fails `validate_public_http_url` | 400 | `{"error": "invalid url"}` |
| Cache hit | 200 | Cached metadata JSON |
| `httpx.HTTPError` (DNS, connect, timeout) | 204 | empty |
| Upstream status >= 400 | 204 | empty |
| `content-type` does not contain `html` | 204 | empty |
| `parse_metadata` returns `None` (no title) | 204 | empty |
| Success | 200 | metadata JSON |

Success body keys: `title`, `description`, `image`, `favicon`, `domain`, `url`.
`description` and `image` may be `null`; `favicon` is always set (defaults to
`/favicon.ico` resolved against the final URL). `image` and `favicon`, when
present, are rewritten to `/preview/image?url=<percent-encoded absolute URL>`
so the browser never contacts the target host. `url` echoes the **requested**
URL, while `domain` comes from the **final** (post-redirect) URL.

Metadata precedence, from `parse_metadata`:

- title: `og:title` → `twitter:title` → `<title>` → no preview (`None`)
- description: `og:description` → `twitter:description` → `description` → `null`
- image: `og:image` → `twitter:image` → `null`, resolved against the final URL
- favicon: first `<link>` whose `rel` tokens contain exactly `icon` →
  `/favicon.ico`, resolved against the final URL. `apple-touch-icon` and
  `mask-icon` must **not** be picked up.
- Duplicate meta keys: first occurrence wins.

Fetch behavior: `User-Agent: PingLinkPreview/1.0`, 5 s timeout,
`follow_redirects=True` (see intentional differences), body decoded then capped
at `PREVIEW_MAX_BYTES * 4` = 2 MiB of text. Successful results are cached in an
in-process `TTLCache` for 600 s keyed by the requested URL. Failures are not
cached.

### `GET /preview/image?url=…`

| Condition | Status | Body |
| --- | --- | --- |
| `url` query param absent | 422 | FastAPI validation error, `detail` key |
| URL fails `validate_public_http_url` | 400 | `{"error": "invalid url"}` |
| `httpx.HTTPError` | 404 | empty |
| Upstream status >= 400 | 404 | empty |
| `content-type` does not start with `image/` | 400 | `{"error": "not an image"}` |
| Body larger than 3 MiB | 404 | empty |
| Success | 200 | image bytes |

Success sets `Content-Type` to the upstream content type and
`Cache-Control: public, max-age=86400`. The size check happens **after** the
full body is in memory (see intentional differences).

### URL validation (`validate_public_http_url`)

Rejects, raising `UrlValidationError`:

- schemes other than `http`/`https` (including `file:`, `ftp:`, and the empty
  scheme produced by a relative or non-URL string)
- missing hostname (`http:///nohost`)
- malformed IPv6 literals, where `urlparse` itself raises `ValueError`
- DNS resolution failure (`socket.gaierror`)
- any host where **any** resolved address is private, loopback, link-local,
  reserved, multicast, unspecified, or in `100.64.0.0/10` (CGNAT)
- any resolved value that does not parse as an IP address

`getaddrinfo` is called with no family hint, so both A and AAAA records are
checked and all must be public.

### Static files

`app.mount("/", StaticFiles(directory="static", html=True))` is registered
**after** every explicit route, so explicit routes win and everything else
falls through to `static/`. Consequences worth preserving:

- `static/style.css` is served at `/style.css`, not `/static/style.css`. The
  same flattening applies to `/app.js`, `/commands.js`, `/keyboard.js`,
  `/sw.js`, `/sitemap.xml`, `/icons/…`, `/fonts/…`, `/assets/…`, `/data/…`.
- `html=True` would make a directory serve its own `index.html`, but no
  subdirectory contains one, so directory paths such as `/pages`, `/icons`,
  and `/fonts` return **404 with no redirect**. Verified against a running
  server.
- `/index.html` returned **200** before Step 2, because `static/index.html` was
  also an ordinary public asset. Step 2 moved the shell to `legacy/index.html`,
  so `/index.html` now returns **404**. `/` and `/app` are unaffected: they are
  answered by explicit routes registered before the mount. See
  [AID-4](#aid-4--indexhtml-no-longer-served-as-a-static-asset-step-2).
- Unknown paths return FastAPI's JSON 404 (`{"detail": "Not Found"}`), not an
  HTML error page.

Asset inventory under `static/` (565 tracked files since Step 2; `find` also reports 4
local `.DS_Store` files, which are untracked and never deployed):

| Path | Count | Notes |
| --- | --- | --- |
| `icons/ui/` | 133 | UI glyphs |
| `icons/emojis/<category>/` | 343 | 7 categories × 49 |
| `icons/emojis/*.svg` | 7 | category tab icons |
| `icons/filetypes/` | 48 | file-type glyphs |
| `fonts/` | 15 | Monaspace Argon/Krypton/Neon/Radon/Xenon × ttf/woff/woff2 |
| `assets/favicons/` | 5 | `icon.svg`, `favicon-32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |
| `assets/scripts/` | 3 | `invite-url.js`, `qrcode.js`, `theme-init.js` |
| `assets/audio/` | 1 | `ping.wav` |
| `assets/manifest/` | 1 | `manifest.webmanifest` |
| `data/` | 1 | `emoji-data.json` |
| `pages/` | 2 | `privacy.html`, `terms.html` |
| root | 6 | `style.css`, `app.js`, `commands.js`, `keyboard.js`, `sw.js`, `sitemap.xml` |

The shell itself is **not** under `static/`: it is `legacy/index.html`, served
only through the explicit `/` and `/app` routes.

## Frontend architecture

### Script load order

`legacy/index.html` loads plain scripts in a fixed order; there is no bundler and no
ES modules. `commands.js` and `keyboard.js` must load **before** `app.js`,
which calls into them via `window.PingCommands` and `window.PingKeyboard`.
`@supabase/supabase-js` comes from `https://cdn.jsdelivr.net`, which is why
that origin is in `script-src`.

Those three script tags use **relative** `src` values (`commands.js`,
`keyboard.js`, `app.js`), not absolute paths. They resolve to `/commands.js`
etc. at both `/` and `/app` only because neither URL has a trailing slash. A
replacement that serves the shell at `/app/` would silently request
`/app/app.js` and break the page. Step 10 must keep the no-trailing-slash form.

`legacy/index.html` also contains one inline `<script>`: a theme/font bootstrap
reading `localStorage` and setting `data-theme` / `data-font` on
`<html>` before paint, plus service-worker registration on `load`. It is
allowed by the CSP hash
`'sha256-3JhmKwxKymAV1oveAZwwL+4vLpjxnFXtDbe6eB+elPY='`. **Editing that block
by even one byte invalidates the hash and the script is silently blocked**,
which loses the pre-paint theme and the service worker. `privacy.html` and
`terms.html` use `/assets/scripts/theme-init.js` instead and need no hash.

### UI language

All user-facing strings are **Swedish**. Command output, error messages, empty
states, and the cheatsheet are Swedish; identifiers and comments are English.
Ported UI must keep the exact strings unless a change is explicitly approved.

### Supabase surface

The browser talks to Supabase directly; there is no privileged backend. Any
authorization the new UI appears to perform is cosmetic — RLS is the boundary.

**Tables:** `profiles`, `contacts`, `pings`, `file_archive` (plus `invites`,
reached only through RPCs).

**RPCs** (all `security definer`, defined in `supabase/schema.sql`):

| RPC | Called from | Purpose |
| --- | --- | --- |
| `create_invite()` | invite dialog | mint a single-use token |
| `redeem_invite(p_token uuid)` | invite landing | create the accepted contact pair |
| `mark_read(p_other uuid)` | opening a chat | stamp `read_at` on their messages to me |
| `mark_delivered(p_id uuid)` | Realtime INSERT handler | stamp `delivered_at`; fire-and-forget |
| `dismiss_ping(p_id uuid)` | message dismiss | remove a message, preserving its archived file |
| `set_disappearing(p_contact_id uuid, p_ttl interval)` | disappearing menu | set the pair's TTL |

`pings` has **no UPDATE RLS policy**, so receipts cannot be written with a
direct client update — `mark_delivered` and `mark_read` exist precisely for
that. Do not "simplify" them into table updates.

**Storage:** one bucket, `ping-files`, private. Upload paths must stay
RLS-compatible (`Users can upload to own folder`); downloads are authorized by
`Users can download files from their pings or archive`.

**Auth:** `getSession`, `onAuthStateChange`, `signUp`, `signInWithPassword`,
`signOut`, `resetPasswordForEmail`, `updateUser`.

### Realtime

Two channels, both created after sign-in and torn down with `removeChannel` on
sign-out:

`channel("realtime")` with four `postgres_changes` listeners:

1. `INSERT` on `pings` filtered `receiver_id=eq.<me>` — calls `mark_delivered`
   fire-and-forget when `delivered_at` is null, appends to the board if that
   chat is open (with an id dedup guard against the `loadPings` race), or
   increments a durable unread count, then plays the ping sound.
2. `UPDATE` on `pings` filtered `sender_id=eq.<me>` — live sender-side
   delivered/read receipts, applied only if the row is in the open chat.
3. `*` on `contacts` filtered `addressee_id=eq.<me>` — reload contacts, play sound.
4. `*` on `contacts` filtered `requester_id=eq.<me>` — reload contacts. Must be
   `*` and not `UPDATE`: invite redemption arrives as an INSERT.

`channel("presence")` keyed by the user id, tracking `{online_at}` on
`SUBSCRIBED` and recomputing the online set on `sync`. This drives the presence
dots in the contact list and `/who`. **No database writes.**

### Client-side state

`localStorage` keys, all read by the inline bootstrap or `app.js`:

| Key | Values |
| --- | --- |
| `ping-theme` | `green`, `amber`, `cyan`, `pink`, `red`, `paper`, `purple` |
| `ping-font` | `radon`, `neon`, `argon`, `xenon`, `krypton` |
| `ping-muted` | truthy/falsy mute flag |

Applied as `data-theme` / `data-font` attributes on `<html>`.

## Feature inventory

Constants that are part of the observable contract:

| Constant | Value | Where |
| --- | --- | --- |
| `PINGS_PAGE_SIZE` | 50 | `app.js` — history page size and the has-more test |
| File size limit | 50 MiB | `app.js` upload validation |
| `RECORD_MAX_MS` | 60000 | `app.js` — video recording hard auto-stop |
| `PREVIEW_TIMEOUT` | 5.0 s | `server.py` |
| `PREVIEW_MAX_BYTES` | 512 KiB (×4 for decoded text) | `server.py` |
| `IMAGE_MAX_BYTES` | 3 MiB | `server.py` |
| Preview cache TTL | 600 s | `server.py` |
| Invite lifetime | 10 minutes, single use | `create_invite` |
| Disappearing TTL options | off, `24 hours`, `7 days` | `legacy/index.html` `data-ttl` |

History loads newest-first (`order DESC` + `limit 50`, reversed for display);
`hasMoreOlder` is true while a page returns exactly 50 rows. Expired messages
are filtered client-side against the pair's TTL in addition to server purging.

### Overlays

Eight overlays, registered topmost-first in `keyboard.js`. Escape closes the
**first open one and stops**:

1. `kbd-cheatsheet` — shortcut help
2. `kbd-palette` — Cmd/Ctrl+K contact switcher
3. `record-modal` — video recording
4. `capture-modal` — camera photo capture
5. `lightbox` — full-size image viewer
6. `invite-modal` — invite link, QR, countdown, regenerate
7. `settings-modal`
8. `gallery-modal` — per-contact file archive

The emoji picker (`emoji-picker`, with search, category row, and grid backed by
`/data/emoji-data.json` and `/icons/emojis/`) is **not** in the overlay
registry and does not participate in the Escape chain.

Palette and Settings both refuse to open on top of another open overlay, by
design, to avoid layered modals.

### Commands

Parsed by `commands.js`. `parseCommand` and `getCommandHints` are pure and are
the unit-testable core. `/word` is intercepted even when unknown (so it can
report `okänt kommando`); a bare `/` or `/ text` falls through as normal text.
The hint menu is active only while the input matches `^/[a-z?]*$`.

| Command | Aliases | Arg | Behavior |
| --- | --- | --- | --- |
| `/help` | `?`, `commands` | — | list all commands |
| `/theme` | — | name | one of the 7 themes, else list valid ones |
| `/font` | — | name | one of the 5 fonts, else list valid ones |
| `/clear` | — | — | clear the open chat; requires a selected contact |
| `/who` | — | — | active contact plus online/offline |
| `/last` | — | — | recall last sent text into the input |
| `/mute` / `/unmute` | — | — | toggle sound |
| `/shrug` | — | — | append `¯\_(ツ)_/¯` |

`/clear`, `/who` and `/last` answer `välj en kontakt först` with no contact
selected.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Cmd/Ctrl+K | toggle the contact palette |
| Cmd/Ctrl+, | open Settings (suppressed if any overlay is open) |
| Escape | close the topmost open overlay |
| `/` | focus the composer |
| `?` | open the cheatsheet |
| Alt+↑ / Alt+↓ | previous / next contact, wrapping |

Bare-key shortcuts (`/`, `?`, Alt+arrows) are suppressed while focus is in an
input, textarea, or contenteditable, or while any overlay is open. Modified
chords bypass that guard. Both `metaKey` and `ctrlKey` are accepted on every
platform; only the cheatsheet *labels* switch between ⌘/⌥ and Ctrl/Alt.

Palette internals: ↑/↓ wrap, Enter selects, backdrop click closes, focus
returns to the previously focused element. The cheatsheet's open is idempotent
so a second `?` cannot clobber the saved focus target.

### Service worker

`static/sw.js`, cache name `ping-shell-v10`, registered from the inline script
in `legacy/index.html`.

- Precaches a hard-coded 16-entry shell list including `/`, `/app`,
  `/style.css`, `/app.js`, `/commands.js`, `/keyboard.js`, two `assets/scripts`
  files, `ping.wav`, the manifest, four favicons, and `MonaspaceRadon.woff2`.
- `skipWaiting()` on install and `clients.claim()` on activate: **a new worker
  takes over immediately.** Old caches are deleted on activate.
- Ignores non-GET and cross-origin requests.
- Explicitly bypasses `/config`, `/preview`, `/preview/image`.
- Navigations: network-first, falling back to cached `/app` then `/`.
- `/style.css`, `/app.js`, `/commands.js`: network-first, refreshing the cache
  on every hit, falling back to cache offline.
- Everything else same-origin: cache-first, populating the cache on miss.

## Test suite baseline

```
$ .venv/bin/python -m pytest -q
......................................                                   [100%]
38 passed, 1 warning in 0.25s
```

Python 3.14.5, run from the repository root on 2026-08-31. The one warning is
`StarletteDeprecationWarning: Using httpx with starlette.testclient is
deprecated`, which is unrelated to application behavior.

`tests/conftest.py` injects placeholder `SUPABASE_URL` / `SUPABASE_ANON_KEY`
via `os.environ.setdefault`, because `server.py` raises at import time without
them. The SvelteKit suite needs the same affordance.

Coverage today: 24 tests in `test_link_preview.py` (URL validation, IP
classification, metadata parsing, TTL cache) and 14 in `test_preview_routes.py`
(both preview routes with mocked DNS and HTTP). **There are no automated tests
of any kind for the frontend, the auth flow, contacts, messaging, Realtime,
storage, commands, or keyboard behavior.** Everything in the manual checklist
below is currently verified only by hand.

## Manual smoke checklist

Run against a deployment with two accounts, A and B, that are already
contacts unless a step says otherwise. Record the date and target next to a
completed run.

### Public pages

- [ ] `/` loads the app shell with no console errors
- [ ] `/app` is byte-identical to `/`
- [ ] `/privacy` and `/terms` render and respect the saved theme
- [ ] `/config` returns exactly `supabaseUrl` and `supabaseAnonKey`
- [ ] An unknown path returns 404
- [ ] No CSP violations in the console on any page

### Auth

- [ ] Sign up with a new email and username; profile row is created once
- [ ] The confirmation email's link lands on a working page, **not** `localhost`
      (see [Supabase Auth URL configuration](#supabase-auth-url-configuration--currently-wrong-in-production);
      note the account is confirmed either way, so only the landing page reveals
      the fault)
- [ ] Sign up with an already-taken username is rejected with a Swedish error
- [ ] Log in with valid credentials
- [ ] Log in with invalid credentials shows an error and no session
- [ ] Reload keeps the session
- [ ] Log out clears the session and tears down both Realtime channels
- [ ] Forgotten-password email arrives; its link lands on `/app`
- [ ] The password reset completes and the new password works
- [ ] A recovery link does **not** get signed out mid-flow

### Contacts and invites

- [ ] Search finds a profile by username
- [ ] A sends B a contact request; B sees it live without reloading
- [ ] B accepts; both sides show the contact, live
- [ ] B rejects; the request disappears for both
- [ ] A creates an invite: QR renders, link copies, countdown runs
- [ ] Regenerating an invite invalidates the previous token
- [ ] B redeems the invite while logged in; A sees the new contact live
- [ ] B redeems an invite while logged out: the token survives sign-up/login
- [ ] An expired (>10 min) invite is refused
- [ ] A reused invite is refused
- [ ] Redeeming an invite from an existing contact reports already-connected
- [ ] Presence dots show A and B online, and go offline when a tab closes

### Messaging

- [ ] A sends text; B receives it live and hears the ping sound
- [ ] Sender sees delivered, then read, when B opens the chat
- [ ] Unread badge persists across reload until the chat is opened
- [ ] Opening the chat clears the badge (`mark_read`)
- [ ] Switching contacts and returning restores the right conversation
- [ ] Scrollback loads older pages of 50 without the viewport jumping
- [ ] Date separators appear at the right boundaries
- [ ] Rapid repeated sends produce no duplicate messages
- [ ] A message sent while the receiver is offline arrives on reconnect
- [ ] No duplicate message when a local send and its Realtime echo race
- [ ] Dismissing a message removes it and preserves its archived file
- [ ] Disappearing set to 24h / 7d / off behaves correctly on both sides
- [ ] An expiring message disappears without a reload

### Links and files

- [ ] A URL in a message is linkified and a preview card loads
- [ ] A URL with no metadata degrades gracefully (no broken card)
- [ ] An unreachable URL degrades gracefully
- [ ] Preview images load through `/preview/image`, never a third-party host
- [ ] Upload a file; B can download it
- [ ] A file over 50 MiB is rejected before upload
- [ ] An interrupted upload reports an error and leaves no half-message
- [ ] An unauthorized user cannot download the file
- [ ] The per-contact file archive lists past files
- [ ] Archive entries survive dismissing the original message
- [ ] The image lightbox opens, closes on Escape, and restores focus

### Camera, video, emoji

- [ ] Photo capture requests camera permission, previews, retakes, and sends
- [ ] Video recording records, auto-stops at 60 s, previews, and sends
- [ ] Denying camera/microphone permission shows an error, not a hang
- [ ] The emoji picker searches, switches categories, and inserts

### Commands and keyboard

- [ ] `/` opens the hint menu; typing filters it
- [ ] Every command in the table above behaves as documented
- [ ] An unknown `/word` reports `okänt kommando`
- [ ] A bare `/` and `/ text` send as normal text
- [ ] Cmd/Ctrl+K, Cmd/Ctrl+`,`, `/`, `?`, Alt+↑/↓ all work
- [ ] Escape closes exactly one overlay, topmost first
- [ ] Bare-key shortcuts do nothing while typing in the composer
- [ ] Focus returns to the trigger after every overlay closes
- [ ] The whole app is operable by keyboard alone

### Settings and preferences

- [ ] All 7 themes apply and survive a reload with no flash of the wrong theme
- [ ] All 5 fonts apply and survive a reload
- [ ] Mute persists across reloads
- [ ] Layout works at mobile, tablet, and desktop widths
- [ ] Reduced-motion is respected

### PWA and offline

- [ ] The app installs from the manifest
- [ ] A second load works offline (cached shell)
- [ ] Cache Storage contains **no** `/config`, `/preview`, Supabase, or private
      file responses
- [ ] Bumping the cache version updates clients without a stuck old bundle
- [ ] Going back online resumes Realtime

## Approved intentional differences

Pre-authorized divergences from the behavior recorded above. Later contract
tests must assert the **new** behavior and cite the entry here.

### AID-1 — Per-hop redirect revalidation (Steps 7, 8, 9)

Today `/preview` and `/preview/image` fetch with `follow_redirects=True`, so
only the *original* URL is validated. A public URL that redirects to
`127.0.0.1`, a link-local address, or `169.254.169.254` is followed. The
SvelteKit implementation validates every hop and every resolved address before
fetching it, and bounds the redirect count.

**Consequence:** redirect chains that currently return 200 will return 400 or
204/404. This is a security fix, not a regression. Any ported test that
encodes the permissive behavior must be updated, not the implementation.

### AID-2 — Incremental body reads (Steps 8, 9)

Today `/preview` decodes the whole body then slices it, and `/preview/image`
reads the entire response into memory before comparing against
`IMAGE_MAX_BYTES` — so a hostile 500 MiB response is fully buffered before
being rejected. The SvelteKit implementation stops reading at the cap and
aborts the upstream response.

**Consequence:** oversized responses are rejected earlier and may return a
different status than the current 404-after-download. Record the chosen status
here when Step 9 implements it.

### AID-3 — Missing `url` query parameter (Steps 8, 9)

FastAPI returns **422** with a `detail` body for a missing `url`. SvelteKit has
no equivalent automatic validation layer. Either status is acceptable provided
it is 4xx and documented; record the chosen status here when Step 8 implements
it, and make the contract test assert that choice rather than 422 by default.

**Chosen, pre-registered by Step 4: `400` with `{ "error": … }`.** This makes a
missing `url` indistinguishable from an invalid one, which is already how every
other rejection on these routes behaves, and leaves the frontend a single error
shape to handle. `src/lib/contract/routes.ts` encodes that choice; Steps 8 and 9
implement it and flip those entries to `done`.

### AID-4 — `/index.html` no longer served as a static asset (Step 2)

Before Step 2 the shell lived at `static/index.html` and was therefore reachable
twice: through the explicit `/` and `/app` routes, and as an ordinary public
asset at `/index.html` (200). Step 2 moved it to `legacy/index.html`, so
`/index.html` now returns **404**.

**Consequence:** the only changed response in the captured contract. `/` and
`/app` are byte-for-byte identical, the file's sha256 is unchanged
(`e0f21ed3…`), so the CSP inline-script hash still matches. Nothing in the
product linked to `/index.html`: `static/sw.js` precaches `/` and `/app`, and
the shell's own asset references are all root-relative. This removes the
collision with SvelteKit's generated root route, which is the entire point of
Step 2.

### AID-5 — 404 response body (Step 4, verified Step 10)

FastAPI answers an unmatched path with **404** and a JSON `{detail}` body, since
every route it serves is an API-style route. SvelteKit renders its **HTML error
page** with the same 404 status.

**Consequence:** only the *status* is contractual. Nothing in the product parses
a 404 body — `static/app.js` never requests an unknown path, and `static/sw.js`
falls back on cached navigations rather than inspecting error bodies. An HTML
404 is also better for the humans who actually hit one. The contract entry for
`/does-not-exist` asserts the status and ignores the body.

### AID-6 — `/sitemap.xml` content type (Step 4)

FastAPI serves `application/xml`; adapter-node's static handler serves
`text/xml`. Both are valid XML media types, and both Google and Bing accept
either for a sitemap.

**Consequence:** none in practice. Forcing `application/xml` would mean adding a
server hook that rewrites the header for one static file, which is more moving
parts than the difference is worth. Verified against `node build/index.js`;
every other route in the captured contract matches FastAPI's content type.

## Features the plan initially missed

Found during this step and since folded into
`docs/SVELTEKIT_MIGRATION_PLAN.md`. Listed here because the baseline is what a
future chat reads to check whether anything was overlooked, and because these
are the surfaces most likely to be forgotten again.

| Surface | Now covered by |
| --- | --- |
| Realtime presence channel | Step 17, with its own teardown and verification |
| Camera capture and video recording | Step 22, a dedicated step |
| Emoji picker | Step 19, alongside the composer |
| Image lightbox | Step 24, in the eight-overlay Escape order |
| Swedish user-facing strings | A migration rule, applying to every step |
| No tracked `.env.example` | Ignore rule fixed; committed in Step 3, verified in Step 29 |
| No frontend test coverage today | Stated in Step 4; the browser suite is greenfield |

The insertion of Step 22 shifted every later step by one: the plan now has 29
steps, and the service worker, QA, cutover, and removal steps are 26 through
29.

## Repository hygiene fixed before Step 2

Four `.gitignore` rules would each have failed silently several steps later.
Fixed ahead of Step 2 because none of them changes application behavior:

| Rule | Problem | Fix |
| --- | --- | --- |
| `.env.*` | swallowed `.env.example`, which Steps 3 and 29 require | added `!.env.example`; `.env` still ignored |
| `package-lock.json` | ignored outright, but Step 5 CI runs `npm ci`, which needs a committed lockfile | rule removed |
| (missing) | `node_modules/`, `/.svelte-kit`, `/build` were not ignored, so Step 3's install would flood `git status` | added |
| `docs/*` + per-file negations | every new doc was ignored unless individually negated, so the Step 12/26/28 deployment and rollback procedures would have vanished | narrowed to `docs/superpowers/` |

The stray 83-byte `package-lock.json` stub on disk is not a real lockfile and
must be replaced during Step 3, not committed as-is.

## SvelteKit toolchain as scaffolded (Step 3)

Generated with the official CLI, `sv@0.17.0`:

```
npx sv create --template minimal --types ts \
    --add sveltekit-adapter="adapter:node" --no-install
```

Versions come from that scaffold, not from `npm view … latest`. The difference
matters: npm's `latest` for TypeScript is **7.x**, but the scaffold pins
`^6.0.3`, and `svelte-check` is built against 6. Do not bump TypeScript to 7
casually — take the version the scaffold gives.

| Package | Range |
| --- | --- |
| `@sveltejs/kit` | `^2.63.0` |
| `@sveltejs/adapter-node` | `^5.5.4` |
| `@sveltejs/vite-plugin-svelte` | `^7.1.2` |
| `svelte` | `^5.56.1` |
| `svelte-check` | `^4.6.0` |
| `typescript` | `^6.0.3` |
| `vite` | `^8.0.16` |

### There is no `svelte.config.js`

Step 3 of the plan called for one, but the current scaffold does not emit it.
Adapter and compiler options now live in the `sveltekit()` plugin inside
`vite.config.ts`:

```ts
sveltekit({
  compilerOptions: { runes: … },
  adapter: adapter()
})
```

Any later step that reaches for `svelte.config.js` — the adapter setup in
Step 12, hooks/CSP in Step 11, `kit.files` or `kit.alias` anywhere — must edit
`vite.config.ts` instead. Svelte 5 **runes mode is forced** for all project
code (not `node_modules`), so ported components use `$props`/`$state`, not the
Svelte 4 store-and-`export let` idiom.

### `static/` is reused, not duplicated

`kit.files.assets` defaults to `static`, which is already this repository's
asset directory, so no configuration was needed. Verified against a real
`npm run build`: all 565 tracked files land in `build/client/` at the same
flattened root paths FastAPI serves them from (`/style.css`, `/app.js`,
`/fonts/…`), plus Brotli and gzip variants. `build/client/index.html` does
**not** exist, confirming Step 2 removed the collision.

The scaffold's `static/robots.txt` was deliberately **not** copied. Anything
added to `static/` is immediately served by the FastAPI static mount too, so it
would have created a new public URL and broken Step 3's no-user-visible-change
rule.

### Known advisory, do not "fix"

`npm audit` reports 3 low-severity findings for `cookie <0.7.0`, reached
transitively through `@sveltejs/kit`. `npm audit fix --force` "resolves" it by
downgrading SvelteKit to **0.0.30**, which is destructive nonsense. Leave it.
Step 5 must not gate CI on a clean `npm audit`.

## Fixture constraints derived from the schema (for Step 4)

Read before designing the two-user fixtures. Every statement below is read off
`supabase/schema.sql`, and each one rules out an approach that looks obvious.

### Accounts can only be created through `auth.signUp`

`profiles` has **no INSERT policy and no DELETE policy** — only SELECT (all
authenticated) and UPDATE (own row). A profile row appears solely via the
`on_auth_user_created` trigger, which reads
`raw_user_meta_data ->> 'username'`. So a seed script signs up with
`options.data.username` and never touches `profiles` directly.

- `username` must match `^[a-z0-9_]{3,20}$` — lowercase, digits, underscore
  only. **No hyphens**, 20 characters maximum. A reserved test prefix has to
  fit inside that budget.
- `profiles_username_lower_idx` makes usernames case-insensitively unique.
- A duplicate signup raises `username_taken` (errcode `P0001`) and the trigger
  aborts the whole transaction, so no orphaned `auth.users` row is left behind.
  An idempotent seed must catch that and fall back to `signInWithPassword`.

### An accepted contact cannot be deleted by anyone

The only DELETE policy on `contacts` is *"Addressee can reject (delete) pending
contacts"* — `addressee_id = auth.uid() and status = 'pending'`. Once a pair is
`accepted`, **neither party can remove it** without a service-role key. The
seeded A↔B relationship is therefore permanent, which is the strongest argument
for durable, reused test accounts rather than fresh ones per run.

### The cheapest idempotent seed is the real invite flow

`redeem_invite` already handles every re-run case: it promotes a pending row,
leaves an accepted row alone, and treats "already contacts" as success. So
A calls `create_invite()`, B calls `redeem_invite(token)`, and running it again
is a friendly no-op. This exercises production RPCs instead of inventing a
parallel setup path.

### Messages are deleted only by `dismiss_ping`, from **both** sides

`pings` has no DELETE policy and no UPDATE policy — deliberately. `dismiss_ping`
sets one per-side flag and hard-deletes the row only when
`dismissed_by_sender` **and** `dismissed_by_receiver` are both true. A cleanup
routine that calls it as one user leaves every row in place, still visible to
the other. Cleanup must authenticate as both accounts.

Deleting the row fires the section 8 `handle_ping_delete` trigger, which removes
the attached storage object. **This no longer means file cleanup is automatic**
— see the correction immediately below.

### Correction (Step 4): uploaded files are *not* cleaned up

An earlier draft of this section stated that file cleanup happens automatically
once both sides dismiss a message. That was read off section 8 alone and is
**wrong for the current schema**, because section 12 supersedes it:

1. `archive_file_ping` copies **every** file ping into `file_archive` on insert.
2. Section 12 redefines `handle_ping_delete` so it deletes the storage object
   only `if not exists (select 1 from public.file_archive where file_path = …)`.
   For any file sent through the app, an archive row always exists, so the
   object is deliberately **kept** when the ping row is deleted.
3. `file_archive` has a SELECT policy and **no DELETE policy**.
4. `storage.objects` has INSERT and SELECT policies for `ping-files` and **no
   DELETE policy**.

So neither the archive row nor the stored object can be removed by any
authorized client. This is correct product behavior — the per-contact archive
is supposed to outlive dismissed messages — but it means fixture cleanup cannot
reclaim uploaded files.

**Consequence for tests:** file-upload tests (Steps 21 and 22) must upload only
small fixture files, on the order of a few hundred bytes. Unlike invite rows,
stored objects cost money and count against project storage, so an unbounded
50 MiB upload test would accumulate permanently.

### Invite rows cannot be deleted at all — resolved

`invites` has SELECT and INSERT policies and **no UPDATE or DELETE policy**.
Nothing a client is authorized to do removes an invite row. They expire after
10 minutes and become invisible, but they accumulate forever.

**Decision (approved by the repository owner, Step 4): accept the
accumulation.** Step 4's requirement that cleanup remove "messages, invites,
and uploaded files" is amended to messages only. Both workarounds are barred by
the migration rules — a cleanup RPC is a schema change, and a service-role key
is forbidden outright — and the rows are tiny, expired, and unreachable. The
same reasoning is extended to uploaded files above, with the size constraint
noted there.

`scripts/e2e-fixtures.ts` states this rather than hiding it: `clean` reports how
many invite rows and archived files it is leaving behind, so the accumulation
stays visible instead of becoming a silent surprise.

### Failure mode that hides all of the above

A PostgREST write blocked by RLS returns **success with zero rows affected**,
not an error. A cleanup script that issues `DELETE FROM pings` will report that
it worked while deleting nothing. Every fixture and cleanup operation must
assert the affected-row count rather than trusting a 2xx.

### Auth email confirmation — checked, and it is ON

Resolved during Step 4 by querying the project's own public settings endpoint:

```
GET {SUPABASE_URL}/auth/v1/settings   (apikey: anon key)
-> { "mailer_autoconfirm": false, "disable_signup": false, … }
```

`mailer_autoconfirm: false` means **Confirm email is enabled**. Therefore
`auth.signUp` returns no session, and a seed script cannot authenticate as an
account it just created.

**Consequence:** the two fixture accounts are created **by hand, once**, and the
seed script only signs in to them. It never calls `signUp`. If it cannot sign
in, it fails with the manual setup instructions rather than trying to work
around the setting.

Re-run that request if the seed ever starts failing for no clear reason: someone
turning confirmation off would change the answer, though the seed does not need
it to be off.

## Two-user fixture strategy (Step 4)

The strategy Steps 15 through 27 build on. Defined here so no test invents its
own account setup.

### The accounts

Two durable, reserved accounts — not ad-hoc sign-ups per run.

| | Username | Why fixed |
| --- | --- | --- |
| A | `ping_e2e_a` | 10 chars, fits `^[a-z0-9_]{3,20}$` |
| B | `ping_e2e_b` | same |

Reserved prefix: `ping_e2e_`. No hyphens — the format check forbids them.

They are **permanent by necessity**, not by preference: `contacts` has no DELETE
policy for accepted rows, so once A and B are contacts the relationship cannot
be undone by any client. Creating fresh accounts per run would leave a growing
trail of undeletable contact pairs.

### One-time manual setup

Because Confirm email is on (above), create both accounts once in the Supabase
dashboard: **Authentication > Users > Add user**, with **Auto Confirm User**
checked, and User Metadata set to `{ "username": "ping_e2e_a" }` and
`{ "username": "ping_e2e_b" }` respectively.

The username must be present at creation: `on_auth_user_created` reads
`raw_user_meta_data ->> 'username'` and aborts the signup without it, so an
account created without metadata gets no profile row at all.

### Credentials

Read from the environment, never committed. Names only:

| Name | Purpose |
| --- | --- |
| `PING_E2E_EMAIL_A` | fixture account A email |
| `PING_E2E_PASSWORD_A` | fixture account A password |
| `PING_E2E_EMAIL_B` | fixture account B email |
| `PING_E2E_PASSWORD_B` | fixture account B password |
| `PING_E2E_USERNAME_A` | optional override, defaults to `ping_e2e_a` |
| `PING_E2E_USERNAME_B` | optional override, defaults to `ping_e2e_b` |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are reused from the application's own
configuration. **No service-role key is involved anywhere in the fixtures.**

### Isolation boundary

These accounts live in the **live Supabase project**. There is no separate test
project and no local Supabase. Therefore:

- A test must never assume an empty database.
- A test must never read, modify, or delete a row it did not create.
- Every assertion must be scoped to the two fixture accounts.

### Seeding

`npm run test:fixtures:seed` signs in as both accounts, verifies each profile
row and username, and ensures the accepted contact relationship using the
**production RPCs** — A calls `create_invite()`, B calls `redeem_invite(token)`.
No parallel setup path exists, so the seed exercises the same code the product
uses.

Idempotent by construction: `redeem_invite` promotes a pending row, leaves an
accepted row alone, and treats "already contacts" as success. When the contact
is already accepted the seed skips the invite entirely.

### Cleanup and its cadence

`npm run test:fixtures:clean` dismisses every message between A and B **as both
accounts**, since `dismiss_ping` hard-deletes a row only once both per-side
flags are set.

**Cadence: on demand, and per suite for suites that write messages.** Not per
test — each cleanup needs two authenticated sessions and a round trip per row,
which would dominate the runtime of a suite that sends a handful of messages.
Not never — messages would otherwise accumulate across runs and break any
assertion about conversation length.

### What fixture cleanup cannot remove

| Data | Why it survives |
| --- | --- |
| `invites` rows | no UPDATE or DELETE policy; expire in 10 minutes, then unreachable |
| `file_archive` rows | SELECT policy only |
| `storage.objects` in `ping-files` | INSERT and SELECT policies only |

Accepted deliberately (see the decision above). The practical rule this places
on later steps: **upload only small fixture files**, since stored objects are
permanent and metered.

### Every mutation asserts its result

A PostgREST write blocked by RLS returns **success with zero rows affected**,
not an error. Both the seed and the cleanup therefore re-read the data and
assert the intended end state rather than trusting a 2xx — for example, after
`redeem_invite` returns `ok`, the seed confirms an accepted contact row is
actually visible to both accounts.

## Test harness (Step 4)

| Command | What it runs |
| --- | --- |
| `npm run test:unit` | Vitest, `src/**/*.{test,spec}.ts` (node) and `src/**/*.svelte.{test,spec}.ts` (browser) |
| `npm run test:e2e` | Playwright, `e2e/**/*.e2e.ts` |
| `npm test` | unit (once) then e2e |
| `npm run check` | `svelte-check` over `src/`, `e2e/`, `scripts/`, and both configs |
| `npm run test:fixtures:seed` | create/repair the two-user fixtures |
| `npm run test:fixtures:clean` | remove messages between the fixture accounts |
| `npm run test:fixtures:check` | report fixture state, change nothing |
| `.venv/bin/python -m pytest -q` | the 38 existing Python tests, kept until Step 29 |

### Recorded run (Step 4, 2026-08-31)

```
npm run check                    416 files, 0 errors, 0 warnings
npm run test:unit -- --run       6 passed (1 file)
npm run test:e2e                 13 passed, 21 skipped (pending, by step)
npm run build                    ok, adapter-node
.venv/bin/python -m pytest -q    38 passed, 1 warning
```

The 21 skips are the pending contract entries, not absent coverage: 12 route
contracts awaiting Steps 6, 8, 9 and 10; 6 security-header assertions awaiting
Step 11; the app-shell smoke test awaiting Step 13; and the two-user test, which
skipped because `PING_E2E_*` were not set in that run.

**With `PING_E2E_*` set but the accounts not yet created, the same suite reports
13 passed, 20 skipped, 1 failed.** That is the intended design, not a
regression — the three states are deliberately distinct:

| Fixture credentials | Result |
| --- | --- |
| absent | skip, with the missing variable names on stderr |
| present but not usable | **fail** — a misconfigured fixture must not pass silently |
| present and usable | run |

Step 5 depends on that middle row: CI without secrets skips loudly, but CI with
*broken* secrets goes red rather than reporting a clean run over an empty suite.

Note that `npm run check` covered **238** files before `tsconfig.json` was
extended and **416** after. The 13 type errors it then found in `e2e/` and
`scripts/` had been invisible.

### Playwright runs against the production server, not `vite preview`

`playwright.config.ts` starts `npm run build && node build/index.js`.

This is **not** interchangeable with the scaffold's `npm run preview`.
`vite preview` serves static files without `ETag` or `Last-Modified`, so the
conditional-request contract recorded in
[Per-route cache headers](#per-route-cache-headers) cannot be tested against it
— the 304 assertion would silently see a 200. adapter-node's server sets both
and answers 304, and it is what Render runs. Steps 11, 12, 26 and 28 depend on
testing the real server.

### Pending versus failing

`src/lib/contract/routes.ts` holds the route contract as data: each entry
records the expected status, content type, body shape, and the migration step
that implements it. `e2e/route-contract.e2e.ts` turns each entry into a test and
marks it `test.fixme` while `done` is false, so unimplemented behavior is
reported as **pending with a named step**, never as a failure.

A later step flips `done: true` for its routes and the real assertions begin
running. Weakening an expectation to make a test pass is not the mechanism —
a genuine divergence belongs in
[Approved intentional differences](#approved-intentional-differences).

`src/lib/contract/routes.spec.ts` guards the table itself: no duplicate paths,
every pending entry carries a step, and nothing may claim `done` for a step that
has not landed.

### The browser suite is greenfield

The 38 Python tests cover link previews only. There is no frontend coverage to
port, so every assertion in `e2e/` is new. The two suites coexist until Step 29.
