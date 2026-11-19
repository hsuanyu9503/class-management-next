# PoC 協作流程｜你 × ChatGPT × Claude Code × GitHub

> 本 PoC 只有 CI 檢查，**不建置網站、不自動部署、不發行 Release**。網站版 SOP 已移到 `docs/starter-kit-reference/`。

## 基本約定

- **GitHub `main` Commit 是正式基準**；需求與驗收決策寫入 `docs/SPEC.md`，技術約束寫入 `docs/TECH.md`。
- **ChatGPT**：獨立差異審查；**Claude Code**：程式修改與 Git 操作；**你**：決定風險等級、核准基準 digest、核准合併。
- **合併 `main` ＝ 同意此版本成為正式基準**；本 Repository 沒有部署或發行 workflow。Repository 的 GitHub Pages 設定由你另行決定是否保留。
- 三方沒有自動共享對話：使用文件、交接單、固定 Commit SHA 傳遞資訊。
- 依 `docs/RISK_POLICY.md` 分級；L2/L3 合併前必須有 **ChatGPT 對實際差異的獨立審查** 與 Claude 逐項回覆。CI 不能取代這個關卡。

## 階段與關卡

| 階段 | 負責 | 產物 | 必要決策 |
|---|---|---|---|
| 1 需求與驗收基準 | 你＋ChatGPT | SPEC、鎖定的 CSV／fixtures | 不可變更項 |
| 2 技術預審 | Claude Code | TECH、風險清單 | **關卡 A**：你確認可開工 |
| 3 實作與自測 | Claude Code | `claude/*` 分支、測試、PR | `validate` 通過 |
| 4 獨立審查 | ChatGPT 審查、Claude 修正 | REVIEW_LOG、審查包 | **關卡 B**：BLOCKER／HIGH 全部解除 |
| 5 基準核准 | 你 | `CMN_STAGE1_ANCHOR_SHA256` repository variable | **關卡 C**：你確認 digest 後設定，`baseline-anchor` 通過 |
| 6 合併 | 你 | 合併 `main` | **關卡 D**：你明確核准合併（不部署） |

## 分支與 PR

- `main` 以 GitHub Ruleset 保護：必須經 PR，且 `validate` 與 `baseline-anchor` 皆成功。
- `claude/<slug>` 為 Claude Code 雲端分支、`feature/<slug>` 為人工分支、`hotfix/<slug>` 為緊急修復。
- Claude 先核對 HEAD 與交接單基準 Commit，不得以聊天記憶替代指定 SHA。
- PR 須附需求對應、風險等級、變更摘要、測試與未驗證項目；新 Commit 需重新審查受影響範圍，舊 Head 的核准不沿用。
- AI 審查報告不是 GitHub 正式 Approve；不可硬推 `main` 或繞過保護。

## 受保護檔案與外部錨定

- `scripts/verify-anchor.mjs` 計算受保護檔案（鎖定基準、防護程式、測試、CI workflow）的 digest。
- CI 的 `baseline-anchor` 會把這個 digest 與你在 Settings 設定的 repository variable 比對；未設定或不一致即失敗。
- 任何修改受保護檔案的 PR 都會讓 digest 改變，需要你重新審查並更新 variable。修改 `ci.yml` 或 `verify-anchor.mjs` 本身的 PR 可能繞過比對，必須人工逐行審查。

## 發生異常怎麼做

- CI 失敗：在 PR 分支修復，不合併。
- `baseline-anchor` 失敗：先執行 `node scripts/verify-anchor.mjs --print`，逐檔比對差異來源；確認是已審查的變更後才更新 variable。
- SHA 不一致：停止並重新確認 Commit。
- 需求與技術衝突：Claude 提出替代方案，ChatGPT 評估，你決策後更新規格。

## 狀態

`規劃中 → 開發中 → 待審查 → 需修正 → 待核准基準 → 可合併 → 已合併`
