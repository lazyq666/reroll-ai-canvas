# Workspace SQLite 运行时权威与遗留整文件 JSON 退休

- **Status**：Implementing（Phase 1、Phase 2 与历史停机迁移已交付；Phase 3–6 待实施）
- **Feature ID**：F03（关联 F07、F08、F09、F10、F12）
- **Owners**：产品 / 后端 / 测试 / 发布维护
- **Last verified**：2026-08-28（Phase 2、历史迁移、故障恢复与回滚自动化通过）
- **Applies to**：Issue #179
- **Supersedes**：无
- **Superseded by**：无
- **Related ADRs**：[ADR-0001](../adr/0001-workspace-data-boundary.md)、[ADR-0003](../adr/0003-generation-history-sqlite-authority.md)、[ADR-0004](../adr/0004-workspace-asset-library-publication-boundary.md)、[ADR-0005](../adr/0005-global-generation-publication-authority.md)
- **Domain terms**：Workspace、Workspace Data、Canvas、Generation Run、Generation History、Project、Prompt Library、Provider、Workflow、Device State

## 1. 一页摘要

Reroll 的 Workspace 可以放在 OneDrive 等已完整同步到本机的目录。持续增长的业务记录如果每次修改都要“读完整文件、改一处、再写回完整文件”，一次生成会放大成多次大文件写入，也更容易在同步、并发或进程中断时形成覆盖和截断。

本功能把需要持续增长、索引分页、幂等或跨对象事务的 Workspace Data 收口到 SQLite 运行时权威。JSON 仍可作为受控迁移输入、导入导出格式和小型控制面文件，但不再承担这些业务记录的在线数据库职责。迁移必须可验证、可重复执行、可恢复，并在验证成功前保留来源文件。

为控制风险，交付按可独立验收的阶段推进。Phase 1 保证新 Workspace 从创建起就是 SQLite authority；Phase 2 已收口 Global History / Effects 运行时并交付旧 Workspace 的停机迁移、精确归档与回滚。Asset Library、Prompt Libraries、Projects、Provider / RunningHub 配置和最终 missing-manifest enforcement 仍由后续阶段完成。

## 2. Problem Statement

- SQLite authority Workspace 完成 Generation Run 后仍会重写全局 `generation-history.json` 和 `generation-effects.json`。
- 新 Workspace 或缺少 `storage-authority.json` 的 Workspace 会被静默解释为 JSON Canvas / Generation Run authority。
- Asset Library、Prompt Libraries、Projects 与部分 Provider / RunningHub 配置仍使用整文件 read-modify-write，无法获得数据库分页、并发更新和跨对象事务保证。
- 已退出热路径的遗留 JSON 仍增加云盘同步、Workspace 搬家、备份与扫描成本，但又不能在缺少完整性验证时直接删除。

## 3. Goals / Non-goals

### Goals

- 新 Workspace 创建完成时已经拥有可用的 Canvas 与 Generation Run SQLite 数据库，以及最后提交的 authority manifest。
- 最终不再把缺少 manifest 静默解释成长期 JSON 运行时权威；既有数据进入明确的迁移或恢复路径。
- Generation History、Effect / Notification 幂等状态、Asset Library、Prompt Libraries 与 Projects 使用事务、索引和数据库分页。
- Workspace 共享 Provider / Model / RunningHub Workflow 配置的每个字段只有一个正式权威；Device State 的密钥与本机连接继续留在设备边界。
- 遗留 JSON 的迁移核对记录数、稳定 ID、引用关系和 Managed Media；验证前保留来源，验证后才允许精确归档或清理。

### Non-goals

- 不移除 SQLite 行内由事务保护的 `payload_json`、`metadata_json` 等 JSON 列。
- 不移除 Workspace identity、occupation、launcher 状态、authority manifest 或一次性迁移报告等小型控制文件。
- 不改变用户主动导入/导出的独立 Workflow JSON 格式。
- 不把 Workspace 共享设置与 Device State 密钥、Token、本机 Provider 地址合并成一个物理数据库。
- 不以一次大爆炸式迁移同时替换全部 Store；每个阶段必须先具备回滚与验收 Gate。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Local Operator | 能启动、停止和维护本机服务 | 创建、迁移、验证、恢复或精确归档 Workspace 存储 | 在服务仍写入时手工删除旧文件；绕过验证发布 authority |
| Administrator | 已登录且 Workspace 可用 | 通过受控维护入口确认迁移和查看业务化结果 | 读取 Device State 秘密或底层绝对诊断路径 |
| Designer | 获授权 Project 可用 | 正常使用 Canvas、Prompt Library、Asset Library 与 Generation Run | 选择存储实现或执行维护迁移 |

存储切换对 Designer 的创作流程透明；现有 Project Access Grant、Canvas Visibility 与 Generation Run 权限不改变。

## 5. User stories

1. 作为 Local Operator，我希望新 Workspace 首次创建即使用 SQLite，以免第一批内容先落入待迁移的 JSON 数据库。
2. 作为 Administrator，我希望旧 Workspace 在明确验证后一次性切换，并在中断后安全重试，而不是得到半套新权威。
3. 作为 Designer，我希望历史列表、删除、素材发布与提示词库编辑在内容增长后仍保持一致，不因云盘同步覆盖丢失更新。
4. 作为 Local Operator，我希望验证成功前原文件保持不变；确认稳定后再通过精确范围退休遗留文件。

## 6. User journey and observable states

本功能不新增日常创作入口。可见状态集中在首次设置、启动恢复和维护迁移。

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| fresh bootstrap | 选择空目录并确认创建 Workspace | 正常继续创建 Administrator | 等待创建完成 | 双库完整且 manifest 已提交 |
| ready | authority 与数据库一致 | 正常产品界面 | 正常业务操作 | 关闭、搬家或进入维护 |
| migration required | 发现只有遗留 JSON、没有可用 manifest | 明确提示需要受控迁移，来源保持不变 | 迁移、查看诊断、退出 | 迁移发布成功或继续使用受支持的临时兼容阶段 |
| recovering | 上次 bootstrap / migration 在提交点前中断 | 明确恢复状态 | 重试同一操作、回到原权威 | 完整性和操作身份验证通过 |
| failure | 文件不可读、身份不匹配、完整性失败或空间不足 | 业务化错误，不暴露秘密和无关绝对路径 | 修复环境后重试 | 所有 Gate 通过 |

Phase 1 不新增视觉组件；Setup 页沿用现有反馈与 Focus 行为。

## 7. Functional rules

1. 新 Workspace 的稳定身份必须先建立；两个 SQLite Store 必须绑定同一个 Workspace identity。
2. 新 Workspace bootstrap 先创建并验证 Canvas / Generation Run 数据库，最后以 atomic replace 提交 `storage-authority.json`；manifest 是运行时切换的提交点。
3. bootstrap 在 manifest 提交前失败时不得把半套 SQLite 当成权威；使用同一 Workspace identity 重试必须可收敛到一套完整 authority。
4. 生产运行时最终不得把“manifest 缺失”与“明确 JSON authority”视为同一状态。强制该规则前，必须先提供旧 Workspace 可到达的受控迁移入口，避免升级后无法恢复。
5. SQLite authority 下的图片、视频和文本 Generation Run 均不得创建或修改 `generation-history.json`、`generation-effects.json` 或 `generation-runs.json`。
6. History 查询、游标分页、按 ID 读取、删除，以及 Effect / Notification 幂等状态必须由 SQLite 事务提供；客户端不判断存储实现。
7. Asset Library、Prompt Libraries 与 Projects 的正式写入必须在 SQLite 事务内完成；需要同时变更 Canvas 归属的 Project 操作必须具有单一事务边界。
8. Workspace 共享 Provider / Model / RunningHub Workflow 字段不得重复保存；稳定读取可使用进程内缓存，但每个写操作必须显式失效。
9. Device State 的 Provider credential 和本机 connection 继续独立于 Workspace Data；“单一权威”按字段职责判断，不要求合并物理文件。
10. 迁移以稳定 operation / migration ID 幂等；重复执行不得重复导入、覆盖较新数据或生成第二套权威。
11. 验证至少覆盖记录数、关键 ID、引用关系、SQLite integrity / foreign key 和引用的 Managed Media；任何失败都不发布新 authority。
12. 遗留文件只允许在验证成功后按报告中记录的精确路径归档或清理；未知文件、冲突副本与来源 Workspace 不参与猜测性删除。

## 8. Domain and state model

每类业务数据在任一时刻只有一个运行时 Authority：

`legacy input → prepared SQLite → verified SQLite → manifest published → legacy archived`

- `prepared` 和 `verified` 仍不改变当前运行时权威。
- `manifest published` 是切换提交点，Canvas 与 Generation Run 不允许混合模式。
- 后续 Store 迁移必须复用相同的“准备、验证、发布、恢复”语义；不能以文件更新时间判断权威。
- Operation ID 用于识别一次 bootstrap / migration 意图；Workspace identity 用于防止把其他目录的数据误接到当前 Workspace。

## 9. Data and persistence

| Data | Final authority | Boundary | Migration / recovery |
| --- | --- | --- | --- |
| Canvas / Canvas Generation History | SQLite | Workspace Data | 已有受控 cutover；继续保留 legacy import / rollback export |
| Generation Run lifecycle | SQLite | Workspace Data | 与 Canvas authority 同时发布 |
| Global Generation History | SQLite | Workspace Data | 从 `generation-history.json` 一次性导入并校验 |
| Effect / Notification publication | SQLite | Workspace Data | 从 `generation-effects.json` 导入；以 Run / Effect 稳定 ID 幂等 |
| Projects | SQLite，且与 Canvas 归属同事务 | Workspace Data | 校验 Project ID 与 Canvas 引用 |
| Workspace Asset Library | SQLite | Workspace Data | 不复制 Managed Media；校验内容摘要和引用 |
| Prompt Libraries | SQLite | Workspace Data | 保留库、模板、范围和顺序身份 |
| Provider / Model / RunningHub shared config | 一个 Workspace 共享权威 | Workspace Data | 消除重复 payload；缓存显式失效 |
| Provider credentials / local connections | 现有 Device State authority | Device State | 不进入 Workspace 迁移 |
| identity / authority / occupation / reports | 小型 JSON 控制面 | Workspace 或 Device control | atomic replace；不作为增长型业务数据库 |

## 10. API / WebSocket / Provider contracts

现有创作 API、WebSocket 消息和 Provider 请求合同保持兼容。迁移不要求浏览器提交或识别存储模式。

- 列表 API 保持现有排序、过滤、权限和分页语义，但由 SQLite 执行过滤与分页。
- 删除 / 取消发布保持现有产品语义；迁移存储不扩大级联删除范围。
- 维护 API 继续只允许 Administrator，并返回稳定阶段、可重试错误与 migration ID。

## 11. Security and privacy

- authority manifest 的 Workspace identity 必须与所选 Workspace 一致；不一致时 fail closed。
- 迁移与归档不复制 Device State credential、Session、Instance State 或 Device Cache。
- 诊断使用业务名称和 Workspace 相对路径；不记录 Prompt、媒体内容、密钥或不必要的绝对路径。

## 12. Performance and reliability constraints

- 热路径不得因单条记录变化而读取或重写完整增长型 JSON 文件。
- 列表与 History 查询必须由索引、LIMIT 和稳定游标支持；不得先全量加载再分页。
- SQLite 使用现有 WAL、busy timeout、foreign key 与 durability 约束；并发测试至少覆盖重复请求和两个写者竞争。
- 中断测试覆盖数据库创建之间、数据库持久化之后、manifest 提交之前和提交之后。
- OneDrive 验收以“Workspace 位于已完整同步到本机的目录”为前提；NAS / SMB / NFS 仍不支持。

## 13. Implementation decisions and phases

### Phase 1 — Fresh Workspace bootstrap（已实现并人工验收）

- 建立独立的新 Workspace SQLite bootstrap 接缝。
- Setup 创建流程在取得 Workspace 使用权并建立 identity 后，创建、验证双库并最后提交 manifest。
- 覆盖正常创建、重复执行、manifest 提交前中断和身份不匹配。
- 暂不取消旧 Workspace 的缺失-manifest JSON 兼容；在迁移入口可达前直接 fail closed 会让既有用户无法启动和迁移。

### Phase 2 — Generation History / Effects（已实现并自动验收）

- Global Generation History 与 History / Notification publication receipt 位于 `generation-runs.sqlite3`，职责与 `canvas-content.sqlite3` 中的 Canvas final log / Canvas Effect Outbox 分离；物理边界由 ADR-0005 固定。
- `WorkspaceGenerationEffects` 只物化 Managed Media，再委托 JSON 或 SQLite publication adapter；SQLite 组合不接收三个 legacy JSON 路径。
- History 支持按媒体类型过滤、稳定游标分页、按 ID 查询与删除；History ID / Run ID 内容冲突 fail closed。
- 停机 CLI 要求绝对 Workspace 路径、稳定 migration ID、绝对报告目录与 `--confirm-service-stopped`，并持有 Workspace 写锁完成预检、恢复副本、staging、完整性验证、manifest-last 发布和精确归档。
- 已由早期 controlled cutover 发布 SQLite 双库、但 Global History / Receipt 仍为 JSON 的 Workspace 走同一 CLI：以正式 SQLite 为权威建立 staging，补齐缺失终态 Run 与 publication 数据，原子替换 Run 数据库并最后更新 manifest；回滚恢复旧 SQLite 数据库和旧 manifest，不退回过期 Canvas JSON。
- 早期 cutover 遗留 Run 中的 `data:` 内嵌输入只在缺失 Run 需要补迁时处理：迁移器验证 MIME、大小与内容签名，以 SHA-256 确定文件名，先写入 recovery staging，发布时再写入 `assets/input/migrations/<migration-id>/` 并把 Run 改为 Workspace 相对 URL；审计记录覆盖路径、摘要、字节数和是否由本次迁移创建，失败自动清理，崩溃可同 ID 续跑，回滚归档迁移所建媒体。
- 无备份且远端也不可重建的 Global History Managed Media 仍默认 fail closed。只有操作人同时逐条给出稳定 History ID 和 `--confirm-quarantine-broken-history` 时，迁移才把精确 ID 写入 `operator-resolution.json`，验证该记录确实缺失后不导入 SQLite；可验证记录、未知 ID、重复 ID 或未列出的缺失记录均停止。原始 JSON 仍逐字节进入 recovery / legacy，preparation report 记录 resolution SHA 与 quarantine 明细，回滚恢复完整原始 JSON。
- `generation-history.json` 缺失 identity 时以 Run ID 或内容摘要加稳定 occurrence 生成确定性 ID；`generation-effects.json` 的 completed receipt 直接转为完成，pending 仅在 durable Run、可重建 effect payload 和 Managed Media 都存在时进入 SQLite，否则生成明确人工处理报告并停止。
- 图片、视频、文本真实 Generation Runs、重启、History HTTP 分页/按 ID/删除与 Notification 重放均验证 SQLite 记录正确，三个 legacy JSON 不创建或 byte / mtime 不变。

### Phase 3 — Asset Library

- 保留 ADR-0004 的发布目录、权限、内容摘要幂等和取消发布语义，仅替换 Store。
- 实施与验收由 Issue #217 跟踪。

### Phase 4 — Prompt Libraries / Projects

- Prompt Libraries 迁入事务 Store；Projects 与 Canvas Project 归属进入同一事务边界。
- 实施与验收由 Issue #218 跟踪。

### Phase 5 — Provider / RunningHub authority

- 按 Workspace shared / Device local 字段职责收口权威，消除 RunningHub payload 双写并增加缓存失效。
- 实施与验收由 Issue #219 跟踪。

### Phase 6 — Remaining legacy retirement and missing-manifest enforcement

- Phase 2 已退休 SQLite authority 下的三个 Generation JSON；本阶段继续处理其他已迁移 Store 的遗留 JSON。
- 在全部旧 Workspace 迁移、核对、归档与回滚演练后，生产运行时不再将缺失 manifest 静默解释成长期 JSON authority。
- 更新或新增 ADR，记录剩余 Store 边界、兼容期和最终退休规则。
- 实施与验收由 Issue #220 跟踪，并以前三个阶段完成为前置条件。

## 14. Acceptance and testing

### Highest test seam

最高接缝是使用真实应用组合和临时 Workspace：从 Setup 创建或启动一个 Workspace，执行真实 Store 操作 / Generation Run，然后检查公开响应、SQLite 查询结果、authority 状态及 legacy 文件未创建/未修改。纯静态源码检查不能替代该 Gate。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
| 空目录创建新 Workspace | Setup / application integration | 双库和 manifest 完整建立，组合结果为 SQLite |
| bootstrap 重复请求 | Workspace bootstrap integration | 同一 identity 收敛到同一 authority，不覆盖业务数据 |
| bootstrap 中断后重试 | failure injection | 不发布半套 authority；重试成功或保留明确恢复证据 |
| 缺少 manifest 的旧 Workspace | startup / migration integration | 来源保持不变，并进入明确兼容或迁移状态；最终阶段不得静默长期运行 |
| 图片、视频、文本完成 | application + fake Provider | SQLite 有最终记录，三个 legacy JSON 未创建或字节未变化 |
| History 分页 / 删除 | HTTP + SQLite | 排序、游标、权限和删除语义与现有合同一致 |
| 通知重复发布 | lifecycle integration | 同一 Effect 只产生一次可见副作用，重启后仍幂等 |
| Store 并发 / 故障 | domain + application integration | 无丢失更新、截断或跨 Store 半提交 |
| 重复迁移 / 中断恢复 | maintenance integration | 记录不重复，authority 只在全部 Gate 后切换 |
| OneDrive 本地同步目录 | real environment rehearsal | 无整文件业务 JSON 热写；完整性、重启和回滚通过 |

### Human acceptance

不新增日常 UI 视觉行为。产品 / 交互只需确认 Setup、迁移中断与恢复文案能区分“来源未改动”“尚未发布”“可重试”，且不会把 SQLite、WAL 等实现词作为用户必须理解的操作。

### Regression neighbors

- 首次 Setup、已有 Workspace 打开、Workspace recovery / move。
- Canvas List、Project Access Grant、Share、Realtime Canvas Sync。
- Generation Run recovery、History、Notification、Batch Generation。
- Asset Library 取消发布不删除 Managed Media。
- Prompt Library scope、Provider settings、RunningHub Workflow 导入导出。

### Phase 1 verification result（2026-08-28）

- `tests.test_sqlite_workspace_bootstrap` 与 `tests.test_workspace_bootstrap` 通过：覆盖空目录首次 Setup、重启后 SQLite composition、重复 bootstrap、恢复记录写入前中断、双库之间中断、manifest 提交失败、已有业务数据保留，以及旧 JSON 来源不被覆盖。
- Storage authority / composition 聚焦回归共 16 项通过。
- Application factory / HTTP、SQLite migration / authority publication、受控迁移 CLI、main SQLite composition 与 Generation Run SQLite authority 共 53 项：52 项在受限沙箱直接通过；唯一需要绑定本机临时端口的 CLI 用例在获准的本机环境单独重跑通过。
- `git diff --check` 通过；测试启动时自动刷新的静态 HTML 版本标记已从本分支移除，不属于本功能交付。
- Phase 3 至 Phase 6 尚未实现，因此本 Spec 保持 `Implementing`，Issue #179 继续处于 `In Progress`。

### Phase 2 and historical migration verification result（2026-08-28）

- `tests.test_generation_runs_sqlite_authority` 使用真实 `GenerationRuns`、SQLite lifecycle store、输出物化与 publication 组合完成图片、视频、文本 Run；重启后完成 History 分页和删除，并断言三个 legacy JSON 的 byte / mtime 不变。
- `tests.test_main_sqlite_authority_integration` 从临时历史 Workspace 迁移后重新加载真实应用组合，验证公开 History 分页、按 ID 读取、删除与 Generation Run 恢复均走 SQLite。
- `tests.test_offline_sqlite_migration` 覆盖 JSON authority 与早期 SQLite authority 两种来源、重复迁移、数据库替换后 / manifest 前崩溃恢复、损坏 JSON、确定性 ID、ID 冲突、缺失 Managed Media、安全与不安全 pending effect、完整性失败、精确归档、两类回滚和回滚后再次发布。
- `tests.test_generation_run_store` 覆盖 schema 1 → 2 原地升级、稳定游标、媒体过滤、ID 冲突不覆盖、receipt claim / settle / reopen 与 legacy rollback projection。
- 早期 SQLite authority 增量用例覆盖：正式 SQLite 非终态 Run 在读取 legacy JSON 前阻止升级、缺失 Managed Media 保留旧 manifest / 数据库、逐 ID operator quarantine 与有效媒体误豁免拒绝、内嵌输入的确定性落盘与回滚归档、数据库替换后且 manifest 提交前的同 ID 恢复，以及精确恢复旧 SQLite 后再次发布。
- 旧 controlled cutover CLI 复用同一 preparation / publication 核心，并新增 Global History、publication receipt 和 legacy archive Gate；Canvas-log-only backfill 仍明确只适用于已经是 SQLite authority 的旧版本补迁，不能代替完整历史 Workspace 迁移。
- Generation、迁移 / 存储、应用 / bootstrap 三组直接相邻回归共 216 项独立通过；Python compileall 与 `git diff --check` 通过。
- 全量 `unittest discover` 共执行 1,951 项，但当前仓库基线仍有 76 failures / 22 errors（包括本 worktree 不存在 `.venv`、测试自动刷新静态 HTML 版本号、与本功能无关的登录响应和 UI 源码断言）。因此不把全量套件宣称为绿色；本功能以独立通过的真实组合与直接相邻模块作为验收证据，测试生成的静态 HTML 变化未纳入交付。
- 2026-08-29 文档清理后，文档知识地图 7 项检查全部通过。

## 15. Rollout, migration and rollback

- 新 Workspace 直接使用 SQLite，不需要先创建 legacy JSON 再迁移。
- 旧 Workspace 在兼容期优先使用停服 CLI；迁移先验证服务已停止且取得写锁，再创建恢复副本与 staging，最后发布权威。
- 发布后仍保留经验证的 rollback export 和来源归档；清理是独立、显式、精确目标的维护动作。
- 只有当迁移入口、恢复路径和真实升级演练都通过后，才启用缺失-manifest fail-closed。

## 16. Traceability

| Kind | Reference |
| --- | --- |
| Issue | #179 |
| Product map | [F03 / F07 / F08 / F09 / F10 / F12](../PROJECT-MAP.md#功能规格注册表) |
| Current references | [Storage layout and migration](../current/storage-layout-and-migration.md)、[Generation pipeline](../current/generation-pipeline.md)、[Controlled cutover](../current/controlled-cutover-and-live-acceptance.md)、[Workspace Asset Library](../current/workspace-asset-library.md) |
| Implementation seams | `generation_publication.py`、`generation_run_store.py`、`offline_sqlite_migration.py`、`sqlite_migration.py`、`sqlite_publication_upgrade.py`、`sqlite_authority_publish.py` |
| Existing tests | `test_generation_runs_sqlite_authority.py`、`test_main_sqlite_authority_integration.py`、`test_offline_sqlite_migration.py`、`test_sqlite_migration.py`、`test_sqlite_authority_publish.py` |

## 17. Open questions

- Phase 6 在升级旧 Workspace 时采用“启动前专用迁移阶段”还是“显式 legacy manifest + 限期兼容”，需要用真实升级与恢复演练决定；不得只修改 `resolve_storage_authority()` 默认值。
- Phase 3–5 的 Store 是否与现有数据库共置，必须分别按事务边界决定；不得从 ADR-0005 推导为“一律放进 Generation Run 数据库”。

## 18. Change log

| Date | Status | Change | Evidence / decision |
| --- | --- | --- | --- |
| 2026-08-28 | Implementing | 将 #179 整理为分阶段 Feature Spec，启动 Phase 1 | Issue body、代码审核评论、现有 ADR / Current docs 与实现对账 |
| 2026-08-28 | Implementing | 完成 Phase 2、旧 Workspace 停机迁移、三个 Generation JSON 精确归档与回滚 | ADR-0005、真实应用组合、迁移故障矩阵与公开 CLI 自动验收 |
