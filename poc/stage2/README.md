# PoC Stage 2｜S2-B2：本機 Emulator 基礎設施（第 1 批）與受控讀取 API 案例執行（第 2 批）

> **第 2 批**：本機受控讀取 API、trace 記錄代理、狀態匯出、Observer 雛形，以及 POC-001、002、008、009 在真實 Emulator 上的執行。結果一律 `UNATTESTED`／`BLOCKED`，**沒有 PASS**。設計、案例對照與結果見 `docs/stage2/S2B2-B2-PLAN.md`。指令：`npm run s2:cases`。

> **這不是後端契約測試。** 這裡只驗證「本機 Firebase Auth／Firestore Emulator 能啟動、只連本機、能載入與清除虛構資料、預設拒絕 client 存取」。Stage 1 的 36 項契約與 72 筆計畫維持 `NOT_RUN`；冒煙成功不等於任何 POC 案例 PASS。

## 需求（依已安裝的 firebase-tools 15.35.0 原始碼確認）

| 項目 | 需求 | 來源 |
|---|---|---|
| Node.js | `>=20`（本專案基準 22） | `firebase-tools` 的 `package.json` `engines` |
| Java | **21 以上** | `node_modules/firebase-tools/lib/emulator/commandUtils.js`：`MIN_SUPPORTED_JAVA_MAJOR_VERSION = 21` |
| Firestore Emulator | `cloud-firestore-emulator-v1.22.0.jar`（firebase-tools 首次執行時下載，並以 MD5 `5d74cc6bee9e18560d2eae2c6440fd13` 核對） | `lib/emulator/downloadableEmulatorInfo.json` |
| Auth Emulator | 內建於 firebase-tools（JavaScript，不需下載） | firebase-tools |

官方文件網站（`firebase.google.com`）在本次執行環境的網路政策下無法連線，因此**沒有**以官方文件核對；上表全部來自實際安裝的套件原始碼。

## 執行

```bash
cd poc/stage2
npm ci
npm run s2:test          # guard + 非破壞性測試（不需 Emulator）
npm run s2:smoke         # 冒煙與全部負向控制
npm run s2:occupied-real # 真實 Emulator 已占用時，確認總控不碰既有資料
npm run s2:cases         # 第 2 批：四個案例＋負向／變異控制（UNATTESTED）
```

- 只安裝在 `poc/stage2/node_modules`（專案本地），不需要全域安裝 firebase-tools。版本以 `package-lock.json` 鎖定（`firebase-tools` 精確版本 `15.35.0`）。
- `s2:smoke` 會依序執行：guard 單元測試 → 4 個「未啟動 Emulator 或設定錯誤」的負向控制（**唯讀探測**，只送 GET）→ `firebase emulators:exec` 正向冒煙 → 「規則放寬」負向控制 → 「斷線」負向控制（唯讀探測）。全部符合預期才回傳 0。
- 每次啟動 Emulator 前後都確認連接埠 8080、9099、4400、4500、9150 **確實關閉**：只有明確的 `ECONNREFUSED` 算關閉；連線成功、`EACCES`、`EPERM`、逾時或其他錯誤都會停止（`src/port-state.mjs`）。**任何前置條件失敗都會立刻停止**（exit 2，`PRECONDITION FAILED`），不執行後續任何步驟，也不清除任何資料。
- 執行紀錄寫到 `evidence/runs/infra-smoke-latest.json`（已列入 `.gitignore`，不提交）。

## 只連本機的保證

- `firebase.json`：所有 Emulator 綁定 `127.0.0.1`，關閉 UI；專案 ID 固定為 `demo-cmn-s2b2`。firebase-tools 對 `demo-` 專案會略過對正式服務的呼叫（`lib/emulator/adminSdkConfig.js`）。
- `src/local-guard.mjs`：在任何網路請求之前檢查，任一不符即失敗：
  - `FIRESTORE_EMULATOR_HOST`、`FIREBASE_AUTH_EMULATOR_HOST` 必須存在，且必須是 loopback 的 `host:port`。缺少時直接失敗，**不會**退回任何雲端端點。
  - 專案必須是 `demo-` 開頭。
  - 環境中不得有憑證類變數（`GOOGLE_APPLICATION_CREDENTIALS`、`FIREBASE_TOKEN` 等）。
  - `FIREBASE_CONFIG` 只接受 `emulators:exec` 為 demo 專案產生的固定形狀。
  - `firebase.json` 的每個 Emulator 都必須綁定 loopback，且 UI 必須關閉。
- `src/emu-client.mjs`：每一個請求的 URL 在送出前都再檢查一次是否為 loopback `http`，並且不允許重新導向。
- firebase-tools 的遠端 MOTD 請求以 `CI=1` 關閉；使用統計只在使用者明確 opt-in 時才會送出（`lib/track.js` 的 `usageEnabled()`），本執行環境沒有 opt-in。

## 預設拒絕

`firestore.rules` 是**拒絕一切**的佔位規則，**不是** S2-B1 的產品授權規則。冒煙會以三種 client 身分驗證全部被拒（403）：

- 匿名讀取；
- 已登入的讀取；
- 已登入的寫入。

另外有一個負向控制：把規則換成 `test/negative-controls/permissive.rules`（只用於負向控制，預設設定不會引用）時，冒煙**必須失敗**，以證明那些 403 確實來自規則。

## 只清除自己擁有的資料

`src/ownership.mjs`：

1. 寫入前證明 Emulator 是空的：Firestore 沒有任何根集合、Auth 沒有帳號。否則拒絕，不送任何寫入或刪除。
2. 寫入本次執行的 nonce 標記 `_smokeOwnership/{RUN_NONCE}`（總控每次產生 32 位十六進位亂數）。
3. 清除前確認標記集合裡只有自己的那一份。否則拒絕清除。

冒煙用 Emulator 專用的 `Authorization: Bearer owner` 繞過規則來載入與檢查虛構資料。這個 owner token **只在 Emulator 有效**，不是正式憑證。

## 檔案

| 檔案 | 用途 |
|---|---|
| `firebase.json` | Emulator 設定（loopback、UI 關閉） |
| `firestore.rules` | 拒絕一切的佔位規則 |
| `src/local-guard.mjs` | 只連本機的 guard |
| `src/emu-client.mjs` | Emulator REST 用戶端（不用 Firebase SDK、不用憑證） |
| `src/seed.mjs` | 從**唯讀**的 Stage 1 fixtures 產生 A17 虛構資料，路徑依 S2-B1 資料模型 |
| `test/guard.test.mjs` | guard 單元測試（不需 Emulator） |
| `src/ownership.mjs` | 擁有權檢查（空環境證明、nonce 標記）。用來避免誤刪他人資料，不是原子鎖，也不能對抗惡意本機程序 |
| `src/port-state.mjs` | 連接埠三態探測（`open`／`closed`／`unknown`） |
| `src/orchestrator.mjs` | 總控邏輯（可注入探測與子程序，供回歸測試） |
| `test/port-state.test.mjs` | 連接埠三態與總控停止的回歸測試（記錄 probe／CLI 啟動次數） |
| `test/smoke.mjs` | 在 `emulators:exec` 內執行的冒煙 |
| `test/probe.mjs` | 唯讀探測（只送 GET），用於「未啟動」「斷線」與 guard 負向控制 |
| `test/nondestructive.test.mjs` | 以假 HTTP 伺服器記錄請求：連接埠被占用、外來 Emulator 有資料時，不送任何破壞性請求 |
| `test/real-occupied.mjs`、`scripts/run-occupied-real.mjs` | 在真實 Emulator 已占用且有外來資料時執行總控，確認資料不變 |
| `test/negative-controls/` | 規則放寬負向控制（不用於正常執行） |
| `scripts/run-smoke.mjs` | 冒煙與全部負向控制的總控入口 |
| **第 2 批** | |
| `src/api/server.mjs`、`src/api/token.mjs`、`src/api/store.mjs` | 本機受控讀取 API（只綁定 loopback、只支援 Emulator 模式）、token claim 檢查、權威文件讀取與 `auditLog` 寫入 |
| `src/authz.mjs`、`src/time-validate.mjs` | 分支 C 授權（S2-B1 §6.1–6.2、§5）與嚴格時間驗證 |
| `src/trace-proxy.mjs`、`src/mask.mjs` | front／back 記錄代理與寫入前遮罩 |
| `src/world.mjs`、`src/harness.mjs` | 案例測資（唯讀 fixtures）、擁有權下的重置、狀態匯出、服務生命週期 |
| `src/adapter.mjs`、`src/observer.mjs`、`src/verdict.mjs` | Firebase Adapter（Stage 1 介面）、Observer 雛形、Stage 2 判定（無 PASS） |
| `scripts/run-cases.mjs`、`test/case-run.mjs`、`test/api-disconnect.mjs` | 第 2 批總控、案例與控制、真實斷線檢查 |
| `test/batch2-unit.test.mjs` | 第 2 批單元測試（不需 Emulator；最後一項使用本機 HTTP） |
