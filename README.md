# TripCart 旅遊購物清單

單頁旅遊購物網站原型，示範旅程與地區篩選、商品新增／編輯／刪除、Google Maps 連結，以及接近店家時的定位提醒。

## 資料結構

- `data/products.json`：商品名稱、描述、數量、單價、圖片、購買狀態與對應地點 ID。
- `data/locations.json`：地區／城市、店名、地址與 Google Maps 連結、定位座標。
- `data/cloudinary.json`：Cloudinary 圖片上傳設定（只放 cloud name 與 unsigned upload preset，不放 API secret）。

頁面會先讀取上述 JSON，再將商品與地點資料合併顯示；使用者在頁面新增或編輯的資料會暫存在瀏覽器的 localStorage，保留本機操作結果。

## Cloudinary 圖片上傳

1. 在 Cloudinary Console 建立一個 unsigned upload preset，建議限制圖片格式、檔案大小與上傳資料夾。
2. 將 `data/cloudinary.json` 的 `enabled` 改成 `true`，並填入 Cloudinary 的 `cloudName` 與 `uploadPreset`。
3. 在新增／編輯商品時選取圖片；儲存前頁面會先上傳圖片到 Cloudinary，再將回傳的 `secure_url` 寫入商品資料。

Cloudinary 的 cloud name 與 unsigned preset 會出現在前端，因此不要把 API secret 放進這個網站。若需要更嚴格的權限控管，應改用後端產生 signed upload。

原有 6 張示例圖片已遷移至 Cloudinary，`data/products.json` 目前直接保存 Cloudinary 圖片網址；之後新增或編輯商品時選取圖片，也會沿用相同的上傳流程。

## 本機預覽

因為瀏覽器安全限制，外部 JSON 不能以 `file://` 直接讀取。請在專案資料夾啟動任一個本機 HTTP 伺服器，再開啟 `index.html`。例如使用 VS Code Live Server，或使用其他可提供靜態檔案的 localhost 工具。

定位提醒在瀏覽器允許位置權限，並以 localhost 或 HTTPS 開啟時可完整運作。
