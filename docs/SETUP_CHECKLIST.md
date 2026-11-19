# Starter Kit V1.2｜首次啟用清單

> ⚠️ **本 PoC 適用說明**：本 Repository 是 Classroom Manager Next 技術驗證 PoC，**沒有** `pages.yml`、`release.yml`、`site/`、`scripts/build.mjs`、`scripts/package_release.py`、`scripts/verify_release.py`。本文件中關於網站建置、Pages 自動部署、Release／Tag／ZIP 的內容沿用自 Starter Kit V1.2 範本，**目前不適用**。唯一的 workflow 是 `.github/workflows/ci.yml` 的 `validate`（`check`／`test`／`stage1:all`）。另注意：GitHub Settings 已啟用 Pages（`pages-build-deployment`），若發佈來源為 `main`，合併後 Repository 檔案仍可能被公開；是否保留由專案負責人決定。

- [ ] 設定專案名稱、Repository URL、主要維護者與網站公開範圍。
- [ ] 填入 `SPEC.md`、`DESIGN.md`、`TECH.md` 的專案規格。
- [ ] 本機 `npm run check`、`npm test`、`npm run build` 成功。
- [ ] GitHub 已建立 Repository、main 分支、首次 Commit。
- [ ] Pages Source 已選 GitHub Actions；`github-pages` environment 允許 main 部署。
- [ ] `main` 已啟用 PR 保護、禁止 force push、必要的 `validate` 檢查。
- [ ] Claude Code 已經過你授權可以存取 Repo，並確認會先讀 `CLAUDE.md`。
- [ ] 測試用 PR 能在 CI 運行且在合併後觸發 Pages；確認正式網址。
- [ ] 與 ChatGPT 的交接單 A／Claude 的交接單 B 都能正常使用。
- [ ] 首次 PR 有風險分級、固定 Head SHA 與 ChatGPT 審查／Claude 修正的回傳紀錄。
- [ ] 若有 Supabase，確保測試環境獨立、備份與遷移策略已核准。
- [ ] 重要版 Release 需有測試證據與核准文件，並下載 ZIP 離線備份。
