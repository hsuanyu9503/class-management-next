# S2-B2 第 3 批（C-1～C-3）階段收尾：剩餘項目分類與下一批提案

> 日期：2026-11-24。狀態：**提案，待負責人確認**。這份文件不關閉任何項目，也不授權開啟 PASS、修改 Settings 或觸發 workflow。
> 依據：`docs/SPEC.md`、`poc/stage1/docs/PoC-階段順序與放行門檻.md`、`docs/stage2/S2B2-B3C-ATTACK-PLAN.md` §5.2 與 §7、HANDOFF、REVIEW_LOG。

## 0. 已完成

| 項目 | 結果 | 紀錄 |
|---|---|---|
| C-1 hosted 攻擊驗收（A10／A14／A4） | 完成 | `S2B2-B3C-REPORT.md` §12 |
| C-1f（A14-1b 標籤、`attest.yml` 可用性診斷） | 完成 | 同上 §13 |
| C-2 第三方驗證與流程 I 的測試簽章（A18） | 本階段驗收完成 | `S2B2-B3C2-REPORT.md` §10 |
| C-3 Environment `s2-attest` | 本階段驗收完成 | `S2B2-B3C3-REPORT.md` §4 |

## 1. 一個規格前提：本 repository 不是正式網站

- `docs/SPEC.md` §1 寫明：本專案是「獨立技術驗證，**不是**正式班級管理網站」。`docs/TECH.md` 也寫「部署／發行：無」「Stage 2／Stage 3 與正式技術選型未開始」。
- `docs/DESIGN.md` 仍是範本，主要頁面、設計 tokens 等都是佔位。
- 所以「網站功能開發」在目前的規格下**不在範圍內**。若要開始，需要負責人先決定範圍（§3）。依 `CLAUDE.md`，規格衝突時由負責人與 ChatGPT 決策，Claude 不自行選擇新需求。
- 下表的分類仍然有用：它說明每一項會不會擋住**任何**後續開發，不論開發是在本 repository 還是另一個 repository 進行。

## 2. 剩餘項目的分類

### 2.1 阻擋網站功能開發

**沒有任何一項技術殘餘項目會阻擋網站功能開發本身。** 唯一的前提是範圍決策：

| 項目 | 依據 | 最小完成條件 |
|---|---|---|
| 網站的範圍與規格 | `SPEC.md` §1（不是正式網站）；`DESIGN.md` 是範本 | 負責人決定：在哪個 repository、做哪些功能；更新或新增 SPEC 與 DESIGN 的頁面規格，經審查 |
| 涉及授權的功能，對應的 D-01～D-16 | `S2B1-AUTHORIZATION.md` §12（決定前預設拒絕） | 只有用到該 capability 的功能才受影響。例如科任點名 D-05、匯出 D-08、敏感請假資訊 D-06 在核准前維持拒絕。其他功能不受影響 |

### 2.2 只阻擋正式 PASS／發布（技術選型）

| 項目 | 依據 | 最小完成條件 |
|---|---|---|
| `PASS_ENABLED=false` | 攻擊計畫 §5.2 流程 I 的門檻；C-1～C-3 已完成 | 另開一個打開 PASS 的 PR，包括：新的工具鏈 commit；正式批准紀錄 `S2B2-TRUST-POLICY.json` 加入 toolchain 與 signing-policy 紀錄；負責人設定兩個 repository variable；新錨定；獨立審查；負責人核准 |
| POC-009 BLOCKED（G-1～G-4 規格缺口） | `S2B2-B2-PLAN.md` §3 | 負責人決定 G-1（授權選項 a／b／c）與 G-4（可信節次日曆）；修訂經審查後重新執行 POC-009 |
| Stage 1 的 72 筆 NOT_RUN（36 案例 × 2 後端） | `SPEC.md` §2；放行門檻 Stage 2～5 | Firebase 與 PostgreSQL 都以同一份測試矩陣實測。Stage 5 的 ADR 需要 P0=20/20 PASS。目前 Stage 2 只有 POC-001／002／008／009 接上 |
| Stage 3（PostgreSQL）、Stage 4（真機／斷網／備份／成本）、Stage 5（ADR） | 放行門檻表 | 依各階段的必要證據；都尚未開始 |

### 2.3 後續追蹤（不阻擋開發，也不阻擋 PASS）

| 項目 | 依據 | 最小完成條件 | 備註 |
|---|---|---|---|
| hosted run 的 artifact 原檔重播：四個正常路徑 run（只有 44971433557 重播過）、run 45088076830 | HANDOFF；REVIEW_LOG | 負責人下載原檔交給審查者，逐項重播 | **artifact 只保存 30 天**，最早的會在 2026-12 中下旬過期；過期後只能保留 job log 層級的證據 |
| B3A-N5（tar 嚴格解析）、B3A-N7（主機來源的信任限制） | B3a 報告；C-1 報告 §12 | N7 的限制是設計上的已知邊界；若要消除，需要另提主機觀測的方案 | 已實作的部分都已合併 |
| R1-N5～N7（`OPERATIONS` 原型鏈查找、非 Bearer `Authorization` 的遮罩、遮罩掃描的範圍） | REVIEW_LOG（延後） | 各自的小 PR 加測試 | 都標為延後 |
| 「main 摘要」 | 多份紀錄中與 N5、N7 並列 | **定義在 Claude 可讀的紀錄中找不到，待確認**；不推測內容 | 與 NOTE-c 同樣處理 |
| NOTE-c、NOTE ①～⑦、審查者探針 X1～X10 | HANDOFF；REVIEW_LOG | 原文或檔案提供後再評估 | 依負責人指示：不推測、不作為阻擋條件 |
| Y5（CLI 解包快取的等價 mutation） | C-2 報告 §7 | 若日後 CLI 支援多個 subject，重新檢視 | — |
| 可用性診斷讀取 log 時沒有位元組上限 | PR #15 審查 | 讀取時加上上限，並補測試 | 輸出本身已有上限 |
| A14-1b「非 BLOCKED」包含 FAIL 的語義說明 | PR #15 審查 | 之後擴充攻擊資料時，依受測的不變條件解釋 | 只影響說明 |
| 審查者環境的 Sigstore 初始化失敗 | PR #17 審查 | 定位原因（TUF 取得或快取權限） | 負責人環境已成功驗證 |
| Environment 的負向阻擋沒有實測 | C-3 計畫 §4 | 不為測試建立弱化的 workflow；維持「設定已核對」 | Environment 不是安全條件 |

## 3. 下一批的提案（**需要負責人決定方向**）

在目前的規格下，Claude 不自行選擇新需求。以下兩個方向列出來供負責人決定，各附使用者看得到的成果與驗收方式。

### 方向 A：在本 PoC 範圍內，擴充 Stage 2 的案例覆蓋（符合現行 SPEC）

- **內容**：在 Firebase emulator 中，把 36 個案例中**還沒接上**的 P0 案例，分批接上同一套 Runner／Observer／Verifier。第一批建議 4～6 個 P0，從 DOMAIN 或 TX 分組挑選，不需要 G-1～G-4 決策的案例。
- **使用者看得到的成果**：每個案例一份本機與 hosted 的結果（最多 `UNATTESTED`），以及更新後的案例對照表：哪些已接上、哪些 BLOCKED、原因是什麼。
- **驗收方式**：
  - 單元測試與 emulator 整合測試；
  - hosted `attest.yml` run 的結果為 `UNATTESTED`；
  - 案例對照表與 Stage 1 的契約一致；
  - 不放寬任何 P0（放行門檻）。
- **不需要**新的基礎設施或 workflow。

### 方向 B：開始網站功能開發（需要先變更範圍）

- **前置**（負責人決定）：
  - 在本 repository 還是另一個 repository 開發（`SPEC.md` 目前排除了本 repository）；
  - 第一個頁面或功能；
  - 後端：技術選型尚未完成（Stage 5），第一批可以先用 mock 或本機資料；
  - 填好 DESIGN 的頁面規格與設計 tokens。
- **候選的第一批**（只是舉例，以負責人的規格為準）：唯讀的「班級點名名冊」頁面，使用 Stage 1 的虛構固定測資。
  - 使用者看得到的成果：手機、平板、桌面三種版面的名冊頁；
  - 驗收方式：DESIGN §7 的視覺驗收清單、鍵盤操作、`prefers-reduced-motion`、三種寬度沒有水平溢出、不使用真實學生資料。
- 正式資料與授權相關的功能，要等相關的 D-xx 決策（§2.1）。

### Claude 的建議

- 若目標仍是技術選型，選**方向 A**：符合現行規格，而且直接推進 Stage 2 → Stage 5 的門檻。
- 若負責人已經決定要開始做網站，選方向 B，並先更新 SPEC 與 DESIGN。PoC 的殘餘項目**不需要**先完成（§2.1）。

## 4. 不變

`PASS_ENABLED=false`、POC-009 BLOCKED、Stage 1 的 72 筆 NOT_RUN。上表的任何一項都不因這份文件而結案。
