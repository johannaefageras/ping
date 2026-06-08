# Per-contact file gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat-header button that opens a full-overlay gallery of every file (both directions) exchanged with the selected contact, where files can be browsed and re-downloaded without auto-dismissal.

**Architecture:** Pure frontend addition to the vanilla JS app. A new `#gallery-modal` overlay (mirroring `#settings-modal`) holds a responsive grid. On open, a dedicated Supabase query loads this contact's `type='file'` pings (newest-first); each row renders as a grid cell (image thumbnail via the existing `fetchObjectUrl`, or a colored file-type icon). Clicking a cell calls the existing `downloadFile()` **without** the chat stream's auto-dismiss wrapper. Lifecycle and Esc-handling reuse the established modal + keyboard-registry conventions. No schema, backend, or RLS change.

**Tech Stack:** Vanilla HTML/CSS/JS, Supabase JS client (already loaded as `sb`), existing helpers (`fetchObjectUrl`, `downloadFile`, `isImageFile`, `isVideoFile`, `fileTypeIcon`, `formatSize`, `escapeHtml`).

**Spec:** [docs/superpowers/specs/2026-06-08-file-gallery-design.md](../specs/2026-06-08-file-gallery-design.md)

**Verification note:** This repo has no JS test harness (tests in `tests/` cover Python preview routes only). Each task is build-and-verify: implement, then load the running app (`uvicorn server:app --reload`, open http://localhost:8000) and confirm the described behavior in the browser. There are no automated test steps to write.

---

## File structure

- **Modify** `static/index.html` — add the `#gallery-btn` to `#chat-header` (~line 372) and the `#gallery-modal` element among the other modals (~line 843).
- **Modify** `static/style.css` — add styling for `#gallery-modal`, `#gallery-panel`, `#gallery-grid`, grid cells, empty state (mirroring `#settings-modal` / `#settings-panel`, ~line 1591).
- **Modify** `static/app.js` — add a `gallery-btn`/`gallery-modal` DOM ref block, a `formatDate()` helper, `loadGalleryFiles()`, `renderGalleryItem()`, `openFileGallery()`/`closeFileGallery()`, the trigger/backdrop wiring, the `exitApp()` close hook, and the keyboard `ctx` registration.
- **Modify** `static/keyboard.js` — register the gallery overlay in the Esc registry (~line 229).

---

## Task 1: Add the gallery trigger button to the chat header

**Files:**
- Modify: `static/index.html:372`

- [ ] **Step 1: Add the button after the contact-name heading**

In `static/index.html`, the `#chat-header` currently ends with `<h2 id="chat-contact-name"></h2>` (line 372). Add a button immediately after it (still inside `<header id="chat-header">`):

```html
            <h2 id="chat-contact-name"></h2>
            <button
              id="gallery-btn"
              type="button"
              aria-label="Filer"
              title="Filer"
            >
              <svg
                class="icon"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
            </button>
```

- [ ] **Step 2: Verify in the browser**

Run `uvicorn server:app --reload` if not already running, open http://localhost:8000, sign in, and select a contact. Expected: an "images" icon button now appears in the chat header next to the contact name. Clicking it does nothing yet (wired in Task 5). No console errors.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(gallery): add file gallery trigger button to chat header

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add the gallery modal markup

**Files:**
- Modify: `static/index.html:843` (insert a sibling before `<div id="settings-modal">`)

- [ ] **Step 1: Add the modal element**

In `static/index.html`, find the line that opens the settings modal:

```html
    <div
      id="settings-modal"
```

Immediately **before** that `<div id="settings-modal"` block, insert the gallery modal. It mirrors the settings modal's titlebar idiom (dots + centered title + close button):

```html
    <div
      id="gallery-modal"
      class="hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Filer"
    >
      <div id="gallery-panel">
        <div id="gallery-titlebar">
          <span class="tb-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <h2 id="gallery-title">~/filer</h2>
          <button id="gallery-close" aria-label="St&auml;ng">
            <svg
              class="icon"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div id="gallery-grid"></div>
      </div>
    </div>

```

- [ ] **Step 2: Verify the modal exists but stays hidden**

Reload the app. Expected: no visual change (the modal has the `hidden` class). In devtools, confirm `#gallery-modal` exists in the DOM. No console errors.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(gallery): add file gallery modal markup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Style the gallery modal and grid

**Files:**
- Modify: `static/style.css` (add a block after the `#settings-*` rules, ~line 1653)

- [ ] **Step 1: Add the gallery styles**

In `static/style.css`, after the `#settings-title { … }` rule (ends ~line 1653) and before the `/* Video recording modal … */` comment, add:

```css
/* File gallery modal: mirrors #settings-modal / #settings-panel. */
#gallery-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
#gallery-modal.hidden { display: none; }

#gallery-panel {
  background: var(--bg, #0a0a0a);
  border: 1px solid var(--fg-dim, #1a9956);
  border-radius: 8px;
  width: min(92vw, 640px);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--fg) 8%, transparent),
    0 24px 60px rgba(0, 0, 0, 0.6),
    0 0 40px color-mix(in srgb, var(--fg) 6%, transparent);
}

#gallery-titlebar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--fg) 4%, var(--bg));
  flex: none;
}

#gallery-title {
  margin: 0;
  flex: 1;
  text-align: center;
  font-size: 0.8rem;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--fg-dim);
}

#gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
}

/* Empty state spans the whole grid. */
#gallery-grid .gallery-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--fg-dim);
  padding: 32px 0;
  font-size: 0.85rem;
}

.gallery-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--fg) 3%, var(--bg));
  cursor: pointer;
  text-align: center;
  color: inherit;
}

.gallery-item:hover,
.gallery-item:focus-visible {
  border-color: var(--fg-dim);
  outline: none;
}

.gallery-thumb {
  width: 100%;
  height: 84px;
  object-fit: cover;
  border-radius: 4px;
  background: color-mix(in srgb, var(--fg) 6%, var(--bg));
}

.gallery-thumb.loading {
  opacity: 0.4;
}

.gallery-icon {
  width: 100%;
  height: 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--fg) 6%, var(--bg));
  border-radius: 4px;
}

.gallery-icon img {
  width: 36px;
  height: 36px;
}

.gallery-name {
  font-size: 0.72rem;
  line-height: 1.2;
  word-break: break-word;
  max-height: 2.4em;
  overflow: hidden;
}

.gallery-meta {
  font-size: 0.65rem;
  color: var(--fg-dim);
}
```

- [ ] **Step 2: Verify by temporarily un-hiding the modal**

In devtools, select `#gallery-modal` and remove the `hidden` class. Expected: a centered terminal-style panel appears matching the settings modal, with an empty grid area. Re-add the `hidden` class. No layout breakage.

- [ ] **Step 3: Commit**

```bash
git add static/style.css
git commit -m "feat(gallery): style file gallery modal and grid

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Add DOM refs and the date helper

**Files:**
- Modify: `static/app.js` (DOM refs near the top, helper near `formatTime` at ~line 1458)

- [ ] **Step 1: Add DOM references**

In `static/app.js`, near the other `getElementById` refs (e.g. after `const chatContactName = document.getElementById("chat-contact-name");` at line 36), add:

```js
const galleryBtn = document.getElementById("gallery-btn");
const galleryModal = document.getElementById("gallery-modal");
const galleryClose = document.getElementById("gallery-close");
const galleryTitle = document.getElementById("gallery-title");
const galleryGrid = document.getElementById("gallery-grid");
```

- [ ] **Step 2: Add a `formatDate` helper**

The existing `formatTime()` (line 1458) returns only HH:MM. The gallery shows a date. Add this directly after `formatTime`:

```js
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("sv-SE", { day: "2-digit", month: "2-digit" });
}
```

- [ ] **Step 3: Verify no breakage**

Reload the app. Expected: app loads normally, no console errors. (Nothing uses these refs/helper yet.)

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat(gallery): add gallery DOM refs and formatDate helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Implement load, render, and lifecycle

**Files:**
- Modify: `static/app.js` (add a self-contained gallery block; place it after the `downloadFile` function, ~line 1084, so the helpers it depends on are already defined)

- [ ] **Step 1: Add the gallery module block**

In `static/app.js`, after the `downloadFile()` function (ends ~line 1084), add the following block. It depends on already-defined helpers: `sb`, `currentUser`, `selectedContact`, `isImageFile`, `fileTypeIcon`, `fetchObjectUrl`, `downloadFile`, `formatSize`, `formatDate`, `escapeHtml`, and the refs from Task 4. (Video files are not special-cased: anything that isn't an image goes through `fileTypeIcon`, which already returns a video filetype icon for video extensions — matching the spec.)

```js
// ============================================================
// FILE GALLERY — per-contact overlay of all exchanged files
// ============================================================
// Browse-and-download view. Unlike the chat stream, downloading here does NOT
// auto-dismiss the file. Blob URLs created for image thumbs are tracked on
// _galleryObjectUrls and revoked on close so none leak.

let _galleryLastFocus = null;
let _galleryObjectUrls = [];

// Loads this contact's file pings, newest-first. Mirrors loadPings' .or()
// filter plus an .eq("type","file"). RLS already restricts rows to pings the
// user is a party to and hasn't dismissed, so no extra guard is needed.
async function loadGalleryFiles() {
  const { recipientId } = selectedContact;
  const { data, error } = await sb
    .from("pings")
    .select("*")
    .eq("type", "file")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${recipientId}),` +
        `and(sender_id.eq.${recipientId},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load gallery files:", error);
    return [];
  }
  return data || [];
}

// Builds one grid cell. Image files get a lazily-fetched thumbnail (degrading
// to the file-type icon on failure); everything else gets the file-type icon.
// Clicking (or Enter/Space) downloads via downloadFile — no dismissal.
function renderGalleryItem(ping) {
  const cell = document.createElement("div");
  cell.className = "gallery-item";
  cell.setAttribute("role", "button");
  cell.setAttribute("tabindex", "0");
  cell.setAttribute("aria-label", "Ladda ner " + ping.file_name);

  const iconHtml = `<span class="gallery-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" /></span>`;
  const thumbHtml = isImageFile(ping.file_name)
    ? `<img class="gallery-thumb loading" alt="${escapeHtml(ping.file_name)}" />`
    : iconHtml;

  cell.innerHTML = `
    ${thumbHtml}
    <span class="gallery-name">${escapeHtml(ping.file_name)}</span>
    <span class="gallery-meta">${formatSize(ping.file_size)} &middot; ${formatDate(ping.created_at)}</span>
  `;

  // Missing file-type icon degrades to file.svg (CSP forbids inline onerror).
  const typeIcon = cell.querySelector(".file-type-icon");
  if (typeIcon) {
    typeIcon.addEventListener("error", () => {
      if (!typeIcon.src.endsWith("/file.svg")) {
        typeIcon.src = "/icons/filetypes/file.svg";
      }
    }, { once: true });
  }

  // Image thumbnail: fetch the private object and fill the <img>. Track the
  // blob URL for revocation on close; degrade to the icon on failure.
  const thumb = cell.querySelector(".gallery-thumb");
  if (thumb) {
    fetchObjectUrl(ping.file_path).then((url) => {
      // Gallery was closed mid-fetch — revoke and bail.
      if (!galleryModal || galleryModal.classList.contains("hidden")) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (!url) {
        thumb.outerHTML = `<span class="gallery-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" /></span>`;
        const fallbackIcon = cell.querySelector(".file-type-icon");
        if (fallbackIcon) {
          fallbackIcon.addEventListener("error", () => {
            if (!fallbackIcon.src.endsWith("/file.svg")) {
              fallbackIcon.src = "/icons/filetypes/file.svg";
            }
          }, { once: true });
        }
        return;
      }
      _galleryObjectUrls.push(url);
      thumb.src = url;
      thumb.classList.remove("loading");
    });
  }

  function activate() {
    downloadFile(ping.file_path, ping.file_name);
  }
  cell.addEventListener("click", activate);
  cell.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  });

  return cell;
}

async function openFileGallery() {
  if (!selectedContact) return;
  _galleryLastFocus = document.activeElement;
  galleryTitle.textContent = "~/filer med @" + selectedContact.username;
  galleryGrid.innerHTML = "";
  galleryModal.classList.remove("hidden");
  galleryClose.focus();

  const files = await loadGalleryFiles();
  // Guard against a close (or contact switch) during the await.
  if (galleryModal.classList.contains("hidden")) return;

  if (files.length === 0) {
    galleryGrid.innerHTML = `<div class="gallery-empty">Inga filer &auml;n</div>`;
    return;
  }
  files.forEach((ping) => galleryGrid.appendChild(renderGalleryItem(ping)));
}

function closeFileGallery() {
  galleryModal.classList.add("hidden");
  _galleryObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  _galleryObjectUrls = [];
  galleryGrid.innerHTML = "";
  if (_galleryLastFocus) _galleryLastFocus.focus();
}

function isGalleryOpen() {
  return !galleryModal.classList.contains("hidden");
}

galleryBtn.addEventListener("click", openFileGallery);
galleryClose.addEventListener("click", closeFileGallery);
galleryModal.addEventListener("click", (e) => {
  if (e.target === galleryModal) closeFileGallery();
});
```

- [ ] **Step 2: Verify open / render / download / close**

Reload the app, select a contact that has exchanged a mix of files (at least one image and one non-image). Click the gallery button. Expected:
- The modal opens, titled `~/filer med @<contact>`.
- Image files show thumbnails; non-images show their colored file-type icon. Each cell shows name, size, and date (DD/MM), newest first.
- Clicking a cell downloads the file. After download, the file is **still present** in the gallery (no dismissal) and still present in the chat stream behind it.
- The close button and a backdrop click both close the modal; focus returns to the gallery button.

Then select a contact with no files and open the gallery. Expected: "Inga filer än" empty state.

- [ ] **Step 3: Verify no blob-URL leak**

Open the gallery for a contact with images, then close it. In devtools, confirm no console errors. (Object URLs created for thumbs are revoked on close.)

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat(gallery): load, render, and lifecycle for file gallery

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Close the gallery on contact switch and sign-out

**Files:**
- Modify: `static/app.js` — `selectContact()` (~line 728) and `exitApp()` (~line 497)

- [ ] **Step 1: Close on contact switch**

In `selectContact()` (line 728), the function starts by reassigning `selectedContact`. Add a guard at the very top of the function body, before that reassignment, so switching contacts while the gallery is open closes the now-stale gallery:

```js
async function selectContact(contactId, recipientId, username, displayName) {
  closeFileGallery();
  selectedContact = { contactId, recipientId, username, displayName: displayName || null };
```

- [ ] **Step 2: Close on sign-out**

In `exitApp()`, the existing teardown calls `closeSettings();` and `closeInvite();` (lines 497–500). Add the gallery close alongside them:

```js
  closeSettings();
  // Same for the invite modal: close it so it doesn't linger over the auth
  // screen and so its countdown interval is cleared.
  closeInvite();
  // And the file gallery, so it doesn't linger over the auth screen and its
  // thumbnail blob URLs are revoked.
  closeFileGallery();
```

- [ ] **Step 3: Verify**

Reload. Open the gallery for a contact, then (via `Cmd/Ctrl+K` or the sidebar) switch to a different contact. Expected: the gallery closes. Open the gallery again, then sign out. Expected: the gallery closes and you land on the auth screen with no lingering overlay and no console errors.

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat(gallery): close gallery on contact switch and sign-out

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Register the gallery in the Esc overlay registry

**Files:**
- Modify: `static/keyboard.js:229` (register the overlay)
- Modify: `static/app.js:2636` (pass `isGalleryOpen` / `closeFileGallery` into `ctx`)

- [ ] **Step 1: Pass the gallery callbacks into the keyboard ctx**

In `static/app.js`, the `window.PingKeyboard.initKeyboard({ … })` call (line 2625) passes overlay callbacks. After the settings pair:

```js
  isSettingsOpen: () => !settingsModal.classList.contains("hidden"),
  closeSettings,
```

add:

```js
  isGalleryOpen,
  closeFileGallery,
```

(`isGalleryOpen` is already defined in Task 5.)

- [ ] **Step 2: Register the overlay in keyboard.js**

In `static/keyboard.js`, the overlays are registered topmost-first (lines 222–229). After the settings registration:

```js
    registerOverlay({ isOpen: ctx.isSettingsOpen, close: ctx.closeSettings });
```

add:

```js
    registerOverlay({ isOpen: ctx.isGalleryOpen, close: ctx.closeFileGallery });
```

- [ ] **Step 3: Verify Esc closes the gallery**

Reload. Open the gallery, press `Esc`. Expected: the gallery closes and focus returns to the gallery button. Confirm `Esc` still closes the settings modal and the lightbox as before (no regression). No console errors.

- [ ] **Step 4: Commit**

```bash
git add static/app.js static/keyboard.js
git commit -m "feat(gallery): close file gallery on Escape via overlay registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the spec's manual test checklist**

With the app running, walk the spec's testing section end to end:

1. Contact with mixed file types → image thumbnails, file-type icons for the rest, names/sizes/dates correct, newest first.
2. Contact with no files → "Inga filer än" empty state.
3. Click a file → it downloads and is NOT dismissed (still in the gallery and chat afterward).
4. `Esc` and backdrop click both close; focus returns to the trigger button.
5. Reopen after closing → no console errors, no leaked blob URLs.
6. Switch contact while open → gallery closes. Sign out while open → gallery closes, lands on auth screen cleanly.

Expected: all pass.

- [ ] **Step 2: Verify the Python tests still pass (no backend touched, sanity check)**

Run: `pytest -q`
Expected: PASS (this feature changes no Python; this just confirms nothing else regressed).

- [ ] **Step 3: No commit needed**

Verification only.
