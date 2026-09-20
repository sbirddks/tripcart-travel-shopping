import { cloudinary } from "./state.js";

export async function loadCloudinaryConfig() {
  try {
    const response = await fetch("data/cloudinary.json");
    if (!response.ok) return;
    cloudinary.config = await response.json();
  } catch (error) {
    cloudinary.config = {};
  }
}

export function cloudinaryReady() {
  const config = cloudinary.config;
  return Boolean(
    config &&
    config.enabled &&
    config.cloudName &&
    config.uploadPreset &&
    !/YOUR_|REPLACE/i.test(config.cloudName + config.uploadPreset)
  );
}

export async function uploadImageToCloudinary(file) {
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
