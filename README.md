# Ping

A tiny web app for sharing texts, links, and files with a friend. No social
media required — sign up, add a contact, and start pinging.

Built as a small project for two people who sit next to each other and just
want a quick way to swap a URL or a file without going through a chat app.

## Features

- Email + password sign-up with username
- Add contacts by username and accept/reject requests
- Send text messages, links, and files to accepted contacts
- Real-time delivery via Supabase Realtime
- Per-side dismiss: each user hides their copy independently; the message and
  any attached file are deleted from storage once both sides dismiss it
- Files stored in a private Supabase Storage bucket — only sender and
  receiver can download them
- Retro terminal aesthetic, Swedish UI

## Stack

- **Backend:** FastAPI (just serves the static frontend and a tiny `/config`
  endpoint that hands the Supabase URL + anon key to the browser)
- **Frontend:** Vanilla HTML/CSS/JS, talks directly to Supabase
- **Database / Auth / Storage / Realtime:** Supabase (Postgres with RLS)

## Project layout

```
server.py               FastAPI app — serves /, /app, /config, /privacy, /terms, static
requirements.txt        Python deps
render.yaml             Render.com deploy config
static/                 Frontend (index.html, app.js, style.css, fonts, icons)
supabase/schema.sql     Full Supabase schema: tables, RLS, triggers, RPC
```

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [supabase/schema.sql](supabase/schema.sql). This
   creates the `profiles`, `contacts`, and `pings` tables, RLS policies, the
   `ping-files` storage bucket, and the `dismiss_ping` RPC.
3. Copy the project URL and the **anon** public key from
   *Project Settings → API*.

### 2. Local environment

Create a `.env` file in the project root:

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
```

Both values are exposed to the browser by `/config`. That's intentional — the
anon key is designed to be public, and access is enforced by Row Level
Security in Postgres.

### 3. Install and run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload
```

Open <http://localhost:8000>.

## Deployment

A [render.yaml](render.yaml) is included for one-click deploy on Render.com.
Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` as environment variables in the
Render dashboard.

Any host that runs Python and serves a single ASGI app works — there's no
state on the backend, so a single small instance is enough.

## Routes

- `/` — public landing page (describes the app, links to privacy/terms)
- `/app` — the app itself (auth screen + chat board)
- `/config` — returns Supabase URL + anon key as JSON
- `/privacy` — Integritetspolicy
- `/terms` — Användarvillkor

## Security model

- The FastAPI server holds no secrets beyond the public anon key. There is no
  service-role key in the backend — it never touches privileged Supabase
  APIs.
- All access control lives in Postgres RLS policies (see
  [supabase/schema.sql](supabase/schema.sql)):
  - Profiles are readable by any authenticated user (so you can search
    usernames), but only the owner can update.
  - Contacts are visible only to the two users involved.
  - Pings are visible only to sender and receiver, and only if that side
    hasn't dismissed them.
  - Sending a ping requires an `accepted` contact link between sender and
    receiver.
  - Files in the `ping-files` storage bucket are readable only if the caller
    is the sender or receiver of a ping that references the object.
- Hard deletion of a ping fires a trigger that also removes the underlying
  storage object, so dismissed files don't leak.

## License

MIT — see [LICENSE](LICENSE).
