# PoC 首次啟用清單

- [ ] 本機 `npm run check`、`npm test`、`npm run stage1:all` 成功（Windows 用 `npm.cmd`）。
- [ ] `main` Ruleset：Active、Bypass 清單為空、要求 PR、禁止 force push 與刪除。
- [ ] Ruleset 的 required status checks 包含 `validate` 與 `baseline-anchor`。
- [ ] 負責人審查後，設定 repository variable `CMN_STAGE1_ANCHOR_SHA256`（Settings → Secrets and variables → Actions → Variables）。
- [ ] 決定是否保留 GitHub Pages（Repository 為 public；若發佈來源為 `main`，合併後檔案可能公開）。
- [ ] Claude Code 會先讀 `CLAUDE.md`；只在 `claude/*` 分支工作、不自行合併。
- [ ] 每個 PR 有風險分級、固定 Head SHA、ChatGPT 審查與 Claude 逐項回覆紀錄。
- [ ] 不建立 Firebase／Supabase 雲端專案；不使用真實學生資料；不提交 `.env` 或憑證。
