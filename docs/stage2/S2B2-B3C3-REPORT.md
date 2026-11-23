# S2-B2 第 3 批 C-3｜Environment `s2-attest`：實作報告

> 依 `S2B2-B3C3-PLAN.md` v0.2，以及負責人的決定 Q-C、Q1～Q3（2026-11-23）。
> Environment 只是**合作 workflow 的額外保護**，不是安全邊界，也**不是**正式 PASS 或第三方驗證的條件（計畫 §0）。
> 本 PR 不改 Settings、不觸發 hosted、不開啟 PASS，也不合併。**C-3 尚未完成**，完成條件見計畫 §4.1。

## 1. 變更

| 檔案 | 變更 |
|---|---|
| `.github/workflows/attest.yml` | `verify` job（唯一具有簽章權限的 job）加上 `environment: s2-attest`。`execute`、`availability` 沒有加。權限、觸發條件、`if` 與 SHA 固定都不變 |
| `.github/workflows/attest-sigtest.yml` | `sigtest` job 加上 `environment: s2-attest`。blob 由 `d8820ae8…` 變成 `a1b93f9637ba6f9b0c4ef81e835c6408cda561ed` |
| `docs/stage2/S2B2-SIGTEST-POLICY.json` | 依計畫 §5.1 換版，固定 UTC cutoff `2026-11-23T10:30:00Z`：<br>- `SIGTEST-001`（舊 blob）改為 `revoked`，`validTo = cutoff`，`invalidateIssued: false`，屬於正常退役；<br>- `SIGTEST-002`（新 blob）為 `active`，`validFrom = cutoff`，`reviewRef: PR #18 (C-3)`。<br>依 Q3，**負責人的明確合併指示才使它生效**。正式的 `S2B2-TRUST-POLICY.json` 不變，仍然沒有紀錄 |
| `tests/repo_policy.test.mjs` | 斷言 `verify` 與 `sigtest` 引用 `s2-attest`，每個檔案只有一處；`execute`、`availability` 與 `attest-attack.yml` 沒有引用 |
| `poc/stage2/test/c2-unit.test.mjs` | 測試身分政策只有一筆 active 紀錄，而且就是已提交的 blob；舊紀錄的 `validTo` 等於新紀錄的 `validFrom`；換版後，run 45121359992 的簽章仍被接受；舊 blob 在 cutoff 時、新 blob 在 cutoff 前 1 秒，都被拒絕 |
| 文件 | 計畫 v0.2（審查的六項補充）、本報告、HANDOFF（C-2 歷史阻塞標為已結案）、REVIEW_LOG、`CLAUDE.md`、攻擊計畫 §4.2 的註記 |

**不改**：
- `attest-attack.yml`：沒有簽章權限；
- 判定程式、第三方驗證、`PASS_ENABLED`。

## 2. 送審重點

- **cutoff 的時間**：`2026-11-23T10:30:00Z`，晚於這個 commit 的撰寫時間（約 10:22Z），也晚於 C-2 的簽章（06:01:22Z），而且一定早於合併。
  - 如果審查後還要再改受保護檔案，就重新計算錨定並重新送審，cutoff 可以保持不變（計畫 §5.1）。
- **Settings**：負責人已建立 `s2-attest`。2026-11-23 18:35 的 API 回應截圖證明了伺服器端狀態：`can_admins_bypass=false`，只有 `branch_policy`，branch policy 只有一筆 `main`。加上 18:19 的空清單截圖，secrets／variables 都是空的。「是否已儲存」的疑點已經關閉。這不是實際觀察到 Environment 擋下執行。
- **OIDC `sub` 的格式會改變**，完整格式不保證固定：可能包含 immutable ID，或被自訂。預期不影響 C-2 的驗證，因為驗證不使用 `sub`；要以 Q3 的真實簽章確認。紀錄中不輸出原始 token。

## 3. 測試與錨定

見 REVIEW_LOG 的 C-3 紀錄。真實的 hosted 證據（計畫 §4.1 的第 4 和第 5 項）要在合併後才能取得。
