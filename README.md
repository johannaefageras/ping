# Ping

A tiny web app for sharing texts, links, and files with a friend. No social
media required — sign up, add a contact, and start pinging.

Built as a small project for two people who sit next to each other and just
want a quick way to swap a URL or a file without going through a chat app.

## Features

- Email + password sign-up with username
- Add contacts by username and accept/reject requests
- Invite links + QR codes: generate a single-use link (valid 10 min) that
  instantly connects you with whoever scans or opens it — no username needed
- Send text messages, links, and files to accepted contacts
- Slash commands in the composer: `/help`, `/theme`, `/font`, `/clear`,
  `/who`, `/last`, `/mute`, `/unmute`, `/shrug`, with a `/` hint menu
- Keyboard shortcuts: `Cmd/Ctrl+K` contact switcher, `Cmd/Ctrl+,` settings,
  `/` to focus the composer, `Alt+↑/↓` to switch contacts, `Esc` to close the
  topmost overlay, and `?` for a shortcuts cheatsheet
- Real-time delivery via Supabase Realtime
- Durable conversation history: messages persist as a scrollable log with date
  separators and paged scrollback (latest 50, "ladda äldre" for older)
- Read/unread + delivery receipts: per-message sent/delivered/read status, and
  a sidebar unread badge that survives reload
- Delete a message: ✕ removes your copy; exchanged files stay available in the
  per-contact file archive for both participants
- Disappearing messages: per-conversation opt-in timer (av / 24h / 7d, either
  side can set it); expired messages are hidden on load and swept daily
- Files stored in a private Supabase Storage bucket — only sender and
  receiver can download them, including from the per-contact file archive
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
scripts/                Small maintenance/generation scripts
static/                 Frontend shell plus assets, fonts, icons, and pages
supabase/schema.sql     Full Supabase schema: tables, RLS, triggers, RPC
```

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [supabase/schema.sql](supabase/schema.sql). This
   creates the `profiles`, `contacts`, `pings`, `file_archive`, and `invites`
   tables, RLS policies, the `ping-files` storage bucket, and the `dismiss_ping`,
   `mark_read`, `mark_delivered`, `set_disappearing`, `create_invite`, and
   `redeem_invite` RPCs. It also defines `purge_expired_pings()` and a daily
   `pg_cron` sweep for disappearing messages — enable the **pg_cron** extension
   (Database → Extensions) for the sweep to run; without it, expired messages are
   still hidden client-side at load time but not physically purged.
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
  - Archived file entries are visible only to the sender and receiver, and do
    not disappear when either side dismisses the chat message.
  - Sending a ping requires an `accepted` contact link between sender and
    receiver.
  - Files in the `ping-files` storage bucket are readable only if the caller
    is the sender or receiver of a ping or archive row that references the object.
- Hard deletion of a ping keeps archived files intact; storage cleanup runs only
  when no ping or archive row still references the object.

## License

MIT — see [LICENSE](LICENSE).
