# 交給 Claude｜Stage1 L1 文件與測試器 PR 草案

請以 GitHub Starter Kit v1.2 的既定 PR/CI 流程，將附上的 Classroom Manager Next PoC Stage1 v1.0 視為**獨立技術驗證工具**，不要合併至舊版 Homework-manager，不要建立 Firebase/Supabase 雲端專案，不要使用真實學生資料。

## 執行範圍
1. 核對 `contracts/source-lock.json` 與原始測資／36案例未被更改，確認 Windows `npm.cmd` 偵測相容修補。
2. 複驗 `contracts/canonical-oracles-v1.0.json` 36組 `expectedResult` 是否逐項忠於原始 `expectedCanonical` 文字。所有新增推論必須標記提案，不能擅自改動正式 A～H 需求。
3. 檢查 `src/runner.mjs`、`src/oracle.mjs` 的嚴格驗證及缺證據不得 PASS；檢查 `src/evidence.mjs` 拒絕 mock 冒稱真後端。
4. 執行 `npm run stage1:all`，提交實際輸出並附版本資訊；若本機是 Windows PowerShell 用 `npm.cmd run stage1:all`。
5. 僅產生 L1 文件／測試器 PR，與我方獨立審查流程對接。禁用真後端 adapter、雲端寫入及敏感憑證。

## 驗收要求
- Stage0 21項通過、Stage1靜態契約通過、mock 測試器自我測試通過。
- 36項對 Firebase 與 PostgreSQL 狀態維持全部 NOT_RUN。
- PR 提供變更摘要、文件差異、模擬負向案例、CI 與證據包，附 Head SHA 供獨立審查。
- 若原始資料或測試口徑不一致，請提出明確的契約修訂，不可改寫來源鎖定資料。

## 禁止
- 將 mock 的 `HARNESS_PASS` 改寫為真正 PoC `PASS`。
- 將 PostgreSQL 或 Firebase 宣稱已選定，或假稱 iPad 實機、真實雲端、備份還原已測。
- 將服務金鑰、帳密或真實學生資料寫入 PR／報告。
