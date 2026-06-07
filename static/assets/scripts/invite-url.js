// Pure, side-effect-free helpers for invite links. Loaded as a classic
// script in the browser (assigns to window) and require()-able under Node
// for unit testing. No DOM, no Supabase — keep it that way so
// it stays trivially testable.
(function (root) {
  // Extract the invite token from a URL fragment like "#invite=<uuid>".
  // Returns the token string, or null if absent/empty. Tolerates extra
  // fragment params (e.g. "#a=1&invite=xyz") and a leading "#".
  function parseInviteToken(hash) {
    if (!hash) return null;
    const frag = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    for (const part of frag.split("&")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq) === "invite") {
        try {
          const val = decodeURIComponent(part.slice(eq + 1));
          return val.length ? val : null;
        } catch (_) {
          return null; // malformed %-escape in the fragment
        }
      }
    }
    return null;
  }

  // Build the shareable invite URL for a token. Always points at /app so the
  // redirect-friendly route handles it. Token goes in the fragment so it
  // never reaches server access logs.
  function buildInviteUrl(origin, token) {
    return origin.replace(/\/+$/, "") + "/app#invite=" + encodeURIComponent(token);
  }

  root.parseInviteToken = parseInviteToken;
  root.buildInviteUrl = buildInviteUrl;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseInviteToken, buildInviteUrl };
  }
})(typeof window !== "undefined" ? window : globalThis);
