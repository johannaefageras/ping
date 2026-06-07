// Mini terminal command layer for Ping.
//
// Plain script (no bundler / no ES modules): everything is exposed on
// window.PingCommands. app.js loads this BEFORE itself and supplies a `ctx`
// capability object to runCommand so commands never touch the DOM or Supabase
// directly. parseCommand and getCommandHints are PURE (no side effects) and are
// the unit-testable core. All user-facing strings are Swedish.
(function () {
  "use strict";

  const THEMES = ["green", "amber", "cyan", "pink", "red", "paper", "purple"];
  const FONTS = ["radon", "neon", "argon", "xenon", "krypton"];

  // Registry: the single source of truth for dispatch, the hint menu, and /help.
  // Each command: { name, aliases?, arg?, summary, run(ctx, args) }.
  // `args` passed to run() is the raw argument string after the command word
  // (already trimmed), or "" when there is none.
  const COMMANDS = [
    {
      name: "help",
      aliases: ["?", "commands"],
      summary: "visa alla kommandon",
      run(ctx) {
        const lines = COMMANDS.map((c) => {
          const usage = "/" + c.name + (c.arg ? " <" + c.arg + ">" : "");
          return usage + " — " + c.summary;
        });
        ctx.systemLine(lines.join("\n"));
      },
    },
    {
      name: "theme",
      arg: "namn",
      summary: "byt färgtema (" + THEMES.join(", ") + ")",
      run(ctx, args) {
        const t = args.trim().toLowerCase();
        if (!THEMES.includes(t)) {
          ctx.systemLine("giltiga teman: " + THEMES.join(", "));
          return;
        }
        ctx.applyTheme(t);
        ctx.systemLine("tema: " + t);
      },
    },
    {
      name: "font",
      arg: "namn",
      summary: "byt typsnitt (" + FONTS.join(", ") + ")",
      run(ctx, args) {
        const f = args.trim().toLowerCase();
        if (!FONTS.includes(f)) {
          ctx.systemLine("giltiga typsnitt: " + FONTS.join(", "));
          return;
        }
        ctx.applyFont(f);
        ctx.systemLine("typsnitt: " + f);
      },
    },
    {
      name: "clear",
      summary: "rensa alla meddelanden i chatten",
      run(ctx) {
        if (!ctx.selectedContact) {
          ctx.systemLine("välj en kontakt först");
          return;
        }
        const n = ctx.clearChat();
        ctx.systemLine("rensade " + n + " meddelande" + (n === 1 ? "" : "n"));
      },
    },
    {
      name: "who",
      summary: "visa info om aktuell kontakt",
      run(ctx) {
        const c = ctx.selectedContact;
        if (!c) {
          ctx.systemLine("välj en kontakt först");
          return;
        }
        const name = c.displayName ? c.displayName + " (@" + c.username + ")" : "@" + c.username;
        const status = ctx.isOnline(c.recipientId) ? "online" : "offline";
        ctx.systemLine(name + " — " + status);
      },
    },
    {
      name: "last",
      summary: "återkalla ditt senaste meddelande",
      run(ctx) {
        if (!ctx.selectedContact) {
          ctx.systemLine("välj en kontakt först");
          return;
        }
        const last = ctx.getLastSent();
        if (!last) {
          ctx.systemLine("inget att återkalla");
          return;
        }
        ctx.setInput(last);
        ctx.focusInput();
      },
    },
    {
      name: "mute",
      summary: "stäng av ljud",
      run(ctx) {
        ctx.setMuted(true);
        ctx.systemLine("ljud av");
      },
    },
    {
      name: "unmute",
      summary: "slå på ljud",
      run(ctx) {
        ctx.setMuted(false);
        ctx.systemLine("ljud på");
      },
    },
    {
      name: "shrug",
      summary: "infoga ¯\\_(ツ)_/¯",
      run(ctx) {
        ctx.appendInput("¯\\_(ツ)_/¯");
        ctx.focusInput();
      },
    },
  ];

  // Look up a command by name or alias (case-insensitive). Returns the command
  // object or null.
  function findCommand(word) {
    const w = word.toLowerCase();
    return (
      COMMANDS.find((c) => c.name === w || (c.aliases && c.aliases.includes(w))) || null
    );
  }

  // PURE. Parse raw input into { name, args, command } if it is a recognised
  // command, else null (so literal slashes fall through to a normal send).
  // A leading "/" followed by a space, or "/" alone, or an unknown /word, all
  // return null EXCEPT unknown /word which we still want to intercept so we can
  // show "okänt kommando". So: return a result for any /word token; let
  // runCommand decide known vs unknown. "/ text" and "/" -> null (send as text).
  function parseCommand(raw) {
    if (typeof raw !== "string") return null;
    const m = raw.match(/^\/([a-z?]+)(?:\s+([\s\S]*))?$/i);
    if (!m) return null; // not "/word..." -> treat as normal text
    const name = m[1];
    const args = (m[2] || "").trim();
    return { name, args, command: findCommand(name) };
  }

  // PURE. Return registry entries matching the partial input for the hint menu.
  // Only active while the input starts with "/" and has no space yet.
  // Empty partial ("/") returns all commands. Returns [] when not applicable.
  function getCommandHints(raw) {
    if (typeof raw !== "string") return [];
    const m = raw.match(/^\/([a-z?]*)$/i);
    if (!m) return [];
    const partial = m[1].toLowerCase();
    if (partial === "") return COMMANDS.slice();
    return COMMANDS.filter(
      (c) =>
        c.name.startsWith(partial) ||
        (c.aliases && c.aliases.some((a) => a.startsWith(partial)))
    );
  }

  // Dispatch. Parses, runs the matched command, or emits an unknown-command
  // system line. No-op (returns false) if raw is not a command at all.
  function runCommand(raw, ctx) {
    const parsed = parseCommand(raw);
    if (!parsed) return false;
    if (!parsed.command) {
      ctx.systemLine("okänt kommando: /" + parsed.name + " — skriv /help");
      return true;
    }
    parsed.command.run(ctx, parsed.args);
    return true;
  }

  window.PingCommands = {
    COMMANDS,
    THEMES,
    FONTS,
    parseCommand,
    getCommandHints,
    runCommand,
  };
})();
