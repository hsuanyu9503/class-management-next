# S2-B2｜後端證據認證（attestation）設計 v0.2（草案）

> **狀態：設計文件，未實作。** 本批沒有任何認證流程、簽章或 PASS 判定的實作。Stage 1 的 `toBackendEvidence()` 仍然拒絕 `PASS`，本設計**不放寬** Stage 1 的任何防護。
> v0.2：回應 PR #4 審查 S2B2-REV-002，新增 §9「隔離要求」與 §10「攻擊驗收情境」。在隔離條件未滿足或無法查證時，結果只能是 `UNATTESTED` 或 `BLOCKED`。
> 相關：`docs/stage2/S2B2-B1-PLAN.md`、`docs/stage2/S2B2-ADAPTER-PLAN.md`、`poc/stage1/src/evidence.mjs`、`poc/stage1/contracts/evidence-schema-v1.0.json`。

## 1. 要解決的問題

Stage 1 只能把真實後端結果記成 `PENDING_ATTESTATION`，因為 Adapter 自己宣稱「已執行、結果正確」不足為憑。本設計回答四個問題：

1. 誰收集證據、誰驗證證據。
2. 證據如何綁定到特定的 commit、案例、fixture 與執行環境。
3. canonical 結果如何來自**實際的後端狀態**，而不是 Adapter 的宣稱。
4. 如何拒絕假 Adapter、舊證據重播、缺少 trace 與篡改結果。

## 2. 角色與信任邊界

| 角色 | 由誰執行 | 是否受信任 | 職責 |
|---|---|---|---|
| **Adapter** | PR 中的程式碼 | **不受信任** | 對 Emulator 送出操作；回報它的 canonical 與證據**只作參考** |
| **受控執行器（Runner）** | 只在 `main` 上、由 `main` 版本定義的 workflow 執行 | 受信任的執行環境 | 啟動 Emulator、產生 nonce、執行 Adapter、記錄所有對 Emulator 的請求與回應（trace）、匯出執行後的 Emulator 狀態 |
| **觀察器（Observer）** | 每個案例一個，與 Adapter 分開的模組 | 經審查的程式碼 | 只讀 Runner 匯出的 Emulator 狀態與 trace，**獨立**算出 canonical |
| **驗證器（Verifier）** | 獨立步驟 | 經審查的程式碼 | 核對綁定欄位、雜湊、簽章；比對 Observer 的 canonical 與 oracle；決定 `PASS`／`FAIL`／`BLOCKED` |
| **信任根（Trust root）** | 待決（D-17） | 由負責人決定 | 為 Runner 產生的證明簽章，讓第三方能確認證據確實來自受控執行器 |

**界線**：

- Adapter 永遠不能決定結果。
- 本機或 PR 上的執行只能產生 `UNATTESTED`（模型與開發用），**永遠不能**產生 `PASS`，因為開發者的電腦與 PR 程式碼都不受信任。
- 「workflow 由 `main` 定義」「Observer 是不同模組」「Verifier 是獨立步驟」**本身不足以**建立信任：Adapter 與證據收集、驗證、簽章之間必須有 §9 的隔離，否則 Adapter 可以改寫狀態、trace、匯出檔或驗證程式，而受控 workflow 仍會替被污染的結果簽章。

## 3. 證明（attestation statement）的綁定欄位

每一筆案例執行產生一份證明，至少包含：

| 欄位 | 內容 | 用途 |
|---|---|---|
| `schemaVersion` | 例如 `s2-attestation-v1` | |
| `testId`、`backend` | 例如 `POC-001`、`firebase` | 案例 |
| `caseSpecDigest` | 該案在 `canonical-oracles-v1.0.json` 中的定義，以 Stage 1 `stableJson` 序列化後的 SHA-256 | 防止換掉預期 |
| `fixtureFileSha256`、`fixtureHash` | 鎖定 fixtures 檔案的 SHA-256（`a2af65e8…`），以及 Stage 1 `createFixtureHash()` 的值 | 防止換掉測資 |
| `gitCommit` | 執行時的完整 commit SHA | 綁定程式碼 |
| `anchorDigest` | `scripts/verify-anchor.mjs` 的 digest（受保護檔案） | 綁定防護程式與鎖定基準 |
| `environment` | Node、Java、firebase-tools 版本、Emulator jar 版本與 MD5、作業系統映像、Runner 識別 | 綁定執行環境 |
| `runId`、`runAttempt`、`nonce` | Runner 在執行**之前**產生的隨機 nonce，同時寫進 Emulator 中的一份標記文件 | 防止重播 |
| `startedAt`、`finishedAt` | §7.6 格式的 UTC 時間 | |
| `traceDigest` | Runner 記錄的請求／回應 trace 檔的 SHA-256 | 綁定實際操作 |
| `stateExportDigest` | 執行後 Emulator 狀態匯出檔的 SHA-256 | 綁定實際狀態 |
| `observedCanonical`、`observedCanonicalDigest` | Observer 從狀態與 trace 算出的 canonical | 結果來源 |
| `adapterClaimedCanonical` | Adapter 自己回報的 canonical（只供比對） | 偵測 Adapter 說謊 |
| `evidenceFiles` | 每個證據檔的路徑與 SHA-256 | |
| `result` | `PASS`／`FAIL`／`BLOCKED`，**只由 Verifier 填寫** | |

## 4. canonical 的來源

1. Runner 先清空 Emulator，載入鎖定的 fixtures，寫入 nonce 標記文件，再交給 Adapter 執行。
2. Adapter 執行後，Runner 透過 Emulator 的本機管理介面（owner 權限）**匯出狀態**；在 Adapter 執行期間，Runner 以本機代理記錄 Adapter 與 Emulator 之間的所有請求與回應，形成 trace。
3. Observer 只讀匯出的狀態與 trace，算出 canonical。例如 POC-008 的計數是由匯出的 `entries` 文件重算，而不是讀 Adapter 回傳的數字。
4. Verifier 比對 `observedCanonical` 與 oracle（並遵守 `P0_PINNED` 與安全斷言）：
   - 一致 → 可以是 `PASS`（仍需第 5 節的其他條件全部成立）；
   - 不一致 → `FAIL`；
   - `adapterClaimedCanonical` 與 `observedCanonical` 不一致 → 記為 Adapter 不一致；結果以 observed 為準，並在證據中標示。

## 5. `PASS` 的條件與拒絕情況

`PASS` 只在下列**全部**成立時才成立；否則為 `BLOCKED`（無法判定）或 `FAIL`（判定結果錯誤）：

| 檢查 | 不成立時 | 防範的攻擊 |
|---|---|---|
| 證明來自受控執行器，且信任根的簽章驗證通過 | `BLOCKED` | 假 Adapter、在開發者電腦上偽造證據 |
| §9 的隔離條件全部成立，且本次執行的隔離自我檢查（§9.5）通過 | `BLOCKED`（無法查證時為 `UNATTESTED`） | 旁路、直接 owner 寫入、篡改證據或驗證程式 |
| 執行後狀態相對於載入的 fixtures 的**所有**變化，都能由 trace 中經受控 API 的操作解釋（§9.4） | `BLOCKED` | 繞過記錄代理直接改寫 Emulator |
| `gitCommit`、`caseSpecDigest`、`fixtureFileSha256`、`anchorDigest` 都等於本次要認證的目標 | `BLOCKED` | 舊證據重播、換掉預期或測資 |
| `nonce` 是本次 `runId` 產生的，且出現在狀態匯出的標記文件中 | `BLOCKED` | 重播其他執行的證據 |
| trace 存在、`traceDigest` 相符，且每個 `requiredEvidenceKeys` 都能對應到 trace 中實際的請求或回應 | `BLOCKED` | 缺少 trace、證據欄位只是字串 |
| 所有 `evidenceFiles` 的 SHA-256 都相符 | `BLOCKED` | 篡改證據檔 |
| `observedCanonical` 由 Observer 從 `stateExportDigest` 對應的匯出檔算出，可以重算 | `BLOCKED` | 篡改結果 |
| `observedCanonical` 與 oracle 一致 | `FAIL` | |

**雜湊與來源的差別**：

- SHA-256 只能證明「檔案在雜湊之後沒有被改動」（完整性）。
- 它不能證明「檔案是誰、在哪裡產生的」（來源）。任何人都可以產生一組自洽的檔案與雜湊。
- 因此第一列的信任根簽章是必要條件，不能用雜湊取代。這與 S2-B1 稽核摘要中「雜湊不是去識別」的結論是同一類問題。

## 6. 證據的保存與遮罩

- **本機執行**：寫到 `poc/stage2/evidence/runs/`，已列入 `.gitignore`，不提交。只供開發，永遠是 `UNATTESTED`。
- **受控執行**：證據以 CI artifact 保存，保存期限由 D-07 決定；`main` 分支只提交證明的摘要，不提交原始 trace。
- **遮罩規則**：
  - 不記錄 ID token、refresh token、`Authorization` 標頭、任何憑證；trace 寫入前，Runner 必須把這些欄位換成固定字串 `<redacted>`。
  - 不記錄學生姓名（`displayName`）。即使 fixtures 是虛構的，也保持同樣的規則，讓日後真實資料不會因習慣而外洩。
  - 學生與文件 ID 數量少、可列舉，雜湊**不算**去識別。證據只用於虛構資料；遇到真實資料時必須另訂規則。
- 本批的冒煙紀錄（`infra-smoke-latest.json`）已遵守上述遮罩：只有計數、狀態碼與步驟名稱，沒有姓名與 token。

## 7. 與 Stage 1 的關係

- 不修改 `poc/stage1/src/evidence.mjs`：它仍然拒絕 `PASS`，Stage 1 的 72 筆計畫仍是 `NOT_RUN`。
- 認證後的結果將放在 Stage 2 自己的位置（例如 `poc/stage2/attested/`），使用新的 schema，**不覆寫**任何 Stage 1 鎖定檔案。
- Emulator 上的 `PASS` 只代表「在 Emulator 環境中符合契約」。真實雲端、真實裝置與正式環境的證據屬於 Stage 4。

## 8. 已知限制與待決事項

| 項目 | 說明 |
|---|---|
| **D-17（新，待負責人決定）**：信任根 | 選項例如：GitHub Actions 的 artifact attestation（Sigstore，綁定 workflow 與 commit），或由負責人手動簽署。選定前，沒有任何結果可以是 `PASS` |
| 受控執行器必須由 `main` 定義 | 否則 PR 可以修改執行器本身。這與 Stage 1 錨定的殘餘風險（修改 `ci.yml` 可略過比對）相同，必須一起處理。由 `main` 定義是**必要但不充分**的條件，還需要 §9 的隔離 |
| 隔離的實作與查證 | §9、§10 只是設計；本批沒有實作或測試任何隔離。實作前與隔離無法查證時，結果只能 `UNATTESTED`／`BLOCKED` |
| Emulator 與正式服務的差異 | 規則引擎、交易與並行行為可能與正式 Firestore 不同；Emulator 的 PASS 不能外推到正式環境 |
| trace 記錄方式 | 需要在 Adapter 與 Emulator 之間放一個本機記錄代理；本批尚未實作 |
| 狀態匯出 | 可用 `firebase emulators:export` 或 owner 權限的 REST 讀取；兩者的完整性與效能尚未比較 |

## 9. 隔離要求（S2B2-REV-002）

以下是產生可認證結果的**必要條件**。本批只是設計，尚未實作；實作與驗收屬於 S2-B2 #3（見 `S2B2-ADAPTER-PLAN.md`）。

### 9.1 受信任元件的來源固定

- Runner、Observer、Verifier、記錄代理與遮罩程式，從**固定的受信任版本**載入：`main` 上經審查並記錄 SHA 的版本，`trustedToolchainCommit`。**不得**從被測 PR 的 checkout 載入。
- 證明中**分別**記錄 `trustedToolchainCommit` 與被測 Adapter 的 `adapterCommit`。驗證時兩者各自比對；Adapter 的 commit 無論是什麼，都不能改變受信任元件。
- 受信任元件的更新本身是一次需要審查的變更，並更新外部錨定（與 Stage 1 錨定的處理方式相同）。

### 9.2 Adapter 的執行隔離

- **程序**：Adapter 在獨立的程序或容器中執行，沒有權限偵錯、注入或監看 Runner、Observer、Verifier 的程序。
- **網路**：Adapter 只能連到受控 API 的單一入口（經記錄代理）。Emulator 的資料埠、管理端點（`/emulator/v1/...`）、hub、logging、websocket 對 Adapter **都不可達**；Adapter 的環境中不提供 `FIRESTORE_EMULATOR_HOST` 等變數，也拿不到 owner token。
- **檔案系統**：Adapter 只看得到唯讀的程式碼與自己的暫存目錄；看不到 oracle、fixtures 的原始檔以外的鎖定檔、證據目錄、匯出檔、trace、Observer 與 Verifier 的程式碼。
- **憑證**：簽章權限（例如 OIDC token、簽章金鑰）只存在 §9.3 的簽章環境；Adapter 與 Runner 的執行環境都沒有。
- **nonce**：由 Runner 在 Adapter 啟動**之後**、操作開始前才寫入 Emulator，Adapter 無法預先取得或改寫標記文件。

### 9.3 驗證與簽章環境

- Verifier 與簽章在**另一個**不執行任何不受信任程式碼的環境（例如另一個 CI job）中進行。它只接收 Runner 交出的 artifact（trace、狀態匯出、證據檔、證明草稿）。
- Verifier 重算所有雜湊與 Observer 的結果（使用 §9.1 固定版本的 Observer），不信任 Runner 已算好的值。
- 簽章權限只授予這個環境，且只在 Verifier 判定通過時才簽。

### 9.4 狀態變化必須能被 trace 完整解釋

- Adapter 結束並且其程序樹與容器**全部銷毀之後**，Runner 才匯出 Emulator 狀態，避免背景程序在驗證期間改寫。
- Verifier 比對「載入的 fixtures＋nonce 標記」與「執行後狀態」，每一筆差異都必須對應到 trace 中經受控 API 的一個操作。
- 有任何無法解釋的差異（例如直接用 owner 權限寫入、繞過代理的請求造成的改變）→ `BLOCKED`。

### 9.5 如何強制與查證

- **每次執行的隔離自我檢查**：Runner 在 Adapter 的執行環境中，嘗試連線 Emulator 的資料埠與管理端點、讀取證據目錄與 Verifier 程式碼，這些嘗試都**必須失敗**；結果寫入證明。任何一項成功 → `BLOCKED`。
- 證明記錄隔離設定的摘要（容器或網路政策的識別與雜湊），Verifier 核對它與受信任設定一致。
- 無法執行自我檢查，或環境不支援所需的隔離（例如開發者電腦）→ 只能 `UNATTESTED`。

## 10. 攻擊驗收情境（S2-B2 #3 必須全部通過）

| 情境 | 攻擊者（被測 Adapter）的作法 | 預期結果 | 依據 |
|---|---|---|---|
| 旁路代理 | 直接連 Emulator 資料埠或 REST 端點，繞過記錄代理 | 連線失敗；即使成功，狀態差異無法由 trace 解釋 → `BLOCKED` | §9.2、§9.4 |
| 直接 owner 寫入 | 以公開的 owner token 呼叫 Emulator 寫入正確答案 | 管理端點不可達；狀態差異無法解釋 → `BLOCKED` | §9.2、§9.4 |
| 篡改 trace／匯出檔 | 改寫 trace 或匯出檔讓結果看起來正確 | 檔案不可達；Verifier 重算雜湊不符 → `BLOCKED` | §9.2、§9.3 |
| 篡改 Observer／Verifier | PR 修改 Observer 或 Verifier 程式碼 | 受信任元件從固定版本載入，PR 版本不被使用；`trustedToolchainCommit` 不符 → `BLOCKED` | §9.1 |
| 背景程序 | Adapter 留下背景程序，在驗證期間改寫 Emulator 或證據 | 匯出前銷毀程序樹與容器；Verifier 在另一個環境 → 改寫無效或被偵測 → `BLOCKED` | §9.4、§9.3 |
| 舊 run 重播 | 提交其他執行或其他 commit 的證據 | `nonce`、`runId`、`gitCommit`、`caseSpecDigest` 不符 → `BLOCKED` | §5 |
| 預先取得 nonce | 在操作前讀取或改寫標記文件 | nonce 在 Adapter 啟動後才寫入，Adapter 無法存取管理端點 → 改寫不可能；若偵測到差異 → `BLOCKED` | §9.2 |
| 偽造證據檔 | 回報不存在或自行產生的證據檔 | 每個 `requiredEvidenceKeys` 必須對應 trace 中的實際請求或回應 → `BLOCKED` | §5 |
| 隔離無法查證 | 在不支援隔離的環境執行 | 只能 `UNATTESTED` | §9.5 |

**GitHub artifact attestation 的定位**：依審查者提供的 GitHub 官方說明（https://docs.github.com/en/actions/concepts/security/artifact-attestations），artifact attestation 證明的是「產出物的來源與建置過程」，**不能**證明測試語意正確。即使 D-17 選擇它作為信任根，§9 的隔離與 §9.4 的狀態解釋仍是必要條件。本執行環境無法連線該網站，此定位來自審查報告，Claude 未自行讀取原文。
