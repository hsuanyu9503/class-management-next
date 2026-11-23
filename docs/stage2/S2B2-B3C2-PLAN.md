# S2-B2 第 3 批 C-2｜第三方驗證（A18）與隔離的測試簽章：計畫 v0.2（草案）

> 狀態：**草案，尚未核准實作**。依 `S2B2-B3C-ATTACK-PLAN.md` v0.4 §5 與負責人的決定 Q-B「流程 I」（2026-11-22）。
> 本計畫不授權開啟 PASS、簽章、更改 Settings 或觸發任何 workflow。`PASS_ENABLED=false` 維持不變。
> v0.2：納入 PR #15 審查（Reviewed Head `dbe6562`）的 C-2 實作備註與官方來源，見 §10。審查者認為方向可採用；這**不是** C-2 的程式或真實簽章驗收。

## 0. 前提與範圍

- C-1 的 hosted 證據已收尾（`S2B2-B3C-REPORT.md` §12）。
- C-2 只做兩件事：
  1. 第三方驗證腳本 `poc/stage2/scripts/verify-attestation.mjs`（攻擊計畫 §5.1），加上單元測試；
  2. 流程 I 的隔離測試簽章 workflow `.github/workflows/attest-sigtest.yml`（攻擊計畫 §5.2），以及它的「測試身分政策」。
- 不在範圍內：
  - 開啟 PASS；
  - 修改 `attest.yml` 的簽章條件；
  - C-3（Environment `s2-attest`）；
  - 非阻擋追蹤項目的處理方式，見 §7 與 Q1。

## 1. 可行性掃描的結果

| 項目 | 現況 | 對 C-2 的影響 |
|---|---|---|
| 正式簽章 | `attest.yml` 只在 `PASS` 時用 `actions/attest-build-provenance@4d10147…`（v4.2.2）簽 `statement.json` | 第三方驗證的對象是 SLSA provenance 證明，subject 是 `statement.json` |
| 批准紀錄 | `S2B2-TRUST-POLICY.json` 目前沒有任何紀錄（`records: []`）。`trust-policy.mjs` 的 parser 要求 `revoked` 有 `validTo`、`active` 沒有 `validTo` | 需要新增「簽章時間有效」的判定（§2.3）。parser 目前**沒有**檢查 `validTo > validFrom`，要補上 |
| `gh` 版本 | 本環境是 `gh` 2.89.0，低於 v2.102.0（GHSA-wjmr-j3rp-mh2g）。另外，本 session 規則限定 `gh` 只能用於搜尋 | Claude **無法**在本環境執行真正的 `gh attestation verify`。腳本的 `gh` 呼叫層只能用單元測試涵蓋（注入假的執行結果）。真實驗證由第三方（審查者或負責人）用 v2.102.0 以上的 `gh` 執行 |
| `gh attestation verify --format json` 的欄位 | Claude 無法連線查官方文件 | §2.2 列出預定使用的欄位，**需要審查者以官方文件確認**，再開始實作 |
| 錨定 | `scripts/verify-anchor.mjs` 計算受保護檔案的 digest（C-1f 之後為 85 檔；C-2 新增檔案後重新計算） | 第三方腳本重用同一個函式。被比對的核准值要怎麼取得，屬於決策（Q2） |

## 2. `verify-attestation.mjs` 的設計

### 2.1 分層

- **純函式核心** `poc/stage2/src/b3/third-party.mjs`：
  - 沒有 I/O，所有外部結果都由參數注入；
  - 輸入：
    - `gh` 驗證成功後輸出的 JSON；
    - `statement.json` 的位元組；
    - 預期的身分（repo、workflow 路徑、source ref）；
    - signer commit 中 `attest.yml` 的 blob 查詢結果；
    - 政策文字、政策來源 commit、取得時間、錨定比對結果；
    - 工具鏈鎖定檔重算的 `targets`；
    - 目前時間；
  - 輸出：`{ result, reasons[], evidence }`。`result` 只有三種：
    - `ACCEPTED`；
    - `REJECTED`；
    - `REVOCATION_STATUS_UNKNOWN`（政策已過期；**不是**接受）。
- **CLI 外殼** `poc/stage2/scripts/verify-attestation.mjs`：
  - 用 `execFile` 執行外部程式，不經過 shell；
  - 依序：
    1. 檢查 `gh --version` ≥ 2.102.0，不足就拒絕執行；
    2. 執行 `gh attestation verify <statement.json> --repo hsuanyu9503/class-management-next --signer-workflow hsuanyu9503/class-management-next/.github/workflows/attest.yml --source-ref refs/heads/main --format json`。**只有**退出碼為 0 時才解析輸出，其他情況一律 `REJECTED`；
    3. 在第三方自己的 clone 中執行 `git rev-parse <signerDigest>:.github/workflows/attest.yml`，取得 blob；
    4. 用 `git show <commit>:<path>` 讀取該工具鏈的鎖定檔，重算 `targets`；
    5. 在 `main` 的 checkout 上計算受保護檔案的 digest，與核准值比對；
  - 都不執行 artifact 或 statement 的內容。

### 2.2 使用的 `gh` JSON 欄位（v0.2：審查者已依官方文件確認欄位名稱與階層，見 §10）

| 用途 | 欄位（陣列中的每一份） |
|---|---|
| signer workflow 與 ref | `verificationResult.signature.certificate.buildSignerURI`：形式為 `https://github.com/<repo>/<path>@<ref>` |
| signer commit | `verificationResult.signature.certificate.buildSignerDigest` |
| source ref／repo | `…certificate.sourceRepositoryRef`、`…certificate.sourceRepositoryURI` |
| 可信時間 | `verificationResult.verifiedTimestamps[].timestamp`。來源可能是透明度日誌或 timestamp authority；實作時記錄每一筆的 type／來源 |
| subject | `verificationResult.statement.subject[].digest.sha256`。digest 的演算法鍵依實際 artifact 而定，本專案明確要求 `sha256` |

- 欄位缺少、型別不符、無法解析時，一律 `REJECTED`。
- 身分只取自憑證（`signature.certificate`）與可信時間。predicate 的內容可能受 workflow 影響，**不得**用來判定身分。

### 2.3 判定規則（對應攻擊計畫 §5.1）

1. **多份證據**：
   - 對 `gh` 回傳、已驗證的證據集合**逐筆**檢查。這是本專案的保守政策，不宣稱已窮舉平台上所有可能的證據；
   - 陣列至少一份；
   - **每一份**都要通過 2～6，任何一份不符就整體 `REJECTED`。
2. **身分**：
   - 從 `buildSignerURI` 解析出 repo、路徑與 ref。路徑必須**完全等於** `.github/workflows/attest.yml`（字串相等，不做前綴比對），ref 必須**大小寫一致地**等於 `refs/heads/main`。`gh` v2.102.0 已修正前綴與大小寫問題，核心仍自己做完整比對；
   - `sourceRepositoryRef` 也必須是 `refs/heads/main`；
   - repo 必須是 `hsuanyu9503/class-management-next`。
3. **簽章政策**：signer commit 中 `attest.yml` 的 blob，必須對應一筆 `signing-policy` 紀錄，而且在**簽章時間有效**（第 5 點）。
4. **statement 綁定**：
   - subject digest 等於實際 `statement.json` 的 SHA-256；
   - `toolchain.signingPolicyBlob` 等於第 3 點的 blob；
   - `toolchain.trustedToolchainCommit` 對應的 `toolchain` 紀錄在簽章時間有效；
   - `targets` 等於重算值；
   - `verdict.result = PASS`、`scenario = honest`；
   - `package.artifactId` 與 `signingPolicyBlob` 不是 null；
   - statement 的欄位名稱，實作時以 `S2B2-B3-attestation-statement.draft.json` 為準。
5. **簽章時間有效**：攻擊計畫 §5.1 步驟 4a，對兩種紀錄一致套用：
   - 狀態是 `active`，或 `revoked` 且 `invalidateIssued` 不是 `true`；
   - `validFrom ≤ t`；有 `validTo` 時 `t < validTo`；
   - `invalidateIssued: true` → 一律拒絕；
   - 格式錯誤（缺少 `validTo` 的 `revoked`、時間無法解析、`validTo ≤ validFrom`）→ 拒絕；
   - **可信時間**（v0.2；Q4）：
     - `verifiedTimestamps` 必須是**非空**陣列。空陣列一律 `REJECTED`，不得用空集合的 `every()` 結果當作有效；
     - 每一筆的 `timestamp` 都必須存在且可以解析，否則 `REJECTED`；
     - **每一筆**都必須落在有效區間內（fail closed）；
     - 記錄採用的每一筆時間與它的 type／來源；
     - 這些是可信的觀測時間，不宣稱等於實際簽署的瞬間。
6. **政策的來源與新鮮度**：
   - 核准的錨定值由外部參數 `--anchor` 提供（Q2），**不得**從待驗證的 checkout 自行取得；
   - 政策取自已錨定的 `main`，錨定比對失敗 → `REJECTED`；
   - 記錄：核准值的來源、政策檔的 SHA-256、政策來源 commit、實際取得時間、驗證時使用的時鐘；
   - 取得時間是實際從遠端取得 `main` 的時間。讀取已存在的舊 checkout，**不**當成剛取得的新政策；
   - 超過 `freshnessHours` → `REVOCATION_STATUS_UNKNOWN`。
7. **反向測試**只修改本機的政策複本，不修改正式的批准紀錄。
   - 政策複本只能透過明確的**測試介面**注入（純函式核心的參數，或只供測試的入口）；
   - 一般 CLI 參數**不能**改掉正式 profile 寫死的政策來源與路徑限制。
8. **交付紀錄**：保存實際的 `gh` 版本、參數、退出碼與輸出，供審查。

`trust-policy.mjs` 的改動：

- 新增純函式 `validAt(record, tMs)`；
- parser 補上 `validTo > validFrom` 的檢查；
- `evaluateTrust`（Runner 產生新證明時的門檻，要求**目前** `active`）維持原語義。

### 2.4 `--profile sigtest`（流程 I 的密碼學與身分層）

- 預期路徑改為 `.github/workflows/attest-sigtest.yml`；
- 政策改用測試身分政策（§3.2）；
- **檔案綁定**（v0.2）：
  - 驗證的對象是已核准的固定 `SIGTEST.txt` 的位元組，它的 SHA-256 寫死在程式中；
  - `gh` 必須對這個實際檔案完成驗證，核心再確認 subject digest 等於該值；
  - 不做的只有**正式業務 statement** 的欄位檢查（第 4 點的 PASS／honest／targets 等），subject 綁定照做。
- 其餘仍然要求：正確的 signer workflow blob、測試政策、可信時間（第 5 點）、新鮮度與錨定（第 6 點）。
- 輸出只有三種：`SIGTEST_IDENTITY_ACCEPTED`、`REJECTED`、`REVOCATION_STATUS_UNKNOWN`。
  - 只有 `SIGTEST_IDENTITY_ACCEPTED` 以狀態 0 退出，其他兩種都以非零狀態退出；
  - **不得**出現 `PASS` 或「正式 statement 被接受」。
- 正式 profile 與 sigtest profile 的政策檔、預期路徑都寫死在程式中，不能用參數混用。

## 3. `attest-sigtest.yml`（流程 I）

### 3.1 workflow

- 觸發：只有 `workflow_dispatch`；job 條件為 `github.ref == 'refs/heads/main'`。
- 權限：
  - workflow 層級 `permissions: {}`；
  - job 層級只有 `contents: read`、`id-token: write`、`attestations: write`。
- 步驟只有兩個：
  1. checkout（`persist-credentials: false`）；
  2. 使用與 `attest.yml` **相同 SHA** 的 `actions/attest-build-provenance`，`subject-path` 固定為 `poc/stage2/sigtest/SIGTEST.txt`。
  - 不安裝依賴，不執行 Adapter 或任何專案程式，不上傳其他 artifact。
- `concurrency` 設定為不重疊。
- `SIGTEST.txt` 是固定的說明文字，例如「這是 C-2 流程 I 的測試簽章，不是 statement，不代表任何 PASS」。內容寫死，`repo_policy` 測試檢查它的 digest。

### 3.2 測試身分政策 `docs/stage2/S2B2-SIGTEST-POLICY.json`

- 與正式批准紀錄**分開**，正式的 `S2B2-TRUST-POLICY.json` 不變。
- 格式與正式政策相同，`policyVersion` 為 `s2-sigtest-policy-v1`，只接受 `signing-policy` 紀錄，對象是 `attest-sigtest.yml` 的 blob。
- 這份 blob 可以在 PR 中事先算出。紀錄是否放在同一個 PR，以及由誰核准，屬於決策（Q3）。

### 3.3 驗收（合併之後，由負責人手動觸發一次）

- **正向**：第三方用 `--profile sigtest` 驗證那一份測試簽章 → `SIGTEST_IDENTITY_ACCEPTED`。
- **反向**（只用本機的政策複本或參數）：
  - 用正式 profile（預期 `attest.yml`）驗證測試簽章 → `REJECTED`；
  - 共用前綴的路徑（`attest-sigtest.yml.bak`、`attest-sigtest.yml-evil`）→ `REJECTED`；
  - 從政策複本移除該 blob 的紀錄，或改為 `invalidateIssued: true` → `REJECTED`；
  - 政策取得時間超過 24 小時 → `REVOCATION_STATUS_UNKNOWN`。
- statement 層（§2.3 第 4～7 點）只用單元測試驗收（流程 I 的分層）。
- 代價（攻擊計畫 §5.2 已列出）：
  - 測試簽章會**永久**留在公開的透明度日誌，內容是測試文字；
  - 新增一個具有簽章權限的 workflow。

## 4. 受保護檔案與錨定

- 新增到保護範圍：
  - `verify-attestation.mjs`；
  - `src/b3/third-party.mjs`（已在 `poc/stage2/src` 的保護樹內）；
  - `attest-sigtest.yml`；
  - `sigtest/SIGTEST.txt`；
  - `S2B2-SIGTEST-POLICY.json`。
- `trust-policy.mjs` 的修改也會改變 digest。
- 合併前需要負責人重新核准 `CMN_STAGE1_ANCHOR_SHA256`。Claude 不會設定這個變數。
- `tests/anchor_coverage.test.mjs` 會檢查新檔案的 import closure 都在保護範圍內。

## 5. 測試

- **單元測試**（攻擊計畫 §5.1 列出的全部，另加以下各項）：
  - 共用前綴的路徑；
  - 多份證據中一份不符；
  - 有效區間的邊界（`signing-policy` 與 `toolchain` 各一組：`t < validFrom`、`t = validFrom`、`t` 在 `validTo` 之前、`t = validTo`、`t` 在撤銷之後）；
  - 正常退役；
  - `invalidateIssued=true`；
  - 政策過期；
  - blob 與 signer commit 不符；
  - 非 honest；
  - 額外：
    - `gh` 退出碼不是 0 時不解析輸出；
    - 版本低於 2.102.0 時拒絕執行；
    - 欄位缺少或型別不符；
    - 零份證據；
    - 多個時間戳中有一個落在區間外；
    - `validTo ≤ validFrom`；
    - sigtest 標籤不會出現 PASS；
    - 兩個 profile 不能混用。
    - v0.2：`verifiedTimestamps` 為空陣列、缺少欄位、時間無法解析、多筆中有一筆在區間外、區間邊界；
    - v0.2：sigtest 的檔案 digest 不符；sigtest 三種輸出的退出碼；
    - v0.2：`--anchor` 缺少或不符；ref 大小寫不同（`refs/heads/Main`）；
    - v0.2：一般 CLI 參數無法改掉正式 profile 的政策與路徑；
    - v0.2：parser 用官方格式的輸出樣本測試（合成資料，不等於真實驗證）。
- **`repo_policy`**：
  - `attest-sigtest.yml` 只有 `workflow_dispatch`、只在 `main` 執行；
  - 權限集合固定；
  - 只有一個 `attest-build-provenance` 步驟，SHA 與 `attest.yml` 相同，`subject-path` 固定；
  - 沒有 `npm`／`node` 或其他執行步驟；
  - `SIGTEST.txt` 的 digest 固定。
- **mutation**：沿用 C-1 的做法，涵蓋路徑比對、區間邊界、多份規則、新鮮度與 profile 隔離。
- 本機無法執行真正的 `gh attestation verify`（§1），這部分標為「未執行，由第三方 hosted 後驗證」。

## 6. 交付順序

1. 審查本計畫（L3），負責人決定 §8 的問題；
2. Claude 實作 C-2，送 PR 與審查證據包；
3. ChatGPT 審查；負責人核准錨定與合併；
4. 負責人手動觸發 `attest-sigtest.yml` 一次；
5. 第三方用 v2.102.0 以上的 `gh` 執行 §3.3 的正向與反向驗證，並交付輸出；
6. 記錄 C-2 的驗收結果，之後才進入 C-3。

順帶修正：攻擊計畫 §5.2 流程 II 的 `ACCEPTANCE_PENDING` 措辭（v0.3 複審的實作備註），限縮為「依目前政策追溯否決已發出、原本有效的證明時，可使用 `invalidateIssued`」。這只是文件修正，不改變流程 I 的決定。

## 7. 非阻擋的 C-1 追蹤項目

| 項目 | 內容 |
|---|---|
| A14-1b 標籤 | Verifier 以 `PACKAGE_DIGEST_MISMATCH` 以外的前置條件錯誤擋下時，改判 `INCONCLUSIVE`，保留原 reason code，仍以非零狀態退出 |
| `attest.yml` 可用性診斷 | 下載失敗時保存有上限的 ID、清單與錯誤診斷；評估同一個 run 重跑或新增上傳者時的同名情況 |

兩項都會改變受保護檔案（錨定），處理方式見 Q1。

## 8. 需要負責人決定

> **負責人的決定（2026-11-23）**：「4項都依妳建議的方式執行」
>
> | 問題 | 決定 |
> |---|---|
> | Q1 | 兩個追蹤項目另開小 PR（C-1f），在 C-2 之前處理 |
> | Q2 | 第三方以參數 `--anchor` 提供核准的錨定值，取自負責人公開的紀錄；輸出記錄來源 |
> | Q3 | 測試身分政策的紀錄由 Claude 在 C-2 PR 中提出，由負責人以明確的合併指示核准 |
> | Q4 | 多個時間戳時，**每一個**都必須落在有效區間內（fail closed） |
>
> 這些決定不取代 ChatGPT 對本計畫的審查。C-2 的實作要等本計畫審查通過才開始。


| # | 問題 | Claude 的建議 |
|---|---|---|
| Q1 | §7 的兩個追蹤項目怎麼處理？ | **另開一個小 PR（C-1f），在 C-2 之前處理**。範圍小、與 A18 無關，分開審查比較清楚。代價是多一次錨定核准。另一個選項是併入 C-2，或延後到 C-3 之後 |
| Q2 | 第三方要比對的「負責人核准的錨定值」從哪裡取得？ | 由第三方以參數 `--anchor` 提供，值取自負責人公開的紀錄（例如 HANDOFF 或 PR 留言中的值），輸出會記錄來源。repository variable 需要權限才能讀取，不假設第三方讀得到 |
| Q3 | 測試身分政策中 `attest-sigtest.yml` blob 的紀錄怎麼建立？ | Claude 在 C-2 PR 中提出這筆紀錄（`approvedBy` 為負責人，`reviewRef` 為該 PR），由負責人以明確的合併指示核准；或負責人在合併後另開 PR 加入。正式的 `S2B2-TRUST-POLICY.json` 不受影響 |
| Q4 | 簽章時間有多個時間戳時，是否要求**每一個**都落在有效區間內？ | 是（fail closed）。若審查者認為應改為取透明度日誌的某一個特定時間，請指出依據 |

## 9. 未驗證與限制

- 官方文件的事實由審查者查核（§10），Claude 的環境無法連線。查核的是文件與格式，不是執行 `gh attestation verify`。
- 真實的 `gh attestation verify` 只能由第三方執行（§1）。官方輸出樣本可以用於 parser 的單元測試，但合成 JSON 的測試**不等於**真實的密碼學驗證；正向與反向驗收仍需要已修補版本的 `gh` 與真實的測試簽章。
- 流程 I 的 sigtest 只驗證密碼學與身分層。它**不是**正式 PASS statement 被接受的證據。
- C-2 完成後，PASS 仍然關閉。打開 PASS 需要另一個 PR、新的工具鏈 commit、批准紀錄、兩個指標與錨定，並重新審查。
- N5、N7、main 摘要、NOTE-c（原文缺失，待確認）、POC-009 BLOCKED、Stage 1 的 72 筆 NOT_RUN 都不受影響。

## 10. v0.2 對應表（PR #15 審查，Reviewed Head `dbe6562`）

審查者依官方文件確認（文件與格式查核，不是執行驗證）：
- `gh` v2.102.0 修正 `--signer-workflow` 的前綴比對與 `--source-ref` 的大小寫比對：
  - https://github.com/cli/cli/releases/tag/v2.102.0
  - GHSA-wjmr-j3rp-mh2g、GHSA-4mq3-hpgx-9cx8
- `--format json` 成功時輸出陣列，每筆有 `attestation` 與 `verificationResult`；後者包含 `signature.certificate`、`verifiedTimestamps`、`statement`。predicate 可能受 workflow 影響，不能用來判定身分：
  - https://cli.github.com/manual/gh_attestation_verify
- `buildSignerURI`、`buildSignerDigest`、`sourceRepositoryURI`、`sourceRepositoryRef`、`verifiedTimestamps[].timestamp` 的名稱與階層：
  - https://github.com/sigstore/sigstore-go/blob/main/docs/verification.md

| 備註 | 處理 | 位置 |
|---|---|---|
| 1. 時間戳的語義與空集合 | 來源可能是透明度日誌或 TSA；陣列必須非空；每筆可解析；每筆都在區間內；記錄 type／來源；不宣稱等於實際簽署瞬間 | §2.2、§2.3 第 5 點；§5 測試 |
| 2. sigtest 的檔案綁定與結果狀態 | 固定 `SIGTEST.txt` 的 digest 綁定照做；三種輸出；只有接受以狀態 0 退出 | §2.4 |
| 3. 政策取得與錨定 | 外部 `--anchor`；記錄來源、hash、commit、取得時間、時鐘；舊 checkout 不算新取得；政策複本只能透過測試介面注入；83 檔更新為 85 檔 | §1、§2.3 第 6～7 點 |
| 4. 真實驗證與單元測試的分層 | 逐筆檢查是保守政策，不宣稱窮舉；保存 `gh` 的版本、參數、退出碼與輸出；合成 JSON 不等於真實驗證 | §2.3 第 1、8 點；§9 |
| 非阻擋：A14-1b 的語義 | 現在非 BLOCKED 的結果也包含 Verifier 的 FAIL。之後擴充攻擊資料時，依該案例受測的不變條件解釋，不一律寫成「已正式接受」 | 記錄於 REVIEW_LOG；不改程式 |
| 非阻擋：診斷的大小 | 輸出有上限，但讀取 log 時的位元組數沒有上限，列為後續強化 | 記錄於 REVIEW_LOG；不改程式 |

