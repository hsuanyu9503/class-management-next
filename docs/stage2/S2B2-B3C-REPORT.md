# S2-B2 第 3 批 C-1｜hosted 攻擊驗收的實作（A10、A14、A4；無簽章）

> 依據：`S2B2-B3C-ATTACK-PLAN.md` v0.4（PR #12 合併為 `0771790`；文件審查通過，設計結案、實作待驗收）。
> 負責人 2026-11-22 決定：
> - Q-A：是；
> - Q-B：流程 I；
> - Q-C：是；
> - Q-D：C-1 → C-2 → C-3。
>
> **本 PR 不能產生 PASS，也不能簽章**：
> - 沒有設定任何 repository variable、secret、OIDC、Environment 或 Settings；
> - `PASS_ENABLED=false` 不變；
> - 新的 workflow 沒有 `id-token` 與 `attestations` 權限。
>
> 本 PR 內的所有結果都來自**本機**（不受信任的 runner）。hosted 驗收要等合併之後，由負責人手動觸發。
>
> **R1**（2026-11-22）：依 PR #13 審查（Reviewed Head `9e4db47`，CHANGES REQUESTED）修正 C1-REV001～005，見 §7。本文 §2～§5 的數字已更新為 R1 的結果。

## 1. 做了什麼

| 部分 | 內容 | 位置 |
|---|---|---|
| **C-1a scenario**（§1.2） | Verifier `s2-verifier-b3c-0`：<br>- 可信的 `scenario` 是必要輸入。缺少或格式不符時判 `BLOCKED SCENARIO_MISSING`，**不會**預設為 honest；<br>- 封裝 `run.json` 中的 scenario 與可信值不符時判 `SCENARIO_MISMATCH`；<br>- 非 honest 的情境一律加上 `SCENARIO_NOT_HONEST`，結果最多 `UNATTESTED`；<br>- statement 加入 `scenario` 欄位。<br>workflow 端：`attest.yml` 的 execute 固定 `B3_SCENARIO: honest`，verify 固定 `EXP_SCENARIO: honest`；`run-attest-execute.mjs` 必須收到 `B3_SCENARIO`，不設預設值 | `src/b3/verifier.mjs`、`src/b3/attest-verify.mjs`、`.github/workflows/attest.yml`、`scripts/run-attest-execute.mjs`、`test/b3-run.mjs` |
| **C-1a 完整觀察值**（§6.2） | `observation.mjs` 依固定順序處理：<br>1. 以結構化的值收集；<br>2. 以 `makeMasker` 依欄位名稱遮罩，再由新增的 `maskObservation` 依明確傳入的 `secretValues` 遮罩（`[MASKED_SECRET]`）；<br>3. `stableJson` 序列化；<br>4. 以 UTF-8 bytes 計算大小，超過 64 KiB 時在字元邊界截斷；<br>5. 計算雜湊。<br>statement 的摘要取前 200 個 code point。<br>Verifier 以可信的 `CHECK_IDS` 檢查 `selfCheckFull`：缺少或多出 ID、型別錯誤、長度、雜湊或摘要不符 → `ISOLATION_EVIDENCE_INVALID`；截斷 → `ISOLATION_EVIDENCE_INCOMPLETE`；`maskSecretCount` 必須是整數。<br>`selfcheck-host.mjs` 改為回傳原始的結構化觀察值；`b3-run.mjs` 在封存時，以本次 run 完整的已發出 token 清單（`h.issuedSecrets()`，含輪替過的舊值）整理觀察值。清單本身不寫出，只記錄筆數 | `src/b3/observation.mjs`、`src/b3/selfcheck-host.mjs`、`src/b3/verifier.mjs`、`test/b3-run.mjs` |
| **C-1a Java 版本**（§6.1） | 改為讀取 `java -version` 的 stderr；無法辨識時如實記錄 `unknown` | `src/b3/env-info.mjs` |
| **C-1b A10**（§2） | 見 §2 | `sandbox-check/probe-a10.mjs`、`src/b3/a10.mjs`、`adapter-b3/attackers/credential-probe.mjs`、`test/a10-run.mjs`、`scripts/run-a10.mjs`（`npm run s2:a10`） |
| **C-1c A14／A4**（§3、§4.1） | 見 §3 | `src/b3/attack-suite.mjs`、`scripts/attack-verify.mjs`、`adapter-b3/attackers/tamper-toolchain.mjs` |
| **`attest-attack.yml`**（§1.1） | 只有 `workflow_dispatch`，每個 job 都限定在 `main` 上執行。<br>jobs：`a10`、`execute-a14`、`execute-a4`、`same-name`、`verify-attack`。<br>**沒有任何** `id-token`、`attestations` 或簽章 action。action 與 `attest.yml` 使用相同的完整 SHA。<br>scenario 寫死在檔案中：`attack-a14`、`attack-a4-tamper`。<br>`verify-attack` 只有 `contents: read` 與 `actions: read`；`actions: read` 只用於 A14-3b 下載前一個 run 的封裝 | `.github/workflows/attest-attack.yml` |
| 受保護清單 | R1（C1-REV005）：改為涵蓋**完整的可信呼叫鏈**，41 → **83** 檔，見 §7 | `scripts/verify-anchor.mjs`、`tests/anchor_coverage.test.mjs` |
| repo_policy | `attest.yml` 只能是 honest。`attest-attack.yml` 的結構測試涵蓋：<br>- 觸發條件；<br>- 沒有簽章權限；<br>- 逐 job 權限；<br>- action 的 SHA 與 `attest.yml` 相同；<br>- scenario 固定；<br>- 只 checkout 可信工具鏈；<br>- 每一行 `run:`（含區塊）都不內嵌 `${{ }}`；<br>- token 只出現一次；<br>- 同名上傳設定 `overwrite: false` | `tests/repo_policy.test.mjs` |
| schema 草案 | 加入必要欄位 `scenario`；PASS 時 scenario 必須是 `honest` | `docs/stage2/S2B2-B3-attestation-statement.draft.json` |
| fixture | 以 C-1a 的程式重新產生誠實 POC-001 封裝：`scenario: honest`、`selfCheckFull`、`maskSecretCount` | `test/fixtures/b3a-honest-poc001/` |

## 2. A10：可信探測與判定

- **可信探測**（`probe-a10.mjs`）：
  - 唯讀掛在 `/check`，在**只有探測程式**的另一個沙箱實例中執行；
  - 每個目標只回報 `DENIED`／`READ_OK`／`CONNECT_OK`、errno 類別，以及開啟成功時的 dev/ino。讀到的內容在探測程式內丟棄。
- **等價性**：由 Runner 在 host 上核對，不假設。探測程式與攻擊者都先送 `READY`，Runner 從 host 讀取該實例 init 行程的 `/proc/<pid>/status` 與 `mountinfo`，然後才送 `GO`。必須相同的項目：
  - 設定 digest；
  - uid、gid、groups、capability、no_new_privs、seccomp；
  - 掛載表 digest；
  - 兩個實例都已完成；
  - 每個目標在兩個實例前後的 host 身分（dev/ino）沒有改變。
- **正向控制**：在兩個實例的前後各做一次，兩次都成立才算。
- **安全揭露**：
  - 真實的機密與控制檔只做唯讀探測；
  - 輸出掃描的比對字串（canary、真實內容的每一行，以及 host 環境中的 token 值，各 ≥ 16 字元）只在記憶體中；
  - 攻擊者的 stdout、stderr 與 claim 只留在 Runner 的記憶體，掃描後丟棄，不寫入 log 或 artifact；
  - 報告寫出前會再掃描一次，有命中就不寫出。
- **canary 只放在 Runner 自建的資料**：`$RUNNER_TEMP/s2-canary-*`、輔助行程 `/bin/sleep` 的環境變數、canary port `18398`。本機另以 canary 模擬 runner 安裝目錄與 `GITHUB_OUTPUT`（報告標記 `simulated`）；hosted 上用 `/proc/*/exe` 找出真實的 `Runner.Worker` 安裝目錄。
- **判定**（`judgeA10`）：與計畫 §2.1／§2.3 相同。
  - 掃描命中即判 `BREACHED`，不會被 `DENIED` 覆蓋；
  - 正向控制不成立 → `N/A_*`；
  - 等價性不成立、缺少探測結果、目標身分改變、探測到不同的物件 → `INCONCLUSIVE`；
  - 必要目標全部 `DEFENDED`，整體才是 `DEFENDED`；
  - 攻擊者的自報**不是**判定的輸入。

| 情境 | 本機結果（R1：`S2B2A10-20261122T153613Z`，commit `ff92a33` 的程式） |
|---|---|
| A10-main（exfil，政策設定） | `DEFENDED`：必要目標全部 `DEFENDED`，等價性成立；`evidenceScope=LOCAL_WITH_SIMULATED_TARGETS` |
| N-1 沒有嘗試，直接回報 EACCES | `DEFENDED`：結果與 main 相同，自報不影響判定 |
| N-2 受控：兩個實例都可讀取 canary，讀取後丟棄，回報 EACCES | `BREACHED`：`RUNNER_TEMP_CANARY` = `TRUSTED_PROBE_SUCCEEDED` |
| N-3 偽造目標清單 | `DEFENDED`：目標清單只取自可信設定 |
| N-4 偽造 socket 與網路結果 | `DEFENDED` |
| N-5 把 canary 寫入輸出 | `BREACHED`：`TRUSTED_SCAN_HIT` |
| N-6 探測實例的設定不同 | `INCONCLUSIVE`：`EQUIVALENCE_NOT_ESTABLISHED` |
| N-7 探測遺漏 `GIT_CONFIG` | `INCONCLUSIVE`：`PROBE_RESULT_MISSING` |
| N-8 放寬設定（反向控制） | `BREACHED`：`TRUSTED_PROBE_SUCCEEDED` |

本機只是「有限範圍」的證據：
- runner 安裝目錄與 `GITHUB_OUTPUT` 是模擬的；
- 本機沒有 docker 與 containerd socket，所以是 `N/A`；
- `ACTIONS_*` token 不在環境中，所以是 `N/A`；
- port `18300`、`18302`、`18399` 在 A10 中沒有服務，所以是 `N/A`；
- `DENIED` 只代表「這個探測操作在核對過的條件下被阻擋」。

## 3. A14／A4：驗證端的攻擊測試組

`runAttackVerify()` 對每個情境都經由 `runVerifyJob()` 判定，與 `attest.yml` 走同一條程式路徑。結果分三層記錄：`testOutcome`、`platformOutcome`、`verifierOutcome`。

| 情境 | 作法 | 預期 |
|---|---|---|
| 正向控制 | 本次的 A14 封裝與正確 ID | `UNATTESTED`，原因含 `TRUST_ROOT_NOT_CONFIGURED`、`SCENARIO_NOT_HONEST`。不成立時整組判 `INCONCLUSIVE` |
| （R1）平台證據 | 由可信步驟 `attack-platform-evidence.mjs` 以唯讀 token 取得本 run 的 artifact 清單，以及 same-name job 的 `##[error]` 行 | 供 A14-2 與 A14-3a 判定；取不到時，相關情境不能判為 DEFENDED |
| A14-1 | 同一個 run 的誘餌 `decoy-POC-001.tar` | `BLOCKED ARTIFACT_SELECTION_MISMATCH` |
| A14-2 | 另一個 job 先以不同名稱上傳作為控制，再以同名 `package-POC-001.tar` 上傳，`overwrite: false` | 只有下列三項都成立才判 DEFENDED，平台結果為 `UPLOAD_REJECTED_CONFLICT`：<br>- 控制上傳成功；<br>- 平台錯誤行含 409 與 conflict；<br>- 本 run 中該名稱只有一個 artifact，而且就是封存的那一個。<br>其他失敗一律判 `INCONCLUSIVE UPLOAD_FAILED_REASON_UNVERIFIED`，並標記需要人工核對。平台若接受同名上傳 → 記錄 `UPLOAD_ACCEPTED`，並以 A14-1b 驗證 → `PACKAGE_DIGEST_MISMATCH` |
| A14-3a | 在本次 run 下載前一個 run 的 artifact ID | 下載失敗，**而且** API 清單確認該 ID 不在本 run → `DOWNLOAD_NOT_FOUND_IN_RUN`；否則判 `INCONCLUSIVE`。若下載成功，Verifier 必須判 `BLOCKED` |
| A14-3b-i／ii | 以 `actions: read` 取得前一個 run 的封裝位元組 | (i) 外層 digest 不變 → `PACKAGE_DIGEST_MISMATCH`；(ii) 外層 digest 改成舊封裝的值 → `RUN_BINDING_MISMATCH`。沒有提供，或已過期 → `NOT_RUN` |
| A4-1 | `tamper-toolchain` 攻擊者寫入 `/check`、`/adapter`，並在 claim 中偽造 Verifier 版本、`verdict: PASS`，以及每一個 canonical 欄位（POC-002） | 寫入失敗（唯讀）。可信證據是 Runner 在 host 端計算的 `adapter-b3`／`sandbox-check`／`src` 樹 digest 前後一致（`trustedTreesUnchanged`）；Verifier 判 `UNATTESTED`，`adapterClaimAgreesWithObserver=false` |
| A4-2-i／ii | 在封裝中注入 `verifier.mjs` | (i) `PACKAGE_DIGEST_MISMATCH`；(ii) `PAYLOAD_SET_MISMATCH`。注入的檔案從未被執行 |
| A4-3 | 驗證 job 的 checkout | `HEAD` 等於兩個 execute job 的工具鏈 commit；結構由 repo_policy 檢查 |

**本機模擬**（R1，commit `ff92a33`）：以本機的 `run-attest-execute.mjs` 產生 A14（POC-001）與 A4-1（POC-002）的封裝，再以三種合成的平台證據執行 `attack-verify.mjs`：

| 平台證據（**合成**） | A14-2 | A14-3a | 整體 | exit |
|---|---|---|---|---|
| 409 conflict 加上清單 | `DEFENDED`（`UPLOAD_REJECTED_CONFLICT`） | `DEFENDED`（`DOWNLOAD_NOT_FOUND_IN_RUN`） | `DEFENDED_WHERE_RUN` | 0 |
| 網路錯誤 | `INCONCLUSIVE` | `DEFENDED` | `INCONCLUSIVE` | 1 |
| 沒有證據 | `INCONCLUSIVE` | `INCONCLUSIVE` | `INCONCLUSIVE` | 1 |

- 其他情境（A14-1、3b-i、3b-ii，A4-1、2-i、2-ii、3）全部 `DEFENDED`。
- **平台證據是合成的**：409 錯誤訊息的實際文字未經 hosted 確認，若實際文字不含 409 與 conflict，A14-2 會判 `INCONCLUSIVE`，需要人工核對。A14-3b 的「前一個封裝」是 fixture。這些只驗證了驗證端的邏輯，**沒有**驗證平台的實際行為。

## 4. 測試

| 項目 | 結果 | 執行者 |
|---|---|---|
| `npm test`（repo_policy、anchor、anchor_coverage 等） | 19/19 通過（R1） | Claude 本機 |
| `npm run check` | 通過 | Claude 本機 |
| `npm run stage1:all`，以及 `git diff --exit-code -- poc/stage1` | 通過；Stage 1 沒有變更 | Claude 本機 |
| `npm run s2:test`（含 `c1-unit` 12 項、`a10-unit` 12 項、`attack-suite-unit` 9 項） | 138/138 通過（R1） | Claude 本機 |
| `npm run s2:b3`（真實 Emulator、沙箱、root） | 33/33 通過（R1：新增 C1-REV004 的呼叫端檢查）。遮罩掃描 96 個檔案，以同一份清單（196 筆，含 6 筆平台憑證）掃描，0 命中。run `S2B2B3A-20261122T153459Z-5539fcb3` | Claude 本機 |
| `npm run s2:a10` | 9/9 符合預期（R1） | Claude 本機 |
| A10 hosted 模式的示範（本機設定 `GITHUB_ACTIONS=true`、`RUNNER_ENVIRONMENT=github-hosted`） | A10-main → `INCONCLUSIVE`：`GITHUB_OUTPUT` 與 `RUNNER_INSTALL_DIR` 不是 DEFENDED，exit 1。證明 hosted 模式不會改用替代資料 | Claude 本機 |
| attest-attack 的本機模擬 | 見 §3 | Claude 本機 |
| mutation | R1：31/31 被測試抓到（原有 17 項，加上 R1 的 14 項），見下方說明與 `S2B2-C1-R1-mutations.txt` | Claude 本機 |
| CI | 見 PR checks | GitHub |
| hosted 的 `attest-attack.yml` | **NOT_RUN**：合併後由負責人觸發 | — |

**mutation 涵蓋的項目**：
- scenario：比對、預設值、上限；
- 完整觀察值：截斷、多出 ID、遮罩、摘要的單位；
- Java 讀取 stderr；
- A10：掃描命中被覆蓋、假設等價性、缺少探測結果、忽略正向控制；
- 測試組：正向控制、A4-1 樹 digest；
- workflow：`id-token`、非 honest 的 `attest.yml`、`run:` 內嵌輸入；
- R1：
  - 單純失敗就判 DEFENDED（A14-2、3a）；
  - 任何錯誤行都當成 conflict；
  - 接受任何 DENIED errno；
  - `PROBE_ERROR` 被當成 DEFENDED；
  - 探測程式與判定的拒絕清單不一致；
  - 預設接受模擬目標；
  - 沒有允許模擬卻使用替代資料；
  - 收集器漏掉平台憑證；
  - `b3-run` 只用 `issuedSecrets`；
  - `a10-run` 或 `src` 樹未納入錨定；
  - CLI 永遠 exit 0；
  - workflow 刪掉平台證據步驟。

## 5. 錨定與合併後的操作

- 錨定 digest 由 `fe954c3a…`（41 檔）變為 **`20c804ea86c1d8a2f133bcddaf8be3b3722451c88528a08560387c43306cd88a`（83 檔，R1）**。
  - 原因：受保護的 `attest.yml`、`verifier.mjs`、`attest-verify.mjs`、`sandbox.mjs`、`verify-anchor.mjs` 有修改，另外受保護範圍擴大為完整的可信呼叫鏈（C1-REV005）。
  - 送審時的 `e2149bd9…`（47 檔）已作廢，不應核准。
  - 在負責人重新核准錨定之前，`baseline-anchor` 會失敗。這是設計上的預期，Claude 不設定變數。
- 合併後，push 會照常觸發 `attest.yml`，結果應為 POC-001 honest → `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]`。之後**由負責人**手動觸發 `attest-attack.yml`：
  - `previousRunId` 與 `previousArtifactId` 可以留空，此時 A14-3a／3b 記為 `NOT_RUN`；
  - 也可以填入一個仍在 30 天保存期內的封裝，例如 run `44978067634` 的 artifact `14736254648`，保存到大約 2026-12-22。
- 交給審查者的 artifact 原檔：
  - `s2-attack-a10`
  - `s2-attack-summary`
  - 三個封裝 artifact：A14、誘餌、A4-1

## 6. 與計畫的差異與限制

- **R1：CI 結果與摘要的關係**：
  - `verify-attack` 只有在 `DEFENDED_WHERE_RUN` 時 exit 0，`a10` 只有在所有預期都成立時 exit 0；其他情況都會在寫完摘要之後 exit 1，摘要以 `if: always()` 上傳；
  - 即使 job 成功，也**不等於**攻擊驗收通過。驗收需要審查者核對摘要與 artifact 原檔。

- **A10 的攻擊者實例不是案例 Adapter**：A10 沒有執行案例；攻擊者使用與案例 Adapter 相同的沙箱設定與入口協定。
- **A4-1 改用 POC-002**：避免與 A14 的 `package-POC-001.tar` 同名（同一個 run 中，同名上傳本身就是 A14-2 的測試對象）。
- **A4-1 的可信證據是 host 端的樹 digest**：claim 中的寫入結果只是參考，不作為證據。
- **producerJob**：`runVerifyJob` 可以注入 producerJob，攻擊 workflow 的 statement 寫 `attack-execute-a14`／`attack-execute-a4`；`attest.yml` 維持 `attest-execute`。
- **statement 摘要的內容變了**：摘要改成「遮罩後 `stableJson` 的前 200 個 code point」，所以字串值會帶引號，部分檢查也改成結構化的值（例如 `HOST_ENDPOINTS_BLOCKED`、`MOUNT_ALLOWLIST`）。schema 只新增 `scenario`。
- **掃描的範圍有限**：只做子字串比對，不解碼 base64 或其他變形，單元測試明確驗證了這一點。所以「沒有命中」不是一般性的安全證明。
- **計畫 §9 的四項實作驗收備註**：
  1. `revoked` 紀錄格式錯誤時拒絕：留到 C-2；
  2. `selfCheckFull` 的大小上限、`originalByteLength` 與 `truncated` 一致、對照可信 `CHECK_IDS`：**已在 C-1 實作並測試**；
  3. 掃描的有限範圍：已在文件中說明並測試；
  4. `ACCEPTANCE_PENDING` 的措辭：屬於流程 II，負責人選了流程 I，留到 C-2 一併處理文件。
- **不涵蓋**：
  - C-2：第三方驗證腳本、`attest-sigtest.yml`；
  - C-3：Environment；
  - POC-009 的 G-1／G-4；
  - N7 的 host 來源、N5 的效能、在 `main` 提交摘要；
  - 非 root 的 runner。
- NOTE-c 仍是「原文缺失，待確認」；缺少的 NOTE 與 X1～X10 沒有執行。

## 7. R1：PR #13 審查的回應（Reviewed Head `9e4db47`）

| ID | 問題 | 修正 | 位置 | 驗證 |
|---|---|---|---|---|
| C1-REV001 | 平台步驟失敗就被當成預期的防禦 | A14-2：只有控制上傳成功、平台錯誤行含 409 與 conflict、本 run 中該名稱只有封存的那一個 artifact，三項都成立才判 DEFENDED；其他失敗判 `INCONCLUSIVE`，並附 `manualReview`。<br>A14-3a：API 清單確認該 ID 不在本 run 才判 DEFENDED。<br>新增可信步驟 `attack-platform-evidence.mjs`（唯讀 token，不輸出 token）；same-name job 新增控制上傳；CLI 只有在 `DEFENDED_WHERE_RUN` 時 exit 0 | `src/b3/attack-suite.mjs`、`scripts/attack-platform-evidence.mjs`、`scripts/attack-verify.mjs`、`attest-attack.yml` | `attack-suite-unit` 新增 4 項：網路錯誤、503、403、沒有 log、控制失敗、清單不可用、兩個同名、名稱屬於其他 artifact、沒有證據、ID 在本 run、錯誤行的擷取上限；mutation R1～R3、R13、R14；本機模擬三種證據 |
| C1-REV002 | A10 把探測程式的故障當成隔離阻擋 | 探測程式 v2：未知操作、格式錯誤、逾時、EMFILE，以及不在清單內的 errno，一律回報 `PROBE_ERROR`；只有符合該操作拒絕清單的 errno 才是 `DENIED`。判定端用同一份清單（有一致性測試）。TCP 目標改用 host 端解析出的 IP，探測程式不再自行解析名稱 | `sandbox-check/probe-a10.mjs`、`src/b3/a10.mjs` | `a10-unit` 新增 3 項：審查者列出的 UNKNOWN_OP、ERROR、EMFILE，以及 EIO、TIMEOUT、ENOTFOUND、EAI_AGAIN、跨操作的 errno、清單一致性、無法解析的目標；mutation R4～R6；`s2:a10` 9/9 |
| C1-REV003 | hosted 上可能靜默改用模擬的必要目標 | 替代資料只在 `allowSimulation` 時使用（本機）。判定預設不接受模擬目標（`SIMULATED_TARGET_NOT_ACCEPTED`），並記錄 `evidenceScope`。hosted 上找不到的真實目標維持缺少，因此不可能判 DEFENDED | `src/b3/a10.mjs`、`test/a10-run.mjs` | `a10-unit` 新增 1 項；mutation R7、R8；hosted 模式的本機示範 → `INCONCLUSIVE`，exit 1 |
| C1-REV004 | 封存時的已知機密清單漏掉平台憑證 | `src/b3/secrets.mjs`：已發出的 token（含輪替）、實際寫入 `case.json` 的 token，以及 Runner 環境中的平台憑證（固定名稱，加上名稱含 TOKEN／SECRET／PASSWORD／CREDENTIAL／PRIVATE_KEY／API_KEY 的變數）合成**同一份**清單。`b3-run` 的遮罩與兩處洩漏掃描都使用這份清單；清單只在記憶體中，只記錄各來源的筆數 | `src/b3/secrets.mjs`、`test/b3-run.mjs` | `c1-unit` 新增 1 項（含審查者的合成值，以及呼叫端的原始碼檢查）；`s2:b3` 經真實呼叫端組裝的檢查（合成的平台憑證、最後一個 case token）；mutation R9、R10 |
| C1-REV005 | 錨定遺漏直接產生驗收證據的可信程式 | 錨定改為涵蓋完整的可信呼叫鏈：<br>- `src/`、`sandbox-check/` 兩棵樹逐檔納入；<br>- 兩個 workflow 的入口腳本；<br>- 被啟動的 Runner 程式：`b3-run`、`a10-run`，以及 `smoke`（由 orchestrator 指名）；<br>- Stage 2 的 package、lock 與 Emulator 設定。<br>刻意不保護的有兩類：受測的 Adapter（`adapter-b3/`），以及單元測試。修正 `verify-anchor.mjs` 中「其他都由工具鏈 commit 固定」的錯誤描述 | `scripts/verify-anchor.mjs`、`tests/anchor_coverage.test.mjs` | `anchor_coverage` 計算每個 workflow 入口的 import closure（含被啟動的程式與 `/check` 入口），必須全部在錨定中；mutation R11、R12；83 檔 |
| 建議（CLI 的退出碼） | job 成功與攻擊驗收的關係 | 見 §6 | `scripts/attack-verify.mjs` | `attack-suite-unit` 的原始碼檢查；mutation R13 |

