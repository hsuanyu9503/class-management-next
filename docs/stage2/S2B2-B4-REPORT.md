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
| POC-016 | **（R1，REV-21-01）先核對案例本身的操作**：命令必須正是 fixture `canonicalCommand`，也就是 LV-007、v5、`AM_TO_FULL_DAY`、原 `operationId` 與 scope；目標 pre 狀態是 v5、AM，post 是 FULL_DAY。之後再核對：back trace 中整個案例只有一次成功的 commit；5 項寫入的完整路徑、種類、前提條件與內容，由判定端從 pre 狀態、front 命令與同一交易的讀取重算；狀態中只有這 5 份文件改變；點名不變；回應中的收據等於狀態中的收據 | `UNATTESTED`，契約 `MATCH` | `MATCH`：`officialVersion 6`，各 delta 都是 1，`attendance N` |
| POC-017 | 兩個請求的 `operationId` 不同；目標與 `expectedVersion 5` 由可信表格綁定；意圖恰好是一個 `AM_TO_FULL_DAY`、一個 `AM_TO_PM`。兩個交易**時間重疊**，條件見 §4 第 1 項（R1），否則是 `INCONCLUSIVE`；輸的一方最後一次嘗試讀到 v6、沒有寫入；嘗試次數在上限內 | `UNATTESTED`，`MATCH` | `MATCH`：`successes 1`、`conflicts 1`、`silentOverwrite false` |
| POC-018 | 100 次都是 `canonicalCommand`（由可信表格綁定）；只有第一次 commit；其餘 99 次只讀收據；100 份收據的 digest 都相同，且等於狀態中的收據 | `UNATTESTED`，`MATCH` | `MATCH`：`uniqueReceiptIds 1`，以整份收據的 digest 計算，不只看 ID |
| POC-021 | 提交的命令是 `canonicalCommand`（由可信表格綁定）；front trace 記錄 API 回了 200 與收據 digest、`delivered:false`；之後以原 `operationId` 查詢，得到的 digest 與遺失的回應相同，也等於狀態中的收據；查詢的 trace 中沒有交易；整個案例只有一次 commit | `UNATTESTED`，`MATCH` | `MATCH`：`receiptRecovered true`、`duplicateCommit false` |

- R0（Head `047b05d` 之前）的結果記錄在下方，保留作為歷史。**R1 的結果見 §10。**
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
| 1 | 並行判定用同一可信時間基準與交易關聯，不看 trace 檔的寫入順序；同步釋放只是安排；重試不沿用舊讀值，記錄首次與重試次數 | 時間區間是每筆 back-proxy 紀錄的 `[at, endedAt]`，來自同一個代理程序的時鐘。<br>**R1（REV-21-02）的判定條件**：兩個請求的第一次嘗試，各自在交易中做的每一次讀取（至少包括收據與 current）都要：<br>- 成功（HTTP 200，有 found 或 missing 的結果）；<br>- 時間有效（`at ≤ endedAt`）；<br>- **結束時間嚴格早於**最早的成功 commit 結束時間。<br>也就是兩個交易都已經讀到 current，而且還沒有任何一方完成 commit。時間相同不算。<br>R0 只比較讀取的開始時間，這是審查指出的落差，已修正。<br>交易依 beginTransaction 回應中的 ID 分組；每次嘗試的讀取只能屬於它自己的交易。<br>**安排**：back 代理的 commit hold（只用於 POC-017），在兩個不同的請求都完成 current 的讀取之前，暫不送出任何 commit。它只是安排，判定仍依上面的時間條件 | 單元：<br>- 故意反轉檔案順序仍判為重疊；<br>- 依序的請求、時間相同的邊界，都不算重疊；<br>- 審查者的反例（讀取在 commit 結束之後才完成）、讀取失敗、時間缺漏或倒置、沒有 current 讀取，都判為未建立；<br>- 真的 loopback 代理上的 hold 測試。<br>mutation T1、T2、C1～C5、H1、H2；`MUT-sequential-adapter` 只被並行檢查擋下（`onlyProblem`）；Observer 證據中有 `attempts`（每次嘗試的交易、讀到的版本、commit 結果） |
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
| `s2:b4`（程序內，Emulator） | 27/27（`S2B2B4-20261124T023014Z-1a8b41bd`、`…T023110Z-61bd6918`；加入 `reconcileProblem` 之後，以目前的測試程式再跑：`…T024829Z-872a46e2`） |
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
- R0 的錨定（95 檔，已被 R1 取代，見 §10）：
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

## 10. R1（PR #21 審查，Reviewed Head `047b05d`）

| ID | 問題 | 處理 | 測試 |
|---|---|---|---|
| REV-21-01（P1） | POC-016 只依受測命令自己的意圖重算寫入，沒有綁定本案例的操作：API 正確執行 `AM_TO_PM`，結果也是 `MATCH` | 新增 `src/b4/case-ops.mjs`（可信工具鏈）：每個寫入案例必須執行的操作，取自鎖定的 `canonicalCommand` 與 `SC01-COMMITTED-v6`，不修改 oracle。Observer 的四個案例都先核對：<br>- 命令欄位（POC-016／018／021 的完整 `canonicalCommand`；POC-017 的目標、版本與兩個指定意圖）；<br>- claimedScope；<br>- 目標路徑；<br>- pre 狀態的版本與 dayPart；<br>- POC-016／018／021 的 post dayPart 必須是 FULL_DAY。<br>不符就是 `CASE_OPERATION_MISMATCH:*`，結果為 `BLOCKED`（`OBSERVATION_AMBIGUOUS`） | 單元：<br>- 案例表格等於鎖定的 fixtures；<br>- 審查者的合成重現：完整判定中，`AM_TO_FULL_DAY` 是 `MATCH`；正確執行的 `AM_TO_PM` 被拒絕（`intent[0]`、`postDayPart`）；<br>- 目標、版本、operationId、scope、目標路徑、POC-017 的意圖都會被點名。<br>Emulator：`MUT-wrong-intent-POC-016` 被拒絕。<br>mutation K1～K6 |
| REV-21-02（P2） | 並行證據只比較開始時間，沒有落實「完成讀取」 | 見 §4 第 1 項：嚴格條件，加上 back 代理的 commit hold（`CASE_BACK_FAULTS`，Verifier 以 `checkBackFaults` 核對：設定的案例每次 commit 都有 hold 紀錄，其他案例沒有）。Emulator 只能提供較弱的證據時，結果如實為 `INCONCLUSIVE` | 單元：審查者的反例與各種邊界；hold 的 loopback 測試。Emulator：`MUT-no-back-hold-POC-017` 被拒絕（`BACK_FAULT_MISMATCH:hold`）；`MUT-sequential-adapter` 仍只因 `INCONCLUSIVE` 被擋下；誠實的 POC-017 證據中，兩方的讀取結束時間都早於 commit 結束，hold 紀錄是 `complete` |

**R1 的結果**（作者在本機 Linux 執行；不是審查者的重跑）：
- `s2:test` 198/198（含 b4-unit 23 項）；`npm test` 20/20；`check`；`stage1:all`；`s2:cases` run `S2B2B2-20261124T072147Z-498f8158`：四個讀取案例結果不變，71/71、7/7。
- `s2:b3`（沙箱，src 與 `971a7d3` 相同）：run `S2B2B3A-20261124T064146Z-355fa5d8`，37/37；四個寫入案例都是 `UNATTESTED`，`MATCH`。
- `s2:b4`：`S2B2B4-20261124T063821Z-e3ad7c27`、`…T063934Z-0ae49e78`、`…T071949Z-9a4ee395`（最後版本 `da5fafd`），都是 29/29。
  - 本機一次中間執行（`…T063645Z-22944a92`）是 28/29。原因是 commit 在 hold 釋放之後才抵達，紀錄寫成 `releasedAt: null`、`complete: false`，hold 本身的行為正確。
  - 已改為記錄 hold 何時、因何釋放（`readers`）。
- 原始碼 mutation：
  - R1 新增 13 項（K1～K6、C1～C5、H1～H2）：13/13 被抓到；
  - B4 原有 28 項：28/28 被抓到。T1 的目標字串因 REV-21-02 改寫而消失，已改為「忽略每個請求的理由」，被抓到；
  - 第一輪中，K5（不綁定目標路徑）與 H2（只有一個讀取者就釋放 hold）存活。已加上單元測試：目標路徑不符，以及真的 loopback 代理上的 hold。重跑後兩項都被抓到；
  - 既有的 mutation 組不變：只有 Y5 存活（等價）。
- 可重播證據：附件 `out-pr21-r1`，包含：
  - `inprocess/`：run `…T071949Z-9a4ee395` 的四個誠實案例、10 項情境 mutation 與 NEG-7，每個都有 front／back trace、pre／post、`judgement.json`、`case-window.json`；
  - `sandbox/`：run `…T064146Z-355fa5d8` 的四個案例，有 `package.tar`、`job-outputs.json`、`statement.json`、`verify.json` 與 trace；
  - `replay-b4.mjs`：在審查 Head 的 checkout 上重新判定，結果與紀錄逐項相同（`REPLAY_SAME`）。
  - 被拒絕與無法判定的結果都保留。
- 新錨定：`ad7d8670dabfebf610278147c016d20acc4bc13ba2747732fadfe3a2a2395e0b`（96 檔；新增 `case-ops.mjs`）。**待負責人核准**；前一輪的 `ddff49c6…` 作廢。
- Windows 的 anchor CLI 問題（`verify-anchor.mjs` 入口判斷）另外追蹤，不在 B4 範圍。

## 11. 合併後的 hosted 執行（2026-11-24，負責人觸發）

- PR #21 由負責人合併：main `1e20989ea6393c12dd18e11db617873c297a9f4a`（Reviewed Head `f9097dd`，最後受保護版本 `971a7d3`）。
- 錨定：verify job 的環境中，`CMN_STAGE1_ANCHOR_SHA256 = ad7d8670…`，與審查通過的值相同。
- 四個 run 都是 `workflow_dispatch`，`head_sha 1e20989`，scenario `honest`；`CMN_S2_TRUSTED_TOOLCHAIN_SHA` 與 `CMN_S2_SIGNING_POLICY_BLOB` 都是空的。

| 案例 | run／attempt | execute job | verify job | package artifact（digest） | verify artifact（digest） | Verifier 結果 | statement SHA-256 |
|---|---|---|---|---|---|---|---|
| POC-016 | 45349735778／1 | 138292897964 | 138293151132 | 14899468624（`e47472c6…`，等於 `EXP_PACKAGE_SHA256`） | 14900220414（`764883ce…`） | `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]` | `0f838451…` |
| POC-017 | 45349750778／**2** | 138293890346 | 138294188567 | 14900310323（`3f1602ca…`） | 14899707352（`b1ac6f93…`） | `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]` | `4e18c6b3…` |
| POC-018 | 45349771980／**2** | 138294604231 | 138294885389 | 14899932074（`879f8c89…`） | 14899996957（`4698c705…`） | `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]` | `8ef344c5…` |
| POC-021 | 45349793785／1 | 138293270120 | 138293530042 | 14900130862（`6209289a…`） | 14900130934（`e89a66f0…`） | `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]` | `61d63ee7…` |

- 四個 run 的簽章步驟都是 skipped，交付紀錄是 `NOT_ATTEMPTED_NOT_PASS`。這是預期的結果：`PASS_ENABLED=false`，信任根也沒有設定。
- **hosted runner 上沒有 `LOCAL_UNTRUSTED_RUNNER`**。唯一的理由是 `TRUST_ROOT_NOT_CONFIGURED`。這代表 Verifier 在 hosted 上沒有發現其他問題，**不是** PASS，也不是正式驗收。
- **POC-017、POC-018 的 attempt 是 2**：API 只看得到 attempt 2 的 job。attempt 1 的原因（例如因 `concurrency: s2-attest` 排隊而被取消後重跑）由負責人確認，**不推測**。
- **證據層級**：
  - 以上數字取自 Claude 以 GitHub API 讀取的 run／job metadata、verify job 的 log 與 artifact 清單；
  - Claude 的環境下載 artifact 原檔時被網路政策拒絕（artifact 的儲存主機不在允許清單內），**沒有**對原檔做重播；
  - 原檔重播（`verifyPackage`，以及從套件內的 trace／state 重新判定）需要負責人下載這 8 個 artifact，交審查者或 Claude 核對。保存期限到 2026-12-24。
- B4 狀態：hosted 四項已執行，**原檔核對待完成**；核對完成之後才收尾 B4。

