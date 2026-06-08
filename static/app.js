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
const galleryBtn = document.getElementById("gallery-btn");
const disappearingBtn = document.getElementById("disappearing-btn");
const disappearingMenu = document.getElementById("disappearing-menu");
const disappearingLabel = document.getElementById("disappearing-label");
const galleryModal = document.getElementById("gallery-modal");
const galleryClose = document.getElementById("gallery-close");
const galleryTitle = document.getElementById("gallery-title");
const galleryGrid = document.getElementById("gallery-grid");
const chatMain = document.getElementById("chat-main");
const board = document.getElementById("board");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const cameraMenu = document.getElementById("camera-menu");
const imageUploadBtn = document.getElementById("image-upload-btn");
const imageCaptureBtn = document.getElementById("image-capture-btn");
const imageInput = document.getElementById("image-input");
const captureModal = document.getElementById("capture-modal");
const captureClose = document.getElementById("capture-close");
const captureVideo = document.getElementById("capture-video");
const captureStill = document.getElementById("capture-still");
const captureStatus = document.getElementById("capture-status");
const captureError = document.getElementById("capture-error");
const captureSnap = document.getElementById("capture-snap");
const captureSend = document.getElementById("capture-send");
const captureRetake = document.getElementById("capture-retake");
const captureCancel = document.getElementById("capture-cancel");
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
const emojiBtn = document.getElementById("emoji-btn");
const emojiPicker = document.getElementById("emoji-picker");
const emojiSearch = document.getElementById("emoji-search");
const emojiCatRow = document.getElementById("emoji-cat-row");
const emojiCatLabel = document.getElementById("emoji-cat-label");
const emojiGrid = document.getElementById("emoji-grid");
const emojiStatus = document.getElementById("emoji-status");
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
let selectedContact = null; // { contactId, recipientId, username, displayName, disappearingTtl }
let contacts = [];
let lastSentText = null; // last text the user sent, for /last recall
let unreadCounts = {}; // recipientId -> count of unread, non-dismissed pings from that contact; loaded from the DB on entry (durable across reload) and kept live by realtime
let realtimeChannel = null;
let presenceChannel = null;
let onlineUserIds = new Set();
let emojiIndex = null; // Map<"folder/id", {label,...}> built lazily from emoji-data.json (see emoji picker)

const PINGS_PAGE_SIZE = 50;
// Paging state for the open chat's scrollback. oldestCursor is a compound
// keyset cursor { ts, id } for the topmost rendered message — created_at alone
// isn't a stable key (two messages can share a microsecond, e.g. a multi-file
// upload loop), so the next older page is fetched with a (created_at, id)
// keyset to avoid skipping or duplicating co-timestamped rows. hasMoreOlder is
// false once a page returns fewer than PINGS_PAGE_SIZE rows (we've reached the
// start of history). loadingOlder guards against overlapping "ladda äldre"
// fetches. lastRenderedPing tracks the newest message appended to the open
// board so realtime/send paths can decide whether a fresh day separator is
// needed.
let oldestCursor = null;
let hasMoreOlder = false;
let loadingOlder = false;
let lastRenderedPing = null;

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

  await loadUnreadCounts();
  await loadContacts();
  subscribeToRealtime();
  subscribePresence();
}

function exitApp() {
  currentUser = null;
  selectedContact = null;
  contacts = [];
  unreadCounts = {};
  oldestCursor = null;
  hasMoreOlder = false;
  loadingOlder = false;
  lastRenderedPing = null;

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
  // And the file gallery, so it doesn't linger over the auth screen and its
  // thumbnail blob URLs are revoked.
  closeFileGallery();

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
      `id, status, requester_id, addressee_id, created_at, disappearing_ttl,
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
  // A contact may have changed their display name OR the pair's disappearing
  // timer since we opened the chat; re-sync both from the fresh data.
  syncSelectedContactDisplayName();
  syncSelectedContactDisappearingTtl();
  renderContacts();
  refreshChatHeader();
  refreshDisappearingControl();
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

// Re-reads the open pair's disappearing_ttl from the freshly loaded `contacts`
// array (matched by the other party's user id), so a remote timer change shows
// live. No-op when no contact is selected or the contact is no longer listed.
function syncSelectedContactDisappearingTtl() {
  if (!selectedContact) return;
  const match = contacts.find(
    (c) =>
      c.status === "accepted" &&
      (c.requester_id === selectedContact.recipientId ||
        c.addressee_id === selectedContact.recipientId)
  );
  if (!match) return;
  selectedContact.disappearingTtl = match.disappearing_ttl || null;
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

// Source of truth for the sidebar unread badges on load: how many messages
// each contact has sent me that I haven't read yet (and haven't deleted).
// Populates the in-memory unreadCounts map keyed by the sender's id (which is
// the contact's recipientId in sidebar terms). Realtime keeps it live after.
async function loadUnreadCounts() {
  const { data, error } = await sb
    .from("pings")
    .select("sender_id")
    .eq("receiver_id", currentUser.id)
    .is("read_at", null)
    .eq("dismissed_by_receiver", false);

  if (error) {
    console.error("Failed to load unread counts:", error);
    return;
  }

  const counts = {};
  (data || []).forEach((row) => {
    counts[row.sender_id] = (counts[row.sender_id] || 0) + 1;
  });
  unreadCounts = counts;
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
  closeFileGallery();
  const contactRow = contacts.find((c) => c.id === contactId);
  selectedContact = {
    contactId,
    recipientId,
    username,
    displayName: displayName || null,
    disappearingTtl: contactRow ? contactRow.disappearing_ttl || null : null,
  };

  document.querySelectorAll(".contact-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.recipientId === recipientId);
  });

  chatPlaceholder.classList.add("hidden");
  chatView.classList.remove("hidden");
  appEl.classList.add("chat-active");
  setMobileContactsCollapsed(true);
  chatContactName.innerHTML = contactNameHtml(username, selectedContact.displayName);

  refreshDisappearingControl();

  await loadPings();
  textInput.focus();
  await markChatRead();
}

// Marks the open chat's incoming messages read in the DB (only when the tab is
// focused — an open-but-backgrounded chat shouldn't count as read), then clears
// the local badge for that contact and re-renders the sidebar.
async function markChatRead() {
  if (!selectedContact || !document.hasFocus()) return;
  const { recipientId } = selectedContact;
  const { error } = await sb.rpc("mark_read", { p_other: recipientId });
  if (error) {
    console.error("mark_read failed:", error);
    return;
  }
  if (unreadCounts[recipientId]) {
    unreadCounts[recipientId] = 0;
    renderContacts();
  }
}

async function loadPings() {
  if (!selectedContact) return;

  const { recipientId } = selectedContact;
  // Fetch the most recent PINGS_PAGE_SIZE rows: order DESC + limit, then
  // reverse so we render oldest→newest into the board.
  const { data: pings, error } = await sb
    .from("pings")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${recipientId}),` +
        `and(sender_id.eq.${recipientId},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PINGS_PAGE_SIZE);

  if (error) {
    console.error("Failed to load pings:", error);
    return;
  }

  const ttlSeconds = parseTtlSeconds(selectedContact.disappearingTtl);
  // hasMoreOlder reflects the raw page size (whether the DB had a full page),
  // independent of how many survive the expiry filter — otherwise filtering the
  // whole page to empty would wrongly stop paging.
  hasMoreOlder = (pings || []).length === PINGS_PAGE_SIZE;
  const page = (pings || [])
    .slice()
    .reverse() // oldest → newest
    .filter((ping) => !isExpired(ping, ttlSeconds));
  // Cursor anchors on the oldest RAW row (not the oldest surviving one) so the
  // next page continues from the true page boundary even if the top rows were
  // filtered out as expired.
  const rawOldest = (pings || []).length
    ? (pings || [])[(pings || []).length - 1]
    : null;
  oldestCursor = rawOldest
    ? { ts: rawOldest.created_at, id: rawOldest.id }
    : null;

  board.innerHTML = "";
  lastRenderedPing = null;
  renderLoadOlderControl();
  let prev = null;
  page.forEach((ping) => {
    renderDaySeparatorIfNeeded(ping, prev);
    renderPing(ping, false);
    prev = ping;
  });
  lastRenderedPing = page.length ? page[page.length - 1] : null;
  scrollToBottom();
}

// Inserts (or refreshes) the "ladda äldre" button as the first child of #board.
// Removed when there is no older history left. Returns the button element (or
// null when there's no more history) so callers can anchor a prepend to it.
function renderLoadOlderControl() {
  let ctl = document.getElementById("load-older");
  if (!hasMoreOlder) {
    if (ctl) ctl.remove();
    return null;
  }
  if (!ctl) {
    ctl = document.createElement("button");
    ctl.id = "load-older";
    ctl.className = "load-older";
    ctl.type = "button";
    ctl.textContent = "ladda äldre";
    ctl.addEventListener("click", loadOlderPings);
  }
  // Always keep it as the first child so it stays at the very top.
  if (board.firstChild !== ctl) board.insertBefore(ctl, board.firstChild);
  return ctl;
}

// Fetches the page of messages older than the oldestCursor keyset and prepends
// them, preserving the user's scroll position (so the viewport doesn't jump).
async function loadOlderPings() {
  if (!selectedContact || loadingOlder || !hasMoreOlder || !oldestCursor) return;
  loadingOlder = true;
  try {
    const { recipientId } = selectedContact;

    // Compound keyset: rows strictly older than the cursor in (created_at, id)
    // descending order — created_at < ts, OR same created_at with a smaller id.
    // This won't skip or duplicate messages that share a created_at at the page
    // boundary (a plain `.lt("created_at", ts)` would drop a co-timestamped
    // sibling). The pair filter is applied with .or(); the keyset is a second
    // .or() (PostgREST ANDs successive .or() groups together).
    const { data: pings, error } = await sb
      .from("pings")
      .select("*")
      .or(
        `and(sender_id.eq.${currentUser.id},receiver_id.eq.${recipientId}),` +
          `and(sender_id.eq.${recipientId},receiver_id.eq.${currentUser.id})`
      )
      .or(
        `created_at.lt.${oldestCursor.ts},` +
          `and(created_at.eq.${oldestCursor.ts},id.lt.${oldestCursor.id})`
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PINGS_PAGE_SIZE);

    if (error) {
      console.error("Failed to load older pings:", error);
      return;
    }

    const ttlSeconds = parseTtlSeconds(selectedContact.disappearingTtl);
    hasMoreOlder = (pings || []).length === PINGS_PAGE_SIZE;
    // Advance the cursor to the raw oldest row of THIS fetch before filtering, so
    // paging continues from the true boundary even if every fetched row expired.
    const rawOldest = (pings || []).length
      ? (pings || [])[(pings || []).length - 1]
      : null;
    const older = (pings || [])
      .slice()
      .reverse() // oldest → newest
      .filter((ping) => !isExpired(ping, ttlSeconds));
    if (rawOldest) {
      oldestCursor = { ts: rawOldest.created_at, id: rawOldest.id };
    }
    if (!older.length) {
      renderLoadOlderControl(); // refresh/remove the button per hasMoreOlder
      return;
    }

    // Scroll anchoring: capture height/top before prepending, restore after, so
    // the messages the user was looking at stay put instead of jumping.
    const prevHeight = chatMain.scrollHeight;
    const prevTop = chatMain.scrollTop;

    // The button (if present) is board.firstChild; the anchor is the node right
    // after it — i.e. the current top-of-history element the older page slots in
    // front of. If the button isn't present, fall back to board.firstChild.
    const btn = document.getElementById("load-older");
    const anchor = btn ? btn.nextSibling : board.firstChild;

    // `anchor` is the first pre-existing chat node. It is a `.day-separator` iff
    // the existing top message began a day. Remember it so we can dedupe the
    // boundary after inserting (the inserted page may end on that same day).
    const preExistingLeadingSep =
      anchor && anchor.classList && anchor.classList.contains("day-separator")
        ? anchor
        : null;

    let prev = null;
    older.forEach((ping) => {
      renderDaySeparatorIfNeeded(ping, prev, anchor);
      renderPingBefore(ping, anchor);
      prev = ping;
    });

    // `prev` is now the last (newest) inserted message. If the pre-existing
    // leading separator is for the same day, it's a duplicate — remove it.
    if (
      preExistingLeadingSep &&
      prev &&
      preExistingLeadingSep.dataset.dayKey === dayKey(prev.created_at)
    ) {
      preExistingLeadingSep.remove();
    }

    renderLoadOlderControl(); // refresh/remove the button per hasMoreOlder
    chatMain.scrollTop = prevTop + (chatMain.scrollHeight - prevHeight);
  } finally {
    // Clear the guard only after all rendering completes, so the whole critical
    // section is covered even if an await is later added to the render tail.
    loadingOlder = false;
  }
}

function dismissPing(el, ping) {
  if (el._dismissed) return;
  el._dismissed = true;
  el.classList.add("fade-out");
  el.addEventListener(
    "animationend",
    async () => {
      if (el._objectUrl) {
        URL.revokeObjectURL(el._objectUrl);
        el._objectUrl = null;
      }
      // Remember the preceding node so we can clean up a day separator that this
      // delete leaves orphaned (a separator whose only message was this one).
      const prev = el.previousElementSibling;
      el.remove();
      // A leading separator is now orphaned if nothing follows it, or the next
      // sibling is another separator (its day's last message just went away).
      if (prev && prev.classList.contains("day-separator")) {
        const next = prev.nextElementSibling;
        if (!next || next.classList.contains("day-separator")) prev.remove();
      }
      await sb.rpc("dismiss_ping", { p_id: ping.id });
    },
    { once: true }
  );
}

function renderPing(ping, animate = true, beforeNode = null) {
  const isSelf = ping.sender_id === currentUser.id;
  const el = document.createElement("div");
  el.dataset.pingId = ping.id;

  if (ping.type === "text") {
    el.className = `item ${isSelf ? "self" : "other"}${animate && !isSelf ? " ping" : ""}`;
    el.innerHTML = `
      <div class="meta">${formatTime(ping.created_at)}<span class="ping-status" aria-hidden="true"></span></div>
      <div class="content">${renderContent(ping.content)}</div>
      <button class="dismiss-btn" aria-label="Ta bort"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
    `;
  } else if (ping.type === "file") {
    el.className = `item ${isSelf ? "self" : "other"} file-item${animate && !isSelf ? " ping" : ""}`;
    const dismissSvg = `<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
    if (isVideoFile(ping.file_name)) {
      el.innerHTML = `
        <div class="meta">${formatTime(ping.created_at)}<span class="ping-status" aria-hidden="true"></span></div>
        <video class="video-inline loading" controls playsinline preload="metadata" aria-label="${escapeHtml(ping.file_name)}"></video>
        <div class="video-meta">
          <span>${escapeHtml(ping.file_name)} <span class="file-size">${formatSize(ping.file_size)}</span></span>
          <a class="video-download-link" data-path="${escapeHtml(ping.file_path)}" data-name="${escapeHtml(ping.file_name)}" role="button" tabindex="0" aria-label="Ladda ner ${escapeHtml(ping.file_name)}"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg> ladda ner</a>
        </div>
        <button class="dismiss-btn" aria-label="Ta bort">${dismissSvg}</button>
      `;
    } else {
      const iconOrThumb = isImageFile(ping.file_name)
        ? `<img class="image-thumb loading" alt="${escapeHtml(ping.file_name)}" />`
        : `<span class="file-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" width="20" height="20" loading="lazy" /></span>`;
      el.innerHTML = `
        <div class="meta">${formatTime(ping.created_at)}<span class="ping-status" aria-hidden="true"></span></div>
        <div class="file-info">
          ${iconOrThumb}
          <span>${escapeHtml(ping.file_name)} <span class="file-size">${formatSize(ping.file_size)}</span></span>
          <button class="download-btn" data-path="${escapeHtml(ping.file_path)}" data-name="${escapeHtml(ping.file_name)}"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg> LADDA NER</button>
        </div>
        <button class="dismiss-btn" aria-label="Ta bort">${dismissSvg}</button>
      `;
    }
  }

  if (beforeNode) {
    board.insertBefore(el, beforeNode);
  } else {
    board.appendChild(el);
  }

  if (isSelf) renderPingStatus(el, ping);

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

  // Video pings: fetch the private file into a blob URL and play it inline.
  // Mirrors the image-thumb lifecycle (dismiss-mid-fetch guard, _objectUrl
  // stored for revocation on dismiss). On failure, degrade to a download row.
  const videoEl = el.querySelector(".video-inline");
  if (videoEl) {
    fetchObjectUrl(ping.file_path).then((url) => {
      // Bail if the ping was dismissed OR the element was detached (e.g. the
      // chat was reloaded / contact switched) while the fetch was in flight —
      // otherwise the blob URL leaks onto an element nothing will revoke.
      if (el._dismissed || !el.isConnected) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (!url) {
        // Fetch failed — degrade to the standard download row so the file is
        // still retrievable.
        const info = document.createElement("div");
        info.className = "file-info";
        info.innerHTML = `
          <span class="file-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" width="20" height="20" /></span>
          <span>${escapeHtml(ping.file_name)} <span class="file-size">${formatSize(ping.file_size)}</span></span>
          <button class="download-btn" data-path="${escapeHtml(ping.file_path)}" data-name="${escapeHtml(ping.file_name)}"><svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg> LADDA NER</button>
        `;
        const meta = el.querySelector(".video-meta");
        if (meta) meta.remove();
        videoEl.replaceWith(info);
        const dlFallback = info.querySelector(".download-btn");
        dlFallback.addEventListener("click", () => {
          downloadFile(dlFallback.dataset.path, dlFallback.dataset.name);
        });
        const fallbackIcon = info.querySelector(".file-type-icon");
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
      videoEl.src = url;
      videoEl.classList.remove("loading");
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
    dlBtn.addEventListener("click", () => {
      downloadFile(dlBtn.dataset.path, dlBtn.dataset.name);
    });
  }

  // Inline-video download link: saves the file but does NOT dismiss the ping
  // (the recipient may keep watching inline; dismissal is manual-X only).
  const videoDlLink = el.querySelector(".video-download-link");
  if (videoDlLink) {
    const triggerVideoDownload = () =>
      downloadFile(videoDlLink.dataset.path, videoDlLink.dataset.name);
    videoDlLink.addEventListener("click", triggerVideoDownload);
    videoDlLink.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        triggerVideoDownload();
      }
    });
  }

}

// Convenience: render a ping inserted before an existing node (used when
// prepending an older page). Never animates historical messages.
function renderPingBefore(ping, beforeNode) {
  renderPing(ping, false, beforeNode);
}

// Renders the sender-side status indicator on one of MY messages:
//   sent (no delivered_at)      → ✓
//   delivered (delivered_at)    → ✓✓
//   read (read_at)              → ✓✓ with a read style
// No-op for messages I received (only the sender sees receipts).
function renderPingStatus(el, ping) {
  if (ping.sender_id !== currentUser.id) return;
  const slot = el.querySelector(".ping-status");
  if (!slot) return;
  if (ping.read_at) {
    slot.textContent = "✓✓";
    slot.classList.add("read");
    slot.title = "Läst";
  } else if (ping.delivered_at) {
    slot.textContent = "✓✓";
    slot.classList.remove("read");
    slot.title = "Levererad";
  } else {
    slot.textContent = "✓";
    slot.classList.remove("read");
    slot.title = "Skickad";
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

  renderDaySeparatorIfNeeded(data, lastRenderedPing);
  renderPing(data);
  lastRenderedPing = data;
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

    renderDaySeparatorIfNeeded(data, lastRenderedPing);
    renderPing(data);
    lastRenderedPing = data;
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

// ============================================================
// FILE GALLERY — per-contact overlay of all exchanged files
// ============================================================
// Browse-and-download view. Unlike the chat stream, downloading here does NOT
// auto-dismiss the file. Blob URLs created for image thumbs are tracked on
// _galleryObjectUrls and revoked on close so none leak.

let _galleryLastFocus = null;
let _galleryObjectUrls = [];

// Loads this contact's file pings, newest-first. Mirrors loadPings' .or()
// filter plus an .eq("type","file"). RLS already restricts rows to pings the
// user is a party to and hasn't dismissed, so no extra guard is needed.
async function loadGalleryFiles() {
  const { recipientId } = selectedContact;
  const { data, error } = await sb
    .from("pings")
    .select("*")
    .eq("type", "file")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${recipientId}),` +
        `and(sender_id.eq.${recipientId},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load gallery files:", error);
    return [];
  }
  return data || [];
}

// Builds one grid cell. Image files get a lazily-fetched thumbnail (degrading
// to the file-type icon on failure); everything else gets the file-type icon.
// Clicking (or Enter/Space) downloads via downloadFile — no dismissal.
function renderGalleryItem(ping) {
  const cell = document.createElement("div");
  cell.className = "gallery-item";
  cell.setAttribute("role", "button");
  cell.setAttribute("tabindex", "0");
  cell.setAttribute("aria-label", "Ladda ner " + ping.file_name);

  const iconHtml = `<span class="gallery-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" /></span>`;
  const thumbHtml = isImageFile(ping.file_name)
    ? `<img class="gallery-thumb loading" alt="${escapeHtml(ping.file_name)}" />`
    : iconHtml;

  cell.innerHTML = `
    ${thumbHtml}
    <span class="gallery-name">${escapeHtml(ping.file_name)}</span>
    <span class="gallery-meta">${formatSize(ping.file_size)} &middot; ${formatDate(ping.created_at)}</span>
  `;

  // Missing file-type icon degrades to file.svg (CSP forbids inline onerror).
  const typeIcon = cell.querySelector(".file-type-icon");
  if (typeIcon) {
    typeIcon.addEventListener("error", () => {
      if (!typeIcon.src.endsWith("/file.svg")) {
        typeIcon.src = "/icons/filetypes/file.svg";
      }
    }, { once: true });
  }

  // Image thumbnail: fetch the private object and fill the <img>. Track the
  // blob URL for revocation on close; degrade to the icon on failure.
  const thumb = cell.querySelector(".gallery-thumb");
  if (thumb) {
    fetchObjectUrl(ping.file_path).then((url) => {
      // Cell was detached while the fetch was in flight (gallery closed, or
      // reopened — which clears the grid). Revoke and bail so a stale URL from
      // a previous open session never lands on a detached <img> or pushes into
      // the current session's array. Mirrors renderPing's isConnected guard.
      if (!thumb.isConnected) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (!url) {
        thumb.outerHTML = `<span class="gallery-icon"><img class="file-type-icon" src="${fileTypeIcon(ping.file_name)}" alt="" /></span>`;
        const fallbackIcon = cell.querySelector(".file-type-icon");
        if (fallbackIcon) {
          fallbackIcon.addEventListener("error", () => {
            if (!fallbackIcon.src.endsWith("/file.svg")) {
              fallbackIcon.src = "/icons/filetypes/file.svg";
            }
          }, { once: true });
        }
        return;
      }
      _galleryObjectUrls.push(url);
      thumb.src = url;
      thumb.classList.remove("loading");
    });
  }

  function activate() {
    downloadFile(ping.file_path, ping.file_name);
  }
  cell.addEventListener("click", activate);
  cell.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  });

  return cell;
}

async function openFileGallery() {
  if (!selectedContact) return;
  _galleryLastFocus = document.activeElement;
  galleryTitle.textContent = "~/filer med @" + selectedContact.username;
  galleryGrid.innerHTML = "";
  galleryModal.classList.remove("hidden");
  galleryClose.focus();

  const files = await loadGalleryFiles();
  // Guard against a close (or contact switch) during the await.
  if (galleryModal.classList.contains("hidden")) return;

  if (files.length === 0) {
    galleryGrid.innerHTML = `<div class="gallery-empty">Inga filer &auml;n</div>`;
    return;
  }
  files.forEach((ping) => galleryGrid.appendChild(renderGalleryItem(ping)));
}

function closeFileGallery() {
  galleryModal.classList.add("hidden");
  _galleryObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  _galleryObjectUrls = [];
  galleryGrid.innerHTML = "";
  if (_galleryLastFocus) _galleryLastFocus.focus();
}

function isGalleryOpen() {
  return !galleryModal.classList.contains("hidden");
}

galleryBtn.addEventListener("click", openFileGallery);
galleryClose.addEventListener("click", closeFileGallery);
galleryModal.addEventListener("click", (e) => {
  if (e.target === galleryModal) closeFileGallery();
});

// --- File input & drag-and-drop ---

// Attach (paperclip) is for non-media files: images and videos have their
// own composer buttons, so reject those here by MIME type and allow
// everything else (files with no detectable type count as "other").
// Drag-and-drop is intentionally left unrestricted.
fileInput.addEventListener("change", () => {
  const others = Array.from(fileInput.files).filter(
    (f) => !f.type.startsWith("image/") && !f.type.startsWith("video/")
  );
  if (others.length < fileInput.files.length) {
    alert("Bilder och videor laddas upp via kamera- och videoknapparna.");
  }
  if (others.length) uploadFiles(others);
  fileInput.value = "";
});

// Attach (paperclip) reuses the existing multi-file picker.
attachBtn.addEventListener("click", () => fileInput.click());

// Image file picker (image-only) reuses the existing upload pipeline.
// accept="image/*" is only a picker hint, so enforce image-only here by
// MIME type: non-image selections (e.g. via "All files") are rejected.
imageInput.addEventListener("change", () => {
  const images = Array.from(imageInput.files).filter((f) =>
    f.type.startsWith("image/")
  );
  if (images.length < imageInput.files.length) {
    alert("Bara bildfiler kan laddas upp här.");
  }
  if (images.length) uploadFiles(images);
  imageInput.value = "";
});

// Video file picker reuses the existing upload pipeline.
// accept="video/*" is only a picker hint, so enforce video-only here by
// MIME type: non-video selections (e.g. via "All files") are rejected.
videoInput.addEventListener("change", () => {
  const videos = Array.from(videoInput.files).filter((f) =>
    f.type.startsWith("video/")
  );
  if (videos.length < videoInput.files.length) {
    alert("Bara videofiler kan laddas upp här.");
  }
  if (videos.length) uploadFiles(videos);
  videoInput.value = "";
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

        // Record delivery regardless of which chat is open. pings has no UPDATE
        // RLS policy, so we cannot write delivered_at with a direct client
        // update — it goes through the mark_delivered security-definer RPC,
        // which stamps now() only when the caller is the receiver and
        // delivered_at is still null. Fire-and-forget: nothing here consumes the
        // result, so we must NOT block rendering the arriving message on the RPC
        // round-trip. delivered_at is never blocked on the chat being open
        // (read_at is the open-and-focused signal).
        if (ping.delivered_at == null) {
          sb.rpc("mark_delivered", { p_id: ping.id }).then(({ error }) => {
            if (error) console.error("mark_delivered failed:", error);
          });
        }

        const chatOpen = selectedContact && ping.sender_id === selectedContact.recipientId;

        if (chatOpen) {
          // Dedup guard: the realtime channel lives for the whole session while
          // loadPings runs per chat-open, so a row committing in the window
          // around loadPings' SELECT can be both in the page AND delivered here.
          // Without auto-dismiss to mask it, that duplicate would persist until
          // reload — skip if this id is already on the board.
          if (!board.querySelector(`[data-ping-id="${ping.id}"]`)) {
            renderDaySeparatorIfNeeded(ping, lastRenderedPing);
            renderPing(ping);
            lastRenderedPing = ping;
            scrollToBottom();
          }
          // Chat is open; if the tab is focused, mark it read immediately.
          markChatRead();
        } else {
          // Chat not open: it's a durable unread. No timed decrement — the
          // badge persists until the chat is opened (mark_read) or the message
          // is deleted.
          unreadCounts[ping.sender_id] = (unreadCounts[ping.sender_id] || 0) + 1;
          renderContacts();
        }

        playPing();
      }
    )
    .on(
      "postgres_changes",
      {
        // Sender-side read/delivery receipts: when a message WE sent gets its
        // delivered_at / read_at stamped by the receiver, reflect it live. We
        // filter on sender_id = me so we only react to our own outgoing rows.
        event: "UPDATE",
        schema: "public",
        table: "pings",
        filter: `sender_id=eq.${currentUser.id}`,
      },
      (payload) => {
        const ping = payload.new;
        // Only relevant if this message is in the currently open chat.
        const inOpenChat =
          selectedContact && ping.receiver_id === selectedContact.recipientId;
        if (!inOpenChat) return;
        const el = board.querySelector(`[data-ping-id="${ping.id}"]`);
        if (el) renderPingStatus(el, ping);
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

// Emoji shortcode token: :e:<folder>/<id>: — inserted by the emoji picker and
// stored verbatim in ping.content. folder is a lowercase english slug; id is a
// lowercase slug that may contain Swedish å ä ö. Verified against the data: no
// id contains ':' '/' uppercase or space, so this is unambiguous.
const EMOJI_TOKEN_RE = /:e:([a-z-]+)\/([a-zåäö-]+):/g;
const URL_RE = /(https?:\/\/[^\s]+)/g;

// Render raw (unescaped) message content to safe HTML, handling BOTH emoji
// tokens and URLs in a single left-to-right pass so text is escaped exactly
// once. Replaces linkify() on the text-ping render path. Anything that isn't a
// recognized token or URL is escaped as plain text — a malformed token is left
// as literal text and never injected as HTML. The <img> src is built from the
// token payload alone, so a ping renders even before the emoji data is loaded;
// alt/label is taken from the loaded data when available, else the id.
function renderContent(text) {
  // Build one combined matcher by scanning for both patterns and taking the
  // earliest match at each position.
  let out = "";
  let pos = 0;
  while (pos < text.length) {
    EMOJI_TOKEN_RE.lastIndex = pos;
    URL_RE.lastIndex = pos;
    const em = EMOJI_TOKEN_RE.exec(text);
    const url = URL_RE.exec(text);
    // Pick whichever matches first (lowest index). null if none from here.
    let next = null;
    let kind = null;
    if (em && (!url || em.index <= url.index)) { next = em; kind = "emoji"; }
    else if (url) { next = url; kind = "url"; }

    if (!next) {
      out += escapeHtml(text.slice(pos));
      break;
    }
    out += escapeHtml(text.slice(pos, next.index));
    if (kind === "emoji") {
      const folder = next[1];
      const id = next[2];
      const label = emojiLabel(folder, id);
      const src = `/icons/emojis/${folder}/${encodeURI(id)}.svg`;
      out += `<img class="emoji-inline" src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy">`;
    } else {
      const url2 = escapeHtml(next[0]);
      out += `<a href="${url2}" target="_blank" rel="noopener">${url2}</a>`;
    }
    pos = next.index + next[0].length;
  }
  return out;
}

// Look up an emoji's Swedish label from the cached picker data; falls back to
// the id when the data isn't loaded yet or the emoji isn't found.
function emojiLabel(folder, id) {
  if (emojiIndex) {
    const entry = emojiIndex.get(`${folder}/${id}`);
    if (entry) return entry.label;
  }
  return id;
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

const VIDEO_EXTS = new Set(["webm", "mp4", "mov", "m4v", "ogv"]);

function isVideoFile(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return VIDEO_EXTS.has(ext);
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

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("sv-SE", { day: "2-digit", month: "2-digit" });
}

// Day-separator label for the conversation log: "Idag" / "Igår" / otherwise a
// localized day. Reuses the sv-SE locale conventions of formatDate/formatTime.
function formatDaySeparator(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dayMs = 86400000;
  const diffDays = Math.round((startOf(today) - startOf(d)) / dayMs);
  if (diffDays === 0) return "Idag";
  if (diffDays === 1) return "Igår";
  // Within the current year: "8 juni"; older: include the year.
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Stable yyyy-mm-dd key for comparing two timestamps' calendar day (local).
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Builds a day-separator element for a given timestamp.
function makeDaySeparator(ts) {
  const sep = document.createElement("div");
  sep.className = "day-separator";
  sep.dataset.dayKey = dayKey(ts);
  sep.textContent = formatDaySeparator(ts);
  return sep;
}

// Inserts a day separator before `ping` when its calendar day differs from the
// previous rendered message's day (or when prev is null — first message of the
// page). When beforeNode is given, insert before it (prepend path); otherwise
// append to the board (initial-load path).
function renderDaySeparatorIfNeeded(ping, prev, beforeNode = null) {
  if (prev && dayKey(prev.created_at) === dayKey(ping.created_at)) return;
  const sep = makeDaySeparator(ping.created_at);
  if (beforeNode) {
    board.insertBefore(sep, beforeNode);
  } else {
    board.appendChild(sep);
  }
}

// Parses a Postgres interval string into seconds. Handles two shapes: the
// PostgREST-normalized serialization that comes back from the DB ("HH:MM:SS",
// "N days", "N day(s) HH:MM:SS") AND the literal interval strings the client
// sends to set_disappearing before a reload normalizes them (e.g. the "24h"
// menu option's "24 hours", and "N minutes"). This dual handling matters for
// optimistic UI: after picking 24h we reflect the label from the raw "24 hours"
// string, not the normalized "24:00:00" we only see on the next chat open.
// Deliberately does NOT handle month/year units or fractional seconds; those
// can't occur via the offered values, and an unparseable string falls through
// to null (timer off) rather than erroring. Null/empty → null (timer off).
function parseTtlSeconds(ttl) {
  if (!ttl) return null;
  let seconds = 0;
  const dayMatch = /(\d+)\s+days?/.exec(ttl);
  if (dayMatch) seconds += parseInt(dayMatch[1], 10) * 86400;
  const hourMatch = /(\d+)\s+hours?/.exec(ttl);
  if (hourMatch) seconds += parseInt(hourMatch[1], 10) * 3600;
  const minMatch = /(\d+)\s+min(?:ute)?s?/.exec(ttl);
  if (minMatch) seconds += parseInt(minMatch[1], 10) * 60;
  const timeMatch = /(\d{1,2}):(\d{2}):(\d{2})/.exec(ttl);
  if (timeMatch) {
    seconds +=
      parseInt(timeMatch[1], 10) * 3600 +
      parseInt(timeMatch[2], 10) * 60 +
      parseInt(timeMatch[3], 10);
  }
  return seconds > 0 ? seconds : null;
}

// True if a ping is older than the pair's disappearing TTL (in seconds). A null
// ttlSeconds (timer off) means nothing expires. Compares against created_at.
function isExpired(ping, ttlSeconds) {
  if (!ttlSeconds) return false;
  const ageSeconds = (Date.now() - new Date(ping.created_at).getTime()) / 1000;
  return ageSeconds > ttlSeconds;
}

// Short label for the header control given a Postgres interval (or null = off).
// Buckets to the offered values; falls back to a compact form for odd values.
function ttlToLabel(ttl) {
  const seconds = parseTtlSeconds(ttl);
  if (!seconds) return "av";
  if (seconds === 86400) return "24h";
  if (seconds === 604800) return "7d";
  // Non-standard value (set via SQL): show whole days if clean, else hours.
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  return `${Math.round(seconds / 3600)}h`;
}

// Renders the header control's label + active state from the open chat's ttl.
// Also folds the current state into the button's aria-label so screen-reader
// users hear it (the visible label span is otherwise masked by aria-label).
// No-op when no chat is open or the control isn't in the DOM.
function refreshDisappearingControl() {
  if (!disappearingBtn || !disappearingLabel || !selectedContact) return;
  const ttl = selectedContact.disappearingTtl;
  const label = ttlToLabel(ttl);
  disappearingLabel.textContent = label;
  disappearingBtn.classList.toggle("active", !!parseTtlSeconds(ttl));
  disappearingBtn.setAttribute(
    "aria-label",
    `Försvinnande meddelanden: ${label}`
  );
}

// Sets (or clears) the open pair's disappearing timer via the security-definer
// RPC, then reflects the new state locally: updates selectedContact, the header
// label, and drops an in-thread confirmation line. p_ttl is a Postgres interval
// string or null (off). No-op if no chat is open.
async function setDisappearing(ttl) {
  if (!selectedContact) return;
  // Capture the target pair before the await: if the user switches chats while
  // the RPC is in flight, we must not write the new ttl onto a different pair or
  // drop a confirmation line into the wrong thread.
  const target = selectedContact;
  const p_ttl = ttl || null; // "" (the "Av" option) → null
  const { error } = await sb.rpc("set_disappearing", {
    p_contact_id: target.contactId,
    p_ttl,
  });
  if (error) {
    console.error("set_disappearing failed:", error);
    systemLine("Kunde inte ändra försvinnande meddelanden.");
    return;
  }
  // Keep the loaded contacts array in sync so a later re-open reads the new ttl,
  // even if the user has since navigated away from this pair.
  const row = contacts.find((c) => c.id === target.contactId);
  if (row) row.disappearing_ttl = p_ttl;
  target.disappearingTtl = p_ttl;
  // The visible control + confirmation only make sense if this pair is still
  // open; if the user switched chats mid-flight, the DB + contacts row are
  // already updated and the new chat will reflect it on its own.
  if (selectedContact !== target) return;
  refreshDisappearingControl();
  const label = ttlToLabel(p_ttl);
  systemLine(
    p_ttl
      ? `Försvinnande meddelanden: ${label}`
      : "Försvinnande meddelanden: av"
  );
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

// --- Composer popup menus (shared) ---
// Builds a button-anchored popup menu: click toggles it, outside-click and
// Escape close it, and aria-expanded stays in sync. Returns { open, close }
// so menu items can close it before acting.
function createPopupMenu(button, menu) {
  function open() {
    menu.classList.remove("hidden");
    button.setAttribute("aria-expanded", "true");
  }
  function close() {
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
  }
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.classList.contains("hidden")) open();
    else close();
  });
  document.addEventListener("click", (e) => {
    if (menu.classList.contains("hidden")) return;
    if (!menu.contains(e.target) && e.target !== button) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.classList.contains("hidden")) close();
  });
  close(); // ensure menu is hidden and aria-expanded initialised, regardless of HTML
  return { open, close };
}

// --- Video button popup menu ---
const canRecordVideo = !!(
  navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === "function" &&
  window.MediaRecorder
);
if (!canRecordVideo) videoRecordBtn.classList.add("hidden");

const videoMenuCtl = createPopupMenu(videoBtn, videoMenu);

videoPickBtn.addEventListener("click", () => {
  videoMenuCtl.close();
  videoInput.click();
});

// --- Camera button popup menu ---
const canCaptureImage = !!(
  navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === "function"
);
if (!canCaptureImage) imageCaptureBtn.classList.add("hidden");

const cameraMenuCtl = createPopupMenu(cameraBtn, cameraMenu);

imageUploadBtn.addEventListener("click", () => {
  cameraMenuCtl.close();
  imageInput.click();
});

// imageCaptureBtn opens the capture modal — wired in the capture-modal block (later task).

// --- Disappearing-messages header control popup ---
if (disappearingBtn && disappearingMenu) {
  const disappearingMenuCtl = createPopupMenu(disappearingBtn, disappearingMenu);
  disappearingMenu.querySelectorAll("button[data-ttl]").forEach((item) => {
    item.addEventListener("click", () => {
      disappearingMenuCtl.close();
      setDisappearing(item.dataset.ttl);
    });
  });
}

// ============================================================
// EMOJI PICKER
// ============================================================

let emojiData = null;        // parsed emoji-data.json { categories: [...] }
let emojiSelectedCat = null; // currently shown category id (when not searching)
let emojiLoaded = false;     // data successfully loaded & UI built once
// emojiIndex (Map "folder/id" -> item) is declared near the top-of-file state.

// Fetch + cache the emoji data on first open. Returns true on success. Builds
// the folder/id index (used by renderContent's emojiLabel) and the category
// row. Shows an inline error and returns false on failure.
async function loadEmojiData() {
  if (emojiLoaded) return true;
  emojiSetStatus("Laddar…");
  try {
    const res = await fetch("/data/emoji-data.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.categories)) {
      throw new Error("malformed emoji data: missing categories");
    }
    // Build the "folder/id" -> item index into a local, so a malformed payload
    // can't leave a half-built emojiIndex behind. folder is item.file's first
    // segment. Assign the module state only once everything succeeds.
    const idx = new Map();
    for (const cat of data.categories) {
      for (const item of cat.items || []) {
        const folder = item.file.split("/")[0];
        idx.set(`${folder}/${item.id}`, item);
      }
    }
    emojiData = data;
    emojiIndex = idx;
  } catch (err) {
    console.error("Failed to load emoji data:", err);
    emojiSetStatus("Kunde inte ladda emojis.");
    return false;
  }
  emojiBuildCatRow();
  emojiLoaded = true;
  emojiClearStatus();
  return true;
}

// Show / hide the inline status line (loading / error / empty-search).
function emojiSetStatus(msg) {
  emojiStatus.textContent = msg;
  emojiStatus.classList.remove("hidden");
}
function emojiClearStatus() {
  emojiStatus.textContent = "";
  emojiStatus.classList.add("hidden");
}

// Build the 7 category icon buttons from the data (order = data order).
function emojiBuildCatRow() {
  emojiCatRow.innerHTML = "";
  emojiData.categories.forEach((cat, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-cat-btn" + (i === 0 ? " sel" : "");
    btn.title = cat.label;
    btn.setAttribute("aria-label", cat.label);
    btn.dataset.catId = cat.id;
    const img = document.createElement("img");
    img.src = `/icons/emojis/${encodeURI(cat.icon)}`;
    img.alt = cat.label;
    btn.appendChild(img);
    emojiCatRow.appendChild(btn);
  });
}

// Render a list of emoji items into the grid as clickable cells.
function emojiRenderGrid(items) {
  emojiGrid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "emoji-grid-cell";
    cell.title = item.label;
    cell.setAttribute("aria-label", item.label);
    // folder/id token payload, stored on the element for the click handler.
    const folder = item.file.split("/")[0];
    cell.dataset.token = `${folder}/${item.id}`;
    const img = document.createElement("img");
    img.src = `/icons/emojis/${encodeURI(item.file)}`;
    img.alt = item.label;
    img.loading = "lazy";
    cell.appendChild(img);
    frag.appendChild(cell);
  }
  emojiGrid.appendChild(frag);
}

// Show one category's emojis and mark its icon selected.
function emojiShowCategory(catId) {
  const cat = emojiData.categories.find((c) => c.id === catId);
  if (!cat) return;
  emojiSelectedCat = catId;
  emojiCatLabel.textContent = cat.label;
  emojiRenderGrid(cat.items);
  emojiClearStatus();
  for (const btn of emojiCatRow.querySelectorAll(".emoji-cat-btn")) {
    btn.classList.toggle("sel", btn.dataset.catId === catId);
  }
}

// Normalize for diacritic-tolerant, case-insensitive matching: lowercase and
// strip combining marks so "glad"/"GLÄD" etc. compare on their base letters.
// (Swedish å ä ö decompose to a/a/o here, which is what we want for search.)
function emojiNormalize(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Filter all emoji across categories whose label or any tag contains the query.
function emojiSearchItems(query) {
  const q = emojiNormalize(query.trim());
  if (!q) return null; // signal: not searching
  const results = [];
  for (const cat of emojiData.categories) {
    for (const item of cat.items) {
      const hay = [item.label, ...(item.tags || [])].map(emojiNormalize);
      if (hay.some((h) => h.includes(q))) results.push(item);
    }
  }
  return results;
}

// Insert text at the textarea caret (replacing any selection), place the caret
// after it, refocus, and trigger the existing auto-grow / hint listeners via a
// synthetic input event.
function insertAtCaret(textarea, str) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + str + after;
  const caret = start + str.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  // Notify existing 'input' listeners (autoGrowInput, renderCommandHints).
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function emojiOpen() {
  emojiPicker.classList.remove("hidden");
  emojiBtn.setAttribute("aria-expanded", "true");
}
function emojiClose() {
  emojiPicker.classList.add("hidden");
  emojiBtn.setAttribute("aria-expanded", "false");
}
function emojiIsOpen() {
  return !emojiPicker.classList.contains("hidden");
}

// Toggle on button click. On open, load data if needed, then show the selected
// (or first) category and focus the search box.
emojiBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (emojiIsOpen()) {
    emojiClose();
    return;
  }
  emojiOpen();
  const ok = await loadEmojiData();
  if (!ok) return; // status line already shows the error; keep panel open
  emojiSearch.value = "";
  emojiShowCategory(emojiSelectedCat || emojiData.categories[0].id);
  emojiSearch.focus();
});

// Category icon click → show that category (event-delegated). Refocus the
// search box so focus stays in the picker (keeps bare-key shortcuts suppressed
// and lets the user keep typing to search).
emojiCatRow.addEventListener("click", (e) => {
  const btn = e.target.closest(".emoji-cat-btn");
  if (!btn) return;
  emojiSearch.value = "";
  emojiShowCategory(btn.dataset.catId);
  emojiSearch.focus();
});

// Emoji click → insert token at the caret; keep the popover open.
emojiGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".emoji-grid-cell");
  if (!cell) return;
  insertAtCaret(textInput, `:e:${cell.dataset.token}:`);
});

// Live search: filter across all categories by label + tags. Empty query
// returns to the selected category. Clears the category-row highlight while
// searching (no single category is "selected").
emojiSearch.addEventListener("input", () => {
  const results = emojiSearchItems(emojiSearch.value);
  if (results === null) {
    emojiShowCategory(emojiSelectedCat || emojiData.categories[0].id);
    return;
  }
  for (const btn of emojiCatRow.querySelectorAll(".emoji-cat-btn")) {
    btn.classList.remove("sel");
  }
  emojiCatLabel.textContent = "Sökresultat";
  if (results.length === 0) {
    emojiGrid.innerHTML = "";
    emojiSetStatus("Inga emojis hittades.");
  } else {
    emojiClearStatus();
    emojiRenderGrid(results);
  }
});

// Outside-click closes (mirrors createPopupMenu). The button's own handler
// manages toggling, so ignore clicks on it here.
document.addEventListener("click", (e) => {
  if (!emojiIsOpen()) return;
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
    emojiClose();
  }
});

// Escape closes (matches camera/video). Works whether focus is in the search
// box or elsewhere in the panel.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && emojiIsOpen()) {
    emojiClose();
    emojiBtn.focus();
  }
});

emojiClose(); // ensure hidden + aria initialised regardless of HTML

// --- Photo capture modal ---
let captureStream = null;   // active MediaStream (video only)
let captureCanvas = null;   // offscreen canvas holding the snapped frame

function captureSetButtons({ snap, send, retake }) {
  captureSnap.classList.toggle("hidden", !snap);
  captureSend.classList.toggle("hidden", !send);
  captureRetake.classList.toggle("hidden", !retake);
}

function captureStopStream() {
  if (captureStream) {
    captureStream.getTracks().forEach((t) => t.stop());
    captureStream = null;
  }
}

// Full teardown used by every exit path.
function closeCaptureModal() {
  captureStopStream();
  captureCanvas = null;
  captureVideo.srcObject = null;
  captureStill.removeAttribute("src");
  captureStill.classList.add("hidden");
  captureSend.disabled = false;
  captureVideo.classList.remove("hidden");
  captureError.classList.add("hidden");
  captureError.textContent = "";
  captureStatus.textContent = "";
  // Reset to the idle button state so a reopen doesn't briefly show the
  // post-snap buttons (Skicka/Ta om) before getUserMedia resolves.
  captureSetButtons({ snap: true, send: false, retake: false });
  captureModal.classList.add("hidden");
}

// Acquire the camera and show the live preview.
async function startCapturePreview() {
  // Stop any stream still running (e.g. on "Ta om") before acquiring a new one,
  // so the old camera tracks aren't orphaned with the light on.
  captureStopStream();
  captureVideo.srcObject = null;
  captureError.classList.add("hidden");
  captureStill.classList.add("hidden");
  captureStill.removeAttribute("src");
  captureVideo.classList.remove("hidden");
  try {
    captureStream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    console.error("getUserMedia failed:", err);
    captureError.textContent = "Kunde inte komma åt kameran.";
    captureError.classList.remove("hidden");
    captureStatus.textContent = "";
    captureSetButtons({ snap: false, send: false, retake: false });
    return;
  }
  captureVideo.srcObject = captureStream;
  captureVideo.play().catch(() => {});
  captureStatus.textContent = "Redo att ta en bild";
  captureSetButtons({ snap: true, send: false, retake: false });
}

async function openCaptureModal() {
  captureModal.classList.remove("hidden");
  await startCapturePreview();
}

function snapPhoto() {
  if (!captureStream) return;
  const w = captureVideo.videoWidth;
  const h = captureVideo.videoHeight;
  if (!w || !h) return; // video not ready yet — keep showing preview
  captureCanvas = document.createElement("canvas");
  captureCanvas.width = w;
  captureCanvas.height = h;
  captureCanvas.getContext("2d").drawImage(captureVideo, 0, 0, w, h);
  captureStill.src = captureCanvas.toDataURL("image/png");
  captureStill.classList.remove("hidden");
  captureVideo.classList.add("hidden");
  captureStatus.textContent = "Förhandsgranskning";
  captureSetButtons({ snap: false, send: true, retake: true });
}

function captureTimestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    "image-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".png"
  );
}

function sendPhoto() {
  if (!captureCanvas) return;
  captureSend.disabled = true; // prevent a double-send queuing two toBlob callbacks
  const name = captureTimestampName();
  captureCanvas.toBlob(async (blob) => {
    if (!blob) {
      captureSend.disabled = false;
      return;
    }
    const file = new File([blob], name, { type: "image/png" });
    closeCaptureModal(); // tear down camera before the upload round-trip
    await uploadFiles([file]);
  }, "image/png");
}

// Wiring
imageCaptureBtn.addEventListener("click", () => {
  cameraMenuCtl.close();
  openCaptureModal();
});
captureSnap.addEventListener("click", snapPhoto);
captureSend.addEventListener("click", sendPhoto);
captureRetake.addEventListener("click", () => {
  captureCanvas = null;
  startCapturePreview();
});
captureCancel.addEventListener("click", closeCaptureModal);
captureClose.addEventListener("click", closeCaptureModal);
captureModal.addEventListener("click", (e) => {
  if (e.target === captureModal) closeCaptureModal();
});
// Escape-to-close is handled by the keyboard overlay registry (initKeyboard).

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
  // Stop any stream still running (e.g. on "Spela in igen") before acquiring a
  // new one, so the old camera/mic tracks aren't orphaned with the light on.
  recordStopStream();
  recordVideo.srcObject = null;
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
  videoMenuCtl.close();
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
// Escape-to-close and bare-key-shortcut suppression are handled by the keyboard
// overlay registry (see initKeyboard below), like the other modals.

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

// A received message counts as read when its chat is open AND the tab is
// focused. Selecting a contact handles the open case; this handles the
// "chat already open, user tabs back in" case.
window.addEventListener("focus", () => {
  markChatRead();
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
  isRecordOpen: () => !recordModal.classList.contains("hidden"),
  closeRecord: closeRecordModal,
  isCaptureOpen: () => !captureModal.classList.contains("hidden"),
  closeCapture: closeCaptureModal,
  isLightboxOpen: () => !lightbox.classList.contains("hidden"),
  closeLightbox,
  isInviteOpen: () => !inviteModal.classList.contains("hidden"),
  closeInvite,
  isSettingsOpen: () => !settingsModal.classList.contains("hidden"),
  closeSettings,
  isGalleryOpen,
  closeFileGallery,
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
