# S2-B1｜授權規格 v0.1（草案）

> **狀態：設計文件，未實作。** 本文件不含 Security Rules 或程式；授權行為尚未在任何後端驗證，相關案例維持 `NOT_RUN`。
> 相關文件：[資料模型](S2B1-DATA-MODEL.md)｜[存取矩陣](S2B1-ACCESS-MATRIX.md)｜[契約對照](S2B1-CONTRACT-TRACEABILITY.md)

## 1. 名詞

| 名詞 | 定義 |
|---|---|
| **Authentication UID**（`authUid`） | Firebase Authentication 驗證後的使用者 ID。只證明「是誰登入」，**本身不帶任何資料權限**。 |
| **Principal**（`principalId`） | 系統內的人員主體。`authUid` 必須經 `authBindings` 綁定到一個 `status = active` 的 principal。 |
| **Membership** | Principal 在某工作空間、某班級（或工作空間管理範圍）的授權紀錄，含 capability 清單與有效期間。 |
| **Capability** | 最小授權單位，例如 `attendance.read`。**所有授權判斷只看 capability。** |
| **Role Preset** | 建立 membership 時用來帶入預設 capability 的範本（導師、科任、管理者、投影）。**角色名稱不參與授權判斷。** |
| **Scope** | 授權的作用範圍：`workspaceId`＋`classId`＋有效期間＋學期狀態。 |

## 2. 決策 A｜班級精確授權

1. 一個工作空間可以管理多個班級。
2. 資料存取的 membership 必須是 `scopeType = class`，並且**只對應一個 `classId`**。要存取兩個班級，就需要兩筆 membership。
3. 同一工作空間的身分（包括工作空間管理者）**不代表可以讀取全部班級**。`scopeType = workspace` 的 membership 只授予工作空間管理能力（例如管理成員、班級、日曆、讀取稽核），**不授予任何學生、點名或請假資料的讀取權**。
4. 沒有萬用字元班級（例如 `classId = "*"`）。

## 3. 決策 B｜敏感請假資訊

1. 請假摘要（`leaveRecords`）和敏感備註（`leaveSensitiveNotes`）分開保存（見資料模型 §3.6）。
2. 讀取敏感備註需要 capability `leave.sensitive.read`。**任何 Role Preset 都不包含這個 capability**；導師、科任、管理者都不能只憑角色取得。
3. 授予 `leave.sensitive.read` 必須另外建立 `sensitiveGrants` 紀錄（授權者、原因代碼、到期時間），並在 membership 的 `sensitiveGrantIds` 參照。沒有有效 grant 時，即使 membership 寫了這個 capability 也視為無效。
4. 敏感文字不得流入一般展示 View、投影、統計、事件、收據、稽核或未授權的匯出。匯出時由伺服器在資料來源端裁剪（POC-029），不是先送出再由前端隱藏。

## 4. Capability 清單

「來源」欄：**Stage 1** 表示 fixtures 已使用這個名稱；**提案** 表示 S2-B1 新增，待審查。

| Capability | 允許的操作 | 授權範圍 | 來源 |
|---|---|---|---|
| `roster.read` | 經 API 取得班級在某日的有效名單（studentId、enrollmentId、seatNo、displayName）；讀取 `roster-display` View | class | 提案 |
| `attendance.read` | 讀取該班點名場次與正式點名 | class | Stage 1 |
| `attendance.write` | 經 API 建立當日點名、登記狀態 | class | Stage 1 |
| `attendance.revise` | 經 API 更正已提交的正式點名；讀取點名修訂紀錄 | class | Stage 1 |
| `leave.applicability.read` | 讀取請假「適用提示」（是否涵蓋、待核對節次），不含假別細節與理由 | class | Stage 1 |
| `leave.read` | 讀取請假摘要（含假別與涵蓋區段），**不含**敏感備註 | class | Stage 1 |
| `leave.revise` | 經 API 修改請假摘要；讀取請假摘要修訂紀錄 | class | Stage 1 |
| `leave.sensitive.read` | 讀取敏感備註；**必須搭配有效的 `sensitiveGrants`** | class | 提案 |
| `leave.sensitive.revise` | 經 API 修改敏感備註；同樣需要 `sensitiveGrants` | class | 提案 |
| `issue.read` | 讀取核對事項 | class | Stage 1 |
| `stats.read` | 讀取該班統計快照 | class | 提案 |
| `projection.read` | 只讀取去識別的投影 View（有 `attendance.read` 者也可讀投影 View） | class | 提案 |
| `export.basic` | 經 API 匯出去敏欄位 | class | 提案 |
| `archive.revise` | 經 API 修改已封存學期的正式資料（例外權限） | class | 提案 |
| `membership.manage` | 經 API 管理成員與 capability（不含授予 `leave.sensitive.*`，見 D-06） | workspace | 提案 |
| `class.manage`、`calendar.manage` | 經 API 管理班級、學期、日曆 | workspace | 提案 |
| `audit.read` | 讀取稽核紀錄（不含敏感文字） | workspace | 提案 |

## 5. Role Preset（預設範本，僅供建立 membership）

| Preset | 預設 capability | 不包含 |
|---|---|---|
| 導師 `homeroom_teacher`（class） | `roster.read`、`attendance.read`、`attendance.write`、`attendance.revise`、`leave.read`、`leave.revise`、`leave.applicability.read`、`issue.read`、`stats.read`、`export.basic` | `leave.sensitive.*`、`archive.revise` |
| 科任 `subject_teacher`（class） | `roster.read`、`attendance.read`、`attendance.write`（節次，見 D-05）、`leave.applicability.read` | `leave.read`、`leave.sensitive.*`、`attendance.revise` |
| 管理者 `workspace_admin`（workspace） | `membership.manage`、`class.manage`、`calendar.manage`、`audit.read` | **任何班級資料讀取**；如需讀取，另建 class membership |
| 投影 `projection_display`（class） | `projection.read` | 其他全部 |

套用 preset 後，capability 會展開保存在 membership；之後修改 preset 定義**不會**回溯改變既有 membership。

## 6. 授權流程

所有正式寫入都經受控 API；讀取路徑見 §7。受控 API 以 Admin 權限存取 Firestore（會繞過 Security Rules），因此**API 必須自行完整執行下列步驟**，不得因為「呼叫來自伺服器」而跳過（POC-005、POC-035）。

1. **驗證身分**：驗證 Firebase ID token，取得 `authUid`。驗證失敗 → `FORBIDDEN`。
2. **解析 Principal**：查 `authBindings/{authUid}` → `principalId`，且 principal `status = active`。否則 → `FORBIDDEN`。
3. **決定 Scope**：請求帶 `workspaceId`、`classId`、目標 ID。伺服器讀取目標文件，**以文件內的 `workspaceId`／`classId` 為準**；與請求不一致 → `FORBIDDEN`（防止偽造 scope）。
4. **找有效 Membership**：`workspaceId` 相同、`principalId` 相同、`scopeType = class` 且 `classId` 相同、`status = active`、`validFrom ≤ 現在 < validToExclusive`。可以有多筆；有效 capability 為多筆的聯集。沒有 → `FORBIDDEN`。
5. **檢查 Capability**：操作所需的 capability 必須在有效集合中。
   - 敏感資料另外檢查：membership 的 `sensitiveGrantIds` 對應的 `sensitiveGrants` 有效且未過期。
   - 已封存學期的寫入另外需要 `archive.revise`。
6. **寫入檢查**（只有寫入命令）：
   - 必填 `operationId`、`expectedVersion`。
   - 計算 `requestHash`；如果 `operationReceipts/{operationId}` 已存在：hash 相同 → 回傳原收據，不再執行；hash 不同 → `OPERATION_REUSE_MISMATCH`，不回傳原收據內容。
   - 在同一交易內讀 current：`version ≠ expectedVersion` → `VERSION_CONFLICT`，不寫入。
   - 同一交易內寫入 current（version +1）、Revision、Receipt、Event；任一失敗則整筆回滾。
7. **回應**：拒絕時一律回 `FORBIDDEN`，**不回傳可識別欄位**，也**不區分「資料不存在」和「沒有權限」**，避免讓人推知其他班級資料是否存在（POC-002）。
8. **稽核**：允許與拒絕都寫入 `auditLog`（含 `policyVersion`、`traceId`、`reasonCode`；不含敏感文字）。

錯誤代碼沿用 `poc/stage1/docs/證據格式與安全記錄契約.md`：`FORBIDDEN`、`VERSION_CONFLICT`、`OPERATION_REUSE_MISMATCH`、`LOCAL_SAVE_FAILED`、`DERIVED_PENDING`、`UNAVAILABLE`。

## 7. 讀取路徑（D-01 待決）

決策 C 只規定寫入。讀取有兩種候選，S2-B1 **要求兩者執行與 §6 步驟 1–5、7 相同的判斷**：

- **(a) 全部經受控 API 讀取**：授權邏輯只有一份，最容易驗證；代價是延遲與 API 成本。
- **(b) 部分集合允許 client 直接讀 Firestore，由 Security Rules 判斷**：Rules 需要以 `request.auth.uid` 查授權。建議查 `accessIndex/{authUid}__{cid}`（伺服器衍生）而不是 custom claims，以避免 token 大小上限與撤銷延遲（D-02）。

不論選哪一種：`students`、`enrollments`、`authBindings`、`memberships`、`sensitiveGrants`、`operationReceipts`、`events`、`auditLog` **都不開放 client 直接讀取**；名單、收據、稽核一律經 API。

## 8. 其他規則

- **撤銷**：membership 被撤銷或過期後，下一次請求即失效；衍生的 `accessIndex` 必須在同一個 API 交易內更新或刪除。
- **收據隔離**：收據只回給原 principal；其他 principal 用同一 `operationId` 查詢 → `FORBIDDEN`（POC-019）。
- **共用裝置切換帳號**：登出或切換 principal 時，裝置必須清除上一位 principal 的本機快取與 outbox，或明確提示有未同步資料（POC-027；裝置端規格屬於 Stage 4）。
- **高權限憑證**：Admin／service account 憑證只存在伺服器端，不放進 client、Git 或證據檔案。

## 9. 待決事項

| ID | 問題 | S2-B1 暫定 |
|---|---|---|
| D-01 | 讀取路徑：全部經 API，或部分由 Security Rules 直接讀 | 未決；兩者都必須符合 §6 |
| D-02 | Rules 的授權來源：`accessIndex` 或 custom claims | 建議 `accessIndex` |
| D-03 | 是否需要伺服器端草稿集合 | 不定義；草稿只在裝置本機 |
| D-04 | 管理者是否需要不經 class membership 的唯讀總覽 | 不允許；需另建 class membership |
| D-05 | 科任的點名範圍是否要限制到節次（period）而不只是班級 | 未決；目前只限到班級 |
| D-06 | 誰可以授予 `leave.sensitive.*`（是否需要兩人核准） | 未決；`membership.manage` 不自動包含 |
| D-07 | 收據與稽核的保存期限 | 未決 |
| D-08 | `export.basic` 的欄位白名單 | 未決；一定不含敏感文字；是否包含 `hasSensitiveNote` 這個布林值也待決 |
| D-09 | 新增 capability 名稱（標「提案」者）是否採用 | 待審查 |
