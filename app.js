const state = {
  products: [],
  trip: "all",
  region: "all",
  search: "",
  editingId: null,
  editingLocationId: "",
  imageData: "",
  imageFile: null,
  session: null,
  profile: null
};
const cloudinary = { config: {} };
const remote = { config: {}, client: null, channel: null };
const $ = (id) => document.getElementById(id);

async function loadCloudinaryConfig() {
  try {
    const response = await fetch("data/cloudinary.json");
    if (!response.ok) return;
    cloudinary.config = await response.json();
  } catch (error) {
    cloudinary.config = {};
  }
}

function cloudinaryReady() {
  const config = cloudinary.config;
  return Boolean(
    config &&
    config.enabled &&
    config.cloudName &&
    config.uploadPreset &&
    !/YOUR_|REPLACE/i.test(config.cloudName + config.uploadPreset)
  );
}

async function loadSupabaseConfig() {
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

function remoteReady() {
  return Boolean(remote.client);
}

function authenticated() {
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

async function initAuth() {
  if (!remoteReady()) return;
  const { data, error } = await remote.client.auth.getSession();
  if (error) throw error;
  state.session = data.session;
  if (state.session) await syncTripcartUser(state.session);
  remote.client.auth.onAuthStateChange((event, session) => {
    state.session = session;
    state.profile = session ? state.profile : null;
    updateAuthUI();
    if (session && !state.editingId) refreshRemoteProducts();
    render();
    if (session) {
      window.setTimeout(() => syncTripcartUser(session, event === "SIGNED_IN"), 0);
    }
  });
}

function updateAuthUI() {
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

function openAuthModal() {
  $("authModal").classList.add("show");
  $("authEmail").focus();
}

function closeAuthModal() {
  $("authModal").classList.remove("show");
}

async function handleAuth(action) {
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
    if (action === "signup" && !result.data.session) {
      showToast("註冊成功，請先完成 Email 驗證。", "good");
    } else {
      showToast("登入成功，已啟用共享編輯。", "good");
    }
  } catch (error) {
    showToast(error.message || "登入失敗，請確認帳號資料。", "warn");
  }
}

function requireAuthentication() {
  if (!remoteReady() || authenticated()) return true;
  showToast("請先登入，才能新增、編輯或刪除共享資料。", "warn");
  openAuthModal();
  return false;
}

function remoteLocationFromRow(row) {
  return {
    region: row.region || "",
    city: row.city || "",
    store: row.store || "",
    location: row.location || "",
    mapsUrl: row.maps_url || "",
    lat: row.lat,
    lng: row.lng
  };
}

function remoteProductFromRow(row) {
  return {
    id: row.id,
    locationId: row.location_id || "",
    trip: row.trip || "",
    nameJa: row.name_ja || "",
    nameZh: row.name_zh || "",
    description: row.description || "",
    qty: row.qty,
    unitPrice: Number(row.unit_price || 0),
    currency: row.currency || "JPY",
    image: row.image_url || "",
    status: row.status || "pending"
  };
}

async function loadRemoteProducts() {
  const [locationResult, productResult] = await Promise.all([
    remote.client.from("locations").select("id,region,city,store,location,maps_url,lat,lng").order("store"),
    remote.client.from("products").select("id,location_id,trip,name_ja,name_zh,description,qty,unit_price,currency,image_url,status").order("created_at", { ascending: false })
  ]);
  if (locationResult.error) throw locationResult.error;
  if (productResult.error) throw productResult.error;
  const locationMap = Object.fromEntries((locationResult.data || []).map((location) => [location.id, remoteLocationFromRow(location)]));
  return (productResult.data || []).map((product) => Object.assign(
    {},
    remoteProductFromRow(product),
    locationMap[product.location_id] || {}
  ));
}

async function refreshRemoteProducts(message) {
  if (!remoteReady()) return;
  try {
    state.products = await loadRemoteProducts();
    initFilters();
    render();
    if (message) showToast(message, "good");
  } catch (error) {
    console.error(error);
    if (message) showToast("共享資料同步失敗，請稍後再試。", "warn");
  }
}

function subscribeToRemoteChanges() {
  if (!remoteReady()) return;
  const refresh = () => {
    if (!state.editingId) refreshRemoteProducts("旅伴已更新共享資料");
  };
  remote.channel = remote.client
    .channel("tripcart-shared-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, refresh)
    .subscribe();
}

async function loadProductsFromJson() {
  const responses = await Promise.all([
    fetch("data/locations.json"),
    fetch("data/products.json")
  ]);
  if (!responses[0].ok || !responses[1].ok) {
    throw new Error("JSON 資料載入失敗");
  }
  const locations = (await responses[0].json()).locations || [];
  const products = (await responses[1].json()).products || [];
  const locationMap = Object.fromEntries(locations.map((location) => [location.id, location]));
  const canonicalProducts = products.map((product) => {
    const locationDetails = Object.assign({}, locationMap[product.locationId] || {});
    delete locationDetails.id;
    return Object.assign({}, product, locationDetails);
  });
  const canonicalById = new Map(canonicalProducts.map((product) => [product.id, product]));

  try {
    const saved = localStorage.getItem("tripcart-products");
    if (saved) {
      const savedProducts = JSON.parse(saved);
      if (Array.isArray(savedProducts)) {
        const normalizedProducts = savedProducts.map((product) => {
          const canonicalProduct = canonicalById.get(product.id);
          const image = typeof product.image === "string" && product.image.startsWith("https://res.cloudinary.com/")
            ? product.image
            : canonicalProduct?.image || "";
          return Object.assign({}, canonicalProduct || {}, product, { image });
        });
        localStorage.setItem("tripcart-products", JSON.stringify(normalizedProducts));
        return normalizedProducts;
      }
    }
  } catch (error) {
    console.warn("Unable to read local product data", error);
  }

  return canonicalProducts;
}

async function loadProducts() {
  if (remoteReady()) {
    try {
      return await loadRemoteProducts();
    } catch (error) {
      console.warn("Unable to load shared Supabase data; using local seed data", error);
      showToast("共享資料暫時無法讀取，先顯示本地初始資料。", "warn");
    }
  }
  return loadProductsFromJson();
}

function saveProducts() {
  try {
    localStorage.setItem("tripcart-products", JSON.stringify(state.products));
  } catch (error) {
    console.warn("Unable to save local product data", error);
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;"
  }[character]));
}

function money(value, currency) {
  const symbols = { JPY: "¥", TWD: "NT$", USD: "$" };
  return (symbols[currency] || (currency || "") + " ") + Number(value || 0).toLocaleString("en-US");
}

function total(product) {
  return Number(product.qty || 0) * Number(product.unitPrice || 0);
}

function uniqueValues(key) {
  return Array.from(new Set(state.products.map((product) => product[key]).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function fillSelect(select, values, allLabel) {
  const oldValue = select.value;
  select.innerHTML = '<option value="all">' + allLabel + "</option>" +
    values.map((value) => '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + "</option>").join("");
  if (values.includes(oldValue)) select.value = oldValue;
}

function initFilters() {
  fillSelect($("tripFilter"), uniqueValues("trip"), "全部旅程");
  fillSelect($("regionFilter"), uniqueValues("region"), "全部地區");
}

function filtered() {
  return state.products.filter((product) =>
    (state.trip === "all" || product.trip === state.trip) &&
    (state.region === "all" || product.region === state.region) &&
    (!state.search || [
      product.nameJa,
      product.nameZh,
      product.store,
      product.location,
      product.region
    ].join(" ").toLowerCase().includes(state.search.toLowerCase()))
  );
}

function render() {
  const list = filtered();
  const pending = state.products.filter((product) => product.status === "pending");
  const done = state.products.filter((product) => product.status === "done");
  $("topTrip").textContent = state.trip === "all" ? "全部旅程" : state.trip;
  $("resultText").textContent = "顯示 " + list.length + " 項商品 · 可新增、編輯或刪除";
  $("itemCount").textContent = state.products.length;
  $("doneCount").textContent = done.length;
  $("pendingCount").textContent = pending.length;
  $("totalAmount").textContent = money(
    pending.reduce((sum, product) => sum + total(product), 0),
    "JPY"
  );
  $("cards").innerHTML = list.length
    ? list.map(cardHtml).join("")
    : '<div class="empty">目前沒有符合條件的商品<br><button class="outline" style="margin-top:14px" onclick="resetFilters()">清除篩選</button></div>';
}

function cardHtml(product) {
  const done = product.status === "done";
  const image = escapeHtml(product.image || "");
  return '<article class="card">' +
    '<div class="thumb"><img src="' + image + '" alt="' + escapeHtml(product.nameZh || product.nameJa) + ' 商品圖片"></div>' +
    '<div class="card-body">' +
      '<div class="card-title"><h3>' + escapeHtml(product.nameZh || product.nameJa) + '</h3>' +
        '<span class="status ' + (done ? "done" : "pending") + '">' + (done ? "已購買" : "待購買") + "</span></div>" +
      '<div class="meta">' + escapeHtml(product.nameJa) + "　·　" + escapeHtml(product.store) + "　·　" + escapeHtml(product.region) + "</div>" +
      '<p class="desc">' + escapeHtml(product.description || "尚未填寫商品描述") + "</p>" +
      '<div class="money-row"><span>數量 ' + escapeHtml(product.qty) + "　單價 " + money(product.unitPrice, product.currency) + "</span>" +
        "<b>" + money(total(product), product.currency) + "</b></div>" +
      '<div class="card-actions">' +
        '<a class="link" href="' + escapeHtml(product.mapsUrl || "#") + '" target="_blank" rel="noopener" onclick="if(this.getAttribute(\'href\')===\'#\'){event.preventDefault();showToast(\'尚未設定 Google Maps 連結\',\'warn\')}">開啟地圖</a>' +
        '<button class="link" style="border:0;background:none;padding:0;font-weight:900" onclick="openDrawer(\'' + escapeHtml(product.id) + '\')">編輯</button>' +
        '<button class="danger" onclick="removeItem(\'' + escapeHtml(product.id) + '\')">刪除</button>' +
      "</div>" +
    "</div></article>";
}

function resetFilters() {
  state.trip = "all";
  state.region = "all";
  state.search = "";
  $("tripFilter").value = "all";
  $("regionFilter").value = "all";
  $("search").value = "";
  render();
}

function showToast(message, type) {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = "toast show " + (type || "good");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => { toast.className = "toast"; }, 4800);
}

function openDrawer(id) {
  if (!requireAuthentication()) return;
  state.editingId = id;
  const product = id
    ? state.products.find((item) => item.id === id)
    : {
        id: "",
        nameJa: "",
        nameZh: "",
        description: "",
        qty: 1,
        unitPrice: 0,
        currency: "JPY",
        trip: state.trip === "all" ? "廣島 3 天 2 夜" : state.trip,
        region: state.region === "all" ? "廣島" : state.region,
        store: "",
        location: "",
        mapsUrl: "",
        status: "pending",
        image: "",
        locationId: ""
      };
  $("drawerTitle").textContent = id ? "編輯商品" : "新增商品";
  $("deleteFromDrawer").style.visibility = id ? "visible" : "hidden";
  $("itemId").value = product.id || "";
  $("nameJa").value = product.nameJa || "";
  $("nameZh").value = product.nameZh || "";
  $("description").value = product.description || "";
  $("qty").value = product.qty || 1;
  $("unitPrice").value = product.unitPrice || 0;
  $("currency").value = product.currency || "JPY";
  $("trip").value = product.trip || "";
  $("region").value = product.region || "";
  $("store").value = product.store || "";
  $("location").value = product.location || "";
  $("mapsUrl").value = product.mapsUrl || "";
  $("status").value = product.status || "pending";
  state.editingLocationId = product.locationId || "";
  state.imageData = product.image || "";
  state.imageFile = null;
  $("imageFile").value = "";
  updateTotalPreview();
  updateImagePreview();
  $("overlay").classList.add("show");
  $("drawer").classList.add("show");
  $("nameJa").focus();
}

function closeDrawer() {
  $("overlay").classList.remove("show");
  $("drawer").classList.remove("show");
  state.editingId = null;
  state.editingLocationId = "";
  state.imageFile = null;
}

function updateTotalPreview() {
  $("totalPreview").textContent = money(
    Number($("qty").value || 0) * Number($("unitPrice").value || 0),
    $("currency").value
  );
}

function updateImagePreview() {
  $("imagePreview").innerHTML = state.imageData
    ? '<img src="' + escapeHtml(state.imageData) + '" alt="商品圖片預覽">'
    : "尚未選擇圖片";
}

function readImage(file) {
  if (!file) return;
  state.imageFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    state.imageData = reader.result;
    updateImagePreview();
  };
  reader.readAsDataURL(file);
}

async function uploadImageToCloudinary(file) {
  if (!cloudinaryReady()) {
    throw new Error("尚未設定 Cloudinary，請先填寫 data/cloudinary.json");
  }
  const config = cloudinary.config;
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", config.uploadPreset);
  if (config.folder) body.append("folder", config.folder);
  const response = await fetch(
    "https://api.cloudinary.com/v1_1/" + encodeURIComponent(config.cloudName) + "/image/upload",
    { method: "POST", body }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.secure_url) {
    throw new Error(result.error && result.error.message ? result.error.message : "Cloudinary 圖片上傳失敗");
  }
  return result.secure_url;
}

async function saveProductToRemote(data) {
  if (!requireAuthentication()) throw new Error("請先登入共享帳號");
  const matchingLocation = state.products.find((product) =>
    product.locationId &&
    product.store === data.store &&
    product.location === data.location &&
    product.mapsUrl === data.mapsUrl
  );
  const locationId = data.locationId || matchingLocation?.locationId || "location-" + Date.now();
  const locationRow = {
    id: locationId,
    region: data.region,
    city: data.region,
    store: data.store,
    location: data.location,
    maps_url: data.mapsUrl,
    lat: data.lat,
    lng: data.lng
  };
  const { error: locationError } = await remote.client.from("locations").upsert(locationRow);
  if (locationError) throw locationError;
  const productRow = {
    id: data.id,
    location_id: locationId,
    trip: data.trip,
    name_ja: data.nameJa,
    name_zh: data.nameZh,
    description: data.description,
    qty: data.qty,
    unit_price: data.unitPrice,
    currency: data.currency,
    image_url: data.image,
    status: data.status
  };
  const { error: productError } = await remote.client.from("products").upsert(productRow);
  if (productError) throw productError;
  return locationId;
}

async function removeItem(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  if (!requireAuthentication()) return;
  if (confirm("確定刪除「" + (product.nameZh || product.nameJa) + "」嗎？")) {
    try {
      if (remoteReady()) {
        const { error } = await remote.client.from("products").delete().eq("id", id);
        if (error) throw error;
        state.products = await loadRemoteProducts();
      } else {
        state.products = state.products.filter((item) => item.id !== id);
        saveProducts();
      }
      closeDrawer();
      initFilters();
      render();
      showToast("商品已刪除");
    } catch (error) {
      console.error(error);
      showToast(error.message || "刪除失敗，請稍後再試。", "warn");
    }
  }
}

function haversine(a, b, c, d) {
  const radius = 6371000;
  const radians = (value) => value * Math.PI / 180;
  const deltaA = radians(c - a);
  const deltaB = radians(d - b);
  const h = Math.sin(deltaA / 2) ** 2 +
    Math.cos(radians(a)) * Math.cos(radians(c)) * Math.sin(deltaB / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

let notified = {};

async function enableReminder() {
  if (!navigator.geolocation) {
    $("permissionText").textContent = "此瀏覽器不支援定位，仍可使用手動提醒。";
    $("permissionText").className = "permission warn";
    return;
  }
  let note = "已請求定位權限。";
  if ("Notification" in window) {
    try {
      const permission = await Notification.requestPermission();
      note += permission === "granted" ? "通知權限已開啟。" : "通知權限未開啟。";
    } catch (error) {
      note += "通知權限未開啟。";
    }
  }
  $("permissionText").textContent = note + " 接近店家時會顯示提醒。";
  $("permissionText").className = "permission";
  navigator.geolocation.watchPosition(
    (position) => checkNearby(position.coords.latitude, position.coords.longitude),
    () => {
      $("permissionText").textContent = "無法取得目前位置，請檢查瀏覽器的定位權限。";
      $("permissionText").className = "permission warn";
    },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
  );
}

function checkNearby(latitude, longitude) {
  const radius = Number($("radius").value);
  state.products
    .filter((product) => product.status === "pending" && product.lat && product.lng)
    .forEach((product) => {
      const distance = haversine(latitude, longitude, product.lat, product.lng);
      if (distance <= radius && !notified[product.id]) {
        notified[product.id] = Date.now();
        const message = "你已接近 " + product.location + " 的 " + product.store + "（約 " + Math.round(distance) + " m）";
        showToast(message, "good");
        if ("Notification" in window && Notification.permission === "granted") {
          try { new Notification("TripCart 位置提醒", { body: message }); } catch (error) {}
        }
      }
    });
}

function demoNear() {
  const product = state.products.find((item) => item.status === "pending" && item.lat && item.lng);
  if (product) {
    notified = {};
    showToast("模擬接近 " + product.store + "，已顯示位置提醒。", "good");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const submitButton = document.querySelector('button[form="itemForm"]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  submitButton.textContent = state.imageFile ? "圖片上傳中…" : "儲存中…";
  try {
    if (!requireAuthentication()) return;
    let imageUrl = state.imageData || "";
    if (state.imageFile) imageUrl = await uploadImageToCloudinary(state.imageFile);
    const data = {
      id: $("itemId").value || "item-" + Date.now(),
      locationId: state.editingLocationId || "",
      nameJa: $("nameJa").value.trim(),
      nameZh: $("nameZh").value.trim(),
      description: $("description").value.trim(),
      qty: Number($("qty").value),
      unitPrice: Number($("unitPrice").value),
      currency: $("currency").value,
      trip: $("trip").value.trim(),
      region: $("region").value.trim(),
      store: $("store").value.trim(),
      location: $("location").value.trim(),
      mapsUrl: $("mapsUrl").value.trim(),
      status: $("status").value,
      image: imageUrl,
      lat: 34.3977,
      lng: 132.4759
    };
    const index = state.products.findIndex((product) => product.id === data.id);
    if (remoteReady()) {
      data.locationId = await saveProductToRemote(data);
      state.products = await loadRemoteProducts();
    } else {
      if (index >= 0) state.products[index] = data;
      else state.products.unshift(data);
      saveProducts();
    }
    initFilters();
    closeDrawer();
    render();
    showToast(index >= 0 ? "商品已更新" : "商品已新增");
  } catch (error) {
    console.error(error);
    showToast(error.message || "圖片上傳失敗", "warn");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "儲存";
  }
}

$("tripFilter").addEventListener("change", (event) => {
  state.trip = event.target.value;
  state.region = "all";
  fillSelect($("regionFilter"), uniqueValues("region"), "全部地區");
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
$("resetFilters").addEventListener("click", resetFilters);
$("addItem").addEventListener("click", () => openDrawer());
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
  handleAuth(event.submitter?.dataset.action || "signin");
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
  if (event.target.checked) enableReminder();
  else {
    $("permissionText").textContent = "提醒功能目前關閉。";
    $("permissionText").className = "permission";
  }
});
$("itemForm").addEventListener("submit", handleSubmit);

async function boot() {
  try {
    await Promise.all([loadCloudinaryConfig(), loadSupabaseConfig()]);
    await initAuth();
    updateAuthUI();
    state.products = await loadProducts();
    initFilters();
    render();
    subscribeToRemoteChanges();
  } catch (error) {
    console.error(error);
    $("resultText").textContent = "資料載入失敗";
    $("cards").innerHTML = '<div class="empty">無法讀取商品資料。請確認 Supabase 連線或使用 localhost／HTTPS 開啟網站。</div>';
    showToast("商品資料載入失敗，請確認 Supabase 設定", "warn");
  }
}
boot();
