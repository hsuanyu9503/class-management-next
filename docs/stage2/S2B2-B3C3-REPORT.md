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

## 4. 合併後的 hosted 證據與驗收（2026-11-23 執行，2026-11-24 審查）：**C-3 本階段驗收完成**

- 合併版本 `824dcbf17dc1e119a014802812e223c4663104f3`。相對已審的 `cc0c503`，只改了 HANDOFF、REVIEW_LOG 與 C-3 的計畫和報告，受保護的程式與政策相同。
- 錨定 `caee16535e4b76d301e7f911cdb8fbd1c1dd2874636310710d3acf3532e56b13`（92 檔）：已核准，執行紀錄中的預期值與實際值相同。
- Settings（計畫 §4.1 第 1 項）：負責人的 API 回應截圖加上空清單截圖。`s2-attest` 只允許 `main`，`can_admins_bypass=false`，沒有 reviewer 或 wait timer，secrets 與 variables 都是空的。

| 證據 | 結果 |
|---|---|
| `attest.yml` run [45158736877](https://github.com/hsuanyu9503/class-management-next/actions/runs/45158736877)，push | `verify` job 137638666261 success；deployment **7996534106**，environment=`s2-attest`，狀態 success，`log_url` 連結到這個 job；`S2B2_B3B_VERIFY POC-001 result=UNATTESTED reasons=TRUST_ROOT_NOT_CONFIGURED`；`DELIVERY result=UNATTESTED signing=NOT_ATTEMPTED_NOT_PASS`；簽章步驟 skipped |
| `attest-sigtest.yml` run [45158899144](https://github.com/hsuanyu9503/class-management-next/actions/runs/45158899144)，attempt 1，負責人觸發 | job 137638891104 success；deployment **7996542680**，environment=`s2-attest`，success；attestation [71047255](https://github.com/hsuanyu9503/class-management-next/attestations/71047255)；Rekor `logIndex=4051371751` |
| 第三方 CLI（負責人：`gh` 2.103.3、Node v26.13.1、win32 x64） | `gh` exit 0，CLI exit 0；`SIGTEST_IDENTITY_ACCEPTED`，reasons=[]，stalePolicy=false；subject `63515e7c…`；`gh-stdout.json` SHA-256 `a873a8bf…`，與 `result.json` 一致；stderr 為空 |

`gh` 回傳兩份 attestation，這是預期的：同一個 `SIGTEST.txt` 有新舊兩份簽章。判定核對了**兩份**，不是任取一份成功：

| 證據 | 新（C-3） | 舊（C-2） |
|---|---|---|
| signer commit | `824dcbf…` | `b8d3ba4…` |
| run／attempt | 45158899144／1 | 45121359992／1 |
| workflow blob | `a1b93f96…` | `d8820ae8…` |
| 核准紀錄 | `SIGTEST-002` | `SIGTEST-001` |
| Tlog（UTC） | 2026-11-23T10:45:09Z | 2026-11-23T06:01:22Z |

- cutoff `2026-11-23T10:30:00Z`：新簽章在新紀錄生效**之後**，舊簽章在舊紀錄退役**之前**。`SIGTEST-001` 是 `revoked`、`invalidateIssued=false`，不會使歷史上有效的簽章失效。
- 審查者的政策重播：
  - 使用已審的核心、實際受保護的政策位元組（SHA-256 `36797ef1…`）、原始的 `gh` JSON、原判定時間與重新計算的錨定，結果相同（接受、reasons 為空、`SIGTEST-002`／`SIGTEST-001`）；
  - 沒有執行候選程式或 targets。
- 證據來源的區分：
  - 密碼學驗證成功：負責人機器上的真實 `gh`；
  - 審查者獨立完成：紀錄一致性、政策重播、GitHub hosted 與 deployment 狀態；
  - `result.json` 是未簽章的紀錄。
- Environment 在憑證中的呈現：
  - `gh` 交付的 `verificationResult.signature.certificate` 中**沒有** deployment environment 欄位，只有 `runnerEnvironment=github-hosted`，兩者不能混為一談；
  - Claude 先前從 job log 的 PEM 讀到 Fulcio 擴充欄位 1.23=`s2-attest`、1.24 為含 immutable ID 的 `sub`。這只是讀取，不是驗證；
  - **補充（PR #19 審查）**：審查者解析了交付的 `gh-stdout.json` 中，第一份 attestation 的 `bundle.verificationMaterial.certificate.rawBytes`，讀到的 X.509 擴充欄位是 1.23=`s2-attest`、1.24=`repo:hsuanyu9503@328976242/class-management-next@1463026260:environment:s2-attest`，與 Claude 從 log 讀到的一致。`gh` 的 `verificationResult.signature.certificate` 摘要沒有展開這兩欄，不代表原始憑證沒有它們。這仍然**不是**審查者重新驗證憑證鏈或簽章；密碼學驗證的來源區分不變，也不新增接受門檻；
  - `s2-attest` 的使用，由 GitHub 的 deployment 狀態證實；
  - 不新增接受門檻。
- 保留的限制：負向的阻擋（非 `main` 被 Environment 擋下）**沒有實測**（計畫 §4）。
- **結論：C-3 本階段驗收完成**。這不是正式 PASS 的驗收，也不授權開啟 PASS。之後不再重跑 C-2 或 C-3 的 sigtest。

