# The problem I need to solve

Me and my friend Robban hangs out a lot and do a lot of coding together, and we always sit right next to each other, me with my MacBook Air, and him with his PC. And it always bugs us that we don't have an easy way of sharing stuff quickly with each other, like links or files or whatever (And none of us use social media really, so we don't have like messenger and stuff). How could we build something, like a web-app for just us, or something else completely, that would resolve this issue? Be creative. It should not only fix our problem but also be a fun project to build.

# A possible solution

"Ping" is the simplest and most satisfying option. A tiny web app that runs on your local network — no internet needed, no accounts, no fuss. You both open the same URL (like http://192.168.1.42:3000) and you get a shared clipboard/board.

## How it works

One person drops a link, text snippet, file, or image onto the page, and it instantly appears on the other person's screen. Think of it like a shared sticky note wall that lives only when you're together.

When one of you drops a file onto the page, the file gets uploaded to the Python backend (which is just running on one of your laptops). The other person sees it appear in real-time via WebSocket, and gets a download link/button. Click it, and the file downloads from the local server over your shared WiFi — so transfers are fast since nothing goes over the internet.
You'd essentially have:

1. Drag & drop (or file picker) → file uploads to the backend's temp storage
2. WebSocket notification → the other person's browser instantly shows the new file with a name, size, and a download button
3. Click download → fetches the file from the local server

For text and links you wouldn't even need the download step — they'd just appear on screen ready to copy.

## Tech

A small Python backend (Flask or FastAPI) with WebSockets for real-time sync, and a simple drag-and-drop frontend. Files get temporarily stored in memory or a temp folder — nothing persists after you close it. You could run it off either of your machines.

## The fun part

You could add sound effects when something arrives (a ping-pong sound, obviously), and give it a retro aesthetic — like an old-school IRC or BBS vibe.
