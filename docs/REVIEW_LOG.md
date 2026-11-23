# REVIEW_LOG｜獨立審查紀錄

> 每一個 PR 記一段，詳細個案可附於 PR／Issue，本文只保留最新決策摘要與連結。

## PR #1｜PoC Stage 1 基準：導入 Starter Kit V1.2 流程層＋CMN-PoC-Stage1-v1.0

- PR URL：`https://github.com/hsuanyu9503/class-management-next/pull/1`
- Base SHA：`aff18f0a67a1fb5c6a550f8b1774ee34701c34a0`
- 風險等級及理由：`L2；新增可執行測試器與 CI workflow；無正式資料、秘密、部署權限。最終等級由專案負責人決定`
- 使用者決策：`已核准合併（2026-11-19，臺灣）`；PR #1 已合併為 `fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`

### 第 1 輪審查（Reviewed Head `211716e561867a0c2bd5c64e4d3f432ca027f42a`）

- 實際取得的證據：`差異包＋補件；以差異重建檔案執行隔離自測與負向測試；未取得完整 Repository、CI Run、Ruleset 畫面`
- ChatGPT 結論：`CHANGES REQUESTED／不建議合併`
- 問題清單：REV-001 HIGH、REV-002 HIGH、REV-003 MEDIUM、REV-004 MEDIUM
- 此 Head 的結論**不沿用**到修正後的 Head。

### Claude 逐項回覆（R1；格式依 `templates/CLAUDE_REVIEW_RESPONSE.md`）

- 審查版本 Head SHA：`211716e561867a0c2bd5c64e4d3f432ca027f42a`
- 修正後 Head SHA：`見 PR #1 最新 commit 與交接訊息`

| ID | 處理結果 | 修改位置／原因 | 驗證證據 | 待使用者決策 |
|---|---|---|---|---|
| REV-001 | 已修 | `poc/stage1/contracts/oracle-approval-v1.0.json`（獨立預期清單；能由 fixtures 推導的欄位改由 fixtures 重算；CSV 來源 token）；`poc/stage1/src/contract-guard.mjs`（寫死的不可放寬斷言）；`scripts/validate-stage1-guards.mjs` | `test/contract-guard.test.mjs` REV-001 共 6 項；以套件副本實測 POC-002=99 時 `stage1:all` exit 1 | 有：approval 清單狀態為 `PROPOSED_PENDING_HUMAN_APPROVAL`，需核准 |
| REV-002 | 已修 | `poc/stage1/src/runner.mjs`（BACKEND_REAL 最多 `PENDING_ATTESTATION`）；`src/oracle.mjs`（拒絕 placeholder 證據）；`src/evidence.mjs`（拒絕 PASS、必填 trace／evidenceFiles、輸出 `BLOCKED`＋`PENDING_ATTESTATION`） | REV-002 共 4 項；以 v1.0 原始 runner／evidence 執行時 4 項全部失敗 | 有：外部受控驗收層屬 Stage 2 以後的設計 |
| REV-003 | 已修 | `poc/stage1/contracts/stage1-baseline-lock.json`（fixed／mutable／addedSinceDelivery）；守護腳本逐檔核對 SHA-256／大小並分類所有檔案 | REV-003 共 3 項；`modifiedSinceV1Delivery` 如實列出 | 無 |
| REV-004 | 已修 | `CLAUDE.md`、`docs/WORKFLOW.md` 修正會誤導的句子；其他範本文件加「本 PoC 適用說明」；PR 模板改為 `stage1:all` | `tests/poc_docs_policy.test.mjs` 共 3 項 | 無 |

**已執行的測試（本機 Linux、Node 22；CI 結果以 PR checks 為準）**

| 命令／操作 | 結果 | 對應 Commit |
|---|---|---|
| npm run check | 成功 | 修正後 Head |
| npm test | 成功 10／10 | 修正後 Head |
| npm run stage1:all | 成功：Stage0 21／21、契約 14／14、防護 3／3、自我測試 33／33、72 筆 NOT_RUN | 修正後 Head |

**未解風險與新發現**

- 合併前必要確認 `.env.example` 補件：路徑與 SHA 隨新差異包另附。
- CSV 為 CRLF＋BOM；差異包無法保留位元組精度，重建時需比對差異包補件中的 fixed 檔案 SHA。
- 未在 Windows 執行 `npm.cmd run stage1:all`。

> 不要把 Claude 自己執行的測試稱作「獨立 Code Review」；請 ChatGPT 依新 Head SHA 複驗。

### 第 2 輪複驗（Reviewed Head `a59da0447bae3705ee7bc0fed71ebc9b8caf380e`）

- 實際取得的證據：完整差異＋增量差異＋補件，以 `git apply` 重建並核對 10 筆 SHA；隔離執行 check／test／stage1:all；CI 與 Ruleset 未能獨立核實
- ChatGPT 結論：`CHANGES REQUESTED`
- 狀態：REV-002 RESOLVED（Stage 1 範圍）；REV-003 RESOLVED_PARTIAL；REV-001／REV-005 HIGH 與 REV-004 MEDIUM 待修
- 關鍵反例：同一 PR 內協同改寫 POC-017 的 oracle、approval、manifest、lock → 全綠

### Claude 逐項回覆（R2）

- 審查版本 Head SHA：`a59da0447bae3705ee7bc0fed71ebc9b8caf380e`
- 修正後 Head SHA：`見 PR #1 最新 commit 與交接訊息`

| ID | 處理結果 | 修改位置／原因 | 驗證證據 | 待使用者決策 |
|---|---|---|---|---|
| REV-001／REV-005 | 已修（含明示殘餘風險） | `poc/stage1/src/contract-guard.mjs` `P0_PINNED`（20 個 P0 以字面值寫在程式中）；`scripts/verify-anchor.mjs`＋CI `baseline-anchor`（與負責人設定的 repository variable 比對） | `test/contract-guard.test.mjs` 四檔協同竄改測試、全 P0 欄位放寬測試；`tests/anchor.test.mjs`；以套件副本實測反例：stage1:all exit 1、anchor exit 1 | **有**：設定 `CMN_STAGE1_ANCHOR_SHA256`、將 `baseline-anchor` 設為 required check |
| REV-002 | 維持 RESOLVED | 無新變更 | 原測試持續通過 | 外部 attestation 屬 Stage 2 以後 |
| REV-003 | 已修 | lock 改定位為 PR 內一致性檢查，協同竄改由外部錨定處理；LOW：缺失 mutable 檔改為回報失敗 | LOW 測試 | 無 |
| REV-004 | 已修 | 操作文件逐句改寫；網站／發行 SOP 移至 `docs/starter-kit-reference/` | `tests/poc_docs_policy.test.mjs`（以 `a59da04` 舊句驗證能偵測） | 無 |

**已執行的測試（本機 Linux、Node 22）**

| 命令／操作 | 結果 | 對應 Commit |
|---|---|---|
| npm run check | 成功 | 修正後 Head |
| npm test | 成功 15／15 | 修正後 Head |
| npm run stage1:all | 成功：Stage0 21、契約 14、防護 4、自我測試 37、72 筆 NOT_RUN | 修正後 Head |
| verify-anchor（未設定變數） | 預期失敗：PENDING_OWNER_APPROVAL | 修正後 Head |

**未解風險**

- 修改 `ci.yml`／`verify-anchor.mjs` 的 PR 可以跳過比對，需人工逐行審查；`pull_request_target` 強化需另立 PR，在本 PR 合併後導入。
- 未在 Windows 執行 `npm.cmd`。

### 第 3 輪複驗與合併決議（Reviewed Head `635587b4685973413132a8a148446be300b99bbc`）

- 最後 Reviewed Head：`635587b46859`（完整 SHA 如上）
- ChatGPT 結論：`CONDITIONALLY APPROVED`
- 問題狀態（限已驗證範圍）：

| ID | 狀態 | 範圍說明 |
|---|---|---|
| REV-001 | RESOLVED | 獨立預期清單＋寫死的安全斷言＋P0 釘選 |
| REV-002 | RESOLVED | Stage 1 範圍：自稱 `BACKEND_REAL` 的結果最多 `PENDING_ATTESTATION`；正式 attestation 尚未實作 |
| REV-003 | RESOLVED | PR 內一致性檢查；多檔協同竄改交由外部錨定 |
| REV-004 | RESOLVED | PoC 操作文件已改寫；網站／發行 SOP 移至 `docs/starter-kit-reference/` |
| REV-005 | RESOLVED | P0 釘選＋外部錨定；修改 `ci.yml`／`verify-anchor.mjs` 可略過比對的殘餘風險仍存在，已明示 |

- **外部錨定**：專案負責人已設定 repository variable `CMN_STAGE1_ANCHOR_SHA256` = `e33380c24bc58bdc3ada4c2ce2d0796e8f23deb7871078ccf0f756475bb934e9`（29 份受保護檔案）。Claude 未設定、也未修改此值。
- **合併前 CI**（[run 44486915175](https://github.com/hsuanyu9503/class-management-next/actions/runs/44486915175)，Head `635587b…`）：`validate` success；`baseline-anchor` 第 1 次 failure（`PENDING_OWNER_APPROVAL`，預期），設定錨定值後第 2 次 **success**。兩項必要檢查於合併前皆通過。
- **Ruleset**：`main-protection` 經**負責人核對**為 Active、Target `main`、Bypass list 為空、要求 PR、必要檢查、禁止 force push。Claude 只能確認 `main` `protected: true`，無法讀取細項。
- **合併決議**：專案負責人正式核准合併；PR #1 已於 2026-11-19 21:20:35（臺灣）合併，Merge Commit `fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`；合併後的樹與 Reviewed Head 相同。
- **合併後 CI**（[run 44532509377](https://github.com/hsuanyu9503/class-management-next/actions/runs/44532509377)，push `main`，commit `fdcb5b9…`）：`validate` success、`baseline-anchor` success。
- **正式核准身分**：ChatGPT 的獨立審查報告**不是** GitHub 帳號的正式 Approve；合併由專案負責人以自己的 GitHub 帳號執行。

## Stage 1 收尾 PR（L1 文件）

- 範圍：只修改 `docs/`；不修改 `src/`、`scripts/`、`tests/`、`.github/workflows/` 或任何受保護的基準契約。外部錨定 digest 必須維持 `e33380c2…34e9`。
- Base：`fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`；Head 與審查結論：見該 PR。
- ChatGPT 結論：`未審查`

## S2-B1｜Firebase 資料模型與權限規格 v0.1（文件 PR）

- Base SHA：`4a842e7399d8fb64f3a0bc6650581920cd38890f`（PR #2 Merge Commit）
- Reviewed Head SHA：`[尚未審查]`
- 風險等級：負責人初評 **L1**（只新增文件，無可執行程式）。Claude 註記：`docs/RISK_POLICY.md` 的強制升級條款提到「存取權限、跨使用者資料可見性」；本 PR 是權限設計規格，雖然沒有行為變更，建議以較高深度審查語意。最終等級由負責人決定。
- 範圍：`docs/stage2/` 4 份新文件；`docs/HANDOFF.md`、`docs/REVIEW_LOG.md` 狀態更新。不修改 `poc/stage1/`、受保護檔案、`src/`、`scripts/`、`tests/`、`.github/`。
- ChatGPT 結論：`未審查`
- 使用者決策：`未核准`

### 第 1 輪審查（Reviewed Head `af1ffc28707bfea0cedc77d3dc9431d82ddc06f5`）

- ChatGPT 結論：`CHANGES REQUESTED`（REV-001、REV-002 HIGH；REV-003～REV-006 MEDIUM；另要求確認 D-05 與 `hasSensitiveNote`）

### Claude 逐項回覆（R1；格式依 `templates/CLAUDE_REVIEW_RESPONSE.md`）

- 審查版本 Head SHA：`af1ffc28707bfea0cedc77d3dc9431d82ddc06f5`
- 修正後 Head SHA：`見 PR #3 最新 commit 與交接訊息`

| ID | 處理結果 | 修改位置 | 驗證證據 | 待使用者決策 |
|---|---|---|---|---|
| REV-001 | 已修 | AUTHORIZATION §4（每個 capability 固定 scopeType）、§6.1–6.4（分支 C／W 與操作對照）、§6.3 步驟 7–9（分支 W 只能管理、不能讀班級資料、禁止自我授權）；DATA-MODEL I-17、I-18；ACCESS-MATRIX §2–§3 | 負向案例 N-01～N-04；交叉檢查 REV-001 共 6 項 | D-09（workspace capability 名稱核准前不生效） |
| REV-002 | 已修 | AUTHORIZATION §8：收據範圍＝工作空間；canonical `requestHash`（欄位、排除項、`stableJson`、SHA-256、測試向量）；處理順序（先授權再讀收據）；跨 principal 重用表；查詢收據規則；DATA-MODEL §3.7、I-09 | N-11～N-15；交叉檢查以 Stage 1 `stableJson` 重算測試向量 | D-10（POC-019 actor 變體缺少第二個有授權的 fixture principal） |
| REV-003 | 已修 | ACCESS-MATRIX §5：fixture principal 的 capability 與 Stage 1 完全相同；POC-001 改由 `attendance.read`＋`rosterSnapshot` 取得；`roster.read` 等提案標為未啟用（AUTHORIZATION §4）；TRACEABILITY POC-001 | 交叉檢查 REV-003 共 4 項 | D-09 |
| REV-004 | 已修 | DATA-MODEL §3.7：收據完全不可變，`derivedStatusAtCommit` 固定為 `pending`；目前進度移到新集合 `derivedProgress`；I-07 改為 Revision／Receipt／Event 各恰好 1 筆；I-10 | N-16、N-17；交叉檢查 REV-004 共 5 項 | 無 |
| REV-005 | 已修 | DATA-MODEL §4：路徑為權威、欄位必須一致、不一致以 `SCOPE_INTEGRITY_ERROR` 拒絕；每個集合的 Scope 來源表；I-01、I-02；AUTHORIZATION §6.1 步驟 3 | N-18、N-19；交叉檢查 REV-005 共 2 項 | 無 |
| REV-006 | 已修 | AUTHORIZATION §7：read／revise 分開授予、存取條件、建立（`sensitive.grant.manage`、不可自我授予、`expiresAt` 必填）、撤銷（單向）、過期、連帶失效；D-06 前建立 grant 的 API 停用；DATA-MODEL §3.3 | N-05～N-10；交叉檢查 REV-006 共 4 項 | D-06 |
| D-05 | 已定預設 | 科任 preset 不含 `attendance.write`，直到節次層級 scope 經審查 | N-20 | D-05 |
| `hasSensitiveNote` | 已修 | 從請假摘要刪除；是否有敏感備註只能由具 read grant 者查詢 `leaveSensitiveNotes` 得知，其他人「沒有」與「沒有權限」回應相同（DATA-MODEL §3.6、I-11） | N-22 | 無 |
| 其他待決 | 已定預設 | AUTHORIZATION §12：D-01～D-10 全部列出決定前的拒絕／停用預設值與解除阻擋條件 | 交叉檢查「每個待決事項都有預設與解除條件」 | D-01～D-10 |

**額外修正（審查未列出，Claude 自查發現）**

- 稽核的 `resourceRef` 對班級資料只記 `classId`＋文件 ID 雜湊，避免只有 `audit.read` 的管理者藉稽核推知班級資料（與 REV-001「不得擴大班級資料閱讀權」一致）。
- fixture membership 的 `validToExclusive` 改為 `null`：原寫「資料集次日」會讓在之後執行的測試全部 `FORBIDDEN`。
- 契約對照中因章節重編而失效的 `§` 參照已更新。

**已執行的測試（本機 Linux、Node 22）**

| 命令／操作 | 結果 |
|---|---|
| npm run check | 成功 |
| npm test | 成功 15／15 |
| npm run stage1:all | 成功：Stage0 21、契約 14、防護 4、執行器 37、72 筆 NOT_RUN |
| verify-anchor（負責人核准值） | ANCHOR_OK（29 份受保護檔案未變） |
| 文件交叉檢查 v0.1（10 項） | 10／10 |
| R1 交叉檢查（31 項，針對 REV-001～006） | 新 Head 31／31；以同一腳本檢查舊 Head `af1ffc2`：26 項失敗，證明檢查能偵測原本的矛盾 |

> 交叉檢查腳本不提交到 Repository（本 PR 維持純文件範圍），隨審查包附上。

### 第 2 輪審查（Reviewed Head `c19910316e1cc4b1025d3ea7be436b0358a2142b`）

- ChatGPT 結論：`CHANGES REQUESTED`。REV-001～006 的主要問題已修正；新增 REV-007、REV-008（HIGH）、REV-009（MEDIUM），以及文件測試前置條件的要求。

### Claude 逐項回覆（R2）

- 審查版本 Head SHA：`c19910316e1cc4b1025d3ea7be436b0358a2142b`
- 修正後 Head SHA：`見 PR #3 最新 commit 與交接訊息`

| ID | 處理結果 | 修改位置 | 驗證證據 | 待使用者決策 |
|---|---|---|---|---|
| REV-007 | 已修 | AUTHORIZATION §6.1 步驟 2／2a：binding `status = active`、token `iat ≥ activatedAt`、principal `active`、membership 有效，三者各自檢查；§6.7 binding 生命週期（建立、停用、撤銷、重新綁定、失效）與生效時機；DATA-MODEL §3.1 binding 欄位、I-19；ACCESS-MATRIX 前提說明 | N-23～N-28；評估程式：移除 binding 狀態檢查 → N-23、N-24 失敗；移除 `activatedAt` 檢查 → N-25 失敗 | D-13（binding 由誰管理） |
| REV-008 | 已修 | AUTHORIZATION §6.6：稽核分為 `auditLog`（完整，沒有任何 API 可讀）與 `auditSummaries`（白名單動作與欄位，不含任何班級資料事件、grant 與 binding 事件）；移除 v0.2 的文件 ID 雜湊作法並說明原因；`audit.read` 只限同一工作空間；DATA-MODEL §3.7、I-10、I-11、I-20；ACCESS-MATRIX §3 | N-29～N-32；評估程式：把 `leave.sensitive.read` 放進摘要白名單 → N-29、N-31 失敗；開放 `auditLog` → N-30 失敗；允許跨工作空間 → N-32 失敗 | D-11（完整稽核的調閱程序） |
| REV-009 | 已修 | AUTHORIZATION §5：D-05 無例外，例外政策標為待負責人核准；membership capability 必須是 preset 預設值的子集，`rolePreset` 不可修改；§6.2／§6.3 步驟 5：評估時忽略超出 preset 的 capability；§6.3 步驟 9；DATA-MODEL I-21；ACCESS-MATRIX §2、§3 | N-33～N-37；評估程式：允許手動加入 → N-33、N-34 失敗；評估時不忽略超出 preset 的 capability → N-37 失敗 | D-05、D-12 |
| 前置條件 | 已修 | AUTHORIZATION §11：每個案例有「前置條件」欄，並寫明未核准時只能驗證預設拒絕；N-02 拆成 N-02a（D-09 未核准 → `FORBIDDEN`）與 N-02b（D-09 已核准 → 允許）；敏感 grant 正向案例（N-06～N-09b、N-29s）標示 D-06＋D-09 | 評估程式：每個有前置條件的案例在 `approvals = []` 下重新評估，都必須是 `FORBIDDEN`／`DISABLED`；把未啟用的 capability 當成已啟用 → 6 個案例失敗；§11 前置條件與 §13 JSON 必須一致 | D-06、D-09 |

**額外修正（Claude 自查發現）**

- `sensitive.grant.manage` 原本沒有任何指派方式：它不在 preset 中，而新的子集規則又禁止手動加入。現在明確寫成由 D-06 決定指派程序，並新增 N-09b 作為 N-09 的對照組，確認 N-09 被拒的原因確實是「授予自己」。
- 評估程式在開發過程中找到 3 處 §11 與 §13 不一致（N-04 前置條件、N-07b 漏列、N-36 前置條件），已修正。
- 評估程式的第一版沒有任何案例能偵測「評估時不忽略超出 preset 的 capability」，所以新增 N-37。

**新的負向測試規格**

- §13 新增機器可讀的授權案例（31 個），只是資料，不是程式。
- 審查用評估程式（不提交）的做法：
  - 從文件本身解析 capability 表、preset 表、稽核白名單與 §11 前置條件，再依 §6、§7、§12 的規則評估每個案例；
  - 另做 8 種「故意放寬規則」的變異測試，每一種都會讓特定案例失敗。
- 這不是只檢查關鍵字是否存在：只要表格與案例互相矛盾，或規則被放寬，就會失敗。

**已執行的測試（本機 Linux、Node 22）**

| 命令／操作 | 結果 |
|---|---|
| npm run check | 成功 |
| npm test | 成功 15／15 |
| npm run stage1:all | 成功：Stage0 21、契約 14、防護 4、執行器 37、72 筆 NOT_RUN |
| verify-anchor（負責人核准值） | ANCHOR_OK（29 份受保護檔案未變） |
| 文件交叉檢查 v0.1 | 11／11（新增「稽核動作名稱不得與 capability 名稱重複」） |
| R1 交叉檢查 | 31／31 |
| R2 授權案例評估 | 31／31；8 種變異全部被偵測 |

### 第 3 輪審查（Reviewed Head `89b975a9b50cc03d424eacb160cad2bc4f9a8544`）

- ChatGPT 結論：`CHANGES REQUESTED`，暫緩合併。新增 REV-010（HIGH）、REV-011、REV-012（MEDIUM），並要求補強 REV-008 的證據。
- 審查深度：權限規格依要求採 **L3 深度**審查；最終風險等級由負責人決定。

### Claude 逐項回覆（R3）

- 審查版本 Head SHA：`89b975a9b50cc03d424eacb160cad2bc4f9a8544`（開始修正前確認：分支上沒有新提交）
- 修正後 Head SHA：`見 PR #3 最新 commit 與交接訊息`

| ID | 處理結果 | 修改位置 | 證據 | 未解決／殘餘風險 |
|---|---|---|---|---|
| REV-010 | 已修 | AUTHORIZATION §6.4 自我讀取：§6.1 步驟 1–2a 全部通過，**且**在該工作空間至少有一筆有效 membership；沒有有效 membership 時一律 `FORBIDDEN`。較寬鬆的作法列為 D-14，決定前拒絕。DATA-MODEL I-19、ACCESS-MATRIX §3 同步 | N-38～N-42、N-55b；變異「自我讀取跳過 principal 檢查」被 N-38 偵測；「自我讀取不需 membership」被 N-39、N-40 偵測 | D-14 |
| REV-011 | 已修 | AUTHORIZATION 名詞與 §5：capability 決定操作，preset 是**版本化的上限**（`s2b1-v1`），有效 capability = membership 上的 capability ∩ 建立時記錄版本的 preset 預設值；preset 不授予。DATA-MODEL 新增 `rolePresetVersion`，I-21 改寫（包含 `sensitive.grant.manage` 依 D-06 指派的例外）。ACCESS-MATRIX §1、§5：fixture 對應 `homeroom_teacher@s2b1-v1`，capability 與 Stage 1 相同，不展開、不繞過 | 正向回歸 N-43、N-44；超額 capability N-45；preset 不授予 N-46；未知版本 N-47。變異「preset 直接授予」被 N-46、N-48 偵測；「忽略 preset 版本」被 N-47 偵測 | 修改 preset 時的遷移程序未定義（只規定必須建立新版本） |
| REV-012 | 已修 | AUTHORIZATION §6.2／§6.3 步驟 5：membership 必須 `principalId`、`workspaceId` 相符、必要欄位齊全，workspace membership 的 `classId` 必須為 null；§7 grant 必要欄位；§13 縮限證據範圍，列出評估程式**不涵蓋**的規則與 6 項上游輸入假設；評估程式改用明確的 principal／binding／membership／grant 關聯模型 | 審查者的兩個反例已收為 N-48、N-49，且都被拒絕。另有錯誤 principal（N-50、N-51）、錯誤工作空間（N-52）、缺少欄位（N-53、N-54、N-54b）、class membership 的 `classId` 為 null（N-55、N-55b）。每項規則都有一個專屬變異會被偵測到 | 評估程式只是模型測試，不代表規格完整或任何後端正確 |
| REV-008 證據 | 已補 | AUTHORIZATION §6.6：`summaryId` 為隨機 UUID、不得由 `auditLog` 推導；`reasonCode` 白名單，其他原因碼一律寫成 `OTHER`；欄位裁剪。**設計調整**：敏感存取改為只依 grant，建立／撤銷 grant 不修改 membership，因此不會產生間接的 `membership.update`，`membership.manage` 讀取他人 membership 時也看不到誰有敏感存取權。推知限制改寫為「不宣稱完全無法推知」 | N-57 欄位裁剪、N-58 原因碼、N-59 成對輸入（只差敏感事件，摘要逐欄相同）、N-60 grant 不修改 membership。變異「多帶欄位」「原因碼直通」「`summaryId` 取自 `auditLog`」「grant 更新 membership」「敏感事件進入摘要」都被偵測到 | 管理者仍可能從系統以外的資訊推測（例如人事異動的時間）；本規格只保證系統產生的摘要不揭露敏感事件 |

**對「設計調整」的說明**：R1 曾規定敏感存取需要「membership 上有 `leave.sensitive.*`」加上「grant」兩者。R3 檢查 REV-008 時發現，grant 流程必須同時修改 membership，這會讓 `membership.manage` 的持有者從 membership 內容推知誰有敏感存取權。因此改為只依 grant：membership 不含、也不得含 `leave.sensitive.*`；條件改為「有效 class membership（任何 preset）＋有效 grant」。這一點請審查者特別確認是否接受。

**測試要求的對應**

- 原 31 個案例全部保留（換成明確關聯的模型 `s2b1-authz-cases-v2`），新增 25 個，共 56 個。
- 43 個負向案例中，38 個附對照組：只改被測條件就會變成 `ALLOW`。
- 其餘 5 個沒有對照組，因為在目前的核准狀態下，沒有任何單一條件能讓它們變成允許：
  - N-02a：正向對應是 N-02b（D-09 核准後）；
  - N-05：正向對應是 N-29s（D-06＋D-09 核准後有 grant）；
  - N-10：正向對應是 N-09b；
  - N-21：未啟用的 capability，由「未核准 capability 視為已啟用」變異覆蓋；
  - N-30：`auditLog` 沒有任何允許的路徑，由「開放 `auditLog`」變異覆蓋。
- D-06＋D-09 的 12 個案例，都分別評估「兩者皆無、只有 D-06、只有 D-09、兩者皆有」四種狀態（輸出中的組合矩陣）；正向結果只代表假設核准的模型情境，不代表實際核准。
- 原 8 種變異測試全部保留，另新增 16 種，共 24 種，全部被特定案例偵測到。

**開發中評估程式自己抓到的問題（已修正）**

- 原因碼白名單的解析規則不接受底線，只讀到 `OK`，導致 N-58 是因為錯誤原因而通過。已修正，並在白名單讀取失敗時直接中止。
- N-29 原本要求 D-06＋D-09，但讀摘要本身只需要 D-09；依真子集規則修正。
- 兩個變異第一次沒有被偵測：
  - 「class membership 的 `classId` 可為 null」在班級資料路徑上已被班級比對擋下，只在自我讀取路徑才有影響，所以新增 N-55b；
  - 「接受缺少必要欄位」被其他檢查遮住，所以新增只有必要欄位規則能擋下的 N-54b。
- R1 交叉檢查發現 §7 改寫後少寫了 `leave.sensitive.revise`，已補回。

**已執行的測試（本機 Linux、Node 22；完整輸出見審查包）**

| 命令／操作 | 結果 |
|---|---|
| npm run check | 成功 |
| npm test | 成功 15／15 |
| npm run stage1:all | 成功：Stage0 21、契約 14、防護 4、執行器 37、72 筆 NOT_RUN |
| verify-anchor（負責人核准值） | ANCHOR_OK（29 份受保護檔案未變） |
| 文件交叉檢查 v0.1 | 11／11 |
| R1 交叉檢查 | 31／31 |
| 授權案例評估 v2 | 56／56；24 種變異全部被偵測 |

> 以上全部是文件與模型層級的檢查。Firebase／PostgreSQL 36×2 項後端案例仍為 `NOT_RUN`；文件評估、mock、自我測試與 CI 成功都不能當成後端安全驗證通過。

### 第 4 輪審查（Reviewed Head `f5960a1771f7a56524328b0e1d1e254ab996c29c`）

- ChatGPT 結論：`CHANGES REQUESTED`，暫緩合併。REV-010、REV-011 已修正；REV-012 的兩個原反例已修正；REV-008 的補強在模型範圍內成立。
- 新增：REV-013（HIGH）、REV-014（MEDIUM），以及 grant 與 membership 生命週期的釐清要求。
- 審查深度：L3；最終分級由負責人決定。

### Claude 逐項回覆（R4）

- 審查版本 Head SHA：`f5960a1771f7a56524328b0e1d1e254ab996c29c`（開始修正前確認：分支上沒有新提交）
- 修正後 Head SHA：`見 PR #3 最新 commit 與交接訊息`

| ID | 處理結果 | 修正位置與規則 | 正反例與變異證據 | 未解決／需負責人核准 |
|---|---|---|---|---|
| REV-013 | 已修 | 授權 §7.1：分成兩條互不替代的路徑。一般班級資料走 C-cap（§6.2，只看 membership capability）；敏感備註走 C-sens（§7.2）。§6.2 步驟 6 改為「敏感備註不走本步驟」，消除「capability 必須在 membership 中」與「敏感 capability 不得寫入 membership」的矛盾。§7.3 新增 preset 資格表；**D-15 核准前沒有任何 preset 具資格**。存取矩陣的拒絕沒有改成允許：科任、投影維持 `—`，導師標為「提案；需 D-06＋D-09＋D-15」 | 審查者的兩個重現都已收入，且都是 `FORBIDDEN`：`X-PD-read-valid`（投影＋有效 read grant）、`X-ST-revise-valid`（科任＋有效 revise grant）。共 38 個 X 案例，涵蓋 3 種 preset × read／revise × 6 種 grant 狀態（無、錯誤 principal、錯誤班級、錯誤 capability、綁定其他 membership、有效），另加 2 個管理者案例。變異「任何 preset 都具資格」被 X-ST／X-PD 的 valid 案例偵測；「忽略 D-15」被子集規則偵測 | **D-15**（資格表） |
| REV-014 | 已修 | 授權 §7.5：建立 grant 的 9 項依序檢查與失敗結果。新增 `INVALID_INPUT` 提案代碼。時間格式固定為 UTC `YYYY-MM-DDTHH:MM:SSZ`，不接受時區位移、只有日期或毫秒；`expiresAt` 必須嚴格晚於現在。`reasonCode` 格式為 `^[A-Z][A-Z0-9_]{2,63}$`。第 9 項最長期限由 D-06 決定，本規格不訂。模型結果改名為 `MODEL_CHECKS_PASSED`，§13 列出刻意不納入模型的檢查 | G-00 是完整合法輸入的正向案例；G-01～G-16 是負向案例，各附只還原該欄位的對照組；N-09b、N-60 補齊完整輸入。專屬變異：略過期限（6 案）、時間格式寬鬆（4 案）、略過原因碼（3 案）、略過 capability 檢查、略過目標 membership、略過資格，都被偵測到 | D-06：最長期限、兩人核准、`reasonCode` 清單、指派程序；`INVALID_INPUT` 代碼是否採用 |
| 生命週期 | 已定規則 | 授權 §7.4、資料模型 `sensitiveGrants` 與 I-22：grant 綁定 `membershipId` 與 `membershipVersion`。撤銷、過期、暫停或任何更新都使 grant 永久失效；撤銷後重建、暫停後恢復都**不會**恢復舊 grant；同班撤銷另一筆 membership 不影響 | L-01 重建、L-02 撤銷另一筆（正向）、L-03 撤銷綁定的那一筆、L-04 暫停、L-05 暫停後恢復、L-06 過期、L-07 其他更新、L-08 grant 的時間格式不合法。變異「grant 不綁定 membership」被 L-01、L-03 等偵測；「忽略 membership 版本」被 L-05、L-07 偵測 | **D-16**（恢復或延長時是否恢復 grant；預設不恢復） |
| §6.3 步驟 9 | 已修 | 改為「建立或修改 membership 時（兩者規則相同）」，並明寫包含在既有 workspace membership 上新增 capability | N-62（修改）；變異「只檢查建立」被 N-62 偵測 | 無 |

**原 56 個案例的處理**：全部保留，測試意圖不變。為配合新規則做了以下調整：

- 所有 membership 加上 `membershipId`、`version`，所有 grant 加上綁定欄位、`grantedAt`、`reasonCode`。因為這些現在都是必要欄位，缺少的話案例會因為其他原因被拒，造成假通過。
- 9 個敏感路徑案例（N-06、N-07、N-07b、N-08、N-29s、N-51、N-54、N-54b、N-56）的前置條件加上 D-15。§11 已同步，N-29s 則依附在 N-29 下。
- 建立 grant 的案例（N-09、N-09b、N-10、N-60）補上完整輸入，前置條件加上 D-15，正向結果由 `ALLOW` 改名為 `MODEL_CHECKS_PASSED`。

**測試總覽**

- 120 個案例：原 56 個，加上新 64 個（38 個 X、8 個 L、17 個 G、N-62）。
- 103 個負向案例中，76 個有「只改被測條件即為正向」的對照組。其餘 27 個沒有：
  - 原有的 5 個，理由同 R3；
  - 22 個 X 案例同時有兩個失敗條件（preset 不具資格，加上 grant 錯誤或不存在），沒有只改一個條件就能允許的對照。它們的單一條件對應案例都有對照組：同 grant 狀態的 X-HR 案例，以及同 preset 的 `valid` 案例；
  - X-WA-read-valid、X-WA-revise-valid：管理者沒有 class membership，屬於結構上不可能的路徑。
- 前置條件包含 D-06＋D-09 的 75 個案例，都在每一個真子集下重新評估，包括「兩者皆無、只有 D-06、只有 D-09」以及缺少 D-15 的組合，結果都必須是拒絕或停用。正向結果只代表「假設已核准」的模型情境。
- 35 種變異（原 24 種，加上新 11 種）全部被特定案例偵測到；輸出列出每一種變異的所有偵測案例。
- 摘要欄位裁剪（N-57）、原因碼轉換（N-58）、成對輸入（N-59）、grant 不修改 membership（N-60、G-00）全部保留。
- 摘要 ID 測試只驗證「不受 `auditLog` 序號影響」，**不驗證** UUID 的隨機性或唯一性（§13 假設 6）。

**開發中評估程式抓到的問題（已修正）**

- 評估程式自己的兩個錯誤：
  - §11 解析只接受 `N-` 開頭的 ID；
  - 為了對應 N-29s 而去掉結尾 `s` 的規則，誤傷了 `wrongClass`。
  已改為只對 `N-數字s` 生效。
- v0.1 交叉檢查發現文件把欄位參照寫成 `membership.version`，看起來像 capability 名稱，已改寫。
- R1 交叉檢查發現 §7 改寫後少了「`grantedBy` 不可等於被授權者」與「連帶失效」的明文，已補回；交叉檢查本身沒有放寬。

**上游假設與殘餘風險**

- §13 列出的 6 項上游假設不變。`d06Assignments` 仍只是 D-06 程序的佔位，不代表真實指派流程已驗證。
- 保守的生命週期規則，代表任何 membership 更新（即使只是無關的 capability 變更）都會使 grant 失效，必須重新建立。這可能造成操作負擔，由 D-16 決定是否調整。
- 所有證據都是文件與模型層級。Firebase／PostgreSQL 36×2 項後端案例仍為 `NOT_RUN`；文件、模型、mock 或 CI 成功都不能當成後端安全驗證通過。

### 第 5 輪審查（Reviewed Head `e588deb532aee91487fd4ccaa90d8d0a892fec94`）

- ChatGPT 結論：`CHANGES REQUESTED`，暫緩合併。本輪沒有新增 HIGH。
- 已成立並保留：REV-013、grant／membership 生命週期、workspace capability 的建立與修改限制、摘要證據。
- 新增：REV-015（MEDIUM）、§6.6 錯誤代碼說明、N-29 前置條件文字。
- 審查深度：L3；最終分級由負責人決定。

### Claude 逐項回覆（R5）

- 審查版本 Head SHA：`e588deb532aee91487fd4ccaa90d8d0a892fec94`（開始修正前確認：分支上沒有新提交）
- 修正後 Head SHA：`見 PR #3 最新 commit 與交接訊息`

| ID | 處理結果 | 修正位置與規則 | 正反例與變異證據 | 未驗證／殘餘風險 |
|---|---|---|---|---|
| REV-015 | 已修 | 授權 §7.6（新增），建立 grant 與既有 grant 存取共用：<br>• **整個字串**完全符合 ASCII `YYYY-MM-DDTHH:MM:SSZ`（不接受前後空白、尾端換行、額外字元、小寫 z、全形數字），並明示不得使用 `re.match`＋`$` 這類會在尾端換行前就算符合的比對；<br>• 再依西曆實際解析：月、當月天數、閏年規則、時分秒範圍，不接受閏秒；<br>• 驗證通過才比較。建立時 `expiresAt` 必須嚴格晚於現在，存取時到期（含等於現在）即拒絕；<br>• `reasonCode` 也是整個字串比對，格式與長度限制不變。<br>建立時輸入不合法回 `INVALID_INPUT`；既有 grant 的時間不合法則該 grant 無效，回 `FORBIDDEN`。§7.2、§7.5 第 7、8 項與資料模型 `sensitiveGrants` 同步。§13 原本的上游假設 5（「可依字串比較」）已**刪除**，改為由評估程式實際驗證 | 新增 49 個 T 案例（43 個負向，各附「只把該值改回合法」的對照組；6 個正向）：<br>• 建立路徑：16 種不合法 `expiresAt`（含審查者的 3 個重現）、7 種不合法 `reasonCode`（含 `ABC\n`）；正向為合法閏日 `2028-02-29`、比現在晚 1 秒、長度 3 與 64 的原因碼；<br>• 存取路徑：同樣 16 種不合法 `expiresAt`，加上等於現在、早 1 秒、2 種不合法 `grantedAt`；正向為閏日、晚 1 秒。<br>新增變異：「只檢查字串外形」（v3 行為）被兩條路徑共 24 案偵測；「接受尾端換行」被 4 案偵測（時間與原因碼都有）；「閏年規則錯誤」被 2 案；「到期判斷含等號」被 2 案 | v3 的外形檢查還有一個審查者沒列出的漏洞：Python 的 `\d` 會接受全形數字。已由 `fullwidth` 案例涵蓋。實作階段仍需在實際語言與函式庫上重做這些測試 |
| §6.6 錯誤代碼 | 已修 | §6.6 改為：授權失敗一律 `FORBIDDEN`；輸入格式錯誤回 `INVALID_INPUT`，但**只在通過該操作的操作者資格檢查之後**才可能出現（建立 grant 為 §7.5 第 1–3 項之後）。未授權者不論輸入格式如何都得到 `FORBIDDEN`。既有資料不合法不屬於輸入錯誤，回 `FORBIDDEN`。`INVALID_INPUT` 仍是 S2-B1 提案代碼，不修改 Stage 1 錯誤代碼契約 | 既有的檢查順序不變（評估程式中，操作者資格在格式檢查之前）；N-09、G-16 等未授權案例仍為 `FORBIDDEN` | 已具 `sensitive.grant.manage` 的操作者，可以從第 7、8 項的 `INVALID_INPUT` 推知第 5、6 項的目標檢查已通過；已在 §6.6 列為可接受的殘餘風險，待審查確認 |
| N-29 文字 | 已修 | §11 N-29 改為「前置步驟 N-29s，需要 D-06＋D-09＋D-15」，並註明「讀取摘要本身只需要 D-09」 | JSON 中 N-29 的 `approvals` 仍為 `["D-09"]`、N-29s 為 D-06＋D-09＋D-15；評估程式的 §11 前置條件比對通過 | 無 |

**原有測試的保留**

- 原 120 個案例**一字未改**（已比對 `e588deb` 與本版 JSON 的前 120 筆，完全相同）。
- 原 76 個對照組、35 種變異全部保留並重跑；變異共 39 種，全部被偵測。
- 調整只在評估程式：
  - 時間改用嚴格驗證並解析後比較；
  - `reasonCode` 改用整個字串比對；
  - 既有 grant 另外驗證 `grantedAt`；
  - §11 解析接受 `T-` 前綴與 `+` 字元。
- 新規則沒有改變原有案例的任何預期結果。

**測試總覽**：169 個案例，146 個負向案例中 119 個有對照組，其餘 27 個不變，理由同 R4。前置條件含 D-06＋D-09 的 124 個案例，都在每個真子集下重新評估。preset 資格限制、membership 綁定與版本失效、摘要成對測試全部保留。

**未驗證項目與殘餘風險**

- 模型與文件層級的時間驗證，不代表 Firestore、受控 API 或任何語言的實作會正確處理；實作時必須以相同案例重新測試。
- 伺服器「現在時間」的來源與時鐘誤差，不在本規格範圍內。
- 摘要 ID 測試仍不驗證 UUID 的隨機性或唯一性。
- Firebase／PostgreSQL 36×2 項後端案例仍為 `NOT_RUN`；模型、文件、mock 與 CI 成功都不能當成後端安全驗證通過。

### 第 6 輪審查（Reviewed Head `221d15567e0aebe0b8a5f5e2555360cf1a25f5bd`）

- ChatGPT 結論：文件與模型範圍**有條件通過**，可進入使用者驗收。REV-015 已修正；沒有新增 BLOCKER／HIGH／MEDIUM。
- 剩下 REV-016、REV-017，都是 LOW。
- 「有條件通過」不是合併授權，也不是後端安全驗證通過。

### Claude 逐項回覆（收尾）

- 審查版本 Head SHA：`221d15567e0aebe0b8a5f5e2555360cf1a25f5bd`（開始修正前確認：分支上沒有新提交）
- 修正後 Head SHA：`見 PR #3 最新 commit 與交接訊息`

| ID | 處理結果 | 修改位置 | 測試證據 | 未驗證項目 |
|---|---|---|---|---|
| REV-016 | 已修 | 授權 §7.2：既有 grant 的 `reasonCode` 也必須通過 §7.6，不合法即該 grant 無效、不得作為授權依據，沒有其他有效 grant 時為 `FORBIDDEN`。§7.6 新增「使用位置」表：建立時回 `INVALID_INPUT`，既有 grant 則該 grant 無效。資料模型 `sensitiveGrants` 同步。評估程式 `gvalid()` 改為呼叫與建立時相同的 `reason_ok()` | 新增 11 個 R-A 案例：<br>• 負向 8 個：尾端換行（審查者重現 `ABC\n`）、尾端空白、開頭空白、非法字元、非字串、長度 2、長度 65、缺少欄位，前 7 個各附「把原因碼改回合法」的對照組；<br>• 正向 3 個：長度 3、長度 64，以及「另有一筆有效 grant」（無效 grant 被忽略、以有效的那筆授權）。<br>專屬變異「略過既有 grant 原因碼驗證」被 7 個案例偵測；既有變異「接受尾端換行」現在也在既有 grant 路徑上被偵測（R-A-rc-nl） | `R-A-rc-missing` 同時受「必要欄位」與 `reason_ok()` 兩條規則保護，任何單一變異都不會讓它變成允許，所以沒有專屬變異。允許的代碼清單仍由 D-06 決定 |
| REV-017 | 已修（只修證據範圍） | 授權 §13 第 5 項改寫，分成三部分：<br>• 已嚴格解析的時間只有 4 項：建立請求的 `expiresAt`、既有 grant 的 `expiresAt`／`grantedAt`、模型的現在時間；<br>• 沒有驗證格式與真實日期合法性、直接用字串比較的時間：binding 的 `activatedAt`、token 的 `tokenIat`、membership 的 `validFrom`／`validToExclusive`；<br>• 這些輸入目前依賴的格式假設，以及實作階段必須補的驗證與負向測試。<br>原本「所有時間都由評估程式嚴格驗證」的概括宣稱已刪除。本輪沒有擴大評估程式的實作 | 文件修正，無新案例 | binding／token 時間與 membership 日期的格式與真實日期合法性，**模型尚未驗證**；明寫實作不得省略 |

**回歸**

- 原 169 個案例一字未改，已與 `221d155` 比對。
- 原 119 個對照組、39 種變異保留重跑。
- 新增 11 個案例與 1 種變異後：180 個案例、127 個對照組、40 種變異，全部通過或被偵測。
- 核准集合真子集、preset 資格、membership 綁定與版本失效、摘要成對測試、時間合法性與期限邊界測試全部保留。

**未驗證項目與殘餘風險**

- 如上表所述，binding、token、membership 的時間欄位只靠格式假設。
- D-01～D-16 未核准的部分維持拒絕或停用；`INVALID_INPUT` 仍是提案代碼。
- Firebase／PostgreSQL 72 筆後端案例仍為 `NOT_RUN`；模型、文件、mock 與 CI 成功都不能當成後端安全驗證通過。

### 第 7 次審查：收尾複驗（審查者稱 R6；Reviewed Head `b8d2b39cfccc40151704ecd3c87fafa6a09e597a`）

- 審查日期：2026-11-20
- 審查者：ChatGPT，獨立審查，L3 深度。最終風險與驗收決策由使用者決定。
- 審查對象：
  - Base：`4a842e7399d8fb64f3a0bc6650581920cd38890f`
  - 前輪 Head：`221d15567e0aebe0b8a5f5e2555360cf1a25f5bd`
  - Reviewed Head：`b8d2b39cfccc40151704ecd3c87fafa6a09e597a`
- **結論**：收尾複驗通過。REV-016、REV-017 結案，文件與模型可進入使用者驗收，本輪未發現新增阻擋項目。
  - 結論只適用於上述 Reviewed Head 的文件與模型範圍。
  - **不代表**真實後端驗證通過、D-01～D-16 已核准、使用者已驗收、GitHub 正式 Approve，或已授權合併。

| ID | 結案狀態 | 審查者依據 |
|---|---|---|
| REV-016 | 已修正，結案 | 既有 grant 與建立 grant 共用原因碼驗證（[規則](https://github.com/hsuanyu9503/class-management-next/blob/b8d2b39cfccc40151704ecd3c87fafa6a09e597a/docs/stage2/S2B1-AUTHORIZATION.md#L224)）。獨立重現：<br>• `ABC\n`、前後空白、非法字元、非字串、長度 2／65、缺少原因碼時，該 grant 無效，沒有其他有效 grant 時為 `FORBIDDEN`；<br>• 長度 3／64 為 `ALLOW`；<br>• 一筆無效 grant 加另一筆有效 grant 為 `ALLOW` |
| REV-017 | 已修正，結案 | §13 已正確限縮證據範圍（[規則](https://github.com/hsuanyu9503/class-management-next/blob/b8d2b39cfccc40151704ecd3c87fafa6a09e597a/docs/stage2/S2B1-AUTHORIZATION.md#L637)）：<br>• 嚴格時間驗證涵蓋建立請求的 `expiresAt`、既有 grant 的 `expiresAt`／`grantedAt`、模型 `now`；<br>• binding `activatedAt`、token `tokenIat`、membership `validFrom`／`validToExclusive` 仍依賴上游格式假設，已揭露並要求實作階段補驗證 |

**ChatGPT 獨立複驗取得的證據**（由審查者執行，與下方 Claude 自行執行的結果分開記錄）

- 180／180 模型案例通過，含 127 個控制案例與核准條件真子集檢查。
- 40／40 變異被偵測；`skip-existing-grant-reason` 被 7 個案例偵測。
- crosscheck v0.1、crosscheck R1 均通過。
- R5 原有 169 個案例內容未變更。
- 完整與增量審查包的內容與固定 Head 相符。
- R5 → R6 只變更 `docs/HANDOFF.md`、`docs/REVIEW_LOG.md`、`docs/stage2/S2B1-AUTHORIZATION.md`、`docs/stage2/S2B1-DATA-MODEL.md`。
- 線上 PR Head 與 Reviewed Head 相符；查核時 PR 尚未合併。
- 同一 Reviewed Head 的 CI `validate`、`baseline-anchor` 均成功：[run 44695301336](https://github.com/hsuanyu9503/class-management-next/actions/runs/44695301336)。

**Claude 先前自行執行的結果**（提交 Reviewed Head 時，乾淨 clone）：check、npm test 15／15、stage1:all、verify-anchor、兩支交叉檢查、評估程式 180／180、40 種變異全部被偵測。

**未驗證範圍（證據邊界）**

- 72 筆真實後端案例仍為 `NOT_RUN`。
- 模型通過**不代表**已驗證：實際 token 驗證、權威資料來源、Security Rules／受控 API、交易、並行、實際稽核寫入，或其他未納入模型的操作。
- binding／token 時間與 membership 日期的格式與真實日期合法性，模型尚未驗證。

**本紀錄之後的變更**

- 本段與 `docs/HANDOFF.md` 的狀態更新另以一個 commit 提交，只修改這兩份交接文件。
- 原審查結論適用於 `b8d2b39cfccc40151704ecd3c87fafa6a09e597a`；新增的交接紀錄 commit **尚未經 ChatGPT 審查**，待增量確認。
- 使用者驗收：**未完成**。合併決定：**未核准**。

### PR #3 合併後事實（2026-11-20，另記；不改寫上方各輪紀錄）

- 使用者已合併 PR #3：Merge SHA `b0f35af9388a2e75b0a141d692d59ecbf5ece446`，PR 最終 Head `d4b32ae4f6df00e50c753eb84a72e8b877b0358d`。
- ChatGPT 已檢查 R6 Reviewed Head（`b8d2b39…`）到合併版本的增量：只有 HANDOFF 與 REVIEW_LOG，授權規格、資料模型與案例未改變。
- 合併後 CI [run 44698127108](https://github.com/hsuanyu9503/class-management-next/actions/runs/44698127108) 成功。
- 合併不代表 D-01～D-16 已核准；72 筆後端案例仍為 `NOT_RUN`。

## S2-B2 第 1 批｜本機 Emulator 基礎設施與後端證據認證設計

- Base SHA：`b0f35af9388a2e75b0a141d692d59ecbf5ece446`
- Reviewed Head SHA（R1）：`d6181bb1ca242a63d2ffeb8d2abe2a1f376d4d2c`
- 風險等級（初評）：**L2**，但信任邊界相關內容（本機 guard、認證設計）建議採 **L3 深度**審查。
  - 理由：新增可執行的測試基礎設施與第三方開發相依（firebase-tools 與 627 個套件）；沒有正式資料、憑證、部署、CI 變更。
  - 最終等級由負責人決定。
- 範圍：
  - `poc/stage2/`：Emulator 設定、拒絕一切的佔位規則、本機 guard、REST 用戶端、虛構資料載入、guard 單元測試、冒煙、負向控制、總控腳本、鎖檔；
  - `docs/stage2/S2B2-B1-PLAN.md`、`S2B2-ATTESTATION.md`、`S2B2-ADAPTER-PLAN.md`；
  - `docs/HANDOFF.md`、`docs/REVIEW_LOG.md`。
- 不修改：Stage 1 鎖定檔、fixtures、`P0_PINNED`、安全斷言、外部錨定、`.github/workflows/`、根目錄 `package.json`、`tests/`。
- ChatGPT 結論（R1，`d6181bb`）：**CHANGES REQUESTED**（S2B2-REV-001 HIGH、S2B2-REV-002 MEDIUM）
- 使用者決策：`未核准`

### R1 回應（Claude，新 Head 見 PR #4）

| 編號 | 等級 | 問題 | 處理 | 證據 |
|---|---|---|---|---|
| S2B2-REV-001 | HIGH | 前置條件失敗不會中止；「未啟動」負向控制重用會 `DELETE` 的冒煙；固定專案／連接埠可能清除他人 Emulator | **已修正**：前置條件改為硬性停止（exit 2）；「未啟動」「斷線」與 guard 負向控制改用唯讀探測；冒煙寫入前證明環境為空、寫入 nonce 標記、清除前再確認，否則拒絕；每次 Emulator 啟動前後檢查 5 個連接埠；CLI 改以 `node firebase.js` 啟動並回報 `spawnError` | `poc/stage2/src/ownership.mjs`、`test/probe.mjs`、`scripts/run-smoke.mjs`；`test/nondestructive.test.mjs`（假伺服器記錄請求：占用時 0 請求、外來資料時無 `DELETE`／`PATCH`）；`npm run s2:occupied-real`（真實 Emulator 內的外來文件與帳號不變）；修正前同情境對占用者送出 104 個請求含兩個 `DELETE` |
| S2B2-REV-002 | MEDIUM | 認證設計缺少 Adapter 與證據收集／驗證／簽章之間的隔離 | **已補設計**（未實作）：`S2B2-ATTESTATION.md` v0.2 §9 隔離要求（受信任元件固定版本並與 Adapter SHA 分別綁定、不從 PR checkout 載入；Adapter 程序／網路／檔案／憑證隔離；nonce 由 Runner 在 Adapter 啟動後寫入；獨立驗證與簽章環境；狀態變化必須能由 trace 解釋；每次執行的隔離自我檢查）與 §10 攻擊驗收情境；隔離無法查證時只能 `UNATTESTED`／`BLOCKED`。D-17 未決定 | `docs/stage2/S2B2-ATTESTATION.md` §5、§8～§10；`S2B2-ADAPTER-PLAN.md` §1、§4 |
| （附帶） | — | Windows 上 `spawnSync` 執行 `.bin/firebase` 的相容性 | 改以 `process.execPath` 執行 `firebase.js`；回報 `spawnError`／`signal`。**未在 Windows 實測** | `S2B2-B1-PLAN.md` §5.3 |

- 範圍未擴大：未修改 Stage 1 鎖定檔、CI、外部錨定、防護斷言或待決權限；72 筆後端計畫維持 `NOT_RUN`。

### R2 複驗（ChatGPT，Reviewed Head `9aac895704248ca6657da74350b2bb7e6adb94a1`）

- 結論：**CHANGES REQUESTED**。S2B2-REV-001 原始占用情境已修正；S2B2-REV-002 設計層面結案（不代表隔離已實作或已驗證；D-17 仍待決）。
- 新增 S2B2-REV-003（MEDIUM）：`portState()` 把所有 socket 錯誤與逾時當成「關閉」，在 `EACCES`／逾時時前置條件被錯誤放行。
- 審查者的獨立測試：10／14 通過，4 項失敗都涉及本機 HTTP 連線，審查環境回報 `EACCES`，所以不視為產品缺陷，也不宣稱獨立 14／14 通過。真實 Emulator 冒煙未由審查者獨立重跑成功。

### R2 回應（Claude，新 Head 見 PR #4）

| 編號 | 等級 | 處理 | 證據 |
|---|---|---|---|
| S2B2-REV-003 | MEDIUM | **已修正**：`src/port-state.mjs` 回傳 `open`／`closed`／`unknown`；只有 `ECONNREFUSED` 是 `closed`；`open` 與 `unknown` 都讓前置條件 exit 2 並輸出連接埠與錯誤碼；第一個結果生效、socket 一律銷毀。總控邏輯移到 `src/orchestrator.mjs`，可注入探測與子程序 | `test/port-state.test.mjs`：占用、`ECONNREFUSED`、`EACCES`、`EPERM`、逾時、其他錯誤；在第一次與 Emulator 停止後的檢查都斷言 probe／CLI 啟動次數（非 `closed` 時為 0）；變異測試確認新測試會抓到回歸 |

- 未擴大安全宣稱：空環境檢查與 nonce 標記不是原子鎖，也不能對抗惡意本機程序（已寫入 README 與 PLAN）。
- 範圍未擴大：未修改 Stage 1 鎖定檔、CI、外部錨定、防護斷言或待決權限；72 筆後端計畫維持 `NOT_RUN`。

### R3 複驗（ChatGPT，Reviewed Head `d195789ac42bac841cf463ccf1ed5310807ca520`，2026-11-21）

- 結論：**R2 複驗通過，可進入使用者驗收**；未發現新增阻擋項目。限於本批基礎設施程式、文件設計與取得的測試證據；**不是** Windows Emulator 驗收、正式後端契約通過、D 項目核准或合併授權。

| 編號 | 等級 | 最終狀態 | 界線 |
|---|---|---|---|
| S2B2-REV-001 | HIGH | 原始問題已修正，結案 | 空環境檢查與 nonce 標記不是原子鎖，不能對抗惡意本機程序 |
| S2B2-REV-002 | MEDIUM | 文件設計層面結案 | 隔離仍未實作，不能據此產生 `PASS`；D-17 待決 |
| S2B2-REV-003 | MEDIUM | 已修正，結案 | — |

證據來源分開記錄：

| 來源 | 內容 |
|---|---|
| ChatGPT 獨立執行 | guard 8 項＋port-state／總控停止 28 項 = **36／36 通過**；實際執行 `run-smoke` 入口：審查環境對 5 個本機連接埠回報 `EACCES`，全部判為 `unknown`，在第一次前置條件停止，未進入冒煙或負向探測。真實 socket 測試在該環境只驗證「連線受限 → `unknown`」路徑。PR Base／Head 與附件一致；25 個新增檔案 blob SHA 與遠端一致；鎖檔 SHA-256 未變 |
| Claude 本機證據（未經審查者獨立重跑） | 乾淨 clone：`s2:test` 42／42、`s2:smoke` exit 0（正向冒煙 14 步，JSON 綁定 Reviewed Head）、`s2:occupied-real` exit 0（外來文件與帳號不變）；根目錄測試、Stage 1、錨定、受保護檔案差異通過 |
| CI（[run 44703084167](https://github.com/hsuanyu9503/class-management-next/actions/runs/44703084167)） | `validate`、`baseline-anchor` success。**CI 不包含 Emulator 冒煙**，CI 成功不代表 Emulator 冒煙通過 |

- 未驗證：Windows 完整流程；認證隔離實作與攻擊驗收；第三方 CLI 與相依套件的完整外連行為與平台相容性。
- 未核准：Q1／Q2／Q3、D-01～D-17。72 筆正式後端計畫維持 `NOT_RUN`；技術選型 `UNDECIDED`。
- ChatGPT 審查不是 GitHub 正式 Approve。
- 使用者決策：`待驗收與合併決策`

## S2-B2 第 1 批｜合併

- 使用者合併 PR #4：Merge SHA `e98c46b05fe2a127f0356e66777c4484ec768ceb`；最終 Reviewed Head `ee756da8920080d4874e1f71915b97f27431576a`，兩者無檔案差異；合併後 CI [run 44854491499](https://github.com/hsuanyu9503/class-management-next/actions/runs/44854491499) 成功。
- 合併不代表 D-01～D-17、Q1～Q3 已核准；REV-002 只在設計層面結案。

## S2-B2 第 2 批｜本機受控讀取 API、trace、Observer 雛形與四個 P0 案例

- Base SHA：`e98c46b05fe2a127f0356e66777c4484ec768ceb`
- Reviewed Head SHA：`[尚未審查]`
- 風險等級（初評）：**L3**。理由：第一次實作身分與授權邊界（token 驗證、binding／principal／membership、scope 解析、capability）、稽核寫入，以及作為後續認證基礎的 trace 與 Observer。最終等級由負責人決定。
- 範圍：`poc/stage2/`（API、授權、時間驗證、trace 代理、遮罩、測資、Adapter、Observer、判定、總控與測試）、`docs/stage2/S2B2-B2-PLAN.md`、`S2B2-ADAPTER-PLAN.md` 狀態列、`HANDOFF`、`REVIEW_LOG`。
- 不修改：Stage 1 鎖定檔、fixtures、`P0_PINNED`、安全斷言、外部錨定、`.github/workflows/`、根目錄 `package.json`、`tests/`、`firestore.rules`、`S2B1-*` 規格、`S2B2-ATTESTATION.md`。
- 結果：POC-001、002、008 `UNATTESTED`＋觀察值符合契約；POC-009 `BLOCKED`（G-1、G-4）。**沒有 PASS**。
- 新增規格缺口：G-1～G-4（`S2B2-B2-PLAN.md` §3），未自行選擇選項。
- Reviewed Head SHA（R1）：`37546804c61c9c0ce081fa5db415b89269e4e163`
- ChatGPT 結論（R1）：**CHANGES REQUESTED**（S2B2-B2-REV001 HIGH；REV002、REV003 MEDIUM）
- 使用者決策：`未核准`

### R1 審查摘要（ChatGPT）

- 四案例 trace／state 16 個檔案雜湊與 summary 一致；Observer 重播結果與附件相同（使用作者的 trace／state，不是新的 Emulator 執行）。
- 審查者 Node 測試 57 項中 53 通過、4 項失敗；4 項都涉及本機 HTTP（`fetch failed`），屬環境限制，**不列為通過**，也不據此判定產品回歸。
- 真實 Emulator 結果是作者本機證據，未獨立重跑；R1 交付的 tar 只含四個正式案例。

### R1 回應（Claude，新 Head 見 PR #5）

| 編號 | 等級 | 處理 | 證據 |
|---|---|---|---|
| S2B2-B2-REV001 | HIGH | **已修正**：`src/api/response-shape.mjs` `checkEntry()`；兩個聚合端點在輸出或計數前逐筆檢查子文件的路徑、`workspaceId`、`classId`、`sessionId`、`attendanceEntryId` 與必要欄位；任一不符整個請求 `FORBIDDEN`，`auditLog` 記 `deny`／`SCOPE_INTEGRITY_ERROR`（型別或值錯誤為 `DATA_INTEGRITY_ERROR`） | 單元：兩端點 × 10 種 scope 不符＋3 種資料錯誤（含審查者重現）；Emulator HTTP：兩端點 × 8 情境，每項先跑允許的對照組，再驗 403、回應只有 `code`／`traceId`、不含 `ST-FOREIGN`、稽核原因碼 |
| S2B2-B2-REV002 | MEDIUM | **已修正**：API 請求 body 白名單（`REQUEST_SHAPE_INVALID`）；front trace 只記錄白名單欄位；遮罩涵蓋任何大小寫與分隔符號的 `authorization` 等鍵，以及字串中的 `Bearer …`、JWT 形狀 | 單元：未知欄位、巢狀、陣列、大小寫變體；Emulator：7 種夾帶虛構 token 的請求全部 `FORBIDDEN`，**實際寫出的** front trace 檔不含任何虛構 token 或 JWT 形狀字串；全執行目錄遮罩掃描 0 洩漏 |
| S2B2-B2-REV003 | MEDIUM | **已修正**：`rosterSnapshot`、`coverageSegments`、核對事項 `evidence` 逐筆驗證並只輸出白名單欄位；非陣列、非物件、缺欄或型別錯誤 → `DATA_INTEGRITY_ERROR` | 單元：額外姓名／email／備註／巢狀資料不輸出；7 種形狀錯誤被拒；Emulator：**直接對 API** 取得原始 HTTP 回應，額外欄位不出現；3 種名單形狀錯誤 `FORBIDDEN` |

- 變異檢查：把 REV001／003 的檢查改回原樣，新單元測試 2 項失敗；把 REV002 的遮罩改回原樣，1 項失敗。
- 證據：每個負向、對照與變異情境的原始 trace、狀態（含 `auditLog`）與結果另存，並附 `artifact-manifest.json`。
- 範圍未擴大：沒有新增 capability、沒有修改契約、fixtures、oracle、S2-B1 規格或 CI；POC-009 維持 `BLOCKED`；72 筆後端計畫維持 `NOT_RUN`。

### R1 複驗（ChatGPT，Reviewed Head `2fa78f74cd2b3b14e7e83934d372fc5022e88a30`）

- 結論：需修正。REV001、REV002 結案；REV003 部分結案。新增 R1-N1（MEDIUM）、R1-N2～N4（LOW）；R1-N5～N7 列為後續。

### R2 回應（Claude，依 `templates/CLAUDE_REVIEW_RESPONSE.md`）

- PR：https://github.com/hsuanyu9503/class-management-next/pull/5
- 審查版本 Head SHA：`2fa78f74cd2b3b14e7e83934d372fc5022e88a30`
- 修正後 Head SHA：`d2dafe16ba488df60e6a2340ad9cd075c691ed2a`。本輪是**兩個** commit（更正先前「單一 commit」的記載）：`d17e537` 是 R1-N1～N4 修正；`d2dafe1` 只把測試中的虛構憑證形狀值改為執行時組字串，原因是 `export_review_packet.py` 判定原寫法疑似憑證。沒有改寫歷史。

| ID | 處理結果 | 修改位置／原因 | 驗證證據 | 待使用者決策 |
|---|---|---|---|---|
| R1-N1 | 已修 | `poc/stage2/src/api/response-shape.mjs`：`date` 以 `parseLocalDate` 驗證；`kind` ∈ {`daily`, `period`}（S2-B1 資料模型 §3.5 已定義，未新增 G-9）；不符 → `DATA_INTEGRITY_ERROR` | 單元 10 種（`date` 物件／陣列／2026-02-30／含時間／數字／缺少；`kind` 陣列／未知／大寫／缺少）；Emulator 3 項（含對照組、403、回應只有 `code`／`traceId`、`auditLog` 恰一筆 `deny`） | 無 |
| R1-N2 | 已修 | `src/api/request-shape.mjs`、`src/mask.mjs`、`src/authz.mjs`（export `ID_RE`）：只記錄自有 `op`、已知 ID 欄位、ID 形狀且非憑證前綴的值；憑證前綴值在所有 trace 遮罩 | 單元：`sk-live-…`、`ghp_…`、`password=…`、60000 字元、JWT 前綴、原型鏈名稱都不出現在回傳值；Emulator：2 種形狀合法但值是不透明憑證的請求，實際寫出的 front trace 不含該字串；全目錄 337 檔掃描 0 洩漏（含 back trace） | 無（殘餘風險已記錄在計畫 §8） |
| R1-N3 | 已修 | `src/api/response-shape.mjs`：`attendanceEntry.read` 驗證父層為 `attendanceSessions` 且 `sessionId` 等於路徑 | 單元 4 種；Emulator 2 項（`sessionId` 不符、存放在非 `attendanceSessions` 父層），含對照組 | 無 |
| R1-N4 | 已修 | `src/api/store.mjs`：`nextPageToken` → `DATA_INTEGRITY_ERROR`／`LIST_TRUNCATED`，整個請求拒絕 | 單元（以替換 `fetch` 測試，**不需要本機連線**）：兩端點都拒絕，完整清單的對照組通過 | 無 |
| R1-N5 | 延後 | OPERATIONS 原型鏈名稱（`authorize` 內 `OPERATIONS[op]` 的查找方式）；本輪只在 trace 端以 `Object.hasOwn` 處理 | — | 無 |
| R1-N6 | 延後 | mask 對非 Bearer `Authorization` 值的雜湊與相關註解 | — | 無 |
| R1-N7 | 延後 | 遮罩掃描的 secrets 蒐集範圍（目前只含最後一組 token／密碼與刻意送出的虛構值） | — | 無 |

變異檢查（本機）：

| 改回原樣的修正 | 擋住的測試 |
|---|---|
| R1-N1 | `batch2-unit` #19 |
| R1-N2（trace 逐值記錄） | `batch2-unit` #20 |
| R1-N2（遮罩憑證前綴） | `batch2-unit` #23 |
| R1-N3 | `batch2-unit` #21 |
| R1-N4 | `batch2-unit` #22 |

每次只有該項失敗，其餘通過。

#### 已執行的測試

在新 Head 的乾淨 checkout 執行，原始輸出附在複驗請求中。

| 命令／操作 | 結果 | 對應 Commit／連結 |
|---|---|---|
| npm run check | 成功 | 新 Head |
| npm test | 成功 | 新 Head |
| npm run stage1:all | 成功 | 新 Head |
| verify-anchor、受保護路徑與鎖檔 diff | 成功 | 新 Head |
| s2:test、s2:smoke、s2:occupied-real、s2:cases | 成功 | 新 Head（Claude 本機證據） |
| Windows、官方文件、CI 上的 Emulator | 未執行（NOT_RUN） | — |

#### 未解風險與新發現

- （LOW）沒有已知前綴的 ID 形狀不透明憑證仍可能被記錄為 `target` 值（計畫 §8）。
- （資訊）`DATA_INTEGRITY_ERROR`、`REQUEST_SHAPE_INVALID`、`LIST_TRUNCATED` 是實作層拒絕規則；是否寫入 S2-B1 由審查與負責人決定。

### R2 複驗（ChatGPT，Reviewed Head `d2dafe16ba488df60e6a2340ad9cd075c691ed2a`，2026-11-21）

依使用者轉交的 ChatGPT 複審報告記錄；以下是該報告的摘要，不是 Claude 的結論。

- 結論：**本輪修正複驗通過，可交使用者驗收與合併決策**；未發現需阻擋本批本機 PoC 的 HIGH／MEDIUM 缺失。不是正式後端驗收、GitHub Approve 或合併授權。
- 結案：REV001、REV002（含 R1 鍵名變體）、REV003、R1-N1、R1-N2（本輪修正範圍）、R1-N3、R1-N4。
- 審查者核對：
  - R2 manifest 338／338 檔案大小與 SHA-256 吻合；
  - 獨立 Node 測試 58 項通過、0 失敗（不含 store HTTP 回歸與 `nondestructive.test.mjs`，本輪未執行）；
  - Observer 以作者的 trace／state 重播 11／11 與附件一致（不是新的 Emulator 執行）；
  - CI [run 44872969720](https://github.com/hsuanyu9503/class-management-next/actions/runs/44872969720) 對應本 Head（不含 Emulator）。
- 作者證據（審查者未獨立重跑 Emulator）：乾淨 checkout `s2:test` 65／65、根目錄檢查、錨定、smoke、occupied、cases 成功，`gitDirty = false`；負向與對照 71／71、變異 7／7。
- 審查者另外以函式層重現確認：R1 版本中，把虛構 JWT 放在 target 鍵名時 token 會出現在 trace；R2 只留下 `target.unknownField = {valueRecorded: false}`。

**可追蹤待辦**（未修復；作者的「延後」記載不等於使用者批准）：

| 項目 | 說明 |
|---|---|
| R1-N5 | `authorize` 內 `OPERATIONS[op]` 的原型鏈查找 |
| R1-N6 | mask 對非 Bearer `Authorization` 值的雜湊與註解 |
| R1-N7 | 遮罩掃描的 secrets 蒐集範圍；零洩漏只涵蓋可識別的值與規則 |
| 不透明憑證 | 沒有已知前綴、形狀像 ID 的憑證仍可能被記錄；只能用於本機虛構資料 |
| 分頁 | 單頁 300 筆以上一律拒絕；未實作跨頁讀取，不得宣稱完整查詢成功 |
| 認證 | 沒有 Verifier、可信簽章、D-17、§9 隔離；Emulator token 無簽章。雜湊、重播一致與 CI 成功都不能把 `UNATTESTED` 提升為 PASS |
| 待決 | G-1～G-4、D-01～D-17、Q1～Q3；POC-009 需要權限決策與可信節次日曆；實作層錯誤碼是否寫入規格另行處理 |

- 使用者決策：`待驗收與合併決策`

## S2-B2 第 2 批｜合併

- 使用者合併 PR #5：Merge SHA `40c09a3fb92b0c699a2b00dda1da5b2a32b468a4`；最後 PR Head `85a0bb4b40d9cf2ff030c1d95f70513cad9a57fd`（相對最後程式審查 Head `d2dafe16` 只有文件）。
- 合併不代表 D-01～D-17、G-1～G-4、Q1～Q3 已核准；N5～N7 與其他待辦仍開啟。

## S2-B2 第 3 批｜準備與決策包

- Base SHA：`40c09a3fb92b0c699a2b00dda1da5b2a32b468a4`
- Reviewed Head SHA：`[尚未審查]`
- 風險等級（初評）：**L2**，信任邊界與信任根設計採 **L3 深度**。理由：只有文件與 schema 草案，沒有程式、workflow 或設定變更；但內容決定後續認證的信任根與權限。最終等級由負責人決定。
- 範圍：
  - 新增 `docs/stage2/S2B2-B3-PLAN.md`、`docs/stage2/S2B2-B3-attestation-statement.draft.json`；
  - 更新 `docs/HANDOFF.md`、`docs/REVIEW_LOG.md`。
- 不修改：程式、測試、workflow、repository 設定、外部錨定、Stage 1 鎖定檔、`S2B2-ATTESTATION.md`。nonce 的一致流程只是提案（計畫 §5）。
- 待決：`S2B2-B3-PLAN.md` §13（v0.1：Q-A～Q-F；v0.2 縮減為 Q-1～Q-4）。
- Reviewed Head SHA（R1）：`29f47a5e82b7f09654849ae206ba7188b400233f`
- ChatGPT 結論（R1）：**CHANGES REQUESTED**（設計層 B3-REV001 HIGH；B3-REV002、003、004 MEDIUM）
- 使用者決策：`未核准`

### R1 審查摘要（ChatGPT）

- 審查者核對：
  - GitHub 比較只有 4 份文件；附件 PLAN 與 JSON 的 blob SHA 與固定 Head 相同；
  - CI 同 Head 成功，但不能證明設計或隔離正確；
  - checks.log 只有摘要與 exit code；isolation-probe.log 是作者以 root 的本機探查，審查者未重跑。
- 審查者另外核對官方文件並提供：
  - public repository 在 Free／Pro／Team 支援 artifact attestations；
  - 官方範例權限；
  - Sigstore bundle 進入公開不可變透明度日誌；
  - CLI 的 signer-digest、source-digest、source-ref 限制。
  
  Claude 引用這些事實並標明來源，沒有自行連線。

### R1 回應（Claude，依 `templates/CLAUDE_REVIEW_RESPONSE.md`）

- PR：https://github.com/hsuanyu9503/class-management-next/pull/6
- 審查版本 Head SHA：`29f47a5e82b7f09654849ae206ba7188b400233f`
- 修正後 Head SHA：見 PR #6

| ID | 處理結果 | 修改位置／原因 | 驗證證據 | 待使用者決策 |
|---|---|---|---|---|
| B3-REV001 HIGH | 已修（設計） | 計畫 §3.4：封存後產生 manifest 與可重現封裝；`artifactId`／`packageSha256`／`manifestSha256` 以 job outputs 交出；選取條件（repository、run、attempt、producer、不可變 ID、內容 digest）；明列信任假設與殘餘風險。§7.2 新增對應可信輸入。攻擊 A13（整包替換）、A14（選錯 artifact） | schema `package`；計畫 §3.4、§8 | 無（平台保證在 B3b 前核對） |
| B3-REV002 MEDIUM | 已修（設計） | 計畫 §3.3：`s2-isolation-policy-v1`。實際設定的 canonical digest 涵蓋命名空間、uid／gid、capability、`no_new_privs`、rootfs、掛載、`/proc`、`/dev`、socket、環境、fd、限制。22 個必要檢查 ID，含正向控制。缺項、未知、重複、型別、失敗、參數改變、平台不支援各有判定。攻擊 A15、A16 | schema `isolation.selfCheck` 改為封閉物件；`sandboxPolicyDigest`；本機 schema 檢查 | 無 |
| B3-REV003 MEDIUM | 已修（設計） | 計畫 §7.4 安全解析規則（路徑、碰撞、連結與特殊檔、realpath、重複、數量與大小、JSON 深度與重複鍵、不執行內容、失敗即停止）；§7.5 分工（安全解析 → schema → 語意）。攻擊 A17 | schema `relPath` 修正：`../outside.json`、`/tmp/outside.json`、`a/../../outside.json` v0.1 接受、v0.2 拒絕 | 無 |
| B3-REV004 MEDIUM | 已修（設計） | 計畫 §4：簽章政策版本（`attest.yml` blob）與工具鏈版本分開；批准紀錄 `S2B2-TRUST-POLICY.json`（版本、撤銷、有效期間）；首次建立與更新步驟；舊證明規則。§7.3：以 build provenance 簽 `statement.json`（subject digest）；第三方驗證身分、signer workflow blob、source digest、subject digest 與內容政策。攻擊 A18 | 計畫 §4、§7.3、§8 | Q-2 |
| 對帳 | 已修 | 計畫 §6.3：`traceId` 唯一；front／back／audit 一對一，audit 內容逐欄吻合；setup／case／teardown 流量階段 | 計畫 §6.3；schema `reconciliation` | 無 |
| 簽章範圍 | 已修 | v0.1 寫「都簽章」→ v0.2 維持 ATTESTATION §9.3「只簽 PASS」；FAIL／BLOCKED 只有未簽章診斷 | 計畫 §3.1；schema `verdict.signed` | 無 |
| A10 | 已修 | 讀到平台憑證即隔離失敗：`BLOCKED`、停止上傳與簽章；「沒有 id-token」只降低影響 | 計畫 §8 | 無 |
| Verifier 權限描述 | 已修 | `id-token` 是 job 層級；改述為只執行可信程式、不主動使用 OIDC、安全解析、PASS 後的獨立簽章步驟 | 計畫 §3.1 | 無 |
| nonce | 已補充（仍是提案） | 逾時、READY／DONE、`runAttempt` 綁定、標記不可改寫、不取代隔離與內容綁定 | 計畫 §5 | Q-4 |
| 公開範圍 | 已修 | 分列 bundle、statement、封裝檔、診斷的去向、存取範圍與保存 | 計畫 §9.6 | Q-3 |
| 決策問題 | 已縮減 | Q-1 D-17、Q-2 CI／錨定／批准、Q-3 公開與保存、Q-4 nonce；取消開放網路的問題 | 計畫 §13 | Q-1～Q-4 |

#### 已執行的測試

| 命令／操作 | 結果 | 對應 Commit |
|---|---|---|
| npm run check、npm test、npm run stage1:all、verify-anchor | 成功 | 新 Head |
| schema 草案驗證（本機 `jsonschema` 4.26，合法控制組＋15 個拒絕案例＋重複鍵示範） | 成功 | 新 Head |
| GitHub runner 上的隔離、端到端簽章 | 未執行（NOT_RUN，B3b） | — |

#### 未解風險與新發現

- （設計）內容綁定只保護封存後的替換；若 Adapter 在封存前突破沙箱，可以偽造全部內容，依賴 §3.3 隔離。
- （未核對）job outputs、artifact ID 不可變性與 artifact 存取範圍。

### R2 複審（ChatGPT，Reviewed Head `4b80145a4ac8916787d92086f2f700727928b1d6`，2026-11-21）

依使用者轉交的 ChatGPT 複審報告摘要：

- 結論：B3-REV001～004 **設計結案，實作待驗收**；準備包可進入使用者決策；未發現新的 HIGH／MEDIUM 設計缺失。不代表隔離、簽章或 Verifier 已實作驗收，也不代表 D-17、CI 權限或 B3a 已獲批准。
- 審查者核對：
  - 附件 PLAN 與 schema 的 blob SHA 與新 Head 一致；
  - path regex 對 7 個不安全樣本全部拒絕；
  - `selfCheck` 的 22 個 required ID 與 properties 相同，`additionalProperties = false`。
- 審查者未完成的項目：
  - 完整 schema suite（審查環境缺少 `jsonschema`，重跑時停止）；
  - 根目錄測試、Emulator、Linux 隔離、端到端簽章。
- 收尾事項（LOW／實作澄清）5 項：
  1. 正向控制依實際拓撲，並使用 sentinel；
  2. manifest 排除自身；
  3. 簽章狀態不由 statement 自我宣稱；
  4. Verifier 憑證描述、控制管道方向、壓縮比；
  5. 可信政策的取得來源與撤銷新鮮度。

### R2 回應（Claude）

- 修正後 Head SHA：見 PR #6

| 項目 | 處理 | 位置 |
|---|---|---|
| 1 正向控制 | 已修（設計）：可信政策固定 `endpoints` 清單，分 `service`（本次實際啟動；預期 `listening` 卻未啟動即失敗，依設計不啟動者標 `not-started-by-design`）與 `sentinel`（Runner 專為自我檢查啟動的 TCP listener 與未掛入的 Unix socket）。front 不列為 TCP 端點；不新增常駐服務 | 計畫 §3.3 |
| 2 manifest | 已修（設計）：manifest 只列 payload，不列自身、`package.tar`、`statement.json`、簽章或交付紀錄；封裝只含 manifest 與其列出的 payload；寫明可重現的 ustar 序列化與排序規則 | 計畫 §3.4；schema `artifacts` 說明 |
| 3 簽章狀態 | 已修（設計）：移除 schema 的 `verdict.signed`；寫明判定 → 固定 statement → 簽章 → 發布的時序與各步失敗處理；實際狀態只寫在外部 `delivery.json`；第三方只以 bundle 判斷 | 計畫 §3.1；schema `verdict` |
| 4 文字與數值 | 已修：Verifier 的憑證欄與 job 層級權限一致；控制管道 READY（Adapter→Runner）／GO（Runner→Adapter）／DONE（Adapter→Runner）；`package.tar` 不壓縮，平台壓縮傳遞時比值 ≤ 100 且仍受 256 MiB 上限 | 計畫 §3.2、§5、§7.4 |
| 5 政策來源 | 已修（設計）：撤銷檢查讀取目前被外部錨定認可的 `main` 上的批准政策，不讀 artifact 或舊工具鏈附帶的政策；記錄政策版本、雜湊、取得方式與時間；離線驗證超過新鮮度上限（提案 24 小時）時標為「撤銷狀態未知」；列入 B3b 驗收 | 計畫 §4.5 |
| Q-3 | 已修：保存天數與可下載範圍未核對，不以平台預設代替 D-07；B3b 前以具體數值批准 | 計畫 §13 |
| 決策分段 | 新增一頁摘要：現在可批准 B3a（本機）＋Q-4；B3b 前才決定 Q-1～Q-3 | `S2B2-B3-DECISION-SUMMARY.md` |

- schema 重跑：合法控制組接受（只代表形狀），16 個拒絕案例全部拒絕（新增：statement 自稱已簽章、manifest 被列為 payload），重複鍵由嚴格解析器拒絕。
- 使用者決策：`待決`（B3a 範圍＋Q-4；B3b 前 Q-1～Q-3）

### R3 收尾複核（ChatGPT，Reviewed Head `5876ddb0ff6fbd3469fe6c027c95f5d261c69ed2`）

- 依使用者轉交的報告摘要：5 項收尾完成，準備包複核通過；B3-REV001～004 維持「設計結案，實作待驗收」。
- 審查者核對：三份附件的 blob SHA 與固定 Head 一致；`signed` 欄位已移除；封閉物件設定。
- 審查者未重跑：完整 schema suite；repository tests；Emulator；Linux 隔離；端到端簽章。

## S2-B2 第 3 批｜合併準備文件，批准 B3a

- 使用者（負責人）回覆「三項都同意」，即：
  1. 驗收並合併 PR #6；
  2. 批准 `S2B2-B3-DECISION-SUMMARY.md` A 節的 B3a 本機範圍；
  3. 同意 Q-4（nonce 一致流程與 ATTESTATION v0.3）。
- PR #6 由 Claude 依該明確批准合併：merge `636e13088a39c3bd956461e6f8fbab75949c58c1`（Head `5876ddb0`，與 Reviewed Head 相同）。
- 這不代表 D-17、CI、錨定、repository variable、公開或保存範圍已批准（B3b 前另行批准）。

## S2-B2 第 3 批 B3a｜本機沙箱、Verifier 與攻擊測試

- Base SHA：`636e13088a39c3bd956461e6f8fbab75949c58c1`
- Reviewed Head SHA：`[尚未審查]`
- 風險等級（初評）：**L3**。理由：
  - 實作隔離與證據鏈的核心（沙箱、自我檢查、封存、Verifier、對帳）；
  - 以 root 執行命名空間與掛載；
  - 修改第 2 批 API 的稽核 `action` 規則。

  最終等級由負責人決定。
- 結果：
  - POC-001／002／008 `UNATTESTED`（觀察值符合契約）；
  - POC-009 `BLOCKED`；
  - 攻擊與控制 26／26 符合預期。

  **沒有 PASS**（`PASS_ENABLED = false`）。
- 不修改：Stage 1 鎖定檔、fixtures、oracle、外部錨定、`.github/workflows/`、根目錄 `package.json`、`tests/`、`firestore.rules`、S2-B1 規格、鎖檔。
- 需要審查的差異：`S2B2-B3A-REPORT.md` §3。
- Reviewed Head SHA（R1）：`211e11433bc3e005d3ef68383340e9b27e8183cf`
- ChatGPT 結論（R1）：需修正（B3A-N1、N2 必修；N3、N4 一併修；N5～N8 與 NOTE 列入後續）
- 使用者決策：`未核准`

### R1 回應（Claude）

| ID | 處理 | 位置 |
|---|---|---|
| B3A-N1 | 已修 | `src/b3/verifier.mjs`（selfCheck 純物件與 own key 檢查） |
| B3A-N2 | 已修 | `src/b3/package.mjs`（拒絕 `__proto__`、`defineProperty`）；`src/b3/verifier.mjs`、`src/b3/reconcile.mjs`、`src/verdict.mjs`（`Object.hasOwn`） |
| B3A-N3 | 已修 | `src/b3/isolation-policy.mjs`（`POSITIVE_CONTROL_REQUIRED`）；`src/b3/verifier.mjs`；`src/b3/selfcheck-host.mjs`；schema 草案 |
| B3A-N4 | 已修 | `src/b3/verifier.mjs`（可信 `platformSupported`；無法查證分支也檢查）；`test/b3-run.mjs` |
| B3A-N5 | 延後 | tar 嚴格解析：要求重新序列化後位元組相同（含結尾附加內容）；單元測試已標 `todo` |
| B3A-N6 | 延後 | 稽核與請求綁定：`resourceRef` 全路徑、`claimedScope`、`authUid`／`principalId` 為 null 的情況、每筆稽核文件必須對應一筆 back PATCH |
| B3A-N7 | 延後 | 掛載選項檢查、FS 隱藏測試的強化、最小化 `/etc` 與 `/usr`、`pathMap` 寫入 digest 或 statement |
| B3A-N8 | 延後 | `case.json` 只給該案例 actor 的 token |
| NOTE ①～⑨ | 延後（⑧ 的 own-key 查表已一併處理） | 依審查報告；B3b 前逐項處理 |

- 範圍：`PASS_ENABLED`、`passPossible` 仍為 false；沙箱設定與 `configDigest` 不變；受保護檔案與錨定不變。
- 審查者的 `S2B2-B3A-reviewer-probes.mjs` 沒有傳到 Claude 的環境；探針依說明自行撰寫。

### R1 增量複驗（ChatGPT）與合併

| 項目 | 內容 |
|---|---|
| Reviewed Head | `9a9450b291a65e9fc6a37596bbbaccf165a825b7`（增量 Base `211e1143`） |
| 結論 | **可合併**；B3A-N1～N4 已關閉 |
| 新發現 | B3A-R1-N1（LOW）：Verifier 遇到非物件的最外層 JSON 會拋出例外（`iso` 為 null 時，型別檢查前就先讀取欄位） |
| NOTE | NOTE-a：reconcile 的原型鏈縱深防禦測試；NOTE-b：Verifier 版本號未提升；NOTE-c：B3b 前處理 |
| 合併 | 使用者確認 CI 後合併 PR #7，merge `15a7c51fe6341d79afdafc5aefb22501fe081377`（2026-11-21T10:07:53Z，由 hsuanyu9503 合併） |

## S2-B2 第 3 批 B3a 後續修正 F1（B3A-R1-N1、NOTE-a、NOTE-b）

- Base SHA：`15a7c51fe6341d79afdafc5aefb22501fe081377`（PR #7 合併）
- Reviewed Head SHA：`df83fb5204d142b44a89906cd5c9d71048ca6f8d`；審查方式 INCREMENTAL
- 風險等級（初評）：**L3**（Verifier 變更）
- 範圍：一個小 commit。B3A-N5～N8 與 NOTE-c 不動，保留到 B3b 前。

| ID | 處理 | 位置 |
|---|---|---|
| B3A-R1-N1 | 已修 | `src/b3/verifier.mjs`：最外層型別檢查在讀取任何欄位前；`out.isolation` 在檢查後才賦值；`verifyPackage` 不再拋出例外（`VERIFIER_INTERNAL_ERROR:<錯誤類別>`，不含訊息）；`trusted` 不是物件 → `TRUSTED_INPUT_MISSING`（NOTE ⑨） |
| NOTE-a | 已加測試 | `test/b3-unit.test.mjs` 直接呼叫 `reconcile()`，`pre`／`post` 使用帶原型的物件 |
| NOTE-b | 已修 | `VERIFIER_VERSION = 's2-verifier-b3a-1'`；statement schema 草案沒有 `verifierVersion` 欄位，不需更新 |
| B3A-N5～N8、NOTE-c | 延後 | B3b 前處理 |

- 範圍：`PASS_ENABLED`、`passPossible` 仍為 false；沙箱設定與 `configDigest` 不變；受保護檔案與錨定不變；未改 CI、workflow、repository variable、OIDC。
- 審查者的 `S2B2-B3A-R1-reviewer-probes.mjs`（X1～X10）**沒有傳到 Claude 的環境**，所以 X1～X10 **未執行**；指令列出的非物件案例已自行寫成單元測試。
- 使用者決策：`未核准`

### F1 增量複驗（ChatGPT，2026-11-21）

- 結論：**通過，可交使用者驗收與合併決策**；未發現新增阻擋性缺失。B3A-R1-N1、NOTE-a、NOTE-b 在本輪範圍結案。範圍只限 PR #8 的輸入型別與例外處理、原型鏈回歸測試、版本號；**不等於**重新驗收完整 B3a 隔離，也**不批准** B3b。
- Reviewed Head：`df83fb5204d142b44a89906cd5c9d71048ca6f8d`；同 Head CI [run 44893134293](https://github.com/hsuanyu9503/class-management-next/actions/runs/44893134293) success（不含 Emulator／B3a）。
- 審查者獨立執行：
  - b3-unit：21 pass、0 fail、**1 todo**。todo 是 tar 結束標記後附加資料的拒絕測試（B3A-N5）；斷言目前仍不成立，**不算通過**。
  - manifest：91／91 檔大小與 SHA-256 吻合。
  - Verifier 封裝重播：15／15 的 result、完整 reasons、observedCanonical 與 verify.json 一致。重播用的 trusted 參數由作者交付的材料重建，只證明固定程式對這組材料可重現，**不構成**執行來源認證。
- 只有作者本機證據（審查者未重跑）：乾淨 checkout 完整流程、Emulator、s2:b3 26／26、16 項 mutation、schema 測試、225 個秘密的遮罩掃描。
- **未執行**：
  - X1～X10 原探針（檔案未取得；新增測試與其不宣稱逐項等價）；
  - hosted runner；A4／A10／A14／A18；簽章與第三方驗證；非 root Runner；
  - Windows 隔離（審查者只在 Windows 執行純函式測試）。
- 未解決（B3b 前處理）：B3A-N5～N8、NOTE-c。
- 使用者決策：`未核准`（待驗收與合併決策）


### PR #8 合併與負責人決定（2026-11-21）

- 負責人回覆「1.合併 2.全部開始」。Claude 依明確批准合併 PR #8：merge `322f65b0373c1fda0f040cc0d249c930da0a6a7e`（Head `493feb86`，同 Head CI run 44903688999 success）。
- 「全部開始」的範圍經負責人確認：
  - Q-1（D-17）、Q-2、Q-3 採用 `S2B2-B3-DECISION-SUMMARY.md` B 節的推薦；
  - **分兩個 PR**：PR-1 先處理 B3A-N5～N8（只在本機，不碰 workflow；NOTE-c 分開追蹤，見下方）；合併後 PR-2 才做 B3b（`attest.yml`、批准紀錄、錨定清單）；
  - Q-3 Actions artifact 保存天數：**30 天**。
- 仍待負責人處理（Claude 不代設）：錨定 digest、`CMN_S2_TRUSTED_TOOLCHAIN_SHA`、`CMN_S2_SIGNING_POLICY_BLOB`。完成前結果一律不得 `PASS`。
- Q-3 的「可下載範圍」：repository 為 public；artifact 的實際存取範圍在 B3b 實作時核對並回報，不以推定代替。

## S2-B2 第 3 批 B3b 前修正 PR-1（B3A-N5～N8）

- Base SHA：`322f65b0373c1fda0f040cc0d249c930da0a6a7e`（PR #8 合併）
- Reviewed Head SHA：`[尚未審查]`
- 風險等級（初評）：**L3**（Verifier、reconcile、沙箱設定與自我檢查變更）
- 詳細內容：`S2B2-B3A-REPORT.md` §7

| ID | 處理 | 位置 |
|---|---|---|
| B3A-N5 | 已修 | `src/b3/package.mjs`（重新序列化後位元組必須相同，`ARTIFACT_NONCANONICAL`） |
| B3A-N6 | 已修 | `src/b3/reconcile.mjs`（完整 `resourceRef`、null 順序、`claimedScope`、每筆稽核對應一筆 PATCH） |
| B3A-N7 | 已修 | `src/b3/isolation-policy.mjs`、`sandbox.mjs`、`selfcheck-host.mjs`、`sandbox-check/selfcheck.mjs`、`verifier.mjs`、`test/b3-run.mjs`、schema 草案；**configDigest 改為 `18d9e21f…`** |
| B3A-N8 | 已修 | `src/b3/case-input.mjs`（`buildCaseInput()`：`case.json` 只含該案例 actor 的 token）；`test/b3-run.mjs` |
| NOTE-c | 原文缺失，待確認 | 只有編號；不推測內容、不據此修改程式、不作為獨立阻擋條件 |

- 範圍：`PASS_ENABLED`、`passPossible` 仍為 false；Stage 1、錨定、CI、workflow、repository variable、OIDC 未變更。
- 使用者決策：`未核准`

### NOTE-c 的處理方式（負責人指示，2026-11-21）

- NOTE-c 目前只有編號，缺少原文，狀態標為「**原文缺失，待確認**」。
- 不推測內容、不據此修改程式、不把它當成獨立的阻擋條件。之後找到原文，再補上具體要求。
- B3A-N5～N8 另有明確描述，與 NOTE-c **分開追蹤**。上方 F1 紀錄中「B3A-N5～N8、NOTE-c」並列的寫法，以本節為準。
- F1 增量複驗「通過」的結論不變。

### PR-1 審查 R1（ChatGPT）與回應

- Reviewed Head：`30f4cccf573279a192a672cc26048e6f99678c5e`（最新 Head `501d2d71` 只多 NOTE-c 的文件更正）
- 結論：**CHANGES REQUESTED**
  - N5、N8：本輪可結案；
  - N7：本機實作方向與證據可接受。`pathMapDigest` 目前只檢查自洽與形狀，不能宣稱已獨立驗證 host 實際來源；hosted 驗收仍待後續；
  - N6：**PR1-REV001（MEDIUM）**：稽核 PATCH 的內容沒有和匯出的狀態對帳（審查者以內容矛盾的封裝重現：仍為 `UNATTESTED`）。
- 審查者獨立執行：b3-unit 27 pass／0 fail／0 todo；manifest 91／91；封裝重播 15／15。重播的 trusted 值由作者交付的材料重建，不是來源認證。
- 其他：N5 的 256 MiB 是輸入上限，不代表峰值記憶體；本輪沒有做上限效能驗收。

| ID | 處理（Claude） | 位置 |
|---|---|---|
| PR1-REV001 | 已修 | `src/trace-proxy.mjs`（結構化 `query`）；`src/b3/reconcile.mjs`（只允許可觀察的建立寫入、嚴格解碼、逐欄比對、遮罩投影） |

- 只修 PR1-REV001；N5／N7／N8 與既有行為維持不變。
- 使用者決策：`未核准`

### PR-1 R1 增量複驗（ChatGPT）與回應

- Reviewed Head：`18c6e7c80b1eddca2570f98729a87606aa7d0daf`（增量 Base `30f4ccc`）
- 結論：修正後再複驗，暫不合併。
  - PR1-REV001 **已關閉**：審查者獨立重跑前輪反例，現在判 `BLOCKED AUDIT_UNRECONCILED`。
  - 新發現 **PR1-R1-REV001（MEDIUM／P2）**：query 的參數名稱可以繞過遮罩，進入證據紀錄。審查者以 `queryOf → maskValue → JSON.stringify` 重現（全部是虛構資料）；HTTP 端到端只以原始碼確認。
- 審查者獨立執行：b3-unit 29／0／0；manifest 91／91；封裝重播 15／15；CI run 44906499146 對應同一 Head。

| ID | 處理（Claude） | 位置 |
|---|---|---|
| PR1-R1-REV001 | 已修 | `src/trace-proxy.mjs` 的 `queryOf`（允許清單投影） |

- 只修 PR1-R1-REV001；PR1-REV001 的逐欄對帳與 create-only 驗證保留不變。
- 使用者決策：`未核准`

### PR-1 R2 增量複驗（ChatGPT）

- Reviewed Head：`8ab69e1d057f3d5ad3207d177cf81ba0c742592e`（增量 Base `18c6e7c`；GitHub 增量 5 個檔案：3 份文件、`trace-proxy.mjs`、`b3-unit.test.mjs`）
- 結論：**R2 增量程式審查通過，沒有新的阻擋項目；可交使用者驗收與合併決策。** 這不代表審查者獨立完成了全部端到端測試，也不是合併授權。
  - PR1-R1-REV001（query 參數名稱未遮罩）：**關閉**；
  - PR1-REV001（稽核 PATCH 內容未對帳）：維持關閉。
- 審查者獨立結果：
  - 附件 12 個 SHA-256 一致；manifest 91／91 一致；Verifier 重播 15／15 一致；
  - 前輪 PATCH 反例仍為 `BLOCKED`（`audit write body missingField:auditId`）；
  - CI run 44908505531 success，對應同一 Head；
  - b3-unit：32 項中 31 pass、**1 fail**。失敗的是需要本機網路的 JSONL 端到端測試：審查環境的本機連線回報 `EACCES 127.0.0.1`，讀到 0 筆紀錄。審查者不據此認定程式有缺陷，**也不把這項記為獨立通過**。
- 只有作者證據（審查者未重跑）：乾淨 checkout 的 s2:test 97／0／0、s2:b3 31／31、mutation 31／31、還原後 b3-unit 32 pass、schema 24 個拒絕案例與 15 份 statement；Linux 隔離與 Emulator。
- 殘餘風險（不列為阻擋項目）：
  - query 的 `fieldPaths` 允許識別字形式的值，`pageSize` 允許有限長度的數字，之後再經過 masker。無法辨識所有「看起來像正常識別字、但沒有前綴」的不透明秘密，**不得宣稱任意內容都不會被記錄**；沿用既有的保留事項；
  - 本輪沒有重新認證所有 body／response 的資料來源；
  - manifest 一致與重播只證明內部一致，不證明可信的執行來源。
- 其他保留：
  - `PASS_ENABLED=false`；POC-001／002／008 最多 `UNATTESTED`，POC-009 `BLOCKED`；
  - N7 `pathMapDigest` 只是自洽檢查；
  - N5 的輸入上限不代表峰值記憶體已驗收；
  - NOTE-c 仍是「原文缺失，待確認」；
  - 缺少的 NOTE ①～⑦ 與 X1～X10 沒有執行。
- 使用者決策：`待決`（PR #9 驗收與合併）

### PR #9 合併（2026-11-21）

- 負責人回覆「合併 pr-9 接著開始 PR-2（B3b）」。Claude 依明確批准合併 PR #9：merge `bda85b23d3238e9652aca61f0627adf7a1482636`（Head `544f40fa`，與 R2 Reviewed Head `8ab69e1d` 相比只多文件；同 Head CI run 44909529711 success）。

## S2-B2 第 3 批 B3b｜受控執行 workflow 與信任根閘門（PR-2）

- Base SHA：`bda85b23d3238e9652aca61f0627adf7a1482636`（PR #9 合併）
- Reviewed Head SHA：`[尚未審查]`
- 風險等級（初評）：**L3**：新增具 `id-token: write`／`attestations: write` 的 workflow；修改受保護檔案與錨定清單；Verifier 判定。
- 負責人決定（2026-11-21）：
  - action 以官方 tag 解析出的完整 SHA 固定（同意 Claude 以 `git ls-remote` 唯讀查詢官方 tag）；
  - PR-2 維持 `PASS_ENABLED=false`；
  - 執行 job 以 sudo 執行 Runner。
- 內容：`S2B2-B3B-REPORT.md`。受保護檔案 29 → 41 個，錨定 digest 改變，**負責人必須在合併前重新核准** `CMN_STAGE1_ANCHOR_SHA256`。
- 與計畫的差異：批准紀錄先不放任何紀錄；`adapterCommit` 等於工具鏈；每次一個案例；不在 `main` 提交摘要。詳見報告 §3。
- 使用者決策：`未核准`

### PR-2 審查 R1（ChatGPT）與回應

- Reviewed Head：`8056dd93c9e60d8c9f0bdfb17449aca2a3a45920`
- 結論：**CHANGES REQUESTED**
  - **PR2-REV001（MEDIUM／P2）**：statement 沒有記錄驗證 job 的可信來源資料。`artifactId` 仍是 `0`、`signingPolicyBlob` 仍是全零、`producerJob` 仍是 `local-b3a`。審查者以模擬流程的真實封裝重現。
  - 不是已發生的偽造 PASS：`PASS_ENABLED=false` 有效阻止 PASS 與簽章。
- 其他審查意見：
  - 打開 PASS 會產生新的工具鏈 commit，文件必須寫清楚：要重新審查、更新批准紀錄與兩個指標，並重新核准錨定；
  - 錨定要等最終 Head 再由負責人核准，**不要為目前的 Head 先更新**；
  - 在 `main` 提交摘要仍是後續待辦；
  - hosted 自我檢查、A10、A4／A14 的平台整合、A18 與實際簽章都尚未完成。
- 審查者獨立執行：
  - 附件 15 個 SHA-256 一致；manifest 91／91；封裝重播 15／15；前輪 PATCH 反例仍為 `BLOCKED`；
  - b3-unit：37 項中 36 pass、1 fail。失敗的是需要本機 HTTP 的 JSONL 測試（審查環境 `EACCES`），不算獨立通過；
  - CI：`validate` success，`baseline-anchor` failure。

| ID | 處理（Claude） | 位置 |
|---|---|---|
| PR2-REV001 | 已修 | `src/b3/verifier.mjs`（可信 provenance；hosted 路徑缺少時判 `BLOCKED`；本機寫 null）；`src/b3/attest-verify.mjs`（交出 provenance；`statementSha256` 寫入診斷）；`test/b3-run.mjs`（不再寫入 `run.artifactId`）；schema 草案（null 規則與 PASS 條件） |
| PASS 啟用順序 | 已補文件 | `S2B2-B3B-REPORT.md` §4 |

- 使用者決策：`未核准`；錨定待最終 Head 再核准。

### PR-2 R1 增量複驗（ChatGPT）

- Reviewed Head：`6d7e90d486fe817cc90689f115d43296323791c4`（增量 Base `8056dd9`）
- 結論：**增量程式審查通過，PR2-REV001 關閉；沒有新的程式阻擋項目。** 等負責人核准錨定、必要的 CI 通過後，再決定是否合併。**不是**已核准合併，CI 也**不是**全綠（`baseline-anchor` 仍失敗）。結論只限於 `PASS_ENABLED=false` 的 B3b 初版。
- `attest-execute` 是本版 schema 與程式定義的 producer 標識，對應 `attest.yml` 的 `jobs.execute`，不是 GitHub 的數字 job ID；不能單靠這個字串證明 producer 的來源。
- 審查者獨立結果：
  - 附件 17 個 SHA-256 一致；manifest 91／91；重播 15／15；前輪 PATCH 反例仍為 `BLOCKED`；
  - 6 組模擬輸出的 digest 都一致，而且都沒有簽章；
  - b3-unit：40 項中 39 pass、1 fail。失敗的是需要本機 HTTP 的 JSONL 測試（`EACCES`），不算獨立通過；
  - **錨定**：從固定 Head 讀取全部 41 個檔案，逐檔核對後重算，得到 `fe954c3acdbb7eb9421cd23e4bd7bb91e6e390e61a267480f927211d34e15a0a`，與作者的值相同。這不是代替負責人的核准；受保護內容若再改變，就必須重新計算。
- 只有作者證據（審查者未重跑）：完整的 Linux／Emulator 流程、mutation、schema suite、模擬腳本本身。
- 保留：
  - hosted 自我檢查、A10、A4／A14 的平台整合、A18、實際簽章；
  - 在 `main` 提交摘要；
  - N7 的 host 來源驗證、N5 的效能界線；
  - POC-009 `BLOCKED`；
  - NOTE-c 仍是「原文缺失，待確認」；缺少的 NOTE 與 X1～X10 沒有執行。
- 使用者決策：`待決`（核准錨定與合併）

### PR #10 合併與第一次 hosted 執行（2026-11-22）

- 負責人核准錨定（`CMN_STAGE1_ANCHOR_SHA256 = fe954c3acdbb7eb9421cd23e4bd7bb91e6e390e61a267480f927211d34e15a0a`，41 檔）後，由負責人合併 PR #10：merge `e4f37509e91a66979fabb76fb6501e1e09c6cae6`（2026-11-22T01:25:54Z，Head `95559cac`）。
- 合併後 `main` 的 CI：[run 44971433581](https://github.com/hsuanyu9503/class-management-next/actions/runs/44971433581) success（含 `baseline-anchor`）。
- **第一次 hosted 執行**：`attest.yml`，[run 44971433557](https://github.com/hsuanyu9503/class-management-next/actions/runs/44971433557)，由 push 觸發，案例 POC-001，在 GitHub-hosted `ubuntu-24.04` 上執行。

  | 項目 | 由 job log 讀到的結果 |
  |---|---|
  | execute job | success。可信工具鏈為 `e4f3750`（兩個變數都還沒設定，所以用本 commit）；sudo 執行並封存；`platformSupported=true`；runId 綁定 44971433557、attempt 1；Runner 內的本機診斷為 `UNATTESTED` |
  | job outputs | 由非 root 的獨立步驟寫入：`packageSha256=e38f098b…`、`manifestSha256=d7f4ee5d…`、`platformSupported=true`、`toolchainCommit=e4f3750` |
  | 上傳 | `archive: false`，單一原始檔 `package-POC-001.tar`（78,336 bytes），artifact ID 14733757533，upload-artifact 回報的 digest 等於 `packageSha256` |
  | verify job | success。依 ID 下載時記錄「Downloading raw file (non-zip)」，檔名為 `package-POC-001.tar`，download-artifact 重算的 digest 一致 |
  | 判定 | `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]`；信任政策的原因為 `TRUSTED_TOOLCHAIN_NOT_SET`、`SIGNING_POLICY_NOT_SET`；statement `08b18248…` |
  | 簽章 | **skipped**（不是 PASS）；交付紀錄為 `NOT_ATTEMPTED_NOT_PASS` |
  | 診斷 | `s2-verify-POC-001`，artifact ID 14733304375，保存 30 天 |

- **由判定推得的結論（有限範圍）**：Verifier 會先處理完整性、隔離、對帳、契約比對等檢查，最後才進入信任根閘門。結果是 `UNATTESTED`，而且頂層原因只有 `TRUST_ROOT_NOT_CONFIGURED`，因此：本次提交的證據通過了該版本 Verifier 對 22 項自我檢查、政策要求的正向控制、對帳、契約 MATCH，以及 provenance 格式與綁定的檢查。
  - 22 項中只有政策指定的子集合（12 項）要求 `positiveControlOk=true`，其餘要求 `null`。
  - 這個結論是依原始 log 與程式的判定順序推得，**尚未**逐項閱讀原始觀察值，也**尚未**重播本次 hosted 封裝。
  - 這個結論**不**證明所有隔離攻擊都會失敗，**不**證明 host 來源已經認證，也**不**代表 A10／A4／A14／A18 的攻擊驗收已經完成。
- **證據界線**：
  - Claude 的執行環境無法連線 artifact 下載主機（`*.blob.core.windows.net`，網路政策 403），**沒有**讀到診斷檔中 22 項檢查的原始觀察值。以上結論來自 job log 與判定的語意，不是逐項檢視。負責人或審查者可以從 run 頁面下載 artifact 14733304375 與 14733757533 核對。
  - 這次只執行 POC-001。POC-002／008／009 尚未在 hosted 執行。
  - A10（平台憑證）沒有逐項證據；A4、A14 的平台整合只有這次正常路徑的證據，沒有攻擊情境；A18 與實際簽章仍是 NOT_RUN。
  - `PASS_ENABLED=false`。

### PR #11 文件審查（ChatGPT）與回應

- Reviewed Head：`38268a65a93f58afe22cdc4936d37b914c79bafa`（Base `e4f3750`）
- 結論：**有條件通過**：主要事實與 GitHub 原始資料一致；修正 HANDOFF 的過時狀態與日期之後，可以交使用者決定是否合併。
- 審查者獨立核對了 GitHub API，以及 execute／verify 兩個 job 的**原始 log**，內容包括：
  - PR #10 的合併；
  - 合併後的 CI；
  - artifact 的 ID、名稱、大小與上傳和下載時的 digest；
  - 判定、簽章 skipped、delivery；
  - `verifier.mjs` 的判定順序。
- 審查者**沒有**讀到 artifact 的原始位元組（本機無法解析下載主機），所以**沒有**重算 hosted package／statement 的 digest，也**沒有**重播 hosted 封裝。報告中的 digest 是原始 log 的值。
- 審查者沒有讀取變數設定的稽核紀錄，所以不能獨立證明誰在何時設定了錨定；`baseline-anchor` 通過，支持基準已經一致。

| ID | 處理（Claude） |
|---|---|
| PR11-N1（LOW）：HANDOFF 仍寫「錨定待核准、`baseline-anchor` 仍失敗」，與下一行已合併的紀錄矛盾；日期過時 | 已修：改為歷史語氣；日期改為 2026-11-22 |
| 判定推論的措辭 | 已改為有限範圍的說法（見上一節） |
| 後續門檻 | HANDOFF 寫明：要先保留並交付 hosted artifact 原檔；各 run／案例的證據獨立保存；完成 hosted 證據與攻擊驗收、獨立審查與負責人核准之後，才能進入 PASS 啟用 PR |

- 使用者決策：`待決`（PR #11 合併）

### 首次 hosted POC-001 原始證據補充複驗（ChatGPT，2026-11-22）

- 輸入：使用者提供的 `s2-verify-POC-001.zip` 與 `package-POC-001.tar`，來自 run 44971433557、attempt 1、commit `e4f3750`。
- 狀態更新：2026-11-22，ChatGPT 已取得使用者提供的首次 hosted 原始 package 與診斷檔。
  - package／manifest／statement 的 digest 與 GitHub 原始日誌一致；
  - 已核對 22 項 selfCheck、12 項必要的正向控制、終止與對帳紀錄；
  - 以相同版本的 Verifier 獨立重播，結果為 `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]`、contract MATCH；完整 statement 除重播時間外一致；
  - 部分 `observed` 字串被截短，Java 版本仍是 `unknown`；攻擊驗收與簽章並沒有因此完成。
- 歷史事實（不改寫）：上方 PR #10 合併與首次 hosted 執行的紀錄寫成時，Claude 的環境無法下載 artifact；PR #11 文件審查當時，審查者也還沒有讀到 artifact 內容、沒有重播。本節是之後補上的。

| 項目 | 結果（審查者以本機檔案重算） |
|---|---|
| package | 78,336 bytes；SHA-256 `e38f098b4a66fc1f7dec1910c269293d367653e9862151107770ee9fcc5b0cd1`，與日誌及 API 的 artifact digest 相同 |
| manifest | `d7f4ee5d05ae395220b20975471200ccb505b65aa1d5efb58c5548a33e8b4c7d`，與 execute job outputs 相同 |
| statement 原始位元組 | `08b18248ef93ad267189bd879643f9a988b68c3a464ba041cee70f3ccdf46c91`，與 verify job log、`verify.json`、`delivery.json` 相同 |
| package 內部 | 安全解析器通過；manifest 與 8 個 payload 檔案的內容綁定都成立 |
| provenance | artifact `14733757533`；producer `attest-execute`；`signingPolicyBlob=ffaee08109f5fde9fe5734cb4ae3986b003cb21e` |
| run 綁定 | runId 44971433557、attempt 1、nonce 都與原始 execute job log 一致 |
| selfCheck | ID 集合正好是政策的 22 項，全部 `ok=true`；12 項必要的正向控制都是 `true`，其餘 10 項是 `null` |
| 終止 | `namespaceTerminated=true`、`remainingAdapterProcesses=0`、`exportAfterTermination=true` |
| 對帳 | frontRequests=1、auditAdded=1、auditMatched=1；其餘計數都是 0；`nonceMarkerUnchanged=true` |
| Observer | workspaceId `WS-A17`、returnedCount 15、crossWorkspaceDisclosure false；契約 MATCH；Adapter 的宣稱與 Observer 一致 |
| 信任根 | `TRUSTED_TOOLCHAIN_NOT_SET`、`SIGNING_POLICY_NOT_SET`；批准紀錄來源的錨定比對為 true |
| delivery | `NOT_ATTEMPTED_NOT_PASS`，`attestationId=null` |

- 重播的可信輸入取自原始 job log 與 API 的值，**沒有**從封裝的自我宣稱取得 runId、nonce、commit 或 artifactId。使用的 Verifier 版本是 `6d7e90d4`，它與 merge commit 只差兩份文件，執行的程式相同。
- 限制：
  - 只是 POC-001 正常路徑的 hosted 證據複驗；不代表 POC-002／008／009 或 A4／A10／A14／A18 的攻擊驗收已經完成；
  - ENV_ALLOWLIST、PROC_ISOLATED、FS_GIT_HIDDEN、OUTPUT_CHANNELS_HIDDEN 提供了 A10 相關的正常自我檢查證據，但不等於完整的平台憑證攻擊測試；
  - 部分 `observed` 字串被產生端截短（每項上限 200 字元），不能當作完整、未截短的逐路徑證據；
  - `environment.java` 為 `unknown`，這份證據沒有證明實際的 Java 版本；
  - `pathMapDigest` 仍只做自洽檢查；
  - 本輪沒有另外執行 JSON Schema 全套測試。
- 後續改善（未實作，列為待辦）：
  - 環境證據改為記錄實際的 Java 版本；
  - 觀察值截短時，另外保存完整的清單或 digest。

### PR #11 合併與 hosted 執行 POC-001／002／008／009（2026-11-22）

- 負責人回覆「三項都是」：合併 PR #11、依序觸發 POC-002／008／009、起草 hosted 攻擊驗收計畫。
  - Claude 依明確批准合併 PR #11：merge `7324a50a6138fe1fb0c431dcd32d54fba2c520a0`（Head `8f0c9747`）。
  - Claude 逐一以 `workflow_dispatch` 觸發三個案例，等前一個完成才觸發下一個，避免 concurrency 取消排隊中的執行。
- 全部在 `main` 的 `7324a50` 上以 GitHub-hosted `ubuntu-24.04` 執行。兩個信任變數都還沒設定，所以可信工具鏈就是本 commit。下表由 job log 讀取：

| 案例 | run | 觸發 | 封裝 artifact（ID／大小／SHA-256，上傳與下載一致） | 判定 | statement SHA-256 | 診斷 artifact | 簽章 |
|---|---|---|---|---|---|---|---|
| POC-001 | [44973507104](https://github.com/hsuanyu9503/class-management-next/actions/runs/44973507104) | push（PR #11 合併） | 14734552843／78,336／`6dfaa8e2b6458db522eff93c166c160751de9a36706bb83c065740ca0ed1b5fb` | `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]` | `9bbda5357f9f148626cd01be0cc7695d31a113f8d77cafbb3c7f8e6aa8273ae9` | 14733889164 | skipped |
| POC-002 | [44973645770](https://github.com/hsuanyu9503/class-management-next/actions/runs/44973645770) | dispatch | 14734956754／71,168／`8f68e2f81370308dbe6e3d0388547625b079d69dcd23133f77478af0077a928c` | `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]` | `ff4f85e0479eb74c647ebadebd88eea38361727d0d5c952bed589012d2946092` | 14734408897 | skipped |
| POC-008 | [44973761591](https://github.com/hsuanyu9503/class-management-next/actions/runs/44973761591) | dispatch | 14734897223／98,304／`f8bb3278a7ac41dba1f7937823ffd8e669015e2903767e0dffbd365f98ef8fec` | `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]` | `ce9a96e93b2097af660ed39de26218e0154e686625ba059c8b0b8be3eb80207a` | 14734148476 | skipped |
| POC-009 | [44973876931](https://github.com/hsuanyu9503/class-management-next/actions/runs/44973876931) | dispatch | 14734482530／97,280／`3ce42f318eb9c56e3fa7f86c81e1ea99c3d28fda37b0e6a652218aba4a5d512d` | `BLOCKED [BLOCKED_FIELDS_G1_G4]` | `ba53ce01e447cde77f058cfcefa1db293d4993cb42997eedee483c3f9b5cbef8` | 14734867491 | skipped |

- 四個判定都與預期相同：POC-001／002／008 是 `UNATTESTED`，POC-009 因 G-1／G-4 是 `BLOCKED`。所有 run 的 `platformSupported=true`；交付紀錄都是 `NOT_ATTEMPTED_NOT_PASS`。
- **證據界線**：
  - 以上只來自 job log。Claude 的環境無法下載 artifact，**沒有**讀取、重算或重播這些 artifact 的內容。
  - 逐項核對與重播，需要由負責人下載各 run 的兩份 artifact 原檔，交給審查者；比照 run 44971433557 的補充複驗。
  - 這些都是正常路徑，不代表 A4／A10／A14／A18 的攻擊驗收已經完成。
- **hosted 攻擊驗收計畫**：`docs/stage2/S2B2-B3C-ATTACK-PLAN.md` v0.1（草案）已起草，待審查與負責人決定 Q-A～Q-D。計畫中同時列出兩項證據改善：Java 版本永遠是 `unknown` 的原因（`java -version` 寫到 stderr），以及觀察值截短的問題。

### PR #12 審查（ChatGPT）與回應

- Reviewed Head：`80b4f7e414187ec5079cb0d4ee358f68e9b5b1f2`（Base `7324a50`）
- 結論：**CHANGES REQUESTED**：先修訂計畫，再請負責人決定 Q-A～Q-D；不建議照 v0.1 開始實作。四個 hosted run 的紀錄與原始 verify log 一致。
  - 審查者**沒有**這四個 run 的 artifact 原檔，**沒有**重播。先前重播過的是 run 44971433557，不能用來代替這四次。
- 審查意見：
  - **PR12-REV001**：Environment 不是不可繞過的 OIDC 限制；
  - **PR12-REV002**：A10 的判準會把沙箱自身資料當成外洩；
  - **PR12-REV003**：A4／A14 的攻擊注入方式與預期結果不夠精確；
  - **PR12-REV004**：A18 的選項與 PASS 前置門檻互相衝突；
  - 兩項設計細節：`scenario` 的來源、完整觀察值的位置；
  - 引用官方資料：GitHub Environment 文件、upload-artifact README、`gh attestation verify` 文件，以及 GHSA-wjmr-j3rp-mh2g（舊版 `--signer-workflow` 只做前綴比對，v2.102.0 修正）。

| ID | 處理（Claude） | 位置 |
|---|---|---|
| PR12-REV001 | 已修訂：分開說明平台發出簽章與第三方接受；Environment 改為合作 workflow 的額外保護 | 計畫 §4.2、Q-C |
| PR12-REV002 | 已修訂：逐目標分類與判準；逐目標的正向控制；由可信側以測試標記與雜湊判定；偽造與遺漏的負向案例；不輸出原始機密 | 計畫 §1.5、§2 |
| PR12-REV003 | 已修訂：A14 每個情境列出輸入、不變的可信輸入、預期拒絕層與 NOT_RUN 條件；三層結果；A4 分為三項，並明列限制 | 計畫 §1.9、§3、§4.1 |
| PR12-REV004 | 已修訂：兩條門檻一致的流程（I／II），由負責人選擇；第三方腳本的完整規則；固定 `gh` v2.102.0 以上 | 計畫 §5；HANDOFF |
| 設計細節 | 已補：`scenario` 只來自可信輸入；完整觀察值只放在 `isolation.json`，statement 不變 | 計畫 §1.2、§6.2 |

- 範圍：只修訂文件；沒有實作、沒有改 Settings、沒有設定變數、沒有測試簽章。
- 使用者決策：`待決`（Q-A～Q-D；PR #12 合併）

### PR #12 v0.2 複審（ChatGPT）與 v0.3 回應

- Reviewed Head：`bbdc47269bfd617f35ea8d8c403796728ecf41cd`
- 結論：**CHANGES REQUESTED**：計畫仍要修訂。這不是發現了程式實作漏洞，也不代表 hosted 攻擊驗收已完成。
- 審查者核對的範圍：
  - 附件的 SHA-256；
  - Head、未合併的狀態，以及同 Head CI；
  - 文件與證據的一致性。
  - 審查者**沒有**重跑本機 npm 或 schema 測試。四個 hosted run 仍缺少各自 artifact 原檔的重播。
- 前一輪項目的判定：
  - PR12-REV001／003、`scenario` 的來源：**設計結案、實作待驗收**；
  - PR12-REV002／004：部分解決，**仍開啟**；
  - 完整觀察值：位置已解決，截斷的判定仍需補齊。
- 必要修正：
  1. REV002：「沒有看到外洩輸出」不能證明讀取被阻擋。需要可信的執行證據；無法確認時判 `INCONCLUSIVE`。
  2. REV002：雜湊前綴與測試標記的規則不一致，而且不能把標記寫進真實的控制檔。
  3. REV004：「目前 `active`」與「在歷史有效期間內」被混為一談，與 B3 計畫 §4.4 衝突。
  4. 完整觀察值：截斷後的資料仍能通過雜湊與摘要比對；處理順序沒有定義。
- 文字說明：
  - 流程 II 中 `ACCEPTANCE_PENDING` 的語意，以及改指變數不會停止已開始的 run；
  - §4.2「具備權限不等於已經發出簽章」。

| 項目 | 處理（Claude，v0.3） | 位置 | 狀態 |
|---|---|---|---|
| REV002：陰性證據 | 可信探測程式，在相同隔離設定下另開沙箱實例執行；比對設定 digest；結果透過 Runner 擁有的管道回報；單一目標 `DEFENDED` 需要四個條件；輸出掃描只能證明 `BREACHED`；負向案例 N-1～N-8 | 計畫 §2.1、§2.3 | 送審 |
| REV002：公開資料規則 | 真實機密與控制檔只做唯讀探測，不輸出內容、雜湊或前綴；canary 只來自 Runner 專建的資料；不寫入真實控制檔；先攔截再公開 | 計畫 §1.5、§2.2 | 送審 |
| REV004：歷史有效期間 | 步驟 4a：產生新證明時要求目前 `active`；第三方依簽章時間判定，與 §4.4 一致，兩種紀錄一致套用；補上邊界、正常退役與 `invalidateIssued` 的測試；「所有 `revoked` 都拒絕」列為另需決策的政策變更 | 計畫 §5.1 | 送審 |
| PR12-OBS：完整觀察值（新追蹤項） | 結構與必要 ID 集合；先遮罩、再序列化；以 UTF-8 bytes 計算大小與雜湊；摘要以 code point 計；截斷判 `INCOMPLETE`；邊界測試 | 計畫 §6.2 | 送審（計畫缺口，不是已發生的產品漏洞） |
| 流程 II 的說明 | `ACCEPTANCE_PENDING` 的語意；若選流程 II，實作前另提暫停、佇列與 `invalidateIssued` 的處理 | 計畫 §5.2；HANDOFF | 文字說明 |
| §4.2 的文字 | 改為「在平台允許，而且實際請求與簽署成功時」 | 計畫 §4.2 | 文字說明 |

- 範圍：只改文件。沒有實作；沒有改 Settings、變數或 workflow；沒有測試簽章；沒有觸發 workflow。
- 使用者決策：`待決`（Q-A～Q-D；PR #12 合併）

### PR #12 v0.3 複審（ChatGPT）與 v0.4 回應

- Reviewed Head：`9bca6c78c4f832aec9fc4ec2e9e4783921ee61e1`
- 結論：**CHANGES REQUESTED**，只剩兩項文件收尾。不要求重設架構，也不要求在本 PR 實作。這是計畫審查，不代表產品已經外洩。
- 審查者的證據：
  - 核對了 Head、CI head_sha、增量範圍與附件的 SHA-256；
  - 讀取相同 Head 的 `mask.mjs`，用合成資料執行一個測試：只有被明確傳入的不透明機密值才會被遮罩；
  - **沒有**重跑完整的 npm、schema 或 hosted 套件。
- 狀態：
  - **設計結案、實作待驗收**：REV001／003／004、REV002 的公開資料規則、`scenario` 的來源；
  - **仍開啟**：
    - **F1**：REV002 的 N-2，把相同設定等同相同的執行結果；
    - **F2**：PR12-OBS，masker 缺少已知機密清單的來源與呼叫契約。
- 實作驗收備註，不是文件阻擋項，記在計畫 §9：
  - `revoked` 紀錄格式錯誤時拒絕；
  - `selfCheckFull` 的邊界，以及對照可信 `CHECK_IDS`；
  - 掃描的有限範圍；
  - `ACCEPTANCE_PENDING` 的措辭。

| 項目 | 處理（Claude，v0.4） | 位置 | 狀態 |
|---|---|---|---|
| F1 | 結論範圍限於「這個探測操作被阻擋」；每個目標記錄身分、操作、時點與執行條件；無法建立等價性時記 `INCONCLUSIVE`；已確認成功時不被覆蓋。N-2 改為非機密 canary 的受控案例，預期回報 `READ_OK` | 計畫 §2.3 | 送審 |
| F2 | 新增包裝層 `maskObservation(value, { secretValues })`（`[MASKED_SECRET]`）；由可信 Runner 收集完整機密清單，包含輪替過的舊值；清單不輸出；無法取得時判 `BLOCKED`；新增六項測試 | 計畫 §6.2 | 送審 |

- 範圍：只改文件。沒有修改程式（包括 masker）；沒有改 workflow、政策、錨定或 Settings；沒有簽章。
- 使用者決策：`待決`（Q-A～Q-D；PR #12 合併）

### PR #12 v0.4 審查（ChatGPT）：文件審查通過

- Reviewed Head：`68ca03c1cfc0658b7cc58acb48ab3475cc4f6a50`
- 結論：**文件審查通過；設計結案、實作待驗收**。F1、F2 的文件阻擋狀態關閉，沒有新的文件阻擋項。這不是 GitHub 的正式核准，也不代表負責人已授權合併、選定 Q-A～Q-D 或啟用 PASS。
- 審查者的證據：
  - 已核對：PR 的 Head 與 Base、同 Head CI 44976821239（兩個 job 的 head_sha 一致）、增量範圍與附件的 SHA-256；
  - **沒有**重跑本機 npm，也沒有重算錨定。這兩項屬於提交者的證據。
- 狀態：
  - REV001～004、F1、F2／PR12-OBS、`scenario` 的來源：設計結案、實作待驗收；
  - 計畫 §9 的四項備註列為 C-1／C-2 的驗收條件；
  - F1 的等價性與 F2 的完整清單，都必須由實作證據支持；
  - 四個 hosted run 的 artifact 原檔重播仍未完成；
  - hosted 攻擊驗收與第三方簽章驗收都尚未完成。
- 本段記錄是在 Reviewed Head 之後新增的文件 commit，只改 `docs/REVIEW_LOG.md` 與 `docs/HANDOFF.md`。新 Head **不是**審查者已審的版本。
- 使用者決策：`待決`（Q-A～Q-D；PR #12 合併）

### PR #12 合併與負責人的決定

- 負責人（2026-11-22）：「pr12合併／q-a 是／q-b 流程1／q-c 是／q-d 依照建議順序」
- 合併：
  - merge commit `0771790f9906fe22233d9156cf4c51e31aae02ad`；
  - 合併時的 Head 是 `667ec03`。它比 ChatGPT 審查的 `68ca03c` 只多一個記錄審查結果的文件 commit；
  - 合併前的同 Head CI 44977590327：success。
- 合併後：
  - `main` 的 CI 44978067608：success；
  - push 觸發的 `attest.yml` run 44978067634：POC-001 → `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]`，簽章步驟 skipped；
  - 封裝 artifact 14736254648，digest `4f5d3dd9923697805f6415493e3b14bf02c6e78d2c3c6ccebc64d6fae676d605`，上傳與下載一致；
  - statement SHA-256 `d0dc527c683e8a1b4c64e6330c32f59efd2caced2c5f6d15ba77b2b8a1507d5d`；
  - 以上只來自 job log，Claude 沒有讀到 artifact 的內容。
- 決定：
  - Q-A 是；
  - Q-B **流程 I**；
  - Q-C 是：Environment 只作為額外保護；
  - Q-D C-1 → C-2 → C-3。
- 使用者決策：合併 `已核准`；Q-A～Q-D `已決定`

### C-1：hosted 攻擊驗收的實作（Claude 送審）

- 依據：攻擊驗收計畫 v0.4；負責人 2026-11-22 的 Q-A～Q-D（Q-D：先做 C-1）。
- 基準：`main` = `0771790`。PR 與 Head 見 PR 描述與審查請求。
- 初評風險：**L3**。理由：
  - 修改受保護的 `attest.yml`、Verifier、`attest-verify.mjs`、沙箱啟動器；
  - 新增一個 workflow，其中 verify-attack job 有 `actions: read`；
  - 錨定 digest 改變。
- 內容摘要：
  - C-1a：scenario 綁定與完整觀察值；
  - C-1b：A10 可信探測與判定；
  - C-1c：A14／A4 驗證端的攻擊測試組，以及無簽章的 `attest-attack.yml`；
  - 詳見 `docs/stage2/S2B2-B3C-REPORT.md`。
- 證據（全部是 Claude 本機的結果）：
  - `npm test` 17/17；`check`；`stage1:all` 且 Stage 1 沒有變更；
  - `s2:test` 129/129；`s2:b3` 32/32（遮罩 0 命中）；`s2:a10` 9/9；
  - attest-attack 的本機模擬：平台層的結果是手動餵入的；
  - mutation 17/17。
- **沒有**的證據：hosted 的 `attest-attack.yml`（NOT_RUN）、獨立審查、負責人核准。
- 錨定：`e2149bd9ff0781ce710d920e62ee8bf16495eaeba1f661eb49fd10eccf1eb976`（47 檔）。需要負責人重新核准；Claude 沒有設定任何變數。
- 使用者決策：`待決`（C-1 合併與重新核准錨定）

### PR #13 審查（ChatGPT）與 R1 回應

- Reviewed Head：`9e4db47d9343827c6d4290d14ff9019538718fbe`
- 結論：**CHANGES REQUESTED**，有五項 P2：C1-REV001～005。這不代表已觀察到實際外洩。
- 審查者的證據：
  - 已核對 Head、CI（`validate` success；`baseline-anchor` 為 `ANCHOR_MISMATCH`，屬待核准狀態）與附件的 SHA-256；
  - 以最小重現確認了 REV002 的 UNKNOWN_OP／ERROR／EMFILE、REV003 的模擬目標、REV004 的合成值，以及 REV005 的未涵蓋檔案；
  - 在 Windows 上 `a10-unit` 有兩項因 POSIX 路徑假設失敗，不列為缺陷；
  - **沒有**重跑 Linux／root 的整合測試；hosted 仍是 NOT_RUN。
- R1（Claude）：逐項修正與驗證見 `docs/stage2/S2B2-B3C-REPORT.md` §7。
  - 本機結果：`npm test` 19/19；`s2:test` 138/138；`s2:b3` 33/33；`s2:a10` 9/9；hosted 模式的示範；attest-attack 的本機模擬（平台證據是合成的）；mutation 31/31。
  - `a10.mjs` 改用 `path.posix`，路徑與平台無關。
- 錨定：`fb0f85b06bf435e7314d1deb95fbdc6833ffba031ea15bdea336b2f7c160a738`（83 檔）。送審時的 `e2149bd9…` 已作廢。需要負責人在複審通過後重新核准；Claude 沒有設定任何變數。
- 使用者決策：`待決`（R1 複審之後才決定合併與重新核准錨定）

### PR #13 R1 複審（ChatGPT）與 R2 回應

- Reviewed Head：`d0ab942897ff82f8337029c556c80dd742c811f3`
- 結論：**CHANGES REQUESTED**，只剩兩項收尾。
  - 本輪結案：C1-REV002、003、005，以及 REV001 中的 A14-2 與退出碼；
  - 仍開啟：REV001 的 A14-3a（沒有證明測到的是有效的外部 artifact）、REV004（短於 12 字元的已知秘密被排除）。
- 審查者的證據：
  - 獨立重算 83 檔的錨定 `fb0f85b0…`，與附件一致；
  - 核對 fixture 原檔；
  - 在 Windows 上重跑三組單元測試，33/33 通過；
  - 兩個最小重現：任意的外部 ID 判為 DEFENDED；短秘密沒被遮罩，掃描也沒命中；
  - **沒有**重跑 Linux／root 的整合測試或 mutation；hosted 仍是 NOT_RUN。
- R2（Claude）：
  - A14-3a 必須先以 artifact API 確認該 ID 存在、未過期，而且屬於另一個 run（等於給定的 `previousRunId`）；
  - 已知秘密不再依長度過濾，平台環境依名稱與用途分類；
  - 逐項說明見 `docs/stage2/S2B2-B3C-REPORT.md` §8；
  - 本機結果：`npm test` 19/19；`s2:test` 141/141；`s2:b3` 33/33；`s2:a10` 9/9；本機模擬（合成證據）；mutation 38/38。
- 錨定：`f79ade1e95fdf78d6f5f2d0f0e2bf4e5fd5ffb99f70a253511aab24e5bf5664e`（83 檔）。`e2149bd9…` 與 `fb0f85b0…` 都已作廢。
- 使用者決策：`待決`

### PR #13 R2 複審（ChatGPT）與 R3 回應

- Reviewed Head：`e4aee0dbef229007bec91a8574faa0ef580fa912`
- 結論：**CHANGES REQUESTED**，只剩 C1-REV001 的一個欄位驗證缺口。
  - C1-REV004：本輪結案；
  - C1-REV002、003、005：維持結案。
- 審查者的證據：
  - 獨立重算 83 檔的錨定 `f79ade1e…`，與附件一致；
  - 在 Windows 上重跑三組單元測試，36/36 通過；
  - 合成的重現：所屬 run 為 null、undefined、`'not-a-run'` 時，都判為 DEFENDED；
  - **沒有**重跑整合測試或 mutation；hosted 仍是 NOT_RUN。
- R3（Claude）：
  - 新增 `foreignEvidenceFrom()`，缺少或型別錯誤的欄位一律保持未知；
  - A14-3a 必須有明確的 `expired: false` 與合法的所屬 run ID，否則判 `INCONCLUSIVE`；
  - 逐項說明見 REPORT §9；
  - 本機結果：`npm test` 19/19；`s2:test` 143/143；`s2:b3` 33/33；`s2:a10` 9/9；本機模擬（合成證據）；mutation 43/43。
- 錨定：`31c23e4dc7bafdf80943581e459576bd0afef9a9f495fc6d046911a36fadb8d3`（83 檔，保護範圍不變）。先前三個 digest 都已作廢。
- 使用者決策：`待決`

### PR #13 R3 審查（ChatGPT）：程式審查通過

- Reviewed Head：`60169cfaf9b3155fe911adb0cebeb6f751a7f1aa`
- 結論：**程式審查通過**。C1-REV001～005 全部結案，本輪沒有新的阻擋項，hosted 驗收仍待完成。這不是 GitHub 的正式核准、不是合併授權，也不代表 PASS 可以啟用。
- 審查者的證據：
  - 增量為 6 個檔案（+123／−17），只涉及三份文件、平台證據收集器、攻擊判定與對應測試；
  - CI 45044919834：`validate` success；`baseline-anchor` 為 `ANCHOR_MISMATCH`，屬待核准狀態；
  - 獨立重算 83 檔的錨定 `31c23e4dc7bafdf80943581e459576bd0afef9a9f495fc6d046911a36fadb8d3`，與附件及 CI log 一致；
  - 在 Windows 上重跑單元測試 38/38；
  - **沒有**重跑 Linux／root 的整合測試或 mutation；這些數字仍是提交者的證據。
- 殘餘風險（審查者列出）：
  - hosted 的 attest-attack 仍是 NOT_RUN，包括 409 訊息、artifact API、實際下載與 Linux 沙箱的行為；
  - A14-3a／3b 需要有效的其他 run artifact；
  - exit 0 或 `DEFENDED_WHERE_RUN` 不代表所有案例都已執行，要逐項核對 `notRun`；
  - A10 的結論限於列出的操作與目標；
  - 四個正常路徑 hosted run 的原檔重播仍待完成。
- 作廢的 digest：`e2149bd9…`、`fb0f85b0…`、`f79ade1e…`。
- 本段記錄是在 Reviewed Head 之後新增的文件 commit，只改 `docs/REVIEW_LOG.md` 與 `docs/HANDOFF.md`。新 Head **不是**審查者已審的版本。
- 使用者決策：`待決`（核准錨定 `31c23e4d…`、合併、合併後觸發 hosted 攻擊驗收）

### PR #13 合併

- 負責人（2026-11-23）：「錨定已核准，pr13合併」。
- 合併前的檢查：
  - 第一次重跑時，`baseline-anchor` 讀到的仍是舊值 `fe954c3a…`，Claude 因此先停止合併，並請負責人確認 repository variable；
  - 負責人更新變數後，`baseline-anchor` 重跑結果為 `ANCHOR_OK`：83 個受保護檔案與 `31c23e4dc7bafdf80943581e459576bd0afef9a9f495fc6d046911a36fadb8d3` 一致；
  - Head `fd4e565` 的 `validate` 與 `baseline-anchor` 都通過。
- 合併：merge commit `b5ae349f1498620ac55fd38cbe888e5d77b40aa9`，`expectedHeadSha` 為 `fd4e565`。
- 合併後：
  - `main` 的 CI 45087498485：success；
  - push 觸發的 `attest.yml` run 45087498469：POC-001，`EXP_SCENARIO: honest` → `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]`，statement `21ca461a…`，簽章 skipped；
  - 封裝 artifact 14780101081，digest `d3dfaacf31a0bb68c13469ebda2370975ae57786577f7cfd3c2f440320de985b`，上傳與下載一致；
  - 以上只來自 job log。
- 尚未執行：hosted 的 `attest-attack.yml`，由負責人觸發。
- 使用者決策：合併 `已核准`；錨定 `已核准`

### 第一次 hosted attest-attack（run 45088076830）與同名階段的修正（Claude 送審）

- 負責人在 PR #13 合併後觸發（2026-11-23），輸入 `previousRunId=45087498469`、`previousArtifactId=14780101081`。
- 結果（只來自 job log 與 artifact 清單）：
  - `a10`：9/9 符合預期，A10-main 以**真實目標**判 `DEFENDED`；
  - `verify-attack`：在 A14 正向控制的下載就失敗；A14 與 A4 都沒有判定，記為 **NOT_RUN**。
- 發現：
  - 平台接受了同一個 run 中的同名上傳（`overwrite: false` 沒有拒絕）；
  - 比較新的同名 artifact 會把原本的 ID 蓋住，`download-artifact` 找不到原本的封裝。這是 fail closed，但有可用性上的影響。
- 修正：same-name 改在主要驗證之後執行；新增 `verify-same-name` 與 A14-2s；`attack-suite` v3。詳見 REPORT §10。
- 錨定：`d0b815eae57482e06fd66ca31af7eac84d657508667345deb02bde78c5f2d45f`（83 檔，保護範圍不變）。需要審查並由負責人重新核准。
- 使用者決策：負責人 2026-11-23「同意」開始修正 PR；合併與錨定 `待決`

### PR #14 審查（ChatGPT）與 R1 回應

- Reviewed Head：`18a5ecc9e07fc5c7f6fb5b398bfcaeb01cea2a1e`
- 結論：**REQUEST_CHANGES**，有一項 P2。
  - **PR14-REV001**：一般的下載失敗被寫成「同名遮蔽」的確定事實。審查者以 ETIMEDOUT 重現，輸出仍是 shadowing 的 finding。
  - 調整 job 順序是合理的；沒有擴大簽章權限，也沒有讓 Verifier 放行。
- 審查者的證據：
  - 附件 SHA-256 一致；
  - 在 Windows 上重跑單元測試 39/39；
  - 獨立重算 83 檔的錨定；
  - 核對了 run 45088076830 的 same-name 與 verify-attack job log；
  - **沒有**重跑 mutation 或整合測試。
- R1（Claude）：
  - 新增 `probe-original` job，讀取它自己的錯誤 log 作為原因證據；
  - 只有出現 ID-not-found 錯誤、而且清單同時列出兩個 ID 時，才記錄 shadowing；其他失敗只判有限命題，結果為 `CAUSE_UNVERIFIED`，不記錄 finding；
  - 報告 §10 對 run 45088076830 的描述，改為區分「觀察到的事實」與「推論」；
  - 逐項說明見 REPORT §11；
  - 本機結果：`s2:test` 145/145、`s2:b3` 33/33、`s2:a10` 9/9、mutation 56/56。
- 錨定：`7c4303b1d0e1906bf7b1bf8022ceaa72020667b91f59682bd62c8c3798205101`（83 檔）。`d0b815ea…` 已作廢。
- 審查者建議另立追蹤的可用性項目（不阻擋本 PR）：下載失敗時保存有上限的 ID／清單／錯誤診斷，並評估同一個 run 重跑或新增上傳者時的同名情況。
- 使用者決策：`待決`

### PR #14 R1 複審（ChatGPT）：程式複審通過

- Reviewed Head：`d2c1c09fcfe42ff5bcf1c97e4678b21d75e6ab8a`
- 結論：**程式複審通過**。PR14-REV001（P2）已關閉，沒有新的阻擋項目。這不是 GitHub approval、不代表 CI 全綠，也不代表 hosted 攻擊驗收已完成。
- 審查者的證據：
  - Head、Base 與附件的 SHA-256 一致；
  - 在 Windows 上重跑單元測試 40/40、`repo_policy` 6/6；
  - 獨立重算 83 檔的錨定 `7c4303b1…`，與 CI log 一致；
  - 獨立對照：ETIMEDOUT 與原因缺失 → `CAUSE_UNVERIFIED`，沒有 finding；目標錯誤 → `SHADOWED`，有 finding；
  - **沒有**重跑 mutation 或 Linux／root 的整合測試；這些仍是提交者的證據。
- 非阻擋的追蹤項目：
  1. **A14-1b 的標籤語義**：工具鏈不符等前置條件錯誤時，目前判為 `BREACHED`，應改為 `INCONCLUSIVE`，並保留原 reason code，仍以非零狀態退出。原則：預期的 `PACKAGE_DIGEST_MISMATCH` → `DEFENDED`；確認替代品被接受，或受測的不變條件遭破壞 → `BREACHED`。
  2. **正常 `attest.yml` 的可用性診斷**：下載失敗時保存有上限的 ID／清單／錯誤診斷，並評估同一個 run 重跑或新增上傳者時的同名情況。
- 仍未完成：修正後的 hosted 執行；run 45088076830 原檔的核對。
- 本段記錄是在 Reviewed Head 之後新增的文件 commit，只改 `docs/REVIEW_LOG.md` 與 `docs/HANDOFF.md`。新 Head **不是**審查者已審的版本。
- 使用者決策（2026-11-23）：
  - 負責人更新了 `CMN_STAGE1_ANCHOR_SHA256`。CI run 45093716207 attempt 2 的結果是 `ANCHOR_OK`（`7c4303b1…`，83 檔），`validate` 也通過；
  - 負責人明確指示「pr14合併」。PR #14 於 Head `7223ff5` 合併為 `2f78f9b72fe8492ae3b3aaba8d06ff234a1fe73f`；
  - 修正後的 hosted `attest-attack.yml` 待負責人觸發。

### 修正後的 hosted `attest-attack.yml`：run 45094456766 attempt 1（Claude 從 log 讀出；不是審查者證據）

- 觸發：負責人，workflow_dispatch，main `2f78f9b72fe8492ae3b3aaba8d06ff234a1fe73f`。工具鏈 commit 也是 `2f78f9b…`（`CMN_S2_TRUSTED_TOOLCHAIN_SHA` 未設定）。錨定 `7c4303b1…`。沒有簽章。
- 7 個 job 全部 success。Node v22.23.5；runner image ubuntu-24.04 20261116.133.1。
- A10：`checks=9/9`、`A10_OK`。A10-main 與 N-1、N-3、N-4 為 DEFENDED；N-2、N-5、N-8 為預期的 BREACHED（負控制）；N-6、N-7 為預期的 INCONCLUSIVE。
  - 4 個 `ENV_*` 為 `N/A_HOST_ABSENT`，`PORT_18300/18302/18399` 為 `N/A_HOST_UNREACHABLE`，其餘目標都是 DEFENDED。
- 主要階段：`ATTACK_SUMMARY stage=main overall=DEFENDED_WHERE_RUN notRun=- findings=0`。
  - A14-positive 的 `CONTROL_OK` 結果是 UNATTESTED（`TRUST_ROOT_NOT_CONFIGURED`、`SCENARIO_NOT_HONEST`）；
  - A14-1、A14-3a、A14-3b-i/ii、A4-1、A4-2-i/ii、A4-3 都是 DEFENDED。
- 同名階段：`ATTACK_SUMMARY stage=same-name overall=DEFENDED_WHERE_RUN notRun=- findings=2`。
  - A14-2 為 `PLATFORM_ACCEPTED`：同名 artifact 被接受，ID 14783000880；
  - A14-1b 為 DEFENDED（`PACKAGE_DIGEST_MISMATCH`）；
  - A14-2s 為 DEFENDED（`ORIGINAL_ID_SHADOWED_FAIL_CLOSED`）。
- `probe-original` 的錯誤行：`Unable to download artifact(s): None of the provided artifact IDs were found`（原 ID 14782373665；`Found 6 artifact(s)`）。
- Artifact digest：
  - `s2-attack-a10` 14782333832，`be9a8e74…`
  - `s2-attack-summary` 14781973556，`449e7ff4…`
  - `s2-attack-summary-same-name` 14781888957，`853d8435…`
  - 原封裝 14782373665，`0f91173c…`
  - 誘餌 14782523179，`f1cffd08…`
  - A4 封裝 14782727619，`3bdbbda7…`
  - 同名封裝 14783000880，`b4589cdf…`
  - 控制檔 14782990640，`bc3978ab…`
- 待審查者確認：主要階段的平台證據行是 `sameNameLogOk=false … errors=1`。推論：主要階段執行時同名 job 尚未執行，所以查不到它的 log。這一點需要用原檔確認。
- 仍未完成：ChatGPT 以原檔做 hosted 驗收；run 45088076830 原檔的核對。

### run 45094456766 原檔審查（ChatGPT，2026-11-23）

- 結論：**八份原始附件核對通過**。可重播的 A14／A4 案例與 A10 診斷判定，都與 hosted 摘要一致；沒有新的產品阻擋缺陷。這不是 GitHub approval，也不授權開啟 PASS、簽章或更改 Settings。
- 審查者的證據：
  - 從實際位元組重算 8 份附件的 SHA-256，逐項符合 GitHub artifact digest。兩個 `package-POC-001.tar` 中，87552 bytes 是原封裝，4096 bytes 是同名替代品；
  - 用已審的判定程式重播（不執行封裝內容）：A14-positive（UNATTESTED）、A14-1、A14-1b、A4-1、A4-2-i/ii 符合；A14-2、A14-2s、A14-3a、A4-3 以 API 清單與 job 日誌交叉核對；
  - A10：九組情境的 overall 與逐目標 outcome 重算一致。A10-main 為 `REAL_TARGETS_ONLY`，五個必要目標都是 DEFENDED。N-2、N-5、N-8 的 BREACHED 是負控制成功被抓到。
- 審查者界定的證據限制：
  - `ENV_*` 為 `N/A_HOST_ABSENT`，不能宣稱這次測到了實際 token 的阻擋；
  - `PORT_183xx` 為 `N/A_HOST_UNREACHABLE`，不能當成防禦成功；
  - 安全診斷沒有保留完整的沙箱原始資料。這次是一致性重算，不是獨立觀測主機；N7 主機來源的信任限制仍在；
  - 平台證據 JSON 沒有獨立隨附件提供，用 API 清單、日誌與摘要欄位交叉核對；當時的清單與日誌是有時間點的證據；
  - 同名可用性問題只是在該 action 版本與該次 run 下觀察到的，不能推廣成一般保證。
- **待補**：A14-3b-i/ii 是「hosted 已執行、原檔獨立重播待補」。缺的是舊 run 45087498469 的 artifact 14780101081（`package-POC-001.tar`，87552 bytes，`d3dfaacf31a0bb68c13469ebda2370975ae57786577f7cfd3c2f440320de985b`）。
  - Claude 以 API 確認（2026-11-23）：該 artifact 屬於 run 45087498469，未過期，到期日 2026-12-23；
  - 補齊後只需重播這兩項，不必重跑 hosted。
- 保留：
  - A14-2 `PLATFORM_ACCEPTED` 與同名可用性 finding；
  - A14-1b 標籤改進（非阻擋）；
  - run 45088076830 原檔核對、四個正常 hosted run 的原檔重播（與本次分開）；
  - `PASS_ENABLED=false`、POC-009 BLOCKED、Stage 1 的 72 筆 NOT_RUN；
  - N5、N7、main 摘要、NOTE-c 原文缺失不因本次結果結案。

### A14-3b-i／ii 原檔獨立重播（ChatGPT，2026-11-23）：缺件關閉

- 原檔：run 45087498469 的 artifact 14780101081（`package-POC-001.tar`，87552 bytes）。
  - SHA-256 `d3dfaacf31a0bb68c13469ebda2370975ae57786577f7cfd3c2f440320de985b`；manifest `3dafa587…`；
  - 封裝內的 `run.json` 確認來源是 run 45087498469。
- 方法：
  - 使用已審、版本 `2f78f9b…` 的 `runVerifyJob`。可信的預期輸入取自 hosted verify-attack 的 log（run 45094456766 attempt 1，scenario `attack-a14`），不採信舊封裝內的 run、nonce 或工具鏈；
  - 只做資料解析並執行可信 Verifier，不執行封裝內的程式。
- 結果，兩項都與 hosted 一致：
  - A14-3b-i：BLOCKED `PACKAGE_DIGEST_MISMATCH`；
  - A14-3b-ii：外層 digest 同步後，仍 BLOCKED `RUN_BINDING_MISMATCH`、`SCENARIO_MISMATCH`、`NONCE_MISMATCH`；
  - 兩項的 `delivery.signing` 都是 `NOT_ATTEMPTED_NOT_PASS`。
- 結論：A14-3b-i／ii 為「原檔獨立重播完成，與 hosted 一致」，**C-1 的 hosted 證據收尾**（報告 §12）。沒有新的修正要求，也不需要再觸發 hosted。這不授權開啟 PASS、簽章或更改 Settings。
- 機器可讀的結果在審查者本機：`work/hosted45094456766/a14-3b-replay-results.json`。這是審查者的證據，不在本 repository。
- 下一步：Claude 提出 C-2 計畫（`docs/stage2/S2B2-B3C2-PLAN.md`，草案），經審查與負責人確認後才實作。

### C-1f（PR #14 R1 的兩個非阻擋追蹤項目）：Claude 實作，待審查

- 負責人決定（2026-11-23）：C-2 計畫的 Q1～Q4 都依建議處理（計畫 §8），Q1 是先開這個小 PR。
- 內容（報告 §13）：
  - A14-1b：前置條件擋下 → `INCONCLUSIVE`，保留 reason code（`attack-suite.mjs` v5）；
  - `attest.yml`：新增 `availability` job，只有 `actions: read`，只在 verify 失敗時保存有上限的診斷；
  - 同名重跑的評估（推論，未在 hosted 測試）。
- 錨定會改變（85 檔，新增 `scripts/attest-availability.mjs`、`src/b3/availability.mjs`），需要負責人重新核准。
- 同一個 PR 也帶入 C-2 計畫草案 v0.1，請一併審查；C-2 尚未實作。

### PR #15 審查（ChatGPT）：C-1f 程式審查通過；C-2 計畫方向可採用

- Reviewed Head：`dbe65627b59761832e95a79adbab4b51804c0d35`（Base `2f78f9b…`）
- 結論：
  - **C-1f 程式審查通過**，沒有需要阻擋的缺陷，可以交給負責人決定錨定核准與合併；
  - C-2 計畫的方向可以採用，另有 4 項實作備註；
  - 這不是 C-2 程式或真實簽章的驗收，不是 GitHub approval，也不授權觸發簽章 workflow。
- 審查者的證據：
  - 遠端 Head 與 Base 和證據包一致，共 13 個檔案；ZIP 中的 7 份原始碼與測試和 Head 逐字一致；
  - 在 Windows、Node 26.13.1 上執行：`attack-suite-unit` 14/14、`availability-unit` 4/4、`repo_policy` 6/6，合計 24/24；
  - 獨立重算錨定 85 檔 `d07dfc54…`，與 PR 及 CI log 一致；
  - CI 45101256252：`validate` success；`baseline-anchor` 為預期的 `ANCHOR_MISMATCH`。
- 審查者**沒有**獨立執行，仍是提交者的證據：
  - `s2:b3`、`s2:a10`（Linux／root／emulator）；
  - `s2:test` 149/149；
  - mutation 16+56；
  - availability job 沒有在 hosted 執行，也不為驗收而製造失敗。
- 非阻擋的提醒：
  - A14-1b 的「非 BLOCKED」也包含 Verifier 的 FAIL。註解只舉 PASS／UNATTESTED。之後擴充攻擊資料時，依該案例受測的不變條件解釋，不一律寫成「已正式接受」；
  - 診斷的**輸出**有上限，但讀取 log 時的位元組數沒有上限，列為後續強化；
  - 這次的診斷實作不代表消除了同名 artifact 的可用性風險。
- C-2 的備註已納入計畫 v0.2（§2.2～§2.4、§5、§9、§10）：
  - 時間戳必須非空且可解析，記錄來源；
  - sigtest 照做檔案 digest 綁定，有三種輸出與對應的退出碼；
  - 外部 `--anchor`、政策取得紀錄、只能透過測試介面注入政策複本；
  - 合成 JSON 不等於真實驗證；
  - 官方來源已列入計畫 §10。
- 本段之後的 commit 只改文件（REVIEW_LOG、HANDOFF、C-2 計畫），錨定仍是 `d07dfc54…`。
- 使用者決策（2026-11-23）：
  - 負責人更新了 `CMN_STAGE1_ANCHOR_SHA256`；
  - 負責人指示「改好了，若CI 全綠，合併pr15」；
  - 同 Head `586ccbf` 的 CI run 45101877596 attempt 2：`validate` success，`baseline-anchor` 為 `ANCHOR_OK`（`d07dfc54…`，85 檔）；
  - PR #15 合併為 `da25061103bf25ca5f75494031198359849b3a9c`。

### C-2（第三方驗證 A18 與流程 I 的測試簽章）：Claude 實作，待審查

- 負責人指示（2026-11-23）：「開始C-2實作」。依計畫 v0.2 實作，詳見 `docs/stage2/S2B2-B3C2-REPORT.md`。
- 內容：
  - `trust-policy.mjs`：新增 `validAt`，parser 檢查 `validTo > validFrom`；
  - `third-party.mjs`（判定核心）、`verify-attestation.mjs`（CLI）；
  - `attest-sigtest.yml`、固定的 `SIGTEST.txt`、測試身分政策 `S2B2-SIGTEST-POLICY.json`（依 Q3 提出紀錄 `SIGTEST-001`）；
  - 攻擊計畫 §5.2 的措辭更正。
- 提交者的證據（審查者尚未重跑）：
  - `npm run check`、`npm test` 20/20、`stage1:all` 通過；
  - `s2:test` 160/160（含 `c2-unit` 11 項）；
  - mutation X1～X36 全部被抓到；既有 56 項與 W1～W16 也全部被抓到；
  - 以假 `gh` 與本機 bare repo 做的端到端模擬。**這不是密碼學驗證**。
- 錨定：`afa0dcd3bf824a17de45d5af883666d3f93be2b8352be1e831f8aacf2469822d`（90 檔），需要負責人重新核准。
- 送審重點（報告 §3）：
  - targets 的 `anchorDigest` 由已核准工具鏈 commit 自己的錨定腳本算出，只在 toolchain 紀錄有效後才執行；
  - subject 要求「至少一個」相符；
  - 測試身分政策的 `reviewRef` 與 `validFrom`。
- 使用者決策：`待決`（見下方 R1）

### PR #16 審查（ChatGPT）：CHANGES REQUESTED（PR16-REV001 P1、PR16-REV002 P2）→ Claude R1 修正

- Reviewed Head：`1164c40dba63081448e091a02ff8b09dc0dc8132`
- 審查者的發現：
  - **PR16-REV001（P1）**：錨定不符等拒絕之後，official 分支仍呼叫 `targetsAt`。CLI 的 `targetsAt` 會執行候選 commit 的腳本，最後才 `REJECTED`，無法撤銷副作用；
  - **PR16-REV002（P2）**：兩份有效的 official 證據共用工具鏈時，第二次解開會 `EEXIST`，被轉成 `TARGETS_UNAVAILABLE#1`。
- 審查者的證據：
  - Head、Base 與附件一致，ZIP 內 10 份檔案與 Head 逐字一致；
  - 在 Windows／Node 26.13.1 上：`c2-unit` 11/11、`repo_policy` 7/7；`anchor_coverage` 因 Windows 路徑分隔符失敗 1 項（不列為 finding）；
  - 兩個反例都重現；
  - 獨立重算錨定 90 檔，與提交值一致；
  - **沒有**重跑：160/160、B3、mutation；也沒有執行真實的 `gh`。
- 審查者對設計問題的答覆：
  - subject「至少一個相符」可以接受；
  - 執行歷史工具鏈的腳本不是天然安全的讀檔操作；
  - 測試身分政策的生效依賴已錨定的 `main`，審查不等於負責人核准。
- Claude R1 修正（報告 §3、§7）：
  - REV001：
    - protected 清單改為已驗證的資料檔 `scripts/anchor-paths.json`，驗證者用自己的程式計算候選 commit 的錨定值，**不執行候選程式**；
    - 兩階段判定，無副作用的檢查全部通過且政策沒過期，才讀取候選 commit；
    - 錨定清單拒絕符號連結與不安全的路徑；
  - REV002：核心依（commit，testId）快取，CLI 依完整 SHA 快取解開的結果；
  - 另外修正 `anchor_coverage` 的 POSIX 路徑。
- R1 的本機結果（提交者證據）：
  - `npm run check`、`npm test` 20/20、`stage1:all` 通過；
  - `s2:test` 165/165：`c2-unit` 13 項；`c2-cli` 3 項，用本機 bare repo、假的 `gh` 和 sentinel；
  - `s2:b3` 33/33（`S2B2B3A-20261123T054522Z-751913ee`）；
  - mutation：
    - Y1～Y10 中 9 項被抓到；Y5（CLI 解開快取）是等價的 mutation，因為一次 CLI 只有一個 testId，核心快取已經涵蓋；
    - 既有的 56＋16＋36 項全部被抓到。protected 清單移到資料檔後，R11、R12、W15、X34 改指向 `anchor-paths.json`，X25 改指向第二階段的比對。
- 新錨定：`060c588e4f919f48bfcbf5c14f3d29ffbb1f36d3d1be957289908bd79e942c25`（91 檔）。送審時的 `afa0dcd3…` 已作廢。
- 使用者決策：`待決`（見下方 R1 複審）

### PR #16 R1 複審（ChatGPT）：程式複審通過；PR16-REV001、PR16-REV002 CLOSED

- Reviewed Head：`d6d51020c6c969c36ac4cb82596ba25d844e783e`（前次 `1164c40`；相對前次 11 個檔案）
- 結論：**R1 程式複審通過**，兩項 finding 都關閉，沒有新的阻擋項目。這不是 GitHub approval，也不代表 C-2 的真實簽章驗收完成。
- 審查者的證據：
  - 附件 8 份檔案與 Head 逐字一致；
  - 在 Windows／Node 26.13.1 上：`c2-unit` 13/13、`repo_policy` 7/7、`anchor_coverage` 2/2（Windows 路徑問題已修正），合計 22/22；
  - 重播前次的兩個反例：錨定錯誤時 `targetsCalls=0`；重複的 official 證據 `ACCEPTED`，只計算一次；
  - 獨立重算錨定 91 檔 `060c588e…`，與文件及 CI log 一致；
  - CI 45120068776：`validate` success；`baseline-anchor` 為預期的 `ANCHOR_MISMATCH`。
- 審查者**沒有**獨立執行，仍是提交者的證據：
  - `c2-cli`（bare repo、假的 `gh`、sentinel）、165/165、B3 33/33；
  - mutation。Y1～Y10 的紀錄是 9 項被抓到、**Y5 未被抓到**，不得改寫成全部抓到；之後若支援多個 subject，要重新檢視這個等價性。
- 剩餘限制（審查者界定）：
  - 候選 tree 必須有有效的 `anchor-paths.json`，缺少時失敗，不能退回執行歷史腳本；
  - 錨定資料清單本身受保護，仍是審查重點，不代表可以任意縮小保護範圍；
  - 合成輸出與 sentinel 測試不能代替密碼學驗證；sigtest 成功只代表測試身分層被接受。
- 交接要求：PR 說明已更新為 R1 的計算方式、測試、複審結果與 91 檔的新錨定。
- 合併後的驗收交付（審查者指定）：
  - run ID／attempt／實際的 commit、subject digest；
  - `gh` 的版本與實際參數、退出碼、`gh-stdout.json`、`result.json`；
  - 正向（`SIGTEST_IDENTITY_ACCEPTED`）與反向結果：official profile 混用、錯誤的錨定要拒絕；政策撤銷、過期與路徑的反向重播，要標明證據來源。
- 使用者決策（2026-11-23）：
  - 負責人更新了 `CMN_STAGE1_ANCHOR_SHA256`，並指示「改好了若 CI 全綠，合併 pr16」；
  - 同 Head `1e70833` 的 CI run 45120816930 attempt 2：`validate` success，`baseline-anchor` 為 `ANCHOR_OK`（`060c588e…`，91 檔）；
  - PR #16 合併為 `b8d3ba4096033105f9149600f3138311e1443045`；
  - 下一步：負責人手動觸發 `attest-sigtest.yml`，之後由第三方以真實的 `gh` 驗證。**C-2 尚未驗收**。

### C-2 hosted 測試簽章：`attest-sigtest.yml` run 45121359992 attempt 1（Claude 從 log 讀出；不是驗證）

- 觸發：負責人，workflow_dispatch，main `b8d3ba4096033105f9149600f3138311e1443045`（PR #16 的合併 commit）。job `sigtest` success。
- 簽章 action：`actions/attest-build-provenance@4d10147…`（內部 `actions/attest@508db95…`），`subject-path: poc/stage2/sigtest/SIGTEST.txt`。
- log 中的事實：
  - `Attestation created for SIGTEST.txt@sha256:63515e7c0a94b6e13d0f9ed2525b4e43b5da5221a8442a611dcc2c6d79ffb318`，與判定核心寫死的 `SIGTEST_SHA256` 相同；
  - 使用 Public Good Sigstore 的憑證；
  - 已上傳到 Rekor：`logIndex=4050349070`；
  - repository attestation：`https://github.com/hsuanyu9503/class-management-next/attestations/70952425`。
- 憑證的 SAN 在 log 中以 base64 呈現。Claude 只讀了 log，**沒有**驗證憑證或簽章。身分與政策的判定，要由第三方以 `gh` v2.102.0 以上執行 `verify-attestation.mjs --profile sigtest`。
- 這份測試簽章會永久留在公開的透明度日誌中。它不是 statement，也不代表 PASS。
- 待完成：
  - 第三方的正向與反向驗證；
  - ChatGPT 審查交付物：run、attempt、commit、subject digest、`gh` 的版本與參數、退出碼、`gh-stdout.json`、`result.json`。
  - 通過後才記錄 C-2 驗收完成。

