# 工作台品牌入场动画

- **Status**：Implemented / Review
- **Feature ID**：F01 / F13
- **Owners**：产品 / 品牌 / 前端 / 测试
- **Last verified**：2026-09-25
- **Applies to**：Issue #211
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
