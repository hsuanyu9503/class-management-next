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
