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

## 5. R1 修正（回應 PR #7 審查 B3A-N1～N4）

依據：審查基準 Head `211e11433bc3e005d3ef68383340e9b27e8183cf`。四項的修正、影響與測試如下。

| ID | 問題 | 修正 | 影響 | 測試（`test/b3-unit.test.mjs`） |
|---|---|---|---|---|
| **B3A-N1** | `selfCheck` 的項目值不是物件時被略過（`if (c && …)`） | 必要 ID 必須是 own key（否則 `ISOLATION_CHECK_MISSING`）；值必須是純物件且 `ok === true`（否則 `ISOLATION_CHECK_FAILED`）；`selfCheck` 本身不是純物件 → `ISOLATION_CHECK_MISSING` | 只會讓原本被略過的偽造證據改判 `BLOCKED` | 「B3A-N1 (P1)」：單項 null、false、0、""、[]、true、1、"ok"；22 項全為 null；`selfCheck` 為 null／[]／字串／0 |
| **B3A-N2** | `parseStrictJson` 遇到 `"__proto__"` 會改寫物件原型；`in` 判斷會沿原型鏈 | 解析器拒絕 `"__proto__"`（`ARTIFACT_JSON_INVALID`），並以 `Object.defineProperty` 建立 own 屬性。verifier／reconcile 的 `in` 全部改為 `Object.hasOwn`。`CASE_ACTORS`、`BLOCKED_FIELDS`（含 `verdict.mjs`）改為 own-key 查表 | 合法封裝不受影響 | 「B3A-N2」：解析器直接測試；「(P2)」稽核藏在 `state-pre.__proto__`；「(P3)」非稽核文件藏在原型；「(P4)」檢查項藏在 `selfCheck.__proto__`。每種都有不用原型手法的對照組（本來就 `BLOCKED`） |
| **B3A-N3** | 正向控制只拒絕 `false`，接受 null 或缺欄位 | 新增凍結清單 `POSITIVE_CONTROL_REQUIRED`（12 項）：清單內必須 `=== true`；清單外必須 own 且 `=== null`；否則 `ISOLATION_CHECK_FAILED`。自我檢查未完成時，清單內填 `false`。schema 草案改為逐 ID 指定（必要項 boolean、其他 null） | 不屬於沙箱設定 → `configDigest` **不變**（`5151d6d4…`） | 「B3A-N3 (P5)」：必要項 null／刪除／字串 `"true"`；全部刪除；清單外 true／刪除；誠實封裝逐項符合清單 |
| **B3A-N4** | `platformSupported` 取自封裝 | 改為必填的可信輸入（Runner 記憶體，比照 job outputs）；與封裝不一致 → `ISOLATION_PLATFORM_MISMATCH`。「無法查證」分支也檢查設定 digest（含 `run.adapterSandboxPolicyDigest`）、控制管道、`READY`、終止 | A9 的可信輸入同步設為 false，結果維持 `UNATTESTED ISOLATION_UNVERIFIABLE` | 「B3A-N4」：封裝 false／可信 true → `BLOCKED`；兩邊 false 且正常 → `UNATTESTED`；兩邊 false 但 digest 錯、有違規、未 READY、終止未成立 → 各自 `BLOCKED`；缺少可信輸入 → `TRUSTED_INPUT_MISSING` |

其他：

- 單元測試使用已提交的誠實 POC-001 封裝（`test/fixtures/b3a-honest-poc001/`，虛構且遮罩）。探針以 `writePackage()` 重新打包，並一致地提供新 digest，所以只測 Verifier 的政策與對帳層，不需要 root 或 Emulator。
- 「B3A-N5 (P6)」tar 結尾後附加內容：依指示標為 `todo`，本輪未修。
- 審查者提供的 `S2B2-B3A-reviewer-probes.mjs` 沒有傳到 Claude 的環境；上表的探針依審查說明的 P1～P6 自行撰寫，需請審查者對照原探針確認涵蓋範圍。
- `s2:b3` 26 項在修正後全部維持原判定（逐項比對見審查請求）。


## 6. 後續修正 F1（B3A-R1-N1、NOTE-a、NOTE-b）

依據：PR #7 合併 `15a7c51fe6341d79afdafc5aefb22501fe081377`（R1 增量複驗結論「可合併；N1～N4 已關閉」）。

**Verifier 版本**（NOTE-b）：

| 版本 | 對應程式 |
|---|---|
| `s2-verifier-b3a-0` | `211e11433bc3e005d3ef68383340e9b27e8183cf`（B3a 首版） |
| `s2-verifier-b3a-1` | R1（`9a9450b`）加上本次 F1 修正 |

版本號只出現在 Verifier 的輸出（`verify.json`）；statement schema 草案沒有 `verifierVersion` 欄位，所以 schema 不需更新。

| ID | 問題 | 修正 | 影響 | 測試（`test/b3-unit.test.mjs`） |
|---|---|---|---|---|
| **B3A-R1-N1** | 最外層 JSON 不是物件時 Verifier 拋出例外；`isPlainObj(iso)` 在讀取 `iso.sandboxPolicyDigest` 之後才檢查 | 解析後、讀取任何欄位前檢查型別：`run`、`isolation`、`state-pre`、`state-post` 必須是純物件；`adapter-claim` 必須是純物件或 null（設計上允許：Adapter 沒有回傳輸出）；三個 JSONL 的每一行必須是純物件。不符 → `ARTIFACT_JSON_INVALID:<檔名>`（isolation → `ISOLATION_EVIDENCE_INVALID`）。`out.isolation` 改在檢查後賦值。`verifyPackage` 以 try/catch 包住，非預期錯誤 → `VERIFIER_INTERNAL_ERROR:<錯誤類別>`，只寫固定清單內的類別名稱，不寫訊息。`trusted` 不是物件 → `TRUSTED_INPUT_MISSING`（NOTE ⑨） | 只讓原本會拋出例外的輸入改為回傳 `BLOCKED`；合法封裝不受影響 | 「B3A-R1-N1: non-object top-level JSON…」：isolation 為 null／[]／"x"／0；run 為 null／[]；state-pre 為 null；state-post 為 []；trace-front 第一行 null；runner-log 某行 [1]；trace-back 某行 "x"；adapter-claim 為 []；adapter-claim 為 null 不算型別錯誤。「…trusted input null…」：null、undefined、[]、"x"、0。「…VERIFIER_INTERNAL_ERROR…」：位元組不是 Buffer；post 內稽核紀錄為 null |
| **NOTE-a** | 原型鏈的縱深防禦缺少直接測試 | 直接呼叫 `reconcile()`，`pre`／`post` 用 `Object.create(...)` 帶原型 | 只增加測試 | 「NOTE-a: reconcile never treats keys on the prototype chain…」：原型上的稽核紀錄不算已存在；只存在於 post 原型上的舊稽核紀錄算刪除；只存在於原型鏈的被稽核文件 → `resourceRef` 不符；對照組為 own key |

- 範圍：`PASS_ENABLED`、`passPossible` 仍為 false；沙箱設定與 `configDigest` 不變。
- 審查者探針 `S2B2-B3A-R1-reviewer-probes.mjs`（X1～X10）沒有傳到 Claude 的環境，**未執行**。
- B3A-N5～N8 與 NOTE-c 保留到 B3b 前。

## 7. B3b 前修正 PR-1（B3A-N5～N8）

依據：PR #8 合併 `322f65b0373c1fda0f040cc0d249c930da0a6a7e`。負責人決定：B3b 分兩個 PR，PR-1 先處理 B3A-N5～N8（只在本機，不碰 workflow）；Q-3 保存天數 30 天（見 REVIEW_LOG）。Verifier 版本 `s2-verifier-b3a-2`。

| ID | 問題 | 修正 | 影響 | 測試 |
|---|---|---|---|---|
| **B3A-N5** | 安全讀取器接受 tar 結束標記後的附加內容，以及其他非標準的序列化 | `readPackageSafe` 最後以 `writePackage()` 重新序列化 payload，manifest 與整包位元組都必須完全相同，否則 `ARTIFACT_NONCANONICAL`。涵蓋結尾附加內容、缺少的結束標記、非 0 的 mtime、權限、uname、payload 順序、manifest 的 JSON 文字 | 封裝格式本來就由 `writePackage()` 產生，合法封裝不受影響 | `B3A-N5 (P6)`（原本的 todo 改為正式測試）；`B3A-N5: every non-canonical serialisation…`；`s2:b3`「N5 bytes appended…」 |
| **B3A-N6** | 稽核紀錄只比對 `resourceRef` 的最後一段；null 欄位、`claimedScope`、稽核文件與 back PATCH 的對應沒有檢查 | reconcile：`resourceRef` 必須是目標查找唯一回傳文件的**完整路徑**（由 pre 狀態以 `OPERATIONS` 的 collection／idField 重算，有歧義則拒絕）；null 欄位順序（allow 必須四欄齊全；`authUid` 為 null 時 principal 與 resource 也必須為 null；principal 為 null 時 resource 必須為 null）；`claimedScope` 與判定一致（allow 必須等於路徑 scope；`SCOPE_CLAIM_MISMATCH` 必須不同；`SCOPE_CLAIM_MISSING` 必須不存在）；每筆新稽核文件必須正好對應同一 trace、同一路徑、狀態 200 的一筆 back PATCH | 誠實案例與攻擊判定不變。A1/A2 降級沙箱多了一個同代碼（`AUDIT_UNRECONCILED`）的細節 | `B3A-N6: audit fields are bound to the request…`（13 種違規＋3 個合法的 deny 對照組） |
| **B3A-N7** | 沙箱掛入 host 的整個 `/usr` 與 `/etc`、整個 node 安裝目錄；只檢查掛載目標，不檢查掛載選項；pathMap 不在任何 digest 中 | `/usr` 改為唯讀 tmpfs，只複製 `USR_BINARIES`（env、rmdir、setpriv、umount）以及這些程式與 node 的 `ldd` 函式庫；**不掛 `/etc`**；`/opt/node` 只綁定 node 執行檔。自我檢查 `MOUNT_ALLOWLIST` 加查每個掛載的模式與 flags、根目錄清單、`/usr` 的檔案集合。FS 隱藏檢查加入更多 host 路徑：整個 runs 目錄、`test`、`scripts`、`node_modules`、`poc/stage1`、node 安裝的 `lib`、`/etc`、`.github`。`pathMap`（含每個複製檔與 node 執行檔的 SHA-256）與 `pathMapDigest` 寫入 `isolation.json` 與 statement；Verifier 檢查一致性與內容規則（`PATH_MAP_INVALID`） | **configDigest 改變**：`5151d6d4…` → `18d9e21f0fbdbc3a48aff834b6b6e21fdb536e339cb0b453cb3297baca9bb7db`（沙箱設定本身改變，這是預期的）。`pathMapDigest` 取決於 host，不納入 configDigest。statement schema 草案新增必填的 `isolation.pathMapDigest`（平台不支援時可為 null）。沙箱內沒有 sudo，`NO_SUDO` 觀察值為 `ENOENT`，正向控制（host 可提權）仍成立 | `B3A-N7: rootfs has no host /usr or /etc tree…`；`B3A-N7: pathMapDigest covers…`（7 種錯誤的 path map）；`s2:b3` 兩個 A15 path map 變體 |
| **B3A-N8** | `case.json` 含有所有 actor 的 token | 只放這個案例 actor 的 token（取自可信的 `CASE_ACTORS` 表）；找不到時停止 | Adapter 本來就只用這個 actor | `s2:b3`「N8 case.json holds only the case actor's token」 |

- 單元測試的誠實 fixture 已從 PR-1 工作樹的執行重新產生（見 fixture README），因為沙箱設定與 path map 改變。
- `s2:b3` 由 26 項增為 30 項：N8、兩個 N7 變體、N5。原 26 項的判定（結果＋reason code）不變。
- §3 中「`/etc` 以唯讀方式掛入沙箱」一項由 N7 取代。
- 範圍：`PASS_ENABLED`、`passPossible` 仍為 false；Stage 1、錨定、CI、workflow 未變更。
- NOTE-c 的具體內容沒有傳到 Claude 的環境，所以本 PR 沒有處理 NOTE-c；NOTE ①～⑦ 的原文也沒有傳到 Claude 的環境，本 PR 只依 REVIEW_LOG 的 N5～N8 描述處理。
