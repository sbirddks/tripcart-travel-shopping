# TripCart 旅遊購物清單

單頁旅遊購物網站原型，示範旅程與地區篩選、商品新增／編輯／刪除、Google Maps 連結，以及接近店家時的定位提醒。

## 資料結構

- `data/products.json`：商品名稱、描述、數量、單價、圖片、購買狀態與對應地點 ID。
- `data/locations.json`：地區／城市、店名、地址與 Google Maps 連結、定位座標。
- `data/trips.json`：旅程 header（旅程名稱、起迄日期、主要地點）。
- `data/trip-details.json`：旅程 detail（主要景點、起迄日、交通方式、班次與費用）。
- `data/cloudinary.json`：Cloudinary 圖片上傳設定（只放 cloud name 與 unsigned upload preset，不放 API secret）。
- `data/supabase.json`：Supabase 專案 URL 與 publishable key；publishable key 可放在前端，但不可放 service role key。
- `supabase/schema.sql`：Supabase 資料表、RLS 權限、Realtime 與初始資料腳本。
- `supabase/trips-migration.txt`：已建立既有 Supabase 專案時，新增旅程資料表所使用的一次性更新 SQL。
- `supabase/meal-finance-migration.sql`：既有專案新增用餐、購物、玩樂、門票與共同成員同步所使用的一次性更新 SQL。

啟用 Supabase 後，Supabase 是多人共享資料的主要來源；訪客可查看資料，登入後才能新增、編輯或刪除。若 Supabase 暫時無法連線，頁面會退回 JSON 與 localStorage 的本機模式。

## 前端程式結構

- `index.html`：只保留頁面結構與欄位，不再內嵌大型樣式或行內事件。
- `styles.css`：集中管理版面、元件與響應式樣式。
- `app.js`：應用程式入口與事件註冊，負責把各功能模組串起來。
- `js/state.js`：共用狀態與外部服務連線狀態。
- `js/data.js`：JSON、localStorage、Supabase 資料讀寫與資料轉換。
- `js/auth.js`、`js/cloudinary.js`：登入權限與 Cloudinary 圖片上傳。
- `js/products.js`、`js/trips.js`、`js/reminders.js`：商品、旅程與位置提醒功能。
- `js/utils.js`：DOM、格式化、HTML 安全轉義與提示訊息等共用工具。

## Supabase 多人共享設定

1. 新專案可在 Supabase SQL Editor 執行 `supabase/schema.sql`；既有專案執行 `supabase/trips-migration.txt` 與 `supabase/meal-finance-migration.sql`。
2. 確認 `data/supabase.json` 的 URL 與 publishable key 對應目前專案。
3. 網站右上角註冊／登入帳號；完成登入後即可共享編輯。
4. Supabase Authentication → Sign In / Providers 請關閉 `Confirm email`，讓註冊後可以立即登入。
5. Email 只作為登入帳號使用，網站不寄送註冊通知信。

`public.tripcart_users` 是登入帳號對應的網站使用者資料表，只保存 Email、顯示名稱、頭像網址與最近登入時間；密碼仍由 Supabase Auth 的 `auth.users` 管理，不會寫入前端資料表。新帳號會由資料庫 trigger 自動建立資料列，RLS 只允許登入者讀寫自己的使用者資料。

目前 RLS 設計為公開讀取、登入後寫入；商品會以旅程下拉選單選擇 `trip_id`，旅程則拆成 `trips` header 與 `trip_details` detail 兩張表。後續若要限制不同旅程的成員，可再加入 `trip_members` 表與旅程層級權限。

## Cloudinary 圖片上傳

1. 在 Cloudinary Console 建立一個 unsigned upload preset，建議限制圖片格式、檔案大小與上傳資料夾。
2. 將 `data/cloudinary.json` 的 `enabled` 改成 `true`，並填入 Cloudinary 的 `cloudName` 與 `uploadPreset`。
3. 在新增／編輯商品時選取圖片；儲存前頁面會先上傳圖片到 Cloudinary，再將回傳的 `secure_url` 寫入商品資料。

Cloudinary 的 cloud name 與 unsigned preset 會出現在前端，因此不要把 API secret 放進這個網站。若需要更嚴格的權限控管，應改用後端產生 signed upload。

原有 6 張示例圖片已遷移至 Cloudinary，`data/products.json` 目前直接保存 Cloudinary 圖片網址；之後新增或編輯商品時選取圖片，也會沿用相同的上傳流程。

## 本機預覽

因為瀏覽器安全限制，外部 JSON 不能以 `file://` 直接讀取。請在專案資料夾啟動任一個本機 HTTP 伺服器，再開啟 `index.html`。例如使用 VS Code Live Server，或使用其他可提供靜態檔案的 localhost 工具。

定位提醒在瀏覽器允許位置權限，並以 localhost 或 HTTPS 開啟時可完整運作。

## 建置與 VS Code 除錯

專案使用 `esbuild` 打包與壓縮 JavaScript／CSS，並使用 `http-server` 提供本地靜態伺服器：

- `npm install`：安裝依賴套件。
- `npm run dev`：在 `http://localhost:4173` 啟動原始碼開發頁面。
- `npm run check`：檢查 JavaScript 語法。
- `npm run build`：產生壓縮後的 `dist/` 發布檔案與 source map。
- `npm run preview`：在 `http://localhost:4174` 預覽 `dist/` 發布版本。

VS Code 可直接從「執行與偵錯」選擇 `TripCart: Chrome local debug`，啟動本地伺服器並以 Chrome 除錯；若要確認壓縮後版本，選擇 `TripCart: Chrome preview dist`。對應設定位於 `.vscode/tasks.json` 與 `.vscode/launch.json`。
