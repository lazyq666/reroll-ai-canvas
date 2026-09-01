# Canvas 分享只读内容完整性

- **Status**：Current
- **Issue**：#92
- **Owners**：产品 / 前端 / 后端 / 测试
- **Date**：2026-08-27
- **Applies to**：Anonymous Share Visitor 通过 Share Link 浏览 Canvas
- **Domain terms**：Canvas、Smart Canvas、Node、Connection、Prompt Node、Prompt Generation Node、Prompt Authoring、Anonymous Share Visitor、Share Link

## 1. 问题与目标

分享页当前维护了一套简化渲染实现，并在后端和前端同时隐藏 Prompt 创作内容：分享响应删除 Prompt 字段、Prompt Node 及其 Connection，浏览器再次跳过 Prompt Node。媒体名称还会过滤通用名称与哈希名称。结果是 Anonymous Share Visitor 看到的不是 Canvas 的只读内容，而是经过缩略和删减的另一份视图。

本次让 Share Link 发布 Canvas 中持久保存的非秘密创作内容。Anonymous Share Visitor 可以使用平移、缩放、Minimap、媒体播放、节点选择、Composer 文字选择和复制等浏览型交互，但不能提交 Canvas Mutation、Generation Run、内容管理动作或其他写入。

## 2. Goals / Non-goals

### Goals

- 分享响应保留 Prompt、Prompt 草稿、Prompt Node、Prompt Generation Node 及其 Connection。
- Prompt Node 在分享 Canvas 中按原位置和尺寸显示，Prompt 内容使用公共只读 Composer 呈现。
- 分享 Canvas 的全部 Node 类型统一使用公共 Canvas Node family；Smart Group、Splitter、Loop、Generation、Frame、文本、画笔和媒体不维护分享专用外壳。
- 直接复用 Designer Composer 的 `.composer > .composer-card > .prompt-row` 输入表面；默认隐藏，选择包含 Prompt Authoring 快照的 Node 时只显示只读文本区，不渲染底部创作按钮和图标。
- Image Node 直接复用 `SmartCanvasModules.nodeGeometry` 的图片布局结果与 Designer 的 `.image-wrap`、`.node-img`、`.thumb-grid` DOM，分享页不维护另一套尺寸兜底或媒体外壳。
- 媒体名称按保存的原始名称、分享媒体 URL 的 `name` 参数、URL basename 顺序展示，不再隐藏通用名称或哈希名称。
- 分享页继续匿名读取，只代理当前 Canvas 实际引用的本地媒体，并递归删除 Secret、API Key、Token、Password、Cookie 与 Session 等敏感字段。
- 分享页不加载 Designer 的完整编辑运行时；复用公共 Canvas Node、Prompt Composer、Node Geometry、现有媒体 DOM 与只读 Canvas 导航能力。
- 分享页默认启用 Designer 已有的 Canvas Level of Detail、Canvas Virtualization 与 Smart Image Resolution；远景 Node body 由 Designer / Share 共用的 `canvasFarPresentation` 输出，不在分享运行时复制另一套性能实现。

### Non-goals

- 不让 Anonymous Share Visitor 获得 Designer Role、Project Access Grant 或登录会话。
- 不开放 Prompt Library、Workspace Asset Library、Provider 配置、API Key、Generation History 管理或其他 Workspace 内容。
- 不允许创建、移动、缩放、删除或连接 Node，不允许上传、生成、改名、下载授权变更或 Canvas 持久化。
- 不把完整 `smart-canvas.js` 作为分享页运行时，也不依赖 CSS `pointer-events` 作为唯一写权限保护。
- 不改变 Share Link 创建、重新生成、撤销、Private Canvas 失效或媒体授权边界。
- 不把 Designer 的写入事件、Provider 参数解析和运行时状态机加载到分享页；只复用公共 Node 组件、现有节点表面与 Composer 结构。

## 3. 角色与权限合同

| Actor | 可以 | 不可以 |
| --- | --- | --- |
| Designer | 按既有 Project 与 Canvas 权限查看、编辑和执行 Generation Run | 越过 Project Access Grant 或 Private Canvas 权限 |
| Anonymous Share Visitor | 通过有效 Share Link 查看一个 Shared Canvas 的非秘密持久创作内容；使用浏览型交互 | 获得账号权限；读取其他 Canvas 或 Workspace 内容；提交任何写入 |

“只读”限制创作结果，不禁止所有 Pointer 与 Keyboard。允许查看 Composer、选择和复制文字、播放媒体、平移、缩放及使用 Minimap；会产生 Canvas Edit、Generation Run 或内容管理结果的控件必须省略、原生禁用或由权限门禁拒绝。

## 4. 分享数据合同

`GET /api/shares/{token}` 继续返回：

```json
{
  "canvas": {},
  "permissions": {
    "read": true,
    "write": false,
    "download": false
  }
}
```

规则：

1. Canvas 顶层只发布现有 `SHARE_CANVAS_FIELDS` 白名单字段。
2. 白名单内的 Node、Connection、Prompt 与 Prompt Authoring 快照保持原结构，不建立分享专用内容副本。
3. 任意层级的敏感键继续删除；以 `_api_key` 结尾的键继续删除。
4. 本地媒体 URL 继续改写为 token-scoped 媒体代理；没有被分享 Canvas 引用的媒体返回 404。
5. token-scoped 媒体代理可接受 `w` 预览参数，但只映射到既有的 512 / 1024 / 2048 三档预览缓存；鉴权和“仅当前 Canvas 引用媒体”的边界先于预览图生成执行。
6. 响应保持 `Cache-Control: no-store`；分享页 Fetch 使用 `credentials: omit`。
7. 无效、撤销、Private 或已删除 Canvas 的 Share Link 继续返回 404。

## 5. 页面与交互

### Canvas 内容

- 所有持久 Node 都由公共 `ic-canvas-node` family 输出；分享页只负责把保存数据规范化为只读 body 数据、布局和状态，不再维护 `<article>` 或 `.share-structure-card` 等平行 Node 外壳。
- Smart Group 无论为空或包含媒体，都保持 `kind="smart-group"`，并复用 `.smart-group-card`、摘要与缩略图表面；不得降级为普通媒体节点。
- Splitter、Loop、Generation、空媒体、Frame、文本和画笔复用 Designer 已有节点 class 与公共 `ic-*` 控件。显示出来的控件必须带 `disabled` / `aria-disabled`，严格 CSP 下不得泄露原生文件选择器文案。
- Prompt Node 和 Prompt Generation Node 不再跳过；与它们连接的 Connection 保持可见。
- Prompt Node 外壳与正文都复用公共 Canvas Node family：沿用 Designer 的无标题 Prompt Node 表面、正文留白和 `ic-prompt-composer contenteditable="false"`，分享页不维护 Prompt 专用标题或卡片样式。
- Prompt 正文不显示运行、模型选择、上传、删除、Resize 或 Quick Add 控件；选择 Node 后可在只读 Composer 中选择和复制完整内容。
- 分享页使用公共 Canvas Node 的 `selected` 状态显示选择边界，不叠加分享专用 Outline；Image Node 的选择边界与实际媒体表面保持一致。
- 点击 Canvas 空白区域会清除本地 Node 选择并关闭 Composer；同一次 Pointer 操作仍可继续进入既有 Canvas 平移。
- Image Node 必须使用 Designer 现有的直接子级媒体 DOM；不得额外包裹 `ic-media-container` 而绕过 `.node-img` / `.thumb-media-frame` 的尺寸约束，也不得显示 `Media unavailable` 等内部占位文案。

### 禁用态 Composer

- 分享页直接使用 Designer Composer 的 `composer`、`composer-card` 与 `prompt-row` 结构，不增加“只读 Composer”、节点标题、关闭栏或分享专用样式。
- Composer 默认隐藏；选择具有 `promptDraftText`、`displayPrompt`、`runPrompt`、`prompt`、Prompt Node 文本或 LLM 指令的 Node 时更新并显示 `#promptInput`，选择无文本 Node 时隐藏。
- `#promptInput` 固定为 `contenteditable="false"`；Focus、生成类型、参数、模板和运行区不渲染。Composer 只显示冻结的创作文本，不解析 Provider Secret，不发起生成请求。
- 选择 Node 只是本地浏览状态，不写入 Canvas、Canvas Viewport、Account 或 Device State。

### 媒体名称

- 优先显示媒体对象保存的 `name`、`filename`、`fileName`、`originalName` 或 `original_name`。
- 其次显示 Node 保存的同类名称，最后读取分享媒体 URL 的 `name` 参数或 URL basename。
- 只对空字符串回退；不因名称通用或类似哈希而隐藏。

### 读取性能

- Level of Detail 默认开启并沿用现有阈值：缩放小于 `0.23` 进入远景模式，大于 `0.28` 回到细节模式，中间区间保持当前状态，避免缩放时反复闪烁。
- 远景模式使用公共 `canvasFarPresentation`：Prompt / Group 使用轻量骨架，图片和视频封面只请求 512 档预览，不创建完整视频或音频控件。
- 细节模式通过现有 `SmartImageResolution`，根据屏幕显示尺寸、缩放比例和像素密度在 512 / 1024 / 2048 三档中选择图片；预览失败时才回退原文件。
- `CanvasVirtualization` 默认只挂载当前 Canvas Viewport 加一屏缓冲区内的 Node，并保留当前选择 Node；Connection 使用同一可见范围判断。权威 Canvas 数据仍完整保留在内存中，平移和缩放只改变浏览器实际绘制的集合，不改变或写回 Canvas。

## 6. Failure / Recovery

- 分享响应失败时继续在 Canvas 内显示现有错误状态，不留下 Loading。
- Prompt 内容为空时仍显示 Prompt Node；Composer 可以为空，但不得出现可编辑 Placeholder 行为。
- 公共 Canvas Node 或 Prompt Composer 未注册时，页面进入可见失败状态，不静默丢弃 Prompt Node。
- 浏览器刷新重新从分享 API 读取权威 Canvas；本地选择和 Composer 展开状态不恢复。

## 7. Acceptance

1. 分享 API 返回 Prompt Node、Prompt 字段及涉及 Prompt Node 的 Connection，同时继续删除敏感字段。
2. 分享 Canvas 的所有 Node 都由公共 `ic-canvas-node` family 输出；Smart Group 含媒体时仍为 Smart Group，其他结构节点也使用 Designer 现有 body 表面，不出现分享专用结构卡片。
3. Prompt 正文使用公共 `ic-prompt-composer` 且 `contenteditable="false"`，可选择、可复制、不可编辑。
4. 分享页复用原 Composer 输入结构，默认隐藏，不显示“只读 Composer”、关闭栏、底部按钮或图标；选择具有 Prompt Authoring 内容的 Node 才显示并更新只读文本。
5. Node 不能移动、缩放、删除、上传、生成或改变 Connection；分享页面不会发出 POST、PUT、PATCH 或 DELETE。
6. 原始文件名完整显示；通用名称和 32 位哈希名称不再被特殊隐藏。
7. 分享请求不携带 Cookie；未引用媒体、失效链接与 Private Canvas 保持拒绝。
8. 单图和多图使用与 Designer 相同的 Node Geometry 与媒体 DOM，自动尺寸和纵横比一致；不显示 `Media unavailable`、`Choose File` 或 `No file chosen` fallback；Light / Dark、宽屏 / 窄屏、平移、缩放、Minimap、Connection 与错误状态回归通过。
9. Image Node 选中时只使用公共 Node 选择边界且贴合媒体尺寸；点击 Canvas 空白区域后选中态与 Composer 同时关闭。
10. 大型分享 Canvas 首屏自动进入远景模式并请求 512 档媒体；放大后自动恢复细节模式与自适应图片档位，视口外 Node / Connection 不挂载，且全程不产生写请求。
11. 已有产出图片的 Generation Node 在远景 / 细节切换前后保持 Node Geometry 计算出的原始宽高比；放大后不得回退到通用媒体默认尺寸或通过 `object-fit: cover` 裁掉内容。

## 8. Verification plan

| 层级 | 入口 | 覆盖 |
| --- | --- | --- |
| 后端集成 | `tests/test_main_account_integration.py` | Prompt 内容、Connection、Secret 过滤、媒体代理、匿名只读、撤销 |
| 同步合同 | `tests/test_canvas_sync_contract.py` | 分享读取不推进 Revision 或产生 Mutation |
| 静态页面合同 | `tests/test_canvas_share_ui.py`、`tests/test_smart_canvas_level_of_detail.py` | 公共 Node / Composer / 远景 body 复用、文件名、只读 Fetch、无写请求 |
| 真实浏览器 | `tests/share_page_browser_smoke.cjs` | Prompt Node、只读 Composer、Pointer / Keyboard、166 Node 远景、视口裁剪、图片档位、Generation 产出图宽高比、无写入、主题、响应式、导航与错误 |
| 文档 | `tests/test_documentation_knowledge_map.py` | Active Spec 链接与知识地图一致性 |

## 9. Documentation and completion

- 本文件是 Issue #92 开发期间的行为权威。
- `CONTEXT.md` 已经定义 Anonymous Share Visitor 与 Share Link 的只读语义，本次不新增领域概念。
- 本次不改变持久架构或安全边界，不新增 ADR。
- 未改变 Current Docs 已记录的产品事实；本次无需修改 `CONTEXT.md`、Current Docs、ADR 或 Project Map。

## 10. Verification result

- `python3 -m unittest tests.test_canvas_share_ui tests.test_smart_canvas_level_of_detail tests.test_smart_canvas_virtualization tests.test_smart_canvas_node_components`：28 项通过；覆盖分享页静态合同、公共远景 body、Level of Detail、Virtualization 与公共 Node family。
- `python3 -m unittest tests.test_smart_canvas_canvas_interaction tests.test_smart_canvas_canvas_mutation tests.test_smart_canvas_generation_batch tests.test_t37_generation_output_legacy_migration`：23 项相关 Smart Canvas 回归通过。
- `./.venv/bin/python -m unittest -v tests.test_main_account_integration.MainAccountIntegrationTests.test_share_link_exposes_read_only_canvas_and_only_referenced_media tests.test_canvas_sync_contract.CanvasSyncContractTests.test_public_share_uses_validated_sqlite_grant_without_legacy_file`：2 项通过。
- `node tests/share_page_browser_smoke.cjs`：真实 Chromium 验收全部通过；覆盖 10 类公共 Node、166 Node 远景 / 细节切换、图片预览档位、视口裁剪、原 Composer 禁用态、生产 CSP、无写请求、媒体边界、导航、Connection、Light / Dark、窄屏与失败状态。
- `NODE_PATH=… node tests/issue_176_far_prompt_wheel_browser_smoke.cjs`：Designer 真实 Chrome 回归通过；公共远景 Prompt body 与远景 Canvas Wheel 行为保持不变。
- `python3 -m py_compile`、三个相关 JavaScript 文件的 `node --check` 与 `git diff --check`：通过。
- `./.venv/bin/python -m unittest -v tests.test_documentation_knowledge_map`：2026-08-29 文档清理后 7 项全部通过。
- 扩展 Persistence suite 中另有 1 项既有失败：公开 API 期望列表未包含现有 `startTransientSession`；本次未改动 Persistence 接口或其实现，不扩大 Issue #92 范围处理。
- 2026-08-27 完成 Light Desktop 与 Dark Narrow 截图检查，未发现内容溢出、Composer 遮挡或主题可读性问题。
- 2026-08-28 使用既有大型 Shared Canvas 复验：运行中的旧后端曾继续裁剪 Prompt；重启加载实现后返回 28 个 Prompt Node。随后发现公共 Node 字符串中的内联尺寸被生产 CSP 拒绝，长 Prompt 被压成竖线；改为通过 CSSOM 复用同一公共 Node 后，166 个 Node、28 个 Prompt Node 与 118 条 Connection 正常显示，所有 Prompt 布局有效，Pointer 可打开 `contenteditable=false` Composer。
- 2026-08-28 UI 漂移回归：移除分享页自造的 Prompt title / `.share-prompt-card`，改由公共 Node family 输出只读 Prompt 正文并直接复用 Designer 节点样式；真实 Canvas 的 28 个 Prompt Node 均为无标题表面，实测卡片 / 文本区 padding 为 12px / 8px。`ic-media-container` 用原生 `hidden` 承载 ready fallback 状态，在生产 CSP 下不再显示 `Media unavailable`。Chromium 回归全部通过，且真实 Canvas 的 166 个 Node、118 条 Connection 保持不变。
- 2026-08-28 全节点复用回归：分享页移除并行 `<article>` / `.share-structure-card` Node 外壳，Frame、媒体、文本、画笔、Prompt、Splitter、Loop、Smart Group 与 Generation 共 10 类角色全部由公共 `ic-canvas-node` family 输出；含媒体 Smart Group 保持编组表面。分享页移除定制“只读 Composer”标题栏，改用原 Composer 结构并禁用全部动作控件。严格 CSP 下的空上传位改用现有非交互节点空态，避免泄露 `Choose File` / `No file chosen`。14 节点 Chromium 矩阵、无写请求、Light / Dark 与窄屏验收通过。
- 2026-08-28 图片与 Composer 同源回归：删除分享页 `480×420` 图片尺寸兜底与 `ic-media-container` 嵌套，改为加载公共 `node-geometry.js` 并输出 Designer 的 `.image-wrap/.node-img/.thumb-grid` DOM。真实 Chrome 对照同一双图节点，Designer 与 Share 均为 `304×176`；单图自动布局回归为 `292×440`。Composer 保留原输入表面但默认隐藏，Focus、参数、模板、运行按钮与图标全部省略。29 项静态/几何测试和完整 Chromium 分享页矩阵通过。
- 2026-08-28 选择与关闭交互回归：删除分享页私有 `.share-node-selected` Outline，改用公共 Canvas Node 的 `.selected` 状态；新增统一的本地清除动作，Canvas 空白 Pointer 会同时清除选中态和关闭 Composer，并继续允许平移。29 项分享页静态合同与 Node Geometry 测试、JavaScript 语法检查、`git diff --check` 和完整 Chromium 分享页矩阵通过；真实 Chrome 验证 Image Node 与图片边界同为 `164×104`、无分享私有选中态、空白点击后 Composer 关闭且选中 Node 为 0；2026-08-29 清理冗余文档目录后，知识地图 7 项全部通过。
- 2026-08-28 分享性能开关回归：分享页直接接入现有 `canvasLevelOfDetail`、`canvasVirtualization` 与 `SmartImageResolution`，并将 Designer 原有远景 body 抽成双方共用的 `canvasFarPresentation`；后端分享媒体继续经过 token / 引用校验，再复用既有预览图生成器。166 Node 浏览器夹具在 10.98% 初始缩放进入远景模式并只请求 `w=512`；放大进入细节模式后挂载 137 / 166 个一屏加缓冲区内的 Node，节点总数仍保持 166，且无写请求。Designer 的远景 Prompt 真实 Chrome 回归同时通过。
- 2026-08-28 Generation 产出图比例回归：真实分享链接中的一张 Generation 产出图原图比例与远景显示比例均为 `0.664`，进入细节模式后曾因 `kind="generation"` 未命中公共媒体填充规则而回退到 `260×180`，显示比例变成 `1.444` 并发生裁剪。公共 Smart Canvas 样式现让 Image / 已有媒体的 Generation 共用同一媒体尺寸规则；原链接放大后 Image、Wrapper、Node 三者尺寸一致，显示比例恢复为 `0.664`。分享页真实 Chromium 与 Designer 公共 Node 真实 Chrome 回归均通过。
