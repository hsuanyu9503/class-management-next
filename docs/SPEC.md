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
