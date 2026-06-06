import socket as _socket

import pytest

from link_preview import validate_public_http_url, UrlValidationError, _is_disallowed_ip


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


def test_rejects_relative_url():
    # urlparse succeeds but yields an empty scheme -> rejected by scheme check.
    with pytest.raises(UrlValidationError):
        validate_public_http_url("not a url")


def test_rejects_malformed_ipv6_host():
    # A malformed IPv6 literal makes urlparse raise ValueError, which the
    # validator must translate into UrlValidationError.
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http://[invalid_ipv6]/")


def test_rejects_missing_host():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http:///nohost")


def test_rejects_localhost():
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


def test_rejects_cgnat_ip():
    with pytest.raises(UrlValidationError):
        validate_public_http_url("http://100.64.0.1/")


def test_dns_failure_raises(monkeypatch):
    def boom(*a, **k):
        raise _socket.gaierror("no dns")
    monkeypatch.setattr("link_preview.socket.getaddrinfo", boom)
    with pytest.raises(UrlValidationError):
        validate_public_http_url("https://example.com/")


def test_is_disallowed_ip_rejects_non_ip():
    assert _is_disallowed_ip("not-an-ip") is True
