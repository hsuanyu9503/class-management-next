# REVIEW_LOG｜獨立審查紀錄

> 每一個 PR 記一段，詳細個案可附於 PR／Issue，本文只保留最新決策摘要與連結。

## PR #1｜PoC Stage 1 基準：導入 Starter Kit V1.2 流程層＋CMN-PoC-Stage1-v1.0

- PR URL：`https://github.com/hsuanyu9503/class-management-next/pull/1`
- Base SHA：`aff18f0a67a1fb5c6a550f8b1774ee34701c34a0`
- 風險等級及理由：`L2；新增可執行測試器與 CI workflow；無正式資料、秘密、部署權限。最終等級由專案負責人決定`
- 使用者決策：`未核准`

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
