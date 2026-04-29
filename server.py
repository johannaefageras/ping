import os

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError("Missing SUPABASE_URL / SUPABASE_ANON_KEY")

app = FastAPI()


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
