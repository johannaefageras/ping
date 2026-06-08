# Emoji picker — design

**Date:** 2026-06-08
**Status:** Approved

## Goal

Turn the composer toolbar's currently-disabled emoji button into a working
**emoji picker** that opens as a popover above the button. Picking an emoji
inserts it into the composer's text field (the user keeps typing — it does not
send immediately), and a chosen emoji renders as the **actual custom SVG art**
inline inside the message bubble, mixed with text.

The picker is built from a data file the user provides
(`static/data/emoji-data.json`) plus SVG art under `static/icons/emojis/<category>/`;
it does not hardcode the emoji set.

## Current state

- The emoji button is a disabled placeholder in
  [static/index.html](../../../static/index.html) (~line 546):
  `<button class="composer-icon-btn is-placeholder" id="emoji-btn" … disabled>`
  with an inline lucide smiley SVG. It sits in `.composer-actions` (~line 415)
  next to `#camera-btn`, `#video-btn`, `#attach-btn`. No JS wiring.
- Text messages are composed in `<textarea id="text-input">` inside
  `<form id="text-form">` (refs `textInput` / `textForm`,
  [static/app.js:73-74](../../../static/app.js)).
- **Send** ([static/app.js:966-1004](../../../static/app.js)): on submit, the
  trimmed value is inserted into Supabase `pings` as `type:"text"`, `content:text`
  (a plain string), then `renderPing(data)` is called. No schema constraint on
  content beyond text.
- **Render** ([static/app.js:784-794](../../../static/app.js)): a text ping's
  body is `<div class="content">${linkify(ping.content)}</div>`. `linkify`
  ([static/app.js:1250-1262](../../../static/app.js)) escapes text and turns URLs
  into anchors, operating on the **raw** (unescaped) content. `escapeHtml`
  ([static/app.js:1399-1406](../../../static/app.js)) escapes `& < > " '`.
  Incoming/realtime pings render through the same `renderPing`.
- **Shared popup helper** `createPopupMenu(button, menu)`
  ([static/app.js:1463-1486](../../../static/app.js)) returns `{ open, close }`
  and handles click-toggle, outside-click close, Escape close, and
  `aria-expanded` sync. Camera and video buttons use it. `.composer-actions` is
  `position: relative` and anchors these popovers
  ([static/style.css:1068-1086](../../../static/style.css), `.composer-menu`).
- **CSP** ([server.py:40-52](../../../server.py)): `img-src 'self' data: blob:`,
  `default-src 'self'`. `static/` is mounted at the web root
  ([server.py:199](../../../server.py)), so `static/icons/emojis/...` →
  `/icons/emojis/...` and `static/data/...` → `/data/...`. No inline event
  handlers allowed (no `'unsafe-inline'` in `script-src`).

## Assets (provided by the user — already in place)

- **Art:** 343 SVGs, 7 categories × 49 each, under
  `static/icons/emojis/<category>/` with category folders `people/`, `nature/`,
  `food-drink/`, `activity/`, `travel-places/`, `objects/`, `symbols/`. Plus 7
  top-level category icons (`people.svg` … `symbols.svg`) for the category row.
  The art is full-color **gradient** SVG (`viewBox 0 0 512 512`) with internal
  `<style>` blocks whose class names (`.cls-1`, `.cls-2`, …) repeat across files.
- **Data:** `static/data/emoji-data.json` (already moved here; fetched as
  `/data/emoji-data.json`). The 7 `icon` fields have been added (one per
  category). All 343 `file` paths and all 7 `icon` paths were verified to exist
  on disk.

### Category slug ↔ Swedish label mapping

| JSON category `id` | Swedish `label`   | folder / `icon`       |
|--------------------|-------------------|-----------------------|
| `människor`        | Människor         | `people` / `people.svg`             |
| `djur-natur`       | Djur & natur      | `nature` / `nature.svg`             |
| `mat-dryck`        | Mat & dryck       | `food-drink` / `food-drink.svg`     |
| `aktiviteter`      | Aktiviteter       | `activity` / `activity.svg`         |
| `platser-resor`    | Platser & resor   | `travel-places` / `travel-places.svg` |
| `prylar`           | Prylar            | `objects` / `objects.svg`           |
| `symboler`         | Symboler          | `symbols` / `symbols.svg`           |

Category order in the picker = the JSON array order, which already matches the
required order (Människor, Djur & Natur, Mat & Dryck, Aktiviteter, Platser &
Resor, Prylar, Symboler).

### emoji-data.json schema

```jsonc
{
  "version": 1,
  "locale": "sv-SE",
  "categories": [
    {
      "id": "människor",        // Swedish category id
      "label": "Människor",     // tooltip on the category icon
      "icon": "people.svg",     // row icon, path under /icons/emojis/
      "path": "människor",      // PRESENT BUT UNUSED by the picker (see below)
      "items": [
        {
          "id": "glad",                 // emoji id (matches filename, no ext)
          "file": "people/glad.svg",    // path under /icons/emojis/ — source of truth
          "label": "Glad",              // Swedish name; tooltip/aria + searched
          "tags": ["leende","nöjd","lycklig","snäll","vänlig","mysig"]  // searched
        }
        // … 49 items
      ]
    }
    // … 7 categories
  ]
}
```

- **`file` is the source of truth** for locating art:
  `file` → `/icons/emojis/<file>` (e.g. `/icons/emojis/people/glad.svg`).
- **Category `path` is ignored** — its value (`"människor"`, `"djur & natur"`)
  does not match any folder; the picker never reads it. Left in the file as-is.
- **Search** matches an emoji if the query is a substring of its `label` or any
  of its `tags`, case-insensitively and diacritic-tolerantly.

## Decisions (locked)

1. **Composer representation = shortcode tokens.** Picking inserts a text token
   into the `<textarea>`; it is stored verbatim in `ping.content` (a plain
   string — **no DB/schema/server change**); the render path swaps it for inline
   art. The textarea is unchanged (Enter-to-send, auto-grow, paste, `/commands`,
   command hints all keep working). Rejected: contenteditable composer (rewrites
   all textarea handling — highest regression risk); opaque sentinel chars (no
   upside over readable shortcodes).
2. **Token format = `:e:<folder>/<id>:`** — e.g. `:e:people/glad:`,
   `:e:food-drink/tv-spel:`. The `:e:` prefix makes accidental collision with
   typed text effectively impossible; the `folder/id` payload (the `file` minus
   `.svg`) maps directly and uniquely to the SVG. Rejected: plain `:slug:` (ids
   can clash across categories, e.g. `klocka` in both `objects` and `symbols`,
   and bare words a user types could trigger it).
3. **Rendering mechanism = `<img>`, not inline `<svg>`.** The art's repeated
   `.cls-*` class names in internal `<style>` blocks would collide if many SVGs
   were injected inline, corrupting colors. `<img src="/icons/emojis/…">` avoids
   that and is allowed by `img-src 'self'`. (The brief said "inline SVG"; an
   `<img>` to the SVG file is visually identical without the collision bug.)
4. **Inline emoji size = 1.4em** (`B/Medium`). Sized in `em` so it scales with
   the line.
5. **No jumbo all-emoji sizing in v1.**
6. **After picking, the popover stays open** (rapid multi-pick); closes on
   Escape, outside-click, or toggling the button.
7. **Insert at the caret** (replacing any selection), caret placed after the
   token, textarea refocused.
8. **Search auto-focuses** on open.
9. **Data file at `static/data/emoji-data.json`**, fetched lazily on first open.
10. **Category icons** come from a new per-category `icon` field (added) — fully
    data-driven, no hardcoded Swedish→english map in code.

## Architecture — the token round-trip

```
PICK   → insert  :e:people/glad:  at the caret in #text-input (textarea)
STORE  → ping.content holds the raw string verbatim, e.g. "Hej :e:people/glad:"
         (unchanged send/store path — a token is just text)
RENDER → renderContent(raw) swaps each :e:<folder>/<id>: →
         <img class="emoji-inline" src="/icons/emojis/<folder>/<id>.svg"
              alt="<label>" loading="lazy">
         and linkifies URLs, escaping all other text exactly once.
```

The `src` is built from the token payload alone, so **a ping renders even if the
data file isn't loaded** (e.g. an incoming ping before the picker was ever
opened). The data file is needed for the picker UI and for the emoji `alt`/label,
not for rendering the art.

## Components

### 1. Emoji button (markup + enable)

In [static/index.html](../../../static/index.html), inside `.composer-actions`:
remove `disabled` and the `is-placeholder` class from `#emoji-btn`; add
`aria-haspopup="true"` and `aria-expanded="false"` (mirroring `#camera-btn` /
`#video-btn`). Keep the existing lucide smiley SVG.

### 2. Emoji picker panel (markup)

Add `#emoji-picker` inside `.composer-actions` (already `position: relative`),
hidden by default via the `.hidden` class. Structure, top → bottom:

- a search `<input type="text">` (Swedish placeholder, e.g. "Sök emoji…"),
- `#emoji-cat-row` — 7 category `<button>`s (built from data),
- a category-label line (e.g. "Människor" / "Sökresultat"),
- `#emoji-grid` — a 7-column CSS grid (scrolls vertically).

### 3. Data load (lazy, cached) — first JSON-data fetch pattern

On the **first** open, `fetch("/data/emoji-data.json")`, parse, and cache in a
module-scoped variable. Subsequent opens reuse the cache. While loading, show a
small "Laddar…" state; on failure, an inline Swedish error
("Kunde inte ladda emojis.") and no crash. This establishes the app's first
data-file fetch pattern.

### 4. Picker controller (open/close/search/grid)

Own controller (the panel is richer than a simple menu), but it **mirrors
`createPopupMenu`'s conventions** for consistency: click-toggle on `#emoji-btn`
(with `e.stopPropagation()`), outside-click close, Escape close, `aria-expanded`
sync, and an idempotent initial close. If the shared helper can be cleanly
reused for the open/close/outside/Escape mechanics, prefer that and layer the
search+grid on top; otherwise a small parallel controller following the same
shape.

Behavior:
- **Open** → show panel, focus the search input, render the currently-selected
  category (default: the first category) into the grid.
- **Category click** → render that category's items; highlight the selected
  category button; update the label.
- **Search input** → filter across **all** categories by `label` + `tags`
  (case-insensitive, diacritic-tolerant); label becomes "Sökresultat"; empty
  result shows "Inga emojis hittades."; clearing the field returns to the
  selected category.
- **Emoji (grid cell) click** → insert the token at the caret in `#text-input`
  (replace selection, place caret after, refocus textarea); **keep the popover
  open**.
- **Close** → outside-click, Escape, or toggling `#emoji-btn`. No
  keyboard-overlay-registry entry (it is a lightweight popover, not a modal;
  Escape handling in the controller suffices, matching camera/video).

Each grid cell is a `<button>` containing
`<img src="/icons/emojis/<file>" alt="<label>" loading="lazy">` with `title` /
`aria-label` = the Swedish `label`.

### 5. Insert-at-caret helper

Given the token string and `#text-input`: replace the current selection
(`selectionStart`…`selectionEnd`) with the token, set the caret to just after the
inserted token, and refocus the textarea. Then trigger the existing auto-grow /
height-reset path so the field resizes if needed.

### 6. Render — `renderContent(raw)` (replaces `linkify` on the text-ping path)

A single escaping-aware pass over the **raw** content producing safe HTML:

- Scan left-to-right for `:e:<folder>/<id>:` tokens **and** URLs.
- Plain text between matches → `escapeHtml`.
- **Token** → `<img class="emoji-inline" src="/icons/emojis/<folder>/<id>.svg"
  alt="<label>" loading="lazy">`. `folder` and `id` are validated against a
  strict charset. Verified against the actual data: every `folder` matches
  `[a-z-]+` (lowercase english slug + hyphen) and every `id` matches
  `[a-zåäö-]+` (lowercase incl. Swedish `åäö` + hyphen); no id contains `:`,
  `/`, uppercase, or spaces, so token parsing is unambiguous. Concrete pattern:
  `/:e:([a-z-]+)\/([a-zåäö-]+):/g`. A token that doesn't match is left as
  literal escaped text (never injected as HTML). `alt`/label is looked up in
  the cached data if present, else falls back to `id`.
- **URL** → the existing linkify anchor markup.

In `renderPing` ([static/app.js:792](../../../static/app.js)), the text branch
calls `renderContent(ping.content)` instead of `linkify(ping.content)`.
`linkify` stays unchanged for any other callers. Received/realtime pings render
emoji because they go through the same `renderPing`.

### 7. CSS (new, matching the existing language)

- `.emoji-inline` — `1.4em` square, `display:inline-block`, `vertical-align`
  tuned to sit on the text line, small horizontal margin.
- `#emoji-picker` + children — dark panel using `--bg`, `--border`,
  `border-radius:10px`, shadow `0 8px 24px rgba(0,0,0,.5)`, anchored
  `bottom: calc(100% + 8px); left:0`, `z-index:50` (same family as
  `.composer-menu`, but its own classes): search input, 7-column category row
  with a selected-state highlight, and a scrollable 7-column grid with hover
  highlight on cells. Reuse the `.hidden` show/hide convention.

### 8. CSP / server

**No change.** `img-src 'self'` covers the art; `/data/emoji-data.json` and
`/icons/emojis/**` are already served by the `StaticFiles` mount.

## Data flow

```
emoji-btn click → picker controller (mirrors createPopupMenu)
  └─ first open: fetch /data/emoji-data.json → cache → build cat row + grid
  ├─ category click → grid = that category's items
  ├─ search input   → grid = items across all categories matching label/tags
  └─ emoji click    → insert ":e:<file-without-.svg>:" at caret in #text-input
                      (popover stays open)

send (unchanged) → pings.insert{ type:"text", content:"…:e:people/glad:…" }
                 → renderPing(data)

renderPing (text branch) → renderContent(raw):
   text → escapeHtml ; token → <img class="emoji-inline" …> ; url → <a …>
```

## Error handling

- **Data fetch fails** → inline Swedish error in the panel; picker doesn't crash;
  retried on next open.
- **Malformed token** in content (doesn't match the strict pattern) → left as
  literal escaped text (never injected as HTML).
- **Missing art file** referenced by a valid token → the `<img>` 404s; handle
  per existing convention (CSP forbids inline `onerror`; if a fallback is wanted,
  attach an `error` listener in JS as done for file-type icons — otherwise the
  broken image is acceptable and rare since tokens come from the picker).
- **Empty search** → "Inga emojis hittades." message; no grid.

## Out of scope (v1)

- Jumbo all-emoji sizing; recents/favorites; skin-tone variants.
- Emoji anywhere other than chat message text (usernames, etc.).
- Editing the emoji in an already-sent message.
- contenteditable composer; any change to `pings` schema, storage, the send
  handler, or server/CSP.

## Testing (manual, in-browser — no automated harness)

Run `.venv/bin/uvicorn server:app --reload`, open http://localhost:8000/app.

1. Emoji button is enabled; clicking opens the popover above it; search is
   auto-focused.
2. The 7 category icons render; clicking each shows that category's 49 emojis;
   the selected category is highlighted and the label updates.
3. Search by **label** (e.g. "glad") and by **tag** (e.g. "happy", "party")
   filters across categories; diacritics tolerant; empty result shows the
   empty-state message; clearing returns to the category.
4. Clicking an emoji inserts the token at the caret in the textarea; the popover
   stays open; multi-pick works; caret position and refocus are correct;
   inserting mid-text works.
5. Sending shows the emoji as inline art (1.4em) mixed with text in the bubble; a
   URL in the same message still linkifies.
6. A **received** ping (second browser/user) renders the emoji art too.
7. Outside-click / Escape / button-toggle each close the popover and keep
   `aria-expanded` correct; the camera and video menus still behave.
8. Data-fetch failure (e.g. temporarily rename the file) shows the inline error,
   no crash; a literal malformed `:e:...:` stays as text.
```

