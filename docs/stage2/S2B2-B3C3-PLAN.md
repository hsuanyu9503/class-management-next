# S2-B2 第 3 批 C-3｜Environment `s2-attest`：計畫 v0.1（草案）

> 狀態：**草案，尚未核准實作**。依 `S2B2-B3C-ATTACK-PLAN.md` v0.4 §4.2、§7，以及負責人的決定：
> - Q-C（2026-11-22）：「是：加入 Environment `s2-attest`，只作為額外保護，不是安全邊界」；
> - Q-D：C-1 → C-2 → C-3。
>
> 本計畫不授權修改 Settings、簽章 workflow、觸發 hosted、合併或開啟 PASS。`PASS_ENABLED=false` 維持不變。

## 0. 定位（不變）

- Environment 只約束**有引用它的 job**。惡意的分支 workflow 可以直接拿掉 `environment:`，所以它**不是**安全邊界，也不能防止非預期的公開簽章（攻擊計畫 §4.2）。
- 對惡意簽章的防線，仍然是 C-2 的第三方驗證：精確的 signer workflow、ref、簽章時間有效的 blob 與工具鏈紀錄。
- C-3 的用途：讓**合作的** workflow 不會被誤用。例如從其他分支手動觸發未修改的 `attest.yml`，Environment 會在平台層再擋一次。
- 在另外提出外部強制機制與可執行的驗證方法之前，Environment **不列入任何驗收條件**，第三方驗證也不檢查它。

## 1. 可行性掃描

| 項目 | 現況 | 對 C-3 的影響 |
|---|---|---|
| 簽章的 job | `attest.yml` 的 `verify`（`id-token: write`、`attestations: write`，只在 PASS 時簽章）；`attest-sigtest.yml` 的 `sigtest` | 兩個都可以加 `environment: s2-attest`。哪些要加，見 Q1 |
| 既有的分支限制 | `attest.yml` 的 `execute`、`attest-sigtest.yml` 的 `sigtest` 都有 `if: github.ref == 'refs/heads/main'`；`verify` 依賴 `execute` | 在目前的 workflow 中，從其他分支觸發時 job 會先被 `if` 略過，**不會**走到 Environment 的檢查。Environment 只在 workflow 檔被改壞（例如拿掉 `if`）時才是第二道保護。見 §4 的驗證限制 |
| Environment 不存在時的行為 | 據審查者先前核對的官方文件：job 引用不存在的 Environment 時，平台會**自動建立一個沒有保護規則的** Environment | **負責人必須在合併 C-3 的 PR 之前**，先在 Settings 建立並設定好 `s2-attest`（§3） |
| OIDC 與 Sigstore 憑證 | job 引用 Environment 後，OIDC token 的 `sub` 會變成 `repo:…:environment:s2-attest`（據官方文件，**待審查者確認**）。C-2 的驗證只使用 `buildSignerURI`、`buildSignerDigest`、`sourceRepositoryURI`／`Ref` 與可信時間，不使用 `sub` | 預期**不影響** C-2 的驗證結果，但不能假定。要用一次真實簽章確認（Q3） |
| 錨定 | `attest.yml`、`attest-sigtest.yml` 都受保護 | 修改後錨定改變，需要負責人重新核准 |
| `attest-sigtest.yml` 的 blob | 測試身分政策 `SIGTEST-001` 核准的是 `d8820ae8…` | 若在 `attest-sigtest.yml` 加上 Environment，blob 會改變，需要新的測試身分紀錄 `SIGTEST-002`（Q3） |

## 2. 變更內容（依 Q1 的建議）

1. `.github/workflows/attest.yml`：`verify` job 加上 `environment: s2-attest`。
   - `execute` 不加：它沒有簽章權限，加上去只會讓每次執行多一道部署紀錄；
   - `availability` 不加：它只有 `actions: read`。
2. `.github/workflows/attest-sigtest.yml`：`sigtest` job 加上 `environment: s2-attest`（若 Q1 選擇包含）。
3. `docs/stage2/S2B2-SIGTEST-POLICY.json`（若 Q1、Q3 都選擇包含）：
   - 新增 `SIGTEST-002`，核准新的 `attest-sigtest.yml` blob；
   - `SIGTEST-001` 改為 `revoked`，`validTo` 設為 C-3 合併後的時間，`invalidateIssued: false`，屬於正常退役：run 45121359992 的既有簽章在它簽章的時間仍然有效；
   - 實際的 `validTo` 時間，在負責人核准合併時一併確認。
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
7. 完成後，把 Environment 頁面的截圖交給審查者，畫面要顯示 deployment branch rule 與 reviewers 的設定。也可以提供 `GET /repos/{owner}/{repo}/environments/s2-attest` 的回應。

## 4. 驗證

| 層級 | 方法 | 誰執行 |
|---|---|---|
| 檔案 | `repo_policy` 測試（§2-4）；錨定涵蓋 | Claude；CI |
| 設定 | §3-7 的截圖或 API 回應：只允許 `main`；沒有 secrets／variables | 負責人提供，審查者核對 |
| hosted（正向） | 合併後，push 到 main 自動觸發的 `attest.yml` run：`verify` job 的頁面顯示 Environment `s2-attest` 的部署紀錄，而且照常完成（結果仍是 UNATTESTED，不簽章） | 平台自動執行；Claude 讀 log，審查者核對 |
| hosted（Q3，可選） | 由負責人手動觸發一次 `attest-sigtest.yml`（已加 Environment），再由第三方用 C-2 的 CLI 驗證：正向 `SIGTEST_IDENTITY_ACCEPTED`。並記錄 Environment 是否出現在 Sigstore 證據中、出現在哪個欄位（只記錄，不作為驗收條件） | 負責人觸發；第三方驗證 |
| 負向（**限制**） | 在目前的 workflow 中，從其他分支觸發會先被 job 的 `if` 略過，**無法**在不修改受保護 workflow 的情況下，觀察到 Environment 擋下執行。本計畫**不**為了測試而建立弱化的 workflow。Environment 的分支限制以 §3 的設定證據為準，標為「設定已核對，未以實際阻擋驗證」 | — |

## 5. 交付順序

1. 審查本計畫，負責人決定 §6 的問題。
2. 負責人依 §3 建立 `s2-attest`，提供設定證據。
3. Claude 實作 §2，送 PR 與審查證據包（L3：修改簽章 workflow，錨定改變）。
4. ChatGPT 審查；負責人核准錨定並決定是否合併。
5. 合併後：
   - 讀取自動觸發的 `attest.yml` run，確認 `verify` 有 Environment 的部署紀錄；
   - 若選擇 Q3，執行 sigtest 與第三方驗證；
   - 記錄 C-3 完成。

## 6. 需要負責人決定

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
