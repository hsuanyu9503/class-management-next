# S2-B2 第 3 批｜hosted 攻擊驗收計畫（A4、A10、A14、A18）v0.4（草案）

> 狀態：**提案，尚未實作，也尚未核准。**本文件只是計畫：不修改 workflow、程式、受保護檔案、變數或 Settings，也不執行測試簽章。
> 依據：`S2B2-B3-PLAN.md` v0.3 §8（攻擊矩陣）；`S2B2-B3B-REPORT.md` §6；PR-2 審查與 hosted 證據複驗的要求（`docs/REVIEW_LOG.md`）。
> 目的：在 GitHub-hosted runner 上，對 §8 中「需要 B3b」的四項攻擊取得可審查的證據。
> 版本：
> - v0.1（Head `80b4f7e`）→ v0.2（Head `bbdc472`）：回應 PR #12 審查的 PR12-REV001～004 與兩項設計細節；
> - v0.2 → v0.3（Head `9bca6c7`）：回應 v0.2 複審的四項必要修正與兩項文字說明；
> - v0.3 → v0.4：回應 v0.3 複審的 F1（N-2 的推論範圍）與 F2（masker 的機密清單來源）。
>
> 對應表見 §9。

## 0. 摘要

| # | 攻擊 | 目前狀態 | 本計畫的驗收方式 |
|---|---|---|---|
| A10 | 竊取平台憑證 | 只有正常路徑的自我檢查 | 逐目標的正向控制；由**可信探測程式**在相同隔離設定下提供讀取被阻擋的證據；攻擊者 Adapter 的輸出掃描只作為額外的 `BREACHED` 證據（§2） |
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
5. **不公開機密與控制檔內容**（v0.3 統一規則）：
   - 真實的 host 機密與控制檔，例如 runner 憑證、`GITHUB_ENV`／`GITHUB_PATH`、`.git/config`，**只做唯讀探測**：
     - 不輸出原文、片段，也不輸出內容的雜湊或雜湊前綴。截短的雜湊仍可用來比對候選值，也可能碰撞，不算安全摘要。
     - 可信側只在記憶體內比對，輸出只有「目標 ID 與判定」。
   - 可以公開的測試標記（canary）及其摘要，**只能來自** Runner 為測試專門建立的隨機、非機密資料。不得把標記寫入真實的 runner、Git 或 GitHub 指令檔，以免改變這些控制檔的語意。
   - Adapter 的 stdout、stderr、claim 與 trace，必須**先由可信 Runner 攔截並檢查**，之後才能寫入公開的 Actions log 或 artifact。不得先串流到 log 再掃描。無法安全處理時，只保留安全診斷，例如目標 ID、判定與位元組數。
   - 驗收失敗時，仍要保存可信 Runner 產生的安全診斷，不能只是事後停止上傳。
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
| **禁止：host 的資料，host 端確認存在** | runner 安裝目錄的 `.credentials`、`.runner`、`_diag`；`$RUNNER_TEMP` 中的檔案；`GITHUB_OUTPUT`／`GITHUB_ENV`／`GITHUB_PATH`／`GITHUB_STEP_SUMMARY`／`GITHUB_STATE`；workspace 的 `.git/config`；host 的 `/proc/<host pid>/environ` | 讀到即 `BLOCKED PLATFORM_CREDENTIAL_EXPOSED`（`testOutcome=BREACHED`） | 逐項確認存在，只記錄「存在」；不記錄內容，也不記錄內容的雜湊 |
| **禁止：host 的資料，host 端不存在** | 執行 job 沒有 `id-token`，所以 `ACTIONS_ID_TOKEN_REQUEST_*` 本來就沒有；`ACTIONS_RUNTIME_TOKEN` 是否出現在 run step 的環境中，依實際狀態記錄 | 不適用（`N/A_HOST_ABSENT`） | 記錄 host 端「不存在」；**不**算正向控制通過 |
| **禁止：socket／裝置** | `/var/run/docker.sock`、`/run/containerd/*`、允許清單以外的 `/dev` | 可以連線或開啟即 `BLOCKED` | 逐項確認 host 端存在且可開啟；不存在者記為 `N/A_HOST_ABSENT` |
| **禁止：網路** | `169.254.169.254:80`、`github.com:443`、`api.github.com:443`、host 上 Emulator 與代理的各 port | 連線成功即 `BLOCKED` | **逐目標**確認 host 端可以連線；某個目標在 host 端也連不到時，該目標記為 `N/A_HOST_UNREACHABLE`。`github.com` 可以連線，不能替代其他目標的正向控制 |

- **單一目標判為 `DEFENDED`**，下列四項都要成立：
  1. 正向控制成功；
  2. 可信探測程式（§2.3）確實執行完成，可信側收到該目標的結果；
  3. 可信探測的結果是「被阻擋」；
  4. 攻擊者 Adapter 的輸出掃描沒有命中。
- 正向控制失敗、探測沒有執行、結果無法確認或缺少，該目標都記為 `INCONCLUSIVE`。**不能**只因為「輸出掃描沒有命中」就判 `DEFENDED`。
- 整體 A10 只有在下列條件都成立時才算 `DEFENDED`：
  - 沒有任何 `BREACHED`；
  - 預先列出的**必要目標**都是 `DEFENDED`；
  - 必要目標至少包含 `GITHUB_OUTPUT`、`.git/config`、runner 安裝目錄、host 的 `/proc/<pid>/environ`、Emulator port。

### 2.2 攻擊者 Adapter `adapter-b3/attackers/credential-probe.mjs`

- 依 §2.1 的清單嘗試讀取、開啟、連線。
- 可以自報「目標 ID 與是否成功」，但這只是參考資料，**不作為判定依據**。
- 讀取成功時，可能把資料夾帶在輸出中；這正是 §2.3 輸出掃描要抓的情況。

### 2.3 可信側的判定（v0.3 修訂）

**(1) 主要證據：可信探測程式 `poc/stage2/src/b3/probe-a10.mjs`**

- 程式本身：
  - 屬於可信工具鏈，以唯讀方式掛入沙箱，Adapter 無法修改；
  - 由可信 Runner 在**另一個沙箱實例**中執行，該實例**只有**探測程式，沒有 Adapter。
- 相同的隔離設定：
  - 探測實例與攻擊實例使用**同一份**隔離設定，包括 namespace、掛載、uid／capability 與網路；
  - 可信側記錄隔離設定的 digest，兩個實例必須相等。不相等時，所有目標都記為 `INCONCLUSIVE`。
- 結果管道：
  - 探測程式只透過 Runner 擁有的結果管道回報，記錄探測程式的 SHA-256 與結束狀態；
  - 結果只有「目標 ID、`DENIED`／`READ_OK`／`CONNECT_OK`、errno 類別」；讀到的內容只在探測程式內丟棄，不回傳；
  - 探測沒有完成、結果格式錯誤，或缺少任何目標時，該目標記為 `INCONCLUSIVE`。
- **結論範圍**（v0.4 修訂）：
  - 兩個實例即使設定 digest、uid 與 capability 都相同，仍是不同的執行中行程。目標狀態、時點、繼承的資源，以及 Adapter 額外採取的操作，都可能不同。
  - 可信探測的 `DENIED` 只證明「**這個探測操作**在已核對的條件下被阻擋」，不證明 Adapter 經由其他路徑也一定讀不到。
- **每個目標的記錄與核對**：
  - 目標身分：路徑加 device／inode，或 socket 位址與 port；
  - 操作：例如 `open(O_RDONLY)`、`connect`；
  - 時點：兩個實例的開始與結束時間，必須在同一個 run 內；
  - 執行條件：uid、capability、設定 digest、掛載表 digest。
- 無法建立案例所需的等價性時，記為 `INCONCLUSIVE`。
- 若已有可信證據確認 Adapter 成功，例如掃描命中，結果就是 `BREACHED`。另一個實例的 `DENIED` **不得**覆蓋這個結果。

**(2) 額外證據：攻擊者 Adapter 的輸出掃描**（只能證明 `BREACHED`，不能證明 `DEFENDED`）

- 測試標記只放在 Runner 專門建立的測試資料，例如：
  - `$RUNNER_TEMP/s2-canary-*` 檔案；
  - Runner 啟動的輔助 host 行程，在其環境變數放標記，供 `/proc/<pid>/environ` 使用；
  - 只在測試期間存在的 canary port。
- 真實的機密與控制檔不放標記。可信側在記憶體內，以原始內容與 Adapter 輸出做子字串比對；只輸出目標 ID 與是否命中。
- Adapter 的所有輸出先寫入 Runner 擁有、不會上傳的暫存區，並設上限；掃描完成後才產生可公開的內容（§1.5）。
- 掃描命中即判 `BREACHED`，不論 Adapter 怎麼自報。

**(3) 負向案例**（目的是證明不會產生**假的 `DEFENDED`**，不要求證明所有可能的隱蔽外洩通道都已封閉）

| 案例 | 攻擊者的行為 | 預期 |
|---|---|---|
| N-1 | 沒有實際嘗試，直接回報全部 `EACCES` | 判定只依可信探測；Adapter 自報不影響結果 |
| N-2（受控案例） | 只使用 Runner 專建的非機密 canary 檔。harness 刻意讓**兩個實例**對同一目標（同一 device／inode）、同一操作都具備可讀條件；Adapter 讀取成功後丟棄資料，並回報 `EACCES` | 可信探測必須回報 `READ_OK` → 該目標 `BREACHED`；Adapter 的丟棄或偽報不影響判定。這個案例驗證的是「判定不採信 Adapter 的自報」，不推論其他情況下 Adapter 的實際能力 |
| N-3 | 偽造完整的目標清單與結果 | 目標清單只取自可信設定；Adapter 的清單不採用 |
| N-4 | 偽造 socket 或網路的結果 | 以可信探測與 host 端正向控制為準 |
| N-5 | 把標記寫入輸出 | 掃描命中 → `BREACHED` |
| N-6 | 測試 harness 刻意讓探測實例使用不同的隔離設定 | 設定 digest 不符 → `INCONCLUSIVE` |
| N-7 | 測試 harness 刻意讓探測程式不回報某個目標 | 該目標 `INCONCLUSIVE`，整體不是 `DEFENDED` |
| N-8 | 測試 harness 刻意放寬隔離設定，讓探測可以讀取 | `BREACHED`。這是證明探測確實會報告讀取成功的反向控制 |

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
  - 第三方驗證要求 statement 的工具鏈紀錄在簽章時間有效（§5.1 步驟 4a）。
- 目前不支援獨立的 `adapterCommit`，Adapter 與工具鏈是同一個 commit。A4 的完整證明（惡意的 Adapter commit 搭配可信的 Verifier）要等支援獨立 `adapterCommit` 之後；在那之前，A4 只驗收上表三項。

### 4.2 從其他分支觸發 workflow（回應 PR12-REV001）

- **事實**：`workflow_dispatch` 可以選擇任何分支，實際執行的是那個分支的 workflow 檔。有寫入權限的人可以在分支上修改 `attest.yml`，或新增另一個 workflow，再要求 `id-token` 權限並簽章。
- 要分開說明兩件事：
  1. **平台是否會發出身分與簽章**：可能會。具備 `id-token: write` 權限，不等於已經發出簽章；但在平台允許、而且實際請求與簽署成功時，就能取得 OIDC token，Sigstore 也會留下紀錄。
     - GitHub Environment 的保護規則，只作用在**有引用該 Environment 的 job**。惡意 workflow 可以直接移除 `environment:`，所以 Environment **不是**對惡意 workflow 的全域防線，也不能保證不會留下非預期的公開簽章。
  2. **第三方是否接受這個簽章**：不接受。理由是第三方驗證（§5）必須獨立核對：
     - 精確的 signer workflow 路徑；
     - source ref 為 `refs/heads/main`；
     - signer commit 中 `attest.yml` 的 blob，在簽章時間是有效的批准紀錄；
     - statement 的工具鏈，在簽章時間是有效的批准紀錄。

     「在簽章時間有效」的定義見 §5.1 步驟 4a。

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
   - 從 signer digest（簽章 workflow 的 commit）取得該 commit 中 `attest.yml` 的 blob，它的 `signing-policy` 紀錄必須在**簽章時間有效**（步驟 4a）。

4a. **「在簽章時間有效」的定義**（v0.3，與 `S2B2-B3-PLAN.md` §4.4 一致；對 `signing-policy` 與 `toolchain` 紀錄**一致套用**）：
   - 要分開兩件事：
     - **產生新證明**時：Runner 的信任門檻要求工具鏈與簽章政策**目前**是 `active`；
     - **第三方驗證歷史證明**時：看簽章時間的有效性。
   - 第三方接受一份證明，下列條件都要成立：
     - 紀錄的狀態是 `active`，或 `revoked` 且 `invalidateIssued` 不是 `true`；
     - 簽章時間 `t` 滿足 `validFrom ≤ t`；
     - 有 `validTo` 時，`t < validTo`；`active` 而且沒有 `validTo` 時，區間不設上限。
   - `invalidateIssued: true`：不論簽章時間，一律拒絕。
   - 其他狀態，或沒有對應的紀錄：拒絕。
   - 簽章時間以透明度日誌的時間為準。
   - 若要改成「所有 `revoked` 都拒絕」，這屬於政策變更，需要另外決策，不在本計畫內。
5. **statement 與簽章的綁定**：
   - subject digest 等於實際取得的 `statement.json` 的 SHA-256；
   - statement 的 `toolchain.signingPolicyBlob` **等於**步驟 4 從 signer commit 取得的 blob；
   - `toolchain.trustedToolchainCommit` 的 `toolchain` 紀錄在簽章時間有效（步驟 4a）；
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
- 有效期間的邊界（`signing-policy` 與 `toolchain` 各一組）：
  - `t < validFrom` → 拒絕；
  - `t = validFrom` → 接受；
  - `t` 在 `validTo` 之前 → 接受；
  - `t = validTo` → 拒絕；
  - `t` 在撤銷之後 → 拒絕；
- 正常退役：`revoked`、`invalidateIssued=false`、`t` 落在有效區間內 → 接受；
- `invalidateIssued=true`，`t` 落在有效區間內 → 拒絕；
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
  - `ACCEPTANCE_PENDING` 只是**交付狀態**，不會讓已產生的有效簽章在密碼學上失效。要讓第三方拒絕它，只能透過批准紀錄的 `invalidateIssued: true`。
  - 刪除或改指變數，只影響之後開始的 run，不能假定已經開始的 run 會立刻停止。
  - **若負責人選擇流程 II**，實作之前必須另外提出下列三項，並經審查：
    - 驗收期間如何暫停後續簽發，例如 push 到 `main` 也會觸發 `attest.yml`；
    - 已排入佇列或執行中的 run 怎麼處理；
    - 什麼情況需要 `invalidateIssued: true`。

    本計畫不授權現在改設定或執行簽章。
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
2. **完整觀察值**（v0.3 固定處理契約）：
   - **位置**：完整觀察值只放在**封裝內的** `isolation.json` 的 `selfCheckFull`。statement 的 `isolation.selfCheck` 與 statement schema 都**不改**。
   - **綁定**：statement 已記錄 `isolation.json` 的 SHA-256（`artifacts.evidenceFiles`），完整清單透過這個既有的 digest 綁定。
   - **結構**：`selfCheckFull` 的鍵必須**正好**等於 statement `isolation.selfCheck` 的檢查 ID 集合（目前 22 項，取自 `CHECK_IDS`），不得缺少或多出。每項包含：
     - `observedFull`：字串；
     - `observedSha256`：64 個小寫十六進位字元；
     - `byteLength`：整數，等於 `observedFull` 的 UTF-8 位元組數；
     - `truncated`：布林；
     - `originalByteLength`：整數，表示截斷前的位元組數；沒有截斷時等於 `byteLength`。
   - **處理順序**：
     1. 觀察值以結構化的值（物件、陣列、字串）收集；
     2. 依**欄位名稱**與**已知機密值**遮罩，直接作用在結構化的值上（v0.4 明定的契約）：
        - **現況**：`makeMasker(names = [])` 的 `maskValue` 會遞迴遮罩機密欄位名稱、憑證形狀的字串，以及 `names` 中的虛構姓名（標記 `[MASKED_NAME]`）。不透明的機密值**只有**被明確傳入時才會被比對；`findLeaks` 的 `secrets` 是另一個掃描 API，不會自動傳入 masker。
        - **選擇**：新增包裝層 `maskObservation(value, { secretValues })`（C-1），**不**沿用 `names` 參數，因為 `names` 的語意是虛構姓名，標記不同。處理分兩步：
          1. 先呼叫 `makeMasker(fixtureNames).maskValue`；
          2. 再遞迴檢查每個字串值與物件的鍵：只要**包含** `secretValues` 中的任何一個值，整個字串就換成 `[MASKED_SECRET]`。
        - **清單來源**：可信 Runner 在記憶體中收集本次 run 的**完整**已知機密清單：
          - 本次發出或使用的 Emulator 與 actor token，包括 `case.json` 的 token；
          - Runner 可見的平台憑證值，例如 `ACTIONS_RUNTIME_TOKEN`（有出現時）；
          - 本次 run 中所有曾經輪替過的舊值。清單只增不減，**不得**只取最後一組。
        - **限制**：
          - 清單只在記憶體中，**不得**輸出；`isolation.json` 只記錄清單的筆數；
          - 排除空字串；
          - 清單無法取得時，判 `BLOCKED ISOLATION_EVIDENCE_INVALID`。
     3. 以 `stableJson` 穩定序列化；
     4. 轉成 UTF-8 位元組，計算大小；
     5. 超過 64 KiB（65,536 bytes）時，截斷到不超過上限的最後一個完整 UTF-8 字元邊界，不切開多位元組字元，並設 `truncated: true`；
     6. 對最後的 UTF-8 位元組計算 `observedSha256`。
   - **statement 摘要**：改成取自 `observedFull` 的前 200 個 **Unicode code point**，不足 200 個時取全文。
     - 現行程式用 `String.prototype.slice` 取前 200 個 UTF-16 code unit，可能切開代理對；C-1 會一併修正。
     - statement 的格式不變。
   - **Verifier 的判定**：

     | 情況 | 判定 |
     |---|---|
     | 缺少必要 ID、多出 ID、型別錯誤、`byteLength` 與實際不符 | `BLOCKED ISOLATION_EVIDENCE_INVALID` |
     | `observedSha256` 不符，或 statement 摘要與 `observedFull` 的前 200 個 code point 不符 | `BLOCKED ISOLATION_EVIDENCE_INVALID` |
     | 任一必要項 `truncated: true` | `BLOCKED ISOLATION_EVIDENCE_INCOMPLETE`；攻擊驗收中，相關目標記為 `INCONCLUSIVE` |

     - 截斷的資料可以保留作為安全診斷，但必須明確標記為不完整。
     - 截斷或缺少的觀察值，**不得**支撐 `DEFENDED` 或 `PASS`。
   - **單元測試**：

     | 案例 | 預期 |
     |---|---|
     | 正好 65,536 bytes | 不截斷 |
     | 65,537 bytes | `truncated`，判 `INCOMPLETE` |
     | 多位元組字元剛好跨在 64 KiB 邊界 | 不切開字元，雜湊正確重算 |
     | 摘要的第 200 個 code point 是非 BMP 字元 | 摘要不切開代理對 |
     | 缺少一個必要 ID | `INVALID` |
     | 多出 ID | `INVALID` |
     | `truncated: false`，但 `byteLength` 與實際不符 | `INVALID` |
     | 機密欄位在序列化前已遮罩 | 雜湊是遮罩後的值 |
     | 機密值出現在巢狀欄位中 | 遮罩後才雜湊 |
     | 機密值放在中性的鍵名下，例如 `observed` | `[MASKED_SECRET]` |
     | 機密值在巢狀陣列中 | `[MASKED_SECRET]` |
     | 字串中夾帶機密值，例如 `"x=<值>;y"` | 整個字串換成 `[MASKED_SECRET]` |
     | 本次 run 中已輪替的舊值 | 仍然遮罩 |
     | 機密值出現在物件的鍵 | 鍵被遮罩 |
     | 對序列化後的 `observedFull` 執行 `findLeaks({ secrets })` | 沒有命中；`observedSha256` 是遮罩後位元組的雜湊 |

## 7. 實作與交付（核准本計畫之後）

| PR | 內容 | 受保護檔案與錨定 |
|---|---|---|
| C-1 | 以下各項，加上單元測試、本機模擬與 mutation：<br>- `attest-attack.yml`（沒有簽章權限）；<br>- `scenario`（§1.2）；<br>- A10（§2，含可信探測程式 `probe-a10.mjs`）、A14（§3）、A4（§4.1）；<br>- 證據改善（§6） | 新增 workflow 與判定程式的修改都會改變錨定 digest，需要負責人重新核准 |
| C-2 | `verify-attestation.mjs`（§5.1）與單元測試；若選擇流程 I，另加 `attest-sigtest.yml` | 依流程而定 |
| C-3（可選） | Environment `s2-attest`（§4.2；只是額外保護，需要負責人在 Settings 設定） | `attest.yml` 改變，需要重新核准錨定 |

- 每個 PR 都要經過 ChatGPT 審查，並由負責人核准。
- 合併後，由負責人手動觸發攻擊 workflow，並下載 artifact 原檔交給審查者。

## 8. 需要負責人決定

> **負責人的決定（2026-11-22）**：「pr12合併／q-a 是／q-b 流程1／q-c 是／q-d 依照建議順序」
>
> | 問題 | 決定 |
> |---|---|
> | Q-A | 是：攻擊情境放在 `attest-attack.yml` |
> | Q-B | **流程 I**：使用隔離的測試簽章 workflow `attest-sigtest.yml`，分層驗收 |
> | Q-C | 是：加入 Environment `s2-attest`，只作為額外保護，不是安全邊界 |
> | Q-D | C-1 → C-2 → C-3 |
>
> 每一個 PR 仍要個別審查、取得負責人核准，並重新核准錨定。
> - Settings 的設定，包括 Environment 與變數，一律由負責人操作；
> - 測試簽章只在 C-2 合併後，由負責人手動觸發。


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

### v0.3 對應表（v0.2 複審，Head `bbdc472`）

| 項目 | 複審判定 | v0.3 的處理 | 狀態 |
|---|---|---|---|
| PR12-REV001 | 設計結案、實作待驗收 | §4.2 修正文字：具備權限不等於已經發出簽章 | 維持「設計結案、實作待驗收」 |
| PR12-REV002（陰性證據） | 部分解決，仍開啟 | §2.1：單一目標 `DEFENDED` 的四個條件。§2.3：可信探測程式在相同隔離設定下執行；比對設定 digest；結果透過可信管道回報；輸出掃描只能證明 `BREACHED`；負向案例 N-1～N-8 | 送審，**不**自行標為通過 |
| PR12-REV002（公開資料規則） | 部分解決，仍開啟 | §1.5 統一規則：真實機密與控制檔只做唯讀探測，不輸出內容或雜湊前綴；canary 只來自 Runner 專建的資料；不寫入真實控制檔；先攔截再公開。§2.2 移除 Adapter 自報長度與雜湊前綴 | 送審，**不**自行標為通過 |
| PR12-REV003 | 設計結案、實作待驗收 | 沒有改變 | 維持 |
| PR12-REV004（歷史有效期間） | 部分解決，仍開啟 | §5.1 步驟 4a：區分「產生新證明需要目前 `active`」與「第三方依簽章時間判定有效」，與 B3 計畫 §4.4 一致，對兩種紀錄一致套用；補上邊界、正常退役與 `invalidateIssued` 的測試。若要「所有 `revoked` 都拒絕」，列為另需決策的政策變更 | 送審，**不**自行標為通過；Q-B 仍待負責人決定 |
| 流程 II 的操作說明 | 非阻擋 | §5.2：`ACCEPTANCE_PENDING` 只是交付狀態；改指變數不會停止已開始的 run；若選流程 II，實作前另提暫停、佇列與 `invalidateIssued` 的處理 | 文字說明 |
| PR12-OBS（完整觀察值：截斷與處理順序；新追蹤項） | 位置已解決；截斷判定仍需補 | §6.2：結構與必要 ID 集合、處理順序（先遮罩再序列化，以 UTF-8 bytes 計算大小與雜湊，摘要以 code point 計）、截斷判 `INCOMPLETE`，以及邊界測試 | 送審；這是**計畫中的缺口**，不是已發生的產品漏洞 |

### v0.4 對應表（v0.3 複審，Head `9bca6c7`）

| 項目 | 複審判定 | v0.4 的處理 | 狀態 |
|---|---|---|---|
| F1：N-2 把相同設定等同相同的執行結果 | 仍開啟 | §2.3(1) 修訂：<br>• 結論範圍限於「這個探測操作在核對條件下被阻擋」；<br>• 每個目標記錄並核對身分（device／inode、socket）、操作、時點與執行條件；<br>• 無法建立等價性時記 `INCONCLUSIVE`；<br>• 已有可信證據確認成功時，不被 `DENIED` 覆蓋。<br>N-2 改為受控案例：使用非機密 canary，兩個實例都具備可讀條件，預期可信探測回報 `READ_OK`；刪除「Adapter 實際上也讀不到」這句。 | 送審 |
| F2：已知機密值需要明確注入 masker | 仍開啟 | §6.2 修訂：<br>• 新增包裝層 `maskObservation(value, { secretValues })`，標記為 `[MASKED_SECRET]`，不沿用 `names`；<br>• 由可信 Runner 在記憶體中收集完整的機密清單，包含輪替過的舊值；<br>• 清單不輸出，只記錄筆數；清單無法取得時判 `BLOCKED`；<br>• 補上中性鍵名、巢狀陣列、夾帶值、舊值、鍵、序列化後的掃描等測試。<br>本 PR 不修改 masker。 | 送審 |
| REV002：公開資料規則 | 設計結案、實作待驗收 | 沒有改變 | 維持 |
| REV004 | 設計結案、實作待驗收 | 沒有改變 | 維持；Q-B 仍待負責人決定 |
| REV001／REV003、scenario 的來源 | 設計結案、實作待驗收 | 沒有改變 | 維持 |

### 實作驗收備註（v0.3 複審提出；不是文件的阻擋項，留待 C-1／C-2 實作與審查時核對）

- **§5.1 步驟 4a 的輸入驗證**：`revoked` 紀錄缺少 `validTo`、時間無法解析，或區間不合法時，一律拒絕；不得把格式錯誤的 `revoked` 紀錄當作無限期有效。
- **`selfCheckFull`**：
  - `byteLength ≤ 65,536`；
  - `originalByteLength` 與 `truncated` 一致；
  - 鍵集合要對照可信的 `CHECK_IDS` 完整集合，不能只比對兩份自報的集合。
- **輸出掃描**：子字串掃描有已聲明的有限範圍，不能辨識所有編碼或變形後的外洩；掃描沒有命中，不是一般性的安全證明。
- **`ACCEPTANCE_PENDING` 的措辭**：§5.2「要讓第三方拒絕它，只能透過 `invalidateIssued`」應限縮為「依目前政策追溯否決已發出、原本有效的證明時，可使用 `invalidateIssued`」。身分、內容或政策的錯誤，本來就可能讓驗證拒絕。這句措辭在實作 C-2 時一併更正。

## 10. 未驗證與限制

- 以下官方文件的事實由審查者核對，Claude 的環境無法連線：
  - Environment 的保護範圍；
  - `overwrite: false` 遇到同名 artifact 時會失敗；
  - `gh attestation verify` 的參數與 JSON 格式；
  - GHSA-wjmr-j3rp-mh2g。
- 實作前仍要以 hosted 執行確認實際行為。
- A10 的可信探測只證明「相同權限與隔離設定下的行程讀不到」，不證明所有隱蔽的外洩通道都已封閉。
- A10 只能涵蓋列出的目標。runner 的實作若改變，需要更新清單；`DEFENDED` 只代表「這些目標在這些條件下讀不到」。
- 本計畫不涵蓋：
  - 非 root Runner、Windows；
  - POC-009 的 G-1／G-4（維持 `BLOCKED`）；
  - N7 的 host 來源認證、N5 的效能；
  - 在 `main` 提交摘要。
- NOTE-c 仍是「原文缺失，待確認」；缺少的 NOTE 與 X1～X10 沒有執行。
