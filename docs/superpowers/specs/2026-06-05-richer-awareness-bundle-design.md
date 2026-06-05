# Ping — "Richer Awareness" feature bundle

**Date:** 2026-06-05
**Status:** Approved design, ready for implementation planning

## Overview

Four small, related client-side features that make Ping more informative at a
glance without changing its character. None requires a backend secret, a build
step, or breaking the "all access control lives in Postgres RLS" model. They are
delivered in one bundle because they share a theme (passive awareness) and touch
overlapping code (`renderPing`, the contact list, the realtime subscription).

The four features:

1. **Colored SVG file-type icons** — replace the monochrome icon-font file
   glyphs with full-color per-extension SVGs.
2. **Inline image previews** — image pings show a clickable thumbnail that opens
   in an in-app lightbox.
3. **Unread badges** — a per-contact count of pings that arrived while that chat
   was closed, in the current session.
4. **Presence** — a live online/offline dot per contact via Supabase Realtime
   presence.

**Out of scope (documented fast-follows):**
- Video poster frames (extracting a frame requires downloading the whole video,
  which fights the private-bucket + auto-dismiss model). Video files get their
  colored type icon, no poster.
- Persisted/cross-device unread state, "last seen" timestamps, typing indicators.

## Constraints & existing architecture

- Vanilla JS in [static/app.js](../../../static/app.js), no build step, no
  framework, no bundler. Supabase JS from a pinned CDN.
- File icons today: an **icon font** (`Ping Icons`) mapped by class in
  [static/icons.css](../../../static/icons.css); `fileTypeIcon(name)` returns a
  class string; `renderPing()` emits `<i class="pi-file-x">`.
- Files live in a **private** Supabase Storage bucket; download is gated by RLS
  (caller must be sender/receiver of a ping referencing the object).
- Receiver downloading a file ping currently triggers auto-dismiss for that
  side ([app.js download-btn handler](../../../static/app.js)).
- Pings auto-dismiss 20s after arrival (freshly-arrived only).
- The single realtime channel ([subscribeToRealtime](../../../static/app.js))
  already listens for incoming pings (`receiver_id=eq.<me>`) and contact changes.

Control glyphs (close `✕`, check, arrows, hourglass) **stay on the icon font**.
Only file-*type* icons move to SVG. This is a deliberate split: colored SVGs read
as "content," monochrome glyphs read as "controls."

---

## Feature 1 — Colored SVG file-type icons

### Assets

47 SVGs already added to [static/icons/filetypes/](../../../static/icons/filetypes/),
named by extension/category: `3ds ai archive asp avi bin css csv dbf dll doc dwg
eps exe file fla gif html ico ini iso jar jpg js json mkv mov mp3 mp4 nfo obj otf
pdf pkg png ppt psd rtf svg ttf txt vcf wav wmv xls xml zip`. **`file.svg` is the
required fallback.** Per the approved "ship as-is" decision, all are used as
delivered (mixed icon styles accepted).

The stray `static/icons/filetypes/README.md` (shipped with the icon pack)
references a `src/lib/fileIcons.ts` build-time globbing flow that does **not**
exist in Ping. Rewrite it to describe Ping's actual runtime mapping, or delete
it. Do not follow it.

### Mapping

Rewrite `fileTypeIcon(name)` to return an **SVG URL path**
(`/icons/filetypes/<key>.svg`) instead of a font class. Logic:

1. Lowercase the file extension.
2. Resolve through an **alias map** to a key that has a matching SVG.
3. If the resolved key has no SVG, return `/icons/filetypes/file.svg`.

Alias map (covers the extensions the current `fileTypeIcon` keys on, mapped to an
available SVG). Direct-match extensions (their own SVG exists) need no alias:

| Extension(s) | SVG key |
|---|---|
| jpeg | jpg |
| docx, odt | doc |
| xlsx, ods | xls |
| pptx, odp | ppt |
| webp, bmp, tiff, heic | jpg *(or `file` — see note)* |
| webm, m4v | mp4 |
| rar, tar, gz, 7z | archive |
| flac, m4a, aac, ogg | mp3 |
| scss, sass, less | css |
| htm | html |
| mjs, ts, tsx, jsx | js |
| py, rb, go, rs, java, c, cpp, h, sh | file *(no per-lang SVG; fallback)* |
| md, log | txt |

> Note on raster image extensions without an exact SVG (`webp`, `bmp`, `tiff`,
> `heic`): map to `jpg` so they read as images. Alternatively keep `file`; pick
> `jpg` for clarity since these are previewable image types (see Feature 2).

Implementation detail: keep the alias map as a small object literal next to
`fileTypeIcon`. Direct extension match (an `<ext>.svg` exists) takes precedence
over alias resolution.

### Rendering

In `renderPing()`, the file-info row renders an `<img>` instead of `<i>`:

```html
<span class="file-icon">
  <img src="${fileTypeIcon(ping.file_name)}" alt="" loading="lazy"
       width="20" height="20" onerror="this.src='/icons/filetypes/file.svg'">
</span>
```

- `alt=""` — the icon is decorative; the filename text carries the meaning.
- `loading="lazy"` — avoids fetching icons for off-screen history.
- Inline `onerror` fallback to `file.svg` if a path 404s. **CSP note:** the
  current CSP forbids inline event handlers via `script-src`. Inline `onerror`
  on an element attribute is governed by `script-src` too. To stay CSP-clean,
  attach the error fallback in JS (`img.addEventListener('error', …)`) rather
  than an inline `onerror` attribute. Use the JS-attached handler.
- `img-src 'self'` in the CSP already allows these same-origin SVGs. ✓

### CSS

`.file-icon img` sized ~20px square, `object-fit: contain`, vertical-align
middle. Remove/!ignore the font-glyph styling for file icons. Keep the icon-font
`@font-face` and control glyphs intact.

### Service worker

The shell-cache in [static/sw.js](../../../static/sw.js) precaches specific
assets. File-type SVGs do **not** need precaching (they're fetched on demand and
the runtime fetch handler already caches successful same-origin GETs). No SW
change required, but verify the runtime cache path catches them. Optionally add
`/icons/filetypes/file.svg` to the SHELL array so the fallback is always offline.

---

## Feature 2 — Inline image previews

### What counts as an image

Extensions: `jpg jpeg png gif webp bmp svg heic` (and any the app can render).
For these, the file ping renders a **thumbnail** instead of the filename row.
Non-image files keep the Feature-1 colored icon row.

### Fetching the image (the critical RLS / auto-dismiss interaction)

The bucket is private, so a thumbnail requires downloading the bytes via
`sb.storage.from("ping-files").download(path)` → `URL.createObjectURL(blob)`.

**This must NOT trigger the receiver auto-dismiss path.** Today, the
download-button handler calls `downloadFile()` *and then* dismisses for the
receiver. Previewing reuses the same storage download but must be decoupled:

- Extract a pure `fetchObjectUrl(path)` helper that only downloads + returns an
  object URL. It performs **no** dismissal.
- The thumbnail render calls `fetchObjectUrl` on load (lazily — see below).
- Only an explicit **user "LADDA NER" action** (save-to-disk) runs the existing
  dismiss-on-download behavior. Viewing/previewing never dismisses.

Revoke object URLs (`URL.revokeObjectURL`) when the ping element is removed
(dismiss/fade-out) to avoid leaks. Track the URL on the element (e.g.
`el._objectUrl`) and revoke in the dismiss path.

### Lazy thumbnail loading

Fetching every image in history on chat open is wasteful and burns RLS
round-trips. Use an `IntersectionObserver` (or fetch on first render for the
small expected volume) so a thumbnail downloads only when it scrolls into view.
For the expected 2-person, low-volume use, eager-on-render is acceptable; prefer
lazy if simple. **Decision for implementation:** start eager-on-render (simplest,
matches current code style); note IntersectionObserver as an optimization.

### Thumbnail UI

- Thumbnail max ~200×140px, `object-fit: cover`, 1px border in theme style,
  rounded corners, cursor pointer.
- A small filename + size caption under/over the thumb, and the existing
  **LADDA NER** button remains (download is still a distinct action).
- Loading state: a placeholder box (terminal-styled, e.g. a subtle pulse or
  "…") until the object URL resolves. On fetch error, fall back to the
  Feature-1 colored icon row so a failed preview degrades gracefully.

### Lightbox

Clicking the thumbnail opens a full-size **in-app overlay**:

- A single reusable overlay element (added once to the DOM), terminal-styled:
  black backdrop, thin accent border, `✕` close (font glyph) top-right.
- Shows the full-resolution image (reuse the already-fetched object URL).
- Close on: `✕` click, backdrop click, `Escape` key.
- Accessibility: `role="dialog"`, `aria-modal="true"`, move focus to the close
  button on open, restore focus on close, trap focus while open.
- The lightbox is view-only; it does **not** dismiss the ping.

### Auto-dismiss interaction for received image pings

Today, received *file* pings skip the 20s timer and wait for download. For
received *image* pings that now render inline, decide: they should behave like
other received files (no 20s auto-timeout; they persist until the user dismisses
or downloads). Keep `isReceivedFile` logic as-is — images are files, so they
already skip the timer. Confirm this still holds after the render change.

---

## Feature 3 — Unread badges

### Semantics (approved)

Per-contact count of pings that arrive **via realtime while that contact's chat
is not the open one**, within the current browser session. Purely client-side,
no DB change. The count is per-device and resets on reload (acceptable, matches
the ephemeral design).

### State

A `Map<recipientId, number>` of unread counts, e.g. `unreadCounts`. Lives in app
state alongside `contacts`.

### Increment

In the realtime incoming-ping handler ([subscribeToRealtime](../../../static/app.js)):
- If the ping's `sender_id !== selectedContact?.recipientId` (chat not open),
  increment `unreadCounts[sender_id]` and re-render that contact's badge.
- If the ping's sender **is** the open chat, render it inline as today (no
  badge).
- `playPing()` still fires regardless.

### Reset

- When `selectContact()` opens a chat, set `unreadCounts[recipientId] = 0` and
  clear that badge.

### Decrement on expiry (consistency with 20s auto-dismiss)

Because unread is session-live and tied to ephemeral pings, a badge should not
outlive the pings it counts. When a counted ping auto-dismisses (the 20s timer
fires for a ping whose chat was never opened), decrement that contact's badge.
Implementation: the incoming-ping handler, when the chat is closed, schedules the
same 20s lifecycle; on expiry, decrement the count (floor at 0) and re-render.
Keep this simple — a per-ping timeout that decrements is enough; do not
over-engineer reconciliation.

> Simpler acceptable alternative if the decrement-on-expiry adds too much
> complexity: clear the badge only on chat-open. The count may then show pings
> that have since expired. Implementer may choose this if the timer bookkeeping
> proves fiddly; note the choice in the PR.

### Rendering

`renderContacts()` appends a badge element to each accepted contact row when
`unreadCounts[recipientId] > 0`. Badge: small pill, accent background, bg-colored
text, count inside. Hidden at 0. Re-render the single row or the list on change.

---

## Feature 4 — Presence (online dot)

### Mechanism (approved)

Supabase Realtime **presence** on a shared channel. Green dot when a contact has
Ping open, grey otherwise. No DB writes, no "last seen."

### Channel

Add a presence channel (e.g. `sb.channel("presence", { config: { presence: {
key: currentUser.id } } })`), or attach presence to the existing realtime channel
if cleanly separable. On `subscribe`, `track({ user_id, at })`. Listen to
`presence` `sync`/`join`/`leave` events to maintain an `onlineUserIds: Set`.

> Design choice: a **dedicated** presence channel is cleaner than overloading the
> postgres_changes channel, because presence has its own lifecycle and payload.
> Use a separate channel; tear it down in `exitApp()` alongside `realtimeChannel`.

### State & rendering

- `onlineUserIds` set in app state.
- `renderContacts()` renders a dot before each accepted contact's name: green
  (online) if `onlineUserIds.has(recipientId)`, grey otherwise.
- On presence sync/join/leave, update the set and refresh the dots (re-render
  contacts or patch the dots directly).

### Privacy note

Presence reveals "is online" to anyone sharing the channel. Scope the channel so
only relevant users see each other if feasible; if a single global presence
channel is used, every authenticated app user broadcasts presence to that
channel. For a 2-person app this is fine, but **note it**: if Ping later scopes
presence per contact-pair, revisit. Document in the privacy policy if presence
visibility is user-facing.

### Teardown

Untrack and remove the presence channel in `exitApp()` and on logout, so an
offline user doesn't linger as "online."

---

## Build order

1. **Feature 1 (SVG icons)** — foundational; reworks the file row that Feature 2
   builds on. Ship + verify icons render and fall back.
2. **Feature 2 (image previews)** — depends on the reworked file row; introduces
   `fetchObjectUrl` decoupling and the lightbox.
3. **Feature 3 (unread badges)** — independent; touches realtime handler +
   `renderContacts`.
4. **Feature 4 (presence)** — independent; new channel + `renderContacts` dots.

3 and 4 can be done in either order or in parallel; both modify
`renderContacts()`, so coordinate that function's changes.

## Testing / verification

Manual (no test harness exists yet — see review backlog):

- **Icons:** every file type shows a colored SVG; unknown extension → `file.svg`;
  a deliberately broken path → `file.svg` fallback via JS error handler; CSP
  console shows no violations.
- **Previews:** send an image → receiver sees a thumbnail without it
  auto-dismissing; click → lightbox opens, Escape/✕/backdrop close it; LADDA NER
  still downloads AND still auto-dismisses for receiver; object URLs revoked on
  dismiss (no leak); non-image file → colored icon row unchanged; failed preview
  → graceful icon fallback.
- **Unread badges:** receive a ping with that chat closed → badge increments +
  ping sound; open chat → badge clears; (if implemented) counted ping expires at
  20s → badge decrements; open chat shows no badge for live messages.
- **Presence:** open Ping in two sessions for two contacts → each sees the
  other's dot green; close one → its dot goes grey within the presence sync
  window; logout → user goes grey for the other side.
- **Regression:** existing text pings, file send/download, dismiss, auto-dismiss
  timer, per-side soft-delete all still work.

## Risks / open notes

- **CSP + inline handlers:** do NOT use inline `onerror`/`onclick` for the new
  elements; attach via `addEventListener` to respect the strict `script-src`.
- **Object URL leaks:** every `createObjectURL` needs a matching `revokeObjectURL`
  on element removal and on lightbox close (if a separate URL is used).
- **Presence visibility** is global on a single channel — fine for 2 users, note
  for the future.
- **Unread decrement-on-expiry** may be simplified to clear-on-open if timer
  bookkeeping is fiddly; implementer's call, noted in PR.
- All four modify shared functions (`renderPing`, `renderContacts`, realtime
  handler). Implement in the stated order to minimize merge friction within the
  single `app.js` file.
