# Ping Feature Ideas

Ping is a fast, private, lightweight messaging app with a durable conversation
history. Messages persist by default as a scrollable log with read/unread and
delivery status; ephemerality is opt-in via per-conversation disappearing
messages (off / 24h / 7d). The strongest ideas below keep that quick, focused,
two-person feel — Ping stays a lightweight direct-message tool, not a sprawling
social network.

## Small / High-Impact

- Clipboard paste upload: paste screenshots, images, and files directly into the chat input.
- Upload progress, retry, and cancel: show transfer state for file pings.
- Browser/PWA notifications: notify when a ping arrives while the app is in the background.
- Quick actions on messages: copy text/link, copy file name, open link, and download all.
- Drag-to-contact: drop a file onto a contact in the sidebar to send without opening the chat.
- Contact invite links or QR codes: make first setup easier than username search.

## Medium Features

- Pastebin/code mode: detect code snippets, preserve formatting, and add a copy button.
- Voice ping: short push-to-record audio clips that disappear after playback or download.
- Screenshot capture flow: capture a screen/window and ping it using browser screen capture APIs.
- Link inbox mode: a compact view of only received URLs.
- Download receipt: show whether a received file has been downloaded or opened.
- Contact nicknames/favorites: pin 1-3 people at the top for faster sending.
- Custom ping sounds per contact or theme.
- Nudge ping: send only a terminal-style pulse/sound without content.
- Temporary rooms: generate a one-time room link for sharing with someone who is not a permanent contact.

## Bigger / Cool Bets

- Local-first encrypted mode: client-side encryption before Supabase storage, with shared contact keys.
- Desktop share target: installable PWA that appears as a share target for links/files from mobile or desktop.
- Rules/automation: auto-save received PDFs to a folder-like queue, auto-tag by file type, or set per-contact disappearing-message defaults.
- Ping board mode: a shared ephemeral canvas where dropped images, files, and links appear spatially and fade out.
- End-to-end "burn after read" files: receiver can download once, then the server/storage object is immediately removed.

## Recommended First Five

1. Clipboard paste upload.
2. Link previews.
3. Upload progress.
4. PWA notifications.
5. Drag-to-contact sending.
