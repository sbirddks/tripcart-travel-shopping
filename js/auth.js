import { state, remote } from "./state.js";
import { $, showToast } from "./utils.js";

export async function loadSupabaseConfig() {
  try {
    const response = await fetch("data/supabase.json");
    if (!response.ok || !window.supabase || typeof window.supabase.createClient !== "function") return;
    const config = await response.json();
    if (config.enabled && config.url && config.publishableKey) {
      remote.config = config;
      remote.client = window.supabase.createClient(config.url, config.publishableKey);
    }
  } catch (error) {
    remote.config = {};
    remote.client = null;
  }
}

export function remoteReady() {
  return Boolean(remote.client);
}

export function authenticated() {
  return Boolean(state.session);
}

async function syncTripcartUser(session = state.session, touchLogin = false) {
  if (!remoteReady() || !session?.user) {
    state.profile = null;
    return;
  }
  const user = session.user;
  const payload = {
    id: user.id,
    email: user.email || "",
    display_name: state.profile?.display_name || user.user_metadata?.display_name || ""
  };
  if (touchLogin) payload.last_login_at = new Date().toISOString();
  const { data, error } = await remote.client
    .from("tripcart_users")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) {
    console.warn("TripCart user profile sync failed", error);
    return;
  }
  state.profile = data;
  updateAuthUI();
}

export async function initAuth({ onSessionChange = () => {} } = {}) {
  if (!remoteReady()) return;
  const { data, error } = await remote.client.auth.getSession();
  if (error) throw error;
  state.session = data.session;
  if (state.session) await syncTripcartUser(state.session);
  remote.client.auth.onAuthStateChange((event, session) => {
    state.session = session;
    state.profile = session ? state.profile : null;
    updateAuthUI();
    onSessionChange({ event, session });
    if (session) {
      window.setTimeout(() => syncTripcartUser(session, event === "SIGNED_IN"), 0);
    }
  });
}

export function updateAuthUI() {
  const status = $("authStatus");
  const button = $("authButton");
  if (!status || !button) return;
  if (!remoteReady()) {
    status.textContent = "本地資料模式";
    button.style.display = "none";
    return;
  }
  button.style.display = "inline-block";
  if (authenticated()) {
    status.textContent = "已登入：" + (state.profile?.display_name || state.session.user.email || "旅伴");
    button.textContent = "登出";
  } else {
    status.textContent = "訪客模式 · 登入後可編輯";
    button.textContent = "登入／註冊";
  }
}

export function openAuthModal() {
  $("authModal").classList.add("show");
  $("authEmail").focus();
}

export function closeAuthModal() {
  $("authModal").classList.remove("show");
}

export async function handleAuth(action) {
  if (!remoteReady()) return;
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const displayName = $("authDisplayName").value.trim();
  try {
    const result = action === "signup"
      ? await remote.client.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } }
        })
      : await remote.client.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    closeAuthModal();
    if (action === "signup" && result.data.session) {
      showToast("註冊成功，已直接登入 TripCart。", "good");
    } else if (action === "signup") {
      showToast("帳號已建立，請重新登入。", "good");
    } else {
      showToast("登入成功，已啟用共享編輯。", "good");
    }
  } catch (error) {
    const code = error?.code || error?.name;
    const message = code === "email_not_confirmed"
      ? "此帳號目前無法登入，請確認 Email 與密碼；若是舊帳號，請重新註冊。"
      : code === "invalid_credentials"
        ? "登入資訊不正確。請確認 Email 與密碼；第一次使用請先按「註冊」。"
        : code === "signup_disabled"
          ? "目前專案暫停註冊，請在 Supabase Auth 開啟 Allow new users to sign up。"
          : error.message || "登入失敗，請確認帳號資料。";
    showToast(message, "warn");
  }
}

export function requireAuthentication() {
  if (!remoteReady() || authenticated()) return true;
  showToast("請先登入，才能新增、編輯或刪除共享資料。", "warn");
  openAuthModal();
  return false;
}
