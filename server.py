import os

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/config")
async def config():
    """Return Supabase connection info to the frontend.

    These are safe to expose — the anon key is designed to be public
    and security is enforced by RLS policies in the database.
    """
    return JSONResponse({
        "supabaseUrl": os.environ["SUPABASE_URL"],
        "supabaseAnonKey": os.environ["SUPABASE_ANON_KEY"],
    })


app.mount("/", StaticFiles(directory="static", html=True), name="static")
