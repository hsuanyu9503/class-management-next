# TECH｜系統架構與技術決策

> 版本：PoC Stage 2（2026-11-24 更新）　｜　維護者：Claude（重要技術選型需經核准）

## 1. 目前技術基底

- 性質：Classroom Manager Next **獨立技術驗證 PoC**，非正式網站。
- 執行環境：Node.js 22+。Stage 1 只用標準函式庫；Stage 2（`poc/stage2`）以鎖檔安裝 Firebase Emulator 相關套件。
- 自動檢查：`scripts/check.mjs`、`tests/*.test.mjs`、`poc/stage1` 的 `stage1:all`。
- CI：`.github/workflows/ci.yml` 的 `validate`（`contents: read`，不使用 secrets）與 `baseline-anchor`。`baseline-anchor` 把受保護檔案的 digest 與負責人設定的 repository variable `CMN_STAGE1_ANCHOR_SHA256` 比對；清單在 `scripts/anchor-paths.json`，目前 92 檔。
- 其他 workflow：`attest.yml`（S2-B2 B3b）、`attest-attack.yml`（C-1）、`attest-sigtest.yml`（C-2）。兩個簽章 job 使用 Environment `s2-attest`（C-3）。見 `CLAUDE.md`。
- 部署／發行：**無**（未導入 Pages／Release workflow）。
- 後端：**暫定 Firebase**（ADR-001，2026-11-24），是目前主要的實作與驗證方向，**尚未**通過任何驗收。**PostgreSQL 對照驗證暫緩**，不作為前置條件。Stage 1 的 72 筆計畫（36 Firebase＋36 PostgreSQL）仍全部是歷史的 `NOT_RUN`。

## 2. Stage 1 模組

詳見 `poc/stage1/README.md` 與 `poc/stage1/docs/Stage1-架構與驗收門檻.md`。

- `contracts/`：36 項原始文字契約（鎖定）、提案式機器預期 `canonical-oracles-v1.0.json`（待審查語意）、證據 schema、執行順序。
- `fixtures/`：虛構固定測資（鎖定）。
- `src/`：後端中立的 oracle／runner／evidence；mock 不可轉成後端證據。
- `test/`：mock adapter 與執行器自我測試（含負向控制）。
- `scripts/`：Stage 0／Stage 1 靜態驗證、環境檢查、72 筆 NOT_RUN 計畫產生。

## 3. 約束

- 不建立 Firebase／Supabase 雲端專案，不啟動真實 Adapter，不使用真實學生資料。
- `poc/stage1/**` 以 `.gitattributes` 停用行尾轉換，維持 SHA-256 鎖定。
- Stage 2（Firebase）**進行中**：受控讀取 API、Observer、Verifier、可信執行與證據鏈（S2-B2 第 1～3 批）。接上的案例只有 POC-001／002／008／009，結果最多 `UNATTESTED`，POC-009 `BLOCKED`。`PASS_ENABLED=false`。
- Stage 3（PostgreSQL）**暫緩**；Stage 4（真機、離線、備份還原、成本）對 Firebase 保留為必要，尚未開始；正式選型的確認（Stage 5）另立 ADR。
- 目前沒有受控**寫入** API；下一批計畫見 `docs/stage2/S2B2-B4-PLAN.md`。
