# S2-B1｜Firebase 資料模型規格 v0.1（草案）

> **狀態：設計文件，未實作。** 本文件沒有對應的 Firestore 資料、Security Rules、SDK 或可執行程式；所有 Stage 2 後端案例維持 `NOT_RUN`。
> 依據：架構決策 A（班級精確授權）、B（敏感請假資訊分離）、C（正式修改只經受控 API）；Stage 1 正式基準 `fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`（契約與 fixtures 不修改）。
> 相關文件：[授權](S2B1-AUTHORIZATION.md)｜[存取矩陣](S2B1-ACCESS-MATRIX.md)｜[契約對照](S2B1-CONTRACT-TRACEABILITY.md)

## 1. 設計原則

1. **身分、在籍、點名、請假、正式修訂、收據、事件與衍生資料各自獨立保存**，以 ID 互相參照，不互相覆寫。
2. **學生身分以 `studentId` 為唯一鍵**；座號（`seatNo`）只存在於在籍（Enrollment）與點名名單快照，永遠不作為身分或主鍵（POC-006、POC-034）。
3. **所有正式資料只由受控 API 寫入**（決策 C）。Client SDK 對 Firestore 的寫入一律拒絕；S2-B1 不定義任何 client 可寫的 Firestore 集合。
4. **敏感請假理由只存在 `leaveSensitiveNotes`**（決策 B），不出現在請假摘要、修訂摘要、事件、收據、衍生 View、統計、稽核或一般匯出。
5. **正式 current、Revision、OperationReceipt、Event 四者在同一交易內寫入**，全成或全不成（POC-016、POC-020）。
6. 本文件的欄位名稱沿用 Stage 1 fixtures（例如 `attendanceEntryId`、`leaveRecordId`、`coverageSegments`、`expectedVersion`、`operationId`）；fixtures 本身不修改。

## 2. 路徑總覽

`{wid}` = workspaceId，`{cid}` = classId。標示 **[server]** 的集合只由受控 API 或伺服器端衍生工作寫入。

```text
principals/{principalId}                                        [server]  人員主體
authBindings/{authUid}                                          [server]  Firebase Auth UID → principalId
workspaces/{wid}                                                [server]  工作空間
workspaces/{wid}/terms/{termId}                                 [server]  學期與封存狀態
workspaces/{wid}/calendars/{calendarId}                         [server]  可信日曆（版本化）
workspaces/{wid}/classes/{cid}                                  [server]  班級
workspaces/{wid}/memberships/{membershipId}                     [server]  成員授權（精確到 classId）
workspaces/{wid}/sensitiveGrants/{grantId}                      [server]  敏感資料存取的明確授權紀錄
workspaces/{wid}/accessIndex/{authUid}__{cid}                   [server]  授權索引（衍生，提案，見 D-02）
workspaces/{wid}/students/{studentId}                           [server]  學生身分
workspaces/{wid}/enrollments/{enrollmentId}                     [server]  在籍（含座號與有效期間）
workspaces/{wid}/classes/{cid}/attendanceSessions/{sessionId}   [server]  點名場次與名單快照
  …/entries/{attendanceEntryId}                                 [server]  正式點名 current
  …/entries/{attendanceEntryId}/revisions/{revisionNo}          [server]  點名修訂（append-only）
workspaces/{wid}/classes/{cid}/leaveRecords/{leaveRecordId}     [server]  請假摘要 current（不含敏感理由）
  …/leaveRecords/{leaveRecordId}/revisions/{revisionNo}         [server]  請假摘要修訂（append-only）
workspaces/{wid}/classes/{cid}/leaveSensitiveNotes/{leaveRecordId}        [server]  敏感備註
  …/leaveSensitiveNotes/{leaveRecordId}/revisions/{revisionNo}  [server]  敏感備註修訂（append-only）
workspaces/{wid}/operationReceipts/{operationId}                [server]  操作收據（冪等鍵）
workspaces/{wid}/events/{eventId}                               [server]  領域事件（append-only）
workspaces/{wid}/classes/{cid}/trackingIssues/{issueId}         [server]  核對事項（衍生）
workspaces/{wid}/classes/{cid}/views/{viewId}                   [server]  一般展示／投影 View（衍生，去敏）
workspaces/{wid}/stats/{statId}                                 [server]  統計快照（衍生）
workspaces/{wid}/auditLog/{auditId}                             [server]  授權決策與操作稽核（append-only）
```

## 3. 集合與欄位

### 3.1 人員主體與驗證綁定

**`principals/{principalId}`**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `principalId` | string | 與文件 ID 相同（例：`ACTOR-SC01-TEACHER`） |
| `status` | `active`／`disabled` | `disabled` 時所有授權失效 |
| `createdAt`、`updatedAt` | timestamp | |

**`authBindings/{authUid}`**：`authUid`、`principalId`、`status`、`boundAt`。一個 Firebase Auth UID 只能綁定一個 principal；綁定只由受控 API 建立。Client 不可讀取他人的綁定。

### 3.2 工作空間、學期、日曆、班級

- **`workspaces/{wid}`**：`workspaceId`、`name`、`status`。
- **`terms/{termId}`**：`termId`、`startLocalDate`、`endLocalDateExclusive`、`state`（`active`／`archived`）。`archived` 的學期，其正式資料唯讀（POC-030）。
- **`calendars/{calendarId}`**：`calendarId`、`version`、`trustState`（`trusted`／`unknown`）、`schoolDays[]`、`periodsByDay`、`policyRef`。`trustState = unknown` 時，不得推定出席率分母（POC-011、POC-014）。
- **`classes/{cid}`**：`classId`、`termId`、`name`、`status`。

### 3.3 成員授權（決策 A）

**`memberships/{membershipId}`**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `membershipId` | string | |
| `workspaceId` | string | 必須等於路徑 `{wid}` |
| `principalId` | string | |
| `scopeType` | `class`／`workspace` | `class`：資料存取授權；`workspace`：只授予工作空間管理能力，**不授予任何學生資料讀取** |
| `classId` | string／null | `scopeType = class` 時**必填**、且只能是一個班級；`workspace` 時為 null |
| `rolePreset` | string | 授權當下套用的範本名稱（見授權文件），**只作紀錄，不作授權判斷** |
| `capabilities` | string[] | 實際授權的 capability 清單（展開後保存） |
| `sensitiveGrantIds` | string[] | 若 `capabilities` 含 `leave.sensitive.read`，必須逐一參照有效的 `sensitiveGrants` |
| `validFrom` | date | 半開區間起點（含） |
| `validToExclusive` | date／null | 半開區間終點（不含）；null 表示未設定終點 |
| `status` | `active`／`suspended`／`revoked` | |
| `version` | int | 每次經 API 修改遞增 |

**`sensitiveGrants/{grantId}`**：`grantId`、`principalId`、`classId`、`capability`（固定為 `leave.sensitive.read`）、`grantedBy`（principalId）、`reasonCode`、`grantedAt`、`expiresAt`、`status`。這是決策 B「必須明確授權」的紀錄；不得由角色範本自動產生。

**`accessIndex/{authUid}__{cid}`**（提案，D-02）：由伺服器依 `authBindings` 與有效 `memberships` 計算的唯讀索引，欄位為 `principalId`、`classId`、`capabilities`、`validUntil`、`sourceMembershipVersions`。它只是加速查核的衍生資料，**權威來源永遠是 `memberships`**。

### 3.4 學生身分與在籍

- **`students/{studentId}`**：`studentId`、`displayName`（虛構）、`status`。**不含座號、不含班級。**
- **`enrollments/{enrollmentId}`**：`enrollmentId`、`studentId`、`classId`、`termId`、`seatNo`、`validFrom`、`validToExclusive`、`status`。
  - 同一學生在同一工作空間的在籍期間不得重疊（半開區間）。
  - 轉班或換座號以「結束舊在籍、建立新在籍」表示，不覆寫歷史（POC-007、POC-034）。

學生與在籍是工作空間層級的資料，讓學生跨班、跨學期時身分仍然穩定。**Client 不直接讀取**這兩個集合；班級名單由受控 API 依「班級＋日期的有效在籍」組合後回傳（見授權文件 §5）。

### 3.5 點名

**`attendanceSessions/{sessionId}`**：`sessionId`、`classId`、`date`、`kind`（`daily`／`period`）、`periodRef`、`rosterSnapshot[]`（`{enrollmentId, studentId, seatNo}`，建立場次當下的有效名單）、`calendarVersion`。歷史場次的名單快照不得因後來的在籍變動而改寫（POC-007）。

**`entries/{attendanceEntryId}`**（正式 current）

| 欄位 | 說明 |
|---|---|
| `attendanceEntryId`、`sessionId`、`classId`、`enrollmentId`、`studentId` | 以 ID 參照；不以座號或姓名參照 |
| `status` | `P`／`R`／`N`／`U`（語意依 Stage 1 fixtures，本文件不重新定義） |
| `scope` | `daily`／`period` |
| `version` | 正式版本，每次正式修改恰好 +1 |
| `lastOperationId`、`updatedAt`、`updatedBy` | |

**`entries/{id}/revisions/{revisionNo}`**：`revisionNo`（= 修改後的 `version`）、`previousVersion`、`newVersion`、`operationId`、`principalId`、`changedFields`、`before`、`after`、`committedAt`。建立後不可修改或刪除。

### 3.6 請假（決策 B）

**`leaveRecords/{leaveRecordId}`**：請假摘要 current，**不含任何理由文字**。

| 欄位 | 說明 |
|---|---|
| `leaveRecordId`、`classId`、`studentId`、`enrollmentId` | |
| `leaveTypeId` | 假別代碼（例：`SICK-LEAVE`）；是否對無敏感權限者顯示，由 capability 決定 |
| `coverageSegments[]` | `{segmentId, startLocalDate, endLocalDateExclusive, dayPart, periodRefs[], timeZone}`（半開區間） |
| `recordEffect`、`teacherConfirmation`、`administrativeApproval` | 沿用 fixtures 欄位 |
| `hasSensitiveNote` | boolean；只表示是否存在敏感備註，不含內容 |
| `version`、`lastOperationId`、`lastRevisionAt` | |

**`leaveSensitiveNotes/{leaveRecordId}`**：`leaveRecordId`、`classId`、`reasonNote`（敏感文字）、`sensitivityClass`、`version`、`lastOperationId`。它和請假摘要是**不同文件**，因為 Firestore 的存取控制以文件為單位，欄位層級無法分開授權。

**`leaveRecords/{id}/revisions/{n}`** 只記錄摘要欄位的變化；敏感文字的變化只記錄在 `leaveSensitiveNotes/{id}/revisions/{n}`。

請假**永遠不會自動改寫點名**（fixtures 不變條件 `noAutomaticAttendanceRewriteFromLeave`；POC-009、POC-016、POC-022）。

### 3.7 操作收據、事件與稽核

**`operationReceipts/{operationId}`**（文件 ID = `operationId`，冪等鍵）

| 欄位 | 說明 |
|---|---|
| `operationId` | |
| `requestHash` | 對「commandType＋targetType＋targetId＋expectedVersion＋intent＋principalId」取 SHA-256 |
| `principalId`、`classId`、`targetType`、`targetId` | |
| `status` | `committed` |
| `previousVersion`、`currentVersion` | |
| `derivedStatus` | `pending`／`done`（衍生資料是否已更新；沿用 fixtures 的 `canonicalCommittedReceipt`） |
| `committedAt` | |

**`events/{eventId}`**：`eventId`、`operationId`、`eventType`、`sourceType`、`sourceId`、`sourceVersion`、`classId`、`occurredAt`。事件只帶 ID 與版本，不帶敏感文字；由衍生工作消費。

**`auditLog/{auditId}`**：`auditId`、`principalId`（可為 null，例如未綁定的 UID）、`authUidHash`、`action`、`resourceRef`、`decision`（`allow`／`deny`）、`reasonCode`、`policyVersion`、`traceId`、`at`。拒絕的請求也要記錄（POC-004、POC-005）；不記錄敏感文字或學生姓名。

### 3.8 衍生資料

- **`trackingIssues/{issueId}`**：`issueId`、`progress`、`checkConclusion`、`question`、`evidence[]`（`{sourceType, sourceId, sourceVersion}`）、`evidenceStale`、`dedupeKey`。來源版本比 `evidence` 新時，`evidenceStale = true`，事項**不得自動解決**（POC-022、POC-023）。
- **`views/{viewId}`**：一般展示與投影 View。`viewType`（`roster-display`、`attendance-summary`、`leave-applicability`、`projection`）、`items[]`、`sourceAsOf`、`projectionAsOf`、`projectionStatus`（`fresh`／`STALE_OR_PENDING`）。**不得包含 `reasonNote` 或任何敏感文字**；`projection` 類型不含可識別個資（POC-004）。
- **`stats/{statId}`**：`scopeIds`、`calendarVersion`、`rateState`（`UNKNOWN`／`READY`）、`officialRate`、`officialDayDenominator`、`officialPeriodDenominator`、`sourceVersions`、`illustrativeOnly`。日曆不可信時 `rateState = UNKNOWN` 且分母為 null（POC-011）；示例資料不得作為正式統計（POC-012、POC-024）。

## 4. 不變條件

| ID | 不變條件 | 對應 Stage 1 |
|---|---|---|
| I-01 | `workspaces/{wid}` 下所有文件的 `workspaceId` 等於路徑 `{wid}`；跨工作空間參照一律拒絕 | POC-001、POC-002、POC-005 |
| I-02 | 班級層級文件的 `classId` 等於路徑 `{cid}`；授權判斷使用伺服器讀到的文件值，不使用 client 宣稱的值 | POC-005、POC-035 |
| I-03 | `studentId` 為唯一身分；`seatNo` 只出現在 `enrollments` 與 `rosterSnapshot`，不得作為文件 ID 或查詢主鍵 | POC-006、fixtures `noCrossDatasetIdentityFromSeatNo` |
| I-04 | 在籍、請假涵蓋、成員授權的期間一律為半開區間 `[from, toExclusive)` | POC-034 |
| I-05 | 點名計數：T＝P+R+N+U、已登記＝P+R+N、到校＝P+R | POC-008、fixtures `invariants` |
| I-06 | 請假不會自動改寫點名 | POC-009、POC-016、POC-022 |
| I-07 | 每次正式提交使 current `version` 恰好 +1，並在同一交易寫入 1 筆 Revision、1 筆 Receipt、至少 1 筆 Event；任一失敗則全部回滾 | POC-016、POC-018、POC-020 |
| I-08 | `expectedVersion` 不等於 current `version` 時以 `VERSION_CONFLICT` 拒絕且不寫入 | POC-017、POC-033 |
| I-09 | 相同 `operationId`＋相同 `requestHash` 回傳原收據、不再寫入；相同 `operationId`＋不同 `requestHash` 以 `OPERATION_REUSE_MISMATCH` 拒絕、不寫入、不回傳原收據內容 | POC-018、POC-019、POC-021 |
| I-10 | Revision、Receipt、Event、AuditLog 為 append-only，建立後不可修改或刪除 | POC-031 |
| I-11 | 敏感文字只存在 `leaveSensitiveNotes`；其他集合（含 Event、Receipt、Revision 摘要、View、Stats、AuditLog）不得包含 | POC-003、POC-029 |
| I-12 | 草稿不是正式資料：S2-B1 不在 Firestore 定義草稿集合；草稿不得產生正式 Revision，也不得使核對事項的 evidence 過期 | POC-015、POC-025 |
| I-13 | 衍生資料記錄 `sourceVersion`／`sourceAsOf`；來源較新時標示 stale 或 `STALE_OR_PENDING`，不得冒稱最新 | POC-022、POC-036 |
| I-14 | 日曆 `trustState = unknown` 時，統計 `rateState = UNKNOWN`，分母為 null | POC-011、POC-014 |
| I-15 | `archived` 學期的正式資料，只能由具 `archive.revise` 的明確授權經 API 修改 | POC-030 |
| I-16 | 不同資料集（例如 `A17-20261117` 與 `SC01-20261116`）不合併身分；以 `workspaceId` 隔離 | fixtures `mustNotMergeDatasets` |

## 5. 與 Stage 1 fixtures 的對應

| Fixtures 資料 | 本模型位置 |
|---|---|
| `principals[]`（`principalId`、`workspaceId`、`capabilities`） | `principals`＋`memberships`。Fixtures 的 principal 沒有 `classId`；Stage 2 載入時，每個 fixture principal 對應到該資料集 `classId` 的一筆 `scopeType = class` membership（例：`ACTOR-SC01-TEACHER` → `CLASS-606-SC01`）。`ACTOR-OTHER` 不建立任何 membership。 |
| `datasets.A17-20261117.rows[]` | `students`＋`enrollments`＋`attendanceSessions/AS-A17-20261117-DAILY/entries` |
| `datasets.SC01-20261116.attendance` | `…/entries/AT-20261116-07`（`version` 4，`status` N） |
| `datasets.SC01-20261116.leave` | `leaveRecords/LV-007`（`version` 5，不含理由）；如需敏感備註，放在 `leaveSensitiveNotes/LV-007` |
| `datasets.SC01-20261116.issue` | `trackingIssues/CR-20261116-001`（evidence 參照 LV-007 v5、AT-20261116-07 v4） |
| `canonicalCommand`／`canonicalCommittedReceipt` | 受控 API 的命令格式／`operationReceipts/{operationId}` |
| `SC01-DRAFT-v6` | 裝置本機草稿（不進 Firestore）；正式仍為 v5 |
| `SC01-COMMITTED-v6` | 經 API 提交後的 `leaveRecords/LV-007` v6＋revision＋receipt＋event（`hypotheticalOnly`，尚未執行） |
| `M04-PENDING`／`L1-ILLUSTRATIVE` | `calendars`（`trustState = unknown`）／`stats`（`illustrativeOnly = true`） |
| `OFFLINE-CONFLICT` | 客戶端 outbox 重送 → API 回 `VERSION_CONFLICT` |

## 6. 不在 S2-B1 範圍

- Security Rules、受控 API 的實作與部署方式（Cloud Functions 或其他）、索引設定。
- 裝置本機儲存（IndexedDB／outbox）的格式：屬於 OFFLINE 組，完整證據在 Stage 4。
- 備份與還原（POC-031）的實作、效能與費用量測（POC-032）。
- PostgreSQL 對應模型（Stage 3）。
