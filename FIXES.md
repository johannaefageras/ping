# Ping — Outstanding Fixes

Handoff doc for continuing the bugfix pass started in chat. Issues are ordered roughly by severity. Each entry has the location, the problem, and a suggested approach — but read the surrounding code before implementing, as the suggestions are starting points, not gospel.

## Already done

- **History-deleting timer.** Fixed in [static/app.js:557](static/app.js#L557) by gating the 20s auto-dismiss `setTimeout` on the `animate` flag, so it fires only for freshly-arrived pings, not for history loaded via `loadPings()`.
- **Dismiss race: timer + manual ✕ both fire.** Fixed in [static/app.js:505](static/app.js#L505) by guarding `dismissPing` with an `el._dismissed` flag, storing the timer ID on `el._dismissTimer` so manual dismissal can cancel it, and using `{ once: true }` on the `animationend` listener.
- **Orphaned files in Supabase storage.** Fixed in [supabase/schema.sql](supabase/schema.sql) by adding a `before delete` trigger on `pings` (`handle_ping_delete`) that removes the matching `storage.objects` row from `ping-files` when a `file`-type ping is deleted. Runs as `security definer`, so no caller-side delete policy on `storage.objects` is needed. **Action required:** re-run the schema (or run just the new section 8 block) in the Supabase SQL editor, then verify by deleting a file ping and confirming the object disappears from the Storage UI.
- **Username uniqueness race during signup.** Fixed in [supabase/schema.sql:51](supabase/schema.sql#L51) by adding an `exception when unique_violation then raise 'username_taken'` block to `handle_new_user`. The raise aborts the surrounding transaction, rolling back the `auth.users` insert — so concurrent signups with the same username no longer leave an orphaned auth user. Client-side handling in [static/app.js:164](static/app.js#L164) detects the `username_taken` message and shows "Användarnamnet är redan taget." The optimistic `maybeSingle()` check is retained for instant UX. **Action required:** re-run the schema (or just section 4) in the Supabase SQL editor. **Verify:** open two browser windows, submit the same username concurrently — exactly one signup should succeed, and the other should get the "redan taget" message; afterwards check the Supabase Auth dashboard to confirm only one user exists for that email/username pair (no orphaned auth users). If the message comes through as a generic "Database error saving new user" instead of `username_taken`, the rollback still worked but Supabase swallowed the message — adjust the client-side string match to the actual returned text.
- **`KeyError` on missing env vars.** Fixed in [server.py](server.py) by reading `SUPABASE_URL` and `SUPABASE_ANON_KEY` into module-level constants after `load_dotenv()` and raising `RuntimeError("Missing SUPABASE_URL / SUPABASE_ANON_KEY")` if either is empty. The process now fails to start instead of returning per-request 500s.
- **Password reset redirect edge cases.** Attempted fix in [static/app.js:73](static/app.js#L73): the `PASSWORD_RECOVERY` handler now `await`s `sb.auth.signOut()` before showing the reset screen, and the `!session` branch ignores the resulting `SIGNED_OUT` event while the reset form is visible (so it doesn't drop into `exitApp()`). **Open concern:** `signOut()` may also invalidate the recovery session that `updateUser({ password })` later relies on — in which case password updates would fail. Needs the manual two-email test in the checklist before declaring done; if `updateUser` errors out, we likely need a different approach (e.g. signing out *before* Supabase processes the URL token at init time, rather than inside the `PASSWORD_RECOVERY` handler).
- **Either-party hard-delete of pings.** Switched to per-side soft-delete. Added `dismissed_by_sender` / `dismissed_by_receiver` boolean columns on `pings`; the SELECT RLS policy now hides a row from whichever side has dismissed it. The public DELETE policy is gone — dismissal goes through a new `security definer` RPC `dismiss_ping(p_id uuid)` ([supabase/schema.sql section 9](supabase/schema.sql)) that flips the caller's flag and only hard-deletes the row once both flags are true (firing the existing storage cleanup trigger). Client change in [static/app.js:520](static/app.js#L520): `dismissPing` now calls `sb.rpc("dismiss_ping", { p_id })` instead of `from("pings").delete()`. **Action required:** run the new section 9 block in the Supabase SQL editor (it's idempotent — safe to re-run). **Verify:** open both sides of a chat, have A dismiss a ping → A's copy disappears, B still sees it. Then have B dismiss it → row + (for file pings) the storage object are gone. Receiver's auto-dismiss-on-download path still works the same end-to-end.
- **`loadContacts()` thrash on every incoming ping.** Removed the `loadContacts()` call from the pings realtime callback in [static/app.js](static/app.js) (`subscribeToPings`). It was dead code: the contacts list is rendered in `contacts.created_at` order (relationship creation time), not last-ping recency, so re-fetching on every incoming ping never changed the UI. Remaining behavior on a new ping: render it if the sender's chat is open, then `playPing()`.
- **Two parallel realtime channels.** Merged `pings-incoming` and `contacts-changes` into a single `realtime` channel with three `.on("postgres_changes", ...)` bindings (incoming pings, contacts where you're the addressee, contacts where you're the requester). Replaces `subscribeToPings()` + `subscribeToContactChanges()` with one `subscribeToRealtime()`; `contactsChannel` state is gone, only `realtimeChannel` remains. One websocket subscription instead of two.
- **Dead code / leftover files.**
  - `uploads/` (empty, pre-Supabase leftover, already in [.gitignore](.gitignore), untracked) → directory deleted.
  - `__pycache__/` (held one stale `.pyc`, already in [.gitignore](.gitignore), untracked) → directory deleted.
  - [server.py](server.py) `/health` endpoint → removed. Verified it's unreferenced: [render.yaml](render.yaml) has no `healthCheckPath`, and grep across the repo found only the definition itself.
  - [generate_sound.py](generate_sound.py) — left in place. Its top-of-file docstring already documents its purpose (`"""Generate a short ping sound as a WAV file..."""`), satisfying the "document or move" criterion.

---

## Cleanups (low priority, no behavior change needed)

### 1. Could the Python backend go away entirely?

[server.py](server.py) only exists to inject Supabase config via `/config`. A static host (Cloudflare Pages, Vercel, GitHub Pages) with a build step that templates `config.js` from env vars at deploy time would eliminate the Python runtime. Render free-tier dynos cold-start; static hosts don't. Worth considering if cold-start latency becomes annoying.

This is architectural — discuss with the user before doing it.

---

## Testing checklist

After each fix, manually verify:

- [ ] Open an existing chat with old pings → nothing auto-deletes (regression check on the already-applied fix).
- [ ] Send a text ping → it auto-dismisses after 20s on both sides.
- [ ] Send a file → receiver sees it, can download, then it dismisses for them; sender's copy auto-dismisses on the timer.
- [ ] Click ✕ on a ping that has 1s left on its timer → no duplicate delete, no console error.
- [ ] Two browser windows signing up with the same username concurrently → only one succeeds, the other gets a clean error.
- [ ] Password reset while already logged in as someone else → ends up updating the correct account.
- [ ] One side dismisses a ping → the other side still sees their copy until they dismiss it themselves; only after both have dismissed does the row disappear from the DB and (for file pings) the storage object get cleaned up.

---

## Repo orientation for the next agent

- Backend: [server.py](server.py) — FastAPI, only serves static files and `/config`.
- Frontend: single-file vanilla JS at [static/app.js](static/app.js), HTML at [static/index.html](static/index.html), CSS at [static/style.css](static/style.css). No build step. Supabase JS loaded from CDN.
- DB: [supabase/schema.sql](supabase/schema.sql) is the source of truth for tables, RLS, triggers, and the storage bucket. Run it in the Supabase SQL editor.
- Deploy: [render.yaml](render.yaml) — Render web service, env vars set in the dashboard.
- The app is in Swedish; keep user-facing strings in Swedish when editing.
