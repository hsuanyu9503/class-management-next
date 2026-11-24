# ADR-001｜後端技術選型：暫定 Firebase，PostgreSQL 對照暫緩

- 狀態：**已決定（暫定）**
- 日期：2026-11-24
- 決策者：專案負責人
- 紀錄者：Claude（依負責人 2026-11-24 的指示整理；ChatGPT 獨立審查待完成）
- 取代：無。本 ADR **不改寫**任何鎖定的 Stage 1 文件，而是以新的決策紀錄說明流程調整。

## 1. 背景

- 原始規劃（`poc/stage1/docs/PoC-階段順序與放行門檻.md`，鎖定）要求兩個後端候選（Firebase、PostgreSQL）以同一份測試矩陣實測：
  - Stage 2：Firebase；
  - Stage 3：PostgreSQL；
  - Stage 4：真機、斷網、備份、成本；
  - Stage 5：ADR 技術選型，需要 P0=20/20 PASS。
- 現況：
  - Stage 2 的 Firebase 驗證已建立完整的可信執行與證據鏈（S2-B2 第 3 批，C-1～C-3），但只接上 POC-001／002／008／009，結果最多 `UNATTESTED`；
  - PostgreSQL（Stage 3）尚未開始。

## 2. 決策

1. **Firebase 作為目前主要的實作與驗證方向。**
2. **PostgreSQL 對照驗證暫緩**，不作為目前推進的前置條件。
3. 這是**暫定**選型：**不代表** Firebase 已通過任何驗收。
4. **重新評估的觸發條件**：必要功能、離線操作、成本或維護出現無法接受的限制時，重新評估其他方案（包括 PostgreSQL）。

## 3. 對階段規劃的調整（不改寫歷史）

| 原階段 | 原要求 | 調整後 | 狀態標示 |
|---|---|---|---|
| Stage 2（Firebase） | Firebase Auth＋Firestore＋受控寫入 | **繼續**，作為主線 | 進行中；沒有任何 PASS |
| Stage 3（PostgreSQL） | PostgreSQL＋RLS＋交易式提交，與 Firebase 做語意比較 | **暫緩**，不作為前置條件 | **暫緩**（不是已完成、不是已放棄） |
| Stage 4（真機／斷網／備份／成本） | 所有 P0 有實機或正式測試環境證據 | **對 Firebase 保留，全部維持必要**：真機、離線、備份還原、成本、安全 | 尚未開始 |
| Stage 5（ADR 選型） | 對照矩陣、P0=20/20 PASS、P1 風險正式決議 | 改為「**Firebase 單一後端的正式確認**」：Firebase 的 P0=20/20 PASS 與 P1 風險決議仍然必要；本 ADR 只是暫定，正式確認時另立 ADR | 尚未開始 |

- **保留不變**（鎖定的 Stage 1 原始資料）：
  - 36 項契約與測試矩陣 `poc/stage1/contracts/poc-test-matrix-v1.0.csv`（含 `firebaseStatus`／`postgresStatus` 欄位）；
  - 固定測資 `poc/stage1/fixtures/canonical-fixtures-v1.0.json`；
  - 機器預期 `canonical-oracles-v1.0.json`；
  - 72 筆執行計畫 `poc/stage1/artifacts/stage1-72-backend-not-run-plan.json`：**36 筆 Firebase、36 筆 PostgreSQL，全部 `NOT_RUN`**；
  - P0／P1 的驗收標準，以及「不得放寬 P0」「mock 的 `HARNESS_PASS` 不得當作後端 PASS」（`docs/SPEC.md` §3）。
- **紀錄規則**：
  - 72 筆 `NOT_RUN` 是歷史紀錄，**不改寫**；
  - Firebase 的新實測結果，另以可追溯的證據記錄（Stage 2 報告、hosted run、artifact digest），不回填鎖定的檔案；
  - PostgreSQL 的 36 筆維持 `NOT_RUN`，在這份 ADR 下標示為「**暫緩**」，**不得**標示為已完成、已通過或不適用。

## 4. 後果

- 好處：集中資源在一個後端；既有的可信執行與證據鏈（C-1～C-3）可以直接延用。
- 代價與風險：
  - 失去「兩個候選以同一契約比較」的語意對照證據；
  - 若 Firebase 在離線、成本或交易語意上出現限制，切換的成本會隨實作的累積而增加；
  - 因此 §2-4 的觸發條件要在每一批的計畫中檢查一次。
- 不影響：`PASS_ENABLED=false`、POC-009 BLOCKED、D-01～D-16、G-1～G-4 的既有狀態與預設拒絕值。

## 5. 重新評估的觀察點（每一批計畫都要列出）

| 觀察點 | 會觸發重新評估的情況（舉例） | 對應的 Stage 1 案例 |
|---|---|---|
| 交易與冪等 | Firestore 交易無法保證「current＋revision＋receipt＋event」原子性，或無法可靠防止重送 | POC-016～021 |
| 授權 | 受控 API 以外的路徑無法關閉；服務帳號繞過 principal＋scope 的檢查無法防止 | POC-001～005、POC-035 |
| 離線 | 共用 iPad 的切帳隔離、durable 本機保存、過期版本衝突無法以可接受的方式達成 | POC-025～028、POC-033 |
| 備份還原 | current／revision／receipt／issue 的結構無法完整還原並核驗 | POC-031 |
| 成本與維護 | 讀寫量、p50／p95／p99 或月成本推估超出可接受範圍；長期維護風險不可接受 | POC-032；Stage 4 |
