const state = {
  products: [],
  trips: [],
  tripDetails: [],
  trip: "all",
  region: "all",
  search: "",
  editingId: null,
  editingLocationId: "",
  editingTripId: null,
  tripEditorDetails: [],
  imageData: "",
  imageFile: null,
  session: null,
  profile: null
};
const cloudinary = { config: {} };
const remote = { config: {}, client: null, channel: null, tripDataLoaded: false };
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

function remoteTripFromRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    primaryLocation: row.primary_location || "",
    persisted: true
  };
}

function remoteTripDetailFromRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    attraction: row.attraction || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    transportType: row.transport_type || "",
    transportDetail: row.transport_detail || "",
    cost: Number(row.cost || 0),
    currency: row.currency || "JPY",
    sortOrder: Number(row.sort_order || 0)
  };
}

function remoteProductFromRow(row) {
  return {
    id: row.id,
    locationId: row.location_id || "",
    tripId: row.trip_id || "",
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

function slugifyTrip(name) {
  return String(name || "trip").trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "") || "trip";
}

function ensureTripsFromProducts(products = state.products) {
  const known = new Map((state.trips || []).map((trip) => [trip.name, trip]));
  (products || []).forEach((product) => {
    if (!product.trip || known.has(product.trip)) return;
    const trip = {
      id: slugifyTrip(product.trip),
      name: product.trip,
      startDate: "",
      endDate: "",
      primaryLocation: product.region || "",
      fallback: true
    };
    known.set(trip.name, trip);
  });
  state.trips = Array.from(known.values());
  const tripIds = new Map(state.trips.map((trip) => [trip.name, trip.id]));
  (products || []).forEach((product) => {
    if (!product.tripId && product.trip) product.tripId = tripIds.get(product.trip) || "";
  });
}

async function loadTripsFromJson() {
  try {
    const [tripResponse, detailResponse] = await Promise.all([
      fetch("data/trips.json"),
      fetch("data/trip-details.json")
    ]);
    if (!tripResponse.ok || !detailResponse.ok) return [];
    const tripData = await tripResponse.json();
    const detailData = await detailResponse.json();
    state.trips = tripData.trips || [];
    state.tripDetails = detailData.details || [];
    try {
      const savedTrips = JSON.parse(localStorage.getItem("tripcart-trips") || "null");
      const savedDetails = JSON.parse(localStorage.getItem("tripcart-trip-details") || "null");
      if (Array.isArray(savedTrips)) state.trips = savedTrips;
      if (Array.isArray(savedDetails)) state.tripDetails = savedDetails;
    } catch (error) {
      console.warn("Unable to read local trip data", error);
    }
    return state.trips;
  } catch (error) {
    state.trips = [];
    state.tripDetails = [];
    return [];
  }
}

async function loadRemoteProducts() {
  const [locationResult, productResult] = await Promise.all([
    remote.client.from("locations").select("id,region,city,store,location,maps_url,lat,lng").order("store"),
    remote.client.from("products").select("id,location_id,trip_id,trip,name_ja,name_zh,description,qty,unit_price,currency,image_url,status").order("created_at", { ascending: false })
  ]);
  if (locationResult.error) throw locationResult.error;
  if (productResult.error) throw productResult.error;
  const locationMap = Object.fromEntries((locationResult.data || []).map((location) => [location.id, remoteLocationFromRow(location)]));
  const products = (productResult.data || []).map((product) => Object.assign(
    {},
    remoteProductFromRow(product),
    locationMap[product.location_id] || {}
  ));
  try {
    const [tripResult, detailResult] = await Promise.all([
      remote.client.from("trips").select("id,name,start_date,end_date,primary_location").order("start_date", { ascending: true }),
      remote.client.from("trip_details").select("id,trip_id,attraction,start_date,end_date,transport_type,transport_detail,cost,currency,sort_order").order("sort_order", { ascending: true })
    ]);
    if (!tripResult.error && !detailResult.error) {
      state.trips = (tripResult.data || []).map(remoteTripFromRow);
      state.tripDetails = (detailResult.data || []).map(remoteTripDetailFromRow);
      remote.tripDataLoaded = true;
    } else {
      remote.tripDataLoaded = false;
      ensureTripsFromProducts(products);
    }
  } catch (error) {
    remote.tripDataLoaded = false;
    ensureTripsFromProducts(products);
  }
  ensureTripsFromProducts(products);
  return products;
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
    if (!state.editingId && !state.editingTripId) refreshRemoteProducts("旅伴已更新共享資料");
  };
  remote.channel = remote.client
    .channel("tripcart-shared-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "trip_details" }, refresh)
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
        ensureTripsFromProducts(normalizedProducts);
        return normalizedProducts;
      }
    }
  } catch (error) {
    console.warn("Unable to read local product data", error);
  }

  ensureTripsFromProducts(canonicalProducts);
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
  fillTripOptions();
}

function fillTripOptions() {
  const select = $("trip");
  if (!select) return;
  const current = select.value;
  const options = (state.trips || []).map((trip) =>
    '<option value="' + escapeHtml(trip.id) + '">' + escapeHtml(trip.name) + "</option>"
  ).join("");
  select.innerHTML = options || '<option value="">請先建立旅程</option>';
  if ((state.trips || []).some((trip) => trip.id === current)) select.value = current;
}

function filtered() {
  return state.products.filter((product) =>
    (state.trip === "all" || product.trip === state.trip) &&
    (state.region === "all" || product.region === state.region) &&
    (!state.search || [
      product.nameJa,
      product.location,
      product.region,
      product.description,
      product.trip
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
  const productId = escapeHtml(product.id || "");
  return '<article class="card">' +
    '<div class="thumb"><img src="' + image + '" alt="' + escapeHtml(product.nameJa) + ' 商品圖片"></div>' +
    '<div class="card-body">' +
      '<div class="card-title"><h3>' + escapeHtml(product.nameJa) + '</h3>' +
        '<span class="status ' + (done ? "done" : "pending") + '">' + (done ? "已購買" : "待購買") + "</span></div>" +
      '<div class="meta">' + escapeHtml(product.location || product.region) + "　·　" + escapeHtml(product.region) + "</div>" +
      '<p class="desc">' + escapeHtml(product.description || "尚未填寫商品描述") + "</p>" +
      '<div class="money-row"><span>數量 ' + escapeHtml(product.qty || "—") + "　單價 " + (product.unitPrice ? money(product.unitPrice, product.currency) : "—") + "</span>" +
        "<b>" + money(total(product), product.currency) + "</b></div>" +
      '<div class="card-actions">' +
        (product.mapsUrl
          ? '<a class="link" href="' + escapeHtml(product.mapsUrl) + '" target="_blank" rel="noopener">開啟地圖</a>'
          : '<button class="link" data-product-action="map" data-product-id="' + productId + '">開啟地圖</button>') +
        '<button class="link card-action" data-product-action="edit" data-product-id="' + productId + '">編輯</button>' +
        '<button class="danger card-action" data-product-action="delete" data-product-id="' + productId + '">刪除</button>' +
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
        description: "",
        qty: "",
        unitPrice: "",
        currency: "JPY",
        tripId: state.trip === "all" ? (state.trips[0]?.id || "") : (state.trips.find((trip) => trip.name === state.trip)?.id || ""),
        trip: state.trip === "all" ? (state.trips[0]?.name || "") : state.trip,
        region: state.region === "all" ? (state.trips[0]?.primaryLocation || "") : state.region,
        location: "",
        mapsUrl: "",
        status: "pending",
        image: "",
        locationId: ""
      };
  if (id && !product) {
    state.editingId = null;
    showToast("找不到這筆商品，清單已重新整理。", "warn");
    render();
    return;
  }
  $("drawerTitle").textContent = id ? "編輯商品" : "新增商品";
  $("deleteFromDrawer").style.visibility = id ? "visible" : "hidden";
  $("itemId").value = id || product.id || "";
  $("nameJa").value = product.nameJa || "";
  $("description").value = product.description || "";
  $("qty").value = product.qty ?? "";
  $("unitPrice").value = product.unitPrice ?? "";
  $("currency").value = product.currency || "JPY";
  fillTripOptions();
  $("trip").value = product.tripId || (state.trips.find((trip) => trip.name === product.trip)?.id || "");
  $("region").value = product.region || "";
  $("location").value = product.location || "";
  $("mapsUrl").value = product.mapsUrl || "";
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
  const existingLocation = state.products.find((product) => product.locationId === data.locationId);
  const matchingLocation = state.products.find((product) =>
    product.locationId &&
    product.location === data.location &&
    product.mapsUrl === data.mapsUrl &&
    product.region === data.region
  );
  const locationId = data.locationId || matchingLocation?.locationId || "location-" + Date.now();
  const selectedTrip = state.trips.find((trip) => trip.id === data.tripId);
  const tripId = selectedTrip?.fallback ? null : (data.tripId || null);
  const locationRow = {
    id: locationId,
    region: data.region,
    city: data.region,
    store: existingLocation?.store || matchingLocation?.store || data.location,
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
    trip_id: tripId,
    trip: data.trip,
    name_ja: data.nameJa,
    name_zh: "",
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
  if (confirm("確定刪除「" + product.nameJa + "」嗎？")) {
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
        const message = "你已接近 " + (product.store || product.location) + "（約 " + Math.round(distance) + " m）";
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
    showToast("模擬接近 " + (product.store || product.location) + "，已顯示位置提醒。", "good");
  }
}

function blankTripDetail() {
  return {
    id: "",
    tripId: state.editingTripId || "",
    attraction: "",
    startDate: "",
    endDate: "",
    transportType: "",
    transportDetail: "",
    cost: "",
    currency: "JPY",
    sortOrder: state.tripEditorDetails.length
  };
}

function renderTripList() {
  const list = $("tripList");
  if (!list) return;
  list.innerHTML = state.trips.length
    ? state.trips.map((trip) => {
        const details = state.tripDetails.filter((detail) => detail.tripId === trip.id).length;
        const dates = [trip.startDate, trip.endDate].filter(Boolean).join(" ～ ") || "尚未設定日期";
        return '<article class="trip-list-item ' + (state.editingTripId === trip.id ? "active" : "") + '">' +
          '<div><strong>' + escapeHtml(trip.name) + '</strong><small>' + escapeHtml(dates) + " · " + escapeHtml(trip.primaryLocation || "尚未設定主要地點") + " · " + details + " 筆明細</small></div>" +
          '<button class="link trip-action" data-trip-action="edit" data-trip-id="' + escapeHtml(trip.id) + '">編輯</button>' +
        "</article>";
      }).join("")
    : '<div class="empty">目前還沒有旅程，請先新增一個旅程。</div>';
}

function tripDetailHtml(detail, index) {
  const transportOptions = ["", "飛機", "巴士", "JR", "地鐵", "計程車", "步行", "其他"];
  return '<div class="trip-detail-row" data-detail-index="' + index + '">' +
    '<div class="detail-row-head"><strong>明細 ' + (index + 1) + '</strong><button type="button" class="danger remove-detail" data-detail-action="remove">移除</button></div>' +
    '<div class="detail-grid">' +
      '<div class="field full"><label>主要景點（都市或景點名稱）</label><input data-detail-field="attraction" value="' + escapeHtml(detail.attraction) + '" placeholder="例如：宮島、岡山城"></div>' +
      '<div class="field"><label>起日</label><input type="date" data-detail-field="startDate" value="' + escapeHtml(detail.startDate) + '"></div>' +
      '<div class="field"><label>迄日</label><input type="date" data-detail-field="endDate" value="' + escapeHtml(detail.endDate) + '"></div>' +
      '<div class="field"><label>交通方式</label><select data-detail-field="transportType">' + transportOptions.map((option) => '<option value="' + escapeHtml(option) + '"' + (detail.transportType === option ? " selected" : "") + '>' + escapeHtml(option || "請選擇") + "</option>").join("") + '</select></div>' +
      '<div class="field"><label>航班／班次／備註</label><input data-detail-field="transportDetail" value="' + escapeHtml(detail.transportDetail) + '" placeholder="例如：JL 258、快速列車"></div>' +
      '<div class="field"><label>費用</label><input type="number" min="0" step="1" data-detail-field="cost" value="' + escapeHtml(detail.cost ?? "") + '" placeholder="選填"></div>' +
      '<div class="field"><label>貨幣</label><select data-detail-field="currency"><option value="JPY"' + (detail.currency === "JPY" ? " selected" : "") + '>JPY</option><option value="TWD"' + (detail.currency === "TWD" ? " selected" : "") + '>TWD</option><option value="USD"' + (detail.currency === "USD" ? " selected" : "") + '>USD</option></select></div>' +
    '</div>' +
  '</div>';
}

function renderTripPage() {
  renderTripList();
  const trip = state.trips.find((item) => item.id === state.editingTripId);
  $("tripFormTitle").textContent = trip ? "編輯旅程" : "新增旅程";
  $("tripId").value = trip?.id || "";
  $("tripName").value = trip?.name || "";
  $("tripStartDate").value = trip?.startDate || "";
  $("tripEndDate").value = trip?.endDate || "";
  $("tripPrimaryLocation").value = trip?.primaryLocation || "";
  $("tripDetailsRows").innerHTML = state.tripEditorDetails.map(tripDetailHtml).join("");
}

function openTripPage() {
  $("productsPage").hidden = true;
  $("tripPage").hidden = false;
  if (!state.editingTripId && state.trips[0]) {
    state.editingTripId = state.trips[0].id;
    state.tripEditorDetails = state.tripDetails.filter((detail) => detail.tripId === state.editingTripId).map((detail) => Object.assign({}, detail));
  }
  renderTripPage();
}

function closeTripPage() {
  $("tripPage").hidden = true;
  $("productsPage").hidden = false;
}

function newTripEditor() {
  if (!requireAuthentication()) return;
  state.editingTripId = null;
  state.tripEditorDetails = [blankTripDetail()];
  renderTripPage();
}

function editTrip(id) {
  if (!requireAuthentication()) return;
  const trip = state.trips.find((item) => item.id === id);
  if (!trip) return;
  state.editingTripId = id;
  state.tripEditorDetails = state.tripDetails.filter((detail) => detail.tripId === id).map((detail) => Object.assign({}, detail));
  if (!state.tripEditorDetails.length) state.tripEditorDetails = [blankTripDetail()];
  renderTripPage();
}

function saveTripsLocally() {
  try {
    localStorage.setItem("tripcart-trips", JSON.stringify(state.trips));
    localStorage.setItem("tripcart-trip-details", JSON.stringify(state.tripDetails));
  } catch (error) {
    console.warn("Unable to save local trip data", error);
  }
}

async function saveTripToRemote(trip, details) {
  if (!requireAuthentication()) throw new Error("請先登入共享帳號");
  const tripRow = {
    id: trip.id,
    name: trip.name,
    start_date: trip.startDate || null,
    end_date: trip.endDate || null,
    primary_location: trip.primaryLocation
  };
  const { error: tripError } = await remote.client.from("trips").upsert(tripRow);
  if (tripError) throw tripError;
  const { error: productError } = await remote.client.from("products").update({ trip: trip.name }).eq("trip_id", trip.id);
  if (productError) throw productError;
  const { error: deleteError } = await remote.client.from("trip_details").delete().eq("trip_id", trip.id);
  if (deleteError) throw deleteError;
  const rows = details.filter((detail) => detail.attraction || detail.transportType || detail.transportDetail || detail.cost).map((detail, index) => ({
    id: detail.id || "detail-" + Date.now() + "-" + index,
    trip_id: trip.id,
    attraction: detail.attraction,
    start_date: detail.startDate || null,
    end_date: detail.endDate || null,
    transport_type: detail.transportType,
    transport_detail: detail.transportDetail,
    cost: Number(detail.cost || 0),
    currency: detail.currency || "JPY",
    sort_order: index
  }));
  if (rows.length) {
    const { error: detailError } = await remote.client.from("trip_details").insert(rows);
    if (detailError) throw detailError;
  }
}

async function handleTripSubmit(event) {
  event.preventDefault();
  if (!requireAuthentication()) return;
  const name = $("tripName").value.trim();
  if (!name) {
    showToast("請先輸入旅程名稱。", "warn");
    $("tripName").focus();
    return;
  }
  const oldTrip = state.trips.find((trip) => trip.id === state.editingTripId);
  const trip = {
    id: state.editingTripId || slugifyTrip(name) + "-" + Date.now(),
    name,
    startDate: $("tripStartDate").value,
    endDate: $("tripEndDate").value,
    primaryLocation: $("tripPrimaryLocation").value.trim()
  };
  const details = state.tripEditorDetails.map((detail, index) => Object.assign({}, detail, { tripId: trip.id, sortOrder: index }));
  try {
    if (remoteReady()) {
      await saveTripToRemote(trip, details);
      state.products = await loadRemoteProducts();
    } else {
      state.trips = state.trips.filter((item) => item.id !== trip.id);
      state.trips.push(trip);
      state.tripDetails = state.tripDetails.filter((detail) => detail.tripId !== trip.id).concat(details.map((detail, index) => Object.assign({}, detail, { id: detail.id || "detail-" + Date.now() + "-" + index })));
      state.products.forEach((product) => {
        if (product.tripId === trip.id || (oldTrip && product.trip === oldTrip.name)) product.trip = trip.name;
      });
      saveTripsLocally();
      saveProducts();
    }
    state.editingTripId = trip.id;
    state.tripEditorDetails = state.tripDetails.filter((detail) => detail.tripId === trip.id).map((detail) => Object.assign({}, detail));
    ensureTripsFromProducts(state.products);
    initFilters();
    renderTripPage();
    render();
    showToast(oldTrip ? "旅程已更新" : "旅程已新增");
  } catch (error) {
    console.error(error);
    showToast(error.message || "旅程儲存失敗，請稍後再試。", "warn");
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
      id: state.editingId || $("itemId").value || "item-" + Date.now(),
      locationId: state.editingLocationId || "",
      nameJa: $("nameJa").value.trim(),
      description: $("description").value.trim(),
      qty: Number($("qty").value) || 1,
      unitPrice: Number($("unitPrice").value) || 0,
      currency: $("currency").value,
      tripId: $("trip").value,
      trip: state.trips.find((trip) => trip.id === $("trip").value)?.name || "",
      region: $("region").value.trim(),
      location: $("location").value.trim(),
      mapsUrl: $("mapsUrl").value.trim(),
      status: state.products.find((product) => product.id === (state.editingId || $("itemId").value))?.status || "pending",
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
$("cards").addEventListener("click", (event) => {
  const action = event.target.closest("[data-product-action]");
  if (!action) return;
  const id = action.dataset.productId;
  if (action.dataset.productAction === "edit") {
    openDrawer(id);
    if (id && $("drawer").classList.contains("show")) {
      state.editingId = id;
      $("itemId").value = id;
    }
  }
  if (action.dataset.productAction === "delete") removeItem(id);
  if (action.dataset.productAction === "map") showToast("尚未設定 Google Maps 連結", "warn");
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
$("addTripDetail").addEventListener("click", () => {
  if (!requireAuthentication()) return;
  state.tripEditorDetails.push(blankTripDetail());
  renderTripPage();
});
const updateTripDetailField = (event) => {
  const field = event.target.closest("[data-detail-field]");
  const row = event.target.closest("[data-detail-index]");
  if (!field || !row) return;
  const detail = state.tripEditorDetails[Number(row.dataset.detailIndex)];
  if (!detail) return;
  detail[field.dataset.detailField] = field.value;
};
$("tripDetailsRows").addEventListener("input", updateTripDetailField);
$("tripDetailsRows").addEventListener("change", updateTripDetailField);
$("tripDetailsRows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-detail-action=\"remove\"]");
  if (!button) return;
  const row = button.closest("[data-detail-index]");
  state.tripEditorDetails.splice(Number(row.dataset.detailIndex), 1);
  renderTripPage();
});
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
    if (!remote.tripDataLoaded) await loadTripsFromJson();
    ensureTripsFromProducts(state.products);
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
