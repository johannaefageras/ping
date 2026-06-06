import os
import sys
from pathlib import Path

# Make the repo root importable so `import server` / `import link_preview` work.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# server.py reads these at import time and raises if missing.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
