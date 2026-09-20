import { state } from "./state.js";
import { $, showToast } from "./utils.js";

function haversine(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadius = 6371000;
  const radians = (value) => value * Math.PI / 180;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const h = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

let notified = {};

export async function enableReminder() {
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

export function demoNear() {
  const product = state.products.find((item) => item.status === "pending" && item.lat && item.lng);
  if (product) {
    notified = {};
    showToast("模擬接近 " + (product.store || product.location) + "，已顯示位置提醒。", "good");
  }
}
