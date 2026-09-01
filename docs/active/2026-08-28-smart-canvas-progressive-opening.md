# Smart Canvas 渐进式打开与节点骨架

- **Status**：Implemented
- **Feature ID**：F05 / F06
- **Owners**：产品 / 交互 / 前端 / 后端 / 测试
- **Last verified**：2026-08-29（补充验证顶层 Image Studio Light DOM 首帧隔离、40ms 快速完整响应下的最短骨架停留、320ms 过渡、无持久化宽高的图片 / Prompt Node、Generation Output 旧画廊迁移、延迟 Viewport Restore，以及强刷时本地待同步 Node 改动恢复后的首帧尺寸与位置连续性）
- **Applies to**：Issue #195
- **Supersedes**：无
- **Superseded by**：无
- **Related ADRs**：[ADR-0002：UI Family Module Ownership](../adr/0002-ui-family-module-ownership.md)
- **Domain terms**：Smart Canvas、Canvas、Node、Canvas Sync、Canvas Interaction、Canvas Mutation

## 1. Problem and outcome

Smart Canvas 当前必须等待页面模块、提示词模板、运行配置与完整 Canvas 文档依次加载后，才首次渲染 Node。网络或本地存储响应变慢时，用户会先看到尚未升级的 Custom Element Light DOM；组件升级后又会经历一段只有背景、没有 Node 轮廓的空白期。现有远景 LOD 占位是已加载 Node 的性能表达，不能代表“Canvas 正在打开”。

打开过程改为显式的渐进状态机：组件未就绪时只显示稳定背景；组件就绪后显示可交互外壳；服务器先发送同一权限校验、同一 Canvas 快照的 Node 轮廓，页面显示只读骨架；完整文档到达后一次性建立权威 `nodes` 和连接，再由真实 Node 替换骨架。媒体资源独立解码并淡入，不阻塞 Node 结构出现。

骨架是瞬时 Presentation，不是 Node，不进入 Canvas Sync、Canvas Mutation、Undo、Realtime、Selection、Minimap、LOD 或持久化。

## 2. Goals and non-goals

### Goals

- 页面模块完成前不暴露未升级的 Custom Element 内容、破图、原始菜单项或无样式文字。
- Canvas 打开不再串行等待提示词模板和运行配置；互不依赖的启动工作并行执行。
- 使用真实 Canvas Node 的稳定标识和几何轮廓显示骨架，不凭空构造业务内容。
- 轮廓与完整文档来自一次授权读取的同一版本，避免两次请求之间发生修订错位。
- 完整文档只提交一次到现有 Canvas Persistence / Canvas Sync 边界；骨架层不污染权威状态。
- 图片预览在解码完成前保持媒体骨架，成功后淡入；预览失败仍按既有规则回退原资源。
- Light、Dark、窄窗口与 Reduced Motion 都有明确行为。
- 打开失败显示可理解、可重试的页面级错误，不暴露半初始化画布。

### Non-goals

- 不改变 Node、Connection、Frame、Group 或 Canvas Mutation 的领域定义。
- 不把骨架保存到 JSON、SQLite、Undo 历史或 Realtime 消息。
- 不把远景 LOD 占位复用为打开骨架，也不改变 LOD 阈值或虚拟化策略。
- 不提前启用需要完整 Node 数据的编辑、选择、连线或生成操作。
- 不改变 Canvas 列表页、Share View 或 Node Review Fixture 的加载协议。
- 不为本需求制作独立 Demo；验收直接在真实 Smart Canvas 页面完成。

## 3. Actors and permissions

渐进式打开沿用 `CANVAS_SYNC.read` 的既有角色、Workspace、Canvas Visibility 与访问授权。轮廓和完整文档属于同一个已授权响应；没有独立的匿名轮廓入口，也不会通过错误差异泄露 Canvas 是否存在。

只读与可编辑用户看到相同的打开阶段。完整文档交给现有权限和交互逻辑后，才决定可执行动作；骨架本身没有编辑能力。

## 4. Interaction and state contract

| Phase | Entry | Visible result | Exit |
| --- | --- | --- | --- |
| `booting` | HTML 开始解析 | 主题正确的稳定背景；应用外壳与未升级组件不可见 | 必需 UI 模块已定义 |
| `awaiting-outline` | UI 模块就绪 | 完整页面外壳与空画布；Node 编辑能力未就绪 | 收到 `canvas_outline` 或空 Canvas 的完整文档 |
| `skeleton` | 收到非空 Node 轮廓 | World 坐标中的只读 Node 骨架；无 Selection、连接和操作入口 | 收到完整文档 |
| `hydrating` | 完整文档已解析 | 建立权威 Canvas 状态并执行现有渲染；骨架短暂覆盖以避免空帧 | 首次真实 Node 渲染完成 |
| `ready` | 首次真实渲染完成 | 骨架淡出并移除；正常 Canvas 交互开放 | 页面离开或致命打开错误 |
| `error` | 必需模块失败、响应非法或打开失败 | 隐藏半初始化外壳，显示错误说明和“重试”动作 | 用户重试或离开 |

状态记录在 `document.documentElement.dataset.canvasOpeningPhase`，仅用于页面表现、诊断和自动化验收。`Node Review Fixture` 保持独立入口，不经过网络打开状态机。

为避免快速响应造成骨架闪烁，只有在收到非空轮廓时进入 `skeleton`；完整文档若已在同一帧到达，客户端至少让轮廓经历一次 Paint，再开始真实 Node 物化。空 Canvas 从 `awaiting-outline` 直接进入 `hydrating`。

非空骨架至少稳定显示 `240ms`，随后用 `320ms` 完整淡出并揭示已物化的真实 Node；媒体 Decode 成功也使用 `320ms` 淡入。Reduced Motion 不执行等待或过渡。

Viewport Restore 与 Opening Stream 并行请求，但骨架首次 Paint 必须等待 Viewport Restore 已应用到 `#world`。因此骨架和真实 Node 从第一帧开始共享同一个平移 / 缩放矩阵；不得先按默认 `scale=1` 绘制、再在 Hydrate 前跳到已保存 Viewport。

若当前 Canvas 存在浏览器本地待同步改动，Canvas Persistence 必须在骨架首次 Paint 前把同一份 Node Create / Update / Unset / Delete 投影到 `canvas_outline`。骨架与 Hydrate 后的真实 Node 都以“服务端快照 + 本地恢复层”为可见输入，不能先显示服务端旧几何，再在强刷恢复本地结果时改变尺寸或位置。

## 5. Data and architecture

### 5.1 Opening stream

新增授权读取表面：

```text
GET /api/canvases/{canvas_id}/open
Content-Type: application/x-ndjson
```

响应按顺序包含：

```json
{"type":"canvas_outline","canvas_id":"…","revision":42,"nodes":[{"id":"…","type":"smart-image","x":120,"y":80,"images":[{"kind":"image","is_still_image":true,"natural_w":1200,"natural_h":400}]}]}
{"type":"canvas_document","canvas":{"id":"…","revision":42,"nodes":[{"id":"…","type":"smart-image","x":120,"y":80,"images":[{"url":"/api/media/…","kind":"image","natural_w":1200,"natural_h":400}]}],"connections":[]}}
```

- `canvas_outline` 是只用于测量的最小投影：保留 `id`、`type`、`x`、`y` 与存在的持久化尺寸；当尺寸未持久化时，补充 Node Geometry 所需的媒体数量、媒体类型、原始宽高、Grid、Scale、Pending / Queued 或 Prompt 状态布尔值。
- 测量投影不得携带媒体 URL、Prompt 正文、Reference Input Instance 内容或其他业务正文；媒体只暴露决定几何的类型、静态媒体判定与数值尺寸。
- 客户端把投影交给现有 Node Geometry Interface，一次性得到骨架 `footprint`；不得再用通用 `280×180` 代替可计算的真实 Node 尺寸。普通 Prompt 正文不进入投影，避免将仅用于 Draft Placement 的文本长度规则误用于最终 DOM。
- 当旧 Generation Output Gallery 会在完整文档 Hydrate 时拆成多个 Image Node 并重新落位，服务端不得为迁移前的聚合 Node 输出误导性骨架；已完成该迁移版本的多媒体 Node 不受此规则影响。单结果 Generation Output 继续输出骨架，并携带 `generationMediaW/H` 等测量字段。
- `canvas_document.canvas` 与既有 `GET /api/canvases/{canvas_id}` 返回相同的完整合同。
- 两个事件从一次 `CANVAS_SYNC.read` 结果生成，`canvas_id` 与 `revision` 必须一致。
- 先序列化并发送小型轮廓，再序列化完整文档，确保大 payload 不阻塞首个有意义视觉反馈。
- 不支持流式响应或返回非成功状态时，客户端回退既有完整 Canvas GET；回退不产生虚构骨架。
- 未知事件可忽略；顺序错误、缺少完整文档或身份不一致视为打开失败。

### 5.2 Module ownership

- `backend/infinite_canvas/canvas_opening.py`：拥有轮廓投影、事件序列化与流顺序；不拥有权限决策或 Canvas 存储。
- `backend/main.py`：只组合路由、当前用户与 `CANVAS_SYNC.read`，返回 Streaming Response。
- `static/js/smart-canvas/canvas-opening.js`：拥有打开状态机、NDJSON 增量读取、骨架 Presentation、回退和重试表面。
- `static/js/smart-canvas/canvas-persistence.js`：继续拥有完整 Canvas 文档进入现有客户端状态的边界；通过 Opening 模块取得完整文档，并向 Opening 提供只含数据变换的本地待同步改动投影，不接触骨架 DOM。
- `static/js/smart-canvas.js`：编排启动并行任务，在首次真实渲染完成后通知 Opening 模块进入 `ready`。
- `static/js/infinite-canvas-ui/feedback-progress.js`：继续提供公共 `ic-skeleton` 原语；不增加 Smart Canvas 业务状态。

Opening 模块对页面暴露小型 Interface：`open({canvasId, outlineReady, outlineTransform})` 返回完整 Canvas 文档；可选的 `outlineReady` 约束首次 Paint，可选的 `outlineTransform` 在绘制前叠加由 Canvas Persistence 提供的本地恢复投影；`ready()` 完成骨架到真实 Node 的过渡，`fail(error)` 显示可重试错误。调用方不传入 Node Store、Mutation、Undo 或 Realtime 对象。

### 5.3 Startup ordering

UI 模块就绪后同时启动：

- Canvas Opening Stream；
- Prompt Templates；
- Runtime / Provider Config；
- 既有设备级 Viewport 恢复。

Viewport Restore 和 Opening 网络读取保持并行；只有轮廓首次 Paint 依赖 Viewport Restore 完成。首次 Node 渲染依赖完整 Canvas 文档、Viewport Restore 和必需 UI 模块。模板或运行配置失败不得使已授权 Canvas 变成空白；相关功能沿用自身降级与错误反馈，并在其完成后执行一次既有配置同步。

## 6. Presentation, media and accessibility

- 骨架层位于 `#world` 内，继承现有平移和缩放；它有独立 class，不使用 `.image-node`，因此不会进入虚拟化、选择和事件绑定查询。
- 为限制超大 Canvas 的瞬时 DOM 成本，Opening Stream 仍携带全部小型几何投影，但页面按稳定文档顺序最多物化 240 个骨架；完整文档继续交给既有虚拟化显示全部 Node。
- 骨架沿用 Node 外框、Header 与内容区的大致比例，以 `ic-skeleton` 和语义 Token 表达；不显示虚假标题、图片、连接、按钮或数量。
- 骨架层使用 `pointer-events: none`、`aria-hidden="true"`；打开阶段通过既有或页面级 `role="status"` 提供一次简短状态，不逐个朗读骨架。
- Light/Dark 使用相同层级与尺寸，只切换语义 Surface、Border、Skeleton Base/Highlight。
- 窄窗口保持 Canvas 坐标和 Viewport 行为，不把骨架重排成列表。
- `prefers-reduced-motion: reduce` 下关闭 Shimmer、媒体淡入和骨架淡出；状态仍按相同顺序切换。
- 由 `smartPreviewImgHtml` 生成的图片以 `data-media-state="loading"` 开始；Decode 成功后切到 `ready`，预览失败转原资源后继续等待，最终失败切到 `error`。

## 7. Failure and recovery

- 必需 UI 模块未定义：移除 Boot Guard，但只显示页面级错误，不显示原始 Custom Element Light DOM。
- `401 / 403 / 404`：保留既有身份与权限语义，错误表面提供返回列表；不会显示轮廓。
- 流读取中断、事件非法或 Canvas 身份 / Revision 不一致：丢弃瞬时骨架，不提交部分文档，显示重试。
- 重试重新执行完整 Opening；旧 Reader、旧骨架和旧状态必须先清理。
- 媒体失败不使 Canvas Opening 失败；Node 保持可用并沿用既有媒体失败表达。

## 8. Acceptance and verification

1. 将公共 UI Core 延迟至少 1.5 秒时，页面只显示稳定背景；`referenceGenerateMenu`、`upstreamInputMenu` 和 `smartTitle` 的原始 Light DOM 不可见。
2. UI Core 就绪后，页面进入 `awaiting-outline`；Canvas Opening 请求不等待 Prompt Templates 或 Runtime Config 完成。
3. 服务端延迟完整文档时，先可见与真实 Node 几何对应的骨架；包括没有持久化 `w/h`、但可由媒体比例或 Node 默认布局计算尺寸的 Node，骨架与首次真实 Node 的宽高误差不超过 `1px`。非默认 Viewport 延迟返回时，骨架首次 Paint 的 World transform、屏幕位置和屏幕尺寸也与真实 Node 一致。此时 `nodes` 未提交，DOM 中不存在真实 `.image-node`。
4. 完整文档到达后，`revision` 和 `canvas_id` 通过一致性检查，现有 Canvas Persistence 只接收一次完整文档。
5. 首次真实 Node 渲染完成后骨架淡出并从 DOM 删除，状态为 `ready`；Selection、Undo、Realtime 与持久化记录中没有骨架。
6. 空 Canvas 不显示伪 Node 骨架，并从 `awaiting-outline` 正常进入 `ready`。
7. 预览图片延迟时 Node 结构先出现、媒体区域保持骨架；Decode 成功后图片淡入，预览失败仍可回退原资源。
8. 流式表面不可用时回退既有完整 GET，Canvas 仍能打开；流中断或事件不一致时不显示半份 Canvas，并提供重试。
9. Light、Dark 与 Reduced Motion 的计算样式符合语义 Token 和动效规则；窄窗口没有页面级横向溢出。
10. 真实浏览器无未捕获异常、原始组件闪现、重复 Node、重复连接或错误 Canvas Mutation。
11. 会在 Hydrate 时拆分的旧 Generation Output Gallery 不显示聚合骨架；拆分后的 Image Node 正常出现。单结果 Generation Output 的骨架与真实位置 / 尺寸误差不超过 `1px`。
12. 强刷时若本地待同步记录把服务端旧的横向 Generation Output 更新为竖向单结果，骨架在首次 Paint 前应用该记录；其位置与宽高相对恢复后的真实 Node 误差不超过 `1px`，不得先显示服务端旧尺寸。

## 9. Verification plan

- Python 单元测试：轮廓测量字段白名单、媒体 URL / Prompt 正文隔离、旧 Generation Output Gallery 过滤与迁移版本豁免、非法坐标规范化、同快照事件顺序与 NDJSON 序列化。
- HTTP 定向测试：授权、媒体类型、首事件与完整事件身份 / Revision 一致，既有 GET 合同不变。
- 静态合同：Boot Guard、模块顺序、Opening Interface、骨架隔离和 Reduced Motion。
- 真实无头 Chrome：延迟 UI Core、延迟 Opening 完整事件、并行启动、空 Canvas、流式回退、媒体 Decode、Light/Dark/Reduced Motion。
- 回归：Canvas 打开、保存、Realtime、Undo、Node Review Fixture 与现有 Smart Canvas 浏览器 Smoke。

实际验证：

- `PYTHONPATH=backend ... .venv/bin/python -m unittest tests.test_canvas_opening tests.test_workspace_artifacts tests.test_canvas_sync_contract.CanvasSyncContractTests.test_progressive_opening_stream_keeps_one_canvas_identity_and_revision`：11 项通过，覆盖测量投影白名单、旧 Generation Output Gallery 过滤 / 迁移版本豁免、非法几何、事件顺序、更新清单和 HTTP 身份 / Revision 一致性。
- 加入 Generation Output Migration、Viewport Selection、Node Geometry 与 Project Layout 的扩展定向回归共 43 项通过。
- `node tests/issue_195_smart_canvas_opening_browser_smoke.cjs`：macOS 真实无头 Chrome 通过 Core 延迟 Boot Guard（包括 `#shell` 外的 Image Studio `crop source` Light DOM）、启动并行、40ms 快速完整响应的最短骨架停留、320ms 完整过渡、无持久化 `w/h` 的 `1200:400` 图片与普通 Prompt、单结果 Generation Output 骨架 / 真实 Node 位置及宽高误差不超过 `1px`；650ms 延迟 Viewport Restore 时骨架首次 Paint 已使用最终 `translate + scale`；服务端 `232×149` 横向旧结果叠加本地待同步的 `768×1280` 竖向结果后，骨架与恢复后的真实 Node 位置 / 尺寸误差不超过 `1px`；旧双结果 Generation Output Gallery 不显示聚合骨架并在 Hydrate 后拆成两个 Image Node；媒体 Decode、Light / Dark、Reduced Motion、旧完整 GET 回退和 403 错误焦点通过。
- `node tests/smart_canvas_node_components_browser_smoke.cjs`：公共 Canvas Node 的十种角色、Light / Dark 与 Node Review Fixture 回归通过，无页面异常。
- JS 语法、`git diff --check`、PROJECT-MAP 链接 / Feature Registry 与 Project Layout 定向检查通过。

Remaining gates：Windows / Linux 浏览器中的首次 Paint、流式代理缓冲与 Pointer / Keyboard 人工确认；Windows 由 Issue #214 跟踪。功能保持 Active `Implemented`，不在这些跨平台门槛完成前晋升 Current。
