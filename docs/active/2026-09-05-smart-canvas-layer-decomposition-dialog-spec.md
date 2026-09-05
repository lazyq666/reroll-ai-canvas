# Smart Canvas 智能分层 Dialog：提示词草稿与区域框选

- **Status**：Implemented（本地实现与确定性回归通过；真实 Provider、触摸及双客户端协作 Gate 待验收）
- **Feature ID**：F05；关联 F07 / F08 / F09
- **Owners**：产品 / UI / 交互 / 前端 / 后端 / 测试
- **Last verified**：2026-09-05；页面交互与请求替身回归、坐标及草稿合同、分层后端回归通过；验证详情见第 15 节
- **Applies to**：智能分层 Dialog 后续迭代，目标发布版本待实施时确定；关联 [Issue #38](https://github.com/lazyq666/reroll-ai-canvas/issues/38)
- **Supersedes**：无；通过验收前不覆盖 Current。计划扩展[当前生成链路](../current/generation-pipeline.md#44-智能分层的专用交付)与[UI 指南](../current/ui-design-guidelines.md)中的分层入口行为
- **Superseded by**：无
- **Related ADRs**：[Workspace 数据边界](../adr/0001-workspace-data-boundary.md)、[UI 家族模块所有权](../adr/0002-ui-family-module-ownership.md)、[统一模型能力目录](../adr/0009-unified-model-capability-catalog.md)
- **Domain terms**：Smart Canvas、Image Node、Layer Decomposition Node、Prompt Authoring、Canvas Mutation、Canvas Sync、Workspace Data、Provider、Model Operation、Generation Run

## 1. 一页摘要

创作者从原图进入智能分层后，可以使用“智能识别”选择预设或编写自定义要求，也可以使用“区域框选”直接在原图上标出需要分离的目标。提示词随原图节点保存，再次进入同一张原图的分层 Dialog 时恢复。

本次用户明确要求：保存输入过的提示词；调研 Seedream 5.0 Pro 的官方要求和社区拆层建议，整理为三至四个预设；Dialog 仅保留智能识别、区域框选两种模式；智能识别的选项下面显示输入框，并提供自定义；区域框选取得原图坐标并自动生成拆层提示词；框选实现前先查找已有项目并同步方案。

用户在本规格整理后明确要求开始实现。本次采用四个可编辑预设、Cropper.js 2、关闭时保存未执行草稿，并保存模式和选框。附件三张截图仅作为视觉参考：图一提供粒度文案，图二提供模式切换外观，图三提供带编号、多矩形和控制点的选框外观。图二中的第三项“自然语言”不进入本次目标设计。

## 2. Problem Statement

- 用户已经写过拆层要求，重新打开原图时仍要重写，无法围绕同一张图反复调整。
- 单一空输入框缺少常见分层场景的起点，用户需要自行摸索提示词。
- 仅描述“上方文字”“左侧便签”容易产生定位歧义；复杂图片需要可见的区域定位方式。
- 原图像素、Dialog 预览像素与模型坐标不相同，直接发送鼠标位置会导致定位错误。

实施前基线：公共 Dialog 打开时重置分层提示词；来源节点没有分层草稿回填。已有任务记录中的 prompt 用于任务执行，不等于原图节点的可编辑草稿。

## 3. Goals / Non-goals

### Goals

- 同一原图的分层要求能恢复，且不同原图之间不会串用。
- 智能识别提供四个可编辑选项，不额外设置自定义入口。
- 用户拖动即可创建多个矩形框，调整后自动更新发送给模型的坐标提示词。
- 预览缩放、窗口变化、切换模式和重新打开不会改变原图上的目标位置。
- 明确模型输入与输出的边界，并以真实拆层样例验证提示词质量。

### Non-goals

- 不扩展为完整图层编辑器，不新增多边形、自由画笔蒙版、OCR 可编辑文字或自动目标检测服务。
- 不改造 PSD 导出、分层结果节点和既有生成任务恢复机制。
- 不保证恢复原始 PSD、严格输出指定层数、逐像素无损或沿矩形边界裁切。
- 不自动执行生成、批量尝试提示词或创建全局提示词历史库。
- 实现与确定性测试不自动发起真实付费模型任务；模型效果由单独 Gate 验收。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Administrator / Designer | 对当前 Smart Canvas 有编辑权限 | 保存原图分层草稿；按可用能力提交分层 | 绕过模型能力、来源媒体或服务端授权校验 |
| Guest Account / Anonymous Share Visitor | 既有只读访问条件成立 | 沿用当前浏览能力 | 编辑草稿、操作可提交的选框或发起生成 |

保存草稿与执行生成均继承当前 Canvas 权限。打开期间失去权限时停止新提交，按 Canvas Sync 既有规则处理未确认修改，不显示虚假的保存成功。

## 5. User stories

1. 我为一张海报写过分层要求，再打开同一原图时希望继续编辑原来的内容。
2. 我希望先选择主体与背景、海报三组或逐对象拆层，再按当前图片调整提示词。
3. 我希望框住标题或便签，通过具体位置说明要拆分的目标。
4. 我希望在两种模式间比较方案，切回时仍保留之前的文字和选框。
5. 我关闭 Dialog、刷新画布或遇到生成失败后，希望已保存的草稿仍在。
6. 我希望替换原图后不会误用旧图的选框，也不会在编辑输入框时意外删除选框或画布节点。

## 6. User journey and interaction contract

### 6.1 入口、布局与退出

- 沿用原图的“智能分层”入口和 Large `ic-ai-processor-dialog`。
- 桌面左侧完整显示原图，右侧为参数；窄屏按原图、参数上下排列。
- 模式切换仅两项：“智能识别 / Smart recognition”和“区域框选 / Region selection”。两种模式共用模型、分辨率和原有参考价格展示。
- 首次打开默认智能识别及自动判断；已有草稿时恢复上次模式及相应内容。仅打开、恢复和关闭未改变的草稿不构成 Canvas Edit。
- 关闭按钮及非手势中的 Escape 关闭 Dialog；关闭取消本次执行意图，但保留已编辑草稿。不会隐式创建 Generation Run。
- 点击“开始分层”时冻结本次来源、提示词和设置，沿用当前 Pending Node、Generation Run 与结果交付流程。

### 6.2 智能识别

识别粒度和分层输出分辨率均使用 `ic-segmented-control`。粒度只提供四个选项，不再提供自定义选项，也不显示粒度解释文字。选项直接展示，长文案允许换行。输入框始终位于粒度选择器下方；选择预设时显示其完整文字，允许修改。

分别保留各选项的编辑草稿：首次选择自动判断时提示词留空；首次选择其他预设载入预设文本，再次选择恢复该选项上次编辑的文本；用户直接编辑当前选项下方的输入框；旧的自定义草稿回填为自动判断下的编辑稿，原始自定义文本仍保留用于兼容。切换选项不会销毁刚编辑的内容。预设被编辑后仍保留原选项身份及已编辑状态，不自动切走或重置。空提示词仅在“自动判断”下解释为使用模型默认识别；其他选项的空文本要求用户补充或改选自动判断。

### 6.3 区域框选

- 在图片未被选框覆盖的区域按下并拖动，松开后创建一个矩形；可连续创建多个矩形。普通点击不生成零面积框。
- 每框显示编号；点击选框后可移动，四角及四边共八个控制点可缩放。图片只作原图预览，不实际裁切。
- 提供“添加区域 / Add region”动作：用于创建与已有框重叠的初始框，也为键盘用户提供数字调整入口。新框默认置于原图中心，尺寸为宽高各 25%；添加后焦点进入图片编辑区。
- 选框可重叠，不自动合并；每框具有稳定内部身份，显示编号按列表顺序排列，删除后连续编号。
- 提供选中区域的删除、清空全部区域，以及原图像素位置和尺寸的数字输入。通过区域列表可切换当前区域。
- 提供每区域可选的目标描述，例如“仅标题文字”或“整张便签”；未填写时使用“区域 N 内的目标内容”，不自动调用识别模型。
- 下方显示自动生成的提示词预览，并提供可编辑的补充要求。坐标段由选框控制，不直接编辑，避免提示词与选框形成两个不同的坐标来源。
- 原图尺寸未确定、没有有效框或坐标无效时不允许以框选模式提交。原图加载失败保留已有草稿并支持重试。

### 6.4 可观察状态

| State | User sees | Allowed actions / recovery |
| --- | --- | --- |
| loading | 原图加载状态；已有文字草稿可读 | 图片与尺寸确定后启用框选；失败可重试 |
| ready-intelligent | 当前预设、自定义文本及合法参数 | 编辑、切换模式、关闭、提交 |
| ready-regions | 原图、编号框、区域列表和实时提示词 | 增删、移动、缩放、编辑描述或补充要求 |
| no-regions / invalid | 缺少区域或具体参数错误 | 修正后提交；保留文字和其他有效框 |
| no-models | 当前分层模型空状态 | 保留草稿；配置模型后重新校验 |
| submitting | 提交反馈；执行按钮不可重复触发 | 沿用已有任务提交与关闭策略 |
| failure | 具体失败原因 | 草稿保留；按现有任务恢复合同继续或显式重试 |
| offline / recovering | 当前 Canvas Sync 的未确认反馈 | 保留待同步修改；恢复后确认，不能声称已持久保存 |
| source-invalid / forbidden | 来源已删除、替换或权限失效 | 禁止旧上下文继续提交；重新进入有效原图 |

### 6.5 输入、焦点和主题

- Tab 可以遍历模式、参数、粒度、输入框、区域列表及动作；模式及粒度遵循公共单选控件键盘行为。
- 区域拥有焦点时方向键微调，Delete 删除选中区域；这些快捷键不向底层画布传播。文本或数字输入拥有焦点时保持其编辑语义。
- 绘制、移动或缩放中按 Escape 只取消本次手势并恢复开始状态；没有活动手势时才关闭 Dialog。
- Pointer 手势在结束时形成一次可保存修改，取消的手势不进入持久化或撤销记录。
- Light/Dark、桌面和 390px 窄屏均需验收；选中边界、编号、控制点在明暗图片上可辨认，不能只靠颜色表达选中状态。
- 触摸拖动仅作用于图片编辑区，参数区域保持正常滚动；触控行为须实测，不凭依赖声明判定通过。

## 7. Functional rules

### 7.1 候选预设

以下为基于公开范例编写的项目候选，不是模型硬规则，也不是已经实测的“最佳提示词”。“三组”和“每个物体”表达用户期望，不能作为保证返回层数的承诺。

| ID / 选项 | 简述 | 中文预设 |
| --- | --- | --- |
| `auto` 自动判断 / Automatic | 由模型默认识别，不自动添加提示词 | 留空；用户主动输入的文字仍按草稿保存。 |
| `subject-background` 主体 / 背景 / Subject / background | 主体整体与背景分别编辑 | 将前景主体整体提取为一个独立透明图层，其余内容保留在背景底图中。主体的附属细节保留在同一层，补全被主体遮挡的背景，保持原有构图与外观。 |
| `text-subject-background` 文字 / 主体 / 背景 / Text / subject / background | 适合海报与封面 | 按三组分离：文字与排版图形为一组，主要人物或产品为一组，其余场景为背景。保留文字内容、字体外观、元素相对位置与配色；补全移除前景后的背景。 |
| `objects` 每个物体独立 / Separate objects | 主要物体分别成层 | 将图中可独立编辑的主要人物、产品、道具和装饰逐个拆为透明图层，同一物体的附属细节保留在一起。文字按完整文本块分组，其余保留为背景并补全遮挡区域。 |

对应英文预设草案：

| ID | English prompt |
| --- | --- |
| `auto` | Empty by default; no generated prompt. |
| `subject-background` | Extract the foreground subject as one transparent layer and keep the remaining content in the background. Keep details belonging to the subject together. Reconstruct the obscured background and preserve the original composition and appearance. |
| `text-subject-background` | Separate the image into three groups: text and layout graphics; the main people or products; and the remaining background. Preserve the wording, lettering, relative positions, and colors. Reconstruct the background behind the foreground elements. |
| `objects` | Extract each main person, product, prop, and decorative object into a separate transparent layer. Keep details belonging to the same object together, and group text into complete text blocks. Keep the remaining scene as the background and reconstruct obscured areas. |

模型当前元素层上限为 16，属于 Provider 能力边界，不在通用预设中写死其他模型的限制。官方中文 300 字、英文 600 词是提示词写作建议，不自动截断用户内容。实际请求限制由精确模型能力及渠道校验决定。

### 7.2 坐标合同

1. 坐标以实际提交的原图为参照；左上为原点，x 向右、y 向下。去除预览留白和容器偏移，并逆变换显示缩放后得到原图位置。
2. 原图尺寸为 `W × H`，框以 `left, top, right, bottom` 的几何边界表示，限制在 `[0,W] × [0,H]`，且 `left < right`、`top < bottom`。这不是输出图层文件尺寸的约定。
3. 持久化保留原图空间的精度；界面可显示整数像素，不反复用显示值覆盖内部值。生成 Seedream 标签时使用 `round(1000 × x / W)`、`round(1000 × y / H)` 并约束到 `0–1000`。
4. 归一化后如左右或上下端点重合，提示用户扩大选框，不能提交无效 bbox 或静默改变用户区域。
5. 示例：原图 `2000 × 1000`，框 `(200,200)–(1600,400)` 对应 `<bbox>100 200 800 400</bbox>`。
6. 框表示目标所在区域；描述指定要分离的内容。同框里的“仅文字”和“整张便签”有不同意图。不能把 bbox 当成像素蒙版或要求模型严格沿框裁切。
7. 上游结果按其实际返回的 Manifest / bbox 定位，不强行套用输入框位置或假设输入框与输出层一一对应。

### 7.3 自动提示词

```text
将图片进行精确图层分离，需分离的坐标为：
区域 1（{可选目标描述}）<bbox>{left1} {top1} {right1} {bottom1}</bbox>、
区域 2（{可选目标描述}）<bbox>{left2} {top2} {right2} {bottom2}</bbox>。
将各区域内描述的目标分别提取为独立图层，保留相对位置，并补全移除目标后的背景。
{用户补充要求}
```

所有占位符均由当前草稿确定；无描述时省略括号。英文模板表达相同含义，保持 `<bbox>`、数字和区域顺序不变。坐标只从结构化区域生成，描述及补充要求不能被反向解析为权威选框。

### 7.4 i18n

全部可见文案、预设、模板、提示、错误、动态编号和可访问名称进入共享中英文资源，使用 `data-i18n-*`、`tr` / `trf` 等现有机制。尚未编辑的预设可跟随语言切换；用户编辑过的文本、自定义内容和目标描述必须原样保存，不翻译、不覆盖。自动坐标模板按当前语言重新生成，坐标值不变。

## 8. Domain and state model

“分层草稿”是原图 Node 的创作配置，不引入新的 Node 类型，不等同于任务记录、Prompt Library 或当前 Canvas Selection。一个源节点可能包含多个媒体，因此草稿关联“来源节点身份 + 稳定媒体身份”，不能仅依赖可变的图片数组下标。

草稿包含版本、当前模式、当前预设、各预设编辑文本与编辑状态、兼容旧自定义文本，以及框选模式的源图尺寸、区域身份/几何/目标描述和补充要求。实现字段为 `sourceNode.layerDecompositionDrafts[mediaKey]`。版本 1 保存 `mode`、`preset`、`prompts`、`sourceWidth/sourceHeight`、`regions` 和 `supplement`；只有编辑过的预设进入 `prompts`。媒体键优先使用 `media_id` / `output_media_id` / `asset_id`，否则使用本地引用或移除已知签名参数的 URL。

尚未结束的鼠标手势和当前焦点属于本地交互状态。草稿修改经既有 Canvas Mutation / Canvas Sync 保存；提交生成时使用冻结快照，后续编辑草稿不修改已开始的 Generation Run。

## 9. Data and persistence

| Data | Authority / boundary | Retention / recovery |
| --- | --- | --- |
| 分层文字、模式与选框 | 来源 Node 的 Canvas 数据；Workspace Data | 随 Canvas 保存、备份和恢复；重新进入同一原图回填 |
| 手势、焦点、当前选框高亮 | 当前浏览器交互状态 | 不作为共享内容持久化 |
| 实际执行提示词与来源快照 | 现有 Generation Run | 沿用任务历史及恢复合同，不充当可编辑草稿 |
| 框选组件与图片预览 | 可再生展示 | 不拥有草稿权威，不提交带框截图 |

- 文本输入防抖保存；失焦、切换模式、关闭、点击执行时收拢未提交修改。不能只在点击执行时保存，也不能仅写浏览器 localStorage。
- 保存失败或尚未同步时使用当前 Canvas Sync 反馈和恢复能力；持久恢复承诺以已确认保存为准。
- 原图 Node 复制时携带草稿，复制后各自独立；删除及 Undo/Redo 沿用现有 Node 内容合同，不因草稿操作创建结果节点。
- 替换媒体后旧草稿不自动套用新媒体；旧媒体及尺寸不匹配的选框不能显示为有效。仅预览 URL 变化而稳定媒体身份未变时仍应恢复。
- 多人编辑通过既有字段级冲突机制处理；不同 Node 的草稿互不覆盖。同一草稿不得用关闭时的过期整份 Node 覆盖远端修改；Dialog 以打开时基线做三方合并；文字字段分别合并，区域数组作为一个字段处理。冲突时保留本地输入，禁止覆盖已保存内容，并提供明确的“放弃未保存修改并关闭”恢复动作；双客户端端到端一致性仍需单独验收。
- 旧画布无草稿时按首次打开处理，不触发批量迁移写入，也不从历史任务任意猜测草稿。

## 10. API / WebSocket / Provider contracts

| Contract | Caller | Observable result | Errors / recovery |
| --- | --- | --- | --- |
| 保存草稿 | Canvas Mutation / Canvas Sync | 来源 Node 获得可恢复的创作配置 | 权限、Revision、断网按现有合同处理 |
| 分层提交 | 已有分层任务入口 | 单张原图 + 当前模式最终 prompt + 合法分辨率，创建一个 Generation Run | 不重复自动提交付费任务；保留草稿 |
| Seedream 区域编译 | 已确认支持该坐标语法的渠道适配 | 原图空间范围转为 0–1000 bbox 提示词，使用专用分层操作 | 未确认坐标语法的模型不能默认为支持框选 |
| 结果交付 | 现有分层任务链路 | 按真实 Manifest 创建一个 Layer Decomposition Node | 失败、部分结果及恢复沿用当前生成链路 |

计划复用既有 API，不因 UI 框选新增公开端点。`image.layer_decomposition` 与 `layer_decomposition: true` 的映射继续属于 Provider Adapter。不同 Provider 的坐标能力不能仅依据模型名称推断；缺少依据时禁用框选提交并解释原因，智能识别可继续使用其已确认能力。

## 11. Security and privacy

沿用现有媒体读取、Canvas 编辑和生成授权。草稿不保存凭证或带秘密的渠道配置，提示词按文本显示，目标描述不能注入 HTML。提交实际原图及用户要求；白框、控制点和编号不烧录入原图，也不自动把图片发送给额外检测服务。

## 12. Performance and reliability constraints

- 拖动和缩放本地实时反馈；手势结束才提交几何，不逐帧保存或调用模型。
- 移动一个框不重新下载图片、不重建整个 Dialog、不丢失输入焦点。
- 当前 Seedream 方案建议最多 16 个有效区域，与已核验的元素层上限协调；达到上限时解释原因，不静默丢弃第 17 个框。第 17 个区域被明确拒绝。
- 控件销毁、模式切换和关闭后释放事件与观察器；反复打开不累积选框实例。
- 所有网络超时、未知提交结果、恢复和幂等沿用现有 Generation Run / Canvas Sync 合同，不新增自动重试生成策略。

## 13. Design system contract

沿用 `ic-ai-processor-dialog`、公共模式单选控件、`ic-select`、分辨率与粒度 `ic-segmented-control`、`ic-textarea` / `ic-form-field`、`ic-icon-button` 和现有 Token。模型筛选、分辨率能力与参考价格保持当前责任。

现有公共表单控件不能提供同图多矩形编辑；框选需引入已实现的几何交互组件并适配项目视觉。编号、控制点、Focus、不可用反馈遵守项目 UI 规范，主题不能通过全局样式覆盖其他 Dialog。规格通过真实页面验证后才更新 Current UI 指南。

## 14. Implementation decisions

- **采用 Cropper.js 2.2.0**：已有 multiple、movable、resizable、keyboard 及边缘控制点，项目负责区域列表、编号、草稿与坐标编译。依据见[调研记录](../archive/2026-09-05-seedream-5-pro-layer-prompts-research.md)。已核验 MIT 许可证；固定 ESM 与 LICENSE 位于 `static/vendor/cropperjs/2.2.0/`，无需运行时 CDN。
- **备选 Annotorious**：若 Cropper.js 在重叠框、键盘或组件生命周期验证中不能满足合同，再评估替换；不能未经调查直接改为手写拖动缩放引擎。
- Dialog 负责交互与草稿事件；Smart Canvas 负责来源身份、保存、恢复、权限与任务提交；Provider 相关模块负责确认坐标语法及请求转换。公共 UI 不拥有 Canvas 存储或 Provider 凭证。
- 自动生成坐标段与可编辑补充要求分开，原图空间区域为唯一坐标来源。预设文本集中维护，不能在多个页面分别复制硬编码。

## 15. Acceptance and testing

### 15.1 自动化验收

最高接缝为真实 Smart Canvas 页面 + Canvas 保存/重新加载 + 分层提交请求；模型请求可使用确定性替身，不能仅检查源码字符串。几何编译另用纯函数测试验证数值。

| ID | Scenario | Expected external behavior |
| --- | --- | --- |
| A01 | 输入文字后关闭，再打开同一原图 | 文本和模式恢复，未产生生成任务 |
| A02 | 保存确认后刷新或重新打开画布 | 提示词、预设编辑状态及选框恢复 |
| A03 | 不同 Node、同 Node 不同媒体、媒体重新排序 | 各自草稿正确，不按旧下标串用 |
| A04 | 四个预设、编辑输入、两种模式反复切换 | 当前选项正确，用户文字与另一模式草稿不丢失 |
| A05 | 中英文切换 | 所有 UI 和自动模板切换；用户文本、坐标保持 |
| A06 | 绘制两框、移动、八向缩放、重叠、新建、删除、清空 | 几何、编号、列表及提示词同步；至少一有效框才可提交 |
| A07 | 不同宽高原图、contain 留白、窗口变化、显示缩放 | 同一原图区域生成相同 bbox；第 7.2 节示例精确成立 |
| A08 | 反向拖动、越界、零面积及归一化后退化 | 正确归整或明确拒绝；无非法 bbox、无静默目标偏移 |
| A09 | 添加区域、键盘微调/删除、输入中 Delete、手势中 Escape | 控件操作正确，输入保留编辑语义；底层画布不响应 |
| A10 | 提交智能识别与框选请求 | 发送原图、对应 prompt 和合法分辨率；不上传标注截图、不重复执行 |
| A11 | 原图加载失败、尺寸未知、无模型、能力变化 | 保留草稿；解释具体原因，不能带无效数据提交 |
| A12 | Dialog 打开时原图替换/删除、权限撤销 | 拒绝旧上下文保存或执行，不能覆盖新媒体配置 |
| A13 | 断网、恢复、同时编辑不同及相同草稿 | 不误报已保存，不覆盖无关 Node 字段，遵循现有冲突规则 |
| A14 | 复制来源 Node、修改副本、删除与 Undo/Redo | 草稿随节点正确复制/恢复，原件与副本互不影响 |
| A15 | 达到区域上限、模型不支持 bbox、生成失败 | 明确限制且保留输入；不静默截断或退化为其他模式 |
| A16 | 旧画布无草稿、重复开关 Dialog | 兼容首次状态，不产生无操作保存、重复监听或额外请求 |

### 15.2 人工与真实模型 Gate

| Gate | Scene | Pass criteria |
| --- | --- | --- |
| UI / 交互 | Light/Dark × 桌面/390px；鼠标、键盘、触摸 | 图一粒度、两模式切换、图三多框的目标体验成立；控制点和文字可辨认 |
| 产品 | 关闭未执行草稿、跨图恢复、切换模式 | 用户能继续此前的工作，保存语义清楚 |
| 真实模型 | 人像/产品、中文海报、多物体静物 | 四预设的分组可用性、文字外观、补背景和独立编辑效果有实际结果记录 |
| 真实框选 | 同图两个框、标题/整张便签/仅便签文字、重叠目标 | 核验模型实际理解与定位；记录遗漏、边界偏移及不遵循分组的情况，不把请求成功当作效果通过 |
| 持久化 / 协作 | 刷新、断网恢复、两端编辑、来源替换 | A01–A04、A12–A14 在真实页面成立 |

本地验证结果：

- `node tests/layer_decomposition_draft_contract.cjs`：通过原图身份、签名 URL、字段三方合并、序列化与 bbox 边界测试。
- `node tests/issue_38_layer_dialog_fixture.cjs` 启动独立夹具，浏览器点击 **Run contract checks**：56 条真实 Smart Canvas 页面检查通过，涵盖恢复、双模式、双语、准确 bbox、八向缩放、反向/零面积拖动、键盘、Escape、重叠/删除/上限、请求冻结/重复提交、失败保留、媒体重排/替换、同字段冲突、加载失败/恢复、取消关闭后继续编辑及显式放弃。夹具仅替换 API / WebSocket，不调用模型。
- 页面刷新后保存的区域与补充要求恢复；实际鼠标拖拽创建选框，数字输入与归一化示例一致。Light/Dark、中英文、桌面及 390px 窄屏检查完成；已修复英文模式与分辨率选项横向溢出。
- `.venv/bin/python3 -m unittest tests.test_smart_canvas_layer_decomposition tests.test_apimart_layer_decomposition tests.test_documentation_knowledge_map tests.test_smart_canvas_canvas_persistence tests.test_core_creation_i18n tests.test_i18n_cache_versions`：51 tests 通过。
- `node static/js/i18n/validate-i18n.js`：通过；已同步模块与页面 i18n 缓存标识。
- `.venv/bin/python3 scripts/sync_infinite_canvas_ui_version.py --check` 通过：`ic-ui-0e81b6afe7d8`。
- 原有独立 Playwright smoke 在当前沙箱启动 Chromium 时因 EPERM / SIGABRT 退出，未记为通过；以上页面验收在应用内浏览器完成。

真实 Provider 提示词效果、真实触摸设备和断网/双客户端协作 Gate 尚未执行，因此本规格保留在 Active，不宣称模型会逐像素服从 bbox。回归邻居包括其他 AI Processor Dialog（反推、扩图、视角、灯光）、原图编辑、Canvas Undo/Redo、模型能力筛选、分层任务恢复、结果合成与 PSD 下载。

### 15.3 实现消融（2026-09-05）

从本轮实现快照逐项删除，使用相同页面夹具与草稿合同判断取舍；不涉及图层编辑器和 PSD 并行修改。

| 候选 | 实验结果 | 最终处理 |
| --- | --- | --- |
| Cropper 重复注册与未使用导入、提示词重复赋值/编译 | 移除后页面 56 项通过；上游 ESM 已注册组件 | 删除，提示词同步集中到 `sync()`，提交时保留即时派生 |
| 专用 flush/discard 事件、关闭前提前清理和关闭后重复保存 | 复用 `ic-hide` 后页面 56 项通过 | 删除两类事件及 `hide()` 覆盖，关闭原因表达显式放弃 |
| 草稿字段三方合并 | 暂改为直接覆盖，合同失败：远端 `remote` 被本地旧值 `one` 覆盖；恢复后通过 | 保留，防止覆盖其他字段修改 |
| Cropper 反向初次框选适配 | 暂时删除后 `Reverse drag keeps both pointer endpoints` 失败；恢复后页面 56 项通过 | 保留，通过上游公开几何 API 修正首框 |

新增关闭回归先在旧实现失败：取消 `ic-hide` 后输入不再更新草稿。清理收敛到确认关闭之后，回归转绿；另覆盖直接关闭路径与草稿冲突阻止普通关闭。保留来源媒体身份、纯坐标编译和手势撤销边界，它们分别负责来源绑定、数值转换与取消操作，不为减少文件数混入页面宿主。

## 16. Rollout, migration and rollback

草稿使用可识别版本且允许缺省；不要求迁移已有任务记录。未来实现需验证旧数据加载及新字段在 Canvas 序列化中的保留，回滚后至少不能破坏原图与已生成结果。

发布前按[完成文档规则](../agents/change-documentation.md)对齐测试、Issue 和 Current：验证后更新生成链路、UI 指南中改变的事实；只有数据边界或架构决定实际改变才修订 ADR / CONTEXT。触及 Infinite Canvas UI 后执行资源版本同步及 `--check`；执行 i18n 校验、相关回归与语言切换验收；每次 push 遵守根 VERSION 与更新说明同步要求。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product map | [F05 功能注册表](../PROJECT-MAP.md#功能规格注册表) |
| Issue | [#38 智能分层dialog优化](https://github.com/lazyq666/reroll-ai-canvas/issues/38)；已同步本次增量需求及规格 |
| Research | [官方文档、社区工作流、提示词与框选组件调研](../archive/2026-09-05-seedream-5-pro-layer-prompts-research.md) |
| Current contracts | [UI 指南](../current/ui-design-guidelines.md)、[生成链路](../current/generation-pipeline.md)、[Canvas Sync](../current/canvas-sync-implementation.md) |
| Implementation seams | [公共 Dialog](../../static/js/infinite-canvas-ui/ai-processor-dialog.js)、[Smart Canvas](../../static/js/smart-canvas.js)、[分层控制器](../../static/js/smart-canvas/layer-decomposition.js)、[画布持久化](../../static/js/smart-canvas/canvas-persistence.js) |
| Existing tests | [分层浏览器场景](../../tests/issue_31_layer_decomposition_browser_smoke.cjs)、[分层前端合同](../../tests/test_smart_canvas_layer_decomposition.py)、[APIMart 分层](../../tests/test_apimart_layer_decomposition.py)、[文档知识地图](../../tests/test_documentation_knowledge_map.py) |
| Verification | 第 15 节记录本地通过项；真实 Provider、触摸设备及完整协作 Gate 待验收 |

## 18. Open questions

方案选型已随“开始实现”进入实施。待真实模型验收确认：同框多个对象的分组、文字保持与背景补全质量。若输出不满足预期，应调整提示词与引导，不能通过前端伪造输出层数。

## 19. Change log

| Date | Status | Change | Evidence / decision |
| --- | --- | --- | --- |
| 2026-09-05 | Draft | 整理提示词持久化、双模式、四预设、区域框选与 bbox 合同 | 用户本次需求、后续坐标讨论及已完成调研；仅编写规格 |

| 2026-09-05 | Implemented | 实现节点草稿、双模式、Cropper.js 2.2.0 与 bbox 编译；请求及页面回归通过 | 用户明确开始实现；第 15 节验证结果，真实模型 Gate 保留 |

| 2026-09-05 | Implemented | 识别粒度改为直接展示的 Tabs Radio Group；自动判断不自动添加提示词 | 用户后续调整要求 |

本轮粒度调整验证：50 条页面检查通过，覆盖自动判断留空、切换恢复、组件一致性及长文案布局；分层/i18n/文档定向回归 20 tests 通过，中英文及深色窄屏人工检查完成。

| 2026-09-05 | Implemented | 分辨率与粒度均改用 ic-segmented-control；移除自定义入口及粒度解释；保留旧自定义草稿 | 用户最新调整要求 |

本轮分段控件调整验收：52 条页面检查、20 条定向回归、草稿兼容合同、i18n 与资源版本检查通过；实际点击、方向键切换及中英文/深色/390px 布局已核验。两组控件均为 ic-segmented-control，不显示自定义选项及粒度解释。
