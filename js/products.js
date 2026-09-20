import { state, remote } from "./state.js";
import { $, escapeHtml, fillSelect, money, showToast, total } from "./utils.js";
import { remoteReady, requireAuthentication } from "./auth.js";
import { uploadImageToCloudinary } from "./cloudinary.js";
import {
  ensureTripsFromProducts,
  loadRemoteProducts,
  saveProductToRemote,
  saveProducts
} from "./data.js";

function uniqueValues(key) {
  return Array.from(new Set(state.products.map((product) => product[key]).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

export function fillTripOptions() {
  const select = $("trip");
  if (!select) return;
  const current = select.value;
  const options = (state.trips || []).map((trip) =>
    '<option value="' + escapeHtml(trip.id) + '">' + escapeHtml(trip.name) + "</option>"
  ).join("");
  select.innerHTML = options || '<option value="">請先建立旅程</option>';
  if ((state.trips || []).some((trip) => trip.id === current)) select.value = current;
}

export function initFilters() {
  fillSelect($("tripFilter"), uniqueValues("trip"), "全部旅程");
  fillSelect($("regionFilter"), uniqueValues("region"), "全部地區");
  fillTripOptions();
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

export function render() {
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
    : `<div class="empty">
        目前沒有符合條件的商品
        <br>
        <button class="outline empty-action" data-product-action="reset" type="button">清除篩選</button>
      </div>`;
}

function cardHtml(product) {
  const done = product.status === "done";
  const image = escapeHtml(product.image || "");
  const productId = escapeHtml(product.id || "");
  const mapAction = product.mapsUrl
    ? `<a class="link" href="${escapeHtml(product.mapsUrl)}" target="_blank" rel="noopener">開啟地圖</a>`
    : `<button class="link" data-product-action="map" data-product-id="${productId}" type="button">開啟地圖</button>`;

  return `<article class="card">
    <div class="thumb">
      <img src="${image}" alt="${escapeHtml(product.nameJa)} 商品圖片">
    </div>
    <div class="card-body">
      <div class="card-title">
        <h3>${escapeHtml(product.nameJa)}</h3>
        <span class="status ${done ? "done" : "pending"}">${done ? "已購買" : "待購買"}</span>
      </div>
      <div class="meta">${escapeHtml(product.location || product.region)}　·　${escapeHtml(product.region)}</div>
      <p class="desc">${escapeHtml(product.description || "尚未填寫商品描述")}</p>
      <div class="money-row">
        <span>數量 ${escapeHtml(product.qty || "—")}　單價 ${product.unitPrice ? money(product.unitPrice, product.currency) : "—"}</span>
        <b>${money(total(product), product.currency)}</b>
      </div>
      <div class="card-actions">
        ${mapAction}
        <button class="link card-action" data-product-action="edit" data-product-id="${productId}" type="button">編輯</button>
        <button class="danger card-action" data-product-action="delete" data-product-id="${productId}" type="button">刪除</button>
      </div>
    </div>
  </article>`;
}

export function resetFilters() {
  state.trip = "all";
  state.region = "all";
  state.search = "";
  $("tripFilter").value = "all";
  $("regionFilter").value = "all";
  $("search").value = "";
  render();
}

export function openDrawer(id) {
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
        tripId: state.trip === "all"
          ? (state.trips[0]?.id || "")
          : (state.trips.find((trip) => trip.name === state.trip)?.id || ""),
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

export function closeDrawer() {
  $("overlay").classList.remove("show");
  $("drawer").classList.remove("show");
  state.editingId = null;
  state.editingLocationId = "";
  state.imageFile = null;
}

export function updateTotalPreview() {
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

export function readImage(file) {
  if (!file) return;
  state.imageFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    state.imageData = reader.result;
    updateImagePreview();
  };
  reader.readAsDataURL(file);
}

export async function removeItem(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product || !requireAuthentication()) return;
  if (!confirm("確定刪除「" + product.nameJa + "」嗎？")) return;

  try {
    if (remoteReady()) {
      const { error } = await remote.client
        .from("products")
        .delete()
        .eq("id", id);
      if (error) throw error;
      state.products = await loadRemoteProducts();
    } else {
      state.products = state.products.filter((item) => item.id !== id);
      saveProducts();
    }
    closeDrawer();
    ensureTripsFromProducts(state.products);
    initFilters();
    render();
    showToast("商品已刪除");
  } catch (error) {
    console.error(error);
    showToast(error.message || "刪除失敗，請稍後再試。", "warn");
  }
}

export async function handleSubmit(event) {
  event.preventDefault();
  const submitButton = document.querySelector('button[form="itemForm"]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  submitButton.textContent = state.imageFile ? "圖片上傳中…" : "儲存中…";

  try {
    if (!requireAuthentication()) return;
    let imageUrl = state.imageData || "";
    if (state.imageFile) imageUrl = await uploadImageToCloudinary(state.imageFile);
    const itemId = state.editingId || $("itemId").value;
    const data = {
      id: itemId || "item-" + Date.now(),
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
      status: state.products.find((product) => product.id === itemId)?.status || "pending",
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
    ensureTripsFromProducts(state.products);
    initFilters();
    closeDrawer();
    render();
    showToast(index >= 0 ? "商品已更新" : "商品已新增");
  } catch (error) {
    console.error(error);
    showToast(error.message || "圖片上傳失敗", "warn");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "儲存商品";
  }
}
