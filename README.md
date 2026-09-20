# TripCart 旅遊購物清單

單頁旅遊購物網站原型，示範旅程與地區篩選、商品新增／編輯／刪除、Google Maps 連結，以及接近店家時的定位提醒。

## 資料結構

- `data/products.json`：商品名稱、描述、數量、單價、圖片、購買狀態與對應地點 ID。
- `data/locations.json`：地區／城市、店名、地址與 Google Maps 連結、定位座標。
- `data/cloudinary.json`：Cloudinary 圖片上傳設定（只放 cloud name 與 unsigned upload preset，不放 API secret）。
- `data/supabase.json`：Supabase 專案 URL 與 publishable key；publishable key 可放在前端，但不可放 service role key。
- `supabase/schema.sql`：Supabase 資料表、RLS 權限、Realtime 與初始資料腳本。

啟用 Supabase 後，Supabase 是多人共享資料的主要來源；訪客可查看資料，登入後才能新增、編輯或刪除。若 Supabase 暫時無法連線，頁面會退回 JSON 與 localStorage 的本機模式。

## Supabase 多人共享設定

1. 在 Supabase SQL Editor 執行 `supabase/schema.sql`。
2. 確認 `data/supabase.json` 的 URL 與 publishable key 對應目前專案。
3. 網站右上角註冊／登入帳號；完成登入後即可共享編輯。
4. Supabase Auth 的 Email 驗證若有開啟，註冊後要先完成信箱驗證。

`public.tripcart_users` 是登入帳號對應的網站使用者資料表，只保存 Email、顯示名稱、頭像網址與最近登入時間；密碼仍由 Supabase Auth 的 `auth.users` 管理，不會寫入前端資料表。新帳號會由資料庫 trigger 自動建立資料列，RLS 只允許登入者讀寫自己的使用者資料。

目前 RLS 設計為公開讀取、登入後寫入；後續若要限制不同旅程的成員，可再加入 `trip_members` 表與旅程層級權限。

## Cloudinary 圖片上傳

1. 在 Cloudinary Console 建立一個 unsigned upload preset，建議限制圖片格式、檔案大小與上傳資料夾。
2. 將 `data/cloudinary.json` 的 `enabled` 改成 `true`，並填入 Cloudinary 的 `cloudName` 與 `uploadPreset`。
3. 在新增／編輯商品時選取圖片；儲存前頁面會先上傳圖片到 Cloudinary，再將回傳的 `secure_url` 寫入商品資料。

Cloudinary 的 cloud name 與 unsigned preset 會出現在前端，因此不要把 API secret 放進這個網站。若需要更嚴格的權限控管，應改用後端產生 signed upload。

原有 6 張示例圖片已遷移至 Cloudinary，`data/products.json` 目前直接保存 Cloudinary 圖片網址；之後新增或編輯商品時選取圖片，也會沿用相同的上傳流程。

## 本機預覽

因為瀏覽器安全限制，外部 JSON 不能以 `file://` 直接讀取。請在專案資料夾啟動任一個本機 HTTP 伺服器，再開啟 `index.html`。例如使用 VS Code Live Server，或使用其他可提供靜態檔案的 localhost 工具。

定位提醒在瀏覽器允許位置權限，並以 localhost 或 HTTPS 開啟時可完整運作。
