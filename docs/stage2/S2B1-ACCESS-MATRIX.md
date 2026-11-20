# S2-B1｜存取授權矩陣 v0.1（草案）

> **狀態：設計文件，未實作，未驗證。** 矩陣描述預期的授權結果，不是任何後端的測試結果。
> 相關文件：[資料模型](S2B1-DATA-MODEL.md)｜[授權](S2B1-AUTHORIZATION.md)｜[契約對照](S2B1-CONTRACT-TRACEABILITY.md)

## 1. 如何閱讀

- 欄位是**套用 Role Preset 後的預設 capability**（見授權文件 §5）。實際判斷只看 membership 上的 capability，不看角色名稱。
- 表格中的班級資料權限，都只適用於「該 principal 有有效 membership 的那一個 `classId`」。對其他班級一律是 `—`。

| 記號 | 意義 |
|---|---|
| `R` | 可讀（依 D-01，可能經 API 或 Security Rules） |
| `R-API` | 只能經受控 API 讀取，client 不可直接讀 Firestore |
| `R*` | 需要明確授權（`leave.sensitive.read`＋有效 `sensitiveGrants`）；預設**沒有** |
| `W-API` | 只能經受控 API 寫入（含 §6 的全部檢查） |
| `W-API*` | 經受控 API，且需要額外的明確授權 |
| `—` | 拒絕：回 `FORBIDDEN`，不回傳可識別欄位 |
| `SYS` | 只由伺服器端衍生工作或受控 API 內部寫入；沒有任何角色可直接觸發 |

**Client SDK 直接寫入：所有角色、所有集合都是 `—`。**（決策 C）

## 2. 班級層級資料

「所需 capability」是判斷依據；其餘欄位是各 preset 預設 capability 推得的結果。

| 集合／資料 | 所需 capability | 導師 | 科任 | 管理者（workspace） | 投影 | 無 membership／其他工作空間 |
|---|---|---|---|---|---|---|
| 班級名單（`students`＋`enrollments` 經 API 組合） | `roster.read` | R-API | R-API | — | — | — |
| `attendanceSessions`、`entries`（讀） | `attendance.read` | R | R | — | — | — |
| 建立場次、登記點名 | `attendance.write` | W-API | W-API | — | — | — |
| 更正已提交的點名 | `attendance.revise` | W-API | — | — | — | — |
| `entries/*/revisions`（讀） | `attendance.revise` | R | — | — | — | — |
| `leaveRecords`（摘要，讀） | `leave.read` | R | — | — | — | — |
| `leaveRecords`（修改） | `leave.revise` | W-API | — | — | — | — |
| `leaveRecords/*/revisions`（讀） | `leave.revise` | R | — | — | — | — |
| 請假適用提示（`leave-applicability` View） | `leave.applicability.read` | R | R | — | — | — |
| `leaveSensitiveNotes`＋其 revisions（讀） | `leave.sensitive.read`＋有效 grant | R*（預設無） | R*（預設無） | —（需另建 class membership 與 grant） | — | — |
| `leaveSensitiveNotes`（修改） | `leave.sensitive.revise`＋有效 grant | W-API*（預設無） | — | — | — | — |
| `trackingIssues` | `issue.read` | R | — | — | — | — |
| `views`（`roster-display`） | `roster.read` | R | R | — | — | — |
| `views`（`attendance-summary`） | `attendance.read` | R | R | — | — | — |
| `views`（`projection`，去識別） | `projection.read` 或 `attendance.read` | R | R | — | R | — |
| `stats`（該班） | `stats.read` | R | — | — | — | — |
| 匯出（伺服器端裁剪） | `export.basic` | R-API | — | — | — | — |
| 已封存學期的正式資料修改 | 對應的 `*.revise`＋`archive.revise` | W-API*（預設無 `archive.revise`） | — | — | — | — |

## 3. 工作空間層級資料

| 集合 | 所需 capability | 導師 | 科任 | 管理者（workspace） | 投影 | 無 membership |
|---|---|---|---|---|---|---|
| `workspaces`、`classes`、`terms`（基本資訊） | 該班任一有效 class membership；管理用 `class.manage` | R（自己的班級） | R（同左） | R、W-API | R（同左） | — |
| `calendars` | 同工作空間任一有效 class membership；管理用 `calendar.manage` | R | R | R、W-API | — | — |
| `memberships` | 自己的：無需額外 capability；他人的：`membership.manage` | R-API（只限自己的） | R-API（只限自己的） | R-API、W-API | — | — |
| `sensitiveGrants` | 自己的：無需額外 capability；授予：見 D-06 | R-API（只限自己的） | R-API（只限自己的） | R-API；授予為 W-API*（見 D-06） | — | — |
| `accessIndex` | 只限自己的（`authUid` 相符） | 依 D-02 | 同左 | — | 同左 | — |
| `operationReceipts` | 只限自己的收據（`principalId` 相符） | R-API | R-API | — | — | — |
| `events` | 無（只供衍生工作） | — | — | — | — | — |
| `auditLog` | `audit.read` | — | — | R-API | — | — |

## 4. 伺服器端

| 主體 | 可寫入 | 限制 |
|---|---|---|
| 受控 API | current、Revision、Receipt、Event、AuditLog、membership、grant、accessIndex | 每個請求都必須完成授權文件 §6 的全部步驟；Admin 權限不等於授權通過 |
| 衍生工作（event 消費者） | `trackingIssues`、`views`、`stats`、`receipts.derivedStatus` | 只讀事件與正式來源；冪等（同一事件重送不產生重複事項）；不寫正式 current |
| Client SDK | 無 | 一律拒絕 |

## 5. 與 Stage 1 fixtures principals 的對照

| Fixture principal | Stage 1 capabilities | S2 對應 |
|---|---|---|
| `ACTOR-TEACHER`（WS-A17） | `attendance.read`、`attendance.write`、`leave.applicability.read` | `CLASS-606-A17` 的 class membership；上述 3 項加上 `roster.read`（提案，用於讀名單） |
| `ACTOR-SC01-TEACHER`（WS-SC01） | `attendance.read`、`attendance.revise`、`leave.read`、`leave.revise`、`issue.read` | `CLASS-606-SC01` 的 class membership；**沒有** `leave.sensitive.read`（POC-003） |
| `ACTOR-OTHER`（WS-FOREIGN） | 無 | 不建立 membership；所有請求 → `FORBIDDEN`（POC-002） |

這裡只描述 Stage 2 載入 fixtures 時的對應方式，**fixtures 檔案本身不修改**。`roster.read` 是否要加入是審查重點：如果不加，`ACTOR-TEACHER` 在 Stage 1 的 capability 下就讀不到名單，POC-001 無法執行（見 D-09）。
