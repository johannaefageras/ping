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
    """Patch server.httpx.AsyncClient.get to return a canned response.
    Also bypasses validate_public_http_url so these tests work in environments
    where example.com resolves to a private/loopback address (e.g. /etc/hosts)."""
    from link_preview import UrlValidationError
    from urllib.parse import urlparse

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

    def fake_validate(url):
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise UrlValidationError("invalid")
        return parsed

    monkeypatch.setattr(server.httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr("server.validate_public_http_url", fake_validate)


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
    from link_preview import UrlValidationError
    from urllib.parse import urlparse

    def fake_validate(url):
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise UrlValidationError("invalid")
        return parsed

    async def boom(self, url, *args, **kwargs):
        raise httpx.ConnectError("nope")

    monkeypatch.setattr("server.validate_public_http_url", fake_validate)
    monkeypatch.setattr(server.httpx.AsyncClient, "get", boom)
    r = client.get("/preview", params={"url": "https://example.com/article"})
    assert r.status_code == 204
