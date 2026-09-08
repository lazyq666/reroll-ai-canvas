# 双设备共用单一云端 Workspace：可行性调研

- Status: Research / Feasibility；不是已交付功能、Current Spec 或已接受 ADR。
- Research date: 2026-09-07
- 范围：官方资料与仓库架构核对；未读取用户数据库、诊断 Node 缺失、迁移数据或部署服务。

后续澄清：用户选择两台本地设备轮换使用，要求仅共享记录上云、媒体继续 OneDrive，并提供可选开关。下面保留首轮集中部署比较；当前讨论方向见[可选云端记录草案](../active/2026-09-07-optional-cloud-records-onedrive-media-spec.md)。

## 结论

可行。针对两台设备，优先评估在一台常驻主机运行一套 Reroll，两端浏览器访问同一个地址。SQLite 与 Managed Media 保存在该主机的持久磁盘，数据库读写只在主机上执行。SQLite 官方明确支持这种通过代理转发远程请求的方式。[SQLite 网络访问建议](https://www.sqlite.org/useovernet.html)

“唯一云端”应是唯一接受编辑的权威服务，同时保留独立备份。云主机符合目标；常驻电脑加私网访问也可实现，但依赖该设备持续开机、联网。数据库磁盘必须由 Reroll 所在主机本地访问。

## OneDrive 风险与证据边界

OneDrive 自动同步设备和云端之间的文件变化。两台设备各运行 Reroll、各写本地同步副本，是两个独立写入端；文件同步不能替代共同数据库服务的事务协调。这是根据产品机制作出的架构判断。[Microsoft 文件同步说明](https://support.microsoft.com/en-us/onedrive/sync-your-computer-s-files-and-folders-with-onedrive)

SQLite 的 WAL 是持久状态的一部分，主数据库与其 WAL 分离可能丢失已提交事务或损坏数据库；运行中直接复制文件也可能产生不一致副本。因此数据库版本覆盖、日志不同步是需要避免的风险，尚不能认定为本次 Node 缺失的确切原因。OneDrive 本地副本同步也不能直接等同于 SQLite 文档所说的 NFS／SMB 网络文件系统限制。[WAL 文档](https://www.sqlite.org/wal.html)、[备份风险](https://www.sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active)

## 与现有项目的衔接

当前架构适合先集中部署：

- 部署要求单 Uvicorn worker，不支持多实例／跨服务器同步；公网部署另需 HTTPS 等处理。[README](../../README.md)
- Canvas 使用本地 SQLite、WAL 与 `synchronous=FULL`；存储组合只有 `json`／`sqlite` 模式。[Canvas 存储](../../backend/infinite_canvas/canvas_store.py)、[存储组合](../../backend/infinite_canvas/workspace_storage_composition.py)
- Workspace 包括画布和生成数据库、存储权威声明及媒体；Instance 账号与 Device 秘密是独立边界。[存储布局](../current/storage-layout-and-migration.md)、[Workspace ADR](../adr/0001-workspace-data-boundary.md)
- 当前占用保护依赖本机文件锁，不能协调异机写入；同一服务内已有 Canvas Revision、Operation ID 去重和 WebSocket 同步。[Workspace 实现](../../backend/infinite_canvas/workspace.py)、[Canvas Sync 合同](../current/canvas-sync-implementation.md)

只改远程数据库、继续运行两套 Reroll，仍需解决广播、任务与权限协调，不能视为已完成云端协作。

## 路线选择

| 方案 | 判断与限制 |
| --- | --- |
| 云主机上的 Reroll + SQLite + 媒体 | 双设备的优先方案；主要处理部署、完整搬迁、身份、生成配置与备份 |
| 常驻电脑 + Tailscale | 已有常驻设备时可先验证；可用性取决于设备和网络 |
| 中央后端 + PostgreSQL + 对象存储 | 适合后续云端产品化；需要数据、媒体引用、恢复与服务协调改造 |

Tailscale Serve 可经 HTTPS 向同一 tailnet 分享服务，并应用访问控制；它提供连接，数据仍在 Reroll 主机。网络可能使用直连或中继，中继性能通常较低，需在两处网络实测。[Serve](https://tailscale.com/docs/features/tailscale-serve)、[连接类型](https://tailscale.com/docs/reference/connection-types)

Supabase 可作为 PostgreSQL 与对象存储的例子，但不会自动适配现有应用。其数据库备份不包含 Storage 实际对象，媒体需要独立覆盖。本调研不承诺价格、额度或地区可达性。[数据库](https://supabase.com/docs/guides/database/overview)、[Storage](https://supabase.com/docs/guides/storage)、[备份范围](https://supabase.com/docs/guides/platform/backups)

## 后续验收边界

迁移应覆盖完整 Workspace，并核对中央账号与画布所有者、配置服务所需秘密。整套服务上云会改变本机 CLI、Dreamina 登录与 ComfyUI 的执行环境；若仍要在个人电脑执行生成，需要另行设计执行代理。

唯一在线服务依赖网络，离线编辑与自动合并需另行评估。验收至少覆盖并发编辑、刷新、断线重连、重试去重、生成完成后的 Node 更新和媒体读取。

SQLite 可用 Online Backup API 或 `VACUUM INTO` 生成一致快照，再同步已完成快照到 OneDrive；不要让另一实例写入备份。数据库与媒体都应纳入恢复演练。[SQLite Backup API](https://www.sqlite.org/backup.html)
