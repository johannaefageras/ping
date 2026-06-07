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
const mobileContactsToggle = document.getElementById("mobile-contacts-toggle");
const chatContactName = document.getElementById("chat-contact-name");
const chatMain = document.getElementById("chat-main");
const board = document.getElementById("board");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const cameraInput = document.getElementById("camera-input");
const attachBtn = document.getElementById("attach-btn");
const cameraBtn = document.getElementById("camera-btn");
const videoBtn = document.getElementById("video-btn");
const videoMenu = document.getElementById("video-menu");
const videoPickBtn = document.getElementById("video-pick-btn");
const videoRecordBtn = document.getElementById("video-record-btn");
const videoInput = document.getElementById("video-input");
const recordModal = document.getElementById("record-modal");
const recordPanel = document.getElementById("record-panel");
const recordClose = document.getElementById("record-close");
const recordVideo = document.getElementById("record-video");
const recordStatus = document.getElementById("record-status");
const recordError = document.getElementById("record-error");
const recordStart = document.getElementById("record-start");
const recordStop = document.getElementById("record-stop");
const recordSend = document.getElementById("record-send");
const recordAgain = document.getElementById("record-again");
const recordCancel = document.getElementById("record-cancel");
const textForm = document.getElementById("text-form");
const textInput = document.getElementById("text-input");
const pingSound = document.getElementById("ping-sound");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxClose = document.getElementById("lightbox-close");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
const displayNameInput = document.getElementById("display-name-input");
const displayNameSave = document.getElementById("display-name-save");
const displayNameMsg = document.getElementById("display-name-msg");
const newPasswordInput = document.getElementById("new-password");
const newPasswordConfirm = document.getElementById("new-password-confirm");
const passwordSave = document.getElementById("password-save");
const passwordMsg = document.getElementById("password-msg");
const muteToggle = document.getElementById("mute-toggle");
const inviteOpenBtn = document.getElementById("invite-open-btn");
const inviteModal = document.getElementById("invite-modal");
const inviteClose = document.getElementById("invite-close");
const inviteQr = document.getElementById("invite-qr");
const inviteLinkInput = document.getElementById("invite-link-input");
const inviteCopyBtn = document.getElementById("invite-copy-btn");
const inviteCountdown = document.getElementById("invite-countdown");
const inviteRegenBtn = document.getElementById("invite-regen-btn");
const inviteError = document.getElementById("invite-error");

// --- App state ---
let sb = null; // Supabase client
let currentUser = null; // { id, username }
let selectedContact = null; // { contactId, recipientId, username, displayName }
let contacts = [];
let lastSentText = null; // last text the user sent, for /last recall
let unreadCounts = {}; // recipientId -> number of pings received while their chat was closed (this session)
let realtimeChannel = null;
let presenceChannel = null;
let onlineUserIds = new Set();

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

    // A password-recovery link lands here with a recovery token in the URL
    // fragment. Supabase fires PASSWORD_RECOVERY (below) once it processes it
    // and makes the recovery session the active one. Detect that case up front
    // so we don't flash the app for whoever was previously logged in before the
    // event arrives.
    const isPasswordRecovery = window.location.hash.includes("type=recovery");
    const inviteToken = window.parseInviteToken(window.location.hash);

    const {
      data: { session },
    } = await sb.auth.getSession();
    if (isPasswordRecovery) {
      showResetPasswordScreen();
    } else if (session) {
      await enterApp(session.user);
      if (inviteToken) {
        await redeemInviteToken(inviteToken);
        clearInviteHash();
      }
    } else {
      if (inviteToken) {
        // Hold the token across sign-in/sign-up; redeem on SIGNED_IN below.
        sessionStorage.setItem(INVITE_STASH_KEY, inviteToken);
        showAuthInviteBanner();
      }
      showAuthScreen();
    }

    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN") {
        const stashed = sessionStorage.getItem(INVITE_STASH_KEY);
        if (stashed) {
          sessionStorage.removeItem(INVITE_STASH_KEY);
          hideAuthInviteBanner();
          // enterApp runs via the normal login path; redeem once we're in.
          // Defer slightly so contacts UI exists before refresh.
          setTimeout(async () => {
            await redeemInviteToken(stashed);
            clearInviteHash();
          }, 0);
        }
      }
      if (event === "PASSWORD_RECOVERY") {
        // Do NOT sign out here. The recovery event already swaps in a recovery
        // session that supersedes any prior login, so updateUser({ password })
        // updates exactly the account the link belongs to — even if a different
        // user was logged in when the link was opened. Calling signOut() would
        // destroy that recovery session and make the password update fail with
        // "Auth session missing".
        showResetPasswordScreen();
      } else if (!session) {
        if (!resetForm.classList.contains("hidden")) return;
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
    setAuthState(target);
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

// Per-state terminal chrome: title path + boot/greeting line.
// Updates #auth-path and #auth-boot to match the visible form.
const AUTH_STATES = {
  login: {
    path: "~/login",
    cmd: "$ ping --auth",
    status: "&check; ansluten.",
    greeting: "välkommen tillbaka.",
  },
  signup: {
    path: "~/signup",
    cmd: "$ ping --auth",
    status: "&check; ansluten.",
    greeting: "skapa ett konto för att börja pinga.",
  },
  forgot: {
    path: "~/recover",
    cmd: "$ ping --recover",
    status: "",
    greeting: "ange din e-post så skickar vi en återställningslänk.",
  },
  reset: {
    path: "~/reset",
    cmd: "$ ping --reset",
    status: "",
    greeting: "välj ett nytt lösenord.",
  },
};

function setAuthState(state) {
  const s = AUTH_STATES[state];
  if (!s) return;
  const pathEl = document.getElementById("auth-path");
  const bootEl = document.getElementById("auth-boot");
  if (pathEl) pathEl.textContent = s.path;
  if (bootEl) {
    const statusHtml = s.status
      ? `<span class="boot-status">${s.status}</span> `
      : "";
    // cmd/greeting are escaped for consistency with the rest of the file;
    // status is left raw because it intentionally carries the &check; entity.
    bootEl.innerHTML =
      `<span class="boot-cmd">${escapeHtml(s.cmd)}</span><br />` +
      statusHtml +
      `<span class="boot-greeting">${escapeHtml(s.greeting)}</span>`;
  }
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
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("username_taken")) {
      showAuthError("Användarnamnet är redan taget.");
    } else if (msg.includes("invalid_username")) {
      // Server-side backstop for the format rule checked above; normally the
      // client regex blocks this first, so it only fires on a malformed request.
      showAuthError("Användarnamn: 3–20 tecken, små bokstäver, siffror, understreck.");
    } else {
      showAuthError("Registrering misslyckades: " + error.message);
    }
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
  setAuthState("forgot");
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
  setAuthState("login");
});

forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();

  const email = forgotEmail.value.trim();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/app",
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
  setAuthState("reset");
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

  currentUser = {
    id: user.id,
    username: profile.username,
    display_name: profile.display_name || null,
  };

  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  appEl.classList.remove("chat-active", "contacts-collapsed");
  currentUsernameEl.textContent = "@" + currentUser.username;
  displayNameInput.value = currentUser.display_name || "";

  await loadContacts();
  subscribeToRealtime();
  subscribePresence();
}

function exitApp() {
  currentUser = null;
  selectedContact = null;
  contacts = [];
  unreadCounts = {};

  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = null;

  if (presenceChannel) sb.removeChannel(presenceChannel);
  presenceChannel = null;
  onlineUserIds = new Set();

  // Clearing board.innerHTML bypasses dismissPing, so revoke any image-preview
  // object URLs here to avoid leaking blobs on logout. Close the lightbox too,
  // since it may be showing one of these now-orphaned URLs.
  closeLightbox();
  board.querySelectorAll(".item").forEach((el) => {
    if (el._objectUrl) {
      URL.revokeObjectURL(el._objectUrl);
      el._objectUrl = null;
    }
  });

  board.innerHTML = "";
  contactsList.innerHTML = "";
  pendingList.innerHTML = "";
  chatView.classList.add("hidden");
  chatPlaceholder.classList.remove("hidden");
  appEl.classList.remove("chat-active", "contacts-collapsed");
  mobileContactsToggle.setAttribute("aria-expanded", "false");

  // Logout can be triggered from inside the settings modal, so close it on the
  // way out — otherwise it stays open over the auth screen. This also clears the
  // typed-but-unsubmitted password/display-name fields.
  closeSettings();
  // Same for the invite modal: close it so it doesn't linger over the auth
  // screen and so its countdown interval is cleared.
  closeInvite();

  showAuthScreen();
}

function setMobileContactsCollapsed(collapsed) {
  appEl.classList.toggle("contacts-collapsed", collapsed);
  mobileContactsToggle.setAttribute("aria-expanded", String(!collapsed));
}

mobileContactsToggle.addEventListener("click", () => {
  if (!appEl.classList.contains("chat-active")) return;
  setMobileContactsCollapsed(!appEl.classList.contains("contacts-collapsed"));
});

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
       requester:profiles!contacts_requester_id_fkey(username, display_name),
       addressee:profiles!contacts_addressee_id_fkey(username, display_name)`
    )
    .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load contacts:", error);
    return;
  }

  contacts = data || [];
  // A contact may have changed their display name since we opened their chat;
  // re-sync the selected contact and its header from the fresh data.
  syncSelectedContactDisplayName();
  renderContacts();
  refreshChatHeader();
}

// Re-reads the currently selected contact's display_name from the freshly
// loaded `contacts` array (matched by the other party's user id). No-op when
// no contact is selected or the contact is no longer in the list.
function syncSelectedContactDisplayName() {
  if (!selectedContact) return;
  const match = contacts.find(
    (c) =>
      c.status === "accepted" &&
      (c.requester_id === selectedContact.recipientId ||
        c.addressee_id === selectedContact.recipientId)
  );
  if (!match) return;
  const other =
    match.requester_id === currentUser.id ? match.addressee : match.requester;
  selectedContact.displayName = other.display_name || null;
}

// Re-renders the open chat header from the selected contact's current name.
// No-op when no chat is open.
function refreshChatHeader() {
  if (!selectedContact || chatView.classList.contains("hidden")) return;
  chatContactName.innerHTML = contactNameHtml(
    selectedContact.username,
    selectedContact.displayName
  );
}

// Renders a contact label: display name as primary line (when set) with
// @username as a smaller secondary line; @username only when no display name.
// Both values are escaped (display names are free text).
function contactNameHtml(username, displayName) {
  const u = escapeHtml(username);
  if (displayName) {
    return (
      `<span class="name-primary">${escapeHtml(displayName)}</span>` +
      `<span class="name-secondary">@${u}</span>`
    );
  }
  return `<span class="name-primary">@${u}</span>`;
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
    const el = document.createElement("div");
    el.className = "pending-item";
    el.innerHTML = `
      <span class="contact-name">${contactNameHtml(c.requester.username, c.requester.display_name)}</span>
      <button class="accept-btn" data-id="${c.id}" aria-label="Acceptera" title="Acceptera"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>
      <button class="reject-btn" data-id="${c.id}" aria-label="Neka" title="Neka"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
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
    const other = isRequester ? c.addressee : c.requester;
    const username = other.username;
    const displayName = other.display_name;
    const el = document.createElement("div");
    el.className =
      "contact-item" +
      (selectedContact && selectedContact.recipientId === recipientId ? " active" : "");
    el.dataset.recipientId = recipientId;
    el.dataset.contactId = c.id;
    el.dataset.username = username;
    const unread = unreadCounts[recipientId] || 0;
    const online = onlineUserIds.has(recipientId);
    el.innerHTML =
      `<span class="contact-left">` +
        `<span class="presence-dot${online ? " online" : ""}" title="${online ? "Online" : "Offline"}"></span>` +
        `<span class="contact-name">${contactNameHtml(username, displayName)}</span>` +
      `</span>` +
      (unread > 0 ? `<span class="unread-badge">${unread}</span>` : "");
    el.addEventListener("click", () => selectContact(c.id, recipientId, username, displayName));
    contactsList.appendChild(el);
  });

  // Outgoing pending
  outgoing.forEach((c) => {
    const el = document.createElement("div");
    el.className = "contact-item outgoing";
    el.innerHTML =
      `<span class="contact-name">${contactNameHtml(c.addressee.username, c.addressee.display_name)}</span>` +
      ` <svg class="icon" role="img" aria-label="Väntar på svar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Väntar på svar</title><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`;
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

async function selectContact(contactId, recipientId, username, displayName) {
  selectedContact = { contactId, recipientId, username, displayName: displayName || null };

  if (unreadCounts[recipientId]) {
    unreadCounts[recipientId] = 0;
    renderContacts();
  }

  document.querySelectorAll(".contact-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.recipientId === recipientId);
  });

  chatPlaceholder.classList.add("hidden");
  chatView.classList.remove("hidden");
  appEl.classList.add("chat-active");
  setMobileContactsCollapsed(true);
  chatContactName.innerHTML = contactNameHtml(username, selectedContact.displayName);

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
  if (el._dismissed) return;
  el._dismissed = true;
  clearTimeout(el._dismissTimer);
  el.classList.add("fade-out");
  el.addEventListener(
    "animationend",
    async () => {
      if (el._objectUrl) {
        URL.revokeObjectURL(el._objectUrl);
        el._objectUrl = null;
      }
      el.remove();
      await sb.rpc("dismiss_ping", { p_id: ping.id });
    },
    { once: true }
  );
}

function renderPing(ping, animate = true) {
  const isSelf = ping.sender_id === currentUser.id;
  const el = document.createElement("div");

  if (ping.type === "text") {
    el.className = `item ${isSelf ? "self" : "other"}${animate && !isSelf ? " ping" : ""}`;
    el.innerHTML = `
      <div class="meta">${formatTime(ping.created_at)}</div>
      <div class="content">${linkify(ping.content)}</div>
      <button class="dismiss-btn" aria-label="Avfärda"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
    `;
  } else if (ping.type === "file") {
    el.className = `item ${isSelf ? "self" : "other"} file-item${animate && !isSelf ? " ping" : ""}`;
    const isImage = isImageFile(ping.file_name);
    const iconOrThumb = isImage
      ? `<img class="image-thumb loading" alt="${escapeHtml(ping.file_name)}" />`
      : `<span class="file-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" width="20" height="20" loading="lazy" /></span>`;
    el.innerHTML = `
      <div class="meta">${formatTime(ping.created_at)}</div>
      <div class="file-info">
        ${iconOrThumb}
        <span>${escapeHtml(ping.file_name)} <span class="file-size">${formatSize(ping.file_size)}</span></span>
        <button class="download-btn" data-path="${escapeHtml(ping.file_path)}" data-name="${escapeHtml(ping.file_name)}"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg> LADDA NER</button>
      </div>
      <button class="dismiss-btn" aria-label="Avfärda"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
    `;
  }

  board.appendChild(el);

  // CSP forbids inline onerror; attach the fallback in JS so a missing icon
  // degrades to file.svg instead of a broken-image glyph.
  const typeIcon = el.querySelector(".file-type-icon");
  if (typeIcon) {
    typeIcon.addEventListener("error", () => {
      if (!typeIcon.src.endsWith("/file.svg")) {
        typeIcon.src = "/icons/filetypes/file.svg";
      }
    }, { once: true });
  }

  // Image pings: fetch the private file for an inline thumbnail. This uses the
  // pure fetchObjectUrl (no dismissal). Clicking the thumb opens the lightbox
  // reusing the same object URL. The URL is stored on the element and revoked
  // when the ping is dismissed (see dismissPing).
  const thumb = el.querySelector(".image-thumb");
  if (thumb) {
    fetchObjectUrl(ping.file_path).then((url) => {
      // Ping was dismissed while the fetch was in flight — revoke and bail so
      // we don't leak a blob URL onto a detached element.
      if (el._dismissed) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (!url) {
        // Fetch failed — degrade to the colored file-type icon row.
        thumb.outerHTML = `<span class="file-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" width="20" height="20" /></span>`;
        const fallbackIcon = el.querySelector(".file-type-icon");
        if (fallbackIcon) {
          fallbackIcon.addEventListener("error", () => {
            if (!fallbackIcon.src.endsWith("/file.svg")) {
              fallbackIcon.src = "/icons/filetypes/file.svg";
            }
          }, { once: true });
        }
        return;
      }
      el._objectUrl = url;
      thumb.src = url;
      thumb.classList.remove("loading");
      thumb.addEventListener("click", () => openLightbox(url));
    });
  }

  // Text pings: render a link preview card for the first URL, if any.
  if (ping.type === "text") {
    const url = firstUrl(ping.content);
    if (url) renderLinkPreview(el, url);
  }

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

  // Auto-remove on timer for freshly-arrived pings only — historical pings
  // loaded on chat open keep until the user dismisses them. Received files
  // also wait for download instead of timing out.
  const isReceivedFile = ping.type === "file" && !isSelf;
  if (animate && !isReceivedFile) {
    el._dismissTimer = setTimeout(() => dismissPing(el, ping), 20000);
  }
}

// ============================================================
// SEND — text pings and file uploads
// ============================================================

textForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;

  // Slash commands run locally and never become pings. parseCommand returns
  // null for plain text and for "/ text" / "/" so literal slashes still send.
  if (window.PingCommands && PingCommands.parseCommand(text)) {
    PingCommands.runCommand(text, buildCommandContext());
    textInput.value = "";
    resetInputHeight();
    hideCommandHints();
    return;
  }

  if (!selectedContact) return;

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
  lastSentText = text;
  textInput.value = "";
  resetInputHeight();
});

async function uploadFiles(files) {
  if (!selectedContact) return;

  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      alert("Filen är för stor (max 50 MB)");
      continue;
    }

    const safeName = file.name.normalize("NFC").replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${currentUser.id}/${crypto.randomUUID()}_${safeName}`;
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

// Downloads a private storage object and returns an object URL for it.
// PURE: it performs no dismissal — used by both image previews (which must NOT
// dismiss) and downloadFile (where the caller handles dismissal separately).
// Returns null on error. Callers must URL.revokeObjectURL() when done.
async function fetchObjectUrl(path) {
  const { data, error } = await sb.storage.from("ping-files").download(path);
  if (error) {
    console.error("Storage download failed:", error);
    return null;
  }
  return URL.createObjectURL(data);
}

async function downloadFile(path, filename) {
  const url = await fetchObjectUrl(path);
  if (!url) {
    alert("Nedladdning misslyckades.");
    return;
  }
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

// Attach (paperclip) reuses the existing multi-file picker.
attachBtn.addEventListener("click", () => fileInput.click());

// Camera: opens the camera on mobile, an image picker on desktop.
cameraBtn.addEventListener("click", () => cameraInput.click());
cameraInput.addEventListener("change", () => {
  if (cameraInput.files.length) {
    uploadFiles(cameraInput.files);
    cameraInput.value = "";
  }
});

// Video file picker reuses the existing upload pipeline.
videoInput.addEventListener("change", () => {
  if (videoInput.files.length) {
    uploadFiles(videoInput.files);
    videoInput.value = "";
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

function subscribeToRealtime() {
  realtimeChannel = sb
    .channel("realtime")
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
        const chatOpen = selectedContact && ping.sender_id === selectedContact.recipientId;

        if (chatOpen) {
          renderPing(ping);
          scrollToBottom();
        } else {
          // Chat not open: count it as unread and schedule a decrement when the
          // ping would have auto-expired (keeps the badge consistent with the
          // 20s ephemeral lifetime).
          unreadCounts[ping.sender_id] = (unreadCounts[ping.sender_id] || 0) + 1;
          renderContacts();
          setTimeout(() => {
            if (unreadCounts[ping.sender_id] > 0) {
              unreadCounts[ping.sender_id] -= 1;
              renderContacts();
            }
          }, 20000);
        }

        playPing();
      }
    )
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
        // "*" (not just UPDATE) so an invite redemption is seen live: the
        // redeemer inserts (requester=creator, addressee=redeemer,'accepted'),
        // and the creator — who is the requester — must catch that INSERT, not
        // only the accept-an-outgoing-request UPDATE.
        event: "*",
        schema: "public",
        table: "contacts",
        filter: `requester_id=eq.${currentUser.id}`,
      },
      () => {
        // Our outgoing request was accepted, or someone redeemed our invite.
        loadContacts();
      }
    )
    .subscribe();
}

// Tracks which users currently have Ping open, via Supabase Realtime presence
// on a shared channel. No DB writes. Updates the online dots in the sidebar.
function subscribePresence() {
  presenceChannel = sb.channel("presence", {
    config: { presence: { key: currentUser.id } },
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      onlineUserIds = new Set(Object.keys(state));
      renderContacts();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ online_at: new Date().toISOString() });
      }
    });
}

// ============================================================
// UTILITIES
// ============================================================

// Turn URLs in raw (unescaped) text into links. Escapes both the URL and the
// surrounding text itself, so it must be given the *raw* content — escaping
// beforehand would let the URL regex swallow entities like &amp; in query
// strings and produce broken links.
function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let out = "";
  let last = 0;
  for (const match of text.matchAll(urlRegex)) {
    out += escapeHtml(text.slice(last, match.index));
    const url = escapeHtml(match[0]);
    out += `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    last = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

// Extracts the first URL from text using the same pattern linkify uses.
function firstUrl(text) {
  const m = text.match(/(https?:\/\/[^\s]+)/);
  return m ? m[0] : null;
}

// Builds a link-preview card under a text ping element and fills it from
// /preview. Silently removes the card on any failure so the plain linkified
// URL in the message body still stands. Mirrors the image-thumb lifecycle:
// bails if the ping was dismissed while the fetch was in flight.
function renderLinkPreview(el, url) {
  const card = document.createElement("a");
  card.className = "link-preview loading";
  card.target = "_blank";
  card.rel = "noopener";
  card.href = url;
  el.appendChild(card);

  fetch("/preview?url=" + encodeURIComponent(url))
    .then((res) => (res.status === 200 ? res.json() : null))
    .then((meta) => {
      if (el._dismissed) {
        card.remove();
        return;
      }
      if (!meta) {
        card.remove();
        return;
      }
      card.href = meta.url || url;
      card.classList.remove("loading");

      let imageHtml = "";
      if (meta.image) {
        imageHtml = `<img class="link-preview__image" alt="" />`;
      }
      const descHtml = meta.description
        ? `<div class="link-preview__desc">${escapeHtml(meta.description)}</div>`
        : "";
      const faviconHtml = meta.favicon
        ? `<img class="link-preview__favicon" alt="" width="14" height="14" />`
        : "";

      card.innerHTML = `
        ${imageHtml}
        <div class="link-preview__body">
          <div class="link-preview__domain">${faviconHtml}<span>${escapeHtml(meta.domain || "")}</span></div>
          <div class="link-preview__title">${escapeHtml(meta.title || "")}</div>
          ${descHtml}
        </div>
      `;

      // CSP forbids inline onerror; attach in JS. A broken proxied image (or
      // favicon) just hides that element and degrades to a text-only card.
      const img = card.querySelector(".link-preview__image");
      if (img) {
        img.addEventListener("error", () => img.remove(), { once: true });
        img.src = meta.image;
      }
      const fav = card.querySelector(".link-preview__favicon");
      if (fav) {
        fav.addEventListener("error", () => fav.remove(), { once: true });
        fav.src = meta.favicon;
      }
    })
    .catch(() => card.remove());
}

// Maps a filename to a colored file-type SVG under /icons/filetypes/.
// DIRECT = extensions that have their own <ext>.svg. ALIASES maps other
// extensions onto an existing icon. Anything unmatched falls back to file.svg.
const FILE_ICON_DIRECT = new Set([
  "3ds", "ai", "archive", "asp", "avi", "bin", "css", "csv", "dbf", "dll",
  "doc", "dwg", "eps", "exe", "fla", "gif", "html", "ico", "ini", "iso",
  "jar", "jpg", "js", "json", "mkv", "mov", "mp3", "mp4", "nfo", "obj",
  "otf", "pdf", "pkg", "png", "ppt", "psd", "rtf", "svg", "ttf", "txt",
  "vcf", "wav", "wmv", "xls", "xml", "zip",
]);

const FILE_ICON_ALIASES = {
  jpeg: "jpg",
  webp: "jpg", bmp: "jpg", tiff: "jpg", heic: "jpg",
  docx: "doc", odt: "doc", md: "txt", log: "txt",
  xlsx: "xls", ods: "xls",
  pptx: "ppt", odp: "ppt",
  webm: "mp4", m4v: "mp4",
  rar: "archive", tar: "archive", gz: "archive", "7z": "archive",
  flac: "mp3", m4a: "mp3", aac: "mp3", ogg: "mp3",
  scss: "css", sass: "css", less: "css",
  htm: "html",
  mjs: "js", ts: "js", tsx: "js", jsx: "js",
};

function fileTypeIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  let key;
  if (FILE_ICON_DIRECT.has(ext)) {
    key = ext;
  } else if (FILE_ICON_ALIASES[ext]) {
    key = FILE_ICON_ALIASES[ext];
  } else {
    key = "file";
  }
  return `/icons/filetypes/${key}.svg`;
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

function isImageFile(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return IMAGE_EXTS.has(ext);
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

// Escapes for both text and attribute contexts. Quotes are included because
// this output is interpolated into HTML attributes (href, data-path, etc.) as
// well as element text — leaving " unescaped would let a crafted value break
// out of an attribute.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scrollToBottom() {
  chatMain.scrollTop = chatMain.scrollHeight;
}

let _lightboxLastFocus = null;

function openLightbox(objectUrl) {
  lightboxImg.src = objectUrl;
  lightbox.classList.remove("hidden");
  _lightboxLastFocus = document.activeElement;
  lightboxClose.focus();
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightboxImg.removeAttribute("src");
  if (_lightboxLastFocus) _lightboxLastFocus.focus();
}

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  // Backdrop click (not the image) closes.
  if (e.target === lightbox) closeLightbox();
});

// --- Settings modal ---
let _settingsLastFocus = null;

function openSettings() {
  _settingsLastFocus = document.activeElement;
  settingsModal.classList.remove("hidden");
  settingsClose.focus();
}

function closeSettings() {
  settingsModal.classList.add("hidden");
  // Discard any unsaved edits so a reopened modal reflects the saved state,
  // not stale typed-but-not-saved text. Also clear the password fields so a
  // typed-but-unsubmitted password isn't left sitting in the DOM.
  displayNameInput.value = currentUser ? currentUser.display_name || "" : "";
  newPasswordInput.value = "";
  newPasswordConfirm.value = "";
  if (_settingsLastFocus) _settingsLastFocus.focus();
}

settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});

// --- Video button popup menu ---
const canRecordVideo = !!(
  navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === "function" &&
  window.MediaRecorder
);
if (!canRecordVideo) videoRecordBtn.classList.add("hidden");

function openVideoMenu() {
  videoMenu.classList.remove("hidden");
  videoBtn.setAttribute("aria-expanded", "true");
}

function closeVideoMenu() {
  videoMenu.classList.add("hidden");
  videoBtn.setAttribute("aria-expanded", "false");
}

videoBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (videoMenu.classList.contains("hidden")) openVideoMenu();
  else closeVideoMenu();
});

// Outside-click closes the menu.
document.addEventListener("click", (e) => {
  if (videoMenu.classList.contains("hidden")) return;
  if (!videoMenu.contains(e.target) && e.target !== videoBtn) closeVideoMenu();
});

// Escape closes the menu.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !videoMenu.classList.contains("hidden")) closeVideoMenu();
});

videoPickBtn.addEventListener("click", () => {
  closeVideoMenu();
  videoInput.click();
});

// --- Video recording modal ---
const RECORD_MAX_MS = 60000; // hard 60s auto-stop
let recordStream = null;      // active MediaStream (camera + mic)
let recordRecorder = null;    // active MediaRecorder
let recordChunks = [];        // collected Blob parts
let recordBlob = null;        // finished recording
let recordBlobUrl = null;     // object URL for review playback
let recordTimer = null;       // setInterval handle for the elapsed timer
let recordStartedAt = 0;

function recordSetButtons({ start, stop, send, again }) {
  recordStart.classList.toggle("hidden", !start);
  recordStop.classList.toggle("hidden", !stop);
  recordSend.classList.toggle("hidden", !send);
  recordAgain.classList.toggle("hidden", !again);
}

function recordStopStream() {
  if (recordStream) {
    recordStream.getTracks().forEach((t) => t.stop());
    recordStream = null;
  }
}

function recordRevokeBlob() {
  if (recordBlobUrl) {
    URL.revokeObjectURL(recordBlobUrl);
    recordBlobUrl = null;
  }
  recordBlob = null;
  recordChunks = [];
}

function recordClearTimer() {
  if (recordTimer) {
    clearInterval(recordTimer);
    recordTimer = null;
  }
}

// Full teardown used by every exit path.
function closeRecordModal() {
  if (recordRecorder && recordRecorder.state !== "inactive") {
    recordRecorder.onstop = null; // don't trigger review on a forced stop
    recordRecorder.stop();
  }
  recordRecorder = null;
  recordClearTimer();
  recordStopStream();
  recordRevokeBlob();
  recordVideo.srcObject = null;
  recordVideo.removeAttribute("src");
  recordVideo.muted = true;
  recordError.classList.add("hidden");
  recordError.textContent = "";
  recordStatus.textContent = "";
  recordModal.classList.add("hidden");
}

// Acquire camera+mic and show the live preview.
async function startLivePreview() {
  recordError.classList.add("hidden");
  recordRevokeBlob();
  recordVideo.removeAttribute("src");
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    console.error("getUserMedia failed:", err);
    recordError.textContent = "Kunde inte komma åt kamera/mikrofon.";
    recordError.classList.remove("hidden");
    recordStatus.textContent = "";
    recordSetButtons({ start: false, stop: false, send: false, again: false });
    return;
  }
  recordVideo.muted = true; // mute live preview to avoid echo
  recordVideo.srcObject = recordStream;
  recordVideo.play().catch(() => {});
  recordStatus.textContent = "Redo att spela in";
  recordSetButtons({ start: true, stop: false, send: false, again: false });
}

async function openRecordModal() {
  recordModal.classList.remove("hidden");
  await startLivePreview();
}

function beginRecording() {
  if (!recordStream) return;
  recordChunks = [];
  recordRecorder = new MediaRecorder(recordStream);
  recordRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordChunks.push(e.data);
  };
  recordRecorder.onstop = () => {
    recordClearTimer();
    recordBlob = new Blob(recordChunks, { type: recordRecorder.mimeType || "video/webm" });
    recordBlobUrl = URL.createObjectURL(recordBlob);
    recordVideo.srcObject = null;
    recordVideo.src = recordBlobUrl;
    recordVideo.muted = false; // play review with sound
    recordVideo.play().catch(() => {});
    recordStatus.textContent = "Förhandsgranskning";
    recordSetButtons({ start: false, stop: false, send: true, again: true });
  };
  recordRecorder.start();
  recordStartedAt = Date.now();
  recordStatus.textContent = "Spelar in… 0s";
  recordSetButtons({ start: false, stop: true, send: false, again: false });
  recordTimer = setInterval(() => {
    const elapsed = Date.now() - recordStartedAt;
    recordStatus.textContent = "Spelar in… " + Math.floor(elapsed / 1000) + "s";
    if (elapsed >= RECORD_MAX_MS) stopRecording();
  }, 250);
}

function stopRecording() {
  if (recordRecorder && recordRecorder.state !== "inactive") recordRecorder.stop();
}

function recordTimestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    "video-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".webm"
  );
}

async function sendRecording() {
  if (!recordBlob) return;
  const file = new File([recordBlob], recordTimestampName(), {
    type: recordBlob.type || "video/webm",
  });
  closeRecordModal();   // tear down camera/mic before the upload round-trip
  await uploadFiles([file]);
}

// Wiring
videoRecordBtn.addEventListener("click", () => {
  closeVideoMenu();
  openRecordModal();
});
recordStart.addEventListener("click", beginRecording);
recordStop.addEventListener("click", stopRecording);
recordSend.addEventListener("click", sendRecording);
recordAgain.addEventListener("click", () => {
  recordRevokeBlob();
  startLivePreview();
});
recordCancel.addEventListener("click", closeRecordModal);
recordClose.addEventListener("click", closeRecordModal);
recordModal.addEventListener("click", (e) => {
  if (e.target === recordModal) closeRecordModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !recordModal.classList.contains("hidden")) closeRecordModal();
});

function showSettingsMsg(el, text, ok) {
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("ok", !!ok);
  el.classList.toggle("err", !ok);
}

displayNameSave.addEventListener("click", async () => {
  const raw = displayNameInput.value.trim();
  if (raw.length > 40) {
    showSettingsMsg(displayNameMsg, "Visningsnamn: max 40 tecken.", false);
    return;
  }
  const value = raw === "" ? null : raw;

  const { error } = await sb
    .from("profiles")
    .update({ display_name: value })
    .eq("id", currentUser.id);

  if (error) {
    // DB CHECK is the backstop for the same length rule enforced above.
    showSettingsMsg(displayNameMsg, "Kunde inte spara visningsnamn.", false);
    return;
  }

  currentUser.display_name = value;
  displayNameInput.value = value || "";
  showSettingsMsg(displayNameMsg, "Sparat!", true);
  renderContacts();
  refreshChatHeader();
});

passwordSave.addEventListener("click", async () => {
  const pw = newPasswordInput.value;
  const confirm = newPasswordConfirm.value;

  if (pw.length < 6) {
    showSettingsMsg(passwordMsg, "Lösenord: minst 6 tecken.", false);
    return;
  }
  if (pw !== confirm) {
    showSettingsMsg(passwordMsg, "Lösenorden matchar inte.", false);
    return;
  }

  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) {
    showSettingsMsg(passwordMsg, "Kunde inte uppdatera lösenord: " + error.message, false);
    return;
  }

  newPasswordInput.value = "";
  newPasswordConfirm.value = "";
  showSettingsMsg(passwordMsg, "Lösenord uppdaterat!", true);
});

// ============================================================
// INVITE LINKS
// ============================================================
let _inviteCountdownTimer = null;
let _inviteLastFocus = null;

function renderInviteQr(url) {
  inviteQr.innerHTML = "";
  try {
    const qr = window.qrcode(0, "M"); // type 0 = auto-size, M = ~15% ECC
    qr.addData(url);
    qr.make();
    // createImgTag(cellSize, margin) returns an <img> with a data: src.
    // CSP allows img-src 'self' data:, so this renders without a CSP change.
    inviteQr.innerHTML = qr.createImgTag(5, 2);
  } catch (err) {
    console.error("QR render failed:", err);
    // The copyable link below is the source of truth; a missing QR is non-fatal.
  }
}

function startInviteCountdown(expiresAt) {
  clearInterval(_inviteCountdownTimer);
  const tick = () => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      clearInterval(_inviteCountdownTimer);
      inviteCountdown.textContent = "Länken har gått ut.";
      inviteCountdown.classList.add("expired");
      inviteRegenBtn.classList.remove("hidden");
      inviteCopyBtn.disabled = true;
      return;
    }
    const total = Math.ceil(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    inviteCountdown.textContent = `Giltig i ${m}:${s}`;
  };
  tick();
  _inviteCountdownTimer = setInterval(tick, 1000);
}

async function generateInvite() {
  inviteError.classList.add("hidden");
  inviteRegenBtn.classList.add("hidden");
  inviteCountdown.classList.remove("expired");
  inviteCopyBtn.disabled = false;
  inviteCopyBtn.classList.remove("copied");
  inviteCopyBtn.textContent = "Kopiera";
  inviteQr.innerHTML = "";
  inviteLinkInput.value = "";
  inviteCountdown.textContent = "Skapar länk…";

  const { data, error } = await sb.rpc("create_invite");
  // create_invite returns a one-row table; supabase-js gives an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || !row.id) {
    console.error("create_invite failed:", error);
    inviteCountdown.textContent = "";
    inviteError.textContent = "Kunde inte skapa länk. Försök igen.";
    inviteError.classList.remove("hidden");
    inviteRegenBtn.classList.remove("hidden");
    return;
  }

  const url = window.buildInviteUrl(window.location.origin, row.id);
  inviteLinkInput.value = url;
  renderInviteQr(url);
  startInviteCountdown(row.expires_at);
}

function openInvite() {
  _inviteLastFocus = document.activeElement;
  inviteModal.classList.remove("hidden");
  inviteClose.focus();
  generateInvite();
}

function closeInvite() {
  clearInterval(_inviteCountdownTimer);
  inviteModal.classList.add("hidden");
  inviteQr.innerHTML = "";
  inviteLinkInput.value = "";
  inviteCountdown.textContent = "";
  if (_inviteLastFocus) _inviteLastFocus.focus();
}

inviteOpenBtn.addEventListener("click", openInvite);
inviteClose.addEventListener("click", closeInvite);
inviteRegenBtn.addEventListener("click", generateInvite);
inviteModal.addEventListener("click", (e) => {
  if (e.target === inviteModal) closeInvite();
});

inviteCopyBtn.addEventListener("click", async () => {
  const url = inviteLinkInput.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch (err) {
    // Fallback for browsers without async clipboard / insecure contexts.
    inviteLinkInput.select();
    document.execCommand("copy");
  }
  inviteCopyBtn.textContent = "Kopierad!";
  inviteCopyBtn.classList.add("copied");
  setTimeout(() => {
    inviteCopyBtn.textContent = "Kopiera";
    inviteCopyBtn.classList.remove("copied");
  }, 1500);
});

const INVITE_STASH_KEY = "ping.pendingInvite";

const INVITE_MESSAGES = {
  ok: (u) => "Ansluten till @" + u + "!",
  used: () => "Länken är redan använd.",
  expired: () => "Länken har gått ut.",
  self: () => "Du kan inte bjuda in dig själv.",
  not_found: () => "Ogiltig länk.",
};

// Show the redemption result. Reuses the existing contact-search-result line in
// the sidebar (visible once inside the app).
function showInviteResult(status, username) {
  const msgFn = INVITE_MESSAGES[status] || INVITE_MESSAGES.not_found;
  contactSearchResult.textContent = msgFn(username);
  contactSearchResult.classList.remove("hidden");
}

// Redeem a token against Supabase and refresh contacts on success.
async function redeemInviteToken(token) {
  const { data, error } = await sb.rpc("redeem_invite", { p_token: token });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    console.error("redeem_invite failed:", error);
    showInviteResult("not_found");
    return;
  }
  showInviteResult(row.status, row.username);
  if (row.status === "ok") {
    await loadContacts();
  }
}

// Strip the invite fragment so a refresh doesn't re-attempt redemption.
function clearInviteHash() {
  if (window.parseInviteToken(window.location.hash)) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

const authInviteBanner = document.getElementById("auth-invite-banner");

function showAuthInviteBanner() {
  if (!authInviteBanner) return;
  authInviteBanner.textContent =
    "Någon vill ansluta — logga in eller skapa ett konto för att acceptera.";
  authInviteBanner.classList.remove("hidden");
}

function hideAuthInviteBanner() {
  if (authInviteBanner) authInviteBanner.classList.add("hidden");
}

// Pasting an invite link into an already-open /app tab only changes the URL
// fragment, which does NOT reload the page (so init() never re-runs). Handle
// that here: re-run the same logged-in/logged-out invite logic on hashchange.
window.addEventListener("hashchange", async () => {
  const token = window.parseInviteToken(window.location.hash);
  if (!token) return;
  if (currentUser) {
    await redeemInviteToken(token);
    clearInviteHash();
  } else {
    sessionStorage.setItem(INVITE_STASH_KEY, token);
    showAuthInviteBanner();
  }
});

function playPing() {
  if (localStorage.getItem("ping-muted") === "1") return;
  pingSound.currentTime = 0;
  pingSound.play().catch(() => {});
}

// --- Terminal command layer ---

// Renders a local-only, ephemeral "system line" in the chat board. Never stored
// in the DB, never sent to the contact, not a real ping. Auto-fades. Used by
// command feedback (/who, /help, /theme, errors, ...). Multi-line text (\n) is
// preserved. Skipped by loadPings (board.innerHTML reset) and by clearChat.
function systemLine(text) {
  if (!board) return;
  const el = document.createElement("div");
  el.className = "item system";
  el.textContent = text; // textContent keeps it XSS-safe and preserves \n via CSS
  board.appendChild(el);
  scrollToBottom();
  el._sysTimer = setTimeout(() => {
    el.classList.add("fade-out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 8000);
}

// Dismisses every real ping in the current chat by triggering each rendered
// dismiss button (reuses dismissPing exactly: RPC, object-URL revocation,
// fade-out). Skips .system lines. Returns the count dismissed.
function clearChat() {
  const items = board.querySelectorAll(".item:not(.system)");
  let n = 0;
  items.forEach((el) => {
    const btn = el.querySelector(".dismiss-btn");
    if (btn) {
      btn.click();
      n++;
    }
  });
  return n;
}

// Wraps applyTheme + the picker UI so /theme keeps the settings panel in sync.
function setThemeFromCommand(theme) {
  const swatches = document.querySelectorAll("#theme-picker .swatch");
  localStorage.setItem("ping-theme", theme);
  applyTheme(theme, swatches);
}

// Wraps applyFont + the picker UI so /font keeps the settings panel in sync.
function setFontFromCommand(font) {
  const buttons = document.querySelectorAll("#font-picker .font-btn");
  localStorage.setItem("ping-font", font);
  applyFont(font, buttons);
}

// Wraps the mute toggle so /mute and /unmute keep the settings panel in sync.
function setMutedFromCommand(muted) {
  localStorage.setItem("ping-muted", muted ? "1" : "0");
  if (muteToggle) muteToggle.checked = muted;
}

// Assembles the capability object handed to commands. Commands call these
// instead of touching globals/DOM/Supabase directly.
function buildCommandContext() {
  return {
    selectedContact,
    isOnline: (id) => onlineUserIds.has(id),
    getLastSent: () => lastSentText,
    systemLine,
    clearChat,
    applyTheme: setThemeFromCommand,
    applyFont: setFontFromCommand,
    setMuted: setMutedFromCommand,
    setInput: (text) => {
      textInput.value = text;
      autoGrowInput();
    },
    appendInput: (text) => {
      textInput.value = textInput.value ? textInput.value + " " + text : text;
      autoGrowInput();
    },
    focusInput: () => textInput.focus(),
  };
}

// --- Command hint menu ---
const commandHints = document.getElementById("command-hints");
let hintItems = []; // current list of matched command objects
let hintIndex = -1; // highlighted row, -1 = none

function hideCommandHints() {
  hintItems = [];
  hintIndex = -1;
  if (commandHints) {
    commandHints.classList.add("hidden");
    commandHints.innerHTML = "";
  }
}

function renderCommandHints() {
  if (!commandHints) return;
  const raw = textInput.value;
  hintItems = window.PingCommands ? PingCommands.getCommandHints(raw) : [];
  if (hintItems.length === 0) {
    hideCommandHints();
    return;
  }
  hintIndex = 0;
  commandHints.innerHTML = "";
  hintItems.forEach((c, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "hint-row" + (i === 0 ? " active" : "");
    row.dataset.index = String(i);
    row.innerHTML =
      `<span class="hint-name">/${c.name}${c.arg ? " &lt;" + c.arg + "&gt;" : ""}</span>` +
      `<span class="hint-summary">${c.summary}</span>`;
    row.addEventListener("mousedown", (e) => {
      // mousedown (not click) so it fires before the input blurs.
      e.preventDefault();
      completeHint(i);
    });
    commandHints.appendChild(row);
  });
  commandHints.classList.remove("hidden");
}

function highlightHint(next) {
  if (hintItems.length === 0) return;
  hintIndex = (next + hintItems.length) % hintItems.length;
  commandHints.querySelectorAll(".hint-row").forEach((row, i) => {
    row.classList.toggle("active", i === hintIndex);
  });
}

// Completes the highlighted command into the input. Commands that take an arg
// get a trailing space (ready for the value); arg-less commands get no space.
function completeHint(i) {
  const c = hintItems[i];
  if (!c) return;
  textInput.value = "/" + c.name + (c.arg ? " " : "");
  hideCommandHints();
  textInput.focus();
}

textInput.addEventListener("input", renderCommandHints);

// Auto-grow the textarea with its content (capped by CSS max-height).
function autoGrowInput() {
  textInput.style.height = "auto";
  textInput.style.height = textInput.scrollHeight + "px";
}

// Reset the textarea after sending/clearing. "auto" lets it collapse back to
// the CSS rows/min-height baseline.
function resetInputHeight() {
  textInput.style.height = "auto";
}

textInput.addEventListener("input", autoGrowInput);

textInput.addEventListener("keydown", (e) => {
  const menuOpen =
    !commandHints.classList.contains("hidden") && hintItems.length > 0;

  if (menuOpen) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightHint(hintIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightHint(hintIndex - 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      completeHint(hintIndex);
    } else if (e.key === "Enter") {
      // Enter with the menu open completes instead of submitting.
      e.preventDefault();
      completeHint(hintIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hideCommandHints();
    }
    return;
  }

  // Menu closed: Enter sends, Shift+Enter inserts a newline.
  // !e.isComposing prevents sending mid-IME-composition (CJK/etc.).
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    textForm.requestSubmit();
  }
});

// --- Theme picker ---
function initThemePicker() {
  const picker = document.getElementById("theme-picker");
  if (!picker) return;
  const swatches = picker.querySelectorAll(".swatch");
  const saved = localStorage.getItem("ping-theme") || "green";
  applyTheme(saved, swatches);
  swatches.forEach((s) => {
    s.addEventListener("click", () => {
      const theme = s.dataset.theme;
      localStorage.setItem("ping-theme", theme);
      applyTheme(theme, swatches);
    });
  });
}

function applyTheme(theme, swatches) {
  if (theme === "green") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  swatches.forEach((s) => s.classList.toggle("active", s.dataset.theme === theme));
}

initThemePicker();

// --- Font picker ---
function initFontPicker() {
  const picker = document.getElementById("font-picker");
  if (!picker) return;
  const buttons = picker.querySelectorAll(".font-btn");
  const saved = localStorage.getItem("ping-font") || "radon";
  applyFont(saved, buttons);
  buttons.forEach((b) => {
    b.addEventListener("click", () => {
      const font = b.dataset.font;
      localStorage.setItem("ping-font", font);
      applyFont(font, buttons);
    });
  });
}

function applyFont(font, buttons) {
  if (font === "radon") {
    document.documentElement.removeAttribute("data-font");
  } else {
    document.documentElement.setAttribute("data-font", font);
  }
  buttons.forEach((b) => b.classList.toggle("active", b.dataset.font === font));
}

initFontPicker();

// --- Mute toggle ---
function initMuteToggle() {
  if (!muteToggle) return;
  muteToggle.checked = localStorage.getItem("ping-muted") === "1";
  muteToggle.addEventListener("change", () => {
    localStorage.setItem("ping-muted", muteToggle.checked ? "1" : "0");
  });
}

initMuteToggle();

// Normalized accepted contacts for the keyboard palette / shortcuts. Mirrors
// the derivation in renderContacts() but returns a flat, render-agnostic shape.
function getAcceptedContactsForKeyboard() {
  if (!currentUser) return [];
  return contacts
    .filter((c) => c.status === "accepted")
    .map((c) => {
      const isRequester = c.requester_id === currentUser.id;
      const recipientId = isRequester ? c.addressee_id : c.requester_id;
      const other = isRequester ? c.addressee : c.requester;
      return {
        contactId: c.id,
        recipientId,
        username: other.username,
        displayName: other.display_name || null,
        online: onlineUserIds.has(recipientId),
        unread: unreadCounts[recipientId] || 0,
      };
    });
}

// --- Start ---
window.PingKeyboard.initKeyboard({
  // overlays
  isLightboxOpen: () => !lightbox.classList.contains("hidden"),
  closeLightbox,
  isInviteOpen: () => !inviteModal.classList.contains("hidden"),
  closeInvite,
  isSettingsOpen: () => !settingsModal.classList.contains("hidden"),
  closeSettings,
  // app state / actions
  isAppActive: () => !appEl.classList.contains("hidden"),
  getContacts: getAcceptedContactsForKeyboard,
  getSelectedRecipientId: () => (selectedContact ? selectedContact.recipientId : null),
  selectContact,
  openSettings,
  focusComposer: () => textInput.focus(),
  escapeHtml,
});

init();
