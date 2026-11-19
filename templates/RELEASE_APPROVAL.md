# 正式版本發布核准單

> ⚠️ **本 PoC 適用說明**：本 Repository 是 Classroom Manager Next 技術驗證 PoC，**沒有** `pages.yml`、`release.yml`、`site/`、`scripts/build.mjs`、`scripts/package_release.py`、`scripts/verify_release.py`。本文件中關於網站建置、Pages 自動部署、Release／Tag／ZIP 的內容沿用自 Starter Kit V1.2 範本，**目前不適用**。唯一的 workflow 是 `.github/workflows/ci.yml` 的 `validate`（`check`／`test`／`stage1:all`）。另注意：GitHub Settings 已啟用 Pages（`pages-build-deployment`），若發佈來源為 `main`，合併後 Repository 檔案仍可能被公開；是否保留由專案負責人決定。

- 專案：`[請填]`
- 版號：`[例如 v1.2.0]`
- main Commit SHA：`[請填完整 SHA]`
- 對應 PR：`[請填]`
- 測試報告：`docs/TEST_REPORT.md`
- 最終驗收：`docs/ACCEPTANCE.md`

## 發布前必須確認

- [ ] 已核對本次版本包含的功能與修改。
- [ ] 必要測試通過，未測試項目已揭露並決定如何處理。
- [ ] 必要視覺與實機驗收完成。
- [ ] 已檢查是否涉及正式資料、權限、SQL、備份與相容性。
- [ ] GitHub Tag、ZIP `VERSION.json`、實際部署 SHA 應一致。
- [ ] 已知問題、部署與回復步驟已記錄。

## 核准

核准人：`[使用者]`

核准日期：`YYYY-MM-DD`

結論：`可發布／暫緩`

> Claude 僅在核准後執行正式 Pages 部署與 ZIP 封存；核准後，`main` 合併會自動部署；**正式 Release 與 ZIP 另需你手動啟動 `release.yml`**。
