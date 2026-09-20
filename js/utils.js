export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;"
  }[character]));
}

export function money(value, currency) {
  const symbols = { JPY: "¥", TWD: "NT$", USD: "$" };
  return (symbols[currency] || (currency || "") + " ") + Number(value || 0).toLocaleString("en-US");
}

export function total(product) {
  return Number(product.qty || 0) * Number(product.unitPrice || 0);
}

export function slugifyTrip(name) {
  return String(name || "trip").trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "") || "trip";
}

export function fillSelect(select, values, allLabel) {
  const oldValue = select.value;
  select.innerHTML = '<option value="all">' + allLabel + "</option>" +
    values.map((value) => '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + "</option>").join("");
  if (values.includes(oldValue)) select.value = oldValue;
}

export function showToast(message, type = "good") {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = "toast show " + type;
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => { toast.className = "toast"; }, 4800);
}
