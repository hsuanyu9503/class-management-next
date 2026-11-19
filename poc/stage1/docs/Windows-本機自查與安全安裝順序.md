# Windows 開發機｜Stage 0 自查說明

## 1. 先不要安裝任何東西，執行現況檢查

請在 **Windows PowerShell** 開啟 Stage 0 資料夾：

```powershell
node --version
npm --version
git --version
java -version
firebase --version
supabase --version
docker --version
gh --version
```

某些指令出現「找不到」，**只表示尚未提供這個 CLI，不代表整台電腦無法開發**。第一階段 Node + npm + Git 對應 `npm run stage0:validate`；Java 用於日後 Firebase 模擬器。

## 2. 基準驗證

```powershell
npm run stage0:validate
npm run stage0:env
```

如果 `node` 尚未安裝，先按 [Node.js 官網](https://nodejs.org/) 指引安裝受支援的 LTS。基準包在隔離環境實際使用 Node 22，`.nvmrc` 固定 22 作為測試可比性基準；不要單純將原本 Windows Node 版本視為已通過。

## 3. 後續需要模擬器時才安裝

- **Firebase**：依 [官方 CLI 指南](https://firebase.google.com/docs/cli) 檢查 Node.js 需求，再依 [Local Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure) 配置模擬器；不啟用正式學生資料或雲端計費。
- **PostgreSQL／Supabase**：依 [官方本機開發指南](https://supabase.com/docs/guides/local-development) 安裝 Supabase CLI；在 Windows 上通常會搭配 Docker Desktop。若無法安裝 Docker，須另行評估安全且可重現的 PostgreSQL 測試環境，不能默默跳過 PostgreSQL PoC。
- **GitHub／Starter Kit v1.2**：在準備進行 L1 文件 PR 時再檢查 GitHub CLI／Git 連線。未經審查，不要把 PoC 與 Homework-manager 的正式資料或環境變數合併。

## 4. 不要做的事情

不要執行 `firebase login`／`supabase link` 指向正式專案；不要上傳真實學生姓名、請假原因或任何校務資料。不要把 `.env`、管理員 JSON 金鑰、service_role、Firebase service account 上傳 GitHub。這份 Stage 0 不需要任何雲端憑證，也不應觸發計費。

## 5. 回傳給審查者的最小證據

提供 `npm run stage0:validate` 摘要（18項皆通過／失敗詳情）與 `npm run stage0:env` 中的工具名稱、版本及狀態即可。**請不要附上私密路徑、帳號、GitHub Token 或學生資料。**
