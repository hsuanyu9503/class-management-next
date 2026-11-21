# S2-B2 第 3 批｜受控執行器、Verifier、信任根與隔離：計畫與決策包 v0.1（草案）

> **狀態：設計與決策包，未實作。** 本文件沒有任何 workflow、OIDC、簽章、Verifier 或隔離實作；沒有修改 repository 設定、外部錨定或 Stage 1 基準。所有結果維持 `UNATTESTED`／`BLOCKED`，沒有 `PASS`。
> 基準：`main` = `40c09a3fb92b0c699a2b00dda1da5b2a32b468a4`（PR #5 合併；最後 PR Head `85a0bb4b40d9cf2ff030c1d95f70513cad9a57fd`，兩者無檔案差異；最後程式審查 Head `d2dafe16ba488df60e6a2340ad9cd075c691ed2a`）。
> 依據：`S2B2-ADAPTER-PLAN.md` §4（第 3 批進入條件：D-17 決定；CI 變更的錨定重新核准）、`S2B2-ATTESTATION.md` v0.2 §3、§5、§9、§10、`S2B2-B2-PLAN.md`。
> 使用者「繼續」代表**開始準備**，不代表已選定信任根、核准 CI 權限或變更錨定。本文件的每一項選擇都是**提案**。

## 0. 摘要

- 第 3 批要做的是：讓一次受控執行的結果能被第三方驗證為「由受信任的工具鏈、在隔離條件下產生」，之後才可能出現第一個 `PASS`。
- 本文件提出：
  - 元件與信任邊界（§3）；
  - 首次信任建立（§4）；
  - 一致的 nonce 流程（§5）；
  - 終止 Adapter → 匯出 → 對帳（§6）；
  - 證明 schema 與驗證流程（§7，schema 草案：`S2B2-B3-attestation-statement.draft.json`）；
  - §10 攻擊驗收矩陣（§8）；
  - D-17／Q1／錨定決策表（§9）；
  - 第 2 批遺留對認證的影響（§10）；
  - 分段交付（§11）。
- **不依賴平台決策**、可以先做的：B3a（本機原型，結果仍是 `UNATTESTED`）。**依賴決策**的：B3b、B3c。
- 需要使用者回答的最少問題在 §13。

## 1. 已完成與尚未實作的信任邊界（第 2 批盤點）

| 邊界 | 第 2 批狀態 | 第 3 批需要 |
|---|---|---|
| Adapter 只經受控 API（front 代理）存取 | **慣例，未強制**：Adapter 與 API、Emulator 同一程序、同一使用者；可直接連 8080／9099 | 網路命名空間或等效隔離，Adapter 只能連到單一入口（§3.2） |
| owner 權限只在 API store 與 harness | 是，但 owner token（`owner`）是公開常數，任何能連 Emulator 的程序都能使用 | Adapter 無法連到 Emulator，owner 失去意義（§3.2） |
| trace（front／back） | 有，遮罩後寫檔；Adapter 與代理同程序，可改寫檔案 | 證據目錄對 Adapter 不可見；雜湊由 Runner 計算 |
| 狀態匯出 | 有（owner 遞迴讀取） | 在 Adapter **全部程序終止後**才匯出（§6） |
| Observer／Verifier | Observer 雛形；判定在同程序；沒有 Verifier | Verifier 在不執行不受信任程式碼的環境，以固定版本重算（§3、§4） |
| 輸入雜湊檢查 | 同一次執行內的竄改偵測 | 雜湊＋信任根簽章（來源）；驗證目標來自可信外部輸入（§7.2） |
| nonce | 只有「擁有權 nonce」（`_smokeOwnership/{nonce}`，防誤刪）；**沒有**認證用 nonce | 認證 nonce 流程（§5） |
| 稽核對帳 | Observer 只檢查「每個請求恰一筆 audit」，狀態差異排除所有稽核文件 | 稽核新增要逐筆對帳，不可整類忽略（§6.3） |
| 遮罩 | 有；R1-N5～N7 與無前綴不透明憑證為待辦 | 證據會公開（若採 §9 選項 A），遮罩成為前提（§10） |
| 信任根 | 無（D-17 待決） | 決策（§9） |

## 2. 目標與非目標

**目標**

1. Runner 在可查證的隔離下執行 Adapter（§9 的 §9.2 條件）。
2. 終止 Adapter 後匯出狀態，並以 trace 解釋每一筆狀態差異。
3. Verifier 以固定版本、在不執行不受信任程式碼的環境，用可信外部輸入重算並判定。
4. 信任根為 Verifier 的判定簽章；第三方可獨立驗證。
5. §10 每一個攻擊情境都有可執行的驗收測試。

**非目標**

- 寫入 API、交易、POC-016～021；產品 Security Rules；PostgreSQL。
- 解決 G-1～G-4；POC-009 維持 `BLOCKED`。
- 修改 Stage 1 鎖定檔、fixtures、oracle、72 筆 `NOT_RUN`。
- 正式雲端、正式資料、部署。
- 讓本機或 PR 上的執行產生 `PASS`（永遠不行）。

## 3. 元件、資料流與信任邊界

### 3.1 資料流（提案）

```text
 ┌─────────────────────────── 執行 job（GitHub-hosted runner，permissions: contents: read；沒有 id-token） ──────────────────────────┐
 │                                                                                                                                │
 │  Runner（受信任工具鏈 @ trustedToolchainCommit，以 runner 使用者執行）                                                          │
 │   ├─ 啟動 Auth/Firestore Emulator（127.0.0.1）                                                                                 │
 │   ├─ 啟動 back 代理 → 受控 API → front 代理；front 代理只在 Unix socket /run/cmn/adapter.sock 上提供服務                        │
 │   ├─ 證據目錄 /run/cmn/evidence（只有 runner 使用者可讀寫）                                                                    │
 │   │                                                                                                                            │
 │   │   ┌──── Adapter 沙箱（adapterCommit 的程式碼）────────────────────────────┐                                               │
 │   └──▶│ 專用 uid（非 root、無 sudo、無 capability）；乾淨環境變數（env -i）      │                                               │
 │       │ 網路命名空間：沒有任何網卡（只有 lo），連不到 8080/9099/4400/4500/9150  │──── /run/cmn/adapter.sock ───▶ front 代理      │
 │       │ PID 命名空間：看不到 Runner、代理、API、Emulator；結束時整個命名空間銷毀  │                                               │
 │       │ 掛載命名空間：只看得到唯讀的 Adapter 程式碼與自己的暫存目錄              │                                               │
 │       └──────────────────────────────────────────────────────────────────────────┘                                               │
 │   ├─ 終止 Adapter 命名空間 → 關閉 socket → 等 API 處理完 → 匯出狀態（§6）                                                    │
 │   └─ 上傳 artifact：trace、state-pre/post、run-input.json（不含簽章、不含判定）                                               │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                         │ artifact（不受信任的傳輸媒介，只靠雜湊與重算）
                                         ▼
 ┌──────────────── 驗證與簽章 job（另一台 runner；permissions: id-token: write、attestations: write、contents: read）────────────────┐
 │  只 checkout trustedToolchainCommit（不 checkout adapterCommit、不執行任何 Adapter 或 PR 程式碼）                               │
 │  Verifier：讀可信外部輸入（§7.2）→ 重算雜湊 → 以固定版本 Observer 重算 canonical → 對帳（§6）→ 隔離自我檢查結果 → 判定        │
 │  判定為 PASS／FAIL／BLOCKED 後，為「證明（statement）」產生信任根簽章（§9 選項 A：GitHub artifact attestation）                │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                 第三方（負責人、ChatGPT）以獨立工具驗證簽章、簽署者 workflow、來源 ref 與 digest（§7.3）
```

### 3.2 元件表

| 元件 | 程式來源 | 版本固定方式 | 可讀檔案 | 網路可達範圍 | 可見憑證 |
|---|---|---|---|---|---|
| Runner（含 harness、沙箱啟動器、匯出） | `main` | `trustedToolchainCommit`（§4；由負責人設定的 repository variable） | 全部（受信任） | 127.0.0.1 上的 Emulator、代理、API | `GITHUB_TOKEN`（`contents: read`）；**不傳給** Adapter |
| Emulator（Auth、Firestore） | firebase-tools 15.35.0（鎖檔）、jar v1.22.0（MD5 核對） | 鎖檔 SHA-256、jar MD5 寫入證明 | 不適用 | 只綁定 127.0.0.1 | owner（Emulator 專用，公開常數） |
| 受控 API | `main` | `trustedToolchainCommit` | 只經 back 代理讀寫 Emulator | back 代理 | owner（只在 API 程序內） |
| front／back 代理 | `main` | `trustedToolchainCommit` | 寫證據目錄 | front：Unix socket；back：Emulator | 無（遮罩後記錄） |
| **Adapter** | `adapterCommit`（可以是任何已審查的 commit） | 證明分別記錄 `adapterCommit` | 唯讀的 Adapter 程式碼、自己的暫存目錄 | **只有** `/run/cmn/adapter.sock` | 只有 Runner 交給它的 actor ID token（虛構使用者、短期） |
| Observer | `main` | `trustedToolchainCommit`；Verifier 用**同一個**版本重算 | trace、state（唯讀） | 無 | 無 |
| Verifier | `main` | `trustedToolchainCommit`；在驗證 job 只 checkout 這個 SHA | artifact、可信外部輸入 | GitHub API（下載 artifact） | 無（簽章由下一步驟使用 OIDC） |
| 簽章步驟 | GitHub 官方 action（版本以完整 commit SHA 固定，**未驗證**可用版本） | action SHA 寫入 workflow，workflow 在錨定清單內 | 證明檔 | GitHub、Sigstore | OIDC token（`id-token: write`）：只存在於驗證 job |

**界線重點**：

- 執行 job 沒有 `id-token: write`：即使沙箱被突破，也拿不到簽章權限。
- 驗證 job 不執行任何不受信任程式碼。
- 兩個 job 都是 GitHub 定義的隔離 VM（**未以官方文件核對**，§12），但「換到另一個 job」**本身不等於**隔離完成：執行 job 內 Adapter 與 Runner 之間的隔離仍要靠沙箱與自我檢查（§3.3）。

### 3.3 沙箱的強制與查證

| 條件 | 強制方式（提案） | 每次執行的自我檢查（Runner 在同一設定的沙箱中先跑） | 不成立時 |
|---|---|---|---|
| 不能連 Emulator、hub、logging、API 的 TCP 埠 | 網路命名空間（沒有網卡） | 連 8080、9099、4400、4500、9150、18300～18302：全部必須失敗；不只是 `ECONNREFUSED`，必須是無路由（`ENETUNREACH` 或同等），以證明不在同一網路 | `BLOCKED` |
| 只能連 front 代理 | Unix socket 掛入沙箱 | socket 可連；另一個測試 socket（未掛入）不可見 | `BLOCKED` |
| 看不到其他程序 | PID 命名空間 | `/proc` 中只有沙箱內的程序；讀不到 Runner 的 `/proc/<pid>/environ` | `BLOCKED` |
| 讀不到證據、Observer、Verifier、`.git` | 掛載命名空間＋檔案權限 | 讀取證據目錄、`poc/stage2/src`、`.git/config` 必須失敗 | `BLOCKED` |
| 非 root、不能提權 | 專用 uid、`setpriv` 去除 capability 與 `no_new_privs` | `id -u ≠ 0`；`sudo -n true` 失敗；capability 集合為空 | `BLOCKED` |
| 沒有平台憑證 | `env -i`，只傳必要變數 | 環境中沒有 `GITHUB_TOKEN`、`ACTIONS_*`、`ACTIONS_ID_TOKEN_REQUEST_*`、`RUN_NONCE` | `BLOCKED` |
| 設定可查證 | 沙箱啟動器在 `trustedToolchainCommit` 中 | 證明記錄啟動器檔案與參數的 SHA-256；Verifier 與受信任設定比對 | `BLOCKED` |
| 平台不支援上述任一項 | — | 自我檢查無法執行 | `UNATTESTED` |

**本機可行性探查**（本執行環境，root，Linux 6.18；只是可行性證據，不是認證）：

- 在網路命名空間中連 `127.0.0.1:8080` → `ENETUNREACH`；
- 經 Unix socket 可以完成 HTTP 請求；
- PID 命名空間結束後，命名空間內的背景 `sleep` 程序全部消失；
- 掛載命名空間可以用 tmpfs 遮住目錄。

未在 GitHub-hosted runner 上驗證：Ubuntu 24.04 對非特權使用者命名空間可能有限制（**未驗證**），屆時以 `sudo` 由 Runner 建立沙箱、Adapter 以專用 uid 執行。

## 4. 首次信任建立（bootstrapping）

問題：Verifier、Observer、沙箱啟動器第一次寫好時還在 PR 裡，**不能**由自己證明自己可信。

| 步驟 | 動作 | 由誰 | 結果狀態 |
|---|---|---|---|
| 1 | B3a PR：Verifier、Observer 修正、沙箱、對帳、攻擊測試 | Claude | 在 PR 上只能 `UNATTESTED` |
| 2 | ChatGPT 獨立審查；負責人審查 | ChatGPT、你 | — |
| 3 | 合併到 `main`，取得 merge commit `M` | 你 | — |
| 4 | 負責人把 repository variable `CMN_S2_TRUSTED_TOOLCHAIN_SHA` 設為 `M`（與現有 `CMN_STAGE1_ANCHOR_SHA256` 同類的人工核准）；並更新外部錨定 digest | 你 | 這是「信任版本」的唯一來源 |
| 5 | 之後的受控執行：Runner 與 Verifier 一律 checkout `M`；`adapterCommit` 可以不同 | workflow | 可能 `PASS` |
| 6 | 工具鏈之後的任何修改，重複 1–4；在變數更新前，新版工具鏈的執行一律 `UNATTESTED` | — | — |

拒絕的捷徑：

- 「工具鏈與 Adapter 在同一個 PR 中，雜湊自洽」→ 不等於可信。
- 「Observer 是不同模組」「Verifier 在另一個 job」→ 不等於隔離完成。
- 「workflow 檔在 `main`，但 checkout PR 的工具鏈」→ 不接受：Verifier 只 checkout 變數指定的 SHA，且檢查 `trustedToolchainCommit` 是 `main` 的祖先。

## 5. nonce 時序：一致流程（提案，需審查後修訂 `S2B2-ATTESTATION.md`）

**現有文字的差異**：

- `S2B2-ATTESTATION.md` §3 寫「Runner 在執行**之前**產生 nonce，同時寫進 Emulator」；§4 第 1 點寫「寫入 nonce 標記文件，**再交給** Adapter 執行」。
- §9.2 寫「由 Runner 在 Adapter **啟動之後**、操作開始前才寫入」。
- 兩者在「寫入 Emulator 的時間」上互相矛盾。

本文件**不**直接選一段當作已批准的規格，而是提出下列一致流程。審查通過後，再把 `S2B2-ATTESTATION.md` 修訂為 v0.3（另一個 PR 或本批 B3a）。

| 時點 | 動作 | Adapter 能否看到 |
|---|---|---|
| T0 | Runner 產生 `attestationNonce`（32 位元組亂數）；只存在 Runner 記憶體與證據目錄 | 否 |
| T1 | Runner 清空並載入 fixtures（擁有權流程沿用第 2 批；擁有權 nonce 與認證 nonce 是**不同**的值與文件） | 否 |
| T2 | Runner 啟動 Adapter 沙箱；Adapter 初始化（讀自己的程式碼）後，經控制管道送出 `READY`；此時 front socket 尚未接受 API 請求 | 否 |
| T3 | Runner 收到 `READY` 後，才寫入 `_attestationRuns/{runId}`：`{nonce, runId, runAttempt, writtenAt}`（owner，經 back 代理之外的 Runner 通道，記入 Runner 日誌） | 否：Adapter 連不到 Emulator；受控 API 沒有任何操作能讀這個集合 |
| T4 | Runner 匯出 `state-pre`（包含標記文件）並計算雜湊；再開放 front socket，送出 `GO` | 否 |
| T5 | Adapter 執行案例操作 | 否 |

調和方式：

- §3 的「執行之前產生」指 T0（產生），不是寫入。
- §4 的「寫入標記，再交給 Adapter 執行」中的「執行」解讀為「開始案例操作」（T5），不是「啟動程序」（T2）。
- §9.2 的「Adapter 啟動之後、操作開始前寫入」對應 T3。
- 這是解讀與文字修正的提案，需要審查同意；在同意前，`S2B2-ATTESTATION.md` v0.2 原文不變。

為何要在 T2 之後寫：如果標記在 Adapter 啟動前就存在，「預先取得 nonce」的攻擊面只取決於隔離；在 T2 之後寫，即使 Adapter 在啟動階段就嘗試讀取，標記也還不存在。

## 6. 終止 Adapter → 匯出狀態 → 對帳

### 6.1 終止順序

1. Adapter 回報完成，或逾時。
2. Runner 終止 Adapter PID 命名空間的 init 程序；核心會終止命名空間內全部程序。
3. 確認：Adapter uid 沒有任何殘留程序（`pgrep -u <adapter-uid>` 為空）；沙箱的暫存目錄已卸載。
4. 關閉 front socket；等待 API 處理中的請求完成，並寫完 audit（有逾時）。
5. 停止接受任何新連線後，才匯出 `state-post`。
6. 終止或逾時失敗 → `BLOCKED`（`ADAPTER_TERMINATION_UNVERIFIED`）。

### 6.2 狀態差異

`diff = state-post − (state-pre)`，逐文件比較（新增、刪除、修改）。

### 6.3 對帳規則（讀取案例）

| 差異類型 | 允許條件 | 否則 |
|---|---|---|
| `workspaces/{wid}/auditLog/{id}` 或 `auditLogUnscoped/{id}` 的**新增** | 每一筆都對應 front trace 中**恰好一個**請求（`traceId`）；每個到達 API 的 front 請求恰好一筆；`decision` 與回應一致（200 ↔ `allow`；403 ↔ `deny`；503 ↔ 含 `outcome`）；`action`、`reasonCode` 在允許集合內；欄位只有稽核白名單；`workspaceId` 與 `resourceRef` 的路徑一致 | `BLOCKED`（`AUDIT_UNRECONCILED`） |
| 既有稽核文件的修改或刪除 | 一律不允許 | `BLOCKED` |
| `_attestationRuns/{runId}` | 必須與 T3 寫入的內容逐位元相同 | `BLOCKED`（`NONCE_MISMATCH`） |
| 擁有權標記 | 不變 | `BLOCKED` |
| 其他任何文件的新增、修改、刪除 | 讀取案例中一律不允許 | `BLOCKED`（`STATE_CHANGE_UNEXPLAINED`） |

back trace 的對應檢查：

- 每一筆後端**寫入**都必須是稽核建立（`currentDocument.exists=false`，路徑在稽核集合）。
- 每一筆後端請求都必須帶有一個 front 請求的 `traceId`。
- 沒有 `traceId` 的後端流量 → `BLOCKED`（`UNATTRIBUTED_BACKEND_TRAFFIC`）。

寫入案例（POC-016～021）的對帳規則屬於後續批次，不在本批定義。

## 7. 證明 schema 與驗證流程

### 7.1 schema 草案

見 `docs/stage2/S2B2-B3-attestation-statement.draft.json`（JSON Schema，**草案，未實作**）。重點：

- `trustedToolchainCommit` 與 `adapterCommit` 分開；
- `targets`：`caseSpecDigest`、`fixtureFileSha256`、`fixtureHash`、`oracleFileSha256`、`anchorDigest`；
- `run`：`runId`、`runAttempt`、`attestationNonce`、`ownershipNonceDigest`、`startedAt`、`finishedAt`；
- `environment`：OS 映像、Node、Java、firebase-tools、jar MD5、鎖檔 SHA-256、runner 識別；
- `isolation`：沙箱設定雜湊、自我檢查逐項結果、Adapter 終止證據；
- `artifacts`：每個 trace、state、evidence 的路徑與 SHA-256；
- `reconciliation`：§6.3 每一類的計數與結果；
- `observedCanonical`、`observedCanonicalDigest`、`adapterClaimedCanonical`；
- `verdict`：只由 Verifier 填寫；`verifierCommit` 必須等於 `trustedToolchainCommit`。

### 7.2 驗證目標必須來自可信外部輸入

| 欄位 | 可信來源（不是 artifact 自己的宣稱） |
|---|---|
| `trustedToolchainCommit` | repository variable `CMN_S2_TRUSTED_TOOLCHAIN_SHA`（負責人設定）；且必須是 `main` 的祖先 |
| `anchorDigest` | repository variable `CMN_STAGE1_ANCHOR_SHA256`（既有） |
| `caseSpecDigest`、`oracleFileSha256` | Verifier 從 `trustedToolchainCommit` 的鎖定 `canonical-oracles-v1.0.json` 重算 |
| `fixtureFileSha256`、`fixtureHash` | 同上，從鎖定 fixtures 重算；並與 Stage 1 `source-lock.json` 比對 |
| `runId`、`runAttempt` | 驗證 job 自己的 GitHub 環境變數，以及「觸發驗證的那一次執行」的 ID；不讀 artifact 內的值 |
| `attestationNonce` | 執行 job 以 job output 傳遞，並由 Verifier 在 `state-post` 中比對；不只信任 artifact 內的副本 |
| `adapterCommit` | workflow 輸入；Verifier 檢查它是 `main` 的祖先（或負責人指定的已審查 commit） |
| 沙箱設定雜湊 | Verifier 從 `trustedToolchainCommit` 的啟動器重算 |

Verifier 對 artifact 做的事：重算全部雜湊；以固定版本 Observer 重算 canonical；執行 §6 對帳；讀取隔離自我檢查結果。artifact 中的 `verdict`、`observedCanonical` 一律**重算後比較**，不採信。

### 7.3 第三方驗證（提案，指令細節**未以官方文件核對**）

負責人或 ChatGPT 取得證明與簽章後：

1. 以 GitHub CLI 的 attestation 驗證功能，指定 repository、簽署者 workflow 路徑與來源 ref（`refs/heads/main`），驗證簽章；
2. 確認 statement 的 `trustedToolchainCommit` 等於當時的 repository variable；
3. 可選：以 `trustedToolchainCommit` 在本機重跑 Verifier，對 artifact 重算一次。

## 8. §10 攻擊驗收矩陣（可執行規格）

**共同前置**：

- B3a 的「攻擊者 Adapter」放在測試專用目錄，不是產品程式碼；每一個都是一個刻意惡意的 Adapter 實作。
- 每項都有**正向控制**：誠實 Adapter 在同一設定下必須得到非 `BLOCKED` 的判定。

| # | 情境 | 攻擊入口（攻擊者 Adapter 的行為） | 可觀察證據 | 正向控制 | 預期結果 | 需要平台／權限決策才能實測 |
|---|---|---|---|---|---|---|
| A1 | 代理旁路 | 直接連 `127.0.0.1:8080`／`9099` 送 REST 請求 | 沙箱內連線失敗（`ENETUNREACH`）；若某種方式成功，`state-post` 差異無法由 trace 解釋 | 誠實 Adapter 只經 socket | 連線失敗；判定不受影響。隔離失效時 → `BLOCKED`（`STATE_CHANGE_UNEXPLAINED`） | 本機可測；GitHub runner 需 B3b |
| A2 | 直接 owner 寫入 | 以 `Authorization: Bearer owner` 寫入「正確答案」（例如改 entries 狀態） | 同 A1；對帳發現非稽核文件變動 | 同上 | `BLOCKED` | 同上 |
| A3 | 篡改 trace／匯出檔 | 嘗試寫 `/run/cmn/evidence/*` | 沙箱內寫入失敗（`EACCES`／`ENOENT`）；Verifier 重算雜湊 | 誠實 Adapter 不碰證據 | 寫入失敗；若檔案在傳輸中被改 → 雜湊不符 `BLOCKED` | 本機可測（另以「改 artifact 後交給 Verifier」模擬傳輸竄改） |
| A4 | 篡改 Observer／Verifier | 在 `adapterCommit` 中修改 `poc/stage2/src/observer.mjs`、Verifier | 驗證 job 只 checkout `trustedToolchainCommit`；證明中 `verifierCommit` | 不修改 | 修改無效；若 artifact 宣稱不同的 Verifier → `BLOCKED` | 需 B3b（workflow） |
| A5 | 背景程序 | Adapter `fork` 出背景程序，延遲 N 秒後改寫 Emulator 或證據 | 終止後 `pgrep -u <adapter-uid>` 為空；匯出在終止之後；對帳 | 無背景程序 | 背景程序隨 PID 命名空間終止；若殘留 → `BLOCKED`（`ADAPTER_TERMINATION_UNVERIFIED`） | 本機可測 |
| A6 | 舊 run 重播 | 交出另一次執行（或另一個 commit）的 artifact | `runId`、`runAttempt`、nonce、`adapterCommit`、`caseSpecDigest` 與可信外部輸入不符 | 本次 artifact | `BLOCKED` | 本機可模擬（以兩次執行交換 artifact）；完整需 B3b |
| A7 | 預先取得或改寫 nonce | 啟動後立刻讀 `_attestationRuns`；嘗試經 API 讀取 | 沙箱連不到 Emulator；API 沒有對應操作（`UNKNOWN_OPERATION`）；`state-post` 中標記不變 | 不嘗試 | 讀取失敗；標記改變 → `BLOCKED`（`NONCE_MISMATCH`） | 本機可測 |
| A8 | 偽造證據檔 | 回傳不存在的 evidence 路徑或自行產生的雜湊 | Verifier 只採用 Runner 產生的檔案；`requiredEvidenceKeys` 必須對應 trace 中實際請求 | 誠實 Adapter | `BLOCKED` | 本機可測 |
| A9 | 隔離無法查證 | 在不支援命名空間或自我檢查失敗的環境執行 | 自我檢查結果缺少或失敗 | 支援的環境 | `UNATTESTED`（無法查證）或 `BLOCKED`（檢查失敗） | 本機可測（以關閉某項隔離模擬） |
| A10 | 竊取平台憑證 | 讀環境變數、`/proc/*/environ`、`.git/config` 找 `GITHUB_TOKEN`、`ACTIONS_*` | 自我檢查；執行 job 沒有 `id-token` | — | 讀不到；即使讀到也不能簽章 | 需 B3b（GitHub runner 實測） |
| A11 | 濫用 front 入口 | 送超大、畸形、未知操作或憑證形狀的請求 | 第 2 批既有拒絕規則與遮罩 | — | 403，不影響判定；稽核可對帳 | 本機可測（第 2 批已有部分） |
| A12 | Adapter 說謊 | 回報與實際回應不同的 canonical | `adapterClaimedCanonical` ≠ `observedCanonical` | 誠實 Adapter | 以 Observer 為準，標記不一致；不影響判定 | 本機可測（第 2 批已有） |

## 9. 決策表：D-17（信任根）、Q1（CI 形式）、錨定

### 9.1 已確認的 repository 事實

2026-11-21 以 GitHub API 唯讀讀取：

- **public** repository，擁有者是個人帳號；
- 允許 fork；
- GitHub Pages 已啟用；
- secret scanning 與 push protection 已啟用；
- 目前只有 `ci.yml`，`permissions: contents: read`。

### 9.2 官方文件核對狀態

`docs.github.com` 在本執行環境的網路政策下**無法連線**（DNS 解析失敗；以 web-fetch 代理也失敗）。下表中所有 GitHub 平台能力、權限名稱、費用與指令都是**未驗證**，標記為「未驗證」，必須在決策前以官方文件確認（§13 Q-D）。

### 9.3 D-17：信任根

| 選項 | 說明 | 必要帳號／方案條件 | 最小權限 | 費用與限制 | 回復方式 | 評估 |
|---|---|---|---|---|---|---|
| **A. GitHub artifact attestation（Sigstore，OIDC 無金鑰簽章）** | 驗證 job 以 workflow 身分為證明簽章；第三方以 CLI 驗證簽署者 workflow 與來源 ref | public repository 可用（**未驗證**；private repository 可能需要特定方案，**未驗證**） | 驗證 job：`id-token: write`、`attestations: write`、`contents: read`（**未驗證**權限名稱）；執行 job：`contents: read` | 公開 repository 的簽章紀錄寫入公開透明度日誌，**無法刪除**（**未驗證**）；證明與證據等同公開 → 遮罩是前提（§10） | 移除 workflow 即停止產生；已發出的證明無法撤回，只能以 Verifier 規則或撤銷清單拒絕 | **推薦**（條件：官方文件核對後成立；§10 前提完成） |
| B. 負責人手動簽署 | 負責人在自己的電腦以 SSH／GPG 金鑰為 Verifier 的輸出簽章 | 負責人保管金鑰 | 不需要 workflow 權限 | 每次執行需人工；信任依賴負責人電腦；Claude 無法執行 | 撤銷金鑰 | 可作為 A 的備援，或在 A 不可用時採用 |
| C. 只做人工審查，不簽章 | 負責人看 CI 記錄後人工確認 | — | — | 不符合 `S2B2-ATTESTATION.md` §5 第一列 → 結果永遠 `UNATTESTED` | — | 不推薦作為信任根；等同維持現狀 |

**不自行選定**：本文件只推薦 A，最終由負責人決定。

### 9.4 Q1：CI 形式

| 選項 | 內容 | 受保護檔案影響 | 權限 | 評估 |
|---|---|---|---|---|
| a | 在 `ci.yml` 加執行 job 與驗證 job | `ci.yml` 改變 → 錨定 digest 改變 | 會讓 PR 觸發的 workflow 也含 `id-token` 設定，需要逐 job 限制；PR 事件與簽章混在同一檔 | 不推薦 |
| **b** | **新增 `attest.yml`**：觸發只用 `workflow_dispatch`（負責人手動）與 `push` 到 `main`；**不**用 `pull_request`／`pull_request_target`；執行 job 與驗證 job 分開 | 必須修改 `tests/repo_policy.test.mjs`（目前斷言只有 `ci.yml`）與 `scripts/verify-anchor.mjs` 的受保護清單（加入 `attest.yml`），兩者都是受保護檔案 → 錨定 digest 改變 | `ci.yml` 維持 `contents: read` 不變；`attest.yml` 的權限逐 job 設定 | **推薦** |
| c | 維持只在本機 | 無 | 無 | 無法取得信任根簽章 → 永遠 `UNATTESTED` |
| 補充 | PR 上以無特權 job 跑 Emulator 與攻擊測試（只產生 `UNATTESTED` 給審查者參考） | 若加在 `ci.yml` 需要錨定變更 | `contents: read` | 可選；與 b 獨立決定 |

### 9.5 錨定與可信變數

| 變更 | 為何需要 | 誰執行 | 回復 |
|---|---|---|---|
| 受保護清單加入 `attest.yml`、沙箱啟動器、Verifier、Observer | 這些檔案被修改時必須觸發重新核准 | Claude 在 B3b PR 中修改；負責人審查 | revert PR |
| `CMN_STAGE1_ANCHOR_SHA256` 更新為新 digest | 受保護檔案改變 | **負責人**在 Settings 設定 | 改回舊值（舊 digest 會讓新 PR 失敗） |
| 新增 `CMN_S2_TRUSTED_TOOLCHAIN_SHA` | §4 的可信版本來源 | **負責人** | 刪除變數 → 所有受控執行 `BLOCKED` |

Claude 不會設定或要求代為設定任何 repository variable、secret、權限或 ruleset。

## 10. 第 2 批遺留對認證的影響

| 項目 | 對認證證據鏈的影響 | 處理 |
|---|---|---|
| R1-N5：`authorize` 以 `OPERATIONS[op]` 查找，`toString` 等原型鏈名稱會被當成存在的操作 | 目前結果仍是 deny（`CAPABILITY_NOT_ENABLED`），但原因碼錯誤，會讓 §6.3 稽核對帳的 `action`／`reasonCode` 規則出現不可解釋的值 | **B3a 前置**：改用自有鍵查找，補測試 |
| R1-N6：非 Bearer `Authorization` 值以 SHA-256 記錄 | 若選 D-17 選項 A，證據公開；低熵值（例如 Basic）的雜湊可被試算還原 | **B3a 前置**：改為固定標記，不記雜湊 |
| R1-N7：遮罩掃描只蒐集最後一組 token 與密碼 | 受控執行要上傳證據前，必須用**本次執行發出的全部** token／密碼掃描 | **B3a 前置**：Runner 記錄每一個發出的秘密（只在記憶體），上傳前掃描；有任何命中 → 不上傳、`BLOCKED` |
| 無前綴、形狀像 ID 的不透明憑證 | 只要 Adapter 能拿到真實憑證，就可能把它寫進 trace；隔離後 Adapter 環境不含任何平台憑證 | B3a：沙箱 `env -i`；殘餘風險（只限虛構資料）需負責人接受（§13） |
| 分頁拒絕（單頁 300 筆） | 不影響目前 fixtures；任何截斷都會 fail closed | 維持；不視為永久豁免，寫入 B3 已知限制 |
| G-1～G-4 | POC-009 仍無法觀察兩欄 | 維持 `BLOCKED`；不在本批解決 |

「延後」不等於永久豁免：上表標為前置的項目，在 B3a 合併前必須完成，否則 B3b 不開始。

## 11. 分段交付、驗收條件與阻擋因素

| 段 | 內容 | 進入條件 | 驗收條件 | 結果上限 |
|---|---|---|---|---|
| **B3-0（本文件）** | 計畫、決策包、schema 草案、攻擊矩陣 | — | ChatGPT 審查；使用者回答 §13 | — |
| **B3a** | R1-N5～N7；沙箱啟動器（命名空間、專用 uid、`env -i`、Unix socket）；隔離自我檢查；終止 → 匯出 → 對帳；認證 nonce 流程（§5，待 ATTESTATION v0.3 審查）；statement 產生器；Verifier（純函式，輸入：artifact＋可信輸入）；攻擊者 Adapter 測試（A1–A3、A5–A9、A11、A12） | 本文件審查通過；§5 nonce 流程同意 | 全部攻擊測試在本機得到預期結果；正向控制通過；第 2 批回歸通過 | `UNATTESTED`（沒有簽章） |
| **B3b** | `attest.yml`、受保護清單、`repo_policy` 測試修改；GitHub runner 上的沙箱與自我檢查；A4、A10 | D-17 決定；Q1 決定；官方文件核對；B3a 合併並設定 `CMN_S2_TRUSTED_TOOLCHAIN_SHA`；錨定重新核准 | 在 GitHub runner 上自我檢查全部通過；攻擊測試通過；簽章可由第三方驗證 | 可能 `PASS` |
| **B3c** | 第一次受控執行：POC-001、002、008；POC-009 仍 `BLOCKED` | B3b 合併 | 負責人與 ChatGPT 獨立驗證簽章並重跑 Verifier | `PASS`／`FAIL`／`BLOCKED` |

**阻擋因素**

- D-17、Q1 未決 → B3b 不開始。
- 官方文件無法連線 → 平台能力全部未驗證。
- GitHub-hosted runner 的命名空間支援未驗證 → 若不支援，需改用其他隔離方式（例如以 `sudo` 建立，或容器），可能影響 B3b 設計。
- §5 nonce 流程需要審查同意後才能修訂 ATTESTATION。

## 12. 環境盤點（本執行環境，唯讀或無副作用）

| 項目 | 結果 |
|---|---|
| repository | public；個人帳號擁有；允許 fork；Pages 啟用；secret scanning 啟用 |
| workflow | 只有 `ci.yml`；`permissions: contents: read`；觸發 `pull_request` 與 `push`（`main`） |
| 受保護檔案 | 29 個；digest `e33380c24bc58bdc3ada4c2ce2d0796e8f23deb7871078ccf0f756475bb934e9` |
| 本機隔離工具 | `unshare`、`setpriv`、`iptables`、`nft` 可用；`bwrap`、`nsjail`、`firejail`、`ip` 不可用；`docker` 有 CLI，但沒有 daemon |
| 命名空間 | 網路、PID、掛載、使用者命名空間可在本環境建立（以 root 執行） |
| 官方文件 | `docs.github.com`、`docs.sigstore.dev` 無法連線（網路政策） |

## 13. 需要使用者回答的最少問題

| # | 問題 | 推薦 | 為何 |
|---|---|---|---|
| Q-A（D-17） | 信任根採哪一個？ | 選項 A（GitHub artifact attestation），條件是 Q-D 核對後成立 | 不需要保管金鑰；第三方可獨立驗證；與 repository 公開一致 |
| Q-B（Q1） | CI 形式？ | 選項 b（新增 `attest.yml`，只用手動與 `main` 觸發，執行與驗證 job 分開） | `ci.yml` 權限不變；簽章權限不接觸 PR 程式碼 |
| Q-C | 可信工具鏈版本以 repository variable `CMN_S2_TRUSTED_TOOLCHAIN_SHA` 固定，並由你設定？ | 是 | 與現有錨定機制一致；PR 無法修改 |
| Q-D | 是否開放 `docs.github.com`（以及 `docs.sigstore.dev`）給本執行環境，讓我在 B3b 前核對官方文件？ | 是 | 否則平台能力、權限名稱、費用與指令都只能標未驗證 |
| Q-E | 若採選項 A：證明與遮罩後的虛構證據會公開、且簽章紀錄無法刪除，是否接受？ | 接受，但以 §10 前置完成為條件 | 本 repository 已公開，且只用虛構資料 |
| Q-F | §5 的 nonce 一致流程，是否同意在 B3a 修訂 `S2B2-ATTESTATION.md` 為 v0.3？ | 同意 | 消除 §3／§4 與 §9.2 的矛盾 |

在這些問題回答前，可以開始的只有 B3a（本機、`UNATTESTED`）；但 B3a 也需要 Q-F。

## 14. 未驗證與限制

- 所有 GitHub 平台能力（artifact attestation 的可用範圍、權限名稱、透明度日誌、CLI 驗證參數、hosted runner 的隔離與命名空間支援、fork PR 的 OIDC 行為）**未以官方文件核對**。
- 本機命名空間探查以 root 執行，只是可行性證據；GitHub runner 上未驗證。
- 本文件沒有任何實作；沒有執行新的 Emulator 測試。
- 本次盤點使用了一次唯讀的 `gh api` 呼叫取得 repository 設定，這不符合本執行環境「`gh` 只用於搜尋」的指引；沒有任何寫入，已記錄於此。
