# S2-B2 第 3 批｜hosted 攻擊驗收計畫（A4、A10、A14、A18）v0.1（草案）

> 狀態：**提案，尚未實作，也尚未核准。**本文件只是計畫：不修改 workflow、程式、受保護檔案、變數或 Settings。
> 依據：`S2B2-B3-PLAN.md` v0.3 §8（攻擊矩陣）；`S2B2-B3B-REPORT.md` §6；PR-2 審查與 hosted 證據複驗的要求（`docs/REVIEW_LOG.md`）。
> 目的：在 GitHub-hosted runner 上，對 §8 中「需要 B3b」的四項攻擊取得可審查的證據。這是打開 `PASS_ENABLED` 之前必須完成的門檻之一（HANDOFF）。

## 0. 摘要

| # | 攻擊 | 目前狀態 | 本計畫的驗收方式 |
|---|---|---|---|
| A10 | 竊取平台憑證 | 只有正常路徑的自我檢查（ENV_ALLOWLIST、PROC_ISOLATED、FS_GIT_HIDDEN、OUTPUT_CHANNELS_HIDDEN） | 新的攻擊者 Adapter 在 hosted 沙箱內實際嘗試讀取 runner 的憑證與指令檔；host 端同時做正向控制 |
| A14 | 選錯 artifact | 只有單元測試；hosted 只有正常路徑 | 執行 job 另外上傳誘餌 artifact；驗證 job 在測試模式下依序拿誘餌 ID、其他 run 的 ID 去下載與判定 |
| A4 | 篡改 Observer／Verifier | 只有結構測試（驗證 job 只 checkout 可信工具鏈） | 攻擊者 Adapter 嘗試讓 Verifier 執行或採用它提供的程式；另外核對從其他分支觸發 workflow 的影響（§5 的殘餘風險） |
| A18 | 未批准的簽章政策 | 只有單元測試；尚無任何簽章 | 第三方驗證腳本與兩種驗收選項（§4.4，需要負責人決定） |

另外，實作 PR 中一併處理兩項證據改善：

- `environment.java` 一直是 `unknown`：`java -version` 把版本寫到 stderr，`test/b3-run.mjs` 只讀 stdout。
- `observed` 字串被截成 200 字元：要另外保存完整觀察值的 digest 與完整清單。

## 1. 共同原則

1. **攻擊執行絕不能產生簽章。** 提案：把攻擊情境放在**另一個 workflow** `.github/workflows/attest-attack.yml`，所有 job 都**沒有** `id-token` 與 `attestations` 權限；`attest.yml` 不改。
   - 攻擊 workflow 的 statement 寫入 `scenario` 欄位。schema 規定 `scenario ≠ honest` 時不得 PASS，Verifier 也會把它判為攻擊測試，不會進入簽章路徑。
2. **每個攻擊都有正向控制**：host 端必須證明攻擊目標確實存在，例如 runner 的憑證檔、`GITHUB_OUTPUT`、誘餌 artifact。「讀不到」只有在「目標存在」時才算證據，延續 §3.3 與 A16 的原則。
3. **每個 run、每個案例的證據獨立保存**，artifact 保存 30 天。之後由負責人下載原檔，交給審查者逐項核對與重播。Claude 的環境無法下載。
4. **結果上限不變**：攻擊執行最多 `UNATTESTED`，偵測到攻擊時為 `BLOCKED`。只要有任何攻擊成功，就是驗收失敗，必須記錄並修正，不能改寫為通過。
5. 觸發方式：只用 `workflow_dispatch`，由負責人手動觸發，只在 `main` 上執行，與 `attest.yml` 相同。push 不觸發攻擊 workflow。

## 2. A10：竊取平台憑證

### 2.1 攻擊者 Adapter `adapter-b3/attackers/credential-probe.mjs`

在 hosted 沙箱內（uid 65534、沒有 capability、`env -i`、最小 rootfs）嘗試以下動作，每一項都記錄 `READ`／`WROTE`／`CONNECTED` 或 errno：

| 類別 | 目標 |
|---|---|
| 環境變數 | `ACTIONS_RUNTIME_TOKEN`、`ACTIONS_ID_TOKEN_REQUEST_URL`、`ACTIONS_ID_TOKEN_REQUEST_TOKEN`、`GITHUB_TOKEN`、`ACTIONS_CACHE_URL`、`ACTIONS_RESULTS_URL`，以及全部 `process.env` |
| `/proc` | `/proc/1/environ`、`/proc/*/environ`、`/proc/*/cmdline` 中 namespace 之外的程序 |
| runner 檔案 | runner 的安裝目錄（例如 `.credentials`、`.runner`、`_diag`）、`$RUNNER_TEMP`、`GITHUB_OUTPUT`／`GITHUB_ENV`／`GITHUB_PATH`／`GITHUB_STEP_SUMMARY`／`GITHUB_STATE`、workspace 的 `.git/config` |
| socket 與裝置 | `/var/run/docker.sock`、`/run/containerd`、`/dev` 中允許清單以外的裝置 |
| 網路 | `169.254.169.254`（metadata）、`github.com:443`、`api.github.com:443`，以及 host 上 Emulator 與代理的 port |

### 2.2 正向控制（host 端，Runner 以 root 執行）

- 在**同一個 job、同一時間**確認上述檔案與 socket 在 host 上存在，並記錄存在與否。只記存在，不記內容。
- 執行 job 本身沒有 `id-token`，所以 `ACTIONS_ID_TOKEN_REQUEST_*` 在 host 上**本來就不存在**。這兩項只能記錄「不適用」，不能當作通過的正向控制。
- 網路：host 端確認 `github.com` 可以連線（runner 有對外網路），沙箱內應為 `ENETUNREACH`。

### 2.3 預期與判定

- 預期全部讀不到、連不到；判定不受影響（`UNATTESTED`，攻擊情境）。
- 只要有任何一項讀到，或連到 namespace 外：`BLOCKED`（新原因碼 `PLATFORM_CREDENTIAL_EXPOSED`），並且不上傳攻擊者寫出的任何內容。
- 證據：每項的結果與 host 端正向控制，寫入 `isolation.json` 的攻擊附錄，以及 run summary。
- **限制**：這只能證明「這個 Adapter 在這些位置讀不到」，不能證明「沒有任何方式能取得」。

## 3. A14：選錯 artifact

### 3.1 情境（在攻擊 workflow 中）

1. **同一個 run 的誘餌**：執行 job 封存誠實案例後，再上傳一個**內容不同**的 artifact，檔名為 `decoy-POC-001.tar`，以 `archive: false` 上傳。驗證 job 在測試模式下，以誘餌 ID 當作 `artifactId` 執行下載與判定。
   - 預期：`ARTIFACT_SELECTION_MISMATCH`（檔名不是 `package-<testId>.tar`）或 `PACKAGE_DIGEST_MISMATCH`。
2. **同名誘餌**：同一個 run 的另一個 job 上傳**同名**的 `package-POC-001.tar`（內容不同）。
   - 這要先確認：`overwrite: false` 時，平台是讓上傳失敗，還是可以共存。
   - 驗證 job 必須只接受 job outputs 中的那個 ID。
3. **其他 run 的 artifact**：以前一次 run 的 artifact ID 當作 `artifactId`。
   - 預期：`download-artifact` 在本 run 找不到這個 artifact 而失敗，因此沒有判定（NOT_RUN／BLOCKED）。
   - 即使加上 `run-id` 硬是取得，`runId`／nonce 綁定也會判 `RUN_BINDING_MISMATCH`。
4. 正向控制：以正確的 ID 判定，結果與誠實路徑相同。

### 3.2 證據

每個情境保存驗證 job 的 `verify.json`（`selection`、`reasons`），以及下載步驟的 log。

## 4. A4 與 A18

### 4.1 A4：篡改 Observer／Verifier

- **透過封裝**：攻擊者 Adapter 嘗試在輸出中夾帶 `verifier.mjs`／`observer.mjs`，或在 claim 中宣稱另一個 Verifier 版本。預期：封裝的 payload 集合固定，判 `PAYLOAD_SET_MISMATCH`；claim 中的版本不會被採用。驗證 job 只 checkout 可信工具鏈，不執行封裝內的任何內容（安全解析）。
- **透過 adapterCommit**：目前 `adapterCommit` 等於工具鏈 commit（報告 §3）。Adapter 和 Verifier 是同一份程式，所以「修改 Verifier」等於「修改工具鏈」，會由批准紀錄（`TOOLCHAIN_NOT_APPROVED`）擋下。驗收方式：在單元測試與 hosted 證據中確認判定原因，不需要另外寫一個惡意的工具鏈。

### 4.2 殘餘風險：從其他分支觸發 workflow（需要負責人決定）

- `workflow_dispatch` 可以選擇任何分支，實際執行的是**那個分支的** `attest.yml`。
- 有寫入權限的人可以建立一個分支，修改 `attest.yml`，例如移除 main 限制、自行簽章，然後觸發。目前的 `if: github.ref == 'refs/heads/main'` 只保護 `main` 上的那份檔案。
- 防線：
  - 第三方驗證（A18）要求 source ref 是 `refs/heads/main`，而且 signer workflow 的 blob 是已批准的版本。這種簽章因此會被**拒絕**，但它仍然會出現在公開的透明度日誌中。
  - 提案（需要負責人在 Settings 設定）：建立 GitHub Environment `s2-attest`，只允許 `main` 部署，並讓驗證 job 使用 `environment: s2-attest`。如此一來：
    - 其他分支上的驗證 job 會被平台擋下，無法取得 OIDC；
    - OIDC 的 claim 會包含 environment，第三方驗證可以額外要求它。

  這需要修改 `attest.yml`（受保護檔案）與 Settings，**尚未核對官方文件**。

### 4.3 A18：第三方驗證腳本

新增 `poc/stage2/scripts/verify-attestation.mjs`（獨立的驗證者使用，不在 workflow 內），依序：

1. 以 `gh attestation verify statement.json --repo hsuanyu9503/class-management-next --signer-workflow hsuanyu9503/class-management-next/.github/workflows/attest.yml --source-ref refs/heads/main --format json` 驗證簽章（參數**尚未以官方文件核對**）。
2. 從結果取得 signer digest（簽章 workflow 的 commit），在該 commit 中取得 `attest.yml` 的 blob，必須是簽章當時 `active` 的 `signing-policy` 紀錄。批准紀錄取自目前經錨定的 `main`，依 §4.5。
3. subject digest 必須等於實際取得的 `statement.json` 的 SHA-256。
4. statement 內容的政策檢查：`toolchain.trustedToolchainCommit` 是 `active` 的 `toolchain` 紀錄；`targets` 等於該工具鏈的鎖定檔重算的值；`verdict.result = PASS`；`package.artifactId`／`signingPolicyBlob` 不是 null。
5. 可選：以該工具鏈重跑 Verifier，重播封裝。

### 4.4 A18 的驗收：兩個選項（需要負責人決定）

| 選項 | 做法 | 優點 | 缺點 |
|---|---|---|---|
| **a. 測試簽章** | 另一個只能手動觸發的 workflow，以 `actions/attest-build-provenance` 簽一個**固定的測試檔**（不是 statement，內容是說明文字）。分別用已批准的 workflow 與刻意不同的 workflow 簽章，以 §4.3 的腳本驗證「前者接受、後者拒絕」 | 打開 PASS 之前就能取得真正的 A18 證據 | 測試簽章會**永久**進入公開的透明度日誌（內容只是測試文字）；需要新增具簽章權限的 workflow，也就是新的受保護檔案 |
| **b. 只驗證政策邏輯** | 以單元測試與已有的公開 bundle 格式，測試 §4.3 腳本的政策判斷：blob 不在批准紀錄、ref 不是 main、subject 不符都要拒絕。實際簽章的驗收延到打開 PASS 之後的第一份 statement：第三方必須同時做正向（接受）與反向（修改批准紀錄後拒絕）驗證 | 不在公開日誌留下測試簽章；不新增簽章 workflow | 打開 PASS 之前沒有真實簽章的證據；A18 的完整驗收延後 |

Claude 建議 **b**：不在公開日誌留下測試簽章，也不增加簽章權限的範圍。但打開 PASS 的 PR 必須把「第一份簽章的正反向第三方驗證」列為合併後的立即驗收，驗收失敗就撤銷批准紀錄。最終由負責人決定。

## 5. 證據改善（同一個實作 PR）

1. **Java 版本**：改為讀取 `java -version` 的 stderr，在 hosted 上記錄實際版本（例如 Temurin 21）。單元測試以假的輸出驗證解析。
2. **完整觀察值**：每項 selfCheck 的 `observed` 仍保留 200 字元的摘要；另外在 `isolation.json` 新增 `observedFull`（完整的 JSON）與 `observedSha256`，讓審查者可以逐路徑核對。
   - statement schema 不變：statement 只記錄 digest，不放完整內容。
   - `observedFull` 也要通過遮罩掃描。

## 6. 實作與交付（核准本計畫之後）

| PR | 內容 | 受保護檔案與錨定 |
|---|---|---|
| C-1 | `attest-attack.yml`（沒有簽章權限）；A10 攻擊者 Adapter 與 host 端正向控制；A14 誘餌情境；A4 的封裝情境；`scenario` 欄位與「非 honest 不得 PASS」；§5 的證據改善；單元測試、本機模擬、mutation | 新增 workflow 與判定程式的修改都會改變錨定 digest，需要負責人重新核准 |
| C-2 | `verify-attestation.mjs`（A18 的第三方驗證腳本）與政策邏輯測試；若選擇 4.4 的 a，加上測試簽章的 workflow | 依選項而定 |
| C-3（可選） | 依 §4.2 加入 Environment `s2-attest`（需要負責人在 Settings 設定） | `attest.yml` 改變，需要重新核准錨定 |

每個 PR 都要經過 ChatGPT 審查並由負責人核准。合併後，由負責人手動觸發攻擊 workflow，下載 artifact 原檔交給審查者核對。全部完成後，才進入「批准紀錄 + 兩個變數 → 打開 PASS」的步驟（HANDOFF）。

## 7. 需要負責人決定

| # | 問題 | Claude 的建議 |
|---|---|---|
| Q-A | 攻擊情境放在**另一個沒有簽章權限的 workflow**（`attest-attack.yml`），而不是加進 `attest.yml`？ | 是 |
| Q-B | A18 採用 §4.4 的哪一個選項？ | b（只驗證政策邏輯，第一份真實簽章時做正反向驗收） |
| Q-C | 是否加入 GitHub Environment `s2-attest`，限制驗證 job 只能在 `main` 上取得 OIDC（§4.2）？ | 是，但先核對官方文件；可以晚於 C-1 |
| Q-D | 實作順序是否為 C-1 → C-2 →（C-3）？ | 是 |

## 8. 未驗證與限制

- GitHub Actions 的下列行為**尚未以官方文件核對**；Claude 的環境無法連到官方文件：
  - `workflow_dispatch` 在其他分支執行時的權限；
  - Environment 對 OIDC 的限制；
  - `overwrite: false` 遇到同名 artifact 時的行為；
  - `gh attestation verify` 的確切參數。
- A10 的攻擊只能涵蓋列出的位置；runner 內部的實作若改變，需要更新清單。
- 本計畫不涵蓋：非 root Runner、Windows、POC-009 的 G-1／G-4（維持 `BLOCKED`）、N7 的 host 來源認證、N5 的效能。
- NOTE-c 仍是「原文缺失，待確認」；缺少的 NOTE 與 X1～X10 沒有執行。
