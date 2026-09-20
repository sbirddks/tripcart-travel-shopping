# AGENTS.md

## 專案定位

- 這是「生命會自己尋找出路」旅程管理網站，採原生 HTML、CSS 與 JavaScript ES modules，不使用前端框架。
- 主要功能固定為三個分頁：`旅程列表`、`旅程購物清單`、`用餐財務管理`。
- Supabase 是多人共享資料的主要來源；無法連線時才退回 JSON 種子資料與 localStorage。
- GitHub Pages 由 `main` 分支的專案根目錄發布；`dist/` 是本機建置驗證產物，已被 Git 忽略。
- 使用者可見文字以繁體中文為主。除非需求明確要求，不要改變網站名稱、主要資訊架構或既有操作流程。

## 開始工作前

1. 先執行 `git status --short --branch`，保留使用者既有變更，不要重設或覆寫不相關檔案。
2. 進行程式結構探索時，優先使用 codebase-memory MCP：`search_graph`、`trace_path`、`get_code_snippet`、`query_graph`、`search_code`。若索引沒有涵蓋目標檔案，再使用 `rg` 或直接讀檔。
3. 先確認需求影響哪個模組，不要把功能重新集中回 `app.js`。
4. 未被明確要求時，不要修改遠端 Supabase 資料、提交 Git、推送分支或部署 GitHub Pages。

## 檔案與模組責任

- `index.html`：頁面語意結構、表單欄位與可存取性標記；避免加入大型行內樣式或行內事件。
- `styles.css`：版面、元件、桌面與手機 RWD。
- `app.js`：應用程式啟動、全域事件註冊、分頁切換與跨模組協調。
- `js/state.js`：共用狀態、目前旅程與外部服務連線狀態。
- `js/data.js`：JSON、localStorage、Supabase 的讀寫、資料正規化與遠端列轉換。
- `js/auth.js`：Supabase 初始化、登入狀態與寫入權限檢查。
- `js/trips.js`：旅程列表、旅程檢視、Header/Daily plan 編輯、即時草稿預覽與收折狀態。
- `js/products.js`：旅程購物清單的篩選、顯示與 CRUD。
- `js/meals.js`：用餐／購物／玩樂／門票支出、共同成員與分攤結果。
- `js/reminders.js`：定位距離與鄰近提醒。
- `js/cloudinary.js`：商品圖片上傳。
- `js/utils.js`：DOM、格式化、HTML 安全轉義與提示訊息等共用工具。
- `data/*.json`：公開設定與離線種子資料。
- `supabase/schema.sql`、`supabase/*migration*`：資料庫結構、索引、RLS、Realtime 與既有專案遷移。

## 實作原則

- 維持原生 ES modules 與目前的模組邊界；除非有明確收益，不新增框架或依賴。
- JavaScript 維持現有風格：2 個空白縮排、分號、具描述性的 camelCase 命名。
- DOM 事件集中由 `app.js` 綁定；功能模組匯出可測試的操作函式，避免重複監聽。
- 所有由使用者或遠端資料產生的 HTML 必須透過 `escapeHtml` 或等效安全處理；不要直接插入未清理字串。
- 狀態先在 `state.js` 的共享模型中更新，再由對應 render 函式重繪；避免讓 DOM 成為唯一資料來源。
- 非同步操作要處理載入、失敗與復原狀態，並提供清楚的繁體中文提示；不要靜默吞掉錯誤。
- 保留 Supabase、JSON 與 localStorage 三種來源的資料正規化邏輯，避免遠端刷新覆蓋尚未完成的本機草稿。

## 產品行為不可破壞

- 旅程列表選擇旅程後，右側要顯示所有日期與完整行程，並可收折左側旅程清單。
- 編輯旅程時，Header 與 Daily plan 是分開的步驟／畫面。
- Daily plan 新增或修改一段行程後，要立即出現在上方可收折的草稿列表；草稿需持續暫存在 localStorage。
- 時間輸入使用小時與分鐘下拉選擇，分鐘以半小時為區間；沒有具體時間的資料仍需能顯示時段。
- 使用者完成整天行程並主動儲存後，才把完整旅程寫入 Supabase；成功後才清除相符的本機草稿。
- 用餐財務管理同時涵蓋 `用餐`、`購物`、`玩樂`、`門票`，保留日期、類型、地點、總消費金額、主要付款人、付款金額與參與者／分攤資訊。
- 財務頁上方要持續顯示消費筆數與分攤金額摘要；金額計算必須依幣別分開，避免不同幣別直接相加。

## Supabase 與資料安全

- 前端只能使用 Supabase URL 與 publishable/anon key；絕不可提交 `service_role` key、資料庫密碼、Cloudinary API secret 或其他私密憑證。
- Cloudinary 前端設定只允許 cloud name 與 unsigned upload preset。
- 維持「公開讀取、登入後寫入」的既有 RLS 邊界。任何新增或修改操作都必須先通過 `requireAuthentication()` 或等效權限檢查。
- 不可為了讓功能通過而關閉 RLS、使用 service role 繞過政策，或放寬到匿名寫入。
- 日期欄位送入 Postgres 前必須是合法 ISO 日期或 `null`。像 `5月14日(二)` 的顯示標籤應保存在對應文字資料中，不可直接寫入 `date` 欄位。
- 調整資料表時，同步更新 `supabase/schema.sql` 與適用的 migration，並檢查外鍵、索引、RLS policy、Realtime publication 及既有資料相容性。
- 遠端 Supabase 可能包含真實共享資料。驗證時預設只做讀取；若需求未明確授權，不建立、修改或刪除測試資料。

## RWD 與可用性

- 桌面版旅程明細可使用表格；窄螢幕（目前斷點約 `780px`）必須改成容易閱讀的卡片／堆疊版面。
- 手機寬度下不可依賴水平捲動才能看到時間、地點或行程內容；長文字要換行，欄位不可互相遮蓋。
- 修改旅程明細時，至少檢查約 390px 手機寬度與 1280px 桌面寬度。
- 按鈕與收折控制需有足夠觸控區域、清楚標籤及鍵盤焦點；只用圖示的按鈕要有 `aria-label`。
- Modal／drawer 應維持原有的關閉按鈕、遮罩點擊與 Esc 關閉行為；開啟後避免背景誤操作。

## 驗證方式

- JavaScript 或資料流程變更：執行 `npm run check`。
- 任何可發布內容變更：執行 `npm run build`，確認 `dist/` 能完整產生。
- 所有文字檔變更：執行 `git diff --check`。
- UI/RWD 變更：以 `npm run dev` 啟動 `http://localhost:4173`，實際檢查桌面與手機寬度、主要互動和瀏覽器 console。
- Supabase 相關變更：驗證未登入可讀、未登入不可寫、登入後可完成預期寫入；不要以降低政策作為修正方式。
- 功能變更至少走過受影響分頁的新增、編輯、刪除／取消與重新整理後狀態；旅程編輯另需測試草稿復原及整天儲存。
- 只有文件變更時，不必為了形式執行完整建置；`git diff --check` 與內容檢查即可。

## GitHub Pages 發布

- 只有使用者明確要求「更新／部署 GitHub Pages」時才發布。
- 發布前必須通過 `npm run check`、`npm run build`、`git diff --check`，並確認沒有意外檔案或機密資訊。
- 目前正式網址為 `https://sbirddks.github.io/tripcart-travel-shopping/`。
- 發布來源是 `main` 根目錄的原始靜態檔案，不要只提交被忽略的 `dist/`。
- 推送後需確認 Pages 部署成功，並實際開啟正式網址檢查頁面標題、更新內容、靜態資源與主要互動。

## Code review 重點

- 優先指出：機密外洩、RLS 放寬、未授權寫入、真實資料破壞、localStorage 草稿遺失、遠端刷新競態、日期格式錯誤、XSS、金額／幣別計算錯誤及手機水平溢位。
- 對行為改動要求具體驗證證據；不要只以建置成功取代實際 UI 與權限流程檢查。
