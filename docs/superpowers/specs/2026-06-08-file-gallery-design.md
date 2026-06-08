# Per-contact file gallery — design

**Date:** 2026-06-08
**Status:** Approved

## Goal

Add a **file gallery** for the currently selected contact: a button in the chat
header opens a full-overlay panel showing a grid of every file (both directions)
exchanged with that contact. The gallery is a browse-and-download view — you can
re-download any file you sent or received without scrolling the chat stream to
find it. This serves the "store and access later" need: files already live in
private Supabase Storage, but the only way to reach an older one today is to
scroll back through messages.

Downloading from the gallery does **not** dismiss the file (unlike the chat
stream, which auto-dismisses a received file after download), so browsing the
gallery never makes files disappear.

This is a pure frontend addition: no schema change, no backend change, no new
RLS policy.

## Current state

- **Storage already works.** Files are uploaded to the private `ping-files`
  bucket and recorded as `type:"file"` ping rows with `file_path`, `file_name`,
  `file_size`. RLS in [supabase/schema.sql](../../../supabase/schema.sql)
  restricts download to the sender/receiver of a ping that references the
  object, and a trigger deletes the object when its ping is hard-deleted.
- **Per-contact pings load** in [loadPings()](../../../static/app.js#L750):
  a `.or(...)` query over `pings` for the current user ⇄ selected contact,
  ordered `created_at` ascending, rendered into `#board` and then discarded
  (no JS-side cache of the rows).
- **File rendering helpers** already exist in
  [renderPing()](../../../static/app.js#L792):
  `isImageFile()`, `isVideoFile()`, `fileTypeIcon()`, `formatSize()`,
  `formatTime()`, and the thumbnail fetch via
  [fetchObjectUrl()](../../../static/app.js#L1062). The colored file-type icon
  has a missing-icon fallback to `/icons/filetypes/file.svg`
  ([static/app.js:859](../../../static/app.js#L859)).
- **Download** is [downloadFile()](../../../static/app.js#L1071): fetches the
  private object via `fetchObjectUrl`, triggers a browser download, revokes the
  blob URL. In the chat stream the receiver's download is wrapped with an
  auto-dismiss ([static/app.js:939](../../../static/app.js#L939)); the gallery
  will call `downloadFile` **directly**, without that wrapper.
- **Chat header** is `<header id="chat-header">`
  ([static/index.html:345](../../../static/index.html#L345)) containing the
  mobile-contacts toggle and `<h2 id="chat-contact-name">`. This is where the
  gallery trigger button goes.
- **Overlay conventions:** modals are `.hidden`-toggled elements with an
  `openX`/`closeX` pair that saves/restores focus (see
  [openSettings/closeSettings](../../../static/app.js#L1504)), a backdrop-click
  close (`if (e.target === modal) close()`), and registration in the keyboard
  Esc registry via `registerOverlay({ isOpen, close })` in
  [keyboard.js:222](../../../static/keyboard.js#L222), wired through the `ctx`
  object passed to `initKeyboard`.

## Design

### Trigger button

A new icon button in `#chat-header`, after `<h2 id="chat-contact-name">`:
`<button id="gallery-btn" …>` with an inline lucide-style "images" SVG and a
Swedish `aria-label`/`title` ("Filer"). It is part of the chat header, which is
only visible when a contact is selected (`#chat-view` is `.hidden` otherwise),
so no separate show/hide logic is needed.

### Gallery overlay

A new modal element `<div id="gallery-modal" class="hidden">` (sibling of the
other modals near [static/index.html:843](../../../static/index.html#L843)),
following the existing modal markup: a backdrop + a panel with a title
("Filer med @<contact>"), a close button, and a scrollable grid container
`#gallery-grid`. Styled in [static/style.css](../../../static/style.css) to
match the existing modal/overlay look, with a responsive thumbnail grid.

### Data load

`loadGalleryFiles()` runs on open: the same `.or(...)` filter as `loadPings`,
plus `.eq("type", "file")`, ordered `created_at` **descending** (galleries read
better newest-first; the chat stream stays ascending). It returns the rows;
nothing is cached between opens, so reopening always reflects current state
(including files dismissed elsewhere, which RLS omits automatically).

### Item rendering

`renderGalleryItem(ping)` builds one grid cell:

- **Image files** (`isImageFile`): an `<img class="image-thumb loading">` filled
  lazily via `fetchObjectUrl(ping.file_path)`. On fetch failure, degrade to the
  colored file-type icon (same fallback pattern as
  [static/app.js:859](../../../static/app.js#L859)).
- **Video files** (`isVideoFile`): the colored file-type icon (a play-style
  filetype icon) — no inline `<video>` element in the grid, to keep many cells
  cheap. Clicking still downloads.
- **Everything else:** the file-type icon via `fileTypeIcon(ping.file_name)`,
  with the `/icons/filetypes/file.svg` missing-icon fallback.
- Below the thumb/icon: `file_name`, `formatSize(file_size)`, and
  `formatTime(created_at)`.
- The cell is the download affordance: clicking (or Enter/Space on a
  focusable cell) calls `downloadFile(ping.file_path, ping.file_name)`
  **directly** — no dismiss.

This is kept separate from `renderPing` rather than shared: the chat-stream
element carries dismiss timers, lightbox wiring, and realtime fade-in that the
gallery cell must not inherit.

### Lifecycle

`openFileGallery()` / `closeFileGallery()` mirror `openSettings`/`closeSettings`:

- `open`: save `document.activeElement`, set the panel title from
  `selectedContact`, clear `#gallery-grid`, show the modal, focus the close
  button, then `loadGalleryFiles()` and render items.
- `close`: hide the modal, **revoke every blob URL** created for image thumbs
  (tracked on the grid so none leak), clear the grid, restore focus.
- Backdrop click closes (`if (e.target === galleryModal) closeFileGallery()`).
- Register `{ isOpen: isGalleryOpen, close: closeFileGallery }` in the keyboard
  overlay registry via the `ctx` object so `Esc` closes it like every other
  overlay. Place it among the app modals in
  [keyboard.js:222](../../../static/keyboard.js#L222).

## Edge cases

- **Empty state:** contact with no files → a centered "Inga filer än" message in
  the grid.
- **Thumbnail fetch fails:** degrade to the file-type icon (existing pattern).
- **Blob-URL cleanup:** revoke all gallery thumb URLs on close.
- **Contact switch / sign-out while open:** close the gallery and clear its
  contents (hook into the existing select-contact and logout paths).
- **Realtime:** a file arriving while the gallery is open does **not** live-update
  the grid; it appears on the next open. Accepted for v1.

## Testing

The repo's tests ([tests/](../../../tests/)) cover the Python preview routes
only; there is no JS test harness. Verification is manual:

1. Open the gallery for a contact with mixed file types → thumbnails for images,
   file-type icons for everything else, names/sizes/dates correct, newest first.
2. Contact with no files → "Inga filer än" empty state.
3. Click a file → it downloads and is **not** dismissed (still present in the
   gallery and in the chat stream afterward).
4. `Esc` and backdrop click both close; focus returns to the trigger button.
5. Reopen after closing → no console errors, no leaked blob URLs.

## Out of scope (YAGNI)

- Cross-contact / global "all my files" view.
- Search or filtering within the gallery.
- Live realtime updates of an open gallery.
- Sent-vs-received visual distinction.
- Bulk / "download all".
- Inline video playback in the grid.
