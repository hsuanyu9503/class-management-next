# TECH｜系統架構與技術決策

> 版本：PoC Stage 1　｜　維護者：Claude（重要技術選型需經核准）

## 1. 目前技術基底

- 性質：Classroom Manager Next **獨立技術驗證 PoC**，非正式網站。
- 執行環境：Node.js 22+，僅標準函式庫；無相依套件。
- 自動檢查：`scripts/check.mjs`、`tests/*.test.mjs`、`poc/stage1` 的 `stage1:all`。
- CI：`.github/workflows/ci.yml` 的 `validate`（`contents: read`，不使用 secrets）。
- 部署／發行：**無**（未導入 Pages／Release workflow）。
- 後端候選：Firebase、PostgreSQL —— **皆未選定、皆 `NOT_RUN`**。

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
- Stage 2／Stage 3 與正式技術選型**未開始**。
