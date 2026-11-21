# S2-B2 第 3 批 B3a｜本機沙箱、Verifier 與攻擊測試（實作紀錄）

> **狀態：本機原型，不受信任。結果上限 `UNATTESTED`，不可能產生 `PASS`。**
>
> - Verifier 的 `PASS_ENABLED = false`；
> - 沒有簽章、信任根（D-17）、GitHub runner、workflow、repository variable 或 OIDC。
>
> 依據：負責人批准 `S2B2-B3-DECISION-SUMMARY.md` A 節範圍與 Q-4，並同意合併 PR #6（merge `636e13088a39c3bd956461e6f8fbab75949c58c1`）。
> 設計：`S2B2-B3-PLAN.md` v0.3；nonce 時序已依 Q-4 修訂 `S2B2-ATTESTATION.md` v0.3。

## 1. 做了什麼

| 範圍（決策摘要 A 節） | 實作 | 位置 |
|---|---|---|
| R1-N5 | 操作名稱以自有鍵查找。授權與 API 稽核的 `action` 都採同一規則；API 只在請求形狀合法時記錄 `action`，與 trace 一致 | `src/authz.mjs`、`src/api/server.mjs` |
| R1-N6 | 非 Bearer 的 `Authorization` 只記 `{masked, scheme: other}`，不記雜湊 | `src/mask.mjs` |
| R1-N7 | harness 記錄每一個發出的 token／refresh token／密碼（只在記憶體）；第 2 批與 B3a 的遮罩掃描都用全部 | `src/harness.mjs`、`test/case-run.mjs`、`test/b3-run.mjs` |
| 隔離政策 | `s2-isolation-policy-v1`：邏輯設定與 canonical digest；init script 由設定產生；22 個檢查 ID；端點清單含 sentinel | `src/b3/isolation-policy.mjs` |
| 沙箱 | 在新的 ipc／mnt／net／pid／uts 命名空間中，以 tmpfs 為 rootfs 並 `pivot_root`，只含掛載允許清單。之後的條件：<br>• uid／gid 65534；<br>• `setpriv` 清除全部 capability，設定 `no_new_privs`；<br>• `env -i`；<br>• 只繼承 fd 0–3；<br>• 唯一入口是 Unix socket | `src/b3/sandbox.mjs` |
| 控制管道 | fd 3，只允許 READY／GO／DONE；其他內容記為違規 | `src/b3/sandbox.mjs`、`adapter-b3/client.mjs` |
| 自我檢查 | 在與 Adapter 相同設定的沙箱實例中執行；host 側同時做正向控制 | `sandbox-check/selfcheck.mjs`、`src/b3/selfcheck-host.mjs` |
| 終止 → 匯出 | 結束 PID 命名空間的 init，確認同一命名空間沒有殘留程序；關閉入口與 API 後才匯出 `state-post` | `src/b3/sandbox.mjs`、`test/b3-run.mjs` |
| nonce（Q-4） | T0 產生 → T1 載入 → 自我檢查 → T2 啟動並等 `READY` → T3 寫 `_attestationRuns/{runId}` → T4 匯出 `state-pre`、送 `GO` → T5 等 `DONE` | `test/b3-run.mjs` |
| 封存 | 可重現的 ustar 封裝；manifest 只列 payload；`packageSha256`／`manifestSha256` 以 Runner 記憶體當作「job outputs」交給 Verifier | `src/b3/package.mjs` |
| 安全解析 | 路徑、檔案類型、重複、大小寫碰撞、數量與大小、manifest 一致性；嚴格 JSON（重複鍵、深度、數字） | `src/b3/package.mjs` |
| 對帳 | front／back／audit 一對一；audit 欄位逐項吻合；流量階段；標記；其他任何變更 | `src/b3/reconcile.mjs` |
| Verifier | 純函式，輸入是封裝位元組＋可信輸入。依序：<br>• 內容綁定 → 安全解析 → 執行綁定 → 隔離政策 → 對帳；<br>• 以本工具鏈的 Observer 與 Stage 1 比對器判定；<br>• 產生符合 schema 草案的 statement | `src/b3/verifier.mjs` |
| Adapter | 自足的 core（不 import 工具鏈），供第 2 批 in-process Adapter 與沙箱 entry 共用；7 個攻擊者 Adapter（只供測試） | `adapter-b3/` |

## 2. 執行結果

本機（Linux、root、真實 Auth／Firestore Emulator）。乾淨 checkout 的最終結果附在審查請求。

### 2.1 誠實 Adapter（正向控制）

| 案例 | 結果 | 原因 | 契約比對 | 稽核對帳 | Stage 1 runner |
|---|---|---|---|---|---|
| POC-001 | `UNATTESTED` | `LOCAL_UNTRUSTED_RUNNER`, `TRUST_ROOT_NOT_CONFIGURED` | `MATCH` | 1／1 | `PENDING_ATTESTATION` |
| POC-002 | `UNATTESTED` | `LOCAL_UNTRUSTED_RUNNER`, `TRUST_ROOT_NOT_CONFIGURED` | `MATCH` | 3／3 | `PENDING_ATTESTATION` |
| POC-008 | `UNATTESTED` | `LOCAL_UNTRUSTED_RUNNER`, `TRUST_ROOT_NOT_CONFIGURED` | `MATCH` | 2／2 | `PENDING_ATTESTATION` |
| POC-009 | `BLOCKED` | `BLOCKED_FIELDS_G1_G4` | `PARTIAL_MATCH_REST_BLOCKED` | 5／5 | `FAIL` |

POC-001／002／008 的觀察值符合契約，但只能是 `UNATTESTED`（本機、沒有信任根）。POC-009 維持 `BLOCKED`（G-1、G-4）。每次執行的 22 項自我檢查與正向控制全部通過。

### 2.2 攻擊與控制

| # | 情境 | 結果 | 說明 |
|---|---|---|---|
| 1 | HONEST POC-001 | 符合 | UNATTESTED [LOCAL_UNTRUSTED_RUNNER,TRUST_ROOT_NOT_CONFIGURED] contract=MATCH stage1=PENDING_ATTESTATION selfCheck=22/22 |
| 2 | HONEST POC-002 | 符合 | UNATTESTED [LOCAL_UNTRUSTED_RUNNER,TRUST_ROOT_NOT_CONFIGURED] contract=MATCH stage1=PENDING_ATTESTATION selfCheck=22/22 |
| 3 | HONEST POC-008 | 符合 | UNATTESTED [LOCAL_UNTRUSTED_RUNNER,TRUST_ROOT_NOT_CONFIGURED] contract=MATCH stage1=PENDING_ATTESTATION selfCheck=22/22 |
| 4 | HONEST POC-009 | 符合 | BLOCKED [BLOCKED_FIELDS_G1_G4] contract=PARTIAL_MATCH_REST_BLOCKED stage1=FAIL selfCheck=22/22 |
| 5 | A1/A2 bypass + owner write from the sandbox: every attempt fails, result unaffected | 符合 | UNATTESTED [LOCAL_UNTRUSTED_RUNNER,TRUST_ROOT_NOT_CONFIGURED] attempts={"4400":"ENETUNREACH","8080":"ENETUNREACH","9099":"ENETUNREACH","18300":"ENETUNREACH","18302":"ENETUNREACH"} |
| 6 | A1/A2/A15 changed launch parameter (no network namespace) lets the bypass through → BLOCKED | 符合 | BLOCKED [SANDBOX_CONFIG_MISMATCH,ISOLATION_CHECK_FAILED,AUDIT_UNRECONCILED:no front request for TR-4d83f345-c3ec-4ff7-840a-0aa52a21f56d,UNATTRIBUTED_BACKEND_TRAFFIC:2,STATE_CHANGE_ |
| 7 | A3 write evidence / toolchain / output channel from the sandbox: all fail, files unchanged | 符合 | UNATTESTED [LOCAL_UNTRUSTED_RUNNER,TRUST_ROOT_NOT_CONFIGURED] {"/home/user/class-management-next/poc/stage2/evidence/runs/s2b2-b3a/S2B2B3A-20261121T084224Z-61fe1e49/TAMPER":"ENOENT |
| 8 | A5 detached background process is killed with the PID namespace before export | 符合 | UNATTESTED [LOCAL_UNTRUSTED_RUNNER,TRUST_ROOT_NOT_CONFIGURED] remaining=0 |
| 9 | A5 control: if termination is skipped, the leftover process is detected → BLOCKED | 符合 | BLOCKED [ADAPTER_TERMINATION_UNVERIFIED] remaining=2 cleanup={"namespaceTerminated":true,"remainingAdapterProcesses":0,"pidNs":"pid:[4026532267]"} |
| 10 | A7 read the attestation marker before READY (TCP) or via the API: both fail | 符合 | UNATTESTED [LOCAL_UNTRUSTED_RUNNER,TRUST_ROOT_NOT_CONFIGURED] {"kind":"nonce-probe","tcpBeforeReady":"ENETUNREACH","apiStatus":403,"apiCode":"FORBIDDEN"} |
| 11 | A7 control: marker changed during the case (simulated compromise) → BLOCKED | 符合 | BLOCKED [PHASE_VIOLATION:1,NONCE_MISMATCH] |
| 12 | A8/A12 forged evidence references and a lying claim do not change the Observer result | 符合 | UNATTESTED [LOCAL_UNTRUSTED_RUNNER,TRUST_ROOT_NOT_CONFIGURED] observed={"workspaceId":"WS-A17","returnedCount":15,"crossWorkspaceDisclosure":false} |
| 13 | A9 isolation unverifiable → UNATTESTED | 符合 | UNATTESTED [ISOLATION_UNVERIFIABLE] |
| 14 | A11 malformed / oversized / prototype-name / credential-field requests: all 403 and reconciled; the extra session read makes the case ambiguous → BLOCKED, never a false match | 符合 | BLOCKED [OBSERVATION_AMBIGUOUS] statuses=[403,403,403,403] audits=5/5 |
| 15 | A16 positive control: sentinel not started → "unreachable" is not accepted → BLOCKED | 符合 | BLOCKED [ISOLATION_CHECK_FAILED] |
| 16 | A3 transport tamper (one bit) → BLOCKED | 符合 | BLOCKED [PACKAGE_DIGEST_MISMATCH] |
| 17 | A13 whole-package replacement with all internal hashes recomputed and the same nonce → BLOCKED | 符合 | BLOCKED [PACKAGE_DIGEST_MISMATCH] |
| 18 | A6 replay of another run's package (digests even supplied consistently) → BLOCKED (runId / nonce) | 符合 | BLOCKED [RUN_BINDING_MISMATCH:runId,RUN_BINDING_MISMATCH:attestationNonce,NONCE_MISMATCH] |
| 19 | A15 isolation evidence "missing check" (even with consistent digests) → BLOCKED ISOLATION_CHECK_MISSING | 符合 | BLOCKED [ISOLATION_CHECK_MISSING] |
| 20 | A15 isolation evidence "only one check" (even with consistent digests) → BLOCKED ISOLATION_CHECK_MISSING | 符合 | BLOCKED [ISOLATION_CHECK_MISSING] |
| 21 | A15 isolation evidence "unknown check" (even with consistent digests) → BLOCKED ISOLATION_CHECK_UNKNOWN | 符合 | BLOCKED [ISOLATION_CHECK_UNKNOWN] |
| 22 | A15 isolation evidence "duplicate check key" (even with consistent digests) → BLOCKED ARTIFACT_JSON_INVALID | 符合 | BLOCKED [ARTIFACT_JSON_INVALID] |
| 23 | A15 isolation evidence "one check ok=false" (even with consistent digests) → BLOCKED ISOLATION_CHECK_FAILED | 符合 | BLOCKED [ISOLATION_CHECK_FAILED] |
| 24 | A15 isolation evidence "claimed digest of other params" (even with consistent digests) → BLOCKED SANDBOX_CONFIG_MISMATCH | 符合 | BLOCKED [SANDBOX_CONFIG_MISMATCH] |
| 25 | MASKING 90 artifact files scanned with 225 issued secrets | 符合 | 0 leaks |
| 26 | CLEANUP owned emulator cleared | 符合 |  |

A17（不安全封裝）與其他純函式規則在 `test/b3-unit.test.mjs`（8 項）。

## 3. 與設計的差異與新發現（需要審查）

| 項目 | 內容 |
|---|---|
| 觀察不明確 → `BLOCKED` | A11 的超長 `sessionId` 請求形狀合法，因此是第二個 `attendanceSession.read`，Observer 拒絕推測哪一個算數。Verifier 原本把這種情況判成 `FAIL`；現在改為 `BLOCKED`（`OBSERVATION_AMBIGUOUS`），因為無法觀察不等於契約失敗。計畫 §8 A11 原寫「不影響判定」，實際是「不會產生錯誤的符合」 |
| API 稽核 `action` | 原本只要 `op` 是 `OPERATIONS` 的鍵（含原型鏈）就記錄；現在只在請求形狀合法且是自有鍵時記錄，與 trace 一致。這是第 2 批 API 的行為變更，第 2 批回歸全部通過 |
| PID 命名空間 | Adapter 的 PID 1 結束時，核心會終止整個命名空間，背景程序無法殘留。A5 的對照組因此讓攻擊者在 `DONE` 後保持 PID 1 存活，才能證明「略過終止」會被偵測 |
| schema 草案 | `isolation.selfCheck` 在 `platformSupported = false` 時允許 null；`platformSupported = true` 時仍必須是完整的封閉物件 |
| Unix socket 路徑 | 長度上限約 107 位元組，入口與 sentinel 目錄放在短路徑 `/tmp/cmn-e-*`、`/tmp/cmn-r-*` |
| `/etc` | 以唯讀方式掛入沙箱（Node 與 sudo 檢查需要），host 的 `/etc` 內容對 Adapter 可見；本執行環境沒有真實秘密，B3b 前需評估改用最小 `/etc` |
| entry probe | front 代理的 `GET /__entry_probe` 在本地回 204、不轉送、不記錄，讓自我檢查不產生 API 流量與稽核 |
| statement 欄位 | `signingPolicyBlob` 是全 0 佔位；`package.artifactId` 是 `0`。本機沒有簽章政策與 artifact |

## 4. 證據界線與 NOT_RUN

- 全部是 Claude 本機證據；CI 不執行 B3a。
- **NOT_RUN**：
  - GitHub-hosted runner 上的沙箱；
  - A4、A10、A14、A18（需要 workflow）；
  - 簽章與第三方驗證；
  - 非 Linux 或非 root 環境（`s2:b3` 會回報 NOT_RUN，exit 3）；
  - Windows。
- 沙箱以 root 建立；Adapter 本身以 uid 65534 執行。這不是「非 root Runner」的驗證。
- POC-009 維持 `BLOCKED`；72 筆維持 `NOT_RUN`；沒有 PASS。
