# Link Previews — Design

**Date:** 2026-06-06
**Feature:** Show a compact preview card (title, domain, favicon, optional OG
image) under any text ping that contains a URL.
**Source:** FEATURE_IDEAS.md → "Link previews" (Small / High-Impact; also #2 in
the Recommended First Five).

## Goal

When a text ping contains a URL, render a small preview card beneath the message
showing the page's title, domain, favicon, and (when available) an Open Graph
image. All remote content is fetched and proxied through our own FastAPI backend
so the strict Content-Security-Policy stays unchanged and the viewer's IP never
leaks to arbitrary third-party hosts.

## Constraints & decisions

These were settled during brainstorming:

- **Fetch source:** a new FastAPI endpoint does the fetching/parsing. The
  browser never talks directly to target sites. Keeps `connect-src 'self'`.
- **Persistence:** ephemeral. Previews are fetched fresh when a ping renders.
  No database schema, RLS, or migration changes. Fits Ping's disposable ethos.
- **Images:** proxied through the server so `img-src 'self'` is untouched and no
  remote host sees the viewer's IP.
- **No CSP changes** are needed — the existing `connect-src 'self'` and
  `img-src 'self'` already permit both new same-origin routes. This is the whole
  point of proxying.

## Non-goals (YAGNI)

- No persisted preview metadata in the `pings` table.
- No previews for file pings.
- At most one preview per ping (the first URL found in the content).
- No third-party preview API (microlink/iframely) — avoids cost, rate limits,
  and leaking URLs to a third party.
- No client-side preview cache beyond the server's in-memory cache and HTTP
  cache headers.

## Architecture

Three new server pieces in `server.py`, plus frontend rendering in `app.js` and
styling in `style.css`.

```
Browser (app.js renderPing)
   │  GET /preview?url=<encoded>
   ▼
FastAPI /preview ──── fetch + parse target HTML (httpx)
   │  JSON { title, description, domain, image, favicon, url }
   │  image/favicon rewritten to /preview/image?url=...
   ▼
Browser renders card; <img src="/preview/image?url=...">
   │  GET /preview/image?url=<encoded>
   ▼
FastAPI /preview/image ── fetch + stream a single remote image
```

## Server endpoints (`server.py`)

**New dependency:** `httpx` (async HTTP client) added to `requirements.txt`.
HTML parsing uses the stdlib `html.parser` (no `beautifulsoup4`) to keep the
dependency surface tiny.

### `GET /preview?url=<encoded>`

Returns JSON metadata for a single URL.

1. Validate the `url` query param: must parse and use the `http`/`https` scheme.
   Anything else → `400`.
2. **SSRF guard:** resolve the hostname; reject if it maps to a loopback,
   link-local, private, or otherwise reserved IP range (`127.*`, `::1`,
   `169.254.*`, `10.*`, `172.16/12`, `192.168.*`, etc.) → `400`.
3. Check the in-memory cache (TTL ~10 minutes). On hit, return cached JSON.
4. Fetch with `httpx`: `timeout=5s`, `follow_redirects=True` but **re-validate
   every redirect hop** against the SSRF guard; cap the body at ~512 KB; only
   parse when the `content-type` is HTML.
5. Parse, with fallbacks:
   - title: `og:title` → `twitter:title` → `<title>`
   - description: `og:description` → `<meta name="description">`
   - image: `og:image` → `twitter:image` (optional)
   - favicon: `<link rel="icon">` / `apple-touch-icon` → fall back to
     `/favicon.ico` on the origin
   - domain: the final URL's hostname
   Resolve any relative image/favicon URLs against the final (post-redirect)
   page URL.
6. Rewrite `image` and `favicon` in the response to
   `/preview/image?url=<re-encoded absolute URL>` so the browser only ever
   hits our origin.
7. Cache and return the JSON.
8. On any failure (timeout, non-HTML, network error, or no usable metadata)
   → `204 No Content`, so the client cleanly shows "no preview" and falls back
   to the plain linkified URL.

### `GET /preview/image?url=<encoded>`

Fetches and streams a single remote image.

1. Same scheme + SSRF validation as `/preview` (and re-validate redirect hops).
2. Fetch with `httpx`: `timeout=5s`, cap at ~3 MB; require an `image/*`
   `content-type` (reject otherwise → `400`).
3. Stream the bytes back with the upstream content-type and
   `Cache-Control: public, max-age=86400`.
4. On any error → `404`.

### Shared helpers

- `_validate_public_http_url(url) -> parsed | raises`: scheme check + DNS
  resolution + private/reserved IP rejection. Used by both routes and on each
  redirect hop.
- In-memory TTL cache (simple dict keyed by URL with timestamp); resets on
  restart/deploy, which is acceptable for a single small instance.

## Frontend (`app.js`)

**Hook point:** inside `renderPing`, in the `ping.type === "text"` branch, after
the element is appended (alongside the existing thumb / dismiss wiring near
`app.js:744`).

1. Detect the first URL in `ping.content` using the same `urlRegex` that
   `linkify` uses. If none, do nothing.
2. Append `<a class="link-preview loading" target="_blank" rel="noopener">`
   (the entire card is the link) with a minimal skeleton placeholder.
3. `fetch("/preview?url=" + encodeURIComponent(firstUrl))`:
   - `204` or any error → remove the card silently. The linkified URL in the
     message body still stands on its own.
   - `200` → fill in favicon + domain (one line), title (foreground color),
     optional description (clamped ~2 lines), and the OG image if present. Set
     the card's `href` to the original URL.
4. **Image element:** `<img class="link-preview__image">` pointing at the
   proxied `/preview/image?...` URL returned by the server. On its `error`
   event, hide the image and degrade to a text-only card — mirroring the
   existing CSP-safe "attach onerror in JS" pattern used for file-type icons.
5. **Lifecycle guard:** if `el._dismissed` is set when the fetch resolves, bail
   — the same guard the existing image-thumb code uses, so a preview can't
   attach to a detached node.
6. **Dismiss timer:** unchanged. The existing 20s auto-dismiss for freshly
   received text pings still applies; the preview rides inside the same element
   and disappears with it.

## Styling (`style.css`)

A compact card matching the terminal aesthetic: thin border, monospace, muted
domain line, title in the foreground color, image capped in height with
`object-fit: cover`. Matches the stylesheet's existing CSS-variable and color
conventions.

New classes:
- `.link-preview`
- `.link-preview.loading`
- `.link-preview__image`
- `.link-preview__title`
- `.link-preview__domain`
- `.link-preview__desc`

## Error handling summary

| Situation | Behavior |
| --- | --- |
| Non-http(s) or unparseable URL | `/preview` → `400`; client removes card |
| Private/loopback/reserved target | `/preview` → `400`; client removes card |
| Timeout / network error / non-HTML | `/preview` → `204`; client removes card |
| HTML parsed but no usable metadata | `/preview` → `204`; client removes card |
| Image fetch fails or wrong type | `/preview/image` → `404`/`400`; `<img>` error → hide image, keep text card |
| Ping dismissed mid-fetch | client bails on `el._dismissed`, no DOM attach |

## Testing

- **Server:** unit tests for `_validate_public_http_url` (accept public hosts;
  reject `localhost`, private/reserved IPs, non-http schemes); metadata parsing
  from sample HTML (og tags present, only `<title>`, relative favicon
  resolution, no metadata → 204); image proxy rejects non-image content-types.
- **Manual:** send a ping with a rich URL (has OG image), a bare URL (title
  only), a URL to a non-HTML resource, and a URL that 404s; confirm graceful
  fallback in each case and that no CSP violations appear in the console.

## Affected files

- `server.py` — two new routes + shared SSRF/cache helpers.
- `requirements.txt` — add `httpx`.
- `static/app.js` — preview rendering in `renderPing`.
- `static/style.css` — `.link-preview*` styles.
