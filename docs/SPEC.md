# SPEC｜產品需求規格（正式決策）

> 版本：PoC Stage 1　｜　狀態：待審查

## 1. 專案背景

- 專案名稱：Classroom Manager Next 技術驗證 PoC
- 性質：獨立技術驗證，**不是**正式班級管理網站；不修改 `Homework-manager-` 與 M02-04／M02-05 已定案功能與視覺規格。
- 來源文件：`CMN-Shared-Data-Architecture-Tech-Validation-v1.0`（以 `poc/stage1/contracts/source-lock.json` 鎖定）。

## 2. 驗收範圍（Stage 1）

- 36 項 PoC 案例（P0 20、P1 16）原文保留：`poc/stage1/contracts/poc-test-matrix-v1.0.csv`。
- 固定虛構測資保留：`poc/stage1/fixtures/canonical-fixtures-v1.0.json`。
- Firebase／PostgreSQL 72 筆執行計畫全部 `NOT_RUN`。
- 放行門檻：`poc/stage1/docs/PoC-階段順序與放行門檻.md`。

## 3. 禁止更動

- 不得修改鎖定的原始資料或放寬既有驗收條件。
- 不得將 mock `HARNESS_PASS` 當作後端 PASS。

## 4. 技術選型與階段調整（2026-11-24，負責人決策）

- 決策紀錄：`docs/adr/ADR-001-backend-selection.md`。
- **暫定以 Firebase 作為技術選型**，是目前主要的實作與驗證方向。這**不代表** Firebase 已通過任何驗收。
- **PostgreSQL 對照驗證暫緩**，不作為目前推進的前置條件；狀態標示為「暫緩」，不是已完成。
- §2 的驗收範圍與 §3 的禁止更動**不變**：
  - 36 項案例、固定測資、P0／P1 的驗收標準都保留；
  - 72 筆 `NOT_RUN` 是歷史紀錄，不改寫；
  - Firebase 的新實測結果另以可追溯的證據記錄。
- Firebase 必要的真機、離線、備份還原、成本與安全驗證，**全部保留**。
- 本 repository 仍是技術驗證 PoC，**不**開始網站頁面製作。

