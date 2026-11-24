# WEB-B1｜第一批網頁製作：範圍與驗收條件提案 v0.2（草案）

> ⚠️ **本 PoC 適用說明**：本 Repository 沒有 `pages.yml`、`release.yml`、`site/` 或網站建置步驟；本提案**不**新增任何部署或發行流程。GitHub Settings 已啟用 Pages，若發佈來源為 `main`，合併後的檔案仍可能被公開（D-W6）。

> 狀態：**提案，送 ChatGPT 審查；核准前不寫任何網頁程式**。
> v0.2（2026-11-24）：負責人已決定 D-W1（另一個 repository：`hsuanyu9503/Classroom-Managerment-Next`）、D-W2（同意讀取既有規格）、D-W3（採用 §3 的候選流程），並要求送審與開 PR。D-W4～D-W7 仍是 Claude 的建議，待負責人確認。既有規格的讀取結果見 §2.1。
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
| 沒有權限、資料不存在 | 同上 | POC-002（回應形狀相同，不洩漏可識別欄位） | 可以；用於錯誤畫面 |
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
| D-W5 | **後端** | 本機 Emulator 加上已驗證的受控 API（`/v1/read`、`/v1/commit`、`/v1/receipt`）；不建立正式的 Firebase 專案，不部署 |
| D-W6 | **公開風險** | 網頁只在本機執行；不使用 Pages 發佈；Pages 是否保留由你決定 |
| D-W7 | **技術** | 沿用 `Homework-manager-` 的作法：不需要建置步驟的原生 HTML、CSS、JS，沒有 CDN 或外部套件；測試用 Playwright（`Homework-manager-` 已在測試中使用） |
| D-W8 | **（v0.2 新增）網站如何連到受控 API** | 受控 API 與 Emulator 在 `class-management-next/poc/stage2` 中，只在本機執行。網站 repository 加一個**只供開發的本機代理**：只轉送 `/v1/read`、`/v1/commit`、`/v1/receipt` 到 front 代理，不開 CORS 給任何其他來源，不含任何後端權限。API 的程式碼不複製到網站 repository |

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

## 3. 候選的第一批（W1）：導師的「點名名冊與請假更正」

只限 `ACTOR-SC01-TEACHER`，資料是 `WS-SC01`／`CLASS-606-SC01` 的虛構測資；`ACTOR-TEACHER`（A17）用於唯讀名冊。

| 頁面／流程 | 使用者看得到什麼 | 使用的 API |
|---|---|---|
| P1 名冊與點名摘要 | 座號、狀態（P／R／N／U）、合計。受控 API **不回傳姓名**（只回傳白名單欄位）；要顯示姓名，需要另外決定 `roster.read`（D-09 前停用） | `attendanceSession.read`、`attendanceSummary.read` |
| P2 請假摘要 | 假別、涵蓋的時段（上午／全天）、版本 | `leaveRecord.read` |
| P3 請假更正 | 「上午 → 全天」的確認、送出中、成功（顯示新版本與收據）、衝突（「資料已被其他裝置更新」，提供重新載入）、無法連線 | `/v1/commit`；`operationId` 由網頁以 UUID v4 產生，同一次操作重送時沿用 |
| P4 回應遺失的恢復 | 送出後連線中斷時顯示「確認是否已完成」，以原 `operationId` 查詢收據 | `/v1/receipt` |
| 錯誤畫面 | 沒有權限與資料不存在看起來**一樣** | 依 POC-002 |

**不在 W1**：
- 請假適用提示、投影、敏感備註、匯出、離線、名冊管理；
- 其他角色；
- 正式登入。

## 4. 驗收條件（提案）

**功能**：
1. P1 的計數與 API 回應一致：P+R+N+U = 合計；已到 = P+R；已登記 = P+R+N。沒有其他工作空間的資料。
2. P3 成功後版本是 6，畫面重新讀取的請假摘要顯示「全天」；點名狀態沒有被改動。
3. 兩個分頁同時更正：一個成功，另一個顯示衝突畫面，不會覆蓋。
4. 連按兩次送出只產生一次修改（同一個 `operationId`）。
5. 模擬回應遺失（測試代理）：P4 恢復同一份收據，沒有重複修改。
6. 以沒有權限的身分開啟：顯示一般的「無法存取」，與資料不存在相同。

**介面**：
- 手機、平板、桌面三種寬度沒有水平溢出；
- 全程可以只用鍵盤操作，焦點看得見；
- 尊重 `prefers-reduced-motion`；
- 狀態不只用顏色表示；
- 依 `DESIGN.md` §7 的清單驗收。tokens 在 D-W2 之後才定案。

**資料與安全**：
- 只用虛構測資；
- 網頁不持有 Emulator 的 owner 權限，只經受控 API；
- 不在瀏覽器保存 token 以外的個資；
- 不部署。

**測試**：
- 端對端測試（Playwright，本機 Emulator 與受控 API），涵蓋上述 6 項；
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
2. 本提案 v0.2 以 PR 送 ChatGPT 審查。負責人確認 D-W4～D-W8，並說明 M02-04／M02-05 的來源。
3. 審查通過後，Claude 在 `Classroom-Managerment-Next` 建立網站的 SPEC、DESIGN 與 CLAUDE.md（同一套流程與守則），以 PR 送審。這需要該 repository 的 push 權限。
4. 核准後才實作 W1：另開 PR，附三種寬度的截圖與端對端測試結果。
