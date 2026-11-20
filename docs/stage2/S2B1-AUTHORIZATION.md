# S2-B1｜授權規格 v0.3（草案）

> **狀態：設計文件，未實作。** 本文件不含 Security Rules 或程式；授權行為尚未在任何後端驗證，相關案例維持 `NOT_RUN`。
> v0.2：回應 PR #3 審查 R1（REV-001 授權分支、REV-002 收據與 requestHash、REV-003 fixture 能力清單、REV-006 敏感 grant；D-05 與所有待決事項的預設拒絕）。
> v0.3：回應 PR #3 審查 R2（REV-007 Auth Binding 狀態、REV-008 稽核分層、REV-009 科任點名例外；案例前置條件與 §13 機器可讀案例）。
> 相關文件：[資料模型](S2B1-DATA-MODEL.md)｜[存取矩陣](S2B1-ACCESS-MATRIX.md)｜[契約對照](S2B1-CONTRACT-TRACEABILITY.md)

## 1. 名詞

| 名詞 | 定義 |
|---|---|
| **Authentication UID**（`authUid`） | Firebase Authentication 驗證後的使用者 ID。只證明「是誰登入」，**本身不帶任何資料權限**。 |
| **Auth Binding** | `authBindings/{authUid}`：把一個 `authUid` 綁定到一個 principal 的紀錄，有自己的狀態與生效時間（§6.7）。 |
| **Principal**（`principalId`） | 系統內的人員主體。`authUid` 必須經 `status = active` 的 Auth Binding 綁定到一個 `status = active` 的 principal。Binding、Principal、Membership 三者**各自**都必須有效。 |
| **Membership** | Principal 在某工作空間的授權紀錄。`scopeType = class` 對應一個班級；`scopeType = workspace` 只用於工作空間管理。 |
| **Capability** | 最小授權單位。每個 capability 固定屬於一種 scopeType（§4）。**所有授權判斷只看 capability。** |
| **Role Preset** | 建立 membership 時帶入預設 capability 的範本。**角色名稱不參與授權判斷。** |
| **Scope** | 授權的作用範圍：`workspaceId`（＋`classId`）＋有效期間＋學期狀態。 |

## 2. 決策 A｜班級精確授權

1. 一個工作空間可以管理多個班級。
2. 班級資料只能經 `scopeType = class` 的 membership 授權，且**一筆只對應一個 `classId`**；要存取兩個班級就需要兩筆。
3. 同一工作空間的身分不代表可以讀取全部班級。`scopeType = workspace` 的 membership 只授予工作空間管理能力，**不授予任何學生、在籍、點名、請假、核對事項、View、統計或匯出的讀取權**（I-17）。
4. 沒有萬用字元班級（例如 `classId = "*"`）。

## 3. 決策 B｜敏感請假資訊

1. 請假摘要與敏感備註分開保存；摘要不含「是否有敏感備註」的旗標（資料模型 §3.6）。
2. 讀取與修改敏感備註分別需要 `leave.sensitive.read`、`leave.sensitive.revise`，**而且都必須有對應的有效 `sensitiveGrants`**（§7）。
3. **任何 Role Preset 都不包含 `leave.sensitive.*`**；導師、科任、管理者都不能只憑角色取得。
4. 敏感文字不得流入一般展示 View、投影、統計、事件、收據、稽核或匯出。匯出時由伺服器在資料來源端裁剪（POC-029）。

## 4. Capability 清單

- **啟用狀態**：`啟用` 表示 Stage 1 fixtures 已使用的名稱；`未啟用` 表示 S2-B1 提案，**在 D-09 核准前一律視為未授予**（預設拒絕）。
- **scopeType**：capability 只在相同 scopeType 的 membership 上有效；放在另一種 membership 上一律無效（I-17）。

| Capability | 允許的操作 | scopeType | 啟用狀態 |
|---|---|---|---|
| `attendance.read` | 讀取該班點名場次（含 `rosterSnapshot`）、正式點名、`attendance-summary` 與 `projection` View | class | 啟用 |
| `attendance.write` | 經 API 建立當日點名、登記狀態 | class | 啟用 |
| `attendance.revise` | 經 API 更正已提交的點名；讀取點名修訂紀錄 | class | 啟用 |
| `leave.applicability.read` | 讀取請假適用提示（`leave-applicability` View），不含假別與理由 | class | 啟用 |
| `leave.read` | 讀取請假摘要（含假別與涵蓋區段），不含敏感備註 | class | 啟用 |
| `leave.revise` | 經 API 修改請假摘要；讀取請假摘要修訂紀錄 | class | 啟用 |
| `issue.read` | 讀取核對事項 | class | 啟用 |
| `roster.read` | 經 API 取得班級在某日的有效名單（含 `displayName`）；讀取 `roster-display` View | class | 未啟用 |
| `leave.sensitive.read` | 讀取敏感備註；另需有效 grant（§7） | class | 未啟用（另受 D-06 阻擋） |
| `leave.sensitive.revise` | 經 API 修改敏感備註；另需有效 grant（§7） | class | 未啟用（另受 D-06 阻擋） |
| `stats.read` | 讀取該班統計快照 | class | 未啟用 |
| `projection.read` | 只讀取去識別的 `projection` View | class | 未啟用 |
| `export.basic` | 經 API 匯出白名單欄位 | class | 未啟用（另受 D-08 阻擋） |
| `archive.revise` | 修改已封存學期的正式資料（須同時具備對應的 `*.revise`） | class | 未啟用 |
| `membership.manage` | 經 API 管理**他人**的 membership（§6.3） | workspace | 未啟用 |
| `class.manage` | 經 API 管理班級與學期 | workspace | 未啟用 |
| `calendar.manage` | 經 API 管理日曆 | workspace | 未啟用 |
| `audit.read` | 只讀取同工作空間的**管理稽核摘要** `auditSummaries`（§6.6）；**不能**讀取完整安全稽核 `auditLog`，摘要中也沒有任何班級資料存取事件 | workspace | 未啟用 |
| `sensitive.grant.manage` | 經 API 建立與撤銷**他人**的 sensitive grant（§7） | workspace | 未啟用（另受 D-06 阻擋） |

## 5. Role Preset（預設範本，只在建立 membership 時使用）

| Preset | scopeType | 預設 capability | 明確不包含 |
|---|---|---|---|
| 導師 `homeroom_teacher` | class | `attendance.read`、`attendance.write`、`attendance.revise`、`leave.read`、`leave.revise`、`leave.applicability.read`、`issue.read`、`roster.read`、`stats.read` | `leave.sensitive.*`、`archive.revise`、`export.basic`（D-08） |
| 科任 `subject_teacher` | class | `attendance.read`、`leave.applicability.read`、`roster.read` | **`attendance.write`（D-05 預設拒絕）**、`leave.read`、`leave.sensitive.*` |
| 管理者 `workspace_admin` | workspace | `membership.manage`、`class.manage`、`calendar.manage`、`audit.read` | 任何班級資料存取；`sensitive.grant.manage` |
| 投影 `projection_display` | class | `projection.read` | 其他全部 |

- Preset 中標為「未啟用」的 capability，在 D-09 核准前不生效。
- 套用 preset 後，capability 會展開保存在 membership；之後修改 preset **不會**回溯改變既有 membership。
- **D-05（科任點名權限）預設拒絕，沒有例外**（REV-009）：在「節次層級的 scope」設計並經審查前，科任 preset 不含 `attendance.write`，而且**不能**以手動加入的方式取得（見下一點）。任何科任例外政策都標示為「待負責人核准」，核准前不得實作。
- **membership 的 capability 必須是其 preset 預設值的子集**（REV-009；直到 D-12 核准自訂 capability 政策為止）：
  - `membership.manage` 建立或修改 membership 時，`capabilities` 只能是該 `rolePreset` 預設 capability 的子集，不能額外加入。
  - `rolePreset` 建立後不可修改；要改變角色，必須撤銷舊 membership、建立新的。
  - 唯一例外是 `leave.sensitive.*`：只能經 §7 的 grant 流程，與 grant 在同一交易內加入，不能用 `membership.manage` 加入。
  - 殘餘風險：把某人指派為 `homeroom_teacher` 是管理決策，系統無法驗證此人實際上是不是導師。這類指派會記錄在 `auditLog` 與 `auditSummaries`（membership 建立事件），由負責人查核。

## 6. 授權流程

受控 API 以 Admin 權限存取 Firestore（會繞過 Security Rules），因此**API 必須自行完整執行下列步驟**，不得因為「呼叫來自伺服器」而跳過（POC-005、POC-035）。

### 6.1 共同前置

1. **驗證身分**：驗證 Firebase ID token，取得 `authUid`。失敗 → `FORBIDDEN`。
2. **解析 Auth Binding**（REV-007）：`authBindings/{authUid}` 必須存在，且
   - `status = active`；
   - token 的簽發時間（`iat`）**不早於** binding 的 `activatedAt`（避免重新綁定前發出的舊 token 沿用新的綁定）。
   任一不成立 → `FORBIDDEN`。**token 本身仍有效也一樣拒絕**：binding 狀態在每一次請求重新讀取，不依賴 token 的到期時間。
2a. **解析 Principal**：binding 的 `principalId` 對應的 principal `status = active`。否則 → `FORBIDDEN`。
   - Binding 有效不代表 principal 有效，principal 有效也不代表 binding 有效；兩者分別檢查，之後的 membership 也分別檢查（§6.2／§6.3 步驟 5）。
3. **解析目標與 Scope**：由請求的目標 ID，伺服器讀取目標文件（或寫入目標的上層文件），**依資料模型 §4 由路徑與權威欄位決定 `workspaceId`／`classId`**。請求中宣稱的 scope 與此不符 → `FORBIDDEN`（防止偽造 scope）；文件欄位與路徑不符 → `FORBIDDEN`，稽核 `SCOPE_INTEGRITY_ERROR`。
4. **選擇授權分支**：依操作類型（§6.4 表格）決定走 §6.2（班級資料）或 §6.3（工作空間管理）。**兩個分支互不替代**：班級資料操作不能用 workspace membership 通過，管理操作也不能用 class membership 通過。

### 6.2 分支 C｜班級資料操作

5. **有效 membership**：`workspaceId` 相同、`principalId` 相同、`scopeType = class`、`classId` 等於步驟 3 的 classId、`status = active`、`validFrom ≤ 現在 < validToExclusive`。可以有多筆，有效 capability 為多筆的聯集，只計：class 型、已啟用、而且屬於該 membership `rolePreset` 預設值的 capability（`leave.sensitive.*` 另依 §7）。超出 preset 的 capability 即使已存在於文件中（例如資料匯入或舊紀錄），**評估時一律忽略**（I-21）。沒有 → `FORBIDDEN`。
6. **Capability**：操作所需的 capability 在有效集合中。敏感資料另外檢查 §7；已封存學期的寫入另外需要 `archive.revise`。

### 6.3 分支 W｜工作空間管理操作（REV-001）

5. **有效 membership**：`workspaceId` 相同、`principalId` 相同、`scopeType = workspace`、`classId = null`、`status = active`、在有效期間內。沒有 → `FORBIDDEN`。
6. **Capability**：操作所需的 workspace capability 在有效集合中（只計 workspace 型、已啟用、屬於 `rolePreset` 預設值的 capability；`sensitive.grant.manage` 另依 §7 由 D-06 程序指派）。
7. **目標限制**：分支 W 只能作用於 `memberships`、`classes`、`terms`、`calendars`、`auditSummaries`（只讀）、`sensitiveGrants`（§7）。**不能讀取 `auditLog`**（完整安全稽核，§6.6）。**不能讀取任何班級資料集合**；需要讀取班級資料時，必須另有該班的 class membership，走分支 C。
8. **禁止自我授權**（I-18）：不得建立、修改、恢復**自己**的 membership；不得授予自己 sensitive grant。
9. **擴權限制**：`membership.manage` 建立或修改的 membership，`capabilities` 必須是其 `rolePreset` 預設值的子集（§5）；不能加入 `leave.sensitive.*`（只能經 §7）；也不能授予自己沒有的 workspace capability。

分支 W 讓管理者能管理成員、班級、學期、日曆與稽核，**但不會因此得到任何班級資料的閱讀權**。管理者可以替**他人**建立 class membership（這是管理職責），但不能替自己建立。

### 6.4 操作與分支對照

| 操作 | 分支 | 所需 capability |
|---|---|---|
| 讀點名、名單快照 | C | `attendance.read` |
| 建立點名／登記 | C | `attendance.write` |
| 更正點名 | C | `attendance.revise`（封存學期另需 `archive.revise`） |
| 讀請假適用提示 | C | `leave.applicability.read` |
| 讀／改請假摘要 | C | `leave.read`／`leave.revise` |
| 讀／改敏感備註 | C | `leave.sensitive.read`／`leave.sensitive.revise`＋有效 grant |
| 讀核對事項、統計、名單、投影 | C | `issue.read`、`stats.read`、`roster.read`、`projection.read` |
| 匯出 | C | `export.basic`（D-08 前停用） |
| 讀自己的 membership、grant | 只需 §6.1 步驟 1–2；只限 `principalId` 等於自己 | 無 |
| 讀自己的收據 | C | 無；但 `receipt.principalId` 必須等於自己，且對 `receipt.classId` 仍有有效 class membership（§8） |
| 管理他人 membership | W | `membership.manage` |
| 管理班級、學期 | W | `class.manage` |
| 管理日曆 | W | `calendar.manage` |
| 讀管理稽核摘要 `auditSummaries` | W | `audit.read` |
| 讀完整安全稽核 `auditLog` | 無（不開放任何 API 讀取；D-11） | — |
| 建立／撤銷他人 sensitive grant | W | `sensitive.grant.manage`（D-06 前停用） |

### 6.5 寫入檢查（兩個分支共用）

所有寫入（含 membership 與 grant 的變更）都是正式修改，必須帶 `operationId` 與 `expectedVersion`，並依 §8 處理。順序：**先完成 §6.1–6.3 的授權，再碰任何收據**，讓未授權的呼叫者無法得知任何 `operationId` 是否存在。

### 6.6 回應與稽核

- 拒絕時一律回 `FORBIDDEN`，**不回傳可識別欄位**，也**不區分「資料不存在」和「沒有權限」**（POC-002）。
- 允許與拒絕都寫入 `auditLog`（完整安全稽核；含 `policyVersion`、`traceId`、`reasonCode`；不含敏感文字）。每一次敏感備註讀取都要記錄。
- **稽核分兩層**（REV-008）：

  | 層級 | 集合 | 內容 | 誰可以讀 |
  |---|---|---|---|
  | 完整安全稽核 | `auditLog` | 所有允許與拒絕的決策，含班級資料存取的完整資源參照 | **沒有任何 API 可以讀**；具 `audit.read` 的管理者也不行。存取程序待定（D-11），決定前一律拒絕 |
  | 管理稽核摘要 | `auditSummaries` | 只有白名單動作與白名單欄位（見下） | 同工作空間、具 `audit.read`（D-09 核准後）的 workspace membership |

- **`auditSummaries` 的動作白名單**：只記錄工作空間管理動作：
  - `membership.create`、`membership.update`、`membership.revoke`
  - `class.create`、`class.update`、`term.update`
  - `calendar.update`

  以及上述動作的拒絕（`decision = deny`）。**不記錄**任何班級資料的讀取或寫入（點名、請假、敏感備註、核對事項、名單、統計、匯出），**也不記錄** sensitive grant 的建立或撤銷、Auth Binding 的變更：這些只存在 `auditLog`。
- **`auditSummaries` 的欄位白名單**：`summaryId`、`at`、`actorPrincipalId`、`action`（白名單之一）、`targetType`（`membership`／`class`／`term`／`calendar`）、`targetId`（`membershipId`、`classId`、`termId`、`calendarId`）、`targetPrincipalId`（只在 `membership.*` 出現）、`decision`、`reasonCode`。不含 `studentId`、班級資料文件 ID 或其雜湊、`traceId`、計數。
- **為什麼不用雜湊**：學生與文件 ID 數量少、可列舉，一般 SHA-256 雜湊可以被逐一試算還原，**不算去識別化**。因此 v0.2 的「班級資料只記文件 ID 雜湊」作法已移除；班級資料事件直接不進入管理者可讀的摘要。
- **推知限制**：因為班級資料事件完全不出現在 `auditSummaries`，只有 `audit.read` 的管理者無法從摘要得知「某班或某學生的敏感備註是否存在、是否被讀取」，也無法從事件數量或時間推知。
- 錯誤代碼沿用 `poc/stage1/docs/證據格式與安全記錄契約.md`：`FORBIDDEN`、`VERSION_CONFLICT`、`OPERATION_REUSE_MISMATCH`、`LOCAL_SAVE_FAILED`、`DERIVED_PENDING`、`UNAVAILABLE`。

### 6.7 Auth Binding 生命週期（REV-007）

| 事件 | 處理 | 生效時機 |
|---|---|---|
| 建立 | 建立 `authBindings/{authUid}`：`status = active`、`activatedAt = 建立時間`、`bindingVersion = 1` | 建立後簽發的 token 才可使用（§6.1 步驟 2） |
| 停用（disable） | `status = disabled`，寫入 `disabledAt`、`disabledBy`、`reasonCode` | **下一次請求立即拒絕**，即使持有的 ID token 尚未到期 |
| 撤銷（revoke） | `status = revoked`，寫入 `revokedAt`、`revokedBy`、`reasonCode`；同時要求 Firebase Authentication 撤銷該 UID 的 refresh token | 下一次請求立即拒絕；refresh token 撤銷只是額外防線，**授權判斷不依賴它** |
| 重新綁定（rebind） | 只允許對 `disabled` 或 `revoked` 的 binding 執行：設定新的 `principalId`（可以是同一人）、`status = active`、`activatedAt = 重新綁定時間`、`bindingVersion + 1` | **重新綁定之前簽發的 token 一律拒絕**（`iat < activatedAt`），使用者必須重新登入 |
| 失效（principal 停用） | binding 不變，但 §6.1 步驟 2a 拒絕 | 下一次請求立即拒絕 |

- 每次狀態變更都寫入 `auditLog`；不寫入 `auditSummaries`。
- 誰可以建立、停用、撤銷、重新綁定 binding：**待決（D-13）**。決定前不提供任何 API；binding 只能由隔離測試環境的載入程序建立。
- 被授權者本人不能變更自己的 binding（I-18）。

## 7. 敏感資料 grant（REV-006）

**存取條件**：讀取（或修改）一筆敏感備註時，以下**全部**成立才允許：

1. 分支 C 的有效 class membership（同 `classId`），且 capabilities 含 `leave.sensitive.read`（或 `leave.sensitive.revise`）。
2. 存在 `sensitiveGrants`：`principalId` 相同、`classId` 相同、`capability` 完全相同、`status = active`、`現在 < expiresAt`。
3. 該 capability 已啟用（D-09），且 grant 機制已開放（D-06）。

讀取權與修改權**分開授予**：有 `leave.sensitive.read` 的 grant 不代表可以修改。

**`sensitive.grant.manage` 的指派**：不在任何 preset 中，也**不能**用 `membership.manage` 加入；由誰、以什麼程序指派，屬於 D-06 的決定範圍。D-06 核准前沒有任何人持有它。

**建立 grant**：只能經分支 W，需要 `sensitive.grant.manage`；`grantedBy` 不可等於被授權者；必須填 `reasonCode` 與 `expiresAt`（不得無期限）。**在 D-06 決定前，建立 grant 的 API 停用**：系統中不會有任何有效 grant，所以所有敏感備註讀取都會被拒絕。

**撤銷與失效**：

- 撤銷：經分支 W，把 `status` 從 `active` 改為 `revoked`，寫入 `revokedBy`、`revokedAt`、`revokeReasonCode`。單向，不能恢復；需要時建立新 grant。
- 過期：`現在 ≥ expiresAt` 時自動失效，每次請求都重新判斷。
- 連帶失效：對應的 class membership 被撤銷、暫停、過期，或移除了 `leave.sensitive.*`，grant 即使仍為 `active` 也不再生效。
- 生效時機：撤銷或失效後的下一次請求立即拒絕；如果建立了 `accessIndex`，必須在同一個 API 交易內更新。

## 8. operationId、requestHash 與收據（REV-002）

**收據範圍**：`operationReceipts/{operationId}` 位於工作空間之下，`operationId` 在**同一工作空間內**唯一。不同工作空間各自獨立。`operationId` 應由 client 以 UUID v4 產生，不可使用可預測的序號。

**Canonical requestHash（`sha256-stablejson-v1`）**

1. 由伺服器組出下列物件，欄位缺一不可：

   | 欄位 | 來源 |
   |---|---|
   | `v` | 固定字串 `sha256-stablejson-v1` |
   | `workspaceId`、`classId` | §6.1 步驟 3 由伺服器解析（工作空間管理操作的 `classId` 為 `null`） |
   | `principalId` | §6.1 步驟 2 由伺服器解析，**不接受 client 提供** |
   | `commandType`、`targetType`、`targetId`、`expectedVersion`、`intent` | client 命令（格式同 fixtures `canonicalCommand`） |

2. **不包含**：`operationId`（它是鍵）、`clientCreatedAt`（重送時可能不同）、token、`authUid`、`traceId`。
3. 序列化：使用 Stage 1 `poc/stage1/src/common.mjs` 的 `stableJson`。物件鍵依字串排序、陣列保持順序、純值用 `JSON.stringify`、沒有空白；以 UTF-8 編碼。伺服器**不做**任何字串正規化。
4. 雜湊：對上述 UTF-8 位元組取 SHA-256，輸出小寫十六進位。

**測試向量**（以 fixtures `canonicalCommand`、`classId = CLASS-606-SC01`、`principalId = ACTOR-SC01-TEACHER` 計算）：

```text
{"classId":"CLASS-606-SC01","commandType":"LeaveRecord.Revise","expectedVersion":5,"intent":{"coverageChange":"AM_TO_FULL_DAY","reasonCode":"SOURCE_CORRECTION"},"principalId":"ACTOR-SC01-TEACHER","targetId":"LV-007","targetType":"LeaveRecord","v":"sha256-stablejson-v1","workspaceId":"WS-SC01"}
requestHash = ff212f322297ac317fd3869dceffb81c094b1457de01c111762c6335b177c8cf
```

只要 principal、payload（`intent`）或 target 任一不同，雜湊就不同，例如：principal 改為另一個 ID → `2e0195cf…`；`intent.coverageChange` 改為 `AM_TO_PM` → `9f0a1d08…`；`targetId` 改為 `LV-008` → `37793557…`。

**提交命令的處理順序**

1. §6.1–6.3 授權。失敗 → `FORBIDDEN`，**不讀取收據**。
2. 計算 `requestHash`。
3. 同一交易內讀 `operationReceipts/{operationId}`：
   - 不存在 → 繼續第 4 步。
   - 存在且 `requestHash` 相同 → 回傳原收據（因為雜湊包含 `principalId`，所以必定是同一 principal），不再寫入。
   - 存在且 `requestHash` 不同 → `OPERATION_REUSE_MISMATCH`。回應只含 `{code, operationId}`，**不含原收據的任何欄位**（版本、principal、時間、目標都不回），不寫入（POC-019：`revisionDelta = 0`、`receiptLeaked = false`）。
4. 讀 current：`version ≠ expectedVersion` → `VERSION_CONFLICT`，不寫入。
5. 同一交易寫入：current（version +1）、1 筆 Revision、1 筆 Receipt、1 筆 Event、`derivedProgress`（`pending`）。任一失敗則整筆回滾。

**跨 principal 重用 `operationId`**

| 情況 | 結果 |
|---|---|
| principal B **沒有**目標的授權，重用 A 的 `operationId` | `FORBIDDEN`（第 1 步就拒絕；B 無法得知該 `operationId` 是否存在） |
| principal B **有**目標的授權，重用 A 的 `operationId` | `OPERATION_REUSE_MISMATCH`，只回 `{code, operationId}`；不寫入，不洩漏 A 的收據 |

後者會讓 B 得知「這個 `operationId` 已被使用」，這是 POC-019 契約要求的回應；由於 `operationId` 是 UUID v4，無法猜測他人的 ID，風險可接受。

**查詢收據（POC-021 恢復）**：只有 `receipt.principalId` 等於呼叫者，且呼叫者對 `receipt.classId` 仍有有效 class membership，才回傳收據；否則一律 `FORBIDDEN`，與「收據不存在」相同。回傳的 `derivedStatus` 讀自 `derivedProgress`，收據本身不變（資料模型 §3.7）。

## 9. 讀取路徑（D-01）

**預設：全部經受控 API 讀取**，client 不直接讀 Firestore。

在 D-01、D-02 決定，且 Security Rules 完成並通過審查與測試之前，**不得開放任何 client 直接讀取**。即使日後開放，`students`、`enrollments`、`authBindings`、`memberships`、`sensitiveGrants`、`operationReceipts`、`derivedProgress`、`events`、`auditLog`、`leaveSensitiveNotes` 仍不開放 client 直接讀取。

## 10. 其他規則

- **撤銷 membership**：撤銷或過期後的下一次請求即失效；如果有 `accessIndex`，必須在同一交易內更新或刪除。
- **共用裝置切換帳號**：登出或切換 principal 時，裝置必須清除上一位 principal 的本機快取與 outbox，或明確提示有未同步資料（POC-027；裝置端規格屬於 Stage 4）。
- **高權限憑證**：Admin／service account 憑證只存在伺服器端，不放進 client、Git 或證據檔案。

## 11. 負向案例（文件層級，供 Stage 2 轉成測試）

這些案例描述**預期**結果，尚未在任何後端執行。

**前置條件規則**：「前置條件」欄列出案例假設已核准的待決事項。

- 前置條件**未成立**時，案例的預期結果一律是 §12 的預設值（拒絕或停用），不是表中「預期」欄的結果。
- 文件測試與日後的 Stage 2 測試都**不得**在待決事項核准前，把它當成已啟用。
- 「無」表示在目前預設狀態下就成立。

| ID | 前置條件 | 情境 | 預期 |
|---|---|---|---|
| N-01 | 無 | 只有 workspace membership（含 `membership.manage`）的管理者讀取某班點名 | `FORBIDDEN`（分支 C 找不到 class membership） |
| N-02a | 無（D-09 **未**核准） | 管理者替他人建立 class membership | `FORBIDDEN`：`membership.manage` 未啟用 |
| N-02b | D-09 已核准 | 管理者替他人建立 class membership，capability 為 preset 預設值的子集 | 允許（分支 W），寫入收據、`auditLog`、`auditSummaries` |
| N-03 | D-09 已核准 | 管理者替**自己**建立 class membership | `FORBIDDEN`（I-18） |
| N-04 | D-09 已核准 | class membership 上被加入 `membership.manage` | 無效，不能做任何管理操作（I-17） |
| N-05 | 無 | 導師（有 `leave.read`，無 grant）讀取敏感備註 | `FORBIDDEN`，回應與「沒有備註」相同 |
| N-06 | D-06＋D-09 已核准 | 有 `leave.sensitive.read`＋有效 read grant，嘗試修改敏感備註 | `FORBIDDEN`（修改需 `leave.sensitive.revise` 與另一筆 grant） |
| N-07 | D-06＋D-09 已核准 | grant 已撤銷 | `FORBIDDEN` |
| N-07b | D-06＋D-09 已核准 | grant 狀態仍是 `active`，但已超過 `expiresAt` | `FORBIDDEN`（每次請求重新判斷到期） |
| N-08 | D-06＋D-09 已核准 | grant 仍有效，但 class membership 已撤銷 | `FORBIDDEN`（連帶失效） |
| N-09 | D-06＋D-09 已核准 | 以 `sensitive.grant.manage` 授予自己 grant | `FORBIDDEN`（I-18） |
| N-09b | D-06＋D-09 已核准 | 經 D-06 程序取得 `sensitive.grant.manage` 的管理者，替**他人**建立 grant | 允許（N-09 的對照組，確認 N-09 是因為「授予自己」而被拒） |
| N-10 | 無（D-06 **未**核准） | 呼叫建立 grant 的 API | 停用，拒絕 |
| N-11 | 無 | 相同 principal、相同 `operationId`、相同命令重送 100 次 | 回傳同一收據；只有 1 次 version 變更（POC-018） |
| N-12 | 無 | 相同 `operationId`、改 `intent` | `OPERATION_REUSE_MISMATCH`，只回 `{code, operationId}`（POC-019） |
| N-13 | D-10 | 有授權的 principal B 重用 A 的 `operationId` | `OPERATION_REUSE_MISMATCH`，不回 A 的收據欄位（POC-019） |
| N-14 | 無 | 沒有授權的 principal 重用 A 的 `operationId` | `FORBIDDEN`，不讀收據 |
| N-15 | 無 | principal B 以 A 的 `operationId` 查詢收據 | `FORBIDDEN`，與不存在相同 |
| N-16 | 無 | 衍生工作把 `derivedStatus` 改成 `done` | 只更新 `derivedProgress`；收據不變（I-10） |
| N-17 | 無 | 一次正式提交 | 恰好 1 筆 Revision、1 筆 Receipt、1 筆 Event（I-07，POC-016） |
| N-18 | 無 | 請求宣稱 `classId = A`，目標文件實際在班級 B | `FORBIDDEN`（§6.1 步驟 3） |
| N-19 | 無 | 文件 `classId` 欄位與路徑不一致 | `FORBIDDEN`，稽核 `SCOPE_INTEGRITY_ERROR`（I-02） |
| N-20 | 無（D-05 **未**核准） | 科任 preset 的 membership 嘗試登記點名 | `FORBIDDEN` |
| N-21 | 無（D-09 **未**核准） | 任何 membership 使用「未啟用」的 capability | 視為未授予，`FORBIDDEN` |
| N-22 | 無 | 只有 `leave.read` 的 principal 讀請假摘要 | 回傳摘要；回應中沒有任何欄位能推知是否有敏感備註 |
| N-23 | 無 | binding 已停用，但使用者仍持有**尚未到期**的有效 ID token | `FORBIDDEN`（§6.1 步驟 2） |
| N-24 | 無 | binding 已撤銷，token 仍有效 | `FORBIDDEN` |
| N-25 | 無 | binding 重新綁定後，使用重新綁定**之前**簽發的 token | `FORBIDDEN`（`iat < activatedAt`） |
| N-26 | 無 | binding 重新綁定後，重新登入取得的新 token，且有有效 membership | 依 membership 正常授權 |
| N-27 | 無 | binding 有效，但 principal 已停用 | `FORBIDDEN`（§6.1 步驟 2a） |
| N-28 | 無 | binding 與 principal 都有效，但 membership 已撤銷或已過期 | `FORBIDDEN`（§6.2 步驟 5） |
| N-29 | D-06＋D-09 已核准 | 導師以有效 grant **成功**讀取敏感備註後，只有 `audit.read` 的管理者讀取 `auditSummaries` | 摘要中沒有任何與該次讀取有關的紀錄（班級、學生、時間、次數都看不到） |
| N-30 | D-09 已核准 | 同上管理者嘗試讀取完整安全稽核 `auditLog` | `FORBIDDEN`（D-11 前不開放） |
| N-31 | D-09 已核准 | 導師讀取敏感備註**被拒**後，管理者讀取 `auditSummaries` | 摘要中沒有該次拒絕 |
| N-32 | D-09 已核准 | 工作空間 A 的管理者讀取工作空間 B 的 `auditSummaries` | `FORBIDDEN` |
| N-33 | D-09 已核准 | 管理者替科任的 membership 手動加入 `attendance.write` | `FORBIDDEN`（capability 必須是 preset 預設值的子集；D-05 無例外） |
| N-34 | D-09 已核准 | 管理者建立 `subject_teacher` membership 時，初始 capability 就含 `attendance.write` | `FORBIDDEN` |
| N-35 | D-09 已核准 | 管理者把既有 membership 的 `rolePreset` 從 `subject_teacher` 改為 `homeroom_teacher` | `FORBIDDEN`（`rolePreset` 不可修改，必須撤銷後重建） |
| N-36 | D-09 已核准 | 管理者以 `membership.manage` 直接加入 `leave.sensitive.read` | `FORBIDDEN`（只能經 §7 grant 流程） |
| N-37 | 無 | 某筆 `subject_teacher` membership 的文件**已經**含有 `attendance.write`（例如資料匯入），科任嘗試登記點名 | `FORBIDDEN`：評估時忽略超出 preset 的 capability（§6.2 步驟 5、I-21） |

## 12. 待決事項：預設值與實作阻擋條件

**原則：在決定之前，一律採用下表的預設值（全部是拒絕或停用）；實作不得自行選擇較寬鬆的值。**

| ID | 問題 | 決定前的預設（拒絕） | 解除阻擋的條件 |
|---|---|---|---|
| D-01 | 讀取路徑：全部經 API，或部分由 Security Rules 直接讀 | 全部經 API；client 直接讀取一律拒絕 | 負責人決定＋Rules 設計與 Rules 測試經審查 |
| D-02 | Rules 的授權來源：`accessIndex` 或 custom claims | 不建立 `accessIndex`、不發 custom claims | D-01 決定開放直接讀取之後 |
| D-03 | 是否需要伺服器端草稿集合 | 不建立；草稿只在裝置本機 | 負責人決定＋資料模型修訂審查 |
| D-04 | 管理者是否需要不經 class membership 的唯讀總覽 | 不允許 | 負責人決定＋存取矩陣修訂審查 |
| D-05 | 科任的點名權限：是否限制到節次；是否需要例外政策 | 科任 preset 不含 `attendance.write`，且**不能**手動加入（N-33、N-34）；任何科任例外政策都是「待負責人核准」 | 節次層級 scope 的設計（資料模型＋授權）經審查，或負責人核准具體的例外政策並經審查 |
| D-06 | 誰可以授予 `leave.sensitive.*`、是否需要兩人核准、最長期限 | 建立 grant 的 API 停用；系統中沒有有效 grant | 負責人決定核准流程與期限上限＋審查 |
| D-07 | 收據、稽核、衍生進度的保存期限 | 不提供刪除 API；全部保留 | 負責人決定保存政策＋審查 |
| D-08 | `export.basic` 的欄位白名單 | 匯出 API 停用 | 白名單經審查；白名單一定不含敏感文字或任何推知敏感備註存在的欄位 |
| D-09 | 新增 capability 名稱（§4 標「未啟用」者）是否採用 | 視為未授予 | 負責人核准名稱與定義 |
| D-10 | POC-019 的「改 actor」變體：fixtures 沒有第二個對 SC01 有授權的 principal | 使用 `ACTOR-OTHER` 時預期為 `FORBIDDEN`（N-14），不是 `OPERATION_REUSE_MISMATCH` | 決定是否以審查過的方式新增第二個測試 principal（**不修改** Stage 1 鎖定的 fixtures） |
| D-11 | 完整安全稽核 `auditLog` 的存取程序（誰、在什麼情況、如何核准與留痕） | 沒有任何 API 可以讀取；具 `audit.read` 也不行 | 負責人決定存取程序（例如雙人核准的調閱流程）＋審查 |
| D-12 | 是否允許 membership 有超出 preset 預設值的自訂 capability | 不允許：capability 必須是 preset 預設值的子集；`rolePreset` 不可修改 | 負責人決定自訂政策與核准方式＋審查 |
| D-13 | 誰可以建立、停用、撤銷、重新綁定 Auth Binding | 不提供任何 API；只能由隔離測試環境的載入程序建立 | 負責人決定身分管理流程＋審查 |

## 13. 機器可讀的授權案例

下列 JSON 把 §11 中與授權判斷有關的案例寫成資料，方便審查時用獨立的評估程式驗證。

- 只描述輸入與預期結果；它是**資料，不是程式**，本 PR 沒有任何對應的實作。
- 交易類案例（N-11～N-19）需要真實的交易與收據狀態，不在此列，留待 Stage 2。
- `N-29s` 是 N-29 的前置步驟（導師成功讀取敏感備註），只在 D-06、D-09 都核准時才是 `ALLOW`。

評估規則與 §6、§7、§12 相同，並另有一條：每個 `approvals` 非空的案例，在 `approvals = []`（目前狀態）下重新評估時，結果都必須是 `FORBIDDEN` 或 `DISABLED`。這就是 §11 的前置條件規則：待決事項核准前，不得視為已啟用。

```json
{
 "schemaVersion": "s2b1-authz-cases-v1",
 "now": "2026-11-20T12:00:00Z",
 "principalWorkspace": "WS-SC01",
 "cases": [
  {
   "id": "N-01",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-02a",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "membershipWrite",
    "target": "other",
    "rolePreset": "homeroom_teacher",
    "capabilities": [
     "attendance.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-02b",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "membershipWrite",
    "target": "other",
    "rolePreset": "homeroom_teacher",
    "capabilities": [
     "attendance.read"
    ]
   },
   "expect": {
    "result": "ALLOW"
   }
  },
  {
   "id": "N-03",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "membershipWrite",
    "target": "self",
    "rolePreset": "homeroom_teacher",
    "capabilities": [
     "attendance.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-04",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read",
       "membership.manage"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "membershipWrite",
    "target": "other",
    "rolePreset": "homeroom_teacher",
    "capabilities": [
     "attendance.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-05",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "sensitive",
    "mode": "read",
    "classId": "CLASS-606-SC01"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-06",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read",
       "leave.sensitive.read"
      ],
      "status": "active"
     }
    ],
    "grants": [
     {
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-12-31T00:00:00Z"
     }
    ]
   },
   "op": {
    "type": "sensitive",
    "mode": "revise",
    "classId": "CLASS-606-SC01"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-07",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read",
       "leave.sensitive.read"
      ],
      "status": "active"
     }
    ],
    "grants": [
     {
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "revoked",
      "expiresAt": "2026-12-31T00:00:00Z"
     }
    ]
   },
   "op": {
    "type": "sensitive",
    "mode": "read",
    "classId": "CLASS-606-SC01"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-07b",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read",
       "leave.sensitive.read"
      ],
      "status": "active"
     }
    ],
    "grants": [
     {
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-11-19T00:00:00Z"
     }
    ]
   },
   "op": {
    "type": "sensitive",
    "mode": "read",
    "classId": "CLASS-606-SC01"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-08",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read",
       "leave.sensitive.read"
      ],
      "status": "revoked"
     }
    ],
    "grants": [
     {
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-12-31T00:00:00Z"
     }
    ]
   },
   "op": {
    "type": "sensitive",
    "mode": "read",
    "classId": "CLASS-606-SC01"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-09",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read",
       "sensitive.grant.manage"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "grantCreate",
    "target": "self"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-09b",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read",
       "sensitive.grant.manage"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "grantCreate",
    "target": "other"
   },
   "expect": {
    "result": "ALLOW"
   }
  },
  {
   "id": "N-10",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read",
       "sensitive.grant.manage"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "grantCreate",
    "target": "other"
   },
   "expect": {
    "result": "DISABLED"
   }
  },
  {
   "id": "N-20",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "subject_teacher",
      "capabilities": [
       "attendance.read",
       "leave.applicability.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.write"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-21",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read",
       "stats.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "stats.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-23",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "disabled",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-24",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "revoked",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-25",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-20T09:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-26",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-20T09:00:00Z"
    },
    "tokenIat": "2026-11-20T09:30:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "ALLOW"
   }
  },
  {
   "id": "N-27",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "disabled",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-28",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": "2026-11-01"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-29s",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read",
       "leave.sensitive.read"
      ],
      "status": "active"
     }
    ],
    "grants": [
     {
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-12-31T00:00:00Z"
     }
    ]
   },
   "op": {
    "type": "sensitive",
    "mode": "read",
    "classId": "CLASS-606-SC01"
   },
   "expect": {
    "result": "ALLOW"
   }
  },
  {
   "id": "N-29",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-SC01",
    "priorEvents": [
     {
      "workspaceId": "WS-SC01",
      "action": "leave.sensitive.read",
      "decision": "allow"
     },
     {
      "workspaceId": "WS-SC01",
      "action": "membership.create",
      "decision": "allow"
     }
    ]
   },
   "expect": {
    "result": "ALLOW",
    "visibleActions": [
     "membership.create"
    ]
   }
  },
  {
   "id": "N-30",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "auditLogRead"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-31",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-SC01",
    "priorEvents": [
     {
      "workspaceId": "WS-SC01",
      "action": "leave.sensitive.read",
      "decision": "deny"
     },
     {
      "workspaceId": "WS-SC01",
      "action": "attendance.read",
      "decision": "allow"
     },
     {
      "workspaceId": "WS-SC01",
      "action": "sensitiveGrant.create",
      "decision": "allow"
     },
     {
      "workspaceId": "WS-SC01",
      "action": "authBinding.disable",
      "decision": "allow"
     }
    ]
   },
   "expect": {
    "result": "ALLOW",
    "visibleActions": []
   }
  },
  {
   "id": "N-32",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-A17",
    "priorEvents": [
     {
      "workspaceId": "WS-A17",
      "action": "membership.create",
      "decision": "allow"
     }
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-33",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "membershipWrite",
    "target": "other",
    "rolePreset": "subject_teacher",
    "capabilities": [
     "attendance.read",
     "attendance.write"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-34",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "membershipWrite",
    "target": "other",
    "rolePreset": "subject_teacher",
    "capabilities": [
     "attendance.write"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-35",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "membershipWrite",
    "target": "other",
    "rolePreset": "subject_teacher",
    "capabilities": [
     "attendance.read"
    ],
    "changeRolePresetTo": "homeroom_teacher"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-36",
   "approvals": [
    "D-09"
   ],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "membershipWrite",
    "target": "other",
    "rolePreset": "homeroom_teacher",
    "capabilities": [
     "attendance.read",
     "leave.sensitive.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  },
  {
   "id": "N-37",
   "approvals": [],
   "actor": {
    "binding": {
     "status": "active",
     "activatedAt": "2026-11-01T00:00:00Z"
    },
    "tokenIat": "2026-11-20T08:00:00Z",
    "principalStatus": "active",
    "memberships": [
     {
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "subject_teacher",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "leave.applicability.read"
      ],
      "status": "active"
     }
    ],
    "grants": []
   },
   "op": {
    "type": "classData",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.write"
   },
   "expect": {
    "result": "FORBIDDEN"
   }
  }
 ]
}
```
