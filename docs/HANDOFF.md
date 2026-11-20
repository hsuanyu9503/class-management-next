# HANDOFF｜當前工作與交接狀態

> 這份文件是跨 AI 對齊進度用的**最新狀態快照**，不是聊天紀錄。歷史審查過程見 `docs/REVIEW_LOG.md`；正式基準見 `docs/STAGE1_BASELINE.md`。

## 目前狀態

- 專案：Classroom Manager Next 技術驗證 PoC
- 階段：**PoC Stage 1 已合併**（Merged Baseline）。合併後驗收狀態依下方實際 CI 證據記錄。
- 目前任務：**S2-B2 第 1 批**：本機 Emulator 基礎設施與後端證據認證設計（新 PR，`poc/stage2/`、`docs/stage2/S2B2-*`）。計畫與驗收清單見 `docs/stage2/S2B2-B1-PLAN.md`。
- **S2-B1 後續事實**（2026-11-20）：
  - PR #3 已由使用者合併，Merge SHA `b0f35af9388a2e75b0a141d692d59ecbf5ece446`（PR 最終 Head `d4b32ae4f6df00e50c753eb84a72e8b877b0358d`，R6 Reviewed Head `b8d2b39cfccc40151704ecd3c87fafa6a09e597a`）。
  - ChatGPT 已檢查 Reviewed Head 到合併版本的增量：只有 HANDOFF 與 REVIEW_LOG。
  - 合併後同 SHA 的 CI [run 44698127108](https://github.com/hsuanyu9503/class-management-next/actions/runs/44698127108) 成功；同 SHA 另有 Repository Pages 發佈紀錄，本批不更改 Pages 設定。
  - 使用者指示「合併完成，我們往下一階段繼續」。**合併不等於** D-01～D-16 已核准，也不等於正式雲端專案、付費服務或部署已獲授權。
- 基準分支：`main`
- 正式基準 Commit（Merge Commit）：`fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`
- 下一階段：PoC Stage 2｜Firebase Adapter 技術驗證，**尚未開始實作**（準備清單見 `docs/STAGE2_PREP.md`；S2-B1 只有設計文件）
- S2-B1 架構決策（負責人已確認）：A 班級精確授權、B 敏感請假資訊分離、C 正式修改只經受控 API。待決事項 D-01～D-16（含決定前的預設拒絕值與解除阻擋條件）見 `docs/stage2/S2B1-AUTHORIZATION.md` §12。
- S2-B2 第 1 批審查：R1（Head `d6181bb1ca24`）CHANGES REQUESTED（S2B2-REV-001 HIGH、S2B2-REV-002 MEDIUM）；R1 修正已提交到 PR #4，回應見 `docs/REVIEW_LOG.md`。
- 下一位負責人：ChatGPT（S2-B2 第 1 批 R1 修正複驗，信任邊界部分採 L3 深度）→ 你（驗收；`S2B2-B1-PLAN.md` §7 的 Q1～Q3；D-01～D-16 仍待決）
- 最近更新：2026-11-20（臺灣）

## PR #1 正式合併紀錄

| 項目 | 內容 |
|---|---|
| PR | https://github.com/hsuanyu9503/class-management-next/pull/1（`merged: true`，由 hsuanyu9503 合併） |
| 原始 Base SHA | `aff18f0a67a1fb5c6a550f8b1774ee34701c34a0` |
| Reviewed Head SHA | `635587b4685973413132a8a148446be300b99bbc` |
| Merge Commit SHA | `fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`（父 commit：`aff18f0…`、`635587b…`） |
| 合併時間 | 2026-11-19 21:20:35（臺灣，UTC+8）＝ 2026-11-19T13:20:35Z |
| 內容一致性 | `git diff 635587b fdcb5b9` 無差異：合併後的樹與最後審查的 Head 完全相同 |
| 審查等級 | L2；ChatGPT 獨立審查第 3 輪結論 CONDITIONALLY APPROVED |
| 合併核准 | **專案負責人正式核准合併**。ChatGPT 的審查報告**不是** GitHub 帳號的正式 Approve。 |
| main 後續更新 | 截至本收尾 PR 建立前，`main` 仍為 `fdcb5b9…`，沒有其他新 Commit |

## GitHub Ruleset 核對結果

- `main-protection` Ruleset 由**專案負責人核對**：Active、Target `main`、Bypass list 為空、要求 PR、必要檢查（`validate`、`baseline-anchor`）、禁止 force push。
- Claude 在本工作階段只能確認 GitHub 回報 `main` 為 `protected: true`；**無法以本工作階段權限讀取 Ruleset 細項**，細項以負責人的核對為準。

## CI 結果

**合併前**（Reviewed Head `635587b…`，pull_request，[run 44486915175](https://github.com/hsuanyu9503/class-management-next/actions/runs/44486915175)）

| Job | Attempt 1（2026-11-19 08:21Z） | Attempt 2（2026-11-19 12:55Z，負責人設定錨定值後重跑） |
|---|---|---|
| `validate` | success | success |
| `baseline-anchor` | failure：`PENDING_OWNER_APPROVAL`（預期，尚未設定 variable） | **success** |

**合併後**（`main` push，[run 44532509377](https://github.com/hsuanyu9503/class-management-next/actions/runs/44532509377)）

| 項目 | 內容 |
|---|---|
| Run ID | `44532509377`（event `push`，branch `main`，run attempt 1） |
| Commit SHA | `fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec` |
| 執行時間 | 2026-11-19T13:20:38Z 建立；13:20:48Z 完成（臺灣 21:20:38～21:20:48） |
| `validate`（[job 135589243585](https://github.com/hsuanyu9503/class-management-next/actions/runs/44532509377/job/135589243585)） | **success**：check、政策測試、`stage1:all`、鎖定檔不變性檢查全部 success |
| `baseline-anchor`（[job 135589243970](https://github.com/hsuanyu9503/class-management-next/actions/runs/44532509377/job/135589243970)） | **success**：digest 與負責人設定的 `CMN_STAGE1_ANCHOR_SHA256` 一致 |
| 整體結果 | **success** |

**同時觸發的其他 workflow**：`pages build and deployment`（[run 44532507248](https://github.com/hsuanyu9503/class-management-next/actions/runs/44532507248)，event `dynamic`，commit `fdcb5b9…`）結論 **success**。這表示 Repository 設定中的 GitHub Pages 已經以 `main` 的內容完成發佈；這不是本 PoC 的 `ci.yml`，是 Repository 層級的設定（見保留限制）。

## Stage 1 交付範圍

- Starter Kit V1.2 流程層：`CLAUDE.md`、`docs/`、`templates/`、PR／Issue 模板、`validate` 與 `baseline-anchor` CI、`scripts/export_review_packet.py`、`scripts/check.mjs`、`scripts/verify-anchor.mjs`。
- `poc/stage1/`：
  - CMN-PoC-Stage1-v1.0 原始契約與虛構測資（鎖定）
  - 後端中立執行器與 mock 自我測試
  - R1／R2 審查防護：獨立預期清單、寫死的安全斷言、P0 釘選、baseline lock
  - 72 筆 `NOT_RUN` 執行計畫
- 外部錨定：29 份受保護檔案的 digest，由負責人設定為 repository variable。

## Stage 2 尚未開始的項目

- Firebase Adapter、Firebase Emulator、任何 Firebase SDK：**未加入**。
- 受信任的後端驗證與證據認證層（attestation）：**未設計、未實作**。
- PostgreSQL Adapter：**未開始**；仍是另一個待比較的候選。
- 36 項 × 2 後端的真實執行：**全部 `NOT_RUN`**。
- 正式 Firebase／Supabase 雲端專案：**未建立**，需另經同意。

## 待確認／阻擋事項

- 是否保留 GitHub Pages：Repository 是 public，而且合併後 Pages 已發佈 `main` 的內容；需由負責人決定是否關閉或保留。
- `contracts/oracle-approval-v1.0.json` 的檔案狀態仍為 `PROPOSED_PENDING_HUMAN_APPROVAL`；負責人採納的是 Stage 1 的正式測試基準（見 `docs/STAGE1_BASELINE.md`）。
- 未在 Windows 實機執行 `npm.cmd run stage1:all`。
- 本收尾 PR 沒有處理的已知不一致：`CLAUDE.md` 頁首提示仍寫「唯一的 workflow 是 `validate`」，實際上還有 `baseline-anchor`。`CLAUDE.md` 是受保護之外的根目錄檔，但不在本次只改 `docs/` 的範圍；建議另立 PR 修正。

## 交接紀錄

| 日期 | 從 → 到 | 任務／版本／Commit | 下一步 |
|---|---|---|---|
| 2026-11-18 | Claude → ChatGPT | Stage 1 基準 PR（Base `aff18f0a67a1`，Head `211716e56186`） | 獨立差異審查 |
| 2026-11-19 | ChatGPT → Claude | 審查 `211716e56186`：CHANGES REQUESTED（REV-001～004） | R1 修正 |
| 2026-11-19 | Claude → ChatGPT | R1（Head `a59da0447bae`） | 複驗 |
| 2026-11-19 | ChatGPT → Claude | 複驗 `a59da0447bae`：CHANGES REQUESTED（REV-001/005、003、004） | R2 修正 |
| 2026-11-19 | Claude → ChatGPT／你 | R2（Head `635587b46859`） | 複驗；你核准 digest |
| 2026-11-19 | ChatGPT → 你 | 複驗 `635587b46859`：CONDITIONALLY APPROVED | 你設定錨定值、核准合併 |
| 2026-11-19 | 你 | 合併 PR #1 → `fdcb5b9a0788` | Stage 1 收尾 |
| 2026-11-19 | Claude → ChatGPT | Stage 1 收尾 L1 文件 PR | L1 差異審查 |
| 2026-11-19 | 你 | 合併 PR #2 → `4a842e7399d8` | 啟動 S2-B1 文件 |
| 2026-11-20 | Claude → ChatGPT | S2-B1 文件 PR（Base `4a842e7399d8`） | 獨立差異審查 |
| 2026-11-20 | ChatGPT → Claude | 審查 `af1ffc28707b`：CHANGES REQUESTED（REV-001～006） | R1 修正 |
| 2026-11-20 | Claude → ChatGPT | S2-B1 R1（v0.2，Head `c19910316e1c`） | 複驗 |
| 2026-11-20 | ChatGPT → Claude | 複驗 `c19910316e1c`：CHANGES REQUESTED（REV-007、REV-008 HIGH；REV-009 MEDIUM；案例前置條件） | R2 修正 |
| 2026-11-20 | Claude → ChatGPT | S2-B1 R2（v0.3，Head `89b975a9b50c`） | 複驗 |
| 2026-11-20 | ChatGPT → Claude | 複驗 `89b975a9b50c`：CHANGES REQUESTED（REV-010 HIGH；REV-011、REV-012 MEDIUM；REV-008 證據補強） | R3 修正 |
| 2026-11-20 | Claude → ChatGPT | S2-B1 R3（v0.4，Head `f5960a1771f7`）；權限規格採 L3 深度審查 | 複驗 |
| 2026-11-20 | ChatGPT → Claude | 複驗 `f5960a1771f7`：CHANGES REQUESTED（REV-013 HIGH；REV-014 MEDIUM；grant／membership 生命週期） | R4 修正 |
| 2026-11-20 | Claude → ChatGPT | S2-B1 R4（v0.5，Head `e588deb532ae`） | L3 深度複驗 |
| 2026-11-20 | ChatGPT → Claude | 複驗 `e588deb532ae`：CHANGES REQUESTED（REV-015 MEDIUM；§6.6 錯誤代碼；N-29 文字），無新增 HIGH | R5 集中修正 |
| 2026-11-20 | Claude → ChatGPT | S2-B1 R5（v0.6，Head `221d15567e0a`） | L3 深度複驗 |
| 2026-11-20 | ChatGPT → Claude | 審查 `221d15567e0a`：文件與模型範圍**有條件通過**，可進入使用者驗收；剩 REV-016、REV-017（LOW） | 收尾修正 |
| 2026-11-20 | Claude → ChatGPT | S2-B1 收尾（v0.7，Head `b8d2b39cfccc`） | 收尾複驗 |
| 2026-11-20 | ChatGPT → 你 | 收尾複驗 `b8d2b39cfccc`：通過，REV-016、REV-017 結案，文件與模型可進入使用者驗收 | 使用者驗收與合併決策（待決） |
| 2026-11-20 | 你 | 合併 PR #3 → `b0f35af9388a`；指示往下一階段繼續 | S2-B2 第 1 批 |
| 2026-11-20 | Claude → ChatGPT | S2-B2 第 1 批 PR（Base `b0f35af9388a`） | 獨立審查 |
| 2026-11-20 | ChatGPT → Claude | 審查 `d6181bb1ca24`：CHANGES REQUESTED（S2B2-REV-001 HIGH；S2B2-REV-002 MEDIUM） | R1 修正 |
| 2026-11-20 | Claude → ChatGPT | S2-B2 第 1 批 R1 修正（Head 見 PR #4） | 複驗 |

> 規格的正式變更請同步修改 SPEC／TECH，不要只在這裡留下新決策。
