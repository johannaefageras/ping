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
