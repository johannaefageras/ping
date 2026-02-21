import asyncio
import hashlib
import json
import os
import secrets
import shutil
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import Cookie, FastAPI, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

UPLOAD_DIR = Path(__file__).parent / "uploads"
ROOM_CODE = os.environ.get("ROOM_CODE")
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

# Server-generated secret for signing cookies (new each restart)
_SERVER_SECRET = secrets.token_hex(32)


def _make_token() -> str:
    """Produce a cookie value that proves the client authenticated."""
    return hashlib.sha256((_SERVER_SECRET + (ROOM_CODE or "")).encode()).hexdigest()


def _check_auth(session: str | None) -> bool:
    """Return True if auth is disabled or the session cookie is valid."""
    if not ROOM_CODE:
        return True
    return session is not None and secrets.compare_digest(session, _make_token())


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOAD_DIR.mkdir(exist_ok=True)
    yield
    # Clean up uploads on shutdown
    shutil.rmtree(UPLOAD_DIR, ignore_errors=True)


app = FastAPI(lifespan=lifespan)


# --- Health endpoint ---

@app.get("/health")
async def health():
    return {"status": "ok"}


# --- Auth endpoints ---

@app.get("/auth/check")
async def auth_check(session: str | None = Cookie(default=None)):
    return {"authenticated": _check_auth(session), "required": ROOM_CODE is not None}


@app.post("/auth")
async def auth(request: Request):
    if not ROOM_CODE:
        return {"ok": True}
    body = await request.json()
    code = body.get("code", "")
    if not secrets.compare_digest(code, ROOM_CODE):
        raise HTTPException(status_code=403, detail="Fel kod")
    response = JSONResponse({"ok": True})
    response.set_cookie(
        key="session",
        value=_make_token(),
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        max_age=60 * 60 * 24 * 30,  # 30 days
    )
    return response


# --- WebSocket connection manager ---

class ConnectionManager:
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)
        await self.broadcast_count()

    async def disconnect(self, ws: WebSocket):
        self.connections.remove(ws)
        await self.broadcast_count()

    async def broadcast(self, message: dict, exclude: WebSocket | None = None):
        data = json.dumps(message)
        for conn in self.connections:
            if conn is not exclude:
                try:
                    await conn.send_text(data)
                except Exception:
                    pass

    async def broadcast_count(self):
        msg = {"type": "presence", "count": len(self.connections)}
        data = json.dumps(msg)
        for conn in self.connections:
            try:
                await conn.send_text(data)
            except Exception:
                pass


manager = ConnectionManager()


# --- WebSocket endpoint ---

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    # Check auth before accepting
    session = ws.cookies.get("session")
    if not _check_auth(session):
        await ws.close(code=4003, reason="Unauthorized")
        return

    await manager.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            if data.get("type") == "text":
                message = {
                    "type": "text",
                    "content": data["content"],
                    "timestamp": datetime.now().isoformat(),
                }
                await manager.broadcast(message, exclude=ws)
                # Echo back to sender with a "self" flag
                message["self"] = True
                await ws.send_text(json.dumps(message))
    except WebSocketDisconnect:
        await manager.disconnect(ws)


# --- File upload endpoint ---

@app.post("/upload")
async def upload_file(file: UploadFile, session: str | None = Cookie(default=None)):
    if not _check_auth(session):
        raise HTTPException(status_code=401, detail="Unauthorized")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Filen är för stor (max 50 MB)")

    file_id = uuid.uuid4().hex[:8]
    safe_name = file.filename or "unnamed"
    stored_name = f"{file_id}_{safe_name}"
    dest = UPLOAD_DIR / stored_name

    with open(dest, "wb") as f:
        f.write(content)

    size = len(content)
    message = {
        "type": "file",
        "filename": safe_name,
        "stored_name": stored_name,
        "size": size,
        "timestamp": datetime.now().isoformat(),
    }
    await manager.broadcast(message)
    return {"ok": True, "stored_name": stored_name}


# --- File download endpoint ---

@app.get("/files/{stored_name}")
async def download_file(stored_name: str, session: str | None = Cookie(default=None)):
    if not _check_auth(session):
        raise HTTPException(status_code=401, detail="Unauthorized")

    path = UPLOAD_DIR / stored_name
    if not path.exists() or not path.is_relative_to(UPLOAD_DIR):
        return {"error": "not found"}
    # Extract original filename (strip the uuid prefix)
    original_name = stored_name.split("_", 1)[1] if "_" in stored_name else stored_name
    return FileResponse(path, filename=original_name)


# --- Serve the frontend ---

app.mount("/", StaticFiles(directory="static", html=True), name="static")
