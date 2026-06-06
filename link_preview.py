"""Pure helpers for link previews: URL/SSRF validation, HTML metadata
parsing, and a tiny in-memory TTL cache. No FastAPI or HTTP I/O here
(DNS validation aside), so the logic stays unit-testable."""

import ipaddress
import socket
import time
from html.parser import HTMLParser
from urllib.parse import urlparse, urljoin, ParseResult


_CGNAT = ipaddress.ip_network("100.64.0.0/10")  # RFC 6598 shared address space


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
        or ip in _CGNAT
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
            # Match the exact "icon" rel token so we don't pick up
            # "apple-touch-icon" / "mask-icon" (which are not the favicon).
            # "shortcut icon" still works since it tokenizes to ["shortcut", "icon"].
            rel = (a.get("rel") or "").lower().split()
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
