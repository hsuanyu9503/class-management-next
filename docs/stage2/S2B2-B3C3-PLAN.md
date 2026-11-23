# S2-B2 第 3 批 C-3｜Environment `s2-attest`：計畫 v0.2

> 狀態：**草案，尚未核准實作**。依 `S2B2-B3C-ATTACK-PLAN.md` v0.4 §4.2、§7，以及負責人的決定：
> - Q-C（2026-11-22）：「是：加入 Environment `s2-attest`，只作為額外保護，不是安全邊界」；
> - Q-D：C-1 → C-2 → C-3。
>
> 本計畫不授權修改 Settings、簽章 workflow、觸發 hosted、合併或開啟 PASS。`PASS_ENABLED=false` 維持不變。
> v0.2：ChatGPT 審查 PR #18 時認為計畫方向可以接受，並要求補充六項，見 §8。前次審查檔的原文 Claude 沒有收到，以 2026-11-23 回報中列出的六項為準。

## 0. 定位（不變）

- Environment 只約束**有引用它的 job**。惡意的分支 workflow 可以直接拿掉 `environment:`，所以它**不是**安全邊界，也不能防止非預期的公開簽章（攻擊計畫 §4.2）。
- 對惡意簽章的防線，仍然是 C-2 的第三方驗證：精確的 signer workflow、ref、簽章時間有效的 blob 與工具鏈紀錄。
- C-3 的用途：讓**合作的** workflow 不會被誤用。例如從其他分支手動觸發未修改的 `attest.yml`，Environment 會在平台層再擋一次。
- **兩種「條件」要分開**（v0.2）：
  - **正式 PASS 的安全判定，以及第三方驗證**：Environment **永遠不是**條件。在另外提出外部強制機制與可執行的驗證方法之前，第三方驗證不檢查它，PASS 的門檻也不包含它；
  - **C-3 這個工作項目本身的完成條件**：見 §4.1。它檢查的是「設定與引用是否如計畫所述」，不代表 Environment 因此成為安全條件。

## 1. 可行性掃描

| 項目 | 現況 | 對 C-3 的影響 |
|---|---|---|
| 簽章的 job | `attest.yml` 的 `verify`（`id-token: write`、`attestations: write`，只在 PASS 時簽章）；`attest-sigtest.yml` 的 `sigtest` | 兩個都可以加 `environment: s2-attest`。哪些要加，見 Q1 |
| 既有的分支限制 | `attest.yml` 的 `execute`、`attest-sigtest.yml` 的 `sigtest` 都有 `if: github.ref == 'refs/heads/main'`；`verify` 依賴 `execute` | 在目前的 workflow 中，從其他分支觸發時 job 會先被 `if` 略過，**不會**走到 Environment 的檢查。Environment 只在 workflow 檔被改壞（例如拿掉 `if`）時才是第二道保護。見 §4 的驗證限制 |
| Environment 不存在時的行為 | 據審查者先前核對的官方文件：job 引用不存在的 Environment 時，平台會**自動建立一個沒有保護規則的** Environment | **負責人必須在合併 C-3 的 PR 之前**，先在 Settings 建立並設定好 `s2-attest`（§3） |
| OIDC 與 Sigstore 憑證 | job 引用 Environment 後，OIDC token 的 `sub` 會變成 `repo:hsuanyu9503/class-management-next:environment:s2-attest`，不再是 `repo:…:ref:refs/heads/main`（據官方文件，**待審查者確認**）。C-2 的驗證只使用 `buildSignerURI`、`buildSignerDigest`、`sourceRepositoryURI`／`Ref` 與可信時間，不使用 `sub` | 預期**不影響** C-2 的驗證結果，但不能假定，要用 Q3 的真實簽章確認。**限制**（v0.2）：任何以 OIDC `sub` 的格式做信任判斷的外部設定（例如雲端的 workload identity federation），都要改成新的格式。本 PoC 沒有這類設定。另外，Sigstore 憑證是否、以及在哪個欄位記錄 Environment，要以 Q3 的實際憑證為準，只記錄，不作為條件 |
| 錨定 | `attest.yml`、`attest-sigtest.yml` 都受保護 | 修改後錨定改變，需要負責人重新核准 |
| `attest-sigtest.yml` 的 blob | 測試身分政策 `SIGTEST-001` 核准的是 `d8820ae8…` | 若在 `attest-sigtest.yml` 加上 Environment，blob 會改變，需要新的測試身分紀錄 `SIGTEST-002`（Q3） |

## 2. 變更內容（依 Q1 的建議）

1. `.github/workflows/attest.yml`：`verify` job 加上 `environment: s2-attest`。
   - `execute` 不加：它沒有簽章權限，加上去只會讓每次執行多一道部署紀錄；
   - `availability` 不加：它只有 `actions: read`。
2. `.github/workflows/attest-sigtest.yml`：`sigtest` job 加上 `environment: s2-attest`（若 Q1 選擇包含）。
3. `docs/stage2/S2B2-SIGTEST-POLICY.json`：依 §5.1 換版。
4. `tests/repo_policy.test.mjs`：
   - 斷言 `verify`（以及 `sigtest`）有 `environment: s2-attest`；
   - 斷言 `execute`、`availability` 與 `attest-attack.yml` 的 job **沒有**引用它；
   - 既有的權限、觸發條件、`if` 條件與 SHA 固定全部保留。
5. 文件：
   - 攻擊計畫 §4.2：註明 C-3 已實作，定位不變；
   - C-3 報告；`CLAUDE.md`；REVIEW_LOG；HANDOFF。
6. **不改**：
   - `attest-attack.yml`：沒有簽章權限，不需要；
   - 判定程式、第三方驗證、`PASS_ENABLED`。

## 3. 負責人在 Settings 的操作（**合併 C-3 的 PR 之前**）

1. 到 repository 的 **Settings → Environments → New environment**，名稱輸入 `s2-attest`（必須完全相同），按 **Configure environment**。
2. **Deployment branches and tags**：選 **Selected branches and tags** → **Add deployment branch or tag rule** → Ref type 選 **Branch**，Name pattern 填 `main` → **Add rule**。清單中只應該有 `main` 這一條。
3. **Required reviewers**：依 Q2 決定。建議不勾選，理由見 Q2。
4. **Wait timer**：不設定。
5. **Allow administrators to bypass configured protection rules**：依 Q2 決定。
6. **Environment secrets／variables**：都不要新增。workflow 繼續使用 repository variables；新增 environment variable 會改變 `vars.*` 的來源，不在本計畫範圍內。
7. 完成後提供 §3.1 的完整設定證據。

### 3.1 完整的設定證據（v0.2）

截圖只能證明當下畫面上的狀態，不能證明已經儲存。請提供下列**任一種**；兩種都提供更好：

- **截圖**：按 **Save protection rules**，**重新整理**頁面後再截圖。畫面要包含：
  - 頁首的 repository 名稱與 Environment 名稱 `s2-attest`；
  - 「Allow administrators to bypass」未勾選；
  - Required reviewers、Wait timer 未勾選；
  - Deployment branches and tags 只有 `main`；
  - Environment secrets 與 variables 都是空的。
- **API 回應**（負責人用自己已登入的 `gh`，讀取伺服器端實際保存的狀態）：

  ```bash
  gh api repos/hsuanyu9503/class-management-next/environments/s2-attest
  ```

  ```bash
  gh api repos/hsuanyu9503/class-management-next/environments/s2-attest/deployment-branch-policies
  ```

  預期：
  - `can_admins_bypass: false`；
  - `deployment_branch_policy` 為 `{"protected_branches": false, "custom_branch_policies": true}`；
  - `protection_rules` 沒有 `required_reviewers` 或 `wait_timer`，只有 `branch_policy`；
  - 第二個指令的 `branch_policies` 只有一筆：`{"name": "main", "type": "branch"}`。

## 4. 驗證

| 層級 | 方法 | 誰執行 |
|---|---|---|
| 檔案 | `repo_policy` 測試（§2-4）；錨定涵蓋 | Claude；CI |
| 設定 | §3.1 的完整設定證據：只允許 `main`、不允許管理員略過、不要求 reviewer、沒有 secrets／variables，而且**已儲存**（重新整理後仍是如此） | 負責人提供，審查者核對 |
| hosted（正向） | 合併後，push 到 main 自動觸發的 `attest.yml` run：`verify` job 的頁面顯示 Environment `s2-attest` 的部署紀錄，而且照常完成（結果仍是 UNATTESTED，不簽章） | 平台自動執行；Claude 讀 log，審查者核對 |
| hosted（Q3，已決定執行） | 由負責人手動觸發一次 `attest-sigtest.yml`（已加 Environment），再由第三方用 C-2 的 CLI 驗證：正向 `SIGTEST_IDENTITY_ACCEPTED`。並記錄 Environment 是否出現在 Sigstore 證據中、出現在哪個欄位（只記錄，不作為驗收條件） | 負責人觸發；第三方驗證 |
| 負向（**限制**） | 在目前的 workflow 中，從其他分支觸發會先被 job 的 `if` 略過，**無法**在不修改受保護 workflow 的情況下，觀察到 Environment 擋下執行。本計畫**不**為了測試而建立弱化的 workflow。Environment 的分支限制以 §3 的設定證據為準，標為「設定已核對，未以實際阻擋驗證」 | — |

### 4.1 C-3 的完成條件（v0.2）

以下全部成立，才記錄 C-3 完成。這些是 C-3 工作項目的條件，**不是** PASS 或第三方驗證的條件（§0）：

1. Settings：§3.1 的完整設定證據，已儲存；
2. 檔案：`verify` 與 `sigtest` 引用 `s2-attest`，其他 job 沒有引用（`repo_policy`）；測試身分政策換版（§5.1）；
3. 錨定：最後一個受保護檔案的 commit 經過審查，新錨定由負責人核准，同一個 Head 的 CI 全綠；
4. hosted：合併後自動觸發的 `attest.yml` run，`verify` job 有 `s2-attest` 的部署紀錄，而且照常完成（UNATTESTED，不簽章）；
5. Q3：合併後由負責人觸發一次 `attest-sigtest.yml`，第三方用 C-2 的 CLI 驗證，結果為 `SIGTEST_IDENTITY_ACCEPTED`（exit 0），審查者核對原檔；
6. 負向阻擋：**不列入**（§4 的限制）。

## 5. 交付順序

1. 審查本計畫，負責人決定 §6 的問題。
2. 負責人依 §3 建立 `s2-attest`，提供設定證據。
3. Claude 實作 §2，送 PR 與審查證據包（L3：修改簽章 workflow，錨定改變）。
4. ChatGPT 審查；負責人核准錨定並決定是否合併。
5. 合併後：
   - 讀取自動觸發的 `attest.yml` run，確認 `verify` 有 Environment 的部署紀錄；
   - 若選擇 Q3，執行 sigtest 與第三方驗證；
   - 記錄 C-3 完成。

### 5.1 測試身分政策換版：UTC cutoff 與最後的錨定審查順序（v0.2）

- 加上 `environment:` 之後，`attest-sigtest.yml` 的 blob 由 `d8820ae8…` 變成 `a1b93f96…`。
- 使用**同一個固定的 UTC cutoff** `2026-11-23T10:30:00Z`：
  - `SIGTEST-001`（舊 blob）改為 `revoked`，`validTo = cutoff`，`invalidateIssued: false`，屬於正常退役；
  - `SIGTEST-002`（新 blob）為 `active`，`validFrom = cutoff`。
  - 兩者之間沒有空檔，也沒有重疊。
- 這個 cutoff 的意義：
  - 舊 blob 在 cutoff **之前**的簽章仍然有效。run 45121359992 的簽章時間是 2026-11-23T06:01:22Z，所以仍被接受；
  - 舊 blob 在 cutoff 之後的簽章、新 blob 在 cutoff 之前的簽章，都**不**被接受。
- cutoff 選在「寫入這個 commit 的時間之後、合併之前」：
  - 合併之前，main 上的舊 workflow 若又被觸發（不應發生），它在 cutoff 之後產生的簽章不會被接受，這是保守的結果；
  - 新 workflow 只有在合併後才會存在於 main，簽章時間一定晚於 cutoff。
- 順序：
  1. cutoff 寫在受保護的政策檔中，這個檔案在錨定範圍內；
  2. **最後一個**改動受保護檔案的 commit 送審；
  3. 審查通過後，負責人核准**這個** commit 的錨定；
  4. 同一個 Head 的 CI 全綠後才合併；
  5. 合併之後，負責人才觸發新的 sigtest。
  - 如果審查後又改了受保護檔案（包括 cutoff），就要重新計算錨定、重新送審。
- `c2-unit` 驗證：
  - 只有一筆 active 紀錄，而且是已提交的 workflow blob；
  - 舊紀錄的 `validTo` 等於新紀錄的 `validFrom`；
  - run 45121359992 的簽章仍被接受；
  - 舊 blob 在 cutoff 時、新 blob 在 cutoff 前 1 秒，都被拒絕。

## 6. 需要負責人決定

> **負責人的決定（2026-11-23）**：「三項都依照妳的建議執行」
>
> | 問題 | 決定 |
> |---|---|
> | Q1 | `attest.yml` 的 `verify` 與 `attest-sigtest.yml` 的 `sigtest` 都引用 `s2-attest` |
> | Q2 | 只允許 `main`；不要求 reviewer；不勾選「允許管理員略過」 |
> | Q3 | 合併後由負責人觸發一次新的測試簽章，以 C-2 的 CLI 驗證；新增 `SIGTEST-002`，`SIGTEST-001` 正常退役 |
>
> 這些決定不取代 ChatGPT 對本計畫的審查。實作 PR 要在計畫審查通過、負責人完成 §3 的 Settings 之後才能合併。


| # | 問題 | Claude 的建議 |
|---|---|---|
| Q1 | 哪些 job 引用 `s2-attest`？ | **`attest.yml` 的 `verify`，加上 `attest-sigtest.yml` 的 `sigtest`**，也就是所有具有簽章權限的 job。代價：`attest-sigtest.yml` 的 blob 會改變，需要新的測試身分紀錄（Q3）。若只加 `verify`，測試簽章 workflow 就沒有這層保護 |
| Q2 | Environment 的保護規則：除了只允許 `main`，是否要求 reviewer 核准、是否允許管理員略過？ | **只允許 `main`，不要求 reviewer**。`attest.yml` 在每次 push 到 main 時自動執行；要求 reviewer 的話，每次合併後都要手動核准，目前 PASS 關閉、不會簽章，這只會增加操作負擔。管理員略過：本 repository 只有一位負責人，建議**不勾選**，讓規則對所有人一致，影響可以忽略。等 PASS 要開啟時，再重新評估是否要求 reviewer |
| Q3 | 是否在 C-3 合併後，用一次新的測試簽章確認 Environment 不影響 C-2 的第三方驗證？ | **是**。`attest.yml` 在 PASS 關閉時不會簽章，所以這是唯一能取得「有 Environment 的真實簽章」的方法。代價：再多一份永久的公開測試簽章；測試身分政策新增 `SIGTEST-002`，`SIGTEST-001` 正常退役 |

## 7. 未驗證與限制

- 以下事實需要審查者以官方文件確認，Claude 的環境無法連線：
  - Environment 不存在時會被自動建立；
  - deployment branch rule 的行為；
  - OIDC `sub` 會因為 Environment 改變；
  - Sigstore 憑證中是否出現 Environment。
- Environment 只保護有引用它的 job，不是安全邊界；惡意 workflow 仍然可以在透明度日誌中留下簽章，只是第三方驗證不會接受。
- 負向的阻擋行為不會以實際執行驗證（§4）。
- C-3 不改變 PASS 的門檻。打開 PASS 仍需要另一個 PR、新的工具鏈 commit、批准紀錄、兩個指標與錨定，並重新審查。
- POC-009 BLOCKED、Stage 1 的 72 筆 NOT_RUN、N5、N7、main 摘要、NOTE-c（原文缺失，待確認）都不受影響。

## 8. v0.2 對應表（PR #18 審查，Head `9958207`／`1668d4d`）

前次審查檔的原文 Claude 沒有收到，以下依 2026-11-23 回報中列出的六項處理：

| 項目 | 處理 | 位置 |
|---|---|---|
| 完整的設定證據方式 | 截圖必須在儲存並重新整理後拍攝，並包含頁首；或用 `gh api` 讀取伺服器端狀態，附上預期值 | §3.1 |
| Environment 不是正式 PASS 的安全條件，要與 C-3 本身的完成條件區分 | §0 分成兩種條件；新增 §4.1 C-3 完成條件 | §0、§4.1 |
| Q3 已經決定，不再標為「可選」 | §4 的表格改為「已決定執行」；也列入 §4.1 | §4、§4.1 |
| OIDC subject 格式的限制 | 新格式 `repo:…:environment:s2-attest`；以 `sub` 做信任判斷的外部設定要更新（本 PoC 沒有）；Environment 是否出現在憑證中只記錄 | §1 |
| 政策換版的 UTC cutoff 與最後的錨定審查順序 | 固定 cutoff `2026-11-23T10:30:00Z`；舊紀錄正常退役、新紀錄同時生效；最後一個受保護 commit → 審查 → 錨定 → CI → 合併 → sigtest | §5.1 |
| HANDOFF 中 C-2 的歷史阻塞標為已結案 | HANDOFF 第 9 項標為「已結案（C-2 已驗收）」 | HANDOFF |

另外，2026-11-23 的設定截圖：只允許 `main`、不允許管理員略過、不要求 reviewer、沒有 secrets／variables。**是否已儲存，還要依 §3.1 補上證據**，必須在合併本 PR 之前完成。

