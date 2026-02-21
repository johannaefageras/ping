const authGate = document.getElementById("auth-gate");
const authForm = document.getElementById("auth-form");
const authInput = document.getElementById("auth-input");
const authError = document.getElementById("auth-error");
const appEl = document.getElementById("app");

const board = document.getElementById("board");
const presence = document.getElementById("presence");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const textForm = document.getElementById("text-form");
const textInput = document.getElementById("text-input");
const pingSound = document.getElementById("ping-sound");

let ws = null;
let reconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 30000;

// --- Auth ---

async function checkAuth() {
  try {
    const res = await fetch("/auth/check");
    const data = await res.json();
    if (!data.required || data.authenticated) {
      showApp();
    } else {
      showAuthGate();
    }
  } catch {
    // If check fails (e.g. network error), try showing app anyway
    showApp();
  }
}

function showAuthGate() {
  authGate.classList.remove("hidden");
  appEl.classList.add("hidden");
  authInput.focus();
}

function showApp() {
  authGate.classList.add("hidden");
  appEl.classList.remove("hidden");
  connectWebSocket();
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = authInput.value.trim();
  if (!code) return;

  try {
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      authError.classList.add("hidden");
      showApp();
    } else {
      authError.classList.remove("hidden");
      authInput.value = "";
      authInput.focus();
    }
  } catch {
    authError.classList.remove("hidden");
  }
});

// --- WebSocket ---

function connectWebSocket() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.addEventListener("open", () => {
    presence.textContent = "ansluten";
    reconnectDelay = 2000; // Reset backoff on success
  });

  ws.addEventListener("close", () => {
    presence.textContent = "frånkopplad";
    scheduleReconnect();
  });

  ws.addEventListener("message", (e) => {
    const data = JSON.parse(e.data);

    if (data.type === "presence") {
      const n = data.count;
      presence.textContent = `${n} online`;
      return;
    }

    if (data.type === "text") {
      addTextItem(data.content, data.timestamp, !!data.self);
      if (!data.self) playPing();
      return;
    }

    if (data.type === "file") {
      addFileItem(data.filename, data.stored_name, data.size, data.timestamp);
      playPing();
      return;
    }
  });
}

function scheduleReconnect() {
  setTimeout(() => {
    presence.textContent = "återansluter...";
    connectWebSocket();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

// --- Send text ---

textForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "text", content: text }));
  textInput.value = "";
});

// --- File upload ---

async function uploadFiles(files) {
  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/upload", { method: "POST", body: formData });
      if (res.status === 413) {
        addTextItem("Filen är för stor (max 50 MB)", new Date().toISOString(), true);
      } else if (res.status === 401) {
        addTextItem("Autentisering krävs — ladda om sidan", new Date().toISOString(), true);
      } else if (!res.ok) {
        addTextItem(`Uppladdning misslyckades: ${file.name}`, new Date().toISOString(), true);
      }
    } catch (err) {
      addTextItem(`Uppladdning misslyckades: ${file.name}`, new Date().toISOString(), true);
    }
  }
}

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) {
    uploadFiles(fileInput.files);
    fileInput.value = "";
  }
});

// --- Drag & drop ---

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) {
    uploadFiles(e.dataTransfer.files);
  }
});

// Also allow dropping anywhere on the page
document.body.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

document.body.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
    dropZone.classList.remove("drag-over");
  }
});

document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) {
    uploadFiles(e.dataTransfer.files);
  }
});

// --- Render items ---

function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function addTextItem(content, timestamp, isSelf) {
  const el = document.createElement("div");
  el.className = `item ${isSelf ? "self" : "other"} ${!isSelf ? "ping" : ""}`;
  el.innerHTML = `
    <div class="meta">${formatTime(timestamp)}</div>
    <div class="content">${linkify(escapeHtml(content))}</div>
  `;
  board.appendChild(el);
  scrollToBottom();
}

function addFileItem(filename, storedName, size, timestamp) {
  const el = document.createElement("div");
  el.className = "item other file-item ping";
  el.innerHTML = `
    <div class="meta">${formatTime(timestamp)}</div>
    <div class="file-info">
      <span class="file-icon">[F]</span>
      <span>${escapeHtml(filename)} <span class="file-size">${formatSize(size)}</span></span>
      <a class="download-btn" href="/files/${encodeURIComponent(storedName)}" download>LADDA NER</a>
    </div>
  `;
  board.appendChild(el);
  scrollToBottom();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  const main = document.querySelector("main");
  main.scrollTop = main.scrollHeight;
}

// --- Sound ---

function playPing() {
  pingSound.currentTime = 0;
  pingSound.play().catch(() => {});
}

// --- Init ---

checkAuth();
