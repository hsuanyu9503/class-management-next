# RELEASE NOTES｜交付版本摘要範本

> ⚠️ **本 PoC 適用說明**：本 Repository 是 Classroom Manager Next 技術驗證 PoC，**沒有** `pages.yml`、`release.yml`、`site/`、`scripts/build.mjs`、`scripts/package_release.py`、`scripts/verify_release.py`。本文件中關於網站建置、Pages 自動部署、Release／Tag／ZIP 的內容沿用自 Starter Kit V1.2 範本，**目前不適用**。唯一的 workflow 是 `.github/workflows/ci.yml` 的 `validate`（`check`／`test`／`stage1:all`）。另注意：GitHub Settings 已啟用 Pages（`pages-build-deployment`），若發佈來源為 `main`，合併後 Repository 檔案仍可能被公開；是否保留由專案負責人決定。

- 版本：`[待填]`
- Git Commit：`[由正式打包腳本寫入 VERSION.json]`
- 日期：`YYYY-MM-DD`
- 正式驗收證據：`[實際 PR 或 Issue／紀錄連結]`

## 本次新增／修改／修復

- `[內容]`

## 升級注意事項

- `[相容性、SQL、需要的人工作業]`

## 已知限制

- `[內容]`

## 重要提醒

請確認正式發布前已將本範本改為真實內容，並核對 `docs/TEST_REPORT.md`；`VERSION.json` 的 Git SHA 才是 ZIP 的技術版本依據。

> V1.1：正式 Release 不會因 main 自動部署而自動建立。需先完成驗收、核准並合併 main，再人工啟動 GitHub Actions `release.yml`。
