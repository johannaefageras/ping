import os
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import FastAPI, Request

load_dotenv()
import httpx
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from link_preview import (
    TTLCache,
    UrlValidationError,
    parse_metadata,
    validate_public_http_url,
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError("Missing SUPABASE_URL / SUPABASE_ANON_KEY")

# The frontend talks directly to Supabase over HTTPS (REST/storage) and a
# websocket (realtime), so both must be allowed by connect-src. Derive the
# wss:// origin from the configured project URL.
_supabase_ws = SUPABASE_URL.replace("https://", "wss://").replace("http://", "ws://")

# sha256 hash of the static inline <script> block (theme bootstrap +
# service-worker registration) in index.html. Allowing it by hash means
# script-src needs no 'unsafe-inline'. If the inline block is edited,
# recompute its hash or the script will be blocked. (privacy.html / terms.html
# load their theme bootstrap from /assets/scripts/theme-init.js, which is
# covered by script-src 'self' and needs no hash.)
_INLINE_SCRIPT_HASHES = "'sha256-3JhmKwxKymAV1oveAZwwL+4vLpjxnFXtDbe6eB+elPY='"

CSP = (
    "default-src 'self'; "
    f"script-src 'self' https://cdn.jsdelivr.net {_INLINE_SCRIPT_HASHES}; "
    "style-src 'self' 'unsafe-inline'; "
    "font-src 'self'; "
    "img-src 'self' data: blob:; "
    "media-src 'self' blob:; "
    f"connect-src 'self' {SUPABASE_URL} {_supabase_ws}; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "geolocation=(), microphone=(self), camera=(self), interest-cohort=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}

app = FastAPI()

# Link-preview fetch limits and cache.
PREVIEW_TIMEOUT = 5.0           # seconds
PREVIEW_MAX_BYTES = 512 * 1024  # 512 KB of HTML
IMAGE_MAX_BYTES = 3 * 1024 * 1024  # 3 MB per proxied image (used by /preview/image)
preview_cache = TTLCache(ttl_seconds=600)  # 10 minutes


def _proxy_image_url(absolute_url: str) -> str:
    return "/preview/image?url=" + quote(absolute_url, safe="")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    return response


@app.get("/config")
async def config():
    """Return Supabase connection info to the frontend.

    These are safe to expose — the anon key is designed to be public
    and security is enforced by RLS policies in the database.
    """
    return JSONResponse({
        "supabaseUrl": SUPABASE_URL,
        "supabaseAnonKey": SUPABASE_ANON_KEY,
    })


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/app")
async def app_page():
    # Alias for "/". Kept so existing links and the OAuth / password-reset
    # redirects (redirectTo: origin + "/app") keep working.
    return FileResponse("static/index.html")


@app.get("/privacy")
async def privacy():
    return FileResponse("static/pages/privacy.html")


@app.get("/terms")
async def terms():
    return FileResponse("static/pages/terms.html")


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


app.mount("/", StaticFiles(directory="static", html=True), name="static")
