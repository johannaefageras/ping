// ============================================================
// PING — keyboard layer: overlay registry, Esc, palette, shortcuts
// ============================================================
// Loaded as a plain script BEFORE app.js. app.js calls
// window.PingKeyboard.initKeyboard(ctx) with a capability object so this layer
// never touches app globals/DOM directly. Mirrors the window.PingCommands
// pattern in commands.js.

(function () {
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

  // --- Public init --------------------------------------------------------
  let ctx = null;

  function initKeyboard(context) {
    ctx = context;

    // Register the existing overlays the app already manages, topmost-first.
    // (Palette + cheatsheet are unshifted onto the front in later tasks.)
    registerOverlay({ isOpen: ctx.isLightboxOpen, close: ctx.closeLightbox });
    registerOverlay({ isOpen: ctx.isInviteOpen, close: ctx.closeInvite });
    registerOverlay({ isOpen: ctx.isSettingsOpen, close: ctx.closeSettings });

    document.addEventListener("keydown", onGlobalKeydown);
  }

  function onGlobalKeydown(e) {
    if (e.key === "Escape") {
      if (closeTopmostOverlay()) {
        e.preventDefault();
      }
      return;
    }
  }

  window.PingKeyboard = { initKeyboard };
})();
