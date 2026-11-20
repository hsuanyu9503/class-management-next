# S2-B1｜授權規格 v0.4（草案）

> **狀態：設計文件，未實作。** 本文件不含 Security Rules 或程式；授權行為尚未在任何後端驗證，相關案例維持 `NOT_RUN`。
> v0.2：回應 PR #3 審查 R1（REV-001 授權分支、REV-002 收據與 requestHash、REV-003 fixture 能力清單、REV-006 敏感 grant；D-05 與所有待決事項的預設拒絕）。
> v0.3：回應 PR #3 審查 R2（REV-007 Auth Binding 狀態、REV-008 稽核分層、REV-009 科任點名例外；案例前置條件與 §13 機器可讀案例）。
> v0.4：回應 PR #3 審查 R3（REV-010 自我讀取前置、REV-011 preset 語意與 fixture 對應、REV-012 評估範圍與輸入假設、REV-008 摘要證據）。敏感資料存取改為**只依 grant**，membership 不再含 `leave.sensitive.*`（§3、§7）。
> 相關文件：[資料模型](S2B1-DATA-MODEL.md)｜[存取矩陣](S2B1-ACCESS-MATRIX.md)｜[契約對照](S2B1-CONTRACT-TRACEABILITY.md)

## 1. 名詞

| 名詞 | 定義 |
|---|---|
| **Authentication UID**（`authUid`） | Firebase Authentication 驗證後的使用者 ID。只證明「是誰登入」，**本身不帶任何資料權限**。 |
| **Auth Binding** | `authBindings/{authUid}`：把一個 `authUid` 綁定到一個 principal 的紀錄，有自己的狀態與生效時間（§6.7）。 |
| **Principal**（`principalId`） | 系統內的人員主體。`authUid` 必須經 `status = active` 的 Auth Binding 綁定到一個 `status = active` 的 principal。Binding、Principal、Membership 三者**各自**都必須有效。 |
| **Membership** | Principal 在某工作空間的授權紀錄。`scopeType = class` 對應一個班級；`scopeType = workspace` 只用於工作空間管理。 |
| **Capability** | 最小授權單位。每個 capability 固定屬於一種 scopeType（§4）。**所有授權判斷只看 capability。** |
| **Role Preset** | 版本化的 capability **上限**（§5）。membership 記錄 `rolePreset` 與 `rolePresetVersion`；有效 capability 只能是「membership 上的 capability」與「該版本 preset 預設值」的交集。**preset 只限制、不授予**：沒有寫在 membership 上的 capability，不會因為 preset 包含它就生效；角色名稱本身也不授予任何權限。 |
| **Scope** | 授權的作用範圍：`workspaceId`（＋`classId`）＋有效期間＋學期狀態。 |

## 2. 決策 A｜班級精確授權

1. 一個工作空間可以管理多個班級。
2. 班級資料只能經 `scopeType = class` 的 membership 授權，且**一筆只對應一個 `classId`**；要存取兩個班級就需要兩筆。
3. 同一工作空間的身分不代表可以讀取全部班級。`scopeType = workspace` 的 membership 只授予工作空間管理能力，**不授予任何學生、在籍、點名、請假、核對事項、View、統計或匯出的讀取權**（I-17）。
4. 沒有萬用字元班級（例如 `classId = "*"`）。

## 3. 決策 B｜敏感請假資訊

1. 請假摘要與敏感備註分開保存；摘要不含「是否有敏感備註」的旗標（資料模型 §3.6）。
2. 讀取與修改敏感備註分別需要 `leave.sensitive.read`、`leave.sensitive.revise`。這兩個 capability **只能由有效的 `sensitiveGrants` 授予**，不寫在 membership 上，也不在任何 preset 中（§7）。
3. 導師、科任、管理者都不能只憑角色或 membership 取得；`membership.manage` 讀取他人 membership 時，也看不到誰有敏感資料存取權。
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
| `leave.sensitive.read` | 讀取敏感備註；**只能由 grant 授予**，不出現在 membership（§7） | class | 未啟用（另受 D-06 阻擋） |
| `leave.sensitive.revise` | 經 API 修改敏感備註；**只能由 grant 授予**，不出現在 membership（§7） | class | 未啟用（另受 D-06 阻擋） |
| `stats.read` | 讀取該班統計快照 | class | 未啟用 |
| `projection.read` | 只讀取去識別的 `projection` View | class | 未啟用 |
| `export.basic` | 經 API 匯出白名單欄位 | class | 未啟用（另受 D-08 阻擋） |
| `archive.revise` | 修改已封存學期的正式資料（須同時具備對應的 `*.revise`） | class | 未啟用 |
| `membership.manage` | 經 API 管理**他人**的 membership（§6.3） | workspace | 未啟用 |
| `class.manage` | 經 API 管理班級與學期 | workspace | 未啟用 |
| `calendar.manage` | 經 API 管理日曆 | workspace | 未啟用 |
| `audit.read` | 只讀取同工作空間的**管理稽核摘要** `auditSummaries`（§6.6）；**不能**讀取完整安全稽核 `auditLog`，摘要中也沒有任何班級資料存取事件 | workspace | 未啟用 |
| `sensitive.grant.manage` | 經 API 建立與撤銷**他人**的 sensitive grant（§7） | workspace | 未啟用（另受 D-06 阻擋） |

## 5. Role Preset（版本 `s2b1-v1`）

| Preset | scopeType | 預設 capability | 明確不包含 |
|---|---|---|---|
| 導師 `homeroom_teacher` | class | `attendance.read`、`attendance.write`、`attendance.revise`、`leave.read`、`leave.revise`、`leave.applicability.read`、`issue.read`、`roster.read`、`stats.read` | `leave.sensitive.*`、`archive.revise`、`export.basic`（D-08） |
| 科任 `subject_teacher` | class | `attendance.read`、`leave.applicability.read`、`roster.read` | **`attendance.write`（D-05 預設拒絕）**、`leave.read`、`leave.sensitive.*` |
| 管理者 `workspace_admin` | workspace | `membership.manage`、`class.manage`、`calendar.manage`、`audit.read` | 任何班級資料存取；`sensitive.grant.manage` |
| 投影 `projection_display` | class | `projection.read` | 其他全部 |

- **preset 的作用**（REV-011）：capability 決定能做什麼操作；preset 決定這筆 membership **最多**能有效持有哪些 capability。有效集合是：
  - membership 上的 `capabilities`，
  - 與 `rolePreset@rolePresetVersion` 的預設值取交集，
  - 再排除 scopeType 不符或未啟用的 capability。
- **版本**：上表是 preset 版本 `s2b1-v1`。membership 建立時記錄 `rolePresetVersion`，授權一律使用**建立時記錄的版本**。
  - 日後修改 preset 定義必須建立新版本（例如 `s2b1-v2`），既有 membership 不受影響，這就是「不回溯」。
  - 要讓既有成員改用新版本，必須撤銷舊 membership、建立新的。
  - 記錄了不存在的版本時，該 membership 無效。
- Preset 中標為「未啟用」的 capability，在 D-09 核准前不生效。
- 建立 membership 時可以只保存 preset 預設值的一部分；**不必**展開成全部預設值。
- **D-05（科任點名權限）預設拒絕，沒有例外**（REV-009）：在「節次層級的 scope」設計並經審查前，科任 preset 不含 `attendance.write`，而且**不能**以手動加入的方式取得（見下一點）。任何科任例外政策都標示為「待負責人核准」，核准前不得實作。
- **membership 的 capability 必須是其 preset 預設值的子集**（REV-009；直到 D-12 核准自訂 capability 政策為止）：
  - `membership.manage` 建立或修改 membership 時，`capabilities` 只能是該 `rolePreset` 預設 capability 的子集，不能額外加入。
  - `rolePreset` 建立後不可修改；要改變角色，必須撤銷舊 membership、建立新的。
  - `leave.sensitive.*` 不會出現在任何 membership（只由 grant 授予，§7）；`sensitive.grant.manage` 的指派依 D-06（§7）。
  - 殘餘風險：把某人指派為 `homeroom_teacher` 是管理決策，系統無法驗證此人實際上是不是導師。這類指派會記錄在 `auditLog` 與 `auditSummaries`（membership 建立事件），由負責人查核。

## 6. 授權流程

受控 API 以 Admin 權限存取 Firestore（會繞過 Security Rules），因此**API 必須自行完整執行下列步驟**，不得因為「呼叫來自伺服器」而跳過（POC-005、POC-035）。

### 6.1 共同前置

1. **驗證身分**：驗證 Firebase ID token，取得 `authUid`。失敗 → `FORBIDDEN`。
2. **解析 Auth Binding**（REV-007）：`authBindings/{authUid}` 必須存在，且
   - `status = active`；
   - token 的簽發時間（`iat`）**不早於** binding 的 `activatedAt`（避免重新綁定前發出的舊 token 沿用新的綁定）。
   任一不成立 → `FORBIDDEN`。**token 本身仍有效也一樣拒絕**：binding 狀態在每一次請求重新讀取，不依賴 token 的到期時間。
2a. **解析 Principal**：binding 的 `principalId` 對應的 principal 存在且 `status = active`。否則 → `FORBIDDEN`。之後所有 membership 與 grant 都必須 `principalId` 等於這個 principal（REV-012）；屬於其他 principal 的紀錄一律不採用。
   - Binding 有效不代表 principal 有效，principal 有效也不代表 binding 有效；兩者分別檢查，之後的 membership 也分別檢查（§6.2／§6.3 步驟 5）。
3. **解析目標與 Scope**：由請求的目標 ID，伺服器讀取目標文件（或寫入目標的上層文件），**依資料模型 §4 由路徑與權威欄位決定 `workspaceId`／`classId`**。請求中宣稱的 scope 與此不符 → `FORBIDDEN`（防止偽造 scope）；文件欄位與路徑不符 → `FORBIDDEN`，稽核 `SCOPE_INTEGRITY_ERROR`。
4. **選擇授權分支**：依操作類型（§6.4 表格）決定走 §6.2（班級資料）或 §6.3（工作空間管理）。**兩個分支互不替代**：班級資料操作不能用 workspace membership 通過，管理操作也不能用 class membership 通過。

### 6.2 分支 C｜班級資料操作

5. **有效 membership**：同時符合下列條件的 membership 才採用；可以有多筆，有效 capability 為多筆的聯集。
   - `principalId` 等於步驟 2a 的 principal；`workspaceId` 等於步驟 3 的工作空間；
   - `scopeType = class`，且 `classId` 非 null、等於步驟 3 的 classId；
   - `status = active`；`validFrom ≤ 現在 < validToExclusive`（null 表示沒有終點）；
   - 必要欄位（`principalId`、`workspaceId`、`scopeType`、`classId`、`rolePreset`、`rolePresetVersion`、`capabilities`、`status`、`validFrom`）全部存在。缺任何一個 → 這筆 membership 無效。
   每筆的有效 capability：membership 上的 capability ∩ `rolePreset@rolePresetVersion` 預設值（§5），且為 class 型、已啟用。超出 preset 的 capability 即使已存在於文件中（例如資料匯入或舊紀錄），**評估時一律忽略**（I-21）。沒有任何有效 membership → `FORBIDDEN`。
6. **Capability**：操作所需的 capability 在有效集合中。敏感資料另外檢查 §7；已封存學期的寫入另外需要 `archive.revise`。

### 6.3 分支 W｜工作空間管理操作（REV-001）

5. **有效 membership**：條件與 §6.2 步驟 5 相同，但 `scopeType = workspace`，且 **`classId` 必須為 null**（非 null → 這筆 membership 無效）。沒有 → `FORBIDDEN`。
6. **Capability**：操作所需的 workspace capability 在有效集合中（membership 上的 capability ∩ preset 預設值，workspace 型、已啟用）。`sensitive.grant.manage` 不在任何 preset 中，只能依 D-06 定義的程序指派；D-06 核准前沒有人持有（§7）。
7. **目標限制**：分支 W 只能作用於 `memberships`、`classes`、`terms`、`calendars`、`auditSummaries`（只讀）、`sensitiveGrants`（§7）。**不能讀取 `auditLog`**（完整安全稽核，§6.6）。**不能讀取任何班級資料集合**；需要讀取班級資料時，必須另有該班的 class membership，走分支 C。
8. **禁止自我授權**（I-18）：不得建立、修改、恢復**自己**的 membership；不得授予自己 sensitive grant。
9. **擴權限制**：`membership.manage` 建立或修改的 membership：
   - `capabilities` 必須是其 `rolePreset@rolePresetVersion` 預設值的子集（§5）；
   - 不能含 `leave.sensitive.*`（只由 grant 授予，§7）或 `sensitive.grant.manage`（依 D-06）；
   - 建立 `scopeType = workspace` 的 membership 時，每一個 workspace capability 都必須是操作者自己目前有效持有的（不能授予自己沒有的 workspace capability）。

分支 W 讓管理者能管理成員、班級、學期、日曆與稽核，**但不會因此得到任何班級資料的閱讀權**。管理者可以替**他人**建立 class membership（這是管理職責），但不能替自己建立。

### 6.4 操作與分支對照

| 操作 | 分支 | 所需 capability |
|---|---|---|
| 讀點名、名單快照 | C | `attendance.read` |
| 建立點名／登記 | C | `attendance.write` |
| 更正點名 | C | `attendance.revise`（封存學期另需 `archive.revise`） |
| 讀請假適用提示 | C | `leave.applicability.read` |
| 讀／改請假摘要 | C | `leave.read`／`leave.revise` |
| 讀／改敏感備註 | C | 該班任一有效 class membership＋對應的有效 grant（`leave.sensitive.read`／`leave.sensitive.revise`，§7） |
| 讀核對事項、統計、名單、投影 | C | `issue.read`、`stats.read`、`roster.read`、`projection.read` |
| 匯出 | C | `export.basic`（D-08 前停用） |
| 讀自己的 membership、grant（REV-010） | §6.1 步驟 1–2a 全部通過（binding `active` 且 token 不早於 `activatedAt`、principal `active`），**並且**在該工作空間至少有一筆有效 membership（class 或 workspace）；只回傳 `principalId` 等於自己的紀錄 | 無（不需要額外 capability）。沒有任何有效 membership 時 → `FORBIDDEN`，即使只是要讀自己的歷史紀錄（較寬鬆的作法列為 D-14，決定前拒絕） |
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
- **`auditSummaries` 的欄位白名單**：每筆摘要**只有**下列欄位，其他欄位一律裁掉：`summaryId`、`at`、`actorPrincipalId`、`action`（白名單之一）、`targetType`（`membership`／`class`／`term`／`calendar`）、`targetId`（`membershipId`、`classId`、`termId`、`calendarId`）、`targetPrincipalId`（只在 `membership.*` 出現）、`decision`、`reasonCode`。不含 `studentId`、班級資料文件 ID 或其雜湊、`traceId`、`policyVersion`、`authUid`、計數。
  - `summaryId`：隨機 UUID v4。**不得**由 `auditId`、`auditLog` 的序號或時間推導，避免從編號間隔推知有多少未列入摘要的事件。
  - `at`：該管理動作本身的時間。
  - `reasonCode`：只能是 `OK`、`NOT_AUTHORIZED`、`SELF_GRANT_FORBIDDEN`、`CAPABILITY_NOT_IN_PRESET`、`PRESET_IMMUTABLE`、`VERSION_CONFLICT`、`INVALID_INPUT` 之一；其他任何原因碼在摘要中一律寫成 `OTHER`（完整原因只在 `auditLog`）。
- **為什麼不用雜湊**：學生與文件 ID 數量少、可列舉，一般 SHA-256 雜湊可以被逐一試算還原，**不算去識別化**。因此 v0.2 的「班級資料只記文件 ID 雜湊」作法已移除；班級資料事件直接不進入管理者可讀的摘要。
- **推知限制與殘餘風險**：
  - 班級資料事件、grant 事件、binding 事件**不會**出現在 `auditSummaries`；grant 的建立與撤銷也不修改 membership（§7），所以不會留下間接的 `membership.update` 摘要。
  - 評估程式有成對測試：兩組輸入只差在敏感事件，一般管理事件完全相同，產生的可讀摘要必須逐欄完全相同（§13）。
  - 但這只證明**摘要本身**不攜帶這些事件。管理者仍可能從系統以外的資訊推測，例如知道某位教師剛被指派為導師（`membership.create` 的 `targetPrincipalId`、時間）。本規格**不宣稱**完全無法推知，只保證系統產生的摘要不揭露敏感事件的存在、內容、時間與次數。
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

1. 分支 C 的有效 class membership（同 `classId`；任何 preset 皆可）。**不需要** membership 上有 `leave.sensitive.*`；membership 上也不得有。
2. 存在 `sensitiveGrants`：`principalId` 等於 §6.1 步驟 2a 的 principal、`workspaceId` 與 `classId` 相同、`capability` 完全相同、`status = active`、`現在 < expiresAt`，且必要欄位（`principalId`、`workspaceId`、`classId`、`capability`、`status`、`expiresAt`、`grantedBy`）全部存在。
3. 該 capability 已啟用（D-09），且 grant 機制已開放（D-06）。

讀取權與修改權**分開授予**：有 `leave.sensitive.read` 的 grant 不代表可以修改；修改需要另一筆 `capability = leave.sensitive.revise` 的有效 grant（N-06）。

**`sensitive.grant.manage` 的指派**：不在任何 preset 中，也**不能**用 `membership.manage` 加入；由誰、以什麼程序指派，屬於 D-06 的決定範圍。D-06 核准前沒有任何人持有它。

**建立 grant**：只能經分支 W，需要 `sensitive.grant.manage`；`grantedBy` 不可等於被授權者；必須填 `reasonCode` 與 `expiresAt`（不得無期限）。**在 D-06 決定前，建立 grant 的 API 停用**：系統中不會有任何有效 grant，所以所有敏感備註讀取都會被拒絕。

**撤銷與失效**：

- 撤銷：經分支 W，把 `status` 從 `active` 改為 `revoked`，寫入 `revokedBy`、`revokedAt`、`revokeReasonCode`。單向，不能恢復；需要時建立新 grant。
- 過期：`現在 ≥ expiresAt` 時自動失效，每次請求都重新判斷。
- 連帶失效：對應的 class membership 被撤銷、暫停、過期，grant 即使仍為 `active` 也不再生效。
- **建立或撤銷 grant 不修改任何 membership**：membership 文件、版本、capability 都不變，因此也不產生 `membership.update` 事件（REV-008）。
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
| N-06 | D-06＋D-09 已核准 | 有有效 class membership＋有效 read grant，嘗試修改敏感備註 | `FORBIDDEN`（修改需 `leave.sensitive.revise` 與另一筆 grant） |
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
| N-29 | D-09 已核准 | 導師以有效 grant **成功**讀取敏感備註（N-29s，該步驟需要 D-06＋D-09）後，只有 `audit.read` 的管理者讀取 `auditSummaries` | 摘要中沒有任何與該次讀取有關的紀錄（班級、學生、時間、次數都看不到） |
| N-30 | D-09 已核准 | 同上管理者嘗試讀取完整安全稽核 `auditLog` | `FORBIDDEN`（D-11 前不開放） |
| N-31 | D-09 已核准 | 導師讀取敏感備註**被拒**後，管理者讀取 `auditSummaries` | 摘要中沒有該次拒絕 |
| N-32 | D-09 已核准 | 工作空間 A 的管理者讀取工作空間 B 的 `auditSummaries` | `FORBIDDEN` |
| N-33 | D-09 已核准 | 管理者替科任的 membership 手動加入 `attendance.write` | `FORBIDDEN`（capability 必須是 preset 預設值的子集；D-05 無例外） |
| N-34 | D-09 已核准 | 管理者建立 `subject_teacher` membership 時，初始 capability 就含 `attendance.write` | `FORBIDDEN` |
| N-35 | D-09 已核准 | 管理者把既有 membership 的 `rolePreset` 從 `subject_teacher` 改為 `homeroom_teacher` | `FORBIDDEN`（`rolePreset` 不可修改，必須撤銷後重建） |
| N-36 | D-09 已核准 | 管理者以 `membership.manage` 在 membership 中加入 `leave.sensitive.read` | `FORBIDDEN`（敏感 capability 只由 grant 授予，§7） |
| N-37 | 無 | 某筆 `subject_teacher` membership 的文件**已經**含有 `attendance.write`（例如資料匯入），科任嘗試登記點名 | `FORBIDDEN`：評估時忽略超出 preset 的 capability（§6.2 步驟 5、I-21） |
| N-38 | 無 | principal 已停用，讀取自己的 membership | `FORBIDDEN`（§6.4 自我讀取也需要 §6.1 步驟 2a） |
| N-39 | 無（D-14 **未**核准） | 所有 membership 都已撤銷，讀取自己的歷史 membership | `FORBIDDEN` |
| N-40 | 無（D-14 **未**核准） | membership 已過期，讀取自己的 grant | `FORBIDDEN` |
| N-41 | 無 | binding、principal、membership 都有效，讀取自己的 membership（另有他人的 membership 存在） | 允許；只回傳自己的紀錄（正向對照） |
| N-42 | 無 | binding 已停用（token 仍有效），讀取自己的 membership | `FORBIDDEN` |
| N-43 | 無 | fixture `ACTOR-TEACHER` 的對應（`homeroom_teacher@s2b1-v1`，capability 與 Stage 1 相同）登記點名 | 允許（fixture 正向回歸） |
| N-44 | 無 | fixture `ACTOR-SC01-TEACHER` 的對應修改請假摘要 | 允許（fixture 正向回歸） |
| N-45 | D-09 已核准 | fixture 形狀的 membership 被多加了 preset 沒有的 `archive.revise` | `FORBIDDEN`：超出 preset 的 capability 被忽略（超額 capability 拒絕） |
| N-46 | 無 | preset 有 `attendance.revise`，但 membership 上沒有，嘗試更正點名 | `FORBIDDEN`：preset 只限制、不授予 |
| N-47 | 無 | membership 記錄了不存在的 preset 版本 `s2b1-v0` | `FORBIDDEN`：membership 無效 |
| N-48 | D-09 已核准 | 操作者只有 `membership.manage`，替他人建立含 `audit.read` 的 workspace membership | `FORBIDDEN`（§6.3 步驟 9：不能授予自己沒有的 workspace capability） |
| N-49 | D-09 已核准 | 操作者的 workspace membership 的 `classId` 不是 null | `FORBIDDEN`（§6.3 步驟 5：membership 無效） |
| N-50 | 無 | 有效的 class membership 屬於另一個 principal | `FORBIDDEN` |
| N-51 | D-06＋D-09 已核准 | 有效的 read grant 屬於另一個 principal | `FORBIDDEN` |
| N-52 | 無 | membership 屬於另一個工作空間 | `FORBIDDEN` |
| N-53 | 無 | membership 缺少必要欄位 `rolePresetVersion` | `FORBIDDEN`：membership 無效 |
| N-54 | D-06＋D-09 已核准 | grant 缺少必要欄位 `expiresAt` | `FORBIDDEN`：grant 無效 |
| N-54b | D-06＋D-09 已核准 | grant 缺少 `grantedBy`（其他條件都成立） | `FORBIDDEN`：只有必要欄位規則能擋下這種情況 |
| N-55 | 無 | class membership 的 `classId` 是 null | `FORBIDDEN`：membership 無效 |
| N-55b | 無 | 唯一的 class membership 的 `classId` 是 null，嘗試自我讀取 | `FORBIDDEN`：自我讀取路徑沒有班級過濾，必須依 `classId` 非 null 規則判定無效 |
| N-56 | D-06＋D-09 已核准 | membership 上被寫了 `leave.sensitive.read`，但沒有 grant | `FORBIDDEN`：敏感存取只看 grant |
| N-57 | D-09 已核准 | 管理事件帶有多餘欄位（`studentId`、`resourceRef`、`traceId`、`policyVersion`、`authUid`） | 摘要只保留白名單欄位，值與原事件一致 |
| N-58 | D-09 已核准 | 管理動作被拒，原因碼不在白名單（`TARGET_HAS_SENSITIVE_GRANT`） | 摘要的 `reasonCode` 為 `OTHER` |
| N-59 | D-09 已核准 | 成對輸入：一般管理事件完全相同，其中一組另外夾雜敏感讀取、grant 建立與撤銷、binding 變更、班級資料讀取 | 兩組的可讀摘要逐欄完全相同（含 `summaryId`、筆數、時間） |
| N-60 | D-06＋D-09 已核准 | 建立 grant | 不修改任何 membership，也不產生 `membership.update` 摘要 |

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
| D-14 | 沒有任何有效 membership 的 principal，能否讀取自己的歷史 membership／grant | 不能：自我讀取也需要在該工作空間至少有一筆有效 membership（§6.4） | 負責人決定是否開放（例如供申訴或查核），以及開放範圍＋審查 |

## 13. 機器可讀的授權案例

下列 JSON 把 §11 中與授權判斷有關的案例寫成資料（`s2b1-authz-cases-v2`），方便審查時用獨立的評估程式驗證。這是**資料，不是程式**；本 PR 沒有任何對應的實作。

**證據範圍（REV-012）**：審查附件中的評估程式**只是模型測試**，只能說明「這些案例與本文件的表格、規則文字彼此一致」。

- 它**不代表**本規格已完整、正確，也**不代表**任何後端實作符合本規格。
- 它只涵蓋以下規則：
  - §6.1 步驟 2／2a；
  - §6.2／§6.3 步驟 5、6、8、9；
  - §6.4 的自我讀取；
  - §6.6 的摘要動作、欄位、原因碼白名單與 `summaryId` 規則；
  - §7 的存取條件與建立 grant 的前置；
  - §12 的預設值。
- **不涵蓋**：
  - §6.1 步驟 1（token 驗證）與步驟 3（scope 解析）；
  - §6.5、§8 的收據與交易（N-11～N-19）；
  - §9 讀取路徑、§10；
  - 封存學期、匯出、撤銷流程本身。

**由上游保證、評估程式直接採信的輸入假設**：

1. `request.authUid` 與 `request.tokenIat` 來自**已驗證簽章**的 Firebase ID token。
2. `op.workspaceId`／`op.classId` 是伺服器依資料模型 §4 從目標文件解析出的 scope，不是 client 宣稱的值。
3. `world` 中的紀錄確實來自 Firestore 的權威集合；評估程式只檢查紀錄**內容**，例如 `principalId`、`workspaceId`、必要欄位、狀態與期間。
4. `d06Assignments` 代表 D-06 程序產生的 `sensitive.grant.manage` 指派紀錄。D-06 尚未定義這個程序，此欄位只是模型的佔位。
5. 時間一律為 UTC ISO 8601 字串，可依字串比較。
6. 摘要的 `summaryId` 在模型中以 `S-1`、`S-2`… 表示「只依摘要本身的順序編號」，用來檢查它不受 `auditLog` 序號影響；實際規格是隨機 UUID v4（§6.6）。

**評估規則**：

- 依 §6、§7、§12 的文字計算每個案例的結果，並與 `expect` 比對。
- **前置條件**：每個 `approvals` 非空的案例，在 `approvals` 的**每一個真子集**下重新評估（例如 D-06＋D-09 的案例會另跑「兩者皆無」「只有 D-06」「只有 D-09」），結果都必須是 `FORBIDDEN` 或 `DISABLED`。正向結果只代表「假設已核准」的模型情境，**不代表**實際核准。
- **對照組**：有 `control` 的負向案例，套用 `control` 的修改（只改變被測試的那個條件）後，結果必須是 `ALLOW`。這確保負向案例確實是因為被測條件被拒，而不是被其他條件先擋下。
- **成對摘要**：`pairWithoutSensitiveEventsEqual = true` 的案例，會把敏感事件、grant、binding、班級資料事件全部移除後重新產生摘要，結果必須逐欄完全相同。

```json
{
 "schemaVersion": "s2b1-authz-cases-v2",
 "now": "2026-11-20T12:00:00Z",
 "presetVersion": "s2b1-v1",
 "cases": [
  {
   "id": "N-01",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships",
     [
      {
       "principalId": "P-A",
       "workspaceId": "WS-SC01",
       "scopeType": "workspace",
       "classId": null,
       "rolePreset": "workspace_admin",
       "rolePresetVersion": "s2b1-v1",
       "capabilities": [
        "membership.manage",
        "class.manage",
        "calendar.manage",
        "audit.read"
       ],
       "status": "active",
       "validFrom": "2026-09-01",
       "validToExclusive": null
      },
      {
       "principalId": "P-A",
       "workspaceId": "WS-SC01",
       "scopeType": "class",
       "classId": "CLASS-606-SC01",
       "rolePreset": "homeroom_teacher",
       "rolePresetVersion": "s2b1-v1",
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
       "validToExclusive": null
      }
     ]
    ]
   ]
  },
  {
   "id": "N-02a",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "homeroom_teacher",
    "rolePresetVersion": "s2b1-v1",
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
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "homeroom_teacher",
    "rolePresetVersion": "s2b1-v1",
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
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-A",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "homeroom_teacher",
    "rolePresetVersion": "s2b1-v1",
    "capabilities": [
     "attendance.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "op.targetPrincipalId",
     "P-B"
    ]
   ]
  },
  {
   "id": "N-04",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "homeroom_teacher",
    "rolePresetVersion": "s2b1-v1",
    "capabilities": [
     "attendance.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships",
     [
      {
       "principalId": "P-A",
       "workspaceId": "WS-SC01",
       "scopeType": "workspace",
       "classId": null,
       "rolePreset": "workspace_admin",
       "rolePresetVersion": "s2b1-v1",
       "capabilities": [
        "membership.manage",
        "class.manage",
        "calendar.manage",
        "audit.read"
       ],
       "status": "active",
       "validFrom": "2026-09-01",
       "validToExclusive": null
      }
     ]
    ]
   ]
  },
  {
   "id": "N-05",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
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
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-12-31T00:00:00Z",
      "grantedBy": "P-GRANTER"
     }
    ],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "revise"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.grants.0.capability",
     "leave.sensitive.revise"
    ]
   ]
  },
  {
   "id": "N-07",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "revoked",
      "expiresAt": "2026-12-31T00:00:00Z",
      "grantedBy": "P-GRANTER"
     }
    ],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.grants.0.status",
     "active"
    ]
   ]
  },
  {
   "id": "N-07b",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-11-19T00:00:00Z",
      "grantedBy": "P-GRANTER"
     }
    ],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.grants.0.expiresAt",
     "2026-12-31T00:00:00Z"
    ]
   ]
  },
  {
   "id": "N-08",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "revoked",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-12-31T00:00:00Z",
      "grantedBy": "P-GRANTER"
     }
    ],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.status",
     "active"
    ]
   ]
  },
  {
   "id": "N-09",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "capability": "sensitive.grant.manage",
      "status": "active"
     }
    ],
    "auditEvents": []
   },
   "op": {
    "type": "grantCreate",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "targetPrincipalId": "P-A",
    "capability": "leave.sensitive.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "op.targetPrincipalId",
     "P-B"
    ]
   ]
  },
  {
   "id": "N-09b",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "capability": "sensitive.grant.manage",
      "status": "active"
     }
    ],
    "auditEvents": []
   },
   "op": {
    "type": "grantCreate",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "targetPrincipalId": "P-B",
    "capability": "leave.sensitive.read"
   },
   "expect": {
    "result": "ALLOW",
    "membershipUpdates": 0
   }
  },
  {
   "id": "N-10",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "capability": "sensitive.grant.manage",
      "status": "active"
     }
    ],
    "auditEvents": []
   },
   "op": {
    "type": "grantCreate",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "targetPrincipalId": "P-B",
    "capability": "leave.sensitive.read"
   },
   "expect": {
    "result": "DISABLED"
   }
  },
  {
   "id": "N-20",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "subject_teacher",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "attendance.read",
       "leave.applicability.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.write"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships",
     [
      {
       "principalId": "P-A",
       "workspaceId": "WS-SC01",
       "scopeType": "class",
       "classId": "CLASS-606-SC01",
       "rolePreset": "homeroom_teacher",
       "rolePresetVersion": "s2b1-v1",
       "capabilities": [
        "attendance.read",
        "leave.applicability.read",
        "attendance.write"
       ],
       "status": "active",
       "validFrom": "2026-09-01",
       "validToExclusive": null
      }
     ]
    ]
   ]
  },
  {
   "id": "N-21",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
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
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "disabled",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.bindings.UID-A.status",
     "active"
    ]
   ]
  },
  {
   "id": "N-24",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "revoked",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.bindings.UID-A.status",
     "active"
    ]
   ]
  },
  {
   "id": "N-25",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-20T09:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "request.tokenIat",
     "2026-11-20T09:30:00Z"
    ]
   ]
  },
  {
   "id": "N-26",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T09:30:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-20T09:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
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
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "disabled"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.principals.P-A.status",
     "active"
    ]
   ]
  },
  {
   "id": "N-28",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.validToExclusive",
     null
    ]
   ]
  },
  {
   "id": "N-29s",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-12-31T00:00:00Z",
      "grantedBy": "P-GRANTER"
     }
    ],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
   },
   "expect": {
    "result": "ALLOW"
   }
  },
  {
   "id": "N-29",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": [
     {
      "auditId": "AUD-leave.sensitive.read-08:30:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T08:30:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "leave.sensitive.read",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "resourceRef": "workspaces/WS-SC01/classes/CLASS-606-SC01/leaveSensitiveNotes/LV-007",
      "studentId": "ST-SC01-0007"
     },
     {
      "auditId": "AUD-membership.create-09:00:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "targetPrincipalId": "P-B"
     }
    ]
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-SC01"
   },
   "expect": {
    "result": "ALLOW",
    "summaries": [
     {
      "summaryId": "S-1",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "decision": "allow",
      "reasonCode": "OK",
      "targetPrincipalId": "P-B"
     }
    ]
   }
  },
  {
   "id": "N-30",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "auditLogRead",
    "workspaceId": "WS-SC01"
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
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": [
     {
      "auditId": "AUD-leave.sensitive.read-08:30:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T08:30:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "leave.sensitive.read",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "resourceRef": "workspaces/WS-SC01/classes/CLASS-606-SC01/leaveSensitiveNotes/LV-007",
      "studentId": "ST-SC01-0007"
     },
     {
      "auditId": "AUD-leave.sensitive.read-08:40:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T08:40:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "leave.sensitive.read",
      "decision": "deny",
      "reasonCode": "NOT_AUTHORIZED",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "resourceRef": "workspaces/WS-SC01/classes/CLASS-606-SC01/leaveSensitiveNotes/LV-007"
     },
     {
      "auditId": "AUD-sensitiveGrant.create-08:50:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T08:50:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "sensitiveGrant.create",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "sensitiveGrant",
      "targetId": "GR-1",
      "targetPrincipalId": "P-A"
     },
     {
      "auditId": "AUD-sensitiveGrant.revoke-09:10:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:10:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "sensitiveGrant.revoke",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "sensitiveGrant",
      "targetId": "GR-1",
      "targetPrincipalId": "P-A"
     },
     {
      "auditId": "AUD-authBinding.disable-09:20:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:20:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "authBinding.disable",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN"
     },
     {
      "auditId": "AUD-attendance.read-09:30:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:30:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "attendance.read",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "classId": "CLASS-606-SC01"
     }
    ]
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-SC01"
   },
   "expect": {
    "result": "ALLOW",
    "summaries": []
   }
  },
  {
   "id": "N-32",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": [
     {
      "auditId": "AUD-membership.create-09:00:00",
      "workspaceId": "WS-A17",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "targetPrincipalId": "P-B"
     }
    ]
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-A17"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "op.workspaceId",
     "WS-SC01"
    ],
    [
     "world.auditEvents.0.workspaceId",
     "WS-SC01"
    ]
   ]
  },
  {
   "id": "N-33",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "subject_teacher",
    "rolePresetVersion": "s2b1-v1",
    "capabilities": [
     "attendance.read",
     "attendance.write"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "op.capabilities",
     [
      "attendance.read"
     ]
    ]
   ]
  },
  {
   "id": "N-34",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "subject_teacher",
    "rolePresetVersion": "s2b1-v1",
    "capabilities": [
     "attendance.write"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "op.capabilities",
     [
      "attendance.read"
     ]
    ]
   ]
  },
  {
   "id": "N-35",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "subject_teacher",
    "rolePresetVersion": "s2b1-v1",
    "capabilities": [
     "attendance.read"
    ],
    "changeRolePresetTo": "homeroom_teacher"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "op.changeRolePresetTo",
     null
    ]
   ]
  },
  {
   "id": "N-36",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "homeroom_teacher",
    "rolePresetVersion": "s2b1-v1",
    "capabilities": [
     "attendance.read",
     "leave.sensitive.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "op.capabilities",
     [
      "attendance.read"
     ]
    ]
   ]
  },
  {
   "id": "N-37",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "subject_teacher",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "leave.applicability.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.write"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.rolePreset",
     "homeroom_teacher"
    ]
   ]
  },
  {
   "id": "N-38",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "disabled"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "selfRead",
    "workspaceId": "WS-SC01",
    "kind": "membership"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.principals.P-A.status",
     "active"
    ]
   ]
  },
  {
   "id": "N-39",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "leave.applicability.read",
       "issue.read"
      ],
      "status": "revoked",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "selfRead",
    "workspaceId": "WS-SC01",
    "kind": "membership"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.status",
     "active"
    ]
   ]
  },
  {
   "id": "N-40",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "selfRead",
    "workspaceId": "WS-SC01",
    "kind": "grant"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.validToExclusive",
     null
    ]
   ]
  },
  {
   "id": "N-41",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     },
     {
      "principalId": "P-B",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "selfRead",
    "workspaceId": "WS-SC01",
    "kind": "membership"
   },
   "expect": {
    "result": "ALLOW",
    "records": [
     "P-A"
    ]
   }
  },
  {
   "id": "N-42",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "disabled",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "selfRead",
    "workspaceId": "WS-SC01",
    "kind": "membership"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.bindings.UID-A.status",
     "active"
    ]
   ]
  },
  {
   "id": "N-43",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "leave.applicability.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.write"
   },
   "expect": {
    "result": "ALLOW"
   }
  },
  {
   "id": "N-44",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "attendance.read",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "issue.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "leave.revise"
   },
   "expect": {
    "result": "ALLOW"
   }
  },
  {
   "id": "N-45",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "attendance.read",
       "attendance.revise",
       "leave.read",
       "leave.revise",
       "issue.read",
       "archive.revise"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "archive.revise"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "op.capability",
     "issue.read"
    ]
   ]
  },
  {
   "id": "N-46",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "attendance.read",
       "attendance.write",
       "leave.applicability.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.revise"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.capabilities",
     [
      "attendance.read",
      "attendance.write",
      "attendance.revise",
      "leave.applicability.read"
     ]
    ]
   ]
  },
  {
   "id": "N-47",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v0",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.rolePresetVersion",
     "s2b1-v1"
    ]
   ]
  },
  {
   "id": "N-48",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "workspace",
    "classId": null,
    "rolePreset": "workspace_admin",
    "rolePresetVersion": "s2b1-v1",
    "capabilities": [
     "audit.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.capabilities",
     [
      "membership.manage",
      "audit.read"
     ]
    ]
   ]
  },
  {
   "id": "N-49",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": "CLASS-606-SC01",
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "membershipWrite",
    "workspaceId": "WS-SC01",
    "targetPrincipalId": "P-B",
    "scopeType": "class",
    "classId": "CLASS-606-SC01",
    "rolePreset": "homeroom_teacher",
    "rolePresetVersion": "s2b1-v1",
    "capabilities": [
     "attendance.read"
    ]
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.classId",
     null
    ]
   ]
  },
  {
   "id": "N-50",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-B",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.principalId",
     "P-A"
    ]
   ]
  },
  {
   "id": "N-51",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [
     {
      "principalId": "P-B",
      "workspaceId": "WS-SC01",
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-12-31T00:00:00Z",
      "grantedBy": "P-GRANTER"
     }
    ],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.grants.0.principalId",
     "P-A"
    ]
   ]
  },
  {
   "id": "N-52",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-A17",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.workspaceId",
     "WS-SC01"
    ]
   ]
  },
  {
   "id": "N-53",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.rolePresetVersion",
     "s2b1-v1"
    ]
   ]
  },
  {
   "id": "N-54",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "grantedBy": "P-GRANTER"
     }
    ],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.grants.0.expiresAt",
     "2026-12-31T00:00:00Z"
    ]
   ]
  },
  {
   "id": "N-54b",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "classId": "CLASS-606-SC01",
      "capability": "leave.sensitive.read",
      "status": "active",
      "expiresAt": "2026-12-31T00:00:00Z"
     }
    ],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.grants.0.grantedBy",
     "P-GRANTER"
    ]
   ]
  },
  {
   "id": "N-55",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": null,
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "classData",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "capability": "attendance.read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.classId",
     "CLASS-606-SC01"
    ]
   ]
  },
  {
   "id": "N-55b",
   "approvals": [],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": null,
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "selfRead",
    "workspaceId": "WS-SC01",
    "kind": "membership"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.memberships.0.classId",
     "CLASS-606-SC01"
    ]
   ]
  },
  {
   "id": "N-56",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": []
   },
   "op": {
    "type": "sensitive",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "mode": "read"
   },
   "expect": {
    "result": "FORBIDDEN"
   },
   "control": [
    [
     "world.grants",
     [
      {
       "principalId": "P-A",
       "workspaceId": "WS-SC01",
       "classId": "CLASS-606-SC01",
       "capability": "leave.sensitive.read",
       "status": "active",
       "expiresAt": "2026-12-31T00:00:00Z",
       "grantedBy": "P-GRANTER"
      }
     ]
    ]
   ]
  },
  {
   "id": "N-57",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": [
     {
      "auditId": "AUD-membership.create-09:00:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "targetPrincipalId": "P-B",
      "studentId": "ST-SC01-0007",
      "resourceRef": "workspaces/WS-SC01/memberships/MEM-B1",
      "extra": "x"
     }
    ]
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-SC01"
   },
   "expect": {
    "result": "ALLOW",
    "summaries": [
     {
      "summaryId": "S-1",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "decision": "allow",
      "reasonCode": "OK",
      "targetPrincipalId": "P-B"
     }
    ]
   }
  },
  {
   "id": "N-58",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": [
     {
      "auditId": "AUD-membership.create-09:00:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "decision": "deny",
      "reasonCode": "TARGET_HAS_SENSITIVE_GRANT",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "targetPrincipalId": "P-B"
     }
    ]
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-SC01"
   },
   "expect": {
    "result": "ALLOW",
    "summaries": [
     {
      "summaryId": "S-1",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "decision": "deny",
      "reasonCode": "OTHER",
      "targetPrincipalId": "P-B"
     }
    ]
   }
  },
  {
   "id": "N-59",
   "approvals": [
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [],
    "auditEvents": [
     {
      "auditId": "AUD-membership.create-09:00:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "targetPrincipalId": "P-B"
     },
     {
      "auditId": "AUD-leave.sensitive.read-08:30:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T08:30:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "leave.sensitive.read",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "resourceRef": "workspaces/WS-SC01/classes/CLASS-606-SC01/leaveSensitiveNotes/LV-007",
      "studentId": "ST-SC01-0007"
     },
     {
      "auditId": "AUD-leave.sensitive.read-08:40:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T08:40:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "leave.sensitive.read",
      "decision": "deny",
      "reasonCode": "NOT_AUTHORIZED",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "resourceRef": "workspaces/WS-SC01/classes/CLASS-606-SC01/leaveSensitiveNotes/LV-007"
     },
     {
      "auditId": "AUD-sensitiveGrant.create-08:50:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T08:50:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "sensitiveGrant.create",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "sensitiveGrant",
      "targetId": "GR-1",
      "targetPrincipalId": "P-A"
     },
     {
      "auditId": "AUD-sensitiveGrant.revoke-09:10:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:10:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "sensitiveGrant.revoke",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "sensitiveGrant",
      "targetId": "GR-1",
      "targetPrincipalId": "P-A"
     },
     {
      "auditId": "AUD-authBinding.disable-09:20:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:20:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "authBinding.disable",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN"
     },
     {
      "auditId": "AUD-attendance.read-09:30:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T09:30:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "attendance.read",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "classId": "CLASS-606-SC01"
     },
     {
      "auditId": "AUD-class.update-10:00:00",
      "workspaceId": "WS-SC01",
      "at": "2026-11-20T10:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "class.update",
      "decision": "allow",
      "reasonCode": "OK",
      "traceId": "TRACE-1",
      "policyVersion": "s2b1-v1",
      "authUid": "UID-ADMIN",
      "targetType": "class",
      "targetId": "CLASS-606-SC01"
     }
    ]
   },
   "op": {
    "type": "auditSummaryRead",
    "workspaceId": "WS-SC01"
   },
   "expect": {
    "result": "ALLOW",
    "summaries": [
     {
      "summaryId": "S-1",
      "at": "2026-11-20T09:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "membership.create",
      "targetType": "membership",
      "targetId": "MEM-B1",
      "decision": "allow",
      "reasonCode": "OK",
      "targetPrincipalId": "P-B"
     },
     {
      "summaryId": "S-2",
      "at": "2026-11-20T10:00:00Z",
      "actorPrincipalId": "P-ADMIN",
      "action": "class.update",
      "targetType": "class",
      "targetId": "CLASS-606-SC01",
      "decision": "allow",
      "reasonCode": "OK"
     }
    ],
    "pairWithoutSensitiveEventsEqual": true
   }
  },
  {
   "id": "N-60",
   "approvals": [
    "D-06",
    "D-09"
   ],
   "request": {
    "authUid": "UID-A",
    "tokenIat": "2026-11-20T08:00:00Z"
   },
   "world": {
    "bindings": {
     "UID-A": {
      "principalId": "P-A",
      "status": "active",
      "activatedAt": "2026-11-01T00:00:00Z"
     }
    },
    "principals": {
     "P-A": {
      "status": "active"
     },
     "P-B": {
      "status": "active"
     }
    },
    "memberships": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "scopeType": "workspace",
      "classId": null,
      "rolePreset": "workspace_admin",
      "rolePresetVersion": "s2b1-v1",
      "capabilities": [
       "membership.manage",
       "class.manage",
       "calendar.manage",
       "audit.read"
      ],
      "status": "active",
      "validFrom": "2026-09-01",
      "validToExclusive": null
     },
     {
      "principalId": "P-B",
      "workspaceId": "WS-SC01",
      "scopeType": "class",
      "classId": "CLASS-606-SC01",
      "rolePreset": "homeroom_teacher",
      "rolePresetVersion": "s2b1-v1",
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
      "validToExclusive": null
     }
    ],
    "grants": [],
    "d06Assignments": [
     {
      "principalId": "P-A",
      "workspaceId": "WS-SC01",
      "capability": "sensitive.grant.manage",
      "status": "active"
     }
    ],
    "auditEvents": []
   },
   "op": {
    "type": "grantCreate",
    "workspaceId": "WS-SC01",
    "classId": "CLASS-606-SC01",
    "targetPrincipalId": "P-B",
    "capability": "leave.sensitive.read"
   },
   "expect": {
    "result": "ALLOW",
    "membershipUpdates": 0
   }
  }
 ]
}
```
