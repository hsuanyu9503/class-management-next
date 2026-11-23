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
> **R1**（2026-11-22）：依 PR #13 審查（Reviewed Head `9e4db47`，CHANGES REQUESTED）修正 C1-REV001～005，見 §7。
> **R2**（2026-11-22）：依 R1 複審（Reviewed Head `d0ab942`，CHANGES REQUESTED，剩兩項）修正 A14-3a 的有效外部 artifact，以及短秘密的規則，見 §8。
> **R3**（2026-11-23）：依 R2 複審（Reviewed Head `e4aee0d`，CHANGES REQUESTED，剩 C1-REV001 的欄位驗證）修正 A14-3a 缺少或格式錯誤欄位時的判定，見 §9。本文 §4～§5 的數字已更新為 R3 的結果。

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

| 情境 | 本機結果（R1：`S2B2A10-20261122T154602Z`，commit `e3853d2`，工作樹乾淨） |
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

**本機模擬**（R1，commit `ff92a33`；之後只有檔名變更）：以本機的 `run-attest-execute.mjs` 產生 A14（POC-001）與 A4-1（POC-002）的封裝，再以三種合成的平台證據執行 `attack-verify.mjs`：

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
| `npm test`（repo_policy、anchor、anchor_coverage 等） | 19/19 通過（R3） | Claude 本機 |
| `npm run check` | 通過 | Claude 本機 |
| `npm run stage1:all`，以及 `git diff --exit-code -- poc/stage1` | 通過；Stage 1 沒有變更 | Claude 本機 |
| `npm run s2:test`（含 `c1-unit` 14 項、`a10-unit` 12 項、`attack-suite-unit` 12 項） | 143/143 通過（R3） | Claude 本機 |
| `npm run s2:b3`（真實 Emulator、沙箱、root） | 33/33 通過（R3）。遮罩掃描 96 個檔案，以同一份清單（195 筆，含 5 筆平台憑證，排除 2 個非秘密類別的名稱）掃描，0 命中。run `S2B2B3A-20261122T162343Z-8e367ddd`（commit `3dcaf3e`，工作樹乾淨） | Claude 本機 |
| `npm run s2:a10` | 9/9 符合預期（R3：run `S2B2A10-20261122T162443Z`，commit `3dcaf3e`） | Claude 本機 |
| A10 hosted 模式的示範（本機設定 `GITHUB_ACTIONS=true`、`RUNNER_ENVIRONMENT=github-hosted`） | A10-main → `INCONCLUSIVE`：`GITHUB_OUTPUT` 與 `RUNNER_INSTALL_DIR` 不是 DEFENDED，exit 1。證明 hosted 模式不會改用替代資料 | Claude 本機 |
| attest-attack 的本機模擬 | 見 §3 | Claude 本機 |
| mutation | R3：43/43 被測試抓到（原有 17 項、R1 的 14 項、R2 的 7 項、R3 的 5 項），見 `S2B2-C1-R3-mutations.txt` | Claude 本機 |
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

- 錨定 digest 由 `fe954c3a…`（41 檔）變為 **`31c23e4dc7bafdf80943581e459576bd0afef9a9f495fc6d046911a36fadb8d3`（83 檔，R3）**。
  - 原因：受保護的 `attest.yml`、`verifier.mjs`、`attest-verify.mjs`、`sandbox.mjs`、`verify-anchor.mjs` 有修改，另外受保護範圍擴大為完整的可信呼叫鏈（C1-REV005）。
  - 送審時的 `e2149bd9…`（47 檔）、R1 的 `fb0f85b0…`，以及 R2 的 `f79ade1e…`，都已作廢，不應核准。保護範圍沒有改變，仍是 83 檔。
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
| C1-REV004 | 封存時的已知機密清單漏掉平台憑證 | `src/b3/mask-list.mjs`：已發出的 token（含輪替）、實際寫入 `case.json` 的 token，以及 Runner 環境中的平台憑證（固定名稱，加上名稱含 TOKEN／SECRET／PASSWORD／CREDENTIAL／PRIVATE_KEY／API_KEY 的變數）合成**同一份**清單。`b3-run` 的遮罩與兩處洩漏掃描都使用這份清單；清單只在記憶體中，只記錄各來源的筆數 | `src/b3/mask-list.mjs`、`test/b3-run.mjs` | `c1-unit` 新增 1 項（含審查者的合成值，以及呼叫端的原始碼檢查）；`s2:b3` 經真實呼叫端組裝的檢查（合成的平台憑證、最後一個 case token）；mutation R9、R10 |
| C1-REV005 | 錨定遺漏直接產生驗收證據的可信程式 | 錨定改為涵蓋完整的可信呼叫鏈：<br>- `src/`、`sandbox-check/` 兩棵樹逐檔納入；<br>- 兩個 workflow 的入口腳本；<br>- 被啟動的 Runner 程式：`b3-run`、`a10-run`，以及 `smoke`（由 orchestrator 指名）；<br>- Stage 2 的 package、lock 與 Emulator 設定。<br>刻意不保護的有兩類：受測的 Adapter（`adapter-b3/`），以及單元測試。修正 `verify-anchor.mjs` 中「其他都由工具鏈 commit 固定」的錯誤描述 | `scripts/verify-anchor.mjs`、`tests/anchor_coverage.test.mjs` | `anchor_coverage` 計算每個 workflow 入口的 import closure（含被啟動的程式與 `/check` 入口），必須全部在錨定中；mutation R11、R12；83 檔 |
| 建議（CLI 的退出碼） | job 成功與攻擊驗收的關係 | 見 §6 | `scripts/attack-verify.mjs` | `attack-suite-unit` 的原始碼檢查；mutation R13 |

## 8. R2：R1 複審的回應（Reviewed Head `d0ab942`）

複審判定：
- 本輪結案：C1-REV002、003、005，以及 REV001 中的 A14-2 與退出碼；
- 仍開啟兩項，就是下表的兩列。

hosted 的實際行為仍待驗收。

| ID | 問題 | 修正 | 位置 | 驗證 |
|---|---|---|---|---|
| C1-REV001（A14-3a） | 只證明了「不在本 run」，沒有證明測到的是有效的外部 artifact | 平台證據步驟以 artifact ID 在**本 repository** 查詢，取得 HTTP 狀態、是否過期，以及所屬的 run。<br>只有下列條件都成立才判 DEFENDED：<br>- 200 而且未過期；<br>- 所屬 run 不是本 run；<br>- 有提供 `previousRunId` 時，所屬 run 必須等於它；<br>- 本 run 的清單（讀取成功）中沒有這個 ID；<br>- 下載失敗。<br>其他情況：404 或已過期 → `NOT_RUN FOREIGN_ARTIFACT_INVALID`；run 不符 → `NOT_RUN FOREIGN_ARTIFACT_RUN_MISMATCH`；查詢失敗或沒有證據 → `INCONCLUSIVE FOREIGN_ARTIFACT_UNVERIFIED`；屬於本 run → `INCONCLUSIVE`。<br>跨 run 下載（A14-3b）的結果記錄為附帶證據 | `src/b3/attack-suite.mjs`、`scripts/attack-platform-evidence.mjs`、`scripts/attack-verify.mjs`、`attest-attack.yml` | `attack-suite-unit` 新增 1 項，涵蓋：審查者重現的 `99999999999999999999`（現在判 `INCONCLUSIVE`）、他人 ID 的證據不能用、404、已過期、null／401／403／500、本 run、run 不符、有效、清單不可用。<br>mutation S1～S4、S7。<br>本機模擬三種**合成**證據：有效 → `DEFENDED`，exit 0；404 → `NOT_RUN`（整體 `DEFENDED_WHERE_RUN` 但 `notRun=A14-3a`，exit 0）；沒有查詢 → `INCONCLUSIVE`，exit 1 |
| C1-REV004（短秘密） | 長度 ≥ 12 的過濾會漏掉已知的短秘密 | 不再依長度過濾，只略過空值。平台環境**依名稱與用途分類**：憑證名稱都算秘密；位置類（`_FILE`／`_PATH`／`_DIR`）與設定類（`MAX_`／`MIN_`／`_TOKENS`）是明列的非秘密類別，只記錄筆數，不記錄值。極短的秘密會遮罩較多文字；若出現在 artifact 中，洩漏掃描會命中，不交出任何封裝（fail closed）。另記錄 `short` 筆數 | `src/b3/mask-list.mjs` | `c1-unit` 新增 2 項：審查者重現的 `old-pass-7`、`pin-4829`（已遮罩，掃描命中）；各來源 1～11 字元的值、長值、輪替值、空值；名稱分類（含本機實際遇到的 `MAX_THINKING_TOKENS` 與 `…_TOKEN_FILE`）。<br>mutation S5、S6。<br>`s2:b3` 33/33（`short=0`、排除 2 個） |

**注意**：
- `verify-attack` 的退出碼為 0 時，仍要檢查摘要中的 `notRun` 清單。綠燈不代表所有案例都已執行。
- 平台證據在本機都是合成的；409 的錯誤文字，以及 artifact API 的實際回應，要等 hosted 確認。

## 9. R3：R2 複審的回應（Reviewed Head `e4aee0d`）

複審判定：
- 本輪結案：C1-REV004；
- 維持結案：C1-REV002、003、005；
- 仍開啟：C1-REV001 中 A14-3a 的必要欄位驗證，就是下表這一列。

| ID | 問題 | 修正 | 位置 | 驗證 |
|---|---|---|---|---|
| C1-REV001（A14-3a 的必要欄位） | 沒有有效的 owner run ID 時，仍可能判為跨 run 防禦成功；收集器用 `expired === true`，會把缺少的 `expired` 推定為「未過期」 | `foreignEvidenceFrom()`（純函式，收集器直接使用）：只有真正的布林值才記為 `expired`；只有十進位 ID（數字或字串）才記為所屬 run；其他一律記為 null（未知）。<br>A14-3a 在檢查 404 與已過期之後，先檢查 `expired === false`，以及所屬 run 符合 `^[1-9][0-9]{0,19}$`；不成立就判 `INCONCLUSIVE FOREIGN_ARTIFACT_UNVERIFIED`。通過這一關之後，才檢查是否為本 run、是否等於 `previousRunId`，以及是否判 DEFENDED | `src/b3/attack-suite.mjs`、`scripts/attack-platform-evidence.mjs` | `attack-suite-unit` 新增 2 項：<br>- 審查者的重現（所屬 run 為 null、undefined、`'not-a-run'`），以及空字串、`'0'`、`'-5'`、`'12a'`、`12.5`、物件、陣列；<br>- `expired` 缺少或型別錯誤（null、undefined、`'false'`、0）；<br>- API 回應 → 平台證據 → 判定的完整路徑：沒有 `workflow_run`、`workflow_run` 沒有 id、id 為 null 或 `'abc'`、`expired` 缺少或為字串、`expired: true`、有效；<br>- 收集器的原始碼必須使用這個轉換。<br>mutation T1～T5。<br>本機模擬（**合成**證據）：有效 → `DEFENDED`；所屬 run 為 null → `INCONCLUSIVE`，exit 1；404 → `NOT_RUN` |

**缺少 API 欄位時的判定**（A14-3a，下載失敗的分支）：

| 查詢結果 | 判定 |
|---|---|
| 沒有查詢；status 為 null、401、403、500 等 | `INCONCLUSIVE FOREIGN_ARTIFACT_UNVERIFIED` |
| 404，或 `expired === true` | `NOT_RUN FOREIGN_ARTIFACT_INVALID` |
| 200，但 `expired` 不是 `false`（缺少、型別錯誤） | `INCONCLUSIVE FOREIGN_ARTIFACT_UNVERIFIED` |
| 200，但所屬 run 缺少或格式錯誤 | `INCONCLUSIVE FOREIGN_ARTIFACT_UNVERIFIED` |
| 所屬 run 就是本 run | `INCONCLUSIVE FOREIGN_ARTIFACT_IS_THIS_RUN` |
| 所屬 run 不等於 `previousRunId`（有提供時） | `NOT_RUN FOREIGN_ARTIFACT_RUN_MISMATCH` |
| 以上都通過，本 run 清單讀取成功且不含此 ID | `DEFENDED DOWNLOAD_NOT_FOUND_IN_RUN` |
| 以上都通過，但清單不可用 | `INCONCLUSIVE DOWNLOAD_FAILED_REASON_UNVERIFIED` |

以上判定都只經過本機單元測試與合成證據的驗證；GitHub artifact API 的實際回應要等 hosted 執行。

## 10. 第一次 hosted 攻擊驗收（run 45088076830），以及同名階段的修正

PR #13 合併後（`b5ae349`），負責人在 2026-11-23 觸發 `attest-attack.yml`：
- run：[45088076830](https://github.com/hsuanyu9503/class-management-next/actions/runs/45088076830)
- 輸入：`previousRunId=45087498469`、`previousArtifactId=14780101081`

以下內容只來自 job log 與 artifact 清單；artifact 的原檔還沒有經過審查者核對。

| job | 結果 | 說明 |
|---|---|---|
| `a10` | success；9/9 符合預期 | A10-main 判 `DEFENDED`，用的是**真實目標**：<br>- runner 安裝目錄由 `/proc` 找到：`RUNNER_INSTALL_DIR`、`.runner`、`.credentials`、`_diag`；<br>- `GITHUB_OUTPUT`／`GITHUB_ENV`／`GITHUB_PATH`／`GITHUB_STEP_SUMMARY`／`GITHUB_STATE`；<br>- docker 與 containerd 的 socket 都是 `DEFENDED`；<br>- `ACTIONS_*`、`GITHUB_TOKEN` 不在 step 環境中，判 `N/A_HOST_ABSENT`。<br>N-1～N-8 都符合預期。artifact：`s2-attack-a10`（14779079759） |
| `execute-a14`、`execute-a4` | success | 封裝：A14 為 `package-POC-001.tar`（14779838237，87,552 bytes）；誘餌（14779798585）；A4-1 為 `package-POC-002.tar`（14779932872） |
| `same-name` | success | 控制上傳成功；**同名上傳也成功**：出現第二個 `package-POC-001.tar`（14780032521，4,096 bytes，隨機內容） |
| `verify-attack` | **failure** | 第一步「A14 正向控制：依本次 ID 下載」失敗：`Found 5 artifact(s)`，`None of the provided artifact IDs were found`。之後的步驟都被略過，沒有 `s2-attack-summary` |

**平台層的發現**：
1. 在同一個 run 中，`upload-artifact`（v7.0.2，`archive: false`，`overwrite: false`）**接受了**第二個同名的 artifact。計畫原本預期它會被拒絕（A14-2）。
2. 之後 `download-artifact`（v8.0.2）的 log 寫著 `Found 5 artifact(s)` 與 `None of the provided artifact IDs were found`；而本 run 的 artifact 清單在那個時間點有 6 個，其中兩個名稱相同。
   - **觀察到的事實**：用原本的 ID 下載失敗，錯誤是「找不到這個 ID」。
   - **推論**（PR14-REV001 之後明確標示為推論）：比較新的同名 artifact 把原本的 ID 蓋住了。這是從這次的 log 與清單推得的，不是對平台行為的一般性證明。此後的 run 只有在 `probe-original` 的 log 出現同一個錯誤、而且清單同時列出兩個 ID 時，才記錄為 shadowing（見 §11）。

**安全面的意義**：
- 這是 **fail closed**：Verifier 沒有收到其他的位元組，而是下載失敗、整個判定沒有執行。
- 但這也表示，同一個 run 中任何能上傳的 job，都能讓驗證端無法取得封裝，造成可用性上的影響。
- `attest.yml` 中只有 execute job 會上傳封裝，沒有其他 job 上傳同名 artifact，所以正常路徑不受影響。這一點仍應列入審查。

**同一個缺陷也存在於 workflow 的設計**：
- same-name 的上傳排在主要驗證的下載之前，所以第一次 hosted 執行沒有判定 A14 與 A4；
- 這些情境維持 **NOT_RUN**，不能算成通過。

**修正**（本 PR；錨定 `d0b815eae57482e06fd66ca31af7eac84d657508667345deb02bde78c5f2d45f`，83 檔）：

| 部分 | 修改 |
|---|---|
| workflow | `verify-attack` 只等兩個 execute job，在同名上傳**之前**下載並判定 A14、誘餌、A14-3a／3b、A4，並上傳 `s2-attack-summary`。<br>`same-name` 改為在 `verify-attack` **之後**執行。<br>新增 `verify-same-name`（`contents: read`、`actions: read`）：<br>- 依原本的 ID 再下載一次真封裝；<br>- 依新 artifact 自己的 ID 下載替代品；<br>- 收集平台證據；<br>- 以 `STAGE=same-name` 判定；<br>- 上傳 `s2-attack-summary-same-name`。 |
| `attack-suite.mjs` v3 | 主要階段（`runAttackVerify`）不再包含 A14-2。新增同名階段（`runSameNameVerify`）：<br>- **A14-2**（平台層）：有 conflict 證據的拒絕 → `DEFENDED`；平台接受，而且清單同時列出兩個 artifact → `PLATFORM_ACCEPTED`。後者記為**發現（finding）**，不算 Verifier 的失守；<br>- **A14-1b**（Verifier 層）：依替代品自己的 ID 取得並驗證，必須是 `BLOCKED PACKAGE_DIGEST_MISMATCH`；<br>- **A14-2s**（新增）：依原本的 ID 再次下載。只有兩種情況算 `DEFENDED`：取回的位元組正是封存的那份（digest 等於 `packageSha256`），或者下載失敗、而 API 清單仍列出原本的 artifact（`ORIGINAL_ID_SHADOWED_FAIL_CLOSED`，同時記為 finding）。取回其他位元組 → `BREACHED`；無法確認 → `INCONCLUSIVE`。<br>摘要多了 `findings` 欄位 |
| CLI | `STAGE=main`／`same-name`，兩個階段都經由 `report()` 寫出摘要；只有 `DEFENDED_WHERE_RUN` 時 exit 0 |
| 測試 | `attack-suite-unit` 13 項：<br>- hosted 重現（接受同名、替代品被擋、原本的 ID 被蓋住而 fail closed）；<br>- 原本的 ID 取回封存位元組、其他位元組、多個檔案；<br>- 清單不可用或不含原本的 artifact；<br>- 替代品下載不到；<br>- 清單沒有同時列出兩者；<br>- 被拒絕時 A14-1b 與 A14-2s 都是 NOT_RUN；<br>- A14-1b 必須依 Verifier 的判定（控制案例）。<br>`repo_policy` 強制 job 順序：`verify-attack` 不得依賴 `same-name`；`same-name` 必須在 `verify-attack` 之後；`verify-same-name` 在 `same-name` 之後；以及 token 的使用處 |

**本機結果**（Claude，commit `5f4ea0d`，工作樹乾淨）：
- `npm test` 19/19；`check` 通過；`stage1:all` 通過，Stage 1 沒有變更；
- `s2:test` 144/144；
- `s2:b3` 33/33（`S2B2B3A-20261123T003226Z-bd8956d6`）；
- `s2:a10` 9/9（`S2B2A10-20261123T003329Z`）；
- 兩個階段的本機模擬（**合成**證據）：
  - 主要階段 → `DEFENDED_WHERE_RUN`；
  - 同名階段：hosted 的情況 → `DEFENDED_WHERE_RUN`，有 2 項 findings；原本的 ID 取回其他位元組 → `BREACHED`，exit 1；
- mutation 50/50 被測試抓到，沒有 SKIP 或 SURVIVED（M1～M17、R1～R14、S1～S7、T1～T5、U1～U7）。與 job 順序有關的舊目標字串因 workflow 新增 job 而不再唯一，已改用唯一的上下文，見 `S2B2-C1-FIX-mutations.txt`。

**尚未完成**：
- 修正後的 hosted 執行；
- 第一次 run 的 artifact 原檔還沒有交給審查者核對，包括 `s2-attack-a10`。

## 11. PR #14 審查回應（PR14-REV001，Reviewed Head `18a5ecc`）

| ID | 問題 | 修正 | 位置 | 驗證 |
|---|---|---|---|---|
| PR14-REV001（P2） | 用原本的 ID 再下載只要失敗，就被寫成「同名遮蔽」的確定事實，例如 ETIMEDOUT 也會如此 | 採審查者提出的第一種策略，**收集可信的原因證據**：<br>- 新增 `probe-original` job：等 `execute-a14` 與 `same-name`；權限只有 `actions: read`；不 checkout、不執行任何程式；只在自己的 job 中用原本的 ID 下載一次，留下自己的錯誤訊息；<br>- `verify-same-name` 等它完成，平台證據步驟讀取它的 `##[error]` 行與 outcome。<br>A14-2s 只判定有限的命題：「原本的 ID 回傳封存的位元組，或不回傳任何位元組」。<br>- 只有三項都成立，才判 `ORIGINAL_ID_SHADOWED_FAIL_CLOSED` 並記錄 finding：`probe-original` 失敗、錯誤行含 `None of the provided artifact IDs were found`、清單同時列出兩個同名 ID；<br>- 其他失敗（逾時、5xx、401／403、原因不明、沒有 probe 的 log）→ `DEFENDED`，platformOutcome 為中性的 `ORIGINAL_DOWNLOAD_FAILED_CAUSE_UNVERIFIED`，`causeVerified: false`，**不**記錄 finding | `src/b3/attack-suite.mjs`（v4）、`scripts/attack-platform-evidence.mjs`、`attest-attack.yml`、`tests/repo_policy.test.mjs` | `attack-suite-unit` 14/14，新增 1 項：<br>- 目標錯誤 → shadowing；<br>- 逾時、503、403、沒有錯誤行 → 原因未證實；<br>- 有目標錯誤，但 probe 成功、probe 結果未知、沒有 probe 的 log、清單只列出一個 ID → 原因未證實；<br>- 審查者的 ETIMEDOUT 重現。<br>mutation V1～V6。<br>本機模擬（**合成**證據）：ID not found → `SHADOWED`；ETIMEDOUT → `CAUSE_UNVERIFIED` |

**本機結果**（commit `0e26959`，程式與 Head 相同，之後只有文件）：
- `npm test` 19/19；`check` 通過；`stage1:all` 通過，Stage 1 沒有變更；
- `s2:test` 145/145；
- `s2:b3` 33/33（`S2B2B3A-20261123T010603Z-ea6fb196`）；
- `s2:a10` 9/9（`S2B2A10-20261123T010708Z`）；
- mutation 56/56（M、R、S、T、U、V 各組），沒有 SKIP 或 SURVIVED。

錨定：`7c4303b1d0e1906bf7b1bf8022ceaa72020667b91f59682bd62c8c3798205101`（83 檔，保護範圍不變）。送審時的 `d0b815ea…` 已作廢。

**送審的問題**（不在本次修正範圍）：
- A14-1b 若被 Verifier 以 `PACKAGE_DIGEST_MISMATCH` 以外的原因擋下（例如工具鏈不符），目前判為 `BREACHED`。這樣處理偏保守，但標籤可能誤導：替代品其實也沒有被接受。本機模擬用過期的封裝時遇到了這個情況。是否改為 `INCONCLUSIVE`，請審查者判斷。

**仍未完成**：
- 修正後的 hosted 執行；
- run 45088076830 的原檔核對。

## 12. 修正後的 hosted 攻擊驗收（run 45094456766）：C-1 hosted 證據收尾

- 執行：負責人以 workflow_dispatch 觸發，attempt 1。
  - main 與工具鏈 commit 都是 `2f78f9b72fe8492ae3b3aaba8d06ff234a1fe73f`（PR #14 的合併 commit）；workflow blob `9206e80c…`；
  - 錨定 `7c4303b1…`；沒有簽章；
  - 7 個 job 都是 success。`probe-original` 的下載步驟依設計失敗（continue-on-error），這**不是**原 ID 下載成功。
- 結果與證據層級：

| 案例 | hosted 結果 | 審查者的原檔證據 |
|---|---|---|
| A10（9 組） | 9/9 符合預期；A10-main 為 `REAL_TARGETS_ONLY`，必要的 5 個目標都是 DEFENDED | 診斷 JSON 的 digest 核對，並以已審的 judge 重算 |
| A14-positive | `CONTROL_OK`；UNATTESTED（`TRUST_ROOT_NOT_CONFIGURED`、`SCENARIO_NOT_HONEST`） | 真封裝重播 |
| A14-1 | DEFENDED（`ARTIFACT_SELECTION_MISMATCH`） | 誘餌重播 |
| A14-1b | DEFENDED（`PACKAGE_DIGEST_MISMATCH`） | 同名替代品的位元組重播 |
| A14-2 | `PLATFORM_ACCEPTED`（finding；不是 Verifier 失守） | API 雙 ID 清單、上傳 log、摘要 |
| A14-2s | DEFENDED（`ORIGINAL_ID_SHADOWED_FAIL_CLOSED`；可用性 finding） | `probe-original` 與 `verify-same-name` 的 ID-not-found 錯誤行、雙 ID 清單 |
| A14-3a | DEFENDED | hosted log、兩個 run 的清單、artifact 歸屬與到期狀態 |
| A14-3b-i | DEFENDED（`PACKAGE_DIGEST_MISMATCH`） | 舊 run 45087498469 的 artifact 14780101081（`d3dfaacf…`）重播 |
| A14-3b-ii | DEFENDED（`RUN_BINDING_MISMATCH`、`SCENARIO_MISMATCH`、`NONCE_MISMATCH`） | 同上；外層 digest 同步後，仍因綁定不符被拒絕 |
| A4-1 | DEFENDED；UNATTESTED | POC-002 原封裝重播；可信樹未變更依 hosted outputs 與 log |
| A4-2-i／ii | DEFENDED（`PACKAGE_DIGEST_MISMATCH`／`PAYLOAD_SET_MISMATCH`） | 從原封裝產生受控注入後重播 |
| A4-3 | DEFENDED | 執行與驗證 SHA、workflow 結構、遠端版本 |

- 結論：**C-1 的 hosted 證據已收尾**。所有案例都有原檔層級的審查證據，沒有新的產品阻擋缺陷，也沒有新的修正要求。
- 界線（審查者界定）：
  - `ENV_*` 為 `N/A_HOST_ABSENT`，不能宣稱這次測到了實際 token 的阻擋；`PORT_183xx` 為 `N/A_HOST_UNREACHABLE`，不能當成防禦成功；
  - A10 是原始診斷的一致性重算，不是獨立觀測主機。安全診斷沒有保留完整的沙箱原始資料；N7 主機來源的信任限制仍在；
  - 平台證據 JSON 沒有獨立隨附件提供，用 API 清單、日誌與摘要欄位交叉核對；
  - 同名的可用性問題只在該 action 版本與該次 run 下觀察到，不能推廣成一般保證。
- 仍然保留：
  - A14-2 與 A14-2s 的平台 finding；
  - 非阻擋的追蹤項目：A14-1b 標籤、`attest.yml` 的可用性診斷；
  - 另行追蹤：run 45088076830 原檔核對、四個正常 hosted run 的原檔重播；
  - `PASS_ENABLED=false`、POC-009 BLOCKED、Stage 1 的 72 筆 NOT_RUN；
  - N5、N7、main 摘要、NOTE-c（原文缺失，待確認）都不因此結案。

## 13. C-1f：PR #14 R1 的兩個非阻擋追蹤項目（負責人 2026-11-23 決定 Q1：在 C-2 之前另開小 PR）

### 13.1 A14-1b 的標籤（`attack-suite.mjs` v5）

| Verifier 對同名替代品的結果 | 舊（v4） | 新（v5） |
|---|---|---|
| BLOCKED，含 `PACKAGE_DIGEST_MISMATCH` | DEFENDED | DEFENDED（不變） |
| 沒有被擋下（PASS／UNATTESTED：替代品被接受） | BREACHED | BREACHED（不變） |
| BLOCKED，但原因是前置條件，例如 `TOOLCHAIN_COMMIT_MISMATCH`、`ARTIFACT_SELECTION_MISMATCH` | BREACHED | **INCONCLUSIVE**：保留 `reasonCodes`，附 `manualReview` |

- 依審查者的原則：替代品沒有被接受，但受測的 digest 檢查沒有被執行到，所以不能判 DEFENDED，也不是 BREACHED。
- INCONCLUSIVE 會讓同名階段的 overall 不是 `DEFENDED_WHERE_RUN`，CLI 仍以非零狀態退出。
- hosted run 45094456766 的 A14-1b 是第一列（DEFENDED），這次修改不影響它的結果。

### 13.2 `attest.yml` 的可用性診斷

- 新增 `availability` job：
  - 執行條件：`needs: [execute, verify]`，且 execute 成功、verify 失敗；
  - 權限只有 `contents: read`、`actions: read`，沒有 id-token、attestations，也不下載 artifact；
  - 只執行 `scripts/attest-availability.mjs`；
  - `github.token` 只出現在這個 job。簽章用的 verify job 權限**不變**。
- 診斷內容由純函式 `src/b3/availability.mjs` 產生，全部有上限：
  - 本 run 的 artifact 清單：最多 100 筆，只有 id、name、大小、digest、expired；
  - 預期 ID 是否在清單中、所有同名 ID；
  - verify job 的 `##[error]` 行：最多 10 行，每行 300 字元。
- `hints` 是給人看的標籤，**不是判定**：
  - `SAME_NAME_PRESENT`、`ID_NOT_FOUND_ERROR`、`EXPECTED_ID_NOT_LISTED`；
  - `LISTING_UNAVAILABLE`、`LISTING_TRUNCATED`、`VERIFY_LOG_UNAVAILABLE`、`EXPECTED_OUTPUTS_INVALID`。
  - 未知的情況保持 null，例如清單不完整時，不推論「不在清單中」。
- 產出：未簽章的 `s2-availability-<testId>`，保存 30 天。它不影響 Verifier 的結果、PASS 或簽章。

### 13.3 同一個 run 重跑或新增上傳者時的同名情況（**推論，未在 hosted 測試**）

- hosted run 45094456766 觀察到的現象：**較新的**同名 artifact 會讓**較舊的** ID 無法被 download-artifact 下載（fail closed）。
- 推論：
  - 只重跑失敗的 verify job：execute 的 outputs 沿用第一次的 ID，那仍是唯一、也是最新的同名 artifact，預期可以下載；
  - 整個 run 重跑：新的 execute 會上傳新的同名 artifact，並以新 ID 交給 verify。新 ID 是最新的，預期可以下載；舊 attempt 的 ID 會被遮蔽，但不再被使用；
  - 新增上傳者：`attest.yml` 中只有 execute 上傳 `package-<testId>.tar`。verify 上傳的是 `s2-verify-*`，availability 上傳的是 `s2-availability-*`，名稱都不同。若之後有其他 job 在 execute 之後上傳同名檔，verify 會失敗（fail closed），availability 會記錄 `SAME_NAME_PRESENT` 與 `ID_NOT_FOUND_ERROR`。
- 以上都沒有在 hosted 執行驗證。若要驗證，需要負責人另外觸發，本 PR 不觸發。

### 13.4 測試

- `attack-suite-unit`：前置條件擋下 → INCONCLUSIVE，保留 reason code，overall 不是 `DEFENDED_WHERE_RUN`；選擇錯誤 → INCONCLUSIVE；被接受 → 仍是 BREACHED。
- `availability-unit` 4 項：
  - hosted 的遮蔽模式；
  - 預期 ID 不在清單中；
  - 未知保持未知（沒有清單、沒有 log、清單被截斷、outputs 不合法）；
  - 上限與格式錯誤的欄位。
- `repo_policy`：
  - attest.yml 的 job 集合；
  - availability 的條件、權限與唯一的 run 行；
  - token 只在 availability；verify job 沒有 `actions: read`。
- mutation W1～W16。

