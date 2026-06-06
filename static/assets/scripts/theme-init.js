// Apply the theme/font the user picked in the app (stored in localStorage)
// before paint, so the legal pages (privacy/terms) match the app instead of
// flashing the default green. Mirrors applyTheme/applyFont in app.js.
//
// This is an external file (not inline) so it's covered by script-src 'self'
// in the CSP — no per-edit hash to maintain. Load it with a plain
// <script src="/assets/scripts/theme-init.js"></script> in <head> before the stylesheet.
(function () {
  var t = localStorage.getItem("ping-theme");
  if (t && t !== "green") document.documentElement.setAttribute("data-theme", t);
  var f = localStorage.getItem("ping-font");
  if (f && f !== "radon") document.documentElement.setAttribute("data-font", f);
})();
