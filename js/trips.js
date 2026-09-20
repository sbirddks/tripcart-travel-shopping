import { state } from "./state.js";
import { $, escapeHtml, showToast, slugifyTrip } from "./utils.js";
import { remoteReady, requireAuthentication } from "./auth.js";
import {
  ensureTripsFromProducts,
  loadRemoteProducts,
  saveProducts,
  saveTripToRemote,
  saveTripsLocally
} from "./data.js";
import { initFilters, render } from "./products.js";

export function blankTripDetail() {
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

export function renderTripList() {
  const list = $("tripList");
  if (!list) return;
  list.innerHTML = state.trips.length
    ? state.trips.map((trip) => {
        const details = state.tripDetails.filter((detail) => detail.tripId === trip.id).length;
        const dates = [trip.startDate, trip.endDate].filter(Boolean).join(" ～ ") || "尚未設定日期";
        return `<article class="trip-list-item ${state.editingTripId === trip.id ? "active" : ""}">
          <div>
            <strong>${escapeHtml(trip.name)}</strong>
            <small>${escapeHtml(dates)} · ${escapeHtml(trip.primaryLocation || "尚未設定主要地點")} · ${details} 筆明細</small>
          </div>
          <button class="link trip-action" data-trip-action="edit" data-trip-id="${escapeHtml(trip.id)}" type="button">編輯</button>
        </article>`;
      }).join("")
    : '<div class="empty">目前還沒有旅程，請先新增一個旅程。</div>';
}

function tripDetailHtml(detail, index) {
  const transportOptions = ["", "飛機", "巴士", "JR", "地鐵", "計程車", "步行", "其他"];
  const transportSelect = transportOptions.map((option) =>
    `<option value="${escapeHtml(option)}"${detail.transportType === option ? " selected" : ""}>${escapeHtml(option || "請選擇")}</option>`
  ).join("");

  return `<div class="trip-detail-row" data-detail-index="${index}">
    <div class="detail-row-head">
      <strong>明細 ${index + 1}</strong>
      <button type="button" class="danger remove-detail" data-detail-action="remove">移除</button>
    </div>
    <div class="detail-grid">
      <div class="field full">
        <label>主要景點（都市或景點名稱）</label>
        <input data-detail-field="attraction" value="${escapeHtml(detail.attraction)}" placeholder="例如：宮島、岡山城">
      </div>
      <div class="field">
        <label>起日</label>
        <input type="date" data-detail-field="startDate" value="${escapeHtml(detail.startDate)}">
      </div>
      <div class="field">
        <label>迄日</label>
        <input type="date" data-detail-field="endDate" value="${escapeHtml(detail.endDate)}">
      </div>
      <div class="field">
        <label>交通方式</label>
        <select data-detail-field="transportType">${transportSelect}</select>
      </div>
      <div class="field">
        <label>航班／班次／備註</label>
        <input data-detail-field="transportDetail" value="${escapeHtml(detail.transportDetail)}" placeholder="例如：JL 258、快速列車">
      </div>
      <div class="field">
        <label>費用</label>
        <input type="number" min="0" step="1" data-detail-field="cost" value="${escapeHtml(detail.cost ?? "")}" placeholder="選填">
      </div>
      <div class="field">
        <label>貨幣</label>
        <select data-detail-field="currency">
          <option value="JPY"${detail.currency === "JPY" ? " selected" : ""}>JPY</option>
          <option value="TWD"${detail.currency === "TWD" ? " selected" : ""}>TWD</option>
          <option value="USD"${detail.currency === "USD" ? " selected" : ""}>USD</option>
        </select>
      </div>
    </div>
  </div>`;
}

export function renderTripPage() {
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

export function openTripPage() {
  $("productsPage").hidden = true;
  $("tripPage").hidden = false;
  if (!state.editingTripId && state.trips[0]) {
    state.editingTripId = state.trips[0].id;
    state.tripEditorDetails = state.tripDetails
      .filter((detail) => detail.tripId === state.editingTripId)
      .map((detail) => Object.assign({}, detail));
  }
  renderTripPage();
}

export function closeTripPage() {
  $("tripPage").hidden = true;
  $("productsPage").hidden = false;
}

export function newTripEditor() {
  if (!requireAuthentication()) return;
  state.editingTripId = null;
  state.tripEditorDetails = [blankTripDetail()];
  renderTripPage();
}

export function editTrip(id) {
  if (!requireAuthentication()) return;
  const trip = state.trips.find((item) => item.id === id);
  if (!trip) return;
  state.editingTripId = id;
  state.tripEditorDetails = state.tripDetails
    .filter((detail) => detail.tripId === id)
    .map((detail) => Object.assign({}, detail));
  if (!state.tripEditorDetails.length) state.tripEditorDetails = [blankTripDetail()];
  renderTripPage();
}

export function addTripDetail() {
  if (!requireAuthentication()) return;
  state.tripEditorDetails.push(blankTripDetail());
  renderTripPage();
}

export function updateTripDetailField(event) {
  const field = event.target.closest("[data-detail-field]");
  const row = event.target.closest("[data-detail-index]");
  if (!field || !row) return;
  const detail = state.tripEditorDetails[Number(row.dataset.detailIndex)];
  if (detail) detail[field.dataset.detailField] = field.value;
}

export function removeTripDetail(event) {
  const button = event.target.closest('[data-detail-action="remove"]');
  if (!button) return;
  const row = button.closest("[data-detail-index]");
  state.tripEditorDetails.splice(Number(row.dataset.detailIndex), 1);
  renderTripPage();
}

export async function handleTripSubmit(event) {
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
  const details = state.tripEditorDetails.map((detail, index) =>
    Object.assign({}, detail, { tripId: trip.id, sortOrder: index })
  );

  try {
    if (remoteReady()) {
      await saveTripToRemote(trip, details);
      state.products = await loadRemoteProducts();
    } else {
      state.trips = state.trips.filter((item) => item.id !== trip.id);
      state.trips.push(trip);
      state.tripDetails = state.tripDetails
        .filter((detail) => detail.tripId !== trip.id)
        .concat(details.map((detail, index) => Object.assign({}, detail, {
          id: detail.id || "detail-" + Date.now() + "-" + index
        })));
      state.products.forEach((product) => {
        if (product.tripId === trip.id || (oldTrip && product.trip === oldTrip.name)) {
          product.trip = trip.name;
        }
      });
      saveTripsLocally();
      saveProducts();
    }

    state.editingTripId = trip.id;
    state.tripEditorDetails = state.tripDetails
      .filter((detail) => detail.tripId === trip.id)
      .map((detail) => Object.assign({}, detail));
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
