# S2-B1｜與 Stage 1 契約的對照 v0.3（草案）

> **狀態：設計對照，未驗證。** 下表說明 S2-B1 的資料模型與授權設計，打算如何支援 Stage 1 的 36 項契約。它**不是**測試結果：36 項在 Firebase 與 PostgreSQL 都維持 `NOT_RUN`，沒有任何一項標為 PASS。
> 契約來源（鎖定、不修改）：`poc/stage1/contracts/poc-test-matrix-v1.0.csv`（SHA-256 `4e42d9bb…ddad3`）；P0 預期另由 `poc/stage1/src/contract-guard.mjs` 的 `P0_PINNED` 固定。
> v0.2：回應 PR #3 審查 R1；更新 POC-001、003、016、018、019、021、029、036 列，新增 D-10。
> v0.3：回應 R2；所有 SEC 類案例另外受 Auth Binding 檢查約束（授權 §6.1 步驟 2、I-19）；POC-004、POC-005 的稽核改為寫入 `auditLog`（不開放讀取）與 `auditSummaries`（不含班級資料事件）。
> 相關文件：[資料模型](S2B1-DATA-MODEL.md)｜[授權](S2B1-AUTHORIZATION.md)｜[存取矩陣](S2B1-ACCESS-MATRIX.md)

## 1. 適用階段的定義

依 `poc/stage1/docs/PoC-階段順序與放行門檻.md`：

| 代號 | 階段 | 本表中的意思 |
|---|---|---|
| **S2** | Stage 2：Firebase Authentication＋Firestore＋受控寫入，在隔離的 Emulator／測試環境執行 | 可以在 Stage 2 取得完整證據 |
| **S2 部分** | 同上，但只能驗證伺服器端的行為 | 裝置端或真實環境的部分要到 Stage 4 |
| **S3** | Stage 3：PostgreSQL＋授權／RLS＋交易式提交 | **全部 36 項**都要以相同預期在 S3 重跑，下表不再逐列重複 |
| **S4** | Stage 4：真實 iPad、斷網、切換帳號、雲端費用與還原 | 需要真實裝置或正式測試環境 |

## 2. 對照表

| ID | P | 組 | 契約預期（CSV 原文摘要） | S2-B1 設計對應 | 適用階段 | 未驗證事項 |
|---|---|---|---|---|---|---|
| POC-001 | P0 | SEC | 15筆且僅 WS-A17 | 分支 C（授權 §6.2）；I-01；以 Stage 1 原有的 `attendance.read` 讀取 `AS-A17-20261117-DAILY` 的 `rosterSnapshot`／`entries`（不新增 capability，存取矩陣 §5） | S2 | 回應只含該班 15 筆，且無其他工作空間資料 |
| POC-002 | P0 | SEC | FORBIDDEN／無可識別 payload | 授權 §6.1 步驟 2、§6.2 步驟 5、§6.6（不區分不存在與無權限）；`ACTOR-OTHER` 無 membership | S2 | 拒絕回應與錯誤訊息確實不含可識別欄位 |
| POC-003 | P0 | SEC | 僅可授權的適用提示／假別（依 scope） | 決策 B；`leaveRecords` 與 `leaveSensitiveNotes` 分離；摘要不含 `hasSensitiveNote`；`leave.sensitive.*` 不在任何 preset，且 D-06 前沒有有效 grant（授權 §7） | S2 | 查詢回應沒有 `reasonNote`，也沒有能推知敏感備註存在的欄位（N-22）；`policyVersion` 如何記錄 |
| POC-004 | P0 | SEC | FORBIDDEN／去識別 | 投影 preset 只有 `projection.read`；`projection` View 去識別；拒絕寫入 `auditLog` | S2 | 底層查詢確實沒有先取得個資 |
| POC-005 | P0 | SEC | 拒絕不匹配 actor 身份及班級 | 授權 §6.1 步驟 3（以伺服器讀到的文件判斷 scope；N-18）；I-02 | S2 | 受控 API 在 Admin 權限下仍執行完整檢查 |
| POC-006 | P1 | DOMAIN | 15人對應有效識別 | `students`／`enrollments` 分離；I-03 | S2 | 以 studentId＋enrollmentId 查當日名單 |
| POC-007 | P1 | DOMAIN | 保留當時有效名單與座號 | `attendanceSessions.rosterSnapshot`；在籍以結束舊紀錄、建立新紀錄表示 | S2 | 歷史快照不會因在籍變動而改寫 |
| POC-008 | P0 | DOMAIN | P9 R1 N1 U4；T15，已登記11，到校10 | `entries.status`；I-05 | S2 | 由 Firestore 實際資料重算計數 |
| POC-009 | P0 | DOMAIN | 部分適用，下午5–7待核對 | `coverageSegments`；I-06；`leave-applicability` View | S2 | 適用判斷不改寫點名、不延長假單 |
| POC-010 | P1 | DOMAIN | 最多預覽4且排除需個別核對者 | 批次預覽由 API 回傳、不提交；提交需 `attendance.write`＋明確確認 | S2 | 預覽 API 的排除規則；「需個別核對」的判定來源 |
| POC-011 | P1 | DOMAIN | UNKNOWN／暫不計算 | `calendars.trustState`；`stats.rateState`；I-14 | S2 | 不推定 21 天或 147 節分母 |
| POC-012 | P1 | DOMAIN | 識別隔離且不可作正式率 | `stats.illustrativeOnly`；I-16 | S2 | 示例統計與 M04 待定資料不共用 |
| POC-013 | P1 | DOMAIN | daily=部分；上午=完全；下午=不適用 | `coverageSegments.dayPart`／`periodRefs` | S2 | 節次比對規則 |
| POC-014 | P1 | DOMAIN | 可能適用／資料待確認 | `calendars.trustState = unknown` | S2 | 不以推測課表判定完全適用 |
| POC-015 | P0 | DOMAIN | 正式仍 v5；issue evidence 不過期 | I-12：草稿只在裝置本機，不進 Firestore | S2 部分 | 伺服器端：草稿不產生 Revision；裝置端草稿保存屬 S4（D-03） |
| POC-016 | P0 | DOMAIN | v6, revision一次, receipt一次, event一次, Attendance N不變 | I-06、I-07（Revision、Receipt、Event 各**恰好 1 筆**）；授權 §8 第 5 步 | S2 | Firestore 交易實際的原子性；Event 數量為 1（N-17） |
| POC-017 | P0 | TX | 恰一成功，另一 VERSION_CONFLICT | I-08；授權 §8 第 4 步 | S2 | 兩個並行交易在 Emulator 下的實際結果 |
| POC-018 | P0 | TX | 只一次正式改版與一次 revision，100次同一 receipt | `operationReceipts/{operationId}`（工作空間範圍）；canonical `requestHash`（授權 §8）；I-09 | S2 | 100 次重送的收據一致性（N-11） |
| POC-019 | P0 | TX | OPERATION_REUSE_MISMATCH | 授權 §8：`requestHash` 含 principal、payload、target；不同則 `OPERATION_REUSE_MISMATCH`，只回 `{code, operationId}`；I-09 | S2 | payload 與 target 變體（N-12）；actor 變體需要第二個對 SC01 有授權的 principal，fixtures 沒有（D-10）；以 `ACTOR-OTHER` 測試會得到 `FORBIDDEN`（N-14） |
| POC-020 | P0 | TX | 整筆回滾 current／revision／receipt／event | I-07；單一交易 | S2 | 失敗注入的方法（Emulator 是否支援，或以 API 測試掛鉤模擬） |
| POC-021 | P0 | TX | 取得同一正式結果，不二次執行 | 以原 `operationId` 查收據，只限原 principal（授權 §8）；I-09 | S2 | 「回應遺失」的模擬方式；他人查詢為 `FORBIDDEN`（N-15） |
| POC-022 | P1 | SYNC | 原 evidence stale，issue 待重新核對，Attendance N不變 | `trackingIssues.evidenceStale`；I-06、I-13 | S2 | 衍生工作不自動解決事項 |
| POC-023 | P1 | SYNC | 冪等且不重複事項；只依最新來源版本 | `events`＋`trackingIssues.dedupeKey` | S2 | 同一事件重送 10 次的結果 |
| POC-024 | P1 | SYNC | 12件 LeaveRecord；20項 TrackingIssue | `leaveRecords` 與 `trackingIssues` 分開計數；`stats.illustrativeOnly` | S2 | 計數基準 |
| POC-025 | P0 | OFFLINE | 僅草稿／待重驗，不能正式成功 | API 只接受線上、經驗證的命令；I-12 | S2 部分 | 伺服器端：離線草稿不產生正式結果；裝置顯示屬 S4 |
| POC-026 | P0 | OFFLINE | 只有證明 durable 才顯示本機已存；連網驗證後收 receipt | 收據由 API 在提交後產生 | S2 部分 | 伺服器端：重連後的收據；本機 durable 判定屬 S4 |
| POC-027 | P0 | OFFLINE | 不同 principal 無法讀取舊快取／Outbox；原使用者有明確恢復提示 | 授權 §10：切換帳號清除或提示；授權 §8：伺服器端以 principal 隔離收據 | S2 部分 | 伺服器端：他人無法讀取原 principal 的收據；裝置快取隔離屬 S4 |
| POC-028 | P1 | OFFLINE | LOCAL_SAVE_FAILED；不稱本機已可靠保存 | 錯誤代碼沿用 Stage 1 | S4 | 純裝置端行為，S2 無對應伺服器資料 |
| POC-029 | P0 | SEC | 資料源端拒絕或裁剪 | 決策 B；I-11；匯出 API 在 D-08 前停用，白名單不含敏感文字或任何推知敏感備註存在的欄位 | S2 | 投影、追蹤、查詢欄位不含敏感資訊；匯出在 D-08 前只能驗證「停用」 |
| POC-030 | P1 | SEC | 唯讀拒絕，例外需明確額外權限 | `terms.state = archived`；`archive.revise`；I-15 | S2 | 封存學期寫入被拒 |
| POC-031 | P0 | DR | current/revision/receipt/issue 結構一致；可核驗雜湊 | I-10（append-only）；文件以 ID 互相參照 | S2 部分 | Emulator 匯出／匯入只能驗證結構；正式備份還原屬 S4 |
| POC-032 | P1 | DR | 輸出吞吐、p50/p95/p99、讀寫量、月費推估原始證據 | 文件結構決定讀寫次數（例：名單經 API 組合） | S4 | Emulator 只能計算讀寫次數；延遲與費用需真實環境 |
| POC-033 | P1 | OFFLINE | VERSION_CONFLICT，提示保留雲端／草稿修訂 | I-08 | S2 部分 | 伺服器端：舊 `expectedVersion` 被拒；裝置提示屬 S4 |
| POC-034 | P1 | DOMAIN | 起含終不含；日曆與有效在籍逐日核對 | I-04；`enrollments` 期間不重疊 | S2 | 跨學期在籍不猜測目前班級 |
| POC-035 | P0 | SEC | 受控 API/RPC 仍執行明示的 principal+scope 驗證 | 授權 §6 開頭：Admin 權限不等於授權通過 | S2 | Firebase 對應的證據是 API 授權紀錄與 Rules 測試，不是 CSV 寫的 `sqlPolicy`（`sqlPolicy` 屬於 S3） |
| POC-036 | P1 | SYNC | 顯示 stale／derived_pending，重試後去重更新 | `views.projectionStatus`；`derivedProgress.derivedStatus`（收據不變，I-10）；I-13 | S2 | 衍生延遲時查詢回應的狀態（N-16） |

## 3. 統計

| 類別 | P0 | P1 | 合計 |
|---|---|---|---|
| S2 可取得完整證據 | 15 | 13 | 28 |
| S2 部分（其餘在 S4） | 5 | 1 | 6 |
| 只能在 S4 | 0 | 2 | 2 |
| **合計** | **20** | **16** | **36** |

- S2 部分：POC-015（P0）、POC-025（P0）、POC-026（P0）、POC-027（P0）、POC-031（P0）、POC-033（P1）。
- 只能在 S4：POC-028（P1）、POC-032（P1）。POC-032 在 S2 可以先記錄 Emulator 的讀寫次數，但延遲與費用證據只能在 S4 取得。
- 本表由第 2 節逐列的「適用階段」欄計算。

**全部 36 項目前狀態：Firebase `NOT_RUN`、PostgreSQL `NOT_RUN`。** 這份對照表的任何內容都不能當作 PASS 的證據。

## 4. Stage 2 開始前必須解決的事項

1. 授權文件 §12 的 D-01～D-13。決定之前一律採用該表的預設值（拒絕或停用），實作不得自行放寬；§11 中有前置條件的案例，在前置條件核准前只能驗證預設拒絕。
2. 證據認證機制（attestation）：Stage 1 只能把真實後端結果記為 `PENDING_ATTESTATION`，Stage 2 需要先設計受控的驗收層（見 `docs/STAGE2_PREP.md` 第 2 節）。
3. 失敗注入（POC-020）與「回應遺失」（POC-021）在 Emulator 的模擬方式。
4. Stage 1 的 `requiredEvidenceKeys` 中屬於 PostgreSQL 的項目（例如 POC-035 的 `sqlPolicy`），在 Firebase 要用哪一種證據對應。這需要審查後另行決定，**不修改鎖定的 CSV**。
