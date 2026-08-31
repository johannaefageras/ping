#!/usr/bin/env python3
"""Capture the live FastAPI response contract for the SvelteKit parity baseline.

Starts the real FastAPI app under uvicorn with *placeholder* Supabase values,
requests every public route, and prints a Markdown report of statuses, headers
and JSON shapes. Used to keep docs/SVELTEKIT_PARITY_BASELINE.md derived from
the running server rather than hand-transcribed.

Placeholders are deliberate: the report is committed, so it must never contain
the real project URL or anon key.

Usage:  .venv/bin/python scripts/capture_baseline.py > /tmp/baseline.md
"""

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent

# Placeholder config. server.py refuses to import without these, and both end
# up in the CSP, so fake values keep the captured output publishable.
FAKE_SUPABASE_URL = "https://example.supabase.co"
FAKE_SUPABASE_ANON_KEY = "placeholder-anon-key"

# Headers worth pinning in the parity contract. Everything else (date, server,
# content-length) is noise or environment-specific.
HEADERS_OF_INTEREST = [
    "content-type",
    "cache-control",
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "x-frame-options",
    "permissions-policy",
    "strict-transport-security",
]

# (label, path). Only routes that need no outbound network access, so the
# capture is deterministic and works offline.
ROUTES = [
    ("Landing / app shell", "/"),
    ("App alias", "/app"),
    ("Public Supabase config", "/config"),
    ("Privacy policy", "/privacy"),
    ("Terms", "/terms"),
    ("Preview, bad scheme", "/preview?url=ftp://example.com/x"),
    ("Preview, loopback host", "/preview?url=http://127.0.0.1/"),
    ("Preview, missing param", "/preview"),
    ("Preview image, loopback host", "/preview/image?url=http://127.0.0.1/x.png"),
    ("Preview image, missing param", "/preview/image"),
    ("Static stylesheet", "/style.css"),
    ("Static app script", "/app.js"),
    ("Service worker", "/sw.js"),
    ("Web app manifest", "/assets/manifest/manifest.webmanifest"),
    ("Sitemap", "/sitemap.xml"),
    ("Emoji data", "/data/emoji-data.json"),
    ("Unknown path", "/does-not-exist"),
]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_server(base: str, proc: subprocess.Popen, timeout: float = 25.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise SystemExit(
                f"uvicorn exited early (code {proc.returncode}):\n"
                f"{proc.stdout.read() if proc.stdout else ''}"
            )
        try:
            urlopen(base + "/config", timeout=1).read()
            return
        except HTTPError:
            return  # responding, which is all we need
        except (URLError, OSError):
            time.sleep(0.2)
    raise SystemExit("server did not become ready in time")


def describe_body(status: int, content_type: str, body: bytes) -> str:
    if status == 204 or not body:
        return "_empty_"
    if "json" in content_type:
        try:
            parsed = json.loads(body)
        except ValueError:
            return "_unparseable JSON_"
        if isinstance(parsed, dict):
            # Keys only. Values may be secrets (/config) or huge (emoji data).
            return "JSON object, keys: `" + "`, `".join(sorted(parsed)) + "`"
        if isinstance(parsed, list):
            return f"JSON array, {len(parsed)} entries"
        return f"JSON scalar ({type(parsed).__name__})"
    if "html" in content_type:
        head = body[:400].decode("utf-8", "replace").strip().splitlines()
        first = next((ln.strip() for ln in head if ln.strip()), "")
        return f"HTML, {len(body)} bytes, starts `{first[:60]}`"
    return f"{len(body)} bytes"


def fetch(base: str, path: str) -> dict:
    req = Request(base + path, headers={"User-Agent": "ping-baseline-capture"})
    try:
        with urlopen(req, timeout=10) as resp:
            status, headers, body = resp.status, dict(resp.headers), resp.read()
    except HTTPError as exc:
        status, headers, body = exc.code, dict(exc.headers), exc.read()
    ct = headers.get("content-type", "")
    return {
        "status": status,
        "headers": {k: v for k, v in ((h, headers.get(h)) for h in HEADERS_OF_INTEREST) if v},
        "body": describe_body(status, ct, body),
    }


def main() -> None:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {
        **os.environ,
        "SUPABASE_URL": FAKE_SUPABASE_URL,
        "SUPABASE_ANON_KEY": FAKE_SUPABASE_ANON_KEY,
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        wait_for_server(base, proc)

        print("<!-- Generated by scripts/capture_baseline.py. Do not edit by hand. -->")
        print(f"\nCaptured with `SUPABASE_URL={FAKE_SUPABASE_URL}` and\n"
              f"`SUPABASE_ANON_KEY={FAKE_SUPABASE_ANON_KEY}`.\n")

        results = {}
        for label, path in ROUTES:
            results[path] = (label, fetch(base, path))

        print("| Route | Status | Content-Type | Body |")
        print("| --- | --- | --- | --- |")
        for path, (label, r) in results.items():
            ct = r["headers"].get("content-type", "—")
            print(f"| `{path}` | {r['status']} | `{ct}` | {r['body']} |")

        print("\n### Security headers (identical on every response)\n")
        shared = results["/config"][1]["headers"]
        for h in HEADERS_OF_INTEREST:
            if h in ("content-type", "cache-control"):
                continue
            print(f"- `{h}`: `{shared.get(h, '(absent)')}`")

        print("\n<!-- End generated section. -->")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
