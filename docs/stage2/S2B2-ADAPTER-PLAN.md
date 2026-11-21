# S2-B2｜Firebase Adapter 對接計畫與後續批次 v0.1（草案）

> **狀態：計畫，未實作。** 本批沒有 Firebase Adapter、受控 API、產品 Security Rules，也沒有執行任何 Stage 1 契約案例。

## 1. 與既有 Stage 1 執行器的介面

Stage 1 的 `poc/stage1/src/runner.mjs` 已規定 Adapter 介面，不修改：

```text
adapter = { mode: 'BACKEND_REAL', backend: 'firebase', execute(caseSpec, fixtures) → { canonical, evidence } }
executeCase(caseSpec, adapter, fixtures) → { status: 'PENDING_ATTESTATION' | 'FAIL', attested: false, ... }
```

- Stage 1 對 `BACKEND_REAL` 最多只回 `PENDING_ATTESTATION`。這是刻意的防護，Stage 2 **不修改**它。
- Stage 2 在 Stage 1 之外加一層：
  - **Runner** 呼叫 `executeCase()`；
  - 依 `S2B2-ATTESTATION.md` 由 Observer 從 Emulator 實際狀態另外算出 canonical；
  - 由 Verifier 決定是否 `PASS`。
- Adapter 回傳的 `canonical` 只作為「Adapter 宣稱」記錄；Adapter 回傳的 `evidence` 必須能對應到 Runner 的 trace。
- S2-B2 #2 的 Observer 雛形與 trace 代理在本機執行，**沒有** `S2B2-ATTESTATION.md` §9 的隔離，所以結果最多 `UNATTESTED`。

## 2. Firebase Adapter 的組成（後續批次實作）

| 模組 | 職責 | 依據 |
|---|---|---|
| 載入器 | 把鎖定的 fixtures 依 S2-B1 資料模型載入 Emulator（本批的 `src/seed.mjs` 是最小版本） | 資料模型 §2、§4、§6 |
| 本機受控 API | 依授權文件 §6 執行全部授權步驟；以 Admin 權限存取 Emulator；所有正式寫入只經這裡（決策 C） | 授權 §6、§8 |
| 案例驅動 | 依 `caseSpec` 以指定 principal 的身分呼叫受控 API | Stage 1 `canonical-oracles` |
| Observer | 每案從匯出狀態與 trace 算 canonical（與 Adapter 分開） | 認證設計 §4 |

D-01 決定前，讀取一律經受控 API（授權 §9），所以即使是唯讀案例也需要本機受控 API。產品 Security Rules 維持本批的「拒絕一切」，直到 D-01／D-02 決定。

## 3. 第一批正式契約案例的選擇

原則：

- P0 優先（`test-order-v1.0.json`）；
- 不依賴任何待決事項的核准；
- 不需要寫入交易；
- 能從 Emulator 狀態獨立重算 canonical。

| 候選 | P | 為何適合第一批 | 待決依賴 |
|---|---|---|---|
| POC-001 | P0 | 唯讀；`ACTOR-TEACHER` 以 Stage 1 原有的 `attendance.read` 讀 15 筆 | 無（D-01 預設「經 API」即可） |
| POC-002 | P0 | 唯讀；`ACTOR-OTHER` 沒有 membership，應 `FORBIDDEN` | 無 |
| POC-008 | P0 | 唯讀；計數可由匯出的 `entries` 重算（本批冒煙已示範資料流） | 無 |
| POC-009 | P0 | 唯讀；請假涵蓋與點名不自動改寫 | 無 |

暫不選：

- **POC-003、POC-029**（敏感資料拒絕）：需要 C-sens 路徑的受控 API。只測拒絕即可，不需要 D-06／D-15。可放第二批。
- **POC-016～021**（寫入交易、冪等、回滾）：需要完整的受控寫入 API 與交易。另立批次。
- **POC-019 的 actor 變體**：受 D-10 阻擋。

## 4. 後續小批 PR 分工（建議）

| 批次 | 內容 | 風險等級建議 | 進入條件 |
|---|---|---|---|
| S2-B2 #1（本批） | Emulator 基礎設施冒煙、本機 guard、認證設計、對接計畫 | L2（新增可執行測試基礎設施；信任邊界設計採 L3 深度審查） | — |
| S2-B2 #2 | 本機受控**讀取** API（授權 §6.1–6.4，分支 C）、trace 記錄代理、狀態匯出、Observer 雛形；POC-001、002、008、009 在 Emulator 執行，結果最多 `UNATTESTED` | L3 | 本批審查通過 |
| S2-B2 #3 | 受控執行器 workflow 與信任根（D-17）、Verifier；`S2B2-ATTESTATION.md` §9 的隔離（固定受信任元件版本、Adapter 網路／檔案／程序隔離、獨立的驗證與簽章環境）；§10 攻擊驗收情境全部通過後，才可能第一次產生可認證的結果 | L3 | D-17 決定；CI 變更的錨定重新核准 |
| S2-B2 #4 | 受控**寫入** API（§6.5、§8：`operationId`、`requestHash`、`expectedVersion`、交易）；POC-016～021 | L3 | #2 審查通過 |
| S2-B2 #5 | C-sens 拒絕路徑（POC-003、029）與其餘 SEC／DOMAIN 案例 | L3 | #2、#4 |
| 之後 | SYNC、OFFLINE（伺服器端）、DR 的 S2 部分 | 依內容 | 逐批 |

每一批都：

- 不修改 Stage 1 鎖定檔案；
- 不把 Emulator 結果寫回 Stage 1 的 72 筆計畫；
- 認證結果另存在 Stage 2 的位置。

## 5. 本批刻意不做的事

- 不實作受控 API、Adapter、Observer、Verifier 或 trace 代理。
- 不撰寫產品 Security Rules：本批只有「拒絕一切」的佔位規則。
- 不執行任何 POC 案例；本批冒煙中讀回 15 筆、P9／R1／N1／U4 的步驟只是**資料流的基礎設施檢查**，不是 POC-008 的結果。
- 不修改 CI。原因見 `S2B2-B1-PLAN.md` §6。
