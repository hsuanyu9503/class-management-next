# Classroom Manager Next｜技術驗證 PoC

> **這是獨立技術驗證專案，不是正式班級管理網站。** 技術選型未決定；資料全虛構；無雲端專案、無資料庫、無後端 Adapter。

## 目錄

| 路徑 | 內容 |
|---|---|
| `poc/stage1/` | `CMN-PoC-Stage1-v1.0` 套件**原檔**（位元組完全不變，見 `stage1-file-manifest.json` 與 `contracts/source-lock.json`） |
| `CLAUDE.md`、`docs/`、`templates/`、`.github/` | 自 AI Web Development Starter Kit V1.2 導入的 PR／審查／交接流程層 |
| `scripts/check.mjs` | 結構與機密檔名檢查（依本 PoC 調整，見檔頭說明） |
| `scripts/export_review_packet.py` | Starter Kit V1.2 原檔：匯出固定 Head SHA 的差異審查包 |

## 驗證

```bash
npm run check
npm test
npm run stage1:all
```

Windows PowerShell 請改用 `npm.cmd run stage1:all`。不需要 `npm install`（只用 Node 22 標準函式庫）。

預期：Stage 0 21／21、Stage 1 契約 14／14、Stage 1 防護 3／3、自我測試 33／33（原 20 項＋審查修正 13 項）、Firebase／PostgreSQL 72 筆 `NOT_RUN`。

審查修正（REV-001～004）說明：`poc/stage1/docs/Stage1-R1-審查修正說明.md`。
mock 的 `HARNESS_PASS` 只測試執行器本身，**不是**任何後端 PASS。

## 未從 Starter Kit 導入的部分

依 `docs/ADOPT_EXISTING.md`「只導入適合現有技術棧的部分」：

- `site/`、`scripts/build.mjs`：本 PoC 沒有網站。
- `.github/workflows/pages.yml`、`release.yml`、`scripts/package_release.py`、`scripts/verify_release.py`：PoC 不做自動部署或發行。
- `database/`：PoC Stage 1 沒有資料庫。
- `QUICKSTART.md`、`tests/smoke.test.mjs`、`tests/automation.test.mjs`：對象是上述未導入的範本網站與部署流程。

`docs/` 中的範本流程文件保留原文；其中提到網站、Pages、Release 的段落不適用於本 PoC。
