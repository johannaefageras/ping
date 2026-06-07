// ============================================================
// PING — keyboard layer: overlay registry, Esc, palette, shortcuts
// ============================================================
// Loaded as a plain script BEFORE app.js. app.js calls
// window.PingKeyboard.initKeyboard(ctx) with a capability object so this layer
// never touches app globals/DOM directly. Mirrors the window.PingCommands
// pattern in commands.js.

(function () {
  "use strict";

  // --- Overlay registry ---------------------------------------------------
  // Ordered topmost-first. Each entry: { isOpen(), close() }. Esc closes the
  // first open overlay and stops. New overlays (palette, cheatsheet) register
  // themselves during initKeyboard.
  const overlays = [];

  function registerOverlay(entry) {
    overlays.push(entry); // pushed in topmost-first order by caller
  }

  function closeTopmostOverlay() {
    for (const o of overlays) {
      if (o.isOpen()) {
        o.close();
        return true;
      }
    }
    return false;
  }

  // --- Cmd/Ctrl+K palette -------------------------------------------------
  let paletteEl, paletteInput, paletteList;
  let paletteRows = [];   // current filtered contacts
  let paletteIndex = -1;  // highlighted row, -1 = none
  let paletteLastFocus = null;

  function isPaletteOpen() {
    return paletteEl && !paletteEl.classList.contains("hidden");
  }

  function openPalette() {
    if (!ctx.isAppActive()) return;
    // Don't open beneath another overlay (the palette sits at a lower z-index
    // than the app's modals); that would render it invisibly and confuse Esc.
    if (overlays.some((o) => o.isOpen())) return;
    paletteLastFocus = document.activeElement;
    paletteEl.classList.remove("hidden");
    paletteInput.value = "";
    renderPalette("");
    paletteInput.focus();
  }

  function closePalette() {
    if (!isPaletteOpen()) return;
    paletteEl.classList.add("hidden");
    paletteList.innerHTML = "";
    paletteRows = [];
    paletteIndex = -1;
    if (paletteLastFocus) paletteLastFocus.focus();
  }

  function filterContacts(query) {
    const all = ctx.getContacts();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => {
      const name = (c.displayName || "").toLowerCase();
      const handle = (c.username || "").toLowerCase();
      return name.includes(q) || handle.includes(q);
    });
  }

  function renderPalette(query) {
    paletteRows = filterContacts(query);
    paletteIndex = paletteRows.length > 0 ? 0 : -1;

    if (paletteRows.length === 0) {
      const msg = ctx.getContacts().length === 0 ? "Inga kontakter än" : "Inga träffar";
      paletteList.innerHTML = '<div class="kbd-empty"></div>';
      paletteList.firstChild.textContent = msg;
      return;
    }

    paletteList.innerHTML = paletteRows
      .map((c, i) => {
        const primary = c.displayName ? ctx.escapeHtml(c.displayName) : ctx.escapeHtml(c.username);
        const handle = ctx.escapeHtml(c.username);
        const dot = '<span class="presence-dot' + (c.online ? " online" : "") + '"></span>';
        const unread = c.unread > 0 ? '<span class="kbd-unread">' + c.unread + "</span>" : "";
        return (
          '<div class="kbd-row' + (i === 0 ? " active" : "") + '" role="option" data-index="' + i + '">' +
          dot +
          '<span class="kbd-name">' + primary + "</span>" +
          '<span class="kbd-handle">@' + handle + "</span>" +
          unread +
          "</div>"
        );
      })
      .join("");

    paletteList.querySelectorAll(".kbd-row").forEach((row) => {
      const i = Number(row.dataset.index);
      row.addEventListener("mousemove", () => highlightPalette(i));
      row.addEventListener("click", () => choosePalette(i));
    });
  }

  function highlightPalette(i) {
    if (paletteRows.length === 0) return;
    const n = paletteRows.length;
    paletteIndex = ((i % n) + n) % n; // wrap
    const rows = paletteList.querySelectorAll(".kbd-row");
    rows.forEach((row, idx) => row.classList.toggle("active", idx === paletteIndex));
    const active = rows[paletteIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function choosePalette(i) {
    const c = paletteRows[i];
    if (!c) return;
    closePalette();
    ctx.selectContact(c.contactId, c.recipientId, c.username, c.displayName);
  }

  // Move selection to the prev/next accepted contact and open it. delta is -1
  // (prev) or +1 (next). Wraps. No-op for 0 contacts. If none selected, picks
  // the first (next) or last (prev).
  function cycleContact(delta) {
    const list = ctx.getContacts();
    if (list.length === 0) return;
    const currentId = ctx.getSelectedRecipientId();
    let idx = list.findIndex((c) => c.recipientId === currentId);
    let next;
    if (idx === -1) {
      next = delta > 0 ? 0 : list.length - 1;
    } else {
      const n = list.length;
      next = (((idx + delta) % n) + n) % n;
    }
    const c = list[next];
    ctx.selectContact(c.contactId, c.recipientId, c.username, c.displayName);
  }

  function onPaletteKeydown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightPalette(paletteIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightPalette(paletteIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (paletteIndex >= 0) choosePalette(paletteIndex);
    }
    // Esc is handled by the global registry handler (palette is registered).
  }

  // --- Public init --------------------------------------------------------
  let ctx = null;

  function initKeyboard(context) {
    ctx = context;

    // Palette DOM + events
    paletteEl = document.getElementById("kbd-palette");
    paletteInput = document.getElementById("kbd-palette-input");
    paletteList = document.getElementById("kbd-palette-list");
    paletteInput.addEventListener("input", () => renderPalette(paletteInput.value));
    paletteInput.addEventListener("keydown", onPaletteKeydown);
    paletteEl.addEventListener("click", (e) => {
      if (e.target === paletteEl) closePalette(); // backdrop click
    });

    // Register overlays, topmost-first.
    // Palette sits above the app's own modals; cheatsheet (Task 6) goes in front.
    registerOverlay({ isOpen: isPaletteOpen, close: closePalette });
    registerOverlay({ isOpen: ctx.isLightboxOpen, close: ctx.closeLightbox });
    registerOverlay({ isOpen: ctx.isInviteOpen, close: ctx.closeInvite });
    registerOverlay({ isOpen: ctx.isSettingsOpen, close: ctx.closeSettings });

    document.addEventListener("keydown", onGlobalKeydown);
  }

  // True when a bare-key shortcut should be ignored: focus is in an editable
  // field, or any overlay is open. Modified chords bypass this guard.
  function isTypingOrOverlayOpen() {
    const el = document.activeElement;
    if (el) {
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) return true;
    }
    return overlays.some((o) => o.isOpen());
  }

  function onGlobalKeydown(e) {
    // --- Modified chords (exempt from typing guard) ---
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (isPaletteOpen()) closePalette();
      else openPalette();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === ",") {
      if (!ctx.isAppActive()) return;
      e.preventDefault();
      // Don't stack Settings on top of an already-open overlay (mirrors openPalette).
      if (!overlays.some((o) => o.isOpen())) ctx.openSettings();
      return;
    }

    // --- Escape (works regardless of typing, but composer hint menu stops it) ---
    if (e.key === "Escape") {
      if (closeTopmostOverlay()) e.preventDefault();
      return;
    }

    // --- Bare-key shortcuts (suppressed while typing / overlay open) ---
    if (isTypingOrOverlayOpen()) return;
    if (!ctx.isAppActive()) return;

    if (e.key === "/") {
      e.preventDefault();
      ctx.focusComposer();
      return;
    }

    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      cycleContact(1);
      return;
    }
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      cycleContact(-1);
      return;
    }
  }

  window.PingKeyboard = { initKeyboard };
})();
