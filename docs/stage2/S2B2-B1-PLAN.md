# S2-B2 第 1 批｜計畫、驗收清單與執行紀錄

> 本批範圍：**本機 Emulator 基礎設施與後端證據認證設計**。這是交接時的工作切分；使用者已授權往 Stage 2 繼續，但這**不等於**核准 D-01～D-16、正式雲端專案、付費服務或部署。
> 基準：`main` = `b0f35af9388a2e75b0a141d692d59ecbf5ece446`（PR #3 合併）。

## 1. 與既有 S2-B2 定義的對照

- Repository 中沒有正式的 S2-B2 規格；只有 `docs/HANDOFF.md` 寫著「是否啟動 S2-B2」。
- 先前審查往來曾以「S2-B2 Security Rules 實作」稱呼下一步。本批的範圍與那個說法**不同**：
  - 本批**不**撰寫產品 Security Rules，只有拒絕一切的佔位規則；
  - 本批做的是基礎設施冒煙、guard、認證設計與對接計畫。
- 產品 Security Rules 要等 D-01（讀取路徑）與 D-02（Rules 授權來源）決定後才開始（授權 §9、§12）。
- 本批沒有覆寫任何既定規劃。

## 2. STAGE2_PREP 前置條件對照

| `docs/STAGE2_PREP.md` 項目 | 狀態 | 證據 |
|---|---|---|
| 負責人確認是否啟動 Stage 2 | 已確認：使用者指示「往下一階段繼續」 | 本批交接指示 |
| Stage 1 收尾 PR 已合併，`main` 的 `validate`、`baseline-anchor` 通過 | 已完成：PR #2、PR #3 已合併；`b0f35af` 的 CI [run 44698127108](https://github.com/hsuanyu9503/class-management-next/actions/runs/44698127108) 成功 | HANDOFF |
| GitHub Pages 是否保留 | **未決**；不影響本機 Emulator 工作。本批不更改 Pages 設定 | — |
| `oracle-approval` 是否需要 v1.1 | **未決**；本批不執行契約案例，不受影響 | — |
| §1 本地工具盤點 | 本批完成（§4） | 本文件 §4 |
| §1 Windows 安裝順序 | **未執行**：本執行環境是 Linux | — |
| §1 Emulator 只在本機或 CI | 本批完成：本機 guard 與負向控制（§5） | `poc/stage2/src/local-guard.mjs` |
| §1 CI 能否執行 Emulator | 評估完成，**本批不加入 CI**（§6） | — |
| §2 認證設計 | 本批完成設計 | `S2B2-ATTESTATION.md` |
| §3 Adapter 對接計畫 | 本批完成計畫 | `S2B2-ADAPTER-PLAN.md` |
| §4 沿用 36 項契約、不修改鎖定檔 | 遵守；錨定 digest 未變 | §5 驗證 |
| §5 PostgreSQL 保留為候選、選型 UNDECIDED | 維持 | — |

## 3. D-01～D-16 對本批的影響

| 類別 | 項目 | 說明 |
|---|---|---|
| 本批會碰到，維持預設即可 | D-01（讀取路徑） | 冒煙驗證 client 讀取一律被拒，符合預設「全部經 API」。冒煙載入資料使用 Emulator 專用 owner 權限，不是 client 讀取 |
| 本批會碰到，維持預設即可 | D-13（Auth Binding 管理） | 冒煙只在 Auth Emulator 建立一個虛構帳號；**沒有**建立 `authBindings`。符合「只由隔離測試環境的載入程序建立」 |
| 不受影響，維持預設 | D-02～D-12、D-14～D-16 | 本批沒有 membership、grant、稽核、匯出、草稿或受控 API |
| 之後的批次需要使用者決策 | 見 §7 | 本批不受阻擋 |

## 4. 本機環境（實際紀錄）

| 項目 | 實際值 |
|---|---|
| 作業系統 | Ubuntu 24.04.5 LTS，x86_64（Claude Code 雲端執行環境） |
| Node.js／npm | v22.23.5／10.9.9 |
| Java | OpenJDK 21.0.13（firebase-tools 15.35.0 要求 ≥ 21） |
| firebase-tools | **15.35.0**（精確版本，專案本地安裝於 `poc/stage2/node_modules`；未全域安裝）。選擇 2026-11-04 發布的版本，而非 2 天前的 15.37.0，以避開剛發布的版本 |
| 鎖檔 | `poc/stage2/package-lock.json`，lockfileVersion 3，627 個套件，SHA-256 `f09293df6b87e6474673bf4c65ea86b5055bb50260e3a44b378d95656b1d6c51` |
| Firestore Emulator | `cloud-firestore-emulator-v1.22.0.jar`，MD5 `5d74cc6bee9e18560d2eae2c6440fd13`（與 firebase-tools 內建的預期值相同）；下載自 `storage.googleapis.com`，存放在使用者快取 `~/.cache/firebase/emulators/`，不在 repository 中 |
| Auth Emulator | 內建於 firebase-tools |
| `npm audit` | 14 個 moderate、0 個 high、0 個 critical，都在 firebase-tools 的相依套件中（只用於本機開發）。未執行 `npm audit fix`，以免改變鎖定版本 |

**來源限制**：官方文件網站 `firebase.google.com` 在本執行環境的網路政策下無法連線。所以 Java ≥ 21、`demo-` 專案行為、Emulator 環境變數名稱等需求，都是從**已安裝套件的原始碼**確認（檔案位置見 `poc/stage2/README.md`），**沒有**以官方文件核對。

**可重現指令**：

```bash
cd poc/stage2
npm ci
npm run s2:test          # guard + 非破壞性測試（不需 Emulator）
npm run s2:smoke
npm run s2:occupied-real # 真實 Emulator 已占用時的非破壞性回歸
```

## 5. 執行結果（Claude 在本執行環境實際執行）

### 5.1 S2B2-REV-001 修正後的安全規則

- **前置條件是硬性停止**：任何前置條件失敗（例如 Emulator 連接埠已被占用），總控立刻以 exit 2 結束，不再執行任何負向控制、冒煙或清除。
- **「未啟動」與「斷線」等負向控制只用唯讀探測**（`test/probe.mjs`，只送 GET），不再重用會寫入與清除的冒煙。
- **只清除自己擁有的環境**：冒煙在任何寫入前先證明 Emulator 是空的（Firestore 沒有任何根集合、Auth 沒有帳號）；再寫入本次執行的 nonce 標記 `_smokeOwnership/{RUN_NONCE}`；清除前再確認標記仍然只有自己那一份。任一不符 → 拒絕且不送任何寫入或刪除（`src/ownership.mjs`）。
- **排他性**：每次啟動 Emulator 前與結束後都確認 5 個連接埠（8080、9099、4400、4500、9150）關閉；Emulator 綁定這些固定埠；同時間的另一個執行會在前置檢查停止（firebase-tools 本身的埠衝突行為未另外測試）。
- 冒煙沒有 `RUN_NONCE` 時在任何請求前拒絕。

修正前後的對照（以假 HTTP 伺服器記錄實際請求）：

| 情境 | 修正前（`d6181bb`） | 修正後 |
|---|---|---|
| 8080／9099 已被另一個程序占用 | exit 1，對占用者送出 104 個請求，**包含** `DELETE` documents 與 `DELETE` accounts | exit 2，`PRECONDITION FAILED`，對占用者 **0** 個請求 |
| 冒煙連到已有資料的外來 Emulator | 先 `DELETE` 清空，再 `PATCH` 寫入 | 拒絕，沒有 `DELETE`／`PATCH`／寫入用 `POST` |

### 5.2 測試結果

| 命令 | 內容 | 結果 |
|---|---|---|
| `npm run s2:test` | guard 8 項＋非破壞性 6 項（不需 Emulator） | 14／14 通過 |
| `npm run s2:smoke` | 總控：guard → 唯讀負向 ×4 → 正向冒煙 → 規則放寬負向 → 斷線唯讀負向，每次 Emulator 啟動前後檢查連接埠 | exit 0，12 項檢查全部符合 |
| `npm run s2:occupied-real` | 在**真實** Emulator 內先放入外來文件與帳號，再執行總控 | 總控 exit 2、停在前置條件、沒有執行冒煙或探測；外來文件與帳號**不變** |

`s2:smoke` 的檢查：

| 檢查 | 預期 | 結果 |
|---|---|---|
| guard 單元測試 | 8／8 通過 | 符合 |
| 前置：負向控制前連接埠關閉 | 關閉 | 符合 |
| 負向：Emulator 未啟動 | 唯讀探測失敗（連線被拒） | 符合 |
| 負向：`FIRESTORE_EMULATOR_HOST=firestore.googleapis.com:443` | 在任何請求前被 guard 拒絕 | 符合 |
| 負向：環境中有 `GOOGLE_APPLICATION_CREDENTIALS` | 被 guard 拒絕 | 符合 |
| 負向：沒有 Emulator 設定 | 被 guard 拒絕，不退回雲端 | 符合 |
| 前置：正向冒煙前連接埠關閉 | 關閉 | 符合 |
| **正向：`firebase emulators:exec` 冒煙** | 14 步全部通過 | 符合 |
| 前置：規則放寬負向前連接埠關閉 | 關閉 | 符合 |
| 負向：規則換成 allow-all | 冒煙在 `deny-anonymous-read` 失敗 | 符合 |
| 前置：全部執行後連接埠關閉 | 關閉 | 符合 |
| 負向：Emulator 停止後（斷線） | 唯讀探測失敗 | 符合 |

正向冒煙的 14 步：

1. local guard；
2. Firestore 可連線；
3. Auth 可連線；
4. 證明 Emulator 是空的（擁有權）；
5. 寫入本次 nonce 標記；
6. 載入 47 份虛構文件；
7. **從 Emulator 狀態讀回** 15 筆，P9／R1／N1／U4，`workspaceId`／`classId` 與路徑一致；
8. 匿名讀取被拒（403）；
9. 在 Auth Emulator 建立虛構帳號；
10. token 查詢；
11. 已登入讀取被拒（403）；
12. 已登入寫入被拒（403）；
13. 清除前確認標記仍只有自己的；
14. 清除後剩 0 份文件、0 個帳號。

- 紀錄中的 fixture 檔案 SHA-256 為 `a2af65e8…8381f`，與 Stage 1 `source-lock` 相同。
- 這些都是**基礎設施冒煙**（`kind: INFRA_SMOKE`、`notAContractResult: true`），**不是**任何 POC 案例的結果。Stage 1 的 72 筆計畫維持 `NOT_RUN`。

### 5.3 Windows 相容性

- 總控改以 `node node_modules/firebase-tools/lib/bin/firebase.js` 啟動 CLI，不再依賴 `node_modules/.bin/firebase`（Windows 上是 `.cmd` 檔，`spawnSync` 無法直接執行）。
- 子程序無法啟動時，紀錄 `spawnError` 與 `signal`，不再只顯示 `exit: null`。
- **未在 Windows 上實際執行。**

## 6. 為何本批不加入 CI

- `.github/workflows/ci.yml` 與根目錄 `package.json` 都在外部錨定的 29 份受保護檔案中。修改它們會改變 digest，`baseline-anchor` 會失敗，直到負責人重新核准 repository variable。
- `tests/repo_policy.test.mjs` 斷言 `ci.yml` 是唯一的 workflow。新增 workflow 就必須修改這項政策測試。
- 本批不在未經決定的情況下削弱任一防護，所以 Emulator 冒煙**只有本機證據**，CI 仍只涵蓋 Stage 1 回歸與錨定。
- 是否加入 CI 冒煙，列為 §7 的使用者決策。

## 7. 需要使用者決策的事項（不阻擋本批）

| 編號 | 問題 | 影響的批次 | 選項 |
|---|---|---|---|
| Q1 | 是否在 CI 執行 Emulator 冒煙 | S2-B2 #2 以後 | (a) 修改 `ci.yml` 新增最小權限 job，並重新核准錨定 digest；(b) 新增獨立 workflow，並修改 `tests/repo_policy.test.mjs` 允許它；(c) 維持只在本機執行 |
| Q2（D-17） | 認證的信任根 | S2-B2 #3 | (a) GitHub Actions artifact attestation（綁定 workflow 與 commit）；(b) 負責人手動簽署；(c) 其他。選定前沒有任何結果能是 `PASS` |
| Q3 | 是否開放 `firebase.google.com` 給本執行環境，以核對官方文件 | 不阻擋 | 開放後可補官方文件核對；不開放則維持以套件原始碼為依據 |

## 8. 未驗證與限制

- 沒有在 Windows 或使用者自己的電腦上執行（§5.3 的相容性修改未經 Windows 實測）。
- 排他性只靠固定連接埠：同一台機器上若有程序在冒煙執行期間才綁定其他埠並改寫資料，不在本批的防護範圍內。
- 沒有以官方文件核對需求（見 §4）。
- 冒煙不包含任何授權邏輯、受控 API、交易或並行測試。
- Emulator 與正式 Firestore 的行為差異未評估。
- 沒有 CI 證據證明 Emulator 冒煙；CI 只證明 Stage 1 回歸與錨定未受影響。
