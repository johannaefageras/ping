"""Pure helpers for link previews: URL/SSRF validation, HTML metadata
parsing, and a tiny in-memory TTL cache. No FastAPI or HTTP I/O here
(DNS validation aside), so the logic stays unit-testable."""

import ipaddress
import socket
from urllib.parse import urlparse, ParseResult


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
