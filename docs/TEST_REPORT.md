# TEST REPORT｜PoC Stage 1 正式驗收測試紀錄

- 版本／Commit：`fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`（PR #1 Merge Commit；樹與 Reviewed Head `635587b4685973413132a8a148446be300b99bbc` 相同）
- 日期：2026-11-19（臺灣）
- 測試環境：
  - GitHub Actions `ubuntu-latest`，Node.js 22
  - Claude Code 雲端容器 Linux，Node v22.23.5
- 未測環境：使用者 Windows（`npm.cmd`）、任何真實後端

| 測試 | 執行狀態 | 結果 | 證據 |
|---|---|---|---|
| `npm run check` | 已執行 | 通過 | CI `validate` step「檢查結構與敏感內容」 |
| 根目錄政策測試（`npm test`） | 已執行 | **15／15** | CI `validate`；本機輸出 |
| Stage 0 靜態檢查 | 已執行 | **21／21** | `stage1:all` 輸出 `stage0StaticReady: true` |
| Stage 1 契約校驗 | 已執行 | **14／14** | `stage1ContractReady: true` |
| Stage 1 防護校驗 | 已執行 | **4／4** | `stage1GuardsReady: true`（approval、安全斷言、baseline lock、P0 釘選） |
| Stage 1 執行器測試 | 已執行 | **37／37** | `node --test`（原 20 項＋R1 13 項＋R2 4 項） |
| 鎖定檔不變性 | 已執行 | 通過 | CI `git diff --exit-code -- poc/stage1` |
| 外部錨定比對 | 已執行 | 通過 | CI `baseline-anchor`：digest `e33380c2…34e9`，29 份檔案 |
| 後端執行計畫 | 已產生 | **72 筆 `NOT_RUN`** | `poc/stage1/artifacts/stage1-72-backend-not-run-plan.json` |
| Firebase 後端 | **未執行** | `NOT_RUN` | 無 Adapter、無 Emulator、無雲端專案 |
| PostgreSQL 後端 | **未執行** | `NOT_RUN` | 無 Adapter、無資料庫 |
| Windows `npm.cmd run stage1:all` | **未執行** | — | — |
| UI／多裝置 | 不適用 | — | 本 PoC 沒有介面 |

CI 證據：
- 合併前 [run 44486915175](https://github.com/hsuanyu9503/class-management-next/actions/runs/44486915175)（Head `635587b…`，attempt 2：兩項 success）
- 合併後 [run 44532509377](https://github.com/hsuanyu9503/class-management-next/actions/runs/44532509377)（`main` `fdcb5b9…`：兩項 success）

## 判讀注意

- 執行器測試中的 `HARNESS_PASS` 只證明**測試器本身**運作正確（mock 合成資料），**不是**任何真實後端的 `PASS`。
- Stage 1 沒有任何路徑能產生後端 `PASS`：自稱 `BACKEND_REAL` 的結果最多是 `PENDING_ATTESTATION`。
- 測試只使用虛構測資，沒有真實學生資料。

## 已知問題

- `oracle-approval-v1.0.json` 檔案狀態仍是 `PROPOSED_PENDING_HUMAN_APPROVAL`（見 `docs/STAGE1_BASELINE.md`）。
- 未在 Windows 實機驗證。

## 測試結論

- Stage 1 契約、防護與測試器：**通過**（以上列已執行項目為限）。
- 雙後端 PoC：**未執行**，留待 Stage 2／Stage 3。

> CI 通過只證明 CI 執行的項目通過；不代表後端可行性、效能或任何裝置已驗收。
