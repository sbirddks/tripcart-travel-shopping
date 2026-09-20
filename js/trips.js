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
    date: "",
    location: "",
    period: "",
    time: "",
    activity: "",
    route: "",
    transport: "",
    cost: "",
    currency: "JPY",
    sortOrder: state.tripEditorDetails.length
  };
}

function normalizeTripDetail(detail = {}, index = 0) {
  const legacyAttraction = String(detail.attraction || "");
  const parts = legacyAttraction.split("｜");
  return Object.assign({}, detail, {
    id: detail.id || "",
    date: detail.date || detail.startDate || "",
    location: detail.location || (parts.length > 1 ? parts.shift() : ""),
    period: detail.period || "",
    time: detail.time || "",
    activity: detail.activity || (parts.length > 1 ? parts.join("｜") : legacyAttraction),
    route: detail.route || detail.transportDetail || "",
    transport: detail.transport || detail.transportType || "",
    cost: detail.cost ?? "",
    currency: detail.currency || "JPY",
    sortOrder: detail.sortOrder ?? index
  });
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
  const transportOptions = ["", "步行", "JR", "新幹線", "巴士", "市內循環巴士", "路面電車", "渡輪", "纜車", "腳踏車", "計程車", "其他"];
  const transportSelect = transportOptions.map((option) =>
    `<option value="${escapeHtml(option)}"${detail.transport === option ? " selected" : ""}>${escapeHtml(option || "請選擇交通方式")}</option>`
  ).join("");
  const periodOptions = ["", "早上", "上午", "中午", "下午", "晚上", "早餐", "午餐", "晚餐", "其他"];
  const periodSelect = periodOptions.map((option) =>
    `<option value="${escapeHtml(option)}"${detail.period === option ? " selected" : ""}>${escapeHtml(option || "請選擇時段")}</option>`
  ).join("");
  const number = String(index + 1).padStart(2, "0");

  return `<article class="trip-detail-row" data-detail-index="${index}">
    <div class="detail-row-marker" aria-hidden="true">
      <span>${number}</span>
      <i></i>
    </div>
    <div class="detail-row-content">
      <div class="detail-row-head">
        <div>
          <strong>行程 ${number}</strong>
          <span>一段可執行的安排</span>
        </div>
        <button type="button" class="danger remove-detail" data-detail-action="remove">移除</button>
      </div>
      <div class="detail-grid detail-grid-primary">
        <div class="field">
          <label>日期</label>
          <input data-detail-field="date" value="${escapeHtml(detail.date)}" placeholder="例如：5月14日（二）">
        </div>
        <div class="field">
          <label>地點</label>
          <input data-detail-field="location" value="${escapeHtml(detail.location)}" placeholder="例如：宮島、岡山">
        </div>
        <div class="field">
          <label>時段</label>
          <select data-detail-field="period">${periodSelect}</select>
        </div>
        <div class="field">
          <label>時間</label>
          <input data-detail-field="time" value="${escapeHtml(detail.time)}" placeholder="例如：15:00 或 15點00分">
        </div>
      </div>
      <div class="field detail-activity-field">
        <label>行程 <span>這段要做什麼</span></label>
        <textarea data-detail-field="activity" rows="2" placeholder="例如：到達岡山車站，轉搭新幹線到廣島車站">${escapeHtml(detail.activity)}</textarea>
      </div>
      <div class="detail-route-grid">
        <div class="field">
          <label>路線走法 <span>轉乘、出口或備註</span></label>
          <textarea data-detail-field="route" rows="2" placeholder="例如：JR 岡山站；車站東口往 JR 中央口">${escapeHtml(detail.route)}</textarea>
        </div>
        <div class="field">
          <label>交通方式</label>
          <select data-detail-field="transport">${transportSelect}</select>
        </div>
      </div>
      <details class="detail-extra">
        <summary>進階資訊 <span>費用與貨幣</span></summary>
        <div class="detail-extra-grid">
          <div class="field">
            <label>預估費用</label>
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
      </details>
    </div>
  </article>`;
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
  $("tripDetailsRows").innerHTML = state.tripEditorDetails.length
    ? state.tripEditorDetails.map((detail, index) => tripDetailHtml(normalizeTripDetail(detail, index), index)).join("")
    : '<div class="detail-empty"><strong>還沒有行程段落</strong><span>按右上角「新增一段行程」開始安排。</span></div>';
}

export function openTripPage() {
  $("productsPage").hidden = true;
  $("tripPage").hidden = false;
  if (!state.editingTripId && state.trips[0]) {
    state.editingTripId = state.trips[0].id;
    state.tripEditorDetails = state.tripDetails
      .filter((detail) => detail.tripId === state.editingTripId)
      .map(normalizeTripDetail);
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
    .map(normalizeTripDetail);
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
    Object.assign({}, normalizeTripDetail(detail, index), {
      tripId: trip.id,
      sortOrder: index,
      startDate: detail.date || detail.startDate || "",
      endDate: detail.date || detail.endDate || "",
      attraction: detail.location && detail.activity
        ? detail.location + "｜" + detail.activity
        : (detail.activity || detail.location || ""),
      transportType: detail.transport || detail.transportType || "",
      transportDetail: detail.route || detail.transportDetail || ""
    })
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
      .map(normalizeTripDetail);
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
