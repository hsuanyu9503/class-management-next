# S2-B2 第 4 批（B4）｜Firebase 受控寫入核心：實作報告

> 依 `S2B2-B4-PLAN.md` v0.2（PR #20，main `42db0e4`），以及負責人 2026-11-24 的決定「pr20合併，依gpt的建議執行」：
> - Q1：採用 POC-016／017／018／021；
> - Q2：G-9、G-10 只登記為缺口持續追蹤，不擴張範圍；
> - Q3：採用七項新增路徑的負向測試。
>
> 風險等級 **L3**：改動受控 API、可信判定程式、Runner 白名單與 `attest.yml` 的 dispatch 選項。
>
> **不授權**：
> - 開啟 PASS、修改 Settings、觸發 hosted、合併、網站頁面製作；
> - `PASS_ENABLED=false`、POC-009 BLOCKED、Stage 1 的 72 筆 `NOT_RUN` 都不變；
> - 本機結果最多 `UNATTESTED`，不回填鎖定的測試矩陣或 72 筆計畫。

## 1. 變更

| 檔案 | 變更 |
|---|---|
| `poc/stage2/src/api/commit.mjs`（新） | `LeaveRecord.Revise` 的處理：格式檢查（授權前）、輸入驗證（授權後）、`requestHash`、§8 第 3～5 步、交易競爭重試（最多 5 次） |
| `poc/stage2/src/api/txn.mjs`（新） | Firestore REST 交易：`beginTransaction`／`batchGet`／`commit`／`rollback`；交易 ID 寫在請求本體中，back trace 會記錄。錯誤分類：`ABORTED` 可重試，其他一律是後端錯誤 |
| `poc/stage2/src/api/server.mjs` | 新增 `POST /v1/commit`、`POST /v1/receipt`；`/v1/read` 不變。稽核紀錄加上 `operationId`、`requestHash`、`attempts`、`transactionRef`。`mutation` 參數只供測試注入，Runner 不傳 |
| `poc/stage2/src/authz.mjs` | `WRITE_OPERATIONS`，與讀取操作分開：任一路由都不能授權另一路由的操作。新增 `checkReceiptAccess`（§3.1.2）。§6.1 的共同步驟抽成函式，讀取路徑的行為不變 |
| `poc/stage2/src/api/request-shape.mjs` | 依路由投影 front trace 中的請求本體：commit 命令逐欄、只在格式正確時記錄值；收據查詢只記 `operationId`、`workspaceId` |
| `poc/stage2/src/trace-proxy.mjs` | 每筆紀錄都有 `endedAt`。front 代理新增兩種可信的故障（只依可信表格設定）：POC-017 的同步點、POC-021 的回應遺失；commit 與收據查詢記錄 `receiptDigest`、`delivered` |
| `poc/stage2/src/b4/commit-trace.mjs`（新） | 判定用的輔助函式（可信工具鏈）：<br>- 從 back trace 重建交易；<br>- 判定端自己的 `requestHash` 與意圖對照表；<br>- 五項寫入集合的精確核對；<br>- 並行重疊證明、每次嘗試的摘要 |
| `poc/stage2/src/observer.mjs` | POC-016／017／018／021 的 Observer |
| `poc/stage2/src/b3/reconcile.mjs` | 寫入的對帳：<br>- 交易綁定；<br>- commit 寫入能解釋每一項狀態變更；<br>- 稽核紀錄中 API 的自我報告逐欄核對；<br>- 被拒絕的提交與收據查詢都沒有交易 |
| `poc/stage2/src/b3/verifier.mjs` | `CASE_ACTORS` 加入四個案例；`CASE_FRONT_FAULTS` 與 `checkFrontFaults`；`INCONCLUSIVE:*` 列入理由；版本 `s2-verifier-b4-0` |
| `poc/stage2/src/b3/attest-verify.mjs`、`scripts/run-attest-execute.mjs`、`test/b3-run.mjs` | 白名單加入四個案例；b3-run 的誠實案例迴圈也跑這四個，front 故障由可信表格決定 |
| `.github/workflows/attest.yml` | dispatch 的 `options` 加入 POC-016／017／018／021。push 仍固定 POC-001；權限、`if`、environment、SHA 固定都不變 |
| `poc/stage2/src/harness.mjs` | `startStack` 接受 `frontFaults` 與 `mutation`（後者只供測試） |
| `poc/stage2/adapter-b3/core.mjs`、`client.mjs` | 受測的 Adapter（不在錨定範圍）：四個寫入案例的請求與宣稱 |
| `poc/stage2/test/b4-unit.test.mjs`（新）、`test/b4-run.mjs`（新）、`scripts/run-b4.mjs`（新）、`package.json`（`s2:b4`） | 單元測試；Emulator 上的誠實案例、mutation 與七項負向測試 |
| `poc/stage2/test/b3-unit.test.mjs` | N8 測試加入四個案例；Verifier 版本 |

**不改**：
- `attest-attack.yml`、`attest-sigtest.yml`、信任政策；
- `PASS_ENABLED`；
- Security Rules，仍拒絕一切，寫入只經受控 API；
- 鎖定的 fixtures、契約、測試矩陣。

## 2. 授權 §8 對照（`S2B1-AUTHORIZATION.md` §6.5、§8；計畫 §3.1）

| 規格 | 實作 | 測試 |
|---|---|---|
| §6.5／§8 第 1 步：先授權（`leave.revise`），失敗就 `FORBIDDEN`，**不讀收據** | `server.mjs` `handleCommit`：格式檢查 → `authorize(..., WRITE_OPERATIONS)` → 失敗就 403；之後才建立交易 | 單元：寫入操作分開、缺 `leave.revise` 時拒絕；NEG-6：ACTOR-OTHER／ACTOR-TEACHER／沒有 token 都 403，back trace 中沒有交易，也沒有讀收據；reconcile 的 `receiptReadBeforeAuthorization` |
| 第 2 步：`requestHash`（`sha256-stablejson-v1`） | `commit.mjs` `requestHashInput`：伺服器解析的 scope 與 principal，加上 client 命令欄位；不含 `operationId`、`clientCreatedAt` | 單元：測試向量 `ff212f32…` 與三個變體（`2e0195cf…` 是 principal `ACTOR-SC01-TEACHER-2`、`9f0a1d08…`、`37793557…`）；判定端另有一份獨立實作，兩者一致；POC-016 狀態中的收據等於測試向量 |
| 第 3 步：同一交易內讀收據：不存在 → 繼續；雜湊相同 → 原收據，不寫入；雜湊不同 → `{code, operationId}`，不寫入 | `processCommit`：在交易中先 `batchGet` 收據；雜湊相同就 rollback 並回傳；雜湊不同就 409 | 單元：三個分支與呼叫順序；POC-018：99 次重送只讀收據、不讀 current、不 commit；NEG-2：409 只有 `code,operationId,traceId`，狀態不變 |
| 第 4 步：讀 current，版本不符 → `VERSION_CONFLICT`，不寫入 | 同一交易中第二次 `batchGet`；不符就 rollback 並回 409 | 單元；POC-017：輸的一方最後一次嘗試讀到 v6、沒有 commit、已 rollback |
| 第 5 步：同一交易寫入 current、revision、receipt、event、`derivedProgress` | 一次 commit，恰好 5 項寫入：<br>- current 以本交易讀到的 `updateTime` 為前提條件；<br>- 其餘 4 項都是 `exists:false`（只能新建） | 單元：實際送出的前提條件與 5 個完整路徑；POC-016：`checkCommitWriteSet`；拆成兩次 commit 的 mutation 被抓到 |
| 交易競爭（計畫 §2.1） | Emulator 回 `ABORTED` 時，在**新的**交易中從第 3 步重來，最多重試 5 次；超過上限回 503 `TRANSACTION_CONTENTION`。其他錯誤一律是後端錯誤，不會是 `VERSION_CONFLICT` | 單元：重試 5 次後成功；一直 abort 時 6 次嘗試後回 contention；重試讀到新版本時才是真的衝突；NEG-7（真的 Emulator 加故障代理） |
| §6.4／§8 查詢收據：不需要 capability；只有收據的本人、且對 `receipt.classId` 仍有有效 class membership 才回傳；否則與「不存在」相同 | `checkReceiptAccess`：先做 §6.1 身分檢查，再讀收據；路徑與內容必須一致；本人檢查；membership 檢查。`derivedStatus` 讀自 `derivedProgress`，收據本身不變 | 單元：六種情況，包括身分失效時不會讀收據；NEG-1：沒有 `leave.revise` 的本人可以查；他人、不存在、沒有 membership、membership 過期、binding 停用都 403，回應形狀相同 |

## 3. 四個案例：判定方式與本機結果

判定只採信 front／back trace 與 Emulator 匯出的狀態（計畫 §2.1），**不**採信 Adapter 的宣稱，也不採信 API 的自我報告。

| 案例 | 判定重點 | 沙箱（`s2:b3`） | 程序內（`s2:b4`） |
|---|---|---|---|
| POC-016 | back trace 中整個案例只有一次成功的 commit；5 項寫入的完整路徑、種類、前提條件與內容，由判定端從 pre 狀態、front 命令與同一交易的讀取重算；狀態中只有這 5 份文件改變；點名不變；回應中的收據等於狀態中的收據 | `UNATTESTED`，契約 `MATCH` | `MATCH`：`officialVersion 6`，各 delta 都是 1，`attendance N` |
| POC-017 | 兩個請求的 `operationId` 不同、`expectedVersion` 相同、意圖不同；兩個交易**時間重疊**，否則是 `INCONCLUSIVE`；輸的一方最後一次嘗試讀到 v6、沒有寫入；嘗試次數在上限內 | `UNATTESTED`，`MATCH` | `MATCH`：`successes 1`、`conflicts 1`、`silentOverwrite false` |
| POC-018 | 100 次相同的命令；只有第一次 commit；其餘 99 次只讀收據；100 份收據的 digest 都相同，且等於狀態中的收據 | `UNATTESTED`，`MATCH` | `MATCH`：`uniqueReceiptIds 1`，以整份收據的 digest 計算，不只看 ID |
| POC-021 | front trace 記錄 API 回了 200 與收據 digest、`delivered:false`；之後以原 `operationId` 查詢，得到的 digest 與遺失的回應相同，也等於狀態中的收據；查詢的 trace 中沒有交易；整個案例只有一次 commit | `UNATTESTED`，`MATCH` | `MATCH`：`receiptRecovered true`、`duplicateCommit false` |

- 沙箱：run `S2B2B3A-20261124T022727Z-045298c0`，37/37。
  - 八個誠實案例中，七個的結果都是 `UNATTESTED [LOCAL_UNTRUSTED_RUNNER, TRUST_ROOT_NOT_CONFIGURED]`；
  - POC-009 仍是 `BLOCKED [BLOCKED_FIELDS_G1_G4]`；
  - 既有的 A1～A16 攻擊與套件層級攻擊結果都不變。
- 程序內：三次連續執行都是 27/27（`S2B2B4-20261124T022847Z`：26/27，原因見下；`…T023014Z-1a8b41bd`、`…T023110Z-61bd6918`：27/27）。
  - 第一次的唯一失敗是一項「Emulator 一定會 abort 並重試」的檢查：Emulator 也可能讓第二個讀取等第一個 commit 完成。兩種都是合法的序列化方式，契約結果都相同。
  - 這一項已改成只記錄、不判定的 INFO；重試邏輯另由單元測試與 NEG-7 確定地覆蓋。
  - 觀察到的兩種模式：`ABORTED_THEN_RETRIED`，鎖逾時約 2 秒；`READ_WAITED_BEHIND_COMMIT`。

## 4. 實作審查須核驗的 5 項（PR #20 複審）

| # | 要求 | 做法 | 證據 |
|---|---|---|---|
| 1 | 並行判定用同一可信時間基準與交易關聯，不看 trace 檔的寫入順序；同步釋放只是安排；重試不沿用舊讀值，記錄首次與重試次數 | 時間區間是每筆 back-proxy 紀錄的 `[at, endedAt]`，來自同一個代理程序的時鐘。判定條件：兩個請求的第一次嘗試，都在最早的成功 commit **結束之前**開始並完成第一次讀取，時間相同也不算重疊。交易依 beginTransaction 回應中的 ID 分組；每次嘗試的讀取只能屬於它自己的交易 | 單元：故意反轉檔案順序仍判為重疊、依序的請求不重疊、時間相同不算；mutation T1、T2；`MUT-sequential-adapter` 只被並行檢查擋下（`onlyProblem`）；Observer 證據中有 `attempts`（每次嘗試的交易、讀到的版本、commit 結果） |
| 2 | 稽核寫入的例外只限已知路徑與操作；commit 集合核對完整路徑、操作種類、前提條件與安全欄位 | 稽核只接受稽核路徑上、只能新建、內容與匯出逐欄相同的 PATCH（既有規則）；commit 寫入不得指向稽核路徑或 `_` 開頭的路徑；`checkCommitWriteSet` 核對完整路徑、`update` 種類、沒有 mask 或 transform、前提條件，以及判定端重算的內容 | 單元：少一項、多一項、前提條件錯誤、收據內容被改都會被點名；NEG-3e；mutation T4～T6 |
| 3 | trace 的遮罩保留判定需要的交易關聯與前提條件，不洩漏敏感內容；證據缺漏就拒絕或列為無法判定 | back trace 保留 Firestore 的請求與回應本體，與既有的稽核 PATCH 相同，用同一個遮罩器處理。這些集合不含敏感文字（I-11）。front 投影逐欄記錄，值的格式不符就不記錄；判定需要的欄位缺漏時，結果是 `COMMAND_NOT_FULLY_RECORDED`，不是通過 | 遮罩掃描：程序內 71 個檔案、沙箱 120 個檔案，都是 0 洩漏；NEG-3b～3d：缺少 commit、交易 ID 不符、beginTransaction 回應被改，都被拒絕 |
| 4 | 021 的 digest 明定序列化與範圍；不可變收據與 `derivedStatus` 分開 | `receiptDigest = sha256(stableJson(responseBody.receipt))`，範圍只有 `receipt` 成員（11 個欄位），不含 `code`、`traceId`、`derivedStatus`。`derivedStatus` 另外與 `derivedProgress` 比對 | 單元：digest 範圍；mutation P1；POC-021 的 `lookupDerivedStatusEqualsDerivedProgress` |
| 5 | 實際展示 mutation 被判定器抓到 | §6 | §6 |

## 5. 新增路徑的負向測試（計畫 §3.4，七項）

| # | 測試 | 結果 |
|---|---|---|
| 1 | 他人的收據、不存在的收據 | 403 `{code, traceId}`，形狀相同。另外測了沒有 membership、membership 過期、binding 停用。沒有 `leave.revise` 的本人可以查（REV-20-01）。所需的測試身分與收據放在獨立的 Stage 2 測試設定中，只在這個測試中載入；不是 POC 案例的 principal，也不授予新的 capability |
| 2 | 同一個 `operationId`、不同內容 | 409 `OPERATION_REUSE_MISMATCH`，只有 `code,operationId,traceId`；狀態不變；不含原收據的欄位。POC-019 的完整案例仍在 B5 |
| 3 | 偽造或缺漏的交易證據 | 3a：API 自報的 `transactionRef` 錯誤，被 reconcile 抓到，雖然契約仍是 `MATCH`；3b：back trace 沒有 commit；3c：commit 引用不屬於這個請求的交易；3d：beginTransaction 回應被改；3e：commit 本體少了 event。全部被拒絕 |
| 4 | 拆成兩次 commit | `SUCCESSFUL_COMMITS:2`；稽核的 `attempts`、`transactionRef`、`outcome` 都對不上，被拒絕 |
| 5 | 收據查詢時寫入 | 查詢的 trace 中出現交易，判為 `transactionOrWriteWithoutCommit`，`lookupTracesReadOnly` 失敗，被拒絕 |
| 6 | 沒有授權的提交 | 403；back trace 中沒有交易，也沒有讀收據 |
| 7 | 交易競爭超過重試上限 | 6 次嘗試後回 503 `TRANSACTION_CONTENTION`，稽核的 `attempts 6`、`transactionRef null`；判定端算出 `conflicts 0`，不會算成 `VERSION_CONFLICT` |

## 6. Mutation

**程序內的情境 mutation**（`s2:b4`，真的 Emulator；每一項都要被判定拒絕）：

| Mutation | 抓到的判定 |
|---|---|
| 跳過收據檢查（POC-018） | 寫入集合（收據沒有先讀到「不存在」）、replay 斷言、收據 digest 不一致 |
| 跳過版本檢查（POC-017） | 契約 `MISMATCH`：`conflicts 0` |
| 拆成兩次 commit（POC-016） | `SUCCESSFUL_COMMITS:2`；稽核對帳失敗 |
| 查詢收據時以新的 `operationId` 重新執行（POC-021） | `revisionDelta 2`、`duplicateCommit true`；查詢 trace 中有交易 |
| 查詢收據時寫入（POC-021） | 同上 |
| API 自報不存在的交易 ID（POC-016） | reconcile `transactionRef` |
| Adapter 依序送出（POC-017，同步點逾時） | **只有** `INCONCLUSIVE:CONCURRENCY_NOT_ESTABLISHED` |
| 沒有設定回應遺失（POC-021） | `FRONT_FAULT_MISMATCH:drop:0`、`INCONCLUSIVE:RESPONSE_LOSS_NOT_ESTABLISHED` |

**原始碼 mutation**（`mutate-b4.py`，本機執行，不提交）：結果見 §6.1。

### 6.1 原始碼 mutation 結果

- **B4：28/28 被抓到**（`mutate-b4.py`）。
  - API（F1～F9）：
    - 收據沒有先讀；
    - 不檢查版本；
    - 重試上限改成 6；
    - 交易競爭回報成 `VERSION_CONFLICT`；
    - current 的前提條件改成 `exists:true`；
    - 新建時沒有前提條件；
    - `requestHash` 包含 `operationId`；
    - 重用不符時洩漏收據；
    - 重試沿用舊交易。
  - 授權（A1～A5）：
    - 不檢查收據本人；
    - 不檢查 membership；
    - 先讀收據才檢查身分；
    - 讀取路由接受寫入操作；
    - 查收據要求 `leave.revise`。
  - 判定（T1～T7、V1～V2、P1）：
    - 時間相同也算重疊；
    - 依檔案順序判定；
    - 接受未綁定的交易；
    - 不核對寫入數量、前提條件、收據內容、讀取順序；
    - 回應遺失與同步點的故障核對被移除；
    - digest 涵蓋整個回應封套。
  - 整合層（G1～G4，真的 Emulator）：
    - reconcile 不比對 `transactionRef`；
    - Observer 不要求交易重疊；
    - reconcile 允許收據查詢使用交易；
    - 收據查詢不做本人／membership 檢查。
  - **G3 第一次沒有被抓到**。原因是 Observer 的 `lookupTracesReadOnly` 也會拒絕同一個情境，測試無法單獨證明 reconcile 這一層有效。
    - 已在 `b4-run.mjs` 加上 `reconcileProblem`：受控的 mutation 必須**同時**被 reconcile 單獨點名；
    - 重跑後 G3 被抓到。
- **既有的 mutation 組**（C-1、C-1 R1～R5、C-1f、C-2、C-2 REV、C-2 Windows、C-3、PR #17）：145 被抓到，1 存活。
  - 存活的是 Y5，與先前的紀錄相同，是等價 mutation；
  - 沒有 SKIP-TARGET。

## 7. 回歸

| 測試 | 結果 |
|---|---|
| `npm run check` | 通過 |
| `npm test`（根目錄） | 20/20 |
| `npm run stage1:all` | 通過；72 筆 `NOT_RUN` 計畫不變 |
| `npm run s2:test`（Stage 2 單元，含 b4-unit） | 191/191 |
| `s2:b3`（沙箱，Linux root） | run `S2B2B3A-20261124T022727Z-045298c0`，37/37 |
| `s2:b4`（程序內，Emulator） | 27/27（`S2B2B4-20261124T023014Z-1a8b41bd`、`…T023110Z-61bd6918`） |
| `s2:cases`（第 2 批讀取案例） | run `S2B2B2-20261124T024342Z-ab2261e4`：四個案例結果不變（POC-001／002／008 `MATCH`、POC-009 `PARTIAL_MATCH_REST_BLOCKED`）；負向控制 71/71；mutation 7/7 |
| hosted | **未執行**：要在合併後，由負責人逐一觸發 |

以上都是作者在本機（Linux）的結果，不是審查者的獨立重跑。

## 8. 受保護檔案與錨定

- 改到的受保護檔案：
  - `.github/workflows/attest.yml`
  - `poc/stage2/package.json`
  - `poc/stage2/scripts/run-attest-execute.mjs`
  - `poc/stage2/test/b3-run.mjs`
  - `poc/stage2/src/` 下的 `authz.mjs`、`harness.mjs`、`observer.mjs`、`trace-proxy.mjs`、`api/request-shape.mjs`、`api/server.mjs`、`b3/attest-verify.mjs`、`b3/reconcile.mjs`、`b3/verifier.mjs`
  - 新增：`api/commit.mjs`、`api/txn.mjs`、`b4/commit-trace.mjs`（位於受保護的 `poc/stage2/src` 目錄）
- 新錨定（`node scripts/verify-anchor.mjs --print`，95 檔）：
  `ddff49c60960495f44fa75b064b01968f1c01c23c96f324b46ebccb5fb364660`。
  - 原本的值是 `caee1653…`（92 檔）；
  - 合併前要由負責人重新核准 repository variable `CMN_STAGE1_ANCHOR_SHA256`。Claude 不設定也不要求設定；
  - 如果審查後還要修改受保護檔案，錨定會再改變，要以最後一個受保護 commit 為準。
- 不受保護、依設計：受測的 Adapter（`adapter-b3/`）與單元測試；`test/b4-run.mjs`、`scripts/run-b4.mjs` 是本機測試，不是 hosted 的入口。

## 9. 已知限制

- **Emulator 不等於正式環境**：
  - Emulator 的交易使用讀寫鎖，鎖逾時約 2 秒；正式的 Firestore 採用樂觀並行，行為不同；
  - 本批證據只代表「在 Emulator 中，同一份契約成立」。正式環境的驗證屬於 Stage 4（ADR-001 §5）。
- **G-4**：沒有可信的節次日曆，所以意圖**只改** `dayPart`，`periodRefs` 保持原值、不重算。
  - 四個案例的預期結果都不依賴 `periodRefs`；
  - `AM_TO_FULL_DAY`／`AM_TO_PM` 之後的節次，等 G-4 決定。
- **稽核不在同一交易中**：提交 commit 之後，另以只能新建的 PATCH 寫入稽核，沿用讀取 API 的作法，由 reconcile 逐欄對帳（計畫 §2.1）。
  - commit 成功但稽核寫入失敗時，會回 503，但寫入已經生效，可以由收據查詢恢復。這是已知的殘餘風險。
- **`TRANSACTION_CONTENTION`**：回應碼是 `UNAVAILABLE`（Stage 1 的錯誤碼），另加 `reason` 欄位；稽核的 `outcome` 是 `TRANSACTION_CONTENTION`。
- **front 代理不是隔離邊界**：沿用 B3a，有 §9 隔離的前提才成立。同步點與回應遺失由可信的 Runner 依表格設定，Verifier 會核對。
- **mutation 參數**（`mutation`、`authorizeFn`）在受控 API 中，只有測試能傳入。Runner（`b3-run.mjs`）與 `attest.yml` 不傳。
