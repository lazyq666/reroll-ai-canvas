# Smart Canvas 远景简化、媒体资源与按需校验需求规格

- 状态：已实施，人工验收通过
- 日期：2026-08-20
- 完成日期：2026-08-20
- 适用范围：Smart Canvas、Canvas Viewport、Smart Group、Frame、Image Studio、Prompt Authoring
- 关联参考：[`canvas-mutation-single-node-move-fast-path.md`](../current/canvas-mutation-single-node-move-fast-path.md)

## Problem Statement

Smart Canvas 已经具备 Canvas Viewport 虚拟化和图片预览优化，但用户仍会遇到几类相互关联的问题。

第一，Canvas Viewport 内的图片可能突然消失或显示为破损图片。虚拟化本意是让远离可视范围的 Node 不再占用浏览器资源，但如果 Node、图片请求和 DOM 的销毁与恢复时机过于激进，用户仍在观看的内容也会被错误回收。用户无法判断这是图片损坏、网络失败，还是性能优化造成的闪烁。

第二，当用户缩小到全览或远景时，大量 Node 虽然已经小到无法阅读，浏览器仍可能创建完整标题、文本、按钮、媒体控件、多图网格、阴影和其他细节。Canvas Viewport 全览时用户的任务已经从“编辑内容”切换成“理解结构和导航”，继续保留完整内容既没有可读价值，也会增加 DOM、图片解码、显卡纹理、布局和绘制成本。

第三，当前图片预览缓存并不是预先固定创建 512、1024、2048 三份。服务端会根据每一次请求的精确宽度惰性创建一份 Device Cache 文件，因此 256、512、768、1024、1536、2048 或其他精确宽度都可能分别产生缓存。Image Studio 当前在一次打开过程中还可能同时请求 1536 WebP、2048 WebP 和原图。冷缓存时，创建 WebP 需要先完整读取并解码原图，再缩放、编码和写盘；这会让“打开详情”反而增加一次额外工作。

第四，放大查看和 Image Studio 的用户目标是检查或修改原始内容，而不是观看性能代理图。如果用户在原图加载完成前快速进入裁剪、画笔或切分，当前 2048 WebP 有机会继续作为编辑底图，最终输出可能被无提示地限制在 2048，并产生二次有损压缩。

第五，Frame 和 Smart Group 是远景导航的重要地标，但它们的名称会随 Canvas Viewport 一起缩小。Frame 名称在全览时可能缩小到无法阅读；Smart Group 当前即使在近景也可能只显示“2 图片”一类摘要而不显示真实名称。单独为 Frame 和 Smart Group 设置不同的缩放百分比仍不能解决问题，因为不同 Frame 的画布尺寸差异很大，同一缩放比例下的屏幕占地并不相同。

第六，Generation Settings 中曾经使用过的模型在模型列表中被关闭或隐藏后，系统会在进入 Smart Canvas 或拖入媒体时主动检查并报错。此时用户没有打开 Prompt Authoring，也没有准备生成，提示与当前动作无关，并产生多余检查。用户只希望在打开 Prompt Authoring 时得知当前选择已经失效。

这些问题都属于客户端展示精度、资源生命周期和检查时机问题。它们不应改变 Workspace Data，不应产生 Canvas Mutation，不应进入 Undo，也不应通过 Canvas Sync 同步给其他协作者。多人同时移动 Node 的服务端确认性能已经由单节点移动快速通道规格负责，本规格不重复设计该路径。

## Solution

为 Smart Canvas 增加一个统一的 Canvas Level of Detail（画布细节层级）机制，并向用户提供“远景简化模式”设置。

远景简化模式默认开启。用户配置的是进入远景模式的缩放阈值，范围为 10%–100%，默认 23%。Canvas Viewport 缩放低于 23% 时进入远景模式；进入后只有缩放高于 28% 才退出。自定义阈值也使用固定 5 个百分点的回差区间：低于用户阈值进入，高于“用户阈值 + 5 个百分点”退出，中间区间保持当前状态。这样可以避免滚轮停在阈值附近时反复销毁和重建资源。

远景模式把 Smart Canvas 从“内容编辑视图”转换成“结构导航视图”。普通 Node 保留轮廓、类型/状态识别、选择和连接关系；图片 Node 最多保留一张 512 轻量预览；视频只保留静态封面；生成中的 Node 保留原有渐变背景和边框，使用静态“正在生成图片”文字，且整张 Node 只呈现一个连续渐变表面；Prompt Node 和 Prompt Generation Node 使用低成本的文本骨架占位符。复杂文本、多个缩略图、富控件、动态媒体、阴影、徽标和不可读的辅助信息不创建或被释放。退出远景模式后，只为 Canvas Viewport 可视范围及合理预加载范围内的 Node 渐进恢复详细资源。

Frame 和 Smart Group 不使用独立的用户缩放阈值。它们通过一个独立于 Node 内容精度的屏幕空间导航标签层显示名称。标签维持约 12 px 的屏幕字号，不随 Canvas Viewport 继续缩小；根据 Frame 或 Smart Group 在屏幕上的实际占地、选择/悬停状态和标签碰撞决定显示。Frame 的导航优先级高于 Smart Group。Smart Group 在近景和远景都必须能显示真实名称；没有自定义名称时才使用类型回退名。

Canvas Viewport 内的 Node 使用稳定的 Render Set 和有界预加载范围。刚离开可视范围的 Node 可以短暂保留为温缓存，避免轻微平移造成闪烁；温缓存必须有数量和媒体资源上限，不能无限积累。任何仍在 Canvas Viewport、预加载范围、Canvas Selection 或 Canvas Interaction 中的 Node 都不能被错误回收。

画布中的图片继续使用 512、1024、2048 三档自适应预览。档位根据图片在屏幕上实际需要的物理像素选择，并保留升降档回差。服务端继续按精确请求宽度惰性创建 Device Cache，不把该机制描述成“每张图片固定创建三份”。远景模式统一限制到 512，并中止已无需要的高精度升级。

放大查看和 Image Studio 改为直接加载原图，不再为了打开详情主动请求或创建 1536/2048 WebP。原图是检查、对比、裁剪、画笔、缩放和切分的唯一权威像素源。原图加载失败时明确显示失败状态并禁止提交像素编辑，不再请求任何 2048 WebP 故障兜底。

模型可用性的主动检查只在 Prompt Authoring 打开时发生。进入 Smart Canvas、恢复 Canvas Viewport、选择 Node、平移缩放和拖入媒体都不触发失效模型提示。打开 Prompt Authoring 后，如果当前 Generation Settings 指向已隐藏或关闭的模型，提示一次并要求用户重新选择。Generation Run 提交时仍必须进行必要的安全校验，这属于执行正确性检查，不受“只在打开时主动提示”的限制。

## User Stories

1. As a Smart Canvas 用户，我希望 Canvas Viewport 内的图片保持稳定显示，从而不会把性能回收误认为文件损坏。
2. As a Smart Canvas 用户，我希望快速小幅平移后刚离开画面的 Node 可以短暂保温，从而返回时不会看到闪烁和破损占位。
3. As a Smart Canvas 用户，我希望远离 Canvas Viewport 的昂贵媒体资源被释放，从而大型 Smart Canvas 不会持续占满内存和显卡。
4. As a Smart Canvas 用户，我希望被选择或正在交互的 Node 不会因为越过可视边界而消失，从而拖动和编辑手势可以连续完成。
5. As a Smart Canvas 用户，我希望缩小到全览时自动进入远景简化模式，从而能流畅地理解整体结构。
6. As a Smart Canvas 用户，我希望放大回到内容编辑尺度时自动恢复细节，从而不需要手动切换显示模式。
7. As a Smart Canvas 用户，我希望远景模式默认开启，从而首次使用大型 Smart Canvas 就能获得性能收益。
8. As a Smart Canvas 用户，我希望可以关闭远景模式，从而在特殊情况下保留完整显示。
9. As a Smart Canvas 用户，我希望能配置远景模式触发阈值，从而适配自己的屏幕、缩放习惯和 Smart Canvas 密度。
10. As a Smart Canvas 用户，我希望阈值使用熟悉的百分比表达，从而能理解 23% 与当前 Canvas Viewport 缩放的关系。
11. As a Smart Canvas 用户，我希望阈值控件只提供 10%–100% 的有效配置范围，从而不会把 Canvas Viewport 的全部 2%–800% 物理范围误认为合理设置范围。
12. As a Smart Canvas 用户，我希望缩放停在阈值附近时界面保持稳定，从而 Node 不会反复在简化与详细状态之间跳变。
13. As a Smart Canvas 用户，我希望连续滚轮缩放时资源恢复是渐进的，从而不会在退出远景模式的一帧内同时创建全部图片和控件。
14. As a Smart Canvas 用户，我希望进入远景模式时不需要的高分辨率请求被取消，从而旧请求不会在稍后覆盖当前状态。
15. As a Smart Canvas 用户，我希望普通 Node 在远景中仍保留轮廓和类型识别，从而能看懂 Smart Canvas 的空间组织。
16. As a Smart Canvas 用户，我希望 Connection 在远景中仍可理解，从而能追踪生成或引用关系。
17. As a Smart Canvas 用户，我希望图片 Node 在远景中最多显示一张轻量预览，从而兼顾内容识别和性能。
18. As a Smart Canvas 用户，我希望视频在远景中只显示静态封面，从而不会创建播放器、解码视频或自动播放。
19. As a Smart Canvas 用户，我希望远景中的生成状态保留单一连续渐变背景和边框并显示“正在生成图片”，从而容易识别又不会因大量动画拖慢全览。
20. As a Smart Canvas 用户，我希望 Prompt Node 和 Prompt Generation Node 在远景中显示文本骨架占位符，而不创建不可读的正文、按钮和输入控件。
21. As a Frame 使用者，我希望全览时仍能读到重要 Frame 名称，从而可以用 Frame 导航大型 Smart Canvas。
22. As a Smart Group 使用者，我希望近景时能够看到 Smart Group 的真实名称，而不只是“2 图片”一类摘要，从而知道分组用途。
23. As a Smart Group 使用者，我希望远景时保留轻量边界和名称，从而可以把 Smart Group 当作导航地标。
24. As a Smart Canvas 用户，我希望 Frame 和 Smart Group 标签保持屏幕可读字号，从而它们不会随着画布缩小到几个像素。
25. As a Smart Canvas 用户，我希望标签重叠时优先保留 Frame 名称，从而主结构比次级分组更清楚。
26. As a Smart Canvas 用户，我希望选中或悬停的 Frame/Smart Group 名称始终出现，从而能确认当前目标。
27. As a Smart Canvas 用户，我希望标签显示由屏幕实际占地决定，从而巨大 Frame 和小型 Smart Group 不会被同一个生硬缩放百分比控制。
28. As a Smart Canvas 用户，我希望画布缩略图根据实际显示像素选择 512、1024 或 2048，从而不会在小尺寸下解码不必要的大图。
29. As a Smart Canvas 用户，我希望图片升降档有回差，从而轻微缩放不会频繁切换图片地址。
30. As a Smart Canvas 用户，我希望系统准确说明 Device Cache 是按请求尺寸惰性创建，从而不会误以为每张图片固定占用三份缓存。
31. As a Smart Canvas 用户，我希望同一原图和同一精确宽度复用已有 Device Cache，从而重复浏览不会重复转码。
32. As a Smart Canvas 用户，我希望原图变化后使用新的预览身份，从而不会看到旧文件的缓存内容。
33. As a Smart Canvas 用户，我希望点开放大查看时直接看到原图，从而放大行为与“检查真实细节”的意图一致。
34. As an Image Studio 用户，我希望裁剪、画笔、缩放和切分始终基于原图，从而导出尺寸和细节不会被限制在 2048。
35. As an Image Studio 用户，我希望打开工作台时不会额外创建一份 1536 或 2048 WebP，从而减少首次打开详情的额外等待和后端处理。
36. As an Image Studio 用户，我希望切换图片时取消上一张原图的迟到加载，从而旧图片不会覆盖新选择。
37. As an Image Studio 用户，我希望关闭工作台后释放原图解码和编辑资源，从而连续查看多张大图不会持续增加内存。
38. As an Image Studio 用户，我希望原图损坏时看到明确的加载失败状态，而不是继续创建或显示 2048 代理图。
39. As an Image Studio 用户，我希望原图失败时不能提交像素编辑，从而系统不会生成看似成功但来源不可信的结果。
40. As a Prompt Authoring 用户，我希望只在打开 Prompt Authoring 时检查当前模型是否可用，从而提示与我的生成意图相关。
41. As a Smart Canvas 用户，我希望进入 Smart Canvas 时不会因为旧模型失效而弹错，从而可以先浏览和整理内容。
42. As a Smart Canvas 用户，我希望拖入媒体时不会检查无关的旧模型，从而导入动作不会产生误导性报错。
43. As a Prompt Authoring 用户，我希望失效模型在一次打开过程中只提示一次，从而不会被重复 Toast 打断。
44. As a Generation Run 用户，我希望真正提交生成时仍验证模型和 Generation Settings，从而减少主动检查不会削弱执行正确性。
45. As a realtime 协作者，我希望远景模式、Canvas Viewport 和标签避让都是本机视图状态，从而不会改变其他人的视角或产生 Canvas Mutation。
46. As a realtime 协作者，我希望性能展示优化不改变 Canvas Revision，从而 Canvas Sync 不会同步无意义的视图变化。
47. As a maintainer，我希望所有细节层级判断由一个统一模块负责，从而不会在不同 Node 渲染函数中散落缩放条件。
48. As a maintainer，我希望虚拟化只决定哪些 Node 需要物化，细节层级只决定这些 Node 物化到什么精度，从而两类优化职责清楚。
49. As a maintainer，我希望图片预览、原图和编辑源拥有明确不同的角色，从而代理图不会意外进入编辑输出。
50. As a tester，我希望用真实浏览器同时验证缩放、DOM、网络请求和提示时机，从而测试覆盖用户真正遇到的行为链。
51. As a release owner，我希望远景模式有可比较的资源计数和交互性能基线，从而“看起来更快”可以被客观验收。
52. As a product designer，我希望设置和交互保持简单，从而用户只需要理解一个远景阈值，不需要配置 Frame、Smart Group 和每种 Node 的多个阈值。

## Implementation Decisions

- 建立一个统一的 Canvas Level of Detail 深模块。它是 Canvas Viewport 缩放到展示精度的唯一决策入口，公开当前模式、进入阈值、退出阈值、稳定切换和资源请求代次；Node 渲染器不得各自散落 `scale < ...` 判断。
- Canvas Level of Detail 只拥有 `detail` 和 `far` 两个用户可感知状态。首版不增加中景、超远景或按 Node 类型配置的多级状态。
- 远景简化模式默认开启。用户配置的进入阈值范围为 10%–100%，默认 23%；退出阈值固定为进入阈值加 5 个百分点。Canvas Viewport 缩放位于回差区间时保持当前模式。
- 百分比直接映射 Canvas Viewport scale：`1 = 100%`。设置控件的 10%–100% 是合理配置范围，不是 Canvas Viewport 的完整缩放范围。
- 远景设置是设备/浏览器本地偏好，不写入 Workspace Data，不产生 Canvas Mutation、不进入 Undo、不增加 Canvas Revision，也不由 Canvas Sync 广播。
- 虚拟化和细节层级保持两个独立职责：虚拟化决定 Canvas Viewport Render Set，细节层级决定 Render Set 中的 Node 使用详细还是远景表现。
- Canvas Viewport Render Set 包含可视范围、一个合理的预加载范围和明确 pin 的 Node。Canvas Selection、Canvas Interaction、焦点、共享转场或其他必须维持身份的场景可以 pin Node。
- 刚离开 Render Set 的 Node 使用有界温 DOM 缓存。温缓存同时限制 Node 数量和仍挂载媒体数量；超过上限时优先释放最久未使用且未被 pin 的条目。
- Node 进入 Canvas Viewport 时必须先拥有稳定容器和占位，再异步升级媒体。图片解码成功后才原子替换显示源，失败不能清空仍然可用的上一档图片。
- 进入远景模式时立即停止不再需要的高精度升级，并通过请求代次忽略迟到结果。昂贵 DOM、播放器、画布和动态资源在稳定状态确认后释放，避免同一帧大规模同步销毁。
- 退出远景模式时先恢复可视 Node 的结构和低成本占位，再按 Canvas Viewport 距离渐进创建详细内容和升级图片。旧模式的异步结果不得覆盖新模式。
- 普通 Node 的远景表现保留边界、基础类型/状态、选择/悬停反馈和必要的 Connection 锚点；不创建富文本编辑器、表单控件、浮动工具、阴影、徽标、多图明细或不可读说明。
- 图片 Node 的远景表现最多挂载一张 512 预览。多图 Node 和 Smart Group 不在远景中创建完整图片网格。
- Smart Group 在远景中不挂载真实媒体；每项图片使用独立格子骨架和组件图标库的 `image` 图标，图标颜色与 Prompt 文本骨架一致。
- 视频 Node 的远景表现只允许一张 512 静态封面，不创建 `<video>` 播放器、不预加载视频内容、不自动播放；没有可用封面时显示轻量媒体占位。
- 音频 Node 的远景表现只显示组件图标库的 `audio` 图标，不创建 `<audio>` 播放器，并沿用详细模式音频 Node 的背景和边框。
- Pending Node 的远景表现保留原有渐变背景和边框，整张 Node 只绘制一个连续渐变表面，仅显示静态“正在生成图片”文字，不运行大面积持续动画。
- Prompt Node 和 Prompt Generation Node 的远景表现使用四行静态文本骨架占位符，骨架颜色为 `var(--ui-color-selected-hover)`，不创建正文、输入框、模型选择或生成按钮。
- Connection 在远景中保留拓扑可读性，但可以关闭阴影、细节标签和非必要装饰；选择或交互中的 Connection 保持命中与反馈能力。
- Frame 在远景中保留轻量边界。Smart Group 在远景中保留轻量外壳，但不创建完整成员内容。
- 新增独立的屏幕空间导航标签层，服务 Frame 和 Smart Group。标签使用约 12 px 的屏幕稳定字号，通过逆向缩放或等价布局抵消 Canvas Viewport 缩放。
- Frame/Smart Group 不提供不同的用户阈值滑杆。标签候选以屏幕边界至少 48 px 宽、28 px 高为默认显示门槛；选择或悬停目标不受该门槛限制。
- 标签碰撞时，选择/悬停目标优先，其次 Frame，最后 Smart Group；同一优先级内优先保留屏幕占地更大的结构。长名称使用单行省略，不通过扩大标签改变 Frame/Smart Group 几何。
- Smart Group 在详细模式也必须显示真实名称。没有用户名称时才显示“智能分组”等类型回退名；图片数量摘要不能替代名称。
- Canvas 图片性能优化继续使用 512、1024、2048 三个候选档，根据渲染长边、Canvas Viewport scale 和 device pixel ratio 计算屏幕所需物理像素。
- 图片档位保留升降级回差。离开可视/预加载范围但仍处于温缓存的图片降到 512；完全回收的 Node 不保留图片元素。
- `/api/media-preview` 继续采用按精确宽度惰性生成：缓存身份包含原文件路径、修改时间、文件大小和精确宽度。同一身份与宽度复用现有 Device Cache；原文件变化自然生成新身份。
- 产品文案不得声称“每张图片会创建三份 WebP”。正确表述是“Canvas 根据显示尺寸请求 512/1024/2048 档位；其他功能请求的其他精确宽度会形成独立缓存”。
- Image Studio 和放大查看不调用预览图生成作为正常打开路径。打开后直接使用经本地同源展示路径解析的原图。
- Image Studio 的可见预览和编辑计算共享一个原图资源会话。不得同时为同一打开动作创建 1536 和 2048 两份代理，也不得在隐藏编辑层重复解码一份独立原图。
- 原图资源会话使用 Node ID、媒体索引和请求代次识别当前选择。切换媒体、关闭 Image Studio 或打开另一项时取消/忽略旧请求，并释放可释放的解码、Canvas、ImageBitmap、视频和事件监听资源。
- 裁剪、画笔、缩放、切分、拼接和其他像素写入只接受原图就绪状态。显示代理、错误兜底或未知精度的图片不能静默作为输出底图。
- 原图加载失败后不请求 media preview 或其他代理图。界面必须显示“原图加载失败”状态并禁用像素编辑提交；下载原文件仍走原有原图路径。
- 原图本身小于或等于 2048 时，Image Studio 同样直接使用原图，不为了文件格式转换额外创建同尺寸 WebP。
- Canvas 中的预览缓存与 Image Studio 的原图会话是不同资源角色。前者优化多 Node 同时展示，后者保证单媒体检查和编辑真实性。
- 模型可用性的主动 UI 检查只由 Prompt Authoring 从关闭变为打开的入口触发。Canvas 初始化、Canvas Sync、Canvas Viewport、Canvas Selection、媒体拖入和普通 render 不得触发该 Toast。
- 如果 Prompt Authoring 打开时当前 Generation Settings 指向隐藏、关闭或不存在的模型，保持 Prompt Authoring 可用，标记当前选择失效并提示用户重新选择；同一次打开不重复提示相同失效模型。
- Generation Run 提交边界继续验证模型、Provider 和 Generation Settings。服务端或提交前安全验证不能因为减少主动 UI 检查而被删除。
- 远景简化、标签避让、Canvas Viewport Render Set 和 Image Studio 临时资源都属于客户端视图/会话状态，不改变 Smart Canvas 的 Node、Connection、Frame 成员、Smart Group 成员或 Workspace Data。
- 本规格不改变 Canvas Revision、Canvas Mutation、Canvas Sync、Canvas Interaction 提交语义或多人权限。
- 实现必须提供脱敏诊断快照：当前 LOD、阈值、Render Set 数量、实际挂载 Node 数、温缓存 Node/媒体数、按精度统计的图片数、视频元素数和最近一次物化耗时。不得记录媒体内容、Prompt、凭据或完整 URL。
- 不使用长期双实现开关。远景模式的用户开关控制产品行为；内部旧的散落缩放判断在迁移完成后删除。

## Testing Decisions

- 使用一个最高层 Smart Canvas 实浏览器行为接缝作为主要验收入口。该接缝加载包含普通图片、视频、多图 Node、Prompt Node、Smart Group、Frame、Connection 和失效模型设置的代表性 Smart Canvas，并通过公开 UI、DOM、网络请求、Canvas Viewport 和诊断快照观察行为。
- 好测试只断言用户可观察行为和公开诊断结果，不依赖私有 helper 名称、内部计时器变量、具体 DOM 拼接函数或 CSS 实现方式。
- 主要浏览器测试必须能真实改变 Canvas Viewport scale、等待稳定状态、拦截 `/api/media-preview` 和原图请求、打开/关闭 Image Studio、拖入媒体、打开 Prompt Authoring，并捕获 console error、page error 与 unhandled rejection。
- 现有 `smart_canvas_viewport_model_validation_browser_smoke.cjs` 是视口图片稳定性和失效模型提示时机的直接先例；实现可以扩展它或迁移为新的统一 LOD/资源浏览器验收，但避免创建多个互相重叠的端到端接缝。
- 现有 `smart_canvas_virtualization_smoke.cjs` 和 `test_smart_canvas_virtualization.py` 是 Render Set、DOM 身份保持、pin、Connection 可见性和诊断统计的先例。
- 现有 `test_smart_canvas_annotation_ui.py` 中自适应图片测试是 512/1024/2048 选择逻辑的先例。
- 如果 Canvas Level of Detail 的纯状态机在浏览器测试中难以穷举，可以增加一个无 DOM 的确定性测试，但它只验证阈值、5 个百分点回差和迟到请求代次；不得复制 Node 渲染行为。
- 默认阈值测试验证：22% 进入远景，23% 边界不产生抖动，23%–28% 保持已有模式，29% 进入详细；重复在 22%/24% 小幅变化时不反复切换。
- 自定义阈值测试至少覆盖 10%、50%、100%，并验证退出阈值始终为进入阈值加 5 个百分点。
- 使用当前 Canvas Viewport 真实比例语义验证：约 14% 的全览进入远景，约 115% 的 Node 聚焦处于详细模式；不得把 100% 当作 Canvas Viewport 最大值。
- 验证远景普通 Node 不创建富控件、多图网格和视频播放器；图片最多一张且请求宽度为 512；详细模式只为可视/预加载范围恢复资源。
- 验证生成中 Node 在远景只保留一个铺满 Node 的连续渐变表面和边框，唯一可见状态文字为“正在生成图片”；Prompt Node 和 Prompt Generation Node 均显示四行 `var(--ui-color-selected-hover)` 文本骨架，不创建文本编辑或模型控件。
- 通过真实双击远景图片验证 Image Studio 进入预览模式；不得只调用内部打开方法绕过用户交互。
- 验证从详细进入远景时高精度迟到请求不能覆盖 512；从远景进入详细时旧的释放任务不能销毁新资源。
- 连续快速缩放和平移至少循环 100 次，验证 Canvas Viewport 内图片不变成空 `src`、破损状态或错误 Node 内容；测试应能在回归出现时稳定失败。
- 验证短暂移出再返回的 Node 保持 DOM 身份或稳定可见内容；超过温缓存边界的 Node 最终释放；选中、交互和显式 pin 的 Node 不被回收。
- 验证 Render Set、实际挂载 Node、温缓存 Node/媒体数量均受配置上限约束，不随往返平移持续增长。
- 验证远景视频 Node 为静态封面且没有 `<video>`；退出远景后只有可视视频按现有用户播放规则创建播放器。
- 验证远景 Smart Group 为每项图片显示独立格子骨架和 `image` 图标，不挂载真实图片；远景音频只显示 `audio` 图标且没有 `<audio>`，背景和边框与详细模式一致。
- 验证 Frame 和 Smart Group 标签在不同 Canvas Viewport scale 下保持约 12 px 屏幕字号，不随世界缩放变成不可读尺寸。
- 验证屏幕边界小于 48×28 px 的未选择结构默认隐藏标签，选择/悬停后显示；标签碰撞时 Frame 优先于 Smart Group。
- 验证 Smart Group 在详细模式显示真实名称而不是只显示媒体数量；没有名称时显示类型回退名。
- 验证 Canvas 图片在所需物理像素跨越档位时请求 512、1024、2048，并在回差区间内保持当前档位。
- 后端媒体预览测试验证任意精确宽度可惰性创建、同一原图/身份/宽度重复请求复用同一文件、原图修改后得到新身份；不得断言每张原图固定只有三份缓存。
- 打开 Image Studio 的网络断言必须为：正常路径不请求 `w=1536` 或 `w=2048` media preview，直接请求原图；同一媒体切换过程中只有当前原图结果可以进入可见和编辑状态。
- 验证一张超过 2048 的原图打开后，裁剪、画笔和切分使用原始 natural dimensions，而不是 2048 代理尺寸。
- 验证用户在打开 Image Studio 后立即切换编辑模式，原图未就绪时不能提交受限输出；原图就绪后提交保持原始尺寸语义。
- 验证原图加载失败时不请求 `w=2048` 或其他 media preview，界面显示原图失败状态，且像素编辑提交被禁用。
- 验证连续切换多张大图并关闭 Image Studio 后，旧请求不会覆盖当前图片，图片元素、Canvas、播放器和可释放解码资源回到约定上限。
- 验证进入 Smart Canvas、平移缩放、选择 Node 和拖入媒体时均不出现“模型已不可用”提示，也不执行主动模型可用性检查。
- 验证打开 Prompt Authoring 后，失效模型只提示一次并要求重新选择；关闭再打开可以重新检查最新模型列表。
- 验证有效模型打开 Prompt Authoring 不产生错误；Prompt Authoring 打开期间选择新模型后提示消失。
- 验证 Generation Run 提交时服务端拒绝已经失效的模型，即使主动提示只发生在 Prompt Authoring 打开时。
- 使用代表性大型 Smart Canvas 记录详细模式和远景模式的 DOM 数、图片档位、视频元素、布局/物化耗时、长任务和交互帧。远景模式必须显著减少昂贵元素；同一约定机器和 fixture 的关键指标不得比认可基线恶化超过 20%。
- 性能结果必须报告 fixture Node/Connection/Frame/Smart Group/媒体数量、Canvas Viewport scale、DPR、浏览器版本和冷热缓存状态，避免只报告不可复现的主观感受。
- 所有浏览器验收中 console error、page error、unhandled rejection 和 Canvas Viewport 内破损图片数量必须为零。

## Out of Scope

- 不实现 `2026-08-20-canvas-mutation-single-node-move-fast-path-spec.md` 已规划的多人单 Node 移动服务端快速通道。
- 不改变同一 Smart Canvas 的 Canvas Revision 排队、Canvas Sync、WebSocket 广播或多人冲突规则。
- 不为 Frame、Smart Group、图片 Node、视频 Node 分别提供多个用户可配置缩放阈值。
- 不在首版增加中景、超远景、语义缩放曲线编辑器或按 Node 类型自定义 LOD。
- 不改变 Smart Canvas 的最小 2% 和最大 800% Canvas Viewport 能力。
- 不改变 Node、Connection、Smart Group 或 Frame 的 Workspace Data schema。
- 不把 Canvas Viewport、远景模式临时状态或导航标签位置保存进 Workspace Data。
- 不改变 `/api/media-preview` 的现有缓存身份算法、WebP quality、PIL/ffmpeg 生成流程或 Device Cache 目录边界。
- 不在本规格中设计 Device Cache 磁盘清理、容量配额或旧身份文件回收策略；该问题需要独立规格，因为它涉及长期缓存保留策略。
- 不删除 Canvas 使用的 512/1024/2048 自适应预览能力。
- 不为 Image Studio 增加手动“代理图/原图”画质切换；Image Studio 只使用原图，原图失败时直接进入失败状态。
- 不改变视频详情播放、视频帧提取或全景预览的业务能力，但这些资源必须遵守打开/关闭生命周期。
- 不改变 Provider 模型列表的隐藏/关闭管理方式。
- 不取消 Generation Run 提交边界的模型和 Generation Settings 安全校验。
- 不处理与本规格无关的 Canvas List、Asset Library、外部编辑器或生成 Provider 性能。
- 不引入移动端布局适配。

## Further Notes

- 当前 Canvas Viewport scale 语义已经核实为 `1 = 100%`，代码允许约 2%–800%。真实 Smart Canvas 全览测得约 14.4%，聚焦一个 Node 后约 115%，因此 0%–100% 不能被描述成完整缩放范围，但 10%–100% 适合作为远景进入阈值的设置范围。
- 默认 23% 贴近当前大型 Smart Canvas 从局部编辑切换到整体导航的实际观察区间；固定 5 个百分点退出回差用于产品可预期性，不作为第二个用户设置。
- `/api/media-preview` 已通过受控精确宽度请求验证：首次请求会创建对应精确宽度文件，重复同一请求复用相同文件且不修改文件时间。512/1024/2048 是主要 Canvas 候选，不是全产品缓存数量上限。
- 现有 Smart Canvas 还会因缩略图和视频封面请求 256、768、1536 等精确宽度。Image Studio 不请求这些预览，其他功能仍可按自身显示尺寸请求预览。
- 冷缓存创建 2048 WebP 不一定比直接看原图更快：服务端必须先解码原图，再缩放、编码和写盘。缓存命中后，2048 对超过 2048 的大图可以降低浏览器解码和显卡纹理成本；该收益应留在多 Node Canvas 展示，而不是强加给单图详情。
- 一张 3840×2160 图片按 4 bytes/pixel 解码约占 31.6 MiB，缩到约 2048×1152 后约占 9 MiB。性能收益主要来自像素尺寸变小，而不只是文件扩展名为 WebP。原图本身不超过 2048 时，重新编码通常没有解码内存收益，反而增加首次转码和有损质量成本。
- Smart Group 当前近景只显示媒体数量、不显示真实名称，是独立于远景模式的导航缺口。本规格将真实名称作为详细与远景模式的共同要求。
- Frame 的画布尺寸差异可能达到数倍，同一 Canvas Viewport scale 下的屏幕占地完全不同，因此使用屏幕边界和碰撞比 Frame/Smart Group 各自固定百分比更可靠。
- 主要验收接缝已经得到用户同意：使用一个最高层 Smart Canvas 浏览器行为测试同时覆盖 LOD、导航标签、资源请求与释放、Image Studio 原图和 Prompt Authoring 模型检查；多人 Canvas Mutation 性能继续使用现有独立规格和测试。
- 本规格不要求用户理解 DOM、图片解码或 Device Cache。面向用户的语言保持为：“远景时简化内容以保持流畅；点开放大查看或进入 Image Studio 时查看原图。”

验收完成时应满足以下摘要：

1. 约 14% 全览进入远景，约 115% 聚焦保持详细，阈值附近不抖动。
2. Canvas Viewport 内图片在连续平移缩放中不消失、不破损。
3. 远景不创建视频播放器、富控件或完整多图网格，图片最多使用 512。
4. Frame/Smart Group 名称在屏幕上可读、避让合理，Smart Group 近景显示真实名称。
5. Image Studio 正常打开只读取原图，不创建 1536/2048 WebP，所有像素编辑保持原始精度。
6. 原图失败时不请求 2048 兜底，明确显示加载失败并禁止提交像素编辑。
7. 只有打开 Prompt Authoring 才主动提示失效模型；进入 Smart Canvas 和拖入媒体不提示。
8. 所有行为保持客户端本地，不产生 Canvas Mutation 或 Canvas Revision。
9. 大型 fixture 的资源计数和交互指标通过基线验收，浏览器错误与破损图片为零。

## Implementation and Acceptance Record

- 实施状态：`completed`
- 人工验收：用户于 2026-08-20（Asia/Shanghai）确认“验收通过”。
- 规格边界：本次没有实现或修改多人单 Node 移动快速通道；该能力继续由关联 active 规格独立推进。
- 远景简化：默认进入阈值为 23%，退出阈值为 28%，用户可在 10%–100% 范围内调整进入阈值。
- 远景表现：图片最多保留一张 512 预览；视频不挂载播放器；音频不挂载原生控件并保持原节点宽高、背景和边框；Pending Node、Prompt Node、Prompt Generation Node 和 Smart Group 使用已确认的轻量占位。
- 导航：Frame 和 Smart Group 使用屏幕空间标签，保持可读字号并按选择、Frame、Smart Group 的顺序处理碰撞优先级。
- 图片资源：Canvas 使用 512/1024/2048 自适应预览；Image Studio 和放大查看直接使用原图；原图失败后不请求 2048 兜底并禁止像素编辑提交。
- 模型检查：仅在 Prompt Authoring 打开时主动检查失效模型，Generation Run 提交边界继续执行必要校验。
- 组件入库：UI 组件库新增“空状态 / Empty states”，收录正在生成图片、提示词文本骨架、Smart Group 图片格、音频占位和视频占位五类样本，直接复用 Smart Canvas 真实样式。

### Automated verification

- `tests/smart_canvas_viewport_model_validation_browser_smoke.cjs`：真实 Chrome 验收通过；覆盖远景切换、媒体挂载、双击预览、原图失败、模型检查时机、100 次快速缩放平移、温缓存上限和删除反馈。最终删除反馈为 19 ms，温缓存 Node/媒体均保持在 8 个上限内。
- `tests/component_surfaces_browser_smoke.cjs`：真实 Chrome 验收通过；“空状态”五类样本全部可见，音频 Node、内容区域和占位区域尺寸一致，背景渐变与 1 px 边框保留，样本未挂载 `<audio>` 或 `<video>`。
- `tests.test_smart_canvas_level_of_detail`、`tests.test_image_studio_uiremake_redesign`、`tests.test_t35_generation_pending_migration`：28 项测试通过。
- `tests.test_ui_component_library_page`、`tests.test_infinite_canvas_ui_component_surfaces`：35 项测试通过，1 项仅在无本机浏览器环境下跳过；对应真实 Chrome smoke 已单独通过。
- 所有上述浏览器验收的 console error、page error 和 unhandled rejection 均为零。
