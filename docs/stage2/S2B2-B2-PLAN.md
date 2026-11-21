# S2-B2 第 2 批｜本機受控讀取 API、trace、Observer 雛形與四個 P0 案例

> **狀態：實作與本機執行紀錄。結果一律是 `UNATTESTED` 或 `BLOCKED`，沒有任何正式 `PASS`。**
> 基準：`main` = `e98c46b05fe2a127f0356e66777c4484ec768ceb`（PR #4 合併；最終 Reviewed Head `ee756da8920080d4874e1f71915b97f27431576a`，兩者沒有檔案差異）。合併後同 SHA 的 CI [run 44854491499](https://github.com/hsuanyu9503/class-management-next/actions/runs/44854491499) 成功。
> 本批**不**實作 Verifier、簽章、信任根（D-17）或 `S2B2-ATTESTATION.md` §9 的隔離。本機代理與 Observer 雛形**不是**安全隔離。
> 相關：[Adapter 計畫](S2B2-ADAPTER-PLAN.md)｜[認證設計](S2B2-ATTESTATION.md)｜[授權](S2B1-AUTHORIZATION.md)｜[資料模型](S2B1-DATA-MODEL.md)｜[存取矩陣](S2B1-ACCESS-MATRIX.md)

## 1. 範圍

| 做了 | 沒做 |
|---|---|
| 本機受控**讀取** API（只綁定 127.0.0.1，只支援明確的 Emulator 模式） | 任何寫入、交易、冪等 API（POC-016～021） |
| §6.1 步驟 1–3、§6.2 步驟 5–6 的授權（分支 C），每次請求重新讀取權威文件 | 分支 W、C-sens／grant、自我讀取、收據 |
| binding／token／membership 時間的嚴格驗證（授權 §13 假設 5 要求的實作驗證） | 正式服務的 token 簽章驗證（**不存在**，API 拒絕在非 Emulator 模式啟動） |
| 每次允許與拒絕都寫入 `auditLog`（產品稽核），與測試 trace 分開 | `auditSummaries`、管理稽核摘要（本批沒有管理操作） |
| front／back 兩個 trace 記錄代理、遮罩、狀態匯出、Observer 雛形 | Verifier、簽章、§9 隔離、可認證結果 |
| Firebase Adapter（沿用 Stage 1 `runner.mjs` 介面，不修改 Stage 1） | 修改 Stage 1 鎖定檔、`PENDING_ATTESTATION` 防護或 72 筆計畫 |
| 真實 Auth／Firestore Emulator 上執行 POC-001、002、008、009 | 其他 32 個案例（維持 `NOT_RUN`） |

Firestore client 規則維持拒絕一切（`firestore.rules` 未修改）；所有讀取都經 API（D-01 預設）。

## 2. 四個案例的對照表

依據：`poc/stage1/contracts/canonical-oracles-v1.0.json`、`poc-test-matrix-v1.0.csv`、`fixtures/canonical-fixtures-v1.0.json`（全部唯讀）。

| 項目 | POC-001 | POC-002 | POC-008 | POC-009 |
|---|---|---|---|---|
| 鎖定 testId／P | POC-001／P0 | POC-002／P0 | POC-008／P0 | POC-009／P0 |
| fixtureSet | `A17-20261117` | `A17-20261117` | `A17-20261117` | `SC01-20261116` |
| 前提（矩陣） | 教師屬 WS-A17 | ACTOR-OTHER 未授權 | 15 筆固定測資 | Leave v5 AM；Attendance N all day |
| 操作（矩陣） | getAuthorized 指定班級 15 筆 | 讀 A17 Student／AttendanceEntry | 重算狀態 | 查出席與假單適用 |
| actor | `ACTOR-TEACHER` | `ACTOR-OTHER` | `ACTOR-TEACHER` | `ACTOR-SC01-TEACHER` |
| actor 的 Stage 1 capability（原樣） | `attendance.read`、`attendance.write`、`leave.applicability.read` | 無；不建立 membership | 同 POC-001 | `attendance.read`、`attendance.revise`、`leave.read`、`leave.revise`、`issue.read` |
| API 請求 | `attendanceSession.read`（`AS-A17-20261117-DAILY`） | `attendanceEntry.read`（A17 第 1 筆）、`student.read`（`ST-A17-0001`）、`attendanceEntry.read`（不存在的 ID，比較用） | `attendanceSummary.read`＋`attendanceSession.read` | `attendanceEntry.read`（`AT-20261116-07`）、`leaveRecord.read`（`LV-007`）、`trackingIssue.read`、`leaveApplicability.read`、再讀一次點名 |
| 授權規則 | 分支 C；`attendance.read`（授權 §6.4、存取矩陣 §5） | §6.1／§6.2 步驟 5（沒有 membership）；`student.read` 需要 `roster.read`（未啟用，D-09）；§6.6 不區分不存在與無權限 | 分支 C；`attendance.read` | 點名 `attendance.read`、請假摘要 `leave.read`、核對事項 `issue.read`；**適用提示 `leave.applicability.read`** |
| 預設拒絕條件 | 任何一項不成立 → `FORBIDDEN` | 一律 `FORBIDDEN` | 同 POC-001 | 適用提示：actor 沒有該 capability → `FORBIDDEN` |
| requiredEvidenceKeys | `authzDecision`、`returnedIds`、`workspaceId` | `authzDecision`、`returnedFields`、`traceId` | `queryCount`、`assertions` | `versions`、`coverageResult`、`entryHash` |
| expectedCanonical | 15 筆且僅 WS-A17 | FORBIDDEN／無可識別 payload | P9 R1 N1 U4；T15，已登記11，到校10 | 部分適用，下午5–7待核對；不得自動改 N 或延長假單 |
| 可執行性 | 可執行 | 可執行 | 可執行 | **部分 BLOCKED**（§3 G-1、G-4） |

**POC-009 的完整前提與預期**（不簡化成只比筆數）：

- 預期欄位：`attendance = N`、`leaveVersion = 5`、`applicability = partial`、`pendingPeriods = [5,6,7]`、`autoRewrite = false`。
- 本批能觀察的：
  - 點名仍是 `N`、version 4；請假仍是 v5、AM、節次 1–4；
  - 前後狀態沒有任何非稽核文件被新增、刪除或修改（`autoRewrite = false`）；
  - 核對事項可讀；
  - 適用提示請求被拒，原因是 `CAPABILITY_NOT_GRANTED`。
- 本批**不能**觀察的：`applicability` 與 `pendingPeriods`（G-1、G-4）。這兩欄在 Observer 的結果中**留空**，不以 fixture 的 `expectedApplicability`／`remainingPeriodsToCheck` 代入。

## 3. 規格缺口與阻擋（需要負責人決策）

| ID | 案例 | 衝突位置 | 內容 | 選項 | 建議 |
|---|---|---|---|---|---|
| **G-1** | POC-009 | 授權 §6.4（讀請假適用提示需 `leave.applicability.read`）vs 存取矩陣 §5（fixture principal 的 capability 與 Stage 1 完全相同，不增不減） | `ACTOR-SC01-TEACHER` 沒有 `leave.applicability.read`。依規格，適用提示必然 `FORBIDDEN`，案例的 `applicability`／`pendingPeriods` 無法產生 | (a) 修訂 S2-B1：`leave.read`（資訊是 `leave.applicability.read` 的超集）也可讀適用提示；(b) 以審查過的方式新增一個 Stage 2 測試 principal（不改鎖定 fixtures，類似 D-10）；(c) 維持 BLOCKED | (a)：語意上最小的改動；但需要 S2-B1 修訂與審查。**本批沒有採用任何選項** |
| G-2 | 全部 | 資料模型 §2：`auditLog` 位於 `workspaces/{wid}/` 之下 | 無法解析工作空間的拒絕（token 無效、目標不存在、capability 未啟用）沒有規定寫在哪裡 | (a) 本批作法：寫入頂層 `auditLogUnscoped`（相同欄位，`workspaceId` 不存在）；(b) 改寫入 actor 所屬工作空間；(c) 不稽核 | (a)，但需要納入資料模型並審查 |
| G-3 | 全部 | 資料模型 §3.3：membership 日期是 `YYYY-MM-DD`，沒有時區 | 「現在」要換成哪個時區的日期 | (a) 本批作法：fixtures `metadata.timeZone` = `Asia/Taipei`；(b) 工作空間欄位 | 在資料模型 `workspaces` 加入時區欄位 |
| **G-4** | POC-009 | fixtures 沒有 WS-SC01 2026-11-16 的可信節次日曆 | 即使授權通過，也沒有可信來源推出「第 5–7 節」 | (a) 新增經審查的 Stage 2 日曆測資；(b) 維持 BLOCKED | (a)，與 G-1 一起決定 |
| G-5 | POC-001、008 | A17 fixture 沒有 `attendanceEntryId` | 載入時以 `AE-{enrollmentId}` 產生 | — | 記錄即可（只影響測試環境的文件 ID） |
| G-6 | 全部 | 授權 §6.1 步驟 1 | Emulator 的 ID token 沒有簽章（`alg: none`），Emulator 的 `accounts:lookup` 也不檢查到期、audience 或內容是否被改（本批實測：偽造 `user_id`、過期、錯誤 aud 都回 200） | — | API 自行檢查 claims；**偽造 token 無法在 Emulator 模式以密碼學方式偵測**。這是本機 PoC 的限制；正式驗證路徑不存在 |
| G-7 | POC-009 | SC01 fixture 只有學生 07 的細節 | 點名場次的名單快照只有一筆 | — | 不影響本批觀察 |
| G-8 | POC-002 | `student.read` 需要 `roster.read`（未啟用） | 對**任何人**都拒絕，所以 POC-002 的 membership 路徑只由點名讀取驗證 | — | D-09 決定後再補 |

## 4. 架構

```text
Adapter ──HTTP──▶ front trace proxy :18301 ──▶ 受控讀取 API :18300 ──▶ back trace proxy :18302 ──▶ Auth :9099 / Firestore :8080
 (actor 的 Emulator token)   (指派 traceId、遮罩、記錄)     (token→授權→白名單回應→auditLog)    (記錄每一次後端讀寫)
                                                                                                     ▲
Observer ◀── 遮罩後的 front／back trace＋前後狀態匯出（owner 讀取，只供觀察）────────────────────────┘
```

- Owner 權限只存在 API 的 store 與測試初始化／觀察程式。Adapter 拿不到 owner token，也不知道 Emulator 位址。**但這不是強制隔離**：同一台機器的程序仍可直接連 Emulator（§9 未實作）。
- 所有新連接埠（18300、18301、18302、18305）納入前批的安全生命週期：只有 `ECONNREFUSED` 算關閉；`EACCES`、逾時等一律停止（`scripts/run-cases.mjs`）。
- Emulator 擁有權、nonce 標記、只清除自己擁有的環境：沿用前批。每個案例前「確認標記 → 清除 → 重寫標記 → 載入」。

### 4.1 授權實作（`poc/stage2/src/authz.mjs`）

| 規格 | 實作 |
|---|---|
| §6.1 步驟 1 | `src/api/token.mjs`：只接受 Emulator token（`alg: none`、無 `kid`）；`iss`、`aud`、`sub = user_id`；`iat`／`exp`／`auth_time` 必須是整數 NumericDate；`exp > now`；`iat` 不晚於 now＋60 秒；`auth_time ≤ iat`；再向 Auth Emulator 確認使用者存在且未停用 |
| §6.1 步驟 2 | 每次請求讀 `authBindings/{uid}`：`authUid` 一致、`status = active`、`activatedAt` 通過嚴格驗證、`iat ≥ activatedAt` |
| §6.1 步驟 2a | 讀 `principals/{pid}`：存在、`principalId` 一致、`status = active` |
| §6.1 步驟 3 | 以 collection group 查詢目標 ID；**由路徑**決定 `workspaceId`／`classId`；欄位與路徑不符 → `SCOPE_INTEGRITY_ERROR`；同一 ID 有多筆 → `SCOPE_INTEGRITY_ERROR`；請求宣稱的 scope 不符 → `SCOPE_CLAIM_MISMATCH` |
| §6.2 步驟 5 | 只採用同 principal、同工作空間、`scopeType = class`、`classId` 相同且非 null、`status = active`、必要欄位齊全、日期合法且 `validFrom ≤ 今天 < validToExclusive` 的 membership；多筆取聯集 |
| §5／§6.2 步驟 5 | 有效 capability ＝ membership 上的 ∩ `rolePreset@rolePresetVersion` 預設值 ∩ class 型 ∩ 已啟用；未知 preset 或版本 → membership 無效 |
| §6.2 步驟 6 | 操作所需 capability 必須在有效集合中；未啟用的 capability（D-09）對所有人拒絕 |
| §6.6 | 授權失敗一律 `403 {code: FORBIDDEN, traceId}`；不存在與無權限的回應形狀相同；授權前的格式錯誤也是 `FORBIDDEN` |

拒絕原因碼只寫入 `auditLog`，不出現在回應中。

### 4.2 時間驗證（`src/time-validate.mjs`）

- binding `activatedAt`：整個字串符合 `YYYY-MM-DDTHH:MM:SSZ`，且是真實存在的 UTC 時間（閏年、月份天數、不接受閏秒），與 §7.6 相同。
- token `iat`／`exp`：非負整數秒。
- membership `validFrom`／`validToExclusive`：整個字串符合 `YYYY-MM-DD`，且是真實日期；「今天」是 `Asia/Taipei` 的日期（G-3）。
- 不合法 → 該筆 binding／membership 無效 → `FORBIDDEN`。不使用 `Date.parse`。

### 4.3 稽核與測試 trace 的區別

| | 產品 `auditLog` | 測試 trace |
|---|---|---|
| 誰寫 | 受控 API，在回應**之前**寫入；寫入失敗則回 `UNAVAILABLE`（fail closed） | front／back 記錄代理 |
| 位置 | `workspaces/{wid}/auditLog/{uuid}`；無法解析工作空間時 `auditLogUnscoped`（G-2） | `evidence/runs/s2b2-b2/<runId>/…`（不提交） |
| 內容 | `auditId`、`at`、`authUid`、`principalId`、`action`、`resourceRef`、`decision`、`reasonCode`、`policyVersion`、`traceId` | 遮罩後的請求與回應 |
| 讀取 | 沒有任何 API 可讀（D-11）；Observer 只從匯出狀態讀取 | 只供 Observer 與審查 |

Observer 以 `traceId` 對應兩者。測試 trace **不能**取代 `auditLog`：每個案例都檢查 `auditLog` 恰好有一筆對應紀錄，缺少即判為問題。

## 5. 證據與遮罩

每次執行在 `poc/stage2/evidence/runs/s2b2-b2/<runId>/`（已列入 `.gitignore`）產生：

- 每案：`trace-front.jsonl`、`trace-back.jsonl`、`state-pre.json`、`state-post.json`、`observation.json`（含 case spec digest、狀態雜湊、檔案雜湊、Adapter 宣稱、Observer 結果、判定）；
- `run-summary.json`：`gitCommit`、`gitDirty`、fixture 與 oracle 檔案 SHA-256、Node／firebase-tools 版本、逐案結果、負向與變異控制、遮罩檢查、清理結果。

遮罩（`src/mask.mjs`）在寫入前進行：

- `Authorization` → `{tokenSha256, claimedAuthUid, verified: false}`；owner → `{emulatorOwner: true}`；
- `password`、`idToken`、`refreshToken`、`displayName`、`email`、`salt`、`passwordHash` 等 → `[MASKED]`；
- 含 fixture 虛構姓名的任何字串 → `[MASKED_NAME]`。

身分關聯：Observer 以 `traceId` 取得 API 自己在 `auditLog` 寫下的 `principalId`。代理記錄的 `claimedAuthUid` 只是未驗證的 claim，Observer 不以它判斷身分。

## 6. 判定規則

- Stage 1 `executeCase()` 照原樣執行並記錄（`PENDING_ATTESTATION` 或 `FAIL`，`attested: false`）。
- Stage 2 判定（`src/verdict.mjs`）用 Stage 1 的比對器，但輸入是 **Observer** 算出的 canonical：
  - `stage2Status`：`UNATTESTED`（已執行）／`BLOCKED`／`ERROR`，**沒有 `PASS`**；
  - `contractMatch`：`MATCH`／`MISMATCH`／`PARTIAL_MATCH_REST_BLOCKED`／`MISMATCH_OR_UNOBSERVABLE`。
- 「已執行」「觀察值符合契約」「已認證」是三件事；本批最多只有前兩件。
- 觀察輸入（trace、狀態匯出）在擷取時記錄雜湊，判定前重新計算；不符 → `INPUT_DIGEST_MISMATCH`。這只是同一次執行內的竄改偵測，不是 §9 的保護。

## 7. 執行結果（Claude 在本執行環境實際執行；乾淨 checkout 的最終結果見 PR）

### 7.1 案例

| 案例 | actor | stage2Status | contractMatch | Observer 觀察值 | Stage 1 runner（Adapter 宣稱） |
|---|---|---|---|---|---|
| POC-001 | ACTOR-TEACHER | `UNATTESTED` | `MATCH` | `workspaceId = WS-A17`、15 筆、`crossWorkspaceDisclosure = false`；回應 ID 與狀態中該場次 15 筆一致；無其他工作空間的識別字串 | `PENDING_ATTESTATION` |
| POC-002 | ACTOR-OTHER | `UNATTESTED` | `MATCH` | 3 個請求都是 `FORBIDDEN`，回應只有 `code`、`traceId`；存在與不存在的目標回應形狀相同；`auditLog` 3 筆 `deny` | `PENDING_ATTESTATION` |
| POC-008 | ACTOR-TEACHER | `UNATTESTED` | `MATCH` | P9 R1 N1 U4、T15、已登記 11、到校 10；API 摘要＝場次回應重算＝狀態重算；`queryCount = 5`（binding、principal、目標、membership、entries） | `PENDING_ATTESTATION` |
| POC-009 | ACTOR-SC01-TEACHER | **`BLOCKED`** | `PARTIAL_MATCH_REST_BLOCKED` | `attendance = N`、`leaveVersion = 5`、`autoRewrite = false`（點名 v4→v4、請假 v5→v5、無非稽核文件變動）；適用提示 `FORBIDDEN`（`CAPABILITY_NOT_GRANTED`）；`applicability`／`pendingPeriods` 未觀察 | `FAIL`（Adapter 回報 `applicability = UNKNOWN`） |

### 7.2 負向與對照控制（真實 API＋Emulator）

每個負向情境先以相同的 actor 和請求跑一次**對照組**（必須允許），再改變單一條件。回應必須是 `403`、只有 `code`／`traceId`，且 `auditLog` 的原因碼符合預期。

| # | 情境 | 預期 | 實際（HTTP／code／稽核原因） | 對照組 | 結果 |
|---|---|---|---|---|---|
| 1 | no token | 拒絕 `TOKEN_MISSING` | 403／FORBIDDEN／TOKEN_MISSING | 通過 | 符合 |
| 2 | garbage token | 拒絕 `TOKEN_MALFORMED` | 403／FORBIDDEN／TOKEN_MALFORMED | 通過 | 符合 |
| 3 | forged token: expired exp | 拒絕 `TOKEN_EXPIRED` | 403／FORBIDDEN／TOKEN_EXPIRED | 通過 | 符合 |
| 4 | forged token: wrong audience | 拒絕 `TOKEN_WRONG_AUDIENCE` | 403／FORBIDDEN／TOKEN_WRONG_AUDIENCE | 通過 | 符合 |
| 5 | forged token: alg RS256 header | 拒絕 `TOKEN_NOT_EMULATOR` | 403／FORBIDDEN／TOKEN_NOT_EMULATOR | 通過 | 符合 |
| 6 | forged token: iat in the future | 拒絕 `TOKEN_FROM_FUTURE` | 403／FORBIDDEN／TOKEN_FROM_FUTURE | 通過 | 符合 |
| 7 | forged token: non-integer iat | 拒絕 `TOKEN_BAD_TIME` | 403／FORBIDDEN／TOKEN_BAD_TIME | 通過 | 符合 |
| 8 | Auth user disabled in emulator | 拒絕 `TOKEN_REJECTED_BY_EMULATOR` | 403／FORBIDDEN／TOKEN_REJECTED_BY_EMULATOR | 通過 | 符合 |
| 9 | binding missing | 拒絕 `BINDING_NOT_FOUND` | 403／FORBIDDEN／BINDING_NOT_FOUND | 通過 | 符合 |
| 10 | binding disabled (token still valid) | 拒絕 `BINDING_NOT_ACTIVE` | 403／FORBIDDEN／BINDING_NOT_ACTIVE | 通過 | 符合 |
| 11 | binding revoked (token still valid) | 拒絕 `BINDING_NOT_ACTIVE` | 403／FORBIDDEN／BINDING_NOT_ACTIVE | 通過 | 符合 |
| 12 | rebind: token issued before activatedAt | 拒絕 `TOKEN_BEFORE_BINDING` | 403／FORBIDDEN／TOKEN_BEFORE_BINDING | 通過；之後重新登入：200 | 符合 |
| 13 | binding activatedAt lowercase z | 拒絕 `BINDING_INVALID_TIME` | 403／FORBIDDEN／BINDING_INVALID_TIME | 通過 | 符合 |
| 14 | binding activatedAt 2026-02-29 (not a leap year) | 拒絕 `BINDING_INVALID_TIME` | 403／FORBIDDEN／BINDING_INVALID_TIME | 通過 | 符合 |
| 15 | binding activatedAt trailing newline | 拒絕 `BINDING_INVALID_TIME` | 403／FORBIDDEN／BINDING_INVALID_TIME | 通過 | 符合 |
| 16 | binding activatedAt with milliseconds | 拒絕 `BINDING_INVALID_TIME` | 403／FORBIDDEN／BINDING_INVALID_TIME | 通過 | 符合 |
| 17 | binding re-pointed to ACTOR-OTHER (membership of another principal not used) | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 18 | principal disabled | 拒絕 `PRINCIPAL_NOT_ACTIVE` | 403／FORBIDDEN／PRINCIPAL_NOT_ACTIVE | 通過 | 符合 |
| 19 | claimed classId of another class (N-18) | 拒絕 `SCOPE_CLAIM_MISMATCH` | 403／FORBIDDEN／SCOPE_CLAIM_MISMATCH | 通過 | 符合 |
| 20 | claimed workspace of another workspace | 拒絕 `SCOPE_CLAIM_MISMATCH` | 403／FORBIDDEN／SCOPE_CLAIM_MISMATCH | 通過 | 符合 |
| 21 | cross-workspace target with honest claim | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 22 | document classId field differs from path (N-19) | 拒絕 `SCOPE_INTEGRITY_ERROR` | 403／FORBIDDEN／SCOPE_INTEGRITY_ERROR | 通過 | 符合 |
| 23 | membership expired (validToExclusive in the past) | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 24 | membership validToExclusive = today (half-open boundary) | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 25 | membership not yet valid | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 26 | membership validFrom month 13 | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 27 | membership validFrom 2026-02-29 | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 28 | membership validFrom trailing space | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 29 | membership validToExclusive full-width digits | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 30 | membership missing rolePresetVersion (N-53) | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 31 | membership unknown preset version s2b1-v0 (N-47) | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 32 | membership suspended | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 33 | membership revoked (N-28) | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 34 | membership workspaceId field of another workspace (N-52) | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 35 | membership classId null (N-55) | 拒絕 `NO_VALID_MEMBERSHIP` | 403／FORBIDDEN／NO_VALID_MEMBERSHIP | 通過 | 符合 |
| 36 | capability removed (attendance.read missing) | 拒絕 `CAPABILITY_NOT_GRANTED` | 403／FORBIDDEN／CAPABILITY_NOT_GRANTED | 通過 | 符合 |
| 37 | capability beyond preset ignored (projection_display + attendance.read) | 拒絕 `CAPABILITY_NOT_GRANTED` | 403／FORBIDDEN／CAPABILITY_NOT_GRANTED | 通過 | 符合 |
| 38 | capability not enabled before D-09 (student.read needs roster.read) | 拒絕 `CAPABILITY_NOT_ENABLED` | 403／FORBIDDEN／CAPABILITY_NOT_ENABLED | 不適用 | 符合 |
| 39 | capability not held (SC01 teacher reads leave applicability) | 拒絕 `CAPABILITY_NOT_GRANTED` | 403／FORBIDDEN／CAPABILITY_NOT_GRANTED | 通過 | 符合 |
| 40 | unknown operation | 拒絕 `UNKNOWN_OPERATION` | 403／FORBIDDEN／UNKNOWN_OPERATION | 不適用 | 符合 |
| 41 | malformed target id | 拒絕 `TARGET_INVALID` | 403／FORBIDDEN／TARGET_INVALID | 不適用 | 符合 |
| 42 | membership validFrom = today (half-open boundary, allowed) | 允許 | 200／OK／OK | 通過 | 符合 |
| 43 | membership with no end date (null) allowed | 允許 | 200／OK／OK | 通過 | 符合 |
| 44 | backend unreachable (closed port) → UNAVAILABLE, no data | `UNAVAILABLE`，無資料 | 503／UNAVAILABLE／— | — | 符合 |

另外，Emulator 停止後的真實斷線：`scripts/run-cases.mjs` 在 `emulators:exec` 結束、連接埠確認關閉後啟動 API，回應 `503 UNAVAILABLE`，只有 `code`／`traceId`。

### 7.3 變異與竄改控制

| 變異 | 目的 | contractMatch | Stage 1 runner | 偵測到 |
|---|---|---|---|---|
| `MUT-skip-authz-POC-002` | API that skips membership/capability checks must be caught by the Observer | `MISMATCH_OR_UNOBSERVABLE` | `FAIL` | 是 |
| `MUT-skip-authz-POC-009` | applicability refusal must come from the real capability check | `MISMATCH_OR_UNOBSERVABLE` | `FAIL` | 是 |
| `MUT-hardcoded-adapter-POC-001` | answers without API calls must not be accepted | `MISMATCH_OR_UNOBSERVABLE` | `PENDING_ATTESTATION` | 是 |
| `MUT-hardcoded-adapter-POC-008` | hard-coded counts must not be accepted | `MISMATCH_OR_UNOBSERVABLE` | `PENDING_ATTESTATION` | 是 |
| `MUT-fixture-variant-POC-008` | Observer recounts real state; it does not copy the oracle | `MISMATCH` | `FAIL` | 是 |
| `MUT-tampered-trace-POC-001` | observation inputs changed after capture must be detected (digest) | `MISMATCH_OR_UNOBSERVABLE` | `PENDING_ATTESTATION` | 是 |
| `MUT-tampered-adapter-claim-POC-001` | a lying adapter claim does not change the Observer verdict and is flagged | `MATCH` | `FAIL` | 是 |


- `MUT-skip-authz-*`：以注入的授權函式模擬「略過 membership／capability 檢查」的錯誤 API。注入只在測試中使用；正式入口一律使用 `authorize()`。
- `MUT-hardcoded-adapter-*`：Adapter 不呼叫 API、直接回傳 oracle 的預期值。Stage 1 runner 會給 `PENDING_ATTESTATION`，這正是 Stage 1 不能 PASS 的理由；Stage 2 的 Observer 因為沒有 trace 而判為 `MISMATCH_OR_UNOBSERVABLE`。

### 7.4 遮罩與清理

- 遮罩：掃描全部 trace、狀態匯出與觀察檔，沒有 token、密碼、原始 `Authorization` 標頭或 fixture 虛構姓名。檢查集包含一組刻意在請求中夾帶 `password`、`displayName`、`email` 的請求。
- 清理：確認 nonce 標記後清除；結束時 0 個根集合、0 個帳號。

### 7.5 前批回歸

`npm run s2:test`（guard、port-state、非破壞性、本批單元測試）、`npm run s2:smoke`、`npm run s2:occupied-real` 全部通過。前批的連接埠三態、唯讀 probe、擁有權與清理規則未放寬。

## 8. 未驗證與限制

- **沒有認證**：沒有 Verifier、簽章、信任根（D-17）、§9 隔離。Adapter、Observer、API 在同一個使用者與機器上執行；本機任何程序都可以繞過代理直接存取 Emulator。
- Emulator token 沒有簽章（G-6）。
- CI 不執行本批（Q1 未決，維持現況，**不**代表已選定 Q1）。
- 沒有在 Windows 執行。
- 官方 Firebase 文件仍無法連線（代理回 403）。Emulator 行為依 firebase-tools 15.35.0 原始碼與本批實測（§3 G-6）。
- Emulator 與正式 Firestore 的差異未評估；collection group 查詢在正式環境需要索引設定，本批未處理。
- 稽核寫入與回應不是同一個交易；回應前寫入失敗時回 `UNAVAILABLE`，但沒有處理「寫入成功、回應送出失敗」。

## 9. 待決事項（本批沒有改變）

- Q1（CI）、Q2／D-17（信任根）、Q3（官方文件）：未決。
- D-01～D-17：維持預設。本批沒有為完成案例核准任何權限、放寬角色或啟用敏感 grant。
- 新增：G-1、G-2、G-3、G-4（§3）。
