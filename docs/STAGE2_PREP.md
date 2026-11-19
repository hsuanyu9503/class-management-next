# PoC Stage 2｜Firebase Adapter 技術驗證：準備清單

> 本 PoC 適用說明：本 Repository 沒有網站建置、部署或發行 workflow；文中提到的 GitHub Pages 僅指 Repository 設定中已啟用的 Pages（見 `docs/STAGE1_BASELINE.md` 保留限制第 4 點）。

> **只是準備清單，尚未開始實作。** 本文件不代表已加入任何 Firebase SDK、Emulator、Adapter 或後端功能。開工前需專案負責人核准，並另立 PR（預期至少 L2；若涉及雲端專案、憑證或權限則為 L3）。

## 前置條件（開工前）

- [ ] 負責人確認是否啟動 Stage 2，以及範圍、預算與時程。
- [ ] Stage 1 收尾 PR 已審查並合併，`main` 的 `validate` 與 `baseline-anchor` 皆通過。
- [ ] 決定 GitHub Pages 是否保留（Repository 為 public）。
- [ ] 決定 `oracle-approval-v1.0.json` 是否需要正式核准版本（例如另立 v1.1 檔名，不改寫 v1.0）。

## 1. 本地工具與環境評估

- [ ] 盤點 Firebase Emulator Suite 需要的工具：Node.js（目前基準 22）、Firebase CLI、Java 執行環境（Firestore／Auth Emulator 需要），以及版本相容性。
- [ ] 參考 `poc/stage1/docs/Windows-本機自查與安全安裝順序.md`，規劃 Windows 本機的安裝順序與自查方式。
- [ ] 確認 Emulator 只在本機或 CI 執行，不連到任何正式 Firebase 專案。
- [ ] 評估 CI 是否能執行 Emulator（執行時間、快取、Java 安裝），以及是否需要獨立 workflow。

## 2. 受信任的後端驗證與證據認證（attestation）規劃

- [ ] 定義由誰（哪個受控執行器）證明「真的有執行後端」：Adapter 身份、執行環境、後端 trace、證據檔案。
- [ ] 定義 `PENDING_ATTESTATION` 轉成 `PASS`／`FAIL` 的條件與流程；Stage 1 的 `toBackendEvidence()` 目前一律拒絕 `PASS`。
- [ ] 證據檔案的保存位置、雜湊與遮罩規則（不得含真實個資或憑證）。
- [ ] 考慮把錨定比對改為從 `main` 執行（例如 `pull_request_target` 只做雜湊比對、不執行 PR 程式碼），降低 Stage 1 保留限制第 2 點的風險。

## 3. Firebase Adapter 與 Stage 1 執行器的介面對接計畫

- [ ] 遵守 `poc/stage1/src/runner.mjs` 的 Adapter 介面：`mode: 'BACKEND_REAL'`、`backend: 'firebase'`、`execute(caseSpec, fixtures)` 回傳 `{canonical, evidence}`。
- [ ] 規劃 36 項的 canonical 輸出如何從 Emulator 狀態取得，而不是由 Adapter 自行宣告。
- [ ] 規劃 fixtures 的載入、隔離與每案重置方式。
- [ ] 規劃每案的 `requiredEvidenceKeys` 如何對應真實的 trace／log。

## 4. 測試契約

- [ ] 沿用 36 項測試契約（P0 20／P1 16）與固定虛構測資，**不修改**鎖定檔案。
- [ ] 沿用 `P0_PINNED`、安全斷言與外部錨定；任何修訂都要重新審查並由負責人重新核准 digest。
- [ ] 執行順序依 `poc/stage1/contracts/test-order-v1.0.json`（P0 優先）。

## 5. 候選比較

- [ ] PostgreSQL 保留為另一個待比較候選，使用相同的 36 項、相同順序、相同證據要求。
- [ ] 技術選型維持 **UNDECIDED**，直到兩個候選都有經認證的真實結果。

## 6. 明確禁止（未經同意前）

- 不建立正式 Firebase（或 Supabase）雲端專案。
- 不使用真實學生資料；不提交 `.env`、service account、token。
- 不把 mock 的 `HARNESS_PASS` 或 `PENDING_ATTESTATION` 當成後端 PASS。
- 不宣稱 Stage 2、Stage 3 或技術選型已完成。
