# 提示词库的通用与当前画布范围

- **Status**：Implemented（人工验收与真实旧 Workspace 兼容使用已完成；等待发布前备份回退演练）
- **Feature ID**：F07
- **Owners**：产品 / UI / 交互 / 前端 / 后端 / 测试
- **Last verified**：2026-08-30（用户确认人工验收完成，并确认本功能已在现有旧 Workspace 中实际使用；自动化、Prompt Library Modal 无头 Chrome、真实 Classic/Smart Canvas 无头 Chrome、模板普通文本插入与历史 Token 展开、Canvas Revision 并发与多用户竞态已通过）
- **Applies to**：`2b777da` 及之后
- **Supersedes**：无
- **Superseded by**：无
- **Related ADRs**：[ADR-0001：Workspace Data、Instance State、Device State 与 Device Cache 的边界](../adr/0001-workspace-data-boundary.md)、[ADR-0007：Prompt Library 专属目录拥有数据与封面媒体](../adr/0007-prompt-library-directory-owns-cover-media.md)
- **Domain terms**：Canvas、Classic Canvas、Smart Canvas、Workspace、Project、Prompt Authoring、Prompt Template、Prompt Library、Prompt Node、Canvas Visibility

## 1. 一页摘要

提示词库同时承载两种复用范围：可以在当前 Workspace 的所有 Canvas 中使用的通用 Prompt Template，以及只服务当前 Canvas 创作上下文的 Prompt Template。

用户从 Canvas 打开提示词库后，在一级导航中选择“通用”或“当前画布”。通用范围继续提供用户自行管理的分类；当前画布范围保持无分类的轻量列表。产品不规定摄影、光影、风格、反推、角色或产品等内容必须如何分类，也不把分类体系升级为强制的产品模型。

当前画布 Prompt Template 属于 Canvas 内容，随 Canvas 复制、授权协作、移动与删除。通用内容复制到当前画布后成为独立副本；当前画布内容可以“设为通用”。任何模板的修改或删除都不改变已经插入 Prompt Node 或 Prompt Authoring 编辑器的文字快照。

用户界面统一使用“提示词库”，不再显示“系统提示词库”“系统提示词”或 Workspace 等技术性范围名称。

## 2. Problem Statement

当前 Prompt Library 只有 Workspace Data 范围。某个 Canvas 特有的角色称谓、世界观术语、镜头编号、阶段性约束或创作规则如果保存到现有库，会污染所有 Canvas 的通用内容；如果不保存，用户又需要反复查找和输入。

现有“系统提示词库”名称还混合了三种不同含义：产品预置、不可删除的默认容器和跨 Canvas 可用范围。实际上它属于当前 Workspace，并非安装级全局内容，也不是发送给模型的 System Message。

现有分类同时包含任务、控制维度、主体和输出结构。分类方法属于用户自己的知识管理选择，产品不应通过增加强制类型、层级或标签体系替用户作答。

## 3. Goals / Non-goals

### Goals

- 用户可以把 Prompt Template 明确保存到“通用”或“当前画布”。
- 当前画布模板不污染其他 Canvas，并随所属 Canvas 完成完整生命周期流转。
- 通用与当前画布在同一个提示词库入口中保持清晰、低成本的区分。
- 通用范围保留现有自由分类能力；当前画布范围不引入分类。
- 通用分类以竖向 Sidebar 呈现，支持用户拖动调整分类顺序，并支持把模板卡片拖到分类上完成归类。
- 从 Prompt Node 保存内容时提供直接、低打断的当前画布保存路径。
- 通用模板与当前画布模板之间可以安全复制或改变范围，不产生隐式同步。
- 保留既有模板、分类和已经插入的 Prompt 文本，不因升级恢复用户已删除的预置。
- Administrator 与 Designer 继续共享创作资源管理能力，不新增审核或贡献者权限体系。

### Non-goals

- 不规定或自动生成摄影、光影、风格、反推、角色、产品等分类。
- 不增加标签、多级分类、收藏、模板卡片手动排序或当前画布模板数量上限；通用分类顺序仍由用户管理。
- 不把 Prompt Template 按长度、完整度或“任务模板/提示词片段”强制拆成不同类型。
- 不提供跨 Workspace 的账号级或安装级提示词库。
- 不提供通用副本与当前画布副本之间的持续同步、继承或覆盖关系。
- 不新增提示词审核、版本发布、贡献者或恢复站权限体系。
- 不改变 Prompt Node、Prompt Generation Node 或 Generation Run 的执行语义。
- 不在本规格中定义用户个人私有、Project 级或 Account 级 Prompt Template。
- 不在本规格中扩展任意多个 Prompt Library 的用户管理信息架构；兼容存量记录时不得静默删除数据。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Administrator | 已登录并进入当前 Workspace | 查看、创建、编辑、删除、复制和改变通用或可编辑 Canvas 的模板范围 | 绕过 Canvas 本身的可见性和编辑权限读取私有 Canvas 模板 |
| Designer | 已登录，且拥有目标 Project 与 Canvas 的编辑权限 | 使用和管理通用模板；使用和管理当前画布模板 | 读取或管理无权访问 Canvas 的当前画布模板 |
| Guest Account | 已登录但没有 Canvas 编辑权限 | 无 | 打开或管理提示词库；通过接口读取模板内容 |
| Anonymous Share Visitor | 通过 Share Link 只读查看 Shared Canvas | 查看允许公开的 Canvas 结果 | 打开提示词库、读取当前画布模板或管理通用模板 |

通用模板是当前 Workspace 的共享创作资源，不区分单条模板所有者。首期所有 Designer 均可管理通用模板。

## 5. User stories

1. 作为正在制作单个 Canvas 的 Designer，我希望保存当前作品特有的术语和规则，而不影响其他 Canvas。
2. 作为重复使用通用方法的 Designer，我希望继续按自己建立的分类浏览和管理通用模板。
3. 作为从 Prompt Node 沉淀经验的 Designer，我希望一次动作就把节点内容保存到当前画布，之后再决定是否编辑或设为通用。
4. 作为复用通用模板的 Designer，我希望复制到当前画布后能够针对当前作品修改，而不受原模板后续变化影响。
5. 作为发现当前画布模板具有长期价值的 Designer，我希望把它设为通用并选择通用分类。
6. 作为复制或移动 Canvas 的 Designer，我希望当前画布模板与 Canvas 一起到达目标位置。
7. 作为协作编辑 Shared Canvas 的 Designer，我希望看到并使用同一份当前画布模板。
8. 作为已经在节点中使用模板的 Designer，我希望模板后来被修改或删除时，已有创作内容保持不变。
9. 作为打开新 Canvas 的 Designer，我希望当前画布范围直接保留紧凑的“创建新提示词模板”入口，不被额外空状态占据浏览空间。
10. 作为使用过旧版本提示词库的 Designer，我希望已有模板、分类和删除决定在升级后保持。

## 6. User journey and interaction contract

### Entry and exit

- Classic Canvas 与 Smart Canvas 沿用现有提示词库入口。
- Smart Canvas 的 Composer、Prompt Node 和相关快捷选择器可以继续应用 Prompt Template。
- Prompt Generation Node 与普通 Prompt Node 共享结构化 Prompt Composer：输入 `/` 打开模板快捷选择器，输入 `@` 打开输入素材快捷选择器；Pointer 点击或上/下方向键切换高亮后按 Enter 均能完成选择。模板正文在光标位置完整展开为可直接修改的普通文本快照，不保留模板身份或持续引用关系，并在重绘后保留。
- 快捷选择器使用紧凑 Popover 层级，不显示额外 Header、Footer、快捷键提示、主库 Tabs 或分类 Tabs，并默认展示全部提示词库与全部分类；模板结果使用行高 `1.5rem` 的单行 `book-text` 图标、提示词名称和提示词分类，名称盒子按文本内容占宽且最多占行宽 60%，分类与可见名称保持 `--ui-space-2` 间距；名称/分类均为 `--ui-font-size-2`，名称使用 Regular 字重与 `--ui-color-text-secondary`，分类使用 `--ui-color-text-tertiary`。画布作用域模板的分类统一显示“当前画布”，其他模板显示所属分类，无分类模板不显示空占位。宽度等于触发它的 Composer 或 Prompt Node 容器，底边固定在容器上方 `0.25rem`，Canvas Viewport 变化时持续跟随触发容器，最大高度 `18rem`，结果在内部滚动。Pointer 位于选择器时，滚轮不得在列表边界穿透为 Canvas Pan/Zoom。
- 打开提示词库后默认进入“通用”的“全部”。
- 关闭提示词库后，焦点返回触发入口；没有应用或保存模板时不改变 Canvas。

### Information architecture

```text
提示词库
├── 通用
│   ├── 搜索
│   ├── 用户自定义分类 Sidebar（可拖动排序）
│   └── 通用 Prompt Template
└── 当前画布
    ├── 搜索
    └── 无分类 Prompt Template
```

- 一级导航固定为“通用 / 当前画布”，不提供“全部”。
- UI 不显示“Workspace”作为范围名称。
- “通用”的辅助说明为“当前工作区内的所有画布均可使用”。
- 进入“通用”后才显示二级分类 Sidebar；不再提供独立“管理分组”模式。
- 通用分类使用竖向 Sidebar；拖动 Sidebar Item 可改变分类顺序，把模板卡片拖到目标 Item 可改变所属分类。
- “新建分组”固定为 Sidebar Item 列表的最后一项；点击后在列表末尾直接出现一个处于编辑状态、初始值为空的新分组，输入框以灰色 Placeholder 显示“请输入分组名”，不打开任务 Modal。分类 Item Hover 或 Focus Within 时显示重命名、删除动作；点击重命名后，分类名称在原位置切换为行内编辑。新建与重命名都使用高度 `1.75rem` 的 `ic-form-field-text-s`，不显示保存或取消图标按钮；点击其他区域或按 `Enter` 保存，按 `Escape` 放弃输入。
- 删除普通分组时，在对应删除入口旁打开公共 `ic-confirm-popover`；确认文案显示分组名，并说明组内模板数量和迁移到“未分类”的后果。Popover 使用中性 Surface/Border，只有“删除分组”按钮使用危险色；取消、`Escape` 或点击外部不提交删除。
- 删除分组不删除组内 Prompt Template：服务端把它们迁移到系统管理的“未分类”。“未分类”按需创建，只在至少包含一个模板时显示，且不提供重命名或删除动作；最后一个模板移出或删除后该项隐藏。
- 模板编辑器不承担分类调整，也不显示“移动到分类”卡片按钮；所属分类通过卡片拖拽改变。
- 模板卡片保持 1:1。配置封面时使用全幅封面，标题与唯一的行内“编辑”按钮叠放在底部；Mask 高度固定为紧凑的 `4rem`，在 0%、50%、100% 处分别为透明、50% 黑、60% 黑且只包住标题区域，标题字号为 `16px`。未配置封面时使用中等明度占位色、80% 白色提示词摘要、左上引号与向下渐隐的 28px 细网格，摘要为 `14px / 2`，按可用高度裁切、不生成多行省略号并在底部最后 `10px` 淡出，标题字号为 `17px`；摘要显示范围为底部标题区保留 `1rem` 呼吸空间且不叠加黑色 Mask。两种卡片均不显示标题分隔线；编辑按钮保留 `34px` 热区与白色图标，但不显示背景、边框、阴影或 Blur。
- 整张模板卡是主动作：从普通提示词库打开时，通用模板复制到当前画布，当前画布模板复制文字；从 Composer 或 Prompt Node 打开时，把模板文字快照添加到对应输入框。
- 进入“当前画布”后不显示空分类占位、分类导航、分类管理入口或专用空状态；没有模板时仅保留网格顶部横跨整行的紧凑“创建新提示词模板”入口。

### Happy path：从 Prompt Node 保存

1. Designer 在 Prompt Node 上执行“保存到当前画布”。
2. 系统立即创建当前画布 Prompt Template。
3. 名称优先采用节点标题；没有可用标题时采用内容第一行的安全截断文本。
4. 页面显示成功 Toast，并提供“编辑”动作。
5. Designer 可以继续创作，或通过 Toast 进入模板编辑器补充名称与封面。

### Happy path：从通用复制到当前画布

1. Designer 在普通提示词库的“通用”中点击整张模板卡，执行“复制到当前画布”。
2. 系统在当前 Canvas 创建新的独立 Prompt Template。
3. 新副本保留当时可见的名称、内容和封面，不保留持续同步关系。
4. 系统反馈复制成功；原通用模板保持不变。

### Happy path：设为通用

1. Designer 在“当前画布”中对一条模板执行“设为通用”。
2. 系统要求从现有通用分类中选择分类；没有分类时允许先创建分类。
3. 保存成功后，该模板从“当前画布”消失并出现在“通用”的目标分类中。
4. 已插入 Canvas 的文字快照保持不变。

### Observable states

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| loading | 打开提示词库或切换一级范围 | 对应范围的加载状态；另一范围的数据不冒充当前范围 | 关闭 | 加载成功或失败 |
| common-ready | 通用内容加载成功 | 通用搜索、分类导航、分类管理和模板卡片 | 使用、新建、编辑、删除、复制到当前画布 | 切换范围或关闭 |
| canvas-ready | 当前画布有模板 | 搜索和无分类模板列表，按最近新增或修改时间排序 | 使用、新建、编辑、删除、设为通用 | 切换范围或关闭 |
| canvas-empty | 当前画布没有模板 | 只显示网格顶部的紧凑“创建新提示词模板”入口，不显示解释性空状态 | 新建或切换通用 | 创建成功或离开 |
| common-empty | 通用范围没有模板 | 分类管理和紧凑“创建新提示词模板”入口，不显示专用空状态 | 新建分类或模板 | 创建成功或离开 |
| group-delete-confirming | 点击普通分组的删除动作 | 锚定删除入口的确认 Popover，明确分组名、迁移数量与“未分类”目标 | 取消或确认删除分组 | 取消关闭；确认后模板迁移并刷新分类 |
| saving | 创建、编辑、删除、复制或改变范围正在提交 | 当前动作的进行中反馈；防止重复提交 | 取消未提交编辑或关闭不相关浮层 | 成功或失败 |
| failure | 当前范围加载或写入失败 | 就地错误、可理解原因和重试动作；编辑草稿不丢失 | 重试、取消、关闭 | 重试成功或用户离开 |
| forbidden | 权限在打开后变化或目标 Canvas 不再可编辑 | 无权限反馈 | 关闭或返回 Canvas | 权限恢复后重新进入 |
| target-missing | 当前 Canvas 或目标模板已删除 | 目标不存在反馈，不创建孤立副本 | 返回当前有效范围 | 用户确认 |

### Input, pointer and keyboard

- 一级导航、通用分类、模板卡片主动作及编辑按钮必须支持 Pointer 与 Keyboard。
- 一级范围、普通分类选择、模板卡片及其菜单支持 Keyboard；分类排序与模板归类按已确认交互使用 Drag，不额外显示移动按钮。
- Tab 顺序先经过一级导航，再进入当前范围的搜索、分类（仅通用）、新建和模板列表。
- `Escape` 沿用现有优先级：先关闭模板编辑或确认层，再关闭提示词库。
- 切换范围后，焦点进入新范围的标题或首个可操作控件，不落到已隐藏的分类控件。
- 保存、复制、设为通用和删除在提交期间不得被 Enter 或连续 Pointer 点击重复触发。

### Responsive and themes

- Desktop 与 Narrow 视口都保留一级范围导航；Narrow 不把范围选择隐藏进只支持 Pointer 的菜单。
- 当前画布没有分类栏，因此模板列表直接占用分类栏释放出的空间。
- Light/Dark 下范围选中、卡片、编辑器、错误和 Toast 均使用公共 Token。

### Copy and internationalization

关键中文文案：

- 功能名：`提示词库`
- 一级范围：`通用`、`当前画布`
- 通用说明：`当前工作区内的所有画布均可使用`
- Prompt Node 快捷动作：`保存到当前画布`
- 通用转当前画布：`复制到当前画布`
- 当前画布转通用：`设为通用`
- 任一范围为空时仍显示网格顶部横跨整行的紧凑 `创建新提示词模板` 入口，不显示专用空状态文案或动作组。

英文文案不得直接显示内部 `workspace`、`system` 或 `scope` 标识；使用面向用户的 `Shared across canvases` 与 `Current canvas` 语义。

## 7. Functional rules

1. 产品只有一个用户可见入口名“提示词库”。
2. 提示词库一级导航只有“通用”和“当前画布”，不显示“全部”。
3. 从 Canvas 打开提示词库时默认激活“通用”的“全部”。
4. 通用模板在当前 Workspace 的所有获授权 Canvas 编辑体验中可用。
5. 当前画布模板只能在所属 Canvas 的获授权编辑体验中读取和管理。
6. 通用范围支持用户自由新增、改名、删除和排序分类。
7. 当前画布范围不支持分类；当前画布模板不得要求或展示 Category。
8. 产品不得强制 Prompt Template 类型、标签、分类层级或分类命名法。
9. 通用新建编辑器包含名称、内容和封面；新模板归入当前分类，当前为“全部”时归入首个可用分类。
10. 当前画布新建编辑器包含名称、内容和封面，不出现分类字段。
11. 当前画布列表按最近新增或修改时间降序显示；首期不提供用户排序控件。
12. 搜索只作用于当前一级范围；切换范围不得展示上一范围的结果。
13. 搜索范围覆盖模板名称与正向/负向内容；Composer `/` 快捷搜索还覆盖可见分类名称，但不搜索封面引用或所属提示词库名称。
14. “复制到当前画布”创建新的 Canvas 所有模板，不移动或修改通用原版。
15. 通用副本与当前画布副本之间没有持续同步；任一副本的后续编辑互不影响。
16. “设为通用”改变模板所有范围；成功后原当前画布记录不再显示。
17. 设为通用必须选择一个通用分类；无分类时允许在流程中创建分类。
18. 从 Prompt Node 执行“保存到当前画布”立即创建，不先打开完整编辑器。
19. Prompt Node 快捷保存成功后必须提供可到达的“编辑”反馈动作。
20. 模板名称不是唯一键；同名模板允许存在，不通过静默覆盖解决冲突。
21. 应用 Prompt Template 时，Prompt Authoring 或 Node 必须保存实际插入的文字快照。
22. 修改、删除、复制或改变模板范围不得回写已插入的文字快照。
23. 当前画布模板随 Canvas 复制、移动和持久化，并继承 Canvas Visibility 与编辑权限。
24. 删除 Canvas 时，其当前画布模板一并删除，不保留 Workspace 级孤立记录。
25. Anonymous Share Visitor 与 Guest Account 不得通过 Canvas 只读入口读取模板库内容。
26. 所有获授权 Designer 均可管理通用模板；首期不增加模板所有者或审核状态。
27. 产品预置只在新 Workspace 初始化时写入一次，之后作为普通通用模板管理。
28. 预置模板不显示“系统”或“内置”标记，可以编辑和删除。
29. 产品升级不得自动补回用户已经删除的预置模板或分类。
30. 迁移不得改变已有模板文本、封面、分类顺序或用户创建的分类名称；旧 `scene`、`scene_en` 字段不属于当前合同并在规范化时移除。
31. 通用模板的所属分类不在模板编辑器中修改，也不提供“移动到分类”卡片按钮；通过卡片拖到分类 Sidebar Item 修改。
32. 通用分类 Sidebar Item 支持拖动排序；成功顺序由 Prompt Library 持久化，失败时不得伪装为成功。
33. Sidebar 不提供“管理分组”按钮；“新建分组”是 Item 列表最后一项，重命名和删除在对应 Item Hover 或 Focus Within 时出现；重命名在原名称位置使用高度 `1.75rem` 的 `ic-form-field-text-s` 行内完成，不打开任务 Modal。
34. 模板新建与编辑任务使用同层双栏布局：左侧实时预览，右侧名称和提示词内容；不得叠加内容底板或表单卡片容器。
35. 未配置封面时，左侧预览随名称和提示词输入实时更新；模板名称与封面选择操作位于预览底部同一行，新建/编辑预览的底部信息区不显示分割线。
36. Prompt Template 持久化合同未定义内容字数上限时，编辑器不得显示字数计数或伪造的上限。
37. 新建、编辑等局部任务在同一个 Prompt Library Dialog 内覆盖显示：保留背景列表并设为 `inert`，使用局部 Mask 和有明确边界的任务 Surface；不得把列表替换成近乎全屏的同色空白 Workspace，也不得创建第二个原生 Dialog。
38. Prompt Template 数据合同只保留名称、正向/负向内容、封面、分类和所有权所需元数据，不定义 `scene` 或 `scene_en` 字段。
39. 删除通用分类必须先打开公共 `ic-confirm-popover`；Surface 不使用危险色 Border，只有最终确认按钮使用 Danger Tone，初始 Focus 为取消，`Escape` 与点击外部等价于取消。Popover 打开时优先消费 `Escape`，该次按键只关闭 Popover，不得继续关闭所在的 Prompt Library Modal。
40. 删除通用分类不得删除分类内 Prompt Template；服务端必须在同一次持久化中把这些模板迁移到 ID 固定为 `uncategorized`、用户可见名称固定为“未分类”的系统管理分类。该分类不存在时按需创建，已存在时复用且不得产生重复记录。
41. “未分类”只在包含至少一个模板时出现在公共返回值和 Sidebar 中；为空时隐藏，且无论是否可见都不得被重命名或删除。
42. 从模板编辑器删除单条 Prompt Template 时，必须由编辑器中的删除按钮锚定打开公共 `ic-confirm-popover`；编辑器保持可见且不切换为另一张确认任务面板。确认后才提交删除，取消或 `Escape` 只关闭 Popover 并保留编辑器。
43. Prompt Library 的通用权威 JSON 与 Prompt Template 封面必须收拢在当前 Workspace 的 `data/prompt-libraries/` 专属目录；封面不得继续通过普通参考媒体上传，也不得把整个目录作为公开静态资源暴露。
44. 旧 `data/prompt_libraries.json` 首次读取迁移时必须先验证并保留恢复副本；可解析的旧封面复制到专属目录并改写引用，通用 Managed Media 原件不得在无法证明无其他引用时删除。

## 8. Domain and state model

Prompt Library 仍是组织 Prompt Template 的 Workspace Data 集合。本规格给 Prompt Template 增加两种可观察的所有范围，而不新增 Prompt 类型：

- **通用范围**：Prompt Template 由当前 Workspace 拥有，可在其所有获授权 Canvas 中使用。
- **当前画布范围**：Prompt Template 由一个确切 Canvas 拥有，只在该 Canvas 的编辑体验中出现。

范围是所有权与可见边界，不是 Category。Category 只组织通用模板。

```text
Workspace
├── 通用 Prompt Template
│   └── Category（用户自定义）
└── Canvas
    └── 当前画布 Prompt Template（无 Category）
```

模板身份在其所有范围内稳定。复制到当前画布会创建新身份；设为通用会把模板提交到新的所有范围。应用模板只把完整正文插入 Prompt Authoring 或 Node，插入后即成为独立、可直接修改的普通文本快照；模板身份、来源范围和后续变更不进入该编辑内容。历史画布保存的模板 Token 在恢复时一次性展开为其冻结的文字快照。

本规格不把“通用范围”定义为安装全局或账号全局。切换 Workspace 后，通用模板随 Workspace 切换。

## 9. Data and persistence

| Data | Authority | Boundary | Retention | Migration/recovery |
| --- | --- | --- | --- | --- |
| 通用 Prompt Template | 当前 Workspace 的 Prompt Library | Workspace Data | 随 Workspace 搬迁、打开和备份 | 保留受支持字段、顺序和分类；移除旧 `scene` / `scene_en` |
| 通用 Category | 当前 Workspace 的 Prompt Library | Workspace Data | 随 Workspace 生命周期 | 不自动重命名、合并或重建 |
| Prompt Template 封面 | Prompt Library 专属目录 | Workspace Data | 随 Prompt Library 目录备份和 Workspace 搬迁 | 内容摘要幂等复用；旧 Managed Media 引用复制后改写，原件不自动删除 |
| 当前画布 Prompt Template | 所属 Canvas 的持久内容权威 | Workspace Data / Canvas 所有 | 随 Canvas 复制、移动和删除 | 旧 Canvas 默认初始化为空列表 |
| 已插入 Prompt 文字快照 | Prompt Authoring 状态或 Node | Workspace Data / Canvas 所有 | 随 Canvas 生命周期 | 不依赖模板继续存在 |
| 当前一级导航与搜索输入 | 当前浏览器编辑端 | 本地临时 UI 状态 | 当前打开会话 | 不进入共享 Canvas 内容 |

实现必须让当前画布模板参与 Canvas 的正常复制、移动、保存和授权读取路径，不得建立删除 Canvas 后仍需后台清理的 Workspace 级孤立所有权。

如果存量数据中存在多个内部 Prompt Library 记录，迁移或兼容层不得静默删除、覆盖或丢弃。用户可见目标仍是一个“提示词库”入口；内部兼容方式必须通过迁移测试证明无数据损失。

## 10. API / WebSocket / Provider contracts

| Contract | Caller | Observable result | Errors/recovery |
| --- | --- | --- | --- |
| 读取通用模板与分类 | Classic/Smart Canvas | 返回当前 Workspace 的获授权通用内容 | 加载失败只影响通用范围，可重试 |
| 读取当前画布模板 | Classic/Smart Canvas | 返回确切 Canvas 所有的无分类模板 | Canvas 不存在或无权限时拒绝，不回退到其他 Canvas |
| 管理通用模板与分类 | Prompt Library UI | 创建、更新、删除或排序 Workspace 所有内容 | 保留编辑草稿；重复提交不得产生重复记录 |
| 管理当前画布模板 | Prompt Library UI / Prompt Node | 创建、更新或删除 Canvas 所有内容 | 调用方提交单项语义 intent；共享 Canvas Commit Lane 负责 checkpoint、Operation ID、Revision 对齐与有限安全重试；同模板变化报告冲突并保留草稿 |
| 复制到当前画布 | Prompt Library UI | 原通用模板不变，当前 Canvas 获得独立副本 | 任一步失败时不得产生半完成副本 |
| 设为通用 | Prompt Library UI | 模板从当前画布范围原子转为通用范围 | 通用创建失败时保留当前画布原记录 |
| Canvas 复制与移动 | Canvas 内容管理 | 当前画布模板随 Canvas 到达目标 | 失败沿用 Canvas 操作的回滚语义 |

本规格不改变 Provider 或 Generation Run 合同。公开接口的具体路径和请求形状由实现设计决定，但必须区分通用所有权与确切 Canvas 所有权，并在服务端执行权限检查。

## 11. Security and privacy

- 当前画布模板可能包含未出现在可见 Node 上的角色设定、项目术语或创作约束，必须按 Canvas 内容处理。
- 服务端不得仅依赖前端范围筛选；读取和写入当前画布模板必须校验目标 Canvas 访问权限。
- Anonymous Share Visitor 的 Share Link 不授予提示词库读取能力。
- Designer 管理通用模板时不得获得其他无权访问 Canvas 的当前画布模板内容。
- 错误信息不得暴露 Workspace 或 Canvas 的底层绝对存储路径。
- 封面继续使用 Managed Media 或既有受控媒体引用，不新增任意服务器路径读取能力。

## 12. Performance and reliability constraints

- 切换“通用 / 当前画布”不得加载或渲染无关 Canvas 的当前画布模板。
- 当前画布列表不因缺少分类而引入全 Workspace 扫描；查询必须以当前 Canvas 为明确边界。
- 创建、复制、设为通用和删除必须防止同一用户动作的重复提交。
- 当前画布模板写入与普通 Canvas Mutation 共用唯一 Canvas Revision；Classic/Smart 调用方不得维护或提交另一套独立版本权威。
- 每次提示词用户意图使用稳定 Operation ID；网络响应丢失、离线恢复或 409 安全重基时复用同一标识，服务端先校验 receipt/collision，再判断目标是否存在。
- 创建与复制在事务内读取最新 Canvas 模板并应用单项语义 intent，可越过无关 Canvas Revision 更新；更新、删除与设为通用必须携带预期模板版本，同一模板已变化时不得自动覆盖。
- 提示词提交前必须等待当前 Canvas 本地 pending/in-flight 修改到达确认 checkpoint；提交期间产生的新本地修改继续排队并基于提示词提交后的 Revision 发送。
- HTTP 响应与 `canvas_mutation` WebSocket 无论谁先到，客户端只确认一次 Revision；提示词成功后紧接的普通 Canvas Mutation 不得使用更旧 Revision。
- `stale_prompt_templates` 只允许在刷新 Canvas 与模板、确认目标未变后以同一 Operation ID 自动重试一次；第二次竞争或同模板变化必须返回可操作错误并保留草稿。
- “设为通用”必须具有原子可观察结果：失败时模板仍留在当前画布，成功时只在通用出现一次。
- Canvas 复制或移动失败时，当前画布模板必须与 Canvas 主体一起回滚，不允许部分到达。
- 模板服务暂时失败不得破坏已经插入或正在编辑的 Prompt 文字。

## 13. Design system contract

- 页面使用共享 `ic-dialog` 提供大尺寸 Modal、Top Layer、Focus 与关闭合同；`ic-prompt-template-library` 仅负责搜索、Sidebar、卡片和局部编辑任务，不自建原生 Dialog。
- 局部编辑、分类编辑和范围提升在同一个 Modal 内使用局部任务覆盖层：背景列表继续渲染但设置 `inert` 与 `aria-hidden`，内部 Mask 只负责建立空间层级，不创建第二个原生 Dialog。分组删除与模板删除统一使用公共 `ic-confirm-popover`；模板删除 Popover 锚定编辑器删除按钮并保留编辑器，取消后无需重建编辑任务。
- 一级“通用 / 当前画布”使用 `ic-segmented-control` 的 `single-label` 合法组合与 `size="large"`，不创建新的自绘选中控件。
- 通用分类与当前画布入口各自使用 `ic-tabs` 的 `vertical-manual-label` 合法组合。
- 分类 Item Actions 沿用 `ws-project-row.has-actions` 的 Hover / Focus Within 显示方式；计数让位给动作，操作结束后仍回到对应分类上下文。
- 模板卡片保持 1:1。存在封面时使用 Full-Bleed Cover，底部内容层包含 `16px` 标题和单一编辑按钮；Mask 固定为 `4rem`，组件使用单一 `--ui-color-mask` 组合 0%、50%、100% 三处的透明、50% 黑、60% 黑紧凑渐变。不存在封面时使用 `--ui-color-prompt-template-placeholder-*` 中等明度、高饱和度的同色相双色渐变表面、80% `--ui-color-text-white` 文字、`14px / 2` 高度自适应摘要、左上引号、28px 细网格和 72% 纵向渐隐；摘要不生成多行省略号，并在底部最后 `10px` 淡出。标题字号为 `17px` 且隐藏媒体 Mask，摘要显示范围为底部标题区保留 `1rem` 呼吸空间。两种卡片的标题区均不渲染分隔线；编辑按钮保留 `34px` 控件盒与白色图标，Base 的 Border、Background、Shadow 和 Backdrop Filter 均为空。卡片主动作由宿主上下文解释，内容组件只发出模板激活事件。
- 模板编辑器沿用已确认的视觉预览语法。局部任务层使用 7px Blur Mask；任务 Surface 采用 `58.75rem` 最大宽度、公共 Border、Radius 与 Modal Shadow，并以 `22px` 内容内边距、`.92fr / 1.08fr` 两栏比例、`30px` 栏间距和至少 `27.5rem` 的预览高度组织内容。预览与字段顶底对齐，字段区域没有额外 Padding、Border、Background 或 Shadow。Narrow 下回流为单列。
- 模板编辑器继续使用公共 `ic-input`、`ic-textarea`、`ic-button`、`ic-file-input` 与 `ic-media-container`。封面文件控件由同一行公共按钮触发；取消系统文件选择后仍留在编辑任务。内容没有服务端或存储上限时，不渲染字符计数或 `maxlength`。
- 卡片 Drag 反馈沿用 SmartGroup Reorder 语法：源卡淡出缩小、详细预览跟手、有效目标磁吸并高亮、落位时预览收拢；预览不参与 Pointer 命中，Reduced Motion 下保持可用。
- 提示词库搜索使用组件库组合 `ic-form-field-search-s`：界面仅显示带搜索图标的小号输入与末端清除动作，不显示 Label 或 Hint；输入仍提供无障碍名称。嵌套 Shadow DOM 中继续使用公共语义 Border、Surface、Radius、字号与控件高度。
- 通用与当前画布范围各自使用一个 `category-tabs` 容器，标题与入口均放入对应容器；两个 Tabs 通过公共 `space="0.125rem"` 参数把内部间距设为 `0.125rem`，范围标题高度固定为 `2rem` 且不参与 Tab 选择，不增加 `library-group` 包装层。两个 Tabs 容器由 `library-switch` 以 `0.75rem` 间距排列。
- 分类的重命名与删除图标按钮，其 Host 与 Shadow DOM 内部 Base 均使用 `1.5rem × 1.5rem` 控件容器，图标保持小号尺寸；两者统一使用 `--ui-color-text-primary`，不对删除按钮使用危险色。
- 提示词库任一范围没有模板时都不渲染 Empty State，只保留网格顶部横跨整行的紧凑“创建新提示词模板”入口；搜索无结果仍显示就地无匹配反馈。
- Prompt Node 的“保存到当前画布”使用现有 Node 操作入口和公共动作组件，不新增永久占位工具条。
- Toast 的“编辑”必须可由 Keyboard 到达，并在进入编辑器后把焦点放到名称字段。
- 真实页面需要覆盖 Light/Dark、Desktop/Narrow、Pointer/Keyboard 和编辑器/确认层焦点恢复；组件样板不能代替页面验收。

## 14. Implementation decisions

- 用户可见信息架构只有一个 Prompt Library，通过所有范围区分通用与当前画布内容。
- 当前画布模板属于 Canvas 持久权威，避免 Workspace 级记录携带 `canvas_id` 后形成孤立清理责任。
- Category 只属于通用范围；当前画布模板不存储无意义的默认 Category。
- 通用到当前画布使用复制语义；当前画布到通用使用改变范围语义。
- 模板复制后不建立引用继承或实时同步。
- 已插入文本只保存普通文字快照，不保存持续模板引用；快照保证模板修改或删除后的 Canvas 稳定性，并允许用户立即局部改写。
- 产品预置采用一次性 seed，不保留用户可见的特殊身份，不在升级时重新合并。
- 现有隐藏字段在兼容读写中不得因公共编辑器未展示而丢失；本规格不要求新增其编辑 UI。
- Modal Shell 位于 Canvas 手势根之外；页面只拥有数据与持久化，内容组件只发出分类排序和模板移动意图，避免 Canvas 与 Modal 同时响应一次输入。
- Canvas Commit Lane 是 Classic/Smart 共用的深 Module；其页面侧 Interface 只有 `commitPrompt(intent)`，内部负责 checkpoint、串行、HTTP 适配、409 安全重基、响应丢失幂等重试和 HTTP/WebSocket Revision 去重。Classic 与 Smart 只提供各自的 Canvas Persistence Adapter。
- Canvas Store 在事务内应用 create/update/delete 单项语义 intent；copy 复用 create，promote 复用带模板版本保护的 delete。完整 templates 数组只保留为旧存储兼容路径，不是页面写入合同。

上述决定与 ADR-0001 的 Workspace Data 边界一致，不新增长期秘密、Instance State 或 Device State 归属，因此本阶段不新增 ADR。若实施选择让当前画布模板脱离 Canvas 权威或引入跨 Workspace 全局所有权，必须先补充或修订 ADR。

## 15. Acceptance and testing

### Highest test seam

最高接缝是通过真实 Classic Canvas 与 Smart Canvas 页面打开提示词库，执行两个范围的浏览、创建、复制、改变范围、Prompt Node 快捷保存、Canvas 复制/移动以及权限拒绝，并在重载后检查可见内容和已插入文字。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
| 打开有当前画布模板的 Canvas | Browser | 默认激活“通用”的“全部”；切换到“当前画布”后无分类栏，按最近修改排序 |
| 打开没有当前画布模板的 Canvas | Browser | 仅显示紧凑“创建新提示词模板”入口，不显示专用空状态 |
| 切换到通用 | Browser | 显示通用分类；不出现“系统”或 Workspace 技术名称 |
| 在当前画布新建 | Browser + HTTP/Canvas persistence | 编辑器无分类字段；重载后仅当前 Canvas 可见 |
| 在通用新建 | Browser + HTTP | 编辑器不显示分类字段，使用当前或首个可用分类；其他获授权 Canvas 可见 |
| 拖动通用分类 | Browser + HTTP | Sidebar 顺序更新并持久化；拖动预览不遮挡或劫持命中 |
| 拖动通用模板到分类 | Browser + HTTP | 模板只出现在目标分类；不打开模板编辑器 |
| 点击模板卡主区域 | Browser | 普通库按范围复制；Composer / Prompt Node 添加文字快照；编辑按钮只打开编辑器且不触发卡片主动作 |
| Prompt Generation Node 输入 `/` | Browser | 快捷选择器不显示库/分类 Tabs，直接显示全部库和分类的提示词；与节点容器等宽、固定在其上方并随 Canvas Viewport 变化持续跟随，最大高度 `18rem`；滚轮在可滚动区和边界都不改变 Canvas Viewport；Pointer 或 Enter 选择后在光标位置插入完整、展开、可直接修改的普通模板文本，生成指令保存修改后的文字且重绘后不出现模板 Token |
| 通用复制到当前画布 | Integration/Browser | 两条记录身份独立；修改任一方不影响另一方 |
| 当前画布设为通用 | Integration/Browser | 成功后当前画布消失、目标通用分类出现一次；失败保留原记录 |
| Prompt Node 快捷保存 | Browser | 无前置 Modal；创建当前画布模板并显示带“编辑”的 Toast |
| 刚编辑 Prompt Node 后立即保存 | Classic/Smart Browser + HTTP/WebSocket | 先完成 Canvas checkpoint，再保存模板；不显示 `stale_prompt_templates`，Node 与模板均保留 |
| 提示词提交期间出现新本地编辑 | Persistence integration/Browser | 新编辑保持 pending，提示词 Revision 确认后以新 Revision 提交，不丢任一侧 |
| 协作者修改其他 Canvas 内容 | WebSocket + HTTP | 当前画布模板 intent 在最新事务状态上安全重基并只生效一次 |
| 协作者修改同一模板 | Store race + HTTP | 仅一个版本成功；另一方得到 `prompt_template_conflict`，草稿保留且不覆盖 |
| 提示词响应丢失或离线恢复 | Browser + HTTP | 同一 Operation ID 重试只产生一条模板或一次删除/设为通用效果 |
| HTTP / WebSocket 乱序 | Persistence integration | 任意先后只推进一次 Revision；后续普通 Canvas Mutation 使用新 Revision |
| 修改或删除来源模板 | Browser reload | 已插入 Node/Composer 的文字快照不变 |
| 复制 Canvas | Canvas content integration | 副本带有当前画布模板，原 Canvas 不受后续编辑影响 |
| 移动 Canvas 到另一 Workspace | Workspace/Canvas integration | 当前画布模板随 Canvas 移动，通用模板不随单个 Canvas 移动 |
| 删除 Canvas | Canvas content integration | 当前画布模板一并删除，不残留可读取记录 |
| Shared/Private 权限 | HTTP/Browser | 只向获授权编辑者返回当前画布模板 |
| Anonymous Share Visitor | HTTP/Browser | 无提示词库入口，接口拒绝读取模板内容 |
| 旧 Workspace 升级 | Migration/integration | 现有模板、分类、顺序与删除结果保留，预置不补回 |
| 存量多个内部 Library | Migration/integration | 无静默删除、覆盖或内容丢失 |
| 连续触发复制或设为通用 | Integration | 单次用户意图只产生一个目标记录 |

### Human acceptance

| Role | Scene | Evidence / confirmation |
| --- | --- | --- |
| UI | Light/Dark × Desktop/Narrow | 一级范围层级清楚；当前画布没有空分类区域；状态与公共 Token 一致 |
| Interaction | Keyboard、Pointer、空范围、编辑、复制和改变范围 | 焦点顺序、Escape 优先级、Toast 编辑入口和失败恢复符合合同 |
| Product | 通用与 Canvas 边界 | 当前画布内容不污染其他 Canvas，通用内容不被误解为安装全局 |
| Security | Private/Shared/匿名 Share | 当前画布隐含提示词不向未授权访问者泄露 |

2026-08-30：用户确认上述 UI、Interaction、Product 与 Security 人工验收均已完成，并确认本功能正在现有旧 Workspace 中实际使用。这证明向前兼容读取、规范化和日常写入路径可用，但不替代发布前备份后的回退与再次恢复演练。

### Regression neighbors

- Classic Canvas 与 Smart Canvas 的 Prompt Template 应用流程。
- Composer 的普通模板文字插入、局部修改与快照行为。
- Prompt Node 与 Prompt Generation Node 的普通模板文字插入，以及历史模板 Token 的展开恢复。
- Reverse Prompt 与 Preset AI Processor 的 Prompt Library 选择。
- 通用 Category 的新增、改名、删除和排序。
- Prompt Template 搜索、封面和删除确认。
- Canvas 复制、移动、删除、Visibility 与 Share Link。
- Workspace 打开、搬迁和旧数据迁移。

## 16. Rollout, migration and rollback

1. 读取现有 Workspace Prompt Library，保留模板、分类、顺序、封面和仍受支持的隐藏兼容字段；规范化时移除旧 `scene` / `scene_en`。
2. 用户界面把现有 Workspace 范围内容呈现为“通用”，不再显示“系统提示词库”。内部兼容 ID 可以暂时保留，但不得出现在 UI 文案中。
3. 每个旧 Canvas 的当前画布模板初始化为空；不得从浏览器 `localStorage` 或通用库自动猜测并迁移内容。
4. 产品预置不重新 seed 到已经存在 Prompt Library 的 Workspace；用户删除的模板与分类保持删除。
5. 当前评审时的代表性 Workspace 状态为 12 条模板，其中 9 条为仍保留的预置、3 条为用户新增；迁移验收必须证明数量与内容不被改写，但该数量不是产品默认合同。
6. 真实旧 Workspace 的升级后兼容使用已经确认；发布前仍需备份现有 Prompt Library 数据，并完成一次只读审计、回退和再次恢复演练。
7. 如果迁移或兼容检查发现无法无损处理的多个内部 Library，停止写入并保留旧数据，不得用空库或单一默认库覆盖。
8. 回滚时通用内容继续由旧 Prompt Library 读取；新增当前画布模板必须保留在 Canvas 数据中，即使旧 UI 暂时无法管理，也不得删除。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product map | [F07 Prompt Authoring 与 Prompt Library](../PROJECT-MAP.md#功能规格注册表) |
| Domain language | [CONTEXT.md](../../CONTEXT.md) |
| Data boundary | [ADR-0001](../adr/0001-workspace-data-boundary.md) |
| Related Current behavior | [Smart Canvas 预设 AI 处理器](../current/smart-canvas-preset-ai-processors.md) |
| UI surfaces | Classic Canvas Prompt Library；Smart Canvas Prompt Library；Composer；Prompt Node |
| Implementation seams | Shared `ic-dialog` Modal Shell；Canvas Commit Lane；Classic/Smart Canvas Persistence Adapter；Canvas Store semantic Prompt intent；Workspace Prompt Library；Prompt Template Library content component |
| Existing automated tests | `tests/test_prompt_library_scopes.py`；`tests/test_canvas_store.py`；`tests/test_canvas_sync.py`；`tests/test_smart_canvas_canvas_persistence.py`；`tests/canvas_commit_lane_browser_smoke.cjs`；`tests/prompt_template_library_browser_smoke.cjs`；`tests/issue_113_prompt_library_modal_context_menu_browser_smoke.cjs`；`tests/test_issue_113_prompt_library_modal_architecture.py`；`tests/feedback_progress_browser_smoke.cjs` |
| Browser/manual evidence | `tests/prompt_library_scope_hosts_browser_smoke.cjs` 通过真实 Classic/Smart 页面验证默认范围、范围切换、普通库复制、Composer/Prompt Node 添加、刚编辑后立即保存、pending checkpoint、提示词成功后紧接普通编辑及 console/pageerror 为空；`tests/canvas_commit_lane_browser_smoke.cjs` 覆盖 409 有限安全重基、丢响应同 Operation ID、串行和同模板冲突；公共组件与 Issue #113 浏览回归继续覆盖 Sidebar/Card/Modal、右键、双击、Drop、Hand Tool 与输入框粘贴隔离；2026-08-30 用户确认人工 Gate 已完成 |

## 18. Open questions

无。产品范围、信息架构、生命周期、分类责任、复制语义、权限和预置身份已于 2026-08-21 确认。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| 2026-08-21 | Approved | 建立通用/当前画布两级范围、通用分类与当前画布无分类合同 | 产品访谈逐项确认 Q1–Q17，并确认最终共识 |
| 2026-08-21 | Implemented | 交付 Workspace 通用范围、Canvas 所有当前画布范围、复制/设为通用、Prompt Node 快捷保存及 Classic/Smart 公共组件接入 | HTTP/存储/权限/迁移测试、公共组件浏览测试、Toast 浏览测试与真实双 Canvas 页面冒烟通过；等待 Human acceptance 与发布前迁移/回退演练 |
| 2026-08-21 | Implemented | Issue #113：Modal Shell 移出 Canvas 手势根；一级范围改用 `single-label`；分类改为竖向 Sidebar，移除管理模式与移动按钮，交付末尾新建项、Item Hover Actions、分类排序及 SmartGroup 级卡片 Drag 反馈；模板编辑器移除所属分组 | 架构单测、公共组件浏览测试与真实 Smart Canvas 右键/粘贴/拖放回归通过 |
| 2026-08-21 | Implemented | Template Card 改为 1:1 全幅封面与底部 0%→80% 黑色渐变；标题和唯一编辑按钮置底；整卡主动作按普通库、Composer、Prompt Node 上下文分别执行复制或添加 | 公共组件截图目检、卡片几何浏览测试及 Classic/Smart 三上下文浏览回归通过 |
| 2026-08-21 | Implemented | 无封面 Template Card 采用已确认的“编辑页”排版与“索引卡”细网格：六组中调占位色、80% 白色高度自适应摘要、底部 10px 文字淡出、左上引号与标题/编辑动作 | 公共组件 Light/Dark 浏览回归、视觉参数与对比度断言、真实页面人工 Gate |
| 2026-08-21 | Implemented | Template Card 采用无分割线的紧凑标题区：有封面使用 `4rem`、透明→50% 黑→60% 黑的三段 Mask，标题分别为 16px/17px；编辑按钮移除容器背景与边框 | 公共组件几何/视觉浏览回归与截图目检 |
| 2026-08-21 | Implemented | Issue #117：修复当前画布提示词写入与 Canvas Revision 的严重竞态；引入共享 Canvas Commit Lane、事务内单项语义 intent、模板版本冲突保护、稳定 Operation ID 和 HTTP/WebSocket Revision 去重 | 后端 API/Store 多用户竞态、响应丢失幂等、Smart Persistence 乱序与 pending 重基、真实 Classic/Smart 页面无头 Chrome 回归通过 |
| 2026-08-21 | Implemented | Issue #119：模板新建/编辑采用已确认的实时视觉预览双栏方案；移除多层内容容器与伪字数上限，名称和封面操作在预览底部同行 | 静态共享组件合同测试、公共组件 Desktop/Narrow 几何与实时输入/文件选择检查；全量浏览回归仍被既有搜索组合态稳定性失败阻断 |
| 2026-08-21 | Implemented | Issue #119：修正 Demo 到生产的承载层级偏差；在唯一 Prompt Library Dialog 内保留背景列表，以局部 Mask 和 940px Task Surface 承载新建/编辑，避免 X-Large 白色 Workspace 吞没任务边界 | 共享组件合同测试；Chrome 真实 Smart Canvas Desktop/Narrow 的背景保留、Inert、边界、实时预览与退出层级检查 |
| 2026-08-22 | Implemented | Issue #90：Prompt Generation Node 改用结构化 Prompt Composer 并接入 `/`、`@` 快捷选择链；Mention Picker 改为无 Header/Footer 的容器锚点 Popover，支持上/下方向键循环切换高亮项；修复列表边界滚轮穿透为 Canvas Pan/Zoom | `tests/issue_90_prompt_generation_quick_picker_browser_smoke.cjs` 覆盖 `/` 打开、筛选、Pointer/方向键/Enter 选择、模板快照、重绘、Light/Dark、容器等宽、固定间距、最大高度及滚动中/边界 Wheel 所有权 |
| 2026-08-23 | Implemented | Issue #90 复审：Picker 接入统一 Canvas Viewport 更新入口，平移/缩放后持续锚定触发容器；移除主库/分类 Tabs，默认展示全部提示词且不再截断 60 条；最大高度调整为 `18rem`；模板项改为 `1.5rem` 行高的单行 `book-text` 图标、按文本内容占宽的 Regular 名称和紧随其后的分类，名称字色使用 `--ui-color-text-secondary`，当前画布模板分类统一显示“当前画布”；修复方向键 `keyup` 重绘 Picker、将高亮项复位到第一项的问题；以公共 `ic-mention-picker` 入库到“菜单、浮层与提示” | 真实 Chrome 先红后绿回归覆盖 Canvas `viewportY 0→-120` 后 `0px` 左偏差与 `4px` 间距、名称可见文字到分类 `8px` 间距、当前画布分类标签、62 条跨库/跨分类结果、288px 高度、Composer/Node 容器等宽、Light/Dark、Pointer/Enter 与 Wheel 边界所有权，以及完整 `keydown→keyup` 序列中的 `0→1→0` 方向键切换；公共组件 Chrome 合同另覆盖注册、Listbox ARIA、320px 等宽、4px 间距、288px 高度、24px 行高、8px 名称分类间距、Pointer 选择与 Wheel 隔离；静态 UI 合同覆盖组件目录、接口和样式合同 |
| 2026-08-23 | Implemented | Issue #90 同源迁移：Smart Canvas 删除旧 `div.mention-picker`、业务 HTML 拼接、定位帧与页面 CSS，直接消费公共 `ic-mention-picker`；公共模块同时支持提示词行和媒体引用行，并分离几何 Anchor 与保留焦点的 Editor Invoker；组件库并列展示内容驱动高度与 `18rem` 最大滚动高度 | Chrome 真实 Smart Canvas 验证公共 Tag、Composer 768px 等宽、左偏差 0px、上方间距 4px、最大高度 288px、行高 24px、名称分类间距 8px、滚动状态及完整按键序列 `0→1→0`；Chrome 组件库验证两种案例分别为内容高 82px/最大高 288px，均与各自容器等宽且间距 4px；输入内容已还原为空 |
| 2026-08-23 | Implemented | Issue #124：范围名称统一为“当前画布”；搜索使用 `ic-form-field-search-s`；范围计数基于完整已加载数据；空范围不再渲染专用 Empty State | `tests/prompt_library_scope_hosts_browser_smoke.cjs` 覆盖 Classic/Smart 真实页面的组件组合、Light/Dark 语义 Border、双范围计数、当前画布文案和空范围渲染 |
| 2026-08-23 | Implemented | Prompt Library Modal 默认打开“通用－全部”；“当前画布－全部”与“通用－全部”使用相同的选中视觉状态 | `tests/prompt_library_scope_hosts_browser_smoke.cjs` 覆盖 Classic/Smart 真实页面的默认范围、默认分类与两个“全部”入口的选中视觉一致性 |
| 2026-08-23 | Implemented | 公共 `ic-confirm-popover` 入库并用于分组删除；移除红色 Surface Border，只保留危险确认按钮；删除分组改为把组内模板迁入按需创建、空时隐藏且不可编辑/删除的“未分类” | 组件静态合同、Prompt Library API 集成测试与 `tests/prompt_group_delete_confirmation_browser_smoke.cjs` 覆盖取消/确认、焦点、Token、事件和迁移结果 |
| 2026-08-23 | Implemented | 单条模板删除迁移到公共 `ic-confirm-popover`；确认浮层锚定编辑器删除按钮，取消或 `Escape` 保留编辑器与外层 Prompt Library Modal | 共享组件静态合同及 `tests/prompt_group_delete_confirmation_browser_smoke.cjs` 覆盖取消、确认、事件与 Escape 层级 |
| 2026-08-23 | Implemented | Issue #126：Composer、Prompt Node 与 Prompt Generation Node 应用模板后改为插入完整展开、可直接修改的普通文本；移除模板富文本 Token 的样式、删除交互和新建路径；历史 Token 恢复时展开冻结正文 | `tests/test_smart_canvas_prompt_quick_picker.py` 覆盖静态合同与兼容迁移；`tests/issue_126_prompt_template_plain_text_browser_smoke.cjs` 在真实 Chrome 覆盖 Composer Enter、Prompt Node Pointer、立即微调、持久文本、无 Token 重绘与历史 Token 展开 |
| 2026-08-30 | Implemented | 完成 Prompt Library 人工验收与真实旧 Workspace 向前兼容使用确认；规格继续保持 Active，等待发布前备份回退演练 | 用户确认 UI、交互、产品边界、安全场景及旧 Workspace 日常使用；尚未把回退与再次恢复写成已完成 |
