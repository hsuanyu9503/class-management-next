# 一頁操作｜你 × ChatGPT × Claude Code × GitHub

> ⚠️ **本 PoC 適用說明**：本 Repository 是 Classroom Manager Next 技術驗證 PoC，**沒有** `pages.yml`、`release.yml`、`site/`、`scripts/build.mjs`、`scripts/package_release.py`、`scripts/verify_release.py`。本文件中關於網站建置、Pages 自動部署、Release／Tag／ZIP 的內容沿用自 Starter Kit V1.2 範本，**目前不適用**。唯一的 workflow 是 `.github/workflows/ci.yml` 的 `validate`（`check`／`test`／`stage1:all`）。另注意：GitHub Settings 已啟用 Pages（`pages-build-deployment`），若發佈來源為 `main`，合併後 Repository 檔案仍可能被公開；是否保留由專案負責人決定。

**新功能：** 你＋ChatGPT 整理 SPEC / DESIGN → Claude Code 技術審查 → claude/feature 分支開發 → CI 檢查 → ChatGPT 差異審查（依 L1／L2／L3）→ Claude 逐項修正 → 三方驗收 → 你核准 PR → **合併 main 自動部署 Pages** → 實站驗證。

**視覺修改：** ChatGPT 提供 DESIGN / 圖片 / 動畫規格 → Claude Code 使用 feature 分支整合 → 自動測試與實機驗收 → 合併 main 自動部署。

**修錯：** 提供重現步驟與基準 Commit → Claude Code 在 hotfix 分支修復 → 測試與驗收 → 合併 main 自動部署。

**重要穩定版本：** 已填寫並核准 RELEASE_NOTES、TEST_REPORT、ACCEPTANCE 的 main Commit → Actions 手動執行 Release，輸入新版本 → 自動建立 **Tag + GitHub Release + ZIP + SHA-256**。

**交接必填：** 基準 SHA、需求、不可變動項、測試方法、資料風險與風險等級；Claude 回覆 PR / SHA / 測試、審查證據與尚未測試事項。

**Code Review：** 以固定 Head SHA 匯出真實程式差異（`python3 scripts/export_review_packet.py`），ChatGPT 用 `templates/CHATGPT_CODE_REVIEW.md` 審查；問題交 Claude 修正，再由你確認。細節見 [Code Review SOP](CODE_REVIEW.md)。

**安全：** 必須設定 main 規則限制直接推送；正式資料庫另外備份，網站 ZIP 無法還原資料庫。

更多：[完整流程](WORKFLOW.md)｜[自動化細節](RELEASE_AUTOMATION.md)
