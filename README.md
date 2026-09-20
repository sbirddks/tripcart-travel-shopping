# TripCart 旅遊購物清單

單頁旅遊購物網站原型，示範旅程與地區篩選、商品新增／編輯／刪除、Google Maps 連結，以及接近店家時的定位提醒。

## 資料結構

- `data/products.json`：商品名稱、描述、數量、單價、圖片、購買狀態與對應地點 ID。
- `data/locations.json`：地區／城市、店名、地址與 Google Maps 連結、定位座標。
- `assets/images/`：商品圖片素材。

頁面會先讀取上述 JSON，再將商品與地點資料合併顯示；使用者在頁面新增或編輯的資料會暫存在瀏覽器的 localStorage，保留本機操作結果。

## 本機預覽

因為瀏覽器安全限制，外部 JSON 不能以 `file://` 直接讀取。請在專案資料夾啟動任一個本機 HTTP 伺服器，再開啟 `index.html`。例如使用 VS Code Live Server，或使用其他可提供靜態檔案的 localhost 工具。

定位提醒在瀏覽器允許位置權限，並以 localhost 或 HTTPS 開啟時可完整運作。
