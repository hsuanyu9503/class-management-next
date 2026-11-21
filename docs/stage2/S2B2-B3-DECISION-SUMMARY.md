# S2-B2 第 3 批｜決策摘要（一頁）

> 依據：`S2B2-B3-PLAN.md` v0.3。這是**提案**，不是已核准的決定。
> 審查狀態：PR #6 R1 複審，B3-REV001～004 **設計結案，實作待驗收**。沒有任何隔離、簽章或 Verifier 已實作或驗收。

## A. 現在可以批准：B3a（只在本機，不碰 GitHub 設定）

| 項目 | B3a 會做 | B3a 不會做 |
|---|---|---|
| 第 2 批遺留 | R1-N5（操作名稱改用自有鍵查找）、R1-N6（非 Bearer 值不再記雜湊）、R1-N7（以本次發出的全部秘密掃描證據） | — |
| 隔離 | `s2-isolation-policy-v1`、沙箱啟動器（命名空間、專用 uid、無 capability、`no_new_privs`、乾淨 rootfs、Unix socket 入口）、22 項自我檢查與正向控制（含 sentinel） | 在 GitHub runner 上執行 |
| 證據 | 終止 → 匯出 → 對帳（front／back／audit 一對一、流量階段）；封存與 manifest；安全解析；statement 產生器；Verifier（純函式） | 簽章；上傳 artifact |
| nonce | 依 Q-4 的一致流程實作，並修訂 `S2B2-ATTESTATION.md` 為 v0.3 | — |
| 測試 | 攻擊測試 A1–A3、A5–A9、A11–A13、A15–A17（本機）；第 2 批回歸 | A4、A10、A14、A18（需要 workflow） |
| 結果上限 | `UNATTESTED`（沒有簽章，不可能 `PASS`） | — |

**需要你回答**：

1. 是否批准 B3a 的本機實作範圍（上表）？
2. **Q-4**：是否同意 nonce 一致流程？流程：T0 產生、T2 啟動但不開入口、T3 寫標記、T4 匯出 `state-pre`、T5 開始操作，含 READY／GO／DONE 與逾時。同意後在 B3a 修訂 ATTESTATION v0.3。

**我的推薦**：兩題都同意。

## B. B3b 前才需要批准（現在不必決定）

| # | 決定 | 推薦 | 你要設定的東西（Claude 不代設） |
|---|---|---|---|
| Q-1（D-17） | 信任根 | GitHub artifact attestation（public repository 可用，審查者核對）；subject 是 `statement.json`；只簽 `PASS` | 無 |
| Q-2 | CI、錨定、批准形式 | 新增 `attest.yml`（只用手動與 `main` 觸發，執行 job 與驗證 job 分開）；`ci.yml` 不變；批准紀錄 `S2B2-TRUST-POLICY.json`；相關檔案列入外部錨定 | 錨定 digest；`CMN_S2_TRUSTED_TOOLCHAIN_SHA`；`CMN_S2_SIGNING_POLICY_BLOB` |
| Q-3 | 公開與保存範圍 | 方向：bundle 必然公開；`statement.json` 上傳並在 `main` 提交摘要；封裝檔只上傳 artifact | 保存天數與可下載範圍（**尚未核對**；B3b 前以具體數值批准，不以平台預設代替 D-07） |

B3b 合併後，在你完成批准步驟（批准紀錄、錨定、兩個變數）之前，結果一律不得 `PASS`。

## C. 不變

- POC-009 維持 `BLOCKED`（G-1、G-4）；其他案例最多 `UNATTESTED`；Stage 1 的 72 筆維持 `NOT_RUN`。
- D-01～D-17、G-1～G-4 沒有因本文件而核准。
- Claude 不設定 repository variable、secret、OIDC 或 workflow，不合併、不部署。
