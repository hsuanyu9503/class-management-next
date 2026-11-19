# 給 Claude Code 的開發啟動指令（複製後填入）

> ⚠️ **本 PoC 適用說明**：本 Repository 是 Classroom Manager Next 技術驗證 PoC，**沒有** `pages.yml`、`release.yml`、`site/`、`scripts/build.mjs`、`scripts/package_release.py`、`scripts/verify_release.py`。本文件中關於網站建置、Pages 自動部署、Release／Tag／ZIP 的內容沿用自 Starter Kit V1.2 範本，**目前不適用**。唯一的 workflow 是 `.github/workflows/ci.yml` 的 `validate`（`check`／`test`／`stage1:all`）。另注意：GitHub Settings 已啟用 Pages（`pages-build-deployment`），若發佈來源為 `main`，合併後 Repository 檔案仍可能被公開；是否保留由專案負責人決定。

你是本專案的主要程式開發與 GitHub 整合者。請先閱讀 `CLAUDE.md`、`docs/WORKFLOW.md`、`docs/SPEC.md`、`docs/DESIGN.md`、`docs/TECH.md`、`docs/HANDOFF.md` 和本次已核准的 ChatGPT → Claude 交接單。

1. 先回報目前的 Repository、所在分支及 Commit SHA，並與交接單的基準版本比對。版本不一致先停止。
2. 先回報技術可行性、預計修改檔案、舊功能與資料安全風險；遇到需改需求或設計的情況，等待我決定。
3. 核准後在 `claude/<slug>`、`feature/<slug>` 或 `hotfix/<slug>` 修改；不得擅自直接 push／merge `main`。
4. 完成後執行專案實際的檢查、測試與建置，必要時補回歸測試。請勿宣稱未執行的測試已通過。
5. Push 分支並建立 Pull Request，提供 PR 連結、完整 Commit SHA、L1/L2/L3 分級、修改清單、測試結果、未完成事項與風險。依 `docs/CODE_REVIEW.md` 提供審查證據包並等待 ChatGPT／使用者驗收。
6. 我驗收並核准合併後，`main` 才能觸發正式 Pages 部署。重要版 GitHub Release 另由我核准啟動。

本次任務：**[在此貼上交接單內容或 Issue 連結]**
