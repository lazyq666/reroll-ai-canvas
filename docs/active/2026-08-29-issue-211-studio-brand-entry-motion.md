# 工作台品牌入场动画

- **Status**：Implemented / Review
- **Feature ID**：F01 / F13
- **Owners**：产品 / 品牌 / 前端 / 测试
- **Last verified**：2026-09-26
- **Applies to**：Issue #211、[LAZ-65](https://linear.app/lazyq/issue/LAZ-65)
- **Supersedes**：无
- **Superseded by**：无
- **Related ADRs**：无
- **Domain terms**：App Shell、Studio Sidebar

## 1. Problem and outcome

首次进入 Reroll 工作台时，应用从身份确认直接切换为完整界面，品牌的流体节点语言没有延续到产品体验。工作台现在只在当前浏览器站点存储中尚未记录完成状态时播放一次品牌入场：四颗液滴顺时针旋入、以短粗液桥连成带孔的环，孔洞闭合成一个液体后边旋转边展开为 Logo；`word.svg` 的字母随后逐个浮现，整个锁定组合收束到真实的 `.sidebar-logo-image.sidebar-logo-wordmark`，再揭示已完成初始化的工作台。完整入场在 `3.38` 秒内结束，满足 4 秒上限。

Logo 由共享的矢量动效模块逐帧绘制为单个 SVG 路径，不再使用预渲染视频。静止帧与 `logo.svg` 几何一致，颜色继承 `currentColor`，Light / Dark 不需要反相。

登录成功使用整页跳转进入 `/`，因此与首次直接打开工作台共享同一实现；成功播放后，同源的新标签页、后续登录和浏览器重新启动都不再播放，除非用户清除该站点的数据。浏览器刷新无条件跳过动画，即使用户在首次动画尚未结束时刷新也不会重播。

## 2. Goals and non-goals

### Goals

- 使用流体拓扑语言：液滴汇聚、成环、合一、展开，全程缓入缓出，没有过冲、压扁或果冻回弹。
- 文字必须来自 `static/images/brand/word.svg`，终态比例与 `wordmark.svg` 一致。
- 桌面端不硬编码最终截图坐标，而是在侧栏展开后测量真实 wordmark 盒子作为终点。
- 工作台身份、路由和 iframe 初始化与动画并行；动画只覆盖呈现，不拥有启动状态。启动较慢时显示品牌加载动画，而不是冻结在终态。
- 运行时加载失败和 Reduced Motion 都不会阻塞工作台。
- Light / Dark 与窄窗口有明确行为。

### Non-goals

- 不改变 Logo SVG 路径或品牌字形。
- 不改变登录、权限和工作台路由协议。
- 不在移动侧栏中新增原本不存在的 Logo 区。
- 不把动画进度写入账户或 Workspace 持久化。

## 3. Interaction and state contract

| Phase | Time | Visible result | Exit |
| --- | --- | --- | --- |
| `mark` | 0 – 1450 ms | 液滴旋入并连成带孔的环（约 480–660 ms），孔洞闭合为一个液体，液体单向扭转后边旋转边展开；Logo 在 1600 ms 精确落定 | 到达锁定时间 |
| `wordmark` | 1450 – 2450 ms | Logo 左移缩放为锁定组合，五组字母以 55 ms 间隔上浮淡入；侧栏展开 | 路由已就绪时进入收束；否则保持此阶段并显示加载 |
| `wordmark` + 加载 | 2450 ms 起 | Logo 在文字旁运行品牌加载循环（标志 → 四个圆点 → 成环 → 标志，每圈 2 秒、顺时针 90°），显示“正在准备你的创作空间…” | 路由就绪后的下一个精确 Logo 节拍，最多多等一圈 |
| `docked` | 650 ms | 锁定组合按 `wordmark.svg` 的内部比例移动并缩小，边界与真实侧栏 wordmark 重合 | 收束开始后 480 ms |
| `finished` | 450 ms | 遮罩淡出并移除，收束在淡出中完成，真实 App Shell 接管 | 完成 |
| `reduced` | — | 居中短暂显示静态 `wordmark.svg`，不播放运动 | 路由就绪后移除 |

动画在 `wordmark` 开始时发出 `studio-entry-motion-dock`。App Shell 只在当前标签页本次入场中临时展开侧栏，不改写既有 `studio_sidebar_pinned` 偏好；用户后续手动切换仍按既有规则保存。收束开始时测量已展开的侧栏 wordmark。宽度不超过 `720px` 时侧栏 Logo 区本来不可见，因此锁定组合在中央缩小并淡出。

完成标记写入同源浏览器持久存储 `localStorage.studio_brand_entry_seen`。值为字符串 `"1"` 时，同源的新标签页、后续登录和浏览器重新启动都跳过动画；清除该站点的数据后会恢复首次播放。读取或写入存储失败时不阻塞工作台，当前首次进入仍可播放，但无法保证后续永久跳过。`<head>` 阶段同时检查持久完成标记和 Navigation Timing 的 `reload` 类型，并在动画 DOM 解析前添加 `studio-entry-motion-skip`；即使动画模块尚未执行，已完成用户与刷新导航也不会绘制动画首帧。运行时再执行同一判断并移除动画层。

## 4. Presentation and accessibility

- 动画层 `aria-hidden="true"`、`pointer-events: none`，不改变焦点顺序，也不拦截工作台控件。
- Logo 使用共享模块 `static/js/infinite-canvas-ui/brand-motion.js`：四个距离场形状（两个圆角方形、两个圆）在移动时以多项式平滑并集形成短粗液桥，静止时回到原稿的圆形圆角颈部；每帧追踪零等值线为单个 SVG 路径，网格密度约每 2.2 个设备像素一格，上限 120 格，单帧约 2 ms。
- 首个脚本帧之前动画层只显示背景，没有静态 Logo 残影；收束结束后换成原始 `logo.svg` 路径。
- 最终分离几何以侧栏 `112px` wordmark 的实测分解为基准：Logo `30.07px`、间距 `8.14px`、文字 `73.68 × 22.69px`，并按真实目标宽度等比计算。
- `word.svg` 在运行时重建为以 `currentColor` 着色的亮度遮罩，字母与其内孔分组后逐个出现；Light / Dark 使用语义 Token，不做反相。重建失败时保留原图并整体淡入，Dark 下对该图反相。
- 状态文案通过公共 i18n 资源显示：中文为“正在准备你的创作空间…”，英文为“Preparing your creative space…”，仅在慢启动时出现，不得在生产 HTML 中维护单语言文本。
- Reduced Motion 不运行动作序列，只短暂显示静态组合标。

## 5. Failure and recovery

- 动画模块以 `type="module"` 加载，启动时写入 `data-entry-runtime="ready"`。`<head>` 中的守护逻辑在 `DOMContentLoaded` 后 1 秒检查该标记，模块加载或执行失败时直接移除动画层，工作台照常显示。
- `word.svg` 读取或解析失败时使用页面中的 `<img>` 回退，不影响收束和完成。
- 页面在后台时 `requestAnimationFrame` 暂停；单帧推进最多 64 ms，回到前台后从原处继续，不会跳过整个序列。
- `finished` 淡出阶段继续完成收束并保持 `docked` 几何，只改变最外层遮罩 opacity，不会反向移动或放大。
- 动画结束早于身份 / 路由初始化时进入加载循环，直到 `studio-route-booting` 移除；动画不会自行伪造路由就绪，并且只在精确 Logo 节拍收束。
- 动画自身无论成功或失败都不修改认证结果、不加载 iframe，也不阻断登录重定向。

## 6. Acceptance and verification

1. 当前浏览器尚无完成标记时，首次已登录进入工作台能看到液滴汇聚、成环、合一、展开、字母浮现、收束和 App Shell 淡入，全程 4 秒内结束；完成后刷新、新标签页、后续登录与浏览器重新启动都不显示动画首帧，清除站点数据后恢复首次播放；动画中途刷新也不显示动画。
2. 文字来源是 `/static/images/brand/word.svg`，终态与可见 `.sidebar-logo-image.sidebar-logo-wordmark` 的外框误差不超过 `1px`。
3. 登录成功跳转 `/` 后复用同一入口，无第二套动画实现。
4. Light / Dark 保持品牌对比度；窄屏居中完成且无横向溢出。
5. Reduced Motion 不播放运动；动画运行时加载失败后工作台仍可进入。
6. 身份初始化较慢时显示加载循环与状态文案，就绪后在精确 Logo 节拍收束。
7. 动画层不接收指针或焦点，真实工作台只在既有身份初始化完成后可见。
8. 中文与英文偏好下的状态文案分别显示对应语言，且英文在现有桌面锁定组合宽度内不截断。

## 7. Verification plan

- Node 合同 `tests/brand_motion_contract.test.mjs`：静止帧与 `logo.svg` 逐点一致，加载循环首尾无缝，拓扑依次为 3 → 4 → 环 → 1 → 3，所有帧留在加载视框内，入场与加载循环均不超过 4 秒。
- Python 静态合同 `tests/test_issue_211_studio_brand_entry_motion.py`：矢量入口、模块加载、4 秒时间预算、慢启动节拍、失败守护、真实目标选择器、主题颜色、持久完成标记与 Reduced Motion。
- Playwright 浏览器入口（Chromium / Firefox / WebKit）：首次播放、持久完成标记、同源新标签页、浏览器存储恢复、同标签刷新、运行时加载失败、慢启动、Reduced Motion、Light / Dark。
- 回归：T30 App Shell 静态合同和桌面 / 窄屏浏览器 Smoke。

实际验证（2026-09-25，本机 macOS，Chrome 154）：

- `node tests/brand_motion_contract.test.mjs`：6 项通过；把颈部圆角半径改为错误值时静止帧一致性检查失败，确认检查有效。
- `python3.12 scripts/readiness_node.py`：18 组 Node 合同全部通过。
- `.venv/bin/python -m unittest tests.test_issue_211_studio_brand_entry_motion`：11 项通过。
- `ISSUE_211_BROWSER=chromium node tests/issue_211_studio_brand_entry_motion_browser_smoke.cjs`（T30 预览服务）：正常播放、`localStorage` 完成标记、同源新标签页、浏览器存储恢复、播放完成后刷新、动画中途刷新、动画模块加载失败 3 秒内移除、身份延迟 4 秒的慢启动加载与收束、Dark Reduced Motion 全部通过；五组字母内联，英文状态文案为 `Preparing your creative space…` 且不溢出。终态 Lockup `x=59.5 / y=38.95 / 112.04 × 30.11`，目标 `x=59.5 / y=38.86 / 112 × 30.28`；文字 `73.78 × 22.72`。
- `ISSUE_211_BROWSER=chromium node tests/issue_211_studio_brand_entry_early_skip_browser_smoke.cjs`：阻断动画模块后仍在 `<head>` 阶段应用 `studio-entry-motion-skip`，动画 DOM 首屏 `display: none`。
- `node tests/issue_211_studio_brand_entry_layer_browser_smoke.cjs`：Dark 播放阶段 Mark 路径逐帧变化、颜色等于语义文字色、Mark Frame 无背景、页面无 Video；文字为 `currentColor` 遮罩；`finished` 淡出至 `320ms` 时 Lockup 仍位于目标且 Mark 为 `30.11px`、路径为原始 Logo；工作台揭示后无残留。

Remaining gates：Firefox 与 WebKit 引擎的同一套浏览器 Smoke，以及 Windows / Linux 真实设备的帧率与 Reduced Motion 人工确认。原 Issue #213 跟踪的透明 VP9 Alpha 解码问题随视频移除不再适用。功能保持 Active `Implemented / Review`，不在这些门槛完成前晋升 Current。

PR 合入回归（2026-09-26）：品牌加载器观察 `data-ui-motion` 的即时变化，无需重建组件即可切换到静态标志，恢复正常偏好后继续动画。核心浏览器测试移除修改 label 触发重建的干扰，先复现失败，再通过切换、静态保持与恢复检查；9 项核心合同和 6 项品牌运动 Node 测试通过。上述跨引擎及真机门槛仍保留。

## 8. 运行时启动加载与统一范围（LAZ-65）

`/startup` 及业务未就绪时返回的运行时页面，在 `starting`、`restart_waiting`、`maintenance`、`stopping` 四种状态中，以公共 `ic-loading[loading-animation="brand"]` 替换品牌栏中的静态图。标志尺寸使用 `--ui-control-height-l`，不另建动画时钟，不播放首次工作台入场序列，也不增加最低等待时长。状态轮询就绪后仍立即进入既有刷新/跳转流程。

标志是 `aria-hidden` 装饰；标题、详情及操作保持原有结构，组件标签复用相同中英文状态键。页面读取公共主题偏好，品牌矢量使用主题文字色。系统或页面 Reduced Motion 显示静态标志。组件升级前或模块请求失败时保留原生静态品牌图片，正文和独立的运行时轮询仍可运行。`failed` 和 `recovery_required` 不显示持续加载，保留复制错误与恢复工作区入口；等待安全重启仍保留取消活动任务并立即重启的按钮。

### 场景检索与边界

| 场景 | 当前实现 / 本次结果 | 统一判断 |
| --- | --- | --- |
| 服务启动、等待安全重启、维护、重启 | `backend/infinite_canvas/app.py`；本次接入 | 已统一 |
| 工作台首次入场中的慢启动 | `static/js/studio-entry-motion.js`；共享品牌几何和循环 | 已统一，保留首次入场策略 |
| 画布列表、分享页、角度工具归档、全景查看 | 对应 HTML 的 Region `ic-loading` | 已统一 |
| 资产库初次读取、切换文件夹 | `workspace-asset-library.js` 的 `_loading` 当前仅显示状态文字 | 优先候选：初次无内容用 Region 品牌加载；已有内容的分页保留紧凑反馈 |
| RunningHub 工作流与应用参数编辑器 | `api-settings.js` 的 `renderRhWorkflowEditorLoading` 使用 Spinner | 候选：大区域内容等待可统一；目前错误分支也调用同一 Loading 函数，必须先区分失败与加载，不能只替换动画 |
| 首次配置引导读取 | `account-setup.js` 的 `state.loading` 当前显示文字与重试入口 | 候选：仅初始读取可用；读取失败也会保持此状态，必须先拆分失败恢复 |
| 工作区搬家详情 | `workspace-move.js` 的真实百分比、文件数、容量及阶段 Badge | 保留 Progress；概览页的维护等待已统一 |
| 打开 Smart Canvas | `canvas-opening.js` 的既有 Phase 驱动可见品牌加载；升级前有静态回退，所有打开阶段保持同一居中位置及尺寸 | 已补齐，保留真实节点骨架；详见[渐进式打开规格](2026-08-28-smart-canvas-progressive-opening.md) |
| 生成日志、媒体缩略图 | `generation-log-modal.js` 及媒体 Shimmer | 保留结构占位 |
| 图像/视频生成、增强、合成、按钮提交、上传、实时同步 | Orbs、Halftone、Spinner、Badge 或真实进度 | 保留任务专用反馈，不替换为品牌等待 |
| 偏好设置里的目录读取、CLI 帮助读取 | 局部文字占位 | 保持紧凑，不在每个字段重复显示品牌标志 |

画布列表加载、空项目、无可访问项目与加载失败互斥：初始读取或刷新时隐藏空状态；卡片为空且项目查询未结束时继续显示加载，不能把尚未返回的项目列表解释成没有权限。首批卡片已有内容时立即显示，不等待项目统计；项目查询完成后重新判断正确的空状态。父页面语言同步或重绘不得让空状态穿透加载器。加载文案统一使用 `workspace.loadingCanvases`，支持中英文即时切换。

本次交付运行时启动入口与 Smart Canvas 打开期间的可见加载提示；其余候选场景是后续建议，没有批量改动其状态机。没有新增领域概念、配置项、接口或持久化行为。

### 本地验证（2026-09-26）

- `.venv/bin/python -m unittest tests.test_application_http tests.test_application_runtime tests.test_core_creation_i18n tests.test_documentation_knowledge_map`：53 项通过。新增 HTTP 回归覆盖四种等待状态与两个终止/恢复状态，确认状态文案、原生图片回退及原有操作入口。
- `node static/js/i18n/validate-i18n.js`：3879 键通过；本次复用既有双语状态键。
- `node tests/brand_motion_contract.test.mjs`：6 项通过；`python3 scripts/sync_frontend_assets.py --check` 通过。
- Codex 内置浏览器连接本地临时验收服务，由生产 `create_app` 的 `/startup` 响应提供页面，运行时状态由夹具控制：启动与重启动画、英文/中文即时切换、Light/Dark、页面 Reduced Motion 静态保持及恢复、390px 窄屏、失败/恢复静态展示、阻断组件模块后的原生图片与正文回退均通过。没有重启用户正在运行的服务或操作真实生成任务。
- `node tests/ic_core_browser_smoke.cjs` 的独立 Chrome 启动器在调试端口建立前退出，未完成该命令；通过已连接的内置浏览器直接运行同一 `tests/ic_core_browser_harness.html`，7 组页面合同全部通过，包括品牌精确起始帧、连续运动、隐藏暂停与 Reduced Motion。独立脚本追加的两组焦点交互未以此次运行结果宣称通过。
- 原有跨浏览器引擎与 Windows/Linux 真机人工门槛继续保留；本地验证不代表发布或合并完成。
- 追加画布打开反馈已通过实际 Chrome 渐进打开回归（新增断言修复前失败、修复后通过），覆盖首帧、骨架、空画布、回退、失败关闭以及双语、主题、Reduced Motion；相关 25 项 Python 检查通过。完整结果及独立原型导致的一项全局设计检查失败记录见[渐进式打开规格](2026-08-28-smart-canvas-progressive-opening.md)。
- 追加加载稳定性与空状态回归：`node tests/issue_195_smart_canvas_opening_browser_smoke.cjs` 验证各阶段同一位置和尺寸、静态回退与动画视框对齐；`node tests/canvas_list_loading_browser.cjs` 在修复前复现父页面语言同步令“无可访问项目”穿透加载器，修复后验证初始读取、延迟项目权限、刷新、切换空项目、失败和中英文切换均通过，截图无叠字。`node tests/canvas_list_loading_regression.cjs` 与 `node tests/canvas_list_cloud_failure_regression.cjs` 通过，首批卡片展示和云存储失败语义保持。
- `.venv/bin/python -m unittest tests.test_canvas_list_ui tests.test_canvas_management_i18n tests.test_canvas_list_browse_navigation_contract tests.test_core_creation_i18n tests.test_documentation_knowledge_map`：55 项通过；`node static/js/i18n/validate-i18n.js`：3886 键通过。
