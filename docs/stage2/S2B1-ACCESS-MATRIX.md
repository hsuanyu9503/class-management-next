# S2-B1｜存取授權矩陣 v0.3（草案）

> **狀態：設計文件，未實作，未驗證。** 矩陣描述預期的授權結果，不是任何後端的測試結果。
> v0.2：回應 PR #3 審查 R1（分支 C／W、fixture 能力清單不擴權、敏感 grant、D-05 與所有待決事項的預設拒絕）。
> v0.3：回應 PR #3 審查 R2（稽核分層、科任 `attendance.write` 不可手動加入、Auth Binding）。
> 相關文件：[資料模型](S2B1-DATA-MODEL.md)｜[授權](S2B1-AUTHORIZATION.md)｜[契約對照](S2B1-CONTRACT-TRACEABILITY.md)

## 1. 如何閱讀

- 「所需 capability」是判斷依據；角色欄位是套用 Role Preset 後的**預設**結果（授權文件 §5）。實際判斷只看 membership 上的 capability，不看角色名稱。
- 標為「未啟用」的 capability（授權文件 §4）在 D-09 核准前一律視為未授予。下表以 **`(D-09)`** 標示這種「preset 中有、但目前不生效」的格。
- 班級資料的權限只適用於「該 principal 有有效 class membership 的那一個 `classId`」。對其他班級一律是 `—`。

| 記號 | 意義 |
|---|---|
| `R` | 可讀（D-01 決定前，一律經受控 API） |
| `R*` | 需要對應的 sensitive grant（授權文件 §7）；預設**沒有** |
| `W` | 只能經受控 API 寫入（含授權文件 §6.5、§8 的全部檢查） |
| `W*` | 經受控 API，且需要額外的明確授權（grant 或 `archive.revise`）；預設**沒有** |
| `—` | 拒絕：回 `FORBIDDEN`，不回傳可識別欄位 |
| `停用` | 對應的待決事項決定前，API 不提供這個操作 |
| `(D-09)` | preset 包含此 capability，但它尚未啟用，目前等同 `—` |

**Client SDK 直接寫入：所有角色、所有集合都是 `—`。**（決策 C）
**Client SDK 直接讀取：D-01 決定前，所有角色、所有集合都是 `—`；以下的 `R` 都是經受控 API。**

## 2. 分支 C｜班級資料

| 集合／資料 | 所需 capability | 導師 | 科任 | 管理者（只有 workspace membership） | 投影 | 無 membership／其他工作空間 |
|---|---|---|---|---|---|---|
| `attendanceSessions`（含 `rosterSnapshot`，無姓名）、`entries` | `attendance.read` | R | R | — | — | — |
| 班級名單（含 `displayName`，經 API 組合 `students`＋`enrollments`） | `roster.read` | R (D-09) | R (D-09) | — | — | — |
| 建立場次、登記點名 | `attendance.write` | W | —（D-05 預設拒絕；不能手動加入，N-33） | — | — | — |
| 更正已提交的點名 | `attendance.revise` | W | — | — | — | — |
| `entries/*/revisions` | `attendance.revise` | R | — | — | — | — |
| `leaveRecords`（摘要，讀） | `leave.read` | R | — | — | — | — |
| `leaveRecords`（修改） | `leave.revise` | W | — | — | — | — |
| `leaveRecords/*/revisions` | `leave.revise` | R | — | — | — | — |
| 請假適用提示（`leave-applicability` View） | `leave.applicability.read` | R | R | — | — | — |
| `leaveSensitiveNotes`＋其 revisions（讀） | `leave.sensitive.read`＋read grant | R*（預設無；D-06 前停用） | R*（同左） | — | — | — |
| `leaveSensitiveNotes`（修改） | `leave.sensitive.revise`＋revise grant | W*（預設無；D-06 前停用） | — | — | — | — |
| `trackingIssues` | `issue.read` | R | — | — | — | — |
| `views`（`roster-display`） | `roster.read` | R (D-09) | R (D-09) | — | — | — |
| `views`（`attendance-summary`） | `attendance.read` | R | R | — | — | — |
| `views`（`projection`，去識別） | `projection.read` 或 `attendance.read` | R | R | — | R (D-09) | — |
| `stats`（該班） | `stats.read` | R (D-09) | — | — | — | — |
| 匯出 | `export.basic` | 停用（D-08） | 停用 | — | — | — |
| 已封存學期的正式資料修改 | 對應的 `*.revise`＋`archive.revise` | W*（預設無） | — | — | — | — |
| 自己的收據（查詢恢復） | 無；`principalId` 相符＋對 `classId` 仍有有效 class membership | R | R | — | R | — |

管理者如果需要讀取某班資料，必須**由另一位有 `membership.manage` 的人**替他建立該班的 class membership；管理者不能自己建立（授權文件 §6.3 步驟 8）。

## 3. 分支 W｜工作空間管理

| 集合／操作 | 所需 capability | 導師 | 科任 | 管理者（workspace） | 投影 | 無 membership |
|---|---|---|---|---|---|---|
| `classes`、`terms`（讀基本資訊） | 該班任一有效 class membership；或 `class.manage` | R（自己的班級） | R（同左） | R (D-09) | R（同左） | — |
| `classes`、`terms`（管理） | `class.manage` | — | — | W (D-09) | — | — |
| `calendars`（讀） | 同工作空間任一有效 class membership；或 `calendar.manage` | R | R | R (D-09) | — | — |
| `calendars`（管理） | `calendar.manage` | — | — | W (D-09) | — | — |
| `memberships`（自己的，讀） | 無 | R | R | R | R | — |
| `memberships`（他人的，讀／管理） | `membership.manage`；capability 只能是 preset 預設值的子集，`rolePreset` 不可修改（I-21） | — | — | R、W (D-09)；**不含自己** | — | — |
| `sensitiveGrants`（自己的，讀） | 無 | R | R | R | R | — |
| `sensitiveGrants`（建立／撤銷他人的） | `sensitive.grant.manage` | — | — | 停用（D-06；且不在 preset 中） | — | — |
| `auditSummaries`（管理稽核摘要，白名單動作與欄位） | `audit.read`，只限同一工作空間 | — | — | R (D-09) | — | — |
| `auditLog`（完整安全稽核） | 無（沒有任何 API 可讀；D-11） | — | — | — | — | — |
| `authBindings`（他人的） | 無（D-13 前不提供 API） | — | — | — | — | — |
| `operationReceipts`（他人的） | 無任何 capability 可讀 | — | — | — | — | — |
| `derivedProgress`、`events` | 無（只供伺服器） | — | — | — | — | — |
| `accessIndex` | 無（D-02 前不建立） | — | — | — | — | — |

**所有角色的前提**：Auth Binding `active` 且 token 簽發時間不早於 `activatedAt`、Principal `active`、Membership 有效，三者各自檢查（I-19）。任一不成立，上面所有格都變成 `—`。

## 4. 伺服器端

| 主體 | 可寫入 | 限制 |
|---|---|---|
| 受控 API | current、Revision、Receipt、Event、`derivedProgress`（建立）、`auditLog`、`auditSummaries`、membership、grant | 每個請求都必須完成授權文件 §6 的全部步驟；Admin 權限不等於授權通過 |
| 衍生工作（事件消費者） | `trackingIssues`、`views`、`stats`、`derivedProgress`（更新） | 只讀事件與正式來源；冪等；**不寫正式 current，也不修改收據** |
| Client SDK | 無 | 一律拒絕 |

## 5. Stage 1 fixtures principals 的對應（REV-003）

**規則：Stage 2 載入 fixtures 時，每個 principal 的 capability 與 Stage 1 `fixtures/canonical-fixtures-v1.0.json` 完全相同，不增不減，也不套用任何 Role Preset。** Fixtures 檔案本身不修改。

| Fixture principal | Stage 1 capabilities（原樣使用） | S2 membership | 說明 |
|---|---|---|---|
| `ACTOR-TEACHER`（WS-A17） | `attendance.read`、`attendance.write`、`leave.applicability.read` | `CLASS-606-A17`，`scopeType = class` | POC-001 的 15 筆以 `attendance.read` 讀取 `AS-A17-20261117-DAILY` 的 `rosterSnapshot`／`entries` 取得，**不需要** `roster.read` |
| `ACTOR-SC01-TEACHER`（WS-SC01） | `attendance.read`、`attendance.revise`、`leave.read`、`leave.revise`、`issue.read` | `CLASS-606-SC01`，`scopeType = class` | 沒有 `leave.sensitive.*`、沒有 grant（POC-003） |
| `ACTOR-OTHER`（WS-FOREIGN） | 無 | 不建立 | 所有請求 → `FORBIDDEN`（POC-002） |

- Membership 期間：`validFrom` 為資料集日期，`validToExclusive` 為 `null`。授權檢查以「現在」判斷有效期間（授權文件 §6.2 步驟 5），測試在資料集日期之後執行，所以不能把終點設在資料集次日。這是隔離測試環境的載入設定，不是業務規則；驗證過期行為的案例（例如 N-07、N-08）應另外建立有終點的 membership 或 grant。
- `roster.read` 等「未啟用」的提案 capability 只用於日後的正式 preset，**不加進任何 fixture principal**。如果 Stage 2 的某個案例只有加入新 capability 才能執行，必須先提出並經審查，不得在測試載入時默默加上。
