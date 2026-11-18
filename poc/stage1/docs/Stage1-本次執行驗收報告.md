# Classroom Manager Next｜PoC Stage1 執行器／共同契約驗收報告 v1.0

## 驗證範圍

本次在**模型隔離執行環境**中，使用 Node.js 執行 Stage0 基準檢查、Stage1 契約驗證、測試執行器自測與計畫輸出。**不代表使用者 Windows 裝置已執行 Stage1，亦不代表 Firebase 或 PostgreSQL 已實測。**

| 驗證 | 執行結果 | 解釋 |
|---|---|---|
| Stage0 鎖定資料與固定測資 | **21/21 PASS** | 原始測試 CSV／虛構測資 SHA-256 相符 |
| Stage1 規範完整性 | **14/14 PASS** | 36案例具機器預期、來源原文、必要證據鍵、有效測資及優先順序 |
| 執行器測試 | **20/20 PASS** | mock 6個正向案例，故意錯誤與缺證據負向控制，未使用真後端 |
| 後端執行計畫 | **72/72 NOT_RUN** | 36案例 × Firebase/PostgreSQL各36案例 |
| Firebase 技術驗證 | **0/36 實測** | 未安裝／未連線／未部署 |
| PostgreSQL 技術驗證 | **0/36 實測** | 未安裝／未連線／未部署 |
| 技術選型 | **UNDECIDED** | 不因工具自測成功宣告選型 |

## 改動與來源

- 原有 Stage0 source-lock 指向的 36案例 CSV 與固定測資 JSON **沒有被修改**。
- 原有 Windows `check-env.mjs` 改成只對 Windows 的 npm 偵測使用 `cmd.exe /d /c npm.cmd --version`，其餘工具探測未改；這項兼容修正與使用者本機先前已驗證成功的方案一致。
- 新增 `canonical-oracles-v1.0.json` 的 36 個機器預期映射，**其語意仍需 Claude L1 審查**，不能把程式式映射視為取代 A～H 正式規格。
- 新增 runner 和來源資料獨立比對；Mock 測試結果僅 `HARNESS_PASS/HARNESS_FAIL`，不會改寫原本 CSV 的 `NOT_RUN`。

## 尚未放行

- Starter Kit v1.2 的 CI 與獨立 PR 審查尚未執行。
- 36項後端 PoC、真實權限判定、交易／冪等、網路重試、iPad 離線復原、備份還原仍未實測。
- 高權限服務、資料留存／授權政策及 Firebase／PostgreSQL 正式選型均未確定。

## 下一步

1. 使用者在 Windows 解壓本包，執行 `npm.cmd run stage1:all`，核對實際環境結果。
2. 以 `docs/Claude-Stage1-L1-審查提示詞.md` 提交**獨立 PoC 專案**文件／測試器 PR，保留審查證據。
3. 待 Stage1 契約驗收通過後，開始 Stage2 Firebase Adapter；Stage3 PostgreSQL 使用同一契約與固定測資。
