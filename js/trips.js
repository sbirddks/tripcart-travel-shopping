import { state } from "./state.js";
import { $, escapeHtml, money, showToast, slugifyTrip } from "./utils.js";
import { remoteReady, requireAuthentication } from "./auth.js";
import {
  ensureTripsFromProducts,
  loadRemoteProducts,
  saveProducts,
  clearTripDraftLocally,
  loadTripDraftLocally,
  saveTripToRemote,
  saveTripDraftLocally,
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
    hour: "",
    minute: "",
    activity: "",
    route: "",
    transport: "",
    cost: "",
    currency: "JPY",
    sortOrder: state.tripEditorDetails.length
  };
}

function parseTimeParts(time = "") {
  const value = String(time || "").trim();
  if (!value) return { hour: "", minute: "" };
  const colon = value.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  const chinese = value.match(/(\d{1,2})\s*點\s*(半|\d{1,2})?分?/);
  const matched = colon || chinese;
  if (!matched) return { hour: "", minute: "" };
  const hour = String(Number(matched[1]));
  const minuteValue = matched[2] === "半" ? 30 : Number(matched[2] || 0);
  if (Number(hour) < 0 || Number(hour) > 23 || minuteValue < 0 || minuteValue > 59) {
    return { hour: "", minute: "" };
  }
  return { hour, minute: String(minuteValue).padStart(2, "0") };
}

function normalizeTripDetail(detail = {}, index = 0) {
  const legacyAttraction = String(detail.attraction || "");
  const parts = legacyAttraction.split("｜");
  const time = detail.time || "";
  const parsedTime = parseTimeParts(time);
  return Object.assign({}, detail, {
    id: detail.id || "",
    date: detail.date || detail.startDate || "",
    location: detail.location || (parts.length > 1 ? parts.shift() : ""),
    period: detail.period || "",
    time,
    hour: detail.hour !== undefined && detail.hour !== null && detail.hour !== ""
      ? String(detail.hour)
      : parsedTime.hour,
    minute: detail.minute !== undefined && detail.minute !== null && detail.minute !== ""
      ? String(detail.minute).padStart(2, "0")
      : parsedTime.minute,
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
          <button class="link trip-action" data-trip-action="view" data-trip-id="${escapeHtml(trip.id)}" type="button">查看</button>
        </article>`;
      }).join("")
    : '<div class="empty">目前還沒有旅程，請先新增一個旅程。</div>';
}

function tripViewerRowHtml(detail, index) {
  const number = String(index + 1).padStart(2, "0");
  const timing = [detail.period, detail.time].filter(Boolean).join(" · ") || "—";
  return `<div class="trip-sheet-row">
    <span class="sheet-index">${number}</span>
    <span class="sheet-location" data-label="地點">${escapeHtml(detail.location || "—")}</span>
    <span class="sheet-timing" data-label="時段・時間">${escapeHtml(timing)}</span>
    <span class="sheet-activity" data-label="行程">${escapeHtml(detail.activity || "—")}</span>
    <span class="sheet-route" data-label="路線走法">${escapeHtml(detail.route || "—")}</span>
    <span class="sheet-transport" data-label="交通方式">${escapeHtml(detail.transport || "—")}</span>
    ${detail.cost ? `<small class="sheet-cost">${escapeHtml(money(detail.cost, detail.currency || "JPY"))}</small>` : ""}
  </div>`;
}

function tripDayHtml(date, details, dayIndex) {
  return `<section class="trip-day-group">
    <div class="trip-day-heading"><div><span>DAY ${String(dayIndex + 1).padStart(2, "0")}</span><strong>${escapeHtml(date || "未定日期")}</strong></div><em>${details.length} 段行程</em></div>
    <div class="trip-sheet-table">
      <div class="trip-sheet-header"><span>#</span><span>地點</span><span>時段・時間</span><span>行程</span><span>路線走法</span><span>交通方式</span></div>
      ${details.map(tripViewerRowHtml).join("")}
    </div>
  </section>`;
}

function tripViewerHtml(trip) {
  if (!trip) return '<div class="empty">選擇左側旅程查看完整行程。</div>';
  const details = state.tripDetails
    .filter((detail) => detail.tripId === trip.id)
    .map(normalizeTripDetail)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const dayMap = new Map();
  details.forEach((detail) => {
    const date = detail.date || "未定日期";
    const group = dayMap.get(date) || [];
    group.push(detail);
    dayMap.set(date, group);
  });
  const dates = [trip.startDate, trip.endDate].filter(Boolean).join(" ～ ") || "日期尚未設定";
  return `<div class="trip-viewer-head">
    <div><span class="eyebrow">Selected trip</span><h3>${escapeHtml(trip.name)}</h3><p>${escapeHtml(dates)} · ${escapeHtml(trip.primaryLocation || "尚未設定主要地點")}</p></div>
    <button class="primary" type="button" data-trip-action="edit" data-trip-id="${escapeHtml(trip.id)}">管理旅程</button>
  </div>
  <div class="trip-viewer-stats"><div><span>行程段落</span><strong>${details.length}</strong></div><div><span>旅程狀態</span><strong>${trip.persisted ? "共享旅程" : "本機旅程"}</strong></div><div><span>主要地點</span><strong>${escapeHtml(trip.primaryLocation || "—")}</strong></div></div>
  <div class="trip-viewer-list">${details.length ? Array.from(dayMap.entries()).map(([date, dayDetails], index) => tripDayHtml(date, dayDetails, index)).join("") : '<div class="detail-empty"><strong>還沒有行程段落</strong><span>按「管理旅程」開始加入每日安排。</span></div>'}</div>`;
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
  const hourOptions = ['<option value="">小時</option>']
    .concat(Array.from({ length: 24 }, (_, hour) => {
      const value = String(hour);
      return `<option value="${value}"${detail.hour === value ? " selected" : ""}>${value.padStart(2, "0")}</option>`;
    }))
    .join("");
  const minuteOptions = ["", "00", "30"].map((option) =>
    `<option value="${option}"${detail.minute === option ? " selected" : ""}>${option || "分鐘"}</option>`
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
          <div class="time-selects">
            <select data-detail-field="hour" aria-label="小時">${hourOptions}</select>
            <span>:</span>
            <select data-detail-field="minute" aria-label="分鐘">${minuteOptions}</select>
          </div>
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

function draftMatchesCurrentTrip(draft) {
  return Boolean(draft && (draft.tripId || "") === (state.editingTripId || ""));
}

function getEditorDraft() {
  const draft = state.tripEditorDraft || loadTripDraftLocally();
  return draftMatchesCurrentTrip(draft) ? draft : null;
}

function normalizedEditorDetails() {
  return state.tripEditorDetails.map((detail, index) => normalizeTripDetail(detail, index));
}

export function saveCurrentTripDraft() {
  if (!state.tripEditorMode || !$("tripForm")) return;
  const draft = {
    tripId: state.editingTripId || "",
    name: $("tripName").value.trim(),
    startDate: $("tripStartDate").value,
    endDate: $("tripEndDate").value,
    primaryLocation: $("tripPrimaryLocation").value.trim(),
    details: normalizedEditorDetails()
  };
  state.tripEditorDraft = draft;
  saveTripDraftLocally(draft);
  const status = $("tripDraftStatus");
  if (status) status.textContent = "草稿已暫存";
  renderTripDraftPreview();
}

export function renderTripDraftPreview() {
  const rows = $("tripDraftPreviewRows");
  const status = $("tripDraftPreviewStatus");
  if (!rows) return;
  const details = normalizedEditorDetails();
  const filledCount = details.filter((detail) => detail.date || detail.location || detail.activity || detail.time).length;
  if (status) status.textContent = `${filledCount} 段行程 · 輸入時自動暫存`;
  if (!details.length) {
    rows.innerHTML = '<div class="trip-draft-empty">新增行程後，這裡會即時整理成可確認的每日列表。</div>';
    return;
  }
  const dayMap = new Map();
  details.forEach((detail) => {
    const date = detail.date || "未定日期";
    const group = dayMap.get(date) || [];
    group.push(detail);
    dayMap.set(date, group);
  });
  rows.innerHTML = Array.from(dayMap.entries()).map(([date, dayDetails]) => `
    <section class="trip-draft-day">
      <div class="trip-draft-day-head"><strong>${escapeHtml(date)}</strong><span>${dayDetails.length} 段</span></div>
      ${dayDetails.map((detail, index) => {
        const timing = [detail.period, detail.time].filter(Boolean).join(" · ") || "未設定時間";
        return `<div class="trip-draft-row">
          <span class="trip-draft-index">${String(index + 1).padStart(2, "0")}</span>
          <div><strong>${escapeHtml(detail.location || "尚未填寫地點")}</strong><p>${escapeHtml(detail.activity || "尚未填寫行程")}</p></div>
          <span class="trip-draft-time">${escapeHtml(timing)}</span>
          <span class="trip-draft-transport">${escapeHtml(detail.transport || "未設定交通")}</span>
        </div>`;
      }).join("")}
    </section>`).join("");
}

function applyTripListCollapsedState() {
  const layout = document.querySelector(".trip-layout");
  const panel = document.querySelector(".trip-list-panel");
  const button = $("toggleTripList");
  if (!layout || !panel || !button) return;
  layout.classList.toggle("trip-list-collapsed", state.tripListCollapsed);
  panel.classList.toggle("is-collapsed", state.tripListCollapsed);
  button.textContent = state.tripListCollapsed ? "展開" : "收折";
  button.setAttribute("aria-expanded", String(!state.tripListCollapsed));
  button.setAttribute("aria-label", state.tripListCollapsed ? "展開旅程列表" : "收折旅程列表");
}

export function toggleTripList() {
  state.tripListCollapsed = !state.tripListCollapsed;
  applyTripListCollapsedState();
}

export function goToTripStep(step) {
  if (!state.tripEditorMode) return;
  if (step === "daily" && !$("tripName").value.trim()) {
    showToast("請先完成 Header 的旅程名稱。", "warn");
    $("tripName").focus();
    return;
  }
  saveCurrentTripDraft();
  state.tripEditorStep = step === "daily" ? "daily" : "header";
  renderTripPage();
}

export function renderTripPage() {
  renderTripList();
  applyTripListCollapsedState();
  const trip = state.trips.find((item) => item.id === state.editingTripId);
  const viewer = $("tripViewer");
  const editor = $("tripEditor");
  if (viewer) {
    viewer.innerHTML = tripViewerHtml(trip);
    viewer.hidden = state.tripEditorMode;
  }
  if (editor) editor.hidden = !state.tripEditorMode;

  const draft = state.tripEditorMode ? getEditorDraft() : null;
  const editorTrip = draft || trip || {};
  $("tripFormTitle").textContent = trip ? "編輯旅程" : "新增旅程";
  $("tripId").value = trip?.id || "";
  $("tripName").value = editorTrip.name || "";
  $("tripStartDate").value = editorTrip.startDate || "";
  $("tripEndDate").value = editorTrip.endDate || "";
  $("tripPrimaryLocation").value = editorTrip.primaryLocation || "";
  $("tripHeaderStepPanel").hidden = state.tripEditorStep !== "header";
  $("tripDailyStepPanel").hidden = state.tripEditorStep !== "daily";
  $("tripHeaderStep").classList.toggle("active", state.tripEditorStep === "header");
  $("tripDailyStep").classList.toggle("active", state.tripEditorStep === "daily");
  $("tripHeaderStep").setAttribute("aria-selected", String(state.tripEditorStep === "header"));
  $("tripDailyStep").setAttribute("aria-selected", String(state.tripEditorStep === "daily"));
  const status = $("tripDraftStatus");
  if (status) status.textContent = draft ? "草稿已暫存" : "草稿未暫存";
  $("tripDetailsRows").innerHTML = state.tripEditorDetails.length
    ? state.tripEditorDetails.map((detail, index) => tripDetailHtml(normalizeTripDetail(detail, index), index)).join("")
    : '<div class="detail-empty"><strong>還沒有行程段落</strong><span>按右上角「新增一段行程」開始安排。</span></div>';
  renderTripDraftPreview();
}

export function openTripPage() {
  $("productsPage").hidden = true;
  $("tripPage").hidden = false;
  state.activePage = "trips";
  state.tripEditorMode = false;
  state.tripEditorStep = "header";
  if ((!state.tripSelectionTouched || !state.editingTripId || !state.trips.some((trip) => trip.id === state.editingTripId)) && state.trips[0]) {
    const preferredTrip = state.trips.find((trip) => trip.id === "hiroshima-okayama-7d") || state.trips[0];
    state.editingTripId = preferredTrip.id;
    state.tripSelectionTouched = true;
    state.tripEditorDetails = state.tripDetails
      .filter((detail) => detail.tripId === state.editingTripId)
      .map(normalizeTripDetail);
  }
  renderTripPage();
}

export function closeTripPage() {
  $("tripPage").hidden = true;
  $("productsPage").hidden = false;
  state.activePage = "shopping";
}

export function newTripEditor() {
  if (!requireAuthentication()) return;
  state.editingTripId = null;
  state.tripEditorMode = true;
  state.tripEditorStep = "header";
  const savedDraft = loadTripDraftLocally();
  state.tripEditorDraft = draftMatchesCurrentTrip(savedDraft) ? savedDraft : null;
  state.tripEditorDetails = [blankTripDetail()];
  if (state.tripEditorDraft?.details?.length) {
    state.tripEditorDetails = state.tripEditorDraft.details.map(normalizeTripDetail);
  }
  renderTripPage();
}

export function selectTrip(id) {
  const trip = state.trips.find((item) => item.id === id);
  if (!trip) return;
  state.editingTripId = id;
  state.tripSelectionTouched = true;
  state.tripEditorMode = false;
  state.tripEditorStep = "header";
  state.tripEditorDraft = null;
  state.tripEditorDetails = state.tripDetails
    .filter((detail) => detail.tripId === id)
    .map(normalizeTripDetail);
  renderTripPage();
}

export function editTrip(id) {
  if (!requireAuthentication()) return;
  const trip = state.trips.find((item) => item.id === id);
  if (!trip) return;
  state.editingTripId = id;
  state.tripSelectionTouched = true;
  state.tripEditorMode = true;
  state.tripEditorStep = "header";
  const savedDraft = loadTripDraftLocally();
  state.tripEditorDraft = draftMatchesCurrentTrip(savedDraft) ? savedDraft : null;
  state.tripEditorDetails = state.tripDetails
    .filter((detail) => detail.tripId === id)
    .map(normalizeTripDetail);
  if (state.tripEditorDraft?.details?.length) {
    state.tripEditorDetails = state.tripEditorDraft.details.map(normalizeTripDetail);
  }
  if (!state.tripEditorDetails.length) state.tripEditorDetails = [blankTripDetail()];
  renderTripPage();
}

export function closeTripEditor() {
  state.tripEditorMode = false;
  state.tripEditorStep = "header";
  state.tripEditorDraft = null;
  renderTripPage();
}

export function addTripDetail() {
  if (!requireAuthentication()) return;
  state.tripEditorDetails.push(blankTripDetail());
  saveCurrentTripDraft();
  renderTripPage();
}

export function updateTripDetailField(event) {
  const field = event.target.closest("[data-detail-field]");
  const row = event.target.closest("[data-detail-index]");
  if (!field || !row) return;
  const detail = state.tripEditorDetails[Number(row.dataset.detailIndex)];
  if (!detail) return;
  const fieldName = field.dataset.detailField;
  detail[fieldName] = field.value;
  if (fieldName === "hour" || fieldName === "minute") {
    detail.time = detail.hour && detail.minute
      ? `${String(detail.hour).padStart(2, "0")}:${detail.minute}`
      : "";
  }
  saveCurrentTripDraft();
  renderTripDraftPreview();
}

export function removeTripDetail(event) {
  const button = event.target.closest('[data-detail-action="remove"]');
  if (!button) return;
  const row = button.closest("[data-detail-index]");
  state.tripEditorDetails.splice(Number(row.dataset.detailIndex), 1);
  saveCurrentTripDraft();
  renderTripPage();
}

export async function handleTripSubmit(event) {
  event.preventDefault();
  if (!requireAuthentication()) return;
  if (state.tripEditorStep !== "daily") {
    goToTripStep("daily");
    return;
  }
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
    state.tripSelectionTouched = true;
    state.tripEditorMode = false;
    state.tripEditorStep = "header";
    state.tripEditorDraft = null;
    clearTripDraftLocally();
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
