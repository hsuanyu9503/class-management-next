# S2-B2 第 3 批｜hosted 攻擊驗收計畫（A4、A10、A14、A18）v0.2（草案）

> 狀態：**提案，尚未實作，也尚未核准。**本文件只是計畫：不修改 workflow、程式、受保護檔案、變數或 Settings，也不執行測試簽章。
> 依據：`S2B2-B3-PLAN.md` v0.3 §8（攻擊矩陣）；`S2B2-B3B-REPORT.md` §6；PR-2 審查與 hosted 證據複驗的要求（`docs/REVIEW_LOG.md`）。
> 目的：在 GitHub-hosted runner 上，對 §8 中「需要 B3b」的四項攻擊取得可審查的證據。
> 版本：v0.1（Head `80b4f7e`）→ v0.2：回應 PR #12 審查的 PR12-REV001～004 與兩項設計細節，對應表見 §9。

## 0. 摘要

| # | 攻擊 | 目前狀態 | 本計畫的驗收方式 |
|---|---|---|---|
| A10 | 竊取平台憑證 | 只有正常路徑的自我檢查 | 攻擊者 Adapter 在 hosted 沙箱內嘗試讀取；**由可信 Runner 判定**，並逐目標做正向控制（§2） |
| A14 | 選錯 artifact | 只有單元測試 | 三種情境：可信輸入固定，只改變一個輸入；分開記錄平台層與 Verifier 層的結果（§3） |
| A4 | 篡改 Observer／Verifier | 只有結構測試 | 分成「Adapter 端的篡改」與「測試 harness 在封裝層注入」兩類；固定可信 checkout 的邊界測試（§4.1） |
| A18 | 未批准的簽章政策 | 只有單元測試 | 第三方驗證腳本；**兩條門檻一致的流程**，由負責人選擇（§5） |

## 1. 共同原則

1. **攻擊執行絕不能產生簽章。** 攻擊情境放在另一個 workflow `.github/workflows/attest-attack.yml`，所有 job 都**沒有** `id-token` 與 `attestations` 權限；`attest.yml` 不改（Q-A）。
2. **`scenario` 的來源**：
   - 由可信 workflow／harness 的輸入決定；`attest.yml` 固定為 `honest`，`attest-attack.yml` 依觸發輸入決定；
   - 以可信輸入的形式交給 Verifier，並綁定 package（寫入 `run.json`，與可信值比對）與 statement；
   - **不**採信 Adapter 或封裝自報的 scenario；缺少 scenario 時**不**預設為 `honest`，一律判 `BLOCKED`；
   - 封裝自報的 scenario 與可信值不符時，判 `BLOCKED SCENARIO_MISMATCH`；
   - `scenario ≠ honest` 的 statement，schema 與 Verifier 都不得給 PASS。
3. **判定由可信 Runner／Verifier 做出**，不採信攻擊者 Adapter 自報的結果（errno、READ）。Adapter 的自報只是參考資料，可信側必須另外觀察（見 §2.3）。
4. **正向控制逐目標記錄**：每個目標都要有 host 端的存在／可達證據。「讀不到」只有在可信側確認「目標存在」時才算證據；host 本來就不存在的目標記為「不適用」，不能當作通過。
5. **不輸出原始機密**：從讀取開始，可信側只記錄有限的安全摘要，例如「存在／不存在」、長度、是否等於測試標記、SHA-256 的前 8 碼。不記錄原始憑證、環境變數值、命令列或指令檔內容。驗收失敗時，仍保存可信 Runner 產生的安全摘要。不只是事後停止上傳。
6. **每個 run、每個案例的證據獨立保存**，artifact 保存 30 天。由負責人下載原檔交給審查者，逐項核對與重播。不得借用其他 run 的複驗結論。
7. **結果上限不變**：攻擊執行最多 `UNATTESTED`；偵測到攻擊時為 `BLOCKED`。只要有任何攻擊成功，就是驗收失敗，必須記錄並修正。
8. **觸發方式**：只用 `workflow_dispatch`，由負責人手動觸發，只在 `main` 上執行；push 不觸發。
9. **每個情境的結果分三層記錄**，不寫含糊的「NOT_RUN／BLOCKED」：
   - `testOutcome`：攻擊是否如預期被擋下（`DEFENDED`／`BREACHED`／`INCONCLUSIVE`）；
   - `platformOutcome`：平台層的結果，例如上傳或下載被拒；
   - `verifierOutcome`：Verifier 的判定與原因碼；Verifier 沒有執行時記 `NOT_REACHED`。

## 2. A10：竊取平台憑證（回應 PR12-REV002）

### 2.1 目標分類與判準

| 類別 | 例子 | 沙箱內可讀時的判定 | 正向控制（可信 Runner 在 host 端、同一時間） |
|---|---|---|---|
| **允許：沙箱自身資料** | 自己的 `HOME`、`PATH`；自己 PID namespace 內的 `/proc/self/*`、`/proc/1/*`（namespace 內的 init 是 Adapter 自己） | 允許，不算外洩 | 不需要；但要確認這些值是沙箱設定的值，例如 `HOME=/work` |
| **禁止：host 的資料，host 端確認存在** | runner 安裝目錄的 `.credentials`、`.runner`、`_diag`；`$RUNNER_TEMP` 中的檔案；`GITHUB_OUTPUT`／`GITHUB_ENV`／`GITHUB_PATH`／`GITHUB_STEP_SUMMARY`／`GITHUB_STATE`；workspace 的 `.git/config`；host 的 `/proc/<host pid>/environ` | 讀到即 `BLOCKED PLATFORM_CREDENTIAL_EXPOSED`（`testOutcome=BREACHED`） | 逐項確認存在，只記錄「存在」，不記內容 |
| **禁止：host 的資料，host 端不存在** | 執行 job 沒有 `id-token`，所以 `ACTIONS_ID_TOKEN_REQUEST_*` 本來就沒有；`ACTIONS_RUNTIME_TOKEN` 是否出現在 run step 的環境中，依實際狀態記錄 | 不適用（`N/A_HOST_ABSENT`） | 記錄 host 端「不存在」；**不**算正向控制通過 |
| **禁止：socket／裝置** | `/var/run/docker.sock`、`/run/containerd/*`、允許清單以外的 `/dev` | 可以連線或開啟即 `BLOCKED` | 逐項確認 host 端存在且可開啟；不存在者記為 `N/A_HOST_ABSENT` |
| **禁止：網路** | `169.254.169.254:80`、`github.com:443`、`api.github.com:443`、host 上 Emulator 與代理的各 port | 連線成功即 `BLOCKED` | **逐目標**確認 host 端可以連線；某個目標在 host 端也連不到時，該目標記為 `N/A_HOST_UNREACHABLE`。`github.com` 可以連線，不能替代其他目標的正向控制 |

- 若有任何「禁止」類目標的正向控制失敗，或該目標無法驗證，該目標的結果記為 `INCONCLUSIVE`。
- 整體 A10 只有在下列條件都成立時才算 `DEFENDED`：
  - 沒有任何 `BREACHED`；
  - 預先列出的**必要目標**都有成功的正向控制；
  - 至少包含 `GITHUB_OUTPUT`、`.git/config`、runner 安裝目錄、host 的 `/proc/<pid>/environ`、Emulator port。

### 2.2 攻擊者 Adapter `adapter-b3/attackers/credential-probe.mjs`

- 依 §2.1 的清單嘗試讀取、開啟、連線。
- Adapter 自報結果，但只能自報**安全摘要**：是否成功、長度、內容的 SHA-256 前 8 碼；不輸出內容本身。

### 2.3 可信側的判定

- **測試標記**：可信 Runner 在每個「禁止」類的 host 檔案，以及執行環境中可以由 Runner 控制的位置，例如 `$RUNNER_TEMP` 中 Runner 自己建立的檔案，放入每次執行都不同的隨機標記。可信 Runner 掃描沙箱的所有輸出，包括 claim、trace、Adapter 的 stdout 與 stderr：只要出現任何標記，或出現 host 檔案內容的雜湊前綴，就判 `BREACHED`，不論 Adapter 怎麼自報。
- **不能放標記的目標**：runner 自身的憑證檔不能修改，由可信 Runner 計算 SHA-256，掃描輸出中是否出現該雜湊的前綴與檔案片段。只記錄是否命中，不記錄內容。
- **負向案例**（證據偽造或遺漏）：
  - 攻擊者 Adapter 自報「全部 `EACCES`」，但實際把標記寫進輸出 → 可信側必須判 `BREACHED`；
  - Adapter 沒有回報某個目標 → 該目標記為 `INCONCLUSIVE`，不是通過。

## 3. A14：選錯 artifact（回應 PR12-REV003）

| 情境 | 攻擊輸入（只改這一項） | 保持不變的可信輸入 | 預期拒絕的層 | 安全證據 | 判為 NOT_RUN 的條件 |
|---|---|---|---|---|---|
| **A14-1 同一 run 的誘餌** | `artifactId` = 誘餌 `decoy-POC-001.tar` 的 ID | 原 producer 的 `packageSha256`、`manifestSha256`、nonce、runId、attempt、testId | 下載成功後，在 Verifier 的選取檢查：`ARTIFACT_SELECTION_MISMATCH`（檔名不是 `package-<testId>.tar`） | `verify.json` 的 `selection`、`reasons`；下載步驟的 log | 誘餌上傳失敗 → 這個情境無法執行，記為 NOT_RUN 並寫明原因 |
| **A14-1b 同上，但誘餌檔名合法** | 誘餌以 `package-POC-001.tar` 的檔名放在**另一個** job 的路徑上傳；`artifactId` = 誘餌 ID | 同上 | Verifier 的內容綁定：`PACKAGE_DIGEST_MISMATCH`（可信的 `packageSha256` 不變） | 同上 | 平台拒絕同名上傳 → 依 A14-2 記錄 |
| **A14-2 同名 artifact** | 同一個 run 的另一個 job，以 `overwrite: false` 上傳同名的 `package-POC-001.tar` | 不適用（這是平台層的測試） | **平台層**：預期上傳被拒，`platformOutcome=UPLOAD_REJECTED`；`verifierOutcome=NOT_REACHED`。依固定版本 action 的官方說明，既有同名 artifact 會讓上傳失敗 | 上傳步驟的 log；正確 ID 的判定仍與誠實路徑相同 | — |
| **A14-3a 其他 run 的 artifact（平台層）** | `artifactId` = 前一次 run 的封裝 ID；下載時**不**指定其他 run | 本 run 的所有可信輸入 | **平台層**：預期 `download-artifact` 在本 run 找不到這個 artifact，`platformOutcome=DOWNLOAD_NOT_FOUND`；`verifierOutcome=NOT_REACHED` | 下載步驟的 log | — |
| **A14-3b 其他 run 的封裝（Verifier 層，受控測試）** | 測試 harness 讓 Verifier 取得前一次 run 的封裝位元組；**明定**外層的 `packageSha256`／`manifestSha256` 是否同步改成該封裝的值 | runId、attempt、nonce 保持本 run 的值 | 外層 digest 不改 → `PACKAGE_DIGEST_MISMATCH`。外層 digest 同步改成舊封裝的值 → `RUN_BINDING_MISMATCH`（runId／nonce）。兩者分成兩個測試，不混為同一個預期 | `verify.json` | 前一次 run 的 artifact 已過期 → NOT_RUN |
| **正向控制** | 無（正確 ID） | 全部 | 與誠實路徑相同的判定 | 同上 | — |

## 4. A4 與從其他分支觸發 workflow 的殘餘風險

### 4.1 A4：篡改 Observer／Verifier（回應 PR12-REV003）

| 情境 | 操作 | 驗收什麼 | 預期 |
|---|---|---|---|
| **A4-1 Adapter 端的篡改** | 攻擊者 Adapter 在沙箱內嘗試寫入或替換 `/check`、`/adapter` 中的檔案；並在 claim 中回傳假的 Verifier 版本與假的 canonical | 可信程式沒有被採用或改寫 | 寫入失敗（唯讀掛載）；claim 中的版本與 canonical 不會被採用，判定以可信 Observer 為準（延伸 A8／A12） |
| **A4-2 封裝層的注入（測試 harness）** | 測試 harness 在封裝中多加 `verifier.mjs`；分成兩個子測試：外層 digest 不改；外層 digest 同步改成新封裝的值 | 安全解析與固定的 payload 集合 | 外層 digest 不改 → `PACKAGE_DIGEST_MISMATCH`；外層 digest 同步改 → `PAYLOAD_SET_MISMATCH`；封裝內的程式從不被執行 |
| **A4-3 固定可信 checkout 的邊界** | 驗證 job 的 checkout 參數：只 checkout 可信工具鏈（變數，或本 commit） | 驗證 job 沒有任何步驟會 checkout Adapter 或執行 artifact 的內容 | repo_policy 的結構測試；hosted log 中 checkout 的 SHA 等於可信工具鏈 |

**限制（明列）**：

- 「修改 Verifier 等於修改工具鏈，會由批准紀錄擋下」**只在未被修改的可信 Verifier 執行檢查時成立**，不能依賴惡意的 Verifier 自行拒絕自己。批准紀錄的檢查本身就在可信工具鏈內，所以真正的防線是：
  - 「只有已批准的工具鏈 commit 才能被 checkout 為可信工具鏈」（負責人設定變數）；
  - 第三方驗證要求 statement 的工具鏈是 `active` 的紀錄（§5）。
- 目前不支援獨立的 `adapterCommit`，Adapter 與工具鏈是同一個 commit。A4 的完整證明（惡意的 Adapter commit 搭配可信的 Verifier）要等支援獨立 `adapterCommit` 之後；在那之前，A4 只驗收上表三項。

### 4.2 從其他分支觸發 workflow（回應 PR12-REV001）

- **事實**：`workflow_dispatch` 可以選擇任何分支，實際執行的是那個分支的 workflow 檔。有寫入權限的人可以在分支上修改 `attest.yml`，或新增另一個 workflow，再要求 `id-token` 權限並簽章。
- 要分開說明兩件事：
  1. **平台是否會發出身分與簽章**：會。只要 workflow 要求 `id-token: write`，平台就會發出 OIDC token，Sigstore 也會記錄簽章。
     - GitHub Environment 的保護規則，只作用在**有引用該 Environment 的 job**。惡意 workflow 可以直接移除 `environment:`，所以 Environment **不是**對惡意 workflow 的全域防線，也不能保證不會留下非預期的公開簽章。
  2. **第三方是否接受這個簽章**：不接受。理由是第三方驗證（§5）必須獨立核對：
     - 精確的 signer workflow 路徑；
     - source ref 為 `refs/heads/main`；
     - signer commit 中 `attest.yml` 的 blob 是 `active` 的批准紀錄；
     - statement 的工具鏈是 `active` 的批准紀錄。

     這才是對惡意簽章的防線。
- **Q-C 的新定位**：加入 Environment `s2-attest`（只允許 `main`），只是對**合作的** workflow 的額外保護，用來避免誤用，例如誤從其他分支觸發未修改的 `attest.yml`，不是安全邊界。
  - 若日後要把 Environment 當作第三方驗證的必要條件，必須先確認最終的 Sigstore 證據中，第三方實際可以驗證到哪個欄位。不能假定 OIDC 的 environment claim 一定以相同欄位出現。
  - 還要另外提出外部強制機制與可執行的驗證方法。在那之前，Environment 不列入任何驗收條件。
- 殘餘風險（保留）：惡意的分支 workflow 仍可以在公開的透明度日誌中留下簽章，只是不會被接受。降低風險的方式是限制寫入權限與審查分支，屬於負責人的組織決策。

## 5. A18：第三方驗證（回應 PR12-REV004）

### 5.1 第三方驗證腳本 `poc/stage2/scripts/verify-attestation.mjs`

由獨立的驗證者使用，不在 workflow 內執行。

1. **固定 CLI 版本**：`gh` 必須是 **v2.102.0 以上**。舊版的 `--signer-workflow` 只做前綴比對（GHSA-wjmr-j3rp-mh2g），v2.102.0 已修正。腳本先檢查版本，版本不足就拒絕執行。
2. **驗證簽章**：

   ```bash
   gh attestation verify statement.json --repo hsuanyu9503/class-management-next --signer-workflow hsuanyu9503/class-management-next/.github/workflows/attest.yml --source-ref refs/heads/main --format json
   ```

   - 只有在 `gh` **驗證成功**時，才解析它輸出的 JSON。這個 JSON 是已驗證結果的陣列。
   - 驗證失敗時，一律拒絕。
3. **多份證據的接受規則**：
   - 陣列中**每一份**都必須通過步驟 4～6；
   - 只要有任何一份不符，就整體拒絕；
   - 結果至少要有一份。
4. **身分與政策**：
   - signer workflow 的路徑**完全等於** `.github/workflows/attest.yml`；
   - source ref 是 `refs/heads/main`；
   - 從 signer digest（簽章 workflow 的 commit）取得該 commit 中 `attest.yml` 的 blob，必須是簽章時間落在有效區間（`[validFrom, validTo)`）內、而且是 `active` 的 `signing-policy` 紀錄；
   - `invalidateIssued: true` 的紀錄，在任何時間都拒絕；
   - 簽章時間以透明度日誌的時間為準。
5. **statement 與簽章的綁定**：
   - subject digest 等於實際取得的 `statement.json` 的 SHA-256；
   - statement 的 `toolchain.signingPolicyBlob` **等於**步驟 4 從 signer commit 取得的 blob；
   - `toolchain.trustedToolchainCommit` 是 `active` 的 `toolchain` 紀錄；
   - `targets` 等於該工具鏈的鎖定檔重算的值；
   - `verdict.result = PASS`；
   - `scenario` 必須是 `honest`，否則拒絕；
   - `package.artifactId`／`signingPolicyBlob` 不是 null。
6. **政策的來源與新鮮度**：
   - 批准紀錄取自**目前經錨定的 `main`**：受保護檔案的 digest 必須等於 `CMN_STAGE1_ANCHOR_SHA256`；
   - 記錄政策檔的 SHA-256、來源 commit、取得時間；
   - 取得時間超過 `freshnessHours`（24 小時），結果標為「撤銷狀態未知」，不得宣稱有效。
7. **反向測試**：只用**本機測試用的政策複本**修改紀錄，例如移除 `signing-policy`、加入撤銷，確認會被拒絕。不修改正式的批准紀錄。

測試（單元）至少包含：

- 共用前綴的不同 workflow 路徑，例如 `attest.yml.bak`、`attest.yml-evil`，必須被拒絕；
- 多份證據中有一份不符時，整體拒絕；
- 簽章時間在撤銷之後；
- `invalidateIssued`；
- 政策過期；
- statement 的 blob 與 signer commit 不符；
- 非 honest 的 scenario。

### 5.2 兩條門檻一致的流程（**需要負責人選擇**；決定之前 `PASS_ENABLED=false`）

**流程 I：保留原門檻**。打開 PASS 之前完成全部 A18 驗收。

- 新增隔離的**測試簽章** workflow `attest-sigtest.yml`：只能手動觸發，只在 `main` 上執行，只簽一個**固定的測試檔**（說明文字，不是 statement）。
- 分兩層驗收：
  - **密碼學與身分層**：以 §5.1 的步驟 1～4 搭配「測試身分政策」驗證：
    - 測試 workflow 路徑 = `attest-sigtest.yml` → 接受；
    - 刻意的不同路徑，或共用前綴的路徑 → 拒絕；
    - 測試 workflow 的 blob 不在測試政策中 → 拒絕。
  - **statement 政策層**：以單元測試驗證 §5.1 的步驟 5～7。
  - 測試檔通過「測試身分政策」，**不得**被報告為「正式 PASS statement 被接受」。
- 代價：
  - 測試簽章會**永久**留在公開的透明度日誌中，內容是測試文字；
  - 新增一個具簽章權限的 workflow，屬於受保護檔案，需要重新核准錨定。

**流程 II：經負責人批准的例外**。真實簽章的 A18 驗收延到打開 PASS 之後的第一份簽章。

- 打開 PASS 之前必須完成：
  - A4／A10／A14 的 hosted 驗收；
  - §5.1 腳本與全部單元測試；
  - 負責人**明確書面批准**這個例外。
- 第一份簽章的狀態是「**已簽章、未驗收**」（`ACCEPTANCE_PENDING`）：在第三方的正向與反向驗證都完成之前，不得對外宣稱它是有效的認證。
- 第一份簽章之後立刻做兩項驗證：
  - **正向**：§5.1 接受它；
  - **反向**：以本機測試政策複本移除對應紀錄、使用共用前綴的路徑、使用錯誤的 blob，確認都會拒絕。
- 失敗時的處理：
  - 立刻把 `CMN_S2_TRUSTED_TOOLCHAIN_SHA` 刪除，或指向不可 PASS 的工具鏈；
  - 在批准紀錄中把該工具鏈與簽章政策改為 `revoked`，必要時加 `invalidateIssued: true`；
  - 記錄事件，並重新審查。
- 代價：打開 PASS 時沒有真實簽章的 A18 證據，門檻有明確、經過批准的例外。

Claude 不代替負責人選擇。兩條流程的共同點：

- 選擇之前，`PASS_ENABLED=false`；
- 打開 PASS 的 PR 會產生新的工具鏈 commit，仍須重新審查、加入批准紀錄、更新兩個指標與錨定；
- HANDOFF 的門檻依所選流程寫明。

## 6. 證據改善

1. **Java 版本**：
   - 改為讀取 `java -version` 的 **stderr**；
   - 解析失敗或沒有 Java 時，**如實記錄** `unknown`，不填假值；
   - 單元測試用假的輸出驗證：Temurin 21 的格式、OpenJDK 的格式、沒有輸出時記 `unknown`、指令失敗時記 `unknown`。
2. **完整觀察值**：
   - **位置**：完整觀察值只放在**封裝內的** `isolation.json`，新增 `selfCheckFull`，結構為 `{ [checkId]: { observedFull, observedSha256 } }`。statement 的 `isolation.selfCheck` **不改**：仍是每項 200 字元的摘要，不加任何新欄位，statement schema 不變。
   - **綁定**：statement 已記錄 `isolation.json` 的 SHA-256（`artifacts.evidenceFiles`），所以完整清單透過這個既有的 digest 綁定，不需要在 statement 中另放 digest。
   - **序列化**：`observedFull` 是 `stableJson` 序列化後的字串；每項上限 64 KiB，超過時截斷並記錄 `truncated: true` 與原始長度。
   - **先遮罩、後雜湊**：`observedFull` 先經同一個 masker 遮罩，再計算 `observedSha256`。**不**對原始憑證內容只做雜湊後公開，因為雜湊可能被枚舉還原。
   - **Verifier 的重算**：
     - 每項的 `observedSha256` 必須等於 `observedFull` 的 SHA-256；
     - statement 中 200 字元的摘要必須等於 `observedFull` 的前 200 字元，`observedFull` 少於 200 字元時則等於全文；
     - 不符時判 `BLOCKED ISOLATION_EVIDENCE_INVALID`。

## 7. 實作與交付（核准本計畫之後）

| PR | 內容 | 受保護檔案與錨定 |
|---|---|---|
| C-1 | 以下各項，加上單元測試、本機模擬與 mutation：<br>- `attest-attack.yml`（沒有簽章權限）；<br>- `scenario`（§1.2）；<br>- A10（§2）、A14（§3）、A4（§4.1）；<br>- 證據改善（§6） | 新增 workflow 與判定程式的修改都會改變錨定 digest，需要負責人重新核准 |
| C-2 | `verify-attestation.mjs`（§5.1）與單元測試；若選擇流程 I，另加 `attest-sigtest.yml` | 依流程而定 |
| C-3（可選） | Environment `s2-attest`（§4.2；只是額外保護，需要負責人在 Settings 設定） | `attest.yml` 改變，需要重新核准錨定 |

- 每個 PR 都要經過 ChatGPT 審查，並由負責人核准。
- 合併後，由負責人手動觸發攻擊 workflow，並下載 artifact 原檔交給審查者。

## 8. 需要負責人決定

| # | 問題 | Claude 的建議 |
|---|---|---|
| Q-A | 攻擊情境是否放在另一個沒有簽章權限的 workflow（`attest-attack.yml`）？ | 是（審查者也認為方向合理） |
| Q-B | A18 採用 §5.2 的流程 I 還是流程 II？ | **不代替負責人選擇**；兩條流程的代價列在 §5.2 |
| Q-C | 是否加入 Environment `s2-attest`，並**定位為合作 workflow 的額外保護，不是安全邊界**（§4.2）？ | 可以，但優先順序低（C-3）；不列入任何驗收條件 |
| Q-D | 實作順序是否為 C-1 → C-2 →（C-3）？ | 決定 Q-B 之後再決定 |

## 9. v0.2 對應表（PR #12 審查）

| ID | 問題 | v0.2 的處理 |
|---|---|---|
| PR12-REV001 | Environment 不是不可繞過的 OIDC 限制 | §4.2：分開說明「平台是否會發出簽章」與「第三方是否接受」；Environment 改為合作 workflow 的額外保護，不是安全邊界；不假定 claim 會出現在 Sigstore 證據中；Q-C 重新定位 |
| PR12-REV002 | A10 的判準會把沙箱自身資料當成外洩 | §2.1：逐目標分類（允許的自身資料、禁止且 host 存在、禁止且 host 不存在、socket、網路）；逐目標的正向控制；`INCONCLUSIVE`。§2.3：以測試標記與雜湊掃描由可信側判定；偽造或遺漏的負向案例。§1.5：不輸出原始機密；失敗時保存安全摘要 |
| PR12-REV003 | A4／A14 的注入方式與預期結果不夠精確 | §3：A14 每個情境列出攻擊輸入、不變的可信輸入、預期拒絕的層、證據、NOT_RUN 條件；分開記錄三層結果（§1.9）。§4.1：A4 分為 Adapter 端、封裝層注入（明定外層 digest）、可信 checkout 邊界三項；明列「不依賴惡意 Verifier 自我拒絕」與「不支援獨立 `adapterCommit`」的限制 |
| PR12-REV004 | A18 的選項與 PASS 前置門檻互相衝突 | §5.2：兩條門檻一致的流程（I：保留門檻並加隔離的測試簽章，分層驗收；II：經負責人批准的例外、`ACCEPTANCE_PENDING`、失敗時的停止與撤銷步驟），由負責人選擇。§5.1：只解析成功驗證後的資料、多份證據規則、政策來源與新鮮度、有效區間與撤銷、blob 與 signer commit 綁定、拒絕非 honest、反向測試只改本機複本。**固定 `gh` v2.102.0 以上**（GHSA-wjmr-j3rp-mh2g），並測試共用前綴的路徑 |
| 設計細節 1 | `scenario` 的來源 | §1.2：只來自可信輸入；缺少時判 `BLOCKED`；不符時判 `SCENARIO_MISMATCH` |
| 設計細節 2 | 完整觀察值的位置 | §6.2：只放在封裝內的 `isolation.json`；statement 不變；透過既有的 artifact digest 綁定；先遮罩後雜湊；Verifier 重算 |

## 10. 未驗證與限制

- 以下官方文件的事實由審查者核對，Claude 的環境無法連線：
  - Environment 的保護範圍；
  - `overwrite: false` 遇到同名 artifact 時會失敗；
  - `gh attestation verify` 的參數與 JSON 格式；
  - GHSA-wjmr-j3rp-mh2g。
- 實作前仍要以 hosted 執行確認實際行為。
- A10 只能涵蓋列出的目標。runner 的實作若改變，需要更新清單；`DEFENDED` 只代表「這些目標在這些條件下讀不到」。
- 本計畫不涵蓋：
  - 非 root Runner、Windows；
  - POC-009 的 G-1／G-4（維持 `BLOCKED`）；
  - N7 的 host 來源認證、N5 的效能；
  - 在 `main` 提交摘要。
- NOTE-c 仍是「原文缺失，待確認」；缺少的 NOTE 與 X1～X10 沒有執行。
