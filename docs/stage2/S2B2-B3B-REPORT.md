# S2-B2 第 3 批 B3b｜受控執行 workflow、批准紀錄與信任根閘門（PR-2）

> 依據：`S2B2-B3-PLAN.md` v0.3 §3.1、§3.4、§4、§7.2、§7.3、§9.4、§9.5；`S2B2-B3-DECISION-SUMMARY.md` B 節。
> 負責人 2026-11-21 決定：
> - Q-1、Q-2、Q-3 採推薦方案；
> - 分兩個 PR（PR-1 已合併為 `bda85b2`）；
> - artifact 保存 30 天；
> - action 以官方 tag 解析出的完整 SHA 固定；
> - PR-2 維持 `PASS_ENABLED=false`；
> - 執行 job 以 sudo 執行 Runner。
>
> **本 PR 不能產生 PASS**，也不設定任何 repository variable、secret、OIDC 或 Settings。

## 1. 做了什麼

| 項目 | 內容 | 位置 |
|---|---|---|
| workflow | `attest.yml`，見下方說明 | `.github/workflows/attest.yml` |
| 執行 job | 由 checkout 可信工具鏈，到上傳封裝為止的完整流程，見下方說明 | 同上；`poc/stage2/scripts/run-attest-execute.mjs`、`attest-outputs.mjs`；`test/b3-run.mjs` 的單一案例模式 |
| 驗證 job | 由 checkout 可信工具鏈、核對錨定，到判定、簽章與上傳為止的完整流程，見下方說明 | `src/b3/attest-verify.mjs`、`scripts/attest-verify.mjs`、`scripts/attest-delivery.mjs` |
| 信任根閘門 | `src/b3/trust-policy.mjs` 嚴格解析批准紀錄。兩個變數都必須指向 `active` 的紀錄；實際跑的 commit 必須等於工具鏈變數；實際跑的 `attest.yml` blob 必須等於簽章政策變數 | `src/b3/trust-policy.mjs` |
| Verifier 判定 | PASS 必須同時符合：GitHub-hosted runner（以驗證 job 自己的環境為準）、信任根已設定、`PASS_ENABLED`。每個缺少的條件都會寫成原因碼。本機執行的原因不變：`[LOCAL_UNTRUSTED_RUNNER, TRUST_ROOT_NOT_CONFIGURED]`。版本為 `s2-verifier-b3b-0` | `src/b3/verifier.mjs` |
| 批准紀錄 | `S2B2-TRUST-POLICY.json`，**目前沒有任何批准**（`records: []`） | `docs/stage2/` |
| 受保護清單 | 加入 12 個檔案：`attest.yml`、批准紀錄、沙箱啟動器、隔離政策、Verifier、reconcile、封裝、信任政策、驗證 job 邏輯與 CLI、Observer、verdict（29 → **41** 檔） | `scripts/verify-anchor.mjs` |
| repo_policy | workflow 清單改為 `attest.yml`、`ci.yml`。新增 `attest.yml` 的結構測試，涵蓋：<br>- 觸發條件與 main 限制；<br>- 逐 job 權限；<br>- 完整 SHA；<br>- 只有 PASS 才簽章；<br>- `persist-credentials: false`；<br>- 30 天保存；<br>- 不用 secrets；<br>- `run:` 不內嵌表達式 | `tests/repo_policy.test.mjs` |
| CLAUDE.md | 頁首的 workflow 說明與受保護清單說明 | `CLAUDE.md` |

**`attest.yml` workflow**：

- 觸發：只有 `push` 到 `main` 與 `workflow_dispatch`，不用 `pull_request*`。
- 最上層 `permissions: {}`；`execute` 加上 `if: github.ref == 'refs/heads/main'`。
- 每次執行只跑一個案例：push 時是 POC-001；手動觸發可選 POC-001／002／008／009。
- `concurrency` 不平行執行。

**執行 job**（`contents: read`）依序：

1. checkout 可信工具鏈：`vars.CMN_S2_TRUSTED_TOOLCHAIN_SHA`；未設定時用本 commit，結果必為 UNATTESTED。
2. 安裝 Node 22 與 Java 21，執行 `npm ci`。
3. 以 sudo 執行 `run-attest-execute.mjs`：一個誠實案例、沙箱、封存、遮罩掃描。有任何洩漏就不交出封裝。
4. 以非 root、獨立的步驟寫入 job outputs。這時 Adapter 的命名空間已經終止。
5. 以 `archive: false` 上傳單一原始封裝檔，保存 30 天。

**驗證 job**（`contents: read`、`id-token: write`、`attestations: write`）依序：

1. checkout 同一個可信工具鏈（`fetch-depth: 0`）。
2. 另外 checkout 目前的 `main`，只讀批准紀錄。
3. 依 artifact ID 下載封裝。
4. 以 `attest-verify.mjs` 判定。
5. **只有 `result == 'PASS'`** 才以 `attest-build-provenance` 簽 `statement.json`。
6. 寫交付紀錄 `delivery.json`（不是證據），並上傳 statement 與未簽章的診斷，保存 30 天。

**驗證 job 的可信輸入**（plan §7.2）：

| 欄位 | 來源 |
|---|---|
| `runId`、`runAttempt` | 本次 workflow run（`GITHUB_RUN_ID`、`GITHUB_RUN_ATTEMPT`）。執行 job 的封裝必須綁定同一個 run |
| `packageSha256`、`manifestSha256`、`attestationNonce`、`platformSupported`、`artifactId` | 執行 job 的 outputs |
| `trustedToolchainCommit` | 驗證 job 自己 checkout 的 commit；執行 job 回報的 commit 必須相同，否則 `TOOLCHAIN_COMMIT_MISMATCH` |
| `runnerKind` | 驗證 job 自己的 `GITHUB_ACTIONS`／`RUNNER_ENVIRONMENT` |
| 信任根 | 批准紀錄取自**目前的 `main`**，不取自工具鏈或 artifact（§4.5）。這份 `main` 的受保護檔案 digest 由可信工具鏈的 `anchorListing` 計算，必須等於 `CMN_STAGE1_ANCHOR_SHA256`，否則 `TRUST_POLICY_NOT_ANCHORED`。`attest.yml` 的 blob 取自 `github.workflow_sha` |
| A14 artifact 選取 | 下載目錄必須**正好一個**一般檔，名稱為 `package-<testId>.tar`，artifact ID 必須是數字，否則 `ARTIFACT_SELECTION_MISMATCH`。另外 download-artifact 在 digest 不符時預設會失敗（`digest-mismatch: error`） |

## 2. 官方 action 的固定版本

由 `git ls-remote` 唯讀查詢官方 tag 取得（負責人同意），並逐一下載該 commit 的 `action.yml`，核對使用的 inputs／outputs 確實存在：

| action | tag | commit SHA | 使用的 inputs／outputs |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | `ref`、`fetch-depth`、`path`、`persist-credentials` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | `node-version` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | `path`、`name`、`archive`、`retention-days`、`if-no-files-found`、`overwrite`；output `artifact-id` |
| `actions/download-artifact` | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | `artifact-ids`、`path`（`digest-mismatch` 預設 `error`） |
| `actions/attest-build-provenance` | v4.2.2 | `4d101475d8b20a2381f78447822ac1eab6504dd8` | `subject-path`；output `attestation-id`（內部使用 `actions/attest@508db95…`，v4.2.1） |

annotated tag 已解析到實際的 commit（`^{}`）。

**未核對**：

- 這些版本在 hosted runner 上的實際行為；
- `archive: false` 上傳後再以 `artifact-ids` 下載時的檔名；
- `actions/attest` 的內部行為。

第一次在 `main` 上執行時才會得到證據。

## 3. 與計畫的差異（需要審查）

| 項目 | 計畫 | 實作 | 原因 |
|---|---|---|---|
| 批准紀錄的初始內容 | §4.3 第 3 步：B3b PR 記錄 `toolchain = M1`（B3a 合併） | **沒有任何紀錄** | PR-2 本身修改了 Runner 與 Verifier，實際執行的工具鏈是 PR-2 的合併 commit（M2），PR 內無法得知。toolchain 與 signing-policy 兩筆紀錄都要在 M2 之後，由負責人以只改紀錄的 PR 加入 |
| `adapterCommit` | workflow 輸入；必須是 `main` 的祖先 | **等於可信工具鏈 commit**（Adapter 程式在同一個 repository 的 `adapter-b3/`） | 支援不同的 Adapter commit 需要另外 checkout Adapter，範圍較大；列為後續 |
| 每次執行的案例數 | 未規定 | 每次一個案例 | matrix job 的 outputs 會互相覆寫，無法一對一交給驗證 job；分開執行可保持綁定單純 |
| 在 `main` 提交 statement 摘要（Q-3） | 方向：提交 | **未實作** | 需要 `contents: write` 並推送到受保護的 `main`（ruleset 要求 PR）。改為上傳 artifact 保存 30 天；摘要提交列為後續（人工 PR） |
| 政策新鮮度上限（§4.5） | 24 小時 | 每次驗證都直接讀目前的 `main`，所以一定是新的；`freshnessHours` 只記在紀錄中，給離線驗證使用 | — |
| 受保護清單 | 6 類檔案 | 12 個檔案 | 加入 reconcile、封裝、信任政策、驗證 job 的邏輯與 CLI、verdict：它們都直接決定判定。其他工具鏈程式由已批准的工具鏈 commit 固定 |
| 錨定的比對方式 | — | 以**可信工具鏈的**受保護清單計算 `main` 的 digest | 如果之後 `main` 的受保護清單改變，就必須同時批准新的工具鏈，否則判 `TRUST_POLICY_NOT_ANCHORED`。這是刻意的 fail closed |

## 4. 負責人的步驟（Claude 不代設）

| 時點 | 步驟 | 結果 |
|---|---|---|
| **合併 PR-2 之前** | 檢查 41 個受保護檔案的清單（`node scripts/verify-anchor.mjs --print`），把 `CMN_STAGE1_ANCHOR_SHA256` 改為新的 digest（見 PR 說明），再 Re-run `baseline-anchor` | 在此之前，PR-2 的 `baseline-anchor` 必定失敗（設計如此） |
| 合併後（M2） | push 會自動觸發 `attest.yml`，執行 POC-001 | 第一份 hosted runner 證據。兩個變數都還沒設定，所以結果是 `UNATTESTED`，原因為 `TRUST_ROOT_NOT_CONFIGURED`，不簽章 |
| 檢視第一次執行之後 | 只改紀錄的 PR：加入 `toolchain = M2` 與 `signing-policy = M2 中 attest.yml 的 blob SHA`；重新核准錨定；設定 `CMN_S2_TRUSTED_TOOLCHAIN_SHA`、`CMN_S2_SIGNING_POLICY_BLOB` | 結果變為 `UNATTESTED`，原因為 `PASS_NOT_ENABLED`，仍然不簽章 |
| hosted 證據審查後 | 另一個小 PR 打開 `PASS_ENABLED` | 這時才可能 `PASS` 並簽章 |

blob SHA 的取得方式（在 M2 的 checkout 中執行）：

```bash
git rev-parse M2:.github/workflows/attest.yml
```

## 5. 第三方驗證（**未以官方文件核對**；PASS 打開後才適用）

依 plan §7.3。以下指令參數取自審查者轉述的 `gh attestation verify` 文件，Claude 沒有連線核對：

```bash
gh attestation verify statement.json --repo hsuanyu9503/class-management-next --signer-workflow hsuanyu9503/class-management-next/.github/workflows/attest.yml --source-ref refs/heads/main
```

另外必須核對下列三項（只比對 workflow 路徑與 ref 不夠；A18）：

- signer digest 對應的 commit 中，`attest.yml` 的 blob 是簽章當時 `active` 的 `signing-policy` 紀錄；
- `statement.json` 的 `toolchain.trustedToolchainCommit` 是 `active` 的 `toolchain` 紀錄；
- `verdict.result = PASS`。

## 6. 攻擊矩陣的狀態

| # | 本 PR 的處理 | 驗證 |
|---|---|---|
| A4 篡改 Observer／Verifier | 驗證 job 只 checkout 可信工具鏈；Observer 與 Verifier 列入受保護清單 | repo_policy 結構測試；hosted 執行尚未發生 |
| A10 竊取平台憑證 | `GITHUB_OUTPUT`／`ENV`／`PATH`／`STEP_SUMMARY`／`STATE` 都列入 `OUTPUT_CHANNELS_HIDDEN`；執行 job 沒有 `id-token`；checkout 不保留憑證 | **NOT_RUN**（需要 hosted 執行） |
| A14 選錯 artifact | `ARTIFACT_SELECTION_MISMATCH`（6 種情況）；依 ID 下載 | 單元測試；hosted 執行尚未發生 |
| A18 未批准的簽章政策 | `SIGNING_POLICY_BLOB_MISMATCH`、`SIGNING_POLICY_NOT_APPROVED` | 單元測試；第三方驗證要等 PASS 打開後 |

## 7. 證據界線與 NOT_RUN

- 本 PR 的所有測試都在 Claude 的本機執行。`attest.yml` **從來沒有在 GitHub 上執行過**：它只在 `main` 觸發，合併後才會第一次執行。
- 以下都是**未驗證**：
  - hosted runner 能否以 root 建立命名空間、`pivot_root` 與 tmpfs；
  - Java 21 的路徑；
  - firebase-tools 在 hosted runner 上能否下載 Emulator；
  - artifact 的實際檔名；
  - job outputs 是否會被平台原樣交付。
- 第一次執行如果在任何一步失敗，就不會產生封裝，也不會有判定；這種情況是 NOT_RUN，不是 PASS。
- 仍然保留：
  - `PASS_ENABLED=false`；
  - POC-009 仍是 `BLOCKED`；
  - `pathMapDigest` 只檢查自洽；
  - N5 沒有做效能驗收；
  - NOTE-c 仍是「原文缺失，待確認」；
  - 缺少的 NOTE ①～⑦ 與 X1～X10 沒有執行。
- 已知不一致：`docs/DESIGN.md` 等 PoC 文件的頁首仍寫「唯一的 workflow 是 `ci.yml`」，本 PR 只更新了 `CLAUDE.md`。
