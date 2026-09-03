# Smart Canvas 多选快速连线与提示词生成快捷入口

- **Status**：Implementing / drift（用户已要求开始实现；主要本地交互已实现，D22-01 协作校验边界及下列验收 Gate 尚未关闭）
- **Feature ID**：F05；关联 F06 / F07 / F13
- **Owners**：产品 / UI / 交互 / 前端 / 测试；协作提交与权限由后端参与验收
- **Last verified**：2026-09-03；消融后 15 项 Node 测试、218 项 Python 回归及真实生产页面隔离场景通过；不是全量 A01–A18 验收结论
- **Applies to**：[Issue #22](https://github.com/lazyq666/reroll-ai-canvas/issues/22)；目标发布版本待实施时确定
- **Supersedes**：无；新增行为在通过验收前不覆盖 Current
- **Superseded by**：无
- **Related ADRs**：[Workspace 数据边界](../adr/0001-workspace-data-boundary.md)、[UI 家族模块所有权](../adr/0002-ui-family-module-ownership.md)
- **Domain terms**：Smart Canvas、Node、Connection、Canvas Selection、Canvas Interaction、Canvas Mutation、Canvas Sync、Reference Input Instance、Prompt Authoring、Generation Settings

## 1. 一页摘要

创作者选中多张图片、多个提示词，或二者混选后，可以一次把这些输入接入同一个图片或视频生成节点，不再逐条拖线。单选提示词时也提供与图片一致的“生成图片/视频”快捷入口。

多选框右侧提供一个公共 Quick Add（快速添加）按钮：点击可创建下游节点；拖到空白处可在指定位置创建；拖到已有生成节点则只添加连接。多选浮动工具栏提供直接创建入口。

输入按照操作开始时的画面位置逐行排序，行内从左到右；后续移动节点不自动改序。新建节点与全部连接作为一个整体保存、撤销和重做。所有入口只准备生成结构，不自动执行 Generation Run，也不消耗 Provider 额度。

## 2. Problem Statement

- 多选后，单个节点的 Quick Add 被隐藏，选区没有对应的公共入口。
- 多选浮动工具栏没有生成入口；用户需要创建目标后逐条连接，操作成本随输入数量增加。
- 提示词浮动工具栏没有生成入口，现有图片动作处理还会提前排除没有图片的节点，不能只增加按钮。
- 现有输入读取优先使用 Connection 的记录顺序，不会自动按画面位置排序；选择顺序、视觉顺序和最终参考图编号可能不同。

## 3. Goals / Non-goals

### Goals

- 图片、提示词和受支持的混合选区一次接入一个新生成节点。
- 多选通过同一个公共输出入口接入已有图片或视频生成节点。
- 单选 Prompt Node 和具有有效输出的 Prompt Generation Node 提供“生成图片/视频”。
- 输入顺序可预测，刷新、协作同步与 Undo/Redo 后保持一致。
- 不支持的输入、失效目标或权限变化不会产生部分连接或空壳新节点。

### Non-goals

- 不增加“选区左侧批量添加共同上游输入”、多目标分发或批量执行生成。
- 多选新建只提供图片与视频生成，不扩展为新建文字生成、拆分或批量运行节点。
- 本期批量连接的已有目标仅限图片或视频生成节点，不改变其他类型的单条连线能力。
- 不自动整理、移动既有节点，不增加参考输入手动排序器或全局连线路由优化。
- 不重排历史连接，不改变 Model Capability、Prompt 合成规则或既有生成快照。
- 不新增纯键盘的“已有目标选择器”或新的移动端触控连线手势。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Administrator / Designer | 当前 Smart Canvas 已加载并具备编辑权限 | 创建节点、批量连接、撤销重做 | 绕过目标 Canvas / Project 的权限或生成模型校验 |
| Guest Account | 无 Canvas 编辑权限 | 沿用既有允许的浏览能力 | 使用本功能提交 Canvas Mutation |
| Anonymous Share Visitor | 通过 Share Link 只读访问 | 只读查看内容 | 显示可执行的生成快捷入口、创建节点或连接 |

入口可用不代替服务端授权；提交前必须重新检查权限。操作过程中失去权限时关闭菜单、清除引线并按现有 Canvas Sync 规则处理未确认变更。

## 5. User stories

1. 我选中一组参考图后，希望创建一个接好所有输入的生成节点，继续编辑 Prompt。
2. 我选中提示词和参考图后，希望二者分别成为文字输入与媒体输入，而不是把提示词复制成独立快照。
3. 我已有一个生成节点，希望追加多个输入，同时保留原来的 Prompt、设置和输入顺序。
4. 我希望连接顺序取决于画面排布，而不是先点中了哪个节点。
5. 我取消操作、遇到失效输入或撤销时，希望画布不留下半成品；重连时也不重复创建。

## 6. User journey and interaction contract

### 6.1 入口与完成行为

| Entry | Action | Result |
| --- | --- | --- |
| 多选浮动工具栏“生成图片/视频” | 点击 / Enter / Space | 创建一个默认图片模式的生成节点，连接全部来源；之后可切换视频模式 |
| Prompt Node / 有效 Prompt Generation Node 浮动工具栏“生成图片/视频” | 点击 / Enter / Space | 同上，来源为该提示词节点 |
| 多选框右侧公共 Quick Add | 点击 / Enter / Space | 打开“图片生成 / 视频生成”菜单；选择后新建并连接 |
| 公共 Quick Add → 空白处 | 拖动并松手 | 在松手位置打开同一类型菜单；选择后按精确落点新建并连接 |
| 公共 Quick Add → 已有合法生成节点 | 拖动并松手 | 不打开创建菜单；只将缺少的输入连接追加到目标 |

- 工具栏文案统一使用现有“生成图片/视频”，Issue 原文中的“生成图片/节点”不作为产品名称。
- 多选工具栏将生成入口放在排列操作前，以 Divider 分隔；保留现有排列、下载和资产库操作。
- Prompt 工具栏保留聚焦编辑与复制功能；生成入口不受“必须包含图片”的条件限制。
- 有两个及以上选中 Node 时，在整个选区外框右侧垂直中点显示一个公共输出按钮；选中成员的单独 Quick Add 继续隐藏。不增加左侧公共按钮。
- 公共按钮表示整个选区的操作资格，不能把多选悄悄收缩成一个活动 Node。缩减到单选后恢复现有单选行为。
- 成功后选择新建或已有目标，清除来源多选，显示该目标现有的生成编辑区域；不自动聚焦文字输入、不自动执行生成。
- 打开菜单、开始拖动和取消均保留来源选择。Escape、点击菜单外部、主动改变选择、切换 Canvas 或切换工具取消未提交操作，不创建 Undo 记录；主动改变选择时保留用户的新选择。
- 松手落在不合法节点、工具栏、Dialog、Composer 等非空白交互表面时，取消连接并按需说明原因；不能把失败命中当作空白处新建。

### 6.2 可观察状态

| State | User sees | Exit / recovery |
| --- | --- | --- |
| ready | 公共按钮与生成入口可用 | 打开菜单、拖线或改变选择 |
| unavailable | 入口不可用，并可通过 Tooltip / 可访问描述读取原因 | 移除不支持节点、补齐输入或完成运行后恢复 |
| dragging | 来源选择保持；从公共输出端到指针的一条临时引线；合法目标高亮 | 松手或 Escape；不预览新节点尺寸，不逐条提交连接 |
| menu-open | 类型菜单与公共按钮锁定，不因 Pointer 移出而消失 | 选择类型提交；Escape / 外部点击取消 |
| committing | 使用现有 Canvas Sync 提交反馈；同一动作不能重复提交 | 权威确认、明确拒绝或进入现有同步恢复 |
| success | 目标被选中，完整输入可见 | 编辑、手动运行、Undo |
| no-op | 所有来源已经接入，提示“所选节点已全部连接” | 保留原图结构和选择，不创建 Undo 或更新 Canvas 时间 |
| failure / forbidden | 明确原因，无本次新增的残留节点或部分连接 | 修正来源或权限后重新发起 |
| offline / recovering | 新操作禁用；已发出的操作沿用现有同步恢复反馈 | 恢复后按原 Operation ID 确认，不另建一次操作 |

### 6.3 输入、焦点和命中

- 公共 Quick Add 与工具栏入口进入既有 Tab 顺序；Enter / Space 激活，菜单方向键导航与 Escape 关闭沿用公共 Menu 合同。
- 通过键盘关闭菜单后焦点回到公共按钮；按钮因选择变化消失时回到 Canvas。Pointer 取消不抢占文本编辑焦点。
- 文本编辑、现有多选移动 / 缩放、Space 平移和中键平移不被新增入口接管。
- 公共按钮、拖线、目标高亮和点击接收者使用同一个命中结果，遵守[连线与 Quick Add 命中优先级](../current/smart-canvas-connection-quick-add-hit-priority.md)。选区透明内部不能遮住目标 Node。
- 本期已有目标批量连接为 Pointer 手势；Keyboard 可完成新建并连接及取消，不承诺纯键盘选择已有目标。

### 6.4 布局与主题

- 沿用生产 Smart Canvas 的 Desktop / Narrow、Light / Dark 和远近景规则；公共按钮不因缩放变成不可操作的小点。
- 窄窗口内工具栏和菜单遵守现有浮层边界与溢出方案；不把按钮挤到 Canvas 外，不通过换行改变画布坐标。
- 公共按钮的真实锚点不在视口内时不伪造贴边端口；可见的多选工具栏仍提供创建入口。虚拟化不能遗漏屏幕外已选来源。

### 6.5 文案与国际化

所有文案在实施时进入共享 i18n，同次提供中英文。静态文字使用 `data-i18n-*`，动态值通过 `tr` / `trf`；本次仅定义文案，不提前修改运行时资源。

| Use | 中文 | English |
| --- | --- | --- |
| 工具栏，复用现有键 | 生成图片/视频 | Generate image/video |
| 公共按钮可访问名称 | 将 {count} 个节点连接到生成节点 | Connect {count} nodes to a generation node |
| 类型菜单 | 图片生成 / 视频生成 | Image generation / Video generation |
| 不支持的节点 | 所选内容包含不支持连接的节点，请调整选择 | Some selected nodes cannot be connected. Update your selection. |
| 缺少有效输入 | 所选内容包含没有可用输出的节点 | Some selected nodes have no available output. |
| 运行中 | 请等待所选节点或目标节点运行完成 | Wait for the selected nodes or the target node to finish running. |
| 来源或目标失效 | 来源或目标已变化，请重新连接 | The source or target has changed. Connect again. |
| 重复连接 | 所选节点已全部连接 | All selected nodes are already connected. |
| 全部回退 | 连接失败，未保留本次更改 | Couldn't connect the nodes. No changes from this action were kept. |

数量只用于按钮描述和明确结果，不在工具栏主标签中堆叠状态。权限、离线与同步错误优先复用既有文案。

## 7. Functional rules

### 7.1 来源资格与输入内容

来源资格先于创建检查；同一规则服务工具栏、公共 Quick Add、拖线提交和重试。

| Source | 本期规则 |
| --- | --- |
| Image Node | 至少具有一个按现有输出规则可引用的媒体；图片、视频、音频沿用已有媒体身份，不因此保证任意 Model 都支持 |
| Prompt Node | 有非空 Prompt；作为文字输入连接，不复制到目标 Composer 正文 |
| Prompt Generation Node | 当前没有运行且具有非空生成输出；引用输出 Prompt，不引用生成指令，不自动运行来源 |
| 已有图片 / 视频生成结果 | 当前没有运行且具有有效输出；沿用既有活动输出及 `sourceOutputId` 绑定规则，不展开整个历史画廊 |
| Smart Group | 作为一个来源 Node，按已有成员顺序输出；递归成员须属于本表支持的内容类型并具有有效输出，不自动执行成员 |
| Frame、Text Annotation、Brush Stroke | 不参与连接；混入选区时整个动作不可用，不静默过滤或展开 Frame |
| Splitter Node、Batch Run Node | 本期多选入口不支持，包括 Group 内成员；不改变它们既有的单条连线能力 |
| 空节点、无可用输出、运行中节点 | 整个动作不可用，说明原因；不创建空壳目标，也不触发上游运行 |

- 若同时选中 Group 和其成员，只保留最外层选中 Group 作为来源，成员不重复连接；公共按钮描述使用归一化后的来源数量。
- Group 的嵌套身份、成员顺序和展开方式沿用现有规则，重复媒体不按 URL 去重。来自不同来源的同一媒体仍是不同 Reference Input Instance。
- 普通多媒体 Node 沿用内部已有顺序；生成输出 Node 只引用当前规则确定的输出。拖线或菜单打开后，来源输出身份或 Group 成员关系变化时取消并提示重新连接。
- 空间排序不冻结 Prompt 正文。成功建立的文字 Connection 保持现有动态引用语义，后续修改 Prompt 可影响未来运行。

### 7.2 视觉顺序

1. 操作开始时冻结归一化后的来源 ID、世界坐标矩形与顺序；工具栏点击、Quick Add 打开菜单、开始拖线均为各自的开始时点。选择先后、DOM 顺序、缩放和平移不参与排序。
2. 按视觉行从上到下、同行从左到右读取。行识别复用[选区整理](../current/smart-canvas-selection-arrangement.md)的上边界 / 纵向中心容差原则：一行整体的上边界跨度或中心跨度不超过 `max(16 世界单位, 行内最小节点高度 / 2)` 时允许同属一行。
3. 为避免散点或重叠时歧义，先按纵向中心、上边界、横向位置、Node ID 的顺序处理来源；若可加入多行，选择与该行平均上边界或平均中心距离较小的一行，平局取较早建立的行。不允许仅凭相邻节点连续接近而把超出整体容差的多行串成一行。
4. 行按平均纵向中心从小到大排列，平局按最小上边界、最小横向位置、最小 Node ID。行内按左边界、上边界、Node ID 排序；ID 使用与界面语言无关的稳定比较。
5. 不要求来源形成完整宫格；允许行内空洞和最后一行不满，不移动节点、不生成新的宫格布局。
6. Group 按整体矩形参与外部排序，内部保持成员顺序。媒体编号按有序来源展开后的媒体列表分配；文字来源保持相对顺序，并沿用 Prompt Authoring 的既有合成层级和重复文本处理，不把图片与文字硬合成一种编号。
7. 在同一顺序下创建持久 Connection，并同步兼容的输入身份列表；不得只重排展示缩略图或 `inputNodeIds`，却保留另一套实际运行输入顺序。
8. 后续移动、缩放、排列来源不会自动改序。刷新、Undo/Redo、重连与其他协作者看到的输入相对顺序必须一致；既有输入被用户显式修改后，以新的编辑结果为准。

例：相同高度为 100 的四个节点 A(0,0)、B(300,8)、C(0,240)、D(300,246)，无论点击顺序是否为 D、B、A、C，连接均为 A、B、C、D；A/B 的轻微纵向错位不改变同行顺序。

### 7.3 新建目标与 Generation Settings

- 所有创建入口只产生一个生成节点与全部来源到该目标的输入 Connection；不创建 Pending Node 或 Generation Run。
- 工具栏默认图片模式；Quick Add 按用户选择的图片 / 视频模式初始化。两种模式可按现有 Composer 行为切换。
- 单来源沿用现有参考生成设置；多来源使用视觉顺序第一项作为设置来源，并沿用现有按模式的最近设置与合法性回退，不混合多套来源设置。不复制来源的运行状态、Prompt 正文或已有参考输入到新目标。
- 新节点保留可编辑的生成身份，不能变成只有上传能力的普通空 Image Node。
- 当前模型不能处理某些输入或超过参考数量上限时，保留完整连接；沿用生成前校验阻止不合法运行，不在连接阶段悄悄截断、改序或换模型。

### 7.4 连接到已有目标

- 目标必须在同一 Canvas、可编辑、未运行，并已有图片或视频生成身份；不自动把普通媒体 Node、Prompt Node 或 Group 改造成目标。
- 目标不能属于归一化前的来源选区或其 Group 成员；拒绝自连与会新引入有向循环的连接，不借本功能修复历史循环。
- 保持目标既有输入的相对顺序与设置；仅将缺少的输入 Connection 按本次视觉顺序追加到末尾。既有文字、媒体、引用角色、Composer 内容、生成结果和历史运行快照不得覆盖。
- 同一来源与目标已存在的输入 Connection 视为满足；不重复创建、不改变其已绑定的输出。已有其他种类的 Connection 不等于已存在输入 Connection。
- 若全部已连接，按 no-op 处理；部分已连接时，只新增剩余连接，Undo 只移除本次新增部分。

### 7.5 新节点落位

- 点击入口创建：以归一化后来源的整体外接矩形作为来源，优先向右并自动避让；同一 Frame 内的来源遵守现有分区放置规则，来源跨 Frame 时以 Canvas 为范围。不选择最后点击的单节点作为锚点。
- 拖到空白处创建：松手点固定为新节点左边缘垂直中点，即使向左拖动或与既有节点重叠也保留精确落点；类型切换不能改变该边缘锚点。
- 复用[Node 自动避让规格](../current/smart-canvas-node-auto-placement.md)，不移动既有节点、不自动扩大 Frame。新节点位置与连接属于同一次 Mutation。

### 7.6 原子性、失败与恢复

- 全部来源、目标、重复项、连接合法性和几何先校验，再一次提交。任何非重复项失败时，整个动作失败；不能保留新节点与部分成功连接。
- 新建与连接、或多条追加连接只产生一个 Undo 和一个逻辑 Canvas Mutation。没有远端冲突时，Undo/Redo 恢复精确节点身份、位置、输出绑定及连接顺序，不重新排序或寻找位置。
- 开始后的来源移动不改变冻结顺序；点击式自动落位在提交时使用最新有效几何，显式拖线落点保持不变。来源删除、归组关系改变、输出身份失效或目标运行 / 删除时取消。
- 若较新 Canvas Revision 仍允许完整意图成立，沿用 Canvas Sync 协调后整体提交；不能成立则整体拒绝，不自动丢弃失效来源后提交剩余部分。
- 断线前已发出但确认未知的操作保留同一 Operation ID，重连后查询 / 重放既有意图；不生成新 ID 或重复目标。未发出的操作离线时不接受新的提交。
- 并发追加按服务端确认次序成为连续输入块，各块内部保持冻结顺序。已有同来源连接按去重规则处理，不覆盖其他协作者新加的内容。
- 撤销遵守既有协作安全规则：不能用旧整图快照覆盖远端修改；若远端编辑让完整撤销不再安全，明确提示冲突，不承诺强制删除他人引用或恢复旧图。

## 8. Domain and state model

没有新 Node 类型或新领域对象。公共 Quick Add 是 Canvas Selection 的临时交互入口，不是实体 Node，也没有需要保存的“选区端口”。

一次 Canvas Interaction 持有来源身份与顺序、可选已有目标或显式落点、请求媒体类型；只有确认动作产生 Canvas Mutation。新建 Node 和 Connection 属于 Canvas，Generation Run 在用户之后明确点击运行时才开始。

“顺序冻结”只固定本次连接顺序及需要绑定的媒体输出身份，不把所有未来 Prompt 与 Group 内容永久冻结成快照；运行快照继续由 Generation Run 负责。

## 9. Data and persistence

| Data | Authority / boundary | Recovery |
| --- | --- | --- |
| 来源选择、拖线、菜单与未提交排序 | 当前编辑端临时状态，不属于 Workspace Data | 切换 Canvas / 重载后取消，不广播 |
| 新目标身份、坐标、Generation Settings、Connection 顺序与输出绑定 | 现有 Canvas Store，属于 Workspace Data | 现有保存、备份、加载、Undo/Redo 与 Canvas Sync |
| Operation ID 与确认结果 | 现有 Canvas Mutation / Canvas Sync | 重复提交返回既有结果，不重复建图 |
| 媒体内容 | 既有 Managed Media 或合法媒体引用 | 本功能只建立引用，不复制、下载、发布或删除媒体文件 |

不引入新的排序存储、持久选区或跨 Workspace 数据。不迁移旧 Canvas 的顺序；序列化与重放必须保留既有 Connection 列表和兼容输入列表的顺序。

## 10. API / WebSocket / Provider contracts

- 不新增公共 HTTP 路由、WebSocket 消息类型或 Provider 接口；复用现有 Canvas Mutation、Revision、Operation ID 与授权通道。
- 对外结果为完整成功、无变化、明确拒绝或确认未知 / 恢复中；不能报告部分连接成功。
- 新增端点失效与原子提交验收，但不引入允许任意前端写入持久选区或预览状态的字段。
- 点击、拖线、菜单取消和连接成功均不得请求 Provider。后续手动生成仍走[Generation Pipeline](../current/generation-pipeline.md)，预览参考顺序与提交顺序使用同一 Prompt Authoring 解析结果。

## 11. Security and privacy

在入口展示、提交与服务端应用 Mutation 时遵守既有权限边界；过期页面不得通过隐藏入口调用绕过。只读分享页不获得编辑动作。失败提示不包含 API Key、绝对文件路径或其他 Canvas 的私有节点内容。

## 12. Performance and reliability constraints

- 不为每个来源单独请求保存或广播；Pointer 移动只更新临时引线与目标命中，不反复排序或进行全量持久化。
- 不因虚拟化、远景或性能原因只连接可见来源、静默截断列表或改变顺序；沿用已有 Canvas 容量边界，不新增未经测量的节点数量承诺。
- 菜单锁定、重渲染、Pan/Zoom 和语言切换不丢失操作来源；重复 Pointer / Keyboard 激活不重复提交同一待完成意图。

## 13. Design system contract

- 复用 `ic-canvas-multi-selection`、`ic-smart-node-toolbar`、`ic-button`、`ic-icon-button`、`ic-icon`、`ic-divider` 和 `ic-menu` 的既有尺寸、Focus 与层级合同。
- 公共选区输出按钮扩展 Node 家族的公共选区呈现能力；页面提供资格、数量、投影范围和事件处理，公共组件不访问 Canvas Store 或执行生成。
- 单节点与选区 Quick Add 复用视觉和命中状态语义，不在页面内复制一套组件私有样式；组件内部结构遵守 ADR-0002。
- 不新增 Design Token、页面或独立样板交互实现；生产页面和组件库应消费同一公共能力。
- 自动截图验证边界、主题和焦点；人工验收确认公共按钮能清晰表达“整个选区共同输出”，二者不能互相替代。

## 14. Implementation decisions

- 提炼一个共享的多来源计划与提交入口，负责资格、Group 归一化、视觉排序、去重和失败语义；单选 Prompt、工具栏与公共 Quick Add 不分别实现业务规则。
- 纯排序与资格规划不依赖 DOM；沿用选区整理的几何原则，但不调用会移动既有 Node 的整理动作。
- Canvas Mutation 拥有一个完整的创建 / 连接事务；Canvas Persistence / Canvas Sync 继续拥有提交、冲突与确认。只循环调用当前单来源创建函数会创建多个目标，不满足本规格。
- Connection Layer 只负责已提交连接和临时拖线呈现；Prompt Authoring 保持最终输入解析权威。新业务逻辑进入 Smart Canvas 的职责模块，宿主只协调交互。
- 建议先完成共享能力、Prompt 与多选工具栏，再接入公共 Quick Add 的点击和拖动；两部分都满足验收前不能宣称 Issue #22 完成。

## 15. Acceptance and testing

### Highest test seam

以真实 Smart Canvas 页面上的选择、工具栏、Pointer / Keyboard、参考缩略图及刷新结果作为主要外部验收入口；配合真实 Canvas Mutation / Canvas Sync 的隔离 Workspace 测试验证保存、权限、幂等和并发。函数片段检查或直接调用内部事件处理器不能代替真实 Pointer 验收。

### Automated acceptance

| ID | Scenario / seam | Expected external behavior |
| --- | --- | --- |
| A01 | 三张图片多选 → 工具栏，浏览器 | 一个图片模式生成节点、三条输入连接、来源不移动、没有 Provider 请求 |
| A02 | 单个 / 多个 Prompt；Prompt Generation，浏览器与输入解析 | 有效入口；引用人工 Prompt 或已生成输出，不引用生成指令，不自动执行上游 |
| A03 | 图文混选，浏览器与模拟 Provider 提交捕获 | 文字、媒体各自保持来源相对顺序；预览、参考编号和最终输入解析一致 |
| A04 | 两行错位、不同尺寸、行内空洞、重叠和散点，纯规划 + 浏览器 | 稳定行顺序；选择顺序、UI 语言、Pan/Zoom 不改变结果；不触发布局整理 |
| A05 | Group 与成员重复选择、嵌套 Group、相同 URL 的不同来源 | Group 不重复接线；内部顺序保留；独立 Reference Input Instance 不按 URL 合并 |
| A06 | Frame / 标注 / Splitter / Batch Run 混选、空来源、运行中来源 | 整个入口不可用，有明确原因；没有静默忽略或残留目标 |
| A07 | 公共 Quick Add 点击与 Keyboard 菜单 | 可选图片 / 视频；创建模式正确，之后可切换；焦点与选区行为符合合同 |
| A08 | 公共 Quick Add 向左 / 右拖到空白，真实 Pointer | 类型菜单打开；左边缘中点等于松手点，重叠不被自动移开，取消无变更 |
| A09 | 点击创建，同 Frame / 跨 Frame / 来源附近拥挤 | 以整体来源落位并避让，范围正确，既有节点与 Frame 尺寸不变 |
| A10 | 追加到已有目标，已有部分 / 全部相同输入 | 原输入、Prompt、设置保留；只追加缺项；全部已接入为 no-op |
| A11 | 非生成目标、自连、Group 内部目标、新循环、目标运行中 | 拒绝整个动作，不降级为空白处创建；不污染既有连线 |
| A12 | Escape、点击外部、换工具、换 Canvas、重复激活 | 清除临时态；未提交操作不留 Undo，提交中的同一意图最多执行一次 |
| A13 | 新建 / 追加后 Undo、Redo、刷新 | 整体恢复精确身份、坐标、顺序和输出绑定；旧输入不被删除 |
| A14 | 来源移动 / 删除、Group 改成员、输出切换、权限撤销 | 移动不重排；身份失效或无权限整体拒绝，无悬空连接或部分成功 |
| A15 | 两编辑端并发追加、过期 Revision、确认前断线后重连 | 按提交次序保留完整输入块；同 Operation ID 幂等；远端修改不被旧 Undo 覆盖 |
| A16 | Model 不支持某媒体 / 超出参考数量 | 连接不截断；手动运行前明确阻止请求，不偷偷换模型或消费额度 |
| A17 | 只读分享与无权限账号，浏览器 + 服务端 | 无可执行入口；直接提交同样拒绝，无 Canvas 内容变更 |
| A18 | Light/Dark、窄窗口、远景、屏幕外来源、语言切换 | 按钮不裁切、来源不遗漏；焦点和动态文案正确；选区移动 / 缩放无回退 |

### Human acceptance

- UI：Light/Dark × Desktop/Narrow 检查多选工具栏密度、公共按钮层级、Tooltip 与菜单边界。
- 交互：真实 Pointer 体验点击 / 拖线阈值、已有目标高亮、取消、Frame 命中与选区移动 / 缩放；Keyboard 检查新建路径与焦点恢复。
- 产品：确认图文混选、两行错位排序、已有目标追加和一次撤销；确认“生成”快捷入口不会直接启动任务。
- 协作：两个独立编辑端验证同时追加、来源删除、断线重连及撤销冲突。模型输入顺序先用隔离模拟 Provider 验证，不以本功能验收为由自动发起付费生成。

### Regression neighbors

单节点左右 Quick Add、文字 / 图片 / 视频创建、活动生成输出绑定、Prompt Authoring、参考实例身份、多选排列、编组与分区、节点自动避让、现有连接命中、只读分享、Canvas Sync 及安全 Undo。

### Implementation verification — 2026-09-03

- `node --test tests/smart_canvas_multi_input.test.cjs tests/smart_canvas_multi_input_transactions.test.cjs`：13 项通过。覆盖稳定视觉行、整体资格、Group 归一化、冻结顺序、输出身份变化、目标去重 / 循环、新建与追加的整体 Undo/Redo、失败前置校验、Frame 边界、失败回退和整体来源重落位。
- `.venv/bin/python -m unittest tests.test_smart_canvas_multi_input_realtime tests.test_smart_canvas_canvas_mutation tests.test_smart_canvas_canvas_persistence tests.test_smart_canvas_node_placement tests.test_smart_canvas_node_placement_architecture tests.test_smart_canvas_reference_instances tests.test_smart_canvas_node_ports tests.test_smart_canvas_selection_arrangement tests.test_smart_canvas_floating_ui tests.test_canvas_realtime tests.test_canvas_sync tests.test_canvas_sync_contract tests.test_documentation_knowledge_map`：218 项通过。其中新增 4 项服务端测试验证批量创建 / 幂等 / Undo/Redo、删除来源后的原子拒绝、并发 Connection 追加顺序及他人撤销权限。
- 真实页面通过 `node tests/issue_22_multi_input_browser_app.cjs` 提供隔离 fixture，打开 `/fixture.html?componentReview=nodes`。测试控制条只提供场景设置和可见状态检查，不加载真实 Workspace 或执行 Provider；界面操作通过真实 Pointer / Keyboard 完成。
- 已观察：逆序选择 A/B/C/D 后工具栏和菜单只创建一个目标，输入均为 A→B→C→D；Prompt 单选与图文混选保留文字引用；拖至已有目标追加全部输入；拖至屏幕 `(600,580)`、缩放 `0.7` 时目标左边缘中点为世界坐标 `(857.142857…,828.571428…)`；视频菜单创建正确类型；Undo/Redo 完整恢复同一目标 ID 和连接顺序；空来源整体禁用，中英文原因切换正确；Light/Dark；Enter / Space 打开菜单及 Escape 取消。
- 浏览器测试发现并修复了拖线后合成 Click 清空选区，以及 Space 激活公共按钮被全局画布平移抢占的问题。
- 尚未通过：真实双编辑端 / 断线重连 / 刷新持久化端到端、模拟 Provider 最终提交捕获、完整 Narrow / 远景 / 屏幕外来源矩阵、人工视觉与交互验收。上述单元与服务端测试不能替代这些 Gate。

### 消融实验与简化 — 2026-09-03

本轮按用户要求精简实现，不删减上述产品行为，不增加协议字段。判断标准是调用方需要理解的规则和状态是否减少、原有行为是否保留，而非单纯合并文件或压缩行数。

先补齐真实 Canvas Persistence 一次发送完整连接块的测试，得到 14/14 基线；随后用临时的内存源码变体逐项关闭机制，生产文件在对照阶段保持不动。结果如下：

| 消融项 | 对照结果 | 决定 |
| --- | --- | --- |
| 视觉行识别改成简单 y/x 排序 | 13/14；轻微错位的同行顺序测试失败 | 保留视觉行规则 |
| 删除来源身份指纹比较 | 13/14；输出切换后仍被视为有效 | 保留来源快照检查；不把前端检查当作服务端并发保证 |
| 删除循环检查 | 13/14；目标能反向接回来源 | 保留循环检查 |
| 删除立即保存前的定时保存调度 | 14/14；真实 Persistence 仍一次发送完整操作 | 删除重复调度，保留立即提交 |
| 删除为 transient 演示页新增的本地 Redo | 13/14；仅原本的本地快照 Redo 断言失败 | 删除演示专用 Redo 栈和公开 transient 状态；改用真实 Mutation / Persistence 的确认与反向 Operation ID 测试，生产协作 Undo/Redo 保持不变 |
| Group 成员遍历与资格检查合并 | 最终 15/15；嵌套、重复成员、内部目标排除与循环均通过 | 一次递归检查，删除重复遍历及重复来源列表 |
| 去掉调用方固定传入的布局 intent | 自动落位 / Frame 测试通过 | 布局规则由 `connectSources` 自己持有；调用方只给来源、目标或新节点及可选落点 |
| 删除多选菜单显式落点标志及自动创建的占位坐标 | 浏览器点击自动避让、拖线精确落点均保持 | `point === null` 表示自动落位，坐标对象表示显式落点，不再保存第二个布尔状态 |
| 收回仅供测试调用的 `visualOrder` 导出 | 排序测试改从生产使用的 `capture` 入口观察，全部通过 | 纯规划 Module 只公开 `capture / validate / target`；保留纯规划与浏览器协调的实际职责分离 |

最终生产代码较本轮开始净减少 39 行，未引入通用工厂、可替换策略或新的测试框架。临时消融脚本不进入仓库。`tests/issue_22_multi_input_browser_harness.js` 移除仅适用于旧演示历史的 Undo/Redo 按钮；上节初次实现的演示页 Undo/Redo 结果只是历史观察，不再作为当前撤销路径的验收证据。

最终验证：

- `node --test tests/smart_canvas_multi_input.test.cjs tests/smart_canvas_multi_input_transactions.test.cjs`：15 项通过，新增真实持久化发送、接收确认、Undo/Redo 引用服务器操作身份的完整客户端测试；不再为让演示测试通过而给生产模块增加第二套 Redo。
- 上节 Python 完整命令重新运行：218 项通过；服务端批量创建、幂等、原子拒绝和 Undo/Redo 仍在原始事务实现上验证。
- 真实页面复测：多选工具栏图片创建、Space 菜单视频创建、拖至空白精确落点、已有目标追加、重复连接 no-op 均保持 A→B→C→D 和原有坐标行为。此结果不覆盖前述未通过 Gate。

D22-01 继续作为独立协作缺口跟踪。本轮没有批准或实施协议扩展，也没有通过删除验收要求将其伪装成已解决。

## 16. Rollout, migration and rollback

- 先完成实现与风险相称的自动化、真实浏览器、人工及双端协作 Gate；本实现状态不表示上述场景已全部通过。
- 保持旧 Canvas 数据格式，不迁移或重新排序已有图。回退 UI 后，已创建节点和连接仍应被旧版本读取。
- 若实施中发现既有 Mutation 协议无法实现原子校验或稳定顺序，先修订本 Spec 并评审兼容方案，不能用多次独立保存替代合同。
- 修改公共 Node UI 时运行并检查 UI 资产版本同步；新增文案必须通过 i18n 校验及语言切换。Push 时再按项目规则更新发布 VERSION 与 update-notes，文档起草不提前改版本。
- 完成后按[文档毕业规则](../agents/change-documentation.md)核对相关 Current：交互 / 命中、自动落位、UI 指南；输入和同步合同有事实变化时再更新其权威，不复制整份规格。通过全部 Gate 前不关闭 Issue，不把 F05 标为已完成。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Issue | [#22：交互优化](https://github.com/lazyq666/reroll-ai-canvas/issues/22)；标题建议为本文标题，尚未修改远端 |
| Product map | [F05：Smart Canvas 创作与交互](../PROJECT-MAP.md#功能规格注册表) |
| Existing contracts | [选区整理](../current/smart-canvas-selection-arrangement.md)、[节点自动避让](../current/smart-canvas-node-auto-placement.md)、[命中优先级](../current/smart-canvas-connection-quick-add-hit-priority.md)、[UI 指南](../current/ui-design-guidelines.md) |
| Input / sync authorities | [Generation Pipeline](../current/generation-pipeline.md)、[Canvas Sync](../current/canvas-sync-implementation.md) |
| UI / implementation seams | `multi-input.js` 负责纯资格 / 排序 / 目标规划；`multi-input-controller.js` 负责选择快照与交互协调；`canvas-mutation.js` 的 `connectSources` 一次修改完整图；`canvas-persistence.js` 负责提交 / 拒绝回退；公共 `nodes/multi-selection.js` 只呈现按钮，不访问画布业务 |
| Existing regression entry points | `tests/test_smart_canvas_canvas_mutation.py`、`tests/test_smart_canvas_selection_arrangement.py`、`tests/test_smart_canvas_reference_instances.py`、`tests/test_smart_canvas_node_ports.py`、`tests/test_canvas_sync.py`、`tests/test_canvas_sync_contract.py` |
| Existing browser neighbors | `tests/smart_canvas_multi_selection_toolbar_browser_smoke.cjs`、`tests/smart_canvas_reference_creation_placement_browser_smoke.cjs`、`tests/smart_canvas_hit_priority_browser_smoke.cjs` |
| Verification evidence | 见第 15 节实际命令、已观察场景与未完成 Gate；不以相邻回归通过替代完整 A01–A18 |

## 18. Open questions

**D22-01 — 服务端语义前置条件（未决，阻止完成）**：现有协议保证整批 Mutation 的结构原子性、端点存在、授权和幂等，但不表达“来源输出 / Group 成员仍等于操作开始时，且目标尚未运行”的条件。当前实现在前端等待先前修改同步后重新校验；服务端接受之前的极短并发窗口仍可能改变这些状态，也可能在并发连线时形成新循环。不得把它记为 A14 / A15 已完全满足。

待评审方案：在现有 Mutation 消息中增加可选、非持久化的语义校验条件，由服务端在同一个提交锁内检查；不新增路由或消息类型、不改变旧客户端的普通操作、不迁移 Canvas 数据。确定字段、幂等内容校验、重试与拒绝行为后再实施。已向用户请求该小幅协议扩展的许可；在决定前不擅自修改服务端协议。

并发追加的真实 Connection 顺序已有测试；兼容 `inputNodeIds` 数组仍沿用既有整字段同步，两个客户端并发写同一目标时可能不包含对方新输入（Prompt Authoring 优先读 Connection）。该兼容数组收敛及实际前端追加的协作 Undo 冲突也必须纳入双端 Gate，不能只凭服务端 Connection 测试宣称完整通过。

## 19. Change log

| Date | Status | Change | Evidence / decision |
| --- | --- | --- | --- |
| 2026-09-03 | Draft | 将 Issue #22 评审落为范围、交互、排序、原子性与验收合同 | 用户请求形成 Spec；仅完成文档，不表示功能已实现 |
| 2026-09-03 | Implementing / drift | 落地工具栏、公共 Quick Add、视觉排序、整体 Mutation 与回退；补充真实页面验证及 D22-01 协作协议缺口 | 用户要求开始实现；已通过的测试与未完成 Gate 分别记录，Issue 保持 In Progress |
| 2026-09-03 | Implementing / drift | 消融冗余历史、重复调度 / 遍历 / 状态及固定参数，保留有失败证据的必要校验 | 15 项 Node、218 项 Python 及主要浏览器路径通过；D22-01 和完整验收 Gate 不变 |
