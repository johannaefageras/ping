# Richer Awareness Bundle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four client-side "passive awareness" features to Ping — colored SVG file-type icons, inline image previews with an in-app lightbox, session-live per-contact unread badges, and Supabase Realtime presence dots.

**Architecture:** All changes are in the vanilla-JS frontend ([static/app.js](../../../static/app.js)) and stylesheet ([static/style.css](../../../static/style.css)). No build step, no framework, no backend change, no DB/RLS change. The SVG assets already exist in [static/icons/filetypes/](../../../static/icons/filetypes/). Features are built in dependency order: icons → previews (both rework the file row), then unread badges and presence (both touch `renderContacts`/realtime, built last to coordinate that shared code).

**Tech Stack:** Vanilla JS (ES2020), Supabase JS v2 (pinned CDN), CSS custom properties for theming. Supabase Storage (private bucket) and Realtime presence.

---

## Testing approach (read first)

This project has **no automated test framework** and no build step. "Tests" here are:

1. **Syntax check** after every JS change: `node --check static/app.js` (must print nothing / exit 0).
2. **Manual browser verification** against a running server, with exact expected behavior per task.

To run the app locally for manual verification (requires a real Supabase project with the schema applied, per [README.md](../../../README.md)):

```bash
# one-time
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# each run (real Supabase creds in .env)
.venv/bin/uvicorn server:app --reload
# open http://localhost:8000/app
```

For a two-person feature (presence, unread, send/receive), use **two browsers** (or one normal + one incognito) logged in as two contacts who have accepted each other.

**Commit after each task** once its syntax check passes and (where a server is available) its manual check passes. If no live Supabase is available to the implementer, still commit on green syntax check and leave the manual-check checkbox unticked with a note in the commit body.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `static/app.js` | All behavior: icon mapping, ping rendering, lightbox, unread state, presence | Modify |
| `static/style.css` | Styling for icons, thumbnails, lightbox, badges, presence dots | Modify |
| `static/index.html` | Add the single reusable lightbox overlay element | Modify |
| `static/icons/filetypes/*.svg` | Colored file-type icons (already added) | Use (no change) |

---

## FEATURE 1 — Colored SVG file-type icons

### Task 1: Rewrite `fileTypeIcon()` to return SVG paths

**Files:**
- Modify: `static/app.js` (the `fileTypeIcon` function, currently at ~line 791)

- [ ] **Step 1: Replace the function body**

Replace the entire existing `fileTypeIcon(name)` function (the one returning `pi-file-*` class strings) with this. It returns a URL path to an SVG, resolving aliases and falling back to `file.svg`. The `DIRECT` set lists every extension that has its own `<ext>.svg` in `static/icons/filetypes/`; `ALIASES` maps the remaining extensions the app cares about onto an available icon.

```javascript
// Maps a filename to a colored file-type SVG under /icons/filetypes/.
// DIRECT = extensions that have their own <ext>.svg. ALIASES maps other
// extensions onto an existing icon. Anything unmatched falls back to file.svg.
const FILE_ICON_DIRECT = new Set([
  "3ds", "ai", "archive", "asp", "avi", "bin", "css", "csv", "dbf", "dll",
  "doc", "dwg", "eps", "exe", "fla", "gif", "html", "ico", "ini", "iso",
  "jar", "jpg", "js", "json", "mkv", "mov", "mp3", "mp4", "nfo", "obj",
  "otf", "pdf", "pkg", "png", "ppt", "psd", "rtf", "svg", "ttf", "txt",
  "vcf", "wav", "wmv", "xls", "xml", "zip",
]);

const FILE_ICON_ALIASES = {
  jpeg: "jpg",
  webp: "jpg", bmp: "jpg", tiff: "jpg", heic: "jpg",
  docx: "doc", odt: "doc", md: "txt", log: "txt",
  xlsx: "xls", ods: "xls",
  pptx: "ppt", odp: "ppt",
  webm: "mp4", m4v: "mp4",
  rar: "archive", tar: "archive", gz: "archive", "7z": "archive",
  flac: "mp3", m4a: "mp3", aac: "mp3", ogg: "mp3",
  scss: "css", sass: "css", less: "css",
  htm: "html",
  mjs: "js", ts: "js", tsx: "js", jsx: "js",
};

function fileTypeIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  let key;
  if (FILE_ICON_DIRECT.has(ext)) {
    key = ext;
  } else if (FILE_ICON_ALIASES[ext]) {
    key = FILE_ICON_ALIASES[ext];
  } else {
    key = "file";
  }
  return `/icons/filetypes/${key}.svg`;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add static/app.js
git commit -m "feat: fileTypeIcon returns colored SVG paths instead of font classes"
```

---

### Task 2: Render file icons as `<img>` with CSP-safe error fallback

**Files:**
- Modify: `static/app.js` (`renderPing`, the `file` branch ~line 547-558, and the listener section ~560-575)

- [ ] **Step 1: Change the file-branch markup to use `<img>`**

In `renderPing`, replace this line inside the `else if (ping.type === "file")` block:

```javascript
        <span class="file-icon"><i class="${fileTypeIcon(ping.file_name)}"></i></span>
```

with:

```javascript
        <span class="file-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" width="20" height="20" loading="lazy" /></span>
```

- [ ] **Step 2: Add a JS-attached error fallback (no inline `onerror` — CSP forbids it)**

In `renderPing`, immediately after `board.appendChild(el);` (~line 560), add:

```javascript
  // CSP forbids inline onerror; attach the fallback in JS so a missing icon
  // degrades to file.svg instead of a broken-image glyph.
  const typeIcon = el.querySelector(".file-type-icon");
  if (typeIcon) {
    typeIcon.addEventListener("error", () => {
      if (!typeIcon.src.endsWith("/file.svg")) {
        typeIcon.src = "/icons/filetypes/file.svg";
      }
    }, { once: true });
  }
```

> Cross-reference: Task 7 rewrites the file branch so that only NON-image files emit `.file-type-icon` (images get a `.image-thumb` instead). This `querySelector(".file-type-icon")` handler stays valid — it simply finds nothing for image pings, which is correct. Keep this block as-is when doing Task 7.

- [ ] **Step 3: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0.

- [ ] **Step 4: Update the file-icon CSS**

In `static/style.css`, replace the `.item.file-item .file-icon` rule (~line 743) with:

```css
.item.file-item .file-icon {
  display: inline-flex;
  align-items: center;
}

.item.file-item .file-type-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  vertical-align: middle;
}
```

- [ ] **Step 5: Manual verification**

With the app running and a chat open, send several files of different types (e.g. a `.pdf`, `.png`, `.zip`, `.mov`, and a `.xyz` with no icon).
Expected:
- Each shows its colored SVG icon in the file row.
- The `.xyz` (unknown) shows `file.svg`.
- DevTools Network shows the SVGs loading from `/icons/filetypes/`.
- DevTools Console shows **no CSP violation** for the icons.
- Temporarily rename one SVG to simulate a 404 → that file row shows `file.svg`, not a broken image.

- [ ] **Step 6: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: render file-type icons as colored SVG <img> with file.svg fallback"
```

---

### Task 3: Remove dead file-glyph CSS from the icon font (optional cleanup)

**Files:**
- Modify: `static/icons.css` (the `.pi-file-*` rules)

> The icon font's `.pi-file-*` glyph rules are now unused for file rows (control glyphs like `.pi-close`, `.pi-arrow-*`, `.pi-check` are still used and MUST stay). This is optional cleanup; the font file itself is unchanged.

- [ ] **Step 1: Confirm no remaining references to file glyphs**

Run: `grep -rn "pi-file" static/*.js static/*.html`
Expected: no matches (all file icons now use `<img>`). If any match remains, do NOT delete the corresponding rule.

- [ ] **Step 2: (Only if Step 1 is clean) leave the CSS as-is or delete the unused `.pi-file-*` rules**

Decision: **leave the unused `.pi-file-*` rules in place.** They're harmless, the font already ships them, and deleting risks touching the wrong rule. Skip deletion unless a later cleanup pass wants it. No commit needed for this task.

---

## FEATURE 2 — Inline image previews + lightbox

### Task 4: Extract a `fetchObjectUrl` helper (decouple download from dismiss)

**Files:**
- Modify: `static/app.js` (`downloadFile` ~line 661)

- [ ] **Step 1: Add the pure fetch helper above `downloadFile`**

Insert before the existing `downloadFile` function:

```javascript
// Downloads a private storage object and returns an object URL for it.
// PURE: it performs no dismissal — used by both image previews (which must NOT
// dismiss) and downloadFile (where the caller handles dismissal separately).
// Returns null on error. Callers must URL.revokeObjectURL() when done.
async function fetchObjectUrl(path) {
  const { data, error } = await sb.storage.from("ping-files").download(path);
  if (error) {
    console.error("Storage download failed:", error);
    return null;
  }
  return URL.createObjectURL(data);
}
```

- [ ] **Step 2: Rewrite `downloadFile` to use it (save-to-disk only)**

Replace the body of `downloadFile(path, filename)` with:

```javascript
async function downloadFile(path, filename) {
  const url = await fetchObjectUrl(path);
  if (!url) {
    alert("Nedladdning misslyckades.");
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0.

- [ ] **Step 4: Manual verification (regression)**

Send a file, click **LADDA NER** as the receiver.
Expected: file downloads to disk AND the ping auto-dismisses for the receiver (unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "refactor: extract fetchObjectUrl so previews can load files without dismissing"
```

---

### Task 5: Add the reusable lightbox overlay element + styles

**Files:**
- Modify: `static/index.html` (add overlay before the `<audio>` element ~line 232)
- Modify: `static/style.css` (append lightbox styles)

- [ ] **Step 1: Add the overlay markup in index.html**

Immediately before `<audio id="ping-sound" ...>`, add:

```html
    <!-- Image preview lightbox (reused for all image pings) -->
    <div id="lightbox" class="hidden" role="dialog" aria-modal="true" aria-label="Bildvisning">
      <button id="lightbox-close" aria-label="Stäng"><i class="pi-close"></i></button>
      <img id="lightbox-img" alt="" />
    </div>
```

- [ ] **Step 2: Append lightbox CSS**

Add to `static/style.css`:

```css
/* --- Image preview thumbnails + lightbox --- */
.item.file-item .image-thumb {
  display: block;
  max-width: 200px;
  max-height: 140px;
  border: 1px solid var(--border);
  border-radius: 4px;
  object-fit: cover;
  cursor: pointer;
  background: #000;
}

.item.file-item .image-thumb.loading {
  width: 200px;
  height: 140px;
  animation: thumb-pulse 1.2s ease-in-out infinite;
}

@keyframes thumb-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}

#lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.92);
  padding: 24px;
}

#lightbox.hidden { display: none; }

#lightbox img {
  max-width: 90vw;
  max-height: 90vh;
  border: 1px solid var(--fg);
  border-radius: 4px;
}

#lightbox-close {
  position: absolute;
  top: 16px;
  right: 20px;
  background: none;
  border: 1px solid var(--fg-dim);
  color: var(--fg);
  font-size: 1.1rem;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
}

#lightbox-close:hover {
  background: var(--fg-dim);
  color: var(--bg);
}
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html static/style.css
git commit -m "feat: add reusable image lightbox overlay markup and styles"
```

---

### Task 6: Wire lightbox open/close behavior in app.js

**Files:**
- Modify: `static/app.js` (add DOM refs near top ~line 42; add lightbox functions in the utilities section)

- [ ] **Step 1: Add DOM references**

Near the other `document.getElementById` refs at the top (after `const pingSound = ...`, ~line 42), add:

```javascript
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxClose = document.getElementById("lightbox-close");
```

- [ ] **Step 2: Add open/close functions and listeners**

Add in the UTILITIES section (near `scrollToBottom`):

```javascript
let _lightboxLastFocus = null;

function openLightbox(objectUrl) {
  lightboxImg.src = objectUrl;
  lightbox.classList.remove("hidden");
  _lightboxLastFocus = document.activeElement;
  lightboxClose.focus();
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightboxImg.removeAttribute("src");
  if (_lightboxLastFocus) _lightboxLastFocus.focus();
}

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  // Backdrop click (not the image) closes.
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.classList.contains("hidden")) {
    closeLightbox();
  }
});
```

> Note: the lightbox reuses the thumbnail's already-fetched object URL (passed in from Task 7), so it does not fetch again and does not revoke on close — the owning ping element revokes when it's dismissed.

- [ ] **Step 3: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: lightbox open/close with Escape, backdrop, and focus handling"
```

---

### Task 7: Render image pings as thumbnails

**Files:**
- Modify: `static/app.js` (`renderPing` file branch; the dismiss path; add an image-extension helper)

- [ ] **Step 1: Add an image-extension predicate near `fileTypeIcon`**

```javascript
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic"]);

function isImageFile(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return IMAGE_EXTS.has(ext);
}
```

- [ ] **Step 2: Branch the file render into image vs non-image**

In `renderPing`, replace the entire `else if (ping.type === "file") { ... }` block's `el.innerHTML = ...` assignment with a conditional. The non-image case keeps the Task-2 `<img class="file-type-icon">` markup. The image case renders a thumbnail placeholder plus the filename/size and the LADDA NER button:

```javascript
  } else if (ping.type === "file") {
    el.className = `item ${isSelf ? "self" : "other"} file-item${animate && !isSelf ? " ping" : ""}`;
    const isImage = isImageFile(ping.file_name);
    const iconOrThumb = isImage
      ? `<img class="image-thumb loading" alt="${escapeHtml(ping.file_name)}" />`
      : `<span class="file-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" width="20" height="20" loading="lazy" /></span>`;
    el.innerHTML = `
      <div class="meta">${formatTime(ping.created_at)}</div>
      <div class="file-info">
        ${iconOrThumb}
        <span>${escapeHtml(ping.file_name)} <span class="file-size">${formatSize(ping.file_size)}</span></span>
        <button class="download-btn" data-path="${escapeHtml(ping.file_path)}" data-name="${escapeHtml(ping.file_name)}"><i class="pi-arrow-down-to-bracket"></i> LADDA NER</button>
      </div>
      <button class="dismiss-btn" aria-label="Avfärda"><i class="pi-close"></i></button>
    `;
  }
```

- [ ] **Step 3: After `board.appendChild(el)`, fetch + populate the thumbnail for image pings**

Add after the Task-2 `typeIcon` error-handler block:

```javascript
  // Image pings: fetch the private file for an inline thumbnail. This uses the
  // pure fetchObjectUrl (no dismissal). Clicking the thumb opens the lightbox
  // reusing the same object URL. The URL is stored on the element and revoked
  // when the ping is dismissed (see dismissPing).
  const thumb = el.querySelector(".image-thumb");
  if (thumb) {
    fetchObjectUrl(ping.file_path).then((url) => {
      if (!url) {
        // Fetch failed — degrade to the colored file-type icon row.
        thumb.outerHTML = `<span class="file-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" width="20" height="20" /></span>`;
        return;
      }
      el._objectUrl = url;
      thumb.src = url;
      thumb.classList.remove("loading");
      thumb.addEventListener("click", () => openLightbox(url));
    });
  }
```

- [ ] **Step 4: Revoke the object URL on dismiss**

In `dismissPing` (~line 521), inside the `animationend` handler before/after `el.remove()`, add the revoke:

```javascript
function dismissPing(el, ping) {
  if (el._dismissed) return;
  el._dismissed = true;
  clearTimeout(el._dismissTimer);
  el.classList.add("fade-out");
  el.addEventListener(
    "animationend",
    async () => {
      if (el._objectUrl) {
        URL.revokeObjectURL(el._objectUrl);
        el._objectUrl = null;
      }
      el.remove();
      await sb.rpc("dismiss_ping", { p_id: ping.id });
    },
    { once: true }
  );
}
```

- [ ] **Step 5: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0.

- [ ] **Step 6: Manual verification**

As two contacts:
- Sender sends an image (`.png`/`.jpg`) → both sides see a thumbnail (after a brief loading pulse).
- Receiver's thumbnail appears WITHOUT auto-dismissing the ping (the preview fetch must not dismiss).
- Click the thumbnail → lightbox opens full-size; Escape, ✕, and backdrop click all close it; focus returns to the page.
- Receiver clicks **LADDA NER** → file saves AND ping auto-dismisses (unchanged).
- Send a non-image file → still shows the colored file-type icon row (Feature 1 intact).
- Dismiss an image ping → no console error; (verify no object-URL leak by dismissing several and checking memory/DevTools doesn't accumulate blob URLs).

- [ ] **Step 7: Commit**

```bash
git add static/app.js
git commit -m "feat: inline image thumbnails opening in lightbox, with object-URL cleanup"
```

---

## FEATURE 3 — Unread badges

### Task 8: Track and reset unread counts

**Files:**
- Modify: `static/app.js` (state ~line 48; `subscribeToRealtime` incoming handler ~line 717; `selectContact` ~line 483; `exitApp` ~line 307)

- [ ] **Step 1: Add unread state**

After `let contacts = [];` (~line 48), add:

```javascript
let unreadCounts = {}; // recipientId -> number of pings received while their chat was closed (this session)
```

- [ ] **Step 2: Increment on incoming ping when chat is closed**

In `subscribeToRealtime`, in the incoming-pings handler (the `table: "pings"` `.on` callback ~line 727), replace the body with:

```javascript
      (payload) => {
        const ping = payload.new;
        const chatOpen = selectedContact && ping.sender_id === selectedContact.recipientId;

        if (chatOpen) {
          renderPing(ping);
          scrollToBottom();
        } else {
          // Chat not open: count it as unread and schedule a decrement when the
          // ping would have auto-expired (keeps the badge consistent with the
          // 20s ephemeral lifetime).
          unreadCounts[ping.sender_id] = (unreadCounts[ping.sender_id] || 0) + 1;
          renderContacts();
          setTimeout(() => {
            if (unreadCounts[ping.sender_id] > 0) {
              unreadCounts[ping.sender_id] -= 1;
              renderContacts();
            }
          }, 20000);
        }

        playPing();
      }
```

- [ ] **Step 3: Reset on chat open**

In `selectContact` (~line 483), after `selectedContact = { contactId, recipientId, username };`, add:

```javascript
  if (unreadCounts[recipientId]) {
    unreadCounts[recipientId] = 0;
    renderContacts();
  }
```

- [ ] **Step 4: Clear on exit**

In `exitApp` (~line 307), where other state is reset (near `contacts = [];`), add:

```javascript
  unreadCounts = {};
```

- [ ] **Step 5: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "feat: track session-live unread counts per contact"
```

---

### Task 9: Render unread badges in the contact list

**Files:**
- Modify: `static/app.js` (`renderContacts`, accepted-contacts loop ~line 384-400)
- Modify: `static/style.css` (badge style)

- [ ] **Step 1: Append a badge in the accepted-contact render**

In `renderContacts`, inside the `accepted.forEach((c) => { ... })` loop, the contact element currently sets `el.textContent = "@" + username;`. Replace that line with markup that includes an optional badge:

```javascript
    const unread = unreadCounts[recipientId] || 0;
    el.innerHTML = `<span class="contact-name">@${escapeHtml(username)}</span>` +
      (unread > 0 ? `<span class="unread-badge">${unread}</span>` : "");
```

> Note: switching from `textContent` to `innerHTML` requires escaping the username (done above with `escapeHtml`). The click handler on `el` is added immediately after in existing code and still works.
>
> **Forward reference:** Task 11 (presence dots) replaces this same `el.innerHTML` with a version that wraps the dot + name in a `.contact-left` group. If you are implementing the full bundle, you may skip straight to Task 11's markup here and treat this step as the badge-only subset. Either order produces correct final code; Task 11's markup is the superset.

- [ ] **Step 2: Add badge + layout CSS**

Add to `static/style.css`:

```css
.contact-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.unread-badge {
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--fg);
  color: var(--bg);
  font-size: 0.7rem;
  font-weight: var(--font-weight-bold);
  text-align: center;
  flex: none;
}
```

> The existing `.contact-item` rule (~line 556) sets padding/cursor/etc.; this adds flex layout. Merge the `display:flex` into the existing rule rather than duplicating the selector if preferred — either works in CSS, but merging is cleaner.

- [ ] **Step 3: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0.

- [ ] **Step 4: Manual verification**

As two contacts (A and B), with A viewing a DIFFERENT chat or no chat:
- B sends A a ping → A's sidebar shows a badge `1` next to B, plus the ping sound.
- B sends two more → badge shows `3`.
- A opens B's chat → badge clears to 0 (disappears).
- B sends a ping while A has B's chat open → no badge (rendered inline instead).
- Wait 20s after an unread ping without opening the chat → badge decrements by one.

- [ ] **Step 5: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: show per-contact unread badges in the sidebar"
```

---

## FEATURE 4 — Presence (online dots)

### Task 10: Subscribe to a presence channel and track online users

**Files:**
- Modify: `static/app.js` (state ~line 49; `enterApp` ~line 284; new `subscribePresence`; `exitApp` ~line 307)

- [ ] **Step 1: Add presence state**

After `let realtimeChannel = null;` (~line 49), add:

```javascript
let presenceChannel = null;
let onlineUserIds = new Set();
```

- [ ] **Step 2: Add a `subscribePresence` function**

Add near `subscribeToRealtime`:

```javascript
// Tracks which users currently have Ping open, via Supabase Realtime presence
// on a shared channel. No DB writes. Updates the online dots in the sidebar.
function subscribePresence() {
  presenceChannel = sb.channel("presence", {
    config: { presence: { key: currentUser.id } },
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      onlineUserIds = new Set(Object.keys(state));
      renderContacts();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ online_at: new Date().toISOString() });
      }
    });
}
```

> Presence `key: currentUser.id` makes each user's presence entries keyed by their user id, so `Object.keys(presenceState())` is the set of online user ids.

- [ ] **Step 3: Call it on enter, tear it down on exit**

In `enterApp` (~line 290), after `subscribeToRealtime();`, add:

```javascript
  subscribePresence();
```

In `exitApp` (~line 298), alongside the `realtimeChannel` teardown, add:

```javascript
  if (presenceChannel) sb.removeChannel(presenceChannel);
  presenceChannel = null;
  onlineUserIds = new Set();
```

- [ ] **Step 4: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat: subscribe to Supabase Realtime presence and track online users"
```

---

### Task 11: Render presence dots in the contact list

**Files:**
- Modify: `static/app.js` (`renderContacts` accepted-contact render — the same `innerHTML` from Task 9)
- Modify: `static/style.css` (dot style)

- [ ] **Step 1: Add a dot to the contact markup**

In `renderContacts`, update the accepted-contact `el.innerHTML` from Task 9 to prepend a presence dot:

```javascript
    const unread = unreadCounts[recipientId] || 0;
    const online = onlineUserIds.has(recipientId);
    el.innerHTML =
      `<span class="presence-dot${online ? " online" : ""}" title="${online ? "Online" : "Offline"}"></span>` +
      `<span class="contact-name">@${escapeHtml(username)}</span>` +
      (unread > 0 ? `<span class="unread-badge">${unread}</span>` : "");
```

> Layout: the dot and name should sit on the left, badge on the right. Wrap dot+name so `justify-content: space-between` pushes the badge right — see CSS step.

- [ ] **Step 2: Adjust contact layout so dot+name group left, badge right**

Update the markup to group dot+name. Replace the Step-1 block with:

```javascript
    const unread = unreadCounts[recipientId] || 0;
    const online = onlineUserIds.has(recipientId);
    el.innerHTML =
      `<span class="contact-left">` +
        `<span class="presence-dot${online ? " online" : ""}" title="${online ? "Online" : "Offline"}"></span>` +
        `<span class="contact-name">@${escapeHtml(username)}</span>` +
      `</span>` +
      (unread > 0 ? `<span class="unread-badge">${unread}</span>` : "");
```

- [ ] **Step 3: Add dot + grouping CSS**

Add to `static/style.css`:

```css
.contact-item .contact-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.presence-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #444;
  flex: none;
}

.presence-dot.online {
  background: var(--fg);
  box-shadow: 0 0 4px var(--fg);
}
```

- [ ] **Step 4: Syntax check**

Run: `node --check static/app.js`
Expected: exit 0.

- [ ] **Step 5: Manual verification**

As two contacts in two browsers:
- Both logged in with each other's chat list visible → each sees the other's dot **green** (online).
- One logs out (or closes the tab) → within a few seconds the other sees that dot go **grey**.
- Log back in → dot returns to green.
- The dot does not break the unread badge layout (badge still right-aligned).

- [ ] **Step 6: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: show online/offline presence dots in the contact list"
```

---

## Final verification (whole bundle)

- [ ] **Run the full regression checklist** from [the spec](../specs/2026-06-05-richer-awareness-bundle-design.md) "Testing / verification" section: icons, previews, unread, presence, and the existing-behavior regressions (text pings, file send/download, dismiss, auto-dismiss timer, per-side soft-delete).
- [ ] **Confirm no CSP violations** in the console across all four features.
- [ ] `node --check static/app.js` → exit 0.
- [ ] **Update the README** "Features" list (optional) to mention image previews, unread badges, and presence.
- [ ] **Finish the branch** using superpowers:finishing-a-development-branch (merge / PR decision).

---

## Notes on simplifications allowed during execution

- **Unread decrement-on-expiry** (Task 8 Step 2): if the per-ping `setTimeout` decrement proves fiddly, the spec permits falling back to **clear-on-open only** (drop the `setTimeout` block). Note the choice in the commit body.
- **Lazy thumbnail loading** (Task 7): eager-on-render is used for simplicity. If history grows large, an `IntersectionObserver` is the documented optimization — not required now.
- **Presence channel scope**: a single global `"presence"` channel is used; every authenticated user broadcasts presence to it. Fine for the 2-person use case; revisit if presence is ever scoped per contact-pair.
