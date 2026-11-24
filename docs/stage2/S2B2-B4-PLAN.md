# S2-B2 第 4 批（B4）｜Firebase 受控寫入核心：POC-016／017／018／021 計畫 v0.1（草案）

> 狀態：**草案，送 ChatGPT 獨立審查；審查通過、負責人核准之後才實作**。
> 依據：`docs/adr/ADR-001-backend-selection.md`（暫定 Firebase）、`docs/SPEC.md` §4、`S2B1-AUTHORIZATION.md` §6.5 與 §8、`S2B1-DATA-MODEL.md`、`S2B2-ADAPTER-PLAN.md` §4（原規劃的「S2-B2 #4 受控寫入 API」）。
> 不授權：開啟 PASS、修改 Settings、觸發 hosted、合併、網站頁面製作。`PASS_ENABLED=false`、POC-009 BLOCKED、72 筆 `NOT_RUN` 的歷史紀錄都不變。

## 1. 案例盤點（36 項；P0 共 20 項）

### 1.1 已接上（Stage 2，S2-B2 第 2～3 批）

| 案例 | P | 目前結果 | 備註 |
|---|---|---|---|
| POC-001 | P0 | `UNATTESTED`（本機與 hosted） | 唯讀 |
| POC-002 | P0 | `UNATTESTED` | 唯讀；G-8：`student.read` 對任何人都拒絕（D-09） |
| POC-008 | P0 | `UNATTESTED` | 唯讀 |
| POC-009 | P0 | **`BLOCKED`**（`BLOCKED_FIELDS_G1_G4`） | G-1、G-4 待負責人決定 |

### 1.2 被決策或測資阻擋（本批不處理，不自行解除）

| 案例 | P | 阻擋原因 | 解除條件 |
|---|---|---|---|
| POC-003 | P0 | 預期 `applicabilityAvailable = true`，需要 `leave.applicability.read`；`ACTOR-SC01-TEACHER` 沒有這個 capability（與 **G-1** 相同） | G-1 的決定 |
| POC-004 | P0 | 需要「投影模式」的 principal。固定測資只有 `ACTOR-TEACHER`、`ACTOR-SC01-TEACHER`、`ACTOR-OTHER` 三個 principal，**沒有**投影模式的身分（**新缺口，提議編號 G-9**） | 負責人決定是否以審查過的方式新增 Stage 2 測試 principal（不改鎖定的 fixtures，類似 D-10） |
| POC-029 | P0 | 前提是「敏感 reasonNote 已保存」，固定測資**沒有**任何敏感備註；也沒有科任 principal（**新缺口，提議編號 G-10**）。匯出由 D-08 停用 | 負責人決定是否新增經審查的 Stage 2 敏感備註測資與科任 principal；D-06、D-15 維持預設拒絕 |
| POC-009 | P0 | G-1、G-4 | 同上 |

G-9、G-10 是 Claude 在盤點時找到的缺口，**只是提議的編號**，需要負責人與審查者確認。

### 1.3 未接上，但不需要新決策（依工作量分批）

| 案例 | P | 需要的能力 | 建議批次 |
|---|---|---|---|
| POC-016 | P0 | 受控寫入：原子提交 current／revision／receipt／event | **B4（本批）** |
| POC-017 | P0 | 受控寫入＋`expectedVersion` 衝突 | **B4** |
| POC-018 | P0 | 受控寫入＋`operationId` 冪等（100 次重送） | **B4** |
| POC-021 | P0 | 受控寫入＋收據查詢（回應遺失後恢復） | **B4** |
| POC-019 | P0 | 受控寫入＋`OPERATION_REUSE_MISMATCH`。改 actor 的變體依 D-10 的**預設值**：用 `ACTOR-OTHER` 時預期 `FORBIDDEN`，不需要新決策 | B5 |
| POC-020 | P0 | 受控寫入＋交易內的故障注入與回滾 | B5 |
| POC-005 | P0 | 受控更正 API＋偽造 scope 的拒絕 | B5 |
| POC-035 | P0 | 服務帳號與請求注入的越權路徑 | B5 或 B6 |
| POC-015 | P0 | 草稿不產生正式 v6。依 D-03 的預設，草稿只在裝置本機，需要與 client 端一起驗證 | 與離線一起（Stage 4） |
| POC-025、026、027 | P0 | 離線、durable 本機保存、共用 iPad 切帳；需要 client SDK 與真機 | Stage 4 |
| POC-031 | P0 | 備份與隔離還原 | Stage 4（DR） |
| P1 共 16 項 | P1 | — | P0 之後 |

## 2. 本批選擇：4 個 P0（POC-016、017、018、021）

**選擇理由**：

- 四個案例共用同一條「受控寫入」路徑：授權 → `requestHash` → 交易內讀收據 → 檢查 `expectedVersion` → 原子寫入。這正是 ADR-001 §5 的第一個觀察點，交易與冪等是 Firebase 是否可行的核心問題。
- 規格已經完整：`S2B1-AUTHORIZATION.md` §6.5、§8 定義了處理順序、`requestHash`（含測試向量 `ff212f32…`）、收據查詢；`S2B1-DATA-MODEL.md` 定義了 revisions、events、receipts。
- 固定測資已經備妥：`canonicalCommand`（`OP-SC01-EXAMPLE-0001`，`LV-007`，`expectedVersion 5`）、`canonicalCommittedReceipt`、`SC01-COMMITTED-v6`。
- 執行者 `ACTOR-SC01-TEACHER` 持有 `leave.revise`，**不需要**放寬授權或等待任何 D-xx／G-xx。
- POC-019（重用不符）、POC-020（故障注入）、POC-005（偽造 scope）也用同一條路徑，但各自需要額外的機制（第二種命令、交易內的故障注入點、更正 API）。放進 B5，讓本批的範圍可以審查得完。

| 案例 | 驗證目的 | 規格依據 | 依賴／未決問題 | 預期結果（`expectedResult`） | 驗收證據 |
|---|---|---|---|---|---|
| **POC-016** | 授權的 actor 以 `expectedVersion 5` 正式提交 AM→全天：current、revision、receipt、event 各一次，點名維持 `N` | 契約 POC-016；授權 §8 第 5 步；資料模型 events（`eventDelta = 1`）；`SC01-COMMITTED-v6` | 無。fixture 標示 `hypotheticalOnly`，本批只在 Emulator 中執行 | `officialVersion 6`、`revisionDelta 1`、`receiptDelta 1`、`eventDelta 1`、`attendance N` | Observer 從匯出的 pre／post 狀態**獨立**重算四個 delta 與點名狀態；trace 中只有一次寫入交易；收據的 `requestHash` 等於測試向量 |
| **POC-017** | 兩個裝置（同一個 actor、兩條連線）同時以 `expectedVersion 5` 提交不同意圖：恰好一個成功，另一個 `VERSION_CONFLICT` | 契約 POC-017；§8 第 4 步 | 無。並行要由 Harness 真正同時送出，不能依序 | `successes 1`、`conflicts 1`、`silentOverwrite false` | Observer 從狀態重算：版本歷史只有 v5→v6、收據 1 筆、revision 1 筆；兩個回應分別是成功與 `VERSION_CONFLICT`；成功者的意圖等於 current |
| **POC-018** | 同一個有效命令與 `operationId` 連續重送 100 次：只有一次正式改版與一次 revision，100 次回傳同一份收據 | 契約 POC-018；§8 第 3 步 | 無 | `revisionDelta 1`、`receiptCount 1`、`uniqueReceiptIds 1` | Observer 從狀態重算；100 個回應的收據 ID 都相同；trace 中只有第一次真正寫入 |
| **POC-021** | commit 實際成功，但回應遺失；client 以原 `operationId` 查詢收據，得到同一個正式結果，不重複執行 | 契約 POC-021；§8「查詢收據」 | 無。「回應遺失」由 trace 代理在 commit 之後丟棄回應來模擬，不改 API 行為 | `receiptRecovered true`、`revisionDelta 1`、`duplicateCommit false` | 第一次的回應確實沒有送達 client（trace 有紀錄）；查詢得到的收據等於狀態中的收據；revision 只有 1 筆 |

**每個案例都要記錄的負向條件**（`mustNotHappen`）：
- 016：只改了請假或偷偷改了點名；
- 017：後寫入者靜默覆蓋；
- 018：重複產生 revision 或版本遞增；
- 021：用新的 `operationId` 重複修改。

由 Observer 從狀態判定，不採信 Adapter 的自我報告。

## 3. 修改範圍

### 3.1 受控寫入 API（新增）

- 在現有的本機 API（`poc/stage2/src/api/server.mjs`，目前只有 `POST /v1/read`）加上：
  - `POST /v1/commit`：`LeaveRecord.Revise` 一種命令；
  - `POST /v1/receipt`：查詢收據。
- 處理順序**完全依** §8：
  1. 授權（§6.1～6.3，`leave.revise`）；失敗就 `FORBIDDEN`，不讀收據；
  2. 計算 `requestHash`（`sha256-stablejson-v1`，以 Stage 1 的 `stableJson`）；
  3. 在同一個 Firestore 交易內讀收據、比對雜湊、檢查版本；
  4. 原子寫入 current、revision、receipt、event 與 `derivedProgress`。
- 寫入使用 Firestore REST 的交易（`beginTransaction`／`commit`），只對 Emulator；沿用 `local-guard` 的限制（只綁定 127.0.0.1、只接受 Emulator 模式）。
- 產品的 Security Rules **不變**（仍拒絕一切）；寫入只經受控 API（決策 C）。

### 3.2 判定與證據

- `observer.mjs`：新增四個案例的觀察函式，從 pre／post 匯出**獨立**重算 delta。
- `verdict.mjs`、`verifier.mjs`（`CASE_ACTORS`）、`attest-verify.mjs`（`CASES`）：加入四個案例 ID。
- `reconcile.mjs`：寫入請求與稽核的對帳。B3A-N6 已有讀取的對帳；寫入要多核對 `operationId`、`requestHash`、交易 ID。
- `case-input.mjs`：寫入案例的 `case.json`。仍然只給該 actor 的 token（B3A-N8）。
- `trace-proxy.mjs`：POC-021 的「commit 後丟棄回應」。只在該案例啟用，並留下紀錄。

### 3.3 Runner、workflow 與 Adapter

| 檔案 | 現況 | 需要的擴充 |
|---|---|---|
| `.github/workflows/attest.yml` | dispatch 的 `options` 只有 POC-001／002／008／009；push 固定 POC-001 | `options` 加入 POC-016／017／018／021。push 仍固定 POC-001，不變 |
| `poc/stage2/scripts/run-attest-execute.mjs` | 白名單只有四個 ID，其他 ID 以 2 退出 | 白名單加入四個 ID |
| `poc/stage2/test/b3-run.mjs` | `SINGLE` 白名單與誠實案例的迴圈只有四個 ID | 同上；本機完整執行也跑新案例 |
| `poc/stage2/adapter-b3/core.mjs` | 四個讀取案例 | 新增四個寫入案例。這是**受測的 Adapter**，不在錨定範圍內 |
| `attest-attack.yml`、`attest-sigtest.yml` | — | **不改** |

- **不新增** workflow 檔，也不另造簽章或驗證的基礎設施。C-1～C-3 不重做。
- 依 C-1 的教訓：`attest.yml` 的 dispatch 只接受一個案例。四個新案例的 hosted 執行，要由負責人在合併後**逐一**手動觸發。

### 3.4 測試

- 單元測試：`requestHash` 測試向量（`ff212f32…`）、§8 的每一個分支、交易內的順序、跨 principal 的情況（B 沒有授權 → `FORBIDDEN`，不讀收據）。
- Emulator 整合測試：四個案例的誠實執行；每個案例至少一個負向的 mutation，例如：
  - 跳過收據檢查 → 018 必須抓到；
  - 不檢查版本 → 017 必須抓到；
  - 分兩次寫入 → 016 必須抓到；
  - 查詢收據時重新執行 → 021 必須抓到。
- 既有的 C-1 攻擊組合（A1～A18）在新案例上**不重跑**，只跑誠實路徑與上述 mutation。攻擊組合是否要延伸到寫入案例，留給審查者判斷。
- 回歸：`npm run check`、`npm test`、`stage1:all`、`s2:test`、`s2:b3`、既有的 mutation 全組。

### 3.5 受保護檔案與錨定

會改動的受保護檔案：
- `scripts/anchor-paths.json` 列出的 `poc/stage2/src`（API、Observer、Verifier、reconcile、verdict、case-input、trace-proxy）；
- `run-attest-execute.mjs`、`test/b3-run.mjs`；
- `.github/workflows/attest.yml`。

因此：
- **錨定會改變**，必須重新計算，並在最後一個受保護 commit 經審查後，由負責人核准；
- 風險等級 **L3**：修改簽章 workflow 的輸入、可信的判定程式與 API；
- 審查證據包要附上 API 與 Observer 的完整檔案、§8 對照表、mutation 結果。

## 4. 預期結果與限制

- 四個案例的本機與 hosted 結果**最多 `UNATTESTED`**，因為 `PASS_ENABLED=false`。結果寫進 Stage 2 報告與 REVIEW_LOG，**不**回填鎖定的測試矩陣或 72 筆計畫。
- Firestore Emulator 的交易語意不等於正式環境，例如並行與重試的時序。本批證據只代表「Emulator 中，同一份契約成立」。正式環境的驗證屬於 Stage 4。
- 若實作中發現 Firestore 交易無法滿足原子性或冪等的要求，依 ADR-001 §5 記錄為重新評估的觀察點，**不**放寬契約。

## 5. 交付順序

1. 本計畫與 ADR-001 送 ChatGPT 審查（本 PR，純文件）。
2. 負責人決定：
   - 是否採用本批的四個案例；
   - 是否確認 G-9、G-10 的缺口編號。
3. 計畫審查通過後，Claude 實作，送新的 PR（L3）與審查證據包。
4. ChatGPT 審查；負責人核准錨定與合併。
5. 合併後，負責人逐一觸發 hosted，審查者核對原檔。

## 6. 需要負責人決定

| # | 問題 | Claude 的建議 |
|---|---|---|
| Q1 | 本批是否採用 POC-016／017／018／021 這 4 個 P0？ | 是。它們共用同一條寫入路徑，不需要新決策 |
| Q2 | 是否確認 G-9（POC-004 缺少投影模式 principal）與 G-10（POC-029 缺少敏感備註測資與科任 principal）兩個新缺口？ | 確認編號並維持 BLOCKED。是否新增測試 principal 或測資，另行決定 |
| Q3 | C-1 的攻擊組合是否要延伸到寫入案例？ | 本批不延伸，只跑誠實路徑與寫入的 mutation；若審查者認為寫入路徑有新的攻擊面，在 B5 補上 |
