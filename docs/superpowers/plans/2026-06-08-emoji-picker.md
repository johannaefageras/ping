# Emoji Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the composer's disabled emoji button into a working popover picker (search + 7 category icons + 7×7 grid) that inserts shortcode tokens into the textarea, which render as inline SVG emoji art in message bubbles.

**Architecture:** Picking inserts a namespaced token `:e:<folder>/<id>:` at the caret in `#text-input`; it is stored verbatim in `ping.content` (no DB/server/CSP change). On render, a new `renderContent(raw)` pass replaces `linkify` on the text-ping branch and swaps tokens → `<img class="emoji-inline">` while still linkifying URLs. The picker lazily fetches `/data/emoji-data.json` (already in place) on first open and is built entirely from that data.

**Tech Stack:** Vanilla JS (no build step), FastAPI static serving, plain CSS. No automated test harness — **verification is `node --check` for syntax + manual in-browser checks**, matching the camera-menu / video-button plans.

**Reference:** [docs/superpowers/specs/2026-06-08-emoji-picker-design.md](../specs/2026-06-08-emoji-picker-design.md)

---

## Pre-flight notes for the implementer

- **Branch:** work is on `feat/emoji-picker` (already created; the spec + emoji assets are committed there).
- **Uncommitted user changes:** `static/index.html` and `static/style.css` have pre-existing uncommitted edits unrelated to emoji (composer toolbar tweaks). **Do not revert or stage them.** When you `git add` for a commit, **add only the specific files this plan's task touches** (the plan tells you which). For HTML/CSS tasks you will be adding *new* emoji markup/styles to files that are already modified — commit the whole file is unavoidable, so before the first HTML commit, confirm with a `git diff` that the only *new* changes beyond the user's pre-existing ones are yours. If unsure, ask rather than clobber.
- **Run the app:** `.venv/bin/uvicorn server:app --reload`, then open http://localhost:8000/app. You need two logged-in users (two browsers/profiles) to test send + receive; a single user can self-verify most of the flow by sending to a contact and viewing own bubbles.
- **The data is ready:** `static/data/emoji-data.json` exists with 7 categories (each with an `icon` field) and 343 items; all `file`/`icon` paths exist under `static/icons/emojis/`. Do **not** regenerate it.

---

## Task 1: Render emoji tokens as inline art (`renderContent`)

This task is independent of the picker UI: once done, typing a literal token like `:e:people/glad:` into the composer and sending it will render as art. That is the manual test.

**Files:**
- Modify: `static/app.js` — add `renderContent()` near `linkify` (~line 1262); change the text branch of `renderPing` (line 792) to call it.
- Modify: `static/style.css` — add `.emoji-inline` (anywhere in the `.item .content` area, e.g. after line 925).

- [ ] **Step 1: Add `.emoji-inline` CSS**

In `static/style.css`, immediately after the `.item .content a { … }` rule (ends ~line 925), add:

```css
/* Inline emoji art inside message bubbles. Sized in em so it scales with the
   surrounding text; vertical-align tuned to sit on the text line. */
.item .content .emoji-inline {
  display: inline-block;
  width: 1.4em;
  height: 1.4em;
  vertical-align: -0.32em;
  margin: 0 1px;
}
```

- [ ] **Step 2: Add `renderContent()` in app.js**

In `static/app.js`, directly **after** the `linkify` function (after its closing brace ~line 1262), add:

```js
// Emoji shortcode token: :e:<folder>/<id>: — inserted by the emoji picker and
// stored verbatim in ping.content. folder is a lowercase english slug; id is a
// lowercase slug that may contain Swedish å ä ö. Verified against the data: no
// id contains ':' '/' uppercase or space, so this is unambiguous.
const EMOJI_TOKEN_RE = /:e:([a-z-]+)\/([a-zåäö-]+):/g;
const URL_RE = /(https?:\/\/[^\s]+)/g;

// Render raw (unescaped) message content to safe HTML, handling BOTH emoji
// tokens and URLs in a single left-to-right pass so text is escaped exactly
// once. Replaces linkify() on the text-ping render path. Anything that isn't a
// recognized token or URL is escaped as plain text — a malformed token is left
// as literal text and never injected as HTML. The <img> src is built from the
// token payload alone, so a ping renders even before the emoji data is loaded;
// alt/label is taken from the loaded data when available, else the id.
function renderContent(text) {
  // Build one combined matcher by scanning for both patterns and taking the
  // earliest match at each position.
  let out = "";
  let pos = 0;
  while (pos < text.length) {
    EMOJI_TOKEN_RE.lastIndex = pos;
    URL_RE.lastIndex = pos;
    const em = EMOJI_TOKEN_RE.exec(text);
    const url = URL_RE.exec(text);
    // Pick whichever matches first (lowest index). null if none from here.
    let next = null;
    let kind = null;
    if (em && (!url || em.index <= url.index)) { next = em; kind = "emoji"; }
    else if (url) { next = url; kind = "url"; }

    if (!next) {
      out += escapeHtml(text.slice(pos));
      break;
    }
    out += escapeHtml(text.slice(pos, next.index));
    if (kind === "emoji") {
      const folder = next[1];
      const id = next[2];
      const label = emojiLabel(folder, id);
      const src = `/icons/emojis/${folder}/${encodeURI(id)}.svg`;
      out += `<img class="emoji-inline" src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy">`;
    } else {
      const url2 = escapeHtml(next[0]);
      out += `<a href="${url2}" target="_blank" rel="noopener">${url2}</a>`;
    }
    pos = next.index + next[0].length;
  }
  return out;
}

// Look up an emoji's Swedish label from the cached picker data; falls back to
// the id when the data isn't loaded yet or the emoji isn't found.
function emojiLabel(folder, id) {
  if (emojiIndex) {
    const entry = emojiIndex.get(`${folder}/${id}`);
    if (entry) return entry.label;
  }
  return id;
}
```

Note: `emojiIndex` is a module variable declared in Task 3. To keep Task 1 independently runnable, also add the declaration now — add this line near the top-of-file state block (after `let onlineUserIds = new Set();`, ~line 109):

```js
let emojiIndex = null; // Map<"folder/id", {label,...}> built lazily from emoji-data.json (see emoji picker)
```

- [ ] **Step 3: Use `renderContent` in `renderPing`**

In `static/app.js`, in `renderPing`'s text branch, change line 792 from:

```js
      <div class="content">${linkify(ping.content)}</div>
```

to:

```js
      <div class="content">${renderContent(ping.content)}</div>
```

Leave `linkify` itself in place (it is no longer called by this branch but is kept for clarity/other potential callers; do not delete it).

- [ ] **Step 4: Verify syntax**

Run: `node --check static/app.js`
Expected: no output (exit 0).

- [ ] **Step 5: Manual verify (token → art, URL still works, escaping)**

Start the server (`.venv/bin/uvicorn server:app --reload`), open http://localhost:8000/app, open a chat, and send these three messages, checking each bubble:

1. Send `hej :e:people/glad: då` → the bubble shows "hej [smiley art] då" with the art at ~1.4× the text height. (Confirm `/icons/emojis/people/glad.svg` loads — no broken image.)
2. Send `kolla https://example.com :e:people/tumme-upp:` → the URL is a clickable link **and** the emoji renders. Both in one message.
3. Send `a < b & c :e:nope/missing:` → shows literal `a < b & c` (correctly escaped, not breaking the page) and the malformed/nonexistent token: `:e:nope/missing:` matches the pattern (`nope`/`missing` are valid charset) so it becomes an `<img>` whose src 404s — acceptable (broken-image). Then send `x :e:Bad/THING: y` → does NOT match the pattern (uppercase), so it stays as the literal text `:e:Bad/THING:`.

- [ ] **Step 6: Commit**

```bash
git add static/app.js static/style.css
git commit -m "$(cat <<'EOF'
feat(composer): render emoji shortcode tokens as inline art

Add renderContent(): a single escaping-aware pass over raw message content
that swaps :e:<folder>/<id>: tokens for inline <img class="emoji-inline">
art and linkifies URLs. Replaces linkify() on the text-ping render path
(linkify kept). Token src is self-contained so incoming pings render even
before the picker data loads. No DB/server/CSP change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Enable the emoji button + picker markup + panel CSS

Adds the (still inert) UI shell: the enabled button and the hidden picker panel, styled. No data/JS behavior yet — clicking does nothing until Task 4. The manual test is purely visual (the panel can be temporarily un-hidden to inspect, then re-hidden).

**Files:**
- Modify: `static/index.html` — enable `#emoji-btn` (~line 546-569); add `#emoji-picker` markup inside `.composer-actions`.
- Modify: `static/style.css` — add `#emoji-picker` panel/search/cat-row/grid styles.

- [ ] **Step 1: Enable the emoji button**

In `static/index.html`, find the emoji button (the `<button>` with `id="emoji-btn"`, currently `class="composer-icon-btn is-placeholder"` and `disabled`). Change its opening tag from:

```html
                  <button
                    type="button"
                    class="composer-icon-btn is-placeholder"
                    id="emoji-btn"
                    aria-label="Emoji"
                    disabled
                  >
```

to:

```html
                  <button
                    type="button"
                    class="composer-icon-btn"
                    id="emoji-btn"
                    aria-label="Emoji"
                    aria-haspopup="true"
                    aria-expanded="false"
                  >
```

(Remove `is-placeholder` and `disabled`; add the two aria attributes. Keep the inner smiley `<svg>` unchanged.)

- [ ] **Step 2: Add the picker panel markup**

In `static/index.html`, inside `.composer-actions` (the `<div class="composer-actions">` …), add the following as a **sibling** of the toolbar buttons, immediately **after** the emoji button's closing `</button>` and before the `#video-menu` div (placement within `.composer-actions` only matters for source order, not visual position — the panel is absolutely positioned):

```html
                  <div
                    id="emoji-picker"
                    class="emoji-picker hidden"
                    role="dialog"
                    aria-label="Emoji"
                  >
                    <input
                      type="text"
                      id="emoji-search"
                      class="emoji-search"
                      placeholder="S&ouml;k emoji&hellip;"
                      autocomplete="off"
                      aria-label="S&ouml;k emoji"
                    />
                    <div id="emoji-cat-row" class="emoji-cat-row" role="tablist" aria-label="Kategorier"></div>
                    <div id="emoji-cat-label" class="emoji-cat-label"></div>
                    <div id="emoji-grid" class="emoji-grid" role="listbox" aria-label="Emoji"></div>
                    <div id="emoji-status" class="emoji-status hidden"></div>
                  </div>
```

- [ ] **Step 3: Add the picker CSS**

In `static/style.css`, immediately after the `.composer-menu-item .icon { … }` rule (~line 1105, before `.composer-icon-btn {`), add:

```css
/* --- Emoji picker popover --- */
.emoji-picker {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 340px;
  background: var(--bg, #0a0a0a);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 50;
}
.emoji-picker.hidden { display: none; }

.emoji-search {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #141414;
  color: var(--fg, #ddd);
  font: inherit;
  font-size: 0.85rem;
  outline: none;
}
.emoji-search::placeholder { color: #777; }

.emoji-cat-row {
  display: flex;
  gap: 2px;
  margin: 8px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.emoji-cat-btn {
  flex: 1;
  height: 38px;
  padding: 4px;
  border: none;
  border-radius: 7px;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.emoji-cat-btn img { width: 24px; height: 24px; display: block; }
.emoji-cat-btn:hover { background: #161616; }
.emoji-cat-btn.sel { background: #1a1a1a; }

.emoji-cat-label {
  font-size: 0.7rem;
  color: #aaa;
  margin: 0 2px 6px;
  min-height: 14px;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  max-height: 252px;
  overflow-y: auto;
  padding-right: 2px;
}
.emoji-grid-cell {
  aspect-ratio: 1;
  padding: 5px;
  border: none;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.emoji-grid-cell img { width: 100%; height: 100%; display: block; }
.emoji-grid-cell:hover { background: #1a1a1a; }

.emoji-status {
  font-size: 0.78rem;
  color: #888;
  padding: 16px 8px;
  text-align: center;
}
.emoji-status.hidden { display: none; }
```

- [ ] **Step 4: Verify the markup parses and panel is styled**

Run: `node --check static/app.js` (unchanged here, but confirms nothing broke if you touched it) — expected no output. (HTML/CSS have no syntax checker; verify visually next.)

Temporarily test the panel look: in the running app, open DevTools console and run `document.getElementById('emoji-picker').classList.remove('hidden')`. Expected: a dark rounded panel appears above the toolbar with a search box, an empty category row, and an empty grid area (no emojis yet — that's Task 3). Re-hide with `…classList.add('hidden')`. Confirm the emoji button is no longer greyed-out/disabled (it's full-opacity and hover-highlights like the other icons).

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/style.css
git commit -m "$(cat <<'EOF'
feat(composer): enable emoji button + add emoji picker panel markup/CSS

Enable #emoji-btn (remove disabled/is-placeholder, add aria) and add the
hidden #emoji-picker popover shell (search + category row + grid) styled to
match the .composer-menu dark panel. No behavior yet (wired in later tasks).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Load emoji data and build the category row + grid

Adds the data fetch (lazy, cached), the `folder/id → entry` index used by `emojiLabel` (Task 1), and functions that render a category's emojis into the grid and the category icons into the row. Still no open/close or click behavior — those come in Task 4. The manual test calls the build function from the console.

**Files:**
- Modify: `static/app.js` — add DOM refs, data load, index build, category-row + grid render functions.

- [ ] **Step 1: Add DOM references**

In `static/app.js`, in the DOM-references block near the top (after `const textInput = …`, ~line 74), add:

```js
const emojiBtn = document.getElementById("emoji-btn");
const emojiPicker = document.getElementById("emoji-picker");
const emojiSearch = document.getElementById("emoji-search");
const emojiCatRow = document.getElementById("emoji-cat-row");
const emojiCatLabel = document.getElementById("emoji-cat-label");
const emojiGrid = document.getElementById("emoji-grid");
const emojiStatus = document.getElementById("emoji-status");
```

- [ ] **Step 2: Add emoji picker state + data load**

In `static/app.js`, add a new section near the other composer-popup code (after the camera menu block, ~line 1517, just before `// --- Photo capture modal ---`). `emojiIndex` was already declared in Task 1; declare the rest here:

```js
// ============================================================
// EMOJI PICKER
// ============================================================

let emojiData = null;        // parsed emoji-data.json { categories: [...] }
let emojiSelectedCat = null; // currently shown category id (when not searching)
let emojiLoaded = false;     // data successfully loaded & UI built once
// emojiIndex (Map "folder/id" -> item) is declared near the top-of-file state.

// Fetch + cache the emoji data on first open. Returns true on success. Builds
// the folder/id index (used by renderContent's emojiLabel) and the category
// row. Shows an inline error and returns false on failure.
async function loadEmojiData() {
  if (emojiLoaded) return true;
  emojiSetStatus("Laddar…");
  try {
    const res = await fetch("/data/emoji-data.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    emojiData = await res.json();
  } catch (err) {
    console.error("Failed to load emoji data:", err);
    emojiSetStatus("Kunde inte ladda emojis.");
    return false;
  }
  // Build the "folder/id" -> item index. folder is item.file's first segment.
  emojiIndex = new Map();
  for (const cat of emojiData.categories) {
    for (const item of cat.items) {
      const folder = item.file.split("/")[0];
      emojiIndex.set(`${folder}/${item.id}`, item);
    }
  }
  emojiBuildCatRow();
  emojiLoaded = true;
  emojiClearStatus();
  return true;
}

// Show / hide the inline status line (loading / error / empty-search).
function emojiSetStatus(msg) {
  emojiStatus.textContent = msg;
  emojiStatus.classList.remove("hidden");
}
function emojiClearStatus() {
  emojiStatus.textContent = "";
  emojiStatus.classList.add("hidden");
}
```

- [ ] **Step 3: Add the category-row + grid render functions**

Append, in the same emoji section:

```js
// Build the 7 category icon buttons from the data (order = data order).
function emojiBuildCatRow() {
  emojiCatRow.innerHTML = "";
  emojiData.categories.forEach((cat, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-cat-btn" + (i === 0 ? " sel" : "");
    btn.title = cat.label;
    btn.setAttribute("aria-label", cat.label);
    btn.dataset.catId = cat.id;
    const img = document.createElement("img");
    img.src = `/icons/emojis/${encodeURI(cat.icon)}`;
    img.alt = cat.label;
    btn.appendChild(img);
    emojiCatRow.appendChild(btn);
  });
}

// Render a list of emoji items into the grid as clickable cells.
function emojiRenderGrid(items) {
  emojiGrid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "emoji-grid-cell";
    cell.title = item.label;
    cell.setAttribute("aria-label", item.label);
    // folder/id token payload, stored on the element for the click handler.
    const folder = item.file.split("/")[0];
    cell.dataset.token = `${folder}/${item.id}`;
    const img = document.createElement("img");
    img.src = `/icons/emojis/${encodeURI(item.file)}`;
    img.alt = item.label;
    img.loading = "lazy";
    cell.appendChild(img);
    frag.appendChild(cell);
  }
  emojiGrid.appendChild(frag);
}

// Show one category's emojis and mark its icon selected.
function emojiShowCategory(catId) {
  const cat = emojiData.categories.find((c) => c.id === catId);
  if (!cat) return;
  emojiSelectedCat = catId;
  emojiCatLabel.textContent = cat.label;
  emojiRenderGrid(cat.items);
  emojiClearStatus();
  for (const btn of emojiCatRow.querySelectorAll(".emoji-cat-btn")) {
    btn.classList.toggle("sel", btn.dataset.catId === catId);
  }
}
```

- [ ] **Step 4: Verify syntax**

Run: `node --check static/app.js`
Expected: no output (exit 0).

- [ ] **Step 5: Manual verify (data builds via console)**

In the running app, open DevTools console and run:

```js
await loadEmojiData();
document.getElementById('emoji-picker').classList.remove('hidden');
emojiShowCategory('människor');
```

Expected: the category row fills with 7 icons (your `people.svg` … `symbols.svg`), the label shows "Människor", and the grid fills with 49 People emoji at 7 per row (scrollable). Run `emojiShowCategory('symboler')` → grid swaps to Symboler and that icon highlights. Run `emojiIndex.get('people/glad')` → returns the glad item object (confirms the index powers `renderContent`'s label lookup). Re-hide the panel.

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "$(cat <<'EOF'
feat(composer): load emoji data and build category row + grid

Lazily fetch/cache /data/emoji-data.json, build the folder/id index that
powers inline-emoji labels, and add functions to render the 7 category icons
and a category's 49 emojis into the grid. No open/click wiring yet.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Open/close the picker + insert emoji at the caret

Wires the button to open/close the popover (toggle, outside-click, Escape, aria), loads data on first open, defaults to the first category, and inserts a token at the caret when an emoji is clicked (popover stays open).

**Files:**
- Modify: `static/app.js` — add the open/close controller, emoji-click handler, insert-at-caret helper.

- [ ] **Step 1: Add the insert-at-caret helper**

In `static/app.js`, in the emoji section (after `emojiShowCategory`), add:

```js
// Insert text at the textarea caret (replacing any selection), place the caret
// after it, refocus, and trigger the existing auto-grow / hint listeners via a
// synthetic input event.
function insertAtCaret(textarea, str) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + str + after;
  const caret = start + str.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  // Notify existing 'input' listeners (autoGrowInput, renderCommandHints).
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
```

- [ ] **Step 2: Add the open/close controller + wiring**

Append in the emoji section:

```js
function emojiOpen() {
  emojiPicker.classList.remove("hidden");
  emojiBtn.setAttribute("aria-expanded", "true");
}
function emojiClose() {
  emojiPicker.classList.add("hidden");
  emojiBtn.setAttribute("aria-expanded", "false");
}
function emojiIsOpen() {
  return !emojiPicker.classList.contains("hidden");
}

// Toggle on button click. On open, load data if needed, then show the selected
// (or first) category and focus the search box.
emojiBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (emojiIsOpen()) {
    emojiClose();
    return;
  }
  emojiOpen();
  const ok = await loadEmojiData();
  if (!ok) return; // status line already shows the error; keep panel open
  emojiSearch.value = "";
  emojiShowCategory(emojiSelectedCat || emojiData.categories[0].id);
  emojiSearch.focus();
});

// Category icon click → show that category (event-delegated).
emojiCatRow.addEventListener("click", (e) => {
  const btn = e.target.closest(".emoji-cat-btn");
  if (!btn) return;
  emojiSearch.value = "";
  emojiShowCategory(btn.dataset.catId);
});

// Emoji click → insert token at the caret; keep the popover open.
emojiGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".emoji-grid-cell");
  if (!cell) return;
  insertAtCaret(textInput, `:e:${cell.dataset.token}:`);
});

// Outside-click closes (mirrors createPopupMenu). The button's own handler
// manages toggling, so ignore clicks on it here.
document.addEventListener("click", (e) => {
  if (!emojiIsOpen()) return;
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
    emojiClose();
  }
});

// Escape closes (matches camera/video). Works whether focus is in the search
// box or elsewhere in the panel.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && emojiIsOpen()) {
    emojiClose();
    emojiBtn.focus();
  }
});

emojiClose(); // ensure hidden + aria initialised regardless of HTML
```

- [ ] **Step 3: Verify syntax**

Run: `node --check static/app.js`
Expected: no output (exit 0).

- [ ] **Step 4: Manual verify (open/close + insert)**

In the running app, open a chat:

1. Click the emoji button → popover opens above it, search box focused, first category (Människor) shown with 49 emoji. Button `aria-expanded` is `true` (check in DevTools).
2. Click a different category icon → grid swaps; that icon highlights.
3. Click an emoji → its token (`:e:people/glad:`) appears in the textarea at the caret; **popover stays open**. Click another → second token appended at caret. Type text between clicks → tokens insert at the caret position, not just the end.
4. Press **Escape** → popover closes, `aria-expanded` is `false`, focus returns to the button. Reopen, then **click outside** the popover → closes. Click the button again while open → closes (toggle).
5. Confirm the **camera and video menus still open/close** normally (no interference from the new global click/keydown listeners).
6. Send the message with the inserted tokens → bubble shows the emoji art inline (end-to-end: pick → insert → send → render).

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "$(cat <<'EOF'
feat(composer): wire emoji picker open/close + insert-at-caret

Toggle the popover on the emoji button (outside-click + Escape close, aria
synced), lazily load data on first open, default to the first category, and
insert :e:<folder>/<id>: at the textarea caret on emoji click (popover stays
open for multi-pick). Mirrors the camera/video menu conventions.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Search (filter by label + tags)

Adds live filtering across all categories by `label` and `tags`, diacritic-tolerant, with an empty-state message; clearing the field returns to the selected category.

**Files:**
- Modify: `static/app.js` — add the search filter + input handler.

- [ ] **Step 1: Add the search filter function**

In `static/app.js`, in the emoji section (after `emojiShowCategory`), add:

```js
// Normalize for diacritic-tolerant, case-insensitive matching: lowercase and
// strip combining marks so "glad"/"GLÄD" etc. compare on their base letters.
// (Swedish å ä ö decompose to a/a/o here, which is what we want for search.)
function emojiNormalize(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Filter all emoji across categories whose label or any tag contains the query.
function emojiSearchItems(query) {
  const q = emojiNormalize(query.trim());
  if (!q) return null; // signal: not searching
  const results = [];
  for (const cat of emojiData.categories) {
    for (const item of cat.items) {
      const hay = [item.label, ...(item.tags || [])].map(emojiNormalize);
      if (hay.some((h) => h.includes(q))) results.push(item);
    }
  }
  return results;
}
```

- [ ] **Step 2: Add the search input handler**

In `static/app.js`, in the emoji wiring (after the `emojiGrid` click listener from Task 4), add:

```js
// Live search: filter across all categories by label + tags. Empty query
// returns to the selected category. Clears the category-row highlight while
// searching (no single category is "selected").
emojiSearch.addEventListener("input", () => {
  const results = emojiSearchItems(emojiSearch.value);
  if (results === null) {
    emojiShowCategory(emojiSelectedCat || emojiData.categories[0].id);
    return;
  }
  for (const btn of emojiCatRow.querySelectorAll(".emoji-cat-btn")) {
    btn.classList.remove("sel");
  }
  emojiCatLabel.textContent = "Sökresultat";
  if (results.length === 0) {
    emojiGrid.innerHTML = "";
    emojiSetStatus("Inga emojis hittades.");
  } else {
    emojiClearStatus();
    emojiRenderGrid(results);
  }
});
```

- [ ] **Step 3: Verify syntax**

Run: `node --check static/app.js`
Expected: no output (exit 0).

- [ ] **Step 4: Manual verify (search)**

In the running app, open the emoji picker:

1. Type `glad` → grid filters to emoji whose label/tags contain "glad" (e.g. Glad, plus others tagged "glad" like Fest/Flinar). Label reads "Sökresultat"; no category icon highlighted.
2. Type a **tag** that isn't in any label, e.g. `happy` (a tag on `glad`) or `party` (tag on `fest`) → matching emoji appear (confirms tag search).
3. Type `GLÄD` or `glÄd` → still matches "glad" (confirms case- and diacritic-tolerance).
4. Type something with no matches, e.g. `zzzxxx` → grid empties and "Inga emojis hittades." shows.
5. Clear the field → returns to the previously-selected category with its 49 emoji and the category highlight restored.
6. With search results showing, click an emoji → its token still inserts at the caret (popover stays open).

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "$(cat <<'EOF'
feat(composer): emoji picker search by label and tags

Live-filter emoji across all categories by label + tags, case-insensitive and
diacritic-tolerant, with a 'Sökresultat' label and an 'Inga emojis hittades.'
empty state; clearing the field returns to the selected category.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full integration pass + cleanup

A final end-to-end manual verification across the whole feature and the previously-shipped composer features, plus a ref-consistency sweep. No new code unless a check fails.

**Files:**
- Possibly modify: `static/app.js` (only to fix anything a check surfaces).

- [ ] **Step 1: Ref-consistency sweep**

Run: `node --check static/app.js && node --check static/keyboard.js`
Expected: no output.

Run: `grep -n "emojiIndex\|renderContent\|loadEmojiData\|insertAtCaret" static/app.js`
Expected: each is defined once and used; no typos / undefined references. Confirm `emojiIndex` is declared exactly once (top-of-file state block) and not re-declared in the emoji section.

Run: `grep -n "linkify(" static/app.js`
Expected: `renderPing` no longer calls `linkify` (it calls `renderContent`); `linkify`'s own definition remains. (If `firstUrl`/`renderLinkPreview` still use their own regex, that's fine — untouched.)

- [ ] **Step 2: End-to-end manual verification (two users)**

With the server running and two logged-in users (two browsers), in an open chat between them:

1. **Pick + multi-insert + send:** open picker, insert 2–3 emoji mixed with typed text, send → sender's bubble shows inline art (1.4em) interleaved with text.
2. **Receive:** the **other** user's window shows the same message with the emoji art rendered (confirms the incoming/realtime path renders tokens, even though that browser may never have opened the picker — the src is self-contained).
3. **URL + emoji together:** send a message with a URL and an emoji → link is clickable, link-preview card still appears (if applicable), emoji renders.
4. **Search → pick → send** works end to end.
5. **Close behaviors:** Escape, outside-click, and button-toggle all close the picker; `aria-expanded` stays correct.
6. **No regressions:** camera menu (upload/take photo) and video menu (pick/record) still open, close, and function; `/commands` and command-hints still work in the textarea (type `/` → hints appear; the emoji insert does not break them); Enter still sends; the textarea still auto-grows and resets after send.
7. **Data failure:** stop the server, rename `static/data/emoji-data.json` aside, restart, open the picker → shows "Kunde inte ladda emojis." and does not crash; restore the file.

- [ ] **Step 3: Commit (only if Step 1/2 required a fix)**

```bash
git add static/app.js
git commit -m "$(cat <<'EOF'
fix(composer): <describe the integration fix>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

If no fix was needed, skip the commit — the feature is complete on the prior tasks.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill. Per the project convention (camera-menu, video-button), expect a `--no-ff` merge to `main` after the user's manual browser test. The user performs the manual test; do not merge without their confirmation.

---

## Notes carried from the spec

- **No server/CSP/DB change.** `img-src 'self'` covers the art; `/data/` and `/icons/emojis/` are already served.
- **Token charset is verified** against the data (`folder` = `[a-z-]+`, `id` = `[a-zåäö-]+`); the regex in Task 1 is exact.
- **`path` category field is intentionally ignored**; `file` is the source of truth for art location.
- **Out of scope (do not add):** jumbo all-emoji sizing, recents/favorites, skin tones, emoji outside chat text, editing sent emoji, contenteditable composer.
