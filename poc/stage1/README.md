# Classroom Manager Next｜PoC Stage 1 共用測試介面與執行器 v1.0

> **狀態：本機「契約工具與執行器」已實測；Firebase／PostgreSQL 後端 PoC 均 `NOT_RUN`。**  
> **技術選型：未決定。**  **資料：全虛構。**  **無網路、無雲端專案、無 DB、無正式網站改動。**

本包承接 Stage 0 原始資料與檢查器，新增 **36 案例的可機器判讀規範、後端中立執行器、兩候選相同順序的執行計畫、必要證據檢查，以及本機 mock 負向控制測試**。

## Windows PowerShell 快速執行

1. 解壓本 ZIP，進入最內層含 `package.json` 的 `CMN-PoC-Stage1-v1.0` 資料夾。
2. 在 PowerShell 執行：

```powershell
node --version
npm.cmd run stage0:validate
npm.cmd run stage0:env
npm.cmd run stage1:validate
npm.cmd run stage1:self-test
npm.cmd run stage1:plan
```

或一次執行：

```powershell
npm.cmd run stage1:all
```

**不必**執行 `npm install`；所有程式只用 Node 標準函式庫。建議 Node ≥22；已依使用者 Windows Node v26.13.1 環境方向設計，但本交付只在隔離執行環境中執行測試，不宣稱已在使用者 Windows 實測。

- `stage0:validate`：保留舊資料雜湊與 21 項靜態檢查。
- `stage0:env`：包含 Windows `npm.cmd` 偵測相容修正；可額外執行 `node scripts/check-env.mjs --write` 產生本機環境報告。
- `stage1:validate`：驗證 36 項機器預期、來源文字、P0/P1、測資、證據鍵及執行次序。
- `stage1:self-test`：使用 `mock` 測試執行器本身，包含故意回錯結果及缺少證據的負向測試。結果 **不計入** 36 項後端 PoC。
- `stage1:plan`：建立 `artifacts/stage1-72-backend-not-run-plan.json`，共 36×2=72 行，全部 `NOT_RUN`。

## 檔案導航

| 路徑 | 功能 |
|---|---|
| `contracts/poc-test-matrix-v1.0.csv` | Stage0 鎖定的 36 項原始文字契約，不更動 |
| `fixtures/canonical-fixtures-v1.0.json` | Stage0 鎖定的虛構測資，不更動 |
| `contracts/canonical-oracles-v1.0.json` | 36 項預期結果的**提案式**機器欄位映射（待審查） |
| `src/oracle.mjs` | 嚴格比較預期值與實際 canonical 輸出；缺欄位即失敗 |
| `src/runner.mjs` | 統一執行單筆案例，區分 mock 與真實後端 |
| `src/evidence.mjs` | 將**未來真實後端結果**轉換成 Stage0 證據格式；拒絕 mock 轉正 |
| `test/mock-adapter.mjs` | 僅供測試執行器的合成假實作，無網路連線 |
| `test/runner.test.mjs` | runner 正反向自我測試 |
| `scripts/validate-stage1.mjs` | Stage1 靜態契約驗證 |
| `scripts/make-plan.mjs` | 計畫輸出：兩個候選全部 NOT_RUN |
| `docs/Stage1-架構與驗收門檻.md` | 使用方式、設計邊界及驗收紀錄 |
| `docs/Claude-Stage1-L1-審查提示詞.md` | Starter Kit v1.2 文件/測試器 PR 交付草稿 |

## 契約限制與待決事項

1. **Stage1 可執行工具 ≠ Firebase／PostgreSQL 已接入。** 目前沒有任一後端 Adapter，未執行 36 項 PoC。
2. `canonical-oracles` 是依據現有 `expectedCanonical` 文字提出的標準化欄位，**需要開發／審查時核實語意**；不能當作已經驗證的後端資料。
3. mock 只實作 6 個可由固定測資推導的場景，**只產生 `HARNESS_PASS` 或 `HARNESS_FAIL`，永不標成 Firebase／PostgreSQL `PASS`**。
4. 未來真實候選必須提供同一套經授權取得的來源狀態、版本、稽核和結果證據；欄位存在本身不等於證據真實，須經獨立檢查。
5. 僅使用虛構學生及隔離工作空間；不可在 CI 日誌或證據包放真實學生資料、密碼、權杖或高權限連線字串。
6. 後端真實測試的起跑條件：先經 Starter Kit v1.2 PR 文件／契約審查、確認兩個候選的測試服務與預算，再分別實作 adapter。

## 注意：Windows 原本 npm ENOENT 修正

Stage0 原始 `check-env.mjs` 對 Windows 的 `npm` 使用 `spawnSync(..., shell:false)` 會出現 `ENOENT`。本 Stage1 包只在 **Windows npm 偵測** 分支使用 `cmd.exe /d /c npm.cmd --version`，未改變原來的其他工具檢測。先前使用者在 Windows 以相同邏輯修正後已得到 `baselineReady:true`。

## 技術選型狀態

Firebase／PostgreSQL 皆 **候選**；Stage2／Stage3 的 PoC 成功與否必須根據真實執行及證據，不能根據 mock pass 或計畫檔判定。
