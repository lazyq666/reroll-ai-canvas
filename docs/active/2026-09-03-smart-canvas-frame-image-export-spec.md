# Smart Canvas 分区大图下载

- **Status**：Implemented（已实现并进行自动化验收；跨平台人工 Gate 完成前保持 Active）
- **Feature ID**：F05 / F10
- **Owners**：产品 / UI / 交互 / 前端 / 测试
- **Last verified**：2026-09-03（真实 macOS Chrome 页面下载与 PNG 解码；详见第 17 节）
- **Applies to**：Smart Canvas 分区大图下载首版，发布版本待实施时确定
- **Issue**：[GitHub #23](https://github.com/lazyq666/reroll-ai-canvas/issues/23)，已加入开发看板；验收后进入 Review，发布及所需人工验收前保持开放。
- **Supersedes**：无
- **Superseded by**：无
- **Related ADRs**：[Workspace 数据边界](../adr/0001-workspace-data-boundary.md)、[UI 家族模块所有权](../adr/0002-ui-family-module-ownership.md)
- **Domain terms**：Smart Canvas、Frame、Image Node、Text Annotation Node、Brush Stroke Node、Smart Group、Canvas Selection、Canvas Viewport、Canvas Mutation、Managed Media

## 1. 一页摘要

用户单选 Frame（分区）后，可在 `smartNodeFloatingPortal` 浮动工具栏点击“下载”，将分区视觉排版保存为一张 PNG。屏幕外的分区内容也参与导出，无需缩小画布或分段截图。

**用户确认的范围**：图片按分区内的位置、大小合成，加上文字标注、画笔、分区背景；提示词卡片、连线、视频封面不显示。排除内容后不重新排列其余内容。

**首版规则**：以分区矩形裁切；输出 PNG；默认 1×、可选 2×；保留当前主题的分区底色；不输出标题与编辑控件；最终确认下载时冻结内容快照。用户已要求按本 Spec 实施；容量参数的跨平台发布验证仍待完成。

## 2. Problem Statement

用户已在分区中完成图片、文字与笔迹排版，希望直接交付该视觉结果。现有单媒体与 ZIP 下载不保留位置关系；截图受到窗口尺寸、缩放、远景简化和屏幕外节点未渲染的影响。

## 3. Goals / Non-goals

### Goals

- 从单选分区的浮动工具栏下载一张完整 PNG，保留支持内容的排版、空白、裁切、透明混合与叠放。
- 图片使用原始资源；文字换行与笔迹与详细模式一致；输出不受视口、浏览器缩放和设备像素密度影响。
- 加载、超限、取消、失败及重试均有明确反馈，导出不修改画布。

### Non-goals

- 完整画布截图或生成工作流示意图；提示词卡片、Connection、视频封面/抽帧、音频、附件、运行占位输出。
- 多分区批量下载、ZIP、PDF、SVG、JPEG、动画、打印排版或 AI 放大。
- 自动重排、扩大分区、展开容器内部隐藏内容；透明/白色背景切换、主题切换、标题开关或自定义尺寸。
- 自动上传结果、加入资产库、创建新 Image Node；不扩展分享页的导出能力。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Administrator / Designer | 按既有权限进入 Smart Canvas 编辑页，完整文档已加载 | 下载所选分区的支持内容 | 读取其他 Canvas / Workspace 的未授权资源 |
| Guest Account | 无编辑页面访问资格 | 无新增能力 | 使用分区导出入口 |
| Anonymous Share Visitor | 通过 Share Link 只读访问 | 保持原有分享能力 | 首版不提供此入口 |

导出是读取与本机下载，不提交 Canvas Edit，不改变 Canvas Updated Time。媒体读取沿用原权限通道；收到会话失效或权限拒绝时终止任务。

## 5. User stories

1. 设计师可下载屏幕外仍存在的分区内容，保留排版和清晰度。
2. 设计师可保留图片、文字与笔迹，排除提示词、连线和视频并留下原空位。
3. 下载前可查看像素尺寸、选择倍率；空内容可下载背景图。
4. 加载或编码失败可重试；等待期间可取消，不产生半成品。
5. 协作者可继续编辑，单次输出使用一致快照，导出不增加撤销记录。
6. 键盘用户可完成打开、倍率选择、下载、取消和重试，并获得焦点与状态反馈。

## 6. User journey and interaction contract

### Entry and exit

- 单选 Frame 的浮动工具栏顺序为“重命名分区 → 切换颜色 → 下载 → 取消分区”。使用 download 图标与现有动作层级。
- 不修改单图片、编组、多选下载或右键菜单的含义。
- 点击“下载”打开小型任务 Dialog：标题“下载分区”、只读分区名称、1× / 2×、实际像素宽高、简短内容范围说明、“取消”“下载”。
- 默认 1×，不跨会话保存；倍率变化即时刷新尺寸和下载可用性。最终确认时才冻结内容。
- 成功交给浏览器下载后关闭 Dialog；产品只提示“已开始下载”，不声称文件已写入磁盘。
- 关闭或取消返回画布；目标仍存在且选中时焦点回到下载按钮，否则回到画布可聚焦入口。

### Observable states

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| ready | 名称、内容、尺寸有效 | 名称、倍率、像素尺寸、范围说明 | 改倍率、下载、取消 | 开始准备或关闭 |
| background-only | 空分区或只有排除内容 | “此分区仅导出背景” | 下载背景、改倍率、取消 | 同 ready |
| oversized | 倍率超出尺寸限制 | 超限提示，下载禁用 | 降倍率、取消 | 尺寸有效或关闭 |
| preparing | 最终确认下载 | “正在准备图片…” | 取消 | 就绪、失败或取消 |
| rendering | 开始分批读取原图、绘制和编码 | “正在生成图片…” | 取消 | 下载触发、失败或取消 |
| success | PNG 交给浏览器 | “已开始下载” | 继续使用画布 | Dialog 关闭 |
| failure | 网络/字体/解码/绘制/编码失败或超时 | 对应错误，保留倍率 | 重试、改倍率、取消 | 新尝试或关闭 |
| unavailable | 根分区删除、上下文切换或已知权限失效 | 原因说明，不下载 | 关闭，重新进入可用画布 | 清理任务 |

不提供跳过失败图片的部分成功模式。主动排除的内容属于正常过滤，不报素材错误。准备和绘制期间禁用倍率及重复提交。

### Input, pointer and keyboard

- Tab 顺序与视觉顺序一致；Enter / Space 激活动作，倍率遵循共享控件键盘行为。
- Escape、关闭按钮和取消走同一取消路径；点击遮罩不关闭任务 Dialog。
- 使用可访问状态消息播报进度，错误与控件关联，不仅依赖 Toast 或颜色。
- 连续点击或 Enter 不重复提交；取消后的迟到结果不得下载或关闭新任务的 Dialog。

### Responsive and themes

支持桌面和较窄桌面窗口；长名称截断或换行，Dialog 不超出窗口，按钮可达。不增加移动端承诺。Light / Dark 都需验证；导出颜色按确认时主题冻结。

### Copy and internationalization

全部可见/无障碍文案进入共享 i18n，使用 `data-i18n-*` / `tr` / `trf`；分区导出专用文案使用 `smart.frameExport.*`，通用下载动作复用 `smart.contextDownload`。

| 场景 | 中文 | English |
| --- | --- | --- |
| 动作 / 标题及入口无障碍名称 | 下载 / 下载分区 | Download / Download frame |
| 字段 | 导出倍率 / 图片尺寸 | Scale / Image dimensions |
| 包含说明 | 包含图片、文字标注、画笔和分区背景 | Includes images, text annotations, brush strokes, and the frame background. |
| 排除说明 | 不包含提示词卡片、连线或视频封面 | Prompt cards, connections, and video thumbnails are excluded. |
| 空内容 | 此分区仅导出背景 | Only the frame background will be exported. |
| 进度 | 正在准备图片… / 正在生成图片… | Preparing images… / Creating image… |
| 下载触发 | 已开始下载 | Download started |
| 素材失败 | 图片无法加载，请重试 | Could not load an image. Please try again. |
| 字体失败 | 文字样式加载失败，请重试 | Could not load text styles. Please try again. |
| 尺寸超限 | 图片尺寸过大，请降低倍率或缩小分区 | The image is too large. Choose a lower scale or resize the frame. |
| 生成失败 | 无法生成图片，请降低倍率或重试 | Could not create the image. Choose a lower scale or try again. |
| 超时 | 导出超时，请重试 | Export timed out. Please try again. |
| 删除 | 分区已被删除，请重新选择 | This frame was deleted. Select another frame. |
| 内容变化 | 分区内容已变化，请检查尺寸后再次下载 | The frame contents have changed. Check the dimensions and download again. |
| 权限 | 当前无法访问此画布，请重新打开 | This canvas is no longer accessible. Please reopen it. |
| 操作 | 取消 / 重试 | Cancel / Retry |

`1×`、`2×`、`PNG`、`{width} × {height} px` 保留符号，数字按既有方式格式化。动态语言切换覆盖 Dialog、进度、失败、空状态和无障碍名称，不重启任务。

## 7. Functional rules

### 7.1 内容白名单

| 内容 | 输出规则 |
| --- | --- |
| 已完成图片，包括图片生成结果 | 只绘制媒体区域，保留位置、大小、比例、现有裁切和 Alpha；不绘制节点标题、文件名、尺寸 Badge、边框、阴影、端口或控件 |
| Text Annotation Node | 保留正文、显式与自动换行、字体、字号、字重、行高、字距与颜色；空文字不输出占位提示 |
| Brush Stroke Node | 保留持久路径、坐标变换、宽度、颜色和透明度；沿用现有曲线、圆头和连接；不绘制命中热区或未结束的笔画预览 |
| 根分区及后代分区 | 绘制正常背景填充；主题和裁切规则见下文 |
| Smart Group 内的支持内容 | 沿用详细布局与内部裁切，递归识别图片、标注和笔迹；不绘制编组外壳、摘要、标题或生成配置 |
| Prompt Node / Prompt Generation Node、Splitter、Batch Run Node | 整体排除，包括其卡片内的参考图、正文和控制 |
| 视频、音频、附件、无图片的运行或失败节点 | 不绘制封面、媒体、图标、波形、状态或占位文字 |
| Connection 与编辑装饰 | 不输出连线、工具栏、选择框、拖动预览、实时指针、头像、操作控件或画布网格 |

多媒体节点先按完整布局计算槽位，再过滤类型；排除视频后不压缩槽位。已成为独立静态 Image Node 的视频抽帧图片可正常输出，导出本身不抽帧。

### 7.2 成员、坐标与叠放

1. 复用当前分区成员与后代关系，不新增另一套空间归属算法。现有按中心归属最小分区的规则继续有效。
2. 只输出选中分区及其后代的支持内容。非成员即使覆盖分区一角也不进入结果。
3. 成员伸出根分区的部分按根分区矩形裁切；不扩大范围或增加边距。后代分区沿用现有溢出语义，只有原布局存在内部裁切时才增加该裁切。
4. 后代按节点身份去重；编组槽位已绘制的图片不从独立成员重复绘制。相同 URL 在不同视觉实例出现时全部保留，不能按 URL 去重排版。
5. 使用正常非交互的图层顺序，背景先于内容，图片、文字与笔迹保留相互叠放。忽略 Selection、Hover、Dragging 的临时提层，不一律将文字或画笔放到最上面。
6. 采用完整详细模式布局，忽略远景简化和屏幕外节点是否挂载。编组和多媒体内部滚动区域按顶部初始布局绘制，超出原可视区域的部分裁切；不自动展开内部滚动或折叠内容。这是保证结果不依赖个人浏览状态的首版默认规则。

### 7.3 背景与标题

- 输出矩形 PNG：先铺满当前主题的纯色画布底色，再叠加正常未选中的分区背景，保留颜色、填充透明度及圆角。
- 半透明背景与底色合成为不透明底图；透明图片按自身 Alpha 与底图混合。不同图片查看器不会因底色不同改变分区背景观感。
- 根分区和后代分区的标题、数量、标题栏装饰、边界描线、选中高亮、阴影全部不输出。当前分区标题栏位于内部，原标题区域保留空白和背景，不上移内容或收紧输出边界。
- 不使用网格、其他分区或非成员节点作为底图。Light / Dark 可以输出不同底色；同主题不受视口与选中状态影响。

### 7.4 输出尺寸与文件

- 根分区世界尺寸为 `W × H`，倍率 `s` 为 1 或 2；输出为 `round(W × s) × round(H × s)` 像素，默认 1×。
- 1200 × 800 分区分别输出 1200 × 800 或 2400 × 1600；画布显示为 25% 或 200% 不影响结果。
- 位置、尺寸、笔宽、文字统一缩放，保留小数坐标至绘制，不逐节点提前取整造成位移。
- 使用原始资源或等价托管副本，不能用低清缩略图作为成功回退。提高倍率不增加原图细节，不调用 AI。
- 文件名为经过现有安全文件名规则处理的 `分区名称.png`；清理后为空使用 `frame.png`；重名由浏览器处理。
- 空分区或仅排除内容时，可在 background-only 提示后下载背景图。

## 8. Domain and state model

导出是本地瞬时任务，不增加 Node、Generation Run 或持久 Operation ID。本地尝试标识用于隔离取消、重试和迟到回调。

- Dialog 准备阶段更新目标变化引起的尺寸和空状态；确认时重新校验。若显示与实际内容不一致，刷新摘要，提示再次下载。
- 最终确认复制一份只读快照：Workspace / Canvas / Frame 身份、支持节点与几何、资源引用、主题样式、倍率、文件名。全过程只读取该快照。
- 快照后的普通成员移动、编辑、删除、生成完成或主题切换不混入本次结果；源资源已不可读时按素材失败处理。下一次下载读取最新内容。
- 根分区被本机/协作者删除（包括 Undo）、Canvas / Workspace 切换、页面退出、登出或已知权限失效，均取消任务并清理。
- 重试创建新尝试，读取最新快照并重新预检，不混用两次内容。
- 所有终态均不得更改 Selection、Viewport、Undo、节点顺序/位置/内容或 Canvas Updated Time。

## 9. Data and persistence

| Data | Authority | Boundary | Retention | Migration/recovery |
| --- | --- | --- | --- | --- |
| 分区、成员、文字、笔迹与媒体引用 | 已加载 Canvas 状态 | Workspace Data | 原生命周期 | 不修改数据格式 |
| 快照、倍率、解码资源与任务状态 | 当前页面内存 | 编辑端瞬时状态 | 终态或退出后释放 | 不恢复、不跨 Workspace 复用 |
| PNG 下载文件 | 用户浏览器下载 | 用户本机文件 | 用户管理 | 不自动登记为 Managed Media |

无数据库字段、数据迁移或长期导出缓存。原图请求产生的既有资源缓存沿用现有规则。

## 10. API / WebSocket / Provider contracts

首版不新增公共 API、WebSocket 消息或 Provider 调用，不要求服务器合成图片。

| Contract | Caller | Observable result | Errors/recovery |
| --- | --- | --- | --- |
| 现有原始媒体读取 / 同源代理 | 导出任务 | 得到当前用户可读原图 | 网络、失效资源或拒绝访问导致失败，修复后重试 |
| 既有 Canvas 同步与页面生命周期 | 页面宿主 | 获知根分区删除、上下文或已知权限变化 | 取消任务，不新增协议 |
| 浏览器下载 | 导出任务 | 一份 PNG Blob 和文件名交给浏览器 | 只承诺触发下载，磁盘保存由浏览器控制 |

若前端容量验证失败，需要重新评审服务端或分片方案，不在实施中默默扩大首版接口。

## 11. Security and privacy

- 复用现有资源解析与权限，不新增无鉴权资源通道或绕过限制。
- 白名单快照不收集排除卡片的 Prompt、Provider 参数、令牌或隐藏附件。
- PNG 不附加 Prompt、工作流、源 URL、原图元数据等文本元数据；用户写在文字标注内的内容按画面输出。
- 错误只显示业务原因与数量，不暴露查询凭据、绝对路径、堆栈或二进制。

## 12. Performance and reliability constraints

以下为首版应用保护阈值；已验证 macOS Chrome 背景图接近总像素上限时可以编码，混合大量原图与 Windows 容量仍需发布前实测。这些数值不代表浏览器通用上限：

- 每边最多 **8192 px**，总像素最多 **32,000,000**，两项同时满足。尺寸必须为有限正数，分配画布前检查。
- 2× 超限禁用该档，1× 可用则保持下载；1× 也超限时提示缩小分区。不静默降倍率或分文件。
- 单页面同时最多一个任务，不排队；重复激活复用现有界面。
- 原图有界分批读取、解码、绘制和释放，不一次解码全部素材。可复用源字节，但每个视觉实例独立绘制。
- 单资源准备超时暂定 30 秒，整体尝试暂定 120 秒；超时失败，不自动重试。超时反馈可能等待当前不可中断的浏览器编码调用结束。
- 绘制按批次让出主线程，及时呈现进度。取消立即反馈并停止后续工作；不可中止的编码结果到达后丢弃。
- 输出限制不能替代源图片解码内存管理。分配、解码或编码失败不得提交空文件，也不能以缩略图冒充原图。
- 终态释放临时画布、位图、监听器与任务缓存；下载 Object URL 在浏览器取得内容后按既有下载生命周期回收，避免过早回收。

毕业前在 macOS / Windows 桌面环境验证普通、接近阈值和重复导出/取消，记录耗时与资源表现，再决定是否调整上述参数。

## 13. Design system contract

- 复用 `ic-smart-node-toolbar`、`ic-button` 和 download 图标，保持现有分区动作尺寸与层级。
- 使用小型显式关闭任务 `ic-dialog`、`ic-segmented-control` 及现有进度/错误反馈；沿用 `--ui-*` Token 与焦点策略。
- 不复制公共组件内部样式；分区底色、文字和笔迹样式从生产呈现规则解析并冻结，不维护独立颜色或字体常量表。
- 真实页面和导出 PNG 需要 UI 人工确认；截图和像素回归不能替代全部人工验收。

## 14. Implementation decisions

- 浏览器侧独立分区图像导出职责模块拥有白名单快照、绘制计划、资源加载、编码、容量、取消与清理。页面只组合入口、Dialog 和状态提供。
- 复用 Smart Container 成员/后代查询、Node Geometry / 媒体布局、原图解析与下载基础能力；不调用会重排或写回结果的 Image Studio 操作。
- 用完整数据与独立绘制表面生成图片，不截取当前 `world` DOM，不改变真实画布缩放或挂载所有节点。
- 文字细节可以通过不影响生产视图的离屏测量取得，等待所需字体就绪；不能用字符数估算作为最终换行依据。
- 图片、文字、笔迹、背景按内容类型隔离绘制；不引入外部截图服务或改变现有容器职责。
- `frame-image-export.js` 拥有任务与绘制；`frame-image-export-host.js` 只适配页面状态、生产节点呈现和下载。离屏节点只用于读取支持内容的几何与样式，逐个测量，图片来源在挂载前清除；原图随后通过受控加载按张绘制。
- 文字使用浏览器 Range 测量字素位置，冻结字体后按测得坐标绘制；图片沿用生产媒体槽位的 object-fit 和内部裁切；图层顺序使用正常状态的 CSS 层级与原顺序。

## 15. Acceptance and testing

### Highest test seam

从真实 Smart Canvas 单选分区、操作工具栏和 Dialog，捕获实际下载，解码 PNG 验证尺寸和内容。以外部结果验收，不以函数存在或源码文本断言代替行为测试。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
| A01 入口与倍率 | 页面与 PNG | 工具栏顺序正确；1200 × 800 分区按倍率输出精确尺寸 |
| A02 内容过滤 | PNG 区域/像素 | 四类支持内容出现；提示词与内嵌参考、连线、视频等消失；空位保留 |
| A03 视口无关 | 缩放、平移、离屏节点 | 同主题同数据在 25% / 100% / 200% 内容尺寸一致，无屏幕外遗漏 |
| A04 原图与叠放 | 高频原图与透明重叠 | 原图清晰，Alpha 与正常图层正确；选中/Hover 不改变输出 |
| A05 标注 | 中文/英文、换行、长词、空文、曲线/点 | 字号、换行、位置、笔宽、颜色匹配，字体失败可恢复 |
| A06 容器与裁切 | 越界、后代分区、编组、重复 URL | 非成员不出现；越界裁切；无重复节点，同源不同实例保留；内部滚动符合 7.2 |
| A07 背景与空状态 | Light/Dark、空分区、仅排除内容 | 主题底色正确，无标题、网格、高亮；背景图可下载 |
| A08 限制 | 边长/总像素临界及无效尺寸 | 分别触发限制，超限不分配，不静默降级，可用倍率正常 |
| A09 失败与重试 | 网络/字体/解码/编码故障、超时、空 Blob | 无半成品，错误可理解，修复后新快照重试成功 |
| A10 取消与重复 | 延迟任务和连续点击 | 仅一个任务，取消后迟到结果不下载，后续新任务正常 |
| A11 并发与生命周期 | 编辑/删除成员、删除根分区、切换上下文 | 普通变化不混入快照；根分区删除或上下文失效取消 |
| A12 只读副作用 | 前后状态与网络 | Selection、Viewport、Undo、内容及更新时间不变，无新增 Mutation、生成或上传 |
| A13 可访问性/i18n | 键盘、动态语言、窄桌面、主题 | 操作和焦点闭环，状态可读，全部文案同步切换 |
| A14 容量与释放 | 近上限和重复成功/失败/取消 | 可完成或明确失败，后续操作可用，任务资源不持续积累 |

纯数据测试补充尺寸、白名单和容器展开边界。视觉比较允许固定平台合理抗锯齿差异，不要求跨系统逐字节相同。

### Human acceptance

| Role | Scene | Evidence / confirmation |
| --- | --- | --- |
| UI / 产品 | 真实图片、中文标注、笔迹分区 × Light/Dark | 对照详细布局与 PNG，确认内容、排版、颜色和空白 |
| 交互 | 窄桌面、键盘、取消、错误重试 | 控件可达，状态明确，画布不跳动 |
| 测试 | macOS / Windows，普通及近阈值分区 | 记录环境、规模、耗时、恢复和重复操作结果 |

### Regression neighbors

分区重命名/颜色/取消分区、编组布局、单媒体/ZIP 下载、Image Studio 拼接、标注编辑、远景和虚拟化、协作、Undo、主题及语言切换。

## 16. Rollout, migration and rollback

- 无迁移；旧分区沿用既有载入/布局规则，原图缺失按失败处理。
- Issue #23 已建立并关联看板；用户于 2026-09-03 授权按 Spec 实施。代码验收后进入 Review，跨平台人工与发布 Gate 通过后再关闭。
- 完成后执行第 15 节、i18n 校验及语言回归。触及共享 UI 模块或其引用时执行 UI 资源版本同步；发布推送遵守 VERSION / update-notes 规则。
- 自动化及必要人工 Gate 通过后才毕业 Current，按[完成文档规则](../agents/change-documentation.md)对齐 Issue、项目地图和相关 UI 权威。
- 回退移除新增入口与导出模块接线，不修改 Canvas 数据或既有下载。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product map | [F05 / F10](../PROJECT-MAP.md#功能规格注册表) |
| Domain | [词汇](../../CONTEXT.md)、[编组与分区命名](../current/smart-canvas-container-terminology.md) |
| UI surfaces | [UI 指南](../current/ui-design-guidelines.md)、[Smart Canvas 页面](../../static/smart-canvas.html) |
| Existing implementation seams | [导出模块](../../static/js/smart-canvas/frame-image-export.js)、[页面适配](../../static/js/smart-canvas/frame-image-export-host.js)、[页面与工具栏](../../static/js/smart-canvas.js)、[Smart Container](../../static/js/smart-canvas/smart-container.js)、[Node Geometry](../../static/js/smart-canvas/node-geometry.js) |
| Regression entry | [PNG 下载 browser smoke](../../tests/smart_canvas_frame_image_export_browser_smoke.cjs)、[尺寸与成员测试](../../tests/smart_canvas_frame_image_export.test.cjs)、[原有分区工具栏 smoke](../../tests/smart_canvas_frame_toolbar_browser_smoke.cjs) |
| Automated validation | 2026-09-03：`.venv/bin/python -m unittest tests.test_documentation_knowledge_map tests.test_smart_canvas_node_components tests.test_core_creation_i18n tests.test_i18n_cache_versions`，23 项通过；`node tests/smart_canvas_frame_image_export.test.cjs`、两个 browser smoke 均通过；`node static/js/i18n/validate-i18n.js` 校验 3071 个键通过；UI 资源版本 `--check`、Spec 相对链接、19 个模板章节及 `git diff --check` 通过。系统 `python3` 为 3.9，不兼容现有测试类型注解，因此使用项目虚拟环境执行 |
| Browser/manual evidence | macOS Chrome 自动化已覆盖 PNG 内容/裁切、1×/2×、详细/远景、主题/语言、重试/取消、空分区、编组与嵌套、快照/根分区删除及 8192 × 3906 背景图编码；导出 PNG 与 Dark Dialog 已视觉检查。Windows、真实复杂原图容量及完整人工验收仍待执行，不据此毕业 Current |
| Issue / Project | [Issue #23](https://github.com/lazyq666/reroll-ai-canvas/issues/23)，开发看板跟踪，保持开放 |

浏览器测试入口为 `node tests/smart_canvas_frame_image_export_browser_smoke.cjs` 和 `node tests/smart_canvas_frame_toolbar_browser_smoke.cjs`，运行环境需提供 Playwright、Sharp 与 Chrome。首个脚本自带临时服务，后者使用 `tests/smart_canvas_manual_server.py`。本机最近一次导出测试的近阈值背景 PNG 为 8192 × 3906，含弹窗与下载约 876 ms；此记录仅作为 macOS Chrome 的背景图基线，不代表复杂原图或其他设备表现。

## 18. Open questions

内容与首版行为没有未决产品问题。剩余发布 Gate 是 Windows 人工交互/视觉与复杂原图容量验证；依据结果决定是否调整应用阈值，不能把当前 macOS 背景图成绩当作所有设备的容量承诺。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| 2026-09-03 | Draft | 分区 PNG 下载的白名单、交互、布局、容量与验收初稿 | 用户确认图片、文字标注、画笔、背景及排除提示词卡片、连线、视频封面；其余默认规则由本稿提出 |
| 2026-09-03 | Implemented | 用户授权实施；新增导出模块、Dialog、中英文和实际 PNG 验收 | Issue #23；素材按张读取，在首张失败时整体终止，因此失败文案不统计全部失败数量 |
