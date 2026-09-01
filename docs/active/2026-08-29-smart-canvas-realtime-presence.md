# Smart Canvas 实时在场状态、指针与账号头像

- **Status**：Approved
- **Feature ID**：F02 / F06 / F13
- **Owners**：产品 / UI / 交互 / 前端 / 后端 / 测试
- **Last verified**：2026-08-29
- **Applies to**：GitHub Issue #196 首个版本
- **Supersedes**：无
- **Superseded by**：无
- **Related ADRs**：无
- **Domain terms**：Account Avatar、Realtime Collaborator、Realtime Client Connection、Realtime Presence、Realtime Pointer、Canvas Viewport、Canvas Mutation

## 1. 一页摘要

当多名获授权用户同时编辑一个 Smart Canvas 时，页面右上角显示在线成员头像，画布中显示其他成员的鼠标指针和姓名，使协作者知道“谁在线、正在看哪里”。首版只服务管理员和设计师，不包括访客、匿名分享、Classic Canvas、远程选区、跟随、聊天或工具状态。

Realtime Presence 是与 Canvas 内容读写分离的瞬时数据流。它可复用现有 Canvas WebSocket，但不进入 Canvas SQLite、Canvas Revision、Canvas Mutation、历史或 Undo，也不占用持久操作的可靠队列。鼠标停止时不继续发送数据；服务端和客户端只保留最新坐标，使慢接收端丢弃过时指针而不拖慢文档操作。

账号默认头像是另一项持久身份能力。账号数据库保存一个颜色槽位，全产品以浅色背景、高饱和度首字母呈现；Realtime Pointer 的颜色则按进入当前 Canvas 的顺序临时分配。功能默认启用，不提供运行期开关；若性能或质量 Gate 未通过，不合并该独立分支。

## 2. Problem Statement

多人同时编辑时，当前 Canvas 内容能同步，但用户无法直接知道其他协作者是否在线、鼠标位于何处，也无法把页面中的协作者与账号身份快速对应。缺少这种轻量反馈会增加口头协调成本，并让并发操作显得不可预测。

同时，指针高频更新若与必须可靠送达的 Canvas Mutation 共用同一排队语义，可能制造队头阻塞、触发无意义的 Canvas Resync，或给单服务器带来不可控压力。产品需要明确这种状态的生命周期和性能边界。

## 3. Goals / Non-goals

### Goals

- 在 Smart Canvas 中准确显示当前在线的获授权账号。
- 以低延迟、平滑但可丢弃的方式显示其他账号最新鼠标位置和姓名。
- 同一账号打开多个标签页或设备时，只呈现一个成员和一个公开指针。
- 确保 Presence 流量不进入 Canvas 持久化、操作锁或可靠文档队列。
- 在单进程、局域网、10 个活跃账号的目标负载下，通过明确的性能与可靠性 Gate。
- 为所有账号提供一致、可访问、可复用的默认 Account Avatar。

### Non-goals

- 不显示连接、重连、网络质量或同步状态 UI。
- 不共享远程 Canvas Selection、Canvas Viewport、输入状态、当前工具、拖拽状态、点击波纹或操作轨迹。
- 不提供指针隐藏开关、跟随、聊天、搜索、成员操作或头像上传。
- 不支持 Guest Account、Anonymous Share Visitor、Classic Canvas、触摸或触控笔。
- 不增加外部实时服务、第二条 WebSocket、CRDT、Yjs、二进制协议或 Presence 历史。
- 不承诺超过现有 Realtime Connection Limit 的产品容量，也不在首版解决多进程横向扩展。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Administrator | 已登录并有当前 Smart Canvas 编辑权限 | 看到成员组和他人指针；向其他人发布自己的在线状态和指针 | 查看连接数、角色、活动时间或指针历史 |
| Designer | 已登录且获得当前 Project 访问授权和 Canvas 编辑权限 | 与 Administrator 相同 | 看到无权进入的 Canvas 的 Presence |
| Guest Account | 已登录但无 Canvas 编辑权限 | 无 | 订阅或发布 Presence |
| Anonymous Share Visitor | 通过 Share Link 只读查看 | 无 | 订阅或发布 Presence |
| 本机操作者 | 运行服务和配置环境 | 配置 Presence 更新间隔并重启生效 | 通过配置读取指针历史；首版没有总开关 |

权限在 WebSocket 建立和既有的逐消息授权边界继续生效。账号失效或授权撤销后，不再发布或接收该 Canvas 的 Presence。

## 5. User stories

1. 作为协作者，我想看到谁与我同时在线，以便判断是否正在共同编辑。
2. 作为协作者，我想看到其他人的鼠标和姓名，以便理解对方正在指向哪里。
3. 作为打开多个标签页的用户，我希望其他人只看到一个我的头像和一个最新活动指针，以免重复占位。
4. 作为使用键盘或辅助技术的用户，我希望成员列表可以聚焦并读出完整姓名，而高频指针不会制造朗读噪音。
5. 作为协作者，我希望 Presence 暂时失败时 Canvas 编辑仍可继续，且恢复后成员和指针自动重建。
6. 作为本机操作者，我希望能调整更新间隔，并能用负载 Gate 判断是否可以合并功能。

## 6. User journey and interaction contract

### Entry and exit

- 用户按既有入口进入获授权 Smart Canvas；页面收到初始 Canvas Snapshot 后，再收到 `presence_snapshot` 才启动 Presence UI 与发送。
- 用户离开 Canvas、失去权限或关闭最后一条连接时退出 Presence。页面不展示额外连接或断线流程。

### Happy path

1. 用户进入 Smart Canvas，右上角出现包括自己的在线成员头像组。
2. 鼠标进入 Canvas 内容交互区域时，客户端立即发送首个世界坐标。
3. 其他用户看到平滑移动的彩色箭头和姓名标签；标签在停止移动后淡出，箭头保留。
4. 鼠标离开 Canvas 区域、窗口失焦或标签页隐藏时，公开指针消失，但只要任一连接仍在线，头像继续存在。
5. 最后一条连接离开后，成员从头像组和成员弹层中消失。

### Observable states

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| capability pending | Canvas 已打开、尚未收到 Presence Snapshot | 不显示成员组和指针 | 正常编辑 Canvas | 收到 Snapshot，或保持为旧服务端兼容模式 |
| online | 收到有效 Snapshot | 自己和在线成员头像；有效的他人指针 | 正常编辑、查看工具提示和成员弹层 | 成员或连接状态变化 |
| own pointer inactive | 鼠标在非 Canvas UI、失焦或标签页隐藏 | 自己头像保留；别人看不到自己的指针 | 正常使用页面 | 鼠标重新进入 Canvas 并移动 |
| partial/slow receiver | 指针下行跟不上 | 过期坐标被跳过，只趋向最新位置 | Canvas 编辑保持可用 | 接收恢复或连接断开 |
| presence disconnected | Canvas Socket 断开 | 远端头像和指针立即清空；自己的头像保留 | 本地 Canvas 能力按既有规则处理 | 新 Snapshot 重建状态 |
| forbidden | 没有编辑权限或权限被撤销 | 不显示 Presence | 无 Presence 动作 | 重新获得合法入口和连接 |

### Input, pointer and keyboard

- 仅监听鼠标。Realtime Pointer 本身 `pointer-events: none`、`aria-hidden`，不拦截任何 Canvas 或固定 UI 操作。
- 成员头像可聚焦并显示完整姓名工具提示；当前用户附加本地化“你”。头像点击无动作。
- `+N` 可点击或键盘激活，打开只读成员弹层；Escape、点击外部或再次激活关闭。
- 成员变更不使用 `aria-live`，不播放声音，不弹 Toast。

### Responsive and themes

- 成员组位于页面右上方，右距 `22px`，与左侧返回按钮垂直居中。
- 头像为 `28px × 28px`，相邻重叠 `6px`。自己的头像固定最右；其他成员按加入顺序从右向左，最多直接显示 5 人，剩余人数在最左侧显示 `+N`。
- 错误通知可以覆盖成员组；成员组不移动、不隐藏。覆盖发生时，已打开的成员弹层自动关闭，错误通知保持可交互。
- Light/Dark 均需保持指针、文字、轮廓和 Focus 可辨认。Realtime Pointer 固定为屏幕尺寸，不随 Canvas Zoom 或页面 UI Scale 改变。

### Copy and internationalization

- 使用服务端 `display_name`，为空时回退 `username`；不显示 Role。
- 默认头像取显示名的第一个 Unicode Grapheme；拉丁字母转大写。仍不可用时取用户名，再不可用时显示通用人员图标。
- Light 主题的头像字符使用对应色系 `400` 阶作为轻量身份标记；它不单独承担姓名传达，完整姓名由头像按钮的无障碍名称、Tooltip 和成员弹层提供。Dark 主题继续使用对应 `200` 阶。
- 动态姓名和 `+N` 不翻译；“你”等固定文字必须进入现有 i18n。
- 姓名标签最大宽度 `160px`，超出使用省略号；工具提示和成员弹层提供完整姓名。

## 7. Functional rules

1. Presence 默认启用，只有收到 `presence_snapshot` 的客户端才开始展示和发送；旧服务端不发 Snapshot 时，客户端静默保持无 Presence 状态。
2. 在线成员的产品身份是 Account，而不是 Realtime Client Connection。同一账号的多条连接共享一个成员条目、一个临时颜色槽和一个公开指针。
3. 最近产生合格鼠标移动的连接控制该账号公开指针。控制连接离开 Canvas、失焦、隐藏或断开时，指针置空；其他旧连接不得恢复旧坐标，直到它再次移动。
4. 自己的 Account Avatar 包含在成员组并固定最右；客户端不渲染自己的协作指针。
5. Pointer 颜色由服务端按账号进入 Canvas 的顺序分配：从 1–10 中取第一个空闲槽，最后一条连接离开时释放，重进可以变化；超过 10 人后循环复用。
6. Account Avatar 颜色与 Pointer 颜色独立。头像颜色随机分配并持久化；右上成员组的重叠头像使用 `1px` `--ui-color-border-secondary` 外环，成员弹层内的头像使用当前 Canvas 的 Pointer 颜色作为身份环。
7. Realtime Pointer 是约 `18px × 22px` 的常见斜向箭头，使用中等明度、高饱和度语义色、`1px` 白色轮廓和轻微主题阴影。姓名标签位于右下，背景沿用 Pointer 色并使用可读的对比文字。
8. 最近更新的 Pointer 位于其他 Pointer 之上；允许指针和标签相互重叠，不做碰撞避让、轨迹、预测或点击动画。
9. 客户端发送 Canvas 世界坐标。接收端按自己的 Canvas Viewport 投影；屏幕外指针隐藏，不显示边缘指示器。平移或缩放时立即重新投影，静止指针可重新进入视野，但姓名标签不因平移重新出现。
10. Canvas 背景、Node、Connection、Frame、Group 和 Canvas 内部控件属于 Pointer 捕获区。固定工具栏、Dock、顶栏、菜单、Dialog、设置和浏览器外部不属于捕获区，进入这些区域时发送 `cursor: null`。
11. 鼠标首次进入捕获区立即发送。之后累计本机屏幕位移不足 `5px` 不发送；达到阈值后按配置间隔节流，每个间隔只发送最后坐标。
12. 收到连续位置时使用不超过 `min(有效更新间隔, 120ms)` 的短插值。更新间隔超过 `1s`，或新目标与当前投影相距超过接收端 `400px` 时直接跳转。
13. 姓名标签在最后一次移动后 `1.5s` 淡出，静止 Pointer 保留且不产生服务器流量。
14. `prefers-reduced-motion` 下位置更新直接跳转，淡出缩短或取消，不运行持续动画。
15. 成员列表顺序按 Account 首次加入当前在线会话的顺序；自己的展示位置例外，但弹层仍以同一成员顺序列出所有人并标记自己。
16. Account Avatar 的默认视觉应用于全产品已有的账号入口和账号管理界面，不在首版提供编辑或图片上传。

## 8. Domain and state model

- 一个 Realtime Collaborator 对应一个已认证 Account 在某个 Smart Canvas 中的在线会话，可拥有多条 Realtime Client Connection。
- 服务端为该 Canvas 在线会话生成不透明 `participant_id`。客户端不得从中推导账号 ID，也不得自报身份、姓名、头像或颜色。
- Account 的第一条连接建立时产生成员加入；最后一条连接结束时产生成员离开。成员会话持有加入顺序、Pointer 颜色槽、当前公开 Pointer 和服务端 Cursor Version。
- 每条连接分别持有严格递增的客户端 `seq`、速率状态和最后活动时间。控制权由最近产生合格移动的连接取得。
- 房间使用单调递增的 `membership_version`；成员事件出现版本缺口时，客户端请求 Presence Snapshot，而不是 Canvas Resync。
- Realtime Presence 是可丢弃瞬时状态；Canvas Mutation 是有序、持久的共享内容变更。二者不得共享持久化、Revision 或失败语义。

## 9. Data and persistence

| Data | Authority | Boundary | Retention | Migration/recovery |
| --- | --- | --- | --- | --- |
| 在线成员、加入顺序、Pointer 颜色、公开坐标 | 当前服务进程 | Memory | 最后一条连接离开或进程退出即删除 | 连接恢复后由新 Snapshot 重建 |
| `avatar_color_slot` | 账号数据库 | Instance State | 随 Account 保存 | 新列 `INTEGER NOT NULL DEFAULT 0`；旧账号启动迁移时随机回填 1–10；新账号注册时随机分配 |
| Canvas 内容、Revision、历史 | 既有 Canvas Authority | Workspace Data | 保持既有规则 | Presence 不写入、不触碰 |
| 浏览器 Pointer 状态 | 当前页面内存 | Device transient | 页面或连接生命周期 | 不写浏览器持久存储 |

- 数据库只保存头像整数槽位，不保存 CSS Token 名称。槽位 `0` 仅用于迁移前哨，完成迁移后合法账号为 1–10。
- 账号数据库不随 Workspace 搬迁，因此 Account Avatar 属于 Instance State。
- 不保存轨迹、最后位置、Presence 审计或活动时间。旧分支可忽略新增账号列；首版不提供反向迁移或默认头像回滚。

## 10. API / WebSocket / Provider contracts

Presence 复用现有 `/ws/canvases/{canvas_id}` JSON WebSocket。初始 Canvas Snapshot 之后，兼容服务端发送 Presence Snapshot。协议不增加第二条连接。

| Contract | Caller | Observable result | Errors/recovery |
| --- | --- | --- | --- |
| `presence_snapshot` | Server | 提供 `protocol_version`、有效更新间隔、`membership_version`、自己的 `participant_id` 和完整成员状态 | 替换客户端全部 Presence；不替换 Canvas |
| `presence_update` | Client | `{seq, cursor:{x,y}\|null}` 更新该连接的最新公开意图 | 无效或过频 Presence 不产生 Canvas Reject/Resync |
| `presence_join` / `presence_leave` | Server | 以 `membership_version` 更新账号级成员集合 | 版本缺口触发 `presence_resync` |
| `presence_batch` | Server | 携带变化参与者的最新 Cursor Version 和坐标 | 批次可发送给包括发送者在内的所有连接；客户端忽略自己 |
| `presence_resync` | Client | 请求仅 Presence Snapshot | 不触发 Canvas Snapshot 或 Revision 变化 |

- 客户端入站 Presence JSON 最大 `1KiB`，只接受规定字段；`seq` 必须为安全整数且对该连接严格递增，`x/y` 必须为有限数。
- 客户端不得提交账号、显示名、角色、颜色或 Canvas ID；这些全部来自已认证 Session 和服务端房间状态。
- 每个账号的服务端 Cursor Version 与房间 Membership Version 分开演进。
- 短时过频更新静默合并或丢弃。持续过频先禁用该连接的 Presence；继续滥用可关闭整个 Canvas Socket。普通 Presence 错误不显示 Toast、不发 Mutation Reject、不触发 Canvas Resync。
- 旧客户端可以忽略未知服务端消息；新客户端在旧服务端未发送 `presence_snapshot` 时不发送 Presence，构成首版能力协商。

## 11. Security and privacy

- WebSocket 建立和每条消息继续使用既有认证、账号状态、访问 Epoch 与 Canvas 编辑权限检查。
- 服务端从 Session Actor 生成公开身份；不信任客户端自报资料，不向前端暴露不必要的账号 ID、连接数、角色、活动时间或设备信息。
- Presence 只在同一获授权 Smart Canvas 房间广播；Guest Account 和 Anonymous Share Visitor 不加入房间。
- 坐标只描述 Canvas 世界位置，并按消息大小、类型、有限数和速率进行约束；不落盘、不进入日志正文或诊断导出。

## 12. Performance and reliability constraints

- 环境变量 `INFINITE_CANVAS_PRESENCE_UPDATE_INTERVAL_MS` 默认 `100`，只接受 `50–500` 的整数；无效配置必须导致启动失败，修改后重启生效。服务端在 Snapshot 中下发有效值，浏览器不直接读取环境变量。
- 服务端批处理窗口为 `min(有效更新间隔 / 2, 50ms)`；没有变化时不发送批次。同一个已编码批次可以广播给所有连接，包括发送者。
- 每条 Socket 使用一个发送 Worker，但逻辑上区分三种服务等级：文档/控制消息为高优先级可靠 FIFO；成员状态可折叠成最新 Presence Snapshot；Pointer 为低优先级 latest-wins。
- 每个接收端至多保留一个最新成员 Snapshot，以及每个参与者一个最新 Pointer。Pointer 不计入现有文档队列 `64` 条 / `16MiB` 限制，不因拥塞触发 Canvas Resync。
- Presence 不进入 Canvas Operation Lock、Store Thread、SQLite、Revision 或 Mutation 广播队列。慢接收端先丢弃旧 Pointer，必须保持文档消息可用且内存有界。
- 复用现有 `15s` 应用 Ping；合法 Ping、Mutation 或 Presence 都刷新连接活动。干净断开后成员移除目标不超过 `1s`，异常断开最迟 `45s` 清理。
- 产品目标负载为 10 个账号按默认 `10Hz` 持续移动 30 分钟，并同时存在 `20 mutation/s`。验收 Gate：
  - Pointer 端到端延迟 `P95 ≤ 250ms`；
  - Mutation `P95/P99` 相对无 Presence 基线不得出现无法解释的 `>20%` 劣化；
  - `10ms` Event Loop Probe 的 `P99 ≤ 50ms`；
  - 不出现 Revision 错误、Canvas Resync、永久发送失败、无界 RSS 或无界队列增长；
  - 人为慢客户端只丢 Pointer，不拖慢其他客户端或文档操作。
- 现有 20 条 Realtime Client Connection 保护不变。20 条连接 × 默认 10Hz 只作为压力探索，不构成用户体验承诺。

## 13. Design system contract

- 以 `static/css/design-tokens.css` 的现有颜色 Primitive 为基础定义 10 组协作者语义槽；不足时先增加 Primitive，再建立 Avatar 背景、Avatar 字符、Pointer 填充和 Pointer 对比文字的语义 Token，业务样式不得散落裸色值。
- Account Avatar 使用浅色背景和中等明度、高饱和度字符；Realtime Pointer 使用中等明度、高饱和度填充。每槽在 Light/Dark 中都需达到既有文字、轮廓和 Focus 可见性规范。
- 成员组、工具提示、`+N`、只读弹层和 Focus 行为应复用现有 `ic-*` 公共组件与 Overlay 层级；Pointer Overlay 可作为 Smart Canvas Shell 的专用非交互层，位于 Canvas 内容之上、固定菜单/工具栏/Dialog/Toast 之下。
- Pointer Overlay 必须位于 Canvas 世界变换之外，使用世界坐标到本机屏幕坐标投影，避免箭头尺寸随 Zoom 改变。
- 自动化机器视觉覆盖关键几何、层级和 Token；人工视觉覆盖 Light/Dark、多人重叠、长姓名、`+N`、错误通知覆盖、Zoom/Pan 和 Reduced Motion。

## 14. Implementation decisions

- 在现有 Canvas WebSocket 上增加独立 Presence 协议和房间内存状态，不创建新服务或新连接。
- Connection Manager 保留可靠文档流，并为成员状态和 Cursor 增加可折叠的有界发送语义；高频坐标不可排在文档消息之前。
- 前端 Presence Controller 负责能力握手、捕获区、5px 累计阈值、节流、Tab/Window 生命周期和协议；Presence Renderer 负责投影、插值、层级、头像组和无障碍。
- 账号系统拥有 Avatar 颜色槽的创建和迁移；Design Token 层拥有槽位到具体主题颜色的映射。
- 本决定可在独立分支整体舍弃，且没有跨服务或不可逆架构承诺，因此不新增 ADR。

## 15. Acceptance and testing

### Highest test seam

以真实应用工厂的已认证 Canvas WebSocket 作为协议、授权、队列和恢复的最高后端接缝；以两个真实浏览器上下文连接同一 LAN Smart Canvas 作为 Pointer 投影和交互的最高用户接缝。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
| 两个合法账号进入和离开 | WebSocket 集成测试 | 首连接产生 Join，最后连接产生 Leave；多 Tab 仍只有一个成员 |
| 多 Tab 控制权切换 | WebSocket + 浏览器 | 最近移动连接控制；隐藏后清空，旧坐标不复活 |
| 世界坐标投影 | 真实页面浏览器 | 不同 Zoom/Pan 下各自投影正确，固定 UI 不捕获，离屏隐藏 |
| 5px 阈值、节流和静止 | 浏览器 + 协议观测 | 小抖动不发送，区间只发最后值，静止无流量且标签 1.5s 淡出 |
| 成员版本缺口 | WebSocket 集成测试 | 只请求和替换 Presence Snapshot，不触发 Canvas Resync |
| 慢客户端和过频发送 | WebSocket/负载测试 | 旧 Cursor 被覆盖；文档消息持续；滥用按规则降级 |
| 权限撤销与无权角色 | WebSocket 集成测试 | 不可加入或继续 Presence，身份资料不可伪造 |
| 账号迁移和默认头像 | 数据库/HTTP/UI 测试 | 旧账号回填 1–10，新账号随机持久化，全产品默认头像一致 |
| 配置边界 | 启动测试 | 50、100、500 合法；缺省为 100；非整数或越界启动失败 |
| 目标负载 | 单服务 LAN 负载测试 | 全部性能与可靠性 Gate 达标，队列和 RSS 有界 |

### Human acceptance

| Role | Scene | Evidence / confirmation |
| --- | --- | --- |
| UI | Light/Dark × Desktop/Narrow；1、6、10+ 人；长姓名；错误通知覆盖 | 截图或录像确认层级、Token、可读性和成员顺序 |
| Interaction | 两台设备在局域网移动、停止、离开、失焦、切换 Tab、Zoom/Pan、Reduced Motion | 录像确认平滑、跳转规则、无事件遮挡和恢复 |
| Product | 管理员/设计师与无权角色；Presence 失败时继续编辑 | 现场确认首版边界和静默降级 |

### Regression neighbors

- Canvas Mutation 顺序、Revision、Resync 和现有连接保护。
- Canvas 打开、关闭、权限撤销和应用 Ping。
- Smart Canvas 固定工具栏、Dock、Dialog、Toast、键盘与指针命中。
- 账号注册、旧账号迁移、账号管理和全产品既有头像位置。
- Design Token Light/Dark 与公共 Overlay/Tooltip/Popover 行为。

## 16. Rollout, migration and rollback

- 在独立分支和 Worktree 开发。视觉、协议、权限、迁移或负载任一 Gate 未通过时不得合并；产品可继续使用无此功能的原分支。
- 发布时向前迁移账号数据库并随机回填旧账号颜色槽；不提供默认头像反向迁移。旧代码可忽略新增列。
- 新客户端以收到 `presence_snapshot` 作为能力信号，兼容旧服务端；旧客户端必须可忽略新消息。
- 首版没有运行时总开关，也不提供 Account Avatar 回滚。性能问题通过不合并或切回无功能分支处理。
- 实现完成前规格保持 Active；只有自动化、双机 LAN 人工验收和负载 Gate 全部通过，才能标记 Implemented/Verified 并按文档毕业规则更新 Current Authority。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product map | [F02 / F06 / F13](../PROJECT-MAP.md#功能规格注册表) |
| Tracked work | GitHub Issue #196 |
| Research | [Issue #196 Presence / Awareness 调研](../archive/2026-08-29-issue-196-presence-awareness-research.md) |
| UI surfaces | Smart Canvas Shell；账号入口；账号管理；Design Token 工作台 |
| Implementation seams | Canvas WebSocket / Connection Manager；账号数据库；Smart Canvas Pointer Overlay 与成员组 |
| Automated tests | `tests/test_account_avatar.py`；`tests/test_realtime_presence.py`；`tests/test_connection_manager.py`；`tests/test_canvas_realtime_websocket.py`；`tests/test_realtime_presence_frontend.py`；`tests/test_realtime_presence_load_cli.py` |
| Browser/manual evidence | `tests/realtime_presence_browser_smoke.cjs`；[Issue #196 Presence 验证与毕业记录](2026-08-29-smart-canvas-realtime-presence-verification.md) |
| ADRs | 无 |
| Replaced historical docs | 无 |

## 18. Open questions

无。未在正文指定的内部结构和测试夹具由实现者在不改变可观察合同、数据边界和 Gate 的前提下决定。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| 2026-08-29 | Approved | 根据 Issue #196 仓库调研和逐项产品访谈建立首版完整合同 | 用户确认全部已讨论决定，并授权补完其余实现规格 |
| 2026-08-29 | Implementation in progress | 记录自动化接缝与待执行 LAN/30 分钟负载 Gate；规格仍未毕业 | 自动化与真实页面浏览器 smoke 已通过；人工和正式负载证据仍 Pending |
