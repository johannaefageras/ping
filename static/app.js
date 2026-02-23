// ============================================================
// PING — Supabase-powered AirDrop-like sharing
// ============================================================

// --- DOM references ---
const authScreen = document.getElementById("auth-screen");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const signupEmail = document.getElementById("signup-email");
const signupUsername = document.getElementById("signup-username");
const signupPassword = document.getElementById("signup-password");
const forgotForm = document.getElementById("forgot-form");
const forgotEmail = document.getElementById("forgot-email");
const forgotLink = document.getElementById("forgot-link");
const forgotBackLink = document.getElementById("forgot-back-link");
const resetForm = document.getElementById("reset-form");
const resetPassword = document.getElementById("reset-password");
const resetPasswordConfirm = document.getElementById("reset-password-confirm");
const authError = document.getElementById("auth-error");
const authTabs = document.querySelectorAll("#auth-tabs .tab");

const appEl = document.getElementById("app");
const currentUsernameEl = document.getElementById("current-username");
const logoutBtn = document.getElementById("logout-btn");
const addContactForm = document.getElementById("add-contact-form");
const contactSearchInput = document.getElementById("contact-search");
const contactSearchResult = document.getElementById("contact-search-result");
const pendingRequests = document.getElementById("pending-requests");
const pendingList = document.getElementById("pending-list");
const contactsList = document.getElementById("contacts-list");
const chatPlaceholder = document.getElementById("chat-placeholder");
const chatView = document.getElementById("chat-view");
const chatContactName = document.getElementById("chat-contact-name");
const chatMain = document.getElementById("chat-main");
const board = document.getElementById("board");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const textForm = document.getElementById("text-form");
const textInput = document.getElementById("text-input");
const pingSound = document.getElementById("ping-sound");

// --- App state ---
let sb = null; // Supabase client
let currentUser = null; // { id, username }
let selectedContact = null; // { contactId, recipientId, username }
let contacts = [];
let realtimeChannel = null;
let contactsChannel = null;

// ============================================================
// BOOTSTRAP
// ============================================================

async function init() {
  try {
    const res = await fetch("/config");
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const { supabaseUrl, supabaseAnonKey } = await res.json();
    if (!supabaseUrl || !supabaseAnonKey) throw new Error("Missing Supabase config");
    sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

    const {
      data: { session },
    } = await sb.auth.getSession();
    if (session) {
      await enterApp(session.user);
    } else {
      showAuthScreen();
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        showResetPasswordScreen();
      } else if (!session) {
        exitApp();
      }
    });
  } catch (err) {
    console.error("Init failed:", err);
    authScreen.classList.remove("hidden");
    showAuthError("Kunde inte ansluta till servern. Försök igen senare.");
  }
}

// ============================================================
// AUTH
// ============================================================

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    authTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    loginForm.classList.toggle("hidden", target !== "login");
    signupForm.classList.toggle("hidden", target !== "signup");
    hideAuthError();
  });
});

function showAuthScreen() {
  authScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
}

function showAuthError(msg, isSuccess = false) {
  authError.textContent = msg;
  authError.classList.toggle("success", isSuccess);
  authError.classList.remove("hidden");
}

function hideAuthError() {
  authError.classList.add("hidden");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();

  const { data, error } = await sb.auth.signInWithPassword({
    email: loginEmail.value.trim(),
    password: loginPassword.value,
  });

  if (error) {
    showAuthError("Inloggningen misslyckades: " + error.message);
    return;
  }
  await enterApp(data.user);
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();

  const email = signupEmail.value.trim();
  const username = signupUsername.value.trim().toLowerCase();
  const password = signupPassword.value;

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    showAuthError("Användarnamn: 3–20 tecken, små bokstäver, siffror, understreck.");
    return;
  }

  // Check if username is taken
  const { data: existing } = await sb
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existing) {
    showAuthError("Användarnamnet är redan taget.");
    return;
  }

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) {
    showAuthError("Registrering misslyckades: " + error.message);
    return;
  }

  // If email confirmation is required, Supabase returns a user but no session
  if (data.user && !data.session) {
    showAuthError("Konto skapat! Kolla din e-post för att bekräfta.", true);
    return;
  }

  await enterApp(data.user);
});

// ============================================================
// FORGOT / RESET PASSWORD
// ============================================================

forgotLink.addEventListener("click", (e) => {
  e.preventDefault();
  hideAuthError();
  loginForm.classList.add("hidden");
  signupForm.classList.add("hidden");
  forgotForm.classList.remove("hidden");
  document.getElementById("auth-tabs").classList.add("hidden");
});

forgotBackLink.addEventListener("click", (e) => {
  e.preventDefault();
  hideAuthError();
  forgotForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
  document.getElementById("auth-tabs").classList.remove("hidden");
  // Re-activate login tab
  authTabs.forEach((t) => t.classList.remove("active"));
  authTabs[0].classList.add("active");
});

forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();

  const email = forgotEmail.value.trim();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  if (error) {
    showAuthError("Kunde inte skicka återställningslänk: " + error.message);
    return;
  }

  showAuthError("Återställningslänk skickad! Kolla din e-post.", true);
  forgotEmail.value = "";
});

resetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();

  const password = resetPassword.value;
  const confirm = resetPasswordConfirm.value;

  if (password !== confirm) {
    showAuthError("Lösenorden matchar inte.");
    return;
  }

  const { error } = await sb.auth.updateUser({ password });

  if (error) {
    showAuthError("Kunde inte uppdatera lösenord: " + error.message);
    return;
  }

  showAuthError("Lösenordet har uppdaterats!", true);
  resetPassword.value = "";
  resetPasswordConfirm.value = "";

  // After a short delay, enter the app
  setTimeout(async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await enterApp(session.user);
  }, 1500);
});

function showResetPasswordScreen() {
  authScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
  loginForm.classList.add("hidden");
  signupForm.classList.add("hidden");
  forgotForm.classList.add("hidden");
  resetForm.classList.remove("hidden");
  document.getElementById("auth-tabs").classList.add("hidden");
  hideAuthError();
}

// ============================================================
// APP ENTRY / EXIT
// ============================================================

async function enterApp(user) {
  const { data: profile, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    showAuthError("Kunde inte ladda profil. Försök igen.");
    await sb.auth.signOut();
    return;
  }

  currentUser = { id: user.id, username: profile.username };

  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  currentUsernameEl.textContent = "@" + currentUser.username;

  await loadContacts();
  subscribeToContactChanges();
  subscribeToPings();
}

function exitApp() {
  currentUser = null;
  selectedContact = null;
  contacts = [];

  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  if (contactsChannel) sb.removeChannel(contactsChannel);
  realtimeChannel = null;
  contactsChannel = null;

  board.innerHTML = "";
  contactsList.innerHTML = "";
  pendingList.innerHTML = "";
  chatView.classList.add("hidden");
  chatPlaceholder.classList.remove("hidden");

  showAuthScreen();
}

logoutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
  exitApp();
});

// ============================================================
// CONTACTS
// ============================================================

async function loadContacts() {
  const { data, error } = await sb
    .from("contacts")
    .select(
      `id, status, requester_id, addressee_id, created_at,
       requester:profiles!contacts_requester_id_fkey(username),
       addressee:profiles!contacts_addressee_id_fkey(username)`
    )
    .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load contacts:", error);
    return;
  }

  contacts = data || [];
  renderContacts();
}

function renderContacts() {
  const pending = contacts.filter(
    (c) => c.status === "pending" && c.addressee_id === currentUser.id
  );
  const accepted = contacts.filter((c) => c.status === "accepted");
  const outgoing = contacts.filter(
    (c) => c.status === "pending" && c.requester_id === currentUser.id
  );

  // Pending incoming requests
  pendingList.innerHTML = "";
  pendingRequests.classList.toggle("hidden", pending.length === 0);
  pending.forEach((c) => {
    const username = c.requester.username;
    const el = document.createElement("div");
    el.className = "pending-item";
    el.innerHTML = `
      <span>@${escapeHtml(username)}</span>
      <button class="accept-btn" data-id="${c.id}">Acceptera</button>
      <button class="reject-btn" data-id="${c.id}">Neka</button>
    `;
    pendingList.appendChild(el);
  });

  pendingList.querySelectorAll(".accept-btn").forEach((btn) => {
    btn.addEventListener("click", () => acceptContact(btn.dataset.id));
  });
  pendingList.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", () => rejectContact(btn.dataset.id));
  });

  // Accepted contacts
  contactsList.innerHTML = "";
  accepted.forEach((c) => {
    const isRequester = c.requester_id === currentUser.id;
    const recipientId = isRequester ? c.addressee_id : c.requester_id;
    const username = isRequester ? c.addressee.username : c.requester.username;
    const el = document.createElement("div");
    el.className =
      "contact-item" +
      (selectedContact && selectedContact.recipientId === recipientId ? " active" : "");
    el.dataset.recipientId = recipientId;
    el.dataset.contactId = c.id;
    el.dataset.username = username;
    el.textContent = "@" + username;
    el.addEventListener("click", () => selectContact(c.id, recipientId, username));
    contactsList.appendChild(el);
  });

  // Outgoing pending
  outgoing.forEach((c) => {
    const username = c.addressee.username;
    const el = document.createElement("div");
    el.className = "contact-item outgoing";
    el.textContent = "@" + username + " (väntar...)";
    contactsList.appendChild(el);
  });
}

// --- Add contact ---
addContactForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = contactSearchInput.value.trim().toLowerCase();
  if (!username) return;

  contactSearchResult.classList.add("hidden");

  const { data: profile } = await sb
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    contactSearchResult.textContent = "Ingen användare hittades.";
    contactSearchResult.classList.remove("hidden");
    return;
  }

  if (profile.id === currentUser.id) {
    contactSearchResult.textContent = "Du kan inte lägga till dig själv.";
    contactSearchResult.classList.remove("hidden");
    return;
  }

  // Check if contact exists in either direction
  const { data: existing } = await sb
    .from("contacts")
    .select("id")
    .or(
      `and(requester_id.eq.${currentUser.id},addressee_id.eq.${profile.id}),` +
        `and(requester_id.eq.${profile.id},addressee_id.eq.${currentUser.id})`
    );

  if (existing && existing.length > 0) {
    contactSearchResult.textContent = "Kontaktförfrågan finns redan.";
    contactSearchResult.classList.remove("hidden");
    return;
  }

  const { error } = await sb
    .from("contacts")
    .insert({ requester_id: currentUser.id, addressee_id: profile.id });

  if (error) {
    contactSearchResult.textContent = "Kunde inte skicka förfrågan.";
    contactSearchResult.classList.remove("hidden");
    return;
  }

  contactSearchInput.value = "";
  contactSearchResult.textContent = "Förfrågan skickad till @" + profile.username + "!";
  contactSearchResult.classList.remove("hidden");
  await loadContacts();
});

async function acceptContact(contactId) {
  await sb.from("contacts").update({ status: "accepted" }).eq("id", contactId);
  await loadContacts();
}

async function rejectContact(contactId) {
  await sb.from("contacts").delete().eq("id", contactId);
  await loadContacts();
}

// ============================================================
// CHAT — select contact, load pings, render
// ============================================================

async function selectContact(contactId, recipientId, username) {
  selectedContact = { contactId, recipientId, username };

  document.querySelectorAll(".contact-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.recipientId === recipientId);
  });

  chatPlaceholder.classList.add("hidden");
  chatView.classList.remove("hidden");
  chatContactName.textContent = "@" + username;

  await loadPings();
  textInput.focus();
}

async function loadPings() {
  if (!selectedContact) return;

  const { recipientId } = selectedContact;
  const { data: pings, error } = await sb
    .from("pings")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${recipientId}),` +
        `and(sender_id.eq.${recipientId},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load pings:", error);
    return;
  }

  board.innerHTML = "";
  (pings || []).forEach((ping) => renderPing(ping, false));
  scrollToBottom();
}

function dismissPing(el, ping) {
  el.classList.add("fade-out");
  el.addEventListener("animationend", async () => {
    el.remove();
    await sb.from("pings").delete().eq("id", ping.id);
  });
}

function renderPing(ping, animate = true) {
  const isSelf = ping.sender_id === currentUser.id;
  const el = document.createElement("div");

  if (ping.type === "text") {
    el.className = `item ${isSelf ? "self" : "other"}${animate && !isSelf ? " ping" : ""}`;
    el.innerHTML = `
      <div class="meta">${formatTime(ping.created_at)}</div>
      <div class="content">${linkify(escapeHtml(ping.content))}</div>
      <button class="dismiss-btn">&times;</button>
    `;
  } else if (ping.type === "file") {
    el.className = `item ${isSelf ? "self" : "other"} file-item${animate && !isSelf ? " ping" : ""}`;
    el.innerHTML = `
      <div class="meta">${formatTime(ping.created_at)}</div>
      <div class="file-info">
        <span class="file-icon">[F]</span>
        <span>${escapeHtml(ping.file_name)} <span class="file-size">${formatSize(ping.file_size)}</span></span>
        <button class="download-btn" data-path="${escapeHtml(ping.file_path)}" data-name="${escapeHtml(ping.file_name)}">LADDA NER</button>
      </div>
      <button class="dismiss-btn">&times;</button>
    `;
  }

  board.appendChild(el);

  // Dismiss button
  el.querySelector(".dismiss-btn").addEventListener("click", () => dismissPing(el, ping));

  // Download button (files)
  const dlBtn = el.querySelector(".download-btn");
  if (dlBtn) {
    dlBtn.addEventListener("click", async () => {
      await downloadFile(dlBtn.dataset.path, dlBtn.dataset.name);
      // Auto-dismiss file pings after download for receiver
      if (!isSelf) {
        dismissPing(el, ping);
      }
    });
  }

  // Auto-remove on timer (but not received files — those wait for download)
  const isReceivedFile = ping.type === "file" && !isSelf;
  if (!isReceivedFile) {
    setTimeout(() => dismissPing(el, ping), 20000);
  }
}

// ============================================================
// SEND — text pings and file uploads
// ============================================================

textForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedContact) return;
  const text = textInput.value.trim();
  if (!text) return;

  const { data, error } = await sb
    .from("pings")
    .insert({
      sender_id: currentUser.id,
      receiver_id: selectedContact.recipientId,
      type: "text",
      content: text,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to send ping:", error);
    return;
  }

  renderPing(data);
  scrollToBottom();
  textInput.value = "";
});

async function uploadFiles(files) {
  if (!selectedContact) return;

  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      alert("Filen är för stor (max 50 MB)");
      continue;
    }

    const filePath = `${currentUser.id}/${crypto.randomUUID()}_${file.name}`;
    const { error: uploadError } = await sb.storage
      .from("ping-files")
      .upload(filePath, file);

    if (uploadError) {
      console.error("Upload failed:", uploadError);
      alert("Uppladdning misslyckades: " + file.name);
      continue;
    }

    const { data, error } = await sb
      .from("pings")
      .insert({
        sender_id: currentUser.id,
        receiver_id: selectedContact.recipientId,
        type: "file",
        file_path: filePath,
        file_name: file.name,
        file_size: file.size,
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to create file ping:", error);
      continue;
    }

    renderPing(data);
    scrollToBottom();
  }
}

async function downloadFile(path, filename) {
  const { data, error } = await sb.storage.from("ping-files").download(path);

  if (error) {
    console.error("Download failed:", error);
    alert("Nedladdning misslyckades.");
    return;
  }

  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- File input & drag-and-drop ---

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) {
    uploadFiles(fileInput.files);
    fileInput.value = "";
  }
});

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
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

// Allow dropping anywhere in the chat view
chatView.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
chatView.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

// ============================================================
// REALTIME
// ============================================================

function subscribeToPings() {
  realtimeChannel = sb
    .channel("pings-incoming")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "pings",
        filter: `receiver_id=eq.${currentUser.id}`,
      },
      (payload) => {
        const ping = payload.new;

        // If from the currently selected contact, render it
        if (selectedContact && ping.sender_id === selectedContact.recipientId) {
          renderPing(ping);
          scrollToBottom();
        }

        // Reload contacts to update ordering
        loadContacts();
        playPing();
      }
    )
    .subscribe();
}

function subscribeToContactChanges() {
  contactsChannel = sb
    .channel("contacts-changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "contacts",
        filter: `addressee_id=eq.${currentUser.id}`,
      },
      () => {
        loadContacts();
        playPing();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "contacts",
        filter: `requester_id=eq.${currentUser.id}`,
      },
      () => {
        // Our outgoing request was accepted
        loadContacts();
      }
    )
    .subscribe();
}

// ============================================================
// UTILITIES
// ============================================================

function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  chatMain.scrollTop = chatMain.scrollHeight;
}

function playPing() {
  pingSound.currentTime = 0;
  pingSound.play().catch(() => {});
}

// --- Start ---
init();
