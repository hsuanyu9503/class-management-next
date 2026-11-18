# 未來候選 Adapter 入口（Stage1 不實作）

**Stage1 沒有 Firebase / PostgreSQL Adapter，也不連任何服務。**

Stage2/3 實作時，兩個 Adapter 都使用 `src/runner.mjs` 內的 `executeCase()`，接收相同的 `caseSpec` 和隔離的虛構 `fixtures`，回傳**實際觀察到的** `canonical` 資料與具有來源依據的 `evidence` 欄位。

案例明確要求的 `requiredEvidenceKeys` 不得用「true」或固定字串代替實際真實證據。測試器的 `HARNESS_PASS` 不是業務通過，也不是雲端測試證據。
