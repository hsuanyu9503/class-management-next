# Stage 1 R1｜獨立審查修正說明（REV-001～REV-004）

> 回應對 Head `211716e561867a0c2bd5c64e4d3f432ca027f42a` 的 L2 獨立差異審查。**鎖定的原始 CSV、fixtures、`canonical-oracles-v1.0.json` 皆未修改**（`contracts/stage1-baseline-lock.json` 與 v1.0 交付清單逐檔核對）。沒有放寬任何既有驗收條件；原 Stage 0 21 項、Stage 1 契約 14 項、原 20 項自我測試都保持不變並通過。

## REV-001（HIGH）預期結果可被改寫

三層獨立防護，由 `scripts/validate-stage1-guards.mjs` 在 `stage1:all` 執行：

1. **獨立預期映射清單** `contracts/oracle-approval-v1.0.json`：36 項逐欄列出。凡能由已鎖定 fixtures 推導的欄位（例：POC-008 的 P9／R1／N1／U4、POC-009 的 v5／N／5–7 節、POC-015 的正式 v5、POC-016 的 v6／Attendance N）**改由 fixtures 路徑重算**，不從 oracle 複製；每案 `sourceTokens` 必須出現在鎖定 CSV 同一列。欄位集合必須與 oracle 完全相同（不能刪欄或加欄）。
   - 狀態：`PROPOSED_PENDING_HUMAN_APPROVAL`。此清單由 Claude 轉錄，**尚未經人工核准**。
2. **寫死在程式中的不可放寬斷言** `src/contract-guard.mjs`：揭露／覆寫／自動改寫／假成功類布林欄位必須為 `false`；`identifyingFieldsReturned` 等計數必須為 `0`；`code` 只能是拒絕代碼，且須與 CSV 文字一致；P0 的 FORBIDDEN 案例不得遺失 `code`。即使 oracle 與 approval 被同步改寫，這一層仍會失敗。
3. **位元組鎖定**：oracle、approval 清單等 10 個固定檔案的 SHA-256／大小（見 REV-003）。

負向測試（`test/contract-guard.test.mjs`）：POC-002 改為 99、同步竄改兩份 JSON、POC-008/015/016/020 數值放寬、揭露旗標改 true、`code` 改為 `OK` 或錯誤代碼、刪欄／加欄、偽造來源 token。另以套件副本實測審查者的攻擊 A：`stage1:all` 結束代碼 1，三層防護都會失敗。

## REV-002（HIGH）假 Adapter 自稱 BACKEND_REAL 可得 PASS

- `src/runner.mjs`：Adapter 自填的 `mode`／`backend` 視為**不可信**。`BACKEND_REAL` 結果最多是 `PENDING_ATTESTATION`（附 `attested:false`），否則 `FAIL`；**Stage 1 沒有任何路徑產生 `PASS`**。
- `src/oracle.mjs`：`BACKEND_REAL` 的必要證據拒絕 placeholder 類值（`placeholder`、`todo`、`dummy`、`synthetic_mock_*` 等）。
- `src/evidence.mjs`：拒絕 `PASS`、拒絕 `attested` 不是 `false` 的結果，且 `traceId` 與至少一個非空 `evidenceFiles` 為必填。可記錄的輸出狀態為 Stage 0 schema 允許的 `BLOCKED`，`notes` 開頭為 `PENDING_ATTESTATION`。
- 正式 `PASS` 需要外部受控驗收層核對 Adapter 身份、環境、後端 trace 與證據；**此驗收層不在 Stage 1 範圍，尚未實作**。
- 舊測試 `Stage0 evidence fields available for FUTURE real backend output only` 原本以 `status:'PASS'` 樣本建立紀錄，已改為 `PENDING_ATTESTATION` 並斷言輸出為 `BLOCKED`；測試數不變。
- 以 v1.0 原始 runner／evidence 執行新測試，REV-002 的 4 項全部失敗，證明新測試確實能偵測原缺陷。

## REV-003（MEDIUM）Manifest 未在 CI 核驗

- 新增 `contracts/stage1-baseline-lock.json`：
  - `fixed`：10 個必須固定的基準檔，CI 逐檔核對 SHA-256 與大小；若該檔存在於 v1.0 交付清單 `stage1-file-manifest.json`，雜湊也必須與交付清單一致。
  - `mutable`：允許經審查 PR 修改的程式／文件。
  - `addedSinceDelivery`：v1.0 之後新增的檔案。
- 套件內任何未分類的檔案都會讓檢查失敗；必須固定的檔案清單寫死在 `scripts/validate-stage1-guards.mjs`，從 lock 刪除項目也會被偵測。
- `stage1-file-manifest.json` 保留為 v1.0 交付紀錄（不改寫）；檢查器輸出 `modifiedSinceV1Delivery`，如實列出 v1.0 之後改過的 mutable 檔案。

## REV-004（MEDIUM）文件仍寫「合併 main 即自動部署 Pages」

- 已直接修正 `CLAUDE.md`、`docs/WORKFLOW.md` 中會誤導操作的句子；PR 模板與測試紀錄範本的 `npm run build` 改為 `npm run stage1:all`。
- 其他沿用範本、提到 Pages／Release／site 的文件加上「本 PoC 適用說明」標示；`tests/poc_docs_policy.test.mjs` 會在缺少標示時失敗。

---

# R2｜第 2 輪複驗修正（審查 Head `a59da0447bae3705ee7bc0fed71ebc9b8caf380e`）

複驗結論 CHANGES REQUESTED：REV-002 已解除（Stage 1 範圍），REV-001／REV-005 HIGH、REV-003／REV-004 MEDIUM 仍需修正。核心反例：在同一 PR 內同步改寫 POC-017 的 oracle、approval、lock、manifest（不動 CSV／fixtures／防護程式），`stage1:all` 仍然全綠。

## REV-001／REV-005：協同竄改

1. **P0 逐案固定預期寫入程式**：`src/contract-guard.mjs` 的 `P0_PINNED` 以字面值列出全部 20 個 P0 案例的完整 `expectedResult`（含 POC-017／018／020／031），每案註明鎖定 CSV 的原文；不讀取任何 JSON。另檢查 CSV 的 P0 集合與釘選集合完全一致。
2. **PR 之外的受信任基準**：`scripts/verify-anchor.mjs` 計算受保護檔案的單一 digest。受保護檔案包含 10 個 fixed 基準、lock、防護程式、runner／oracle／evidence、測試、`ci.yml`、`package.json`、`.gitattributes`，以及此腳本本身。CI 新增 `baseline-anchor` job，把 digest 與 GitHub repository variable `CMN_STAGE1_ANCHOR_SHA256` 比對。
   - 這個變數只有負責人能在 Settings 設定，PR 無法修改；設定變數就是負責人對該基準的核准紀錄。
   - 未設定時以 `PENDING_OWNER_APPROVAL` 失敗，不一致時以 `ANCHOR_MISMATCH` 失敗（fail closed）。
3. **負向測試**：
   - `test/contract-guard.test.mjs`：POC-017 `successes:2／conflicts:0` 並同步改寫四份檔案（approval、generic 斷言、lock 在構造上都一致）→ P0 pin 失敗；20 個 P0 的每一個欄位放寬都會被攔截。
   - `tests/anchor.test.mjs`：在暫存副本重現同一個四檔協同竄改 → `ANCHOR_MISMATCH`；未設定變數 → `PENDING_OWNER_APPROVAL`。
   - 以套件副本實測審查者的反例：`stage1:all` exit 1（POC-017 pin），`verify-anchor` exit 1（digest 不同）。

**殘餘風險（無法在 PR 內解決，已明示）：** 修改 `.github/workflows/ci.yml` 或 `scripts/verify-anchor.mjs` 的 PR 可以跳過比對。這兩個檔案都在受保護集合中，因此 digest 一定會改變；負責人在更新變數前必須逐行審查這類差異。更強的防護（例如以 `pull_request_target` 從 `main` 執行比對邏輯）只能在本 PR 合併後另立 PR 導入。

## REV-003：協同竄改與健壯性

- 協同竄改由上述外部錨定處理；`stage1-baseline-lock.json` 的定位修正為「PR 內一致性檢查」，不再單獨宣稱不可變。
- LOW：`checkBaselineLock()` 遇到缺失的 mutable 檔案時，改為回報失敗項目，不再因 `sha256(null)` 拋出 TypeError；已補測試。

## REV-004：繼承文件矛盾

- `docs/WORKFLOW.md`、`docs/ONE_PAGE.md`、`docs/SETUP_CHECKLIST.md`、`templates/CLAUDE_GITHUB_TASK.md` 逐句改寫為 PoC 版本：只有 CI，不部署、不發行，並加入基準核准關卡。
- 網站／部署／發行 SOP 移到 `docs/starter-kit-reference/`：`RELEASE_AUTOMATION`、`INSTALL`、`RELEASE_NOTES`、`ACCEPTANCE`、`ADOPT_EXISTING`、`CHANGELOG`、`REVIEW_UPGRADE_NOTES`、`templates/RELEASE_APPROVAL`，並附 README 標明不適用。
- `tests/poc_docs_policy.test.mjs` 用指令句型偵測操作文件；以 `a59da04` 的舊檔驗證，審查者指出的句子全部能被偵測。
