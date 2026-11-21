# S2-B2 第 3 批｜受控執行器、Verifier、信任根與隔離：計畫與決策包 v0.2（草案）

> **狀態：設計與決策包，未實作。** 本文件沒有任何 workflow、OIDC、簽章、Verifier 或隔離實作；沒有修改 repository 設定、外部錨定或 Stage 1 基準。所有結果維持 `UNATTESTED`／`BLOCKED`，沒有 `PASS`。
> 基準：`main` = `40c09a3fb92b0c699a2b00dda1da5b2a32b468a4`（PR #5 合併；最後 PR Head `85a0bb4b40d9cf2ff030c1d95f70513cad9a57fd`，兩者無檔案差異；最後程式審查 Head `d2dafe16ba488df60e6a2340ad9cd075c691ed2a`）。
> 依據：`S2B2-ADAPTER-PLAN.md` §4（第 3 批進入條件：D-17 決定；CI 變更的錨定重新核准）、`S2B2-ATTESTATION.md` v0.2 §3、§5、§9、§10、`S2B2-B2-PLAN.md`。
> v0.2：回應 PR #6 審查（B3-REV001 artifact 內容綁定、B3-REV002 隔離政策封閉定義、B3-REV003 不受信任檔案的安全解析、B3-REV004 簽署身分與批准政策），以及對帳、簽章範圍、A10、Verifier 權限描述、公開範圍的一致性修正。
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
 ┌──────────── 執行 job（GitHub-hosted runner；permissions: contents: read；沒有 id-token） ────────────┐
 │ Runner（受信任工具鏈 @ trustedToolchainCommit）                                                     │
 │  ├─ Emulator（127.0.0.1）、back 代理 → 受控 API → front 代理（只在 Unix socket 上服務）              │
 │  ├─ 證據目錄（只有 Runner 使用者可讀寫）                                                            │
 │  │    ┌──── Adapter 沙箱（adapterCommit；§3.3 的封閉政策）────┐                                     │
 │  └───▶│ 專用 uid、無 capability、no_new_privs、乾淨 rootfs      │── Unix socket ──▶ front 代理         │
 │       │ 網路／PID／掛載命名空間；只繼承 0/1/2＋控制 fd          │                                     │
 │       └─────────────────────────────────────────────────────────┘                                     │
 │  ├─ 終止 Adapter → 關閉入口 → 匯出（§6）                                                           │
 │  ├─ 封存（seal）：產生 manifest 與封裝檔 package.tar；計算 packageSha256、manifestSha256（§3.4）     │
 │  ├─ 上傳 artifact（單一封裝檔）                                                                     │
 │  └─ 以 job outputs 交出 {artifactId, packageSha256, manifestSha256, attestationNonce, runAttempt}    │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │ job outputs（§3.4 的信任假設）          │ artifact（不受信任的傳輸媒介）
          ▼                                         ▼
 ┌──────────── 驗證與簽章 job（另一台 runner；permissions: id-token: write、attestations: write、contents: read）┐
 │ 只 checkout trustedToolchainCommit；不 checkout adapterCommit；不執行任何 Adapter、PR 或 artifact 內的程式      │
 │ 1. 依 §3.4 選取 artifact，比對 packageSha256（期望值來自 job outputs，不來自封裝內）                          │
 │ 2. 依 §7.4 安全解包；依 §7.5 先做 schema 驗證、再做語意驗證                                                   │
 │ 3. 重算全部雜湊；以固定版本 Observer 重算 canonical；§6 對帳；§3.3 隔離政策完整性                             │
 │ 4. 判定。只有 PASS 才進入簽章步驟（維持 ATTESTATION §9.3）；FAIL／BLOCKED 只輸出未簽章的診斷                  │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
          ▼
 第三方以 §7.3 的政策驗證簽章、簽署 workflow 版本、來源 commit 與 subject digest
```

**Verifier 與簽章權限**（修正 v0.1 的描述）：

- `id-token: write` 是 **job 層級**的權限。驗證 job 內的任何程式在技術上都可能取得 OIDC token，不能說 Verifier「沒有」這個能力。
- 本設計的保證是：
  - 驗證 job 只執行 `trustedToolchainCommit` 的程式與固定 SHA 的官方 action；
  - Verifier 不主動使用 OIDC；
  - 對 artifact 只做 §7.4 的安全解析，不執行其中任何內容；
  - 簽章是 Verifier 判定 `PASS` 之後的獨立步驟。

**簽章範圍**：v0.1 曾寫「PASS／FAIL／BLOCKED 都簽章」，與 `S2B2-ATTESTATION.md` §9.3「只在 Verifier 判定通過時才簽」不一致。v0.2 **維持原規則**：

- 只簽 `PASS`；
- `FAIL`／`BLOCKED`／`UNATTESTED` 只產生未簽章的診斷檔，並標示「未簽章、不是認證」。

是否要另外以不同 predicate 簽署診斷結果，列為後續提案，不在本批決定。

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

### 3.3 沙箱的強制與查證：封閉的隔離政策（B3-REV002）

隔離以**有版本的政策** `s2-isolation-policy-v1` 定義。政策檔與沙箱啟動器都在 `trustedToolchainCommit`。

**(a) 實際生效設定的 canonical digest**（`sandboxPolicyDigest`）

Runner 在啟動沙箱**之前**，把實際要套用的設定以 `stableJson` 序列化並計算 SHA-256。Verifier 從 `trustedToolchainCommit` 的政策檔與啟動器重新產生預期設定，兩者必須逐位元相同。設定至少涵蓋：

| 項目 | 必要值 |
|---|---|
| 命名空間 | `net`、`pid`、`mnt`、`ipc`、`uts` 皆為新建；`user` 依平台（§12） |
| uid／gid | 專用、非 0；補充群組為空 |
| capability | effective、permitted、inheritable、bounding、ambient 全部為空 |
| `no_new_privs` | 啟用 |
| rootfs 與工作目錄 | 乾淨的唯讀 rootfs（只含 Node 執行檔與 Adapter 程式碼）；工作目錄是新的 tmpfs |
| 掛載允許清單 | 每一項的來源、目標、`ro`／`rw`；清單外不得有任何掛載 |
| `/proc` | 在新的 PID 命名空間重新掛載；不掛 host 的 `/proc`、`/sys` |
| `/dev` | 只有 `null`、`zero`、`urandom` |
| 入口 | 只有一個 Unix socket：front 代理；沒有其他 host socket |
| 環境變數 | 允許清單（名稱與來源）；其餘全部清除 |
| 繼承的 fd | 只有 0、1、2 與一個控制 fd；其他一律關閉 |
| 資源與時間 | 逾時、程序數上限 |

`env -i` 或遮住幾個目錄，**本身不是**完整的檔案隔離；必須以上表的允許清單定義。

**(b) 必要的自我檢查 ID**（`s2-isolation-policy-v1`）

| ID | 檢查內容 | 正向控制（同時進行） |
|---|---|---|
| `NS_NET_DISTINCT` | 沙箱與 host 的 `/proc/<pid>/ns/net` inode 不同 | Runner 讀 host 側 inode |
| `NS_PID_DISTINCT`、`NS_MNT_DISTINCT`、`NS_IPC_DISTINCT`、`NS_UTS_DISTINCT` | 同上，各命名空間 | 同上 |
| `NET_NO_INTERFACES` | 沙箱內除了 `lo` 沒有網卡 | — |
| `HOST_ENDPOINTS_BLOCKED` | 沙箱內連 8080、9099、4400、4500、9150、18300～18302 全部失敗 | **Runner 在 host 側同時連這些端點，必須成功**（證明它們確實存在） |
| `ENTRY_SOCKET_REACHABLE` | 沙箱內經 Unix socket 呼叫 front 代理成功 | — |
| `NO_OTHER_SOCKETS` | 沙箱內看不到 host 的其他 socket（例如 Docker、Emulator 的 socket 檔案） | Runner 在 host 側確認這些路徑存在（若存在） |
| `UID_NONROOT`、`NO_CAPS`、`NO_NEW_PRIVS` | `id -u ≠ 0`；`/proc/self/status` 的 Cap* 全為 0；`NoNewPrivs: 1` | — |
| `NO_SUDO` | `sudo -n true` 失敗 | Runner 在 host 側確認 runner 使用者可以 sudo（證明檢查不是因為沒有 sudo 而通過） |
| `FS_EVIDENCE_HIDDEN`、`FS_TOOLCHAIN_HIDDEN`、`FS_GIT_HIDDEN` | 讀證據目錄、`poc/stage2/src`、`.git/config` 失敗 | Runner 在 host 側確認這些路徑存在 |
| `PROC_ISOLATED` | `/proc` 只列出沙箱內的程序 | — |
| `DEV_ALLOWLIST` | `/dev` 內容等於允許清單 | — |
| `ENV_ALLOWLIST` | 環境變數名稱集合等於允許清單；沒有 `GITHUB_*`、`ACTIONS_*`、`RUN_NONCE` | — |
| `FD_ALLOWLIST` | `/proc/self/fd` 只有允許的 fd | — |
| `MOUNT_ALLOWLIST` | `/proc/self/mountinfo` 等於允許清單 | — |
| `OUTPUT_CHANNELS_HIDDEN` | 讀寫 `GITHUB_OUTPUT`、`GITHUB_ENV`、`GITHUB_STEP_SUMMARY` 指向的檔案失敗 | Runner 在 host 側確認檔案存在 |

`ENETUNREACH` 之類的錯誤碼**不能**單獨作為隔離證明；必須搭配命名空間 inode、設定 digest 與正向控制。

**(c) 判定規則**（Verifier 依政策檢查完整性，不只檢查 `every(ok)`）

| 情況 | 結果 |
|---|---|
| 政策版本不是可信清單中的版本 | `BLOCKED`（`ISOLATION_POLICY_UNKNOWN`） |
| `sandboxPolicyDigest` 與重新產生的預期值不同（包括程式相同但啟動參數不同） | `BLOCKED`（`SANDBOX_CONFIG_MISMATCH`） |
| 缺少任何必要 ID | `BLOCKED`（`ISOLATION_CHECK_MISSING`） |
| 出現未知 ID | `BLOCKED`（`ISOLATION_CHECK_UNKNOWN`） |
| 同一 ID 重複（JSON 重複鍵，以嚴格解析器偵測） | `BLOCKED`（`ISOLATION_CHECK_DUPLICATE`） |
| 型別錯誤 | `BLOCKED`（`STATEMENT_SCHEMA_INVALID`） |
| 任一項 `ok = false`，或對應的正向控制失敗 | `BLOCKED`（`ISOLATION_CHECK_FAILED`） |
| Runner 回報平台不支援（`platformSupported = false`） | `UNATTESTED`（`ISOLATION_UNVERIFIABLE`） |

自我檢查在與 Adapter **相同設定**的另一個沙箱實例中、Adapter 啟動之前執行；兩者的 `sandboxPolicyDigest` 必須相同。

**本機可行性探查**（本執行環境，root，Linux 6.18；只是可行性證據，不是認證；**沒有**驗證非 root Adapter 的完整隔離）：

- 在網路命名空間中連 `127.0.0.1:8080` 等埠 → `ENETUNREACH`；
- 經 Unix socket 可以完成 HTTP 請求；
- PID 命名空間結束後，命名空間內的背景程序全部消失；
- 掛載命名空間可以用 tmpfs 遮住目錄。

未在 GitHub-hosted runner 上驗證命名空間支援（§12）。

### 3.4 artifact 的內容綁定與選取（B3-REV001）

**問題**：v0.1 只要求 Verifier「重算 artifact 內的雜湊」。攻擊者若保留 `runId`、nonce、commit，替換 trace、state 與隔離結果，再重算所有內部雜湊，封裝檔可以完全自洽。nonce 也可以從待驗證的材料中讀到，不能用來認證內容。

**設計**：

1. **封存（seal）**：Adapter 終止、入口關閉、匯出完成後，Runner 停止寫入證據目錄，產生：
   - `manifest.json`：每個檔案的正規化路徑、大小、SHA-256；
   - `package.tar`：以固定順序、固定 mtime／uid／權限打包的單一檔案（可重現）；
   - `manifestSha256`、`packageSha256`。
2. **以不受 Adapter 控制的通道交出期望值**：封存步驟在 Adapter 終止之後執行，把 `{artifactId, packageSha256, manifestSha256, attestationNonce, runAttempt}` 寫入 **job outputs**。Adapter 不能寫 job outputs：輸出檔被沙箱遮住，以 `OUTPUT_CHANNELS_HIDDEN` 檢查；而且封存發生在 Adapter 的程序全部終止之後。
3. **選取 artifact**：驗證 job **只**依下列條件選取，全部必須相符；禁止只用名稱、「最新」或封裝自己宣稱的資訊：
   - repository；
   - 觸發驗證的那一次 `run_id` 與 `run_attempt`；
   - producer job；
   - job outputs 中的 `artifactId`（不可變 ID）；
   - 下載後重算的 `packageSha256` 等於 job outputs 的值。
4. 解包後，`manifest.json` 的 SHA-256 必須等於 job outputs 的 `manifestSha256`；每個檔案必須與 manifest 一致；manifest 以外不得有檔案。
5. 證明中記錄 `package.artifactId`、`packageSha256`、`manifestSha256`。簽章的 subject 是證明本身（§7.3），因此簽章也間接綁定封裝內容。

**信任假設**（明列，不隱含依賴）：

| 假設 | 依據 | 狀態 |
|---|---|---|
| job outputs 由執行 job 的步驟寫入，並由平台原樣交給依賴它的 job | GitHub Actions 平台行為 | **未以官方文件核對**（Claude 無法連線）；B3b 前核對 |
| Adapter 無法寫入 job outputs | 沙箱政策 `OUTPUT_CHANNELS_HIDDEN`，且封存在 Adapter 終止之後 | B3a 設計，B3b 在 hosted runner 上實測 |
| artifact ID 不可變，且平台記錄其 producer run／attempt | GitHub Actions artifact API | **未核對**；即使成立，也只作為選取條件，內容仍以 `packageSha256` 判定 |
| 執行 job 在封存之前沒有被 Adapter 攻破 | §3.3 隔離與自我檢查 | 殘餘風險：如果 Adapter 突破沙箱，它可以在封存前偽造全部內容；內容綁定只保護「封存之後」的替換 |

artifact 仍是不受信任的傳輸媒介：內容以 job outputs 的期望值判定，**不**依賴 artifact 服務保證內容正確。

## 4. 首次信任建立與批准政策（B3-REV004）

### 4.1 兩種要批准的版本

| 版本 | 內容 | 為何分開 |
|---|---|---|
| **簽章政策版本**（signing policy） | `attest.yml` 的檔案內容（Git blob SHA）與它固定的 action SHA | 決定「誰能簽章、在什麼條件下簽」 |
| **可信工具鏈版本**（`trustedToolchainCommit`） | Runner、沙箱啟動器、隔離政策、Observer、Verifier 所在的 commit | 決定「證據如何收集、如何判定」 |

`main` 的祖先**不等於**已批准：每一個版本都必須出現在批准紀錄中。

### 4.2 批准紀錄（提案）

- 檔案 `docs/stage2/S2B2-TRUST-POLICY.json`（B3b 新增；列入外部錨定的受保護清單）。
- 每一筆紀錄：
  - `approvalId`；
  - `kind`（`signing-policy`／`toolchain`）；
  - 對應的 SHA；
  - `approvedAt`、`approvedBy`（負責人）、審查紀錄連結；
  - `status`：`active`／`revoked`；
  - `validFrom`、`validTo`（撤銷時填寫）。
- 現行指標：repository variables：
  - `CMN_S2_TRUSTED_TOOLCHAIN_SHA`；
  - `CMN_S2_SIGNING_POLICY_BLOB`（`attest.yml` 的 blob SHA）。

  兩者都必須指向紀錄中 `active` 的項目。
- 修改紀錄或變數都只能由負責人進行：紀錄經 PR 審查與錨定重新核准，變數在 Settings 設定。

### 4.3 首次建立的步驟

| 步驟 | 動作 | 由誰 | 結果狀態 |
|---|---|---|---|
| 1 | B3a PR：Verifier、隔離政策、沙箱、對帳、攻擊測試 | Claude | 在 PR 上只能 `UNATTESTED` |
| 2 | ChatGPT 獨立審查；負責人審查；合併為 `M1` | ChatGPT、你 | — |
| 3 | B3b PR：`attest.yml`、`S2B2-TRUST-POLICY.json`（紀錄 `toolchain = M1`）、受保護清單；合併為 `M2` | Claude；審查同上 | 合併後仍**不能** `PASS`：簽章政策尚未批准 |
| 4 | 負責人確認 `M2` 中 `attest.yml` 的 blob SHA，以一個只改紀錄的 PR 加入 `signing-policy` 紀錄；更新錨定 digest；設定兩個變數 | 你 | 這時才可能 `PASS` |
| 5 | 之後的修改：工具鏈或 workflow 任何變更，重複審查 → 紀錄 → 變數；在更新前，新版本的執行一律 `UNATTESTED` 或 `BLOCKED` | — | — |

### 4.4 撤銷與舊證明

- 撤銷：紀錄改為 `revoked`，填 `validTo`；變數改指向其他 `active` 版本，或刪除變數（刪除 → 所有受控執行 `BLOCKED`）。
- 舊證明的驗證：簽章時間落在該版本的 `[validFrom, validTo)` 內 → 可以接受；
  - 若撤銷原因是安全問題，紀錄標 `invalidateIssued: true`，舊證明一律拒絕；
  - 簽章時間以透明度日誌的時間為準。

### 4.5 拒絕的捷徑

- 「工具鏈與 Adapter 在同一個 PR 中，雜湊自洽」→ 不等於可信。
- 「Observer 是不同模組」「Verifier 在另一個 job」→ 不等於隔離完成。
- 「workflow 路徑與 `main` ref 正確」→ 不足：workflow 內容必須是已批准的 blob（§7.3）。

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

**補充規則**（v0.2）：

- `READY` 逾時（例如 60 秒）→ 終止沙箱、`BLOCKED`（`ADAPTER_NOT_READY`）；`GO` 之後的案例逾時同理。
- 控制管道只傳固定的 `READY`／`DONE` 訊息，Runner 不接受其他內容。
- 標記文件包含 `runAttempt`；重新執行（attempt +1）會產生新的 nonce 與新的標記。
- 標記寫入後不得改寫：T4 的 `state-pre` 與匯出的 `state-post` 中，標記必須逐位元相同。
- nonce 只防止重播與預先寫入，**不能**取代隔離（§3.3）或內容綁定（§3.4）。

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

### 6.3 流量階段與對帳規則（讀取案例）

**流量階段**：Runner 自己的流量與 Adapter 引起的流量分開記錄，不以樣式猜測。

| 階段 | 時間範圍 | 誰的流量 | 記錄位置 |
|---|---|---|---|
| setup | T1～T4 | Runner：清空、載入、寫標記、匯出 `state-pre`；以 Runner 通道直接連 Emulator，**不經** back 代理 | `runner-log.jsonl`（每筆附階段） |
| case | `GO` 到 Adapter 終止且入口關閉 | 只有 Adapter → front → API → back | `trace-front.jsonl`、`trace-back.jsonl` |
| teardown | 入口關閉之後 | Runner：匯出 `state-post` | `runner-log.jsonl` |

case 階段之外，back 代理收到任何流量都記為異常；case 階段的 Runner 通道流量也是異常。

**front／back／audit 的一對一因果連結**：

1. front trace 的每一筆都有唯一 `traceId`（重複 → `BLOCKED`）。
2. 每個到達 API 的 front 請求，在 `state-post` 中恰好對應一筆新增稽核，且稽核內容與該請求吻合：
   - `traceId` 相同；
   - `action` 等於請求的 `op`（未知操作時為 null）；
   - `principalId` 等於該 token 綁定的 principal；
   - `resourceRef` 與請求目標一致，或依原因碼為 null；
   - `decision` 與回應一致（200 ↔ `allow`；403 ↔ `deny`；503 ↔ 含 `outcome`）；
   - `reasonCode` 與回應及稽核原因一致，而不只是「在允許集合內」。
3. back trace 的每一筆都帶有某個 front 請求的 `traceId`；沒有 `traceId` → `BLOCKED`（`UNATTRIBUTED_BACKEND_TRAFFIC`）。
4. 每一筆後端寫入都是該 `traceId` 的稽核建立（`currentDocument.exists=false`，路徑在稽核集合，且恰一筆）。

**狀態差異規則**：

| 差異類型 | 允許條件 | 否則 |
|---|---|---|
| 稽核集合的新增 | 符合上面第 2 點，且一對一 | `BLOCKED`（`AUDIT_UNRECONCILED`） |
| 既有稽核文件的修改或刪除 | 一律不允許 | `BLOCKED` |
| `_attestationRuns/{runId}` | 與 T3 寫入的內容逐位元相同 | `BLOCKED`（`NONCE_MISMATCH`） |
| 擁有權標記 | 不變 | `BLOCKED` |
| 其他任何文件的新增、修改、刪除 | 讀取案例中一律不允許 | `BLOCKED`（`STATE_CHANGE_UNEXPLAINED`） |

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
| `trustedToolchainCommit` | repository variable `CMN_S2_TRUSTED_TOOLCHAIN_SHA`（負責人設定），且在批准紀錄（§4.2）中為 `active`；是 `main` 的祖先只是必要條件，不是充分條件 |
| 簽章政策（`attest.yml` blob） | repository variable `CMN_S2_SIGNING_POLICY_BLOB`，且在批准紀錄中為 `active`（§4、§7.3） |
| `anchorDigest` | repository variable `CMN_STAGE1_ANCHOR_SHA256`（既有） |
| `caseSpecDigest`、`oracleFileSha256` | Verifier 從 `trustedToolchainCommit` 的鎖定 `canonical-oracles-v1.0.json` 重算 |
| `fixtureFileSha256`、`fixtureHash` | 同上，從鎖定 fixtures 重算；並與 Stage 1 `source-lock.json` 比對 |
| `runId`、`runAttempt` | 驗證 job 自己的 GitHub 環境變數，以及「觸發驗證的那一次執行」的 ID；不讀 artifact 內的值 |
| `attestationNonce` | 執行 job 以 job output 傳遞，並由 Verifier 在 `state-post` 中比對；不只信任 artifact 內的副本。nonce 不能認證內容（§3.4） |
| `artifactId`、`packageSha256`、`manifestSha256` | 執行 job 封存後的 job outputs（§3.4）；不從封裝內讀取 |
| `adapterCommit` | workflow 輸入；Verifier 檢查它是 `main` 的祖先（或負責人指定的已審查 commit） |
| `isolationPolicyVersion`、`sandboxPolicyDigest`、`sandboxLauncherSha256` | Verifier 從 `trustedToolchainCommit` 的政策檔與啟動器重新產生預期值（§3.3） |

Verifier 對 artifact 做的事：依 §3.4 選取並比對封裝 digest；依 §7.4 安全解包；重算全部雜湊；以固定版本 Observer 重算 canonical；執行 §6 對帳；讀取隔離自我檢查結果。artifact 中的 `verdict`、`observedCanonical` 一律**重算後比較**，不採信。

### 7.3 簽章內容與第三方驗證（B3-REV004）

**簽什麼**：選擇「以 GitHub artifact attestation 的 build provenance，把證明 JSON（`statement.json`）的位元組當 subject 簽章」。

- subject digest ＝ `statement.json` 的 SHA-256。這份檔案以 `stableJson` 序列化，Verifier 產生後不再修改。
- predicate 是平台的 build provenance，記錄 workflow 與來源 commit。
- `statement.json` 內記錄 `packageSha256`、`manifestSha256`，以及每個原始證據檔的 SHA-256，連結到原始證據（§3.4）。
- 不採用自訂 predicate：自訂 predicate 的內容同樣由 workflow 產生，不會更可信。
- 審查者轉述的官方 CLI 文件提醒：predicate 可受 workflow 控制，簽章成功**不等於**測試語意成立。因此第三方仍需依政策檢查 statement 內容。

**第三方驗證政策**（具體 CLI 參數須在 B3b 以官方文件確認）：

1. 驗證簽章與透明度日誌紀錄。
2. 簽署者身分：
   - repository ＝ `hsuanyu9503/class-management-next`；
   - workflow 路徑 ＝ `.github/workflows/attest.yml`；
   - 來源 ref ＝ `refs/heads/main`。
3. 簽署者 workflow 的 commit（signer digest）：在該 commit 中，`attest.yml` 的 blob SHA 必須是批准紀錄中、簽章當時 `active` 的 `signing-policy` 項目。
   - 只比對 workflow 路徑與 ref 不夠；
   - 只比對 commit 也不夠，因為每一個新的 `main` commit 都會改變 signer digest。
4. 來源 commit（source digest）：必須是 `main` 上的 commit，且其中的工具鏈符合批准紀錄。
5. subject digest ＝ 實際取得的 `statement.json` 的 SHA-256。
6. 對 statement 內容做政策檢查：
   - `toolchain.trustedToolchainCommit` 是簽章當時 `active` 的 `toolchain` 項目；
   - `targets` 等於該工具鏈中鎖定檔重算的值；
   - `verdict.result = PASS`。

   statement 宣稱的值只是待檢查的資料，**不是**憑證身分。
7. 可選：以 `trustedToolchainCommit` 在本機重跑 Verifier，對封裝重算一次。

### 7.4 不受信任檔案的安全解析（B3-REV003）

驗證 job 有簽章權限，所以 artifact 的解包與讀取規則在設計階段就要固定。

| 規則 | 內容 | 違反時 |
|---|---|---|
| 路徑 | 只接受相對路徑；每一段由 `[A-Za-z0-9_-]` 開頭，只含 `[A-Za-z0-9._-]`；不允許空段、`.`、`..`、隱藏檔名、反斜線、絕對路徑 | `BLOCKED`（`ARTIFACT_PATH_INVALID`） |
| 正規化碰撞 | 不允許大小寫不同或 Unicode 正規化後相同的兩個路徑 | `BLOCKED`（`ARTIFACT_PATH_COLLISION`） |
| 檔案類型 | 只允許一般檔案與目錄；拒絕 symlink、hardlink、裝置、FIFO、socket | `BLOCKED`（`ARTIFACT_ENTRY_TYPE`） |
| 解析後位置 | 解開到新建的空目錄；每個檔案以 `realpath` 確認仍在根目錄內；開檔使用不跟隨連結的方式 | `BLOCKED`（`ARTIFACT_ESCAPE`） |
| 重複 | 封裝內同一路徑出現兩次 | `BLOCKED`（`ARTIFACT_DUPLICATE`） |
| 數量與大小 | 檔案數 ≤ 2000；單檔 ≤ 16 MiB；總解壓 ≤ 256 MiB；壓縮比上限 | `BLOCKED`（`ARTIFACT_LIMIT`） |
| JSON | UTF-8；最大深度 64；拒絕重複鍵（嚴格解析器）；數字必須是安全整數或有限值 | `BLOCKED`（`ARTIFACT_JSON_INVALID`） |
| 執行 | 不執行封裝內任何腳本；不 `npm install`；不載入封裝指定的模組；不依封裝內容決定要執行的程式 | 設計上禁止 |
| 順序 | 解析與安全驗證全部通過後，才做語意驗證；任何一項失敗即停止，不進入簽章步驟 | — |

### 7.5 schema 驗證與語意驗證的分工

| 層 | 內容 | 結果的意義 |
|---|---|---|
| 1 安全解析 | §7.4 | 通過只代表可以安全讀取 |
| 2 schema 驗證 | `S2B2-B3-attestation-statement.draft.json` | 通過只代表形狀正確，**不代表** `PASS` |
| 3 語意驗證 | §3.3(c)、§3.4、§6.3、§7.2、§7.3 的政策：與可信外部輸入比對、重算雜湊、重算 canonical、隔離政策完整性、對帳 | 通過＋oracle 一致，才可能是 `PASS` |

JSON 重複鍵、「必要檢查 ID 全部存在」之外的跨欄位一致性等，schema 無法表達，必須在第 2 層的嚴格解析與第 3 層處理。

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
| A10 | 竊取平台憑證 | 讀環境變數、`/proc/*/environ`、`.git/config`、`GITHUB_OUTPUT` 等找 `GITHUB_TOKEN`、`ACTIONS_*` | 自我檢查 `ENV_ALLOWLIST`、`PROC_ISOLATED`、`FS_GIT_HIDDEN`、`OUTPUT_CHANNELS_HIDDEN`；Runner 在 host 側確認這些值存在 | 誠實 Adapter | 必須讀不到。**一旦讀到就是隔離失敗**：`BLOCKED`，停止上傳與簽章。「執行 job 沒有 `id-token`」只降低影響，不算驗收成功 | 需 B3b（GitHub runner 實測） |
| A11 | 濫用 front 入口 | 送超大、畸形、未知操作或憑證形狀的請求 | 第 2 批既有拒絕規則與遮罩 | — | 403，不影響判定；稽核可對帳 | 本機可測（第 2 批已有部分） |
| A12 | Adapter 說謊 | 回報與實際回應不同的 canonical | `adapterClaimedCanonical` ≠ `observedCanonical` | 誠實 Adapter | 以 Observer 為準，標記不一致；不影響判定 | 本機可測（第 2 批已有） |
| A13 | **整包替換**（B3-REV001） | 保留本次 `runId`、nonce、commit，替換 trace／state／隔離結果，並同步重算所有內部雜湊與 manifest | 下載後的 `packageSha256`／`manifestSha256` ≠ job outputs | 原封裝 | `BLOCKED`（`PACKAGE_DIGEST_MISMATCH`） | 本機可模擬（以兩份封裝交換）；完整需 B3b |
| A14 | 選錯 artifact | 以相同名稱上傳另一個 artifact；或指向其他 run／attempt | artifact ID、run、attempt、producer 不符 | 正確 artifact | `BLOCKED`（`ARTIFACT_SELECTION_MISMATCH`） | 需 B3b |
| A15 | 隔離政策不完整（B3-REV002） | 自我檢查少一項；只交一項 `ok = true`；重複 ID；未知 ID；同一程式但改啟動參數（例如不建立網路命名空間） | §3.3(c) 規則；`sandboxPolicyDigest` | 完整政策 | 各自的 `BLOCKED` 原因碼 | 本機可測 |
| A16 | 隔離檢查的偽陰性 | 刻意讓 host 端點不存在，使「連不到」看似成功 | 正向控制：host 側同時連線必須成功 | 端點存在 | 正向控制失敗 → `BLOCKED`（`ISOLATION_CHECK_FAILED`） | 本機可測 |
| A17 | 不安全的封裝（B3-REV003） | 封裝內含 `../outside.json`、絕對路徑、`a/../../x`、symlink、hardlink、重複路徑、大小寫碰撞、超量檔案或過深 JSON、重複鍵 | §7.4 規則；驗證 job 根目錄外沒有新檔案 | 正常封裝 | 對應的 `ARTIFACT_*` 原因碼；不進入簽章 | 本機可測 |
| A18 | 未批准的簽章政策（B3-REV004） | 相同 workflow 路徑與 `main` ref，但 `attest.yml` 內容是未批准的版本 | 第三方驗證政策 §7.3 第 3 點 | 已批准版本 | 拒絕 | 需 B3b |

## 9. 決策表：D-17（信任根）、Q1（CI 形式）、錨定

### 9.1 已確認的 repository 事實

2026-11-21 以 GitHub API 唯讀讀取：

- **public** repository，擁有者是個人帳號；
- 允許 fork；
- GitHub Pages 已啟用；
- secret scanning 與 push protection 已啟用；
- 目前只有 `ci.yml`，`permissions: contents: read`。

### 9.2 官方文件核對狀態

Claude 的執行環境仍無法連線 `docs.github.com`、`cli.github.com`（網路政策）。下列事實由 **PR #6 的審查者（ChatGPT）核對官方文件**後提供，在此引用並標示來源；Claude 沒有自行連線確認。

| 事實 | 來源（審查者核對） |
|---|---|
| GitHub Free／Pro／Team 的 **public** repository 支援 artifact attestations；private／internal 需要 Enterprise Cloud | [Use artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) |
| 官方二進位產物範例的權限為 `id-token: write`、`contents: read`、`attestations: write` | 同上 |
| public repository 的 Sigstore bundle 會進入**公開、不可變**的透明度日誌 | [Artifact attestations（概念）](https://docs.github.com/en/actions/concepts/security/artifact-attestations) |
| CLI 驗證提供 signer-digest、source-digest、source-ref 等限制；predicate 可受 workflow 控制，簽章成功不等於測試語意成立 | [gh attestation verify](https://cli.github.com/manual/gh_attestation_verify) |

仍未核對：

- 帳號實際方案與費用；
- hosted runner 的命名空間權限；
- job outputs 與 artifact ID 的不可變性（§3.4）；
- 固定 action SHA 的版本相容性；
- 確切的 CLI 指令。

這些在 B3b 實作前核對；Claude 的連線限制如實記錄，不要求使用者為審查另外開網路。

### 9.3 D-17：信任根

| 選項 | 說明 | 必要帳號／方案條件 | 最小權限 | 費用與限制 | 回復方式 | 評估 |
|---|---|---|---|---|---|---|
| **A. GitHub artifact attestation（Sigstore，OIDC 無金鑰簽章）** | 驗證 job 以 workflow 身分，把 `statement.json` 當 subject 簽 build provenance（§7.3）；第三方依 §7.3 政策驗證 | public repository 可用（審查者核對）；本 repository 是 public；若日後改為 private，需要 Enterprise Cloud | 驗證 job：`id-token: write`、`attestations: write`、`contents: read`（審查者核對官方範例）；執行 job：`contents: read` | Sigstore bundle 進入公開、不可變的透明度日誌（審查者核對）；其他內容的公開範圍見 §9.6；費用未核對 | 移除 workflow 或撤銷批准紀錄即停止；已發出的簽章紀錄無法刪除，只能以批准紀錄的撤銷規則拒絕（§4.4） | **推薦**（條件：§10 前置完成） |
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
| 受保護清單加入 `attest.yml`、`S2B2-TRUST-POLICY.json`、沙箱啟動器、隔離政策、Verifier、Observer | 這些檔案被修改時必須觸發重新核准 | Claude 在 B3b PR 中修改；負責人審查 | revert PR |
| `CMN_STAGE1_ANCHOR_SHA256` 更新為新 digest | 受保護檔案改變 | **負責人**在 Settings 設定 | 改回舊值（舊 digest 會讓新 PR 失敗） |
| 新增 `CMN_S2_TRUSTED_TOOLCHAIN_SHA`、`CMN_S2_SIGNING_POLICY_BLOB` | §4 的現行批准指標 | **負責人** | 刪除變數 → 所有受控執行 `BLOCKED` |

### 9.6 公開與保存範圍（修正 v0.1 Q-E 的合併敘述）

| 內容 | 去向 | 存取範圍 | 保存 | 狀態 |
|---|---|---|---|---|
| Sigstore bundle（簽章、憑證、subject digest） | 公開透明度日誌 | 公開 | 不可刪除 | 審查者核對 |
| `statement.json`（證明本身） | 提案：Actions artifact＋在 `main` 提交摘要 | public repository 的 artifact 存取範圍**未核對**；`main` 上的摘要公開 | artifact 保存期限**未核對**（D-07） | 待決 |
| 封裝檔（trace、state、manifest、隔離結果） | 提案：只作為 Actions artifact，**不**提交到 `main` | **未核對** | **未核對** | 待決 |
| 未簽章的診斷檔（FAIL／BLOCKED） | Actions artifact | **未核對** | **未核對** | 待決 |

簽章本身**不會**讓 trace／state 自動公開；但 public repository 的 artifact 是否可被任何人下載，需要在 B3b 前核對。在核對前，以「可能公開」設計遮罩（§10）。

Claude 不會設定或要求代為設定任何 repository variable、secret、權限或 ruleset。

## 10. 第 2 批遺留對認證的影響

| 項目 | 對認證證據鏈的影響 | 處理 |
|---|---|---|
| R1-N5：`authorize` 以 `OPERATIONS[op]` 查找，`toString` 等原型鏈名稱會被當成存在的操作 | 目前結果仍是 deny（`CAPABILITY_NOT_ENABLED`），但原因碼錯誤，會讓 §6.3 稽核對帳的 `action`／`reasonCode` 規則出現不可解釋的值 | **B3a 前置**：改用自有鍵查找，補測試 |
| R1-N6：非 Bearer `Authorization` 值以 SHA-256 記錄 | 若選 D-17 選項 A，證據公開；低熵值（例如 Basic）的雜湊可被試算還原 | **B3a 前置**：改為固定標記，不記雜湊 |
| R1-N7：遮罩掃描只蒐集最後一組 token 與密碼 | 受控執行要上傳證據前，必須用**本次執行發出的全部** token／密碼掃描 | **B3a 前置**：Runner 記錄每一個發出的秘密（只在記憶體），上傳前掃描；有任何命中 → 不上傳、`BLOCKED` |
| 無前綴、形狀像 ID 的不透明憑證 | 只要 Adapter 能拿到真實憑證，就可能把它寫進 trace；隔離後 Adapter 環境不含任何平台憑證 | B3a：沙箱 `env -i`；殘餘風險（只限虛構資料）列入 Q-3 的公開範圍決策（§13） |
| 分頁拒絕（單頁 300 筆） | 不影響目前 fixtures；任何截斷都會 fail closed | 維持；不視為永久豁免，寫入 B3 已知限制 |
| G-1～G-4 | POC-009 仍無法觀察兩欄 | 維持 `BLOCKED`；不在本批解決 |

「延後」不等於永久豁免：上表標為前置的項目，在 B3a 合併前必須完成，否則 B3b 不開始。

## 11. 分段交付、驗收條件與阻擋因素

| 段 | 內容 | 進入條件 | 驗收條件 | 結果上限 |
|---|---|---|---|---|
| **B3-0（本文件）** | 計畫、決策包、schema 草案、攻擊矩陣 | — | ChatGPT 審查；使用者回答 §13 | — |
| **B3a** | R1-N5～N7；隔離政策 `s2-isolation-policy-v1` 與沙箱啟動器（§3.3）；自我檢查與正向控制；終止 → 匯出 → 對帳（§6）；封存與 manifest（§3.4）；安全解析（§7.4）；認證 nonce 流程（§5，待 Q-4）；statement 產生器；Verifier（純函式，輸入：封裝＋可信輸入）；攻擊測試 A1–A3、A5–A9、A11–A13、A15–A17（本機） | 本文件審查通過；Q-1～Q-4 回答 | 全部攻擊測試在本機得到預期結果；正向控制通過；第 2 批回歸通過 | `UNATTESTED`（沒有簽章） |
| **B3b** | `attest.yml`、`S2B2-TRUST-POLICY.json`、受保護清單、`repo_policy` 測試修改；GitHub runner 上的沙箱與自我檢查；A4、A10、A14、A18 | B3a 合併；§9.2 未核對事項核對；§4.3 的批准步驟完成（紀錄、錨定、兩個變數） | 在 GitHub runner 上自我檢查全部通過；攻擊測試通過；簽章可依 §7.3 由第三方驗證。批准步驟完成前一律不得 `PASS` | 可能 `PASS` |
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

v0.2 縮減為 4 題。v0.1 的 Q-C（變數固定）併入 Q-2；Q-D（開放網路）取消：官方事實已由審查者核對，其餘在 B3b 前核對。

| # | 問題 | 推薦 | 為何 |
|---|---|---|---|
| Q-1（D-17） | 信任根採哪一個？ | 選項 A：GitHub artifact attestation，subject 是 `statement.json`；只簽 `PASS`（§3.1、§7.3） | public repository 可用；不需要保管金鑰；第三方可依政策獨立驗證 |
| Q-2（Q1＋錨定） | CI 與批准形式？ | 新增 `attest.yml`，只用手動與 `main` 觸發；執行 job 與驗證 job 分開；`ci.yml` 不變。批准紀錄 `S2B2-TRUST-POLICY.json`＋兩個由你設定的變數；相關檔案全部列入外部錨定（§4、§9.4、§9.5） | 簽章權限不接觸 PR 程式碼；批准有歷史與撤銷 |
| Q-3 | 公開與保存範圍（§9.6）：bundle 必然公開；`statement.json` 與封裝檔是否上傳為 Actions artifact、是否在 `main` 提交摘要、保存多久？ | bundle 公開（必然）；`statement.json` 上傳並在 `main` 提交摘要；封裝檔只上傳 artifact，保存期限依 D-07 先採平台預設；全部以「可能公開」設計遮罩 | 只用虛構資料；可追溯；不把原始證據提交到 `main` |
| Q-4 | 是否同意依 §5 的 nonce 一致流程（含 READY／GO 逾時、`runAttempt` 綁定、標記不可改寫），在 B3a 把 `S2B2-ATTESTATION.md` 修訂為 v0.3？ | 同意 | 消除 §3／§4 與 §9.2 的矛盾 |

在這些問題回答前，不進入 B3a 實作。

## 14. 未驗證與限制

- 審查者已核對的平台事實見 §9.2；其餘（方案與費用、hosted runner 命名空間、job outputs 與 artifact ID 的保證、artifact 存取範圍與保存、fork PR 的 OIDC 行為、確切 CLI 指令）**未核對**。
- 本機命名空間探查以 root 執行，只是可行性證據；沒有驗證非 root Adapter 的完整隔離；GitHub runner 上未驗證。
- schema 草案的驗證範例（合法控制組與拒絕案例）以本機 `jsonschema` 執行，附在審查請求中；schema 通過不代表 `PASS`（§7.5）。
- 本文件沒有任何實作；沒有執行新的 Emulator 測試。
- 本次盤點使用了一次唯讀的 `gh api` 呼叫取得 repository 設定，這不符合本執行環境「`gh` 只用於搜尋」的指引；沒有任何寫入，已記錄於此。
