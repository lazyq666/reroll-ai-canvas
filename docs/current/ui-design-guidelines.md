# UI 设计与交互实现指南

> Status: Current  
> Last verified: 2026-08-30
> Audience: UI、交互、产品、前端与 AI 开发代理

本页是 Reroll 界面设计的唯一长期入口。它说明产品应该呈现什么体验、优先复用什么、哪些边界不能破坏。历史迁移任务、组件数量审计、截图快照和人工确认流水不再作为设计依据；真实页面、公共 `ic-*` 组件、Design Tokens 和用户行为测试共同证明当前实现。

## 1. 产品体验方向

Reroll 是桌面优先的 AI 视觉创作工作台，不是营销站、移动端应用或通用后台模板。

- 内容优先：画布、媒体与生成结果比容器装饰更重要。
- 紧凑但不拥挤：持续操作区使用高信息密度，重要任务仍保留清楚的分组、标题和反馈。
- 结果可预测：每次点击、拖动、提交和关闭都要有明确后果；不得用视觉成功掩盖仍在处理或已经失败的状态。
- 状态可恢复：加载、空、部分成功、失败、断线、重同步、无权限和撤销都必须有可理解的下一步。
- 明暗主题等价：主题可以改变明度与对比，不改变层级、语义、可用功能或布局。
- 桌面优先：当前不承诺移动端布局；窄窗口仍不能遮挡关键操作或造成不可恢复状态。

## 2. 页面层级

| 层级 | 用途 | 设计要求 |
| --- | --- | --- |
| App Shell | 主导航、账号、设置与工作区入口 | 稳定、低干扰，不与当前任务争夺注意力 |
| Page / Workbench | 列表、设置、专用生成工作台 | 一个明确主任务；次级能力按区域或渐进披露组织 |
| Smart Canvas | Node、Connection、Frame、选择与生成 | 空间内容优先；浮层跟随选择，不永久占用画布 |
| Overlay | Dialog、Menu、Popover、Toast | 临时任务、明确关闭方式、焦点进入与返回完整 |
| Feedback | Loading、Empty、Progress、Success、Failure | 说明发生了什么、是否影响已有结果、用户下一步是什么 |

Canvas List 与 Smart Canvas 的无限空间背景统一使用纯装饰的公共 `ic-canvas-grid`。组件只绘制由 `--ui-color-surface-canvas` 和 `--ui-color-border-canvas-grid` 派生的 15px 网点，不参与 Pointer 命中、键盘导航、Canvas Pan/Zoom 或内容层级；页面只负责把它放在 Canvas 内容之前，不得在页面 CSS 中叠加方格线或复制网点渐变。

Smart Canvas 的导航地图统一使用公共 `ic-smart-minimap`。当前 Viewport 内保持清晰且不绘制 Border，Viewport 外覆盖语义 `--ui-color-mask`，使“正在看哪里”先于节点细节被识别；地图内容背景使用 `--ui-color-surface`。Frame 使用自身主色的 20% 半透明色，Frame 内全部后代节点使用所属 Frame 主色的 30% 半透明色；嵌套 Frame 按最近且较小的 Frame 优先。Frame 外的 Smart Group 使用 `--ui-color-minimap-group`（Light 为 Gray 300），媒体与执行节点使用 `--ui-color-minimap-media`（Light 为 Blue 300），Prompt、Prompt Generation、Text Annotation 与 Brush Stroke 使用 `--ui-color-minimap-text`（Light 为 Green 300）。地图按世界坐标真实比例缩放节点，只有小于 1.5px 时才使用最小绘制尺寸，不得用过大的最小宽高把大范围画布里的相邻节点挤成色块。当 Viewport 的投影面积低于地图面积的 10% 时，地图围绕当前 Viewport 启用有上限的焦点投影，让 Viewport 和节点同步放大；焦点倍率最多为完整内容投影的 2 倍，不能只放大 Mask 镂空、因宽高比差异让某一边过度膨胀，或无限裁掉全局上下文。组件拥有固定单 SVG、世界坐标投影、语义图层、Mask、Pointer Capture、点击/拖拽导航和方向键导航；Smart Canvas 页面适配器只提交轻量的 `frame`、`group`、`text`、`media` 矩形、继承的 Frame 色与当前 Viewport，不得复制内部 SVG，或把完整 Node DOM 放进地图。交互预览位于 `/ui-component-library#smart-minimap`。

Canvas List 与 Smart Canvas 共享相同的 Wheel 手势方向：无 `Ctrl` / `Command` 修饰键的鼠标滚轮或触控板双指滑动平移 Canvas Viewport，`Ctrl` / `Command + Wheel` 才围绕 Pointer 位置缩放。两处都读取 Smart Canvas 的滑动与缩放设备偏好；Canvas List 不得把普通 Wheel 手势解释为缩放。

首次设置中的工作区目录输入与“选择…”按钮在桌面横排时按控件中心线对齐，按钮必须预留完整标签宽度；窄窗口改为单列并让按钮占满可用宽度。设备没有保存过页面偏好时，完成首次设置后默认进入 Reroll；已有用户保存的页面选择继续优先，不得被默认值覆盖。首次设置接口用稳定的 `reason` / `message_code` 表达可见失败与检查结果，页面按当前语言选择产品文案；服务端中文诊断可以保留用于中文兼容与排错，但不得直接透传到英文界面。工作区搬家进度页与首次设置页属于同一产品外壳，必须使用 Design Tokens、明暗主题和公共 `ic-card`、`ic-progress`、`ic-badge`、`ic-alert`、`ic-button`，持续展示阶段说明、文件数和容量进度，并在窄窗口保持关键状态与操作完整可见，不得维护独立的硬编码深色皮肤或原生控件样式。

生产页面中的可见正文、动态反馈、`title`、`label`、`description`、Placeholder、图片替代文字和 ARIA 名称都必须通过公共 i18n key 提供；中文只作为带有 `data-i18n*` 绑定的首屏回退，不得成为运行时分支条件。英文采用简短的 Sentence case 和直接的动作动词，避免 `task(s)`、`image(s)` 等括号复数、逐字翻译和无必要的标题式大写。桌面与 `390px` 窄窗口都要用真实英文偏好检查横向溢出、截断和公共组件合同。

生成日志中的视频引用不得把视频文件地址直接交给 `<img>`；索引和详情缩略图统一复用 `/api/media-preview` 的派生封面，并保留原始视频地址供回退或后续播放。周期性更新运行耗时或进度文案时，必须保留正在显示的 Status Badge 与 Spinner 实例；只有语义状态真正变化时才更新 `tone` 或 `loading`，不得因轮询、计时或 Node 重绘反复重建动画。

## 3. 浮层与层级规范

浮层的前后关系由两件事共同决定：**当前活动层级作用域**（页面、Modal 或浏览器 Top Layer）和**作用域内的语义槽**。`z-index` 只解决同一 Stacking Context（层叠上下文）内的排序；一个组件即使使用很大的值，也不能可靠逃出祖先创建的层叠上下文。CSS 的绘制顺序会把一个层叠上下文作为整体参与外层排序，详见 [CSS 2.2 Stacking Context 绘制顺序](https://www.w3.org/TR/CSS22/zindex.html)。

浏览器的 CSS Top Layer 是另一套由浏览器管理的有序层：进入该层的元素不受普通祖先的 `overflow`、`opacity` 等裁切或遮挡，后进入的元素显示在更上方；每个 Top Layer 元素的 `::backdrop` 自动位于该元素下方。它不是一个更大的 `z-index`，页面也不能直接操作这份层列表，详见 [CSSWG Top Layer](https://drafts.csswg.org/css-position-4/#top-layer)。原生 Modal Dialog 和 Popover API 会通过标准接口进入 Top Layer，分别见 [HTML Dialog](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element) 与 [HTML Popover](https://html.spec.whatwg.org/multipage/popover.html#the-popover-attribute)。

### 语义顺序与 Token 槽

下表按默认“从后到前”排列。具体数值只由 [`static/css/design-tokens.css`](../../static/css/design-tokens.css) 维护；本文只定义 Token 名称、语义和相对顺序。该分类参考了 Atlassian 对 Popup、Blanket、Modal、Flag 与 Tooltip 的分层，以及“拖拽中的 UI 使用 Overlay elevation”的规定，但不复制其数值；见 [Atlassian Elevation](https://atlassian.design/foundations/elevation/)。

| 顺序 | 语义槽 | 典型 UI | 规则 |
| --- | --- | --- | --- |
| 1 | `--ui-z-base` | 页面、Canvas、Node、普通容器 | 默认内容层；普通布局不应为了“保险”设置更高层级。 |
| 2 | `--ui-z-raised` | 选中态 Node、悬浮卡片、局部浮动工具栏 | 只覆盖同一区域的普通内容，不跨页面区域争夺层级。 |
| 3 | `--ui-z-sticky` | Sticky 标题栏、侧栏、Dock | 保持导航或局部操作可见；Menu、Popover 和反馈必须能覆盖它。 |
| 4 | `--ui-z-drag-preview` | 拖拽预览、拖动中的幽灵副本 | 在当前作用域内覆盖内容与 Sticky UI；不覆盖命令浮层、Modal 或系统反馈，且必须 `pointer-events: none`。 |
| 5 | `--ui-z-popover` | Dropdown、Menu、Context Menu、Select 列表、Popover | 所有锚点型命令或补充信息共用一个语义槽；通过打开顺序与挂载位置解决同槽嵌套，不创建页面专用数字。 |
| 6 | `--ui-z-backdrop` | 自定义兼容实现的遮罩 | 只服务紧随其上的 Modal；原生 `::backdrop` 由 Top Layer 排序，不使用该 Token。 |
| 7 | `--ui-z-modal` | Modal Dialog、沉浸式编辑面板、Lightbox | 创建新的活动层级作用域，遮挡并冻结先前作用域；Lightbox 和全屏编辑不是新的层级类别。 |
| 8 | `--ui-z-toast` | Toast、非阻断全局状态反馈 | 位于当前活动作用域的内容和命令浮层之上，但不能抢夺 Focus；Modal 打开时必须进入该 Modal 作用域，或将与当前任务无关的消息延后。Carbon 同样区分阻断任务的 Modal 与不中断流程的 Toast，见 [Carbon Modal 与 Notification](https://carbondesignsystem.com/components/modal/usage/#related)。 |
| 9 | `--ui-z-tooltip` | 只读 Tooltip、快捷键提示 | 当前活动作用域内最前；仅显示当前可交互 Trigger 的说明，不允许旧作用域 Tooltip 穿过新 Modal。Tooltip 不接收 Focus，交互内容改用 Popover 或非模态 Dialog，见 [WAI-ARIA APG Tooltip](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)。 |

以上顺序会在每个 Modal 作用域内重新应用。例如，Modal 内 Select 的 `--ui-z-popover` 必须位于该 Modal 内容之上；它不应因为 Token 在全局表中排在 `--ui-z-modal` 之前，就被挂到 Modal 外部再与 Modal 的数值硬碰。Tooltip 同理。这也是层级作用域比“谁的数字最大”更重要的原因。

Nested Modal（Modal 上再开 Modal）目前不提供独立 Token，并继续由 `ic-dialog` 合同禁止。WAI-ARIA 的 Dialog 模式允许 Dialog 覆盖另一个 Dialog，但要求活动 Dialog 外部保持不可操作且 Focus 受控，见 [WAI-ARIA APG Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)。如果未来确有不可替代的业务场景，应由公共组件升级合同：后打开的 Dialog 作为新的 Top Layer 作用域覆盖前一个 Dialog，并拥有自己的 Backdrop 与 Focus 返回链；禁止页面用 `--ui-z-modal` 加一或另造“二级 Modal”数值。

### 组件挂载规则

1. `ic-dialog`、`ic-menu`、`ic-popover`、`ic-tooltip`、Toast 与拖拽预览的组件代码负责选择挂载位置和语义 Token；业务页面只调用公共接口。
2. 每个页面有一个文档浮层作用域；每个打开的 `ic-dialog` 创建一个内部浮层作用域。锚点型浮层必须挂载到 Trigger 所属的最近活动作用域，而不是无条件追加到 `<body>`。
   作用域查找必须沿 Composed Tree 穿过 Shadow Root 的 Host；只在控件自己的 Light DOM 中调用 `.closest('dialog')` 会把 Modal 内的 Tooltip 或 Popover 错挂到页面作用域。
3. Modal 内部完成任务所需的 Menu、Popover、Select 列表、Tooltip、Toast 和拖拽预览，必须在 Flat/Composed Tree 中属于活动 Dialog，或通过由该组件管理、在其后进入的 Top Layer 元素呈现。这样既能显示在 Modal 内容上方，也不会逃出 Modal 的 Focus 与 Inert 边界。WAI-ARIA 要求 Modal 外部不可交互，并要求操作 Dialog 所需的元素属于 Dialog，见 [APG Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)。
4. 打开 Modal 时，组件库必须关闭或取消此前页面作用域中的 Tooltip、Menu、Popover 与拖拽预览；关闭 Modal 后再把 Focus 返回 Trigger。不得让旧 Tooltip 因为全局层级较高而显示在遮罩之上。
5. 普通 DOM 浮层遇到 `overflow`、`transform`、`opacity` 或 Shadow DOM 边界时，组件库负责使用作用域 Portal 或标准 Top Layer；页面不能靠 `position: fixed` 与更大 `z-index` 猜测结果。Material Web 也把 Dialog 内 Select 的定位方式作为组件能力，而不是页面补丁，见 [Material Web Select](https://github.com/material-components/material-web/blob/main/docs/components/select.md#api)。
6. 使用原生 `<dialog>.showModal()`、Popover API 或 Fullscreen API 时，组件库负责进入/退出 Top Layer、Light Dismiss、Escape、Focus 和 `::backdrop`；不存在也不得新增 `--ui-z-top-layer`。
7. Tooltip 只承载简短只读说明；含按钮、链接、输入或需要 Pointer 停留操作的内容属于 Popover 或 Dialog。Toast 只承载非阻断反馈；需要确认、复制诊断或恢复操作的内容使用持续可见区域或 Dialog。
8. Canvas 页面中的 Modal Shell 必须挂在 Canvas 手势根之外，并由共享 `ic-dialog` 进入 Top Layer；业务内容组件作为 Dialog 内容存在，不得在 Canvas 容器内自行创建原生 `<dialog>` 或依靠逐个 `stopPropagation()` 模拟隔离。

### 页面责任与禁止事项

页面负责选择正确组件、提供 Trigger/Anchor、业务文案、关闭条件与领域状态；当 Anchor 被删除、权限变化、Selection 失效或页面切换时，页面要通知组件关闭。Canvas 的选择、拖动、连线和命中优先级仍由交互合同决定，不能把 `z-index` 当作业务优先级。

禁止以下做法：

- 在业务 CSS 中写任意层级数字、极大值，或重新赋值 `--ui-z-*` 来压过公共组件；确有新跨页面语义时，先扩展 Token 与本节。
- 为 Dropdown、Context Menu、Lightbox、全屏编辑面板等同义场景各建一套层级；它们必须映射到表中已有语义槽。
- 将 Tooltip、Menu、Popover 或 Toast 无条件 Portal 到 `<body>`，不判断 Trigger 所属的活动 Modal。
- 同时为一个 Modal 手写 Backdrop，又调用会生成 `::backdrop` 的 Top Layer API。
- 用 `transform`、`opacity`、`filter`、`isolation` 或 `contain` 在公共浮层根上意外创建新的 Stacking Context。
- 在打开 Modal 后保留旧作用域可见或可交互的浮层，或用 Tooltip 承载可聚焦操作。
- 为 Nested Modal、第三方组件或单个页面临时创建 `--ui-z-modal-*`、`--ui-z-tooltip-*` 等变体；先修复公共挂载合同。

### 层级验收要求

层级修改必须同时通过公共组件样板间和至少一个受影响真实页面，覆盖 Light/Dark 与键盘/Pointer。自动化测试至少验证：

1. Sticky UI 上打开 Menu/Popover 时，浮层可见且不被裁切；Tooltip 从 Menu 或 Popover 内触发时位于其上。
2. 拖拽预览覆盖当前内容但不遮挡命令浮层，并且不会成为 Pointer 命中目标。
3. Modal 打开后，Backdrop 覆盖页面、Dialog 位于 Backdrop 上方、页面作用域旧浮层全部关闭，页面内容无法获得 Pointer 或 Keyboard Focus。
4. Modal 内的 Select/Menu/Popover/Tooltip 在 Dialog 内容上方且不被 Dialog 的滚动容器裁切；Tooltip 的 Trigger 仍保持 Focus，Escape 与关闭后的 Focus 返回符合组件合同。
5. Modal 打开时的 Toast 只出现在活动 Modal 作用域，或按规则延后；Tooltip 仍位于当前 Toast/Popover 之上，但旧页面 Tooltip 不得出现。
6. 沉浸式编辑面板与 Lightbox 使用 Modal 规则；当前 Nested Modal 请求被公共组件明确拒绝。未来若开放 Nested Modal，必须新增多层 Backdrop、Top Layer 顺序、Inert 和逐层 Focus 返回测试。
7. 在具有 `overflow`、`transform`、`opacity` 和 Shadow DOM 的祖先场景中，通过 `elementsFromPoint()` 或等价的真实命中断言验证最上层是预期浮层，不能只断言某个 `z-index` 的计算值。
8. 静态检查确保业务页面没有新增裸 `z-index` 数字或私自覆盖 `--ui-z-*`；公共组件只消费语义 Token，不复制其具体数值。

## 4. 视觉基础

视觉变量的代码权威是 [`static/css/design-tokens.css`](../../static/css/design-tokens.css)，维护说明见 [Design Tokens](design-tokens.md)。

- 业务页面使用语义化 `--ui-*` Token，不新增页面级品牌色、阴影、圆角、控件高度或 Focus Glow。
- 公共键盘 Focus Ring 只在 `:focus-visible` 下显示，统一使用 `--ui-color-border-focus` 的 1px 单层向内绘制：Light 为 `gray-500`，Dark 为 `gray-400`，不叠加第二层颜色或 Shadow。所有消费 `--ui-focus-ring` 的一方样式必须同时消费 `--ui-focus-ring-offset`，不得被祖先的 `overflow` 裁剪。Modal、Popover 或全屏编辑关闭后仍须按交互合同把 Focus 返回触发控件；Focus、Selected、Pressed 是不同状态，不得因为返回 Focus 而改画为选中态。
- 阴影只使用 `none → raised → overlay → modal` 四级语义层次；Menu、Popover、浮动工具栏等临时浮层默认使用 `--ui-shadow-overlay`，Dialog 与模态任务 Surface 使用 `--ui-shadow-modal`。`ic-mention-picker` 是低层级锚点建议列表的明确例外，使用 `--ui-shadow-raised`。
- 可比较的尺寸 Token 统一使用 `xs / s / m / l / xl` 后缀；圆角的特殊形态使用 `none / pill`。数字型间距与字号、语义型阴影与层级不改写为尺寸字母。
- 默认密度为 `medium`；工具栏和画布浮层使用 `small`；登录、初始化等高强调入口可使用 `large`。
- 所有可见原生滚动条统一由 Reroll UI 的 Scrollbar Foundation 管理，并继承 Prompt Node 的视觉基准：纵向与横向厚度均为 `4px`，Track 与 Corner 透明，Thumb 直接贴滚动容器边缘且不加圆角，默认使用 `--ui-color-border-primary`，Hover 使用 `--ui-color-text-tertiary`。该基础同时进入页面 Light DOM 与公共组件的开放 Shadow DOM；页面不得复制 `::-webkit-scrollbar` 或 `scrollbar-color` 样式。仅当横向工具栏、Tabs 或缩略图带已提供其他可见位置线索且滚动仍可由 Wheel、Trackpad 或键盘完成时，允许显式使用 `scrollbar-width: none` 并隐藏 WebKit Scrollbar；隐藏规则不得阻止实际滚动。UI 组件库必须在 Foundations 下以“滚动条 / Scrollbar”登记 `ic-scrollbar`，并用真实 Core 同时展示纵向、横向、开放 Shadow DOM 与显式隐藏但仍可滚动的情境；明暗主题由组件库主控件统一切换。
- 非圆形 `ic-button` 使用 `--ui-radius-m` 与 `corner-shape: squircle` 形成连续圆角。Primary `ic-icon-button` 保持 `--ui-radius-pill` 与 `corner-shape: round`；Secondary 与 Tertiary `ic-icon-button` 改用与 Primary `ic-button` 相同的 `--ui-radius-m` 和 `corner-shape: squircle`。Secondary 使用 `--ui-color-border-secondary` 边框与 `--ui-shadow-raised` 阴影；Tertiary 不显示背景、边框或阴影。Disabled 状态不显示阴影。公共 Icon Token 将 XS 与 S 图标线宽统一为 `1.33`；M、L、XL 继续使用各自尺寸 Token，组件只有在明确的上下文语义需要时才覆盖线宽。
- 所有 Modal / Dialog 外壳统一使用 `--ui-radius-m`，包括 `ic-dialog`、`ic-confirmation-dialog`、`ic-ai-processor-dialog`、原生或兼容期 Dialog，以及 Dialog 内承担局部阻断任务的 Surface。该规则只约束弹窗最外层壳体；内部媒体框、卡片、按钮等子组件继续使用各自的 Radius 合同。沉浸式全屏 Dialog 也保留同一 Radius 属性，不以页面级 `0` 或 `none` 覆盖公共合同。
- `<ic-button ghost>` 是 Secondary Neutral Action 的透明表面变体，但在组件样板间按视觉层级统一命名为 Tertiary（`ic-button-tertiary-*`）：默认使用 `--ui-color-action-tertiary`、无边框，Hover 使用 `--ui-color-action-tertiary-hover`；不得与 Primary、Danger、Toggle 或图标按钮组合。Danger 按钮按 Primary、Secondary、Tertiary 三个视觉层级分别消费 `--ui-color-action-primary-danger*`、`--ui-color-action-secondary-danger*` 与 `--ui-color-action-tertiary-danger*`；公开接口中的 Tertiary Danger 使用 `<ic-button hierarchy="quiet" tone="danger">`。Primary Danger 的文字在明暗主题均使用固定白色；Tertiary Danger Hover 在浅色主题使用 `red-50`（`#FFF0F2`），深色主题使用 `gray-800`。Secondary、Tertiary、Secondary Danger 与 Tertiary Danger 按钮统一使用 `--ui-font-weight-regular`，Hover 只改变表面或边界，不改变文字颜色。普通 `<ic-button hierarchy="primary">` 的 Hover 同样只切换 `--ui-color-action-primary-hover`，不产生 Shadow 或升起位移。`<ic-icon-button background="ghost">` 是无背景图标按钮；这里的 Ghost 描述无背景呈现方式，不是层级名称。组件样板间将图标按钮统一分类为一级、二级、三级，并分别使用 `ic-icon-button-primary-*`、`ic-icon-button-secondary-*`、`ic-icon-button-tertiary-*` 作为复制标识；其中三级仍由公开接口 `background="ghost"` 表达。Composer 的 `apiKindToggle` 使用 `generation-kind` 变体，Default 与 Hover 均保持参数区的默认文字颜色，Hover 只改变背景。Composer 的运行入口统一使用 Large Primary Icon Button，Actions 家族拥有其强调色、Hover、阴影和图标描边，Composer 页面只拥有位置与运行行为。
- 语义颜色首先按 `surface / action / text / icon / border` 表达视觉责任，再按需附加 `primary / secondary / tertiary`、`success / warning / danger` 和 `hover / disabled / selected`。Surface 只表达静态 UI 容器，Action 表达可交互容器；瞬时 Pressed 不拥有独立语义颜色，由 Action 组件在保留当前颜色的同时用 Motion 表达；Toggle 的持久 `pressed` 状态继续使用 Selected 颜色。`info` 只是业务或组件 Tone，不拥有专属语义颜色。
- Prompt Template 有封面时使用 Full-Bleed Cover 与紧凑的 `4rem` 底部 Mask，组件从单一 `--ui-color-mask` 组合出 0%、50%、100% 处的透明、50% 黑、60% 黑渐变，且只包住标题区域，标题字号为 `16px`。没有封面时使用中等明度、高饱和度的同色相双色渐变占位面、80% 白色正文、左上引号和向下渐隐的 28px 细网格，正文为 `14px / 2`，按可用高度裁切且底部最后 `10px` 淡出，不生成多行省略号；标题字号为 `17px`。两种卡片都不显示标题分隔线；预览范围仍为底部标题区预留 `1rem` 呼吸空间。标题与唯一编辑按钮固定在底部；编辑按钮保留 `34px` 热区和白色图标，但不显示背景、边框、阴影或 Blur，Hover 只增强图标不透明度。
- Prompt Template 新建与编辑在提示词库 Dialog 内使用局部任务覆盖层：背景列表继续可见但设为 `inert`，局部 Mask 解释来源关系，创建/编辑 Surface 以明确边界承载双栏布局；不得创建第二个原生 Dialog。Surface 内左侧是与模板卡片同语法的实时预览，右侧只放名称与提示词内容。无封面时预览随输入同步文字和名称；有封面时改为 Full-Bleed Cover；名称与选择、更换或移除封面操作位于预览底部同一行，底部信息区不使用分割线。Surface 内不叠加浅灰内容底板或带边框、阴影、额外内边距的表单卡片。只有持久化合同存在真实字数上限时才显示字数计数与限制；不得用虚构上限占据界面。
- 图标使用项目 `ic-icon` 的语义名称；仅图标按钮必须有可见 Tooltip 和无障碍名称。导航展开图标必须在组件定义和重绘前后都被控件盒约束尺寸与绘制范围，不能用未约束 SVG 覆盖周边界面。
- 图片或视频的通用生成入口、在线生成导航、生成 Node 空状态和图片处理页主生成按钮统一显示 Lucide `Zap`。`generate`、`online-generate` 与兼容语义名 `sparkles` 均解析为该图标；生成按钮不得借用 `Play`，真实媒体播放操作继续使用 `Play`。
- 动效只解释空间关系、状态变化或操作结果；`prefers-reduced-motion` 与 `data-ui-motion="reduced"` 下必须保持完整可用。所有可用的 `ic-button` 与 `ic-icon-button` 默认使用同一瞬时 Pressed Motion：按下在 `90ms` 内缩放至 `94%`，释放在 `240ms` 内按 Spring 曲线回到原尺寸；过程中保持当前 Default 或 Hover 颜色。Disabled、Loading 与 Invalid 不缩放，Reduced Motion 下移除缩放距离。
- Menu、Popover、Confirm Popover、Tooltip、Mention Picker 与 Generation Settings Picker 统一由公共组件拥有浮层进入和退出，不允许业务页面复制 `opacity`、`transform` 或延时销毁逻辑。六类组件均按 `closed → entering → open → exiting` 运行：进入以锚点方向的 `var(--ui-space-1)` 位移、透明度与轻微缩放解释空间来源，除 Tooltip 外均从 `96%` 缩放到 `100%`，Tooltip 从 `98%` 到 `100%`；除 Tooltip 外进入使用 `var(--ui-motion-duration-normal)` 与 `var(--ui-motion-ease-fluid)`，Tooltip 使用 `var(--ui-motion-duration-fast)`。退出统一使用 `var(--ui-motion-duration-fast)` 与 `var(--ui-motion-ease-press)` 反向收束。关闭开始时立即移除公开 `open` 状态并返回 Focus，但 Surface 必须以 `inert`、`aria-hidden`、不可 Pointer 命中的形式留在 Top Layer，动画完成后再关闭 Top Layer 并派发 `ic-after-hide`；退出中重新打开必须打断旧的完成回调，不得闪烁或被过期任务关闭。`ic-after-show` 只在进入完成后派发。Reduced Motion 保留完整状态与事件顺序，把位移和缩放归零，并通过中央 Duration Token 近乎即时完成。
- Dialog 与 Confirmation Dialog 统一由 Dialog 家族拥有模态进入、退出和 Backdrop 动画。标准 Surface 按 `closed → entering → open → exiting` 运行：进入从下方 `var(--ui-space-2)`、`96%` 缩放与透明状态出发，使用 `var(--ui-motion-duration-release)` 与 `var(--ui-motion-ease-fluid)`；Backdrop 同时用 `var(--ui-motion-duration-normal)` 淡入并过渡到 `2px` Blur。退出以 `var(--ui-motion-duration-fast)` 与 `var(--ui-motion-ease-press)` 反向收束，完成后才关闭原生 Dialog、返回 Focus 并派发 `ic-after-hide`。退出中重新打开必须取消过期的关闭完成事件，并从同一模态任务恢复，不得闪烁。沉浸式 Dialog 与 Reduced Motion 均移除位移和缩放；Reduced Motion 仍保留完整状态与事件顺序，并通过中央 Duration Token 近乎即时完成。业务页面不得为 Dialog 复制进入、退出、Backdrop 或延时关闭逻辑。
- Checkbox、Radio、Switch 与 Slider 的状态微动效由 Selection / Adjustment 公共组件统一拥有。Checkbox 勾选或混合标记、Radio 选中圆点从 `40%` 缩放与透明状态进入，透明度使用 `var(--ui-motion-duration-fast)`，缩放使用 `var(--ui-motion-duration-release)` 与 `var(--ui-motion-ease-spring)`；Checkbox 与 Radio 按住时控制体缩放到 `88%`。Switch Thumb 的位置变化使用同一 Release + Spring，按住时横向扩展至 `125%`、纵向压缩至 `86%`，解释拨动前的受力。Slider 只在按住 Thumb 时缩放到 `88%`，位置本身不得添加过渡，以免拖动落后于 Pointer。选中视觉必须读取组件实时 `:state(checked)` / `:state(indeterminate)`，不得把只表达初始默认值的静态 `checked` / `indeterminate` 属性当成当前状态。Disabled 与 Invalid 不播放按压形变；Reduced Motion 把持续时间压缩到 `1ms` 并移除按压形变，但保留清晰的最终选中位置与标记。业务页面不得通过 `::part` 复制或覆盖这些状态动画。
- 导航与命令只为状态变化补动效，不给静态导航容器统一添加进场动画。Tabs 与 Segmented Control 在原有节点上切换选中态：Tabs 只过渡背景与文字颜色，Segmented Control 过渡背景、文字、边框和阴影，均使用 `var(--ui-motion-duration-fast)`；不添加移动下划线或滑动胶囊，以免不同宽度的标签和可滚动内容产生错误的空间暗示。Expandable Navigation（`ic-nav-disclosure`）在同一个内容节点上以 `200ms` 的 Grid Row 展开/收起并以 `var(--ui-motion-duration-fast)` 淡入淡出；Steps 在原有 Step 节点上过渡当前、完成和后续状态的背景、边框与文字颜色。Toolbar、Floating Toolbar、Navigation Item、Breadcrumb 与 Pagination 不拥有家族级装饰动画，其内部 Action 继续遵守 Actions 动效合同。Reduced Motion 把上述导航状态过渡压缩到 `1ms`。
- 容器与数据展示保持稳定，不给 Card、Divider、List 或 Media Container 添加家族级进场、悬浮抬升或布局位移动画；这些组件只组织信息，反复播放装饰动画会干扰比较和阅读。Table 保留现有的行 Hover / Selected 背景色过渡，使用 `var(--ui-motion-duration-fast)`，但行的位置、尺寸和表格外壳不动；Reduced Motion 通过中央 Duration Token 把该过渡压缩到 `1ms`。Card 内的按钮、选择控件或媒体操作继续使用各自组件家族的动效，不由容器重复实现。
- 空状态与加载占位保留已有且职责明确的动效：`ic-loading` 用连续旋转表达未知时长，`ic-progress` 用 `var(--ui-motion-duration-normal)` 连接真实数值变化，`ic-skeleton` 用流光表达已知内容结构尚未就绪，`ic-generation-pending` 用受帧率和可见性约束的 Halftone 表达持续生成。真正的 `ic-empty-state`、空上传节点及远景静态媒体/文本占位不添加淡入、呼吸或循环装饰，因为“没有内容”不是“仍在处理”。Reduced Motion 下停止 Spinner、Skeleton 与 Halftone 的连续循环，Progress 立即显示新宽度；组件仍保留最终视觉、状态文字和无障碍语义。

## 5. 组件选择

新界面先查 `static/js/infinite-canvas-ui/` 中已经存在的公共模块，再决定是否新增。常用选择如下：

`ic-table` 明确支持 `size="small|medium|large"` 三个尺寸；尺寸由组件自身选择，不随页面密度隐式变化。未设置时使用 Medium，Medium 的表头上、左内边距为 16px。

Prompt Composer 的布尔生成参数统一使用 `ic-switch size="s"`（组件库变体名 `ic-switch-small`），标签字号为 `var(--ui-font-size-2)`，Host 左右内边距均使用 `var(--ui-space-2)`。模型专属开关必须来自明确的能力合同；能力未知或不支持时不显示，服务端仍需独立校验，不能仅依赖界面隐藏。

Composer 与 Prompt Node 的 Reference Input Instance 缩略图统一使用公共 `ic-reference-thumbnail`。组件拥有 45px 外框、媒体或文本预览、底部标签、Hover / Focus 删除动作、键盘激活以及可取消的 `ic-activate` / `ic-remove` 事件；缩略图 Hover 时统一组合公共 `ic-thumb-hovercard`，页面不得复制浮层 DOM、样式、定位或播放逻辑。Hovercard 默认显示在 Thumb 上方，使用 `var(--ui-space-2)` 间距，并让两者水平中心线对齐，不再按左边缘对齐；仅在接近视口边缘时允许为防止出屏而翻转到下方或横向偏移。Hovercard 按 `closed → entering → open → exiting` 运行，以 `var(--ui-motion-duration-fast)` 从锚点方向移动 `var(--ui-space-1)`、由 `98%` 缩放并淡入；关闭开始时立即停止媒体并移除辅助技术暴露，但保留不可交互 Surface 完成反向退出，退出期间重新 Hover 必须打断旧销毁任务。Reduced Motion 保留状态顺序，使用 `1ms` 且移除位移与缩放。Hovercard 仅供预览，不显示底部按钮，也不提供查看原图、原视频或原文的动作：图片与视频在最大 `12rem × 12rem` 范围内保持原始宽高比，长边撑满上限、短边自适应；视频进入 Hover 即播放，移出 Hover 后暂停、卸载并移除播放器。文本固定 `12rem × 8rem`，只裁切预览且不可滚动；音频固定 `12rem × 8rem`，使用九根白色竖向波形柱，以错开的负动画延迟做上下起伏，并让首尾关键帧保持一致以连续循环；Reduced Motion 下停止动画并保留静态波形。进入 Hover 即播放，移出后暂停、卸载并移除播放器。文本预览内容依次读取 `preview-text`、调用方文本数据、`aria-label` 和 `label`，完整业务调用方必须优先传入来源全文。缩略图内音频使用 `audio-lines`，文本使用 `square-text`，图标必须在扣除底部标签后的媒体显示区内居中，文本缩略图外框区域使用 `var(--ui-color-surface)`。页面只负责引用排序和提交引用增删；组件库与真实页面必须渲染同一组公共组件并执行真实 Hover 与删除交互。

Composer 外壳及展开状态底部的连续圆角统一使用 `--ui-radius-m`，组件库预览与 Smart Canvas 页面不得分别覆盖为其他圆角。

Dialog 的 Size 必须作为独立矩阵比较 Small、Medium、Large 与 X-Large，并在每个尺寸样例中直接说明固定宽高、内容驱动高度或视口比例等布局方式；Small 的公共最大宽度为 `28rem`，X-Large 的公共尺寸为视口宽度 `90vw`、视口高度 `92vh`。关闭策略、标题可见性和 Confirmation 后果使用各自矩阵。所有 `ic-menu` Surface 统一使用 `--ui-radius-m` 圆角，包括 Dropdown Menu、Context Menu 与 Smart Canvas Node 右键菜单；业务页面不得覆盖为其他圆角。Menu / Popover live case 的矩阵单元必须为浮层完整展开预留至少 320px 宽、420px 高，且桌面 live case 根容器不得设置固定最大宽度，不能用普通静态组件的紧凑单元裁切浮层；只有窄屏验证可以使用 360px 宽度约束。Navigation / Command 中的 Toolbar 与 Floating Toolbar 矩阵单元不得窄于 360px；复制标签包装层必须保持组件原本的内容宽度，不能把行内工具条、浮动工具条、Tabs 或 Segmented Control 强行撑满单元，也不得造成挤压、重叠或越界。Tabs 与 Segmented Control 必须把 `size="small|medium|large"` 作为独立尺寸矩阵比较；显式 Size 覆盖页面 Density，未设置 Size 时继续继承 Density，而且该尺寸合同在组件位于其他 Web Component 的 Shadow DOM 内时也必须成立。Tabs 的 `label-and-icon` 合法组合必须渲染真实 `ic-icon`，不能只在组件名称中声明 Icon；所有尺寸的 Segmented Control 选中项统一使用 `--ui-color-surface` 背景和 `--ui-color-text-primary` 文本色。

Dialog 的紧凑产品形态使用 `size="small" variant="compact"`，公共宽度为 `32rem`（512px）；它仍属于 Small，不得因 Footer 使用 `medium-explicit-task` 双按钮组合而扩成 Medium。只读且无损的内容使用 `dismiss-policy="light"`，允许关闭按钮、Escape 与点击遮罩退出；会提交任务的内容使用 `dismiss-policy="explicit"`，遮罩点击不关闭，但仍保留关闭按钮与 Escape。组件负责 Top Layer、遮罩、标题、内容滚动、Footer、初始 Focus、Focus Trap 和关闭后回到 Trigger；页面只提供业务内容与动作。需要标题和副标题时，把 `h2-with-subtitle` 组合放入 `slot="label"`，由 Dialog 自身的原生 H2 承载，页面不得再嵌套 H2。Footer 的 `medium-explicit-task` 表示“前置 Secondary 文本按钮 + 后置唯一 Primary 文本按钮”的动作层级，与 Dialog 宽度无关。`ic-dialog-compact-light` 的内容列表底部保留 `--ui-space-2` 呼吸空间；Dialog 示例只显示外层组合名称，内部用于拼装搜索体验的 `ic-form-field-search` 不重复显示组件名标签。

Dialog 组件库的 Product Components 区通过“Generation Log Modal”按钮打开真实生产实现，用固定的成功、失败和跨日期示例数据验收任务索引、详情、引用图、技术详情与复制诊断。样板页只提供 Fixture 和启动器，不复制产品模块或样式。

Smart Canvas Quick Add 的“引用该节点生成”浮层以 `ic-menu-reference-generate` 业务别名收录在“菜单、浮层与提示”，真实页面和组件库共同使用 `ic-menu[variant="reference-generate"]`。该变体固定为 Small Context Command Menu，浮层使用 `--ui-radius-m` 圆角，“引用该节点生成”分组标签使用 Regular 字重，并保留文本、图片、视频三个命令项；组件库样板默认展开菜单本体，同时保留真实触发按钮以便关闭后再次操作。

`ic-tabs` 提供公共 `space` 参数，可传入有效 CSS Gap 值覆盖合法组合的默认项间距；未设置时继续使用既有 Token 默认值，无效值使组件合同进入 Invalid。

`ic-card` 的 Plain、Subtle 与 Small、Medium、Large 变体统一使用 `--ui-radius-m`（16px）圆角；Size 只改变内边距和内容间距，不改变圆角。`ic-divider` 的默认外间距统一使用 `--ui-space-1`（4px）：水平分隔线上下各 4px，垂直分隔线左右各 4px。

Toolbar 与 Floating Toolbar 的组件库矩阵只登记已由产品消费的布局：Toolbar 保留横向有框、横向无边框和纵向无边框，删除未落地的横向更多菜单组合；Floating Toolbar 保留单行滚动和单行裁切，删除未落地的自动换行组合。`inline-clip` 仅用于 Smart Canvas 文字、画笔等内容数量固定且完整宽度可预知的短参数栏；节点、选区等长度可变的悬浮命令栏继续使用 `inline-scroll`。

“导航与命令”组件页按“视图切换、位置导航、内容翻页、内容操作、流程进度、状态”的任务顺序组织现有实例。分区导航必须与 Navigation Item、Expandable Navigation、Breadcrumb 相邻；Toolbar 与 Floating Toolbar 归入内容操作。Expandable Navigation（`ic-nav-disclosure`）直属的二级 Navigation Item 统一使用 `--ui-control-height-m` 固定行高，上下内边距计算在该高度内，不得额外撑高条目。分组标题与矩阵列名使用设计师可直接识别的名称，不把 `legal combinations`、`Complete states` 等合同术语作为可见标题，也不以用途说明、提示条或辅助说明卡补充分类。Tabs 的组件别名只描述可见的方向与内容形态，使用 `ic-tabs-horizontal`、`ic-tabs-horizontal-icon`、`ic-tabs-vertical`；Automatic / Manual Activation 仅保留为交互参数和内部合同维度。`horizontal-automatic-label` 组合的 Tabs Bar 使用 10px 圆角，每个 Tab Item 继续使用 `--ui-radius-s`（8px）圆角。所有 `ic-tabs` 变体的 Item Gap 默认统一为与 `ic-tabs-horizontal` 相同的 `0.125rem`（2px），`space` 参数可显式覆盖；`ic-tabs size="small"` 的 Item 字号固定为 `--ui-font-size-2`（12px），不得被调用页面的继承字号覆盖。Segmented Control 的纯文字与图标文字别名分别使用 `ic-segmented-control`、`ic-segmented-control-icon`；外层容器使用 10px 圆角，Item 使用 `--ui-radius-s`（8px）圆角。容器 Border 使用映射到 `--ui-palette-gray-100` 的 `--ui-color-border-segmented-control`，选中项外描边使用 `--ui-color-border-secondary`；选中项外描边不占用 Item 内部尺寸，Hover 不改变外观。Small / Medium / Large 容器高度分别使用 `--ui-control-height-s/m/l`，字号分别使用 `--ui-font-size-1/2/3`（10px / 12px / 14px），选项左右 Padding 分别为 `--ui-space-2` / `10px` / `--ui-space-3`。

Mention Picker 统一使用公共 `ic-mention-picker`。业务层只负责候选项筛选、引用状态与选择后的插入/引用；公共组件负责提示词行和媒体 Masonry Card、可选的媒体 `badge`、可选来源 Tabs、Loading / Empty / Error / Retry、容器锚定、默认固定 `18rem` 高度、方向键活动项、Pointer/Enter 选择、Escape 关闭与 Wheel 隔离。无候选项时 Loading、Error 与 Empty 必须互斥，优先级为 Loading 高于 Error、Error 高于 Empty；仅在已有候选项的分页加载中，Loading 才作为底部状态与内容并存。媒体模式的“当前画布 / 资产库”来源切换必须复用左对齐、内容宽度的 Small `ic-segmented-control`，不得拉伸占满容器剩余宽度。媒体 Card 目标宽度为 `5.625rem`（相对原 `3.75rem` 放大到 150%），默认 Border 使用 `--ui-color-border-secondary`；Card 外框、媒体容器与图片均使用 `--ui-radius-xs`。Hover 时 Border 切换为 `--ui-color-border-focus`、Shadow 切换为 `--ui-shadow-raised`，并显示从顶部 0% 不透明度渐变到底部 `--ui-color-mask` 60% 不透明度的 Mask。媒体区仅允许垂直滚动，图片与视频 Poster 使用现有最小档 `512px WebP` 缩略图，保持自然比例并以 `contain` 处理极端长宽比；视频只显示 Poster，不创建逐卡 Player；音频使用一个共享、手动启动且在移出/切换/关闭时停止的 Player。业务层每次按 60 项增量加载，已加载项必须累计保留；触底不得用下一页替换已有项，追加后必须保留滚动位置与活动项，反向滚动可访问所有已加载项。视觉方向键在 Masonry 中选择相应方向的最近 Card，到达末尾时向业务层请求下一页。普通编辑状态下，调用方必须把 Composer 或节点容器作为几何 Anchor；全屏编辑状态下改用编辑内容区作为 Anchor，并选择 `overlay-block-end` 定位，使 Picker 与编辑内容区等宽、底边固定在底部操作栏上方并向上覆盖编辑区。靠近视口上边缘且不足以容纳 `18rem` 时，Picker 只缩小到 Anchor 上方的可用高度，第一项和滚动区域仍必须留在可视范围内。两种状态均可单独传入保留焦点的编辑器 Invoker；Picker 必须进入浏览器 Top Layer，高于全屏 Mask 与面板，且不得挤压编辑器布局。产品页面不得再拼接 Picker HTML、复制 Picker CSS 或维护独立定位帧。组件库必须把 `ic-mention-picker-prompt` 与 `ic-mention-picker-media` 作为同一公共组件的提示词和输入图变体并列展示；输入图样例必须使用真实来源 Tabs、图片/视频/音频媒体项和公共组件交互，不得复制 Smart Canvas 的 Picker DOM 或样式。

Mention Picker 媒体 Card 的 Hover Mask 内只显示名称；名称使用 `--ui-color-text-white`、`--ui-font-size-1`（10px）与 `--ui-font-weight-regular`，不得继承提示词模式的字号或 Bold 字重。Smart Canvas 中已经属于当前 Prompt Authoring 的媒体 Card 例外地把该名称替换为当前引用槽位的“媒体类型 + 序号”（如“图片1”“图片2”）。已引用 Card 必须先进入独立的 `.media-leading` 区域，复用 `ic-reference-thumbnail` 的方形封面、Border、圆角与底部通栏 Label 视觉；底部 Label 直接显示同一引用槽位名称，不再显示“已引用”，单卡固定为 `4.0625rem × 4.0625rem`（65px × 65px），按从左到右、再从上到下的行优先顺序排列；不得由 CSS Columns 以从上到下的列优先顺序填充。媒体 Listbox 是唯一的纵向滚动容器，其他 Card 的 Masonry 多列必须放在自然高度的 `.media-columns` 内层；不得让固定高度的 Listbox 自身成为多列容器，以免卡片进入横向隐藏列、滚动条消失或无法反向滚动。

Prompt Composer 内的媒体 `@` Token 不显示素材原始名称，必须显示与当前缩略图槽位一致的“媒体类型 + 序号”（如“图片1”“图片2”）。Token 自身不增加横向 Margin；Composer、Prompt Node 与 Prompt Generation Node 中相邻 Token 的视觉间距只由正文中的一个空格产生。缩略图拖动排序后，已有 Token 只按同一引用实例同步重编号，不改变正文中的位置；从缩略图移除某个引用实例时，Composer 中对应的 Token 也必须一并移除，同 URL 的其他引用实例不受影响。

Workspace Asset Library 使用 X-Large `ic-dialog` 承载 `ic-workspace-asset-library`，产品界面统一称“资产库”，成员动作统一称“添加到资产库”和“从资产库移除”，不得显示“工作区资产库”“发布”或“取消共享”。其信息架构复用 Prompt Library 的双栏模式：左侧带 Small 搜索框、“全部”、共享子文件夹和就地新建/改名/删除，右侧为批量导入 Toolbar 与 Masonry Results，窄屏时 Sidebar 位于 Results 上方。文件夹删除使用危险确认，组内素材保留在“全部”；素材 Card 可拖入文件夹。

约 `11.25rem` 宽的 Masonry Card 保持图片自然比例并使用 Lazy Loading；分页每次 60 条，可见窗口最多 120 个 Card。Pointer 点击 Card 或聚焦后按 Enter，会在当前 Canvas Viewport 中心附近插入一个自动避让的 Image Node，随后关闭 Dialog、选中并 Reveal 新节点；Card 使用点击指针和明确表达插入意图的无障碍名称，快速重复激活不得产生重复 Node。“批量导入”必须以 Button 打开原生图片文件选择器，允许从外部文件夹多选图片；上传目标是当前资产库文件夹，完成后在 Toolbar 就地汇总新增、已存在和失败数量，不得把该按钮解释为选择库内 Card 后批量插入 Canvas。方向键继续按视觉邻近关系移动 Focus；改名在 Card 内就地完成，改名与移除动作不得触发插入。从资产库移除使用有明确后果文案的确认层，初始 Focus 落在取消，关闭后回到原入口。只有可管理素材显示改名和移除动作，Loading / Empty / Error / Retry 在当前文件夹内就地反馈。

管理员可通过 `/ui-component-library` 直接打开 UI 组件样板间，用于比较公共组件、状态与历史迁移证据。样板间使用“Section Navigation + 单主题主预览”：分区与入口始终可见，不使用可展开分组；分区标题和具体组件入口都采用中文主名称与英文次级名，例如“按钮 / Button”。“设计参数”是 Sidebar 第一项，后续依次展示组件 Components、组合模块 Blocks、参考与实验内容。Components 表达可脱离具体业务复用的控件能力或通用交互模式，因此 Input、Select、Dialog、Navigation、Menu 与 Popover 等仍归入 Components；Blocks 表达由多个组件组成并完成一段具体任务的区域，例如生成编辑器、提示词模板库、检索导航侧栏和图片编辑区。`ic-empty-state` 与 Smart Canvas 的无内容占位统一归入“空状态”，不在“反馈与进度”重复展示。设计参数页面只保留搜索、筛选、结果标题、参数映射与编辑操作所需信息，单个变量可直接复制，不重复提供复制格式、批量复制或页内主题控制，也不显示来源介绍、连接状态、分类说明或逐卡片辅助描述。版本化组件合同继续作为工程依据保留，但不在 Sidebar 中重复建立“规范”分类。Sidebar 的当前入口必须使用 `ic-nav-item` 的 `current="page"` 状态，显示与公共 Navigation Item 一致的持久选中背景、文字和起始侧标记，并让 URL Hash、主标题、预览内容和 `aria-current` 始终同步；浏览器前进或后退时也恢复同一入口。除需要完整 Canvas 上下文的 Nodes 外，组件浏览页把现有合法组合和状态示例整理为语义表格矩阵，不以松散卡片代替行列比较；状态矩阵是唯一展示方式，不提供布局切换、原始布局回退或逐组件布局偏好，宽度不足时在预览区横向滚动。组件状态样例必须渲染真实公共 `ic-*` 组件，并通过组件公开的 `data-preview-state` 等预览接口复现状态；组件库页面只负责样板容器、网格和说明文字的布局，不得选择 `ic-*` 标签、使用 `::part`、追加外观 Class 或覆盖 Token 来修改组件的尺寸、对齐、状态或视觉。按钮矩阵不静态展示瞬时 Pressed 或 Keyboard Focus 状态，设计者分别通过点击和 Tab 键直接预览真实反馈；Toggle 的持久 `pressed` 属性在样板间按视觉结果命名为 Selected。矩阵滚动区域在视口内独立滚动，让横向滚动条保持在预览底部。明暗主题由主区域右上角统一切换，组件名与变量名复制标签必须保留，基于合法组合生成的名称必须包含完整 `ic-*` 组件前缀。标题实例只显示组件本身，不叠加“Title only / Subtitle”说明；矩阵 Caption 与外部标题相同时只保留无障碍名称，不重复显示副标题。“选择与调节”按具体组件家族分类，S/M/L 在同一尺寸矩阵比较，不把不同组件的 Default/Hover/Focus 等状态混为一个分类；多选画幅允许清空且不自动恢复默认值，必填反馈由拥有确认按钮的流程在确认时提示；Slider 两端预留半个 Thumb，极值位置不得越出控件盒。文本和搜索输入同样提供 S/M/L，组件库不重复陈列外观与 Text 相同的 Email/URL/Tel 示例，搜索清除动作只在输入框聚焦后显示；嵌入输入框的图标动作使用 `ic-icon-button background="ghost"`，默认保持透明，图标默认使用 `--ui-color-text-secondary`，Hover 切换为 `--ui-color-text-tertiary`；同一输入框内相邻尾部动作使用 4px 间距。容器与数据展示把 Card 的 Tone 和 Size 作为独立变量完整比较，每个 Card 变体都在组件名称下方标明实际内边距与对应 Token：Small 为 16px（`--ui-space-4`）、Medium 为 20px（`--ui-space-5`）、Large 为 24px（`--ui-space-6`）；Divider 矩阵只把水平线和垂直线作为真实变体，Table 表头上、左内边距不小于 16px。文件与媒体输入必须分成三层：无可见 UI 的 `ic-file-input` picker 只负责文件窗口与 accept、数量、大小、required、disabled 校验；命令入口复用带 upload 图标的 `ic-button`；可见 `ic-upload-surface` 只提供 node 和 compact 两种形态。single/multiple、required 与限制是行为参数，不形成视觉变体。Surface 比较 default、hover、focus-visible、drag-active、disabled、error；组件库中的媒体槽位展示只保留 Image Frame 的 ready 样例，以及 File Slot 的 empty、uploading、error 状态，不展示 `ic-media-slot-video`、`ic-media-slot-audio` 或 `ic-media-slot-file` ready 样例。传输、持久化和业务含义仍由调用方负责，错误配置作为 fail-closed 状态展示。Sidebar 不展示审计数字、状态说明或组件级装饰性文案，也不再叠加独立图标 rail。该样板间不进入普通产品导航，也不替代真实页面验收；当前代码、Current Spec 和最高公共行为测试仍是行为权威。

新建 Frame 与缺失或非法颜色值的兼容回退统一使用灰色 `slate`。蓝色 `blue`、紫色 `violet`、琥珀色 `amber`、绿色 `green` 与灰色 `slate` 五套颜色继续可选，已有合法显式颜色不得被默认值覆盖。

Smart Canvas 远景模式中的 Prompt Node 与 Prompt Generation Node 文本骨架必须按 Node 内容高度计算可容纳行数，不得固定为四行；骨架保留 20px 上下内边距、9px 行高与 10px 行间距，并限制最多 24 行以控制远景 DOM 成本。远景骨架不拥有文本滚动；Pointer 位于两类 Prompt 骨架上时，无修饰键 Wheel 必须平移 Canvas Viewport，修饰键 Wheel 仍按画布缩放规则处理。详细模式下，未选中的 Prompt Node 与 Prompt Generation Node 不取得滚动优先级：即使文本纵向溢出，Pointer 位于正文上时，无修饰键 Wheel 仍平移 Canvas Viewport。点击选中 Node 后，发生纵向溢出的文本区域才拥有普通 Wheel，并且滚动位置到达顶部或底部时也不得穿透到 Canvas；选中但无溢出时 Wheel 继续平移 Canvas Viewport。空上传 Node 的远景占位背景使用 `--ui-color-surface`，生成中 Node 继续使用生成状态渐变，两者不共用背景规则。音频占位与无静态封面的视频占位只使用 Node 外壳 Border；外壳必须按自身实际圆角裁切内部填充，内部占位不得再绘制覆盖外壳的第二层 Border。

Frame 与 Smart Group 的导航 Badge 只在 Smart Canvas 远景模式渲染，详细模式不得因 Hover 或 Selected 临时显示。Badge 是对应容器 Node 的直接子元素，并以逆缩放保持 24px 屏幕高度；拖动容器或拖动 Badge 时两者必须在同一帧移动，首次按下未选中的 Badge 会先选中对应容器并进入同一个 Node 移动手势。Badge 使用 `--ui-color-surface`、1px `--ui-color-border-nodes`、`--ui-radius-s` 与 `--ui-shadow-raised`，不得使用独立 Overlay 的 12px 胶囊外观；Frame Badge 只用 Frame 语义色表达文字，不另建一套填充与 Border。

图片编辑模式栏、节点浮动操作栏与智能画布工具栏属于 Blocks 下的公共任务组合，分别使用 `ic-image-edit-mode-toolbar`、`ic-smart-node-toolbar` 与 `ic-smart-canvas-dock`。Block 模块是三者 DOM 结构、尺寸、Surface、按钮状态、定位与响应式样式的唯一实现所有者；Smart Canvas 与 UI 组件库只能消费公开元素，不得在页面 CSS、样板页或 Actions / Navigation 组件分类中维护第二份实现。图片编辑模式栏拥有预览、裁剪、遮罩、画笔、缩放、宫格与 360 全景入口，外层可见 Surface 使用 10px 圆角，内部 Tab Item 继续使用 `--ui-radius-s`；组件库只标记组合模块本身，不得为其内部合法组合生成第二个组件名标签。节点浮动操作栏拥有可滚动命令 Surface，并由业务调用方提供当前 Node、Smart Group、Frame 或多选状态对应的动作与可用性；智能画布工具栏拥有左侧与底部两种布局的 Surface、分隔线、工具按钮状态和自适应规则，Surface 使用 `--ui-radius-l` 圆角，外框横截面尺寸由按钮尺寸加两侧 `--ui-space-2` 留白构成，以保证上下左右视觉间距一致；未选中 Item 默认使用 `--ui-color-text-secondary` 显示文字与图标。业务调用方继续提供具体命令、设置面板及持久化偏好。组件库使用公开 `data-preview-state` 只解除生产定位以便独立展示，不覆盖 Block 的内部外观。

“节点 / Nodes”作为 Components 下的独立家族，是组件库表格矩阵规则的特例：该入口直接嵌入生产 Smart Canvas 的自由画布验收模式，展示公共 `ic-canvas-node` 的十种 `kind`：`image`、`generation`、`prompt`、`prompt-generation`、`splitter`、`loop`、`smart-group`、`frame`、`text-annotation` 与 `brush-stroke`。标准 Node 外壳在 Light 主题使用 `--ui-color-surface` 背景、`--ui-color-border-nodes` 的 1px Border、12px Radius 和 `0 1px 2px rgba(20,20,20,.08)` Shadow；该 Border Token 在 Light 映射 `gray-300`、在 Dark 映射 `gray-700`。非空 Image Node 的 Host 本身是图片外唯一容器，四边使用 2px Padding、`--ui-radius-s`、1px `--ui-color-border-nodes`、透明背景与 `--ui-shadow-raised`；内部图片填满内容区、使用同心内圆角且不绘制第二层 Border，使图片 Alpha 像素继续显示下方 Canvas，而不改变不透明像素、尺寸或 Object Fit。Empty Image Node 与尚无媒体结果的 Generation Node 继续使用标准 Node 的 Surface 背景。实体 Node 的普通 Hover 保持 `--ui-color-border-nodes` 并由 Shadow 表达层级变化；Selected 状态把外壳 Border 切换为 2px `--ui-color-border-focus`，并保留 Overlay Shadow。Frame 保持自身语义色，Text Annotation 与 Brush Stroke 没有实体外壳 Border，也不在 Hover 时显示外壳 Shadow。Prompt 与 Prompt Generation 的纵向滚动面延伸到外壳右边缘，滚动条宽 4px、轨道透明、Thumb 使用 `--ui-color-border-primary` 且无额外内缩；Prompt 字符计数在独立底部状态行内右对齐，其文字末端必须与对应正文内容区的右边界对齐，对齐只调整计数 Padding，不移动正文或改变换行宽度。Prompt Generation 的 Reference Input 缩略图区保持内容高度且不参与纵向收缩，指令增长至滚动状态时也不得压缩或裁切缩略图。Prompt Generation 的指令显示内容左边缘必须与 Reference Input Thumb 左边缘视觉对齐：指令区域起始侧 Padding 为 `--ui-space-0`，末端侧 Padding 缩减为 `--ui-space-2`，同时继续让滚动面延伸至 Node 右边缘。Prompt Generation 的模型选择器展开后，Pointer 位于 listbox 内时 Wheel 始终由 listbox 拥有；内容不可滚动或到达边界时也不得穿透并触发 Canvas Pan/Zoom。Resize Handle 位于 Node 右下角外侧，以跟随外壳圆角的 L 形线条表示，线条两端为圆头、线宽为 2px、转角半径为 14.5px；可见图形为 18px，距 Node 约 5px，外层仍保留 44px 透明拖拽热区。多选 Node 的公共选区外框使用 `ic-canvas-multi-selection`，组件内部绘制 2px `--ui-color-border-focus` Border 与四个缩放角点；Smart Canvas 只提供选中身份、投影后的范围、开关状态和移动/整体缩放手势。十种角色按一行一种角色纵向排列，每行由生产 Node 数据渲染至少两个可安全并列的稳定状态；Image Node 行额外覆盖生产 `images[].kind` 的 Image、Empty、Video 与 Audio 四种媒体状态，音频和视频不是新增 Node kind；Generation Node 行覆盖 `referenceGenerationKind` 区分的 Image Generation 与 Video Generation，并使用当前 Lucide 图标库的 `Zap` 图标、`--ui-color-icon-secondary` 图标色与“生成图片或视频”说明。行名与状态名使用生产 Text Annotation Node 显示，不新增标签外壳。Hover、Selected、Dragging 与 Focus 等瞬时交互状态不得写进 Fixture，必须由真实 Pointer / Keyboard 操作产生。验收 Fixture 只拥有本地 Node 与模型数据；生产 Smart Canvas 拥有坐标、尺寸计算、业务正文、选择与 `smart-node-floating-menu`、Resize、Quick Add 磁吸、Connection、模型选择器、Mutation 和 Generation Run。验收模式使用临时画布会话保留生产拖动、Resize、撤销和重渲染，但不连接协作持久化后端、不发出 API 写入，也不显示协作同步失败反馈。组件库不得维护独立 Node 表格页面或预览事件适配器，也不得复制控件 DOM、Node 外壳、状态 Class 或样式；拖动、Resize、Quick Add 和模型选择器必须通过真实 Pointer / Focus 操作验收。

Prompt Node 与 Prompt Generation Node 的展开编辑统一使用 Nodes 家族公共 `ic-prompt-node-focus-surface`。组件拥有遮罩、`850 × 660px` 最大面板尺寸、16px 小视口安全边距、Modal 语义以及点击面板外区域与 `Escape` 请求收起的交互；展开面板不显示收起按钮。Smart Canvas 只负责两类 Node 的可展开资格、正文、编辑持久化、子浮层优先级、开关状态与收起后的焦点返回。

Text Generation 与其他 Generation Pending 状态放入 Node 时，内层生成 Surface 及其单元格必须继承 Node 外壳的实际圆角，不得因使用更大的全局 Radius 而在四角露出 Node 背景。独立使用 `ic-generation-pending` 时仍保留组件默认圆角。Image、Video 与 Text 变体都由公共组件在 Surface 上方组合同一种 Status Badge；`elapsed` 提供可选耗时文字，`label` 提供当前生成状态，`description` 在存在时作为同一 Badge 的补充信息。调用方不得在 Node 外壳另行复制运行中的 Badge。

除 Smart Group、Frame 以及没有实体外壳的 Text Annotation 与 Brush Stroke 保留各自反馈外，其他 Node Hover 统一使用 `--ui-shadow-overlay`。

连接线拖拽时，可连接 Node 的目标区域在可见外框四周扩展 24px；进入目标区时显示与连接方向对应的 Quick Add 按钮并高亮 Node，离开后撤销提示，松开时立即建立连接。Frame 不作为连接目标。

已有连接线默认使用 `--ui-color-border-connections`；进入 Hover 状态时，线条颜色使用 `--ui-color-border-focus`，线宽保持 2.5px；透明点击热区不随视觉线宽变化。

公共 Node 的 Selected 2px Border 由绝对定位、脱离盒模型的选择层承载，Host 的布局 Border 始终保持 1px；因此 Prompt、Prompt Generation、Splitter、Smart Group、Batch Run、Frame 以及 Image、Video、Audio 的内容尺寸和位置都不得因选中发生变化。

Image、Video 与 Audio Node 的外置 Name Badge 高 14px，与媒体容器保持 6px 视觉间距；文字使用 `--ui-text-caption`，字色使用 `--ui-color-text-on-action-primary-disabled`，Hover 与 Dark 主题不覆盖为其他颜色。Image 与 Video 媒体上的 Resolution Badge 高 `1rem`、左右内边距 6px，沿用 `ic-video-play-button` 的 25% 黑色背景、白色前景和 10px 背景模糊，字重为 Regular（400），并移除额外 Border 与 Shadow；Light / Dark 主题保持一致。Video Node 的原生 `video` 播放器继承媒体容器圆角，视觉上与 Image Node 的图片圆角一致；封面中央播放入口使用 Actions 家族中的公共 `ic-video-play-button`，对应 Figma 节点 `299:18`，默认 Medium 为 4rem，缩略图 Small 为 32px，进入播放态后使用浏览器原生播放控件。Upload Node 的上传动作使用 `<ic-button hierarchy="primary" size="small">`，图标、文案与按钮三段内容使用 `--ui-space-3` 间距。

媒体槽位中的音频和视频使用共享 `ic-media-player-controls`。原生 `HTMLMediaElement` 只负责解码、缓冲和播放，不显示浏览器自带控制条；可见控制统一组合基于 Web Awesome 基础能力封装的 `ic-icon-button`、`ic-slider` 与 `ic-icon`。音频与视频控制区都使用从顶部完全透明（0% 不透明度）过渡到底部 `var(--ui-color-mask)` 的纵向渐变；`--ui-color-mask` 仍表示遮罩终点色，不承担渐变结构。两者都使用白色 UI：第一行依次为播放/暂停、当前时间/总时长、静音/取消静音，第二行是整行可拖动进度条；不提供音量滑块、全屏或画中画。播放控件属于媒介操作，不改变槽位 ready 状态只显示删除、且不显示预览或替换的动作合同。

“选择与调节”的复制别名使用“基础组件 + 用途”的短名称，不把勾选位置、标签结构、横向布局或所在表格写进名称。当前扩展别名为 `ic-checkbox-list`、`ic-aspect-ratio-picker-multiple`、`ic-radio-group-tabs`、`ic-select-secondary`、`ic-select-model` 与 `ic-select-count`；尺寸只在末尾追加 `-small` 或 `-large`。

`ic-select` 的下拉选项文字统一从行首对齐；`ic-checkbox-list` 在没有业务容器宽度约束时按内容决定宽度并保持内部标题从行首对齐，业务页面仍可通过自己的布局宽度让它占满列表列。

`ic-select-secondary` 使用 `ic-select[data-component-variant="secondary"]` 作为公共接口：闭合控件与已选选项使用 `--ui-color-action-secondary-selected` 背景且不显示边框，未选和已选文字都使用 `--ui-color-text-primary`。

画幅选择器的已选中项统一使用 `--ui-radius-s` 圆角；默认与工具栏选中项使用 `--ui-color-action-secondary` 背景、`--ui-color-border-primary` 边框与 `--ui-shadow-raised` 阴影。多选变体的选中与 Hover 背景使用 `--ui-color-surface-subtle`，且不显示边框或阴影。

生成设置选择器的分辨率与质量选中项使用 `--ui-color-action-secondary` 背景、`--ui-color-border-primary` 边框与 `--ui-shadow-raised` 阴影；分段选项容器与 Panel 均使用 `--ui-radius-s` 圆角，嵌套画幅选择器沿用基础 `--ui-radius-s`，不得由生成设置变体覆盖为 `--ui-radius-m`。

设计参数默认只读；进入编辑后，只给原子 HEX 色值和可拆成 Light/Dark 原子引用的 `--ui-color-*` 语义映射显示编辑控件，其他全局 Token 与 `--ic-*`、`--smart-*`、`--api-*` 等模块或业务变量保持只读。草稿必须即时覆盖当前预览但不写文件；底部持久显示修改数量、放弃和“检查并保存”，保存前用 Modal 对比原值与新值。非法值不得进入保存确认；源文件已变化或写入失败时保留草稿并显示失败，不允许覆盖或伪造成功。

“菜单、浮层与提示”不得把全部实例聚合成只有一个内容行的超宽总表；必须按 Thumb Hovercard、Mention Picker、Dropdown Menu、选择菜单、Context Menu、命令菜单项、选择菜单项、轻关闭 Popover、显式确认 Popover 与 Tooltip 分组，每个矩阵最多两个变体列。`ic-thumb-hovercard` 在该分组独立展示 Image、Video、Audio、Text 四种真实 Hover 状态；“文件与媒体输入”仍以 `ic-reference-thumbnail` 作为真实调用方验收组合效果，但目录归属和独立组件预览不重复放置。矩阵表头高度由标签内容决定，不继承为浮层预览保留的内容单元最小高度；专用高度只应用于承载可展开浮层的内容格。

Mention Picker 统一使用公共 `ic-mention-picker`，浮层阴影固定使用 `--ui-shadow-raised`；结果列表顶部 Padding 使用 `--ui-space-1`，左右与底部 Padding 使用 `--ui-space-2`。业务层只负责候选项筛选与选择后的插入/引用；公共组件负责提示词行和媒体引用行、容器锚定、默认固定 `18rem` 高度、方向键活动项、Pointer/Enter 选择、Escape 关闭与 Wheel 隔离。普通编辑状态下，调用方必须把 Composer 或节点容器作为几何 Anchor；全屏编辑状态下改用编辑内容区作为 Anchor，并选择 `overlay-block-end` 定位，使 Picker 与编辑内容区等宽、底边固定在底部操作栏上方并向上覆盖编辑区。两种状态均可单独传入保留焦点的编辑器 Invoker；Picker 必须进入浏览器 Top Layer，高于全屏 Mask 与面板，且不得挤压编辑器布局。产品页面不得再拼接 Picker HTML、复制 Picker CSS 或维护独立定位帧。组件库必须并列展示提示词模式与输入图/媒体模式；后者直接以 `tabs`、媒体 `items` 和公开事件驱动真实 `ic-mention-picker`，覆盖“当前画布 / 资产库”、自然比例 Masonry、图片/视频/音频及来源切换，不维护第二套展示实现。输入图来源切换与媒体 Card 必须同时遵守前述 Small Segmented Control、`5.625rem` Card、`--ui-radius-xs`、语义 Border、Hover Raised Shadow 与 Mask 渐变规则。

“实验 → 动画实验 A”提供基于三色团合成动画的实时参数调节；“动画实验 B”提供 Canvas 2D Halftone 点阵动画，并开放流速、点阵密度、圆点大小、场尺度、对比度与多实例数量；“动画性能对比”用于比较三种 Pending Node 动画方案；“点击反馈实验”并列展示浅色与深色环境中的放射线段反馈，默认颜色使用 `--ui-color-border-focus`，普通点击与拖动松手都只播放一次视觉反馈，空闲时不得保留 `requestAnimationFrame`。实验 B 与正式 `ic-generation-pending` 统一采用流速 2.3×、点阵密度 36、圆点大小 18%、场尺度 0.5×、对比度 1.2；背景与圆点分别使用 `var(--ui-color-surface)` 和 `var(--ui-color-text-disabled)` 跟随主题，实验预览画幅为 2:3。Image、Video 与 Text Generation Pending 共用该 Halftone 动画和一条最高 24 FPS 的调度循环，并在离屏、页面隐藏或 reduced-motion 下停止连续绘制；公共组件保留 `kind/state/count/label/description` 合同，增加可选 `elapsed`，并继续提供可访问状态文字。三种 Pending 都不在 Halftone Surface 内重复显示状态文字；公共组件把加载图标、运行时长与“正在生成图片/视频/文本…”合并到 Node 外侧的 Status Badge。点击反馈实验使用最高 1.5 DPR 的 Canvas，限制同时爆发数量；reduced-motion 下只显示短暂静态定位点，不补发业务 `click`。智能画布采用该实验验证后的 `count:8; radius:16px; length:10px; duration:360ms; maxBursts:3; color:--ui-color-border-focus` 配置，彩色线宽为 `1.5px`、外轮廓为 `2.4px`。左键手势从智能画布 `shell` 内开始时，普通点击和拖动松手都会在最终位置播放反馈；画布内容、节点、工具栏、浮层、菜单和小地图不做区域区分。它是产品层的视觉反馈模块，不注册新的 `ic-*` 公共组件，也不改变节点选择、拖动或其他 Smart Canvas 业务交互合同。

Halftone 圆点尺寸仍以 `dot:18%` 参与场值变化，但正式 `ic-generation-pending` 与动画实验 B 都使用 `2px` 最小圆点半径，避免常用缩放范围内的小圆点因抗锯齿失去实色核心。正式 `ic-generation-pending` 的 Halftone Canvas 按节点未缩放的排版宽高使用固定 `2×` 内部渲染密度；Smart Canvas 视口缩放以及图片或视频的 1K、2K、4K 输出档位都不改变等待动画的内部尺寸，只有节点自身宽高变化时才重新分配。`ic-generation-pending` 外置 Status Badge 使用 `--ui-font-size-2`（12px）字号和 `--ui-font-weight-regular` 字重，不使用加粗样式；耗时属性更新必须保留现有 Badge 与 Spinner 实例。

Text Entry 的默认 `appearance="outlined"` 使用 Surface 与 Border；低强调文本与搜索输入可显式使用 `appearance="subtle"`，以 `--ui-color-surface-subtle` 作为背景且不显示 Border。两种外观共享 Size、Focus、Invalid、Disabled、Readonly 与搜索清除动作合同。`ic-input` 只在文字确实超出可显示范围时启用 `--ui-space-1`（4px）边缘渐变：未截断时不显示渐变，位于开头时只淡出右侧，滚动到中间时左右同时淡出，位于末尾时只淡入左侧。组件根据真实文字宽度和横向滚动位置同步这四种状态，渐变直接作用于被截断的文字边缘，不再用永久的 4px 文字内边距把文字隔离在渐变之外。为补偿渐变区域，Small、Medium、Large 的容器横向 Padding 基准分别使用 `--ui-space-1`、`--ui-space-2`、`--ui-space-3`（`0.25rem / 0.5rem / 0.75rem`）；默认描边的 `ic-form-field-text-s` 左侧额外增加 4px，因此实际左右 Padding 为 8px / 4px。单个尾部 Action 不保留额外起始间距，Dual Action 只在两个 Action 之间保留 `--ui-space-1`（4px）。Text Entry 复制名称固定使用 `ic-form-field-{类型}[-{外观}][-{尾部结构}][-{状态}][-{尺寸}]` 顺序；省略默认 Outlined、Medium、Hint 和 Vertical Resize，尺寸使用 `s/l`。搜索图标与清除按钮属于 Search 的默认结构，因此 Search 只使用 `ic-form-field-search[-subtle][-s/-l]`，不附加 `end-icon`；`end-icon/end-button/end-dual` 仅用于尾部动作可选的通用 Text 输入。

| 用户意图 | 优先使用 | 不要做 |
| --- | --- | --- |
| 提交、取消、图标操作 | `ic-button`、`ic-icon-button`、`ic-button-group` | 页面内复制一套 Button 皮肤 |
| 文本、数值和长文本输入 | `ic-input`、`ic-textarea`、相关 Text Entry 模块 | 只用 placeholder 充当标签 |
| 单选、多选、开关和连续调节 | `ic-select`、Checkbox/Radio/Switch/Slider 公共模块 | 用不同视觉表达相同选择语义 |
| 临时阻断任务 | `ic-dialog` | 自建无 Focus Trap 的绝对定位浮层 |
| 临时命令或补充信息 | `ic-menu`、`ic-popover` | 把重要持久状态藏在 hover-only UI |
| 状态与反馈 | `ic-alert`、Badge/Progress/Toast 公共模块 | 只改颜色、不提供文本或恢复动作 |
| 内容分组与数据 | Heading、Card、List、Table、Divider 公共模块 | 为每个页面创造不同容器层级 |
| Prompt 与生成设置 | Prompt Composer、Generation Settings、Aspect Ratio 等领域组合模块 | 绕过既有领域状态自己拼原子控件 |
| Prompt Template 管理 | `ic-dialog` + `ic-prompt-template-library` | Classic/Smart 各自复制弹窗、搜索、分类或编辑器 |

`ic-toast` 的公共 Overlay 使用内容自适应宽度：`width: auto`，默认最小宽度为 17rem，最大宽度为 27.2rem（最小宽度的 1.6 倍）；当视口较窄时，最小和最大宽度都不得超过视口宽度减去左右各一个 `--ui-space-4`。

提示词与诊断信息复制成功及级联完成使用 Success Toast；复制失败及级联运行失败使用 Danger Toast。用户主动停止级联不属于运行失败，使用 Neutral Toast。

`ic-alert` 表达需要用户处理、在关闭或恢复前持续存在的异常与重要状态。它不再提供独立的 Action 变体；设置非空 `action-label` 时，同一个 `ic-alert` 会组合一个 `ic-button-secondary-small` 并在点击时派发 `ic-action`。Alert 统一使用 `--ui-radius-s` 圆角，Title 使用 `--ui-font-size-3` 与 `--ui-font-weight-medium`，Subtitle 保留 `--ui-text-subtitle` 的字族、字重与行高，并将字号设为 `--ui-font-size-2`。Neutral 使用灰色 `circle-alert`，Success 使用 `circle-check-big`，Warning 使用橙色 `triangle-alert`，Danger 使用红色 `circle-alert`；是否带按钮不改变状态图标。状态图标统一使用 2px 描边，并与 Title 首行垂直居中；关闭操作复用 `ic-icon-button-tertiary-small`，可见按钮高度与 Title 行高一致，按钮及其内部关闭图标在整个 Alert 高度中垂直居中。组件页的 Alert 区使用固定演示位与 Neutral、Info、Success、Warning、Danger、带按钮 Alert 六个触发按钮；六种都进入同一队列。新 Alert 插入最上层，旧 Alert 向下错位并缩小，最多露出三层，只有顶层可以操作；所有 Alert，包括带按钮 Alert，都不自动销毁，只在用户点击 × 后执行离场动画并移除，之后下一项上移、隐藏队列依次补入第三层。生成失败等任务级 Alert 保持在右上反馈区，并在对应 Node 内保留对象级失败状态；每个失败 Generation Run 创建独立队列条目，即使失败原因相同也不得合并或覆盖。每张 Alert 独立绑定自己的详情目标；点击“查看详情”只打开详情，不销毁 Alert，只有点击 × 才执行离场与补位。`ic-toast` 只表达操作已经完成、用户知晓即可的短暂结果，使用独立的浮层结构与视觉：四边等宽描边、浮层阴影和紧凑状态图标，不继承 Alert 的 DOM 或左侧强调边。公共 Overlay 默认位于视口底部中央，至少保留 24px 阴影安全距离；新消息在最终锚点从 `96%` 缩放与透明状态淡入，避免动画穿过底部安全边界，并位于最前；最多同时显示三张逐级上移、缩小的堆叠卡片。Toast 不提供关闭按钮，默认 4 秒自动消失，Pointer 悬停或键盘 Focus 时暂停；销毁时先进入不可交互且对辅助技术隐藏的离场状态，向下滑出并淡出，同时让后方卡片补位，动画结束后才移除元素；减少动态效果模式近乎即时完成。只有提供后续动作的 Toast 才允许由调用方设为持续显示。页面底部存在固定操作栏或 Dock 时，通过 `--ic-toast-block-end-offset` 将 Toast 抬高避让。Alert 与 Toast 不共享同一视觉结构或空间锚点，不能只依靠颜色区分严重程度和持续性。

实现上，Alert 与 Toast 复用 Feedback / Progress 家族内部的堆叠队列模块，由同一状态机负责进入、退出、补位、可见层数、层级、过期销毁任务失效和 Reduced Motion；公共组件拥有 Host 的透明度、Transform、Transition 和交互状态，页面只定位 Alert 队列容器，不得复制动画选择器。顶部 Alert 与底部 Toast 通过方向、层距、缩放和销毁时长参数形成两个适配器。共享只发生在行为 seam，二者的 DOM、视觉、挂载范围、可访问语义与自动消失策略不得合并。

所有 `ic-alert` 均占满父容器可用宽度，但最大不超过 30rem。所有 Alert 的 Subtitle 统一使用 `--ui-color-text-tertiary`，最多显示两行，超出内容隐藏；表面阴影统一使用 `--ui-shadow-overlay`。外框使用不占据内部尺寸的 1px `outline`，不使用内部 Border，左侧状态强调线也不参与盒模型计算。组件页队列的相邻层级偏移为 19px。Alert 队列动效参考 Sonner 的可中断过渡：新项从自身高度上方滑入并淡入，旧项同步下压；进入和重排使用 400ms `ease`，顶层关闭使用 200ms `ease-out` 向上淡出，同时下层回弹补位；Reduced Motion 下近乎即时完成。

`ic-badge` 按用途只分为 Label、Count 与 Status。Small、Medium、Large 是独立的视觉尺寸，三种用途均可使用；高度与字号依次为 16px / `--ui-font-size-1`、20px / `--ui-font-size-2`、24px / `--ui-font-size-3`，Medium 为默认值。Label 使用 `--ui-font-weight-regular` 字重、`--ui-color-surface` 背景和 `--ui-color-border-secondary` 边框；Status 的三档字号沿用同一组字号 Token，字重同样使用 `--ui-font-weight-regular`，状态背景和边框配色保持各 Tone 语义。正常或空闲对象不显示 Status Badge；同步中、加载中、等待中和生成中统一属于 Processing 语义，使用 Info 与 Spinner，具体文案由业务场景替换；Spinner 默认每 1.2 秒旋转一圈，避免持续处理状态显得急促。Processing Badge 使用适配小尺寸徽标的独立细圆环，`ic-loading` 保留独立的 Busy Spinner；两者不互相嵌套。完成状态仅在结果仍值得识别时使用 Success，否则恢复为无 Badge；需要注意与失败分别使用 Warning 和 Danger。Badge 只展示附着对象的信息，不作为交互控件，也不替代 Loading、Progress 或 Alert。

Smart Canvas 图片左上角的信息分成两个相邻的非交互 Badge：`[1080×1080] [1:1]`。分辨率在前，宽高比在后，间距为 `--ui-space-1`；各自沿用 16px 高、常规字重、半透明黑底白字和背景模糊。宽高比文字前固定显示 Lucide `Proportions` 画幅对比图标，使用公共 `ic-icon name="aspect-ratio" size="x-small"`（12px），图文间距为 `--ui-space-1`；近似比例的图标位于 `≈` 前。图标仅为装饰，不随横竖方向切换，也不增加独立读屏内容。空间不足时两个 Badge 自动换行，不把宽高比截成省略号。单图、多图与 Smart Group 中的图片使用相同规则；Hover、图片选中或图片内键盘 Focus 时显示，拖动与远景 LOD 时隐藏，Reduced Motion 不播放位移动画。它们不改变 Node 的几何尺寸，也不拦截图片操作。视频继续只显示分辨率。

宽高比始终按宽在前、高在后计算。精确匹配固定常见比例时保留熟悉名称（如 `21:9`，不强制改写为 `7:3`）；否则，精确约分后的两个整数都不超过 20 时直接显示（如 `6:5`、`7:4`）。再否则，以 `1 − min(实际比例 / 候选比例, 候选比例 / 实际比例)` 选择误差最小的常见比例，误差不超过 1% 时按该常见比例显示且不加 `≈`。这个误差表示裁成候选比例所需丢弃的最小面积比例，只用于标签识别，不触发裁切。超出容差时，短边归一为 1，长边最多保留两位小数并加 `≈`，去掉无意义的尾零；例如 `1024×600 → ≈ 1.71:1`，`2560×1080 → ≈ 2.37:1`。固定常见集合为 `1:1`、`2:3`、`3:4`、`9:16`、`9:21`、`4:5`、`1:2`、`1:3`、`1:4`、`1:8` 及其横向倒数，不随 Model 切换。1% 包含边界，横竖互换或像素等比例放大不改变判定。

两个 Badge 读取同一对有效原图像素尺寸，按 `natural_w/natural_h`、`width/height`、`w/h` 的优先级选择完整正整数对，不跨来源拼接，不读 Node 大小或 `layout_w/layout_h` 缩略图尺寸。尺寸缺失或无效时隐藏，原图加载成功后同时补齐；部分自然尺寸不能阻断完整尺寸恢复。加载期间重绘或切换语言后，更新当前挂载的图片与编组引用，已被替换的旧媒体回调不得覆盖新图。图片替换后重算。近似符号与中英文可访问说明同步更新；这个展示结果不进入持久数据、生成参数或生成日志的分辨率比较。

Issue [#21](https://github.com/lazyq666/reroll-ai-canvas/issues/21) 的验收入口：[比例与尺寸来源回归](../../tests/smart_canvas_image_metadata.test.cjs)，运行 `node --test tests/smart_canvas_image_metadata.test.cjs`；[真实页面验收服务](../../tests/issue_21_image_metadata_browser_app.cjs)，运行 `node tests/issue_21_image_metadata_browser_app.cjs` 后打开 `http://127.0.0.1:8821/fixture.html?componentReview=nodes`。该页面加载生产 Smart Canvas 的临时会话，[验收脚本](../../tests/issue_21_image_metadata_browser_harness.js)检查双 Badge、窄图换行、异步补全、媒体替换、视频仅保留分辨率、中英文可访问说明，以及生成日志中的相同与不同像素尺寸；同时验证局部尺寸刷新后图标自动渲染，以及语言切换和媒体恢复后各图片保留装饰性画幅图标。页面提供主题与可见状态的人工验收控件，不写入 Workspace。

组件只拥有可复用的视觉、语义、键盘和事件合同；页面仍拥有业务文案、权限、数据请求、空间定位和领域状态。第三方 `wa-*` 标签、`--wa-*` 变量和 Vendor 路径只允许出现在 Reroll UI adapter 内，不能进入业务页面。

## 6. 交互合同

公共 Action 的 Disabled 外观必须直接消费对应的 `--ui-color-action-*-disabled`、`--ui-color-text-disabled` / `--ui-color-icon-disabled` 与适用的 `--ui-color-border-disabled`；Primary 内容使用 `--ui-color-text-on-action-primary-disabled`。不得只在 Default、Danger 或 Hover 颜色上叠加组件级 `opacity` 来模拟不可用状态，且 Disabled 控件不得响应 Hover 颜色。

### Focus 与键盘

- Pointer 点击可以保留真实 DOM Focus，但不显示误导性的键盘 Focus Ring；禁止通过 `blur()` 隐藏焦点。
- Tab、Shift+Tab、方向键进入控件时必须显示统一 `--ui-focus-*` Ring。
- Dialog、Menu 和 Popover 必须声明初始 Focus；关闭后返回打开它的 Trigger。
- 邻近单个危险入口、且后果可用短文解释的确认使用公共 `ic-confirm-popover`：Surface 继续使用普通 Border、Surface、Radius 与 Popover Shadow Token，只有最终确认按钮使用 Danger Tone；初始 Focus 落在取消，`Escape` 与点击外部均按取消处理并把 Focus 返回 Trigger。Popover 打开时拥有第一层 `Escape`，必须拦截该次按键，只关闭自身，不得同时关闭承载它的 Modal、Menu 或其他 UI；影响整个任务或需要较长说明的确认继续使用 `ic-confirmation-dialog`。
- 搜索框不能仅因位于 Overlay 顶部而自动获得焦点，除非用户明确执行搜索或输入任务。
- 快捷键不能在文本编辑、菜单锁定或模态任务中误触发画布命令。
- Smart Canvas 在非文本编辑、非菜单锁定且非模态任务中，将 `Command/Ctrl + +`、`Command/Ctrl + =` 与数字小键盘 `Add` 解释为围绕 Canvas Viewport 中心放大，将 `Command/Ctrl + -` 与数字小键盘 `Subtract` 解释为围绕中心缩小；键盘缩放复用 Canvas Settings 的缩放速度。页面级浏览器缩放继续由全局守卫取消，但守卫不得停止事件传播或代替 Smart Canvas 修改 Viewport。
- 容器级 Enter、Space、Paste、Context Menu 或 Drag 快捷逻辑必须识别原生控件与 `ic-*` 自定义控件边界；不得把自定义输入或按钮误判成卡片、页面或 Canvas 空白区域。

### 状态与反馈

每个异步能力至少判断以下状态是否适用：初始、加载、空、部分成功、成功、失败、重试、断线/重同步、无权限、目标已删除或结果已过期。

- 短暂且不影响结果的信息可用 Toast；需要用户阅读、复制诊断或执行恢复的失败必须持续可见。
- Toast 可以提供一个键盘可达的非阻断后续动作（例如保存成功后的“编辑”）；动作不得承担确认、失败恢复或读取重要信息的唯一入口。公共调用使用 `actionLabel` 与 `onAction`，触发后关闭该 Toast。
- 部分成功同时说明成功数量和失败数量，不把整个操作伪装成全失败。
- 缺少提示词等可立即修正的必填输入，不用禁用主操作来隐藏校验；主操作保持可点击，触发后明确指出缺少什么，并在校验通过前不提交请求。
- 禁用控件必须解释原因；未知状态保持 fail-closed，不显示可执行假象。
- 用户已经输入的 Prompt、选择和表单内容在可恢复错误后继续保留。
- 危险操作说明对象、影响和恢复边界；取消按钮不得藏在不可见区域。
- 删除容器但保留容器内对象时，确认文案必须明确对象的迁移目标和数量，不能只写“确定删除”。

### Smart Canvas

- Node、Connection、Frame、Selection 与 Viewport 的术语和归属以 [`CONTEXT.md`](../../CONTEXT.md) 为准。
- 单选 Smart Group 或具有明确生成身份的 Generation Node 时，Composer 自动打开。普通 Image Node 不触发 Composer，包括上传前的空媒体槽、图片、视频与音频状态；上传中和上传完成重绘可以保持 Selection，但不能打开 Composer 或启用运行按钮。Quick Add 创建的空 Generation Node 只把所选图片 / 视频作为初始模式，Composer 仍可双向切换；只有已实际承载视频或音频、且没有图片媒体的 Generation Node 固定为视频生成。Composer 可见性、运行按钮基础资格和最终 Generation Run 门禁必须使用同一角色资格结果。
- Composer 展开为大尺寸编辑面板时继续保留底部参数区和运行操作区的布局、间距与圆角，但两区不增加独立背景填充；面板 Surface 应连续透过参数区与操作区，不以展开状态制造额外底栏色块。
- Composer 外壳的显示与隐藏复用线上 `.open` 状态，以 `var(--ui-motion-duration-normal)` 同时过渡透明度与 `10px` 纵向距离；聚焦展开和收起使用同一 Composer 节点的首尾几何差值连续变形，不重建第二个面板。组件库必须提供真实的显示 / 隐藏与展开 / 收起控制并执行这两套线上动效，不能用 `transform:none` 或固定 `opacity:1` 绕过验收。Reduced Motion 下跳过几何变形，外壳显示 / 隐藏则由中央 Duration Token 近乎即时完成。
- Blocks 按是否临时出现决定动效归属：Smart Node Toolbar 保留已有的 `3px` 位移淡入，Dock 的设置与画笔面板保留已有的 `6px` 位移淡入，Smart Node Context Menu 直接继承 Menu 浮层生命周期；这些已有动效不得重复实现。Prompt Template Library、Workspace Asset Library、Search Sidebar、Smart Canvas Dock 等持续占位的容器不添加家族级进场动画，其内部浮层、Dialog、Action 与 Loading 继续遵守各自公共组件合同。
- Composer、Prompt Node 与 Prompt Generation Node 的正文编辑器持续显示中性的 `{count} 字符`提示。字符按 Unicode Extended Grapheme Cluster 计算：组合重音、ZWJ Emoji 与旗帜 Emoji 各按一个用户可见字符，空格、换行和标点正常计数；Composer 排除媒体 Mention Token，Prompt Generation Node 只计算本 Node 指令而不合并上游内容。计数位于编辑器视觉右下角，但必须作为 `contenteditable` 外的 Sibling 占用 `20px` 保留状态行，正文只在上方区域滚动，不得用绝对定位或背景遮挡文字。计数使用 `--ui-font-size-1`、`--ui-color-text-tertiary`、`--ui-font-weight-regular` 与 Tabular Nums，不显示分母、上限、警告或进度语义，不截断输入、不改变 Run 资格。普通与展开状态复用同一派生值；通过 `aria-describedby` 关联编辑器，但不在每次按键时使用 `aria-live` 播报。计数不写入 Canvas、Mutation、Undo、Realtime 或 Generation Run 数据。
- 所有持久 Node 角色通过公共 `ic-canvas-node` 外壳渲染，领域角色由 `nodeKinds.catalog()` 统一列出；Smart Canvas 负责把角色正文、空间布局和运行状态组合进该外壳。新增 Node 角色必须同时扩展领域清单、公共 `kind` 合同、生产适配和组件库角色矩阵，不能只在 `render()` 中追加类型分支。
- `kind="loop"` 的用户界面名称是“批量运行”，内部兼容身份仍可保持 `smart-loop`。节点内按“标题与说明 → 变量与选项数 → 固定按序配对说明 → 执行方式和数量 → N 个任务汇总与运行/停止”组织；提示词选项只在变量开启时展开。该节点必须复用公共 Button、Segmented Control、Popover、Number Input 与 Prompt Composer，Light/Dark、Pointer、Keyboard 和 Selection 行为不得因信息重组产生第二套控件或交互规则。它不显示预计输出、任务预览或 Batch Generation 工作台能力。
- Smart Canvas Dock 只有指针、抓手、画笔、文字与画布这五个互斥工具使用 `pressed` 选中态；日志、提示词模板、资产库与设置属于命令入口，打开对应面板或 Dialog 时保持未选中，并以 `aria-expanded` 表达展开状态（适用时）。快捷键不占用 Dock 图标，固定为设置面板底部带 Keyboard 图标、平台快捷键与右箭头的整行入口；节点包导入不进入 Dock 或设置面板。
- 设置面板中的快捷键入口打开 `small + compact + light` Dialog。内容保持通用、画布导航、节点与编组、创建工具四个纵向分组和 21 行 Keycap，可滚动但不扩大外壳。搜索必须复用正式 `ic-form-field-search` 组合；输入按名称或按键过滤并隐藏空分组，无匹配时显示 Empty State。存在文字时显示 `ic-icon-button-tertiary` 清除动作，默认与 Hover 均不显示背景；清除后恢复四组、21 行并把 Focus 放回搜索框。
- 空白 Smart Canvas 的 Pointer 右键菜单在“粘贴节点”下方显示“批量导入节点”，该命令打开 `small + compact + explicit` Dialog，并保持“选择文件 → 检查内容 → 完成”三态；双击快捷创建菜单和 Group 内创建菜单不显示该命令。选择态支持点击、Enter、Space 与拖放，只接受不超过 100 MB 的 JSON / ZIP，不提供示例节点包入口；校验失败在原位持续显示，不提交导入。选中文件后显示名称、体积、类型和可读取状态；检查态在真正写入画布前显示节点、连接、资源统计与兼容性提示；完成态提供关闭和定位。Footer 文案依次为“取消 / 继续”“返回 / 导入 N 个节点”“关闭 / 定位到新节点”，每一态最多一个 Primary；返回保留已选文件，完成后定位到新 Node，普通关闭把 Focus 返回 Canvas。
- 资源包导出只在同时选择至少两个 Node 后出现于 Node 右键菜单，文案为“导出节点为资源包”，并直接导出包含可用资源的 ZIP 节点包。它与条件允许时出现的“添加到资产库”位于同一个操作分组；该分组整体位于“创建分区”之后、“复制节点”之前。单选右键菜单不显示资源包导出入口，设置面板不再承载导出。
- Smart Canvas Node 右键菜单使用 Blocks 家族的公共 `ic-smart-node-context-menu`；菜单打开期间按住 Shift 时，在“复制节点”后渐进显示“复制节点 ID”，松开 Shift 后再次隐藏。该命令只复制打开菜单时命中的 Node ID，并以 Success / Danger Toast 明确反馈结果。图片的“复制为图片”与 Figma 保持一致：macOS 使用 `⇧⌘C`，Windows 使用 `Ctrl+Shift+C`；快捷键仅在单选且能确定唯一目标图片时执行。菜单项 Hover 背景统一使用 `--ui-color-action-secondary-hover`。
- Canvas Settings 使用宽 `21.5rem` 的单列分组表面，按“画布 / 生成 / 操作”依次展开，并以组间 Divider、标题和留白建立扫描顺序；设置主体不保留底部 Padding，“画布”组合标题把原底部间距移到顶部。左侧显示设置名称，右侧显示选项。明暗主题是“画布”标题右侧的 Quiet Small 图标动作，Light 显示 Moon、Dark 显示 Sun，并继续复用全局 `StudioTheme` 偏好。工具栏位置、生成引擎、图片性能优化、缩放与滑动速度均不显示辅助文案；生成引擎使用标记为 `ic-select-small` 的 Small `ic-select`。Dock 默认位于左侧，工具栏位置与 Generation Batch 的横向/纵向方向使用标记为 `ic-tabs-small` 的 `ic-tabs size="small"`，Small 字号为 `--ui-font-size-2`（12px）；批次方向默认横向。图片性能优化使用默认尺寸 `ic-switch`；缩放与滑动速度使用 `ic-slider size="s"`，由设置菜单布局提供 `8rem` 宽度。远景简化模式始终开启，不向用户开放启停或精简化比例。使用外部 `aria-labelledby` 的图片性能 `ic-switch` 不生成内部 Owned Label，Label Part 不占布局空间，Control Part 右缘应与 Host 右缘对齐。除 Generation Batch 方向外，这些 UI 偏好不创建 Canvas Mutation，也不写入 Canvas 或 Workspace Data；批次方向是共享 Canvas 字段，随 Canvas 保存，但不得进入跨 Canvas 的个人“最近一次 Generation Settings”。
- 选择、拖动、框选、连线和快速添加是竞争命中关系；实现必须遵循相应 Current Spec，不靠局部 `z-index` 偶然决定。
- 浮动工具栏、Menu 与 Processor Dialog 依附于当前选择；取消选择、删除目标或权限变化时必须安全关闭或降级。
- 单选分区的浮动工具栏按“重命名分区、切换颜色、下载、取消分区”排列。下载使用小型显式关闭任务 Dialog，提供倍率、像素尺寸与进度/失败反馈；取消和 Escape 不改变画布，尺寸超限时将焦点保留在可用操作上。图片合成范围、裁切、只读快照及发布 Gate 见[分区大图下载规格](../active/2026-09-03-smart-canvas-frame-image-export-spec.md)。
- Prompt Template Library 的 Canvas 范围统一命名为“当前画布”。搜索使用组件库组合 `ic-form-field-search-s`，界面仅显示带搜索图标的小号输入与末端清除动作，不显示 Label 或 Hint；输入仍提供无障碍名称。在嵌套 Shadow DOM 内仍复用公共语义 Border、Surface、Radius、字号与控件高度。范围计数始终反映已加载的通用与当前画布完整数据，不随当前筛选归零。模板网格顶部使用横跨整行的紧凑“创建新提示词模板”入口，不占用模板卡片坑位、不显示辅助说明；任一范围没有模板时只保留该创建入口，不渲染专用 Empty State；搜索无匹配仍保留就地反馈。
- Prompt Template Library 的通用与当前画布范围各自使用一个 `category-tabs` 容器，标题和入口都放入对应容器；两个 Tabs 使用公共 `space="0.125rem"` 参数，范围标题高度为 `2rem` 且不参与 Tab 选择，不使用额外 `library-group` 容器。`library-switch` 以 `0.75rem` 间距排列两个容器。
- UI 组件库以通用语义命名复用模式：生产 Prompt Template Library Sidebar 以“检索导航侧栏”登记为组合模块 Block，其中的 `library-switch` 以“分区导航”登记为“导航与命令”下的一类 Component。目录、复制标识与搜索索引不使用业务名称；两个条目都以真实 `ic-prompt-template-library` 的公开 Part 呈现，不维护脱离生产实现的样式副本。
- Prompt Template Library 的分类重命名与删除图标按钮，其 Host 与 Shadow DOM 内部 Base 均使用 `1.5rem × 1.5rem` 容器并保留小号图标，两者统一使用 `--ui-color-text-primary`。点击重命名后不打开任务 Modal，而是在原分类名称位置进入行内编辑；点击“新建分组”后，同样在分类列表末尾直接出现一个处于编辑状态、初始值为空的新分组，输入框以灰色 Placeholder 显示“请输入分组名”。两者都复用 `ic-form-field-text-s` 且控件高度为 `1.75rem`，不显示保存或取消图标按钮；点击其他区域或按 `Enter` 保存，按 `Escape` 放弃输入。
- Prompt Composer 的 `@` / `/` 快捷选择器保持一个共享交互合同；`@` 或 `/` 位于编辑器起始位置，或紧跟空格、Tab、`<br>` 及块级换行时必须触发，位于单词、路径或邮箱正文中时不得误触发。该模式在“菜单、浮层与提示”家族登记为公共 `ic-mention-picker`，其使用方只负责筛选候选项和处理 `ic-select` 插入结果，组件统一负责容器锚定、选中项导航与 Wheel 所有权。`/` 不显示额外 Header、Footer、快捷键提示、主库 Tabs 或分类 Tabs，默认直接展示并搜索全部提示词库与全部分类，只匹配模板名称、正向/负向提示词和可见分类名称，不匹配封面引用或所属提示词库名称。`@` 的媒体模式只显示“当前画布 / 资产库”两个来源 Tab，共享搜索词并分别记住活动项与滚动位置；当前画布搜索全部可引用媒体，资产库搜索其中已经添加的图片。每个来源当前已加载的候选中，已属于当前 Prompt Authoring 的媒体按引用槽位顺序排在最前，其余候选保持来源原排序；身份优先按 `media_id`、兼容按 URL 对齐。再次选择这些候选不得创建新的 Reference Input Instance 或 Undo 历史，但每次从 `@` Picker 选择都必须复用原引用实例，并在当前光标位置插入新的 Mention Token；从缩略图入口打开的手动引用模式仍不得插入 Token。模板结果使用行高 `1.5rem` 的单行“`book-text` 图标 / 提示词名称 / 提示词分类”结构，名称盒子按文本内容占宽且最多占结果行的 60%，分类与可见名称文字间距为 `--ui-space-2`；名称和分类均使用 `--ui-font-size-2`，名称使用 Regular 字重与 `--ui-color-text-subtitle`，分类使用 `--ui-color-text-faint`。画布作用域模板的分类统一显示“当前画布”，其他模板显示所属分类，无分类模板不显示空分类占位。支持方向键切换高亮项，并保证高亮项滚入结果区可见范围；Enter 选择高亮项，Escape 关闭。选择 Prompt Template 后在当前光标位置插入完整、展开、可直接编辑的普通文本快照；不渲染模板富文本 Token、不保留持续模板引用，也不折叠模板正文。普通编辑时，结果区独立滚动，宽度等于触发它的 Composer 或 Prompt Node 容器，底边固定在容器上方 `0.25rem`，并在 Canvas Pan/Zoom 或程序化 Viewport 变化时持续跟随触发容器；Composer、Prompt Node 与 Prompt Generation Node 全屏编辑时，`@` 和 `/` 均改为与编辑内容区等宽、底边贴合编辑内容区底边并向上覆盖编辑区的 `overlay-block-end` 定位。两种定位默认固定为 `18rem` 高度，空间不足时缩小到可用高度，切换来源、Loading / Empty / Error 或结果数量不得改变高度。Pointer 位于选择器内时，滚轮始终属于选择器；即使内容不可滚动或已到达边界，也不得触发 Canvas Pan/Zoom。Prompt Node 与 Prompt Generation Node 都必须支持 Pointer 选择，选择期间不得因编辑器 Blur 提前关闭。
- `@` / `/` 快捷选择器在触发符后输入空格时必须立即关闭；之后输入的新 `@` 或 `/` 必须开启独立的空查询会话，不得把前一个触发符识别为查询来源。
- 远端协作状态不能覆盖本地正在输入或拖动的临时状态；确认、冲突与重同步必须让用户知道结果。

## 7. 设计交付最小内容

UI/交互设计稿或 Feature Spec 至少说明：

1. 用户任务、入口、完成条件和非目标；
2. 页面层级与复用的 `ic-*` 组件；
3. 默认、hover、focus-visible、active、disabled、loading、empty、partial、failure 和 recovery 中适用的状态；
4. Light/Dark、密度、长文案、窄窗口和内容溢出；
5. Pointer、Keyboard、关闭、撤销、权限变化和并发影响；
6. 真实页面验收路径，而不是只验证隔离组件截图。

## 8. AI 与开发执行规则

1. 先读 `CONTEXT.md`、`PROJECT-MAP.md` 和对应 Current/Active Spec，再读实际页面与相邻测试。
2. 先复用公共组件和 Token；只有现有接口不能表达新的跨页面语义时，才扩展 `static/js/infinite-canvas-ui/`。
3. 公共组件只接受可复用语义，不吸收页面 API、业务权限或 Canvas 坐标逻辑。
4. 不以历史审计数字、旧 Handoff、截图快照或组件库样例推断当前行为；代码、Current Spec 和最高公共行为测试优先。
5. 视觉修改必须在受影响的真实页面同时检查，不以组件预览页通过替代产品验收。
6. 完成后按 [`docs/agents/change-documentation.md`](../agents/change-documentation.md) 更新最少必要的权威文档。

## 9. 验收清单

- 主任务和主操作是否一眼可见，次要信息是否降低了注意力竞争？
- 是否只使用共享 Token 和项目拥有的 `ic-*` 接口？
- Pointer 与 Keyboard 都能完成任务，Focus 进入/返回是否正确？
- 加载、空、失败、恢复、无权限和部分成功是否有明确文案与下一步？
- Light/Dark、长内容、窄窗口与 reduced motion 是否仍可用？
- Smart Canvas 命中、选择、拖动、连线与协作是否没有相互破坏？
- 自动化验证的是用户可观察行为，人工验收发生在真实页面吗？

## Node 组件验收细化（2026-08-26）

失败内容在 Node 标题下方的可用正文区域内水平、垂直居中，不随内容高度收缩并贴向上方。
点击失败 Node 内的“查看日志”会打开 Smart Canvas 生成日志 Modal，不仅执行节点选中或保留在组件示例内。

Image Node、Generation Node 与 Prompt Generation Node 均提供稳定失败态，沿用生成目标形态展示“生成失败”、失败原因与“查看日志”动作；这些失败态的实体外壳统一使用 `--ui-color-surface`，Image Node 不得继续继承媒体就绪态的透明外壳。失败图标容器为 `2rem × 2rem`，不显示 Border、背景或 Shadow；Error 图标使用与默认 Zap 相同的 Medium 尺寸。组件库行标签与首个 Node 保持至少 80px 的视觉间距，Image Node 使用项目自有的几何测试素材 `static/images/test/fixture.svg`，Prompt Generation Node 同时展示含上游 Image 的输入状态。除无实体外壳的 Annotation 外，Node Host 选中时统一使用 `--ui-color-border-focus` Border 与 `--ui-shadow-overlay` Shadow，不由内部媒体或业务容器代替选中反馈，Image、Video 与 Audio 内容也遵循同一规则。Smart Group 与 Frame 使用与其他实体 Node 一致的 `12px` 圆角，Smart Group 默认使用 `--ui-shadow-raised`；远景模式中的名称 Tag 继续分别表达 Smart Group 的 Surface/Border/Shadow 与 Frame 的框架色，而不是合并成无差别标签。上传 Node 只允许共享主按钮通过 Pointer 或 Keyboard 打开文件窗口，空白区域仍可接收 Drop；标题为“拖拽、粘贴或点击选择文件”，说明为“支持图片、视频和音频，最大 500MB”，对应产品实际接受的媒体类型和服务端单文件上限。外层 Surface 不重复绘制，图标容器使用 `--ui-color-surface` 背景、`--ui-color-border-tertiary` Border 与 `--ui-shadow-raised` Shadow；除上传按钮外，Upload Node 主体均可拖动 Node，Generation Node 除“查看日志”等操作按钮外也遵循相同规则。Prompt Node 与 Prompt Generation Node 的展开动作位于选中态 `smart-node-floating-menu`，全屏面板继续在右上角提供收起动作。Video Node 加载或重绘时不自动播放；Pointer 直接单选或按 Enter 选中 Video Node 后开始播放，已单选 Video Node 上的普通点击与 Space 在播放和暂停之间切换。Video 与 Audio 在当前 Canvas 会话内共享一个活动媒体名额；切换到另一个 Video 时暂停前一个并从目标自身保存的进度播放，Audio 仍由显式媒体操作启动。Video 失去单选、进入多选或取消选择时暂停并恢复封面，但按 Node 媒体实例保留当前进度；再次单选从该进度继续，同一 URL 的不同实例不共享进度。视频节点内的播放态使用浏览器原生播放控件，不保留封面中央播放图标；新 Video 媒体实例默认开启自动循环，Node 的 `smart-node-floating-menu` 与应用内全屏工具栏共享同一个“自动循环”Toggle 状态，切换 Toggle 本身不触发播放。开启态使用黑色背景、Check 图标与“循环已开启”文案，关闭态恢复普通背景、Loop 图标与“自动循环”文案；关闭循环后自然结束停在末帧，下一次播放从 0 开始。节点播放器与应用内全屏播放器均不提供浏览器原生系统全屏、画中画或投送入口；双击 Video 媒体与 `smart-node-floating-menu` 的“全屏播放”执行同一应用内全屏动作，以保持画布定义的媒体比例与完整显示。进入和退出应用内全屏时，节点播放器与全屏播放器双向移交当前进度、播放/暂停、音量、静音、播放速度与循环状态，且任一时刻只允许一处播放。打开普通 Dialog、页面失焦、标签页隐藏、最小化或离开页面时暂停活动媒体，关闭或返回后不自动恢复；播放失败必须保留明确重试入口，删除媒体实例时清除其会话状态并关闭正在展示该实例的应用内全屏。

Upload Node 的上传 Surface、标题和说明等非按钮区域必须继承 Node 的拖动光标；上传按钮继续显示按钮自己的点击光标，并保持为不会触发 Node 拖动的独立操作目标。Generation Node 的图片生成、视频生成和失败状态也必须让目标 Surface、图标、标题与说明继承 Node 光标；“查看日志”等操作按钮保留自己的点击光标与事件隔离。Generation Result 已切换为 Image Node 角色，其媒体和文件名继续遵循 Image Node 的查看、选择与重命名交互合同。

Smart Canvas 的媒体文件名 Badge 在文件名前显示媒体身份：图标按实际内容区分图片、视频或音频，文字只表达来源。上传媒体统一显示“已导入 / Imported”，Generation Output 统一显示“AI 生成 / AI generated”；已完成结果不得因 Composer 后续模式变化而改写身份。单媒体、多媒体与 Smart Group 中的媒体使用同一规则，优先保留媒体自身的生成身份；历史记录只在有明确生成输出证据时使用生成名称，其余沿用上传素材分类。普通画布右键“上传媒体”命令直接打开文件选择器，因此不新增空上传 Node 的身份 Badge。身份与原文件名并列显示并在空间不足时省略，Hover Title 保留全文，双击仍编辑原文件名。

媒体文件名 Badge 使用次级文字色 `--ui-color-text-secondary`，配对媒体图标继承同一颜色。浅色、深色和 Hover 共用这一语义颜色，不使用禁用态颜色表达媒体身份。

Image / Video Generation 在空态、生成中和无结果失败态使用 Generation 外壳；一旦交付可展示的图片或视频结果，视觉角色切换为 Image Node，统一使用 2px Surface Padding、1px Border、Image Radius 与 Raised Shadow，同时保留 Generation Run 元数据和后续操作能力。

Quick Add 在默认、普通 Hover 与 Dark 主题下与 Node 外壳共用 `--ui-color-border-nodes`；Focus 与菜单展开状态仍使用各自的语义 Border。

`ic-canvas-multi-selection` 的公共选区输出能力由 Node 家族持有：`quick-add-visible` 控制是否呈现，`quick-add-label` 提供可访问名称，`quick-add-reason` 非空时使按钮不可用并解释原因；页面通过 `quickAddTrigger` 和 `isQuickAddEvent(event)` 对接点击、拖动与焦点，不读取组件私有结构。按钮使用 `ic-icon-button`，位于选框右侧垂直中点，以屏幕尺寸保持可操作；资格、数量、视口投影和批量连接由页面职责模块决定。多选生成菜单仅含图片 / 视频，不改变单节点菜单的文本 / 图片 / 视频能力。对应业务仍按 [Issue #22 Active Spec](../active/2026-09-03-smart-canvas-multi-input-quick-add-spec.md) 验收，未通过的协作 Gate 不作为 Current 功能结论。

## Lighting Reference Dialog（2026-08-28）

兼容 Image Node 的“灯光参考”入口位于 `smartNodeFloatingPortal` 的“角度控制”之后，复用 Large `ic-ai-processor-dialog` 的左右两栏骨架。左栏用尽可能大的连续区域显示可拖拽标准灯光球场景，来源图仅以不带说明文案的小型上下文缩略图出现；右栏允许纵向滚动并按“方向、颜色、曝光与阴影、确定性 Prompt”分组密集参数，分组之间使用 24px 间距，分组标题不追加解释性辅助文案。颜色模式复用 Small `ic-segmented-control`，Number Input、Color Field 与 Textarea 统一使用 Small Size；单个选项标题行与 Slider 使用 4px 垂直间距，所有 `ic-slider` 的可视宽度与所在选项/数值列对齐。Pointer 拖拽与 Number / Slider 必须双向同步，所有主任务可只用 Keyboard 完成。

表观光源尺寸必须在 Three.js 参考场景中产生可见的球面过渡与地面半影变化，并由固定像素差分防止控件退化为无效果状态。Light / Dark 只改变 Dialog Surface 和文字的 Token 映射，不改变 Three.js 参考场景的固定色彩管理。取消、关闭按钮、Escape、成功和 DOM 断连都必须释放 Renderer。确认后选中新建图片 Generation Node 并把英文 Prompt 填入 Composer；来源与新 Node 都保存 Lighting Intent 以支持下次继续微调，但不会自动开始 Generation Run。
