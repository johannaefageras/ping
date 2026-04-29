import os
from html import escape

from dotenv import load_dotenv
from fastapi import FastAPI, Request

load_dotenv()
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError("Missing SUPABASE_URL / SUPABASE_ANON_KEY")

app = FastAPI()


SITEMAP_PATHS = (
    {"path": "/", "priority": "1.0"},
    {"path": "/app", "priority": "0.8"},
    {"path": "/privacy", "priority": "0.3"},
    {"path": "/terms", "priority": "0.3"},
)


def public_origin(request: Request) -> str:
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get(
        "x-forwarded-host",
        request.headers.get("host", request.url.netloc),
    )
    return f"{scheme.split(',')[0].strip()}://{host.split(',')[0].strip()}"


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


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap(request: Request):
    origin = public_origin(request).rstrip("/")
    urls = "\n".join(
        "  <url>\n"
        f"    <loc>{escape(origin + item['path'])}</loc>\n"
        f"    <priority>{item['priority']}</priority>\n"
        "  </url>"
        for item in SITEMAP_PATHS
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{urls}\n"
        "</urlset>\n"
    )
    return Response(content=xml, media_type="application/xml")


@app.get("/")
async def landing():
    return FileResponse("static/landing.html")


@app.get("/app")
async def app_page():
    return FileResponse("static/index.html")


@app.get("/privacy")
async def privacy():
    return FileResponse("static/privacy.html")


@app.get("/terms")
async def terms():
    return FileResponse("static/terms.html")


app.mount("/", StaticFiles(directory="static", html=True), name="static")
