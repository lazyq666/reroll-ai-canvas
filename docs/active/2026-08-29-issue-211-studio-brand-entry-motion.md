# 工作台品牌入场动画

- **Status**：Implemented / Review
- **Feature ID**：F01 / F13
- **Owners**：产品 / 品牌 / 前端 / 测试
- **Last verified**：2026-09-02
- **Applies to**：Issue #211
- **Supersedes**：无
- **Superseded by**：无
- **Related ADRs**：无
- **Domain terms**：App Shell、Studio Sidebar

## 1. Problem and outcome

首次进入 Reroll 工作台时，应用从身份确认直接切换为完整界面，品牌的流体节点语言没有延续到产品体验。工作台现在只在当前浏览器站点存储中尚未记录完成状态时播放一次品牌入场：透明流体 Logo 完成聚合与分裂后，`word.svg` 通过节点扫描显现；整个锁定组合收束到真实的 `.sidebar-logo-image.sidebar-logo-wordmark`，再揭示已完成初始化的工作台。

登录成功使用整页跳转进入 `/`，因此与首次直接打开工作台共享同一实现；成功播放后，同源的新标签页、后续登录和浏览器重新启动都不再播放，除非用户清除该站点的数据。浏览器刷新无条件跳过动画，即使用户在首次动画尚未结束时刷新也不会重播。

## 2. Goals and non-goals

### Goals

- 保留方案 C 的流体 Logo、节点扫描文字和画布网格显现节奏。
- 文字必须来自 `static/images/brand/word.svg`，终态比例与 `wordmark.svg` 一致。
- 桌面端不硬编码最终截图坐标，而是在侧栏展开后测量真实 wordmark 盒子作为终点。
- 工作台身份、路由和 iframe 初始化与动画并行；动画只覆盖呈现，不拥有启动状态。
- 媒体失败、自动播放失败和 Reduced Motion 都不会阻塞工作台。
- Light / Dark 与窄窗口有明确行为。

### Non-goals

- 不改变 Logo SVG 路径或品牌字形。
- 不改变登录、权限和工作台路由协议。
- 不在移动侧栏中新增原本不存在的 Logo 区。
- 不把动画进度写入账户或 Workspace 持久化。

## 3. Interaction and state contract

| Phase | Visible result | Exit |
| --- | --- | --- |
| `mark` | 透明 WebM 在视口中央播放，应用在遮罩下并行初始化 | 视频自然结束、失败或超时 |
| `wordmark` | 侧栏展开；Logo 移到真实 wordmark 起点并以 2.986 倍终态尺寸显现 `word.svg` | 文字扫描和状态文案完成 |
| `docked` | 分离的 Logo 与文字按 `wordmark.svg` 的内部比例缩小，边界与真实侧栏 wordmark 重合 | 收束完成且路由已就绪 |
| `finished` | 遮罩淡出并移除，真实 App Shell 接管 | 完成 |
| `reduced` | 居中短暂显示静态 `wordmark.svg`，不播放移动、扫描或缩放 | 路由就绪后移除 |

桌面端的动画会在 `wordmark` 阶段发出 `studio-entry-motion-dock`。App Shell 只在当前标签页本次入场中临时展开侧栏，不改写既有 `studio_sidebar_pinned` 偏好；用户后续手动切换仍按既有规则保存。宽度不超过 `720px` 时侧栏 Logo 区本来不可见，因此锁定组合在中央完成并淡出。

完成标记写入同源浏览器持久存储 `localStorage.studio_brand_entry_seen`。值为字符串 `"1"` 时，同源的新标签页、后续登录和浏览器重新启动都跳过动画；清除该站点的数据后会恢复首次播放。读取或写入存储失败时不阻塞工作台，当前首次进入仍可播放，但无法保证后续永久跳过。`<head>` 阶段同时检查持久完成标记和 Navigation Timing 的 `reload` 类型，并在动画 DOM 解析前添加 `studio-entry-motion-skip`；即使延迟动画脚本尚未执行，已完成用户与刷新导航也不会绘制动画首帧。运行时再执行同一判断并移除动画层。

## 4. Presentation and accessibility

- 动画层 `aria-hidden="true"`、`pointer-events: none`，不改变焦点顺序，也不拦截工作台控件。
- WebM 的有效 Alpha 内容只占视频画布约 `662 / 960`，内部使用 `1.436` 校正，使可见 Logo 而非透明视频盒与 SVG 几何匹配。
- 最终分离几何以侧栏 `112px` wordmark 的实测分解为基准：Logo `30.07px`、间距 `8.14px`、文字 `73.68 × 22.69px`，并按真实目标宽度等比计算。
- Dark Mode 对视频、Logo 和文字资产做同一反相处理；背景与文案使用语义 Token。
- 状态文案通过公共 i18n 资源显示：中文为“正在准备你的创作空间…”，英文为“Preparing your creative space…”，不得在生产 HTML 中维护单语言文本。
- Reduced Motion 不加载动作序列，只短暂显示静态组合标。

## 5. Failure and recovery

- WebM、`source` 或 `video.play()` 失败时，立即使用 `logo.svg` 背景和 `word.svg` 快速收束。
- 正常播放时 Mark Frame 不设置静态背景，Video 也不设置 Poster，避免透明 WebM 下方的静态 Logo 在移动与遮罩淡出阶段形成中心残影；`logo.svg` 只在明确的媒体失败状态启用。
- WebM 正常结束后先取消媒体 watchdog、解除错误监听并从 DOM 删除 Video 合成层；等待两次 Paint 后才用普通 `logo.svg` 接管 Mark 并开始左上角移动。终态移动和遮罩淡出阶段不再包含透明 VP9 视频纹理，避免浏览器保留中央末帧。
- `finished` 淡出阶段完整继承 `docked` 的 Lockup 位置、Mark / Word 尺寸和网格几何，只改变最外层遮罩 opacity。不得因退出 Docked 选择器而恢复初始居中 transform 或大尺寸 Mark，避免 Logo 从 Sidebar 反向移动到中央并渐隐。
- 视频在 `6500ms` 内未结束时触发同一快速回退。
- 动画完成早于身份 / 路由初始化时保持终态，直到 `studio-route-booting` 移除；动画不会自行伪造路由就绪。
- 动画自身无论成功或失败都不修改认证结果、不加载 iframe，也不阻断登录重定向。

## 6. Acceptance and verification

1. 当前浏览器尚无完成标记时，首次已登录进入工作台能看到透明流体 Logo、扫描文字、收束和 App Shell 淡入；完成后刷新、新标签页、后续登录与浏览器重新启动都不显示动画首帧，清除站点数据后恢复首次播放；动画中途刷新也不显示动画。
2. 文字网络资源是 `/static/images/brand/word.svg`，终态与可见 `.sidebar-logo-image.sidebar-logo-wordmark` 的外框误差不超过 `1px`。
3. 登录成功跳转 `/` 后复用同一入口，无第二套动画实现。
4. Light / Dark 保持品牌对比度；窄屏居中完成且无横向溢出。
5. Reduced Motion 不播放视频运动；媒体请求失败或自动播放拒绝后工作台仍可进入。
6. 动画层不接收指针或焦点，真实工作台只在既有身份初始化完成后可见。
7. 中文与英文偏好下的状态文案分别显示对应语言，且英文在现有桌面锁定组合宽度内不截断。

## 7. Verification plan

- Python 静态合同：生产 HTML 资源、状态机、失败超时、Reduced Motion、真实目标选择器和 App Shell 协作事件。
- Playwright 浏览器矩阵入口（Chromium / Firefox / WebKit）：首次播放、持久完成标记、同源新标签页、浏览器存储恢复、同标签刷新、WebM 失败、Reduced Motion、Light / Dark。
- 回归：T30 App Shell 静态合同和桌面 / 窄屏浏览器 Smoke。

实际验证：

- `node static/js/i18n/validate-i18n.js`：中英文资源结构、变量占位符和生产页面引用校验通过，共 `3028` 个 key。
- `PYTHONPATH=backend /tmp/ic-i18n-venv/bin/python -m unittest tests.test_issue_211_studio_brand_entry_motion tests.test_studio_shell_ui tests.test_setup_page_contract tests.test_account_setup_ui tests.test_workspace_service tests.test_auth_http tests.test_application_http`：首批 i18n、首次设置和应用壳回归共 `122` 项通过。
- `node tests/setup_browser_smoke.cjs`：真实无头 Chrome 通过中英文首次设置、Light / Dark、窄屏和可访问性检查；英文模式下后端中文诊断不会泄漏到 UI。
- `.venv/bin/python -m unittest tests.test_issue_211_studio_brand_entry_motion tests.test_studio_shell_ui tests.test_documentation_knowledge_map`：启动动画、工作台 Shell 和文档知识图谱共 `45` 项通过。
- `PYTHONPATH=backend .venv/bin/python -m unittest tests.test_main_account_integration`：13 项通过；现有 FastAPI lifespan 弃用提示与未选择 Workspace 的 legacy receipt 恢复日志不影响结果。
- `ISSUE_211_BROWSER=chromium|firefox|webkit node tests/issue_211_studio_brand_entry_motion_browser_smoke.cjs`：Chromium、Firefox 与 WebKit 三套真实无头浏览器引擎通过正常播放、`localStorage` 完成标记、同源新标签页、浏览器存储恢复、播放完成后刷新、动画中途刷新、媒体失败和 Dark Reduced Motion；英文状态文案为 `Preparing your creative space…` 且没有宽度溢出。三套引擎的终态位置误差为 `0px`，宽高误差均小于 `0.25px`。
- `ISSUE_211_BROWSER=chromium|firefox|webkit node tests/issue_211_studio_brand_entry_early_skip_browser_smoke.cjs`：阻断延迟动画脚本后，Chromium、Firefox 与 WebKit 都在 `<head>` 阶段读取持久完成标记并应用 `studio-entry-motion-skip`；动画 DOM 保留但首屏计算样式为 `display: none`，不会闪现第一帧。
- `node tests/issue_211_studio_brand_entry_layer_browser_smoke.cjs`：真实 Dark 播放阶段确认 Mark Frame 的 `background-image: none`、Video Poster 为空、Video 为唯一可见 Logo 层；进入 `wordmark` 时 Video 已从 DOM 删除并由 SVG 接管。`finished` 淡出至 `320ms` 时 Lockup 仍位于目标 `x=59.5 / y=38.859`，Mark 仍为 `30.063px`，没有反向移动或放大；工作台揭示后的 Dark 截图没有中央残留，顶层 Video 数量为 `0`。
- `node tests/t30_studio_shell_browser_smoke.cjs` 与 `node tests/studio_shell_fresh_device_browser_smoke.cjs`：桌面 Light / Dark、窄屏与新设备工作台回归通过。
- `node --check`、`git diff --check` 与人工截图检查通过。

Remaining gates：Windows / Linux 对透明 VP9 Alpha 解码和真实设备 Reduced Motion 的发布前人工确认；Windows 由 Issue #213 跟踪。功能保持 Active `Implemented / Review`，不在这些门槛完成前晋升 Current。
