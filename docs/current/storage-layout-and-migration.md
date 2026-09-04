# 存储路径与旧数据迁移

本文是当前有效的运行数据边界和旧数据迁移说明。源码目录只保存应用代码与内置
资源，不是运行数据目录。Workspace 必须选择 Git 源码仓库之外的独立目录；两者不能
使用同一目录或互相包含。首次创建、打开、恢复重连和搬家都会在写入前拒绝重叠位置。

## 四种数据边界

| 边界 | 保存什么 | 是否随工作区搬家 | 是否可直接清理 |
| --- | --- | --- | --- |
| Workspace Data | 画布、素材、生成结果、内容历史、对话、团队模型选择和用户工作流 | 是 | 否 |
| Instance State | 账号、密码校验信息、会话、全局角色、模型能力审核状态，以及带 `workspace_id` 的视图状态、分享和内容审计 | 否 | 否 |
| Device State | 单个源码目录服务的 API Key、本机连接、启动器状态、服务身份和当前工作区选择 | 否 | 否 |
| Device Cache | 单个源码目录服务的媒体预览和可重新下载模型 | 否 | 是；需要时会重新生成或下载 |

## 新版路径

### Workspace

用户在首次设置或工作区管理中选择一个完整目录：

该目录应与源码仓库并列或位于其他本机、外接磁盘或已完整同步的云盘位置，不能放在
源码仓库内部。即使 Workspace 子目录被 `.gitignore` 忽略，也不视为安全隔离。

```text
<workspace>/
├── data/
│   ├── canvases/
│   ├── conversations/
│   ├── recovery/<migration-id>/
│   │   ├── source/                    # 迁移前逐文件 SHA-256 恢复副本
│   │   ├── staging/                   # 尚未发布的 SQLite 双库
│   │   ├── legacy/                    # 发布后精确归档的三个生成 JSON
│   │   └── rollback/                  # 回滚演练保留的 SQLite 与 manifest
│   ├── workflows/
│   ├── canvas-content.sqlite3
│   ├── generation-runs.sqlite3
│   ├── storage-authority.json         # 仅 SQLite authority 存在
│   ├── api_providers.json
│   ├── available_models.json
│   ├── generation-history.json        # 仅 JSON authority 兼容期
│   ├── generation-effects.json        # 仅 JSON authority 兼容期
│   ├── generation-runs.json           # 仅 JSON authority 兼容期
│   ├── projects.json
│   ├── prompt-libraries/
│   │   ├── prompt_libraries.json      # 通用 Prompt Template 与 Category 权威
│   │   ├── covers/                    # 内容摘要命名的 Prompt Template 封面
│   │   ├── recovery/                  # 旧布局 JSON 的校验恢复副本
│   │   └── migration-v1.json          # 旧布局迁移结果与缺失引用
│   └── workspace_asset_library.json
└── assets/
    ├── input/
    ├── output/
    └── uploads/
```

`storage-authority.json` 存在时，`canvas-content.sqlite3` 与
`generation-runs.sqlite3` 必须同时成为权威，不能只切换其中一个。两类“历史”有不同职责：

- `canvas-content.sqlite3` 的 Canvas Generation History 是某一张 Canvas 的最终日志，
  不进入 Canvas 公共快照、实时 Mutation、Revision 或撤销历史；
- `generation-runs.sqlite3` 的 Global Generation History 是跨 Canvas 的用户历史列表，
  同库还保存 Generation Run lifecycle 和 History / Notification 发布回执，避免重启重放。

浏览器统一通过 HTTP 接口读写，不判断底层存储类型。SQLite authority 的真实应用组合不会
把 `generation-history.json`、`generation-effects.json`、`generation-runs.json` 的路径交给
运行时，因此图片、视频和文本 Run 都不能创建、读取或修改它们。尚未受控切换的旧 Workspace
继续由 JSON 兼容适配器使用这三个文件和 Canvas JSON `logs`；这是迁移前的单一权威，不是
SQLite 的第二份副本。

停服切换会把旧 Canvas 日志与所属 Canvas 原子导入 Canvas Store，把全局 History、Run 和
History / Notification 回执导入 Generation Run Store。发布 `storage-authority.json` 前会核对
记录数、稳定 ID、Run 引用、Managed Media、SQLite integrity 与 foreign key；任一项失败就
保留来源与恢复副本，不改变当前 authority。重复的旧 Canvas 日志 ID 会稳定改号并保留原 ID
供审计，同一 Canvas 内重复的 Generation Run ID 不会导致记录被静默丢弃。全局 History 缺失
ID 时按内容稳定计算；显式 ID 冲突会停止，不能覆盖已经导入或更晚的数据。具体命令见
[停服切换与 9 机器人协作验收](controlled-cutover-and-live-acceptance.md)。
早期版本已经发布 SQLite 双库、但 Global History / Publication Receipt 仍留在三个 Generation
JSON 的 Workspace，使用同一正式停服命令执行 Phase 2 upgrade。它以现有 SQLite 为权威，复制
旧 manifest、数据库和 JSON 后只在 staging 补齐缺失记录，绝不让 legacy Run 覆盖同 ID 的当前
SQLite Run；发布失败恢复旧 SQLite authority。只有 Global History / Receipt 已完整迁入、单独
遗漏 Canvas JSON 日志时，才使用专用停服 backfill。缺失旧 Run 中仍为 `data:` 的内嵌输入会在
recovery staging 按 SHA-256 物化，并在发布时进入 `assets/input/migrations/<migration-id>/`；
失败、同 ID 续跑和回滚都使用 preparation report 中的相对路径与摘要审计，正式 SQLite 不保存
内嵌字节或设备绝对路径。
人工确认永久缺失的 Global History 媒体可以按稳定 History ID 进入 operator quarantine，但必须
同时给出专用二次确认参数。resolution 文件及其 SHA、被豁免 ID 和验证失败原因进入 recovery
审计；原始 JSON 仍精确归档并可由 rollback 完整恢复。该机制不会放宽其他 History、pending
effect、Run 或 Managed Media Gate。

新选择的空目录在首次 Setup 时直接建立上述两个 SQLite Store，并在完整性检查通过后最后
提交 `storage-authority.json`，不会先创建 Canvas 或 Generation Run 的 JSON 主存储。创建若
在 manifest 提交前中断，会保留带 Workspace identity 的 bootstrap 恢复记录；重试只复用能
证明属于同一 Workspace 的数据库。已有旧 Canvas / Generation Run JSON 的 Workspace 不走
fresh bootstrap，也不会覆盖来源，继续使用受控切换流程。缺少 manifest 的旧 Workspace 在
升级恢复 Gate 落地前仍处于临时兼容阶段，不能被解释为新 Workspace 的默认存储设计；最终
退休规则由 [#179 Active Spec](../active/2026-08-28-workspace-sqlite-authority.md) 分阶段实施。

已保存 Workspace 永久不可用时，恢复页不会自动建立空白替代，但提供用户主动选择的“创建
新的工作区”。它只接受受支持的空目录；完整已有 Workspace 引导到打开流程，普通非空、
不完整、不可读或出现未知文件的目录拒绝创建。确认后先在 Device State 保存可恢复的创建
操作，再于未激活的目标中建立稳定 identity、双 SQLite Store 和完整性校验，最后提交
`storage-authority.json`。只有真实 SQLite composition 重新打开成功后才替换本机当前 Workspace
选择并请求受控重启。

初始化或验证失败时原选择不变，Instance State 的账号、有效 Session 和全局 Role 不变，旧
Workspace 目录和内容不被修改或删除。创建记录、目标 identity 与已知 bootstrap 文件完全匹配
时可以续跑；启动器拒绝重启时恢复原选择和同一创建记录。应用不自动删除失败目标，因为无法
证明确认后没有用户或同步软件加入文件。详细取舍见
[ADR-0006](../adr/0006-explicit-workspace-creation-during-recovery.md)。

正式历史迁移采用停服的一次性入口。它先取得 Workspace 写锁，要求不存在非终态 Run，再按
SHA-256 建立精确恢复副本、只在 staging 双库导入和验证、原子替换正式数据库，并把
`storage-authority.json` 作为最后一个 authority 提交点。提交后，三个 legacy JSON 才逐文件
归档到 `data/recovery/<migration-id>/legacy/`；首次部署不会删除该归档。中断前 authority 不变，
同一 migration ID 可以恢复或重试。回滚时先逐字节恢复三个 JSON，再撤回 manifest，并把正式
SQLite、WAL 与 SHM 移到同一恢复目录，旧版本即可按 JSON authority 重新启动。早期 SQLite
Phase 2 upgrade 的回滚则恢复精确的旧数据库与旧 manifest，保持旧 SQLite authority。物理边界与取舍见
[ADR-0005](../adr/0005-global-generation-publication-authority.md)。

普通 UI 只显示工作区目录，不要求用户理解内部 `data/` 与 `assets/`。
Workspace 不包含活动账号库、成员列表、membership 或按 Workspace 的角色。
主界面设置菜单以“数据存储位置”命名这个入口，并用 Medium Dialog 展示当前工作区目录、
打开已有工作区和搬家到新位置；Dialog 内容占满公共内容区，Header 顶部与左右统一使用
`--ui-space-6` 内边距，Body 与 Footer 继续沿用 `ic-dialog` 的标准内边距。

同一 Workspace 默认只允许一个服务写入。服务取得本机文件锁后还会在 Workspace 的
`.infinite-canvas-service/occupation.json` 记录服务身份，并在正常关闭时删除。云盘可能
延迟同步这次删除；确认原设备服务已经停止后，操作者可以使用启动器的
`--takeover-workspace` 参数替换其他设备残留的记录。该参数不绕过本机活动文件锁，也不
用于两个仍在运行的服务之间共享写入权；没有显式参数时继续拒绝其他设备的记录。
统一启动器通过仅由监督进程持有的生命线管理后端；启动窗口、终端标签页或外层启动任务
结束时，后端必须检测到监督关系断开并走正常关闭流程，释放端口、文件锁和匹配的
`occupation.json`。受控重启仍由同一个存活的启动器接续，直接运行后端不属于可重启的
正式运行入口。

`workspace_asset_library.json` 是 Workspace Asset Library 的发布目录，只保存素材条目、Publisher 和私有来源快照；图片字节继续位于 `assets/` 的 Managed Media 区域。相同媒体以内容摘要幂等复用，取消共享只移除条目，不删除画布图片或媒体文件。列表 API 不公开来源 Project、Canvas 或 Node。完整合同见[工作区资产库与本地引用](workspace-asset-library.md)，架构取舍见 [ADR-0004](../adr/0004-workspace-asset-library-publication-boundary.md)。Prompt Template 封面是这一通用媒体规则的窄例外，由 [ADR-0007](../adr/0007-prompt-library-directory-owns-cover-media.md) 定义的 Prompt Library 专属目录拥有。

### Prompt Template 的所有范围

- “通用” Prompt Template 与 Category 保存在 `<workspace>/data/prompt-libraries/prompt_libraries.json`，封面字节保存在相邻的 `covers/`，共同组成可单独检查和备份的 Prompt Library 目录。存量多个内部 Library 通过兼容投影共同呈现，读写不得静默合并、覆盖或丢弃仍受支持的隐藏字段；已退出合同的 `scene` 与 `scene_en` 在模板规范化时移除。
- “当前画布” Prompt Template 保存在所属 Canvas 的顶层 `prompt_templates` 内容中，属于 Canvas 持久权威，不另建带 `canvas_id` 的 Workspace 级旁表。它随 Canvas 复制、移动、导出、授权与删除；Canvas 副本得到独立内容身份。
- 当前画布模板仍由 Canvas 拥有，但其封面字节可以与通用模板一起在 `prompt-libraries/covers/` 按内容摘要复用；删除模板只删除引用，不在无法证明无其他引用时删除封面文件。
- 旧 Canvas 没有 `prompt_templates` 时按空列表读取，不从浏览器 `localStorage` 或通用库猜测迁移。产品预置只在新 Workspace 首次创建 Prompt Library 时写入一次，后续删除不会因升级自动补回。
- 通用复制到当前画布产生独立副本；当前画布设为通用通过 operation ID、Canvas Revision 与权限校验提交。冲突保留权威 Canvas 快照，不能回退到其他 Canvas。

旧 Workspace 的 `data/prompt_libraries.json` 在首次读取时迁移。迁移先验证旧 JSON，复制仍存在的 `assets/input/imported/` 封面并准备改写引用，再持久化旧 JSON 的内容校验副本与迁移 manifest，最后才原子发布新权威。通用 Managed Media 原图不在迁移中删除，因此失败或人工回退不会让旧引用失效。新目录已经存在但内容损坏时不得静默回退读取旧文件，以免形成双重权威。具体取舍见 [ADR-0007](../adr/0007-prompt-library-directory-owns-cover-media.md)。

### Instance State

默认位于操作系统的兼容状态根目录 `Infinite Canvas` 中，其 `instance-state/` 由同一设备上的
多个源码目录服务共享：

```text
<device-state>/instance-state/
├── auth.db
├── model-capability-workbench.json
├── account-recovery/
│   ├── seed-<workspace-id>-<digest>.db
│   ├── legacy-<workspace-id>-<digest>.db
│   └── legacy-setup-<workspace-id>-<digest>.db
└── legacy-account-migration.json
```

`auth.db` 是当前设备上这些本地服务共用的活动账号库。账号、会话和 `users.role`
在所有 Workspace 中保持不变；分享、私有视图和内容审计通过 `workspace_id` 关联当前内容。可用
`INFINITE_CANVAS_INSTANCE_STATE_DIR` 显式覆盖，主要用于测试和受控管理；选择或搬动
Workspace 不会改变这个位置。

`model-capability-workbench.json` 保存安装级 Administrator 共用的 Model Capability Evidence、Draft、Review State 与 Published 投影。它以版本化 JSON 原子替换；只有 Published 能力投影参与运行目录 Revision，Evidence、草稿和退回记录不会改变生成合同。该文件不包含 Provider 凭证，也不随 Workspace 搬迁或 Device Cache 清理。

### Device State

| 系统 | 默认目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Infinite Canvas/installations/<目录身份>/` |
| Windows | `%LOCALAPPDATA%\Infinite Canvas\installations\<目录身份>\` |
| Linux | `$XDG_STATE_HOME/infinite-canvas/installations/<目录身份>/`；未设置时位于 `~/.local/state/` |

目录身份由源码目录的规范绝对路径稳定派生，因此两个 checkout 的端口记录、锁、
服务身份和 Workspace 选择不会互相覆盖。可用 `INFINITE_CANVAS_STATE_DIR` 覆盖，
主要用于测试、便携部署和管理员明确指定；显式指向同一路径会关闭自动隔离。

### Device Cache

| 系统 | 默认目录 |
| --- | --- |
| macOS | `~/Library/Caches/Infinite Canvas/installations/<目录身份>/` |
| Windows | `%LOCALAPPDATA%\Infinite Canvas\Cache\installations\<目录身份>\` |
| Linux | `$XDG_CACHE_HOME/infinite-canvas/installations/<目录身份>/`；未设置时位于 `~/.cache/` |

目录结构：

```text
<device-cache>/
├── media-previews/
├── image-processor-results/
└── models/
    ├── matting/
    └── image-processors/
        └── depth-anything-v2-small/
            └── model.onnx
```

可用 `INFINITE_CANVAS_CACHE_DIR` 覆盖。删除该目录不会删除作品，但第一次重新打开
媒体或使用本机模型时需要重建/下载。`image-processor-results/` 只保存可由来源内容摘要、
固定处理器版本、模型摘要和输出参数重建的派生结果；成功交付给画布的深度图会另行物化为
Workspace Managed Media。`models/image-processors/` 中的 Depth Anything 权重按固定
revision、字节数和 SHA-256 校验后才发布，模型和临时下载文件不随 Workspace 搬迁。

## 新旧路径对照

| 旧路径 | 新路径 | 处理方式 |
| --- | --- | --- |
| `refactor-data/canvases/` | `<workspace>/data/canvases/` | 原样复制并校验 |
| `refactor-data/conversations/` | `<workspace>/data/conversations/` | 原样复制并校验 |
| `refactor-data/recovery/` | `<workspace>/data/recovery/` | 原样复制并校验 |
| `refactor-data/auth.db*` | `<instance-state>/auth.db` + `account-recovery/` | SQLite 一致性快照、双副本验证后激活；不进入 Workspace |
| `refactor-data/projects.json` | `<workspace>/data/projects.json` | 原样复制并校验 |
| `refactor-data/prompt_libraries.json` | `<workspace>/data/prompt-libraries/prompt_libraries.json` | 先按旧文件原样复制并校验；首次读取时执行带恢复副本的目录迁移 |
| `refactor-data/available_models.json` | `<workspace>/data/available_models.json` | 原样复制并校验 |
| `refactor-data/api_providers.json` | Workspace 的共享设置 + Device State 的本机连接 | 自动拆分密钥、地址和团队设置 |
| `refactor-data/media_previews/` | `<device-cache>/media-previews/` | 复制到可清理缓存 |
| `refactor-data/data/media_previews/` | `<device-cache>/media-previews/` | 兼容旧工作区布局 |
| `refactor-data/models/` | `<device-cache>/models/` | 复制到本机模型缓存 |
| `refactor-data/data/models/` | `<device-cache>/models/` | 兼容旧工作区布局 |
| `refactor-data/assets/` | `<workspace>/assets/` | 原样复制并校验 |
| `storage_settings.json`、`.DS_Store` 等 | 不迁移 | 已知旧指针或系统元数据 |

`api.env`、`workspace-storage.json`、`server-identity.json`、启动锁等设备文件不能通过
工作区迁移脚本删除。来源中出现这类文件或任何未知文件时，脚本会停止且保留来源。

## 一键迁移脚本

脚本位置：

```text
backend/scripts/migrate_legacy_data.py
```

### 1. 先预览

macOS/Linux：

```bash
.venv/bin/python backend/scripts/migrate_legacy_data.py \
  --source "/旧数据/refactor-data" \
  --workspace "/新工作区" \
  --dry-run
```

Windows：

```bat
.venv\Scripts\python.exe backend\scripts\migrate_legacy_data.py ^
  --source "D:\旧数据\refactor-data" ^
  --workspace "D:\Reroll Workspace" ^
  --dry-run
```

预览会计算全部文件的 SHA-256，并输出来源、目标、分类、文件数量和容量，不写入
任何目标，也不删除来源。

### 2. 迁移并自动删除旧源

```bash
.venv/bin/python backend/scripts/migrate_legacy_data.py \
  --source "/旧数据/refactor-data" \
  --workspace "/新工作区" \
  --delete-source
```

输入 `DELETE` 后，脚本执行：

1. 再次扫描，确认数据在预览后没有变化；
2. 将 Workspace Data 和 Device Cache 复制到暂存目录；账号文件只作为待迁移输入，不作为 Workspace 内容发布；
3. 对每个普通文件进行 SHA-256 校验；
4. 拆分共享 Provider 设置与设备连接；
5. 为旧账号库生成 SQLite 一致性快照，验证 Instance 活动副本与账号恢复副本；
6. 从目标 Workspace 暂存目录清除旧 `auth.db`、WAL 和 SHM 后发布目标工作区；
7. 仅在以上步骤全部成功后删除精确的来源目录；
8. 在 `<workspace>/data/recovery/migrations/` 保存内容迁移路径对照报告。

已在外部完成备份且需要无人值守时可以增加 `--yes`：

```bash
.venv/bin/python backend/scripts/migrate_legacy_data.py \
  --source "/旧数据/refactor-data" \
  --workspace "/新工作区" \
  --delete-source \
  --yes
```

## 安全限制

- 目标工作区必须不存在或为空。
- 不合并、不覆盖已有工作区。
- 来源、工作区、Device State 和 Device Cache 不能互相包含。
- Workspace 搬家、复制和导出排除 `data/auth.db*` 及旧账号恢复文件。
- 拒绝磁盘根目录、用户主目录和当前项目根目录作为来源。
- 拒绝符号链接、未知文件和目标冲突。
- 校验失败时不删除来源。
- 脚本只删除用户明确指定的旧源目录，不删除其父目录。

项目根目录现有的 `local-state/refactor-data` 不会因代码升级自动移动或删除；只有
明确运行迁移脚本才会处理它。

## 启动时的旧 Workspace 账号迁移

应用打开仍含 `data/auth.db` 的旧 Workspace 时执行以下幂等流程：

1. 先清理上一次已结束迁移留下的私有临时数据库及恢复副本 sidecar；活动 `auth.db` 的 WAL/SHM 不在清理范围；
2. 通过 SQLite backup API 读取包含已提交 WAL 的一致性快照，并校验表、完整性、外键和记录数；
3. 若 Instance State 尚无账号，先发布并验证 `account-recovery/seed-*.db`，再原子发布并验证活动 `auth.db`；
4. 两个副本都有效后才删除 Workspace 中的 `auth.db`、`auth.db-wal` 和 `auth.db-shm`；
5. 若 Instance State 已有账号，它始终具有权威性；旧 Workspace 账号只归档为 `legacy-*.db`，不合并、不覆盖；
6. 旧版未配置状态使用的 `<device-state>/setup/auth.db*` 遵循同一规则：没有其他账号来源时可以播种 Instance State，否则验证归档为 `legacy-setup-*.db` 后删除源文件，永不与现有用户合并；
7. 任一步失败都保留尚未归档的源数据，写入不含密码、令牌或绝对路径的 `legacy-account-migration.json` 恢复状态，下一次启动可安全重试。

这些清理由 Instance State 在启动时受控执行。不要在服务运行时手工复制或删除
SQLite 主文件、WAL 或 SHM。

迁移后的旧表会补充内容关联：私有视图状态与分享记录写入来源 Workspace 的
`workspace_id`，内容类型审计记录也补上同一标识；账号生命周期审计保持安装级，
`workspace_id` 为空。
