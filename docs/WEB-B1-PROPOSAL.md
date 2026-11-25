# WEB-B1｜第一批網頁製作：範圍與驗收條件提案 v0.4（草案）

> ⚠️ **本 PoC 適用說明**：本 Repository 沒有 `pages.yml`、`release.yml`、`site/` 或網站建置步驟；本提案**不**新增任何部署或發行流程。GitHub Settings 已啟用 Pages，若發佈來源為 `main`，合併後的檔案仍可能被公開（D-W6）。

> 狀態：**文件審查通過（PR #22 R2，Reviewed Head `0018b11`），已合併**。2026-11-25 負責人更正 D-W1：網站的 repository 是 **`hsuanyu9503/Classroom-Manager-ver.Next`**，下文中的 `Classroom-Managerment-Next` 都以此為準。D-W4～D-W8 依建議。
> v0.2（2026-11-24）：負責人已決定 D-W1（另一個 repository：`hsuanyu9503/Classroom-Managerment-Next`）、D-W2（同意讀取既有規格）、D-W3（採用 §3 的候選流程），並要求送審與開 PR。D-W4～D-W8 仍是 Claude 的建議，待負責人確認。既有規格的讀取結果見 §2.1。
> v0.3（2026-11-24）：回應 PR #22 審查——REV22-01（開發身分與本機服務的啟動契約，§2.2）、REV22-02（結果不明時的規則，§3.1），以及三個小項目（待確認項目統一為 D-W4～D-W8；POC-002 改列為參考案例；「版本 6」限定在重設後的初始測資）。
> v0.4（2026-11-24）：回應 PR #22 R1 複審（Head `eec0c83`）——REV22-01 殘項：靜態首頁的頂層導航與 API 的 POST 分開規定；REV22-02 殘項：結果不明後重送時，仍可能因身分或授權失效而被拒絕。另外補上授權規格的明確連結，並說明離開頁面的提示只是盡力提醒。
> 依據：
> - 負責人的順序「先完成 B4，再開始網頁」（2026-11-24）；
> - B4 已完成約定的 Emulator／hosted 驗證（`docs/stage2/S2B2-B4-REPORT.md` §12）；
> - ADR-001（暫定 Firebase）；`S2B2-B3-CLOSEOUT.md` §3「方向 B」。
>
> **規格衝突（依 CLAUDE.md 先提出，不自行選擇）**：
> - `SPEC.md` §1 寫明本 repository「**不是**正式班級管理網站」；
> - `SPEC.md` §4 寫明「**不**開始網站頁面製作」；
> - `DESIGN.md` 仍是範本（D0.1）。
>
> 處理（v0.2）：負責人指定網站在**另一個 repository**（D-W1），所以本 repository 的 SPEC §1／§4「不是網站、不製作頁面」**仍然成立**，只在 §4 加註網站的位置。網站本身的 SPEC 與 DESIGN，在新的 repository 中另外建立，送審之後才實作。
>
> 不授權：正式資料、正式雲端環境、部署、開啟 PASS、修改 Settings。

## 1. 目前已驗證、可以接上的能力

只在**本機 Emulator** 與 hosted（`UNATTESTED`）中驗證過，不是正式環境。

| 能力 | API | 已驗證的案例 | 可以用在網頁 |
|---|---|---|---|
| 班級點名名冊、點名明細（唯讀） | `POST /v1/read`：`attendanceSession.read` | POC-001（只回傳本工作空間的資料） | 可以 |
| 點名摘要計數 | `attendanceSummary.read` | POC-008（P／R／N／U 與合計） | 可以 |
| 沒有權限、資料不存在 | 同上 | POC-002 是**參考案例**：它只驗證了 POC-002 使用的路由與目標。網站用到的每一條路由，都要在網站自己的測試中，另外驗證「沒有權限」與「不存在」的回應相同（§4 功能 6） | 可以；用於錯誤畫面 |
| 請假摘要（唯讀） | `leaveRecord.read` | POC-009：讀取部分已驗證 | 可以；**不顯示**「請假適用」，因為 G-1／G-4 阻擋 |
| 請假更正（AM→全天） | `POST /v1/commit` | POC-016（原子提交） | 可以 |
| 兩台裝置同時更正 | 同上 | POC-017（一方成功、一方 `VERSION_CONFLICT`） | 可以；衝突畫面 |
| 重送不重複 | 同上 | POC-018（同一個 `operationId`，同一份收據） | 可以；送出按鈕的防重複 |
| 回應遺失後恢復 | `POST /v1/receipt` | POC-021 | 可以；「確認是否已送出」 |

**不能接**（阻擋或尚未驗證）：
- 請假適用提示：G-1、G-4；
- 投影模式：G-9；
- 敏感備註：G-10、D-06／D-15；
- 匯出：D-08；
- 草稿、離線、共用 iPad 切帳：Stage 4；
- 名冊管理與成員管理：分支 W 尚未實作；
- 正式登入：只有 Auth Emulator 的模式，沒有正式的 token 驗證。

## 2. 開始前需要負責人決定

| # | 決定事項 | Claude 的建議 |
|---|---|---|
| D-W1 | **在哪個 repository 開發** | **已決定**：`hsuanyu9503/Classroom-Managerment-Next`（2026-11-24 時是空的 repository，沒有任何 commit）。本 session 目前只有唯讀；實作時需要 push 權限 |
| D-W2 | **既有產品與設計規格** | **已決定：同意讀取**。結果見 §2.1：讀到 `Homework-manager-` v2.103；**M02-04／M02-05 沒有找到** |
| D-W3 | **第一個使用者流程** | **已決定**：§3 的候選批次（點名名冊與請假更正，只限導師、單一班級） |
| D-W4 | **資料** | 只用 Stage 1 的固定虛構測資；不接任何真實學生資料 |
| D-W5 | **後端** | 本機 Emulator 加上已驗證的受控 API（`/v1/read`、`/v1/commit`、`/v1/receipt`），版本固定，見 §2.2；不建立正式的 Firebase 專案，不部署 |
| D-W6 | **公開風險** | 網頁只在本機執行；不使用 Pages 發佈；Pages 是否保留由你決定 |
| D-W7 | **技術** | 沿用 `Homework-manager-` 的作法：不需要建置步驟的原生 HTML、CSS、JS，沒有 CDN 或外部套件；測試用 Playwright（`Homework-manager-` 已在測試中使用） |
| D-W8 | **（v0.2 新增）網站如何連到受控 API** | 受控 API 與 Emulator 在 `class-management-next/poc/stage2` 中，只在本機執行。網站 repository 用一個**只供開發的啟動器與本機代理**連接，契約見 §2.2。API 的程式碼不複製到網站 repository |

### 2.1 既有規格的讀取結果（D-W2，唯讀，2026-11-24）

- **`hsuanyu9503/Homework-manager-`**：commit `cdaf91e`，Classroom Manager v2.103。
  - 這是單一頁面的網站（`index.html`、`style.css`、`app.js`），資料存在瀏覽器的 localStorage／IndexedDB，以 GitHub Pages 部署。
  - 規格只寫在 README 的版本紀錄中，沒有獨立的規格文件。
- **M02-04／M02-05：在該 repository 中找不到這兩個編號。標示為「原文缺失，待確認」**：
  - 不推測其內容；
  - 請負責人提供文件，或指出所在位置。
- **可以沿用的既有慣例**（這些不是 M02 的正式規格，只是現有網站的作法；採用與否在網站 repository 的 DESIGN 中定案）：
  - 色彩 tokens：`--bg #f7fbff`、`--surface #fff`、`--text #243047`、`--muted #718096`、`--line #e3ebf6`、`--primary #6c63ff`、`--danger #e95d7b`、`--warning #e8922f`、`--success #26a879`；`--radius 18px`；字型 `system-ui … "Noto Sans TC"`；
  - 版面：以 iPad 橫向為主（例如 1408 × 1056），窄螢幕改成兩欄或單欄，長名稱換行；
  - 互動：
    - Escape 或「返回」可以關閉，關閉後焦點回到原按鈕；
    - 視窗內 Tab 焦點循環；
    - 尊重減少動畫的系統偏好；
    - 狀態有文字與語意標籤；
  - 資料安全：多分頁同時修改時，顯示持續的警示，提供「重新載入最新資料」。這與 W1 的 `VERSION_CONFLICT` 畫面是同一種使用者體驗，可以沿用文字與流程。
- **與 W1 不同、**不**沿用的部分**：
  - 既有網站的出缺席登記，會「連動前一個實際上課日的作業」；
  - W1 是受控 API 的新資料模型（請假不得自動改寫點名，`noAutomaticAttendanceRewriteFromLeave`），**不**把既有的連動規則帶入；
  - 是否、如何與既有網站整合，**不在** W1 範圍內，另行決定。

### 2.2 開發身分與本機服務的契約（v0.3，REV22-01）

受控 API 每一次請求都驗證 Auth Emulator 的 Bearer token，並依權威文件重新授權。測試世界、使用者與 token，由 `poc/stage2/src/harness.mjs` 的 `seedWorld`／`signIn`／`startStack` 建立。網站沿用這套機制，**不**新增登入功能。

**對接的 API 版本**：
- 固定為 `class-management-next` main `1e20989ea6393c12dd18e11db617873c297a9f4a`（PR #21 合併；受控 API 與判定程式等於已審查的 `f9097dd`，最後受保護版本 `971a7d3`）；
- 啟動器在執行前確認：
  - 該 checkout 的 `git rev-parse HEAD` 等於這個 commit；
  - `poc/stage2` 沒有未提交的修改；
  - 不符就拒絕啟動。
- 要換成其他版本，必須另外送審。

**啟動、測資、重設與停止**：
- 由網站 repository 的**開發用啟動器**負責（一個本機 CLI，只在開發者的電腦上執行；不是網頁的功能）：
  1. 檢查 Emulator、受控 API、代理用到的 port 都是關閉的；
  2. 在 `firebase emulators:exec` 中，以 `class-management-next` 的 harness 建立一個**全新**的虛構測試世界：Stage 1 的固定測資；
  3. 啟動 back 代理 → 受控 API → front 代理；
  4. 啟動網站的本機代理（下述）。
- **重設**：停止後重新啟動，就是一個全新的世界。網頁上**沒有**重設的功能。
- **停止**：結束啟動器；Emulator、API 與代理一起關閉；結束後再次確認 port 都已關閉。
- 這些責任屬於開發者／測試程式，不屬於網頁。

**測試情境與身分**：每次啟動只載入**一個**情境，情境名稱顯示在頁面頂端的標示中。

| 情境 | 身分（actor） | 資料 | 可以做的事 |
|---|---|---|---|
| `S-ROSTER-A17` | `ACTOR-TEACHER` | `WS-A17`／`CLASS-606-A17` | P1 名冊與點名摘要（唯讀） |
| `S-LEAVE-SC01` | `ACTOR-SC01-TEACHER` | `WS-SC01`／`CLASS-606-SC01` | P1（該班的名冊）、P2、P3、P4 |
| `S-DENY` | `ACTOR-OTHER` | 沒有任何 membership | 只用於「沒有權限」的測試 |

- 這三個情境是**分開的**執行：
  - 頁面不能把兩個情境拼成同一個班級或同一個身分；
  - 頁面沒有切換身分的功能；
  - 要換情境，必須停止並重新啟動。

**token 的處理**：
- 只有該情境 actor 的一個短期 Auth Emulator token，**只存在本機代理的記憶體中**。代理在轉送時，替請求加上 `Authorization` 標頭。
- **頁面從頭到尾都拿不到 token**：
  - 不寫入 localStorage、sessionStorage、IndexedDB 或 cookie；
  - 不在網址、記錄檔或畫面中出現。
- 頁面送來的 `Authorization` 標頭一律丟棄。
- owner 權限（Emulator 的管理權）、其他 actor 的憑證、密碼，都**不會**進入代理或頁面；它們只留在啟動器的 harness 中。
- 停止啟動器時，token 隨程序結束而消失。Emulator 的 token 大約 1 小時後失效；失效後，所有請求都會得到 `FORBIDDEN`，需要重新啟動。

**本機代理的邊界**：
- 只監聽 `127.0.0.1`。
- upstream 固定為 front 代理（`http://127.0.0.1:18301`），**不**接受任何指定目的地的參數。
- **所有請求**：`Host` 必須是 `127.0.0.1:<port>` 或 `localhost:<port>`，用來防止 DNS rebinding；不符就回 403。
- **靜態檔案的 `GET`／`HEAD`**（v0.4 分開規定）：
  - 只提供網站 repository 中允許清單上的靜態檔案（例如 `/`、`/index.html`、`/style.css`、`/app.js`）；不在清單中就 404；
  - **允許正常的頂層導航**：使用者直接在網址列輸入或開啟書籤時，瀏覽器送出的 `Sec-Fetch-Site` 是 `none`（[W3C Fetch Metadata §2.3](https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-site-header)），這種請求要正常回應。不對靜態 `GET` 套用 API 的同源限制；
  - 靜態回應**不含** token 或任何測試資料，也**不會**觸發任何 API 呼叫或寫入；
  - 不轉送給 upstream。
- **API 的 `POST`**（限制不因首頁而放寬）：
  - 只接受剛好這三個路徑：`/v1/read`、`/v1/commit`、`/v1/receipt`；
  - `Content-Type: application/json`，請求本體上限 64 KiB；
  - `Origin` **必須存在**，而且等於代理自己的來源；
  - 有 `Sec-Fetch-Site` 時必須是 `same-origin`；
  - 不符就回 403，**不轉送**。
- 其他的方法或路徑一律 404，不轉送。
- 不送出任何 CORS 標頭。
- 上面這些才是存取控制；「不開 CORS」只是其中一項，不能單獨代表完成。
- 殘餘風險：同一台電腦上的其他程序，可以直接呼叫 `127.0.0.1` 的代理。只用虛構測資，不接正式資料（D-W4），才能接受這一點。

## 3. 候選的第一批（W1）：導師的「點名名冊與請假更正」

情境與身分見 §2.2：請假流程只在 `S-LEAVE-SC01`（`ACTOR-SC01-TEACHER`）；`S-ROSTER-A17`（`ACTOR-TEACHER`）是另一個獨立的唯讀情境。

| 頁面／流程 | 使用者看得到什麼 | 使用的 API |
|---|---|---|
| P1 名冊與點名摘要 | 座號、狀態（P／R／N／U）、合計。受控 API **不回傳姓名**（只回傳白名單欄位）；要顯示姓名，需要另外決定 `roster.read`（D-09 前停用） | `attendanceSession.read`、`attendanceSummary.read` |
| P2 請假摘要 | 假別、涵蓋的時段（上午／全天）、版本 | `leaveRecord.read` |
| P3 請假更正 | 「上午 → 全天」的確認、送出中、成功（顯示新版本與收據）、衝突、結果尚未確認；規則見 §3.1 | `/v1/commit` |
| P4 結果尚未確認時的確認 | 以**原本的**操作查詢收據，或重新送出**原本的**操作；規則見 §3.1 | `/v1/receipt`、`/v1/commit` |
| 錯誤畫面 | 沒有權限與資料不存在看起來**一樣** | 依 POC-002 |

### 3.1 送出結果的規則（v0.3，REV22-02）

**前提**：受控 API 會先完成交易（`processCommit`），之後才寫入稽核並送出回應。所以「沒有收到回應」**不**代表「沒有修改」。收據查詢的 `FORBIDDEN`，也**不能**證明交易沒有發生。

1. **固定操作**：
   - 使用者按下確認時，網頁一次產生並**凍結**一個「操作」：`operationId`（UUID v4）與**完整的** command（`expectedVersion`、intent、target、scope 等）。
   - 之後重送一律使用同一個 `operationId` 與同一份 command 內容，不重建、不修改。
2. **送出中**：
   - 送出按鈕停用；
   - 再按一次也只會沿用同一個操作；
   - 不會同時有兩個不同的操作在處理中。
3. **依回應決定狀態**：

| 回應 | 狀態 | 畫面與可以做的事 |
|---|---|---|
| 200 `OK` 加上收據 | 已完成 | 顯示收據與新版本；清除凍結的操作 |
| 409 `VERSION_CONFLICT` | 未修改（衝突） | 依 [`S2B1-AUTHORIZATION.md` §8](stage2/S2B1-AUTHORIZATION.md)「提交命令的處理順序」，授權通過之後，會在同一個交易中先檢查收據，所以這次操作**確定沒有寫入**。重新讀取請假摘要並顯示最新內容；使用者**重新確認**後，才建立**新的**操作，帶新的 `expectedVersion`。**不會**自動換版本後覆蓋 |
| 409 `OPERATION_REUSE_MISMATCH` | 錯誤 | 凍結的操作不應該發生這種情況，表示網頁有缺陷。顯示錯誤，保留原操作，不自動重試 |
| 403 `FORBIDDEN`（**第一次**提交） | 不允許 | 這次操作在授權階段就被拒絕，沒有進入交易。顯示一般的「無法存取」；不重試 |
| 403 `FORBIDDEN`（**結果不明之後的重送**） | **結果仍未確認，目前無法存取** | 見第 4 點：保留原操作，**不**視為未提交 |
| 網路錯誤、逾時、連線中斷、5xx、`UNAVAILABLE`（包括 `TRANSACTION_CONTENTION`） | **結果尚未確認** | 持續顯示「結果尚未確認」，**不**顯示「修改未發生」。保留凍結的操作，提供兩個動作：「查詢結果」與「重新送出同一操作」 |

4. **結果尚未確認時**：
   - **查詢結果**：以原 `operationId` 呼叫 `/v1/receipt`。
     - 200：已完成，顯示收據。
     - `FORBIDDEN`、5xx、網路錯誤：**仍然是**「結果尚未確認」，不是「未提交」。
   - **重新送出同一操作**：與原本的請求完全相同。
     - API 會**先**驗證身分並重新授權（`poc/stage2/src/api/server.mjs`：token 檢查 → `handleCommit` → 授權，被拒絕就直接回 403），**之後**才在交易中檢查收據；
     - 目前身分與授權**仍然通過**，而且操作一致時：已經提交過，就回傳原收據，不會再寫入（[`S2B1-AUTHORIZATION.md` §8](stage2/S2B1-AUTHORIZATION.md)「提交命令的處理順序」）；沒有提交過，就依 API 契約處理，可能成功、衝突或被拒絕；
     - **身分或授權已經失效**時（例如 token 過期、membership 被撤銷），重送會得到 `FORBIDDEN`，即使先前其實已經提交。這時畫面顯示「先前的結果尚未確認，目前無法存取」：
       - 保留原本的 `operationId` 與 command；
       - **不**視為未提交，**不**當成成功結案，**不**另建操作；
       - 不自動重試；前端不嘗試繞過授權，也不新增 token 刷新功能（開發情境中要重新啟動，§2.2）。
   - **絕對不會**自動產生新的 `operationId` 再提交，也不會把查詢失敗當成可以改送新操作的理由。
5. **重新整理或關閉頁面**：
   - W1 的凍結操作**只在頁面的記憶體中**，沒有離線或持久的草稿（Stage 4）。
   - 有「結果尚未確認」的操作時，離開頁面前會請瀏覽器顯示離開確認。這只是**盡力提醒**：瀏覽器可能不顯示，或使用者可能仍然離開，所以**不能**當成保存未確認操作的保證。
   - 重新整理之後，**無法**自動恢復那個操作。頁面只能重新讀取請假摘要，顯示目前的版本與內容，並說明「先前的送出結果無法自動確認，請以目前內容判斷」。
   - 這個恢復範圍的限制會寫在網站的 SPEC 中。

**不在 W1**：
- 請假適用提示、投影、敏感備註、匯出、離線、名冊管理；
- 其他角色；
- 正式登入。

## 4. 驗收條件（提案）

**功能**：
1. P1 的計數與 API 回應一致：P+R+N+U = 合計；已到 = P+R；已登記 = P+R+N。沒有其他工作空間的資料。
2. 在**重設後的初始測資**（`LV-007` v5、上午）下，P3 成功後版本是 6，重新讀取的請假摘要顯示「全天」，點名狀態沒有被改動。「v6」只是這個固定初始狀態下的驗收值，不是產品規則。
3. 兩個分頁同時更正：一個成功，另一個顯示衝突畫面，不會覆蓋。
4. 連按兩次送出只產生一次修改（同一個 `operationId`、同一份 command）。
5. **提交已經發生，但回應遺失**（測試用的故障代理）：畫面顯示「結果尚未確認」；「查詢結果」取得同一份收據。整個過程只有一筆 revision，只用過一個 `operationId`。
6. 以 `S-DENY` 情境開啟每一個網站用到的路由與目標，加上一個不存在的目標：顯示一般的「無法存取」，「沒有權限」與「不存在」的回應相同。
7. **提交已經發生，但收據查詢失敗**（測試代理讓 `/v1/receipt` 回 503 或中斷連線）：
   - 畫面仍然是「結果尚未確認」，不是「未提交」；
   - 不會自動產生新的 `operationId`；
   - 「重新送出同一操作」得到原收據；
   - 只有一筆 revision。
8. **收據查詢被拒絕**（測試代理讓 `/v1/receipt` 回 403 `FORBIDDEN`）：同第 7 項，不得當成「未提交」，也不得自動改送新的操作。
9. **衝突之後**：重新讀取並顯示最新內容；不經使用者重新確認，就不會送出任何新的操作。
10. **（v0.4）結果不明之後，身分或授權失效**：
    - 提交成功但回應遺失；
    - 接著讓身分或授權失效，例如測試中停用該 actor 的 binding，或撤銷 membership；
    - 重送原操作，被 `FORBIDDEN` 拒絕。
    - 預期：畫面保留「先前的結果尚未確認，目前無法存取」，保留原 `operationId` 與 command；revision 仍然只有一筆；沒有出現新的 `operationId`。
11. **（v0.4）本機代理**：
    - 直接開啟首頁成功：模擬網址列導航，`Sec-Fetch-Site: none`，沒有 `Origin`；
    - 跨來源的 API `POST` 不會轉送：`Origin` 不符，或 `Sec-Fetch-Site: cross-site`，都回 403，而且 upstream 沒有收到請求；
    - 沒有 `Origin` 的 API `POST` 也被拒絕。

測試用的故障代理只存在於端對端測試中，不是網站本機代理的功能。

**介面**：
- 手機、平板、桌面三種寬度沒有水平溢出；
- 全程可以只用鍵盤操作，焦點看得見；
- 尊重 `prefers-reduced-motion`；
- 狀態不只用顏色表示；
- 依 `DESIGN.md` §7 的清單驗收。tokens 在 D-W2 之後才定案。

**資料與安全**：
- 只用虛構測資；
- 網頁不持有 Emulator 的 owner 權限，只經受控 API；
- 頁面拿不到 token（§2.2）；瀏覽器中不保存任何 token、憑證或學生資料（不寫入 localStorage、sessionStorage、IndexedDB、cookie）；
- 不部署。

**測試**：
- 端對端測試（Playwright，本機 Emulator 與受控 API），涵蓋上述 11 項，加上 §2.2 本機代理的邊界測試：其他路徑、其他方法、錯誤的 `Host`、不符的 `Origin`、頁面自帶的 `Authorization` 都會被拒絕或丟棄；
- 三種寬度的截圖；
- 既有的 `check`、`npm test`、`stage1:all`、Stage 2 測試全部回歸；
- 結果分成「已通過／未執行／只經人工檢視」。

## 5. 仍保留的正式門檻（W1 不處理）

- 正式的身分驗證與 Security Rules；
- 真機與離線（Stage 4）；
- 備份與還原（POC-031）；
- 成本；
- 正式的 Firebase 專案；
- G-1／G-4／G-9／G-10 與 D-xx 決策；
- 正式 PASS（`PASS_ENABLED=false`）。

## 6. 交付順序

1. **（已完成）** D-W1～D-W3 已決定；既有規格已讀取（§2.1）。
2. 本提案 v0.2 以 PR 送 ChatGPT 審查（PR #22）；v0.3 回應審查的 REV22-01／02。負責人確認 D-W4～D-W8，並說明 M02-04／M02-05 的來源。
3. 審查通過後，Claude 在 `Classroom-Managerment-Next` 建立網站的 SPEC、DESIGN 與 CLAUDE.md（同一套流程與守則），以 PR 送審。這需要該 repository 的 push 權限。M02-04／M02-05 沒有原文之前，對應的需求標示「未確認」，不自行補造。
4. 核准後才實作 W1：另開 PR，附三種寬度的截圖與端對端測試結果。
