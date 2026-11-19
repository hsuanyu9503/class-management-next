# HANDOFF｜當前工作與交接狀態

> 這份文件是跨 AI 對齊進度用的**最新狀態快照**，不是聊天紀錄。

## 目前狀態

- 專案：Classroom Manager Next 技術驗證 PoC
- 任務：導入 Starter Kit V1.2 流程層，並建立 PoC Stage 1 文件與測試基準
- 狀態：`R2 修正完成，待 ChatGPT 複驗新 Head，並待負責人核准 baseline digest`（`211716e56186`、`a59da0447bae` 兩輪皆 CHANGES REQUESTED）
- 基準分支：`main`
- 基準 Commit：`aff18f0a67a1fb5c6a550f8b1774ee34701c34a0`
- 開發分支：`claude/nice-cerf-run692`
- 開發 PR：https://github.com/hsuanyu9503/class-management-next/pull/1（Head SHA 以 PR 頁面與 CI 為準）
- 初評風險：**L2**（新增可執行測試器與 CI workflow；無正式資料、秘密、部署權限）；最終等級由專案負責人決定
- 下一位負責人：ChatGPT（獨立差異審查）→ 你（決定等級與是否合併）
- 最近更新：2026-11-19

## 已確認事項

- Source Lock 兩檔 SHA-256 與大小相符；`stage1-file-manifest.json` 38 檔雜湊相符。
- 36 項案例：P0 20、P1 16；Firebase／PostgreSQL 皆 `NOT_RUN`。
- 11／17 A17：15 人 P9／R1／N1／U4（已登記 11、到校 10）。
- 11／16 SC-01：`LV-007 v5`、`AT-20261116-07`（v4, N）、`CR-20261116-001` 關聯不變。
- v6：`SC01-DRAFT-v6`（正式仍 v5）與 `SC01-COMMITTED-v6`（`hypotheticalOnly`）為兩個獨立情境。

## 待確認／阻擋事項

- ~~`main` 尚未設定分支保護~~：2026-11-18 已由負責人設定 Ruleset；GitHub 回報 `main` `protected: true`。Ruleset 細項（Active、Bypass 空、required check `validate`）由負責人在 Settings 確認，Claude 無法讀取。
- `contracts/oracle-approval-v1.0.json` 狀態為 `PROPOSED_PENDING_HUMAN_APPROVAL`，需負責人／獨立審查核准。
- **外部錨定**：負責人需在 Settings → Secrets and variables → Actions → Variables 設定 `CMN_STAGE1_ANCHOR_SHA256`（值為 `node scripts/verify-anchor.mjs --print` 的 digest，應與 ChatGPT 複驗時重算的值一致），並把 `baseline-anchor` 加入 Ruleset required checks。未設定前 `baseline-anchor` 會失敗，這是預期行為。
- 殘餘風險：修改 `ci.yml`／`verify-anchor.mjs` 的 PR 可略過比對，需逐行人工審查。
- REV-002：正式 `PASS` 需外部受控驗收層，Stage 1 未實作；Stage 1 只能產生 `PENDING_ATTESTATION`／`FAIL`。
- Repository 為 public 且已啟用 GitHub Pages（既有 `pages-build-deployment`）；合併 main 可能公開發佈 Repository 內容。
- `canonical-oracles-v1.0.json` 為提案式欄位映射，語意需審查。
- 未在使用者 Windows 實機執行 `npm.cmd run stage1:all`。
- 原分支名稱要求 `docs/poc-stage1-l1-baseline`：本工作階段僅能推送 `claude/*`（Starter Kit 亦允許 `claude/*`），故使用 `claude/nice-cerf-run692`。

## 測試結果快照

| 項目 | 結果（通過／失敗／未執行） | 證據 |
|---|---|---|
| npm run check | 通過（本機 Linux） | PR 描述 |
| npm test | 通過（本機 Linux） | PR 描述 |
| npm run stage1:all | 通過（本機 Linux, Node 22）：Stage0 21／契約 14／防護 4／自我測試 37／72 NOT_RUN | PR 描述 |
| CI baseline-anchor | 待負責人設定 variable（未設定時預期失敗） | PR checks |
| CI validate | 見 PR checks（需對應最新 Head SHA） | — |
| 後端 PoC（36×2） | **未執行**（NOT_RUN） | `poc/stage1/artifacts/stage1-72-backend-not-run-plan.json` |
| Windows 實機 | 未執行 | — |

## 交接紀錄

| 日期 | 從 → 到 | 任務／版本／Commit | 下一步 |
|---|---|---|---|
| 2026-11-18 | Claude → ChatGPT | Stage 1 基準 PR（Base `aff18f0a67a1`，Head `211716e56186`） | 獨立差異審查 |
| 2026-11-19 | ChatGPT → Claude | 審查 `211716e56186`：CHANGES REQUESTED（REV-001～004） | R1 修正 |
| 2026-11-19 | Claude → ChatGPT | R1 修正（Head `a59da0447bae`） | 複驗新 Head |
| 2026-11-19 | ChatGPT → Claude | 複驗 `a59da0447bae`：CHANGES REQUESTED（REV-001/005 HIGH、REV-003/004 MEDIUM；REV-002 RESOLVED） | R2 修正 |
| 2026-11-19 | Claude → ChatGPT／你 | R2 修正（新 Head 見 PR） | 複驗；你核准 digest |

> 規格的正式變更請同步修改 SPEC / DESIGN / TECH，不要只在這裡留下新決策。
