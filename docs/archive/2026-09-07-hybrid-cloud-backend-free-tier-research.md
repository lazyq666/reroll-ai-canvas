# 本地 Reroll + OneDrive 媒体 + 云端结构数据：免费后端调研

- Status: Research / Feasibility；不是 Current Spec、已接受 ADR 或已交付能力。
- 官方资料核对日期：2026-09-07。免费档可能调整，实际账号额度与两处网络可达性仍需验证。
- 用户范围：两台设备保留本地 Reroll，**交替使用**；媒体继续通过 OneDrive 同步；共享结构数据可选择使用云端权威。首版不要求同时编辑或实时协作。
- 本文前半为选型调研；后续经用户授权完成云端接入前探针，见文末。尚未接线生产运行时或迁移用户数据。

## 选型判断

优先验证 **Turso 的远程 libSQL 连接**，因为它保留 SQLite 系列 SQL 语义，并提供 Python 远程客户端。PostgreSQL 路线可选 Neon 或 Supabase，适合作为兼容性验证失败后的候选，但要迁移 SQL 与驱动。Cloudflare D1 + Workers 排在后面：免费资源可用，不过现有跨 Python 业务逻辑的事务需要适配，通常还要开发云端 API。此排序是结合项目约束的工程判断，不是供应商承诺。

## 免费档关键额度

| 服务 | 结构数据与请求额度 | 与交替使用相关的限制 |
| --- | --- | --- |
| [Turso](https://turso.tech/pricing) | 总存储 5 GB；每月读取 5 亿行、写入 1000 万行；另列每月 Sync 3 GB | Sync 是数据库同步流量，不应误写为所有 SQL 查询的统一 egress 额度；免费档 PITR 为 1 天。无使用量实测，不能承诺一定够用 |
| [Supabase](https://supabase.com/pricing) | 每项目数据库 500 MB；每月 egress 5 GB；API 请求数不限 | 免费项目闲置一周会暂停，最多 2 个活跃项目；免费档不含自动数据库备份。API 次数不限仍受计算与流量约束 |
| [Neon](https://neon.com/pricing) | 每项目 0.5 GB；每月每项目 100 CU-hours；公网出站每月 5 GB | 免费档闲置 5 分钟自动休眠，查询时自动唤醒；CU-hours 是计算量，不是请求次数 |
| [Cloudflare D1](https://developers.cloudflare.com/d1/platform/pricing/) | 每天读 500 万行、写 10 万行；账户总存储 5 GB | **免费单库上限为 500 MB**，不是单库 5 GB。另有 Workers API 网关额度，见下文 |

这些额度均仅用于结构数据。媒体继续放在 OneDrive，不计入本方案的云对象存储预算；媒体传输费用也不包含在上表。读／写“行数”与用户点击次数不同，扫描、索引和批量更新都可能放大计量。[D1 计量说明](https://developers.cloudflare.com/d1/platform/pricing/)、[Turso 使用量说明](https://docs.turso.tech/help/usage-and-billing)

## 适配和运行限制

**Turso。** 官方 Python 快速开始明确展示 `libsql.connect(database=远程地址, auth_token=...)`，不需要本地副本。其 SDK 目录区分了远程 libSQL 与本地 `pyturso`／Sync；不要把新的离线 push/pull 同步能力自动当成本项目首版方案。[Python 远程连接](https://docs.turso.tech/sdk/python/quickstart)、[SDK 选用](https://docs.turso.tech/sdk/introduction)

官方 libSQL 交互事务说明记录了 5 秒超时，网络往返多的读—计算—写操作需要实测。现有 `sqlite3` 的事务、`row_factory`、`PRAGMA`、`executescript` 等用法也必须逐项验证，不能承诺只换连接字符串即可。Turso 公共价格表没有单独给出通用 SQL egress 或适用于全部 SDK 的请求大小／CPU 上限，本调研不推断其无限制。[事务说明](https://docs.turso.tech/sdk/ts/reference)、[价格表](https://turso.tech/pricing)

**Supabase / Neon。** 两者均为 PostgreSQL，无法直接读取原 SQLite 文件或复用全部 SQLite SQL。可保留本地 Python 业务执行，但要适配连接、事务、数据类型与迁移。Neon 的休眠后唤醒会增加首次查询延迟，频繁轮询或后台活动会延长计算活跃时间。[Supabase 数据库](https://supabase.com/docs/guides/database/overview)、[Neon 休眠](https://neon.com/docs/introduction/scale-to-zero)、[Neon 计算管理](https://neon.com/docs/manage/endpoints/)

Supabase 免费 Realtime 包含 200 峰值连接、每月 200 万消息；它不是首版交替使用需求的必要组件。首版可在打开和恢复连接时读取云端最新状态。Turso 的数据库副本同步、Neon 的读副本和 D1 的 Session 一致性也不能直接当成 Reroll 的浏览器实时协作实现。[Supabase 额度](https://supabase.com/docs/guides/platform/billing-on-supabase)、[D1 Session](https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession)

**D1 + Workers。** D1 使用 SQLite SQL 语义，API 的 `batch()` 支持整批失败回滚；这种预先构造批语句的方式并不等于本地 Python 打开事务、执行查询、计算后再更新的连接合同。应专门验证复杂 Canvas Mutation 和条件写入。[D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

免费 Worker 每天 10 万请求、每次调用 10 ms CPU；D1 单行／字符串／BLOB 上限 2 MB，单条查询最多 100 个绑定参数，查询最长 30 秒。D1 无单独 egress 收费，也没有按活跃计算小时计费；这不构成低延迟保证。超出 D1 免费日读写额度会返回错误，UTC 零点重置。[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)、[D1 定价](https://developers.cloudflare.com/d1/platform/pricing/)

## 官方资料存在的差异

- **Turso 闲置行为**：2025-03-19 的免费档发布说明称不再冷启动／休眠，但现行 CLI `group unarchive` 页面仍写免费数据库闲置 10 天归档。本调研无法消除两页差异；落地时要核对所选数据库部署与账号实际行为，不能保证“永不休眠”。[发布说明](https://turso.tech/blog/turso-cloud-debuts-the-new-developer-plan)、[CLI 文档](https://docs.turso.tech/cli/group/unarchive)
- **Neon 额度**：旧官方博客仍残留 50 CU-hours 或较少项目数；当前价格页及 2026-09-01 官方文章使用每项目 100 CU-hours 和 0.5 GB。本表采用后者，不沿用旧值。[旧博客](https://neon.com/blog/how-to-make-the-most-of-neons-free-plan)、[近期官方说明](https://neon.com/blog/building-patterns-unlocked-by-scale-to-zero)

## 首版设计建议

将远程库作为结构数据的唯一权威，设备切换时重新读取；云端保存写入租约与递增代次，并在提交时校验，防止睡眠后恢复的旧设备或后台生成回调继续写入。断网或租约失效时停止提交，不自动回退为另一份可写本地权威。这些是待设计和验证的项目机制，供应商数据库不会自动替应用实现。

媒体可能晚于云端结构数据到达另一设备，应保留 Node 和媒体引用，并显示同步等待状态；不能把暂时找不到文件解释为删除。免费额度评估需要测量实际库大小、单次画布编辑的行读写量、打开画布的出站数据和异网事务耗时，再决定供应商。

## 实施补充：Python 驱动与平台兼容性

同日进一步核对官方发布包，并在独立 `/private/tmp/reroll-turso-driver-probe` Python 3.12 环境做本地探针；没有改项目虚拟环境，也没有 Turso 云账号／数据库凭据。**以下结果不等于真实云端读写或 Windows 运行验收通过。**

当前官方文档区分两种云数据库：SQLite fork 的 **libSQL** 配 `libsql`，重写引擎 **Turso Database** 配 `turso_serverless`；两者不能仅凭同属 Turso 就互换驱动。此项明确了前文“远程 libSQL”的具体含义。[官方 Python 快速开始](https://docs.turso.tech/sdk/python/quickstart)

| 发布包 | 平台证据与本地发现 |
| --- | --- |
| `libsql==0.1.11` | PyPI 提供 CPython 3.12 的 Windows amd64、macOS x86_64／arm64 wheel；macOS arm64 安装成功。并非完整 DB-API 替换，见下表 |
| `turso-serverless==0.1.0` | Python ≥3.10，`py3-none-any` 纯 Python wheel，无原生扩展；适合跨平台分发，但对应新引擎，SQL 迁移仍需验证 |
| `libsql-client==0.3.1` | 旧 SDK 仓库已归档；其 HTTP 模式不支持交互事务，不建议作为新集成依赖 |

来源：[libsql 发布元数据](https://pypi.org/pypi/libsql/0.1.11/json)、[turso-serverless 发布元数据](https://pypi.org/pypi/turso-serverless/0.1.0/json)、[已归档旧 SDK](https://github.com/tursodatabase/libsql-client-py)。Windows 证据只覆盖可安装包的存在，未在 Windows 实机执行。

`libsql==0.1.11` 本地引擎探针结果：

| 项目需要的接口／行为 | 结果 |
| --- | --- |
| Canvas 与 Generation Run 初始化 SQL | 分别建立 13 和 10 张表，`integrity_check` 返回 `ok` |
| `json_extract`、显式 `BEGIN IMMEDIATE`、提交／回滚、`cursor.description`、列表形式 `executemany` | 基础案例通过 |
| `connection.row_factory = sqlite3.Row` | 不支持此属性；需要返回行适配 |
| 遍历 Cursor／生成器形式 `executemany` | 不支持；需要包装和参数物化 |
| 唯一键冲突与 SQL 错误 | 抛 `ValueError`，不匹配项目捕获的 `sqlite3.IntegrityError` |
| `Connection.executescript` 遇到错误 | 静默返回；`Cursor.executescript` 才传播错误 |
| 大整数参数 | 超过 32 位时可能经浮点编码；探针中的毫秒时间戳 `typeof(?)` 返回 `real`，通用 64 位整数精度不能据此保证 |

源码印证了异常降为 `ValueError`、连接级脚本丢弃错误和 `i32` 失败后尝试 `f64` 的转换顺序。[官方 libsql Python 源码](https://github.com/tursodatabase/libsql-python/blob/main/src/lib.rs)

`turso_serverless` 自带 `Row` 支持字段名访问，但不能直接传 `sqlite3.Row`；其异常也不是 `sqlite3` 异常子类。使用脚本化协议响应的本地探针验证了跨 HTTP 请求保留 baton、根据服务器 autocommit 响应追踪事务、脚本走 sequence、64 位整数结果保真，以及传输失败时抛错并清除旧 stream、不会自行重试。该探针只验证驱动合同，没有模拟或验证真实 Turso 数据库引擎。[官方 serverless 源码与事务示例](https://github.com/tursodatabase/turso/tree/main/serverless/python)

云端还有独立限制：`busy_timeout` 无效，不能设置 `journal_mode`。本地 WAL／PRAGMA 探针通过不能当作远端支持证据。[Turso Cloud 限制](https://docs.turso.tech/cloud/limitations)

**实施建议**：为减少原有 SQL 语义变化，首选仍是云端 **libSQL 引擎**。不存在本次已验证、可直接替换 `sqlite3` 的官方 Python 包；若采用 `libsql==0.1.11`，必须在受测试的适配层解决上述接口、脚本、异常和整数问题。另一条可评估路线是针对官方 SQL over HTTP／Hrana 协议实现有界适配，明确处理事务状态与失败；不能把省掉依赖理解为省掉协议验收。不要仅为纯 Python 分发便利切换到新引擎，再未经验证迁移已有画布。最终驱动选择还需要真实云端事务、失败恢复和两平台验收。

## 后续真实云端探针

用户完成官方 CLI 授权后，核对账号包含 5 GB 存储、每月 5 亿行读取、1000 万行写入与 100 个数据库，超额计费关闭。在东京区域准备 libSQL 测试库和空的正式目标库；没有迁移用户内容。

针对官方 HTTP 协议的隔离适配已通过合成数据探针：现有 Canvas 与 Generation Run schema 可建表；中文和 64 位整数保真；事务回滚、真实节点移动、独立连接回读与 Operation ID 去重通过；编辑资格过期后，旧设备不能覆盖新持有者。一次首次导入 100 节点约 10.5 秒，单节点真实移动约 2.1 秒，说明串行 SQL 网络往返仍需优化。这里的“两端”是同机独立连接，不是两台物理设备与两个网络的验收。

实现期间确认：非事务查询返回空 baton 不代表逻辑连接永久关闭；事务状态应以服务端 `get_autocommit` 为准。不得根据 SQL 首词猜测 `ROLLBACK TO` 等操作是否结束事务，也不能把提交响应丢失当作确定失败后盲目重发。[官方 HTTP 协议](https://github.com/tursodatabase/libsql/blob/main/docs/HTTP_V2_SPEC.md)

复现入口、实际验证范围与尚未完成的产品 Gate 统一记录在 [Active Spec](../active/2026-09-07-optional-cloud-records-onedrive-media-spec.md#接入前验证进度2026-09-07)。本文仍不是当前应用已经支持云端开关的声明。
