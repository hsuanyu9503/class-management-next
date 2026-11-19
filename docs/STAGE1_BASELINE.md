# Classroom Manager Next PoC Stage 1｜正式基準紀錄

> 本 PoC 適用說明：本 Repository 沒有網站建置、部署或發行 workflow；但 Repository 設定已啟用 GitHub Pages，詳見下方保留限制第 4 點。

## 正式基準

| 項目 | 內容 |
|---|---|
| 基準名稱 | Classroom Manager Next PoC Stage 1 |
| 狀態 | **Merged Baseline** |
| Merge Commit | `fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`（PR #1，2026-11-19 臺灣） |
| Reviewed Head | `635587b4685973413132a8a148446be300b99bbc`（合併後的樹與此相同） |
| 測試契約 | 36 項：P0 20 項、P1 16 項（`poc/stage1/contracts/poc-test-matrix-v1.0.csv`，SHA-256 `4e42d9bb4bcd071d784a558a96ae50cc3521fb2e433c27c819e76ca857bddad3`） |
| 固定虛構測資 | `poc/stage1/fixtures/canonical-fixtures-v1.0.json`，SHA-256 `a2af65e8b86f2f212441b206a1457ca5eb76870375651a07ddaf0cd50508381f` |
| 外部錨定 | 29 份受保護檔案；repository variable `CMN_STAGE1_ANCHOR_SHA256` = `e33380c24bc58bdc3ada4c2ce2d0796e8f23deb7871078ccf0f756475bb934e9`（由負責人設定） |
| 技術選型 | **UNDECIDED** |
| Firebase | **NOT_RUN** |
| PostgreSQL | **NOT_RUN** |
| 後端執行計畫 | 72 筆（36 × 2），全部 `NOT_RUN` |

受保護檔案清單與逐檔 SHA：在 `fdcb5b9…` 執行 `node scripts/verify-anchor.mjs --print`。

## 保留限制

1. **預期清單的核准範圍。** `poc/stage1/contracts/oracle-approval-v1.0.json` 的檔案狀態仍是 `PROPOSED_PENDING_HUMAN_APPROVAL`，本次沒有改寫這個檔案。負責人這次採納的是「Stage 1 的正式測試基準」，並不代表所有未來業務語意都已永久定案。日後如需修訂，必須另立新版本並重新審查。
2. **外部錨定的極限。** 外部錨定能偵測受保護檔案的任何變化，但比對邏輯本身在 `ci.yml` 和 `scripts/verify-anchor.mjs` 裡，這兩個檔案可以被 PR 修改。所以它還不是完全獨立、無法被 PR 內工作流程繞過的驗證；這類 PR 必須由負責人逐行審查。
3. **Stage 2 的前置條件。** 實作真實後端測試之前，必須先規劃受信任的驗證與證據認證機制（attestation）。目前 Stage 1 只能把真實後端結果記為 `PENDING_ATTESTATION`／`BLOCKED`，不能記為 `PASS`。
4. **公開狀態。** Repository 目前是 **Public**。GitHub Pages 已在 Repository 設定中啟用：PR #1 合併時，`pages build and deployment`（[run 44532507248](https://github.com/hsuanyu9503/class-management-next/actions/runs/44532507248)）以 `fdcb5b9…` 執行並成功，表示 `main` 的內容已被發佈。本紀錄**不假定** Pages 已關閉；是否保留由負責人決定。
5. **資料與後端範圍。** Stage 1 不包含真實學生資料，不包含正式雲端資料庫，也沒有執行任何真實後端測試；mock 的 `HARNESS_PASS` 不是後端 PASS。

## 審查與核准紀錄

- L2 獨立審查共 3 輪（`211716e`、`a59da04`、`635587b`）；最後結論 CONDITIONALLY APPROVED；REV-001～REV-005 在已驗證範圍內 RESOLVED。詳見 `docs/REVIEW_LOG.md`。
- 專案負責人正式核准合併；ChatGPT 的審查報告不是 GitHub 帳號的正式 Approve。
