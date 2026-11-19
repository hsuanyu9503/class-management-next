# 一頁操作｜PoC 版

**修改：** 交接單（基準 SHA、需求、不可變更項）→ Claude 在 `claude/*` 分支修改 → `npm run check`、`npm test`、`npm run stage1:all` → 建立 PR。

**審查：** Claude 以固定 Head SHA 匯出差異（`python3 scripts/export_review_packet.py --base origin/main --head HEAD`）→ ChatGPT 依 `templates/CHATGPT_CODE_REVIEW.md` 審查 → Claude 逐項修正並產生新 Head → 重新審查。

**核准：** 你確認 `node scripts/verify-anchor.mjs --print` 的 digest → 在 Settings → Secrets and variables → Actions → Variables 設定 `CMN_STAGE1_ANCHOR_SHA256` → Re-run `baseline-anchor` → 你核准合併。

**不做：** 本 PoC 不建置網站、不自動部署、不建立 Release／Tag／ZIP、不連接真實後端、不使用真實學生資料。

**安全：** `main` 以 Ruleset 要求 PR、`validate`、`baseline-anchor`；禁止 force push。

更多：[完整流程](WORKFLOW.md)｜[Code Review SOP](CODE_REVIEW.md)
