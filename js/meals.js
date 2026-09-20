import { state } from "./state.js";
import { $, escapeHtml, money, showToast } from "./utils.js";
import { authenticated, remoteReady, requireAuthentication } from "./auth.js";
import {
  deleteMealFromRemote,
  saveMealPeopleToRemote,
  saveMealPlansLocally,
  saveMealToRemote
} from "./data.js";

const mealTypes = ["用餐", "購物", "玩樂", "門票"];

function selectedTrip() {
  return state.trips.find((trip) => trip.id === state.mealTripId) || state.trips[0];
}

function selectedMeals() {
  const tripId = state.mealTripId;
  return state.meals.filter((meal) => !tripId || meal.tripId === tripId);
}

function allPeople() {
  const names = [...state.mealPeople];
  state.meals.forEach((meal) => {
    if (meal.payer) names.push(meal.payer);
    (meal.participants || []).forEach((person) => names.push(person));
  });
  return Array.from(new Set(names.map((name) => String(name).trim()).filter(Boolean)));
}

function currentFormParticipants() {
  return Array.from(document.querySelectorAll('#mealParticipants input[type="checkbox"]:checked'))
    .map((input) => input.value);
}

function mealPlace(meal) {
  return meal.place || meal.restaurant || "";
}

function tripOptions() {
  const options = state.trips.map((trip) =>
    `<option value="${escapeHtml(trip.id)}">${escapeHtml(trip.name)}</option>`
  ).join("");
  return options || '<option value="">請先建立旅程</option>';
}

function renderParticipantControls() {
  const people = allPeople();
  const participantBox = $("mealParticipants");
  const payer = $("mealPayer");
  if (!participantBox || !payer) return;

  participantBox.innerHTML = people.length
    ? people.map((person) => `<label class="participant-option">
        <input type="checkbox" value="${escapeHtml(person)}"${state.mealFormParticipants.includes(person) ? " checked" : ""}>
        <span>${escapeHtml(person)}</span>
      </label>`).join("")
    : '<span class="participant-empty">先在左側輸入共同成員，再選擇分攤對象。</span>';

  const currentPayer = payer.value;
  payer.innerHTML = '<option value="">請選擇付款人</option>' + people.map((person) =>
    `<option value="${escapeHtml(person)}">${escapeHtml(person)}</option>`
  ).join("");
  if (people.includes(currentPayer)) payer.value = currentPayer;
}

function renderMealSummary() {
  const meals = selectedMeals();
  const totals = new Map();
  meals.forEach((meal) => {
    totals.set(meal.currency, (totals.get(meal.currency) || 0) + Number(meal.amount || 0));
  });
  const totalText = totals.size === 1
    ? money([...totals.values()][0], [...totals.keys()][0])
    : totals.size > 1
      ? [...totals.entries()].map(([currency, total]) => money(total, currency)).join(" ／ ")
      : "—";
  const peopleCount = allPeople().length;
  const averageText = totals.size === 1 && peopleCount
    ? money([...totals.values()][0] / peopleCount, [...totals.keys()][0])
    : "—";
  $("mealTotal").textContent = totalText;
  $("mealCount").textContent = meals.length;
  $("mealAverage").textContent = averageText;
  $("mealTripLabel").textContent = selectedTrip()?.name || "尚未選擇旅程";
}

function mealRecordHtml(meal) {
  const participants = (meal.participants || []).join("、") || "尚未設定分攤對象";
  const amount = Number(meal.amount || 0) ? money(meal.amount, meal.currency) : "待估算";
  const paidAmount = Number(meal.paidAmount ?? meal.amount ?? 0) ? money(meal.paidAmount ?? meal.amount, meal.currency) : "待記錄";
  return `<article class="meal-record">
    <div class="meal-record-date"><strong>${escapeHtml(meal.date || "未定日期")}</strong><span>${escapeHtml(meal.mealType || "用餐")}</span></div>
    <div class="meal-record-main">
      <div class="meal-record-title"><h4>${escapeHtml(mealPlace(meal) || "尚未填寫地點")}</h4><strong>${amount}</strong></div>
      <p>主要付款人：${escapeHtml(meal.payer || "尚未設定")} · 付款金額：${paidAmount}</p>
      <small>分攤：${escapeHtml(participants)}${meal.note ? ` · ${escapeHtml(meal.note)}` : ""}</small>
    </div>
    <div class="meal-record-actions">
      <button class="link" type="button" data-meal-action="edit" data-meal-id="${escapeHtml(meal.id)}">編輯</button>
      <button class="danger" type="button" data-meal-action="delete" data-meal-id="${escapeHtml(meal.id)}">刪除</button>
    </div>
  </article>`;
}

function settlementByCurrency() {
  const people = allPeople();
  const grouped = new Map();
  selectedMeals().forEach((meal) => {
    const currency = meal.currency || "JPY";
    const group = grouped.get(currency) || new Map();
    grouped.set(currency, group);
    const participants = meal.participants?.length ? meal.participants : (meal.payer ? [meal.payer] : []);
    const share = Number(meal.amount || 0) / Math.max(participants.length, 1);
    participants.forEach((person) => {
      const entry = group.get(person) || { paid: 0, share: 0 };
      entry.share += share;
      group.set(person, entry);
    });
    if (meal.payer) {
      const entry = group.get(meal.payer) || { paid: 0, share: 0 };
      entry.paid += Number(meal.paidAmount ?? meal.amount ?? 0);
      group.set(meal.payer, entry);
    }
  });
  return Array.from(grouped.entries()).map(([currency, balances]) => ({ currency, balances, people }));
}

function renderSettlement() {
  const groups = settlementByCurrency();
  const container = $("mealSettlement");
  if (!container) return;
  if (!groups.length) {
    container.innerHTML = '<div class="settlement-empty">新增消費金額並設定付款人與分攤對象後，這裡會顯示每人的應收付。</div>';
    return;
  }

  container.innerHTML = groups.map(({ currency, balances, people }) => {
    const names = Array.from(new Set([...people, ...balances.keys()]));
    return `<div class="settlement-group">
      <div class="settlement-group-head"><strong>${escapeHtml(currency)} 分攤試算</strong><span>正數代表應收，負數代表應付</span></div>
      <div class="settlement-table">
        ${names.map((person) => {
          const entry = balances.get(person) || { paid: 0, share: 0 };
          const balance = entry.paid - entry.share;
          return `<div class="settlement-row">
            <strong>${escapeHtml(person)}</strong>
            <span>已付 ${money(entry.paid, currency)}</span>
            <span>應分 ${money(entry.share, currency)}</span>
            <b class="${balance >= 0 ? "receive" : "pay"}">${balance >= 0 ? "應收 " : "應付 "}${money(Math.abs(balance), currency)}</b>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  }).join("");
}

export function renderMealPage() {
  const tripFilter = $("mealTripFilter");
  if (!tripFilter) return;
  if (!state.mealTripId || !state.trips.some((trip) => trip.id === state.mealTripId)) {
    state.mealTripId = state.editingTripId || state.trips[0]?.id || "";
  }
  if (Object.prototype.hasOwnProperty.call(state.mealPeopleByTrip, state.mealTripId)) {
    state.mealPeople = state.mealPeopleByTrip[state.mealTripId] || [];
  }
  tripFilter.innerHTML = tripOptions();
  tripFilter.value = state.mealTripId;
  $("mealPeople").value = state.mealPeople.join("\n");
  renderParticipantControls();
  renderMealSummary();
  $("mealRecords").innerHTML = selectedMeals().length
    ? selectedMeals().map(mealRecordHtml).join("")
    : '<div class="meal-empty"><strong>還沒有消費紀錄</strong><span>先輸入成員與地點，再新增第一筆規劃。</span></div>';
  renderSettlement();
}

export async function saveMealPeople() {
  if (remoteReady() && !authenticated()) {
    requireAuthentication();
    return;
  }
  const people = $("mealPeople").value
    .split(/[\n,，、]+/)
    .map((person) => person.trim())
    .filter(Boolean);
  state.mealPeople = Array.from(new Set(people));
  state.mealPeopleByTrip[state.mealTripId] = state.mealPeople;
  saveMealPlansLocally();
  try {
    if (remoteReady()) await saveMealPeopleToRemote(state.mealTripId, state.mealPeople);
  } catch (error) {
    console.error(error);
    renderMealPage();
    showToast("共同成員已保留在本機，但 Supabase 同步失敗。", "warn");
    return;
  }
  renderMealPage();
  showToast(remoteReady() ? "共同成員已同步到 Supabase" : "共同成員已更新", "good");
}

export function resetMealForm() {
  $("mealForm").reset();
  $("mealId").value = "";
  $("mealTripFilter").value = state.mealTripId;
  $("mealCurrency").value = "JPY";
  state.mealFormParticipants = [];
  $("mealFormTitle").textContent = "新增消費紀錄";
  $("saveMeal").textContent = "儲存消費紀錄";
  renderParticipantControls();
}

export function editMeal(id) {
  const meal = state.meals.find((item) => item.id === id);
  if (!meal) return;
  state.mealTripId = meal.tripId;
  state.mealFormParticipants = meal.participants || [];
  renderMealPage();
  $("mealId").value = meal.id;
  $("mealDate").value = meal.date || "";
  $("mealType").value = meal.mealType || "用餐";
  $("mealRestaurant").value = mealPlace(meal);
  $("mealAmount").value = meal.amount ?? "";
  $("mealCurrency").value = meal.currency || "JPY";
  $("mealPayer").value = meal.payer || "";
  $("mealPaidAmount").value = meal.paidAmount ?? meal.amount ?? "";
  $("mealNote").value = meal.note || "";
  $("mealFormTitle").textContent = "編輯消費紀錄";
  $("saveMeal").textContent = "更新消費紀錄";
  renderParticipantControls();
  $("mealRestaurant").focus();
}

export async function handleMealSubmit(event) {
  event.preventDefault();
  if (remoteReady() && !authenticated()) {
    requireAuthentication();
    return;
  }
  const tripId = $("mealTripFilter").value;
  if (!tripId) {
    showToast("請先建立或選擇旅程。", "warn");
    return;
  }
  const participants = currentFormParticipants();
  const payer = $("mealPayer").value;
  if (!participants.length && payer) participants.push(payer);
  if (!participants.length) {
    showToast("請至少選擇一位分攤成員。", "warn");
    return;
  }
  const id = $("mealId").value || "meal-" + Date.now();
  const record = {
    id,
    tripId,
    date: $("mealDate").value,
    mealType: $("mealType").value,
    place: $("mealRestaurant").value.trim(),
    amount: Number($("mealAmount").value) || 0,
    currency: $("mealCurrency").value,
    payer,
    paidAmount: $("mealPaidAmount").value === ""
      ? (Number($("mealAmount").value) || 0)
      : Number($("mealPaidAmount").value) || 0,
    participants,
    note: $("mealNote").value.trim()
  };
  const index = state.meals.findIndex((meal) => meal.id === id);
  if (index >= 0) state.meals[index] = record;
  else state.meals.unshift(record);
  state.mealTripId = tripId;
  saveMealPlansLocally();
  try {
    if (remoteReady()) await saveMealToRemote(record);
  } catch (error) {
    console.error(error);
    resetMealForm();
    renderMealPage();
    showToast("消費紀錄已保留在本機，但 Supabase 同步失敗。", "warn");
    return;
  }
  resetMealForm();
  renderMealPage();
  showToast(
    remoteReady()
      ? (index >= 0 ? "消費紀錄已更新並同步" : "消費紀錄已新增並同步")
      : (index >= 0 ? "消費紀錄已更新" : "消費紀錄已新增"),
    "good"
  );
}

export async function handleMealAction(event) {
  const action = event.target.closest("[data-meal-action]");
  if (!action) return;
  const id = action.dataset.mealId;
  if (action.dataset.mealAction === "edit") editMeal(id);
  if (action.dataset.mealAction === "delete") {
    const meal = state.meals.find((item) => item.id === id);
    if (remoteReady() && !authenticated()) {
      requireAuthentication();
      return;
    }
    if (!meal || !window.confirm(`確定刪除「${mealPlace(meal) || "這筆消費紀錄"}」嗎？`)) return;
    state.meals = state.meals.filter((item) => item.id !== id);
    saveMealPlansLocally();
    try {
      if (remoteReady()) await deleteMealFromRemote(id);
    } catch (error) {
      console.error(error);
      renderMealPage();
      showToast("消費紀錄已從本機移除，但 Supabase 刪除失敗。", "warn");
      return;
    }
    resetMealForm();
    renderMealPage();
    showToast(remoteReady() ? "消費紀錄已刪除並同步" : "消費紀錄已刪除", "good");
  }
}
