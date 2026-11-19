# Starter Kit V1.2 範本參考（本 PoC 不適用）

> **本資料夾的內容不是本 PoC 的操作指引。** 這些是 AI Web Development Starter Kit V1.2 中與「靜態網站建置、GitHub Pages 自動部署、Release／Tag／ZIP 發行、既有網站導入」相關的原始文件，僅保留作為來源參考。

本 PoC 的實際規則：

- 唯一 workflow 是 `.github/workflows/ci.yml`：`validate`（`check`／`test`／`stage1:all`）與 `baseline-anchor`（與負責人核准的 digest 比對）。
- **沒有** `pages.yml`、`release.yml`、`site/`、`scripts/build.mjs`、`scripts/package_release.py`、`scripts/verify_release.py`；不建置網站、不自動部署、不建立 Release／Tag／ZIP。
- 操作指引請看：根目錄 `CLAUDE.md`、`docs/WORKFLOW.md`、`docs/ONE_PAGE.md`、`docs/SETUP_CHECKLIST.md`。
