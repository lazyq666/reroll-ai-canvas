# Smart Canvas 生成失败反馈

> Status: Current  
> Last verified: 2026-08-27
> Applies to: Smart Canvas 图片、视频、文本与处理器生成

## 用户合同

生成失败后，反馈必须持续可见，直到用户关闭、重试成功或离开当前任务。失败不能只用短暂 Toast 表达，也不能删除已经成功的输出。

| 结果 | 标题 | 内容 | 操作 |
| --- | --- | --- | --- |
| 部分成功 | `{操作}部分成功` | `已完成 {success} 项，{failed} 项失败。` | 查看详情、复制诊断、关闭 |
| 全部失败 | `{操作}失败` | `{failed} 项均未完成。` | 重试、查看详情、复制诊断、关闭 |
| 单项失败 | `{操作}失败` | 用户可理解的分类文案 | 重试、复制诊断、关闭 |

操作名按真实入口显示为“图片生成”“视频生成”“文本生成”或处理器名称；无法识别时使用“生成任务”，不能暴露内部函数名。
失败 Node 内的“查看日志”必须打开生成日志 Modal；节点保留日志 ID 或稳定 Generation Run ID 时，Modal 应同时定位对应记录。

### 生成日志 Modal

生成日志 Modal 使用“任务索引 + 所选任务详情”的单一结构。标题栏只显示“生成日志”和关闭按钮；不显示标题图标、说明文案或主题切换入口，明暗外观跟随应用全局主题。

点击日志入口或失败 Node 的“查看日志”后，Modal 立即打开，不等待历史请求完成。首次加载时，左右两栏使用共享 `ic-skeleton` 占位，并标记加载状态；成功后替换为任务索引和详情，保留入口指定的日志 ID 或 Generation Run ID 定位。已加载的历史在当前页面内直接复用。加载失败时显示明确说明和“重新加载”按钮，不能误报为没有日志；只有请求成功且没有记录时显示空状态。加载期间可以通过关闭按钮、Escape 或背景关闭，迟到的响应不得重新打开 Modal 或抢走焦点；连续打开复用正在进行的请求，以最后一次入口指定的任务为准。中英文切换保留加载或错误状态，骨架外观跟随全局主题和减少动态效果设置。

验收入口：`node tests/smart_canvas_log_loading_regression.cjs` 覆盖慢请求、任务定位、缓存、关闭、连续打开、失败重试、空状态和语言重绘；`node tests/generation_log_loading_browser_app.cjs` 提供真实页面模拟服务，通过标准输入的 `hold`、`success`、`empty`、`error` 控制响应，不连接真实云端。

左侧把每条 Generation History 记录当作一个对应 Node 的任务，并按“今天”“昨天”“本月”“上个月”或更早月份的真实时间分组。失败任务以更高的信息层级显示用户可理解的概括原因；成功任务使用更低高度。两种状态都可以选择查看详情。索引不显示成功、失败或总数统计，也不放置或预留复制按钮。索引标题固定为“任务成功 / 任务失败 / 任务部分完成 · Prompt 第一句”，使用 Regular 字重并单行省略；失败状态图标与概括原因放在同一行。成功记录不显示状态图标：存在引用图时仅显示缩略图，不存在引用图时文字占满整行。左侧滚动面使用 Canvas Surface，Modal 内滚动条与 Prompt Node 的细滚动条规范一致。右侧详情标题仍为“任务类型 · 任务名称”：优先使用当前 Node 的用户自定义名称，没有名称时使用 Prompt 第一句，不生成临时摘要。右侧始终保留完整 Prompt。

右侧是连续信息面，不叠加多层卡片，整个内容面使用 `--ui-space-5` Padding。它展示状态、Node 与完整时间、输出设置、Model、Provider、耗时、失败概括、Reference Input Instance 缩略图和完整提示词；引用图可以打开轻量预览。成功详情标题不显示状态图标；失败状态图标放入失败概括模块，图标容器与图标等大且不带独立背景。失败概括模块使用 `--ui-color-action-secondary-danger` 背景和 `--ui-radius-s` 圆角，不使用左侧 Border。Generation Run ID、上游任务 ID、HTTP / 错误码和经过脱敏的 Provider 原文放在默认收起的“技术详情”中。

Modal Shell 使用共享 `ic-dialog` 并挂载在 Canvas 手势根之外。Modal 打开后，初始焦点进入当前任务，而不是强制聚焦关闭按钮；因此关闭 Tooltip 不会在没有 Hover 或键盘导航时自动出现。
Modal 必须拥有其范围内的 Pointer 与 Wheel 输入：按下、松开或单击内容不得改变底层 Canvas Selection、打开 Node 的 Prompt Authoring，也不得启动画布手势；左右滚动区仍可正常滚动，但滚轮与触控板事件不得穿透为底层 Canvas 的平移或缩放。
Modal 内任意区域的 `contextmenu` 事件不得冒泡打开 Canvas 的创建菜单或 Node 菜单；文本、图片等内容的浏览器原生菜单仍可使用。

“复制诊断信息”只位于右侧底部，并使用 `ic-button-primary` 与左侧复制图标。切换任务后按钮必须复制当前详情对应的报告。报告至少包含时间、状态、耗时、任务、Node、Provider、Model、输出设置、Generation Run ID、上游任务 ID、错误分类、用户可读原因、HTTP / 错误码、技术原文与引用图数量；保留现有支持所需的安全请求参数和任务结果计数，但不包含 Prompt、素材名称或内容、图片二进制、API Key、Token、Cookie、密码、鉴权 Header 或完整本机路径。

## 错误表达

界面先给用户能行动的摘要，再在详情中保留 Provider 原始信息。分类优先级如下：

| 类别 | 用户说明 | 推荐下一步 |
| --- | --- | --- |
| authentication | 账号、密钥或登录状态不可用 | 前往设置检查连接 |
| provider permission | 平台明确拒绝当前账号的生成权限 | 核对运行设备上的 CLI 账号和生成权限；已开通时携带诊断联系平台 |
| quota / balance | 额度、余额或套餐限制 | 检查账户后重试 |
| rate limit / concurrency | 请求过多或平台并发已满 | 稍后重试 |
| moderation / policy | 输入或结果被平台策略拒绝 | 调整 Prompt 或素材 |
| timeout / network | 平台或网络未在期限内响应 | 保留输入并重试 |
| invalid request | 模型、尺寸、素材或参数不被接受 | 返回设置修正 |
| provider unavailable | 平台暂时不可用 | 稍后重试或更换 Provider |
| target changed | Node 已删除、权限变化或结果已过期 | 保留生成历史，不写回旧目标 |
| unknown | 尚未分类 | 复制诊断并重试 |

提交前画布同步超时使用 `canvas_sync_incomplete`，说明本次生成请求尚未提交，并提示
等待画布恢复同步后重试。历史记录中“实时同步尚未完成，生成任务未提交”、智能分层的
“画布仍在同步，请稍后重试保存提示词”及对应英文原文也使用此分类；已存为 `unknown`
的诊断在显示时按当前规则重新识别，切换语言时重新解析用户说明。此分类不填造 HTTP 状态、上游任务 ID
或费用证据，不能将本地同步失败解释为 Provider 拒绝生成。

APIMART 等平台返回“账户限制”时，不能自行推断为余额不足；只有原始响应明确指向余额、额度或套餐时才使用对应类别。

Dreamina CLI 返回 `current account is not allowed to use dreamina_cli` 或对应中文原文时，使用 `provider_permission_denied`，不能显示“平台内部错误，稍后重试”。这一语义也优先于历史记录中包装的 HTTP 502；新请求以 HTTP 403 保留权限拒绝原文。登录或积分查询成功只证明对应查询可用，不能证明生成接口的账号资格。没有任务或计费证据时不推断扣费、退款或可恢复状态。

CLI helper 返回结构化错误时，`error.message` 与经过脱敏的 `error.detail` 都必须进入 Generation Run 诊断；不能把带上游参数说明的 HTTP 400 收缩成只有 `HTTP 400`。失败 Alert 的“查看详情”同时保存当前日志 ID 和稳定的 Generation Run ID；若日志持久化或协作对账后 ID 发生变化，应按 Generation Run ID 找到对应记录并聚焦。

生成信息概览中的“模型”使用用户选择时看到的精确模型目录名称；例如 Codex 目录项可显示为 `gpt-image-2-cli`。Provider 请求所需的底层模型 ID（例如 `gpt-image-2`）继续保存在请求诊断中，不能用目录显示名称替换执行参数，也不能把底层 ID 当作概览名称。

## 诊断复制

复制内容用于支持与排障，应包含：操作名、时间、Provider、Model、Generation Run/Operation ID、分类、HTTP/Provider 状态、可安全公开的原始错误和成功/失败数量。不得包含 API Key、Token、Cookie、密码、完整本机路径、Prompt 或素材名称与内容。

## 费用与恢复

系统不能在缺少 Provider 账单证据时承诺“未扣费”或“已退款”。可明确说明哪些输出已保存、哪些任务失败、重试是否会创建新的 Generation Run。重试必须复用仍有效的用户输入，但继续遵守幂等、权限和 Target Guard。

## 验收

- 单项、部分和全部失败的数量、标题与操作名正确。
- Alert 在用户处理前持续存在；详情可展开，诊断可复制且已脱敏。
- CLI helper 的结构化上游错误详情可见；日志 ID 对账变化后，“查看详情”仍能按稳定 Generation Run ID 聚焦本次失败。
- Modal 只呈现日期分组任务索引与当前详情；成功和失败任务都可选，失败层级更强，成功行更紧凑，索引无统计和复制动作。
- Modal 使用位于 Canvas 手势根之外的共享 `ic-dialog`；点击日志任意内容不改变 Node 选择、不打开 Prompt Authoring，初始焦点位于当前任务且关闭 Tooltip 不会默认出现。
- Modal 内的 Wheel 只滚动本地内容，不改变 Canvas 的 `x` / `y` / `scale`。
- Header、索引、详情、底部操作区和遮罩空白上的右键都不会打开 Canvas 菜单。
- 索引标题使用“任务状态 · Prompt 第一句”，失败图标与概括原因同行；成功状态在索引和详情中均不显示图标；详情标题遵守“类型 · 自定义 Node 名称 / Prompt 第一句”回退规则。
- 右下角唯一的 `ic-button-primary` 复制当前任务的安全诊断；报告字段完整且不泄露 Prompt、素材内容、凭据、路径或图片二进制。
- 生成信息概览显示模型目录名称，诊断仍保留实际请求模型 ID；两种身份不会互相覆盖。
- 已成功输出不会因同批其他任务失败而消失。
- 可恢复错误保留 Prompt、素材和设置；目标失效不会让旧 Node 复活。
- 文本生成在输入框聚焦或保存回执延迟超过 5 秒时仍可提交一次；同步始终未完成时不提交，保留输入，并在中英文日志与诊断中显示同步失败分类。
- 智能分层使用同一生成同步等待；保存确认后才提交，超时保留分层要求并记录同步失败。历史中已保存为未知错误的此类失败，在任务索引、详情和中英文切换后都显示同步失败原因。
- 反馈使用公共 `ic-alert` 等项目组件，并通过真实 Smart Canvas 行为测试验证。

代表性测试：`tests/test_generation_log_modal.py`、`tests/generation_log_modal_browser_smoke.cjs`、`tests/test_smart_canvas_generation_failure_feedback.py`、`tests/smart_canvas_generation_task_query_browser_smoke.cjs`。
