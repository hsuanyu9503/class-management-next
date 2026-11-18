# Claude × GitHub Starter Kit v1.2｜Stage 0 接手說明

## L1 文件 PR（不得直接合併到正式產品資料模型）

1. 在**獨立的 PoC repository／分支**，加入此 Stage 0 包的契約、fixtures、校驗器與文件。
2. 本階段不加入 Firebase、Supabase 或正式學生資料憑證；不建立 cloud project，不改 Homework-manager 正式資料。
3. 在獨立分支執行 `npm run stage0:validate`；記錄 commit SHA 和摘要，生成 L1 審查證據。
4. 使用現有 Starter Kit v1.2 的 protected main／CI／證據包／ChatGPT 獨立審查流程。不得覆蓋既有的 `.github/workflows`。
5. CI 參考檔放在 `ci-example/`，需由維護者確認權限與現有工作流程相容後，才另行移至 `.github/workflows/`。
6. 確認 `Node 22` 在執行環境具備相容性；若改版本，須另外留存重跑證據。
7. L1 審查完成後，Stage 1 才建立與執行測試器；36項 adapter PoC 狀態保持 `NOT_RUN`。

## PR 驗收範本

- [ ] 36測試 ID/fixture未被悄悄改寫，並保存 SHA-256。
- [ ] 20 P0 / 16 P1；Firebase/PostgreSQL 仍全 `NOT_RUN`。
- [ ] 無真實個資、`.env`、service_role、service account 或 token。
- [ ] `npm run stage0:validate` PASS；附執行記錄與 commit SHA。
- [ ] 來源資料關聯 `SC01-20261116`/`A17-20261117` 保持隔離。
- [ ] 無雲端計費操作或正式學生資料庫寫入。
- [ ] 獨立審查結論明確：Stage0 文檔完成 ≠ 雙後端驗證完成。
