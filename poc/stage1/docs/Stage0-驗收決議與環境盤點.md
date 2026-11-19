# Stage 0｜環境盤點與基準驗收紀錄

**2026-11-18｜規格版本 1.0｜驗收類別：規格／靜態資料，不含雲端或裝置實測**

## 1. 本次實際執行的檢查（隔離 Linux 執行環境）

| 編號 | 檢查項目 | 狀態 | 驗收證據 |
|---|---|---|---|
| S0-01 | 來源檔案 SHA-256 | PASS | `contracts/source-lock.json`、`reports/stage0-validation-this-runtime.json` |
| S0-02 | 36 項唯一測試 ID | PASS | POC-001～036 連續、無重複 |
| S0-03 | 優先級分布 | PASS | P0=20，P1=16 |
| S0-04 | 雙後端未執行狀態 | PASS | 全部 `NOT_RUN` |
| S0-05 | 測資可解析與關聯 | PASS | 7 個固定 fixture、CSV/JSON 載入成功 |
| S0-06 | 11/17 點名不變式 | PASS | P9/R1/N1/U4=15；U=07/09/13/15 |
| S0-07 | SC-01 來源分離 | PASS | `LV-007 v5` 上午第1-4節，`AT-20261116-07` 全天 N，`CR-20261116-001` 待核對 |
| S0-08 | v6 草稿與正式示例 | PASS | 草稿保持正式 v5；僅假設提交成功才是 v6 |
| S0-09 | M04 未定分母 | PASS | 不能把21平日／147節視為正式應點名分母 |
| S0-10 | 規格校驗腳本 | PASS | 本次 `node scripts/validate-stage0.mjs` 21/21 靜態檢查通過 |
| S0-11 | 程式基本工具（這個隔離環境） | PASS | Node v22.16.0、npm 10.9.2、Git 2.47.3、Java 21、Python 3.13.5 |
| S0-12 | 雙候選後端 CLI（這個隔離環境） | NOT_READY | Firebase CLI、Supabase CLI、Docker、gh 均未偵測到 |
| S0-13 | 使用者 Windows 電腦工具環境 | NOT_CHECKED | 無法從這個隔離環境讀取使用者電腦的安裝情形 |
| S0-14 | 實際 iPad 離線／重開／切帳 | NOT_RUN | 等 Stage 4 真機測試 |
| S0-15 | GitHub CI／Starter Kit v1.2 合併 | NOT_RUN | 未存取／修改任何使用者 repo |

### 判定

- **Stage 0 的技術中立靜態基準：PASS。**
- **實際可執行兩套後端的 Windows 工作站：UNKNOWN，不能放行 Stage 2／3。**
- **後端驗證結果：0／36 實測；Firebase、PostgreSQL 均未選型。**

## 2. 重要隔離限制

本次只存取對話已提供的全虛構測資，不連接正式班級資料、Firebase／Supabase 帳號，不建立雲端專案，未安裝套件，也未啟動任何模擬器；未寫入使用者電腦或 GitHub。

### 下一個驗收門檻

在使用者自己的 Windows 裝置執行 `npm run stage0:env` 與 `npm run stage0:validate`，確認 Node、npm、Git 與 Java。Firebase CLI、Supabase CLI、Docker／相容執行環境可在決定 Stage 2／3 的具體測試環境後再安裝；不需要為了通過 Stage 0 無條件先安裝所有工具。
