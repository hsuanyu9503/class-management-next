# PoC Stage 1｜共用測試介面與執行器驗收規格 v1.0

## 1. 不變來源

- 來源：Stage0 `contracts/poc-test-matrix-v1.0.csv`（36件：20 P0＋16 P1）及 `fixtures/canonical-fixtures-v1.0.json`。
- `contracts/source-lock.json` 記錄這兩檔的 SHA-256；Stage1 嚴禁修改原始資料及測試預期原文。
- `test-order-v1.0.json` 固定 SEC → DOMAIN → TX → SYNC → OFFLINE → DR 六群及群內順序。
- `A17-20261117`：15人 P9/R1/N1/U4；`SC01-20261116`：`LV-007 v5` 上午1–4節、出席 `N` 全天、`CR-20261116-001` 核對下午5–7節；兩者不以座號串接。
- `M04-PENDING`：沒有正式應點名分母；`L1-ILLUSTRATIVE`：18天／126節僅供獨立示例。草稿 v6 不更改正式 v5。

## 2. 技術中立 API

**本階段先固定「測試 Adapter 協定」，不是正式產品 API。**

```js
const adapter = {
  backend: 'firebase' | 'postgres',
  mode: 'BACKEND_REAL',
  async execute(caseSpec, isolatedFixtures) {
    // Return observed facts, NOT 'PASS' or hardcoded expected results.
    return {
      canonical: { /* normalized observations */ },
      evidence: { /* requiredEvidenceKeys returned as redacted proof identifiers/metadata */ }
    };
  }
};
const result = await executeCase(caseSpec, adapter, fixtures);
```

`caseSpec` 含原始測試敘述、`expectedResult`、`requiredEvidenceKeys`、來源 fixture ID。 `executeCase` 不接受無實作的 Adapter，拒絕將 `mock` 偽裝成真後端，並以獨立 Oracle 比對欄位（嚴格相等）。任何缺少必要 canonical 值或證據的結果都不能取得 `PASS`。

## 3. 結果與安全語意

- Stage 0 案例狀態：`NOT_RUN`、`PASS`、`FAIL`、`BLOCKED`、`SKIPPED`。
- Stage 1 模擬執行器狀態：**僅 `HARNESS_PASS`／`HARNESS_FAIL`**，不是後端狀態。
- 真實 Adapter 執行的標準化證據必須使用 `src/evidence.mjs` 和既有的 `contracts/evidence-schema-v1.0.json` 進行後續檢查。
- `expectedVersion`、`operationId`、Revision 原子性和可信授權**必須由實際服務及資料來源證明**，不能由 mock、前端顯示或回傳布林值假定。
- `toBackendEvidence` 僅格式化，並不能證明任何真實證據的完整性；在 Stage2/3 必須加入實際服務的交易記錄、權限審計、失敗注入及獨立核對。

## 4. 完成本階段之門檻

| Gate | 驗證方法 | 預期 |
|---|---|---|
| ST1-01 | `stage0:validate` | 21/21 靜態通過 |
| ST1-02 | `stage1:validate` | 36案例皆有機器 Oracle；來源鎖定無異動 |
| ST1-03 | `stage1:self-test` | mock 6案例與負向控制合格；非後端結果 |
| ST1-04 | `stage1:plan` | 36×2=72項全部 NOT_RUN |
| ST1-05 | 安全檢查 | 不讀真實學生資料、不連線雲端、不儲存金鑰 |
| ST1-06 | Starter Kit v1.2 L1 審查 | 後續仍須專案 CI、PR、人工核對 |

以上 ST1-01～05 可在本機完成；ST1-06 尚未執行，**契約正式開發放行仍需 L1 PR 審查**。Stage2 Firebase 和 Stage3 PostgreSQL 均維持 `NOT_RUN`。

## 5. 跨候選比較與兩階段 Gate

Stage2/3 必須使用相同的 `testId`、`fixtureHash`、執行順序、actor、預期結果及版本情境，並保留雲端和本機實驗差異。Stage4 真實 iPad 斷網、容量不足與切帳，及備份還原實測，不可由本機模擬器完全取代。Stage5 ADR 選型必須等待 20 項 P0 證據與成本指標。

**不改動：**M02-04/05 A～H 規格、Sage Journal 封版、原本 Homework-manager、正式班級資料與任何雲端專案。
