import { state, remote } from "./js/state.js";
import { $, fillSelect, showToast } from "./js/utils.js";
import {
  authenticated,
  closeAuthModal,
  handleAuth,
  initAuth,
  loadSupabaseConfig,
  openAuthModal,
  remoteReady,
  updateAuthUI
} from "./js/auth.js";
import { loadCloudinaryConfig } from "./js/cloudinary.js";
import {
  ensureTripsFromProducts,
  loadProducts,
  loadTripsFromJson,
  refreshRemoteProducts,
  subscribeToRemoteChanges
} from "./js/data.js";
import {
  closeDrawer,
  handleSubmit,
  initFilters,
  openDrawer,
  readImage,
  removeItem,
  render,
  resetFilters,
  updateTotalPreview
} from "./js/products.js";
import {
  addTripDetail,
  closeTripPage,
  editTrip,
  handleTripSubmit,
  newTripEditor,
  openTripPage,
  removeTripDetail,
  renderTripPage,
  updateTripDetailField
} from "./js/trips.js";
import { demoNear, enableReminder } from "./js/reminders.js";

function bindEvents() {
  $("tripFilter").addEventListener("change", (event) => {
    state.trip = event.target.value;
    state.region = "all";
    fillSelect($("regionFilter"), uniqueRegions(), "全部地區");
    render();
  });

  $("regionFilter").addEventListener("change", (event) => {
    state.region = event.target.value;
    render();
  });

  $("search").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  $("cards").addEventListener("click", (event) => {
    const action = event.target.closest("[data-product-action]");
    if (!action) return;
    const id = action.dataset.productId;
    if (action.dataset.productAction === "edit") openDrawer(id);
    if (action.dataset.productAction === "delete") removeItem(id);
    if (action.dataset.productAction === "map") showToast("尚未設定 Google Maps 連結", "warn");
    if (action.dataset.productAction === "reset") resetFilters();
  });

  $("resetFilters").addEventListener("click", resetFilters);
  $("addItem").addEventListener("click", () => openDrawer());
  $("tripManager").addEventListener("click", openTripPage);
  $("backToProducts").addEventListener("click", closeTripPage);
  $("newTrip").addEventListener("click", newTripEditor);

  $("tripList").addEventListener("click", (event) => {
    const action = event.target.closest("[data-trip-action]");
    if (action?.dataset.tripAction === "edit") editTrip(action.dataset.tripId);
  });
  $("addTripDetail").addEventListener("click", addTripDetail);
  $("tripDetailsRows").addEventListener("input", updateTripDetailField);
  $("tripDetailsRows").addEventListener("change", updateTripDetailField);
  $("tripDetailsRows").addEventListener("click", removeTripDetail);
  $("tripForm").addEventListener("submit", handleTripSubmit);

  $("trip").addEventListener("change", (event) => {
    const trip = state.trips.find((item) => item.id === event.target.value);
    if (trip && !$("region").value.trim()) $("region").value = trip.primaryLocation || "";
  });

  $("authButton").addEventListener("click", async () => {
    if (!remoteReady()) return;
    if (authenticated()) {
      const { error } = await remote.client.auth.signOut();
      if (error) showToast(error.message || "登出失敗", "warn");
      else showToast("已登出共享帳號");
    } else {
      openAuthModal();
    }
  });
  $("closeAuthModal").addEventListener("click", closeAuthModal);
  $("authForm").addEventListener("submit", (event) => {
    event.preventDefault();
    handleAuth(event.submitter?.dataset.authAction || "signin");
  });

  $("closeDrawer").addEventListener("click", closeDrawer);
  $("cancelDrawer").addEventListener("click", closeDrawer);
  $("overlay").addEventListener("click", closeDrawer);
  $("qty").addEventListener("input", updateTotalPreview);
  $("unitPrice").addEventListener("input", updateTotalPreview);
  $("currency").addEventListener("change", updateTotalPreview);
  $("imageFile").addEventListener("change", (event) => readImage(event.target.files[0]));
  $("deleteFromDrawer").addEventListener("click", () => state.editingId && removeItem(state.editingId));
  $("demoNear").addEventListener("click", demoNear);
  $("reminderToggle").addEventListener("change", (event) => {
    if (event.target.checked) {
      enableReminder();
    } else {
      $("permissionText").textContent = "提醒功能目前關閉。";
      $("permissionText").className = "permission";
    }
  });
  $("itemForm").addEventListener("submit", handleSubmit);
}

function uniqueRegions() {
  return Array.from(new Set(state.products.map((product) => product.region).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

async function handleSessionChange({ session }) {
  if (session && !state.editingId) {
    await refreshRemoteProducts("", () => {
      initFilters();
      render();
    });
  }
  render();
}

async function boot() {
  bindEvents();
  try {
    await Promise.all([loadCloudinaryConfig(), loadSupabaseConfig()]);
    await initAuth({ onSessionChange: handleSessionChange });
    updateAuthUI();
    state.products = await loadProducts();
    if (!remote.tripDataLoaded) await loadTripsFromJson();
    ensureTripsFromProducts(state.products);
    initFilters();
    render();
    renderTripPage();
    subscribeToRemoteChanges(() => {
      if (!state.editingId && !state.editingTripId) {
        refreshRemoteProducts("旅伴已更新共享資料", () => {
          initFilters();
          render();
        });
      }
    });
  } catch (error) {
    console.error(error);
    $("resultText").textContent = "資料載入失敗";
    $("cards").innerHTML = '<div class="empty">無法讀取商品資料。請確認 Supabase 連線或使用 localhost／HTTPS 開啟網站。</div>';
    showToast("商品資料載入失敗，請確認 Supabase 設定", "warn");
  }
}

boot();
