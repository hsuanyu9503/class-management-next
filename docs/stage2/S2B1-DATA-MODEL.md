# S2-B1｜Firebase 資料模型規格 v0.4（草案）

> **狀態：設計文件，未實作。** 本文件沒有對應的 Firestore 資料、Security Rules、SDK 或可執行程式；所有 Stage 2 後端案例維持 `NOT_RUN`。
> 依據：架構決策 A（班級精確授權）、B（敏感請假資訊分離）、C（正式修改只經受控 API）；Stage 1 正式基準 `fdcb5b9a0788584f7a35ff507e1daff3dd7d29ec`（契約與 fixtures 不修改）。
> v0.2：回應 PR #3 審查 R1（REV-002、REV-004、REV-005、REV-006 與 `hasSensitiveNote` 最小揭露）。
> v0.3：回應 PR #3 審查 R2（REV-007 Auth Binding 狀態欄位、REV-008 稽核分為 `auditLog` 與 `auditSummaries`）。
> v0.4：回應 PR #3 審查 R3（`rolePreset` 改為版本化的 capability 上限並新增 `rolePresetVersion`；敏感資料存取只依 grant，membership 不含 `leave.sensitive.*`；I-19、I-21 修訂）。
> 相關文件：[授權](S2B1-AUTHORIZATION.md)｜[存取矩陣](S2B1-ACCESS-MATRIX.md)｜[契約對照](S2B1-CONTRACT-TRACEABILITY.md)

## 1. 設計原則

1. **身分、在籍、點名、請假、正式修訂、收據、事件與衍生資料各自獨立保存**，以 ID 互相參照，不互相覆寫。
2. **學生身分以 `studentId` 為唯一鍵**；座號（`seatNo`）只存在於在籍（Enrollment）與點名名單快照，永遠不作為身分或主鍵（POC-006、POC-034）。
3. **所有正式資料只由受控 API 寫入**（決策 C）。Client SDK 對 Firestore 的寫入一律拒絕；S2-B1 不定義任何 client 可寫的 Firestore 集合。
4. **敏感請假資訊只存在 `leaveSensitiveNotes`**（決策 B）。其他集合不含敏感文字，也不含「是否有敏感備註」的旗標（§3.6）。
5. **每次正式提交在同一交易內寫入：current（version +1）、恰好 1 筆 Revision、恰好 1 筆 Receipt、恰好 1 筆 Event**；全成或全不成（POC-016、POC-020）。
6. **路徑是 Scope 的權威來源**；文件內的 `workspaceId`／`classId` 欄位必須與路徑一致（§4）。
7. 欄位名稱沿用 Stage 1 fixtures（例如 `attendanceEntryId`、`leaveRecordId`、`coverageSegments`、`expectedVersion`、`operationId`）；fixtures 本身不修改。

## 2. 路徑總覽

`{wid}` = workspaceId，`{cid}` = classId。所有集合都只由受控 API 或伺服器端衍生工作寫入。

```text
principals/{principalId}                                          人員主體
authBindings/{authUid}                                            Firebase Auth UID → principalId
workspaces/{wid}                                                  工作空間
workspaces/{wid}/terms/{termId}                                   學期與封存狀態
workspaces/{wid}/calendars/{calendarId}                           可信日曆（版本化）
workspaces/{wid}/classes/{cid}                                    班級
workspaces/{wid}/memberships/{membershipId}                       成員授權（class 或 workspace 範圍）
workspaces/{wid}/sensitiveGrants/{grantId}                        敏感資料存取的明確授權
workspaces/{wid}/accessIndex/{authUid}__{cid}                     授權索引（衍生；D-02，預設不建立）
workspaces/{wid}/students/{studentId}                             學生身分
workspaces/{wid}/enrollments/{enrollmentId}                       在籍（含座號與有效期間）
workspaces/{wid}/classes/{cid}/attendanceSessions/{sessionId}     點名場次與名單快照
  …/entries/{attendanceEntryId}                                   正式點名 current
  …/entries/{attendanceEntryId}/revisions/{revisionNo}            點名修訂（不可變）
workspaces/{wid}/classes/{cid}/leaveRecords/{leaveRecordId}       請假摘要 current（不含敏感資訊）
  …/leaveRecords/{leaveRecordId}/revisions/{revisionNo}           請假摘要修訂（不可變）
workspaces/{wid}/classes/{cid}/leaveSensitiveNotes/{leaveRecordId}          敏感備註
  …/leaveSensitiveNotes/{leaveRecordId}/revisions/{revisionNo}    敏感備註修訂（不可變）
workspaces/{wid}/operationReceipts/{operationId}                  操作收據（不可變；冪等鍵）
workspaces/{wid}/derivedProgress/{operationId}                    衍生更新進度（可更新）
workspaces/{wid}/events/{eventId}                                 領域事件（不可變）
workspaces/{wid}/classes/{cid}/trackingIssues/{issueId}           核對事項（衍生）
workspaces/{wid}/classes/{cid}/views/{viewId}                     一般展示／投影 View（衍生，去敏）
workspaces/{wid}/stats/{statId}                                   統計快照（衍生）
workspaces/{wid}/auditLog/{auditId}                               完整安全稽核（不可變；沒有任何 API 可讀，D-11）
workspaces/{wid}/auditSummaries/{summaryId}                       管理稽核摘要（不可變；白名單動作與欄位，`audit.read` 可讀）
```

## 3. 集合與欄位

除非特別說明，每份文件都帶 §4 規定的 Scope 欄位（`workspaceId`，班級資料另加 `classId`），下列表格不再重複列出。

### 3.1 人員主體與驗證綁定（工作空間之外）

**`principals/{principalId}`**：`principalId`（與文件 ID 相同）、`status`（`active`／`disabled`；`disabled` 時所有授權失效）、`createdAt`、`updatedAt`。

**`authBindings/{authUid}`**（REV-007；生命週期見授權文件 §6.7）

| 欄位 | 說明 |
|---|---|
| `authUid`、`principalId` | 一個 `authUid` 同一時間只綁定一個 principal |
| `status` | `active`／`disabled`／`revoked`；只有 `active` 可以通過授權 |
| `activatedAt` | 本次綁定生效的時間；**簽發時間早於此值的 token 一律拒絕** |
| `bindingVersion` | 每次重新綁定 +1 |
| `disabledAt`、`disabledBy`、`revokedAt`、`revokedBy`、`reasonCode` | 狀態變更紀錄 |

綁定的建立與變更方式待決（D-13）；決定前不提供 API。

### 3.2 工作空間、學期、日曆、班級

- **`workspaces/{wid}`**：`name`、`status`。
- **`terms/{termId}`**：`termId`、`startLocalDate`、`endLocalDateExclusive`、`state`（`active`／`archived`）。`archived` 學期的正式資料唯讀（POC-030）。
- **`calendars/{calendarId}`**：`calendarId`、`version`、`trustState`（`trusted`／`unknown`）、`schoolDays[]`、`periodsByDay`、`policyRef`。`trustState = unknown` 時不得推定出席率分母（POC-011、POC-014）。
- **`classes/{cid}`**：`classId`、`termId`、`name`、`status`。

### 3.3 成員授權（決策 A）

**`memberships/{membershipId}`**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `membershipId` | string | |
| `principalId` | string | |
| `scopeType` | `class`／`workspace` | 決定這筆 membership 只能用在哪一種授權分支（授權文件 §6） |
| `classId` | string／null | `scopeType = class` 時**必填**且只能是一個班級；`workspace` 時**必須為 null** |
| `rolePreset` | string | 建立時套用的 preset 名稱。**作為有效 capability 的上限**（授權文件 §5）：有效 capability = `capabilities` ∩ 該 preset 版本的預設值。preset 不授予任何 membership 上沒有的 capability；角色名稱本身也不授予權限。建立後不可修改 |
| `rolePresetVersion` | string | 建立時的 preset 版本（目前為 `s2b1-v1`）。授權一律使用此版本；修改 preset 定義必須建立新版本，不回溯影響既有 membership。不存在的版本 → membership 無效 |
| `capabilities` | string[] | membership 上記錄的 capability。只有與 `scopeType` 相符、已啟用、且在 preset 上限內的才有效（授權文件 §4、§5）。**不得**包含 `leave.sensitive.*`（只由 grant 授予）或 `sensitive.grant.manage`（依 D-06）；即使出現也一律忽略 |
| `validFrom` | date | 半開區間起點（含） |
| `validToExclusive` | date／null | 半開區間終點（不含）；null 表示未設定終點 |
| `status` | `active`／`suspended`／`revoked` | |
| `version` | int | 每次經 API 修改 +1 |
| `createdBy`、`updatedBy` | principalId | 不可等於 `principalId` 本人（禁止自我授權，授權文件 §6.3） |

**`sensitiveGrants/{grantId}`**（決策 B 的明確授權紀錄，完整規則見授權文件 §7）

| 欄位 | 說明 |
|---|---|
| `grantId`、`principalId`、`classId` | 只授予一個 principal 在一個班級 |
| `capability` | `leave.sensitive.read` 或 `leave.sensitive.revise`，一筆 grant 只授予一種 |
| `grantedBy`、`grantedAt`、`reasonCode` | `grantedBy` 不可等於 `principalId` |
| `expiresAt` | **必填**，不得無期限 |
| `status` | `active` → `revoked`（單向）；過期由時間判斷，不需改狀態 |
| `revokedBy`、`revokedAt`、`revokeReasonCode` | 撤銷時寫入 |

grant 只能新增或從 `active` 改為 `revoked`，其他欄位建立後不可修改；續期必須建立新的 grant。

**`accessIndex/{authUid}__{cid}`**：伺服器衍生的唯讀索引，只在 D-01 決定允許 client 直接讀取時才建立（D-02）；在那之前不建立。權威來源永遠是 `memberships` 與 `sensitiveGrants`。

### 3.4 學生身分與在籍

- **`students/{studentId}`**：`studentId`、`displayName`（虛構）、`status`。**不含座號，不含班級。**
- **`enrollments/{enrollmentId}`**：`enrollmentId`、`studentId`、`classId`、`termId`、`seatNo`、`validFrom`、`validToExclusive`、`status`。
  - 同一學生在同一工作空間的在籍期間不得重疊（半開區間）。
  - 轉班或換座號以「結束舊在籍、建立新在籍」表示，不覆寫歷史（POC-007、POC-034）。

這兩個集合位於工作空間層級，讓學生跨班、跨學期時身分仍然穩定。Client 不直接讀取；班級名單經受控 API 讀取，見授權文件 §4（`roster.read`、`attendance.read`）與存取矩陣 §2。

### 3.5 點名

**`attendanceSessions/{sessionId}`**：`sessionId`、`date`、`kind`（`daily`／`period`）、`periodRef`、`rosterSnapshot[]`（`{enrollmentId, studentId, seatNo}`，建立場次當下的有效名單，不含姓名）、`calendarVersion`。歷史場次的名單快照不得因後來的在籍變動而改寫（POC-007）。

**`entries/{attendanceEntryId}`**（正式 current）：`attendanceEntryId`、`sessionId`、`enrollmentId`、`studentId`、`status`（`P`／`R`／`N`／`U`，語意依 Stage 1 fixtures，本文件不重新定義）、`scope`（`daily`／`period`）、`version`（每次正式修改恰好 +1）、`lastOperationId`、`updatedAt`、`updatedBy`。

**`entries/{id}/revisions/{revisionNo}`**：`revisionNo`（= 修改後的 `version`）、`previousVersion`、`newVersion`、`operationId`、`principalId`、`changedFields`、`before`、`after`、`committedAt`。建立後不可修改或刪除。

### 3.6 請假（決策 B）

**`leaveRecords/{leaveRecordId}`**：請假摘要 current。

| 欄位 | 說明 |
|---|---|
| `leaveRecordId`、`studentId`、`enrollmentId` | |
| `leaveTypeId` | 假別代碼（例：`SICK-LEAVE`）；只有 `leave.read` 才看得到 |
| `coverageSegments[]` | `{segmentId, startLocalDate, endLocalDateExclusive, dayPart, periodRefs[], timeZone}`（半開區間） |
| `recordEffect`、`teacherConfirmation`、`administrativeApproval` | 沿用 fixtures 欄位 |
| `version`、`lastOperationId`、`lastRevisionAt` | |

**最小揭露（`hasSensitiveNote`）**：v0.1 曾在摘要放 `hasSensitiveNote` 布林值；v0.2 **刪除這個欄位**。理由：「這位學生的請假有敏感備註」本身就是敏感資訊，而 Firestore 無法在文件內逐欄位授權。是否有敏感備註，只能由具 `leave.sensitive.read`＋有效 grant 的 principal 查詢 `leaveSensitiveNotes/{leaveRecordId}` 得知。對其他人，「沒有備註」和「沒有權限」的回應相同（`FORBIDDEN`）。

**`leaveSensitiveNotes/{leaveRecordId}`**：`leaveRecordId`、`reasonNote`（敏感文字）、`sensitivityClass`、`version`、`lastOperationId`。這是一份獨立文件，因為 Firestore 的存取控制以文件為單位。

**`leaveRecords/{id}/revisions/{n}`** 只記錄摘要欄位的變化；敏感文字的變化只記錄在 `leaveSensitiveNotes/{id}/revisions/{n}`。

請假**永遠不會自動改寫點名**（fixtures 不變條件 `noAutomaticAttendanceRewriteFromLeave`；POC-009、POC-016、POC-022）。

### 3.7 操作收據、衍生進度、事件與稽核（REV-002、REV-004）

**`operationReceipts/{operationId}`**：**完全不可變**，在提交交易內建立一次，之後不得修改或刪除。

| 欄位 | 說明 |
|---|---|
| `operationId` | 文件 ID。範圍是**工作空間**：同一 `workspaceId` 內唯一 |
| `requestHash` | 依授權文件 §8 的 canonical 規則計算 |
| `requestHashAlgorithm` | 固定為 `sha256-stablejson-v1` |
| `principalId`、`classId`、`commandType`、`targetType`、`targetId` | 原請求的主體與目標 |
| `status` | 固定為 `committed`（只有成功提交才會建立收據） |
| `previousVersion`、`currentVersion` | |
| `derivedStatusAtCommit` | 固定為 `pending`：提交當下衍生資料尚未更新。對應 fixtures `canonicalCommittedReceipt.derivedStatus = "pending"` |
| `committedAt` | |

**`derivedProgress/{operationId}`**：衍生更新的**目前**進度，由衍生工作更新：`operationId`、`derivedStatus`（`pending`／`done`／`failed`）、`updatedAt`、`attempts`。收據查詢 API 回傳的 `derivedStatus` 讀自這裡；收據本身不改（POC-036）。

**`events/{eventId}`**：`eventId`、`operationId`、`eventType`、`sourceType`、`sourceId`、`sourceVersion`、`occurredAt`。每次正式提交**恰好 1 筆**（POC-016 `eventDelta = 1`）。事件只帶 ID 與版本，不帶敏感文字。不可變。

**`auditLog/{auditId}`**（完整安全稽核）：`auditId`、`principalId`（可為 null，例如未綁定的 UID）、`authUid`、`action`、`resourceRef`（完整的 collection 與文件 ID）、`decision`（`allow`／`deny`）、`reasonCode`、`policyVersion`、`traceId`、`at`。記錄所有允許與拒絕，包括每一次敏感備註讀取、grant 與 Auth Binding 的變更（POC-004、POC-005）。不記錄敏感文字或學生姓名。**沒有任何 API 可以讀取**，存取程序待決（D-11）。不可變。

**`auditSummaries/{summaryId}`**（管理稽核摘要，REV-008）：只包含授權文件 §6.6 的白名單動作與白名單欄位：`summaryId`、`at`、`actorPrincipalId`、`action`、`targetType`、`targetId`、`targetPrincipalId`、`decision`、`reasonCode`。**不包含任何班級資料存取事件**，也不包含 `studentId`、班級資料文件 ID 或其雜湊、`traceId`。v0.2 曾以文件 ID 的 SHA-256 雜湊作為去識別方式；因為 ID 少且可列舉，雜湊可被逐一試算還原，v0.3 已移除這個作法。由受控 API 與 `auditLog` 在同一交易寫入。不可變。

### 3.8 衍生資料

- **`trackingIssues/{issueId}`**：`issueId`、`progress`、`checkConclusion`、`question`、`evidence[]`（`{sourceType, sourceId, sourceVersion}`）、`evidenceStale`、`dedupeKey`。來源版本比 `evidence` 新時 `evidenceStale = true`，且**不得自動解決**（POC-022、POC-023）。
- **`views/{viewId}`**：`viewType`（`roster-display`、`attendance-summary`、`leave-applicability`、`projection`）、`items[]`、`sourceAsOf`、`projectionAsOf`、`projectionStatus`（`fresh`／`STALE_OR_PENDING`）。不含敏感文字；`projection` 不含可識別個資（POC-004）。
- **`stats/{statId}`**：`scopeIds`、`calendarVersion`、`rateState`（`UNKNOWN`／`READY`）、`officialRate`、`officialDayDenominator`、`officialPeriodDenominator`、`sourceVersions`、`illustrativeOnly`。日曆不可信時 `rateState = UNKNOWN` 且分母為 null（POC-011）；示例資料不得作為正式統計（POC-012、POC-024）。

## 4. Scope 欄位與路徑權威（REV-005）

**規則**

1. **路徑是權威來源。** 文件位於 `workspaces/{wid}/…` 時，它的工作空間就是 `{wid}`；位於 `…/classes/{cid}/…` 時，它的班級就是 `{cid}`。
2. **欄位必須與路徑一致。** 每份工作空間內的文件都帶 `workspaceId`；班級路徑下的文件都帶 `classId`。受控 API 寫入時一律**由路徑填入**，不接受 client 提供的值。
3. **不在班級路徑下、但屬於某班級的文件**（`enrollments`、`memberships`（class）、`sensitiveGrants`、`operationReceipts`、`stats` 的班級統計），`classId` 欄位就是權威來源，且建立後不可修改。
4. **授權時，Scope 由伺服器讀到的目標文件決定**（路徑＋上述欄位）。如果文件欄位與路徑不一致，視為資料完整性錯誤：拒絕請求（對外回 `FORBIDDEN`），稽核記錄 `reasonCode = SCOPE_INTEGRITY_ERROR`。

**各集合的 Scope 來源**

| 集合 | `workspaceId` 來源 | `classId` 來源 |
|---|---|---|
| `principals`、`authBindings` | 無（工作空間之外） | 無 |
| `workspaces`、`terms`、`calendars`、`students` | 路徑 | 無 |
| `classes` | 路徑 | 路徑（文件 ID） |
| `memberships` | 路徑 | 欄位（`scopeType = class` 必填；`workspace` 為 null） |
| `sensitiveGrants` | 路徑 | 欄位（必填） |
| `accessIndex` | 路徑 | 文件 ID 的 `{cid}` 部分 |
| `enrollments` | 路徑 | 欄位（必填） |
| `attendanceSessions`、`entries`、`revisions` | 路徑 | 路徑 |
| `leaveRecords`、`leaveSensitiveNotes` 及其 `revisions` | 路徑 | 路徑 |
| `trackingIssues`、`views` | 路徑 | 路徑 |
| `operationReceipts` | 路徑 | 欄位（目標文件的 `classId`） |
| `derivedProgress` | 路徑 | 無（以 `operationId` 對應收據） |
| `events` | 路徑 | 無（以 `sourceId` 對應來源；只供衍生工作，不開放讀取） |
| `stats` | 路徑 | 欄位（班級統計必填；工作空間統計為 null） |
| `auditLog` | 路徑 | 無（`resourceRef` 記完整參照；不開放讀取） |
| `auditSummaries` | 路徑 | 無（只有工作空間管理目標；`targetId` 可以是 `classId`，但只出現在 `class.*` 動作） |

## 5. 不變條件

| ID | 不變條件 | 對應 Stage 1 |
|---|---|---|
| I-01 | 工作空間內每份文件的 `workspaceId` 等於路徑 `{wid}`；跨工作空間參照一律拒絕 | POC-001、POC-002、POC-005 |
| I-02 | 班級路徑下每份文件的 `classId` 等於路徑 `{cid}`；不在班級路徑下的班級文件，`classId` 欄位建立後不可修改；不一致時以 `SCOPE_INTEGRITY_ERROR` 拒絕（§4） | POC-005、POC-035 |
| I-03 | `studentId` 為唯一身分；`seatNo` 只出現在 `enrollments` 與 `rosterSnapshot`，不得作為文件 ID 或查詢主鍵 | POC-006、fixtures `noCrossDatasetIdentityFromSeatNo` |
| I-04 | 在籍、請假涵蓋、成員授權的期間一律為半開區間 `[from, toExclusive)` | POC-034 |
| I-05 | 點名計數：T＝P+R+N+U、已登記＝P+R+N、到校＝P+R | POC-008、fixtures `invariants` |
| I-06 | 請假不會自動改寫點名 | POC-009、POC-016、POC-022 |
| I-07 | 每次正式提交使 current `version` 恰好 +1，並在同一交易寫入**恰好 1 筆** Revision、**恰好 1 筆** Receipt、**恰好 1 筆** Event；任一失敗則全部回滾 | POC-016、POC-018、POC-020 |
| I-08 | `expectedVersion` 不等於 current `version` 時以 `VERSION_CONFLICT` 拒絕且不寫入 | POC-017、POC-033 |
| I-09 | 同一工作空間內：相同 `operationId`＋相同 `requestHash` 回傳原收據、不再寫入；相同 `operationId`＋不同 `requestHash`（包括不同 principal）以 `OPERATION_REUSE_MISMATCH` 拒絕、不寫入、不回傳原收據的任何欄位 | POC-018、POC-019、POC-021 |
| I-10 | Revision、Receipt、Event、`auditLog`、`auditSummaries` 建立後不可修改或刪除；衍生進度另存於 `derivedProgress` | POC-031、POC-036 |
| I-11 | 敏感文字與「是否有敏感備註」只存在 `leaveSensitiveNotes`；其他集合（含 Event、Receipt、Revision 摘要、View、Stats、`auditLog`、`auditSummaries`、匯出）都不得包含 | POC-003、POC-029 |
| I-12 | 草稿不是正式資料：S2-B1 不在 Firestore 定義草稿集合；草稿不得產生正式 Revision，也不得使核對事項的 evidence 過期 | POC-015、POC-025 |
| I-13 | 衍生資料記錄 `sourceVersion`／`sourceAsOf`；來源較新時標示 stale 或 `STALE_OR_PENDING`，不得冒稱最新 | POC-022、POC-036 |
| I-14 | 日曆 `trustState = unknown` 時，統計 `rateState = UNKNOWN`，分母為 null | POC-011、POC-014 |
| I-15 | `archived` 學期的正式資料，只能由具 `archive.revise` 的明確授權經 API 修改 | POC-030 |
| I-16 | 不同資料集（例如 `A17-20261117` 與 `SC01-20261116`）不合併身分；以 `workspaceId` 隔離 | fixtures `mustNotMergeDatasets` |
| I-17 | membership 的 capability 必須與 `scopeType` 相符；`scopeType = workspace` 的 membership 不授予任何班級資料存取 | 決策 A |
| I-18 | 不得自我授權：membership、sensitive grant、Auth Binding 的建立者、修改者不可是被授權者本人 | 決策 A、B |
| I-19 | 授權必須同時滿足：Auth Binding `active` 且 token 簽發時間不早於 `activatedAt`、Principal `active`、Membership 有效（含 `principalId`、`workspaceId`、必要欄位）；三者各自檢查。**自我讀取**（讀自己的 membership、grant、收據）也適用，沒有例外（D-14） | REV-007、REV-010 |
| I-20 | `auditSummaries` 不含任何班級資料存取事件；只具 `audit.read` 的管理者無法從中推知任何班級或學生的資料是否存在或被存取 | REV-008、決策 B |
| I-21 | membership 的有效 capability = `capabilities` ∩ `rolePreset@rolePresetVersion` 的預設值；經 API 寫入時 `capabilities` 必須是該預設值的子集；`rolePreset` 與 `rolePresetVersion` 建立後不可修改。`leave.sensitive.*` 不在 membership 上，只由有效 grant 授予（§7）；`sensitive.grant.manage` 不在任何 preset，只能依 D-06 定義的程序指派，D-06 前沒有人持有 | REV-009、REV-011、D-06、D-12 |

## 6. 與 Stage 1 fixtures 的對應

| Fixtures 資料 | 本模型位置 |
|---|---|
| `principals[]`（`principalId`、`workspaceId`、`capabilities`） | `principals`＋`memberships`。每個 fixture principal 對應到該資料集 `classId` 的**一筆** `scopeType = class` membership，`capabilities` **與 Stage 1 完全相同，不增不減**（REV-003；見存取矩陣 §5）。`ACTOR-OTHER` 不建立任何 membership。 |
| `datasets.A17-20261117.rows[]` | `students`＋`enrollments`＋`attendanceSessions/AS-A17-20261117-DAILY`（`rosterSnapshot` 15 筆）＋`entries` |
| `datasets.SC01-20261116.attendance` | `…/entries/AT-20261116-07`（`version` 4，`status` N） |
| `datasets.SC01-20261116.leave` | `leaveRecords/LV-007`（`version` 5） |
| `datasets.SC01-20261116.issue` | `trackingIssues/CR-20261116-001`（evidence 參照 LV-007 v5、AT-20261116-07 v4） |
| `canonicalCommand` | 受控 API 的命令格式（授權文件 §8） |
| `canonicalCommittedReceipt` | `operationReceipts/{operationId}`；其中 `derivedStatus: "pending"` 對應 `derivedStatusAtCommit` |
| `SC01-DRAFT-v6` | 裝置本機草稿（不進 Firestore）；正式仍為 v5 |
| `SC01-COMMITTED-v6` | 經 API 提交後的 `leaveRecords/LV-007` v6＋1 筆 revision＋1 筆 receipt＋1 筆 event（`hypotheticalOnly`，尚未執行） |
| `M04-PENDING`／`L1-ILLUSTRATIVE` | `calendars`（`trustState = unknown`）／`stats`（`illustrativeOnly = true`） |
| `OFFLINE-CONFLICT` | 客戶端 outbox 重送 → API 回 `VERSION_CONFLICT` |

## 7. 不在 S2-B1 範圍

- Security Rules、受控 API 的實作與部署方式、索引設定。
- 裝置本機儲存（IndexedDB／outbox）的格式：屬於 OFFLINE 組，完整證據在 Stage 4。
- 備份與還原（POC-031）的實作、效能與費用量測（POC-032）。
- PostgreSQL 對應模型（Stage 3）。
