# 停服切换与 9 机器人协作验收

本文记录不依赖 AI 持续监视的停服迁移、回滚和协作验收入口。历史 Workspace 的正式
JSON → SQLite 切换是离线维护命令；服务必须已经完全停止，命令不会边迁移边服务用户。

## 一、历史 Workspace → 完整 SQLite authority 停服迁移

### 正式迁移命令

1. 先在启动器或终端中停止服务，并确认没有其他设备仍在写这个 Workspace。
2. 选定一个不会改变的 migration ID；失败恢复、重试和回滚都继续使用它。
3. 使用绝对 Workspace 路径和绝对报告目录执行：

```bash
.venv/bin/python scripts/storage/migrate_workspace_sqlite_authority.py migrate \
  --base-url http://127.0.0.1:3001 \
  --workspace "/absolute/path/to/workspace" \
  --migration-id sqlite-cutover-YYYYMMDD \
  --report-directory "/absolute/path/to/migration-reports" \
  --confirm-service-stopped
```

`--confirm-service-stopped` 是明确的停服确认，不是自动停服开关。CLI 先确认指定 localhost
端口没有监听，再尝试取得 Workspace 的独占写锁；任一检查失败都停止。它还要求：

- JSON authority 时，`generation-runs.json` 中不存在 queued/running/pending/recovering 等非终态 Run；早期 SQLite authority 时，先检查正式 `generation-runs.sqlite3`，且在通过前不读取 legacy JSON；
- Workspace 是尚未切换的 JSON authority，或是早期 controlled cutover 已发布双库、但三个 Generation JSON 尚未退休的 SQLite authority；
- Workspace identity、`data/`、`assets/` 和所有迁移来源均可读；
- `generation-history.json`、`generation-effects.json` 与 `generation-runs.json` 是有效 JSON；
- 每个待迁入输出都能映射到真实 Managed Media。

对于尚未切换的 JSON authority，迁移按下面的固定顺序执行，直到 authority manifest 发布前
都不会改变当前 JSON authority：

1. 停服与非终态 Run 预检；
2. 把每个来源逐文件复制到 `data/recovery/<migration-id>/source/` 并记录 SHA-256；
3. 只向 `staging/` 内的 SQLite 双库导入 Canvas、Canvas Log、Global History、Generation Run
   lifecycle 与 History / Notification Publication Receipt；
4. 验证来源和目标记录数、稳定 ID、Run 引用、Managed Media、SQLite integrity 与 foreign key；
5. 原子替换正式双库，最后发布 `storage-authority.json`；
6. manifest 已发布后，才把三个 legacy JSON 逐字节归档到
   `data/recovery/<migration-id>/legacy/`。

全局 History 保留用户可见顺序、时间、Provider、Model、媒体类型和输出 URL。缺失 ID 使用可
重复计算的确定性 ID；显式 ID 冲突会停止，重复执行不会重复导入或覆盖更晚记录。已完成的
History / Notification 回执直接标记完成，避免重启后重复发布。pending 只有在 durable Run 和
可重建输出都存在时才进入待处理；否则 preparation report 会列出人工处理项并停止。

若报告确认某条旧 Global History 引用的 Managed Media 已永久丢失，且操作人决定保留审计但
不再把这条断链记录迁入 SQLite，必须逐条列出稳定 History ID 并二次确认：

```bash
.venv/bin/python scripts/storage/migrate_workspace_sqlite_authority.py migrate \
  --base-url http://127.0.0.1:3001 \
  --workspace "/absolute/path/to/workspace" \
  --migration-id sqlite-cutover-YYYYMMDD \
  --report-directory "/absolute/path/to/migration-reports" \
  --confirm-service-stopped \
  --quarantine-missing-history-id "history:run:EXACT_RUN_ID" \
  --confirm-quarantine-broken-history
```

该入口只适用于早期 SQLite Phase 2 upgrade，不适用于普通 JSON → SQLite 或 rollback。迁移把
精确 ID、Workspace / migration identity、确认原因写入 `operator-resolution.json`；只有媒体验证
确实失败的同 ID 记录才会进入 quarantine。未知 ID、重复 ID、仍可验证的媒体或任何未列出的
缺失记录都会继续阻止发布。原始 `generation-history.json` 仍按 SHA-256 复制并逐字节归档，
preparation report 记录 resolution 摘要与 quarantine 明细，回滚会恢复包含这些记录的完整 JSON。

成功报告位于
`/absolute/path/to/migration-reports/<migration-id>/offline-migration-report.json`；Workspace 内的
`recovery-manifest.json`、`preparation-report.json` 和 legacy archive report 记录逐文件摘要与各项
Gate。持久报告只写 Workspace 相对路径，不保存管理员密码。首次部署不会删除 `legacy/` 归档。

如果 staging 阶段失败，来源和当前 authority 保持不变；修正来源后用同一 migration ID 重试。
如果进程恰好在 manifest 发布后、legacy 归档前中断，同一命令会先验证已发布双库，再幂等完成
归档，不重新导入。

### 早期 SQLite cutover 的 Phase 2 升级

同一个 `migrate` 命令会自动识别早期 `storage-authority.json`：这类 Workspace 已经以 SQLite
保存 Canvas / Generation Run，但 Global History 和 History / Notification 回执仍留在 JSON。
升级不会先撤回到 JSON，也不会重建或覆盖 Canvas 数据库，而是：

1. 先检查正式 SQLite 中没有非终态 Run，再读取 legacy JSON；
2. 精确复制旧 manifest、正式数据库、WAL / SHM 和三个 Generation JSON，并记录 SHA-256；
3. 从正式 Generation Run 数据库建立 staging，在副本中升级 schema，补入缺失的终态 Run、
   Global History 和 Publication Receipt；同 ID 已存在时始终保留当前 SQLite 权威记录；
4. 缺失 Run 若仍含 `data:` 内嵌输入，会先验证 MIME、大小和内容签名，再按 SHA-256 确定名称写入
   recovery staging；正式发布时才复制到 `assets/input/migrations/<migration-id>/` 并把 Run 改为
   Workspace 相对 URL；
5. 验证后原子替换 Generation Run 数据库，最后提交包含 `previous_migration_id` 的新 manifest，
   再精确归档三个 JSON。

若数据库已替换但新 manifest 尚未提交时进程中断，同一 migration ID 会根据 publication intent
继续完成；普通失败则自动恢复旧数据库和旧 manifest。该升级的 `rollback` 恢复的是精确的旧
SQLite 数据库、旧 manifest 与三个 JSON，而不是退回可能过期的 Canvas JSON。若升级后已经有
新的业务写入，自动回滚会拒绝覆盖新数据，要求人工处理。
由迁移创建的内嵌输入文件会记录路径、SHA-256、大小和 MIME；普通发布失败会自动清理，崩溃后
可用同一 migration ID 验证并续跑，回滚时则移入该 migration 的 `rollback/retired-materialized-media/`
归档。迁移前已存在且摘要相同的文件不会由回滚删除。

### 回滚演练

先停止新版本服务，再使用原 migration ID：

```bash
.venv/bin/python scripts/storage/migrate_workspace_sqlite_authority.py rollback \
  --base-url http://127.0.0.1:3001 \
  --workspace "/absolute/path/to/workspace" \
  --migration-id sqlite-cutover-YYYYMMDD \
  --report-directory "/absolute/path/to/migration-reports" \
  --confirm-service-stopped
```

JSON → SQLite 切换的回滚先从已校验归档逐字节恢复三个 generation JSON，确认旧版本来源已持久化后，才撤回
`storage-authority.json`。正式 SQLite、WAL、SHM 和 manifest 不删除，而是移到
`data/recovery/<migration-id>/rollback/retired-sqlite-authority/`。命令最后以 JSON authority
重新组合并验证，报告 `old_version_restart_ready=true`；此时旧版本可以重新启动。该流程可以
反复演练，同一 migration ID 也可在回滚后重新发布 SQLite。

旧 `run_controlled_sqlite_migration.py` 仍供已有自动化兼容，但它复用同一完整 migration core，
只有在 Global History、Publication Receipt 和 legacy archive 都验证后才报告成功。新部署以
上面的离线入口为准。

### 仅遗漏 Canvas Log 的旧版 SQLite 补迁

如果 Workspace 的 Global History / Publication Receipt 已经完整迁入 SQLite，只遗漏 Canvas JSON
`logs`，才使用下面的专用一次性回填。如果三个 Generation JSON 仍在运行时目录，必须使用上面
的正式 `migrate` 命令完成早期 SQLite Phase 2 升级，不能只跑 Canvas Log backfill。

```bash
.venv/bin/python scripts/storage/backfill_sqlite_generation_history.py \
  --base-url http://127.0.0.1:3001 \
  --workspace "/absolute/path/to/workspace" \
  --migration-id sqlite-history-backfill-YYYYMMDD \
  --confirm-service-stopped
```

脚本先用 SQLite Backup API 创建当前数据库的完整恢复副本，再把旧日志写入 staging 副本并验证，最后以单个 SQLite 事务写入正式库。它不会修改 `storage-authority.json`、Canvas Revision 或撤销历史。设备同步产生的 Canvas 冲突副本会按内部 Canvas ID 合并；同一日志 ID 内容完全相同时只导入一份，内容不同时停止并要求人工判断。成功事务会在 SQLite `store_metadata` 写入一次性标记，避免换一个 migration ID 重复导入。

审计报告位于 `<workspace>/data/recovery/<migration-id>/generation-history-backfill-report.json`，同时保留 `canvas-content.before.sqlite3`、原 Canvas JSON 和 authority manifest。验收要求 `starting_log_count + source_log_count = final_log_count`、`imported_log_count = source_log_count` 且 SQLite integrity 与 foreign-key 检查通过。此工具只补 Canvas Log，不能代替上述包含 Global History、Run 和 Publication Receipt 的完整 JSON authority 迁移。

## 二、迁移后的 9 机器人 + 1 人工验收

默认脚本创建 9 个机器人会话、1 张临时 Smart Canvas，并运行 120 轮协作 Mutation。账号容量充足时，每个机器人使用独立临时账号；容量不足时，脚本会透明报告实际临时账号数并把 9 个会话分配给可用账号，不会修改生产账号上限或现有用户。机器人不会调用生成 API，也不会更改 Provider 设置；第 10 位参与者由管理员在浏览器中人工操作和生成。

### macOS 双击入口

Finder 中双击 `admin-tools/多人协作性能测试-macOS.command` 即可启动。入口会依次询问服务端口、管理员账号、可选的 Canvas ID、机器人轮数，以及是否要求人工完成一次生成。默认使用 3001 端口、9 个机器人和 120 轮；已有 Canvas ID 留空时会新建测试画布。

登录成功并准备好机器人后，入口会自动用默认浏览器打开测试画布，但仍会等到人工按 Enter 才开始机器人操作。管理员密码由 Python CLI 隐藏读取；入口文件、命令行和报告均不保存密码。机器人始终不会发起 AI 生成。

首次可在终端运行下面的预览命令，只检查入口配置，不连接服务：

```bash
./admin-tools/多人协作性能测试-macOS.command --dry-run
```

```bash
.venv/bin/python scripts/performance/run_live_collaboration_acceptance.py \
  --base-url http://127.0.0.1:3001 \
  --admin-username YOUR_ADMIN_USERNAME \
  --robot-count 9 \
  --robot-rounds 120 \
  --round-interval-seconds 1 \
  --require-human-generation \
  --report-root /private/tmp/ic-live-acceptance
```

执行流程：

1. 输入管理员密码；
2. 脚本创建临时测试 Canvas、9 个机器人会话及容量允许的独立临时账号；
3. 终端打印测试 Canvas 地址；
4. 人工打开地址，按 Enter 后机器人开始；
5. 人工在同一 Canvas 操作并完成一次生成；
6. 脚本验证机器人 Mutation 数量、P50/P95/P99、最终 Node 投影和人工 Generation Output；
7. 输出 `summary.json`、`metrics.csv` 与 `cleanup.json`。

复用已经存在的 Smart Canvas 时，传入其明确 ID。下面示例执行 241 轮
（约 4 分钟）：第 1 轮创建 9 个测试 Node，后续 240 轮恰好产生 2160 次
位置 Mutation，并显式使用正式 150/300 ms P95/P99 Gate：

```bash
.venv/bin/python scripts/performance/run_live_collaboration_acceptance.py \
  --base-url http://127.0.0.1:3001 \
  --admin-username YOUR_ADMIN_USERNAME \
  --canvas-id EXISTING_CANVAS_ID \
  --robot-count 9 \
  --robot-rounds 241 \
  --round-interval-seconds 1 \
  --ack-p95-gate-ms 150 \
  --ack-p99-gate-ms 300 \
  --require-human-generation \
  --human-generation-grace-seconds 180 \
  --report-root /private/tmp/ic-live-acceptance
```

复用模式不会把既有 Canvas 加入 cleanup allow-list；每次运行会生成唯一的
Mutation 与 Node 命名空间。人工生成只按测试开始后新增的 Generation Output
判定，既有输出不会造成误通过。

机器人阶段结束时，如果人工 Generation Run 已启动但尚未写回，脚本会在
`--human-generation-grace-seconds` 指定的宽限期内轮询公开 Canvas 快照；默认
180 秒。该等待不延长机器人负载，也不会发起 Generation Run。

Generation Output 等非 Mutation 写入可能使 Canvas 服务以 4409 要求实时客户端
重新同步。机器人会和浏览器一样重新连接、读取最新 Canvas Snapshot，并使用原
operation ID 继续未确认操作；报告通过 `realtime_resync_count` 和
`realtime_close_code_counts` 记录重同步。权限、会话或容量等不可恢复关闭不会被
重试，报告会保留关闭码以及断开前已确认的 `metrics.csv` 样本。

首轮建议不加 `--cleanup-test-canvas`，保留测试 Canvas 和人工 Generation Output 供视觉检查；机器人 session 和账号仍按公开创建响应中的精确 ID 清理。确认视觉结果后可手动删除 Canvas。后续纯自动回归可以增加 `--start-immediately --cleanup-test-canvas`。

如果结束时仍有活动生成，脚本不会删除测试 Canvas 或机器人账号，以免破坏尚未完成的 Generation Run；报告会保留精确 allow-list，待生成终态后再处理。

## 报告口径

- 机器人层通过：预期 Mutation 全部确认、最终 9 个机器人 Node 齐全、P95 不超过默认 500 ms；
- 人工生成层：加 `--require-human-generation` 时，最终 Canvas 必须观察到至少一个相对测试起点新增的 Generation Output URL；
- `generation_requests_submitted=0` 永远表示机器人没有发起生成，不代表人工没有生成；
- 脚本不删除任何生成媒体，也不按目录差集猜测清理对象。
