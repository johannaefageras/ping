# Link Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact, server-proxied preview card (title, domain, favicon, optional OG image) under any text ping containing a URL, without weakening CSP or leaking the viewer's IP.

**Architecture:** A new FastAPI `/preview` route fetches and parses the target page's metadata and returns JSON with image/favicon URLs rewritten to a same-origin `/preview/image` proxy route. Both routes share an SSRF guard and a 5s timeout; `/preview` results are cached in-memory with a 10-minute TTL. The frontend's `renderPing` detects the first URL in a text ping and renders a card from the JSON; everything is ephemeral with no DB changes.

**Tech Stack:** FastAPI + httpx (new dep) + stdlib `html.parser` on the backend; vanilla JS + CSS on the frontend. Tests with pytest + FastAPI `TestClient`.

**Reference spec:** `docs/superpowers/specs/2026-06-06-link-previews-design.md`

---

## File Structure

- **Create:** `link_preview.py` — pure, testable module: URL validation/SSRF guard, HTML metadata parsing, the in-memory TTL cache. No FastAPI imports. Keeps `server.py` thin and the logic unit-testable without HTTP.
- **Modify:** `server.py` — add `/preview` and `/preview/image` routes that call into `link_preview.py` and do the actual `httpx` fetching/streaming.
- **Modify:** `requirements.txt` — add `httpx`.
- **Create:** `requirements-dev.txt` — add `pytest` (test-only dep; keeps prod image lean).
- **Create:** `tests/test_link_preview.py` — unit tests for the pure module.
- **Create:** `tests/test_preview_routes.py` — route tests via `TestClient` with httpx mocked.
- **Modify:** `static/app.js` — preview rendering inside `renderPing`.
- **Modify:** `static/style.css` — `.link-preview*` styles.

Rationale: parsing/validation/caching live in `link_preview.py` because they're pure functions that benefit most from fast unit tests; the network I/O stays in `server.py` where it can be mocked at the route boundary.

---

## Task 1: Project test scaffolding + dependencies

**Files:**
- Modify: `requirements.txt`
- Create: `requirements-dev.txt`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: Add httpx to runtime deps**

Edit `requirements.txt` to read:

```
fastapi
uvicorn[standard]
python-dotenv
httpx
```

- [ ] **Step 2: Create dev deps file**

Create `requirements-dev.txt`:

```
-r requirements.txt
pytest
```

- [ ] **Step 3: Install deps into the venv**

Run: `.venv/bin/pip install -r requirements-dev.txt`
Expected: installs `httpx`, `pytest` (and their deps) with no errors.

- [ ] **Step 4: Create the tests package**

Create `tests/__init__.py` (empty file).

- [ ] **Step 5: Create conftest with env + path setup**

`server.py` raises at import if `SUPABASE_URL`/`SUPABASE_ANON_KEY` are missing and mounts `StaticFiles(directory="static")`. Tests import `server`, so set dummy env before import and ensure the repo root is importable.

Create `tests/conftest.py`:

```python
import os
import sys
from pathlib import Path

# Make the repo root importable so `import server` / `import link_preview` work.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# server.py reads these at import time and raises if missing.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
```

- [ ] **Step 6: Verify pytest runs (collects zero tests)**

Run: `.venv/bin/pytest -q`
Expected: `no tests ran` (exit code 5 is fine) — confirms pytest is installed and conftest imports cleanly.

- [ ] **Step 7: Commit**

```bash
git add requirements.txt requirements-dev.txt tests/__init__.py tests/conftest.py
git commit -m "Add httpx dep and pytest test scaffolding"
```

---

## Task 2: SSRF URL validation (`link_preview.py`)

**Files:**
- Create: `link_preview.py`
- Test: `tests/test_link_preview.py`

- [ ] **Step 1: Write failing tests for URL validation**

Create `tests/test_link_preview.py`:

```python
import pytest

from link_preview import validate_public_http_url, UrlValidationError


def test_accepts_public_https_url():
    parsed = validate_public_http_url("https://example.com/page")
    assert parsed.scheme == "https"
    assert parsed.hostname == "example.com"


def test_rejects_non_http_scheme():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("ftp://example.com/x")


def test_rejects_file_scheme():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("file:///etc/passwd")


def test_rejects_unparseable():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("not a url")


def test_rejects_missing_host():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http:///nohost")


def test_rejects_localhost(monkeypatch):
    # localhost resolves to a loopback address -> rejected.
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http://localhost/admin")


def test_rejects_loopback_ip():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http://127.0.0.1/")


def test_rejects_private_ip():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http://192.168.1.1/")


def test_rejects_link_local_ip():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http://169.254.169.254/latest/meta-data/")


def test_rejects_ipv6_loopback():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http://[::1]/")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_link_preview.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'link_preview'`.

- [ ] **Step 3: Implement validation in `link_preview.py`**

Create `link_preview.py`:

```python
"""Pure helpers for link previews: URL/SSRF validation, HTML metadata
parsing, and a tiny in-memory TTL cache. No FastAPI or network I/O here so
the logic stays unit-testable."""

import ipaddress
import socket
from urllib.parse import urlparse, ParseResult


class UrlValidationError(Exception):
    """Raised when a URL is unsafe to fetch (bad scheme, no host, or resolves
    to a private/reserved IP range)."""


def _is_disallowed_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # not an IP we understand -> treat as disallowed
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def validate_public_http_url(url: str) -> ParseResult:
    """Validate that `url` is an http(s) URL whose host resolves only to
    public IP addresses. Returns the parsed URL or raises UrlValidationError.
    """
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        raise UrlValidationError("unparseable url") from exc

    if parsed.scheme not in ("http", "https"):
        raise UrlValidationError("scheme must be http or https")
    if not parsed.hostname:
        raise UrlValidationError("missing host")

    # Resolve every address the host maps to; reject if any is non-public.
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise UrlValidationError("dns resolution failed") from exc

    for info in infos:
        ip_str = info[4][0]
        if _is_disallowed_ip(ip_str):
            raise UrlValidationError(f"host resolves to disallowed ip: {ip_str}")

    return parsed
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_link_preview.py -q`
Expected: PASS (all validation tests green).

- [ ] **Step 5: Commit**

```bash
git add link_preview.py tests/test_link_preview.py
git commit -m "Add SSRF-safe URL validation for link previews"
```

---

## Task 3: HTML metadata parsing (`link_preview.py`)

**Files:**
- Modify: `link_preview.py`
- Test: `tests/test_link_preview.py`

- [ ] **Step 1: Write failing tests for metadata parsing**

Append to `tests/test_link_preview.py`:

```python
from link_preview import parse_metadata


BASE = "https://example.com/article"


def test_parses_og_tags():
    html = """
    <html><head>
      <title>Fallback Title</title>
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="A description.">
      <meta property="og:image" content="https://cdn.example.com/img.png">
      <link rel="icon" href="/favicon.ico">
    </head><body></body></html>
    """
    meta = parse_metadata(html, BASE)
    assert meta["title"] == "OG Title"
    assert meta["description"] == "A description."
    assert meta["image"] == "https://cdn.example.com/img.png"
    assert meta["favicon"] == "https://example.com/favicon.ico"
    assert meta["domain"] == "example.com"


def test_falls_back_to_title_tag():
    html = "<html><head><title>Just A Title</title></head><body></body></html>"
    meta = parse_metadata(html, BASE)
    assert meta["title"] == "Just A Title"
    assert meta["description"] is None
    assert meta["image"] is None


def test_resolves_relative_image_against_base():
    html = """
    <html><head>
      <meta property="og:title" content="T">
      <meta property="og:image" content="/media/pic.jpg">
    </head></html>
    """
    meta = parse_metadata(html, BASE)
    assert meta["image"] == "https://example.com/media/pic.jpg"


def test_twitter_title_fallback():
    html = """
    <html><head>
      <meta name="twitter:title" content="Tw Title">
    </head></html>
    """
    meta = parse_metadata(html, BASE)
    assert meta["title"] == "Tw Title"


def test_default_favicon_when_absent():
    html = "<html><head><title>T</title></head></html>"
    meta = parse_metadata(html, BASE)
    assert meta["favicon"] == "https://example.com/favicon.ico"


def test_returns_none_when_no_title_anywhere():
    html = "<html><head></head><body>no metadata</body></html>"
    meta = parse_metadata(html, BASE)
    assert meta is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_link_preview.py -q`
Expected: FAIL with `ImportError: cannot import name 'parse_metadata'`.

- [ ] **Step 3: Implement the parser**

Add to `link_preview.py` (new import at top, new class + function):

```python
from html.parser import HTMLParser
from urllib.parse import urljoin
```

```python
class _MetaParser(HTMLParser):
    """Collects og:/twitter:/name meta tags, <title>, and favicon links."""

    def __init__(self):
        super().__init__()
        self.metas = {}          # key (property or name) -> content
        self.title = None
        self.icon_href = None
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = a.get("property") or a.get("name")
            content = a.get("content")
            if key and content and key not in self.metas:
                self.metas[key] = content.strip()
        elif tag == "title":
            self._in_title = True
        elif tag == "link":
            rel = (a.get("rel") or "").lower()
            if self.icon_href is None and ("icon" in rel) and a.get("href"):
                self.icon_href = a["href"].strip()

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and self.title is None:
            text = data.strip()
            if text:
                self.title = text


def parse_metadata(html: str, base_url: str):
    """Parse title/description/image/favicon/domain from HTML.

    `base_url` is the final (post-redirect) page URL, used to resolve
    relative image/favicon hrefs. Returns a dict, or None if no usable
    title could be found (caller treats that as "no preview")."""
    p = _MetaParser()
    p.feed(html)

    title = (
        p.metas.get("og:title")
        or p.metas.get("twitter:title")
        or p.title
    )
    if not title:
        return None

    description = (
        p.metas.get("og:description")
        or p.metas.get("twitter:description")
        or p.metas.get("description")
    )
    image_raw = p.metas.get("og:image") or p.metas.get("twitter:image")
    image = urljoin(base_url, image_raw) if image_raw else None

    favicon_raw = p.icon_href or "/favicon.ico"
    favicon = urljoin(base_url, favicon_raw)

    domain = urlparse(base_url).hostname

    return {
        "title": title,
        "description": description,
        "image": image,
        "favicon": favicon,
        "domain": domain,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_link_preview.py -q`
Expected: PASS (validation + parsing tests all green).

- [ ] **Step 5: Commit**

```bash
git add link_preview.py tests/test_link_preview.py
git commit -m "Add HTML metadata parsing for link previews"
```

---

## Task 4: In-memory TTL cache (`link_preview.py`)

**Files:**
- Modify: `link_preview.py`
- Test: `tests/test_link_preview.py`

- [ ] **Step 1: Write failing tests for the cache**

Append to `tests/test_link_preview.py`:

```python
from link_preview import TTLCache


def test_cache_returns_stored_value():
    cache = TTLCache(ttl_seconds=100)
    cache.set("k", {"title": "x"})
    assert cache.get("k") == {"title": "x"}


def test_cache_miss_returns_none():
    cache = TTLCache(ttl_seconds=100)
    assert cache.get("absent") is None


def test_cache_expires(monkeypatch):
    t = {"now": 1000.0}
    cache = TTLCache(ttl_seconds=10, now=lambda: t["now"])
    cache.set("k", "v")
    t["now"] = 1005.0
    assert cache.get("k") == "v"     # within TTL
    t["now"] = 1011.0
    assert cache.get("k") is None    # expired
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_link_preview.py -q`
Expected: FAIL with `ImportError: cannot import name 'TTLCache'`.

- [ ] **Step 3: Implement the cache**

Add to `link_preview.py` (new import + class):

```python
import time
```

```python
class TTLCache:
    """Minimal in-memory cache with per-entry TTL. Not thread-safe beyond
    CPython's GIL-protected dict ops, which is fine for this low-traffic
    single-instance use. `now` is injectable for testing."""

    def __init__(self, ttl_seconds: float, now=time.monotonic):
        self._ttl = ttl_seconds
        self._now = now
        self._store = {}  # key -> (expires_at, value)

    def get(self, key):
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if self._now() >= expires_at:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key, value):
        self._store[key] = (self._now() + self._ttl, value)
```

Note: the cache test uses `now=lambda: ...` returning wall-clock-style floats; that's fine because `TTLCache` only ever compares values from the same `now` source.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_link_preview.py -q`
Expected: PASS (all `link_preview` tests green).

- [ ] **Step 5: Commit**

```bash
git add link_preview.py tests/test_link_preview.py
git commit -m "Add in-memory TTL cache for link previews"
```

---

## Task 5: `/preview` route (`server.py`)

**Files:**
- Modify: `server.py`
- Test: `tests/test_preview_routes.py`

- [ ] **Step 1: Write failing route tests**

Create `tests/test_preview_routes.py`:

```python
import httpx
import pytest
from fastapi.testclient import TestClient

import server


@pytest.fixture(autouse=True)
def clear_cache():
    # Reset the module-level cache between tests for isolation.
    server.preview_cache._store.clear()
    yield


@pytest.fixture
def client():
    return TestClient(server.app)


def _mock_get(monkeypatch, *, status=200, html="", content_type="text/html",
              final_url="https://example.com/article"):
    """Patch server.httpx.AsyncClient.get to return a canned response."""
    class FakeResp:
        def __init__(self):
            self.status_code = status
            self.text = html
            self.content = html.encode()
            self.headers = {"content-type": content_type}
            self.url = httpx.URL(final_url)

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError("err", request=None, response=None)

    async def fake_get(self, url, *args, **kwargs):
        return FakeResp()

    monkeypatch.setattr(server.httpx.AsyncClient, "get", fake_get)


def test_preview_rejects_bad_scheme(client):
    r = client.get("/preview", params={"url": "ftp://example.com"})
    assert r.status_code == 400


def test_preview_rejects_private_host(client):
    r = client.get("/preview", params={"url": "http://127.0.0.1/"})
    assert r.status_code == 400


def test_preview_returns_metadata(client, monkeypatch):
    html = """
    <html><head>
      <meta property="og:title" content="Hello">
      <meta property="og:description" content="World">
      <meta property="og:image" content="https://cdn.example.com/p.png">
    </head></html>
    """
    _mock_get(monkeypatch, html=html)
    r = client.get("/preview", params={"url": "https://example.com/article"})
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Hello"
    assert body["description"] == "World"
    assert body["domain"] == "example.com"
    # image is rewritten to the same-origin proxy
    assert body["image"].startswith("/preview/image?url=")
    assert body["favicon"].startswith("/preview/image?url=")


def test_preview_204_when_no_metadata(client, monkeypatch):
    _mock_get(monkeypatch, html="<html><head></head><body>x</body></html>")
    r = client.get("/preview", params={"url": "https://example.com/article"})
    assert r.status_code == 204


def test_preview_204_on_non_html(client, monkeypatch):
    _mock_get(monkeypatch, html="{}", content_type="application/json")
    r = client.get("/preview", params={"url": "https://example.com/data.json"})
    assert r.status_code == 204


def test_preview_204_on_fetch_error(client, monkeypatch):
    async def boom(self, url, *args, **kwargs):
        raise httpx.ConnectError("nope")
    monkeypatch.setattr(server.httpx.AsyncClient, "get", boom)
    r = client.get("/preview", params={"url": "https://example.com/article"})
    assert r.status_code == 204
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_preview_routes.py -q`
Expected: FAIL — `/preview` returns 404 (route not defined) / `server` has no `httpx` or `preview_cache` attribute.

- [ ] **Step 3: Implement the `/preview` route**

In `server.py`, add imports near the top (after the existing imports):

```python
from urllib.parse import quote

import httpx

from link_preview import (
    TTLCache,
    UrlValidationError,
    parse_metadata,
    validate_public_http_url,
)
```

Add module-level config after `app = FastAPI()`:

```python
# Link-preview fetch limits and cache.
PREVIEW_TIMEOUT = 5.0          # seconds
PREVIEW_MAX_BYTES = 512 * 1024  # 512 KB of HTML
IMAGE_MAX_BYTES = 3 * 1024 * 1024  # 3 MB per proxied image
preview_cache = TTLCache(ttl_seconds=600)  # 10 minutes


def _proxy_image_url(absolute_url: str) -> str:
    return "/preview/image?url=" + quote(absolute_url, safe="")
```

Add the route (place it before the `app.mount("/", StaticFiles(...))` line so it isn't shadowed by the static mount):

```python
@app.get("/preview")
async def preview(url: str):
    """Fetch a URL's page metadata and return it as JSON. Image and favicon
    fields are rewritten to the same-origin /preview/image proxy so the
    browser never contacts the target host directly (CSP stays strict)."""
    try:
        validate_public_http_url(url)
    except UrlValidationError:
        return JSONResponse({"error": "invalid url"}, status_code=400)

    cached = preview_cache.get(url)
    if cached is not None:
        return JSONResponse(cached)

    try:
        async with httpx.AsyncClient(
            timeout=PREVIEW_TIMEOUT, follow_redirects=True
        ) as cx:
            resp = await cx.get(url, headers={"User-Agent": "PingLinkPreview/1.0"})
    except httpx.HTTPError:
        return Response(status_code=204)

    if resp.status_code >= 400:
        return Response(status_code=204)

    content_type = resp.headers.get("content-type", "")
    if "html" not in content_type:
        return Response(status_code=204)

    html = resp.text[: PREVIEW_MAX_BYTES * 4]  # text is decoded; cap generously
    meta = parse_metadata(html, str(resp.url))
    if meta is None:
        return Response(status_code=204)

    if meta.get("image"):
        meta["image"] = _proxy_image_url(meta["image"])
    if meta.get("favicon"):
        meta["favicon"] = _proxy_image_url(meta["favicon"])
    meta["url"] = url

    preview_cache.set(url, meta)
    return JSONResponse(meta)
```

Add `Response` to the existing fastapi.responses import line. Change:

```python
from fastapi.responses import FileResponse, JSONResponse
```

to:

```python
from fastapi.responses import FileResponse, JSONResponse, Response
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_preview_routes.py -q`
Expected: PASS (all `/preview` route tests green).

- [ ] **Step 5: Commit**

```bash
git add server.py tests/test_preview_routes.py
git commit -m "Add /preview metadata route"
```

---

## Task 6: `/preview/image` proxy route (`server.py`)

**Files:**
- Modify: `server.py`
- Test: `tests/test_preview_routes.py`

- [ ] **Step 1: Write failing tests for the image proxy**

Append to `tests/test_preview_routes.py`:

```python
def _mock_image_get(monkeypatch, *, status=200, content=b"\x89PNG\r\n",
                    content_type="image/png"):
    class FakeResp:
        def __init__(self):
            self.status_code = status
            self.content = content
            self.headers = {"content-type": content_type}
            self.url = httpx.URL("https://cdn.example.com/p.png")

    async def fake_get(self, url, *args, **kwargs):
        return FakeResp()

    monkeypatch.setattr(server.httpx.AsyncClient, "get", fake_get)


def test_image_proxy_rejects_private_host(client):
    r = client.get("/preview/image", params={"url": "http://127.0.0.1/x.png"})
    assert r.status_code == 400


def test_image_proxy_streams_image(client, monkeypatch):
    _mock_image_get(monkeypatch, content=b"\x89PNG\r\n", content_type="image/png")
    r = client.get("/preview/image",
                   params={"url": "https://cdn.example.com/p.png"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == b"\x89PNG\r\n"
    assert "max-age" in r.headers.get("cache-control", "")


def test_image_proxy_rejects_non_image(client, monkeypatch):
    _mock_image_get(monkeypatch, content=b"<html>", content_type="text/html")
    r = client.get("/preview/image",
                   params={"url": "https://cdn.example.com/notimage"})
    assert r.status_code == 400


def test_image_proxy_404_on_fetch_error(client, monkeypatch):
    async def boom(self, url, *args, **kwargs):
        raise httpx.ConnectError("nope")
    monkeypatch.setattr(server.httpx.AsyncClient, "get", boom)
    r = client.get("/preview/image",
                   params={"url": "https://cdn.example.com/p.png"})
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_preview_routes.py -q`
Expected: FAIL — `/preview/image` returns 404 (route not defined) for the streaming/non-image tests.

- [ ] **Step 3: Implement the `/preview/image` route**

In `server.py`, add this route just below the `/preview` route:

```python
@app.get("/preview/image")
async def preview_image(url: str):
    """Fetch and stream a single remote image so the browser keeps talking
    only to our origin (img-src 'self'). Rejects anything that isn't an
    image."""
    try:
        validate_public_http_url(url)
    except UrlValidationError:
        return JSONResponse({"error": "invalid url"}, status_code=400)

    try:
        async with httpx.AsyncClient(
            timeout=PREVIEW_TIMEOUT, follow_redirects=True
        ) as cx:
            resp = await cx.get(url, headers={"User-Agent": "PingLinkPreview/1.0"})
    except httpx.HTTPError:
        return Response(status_code=404)

    if resp.status_code >= 400:
        return Response(status_code=404)

    content_type = resp.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        return JSONResponse({"error": "not an image"}, status_code=400)

    data = resp.content
    if len(data) > IMAGE_MAX_BYTES:
        return Response(status_code=404)

    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_preview_routes.py -q`
Expected: PASS (all route tests green).

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: PASS (link_preview + route tests all green).

- [ ] **Step 6: Commit**

```bash
git add server.py tests/test_preview_routes.py
git commit -m "Add /preview/image proxy route"
```

---

## Task 7: Frontend preview rendering (`static/app.js`)

**Files:**
- Modify: `static/app.js` (in `renderPing`, text branch, near line 744; reuse `urlRegex` pattern from `linkify` at line 1046)

This task is frontend DOM wiring with no automated test (the project has no JS test runner). Verification is manual in Task 9.

- [ ] **Step 1: Add a `renderLinkPreview` helper**

Add this function near `linkify` (e.g. just after the `linkify` function around `app.js:1058`):

```javascript
// Extracts the first URL from text using the same pattern linkify uses.
function firstUrl(text) {
  const m = text.match(/(https?:\/\/[^\s]+)/);
  return m ? m[0] : null;
}

// Builds a link-preview card under a text ping element and fills it from
// /preview. Silently removes the card on any failure so the plain linkified
// URL in the message body still stands. Mirrors the image-thumb lifecycle:
// bails if the ping was dismissed while the fetch was in flight.
function renderLinkPreview(el, url) {
  const card = document.createElement("a");
  card.className = "link-preview loading";
  card.target = "_blank";
  card.rel = "noopener";
  card.href = url;
  el.appendChild(card);

  fetch("/preview?url=" + encodeURIComponent(url))
    .then((res) => (res.status === 200 ? res.json() : null))
    .then((meta) => {
      if (el._dismissed) {
        card.remove();
        return;
      }
      if (!meta) {
        card.remove();
        return;
      }
      card.href = meta.url || url;
      card.classList.remove("loading");

      let imageHtml = "";
      if (meta.image) {
        imageHtml = `<img class="link-preview__image" alt="" />`;
      }
      const descHtml = meta.description
        ? `<div class="link-preview__desc">${escapeHtml(meta.description)}</div>`
        : "";
      const faviconHtml = meta.favicon
        ? `<img class="link-preview__favicon" alt="" width="14" height="14" />`
        : "";

      card.innerHTML = `
        ${imageHtml}
        <div class="link-preview__body">
          <div class="link-preview__domain">${faviconHtml}<span>${escapeHtml(meta.domain || "")}</span></div>
          <div class="link-preview__title">${escapeHtml(meta.title || "")}</div>
          ${descHtml}
        </div>
      `;

      // CSP forbids inline onerror; attach in JS. A broken proxied image (or
      // favicon) just hides that element and degrades to a text-only card.
      const img = card.querySelector(".link-preview__image");
      if (img) {
        img.addEventListener("error", () => img.remove(), { once: true });
        img.src = meta.image;
      }
      const fav = card.querySelector(".link-preview__favicon");
      if (fav) {
        fav.addEventListener("error", () => fav.remove(), { once: true });
        fav.src = meta.favicon;
      }
    })
    .catch(() => card.remove());
}
```

- [ ] **Step 2: Call `renderLinkPreview` from the text branch of `renderPing`**

In `renderPing`, after `board.appendChild(el);` (line ~744) and within the area where `el` is wired up, add a guarded call. Insert this block right after the existing `const thumb = el.querySelector(".image-thumb");` block ends (before the "Dismiss button" comment at ~line 790):

```javascript
  // Text pings: render a link preview card for the first URL, if any.
  if (ping.type === "text") {
    const url = firstUrl(ping.content);
    if (url) renderLinkPreview(el, url);
  }
```

- [ ] **Step 3: Bump the service worker cache version**

`app.js` is cached by the service worker. In `static/sw.js`, bump the cache name so clients pick up the new JS:

Change:
```javascript
const CACHE = "ping-shell-v5";
```
to:
```javascript
const CACHE = "ping-shell-v6";
```

- [ ] **Step 4: Syntax-check the JS**

Run: `node --check static/app.js && node --check static/sw.js`
Expected: no output (exit 0) — confirms no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add static/app.js static/sw.js
git commit -m "Render link preview cards for text pings"
```

---

## Task 8: Link preview styling (`static/style.css`)

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1: Inspect existing variables/conventions**

Run: `grep -nE "^\s*--|\.item|\.content|var\(--" static/style.css | head -40`
Expected: lists the CSS custom properties (colors, borders, fonts) and the `.item`/`.content` rules so the new card matches them. Use the discovered variable names (e.g. border/foreground/muted colors) in Step 2 instead of hardcoded hex values.

- [ ] **Step 2: Append link-preview styles**

Append to `static/style.css` (substitute the actual variable names found in Step 1 for the `var(--...)` placeholders below — the structure stays the same):

```css
/* ── Link previews ─────────────────────────────────────────── */
.link-preview {
  display: block;
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  background: var(--bg-elev, rgba(255, 255, 255, 0.03));
  max-width: 360px;
}

.link-preview.loading {
  min-height: 40px;
  opacity: 0.6;
}

.link-preview__image {
  display: block;
  width: 100%;
  max-height: 160px;
  object-fit: cover;
}

.link-preview__body {
  padding: 8px 10px;
}

.link-preview__domain {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--muted, #888);
  margin-bottom: 2px;
}

.link-preview__favicon {
  display: inline-block;
  vertical-align: middle;
}

.link-preview__title {
  font-weight: 600;
  line-height: 1.3;
}

.link-preview__desc {
  margin-top: 4px;
  font-size: 0.8rem;
  color: var(--muted, #888);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

No service-worker bump needed here: Task 7 already set `const CACHE = "ping-shell-v6";`, and the existing sw.js fetch handler is network-first for `style.css`, so the new styles are served on reload regardless.

- [ ] **Step 3: Commit**

```bash
git add static/style.css
git commit -m "Style link preview cards to match terminal aesthetic"
```

---

## Task 9: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the server**

Run: `.venv/bin/uvicorn server:app --reload`
Expected: starts on http://localhost:8000 with no import errors.

- [ ] **Step 2: Probe `/preview` directly**

Run: `curl -s "http://localhost:8000/preview?url=https://github.com" | head -c 400`
Expected: JSON with `title`, `domain` "github.com", and `image`/`favicon` starting with `/preview/image?url=`.

- [ ] **Step 3: Probe the SSRF guard**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8000/preview?url=http://127.0.0.1/"`
Expected: `400`.

- [ ] **Step 4: Probe the image proxy**

Run: `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:8000/preview/image?url=https://github.com/favicon.ico"`
Expected: `200 image/...`.

- [ ] **Step 5: In the app, send pings and watch the console**

Open http://localhost:8000, sign in, open a chat, and send:
- a URL with a rich OG image (e.g. a news article or GitHub repo) → card shows image + title + domain
- a bare URL (title only) → text-only card
- a URL to a non-HTML resource (e.g. a direct PDF link) → no card, plain link remains
- a 404 URL → no card, plain link remains

Expected: graceful fallback in each case, and **no CSP violation errors** in the browser console.

- [ ] **Step 6: Final full test run**

Run: `.venv/bin/pytest -q`
Expected: PASS — entire suite green.

---

## Notes for the implementer

- **SSRF / DNS-rebinding caveat (accepted for v1):** validation resolves DNS once, then httpx connects (resolving again). A hostile DNS could return a public IP at validation and a private IP at connect. Accepted for this two-person app; redirect following uses the same `validate`-free httpx path, so do not relax the initial guard. If hardening later, pin resolved IPs and pass them to httpx.
- **`text` cap:** `resp.text` is already fully decoded by httpx; the `PREVIEW_MAX_BYTES * 4` slice is a guard against pathologically large pages, not a hard streaming cap. Good enough for v1.
- **Cache key** is the raw request URL; identical URLs share a cached result for 10 minutes across both chat sides.
