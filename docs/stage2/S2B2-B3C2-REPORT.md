# S2-B2 第 3 批 C-2｜第三方驗證（A18）與隔離的測試簽章：實作報告

> 依 `S2B2-B3C2-PLAN.md` v0.2（PR #15 審查後版本）與負責人的決定（Q-B 流程 I；C-2 計畫 Q1～Q4）。
> 本 PR **不**開啟 PASS（`PASS_ENABLED=false`），不改 `attest.yml` 的簽章條件，不改 Settings，不觸發任何 workflow。
> 單元測試與本機模擬使用**合成的** `gh` 輸出，**不是**密碼學驗證。真實的正向與反向驗收，要在合併後由第三方用 `gh` v2.102.0 以上執行。

## 1. 做了什麼

| 項目 | 檔案 | 說明 |
|---|---|---|
| 簽章時間的有效性 | `poc/stage2/src/b3/trust-policy.mjs` | 新增純函式 `validAt(record, t)`（攻擊計畫 §5.1 步驟 4a）。parser 新增 `validTo > validFrom` 的檢查，並可指定政策版本與允許的紀錄種類（供測試身分政策使用）。Runner 的門檻 `evaluateTrust`（要求**目前** active）語義不變 |
| 判定核心 | `poc/stage2/src/b3/third-party.mjs`（新） | 純函式 `judgeAttestation()`；兩個寫死的 profile（official／sigtest）；`computeTargets()`；`gh` 版本門檻；`buildSignerURI` 的精確解析 |
| CLI | `poc/stage2/scripts/verify-attestation.mjs`（新） | 第三方在自己的 clone 上手動執行，不在任何 workflow 中執行 |
| 測試簽章 workflow | `.github/workflows/attest-sigtest.yml`（新） | 只有 `workflow_dispatch`、只在 `main`；只有 checkout 和一個 `attest-build-provenance` 步驟（與 `attest.yml` 相同的 SHA）；subject 固定 |
| 固定的測試檔 | `poc/stage2/sigtest/SIGTEST.txt`（新） | 說明文字，SHA-256 `63515e7c…` 寫死在判定核心。`.gitattributes` 停用它的行尾轉換 |
| 測試身分政策 | `docs/stage2/S2B2-SIGTEST-POLICY.json`（新） | `s2-sigtest-policy-v1`。一筆 `SIGTEST-001`，核准 `attest-sigtest.yml` 的 blob `d8820ae8…`。依 Q3 由 Claude 提出，**負責人的明確合併指示才使它生效**。正式的 `S2B2-TRUST-POLICY.json` 不變，仍然沒有紀錄 |
| 錨定 | `scripts/verify-anchor.mjs` | 保護範圍新增 `attest-sigtest.yml`、`SIGTEST.txt`、測試身分政策、`verify-attestation.mjs`。`third-party.mjs` 已在 `src` 保護樹內 |
| 文件 | 攻擊計畫 §5.2、`CLAUDE.md` | `ACCEPTANCE_PENDING` 的措辭限縮（v0.3 複審的實作備註）；`CLAUDE.md` 列出四個 workflow |

## 2. 判定規則（對應計畫 v0.2 §2.3）

結果只有三種：

- 接受：official 為 `ACCEPTED`，sigtest 為 `SIGTEST_IDENTITY_ACCEPTED`；
- `REJECTED`；
- `REVOCATION_STATUS_UNKNOWN`：政策取得時間超過 `freshnessHours`，**不是**接受。

只要有任何拒絕理由，就一律是 `REJECTED`，不會被軟化成 unknown。CLI 只有接受時以 0 退出；`REJECTED`、unknown 為 1；用法錯誤與 `gh` 版本不足為 2。

1. **多份證據**：
   - 對 `gh` 回傳、已驗證的集合逐筆檢查；
   - 空陣列 → `NO_ATTESTATIONS`；`gh` 失敗 → `GH_VERIFY_FAILED`，不解析輸出。
2. **身分**：只取自憑證，**不**看 predicate。
   - `buildSignerURI` 以完整的正規表示式解析成 repo／路徑／ref。路徑與 ref 都用大小寫敏感的字串相等比對；
   - `sourceRepositoryRef`、`sourceRepositoryURI` 也要相等；
   - `buildSignerDigest` 必須是 40 位十六進位。
3. **可信時間**（Q4）：
   - `verifiedTimestamps` 必須非空；
   - 每筆的 `timestamp` 必須是帶時區的 ISO-8601 字串，而且可以解析；
   - **每一筆**都要落在紀錄的有效區間內；
   - 每筆的 type 都記錄下來。
4. **紀錄**：
   - 同一個 sha 只要有任何一筆 `invalidateIssued: true`，就一律拒絕；另一筆有效的紀錄不能挽回；
   - 否則，每個時間都要有一筆 `validAt` 成立的紀錄。
5. **subject 綁定**（兩個 profile 都做）：
   - 已驗證 statement 的 `subject[].digest.sha256` 必須包含實際檔案的 SHA-256；
   - sigtest 另外要求檔案等於固定的 `SIGTEST.txt`。
6. **簽章政策**：signer commit 中 signer workflow 的 blob（`git rev-parse <commit>:<path>`），必須有在簽章時間有效的 `signing-policy` 紀錄。
7. **official 的業務 statement**（嚴格 JSON，不接受重複鍵）：
   - `schemaVersion`；`verdict.result = PASS`；`scenario = honest`；
   - `toolchain.signingPolicyBlob` 不是 null，而且等於第 6 點的 blob；
   - `package.artifactId` 不是 null；
   - `trustedToolchainCommit` 的 `toolchain` 紀錄在簽章時間有效；
   - **先**檢查完紀錄，才重算 `targets` 並比對。
8. **政策**：
   - 核准的錨定值來自外部參數 `--anchor`（Q2），並記錄 `--anchor-source`；
   - CLI 先 `git fetch` main，記錄**實際取得的時間**與 commit，再解開該 tree；
   - 以目前的錨定函式重算 digest，必須等於 `--anchor`；
   - 只讀 profile 寫死的政策檔；
   - 取得時間晚於驗證時鐘 → `REJECTED`。
9. **測試介面**：
   - 政策複本只能透過純函式核心的 `policy` 參數注入（單元測試使用）；
   - CLI 只接受 `--profile --subject --repo-dir --anchor --anchor-source --out`，其他參數，例如 `--policy`、`--signer-workflow`，都以 2 退出；
   - profile 物件是凍結的。
10. **交付紀錄**：`result.json` 保存：
    - `gh` 的版本、參數、退出碼、stdout 的 SHA-256 與 stderr（前 2000 字元）；
    - 驗證時鐘、政策來源、每筆證據的時間與核准 ID。
    - 原始 stdout 另存 `gh-stdout.json`。

## 3. 送審重點（設計選擇）

- **targets 中的 `anchorDigest`**（R1 依 PR16-REV001 改寫，見 §7）：
  - 第一版是執行候選 commit 自己的 `scripts/verify-anchor.mjs`。審查者指出：這條路徑在拒絕之前就會執行候選程式（P1）；
  - 現在 protected 清單改為**資料檔** `scripts/anchor-paths.json`（本身受保護）。驗證者用**自己的** `anchorListing()`，依候選 commit 的清單計算該 commit 的錨定值，**不執行**候選 commit 的任何程式；
  - 清單會先驗證：版本、非空、不重複、必須包含自己與 `verify-anchor.mjs`、路徑不能是絕對路徑，也不能有 `.`／`..` 段。符號連結與非一般檔案一律讓計算失敗；
  - 在本 PR 之前的 commit 沒有這個資料檔，因此無法驗證，結果是 `TARGETS_UNAVAILABLE`（fail closed）。目前沒有任何已核准的工具鏈，所以沒有影響。
- **subject 比對**：一份 provenance 可以有多個 subject，目前要求「**至少一個**等於實際檔案」。`attest.yml` 與 `attest-sigtest.yml` 都只簽一個檔案。
- **測試身分政策的紀錄**：
  - `reviewRef` 寫成 `PR #16 (C-2)`，以本 PR 的實際編號為準；
  - `validFrom` 是 `2026-11-23T00:00:00Z`，早於合併時間，但簽章只會在合併後發生；
  - 紀錄在合併前不會生效，因為驗證只讀已錨定的 `main`。
- **`gh` 版本**：門檻寫死為 2.102.0（審查者已以官方 release notes 確認）。CLI 先檢查版本，不足時不驗證，以 2 退出，並寫出 `NOT_RUN` 紀錄。

## 4. 測試

| 測試 | 結果 | 範圍 |
|---|---|---|
| `c2-unit` | 11/11 | 見下 |
| `b3-unit` | 40/40 | parser 改動的回歸 |
| `repo_policy` | 新增 `attest-sigtest.yml` 測試 | workflow 清單、觸發、權限、步驟、相同 SHA、subject 固定、沒有 run／token／artifact、`.gitattributes` |
| `anchor_coverage` | 通過 | `verify-attestation.mjs` 的 import closure 都在錨定內，新檔案都受保護 |
| mutation | X1～X36 全部被抓到 | 路徑、ref、repo、多份證據、空集合、時間、區間邊界、invalidateIssued、新鮮度、錨定、subject、profile、statement、CLI 參數、workflow、錨定清單、政策紀錄、固定檔 |

`c2-unit` 的涵蓋範圍：

- sigtest 的正向結果，輸出中沒有 `PASS`；
- 共用前綴的路徑、大小寫不同的 ref、他人的 repo、predicate 不能替代憑證；
- profile 不能混用；
- 多份證據、空集合、`gh` 失敗；
- 時間戳：
  - 空陣列、缺欄位、不能解析、沒有時區、非字串；
  - 混合 type 中有一筆在區間外；
  - 時區換算（`+08:00`）；
- 區間邊界（`signing-policy` 與 `toolchain` 各一組）：`t < validFrom`、`= validFrom`、`validTo` 前、`= validTo`、撤銷後；
- 正常退役，以及 `invalidateIssued`（含另一筆有效紀錄也不能挽回）；
- `validAt` 與 parser 的格式錯誤；
- 新鮮度（剛好 24 小時、超過、未來的時間、拒絕優先），以及錨定缺少或不符；
- 政策複本：移除紀錄、其他 blob、用正式政策代替、錯誤的種類；
- subject 與 blob；
- official 的全部 statement 規則（含 targets 只在紀錄有效後才重算）；
- `gh` 版本門檻；
- `computeTargets` 重現已提交 fixture 的 `run.json.targets`；
- 已提交的 `SIGTEST.txt` digest，以及測試身分政策核准的正是已提交 workflow 的 blob；
- CLI 參數白名單。

**本機端到端模擬**：用**假的** `gh`（只輸出固定 JSON，**沒有**任何密碼學驗證），加上暫存區中的本機 bare repo 當作 `origin`：

| 情境 | 結果 |
|---|---|
| sigtest，身分正確 | `SIGTEST_IDENTITY_ACCEPTED`，exit 0，核准 `SIGTEST-001` |
| sigtest，路徑多 `.bak` | `REJECTED SIGNER_WORKFLOW_MISMATCH`，exit 1 |
| `gh` 以 1 退出 | `REJECTED GH_VERIFY_FAILED`，exit 1 |
| `--anchor` 錯誤 | `REJECTED ANCHOR_MISMATCH`，exit 1 |
| official profile 驗證 sigtest 檔 | `REJECTED`，exit 1 |
| official，**模擬**的 main 加入 toolchain 與 signing-policy 紀錄，合成 PASS statement | `ACCEPTED`，exit 0（第一版；R1 之後由 `c2-cli` 測試取代，見 §7） |
| 同上，`targets.anchorDigest` 竄改 | `REJECTED TARGETS_MISMATCH`，exit 1 |
| 本環境的真實 `gh` 2.89.0 | 拒絕執行，exit 2，`NOT_RUN GH_VERSION_UNSUPPORTED` |

模擬用的政策 commit 只存在暫存區的 bare repo 中，沒有推到任何遠端。

## 5. 合併後的操作（負責人與第三方）

1. 負責人核准新錨定，合併本 PR。
2. 負責人到 Actions 手動觸發 `attest-sigtest.yml` 一次，分支選 `main`。產生的測試簽章會**永久**留在公開的透明度日誌中。
3. 第三方（審查者或負責人）在自己的機器上，以 `gh` v2.102.0 以上、已登入，在 clone 的根目錄執行：

   ```bash
   node poc/stage2/scripts/verify-attestation.mjs --profile sigtest --subject poc/stage2/sigtest/SIGTEST.txt --repo-dir . --anchor <負責人核准的錨定值> --anchor-source "<取值來源>" --out <輸出目錄>
   ```

   - 正向：預期 `SIGTEST_IDENTITY_ACCEPTED`；
   - 反向（只用參數或本機的複本，不改正式紀錄）：
     - `--profile official` → `REJECTED`；
     - 錯誤的 `--anchor` → `REJECTED`；
     - 單元測試的政策複本與共用前綴的路徑，已經在 `c2-unit` 中涵蓋。若要再以真實簽章驗證這些反向情境，可以用核心函式加上 `gh` 的真實輸出重播；
   - 交付：`result.json`、`gh-stdout.json`、使用的 `gh` 版本。
4. 記錄 C-2 的驗收結果，之後才進入 C-3。

## 6. 限制

- 單元測試與模擬的 `gh` 輸出都是合成的，**不等於**真實的密碼學驗證。
- sigtest 只驗證密碼學與身分層，**不是**正式 PASS statement 被接受的證據。statement 層只有單元測試（流程 I 的分層）。
- 多份證據的逐筆檢查是保守政策，不宣稱已窮舉平台上所有可能的證據。
- 可信時間是 `gh` 回傳的觀測時間，不宣稱等於實際簽署的瞬間。
- C-2 合併後，PASS 仍然關閉。打開 PASS 需要另一個 PR、新的工具鏈 commit、批准紀錄、兩個指標與錨定，並重新審查。
- N5、N7、main 摘要、NOTE-c（原文缺失，待確認）、POC-009 BLOCKED、Stage 1 的 72 筆 NOT_RUN 都不受影響。

## 7. R1：PR #16 審查的回應（Reviewed Head `1164c40`）

| ID | 問題 | 修正 | 位置 | 驗證 |
|---|---|---|---|---|
| PR16-REV001（P1） | 錨定不符等情況已經記下拒絕理由，official 分支仍會呼叫 `targetsAt`，而 CLI 的 `targetsAt` 會執行候選 commit 的腳本。最後才 `REJECTED`，無法撤銷已經發生的副作用 | 1. **不再執行候選程式**：protected 清單改為已驗證的資料檔 `scripts/anchor-paths.json`。`verify-anchor.mjs` 讀取它；CLI 用驗證者自己的 `anchorListing()` 計算候選 commit 的錨定值。CLI 中唯一的子程序是 `gh`，以及 `git`／`tar` 的資料操作；沒有需要檢查退出碼的候選腳本。<br>2. **兩階段判定**：所有證據的無副作用檢查先做完；只有**完全沒有**拒絕理由、政策也沒過期時，才進入讀取候選 commit 的 `targetsAt`。無副作用檢查包括：外部錨定、政策來源、取得時間與新鮮度、身分、可信時間、subject、簽章政策、statement 欄位、toolchain 紀錄。<br>3. 錨定清單拒絕符號連結、非一般檔案、`.`／`..` 與絕對路徑 | `scripts/anchor-paths.json`（新）、`scripts/verify-anchor.mjs`、`src/b3/third-party.mjs`、`scripts/verify-attestation.mjs` | `c2-unit` 新增測試：14 種拒絕情境下 `targetsAt` 呼叫 0 次，statement 層的 4 種拒絕也是 0 次。<br>`c2-cli`（新）：本機 bare repo 加上**假的** `gh`。候選 commit 在 `verify-anchor.mjs` 與 `package.json` 植入 sentinel；對照組證明直接啟動那個腳本時 sentinel 會出現。錨定錯誤與第二份身分錯誤時 `REJECTED`、**沒有解開**候選 commit、sentinel 不存在；正確時 `ACCEPTED`，sentinel 同樣不存在。另測錨定清單的驗證（符號連結、`..`、絕對路徑、`.`、缺少自己、版本、重複、空的 trees） |
| PR16-REV002（P2） | 兩份有效的 official 證據使用同一個工具鏈時，第二次解開到同一個目錄會 `EEXIST`，被轉成 `TARGETS_UNAVAILABLE#1` | 核心依（完整 commit，testId）快取，每組只計算一次，結果套用到每份證據。CLI 依**完整** commit SHA 快取解開的結果，失敗也會快取，不重試；目錄名稱用完整 SHA，不用前綴 | `src/b3/third-party.mjs`、`scripts/verify-attestation.mjs` | `c2-unit`：兩份／三份有效證據 → `ACCEPTED`，只計算一次；targets 失敗時每份證據都拒絕，也只計算一次。<br>`c2-cli`：兩份有效證據 → `ACCEPTED`，只解開一次 |

另外：
- `tests/anchor_coverage.test.mjs` 的路徑改用 POSIX 格式。審查者在 Windows 上遇到反斜線比對失敗，那不是這次的 finding，但修正成本很低。
- 審查者對設計問題的答覆已採納：subject「至少一個相符」可以接受；測試身分政策的生效依賴已錨定的 `main`。

**mutation（R1 新增 Y1～Y10）**：

- Y1 是把「CLI 執行候選錨定腳本」放回來（舊行為），被 `c2-cli` 的 sentinel 抓到。
- **Y5（移除 CLI 的解開快取）沒有被抓到**，它是等價的 mutation。一次 CLI 只驗證一個 subject，也就是一個 testId；核心快取已經保證同一個 commit 只呼叫 `targetsAt` 一次，所以 CLI 的快取在目前的參數下觀察不到。這個快取保留作為防禦。
- 其餘 Y 全部被抓到。

測試結果與錨定值見 REVIEW_LOG 的 R1 紀錄。

## 8. C-2 本機驗證在 Windows 受阻，以及修正（2026-11-23）

**狀態：C-2 本機驗證受阻，尚未驗收。** 以下 hosted 簽章已經存在，**不需要**重新觸發：

- `attest-sigtest.yml` run 45121359992，attempt 1；
- attestation https://github.com/hsuanyu9503/class-management-next/attestations/70952425 。

### 8.1 觀察到的事實（負責人回報）

- 在 Windows 上，三次本機驗證（sigtest 正向、official 反向、錯誤錨定反向）都在 `verify-attestation.mjs` 的 `extract()` 中斷。中斷在第 57 行，呼叫端是第 63 行，也就是 main 的快照。
- `tar` 解開 `main.tar` 中 `poc/stage1/docs/` 的中文檔名時失敗，訊息是 `Invalid empty pathname: Unknown error`，exit status 1。
- 三個輸出資料夾都**沒有** `result.json`。`gh attestation verify` 一次都沒有執行。
- 因此，三次的非零退出都**不是**政策拒絕，也不能算是反向測試通過。

### 8.2 原因與修正

- 原因：第一版用 `git archive` 加系統的 `tar` 建立快照。Windows 內建的 bsdtar（`tar.exe`）無法解開這個 repository 的 UTF-8 檔名。
- 修正：新增 `poc/stage2/src/b3/git-snapshot.mjs`，**不再使用 `tar`**。
  - `git ls-tree -r -z --full-tree <commit>`：取得原始、以 NUL 分隔、未加引號的 UTF-8 路徑、mode 與 blob ID；
  - `git cat-file --batch`：取得原始 blob 位元組。沒有 checkout，所以不會套用 autocrlf、filter 或 attributes；
  - 每個 blob 都重新計算 Git 物件雜湊（sha1，或 SHA-256 repository 的 sha256），必須等於它的物件 ID。寫出的位元組因此在每個平台上都和 commit 完全相同；
  - 檔案由驗證者自己的程式寫出，不執行 commit 中的任何程式。
- 以下情況 fail closed，回報 `SNAPSHOT_FAILED[stage]` 並附上路徑。所有平台套用同一套規則，Linux 上能建立的快照在 Windows 上也能建立：
  - 符號連結、submodule 等非一般檔案；
  - 路徑不是合法的 UTF-8、絕對路徑，或含有空段、`.`、`..`、反斜線、控制字元；
  - 含有 Windows 保留字元 `<>:"|?*`，或保留名稱 `CON`、`NUL`、`COM1` 等；
  - 路徑段以 `.` 或空白結尾；
  - 在不分大小寫或會正規化 Unicode 的檔案系統上會衝突的兩個路徑；
  - 快照目標目錄不是空的。
- 錨定驗證**完全保留**：錨定值仍以 `anchorListing()` 計算，不略過任何受保護的檔案。`c2-snapshot` 測試確認：
  - 快照上計算出的每一行，都等於直接從 Git 物件計算的 SHA-256；
  - 在有 `tar` 的平台上，結果與舊的 `tar` 路徑逐位元組相同。
- 同樣保留：不執行候選 commit 的程式、依完整 commit SHA 快取，以及所有信任檢查（R1）。

### 8.3 診斷：環境錯誤不得冒充政策拒絕

| 退出碼 | 結果 | 意義 |
|---|---|---|
| 0 | `SIGTEST_IDENTITY_ACCEPTED`／`ACCEPTED` | 接受 |
| 1 | `REJECTED`／`REVOCATION_STATUS_UNKNOWN` | 政策的判定 |
| 2 | 用法錯誤、`gh` 版本不足 | 沒有驗證 |
| 3 | `NOT_RUN` `ENVIRONMENT_ERROR` | 環境或 repository 形狀的問題，**不是**政策判定 |

- 退出碼 3 涵蓋以下情況：
  - fetch main 失敗；
  - main 或候選工具鏈的快照失敗；
  - main 的錨定值無法計算。以前會被吞掉，變成 `ANCHOR_MISMATCH` 的「拒絕」；
  - `gh` 無法啟動；
  - signer commit 不在 clone 中。
- `result.json` 一律寫出，內容包括 `environment[]`（stage 與錯誤訊息）與 `platform`；如果已有政策判定，另外保存在 `policyResult`，供參考。

### 8.4 測試（提交者，Linux）

- `c2-snapshot`（新）：**不需要 shell、tar，也不需要在磁碟上建立符號連結，可以在 Windows 執行**。
  - HEAD 的快照：包含中文檔名的每個檔案，都與 `git cat-file blob` 逐位元組相同；沒有寫出多餘的檔案；
  - 錨定值：快照上的每一行等於直接從 Git 物件計算的值；與 `tar` 路徑交叉比對（在非 Windows 平台）；
  - 位元組保真：CRLF、BOM、二進位、空檔、可執行檔、中文路徑、NFD 檔名；
  - fail closed：符號連結、submodule、`:`、`CON`、結尾的 `.` 或空白、反斜線、大小寫衝突、正規化衝突、不合法的 commit ID、未知的 commit、非 repository、非空的目標目錄；
  - 完整性：blob 被替換、被截斷、物件不存在、ID 不符。
- `c2-cli` 新增環境錯誤測試：非 repository → `fetch-main`；main 含符號連結 → `snapshot-main`；main 的錨定清單不合法 → `anchor-main`。三者都是 exit 3、`NOT_RUN`，不會產生政策理由，也不會留下 sentinel。
  - 這個檔案的 stub `gh` 是 POSIX 的 shebang 腳本，Windows 上會略過；Windows 的相容性由 `c2-snapshot` 涵蓋。
- mutation Z1～Z12 全部被抓到。其他測試結果與錨定值見 REVIEW_LOG。
- **沒有執行**：Claude 的環境沒有 Windows。Windows 上的 `c2-snapshot` 與三次本機驗證，要由負責人或審查者執行。

### 8.5 修正審查後的操作（負責人或審查者，在 Windows 上）

見 HANDOFF。三次驗證都使用既有的簽章，不重新觸發 hosted。每次都要保留：退出碼、`result.json`、`gh-stdout.json`，以及 `gh --version` 的輸出。

