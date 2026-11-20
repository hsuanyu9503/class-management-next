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
