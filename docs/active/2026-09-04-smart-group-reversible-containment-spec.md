# Smart Group 可逆编组与成员还原

- **Status**：Implemented / Review pending（2026-09-04 已完成本地实现与自动化回归；真实双端协作、Keyboard / Focus、Reduced Motion 和发布前人工 Gate 尚未完成）
- **Feature ID**：F05；关联 F06 / F09 / F13
- **Owners**：产品 / UI / 交互 / 前端 / 后端 / 测试
- **Last verified**：2026-09-04；Smart Container、Canvas Interaction、Mutation / Persistence、Realtime 校验、Viewport / Minimap、只读分享和 i18n 自动化通过；真实双端及人工 Gate 待验证
- **Applies to**：[Issue #28](https://github.com/lazyq666/reroll-ai-canvas/issues/28)；目标发布版本 `2026.09.04.2`
- **Supersedes**：无；通过验收前不覆盖[Smart Canvas 编组与分区命名](../current/smart-canvas-container-terminology.md)或其他 Current 行为
- **Superseded by**：无
- **Related ADRs**：[UI 家族模块所有权](../adr/0002-ui-family-module-ownership.md)、[Smart Group 成员权威与有序投影](../adr/0010-smart-group-member-authority.md)
- **Domain terms**：Smart Canvas、Node、Image Node、Smart Group、Smart Group Node Member、Smart Group Media Member、Node Rest Geometry、Group Presentation、Connection、Frame、Canvas Interaction、Canvas Mutation、Canvas Sync、Canvas Revision、Operation ID、Generation Run、Node Package

## 1. 一页摘要

Designer 使用 Smart Group 把多种 Node 或直接加入的媒体作为一个有序整体进行整理、移动、预览、下载和生成。编组可以在内部把内容显示得更紧凑，但这种紧凑只属于 Group Presentation，不能悄悄改小成员真实尺寸、删除原 Node、丢失生成状态或改写成员自己的 Connection。

对进入编组前已存在的 Smart Group Node Member，创建编组、移入、整理、缩放、拖出和解散必须形成可逆往返：Node 身份和语义状态始终不变，离开编组时恢复 Node Rest Geometry。直接上传或粘贴到编组、此前没有独立 Node 身份的媒体是 Smart Group Media Member；它被拖出或随编组解散时才创建新的 Image Node。

本规格把“解散编组”和“删除编组”定义为不同意图：解散保留内容，删除移除编组及其拥有的内容。成员关系、顺序、几何、Connection 变化与容器消失必须作为一次 Canvas Mutation 提交，并在保存重载、Undo/Redo、复制粘贴和多人协作后保持同一结果。

## 2. Problem Statement

- 当前 Smart Group 为了显示紧凑，会直接改写非图片成员的坐标和尺寸；解散后这些 Node 仍保持缩小状态。
- 当前 Image Node 加入 Smart Group 时会被拆成媒体并删除原 Node；解散时再创建新的 Image Node，导致身份、尺寸、生成状态、元数据和部分 Connection 无法还原。
- 当前编组缩放继续修改成员真实几何，用户无法判断是在调整容器外观还是永久编辑内容。
- Node 成员和直接媒体分别存放，不能可靠表达跨类型的一个有序成员列表。
- 跨编组拖动缺少唯一所有权约束；保存迁移、Connection、Frame、复制粘贴、实时协作和生成任务也没有共同的可逆边界。
- 因此 Issue #28 表面是“解散后尺寸过小”，实际是 Smart Group 的身份、所有权和展示状态没有分层。

## 3. Goals / Non-goals

### Goals

- Smart Group Node Member 在完整编组往返中保留同一个 Node 身份、内容状态、Connection 和 Node Rest Geometry。
- Smart Group 的移动、Resize 和整理具有可预测、可撤销且不会破坏成员真实数据的结果。
- Node 成员与直接媒体共享一个稳定、可持久化的成员顺序，并明确两者在拖出与解散时的不同结果。
- 一个 Node 最多由一个 Smart Group 拥有；跨组移动是原子转移，不出现双重归属或部分成功。
- 保存重载、复制粘贴、Node Package、Canvas Sync、Undo/Redo 和 Generation Run 使用同一成员语义。
- 旧画布中已经失去原 Node 身份的编组媒体获得确定性、非破坏性的兼容行为。
- UI、交互、前端、后端与测试可以用同一组规则判断“整理展示”与“编辑真实 Node”的边界。

### Non-goals

- 不在本期修改普通多媒体 Image Node 的“拆分媒体”行为；相邻问题另行跟踪。
- 不在本期开放新的 Smart Group 嵌套能力、嵌套编辑器或递归布局交互。
- 不改变 Frame 的空间包含语义；Frame 仍不拥有其中内容。
- 不增加新的图片编辑、生成设置、Provider 能力或自动执行 Generation Run。
- 不借解散动作自动整理用户原有 Node、避免重叠或重写原始布局；精确还原优先于自动美化。
- 不承诺从旧数据中推断从未保存的原 Node ID、尺寸、位置或历史状态。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Designer | 对目标 Smart Canvas 有编辑权限 | 创建、移动、Resize、整理、移入、移出、解散、删除、复制及撤销 Smart Group | 绕过 Canvas Sync 权限、修改其他 Workspace 内容或使一个 Node 同时归属多个 Smart Group |
| Administrator | 以可编辑身份进入目标 Canvas | 与 Designer 相同；按现有权限管理 Canvas | 通过本功能读取额外秘密或绕过成员/Connection 校验 |
| Guest Account | 没有 Canvas 编辑资格 | 看到既有拒绝或无编辑入口 | 提交编组相关 Canvas Mutation |
| Anonymous Share Visitor | 通过 Share Link 只读查看 | 按分享页现有规则查看 Smart Group 聚合内容 | 改变成员、顺序、几何、Connection 或触发编辑手势 |

## 5. User stories

1. 作为 Designer，我希望把大小不同的图片、提示词和标注放进 Smart Group 后仍能完整取回，以便放心整理而不破坏作品。
2. 作为 Designer，我希望 Resize 或整理编组只改变组内缩略展示，以免解散后才发现成员被永久缩小。
3. 作为 Designer，我希望把成员拖出时保持同一个 Node 和原尺寸，并把它放到鼠标松手的位置。
4. 作为 Designer，我希望解散整个编组后恢复进入编组前的相对布局，并保留编组后来整体移动的结果。
5. 作为 Designer，我希望直接拖入编组的图片在拖出时成为一个正常大小的 Image Node，而不是异常小的缩略图。
6. 作为 Designer，我希望把 Node 从编组 A 拖入编组 B 时一次完成转移，并能一步撤销。
7. 作为 Designer，我希望复制或粘贴一个编组后，副本可以独立解散，不引用或修改原编组成员。
8. 作为协作中的 Designer，我希望别人同时移动、转组或解散时得到完整成功或明确冲突，而不是看到成员重复或丢失。
9. 作为 Designer，我希望删除编组与解散编组有明确不同的结果，并能用 Undo 恢复误操作。
10. 作为键盘和辅助技术用户，我希望所有菜单动作可操作、状态反馈可感知，且不能只靠缩略图大小或颜色表达成员状态。

## 6. User journey and interaction contract

### 6.1 入口与退出

- 创建编组沿用现有 Canvas Selection 入口；选中的合格 Node 成为 Smart Group Node Member，成功后选择新 Smart Group。
- 拖入已有 Smart Group 表达“移入编组”；若来源已经属于另一个 Smart Group，则表达“转移到编组”。
- 从组内拖出、成员菜单“移出编组”和 Smart Group 菜单“解散编组”是三条明确退出路径，共享身份与还原规则，但位置规则不同。
- “删除编组”继续表达删除 Smart Group 及其拥有内容，不得与“解散编组”共用模糊名称、图标说明或结果。
- Pointer / Keyboard 手势在提交前取消时不修改持久状态、不产生 Undo；提交成功后一次 Undo 恢复完整前态。

### 6.2 可观察状态

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| ordinary | Node 不属于 Smart Group | 普通 Node 尺寸、内容与 Connection | 选择、编辑、创建或移入编组 | 编组提交或普通编辑 |
| grouped | Node Member 或 Media Member 已归属 Smart Group | Smart Group 内紧凑、有序的 Group Presentation | 预览、下载、生成、整理、Resize、移出、解散、删除 | 下一次已提交动作 |
| arranging | 用户整理或 Resize Smart Group | 实时预览新的组内布局；普通成员真实尺寸不变化 | 完成或取消 | 提交一次 Mutation 或回到 grouped |
| transferring | 成员从一个 Smart Group 指向另一个 | 目标高亮和单一拖拽预览 | 完成或取消 | 原子转移、明确拒绝或取消 |
| extracting | 成员正在拖出 Smart Group | 恢复尺寸的拖拽预览；Pointer 锚点稳定 | 落到 Canvas 或取消 | 原子移出或回到 grouped |
| disbanding | 用户执行“解散编组” | 内容恢复预览；必要时说明会移除的编组级 Connection | 确认既有命令或取消 | 一次 Mutation 完成或无变化 |
| deleting | 用户执行“删除编组” | 既有危险动作反馈，明确内容也会删除 | 完成、取消、随后 Undo | 删除提交或取消 |
| recovering | 提交结果未知、断线或 Revision 变化 | 持续可感知的恢复/冲突反馈，不显示半完成状态 | 等待、重试同一 Operation ID 或放弃未提交动作 | 收到权威结果或明确失败 |
| legacy | 旧 Smart Group 只有直接媒体、缺少原 Node 资料 | 保持可查看、可解散；不声称能够恢复不存在的身份 | 兼容解散、拖出、复制、删除 | 数据按兼容规则提交 |
| forbidden | 权限丢失或目标只读 | 编辑入口不可用或操作被明确拒绝 | 查看；按现有权限恢复 | 权限恢复或离开 Canvas |

### 6.3 Pointer、Keyboard 与焦点

- Node Member 拖出时，拖拽预览从紧凑展示平滑过渡到 Node Rest Geometry；松手后以 Pointer 落点为准，并保持归一化抓取点，避免 Node 突然跳到左上角。
- 拖出阈值、Pointer Capture、Space 平移、中键平移、文本编辑和现有选择手势沿用 Smart Canvas 合同；拖出不能抢占正在编辑的文本。
- 菜单中的“移出编组”“解散编组”“删除编组”可用 Keyboard 激活；Escape 关闭菜单或取消未提交手势，Focus 返回原触发位置。触发 Node 因成功动作消失时，Focus 回到 Smart Canvas 的合理容器。
- 不能把失败命中解释成删除或静默移出。松手位置无效、目标已删除或权限变化时，成员留在原编组并说明原因。
- Group Presentation 的缩略比例不能成为唯一可拖拽区域；远景、窄窗口与极端宽高比下仍应提供可发现的成员选择和编组动作。

### 6.4 布局、主题与动效

- 沿用生产 Smart Canvas 的 Desktop / Narrow、Light / Dark 和远近景规则；本期不新增独立页面或 Design Token。
- Smart Group 外框可以 Resize，内部缩略图随可用空间自适应；相同成员、相同顺序和相同外框必须产生确定性 Group Presentation。
- Reduced Motion 移除拖出时的尺寸过渡，但保留相同状态顺序、最终尺寸和 Focus 结果。
- Pending Node、失败状态、选中、Focus、拖拽目标和只读状态继续使用公共 Node / Canvas 语义，不能由编组局部样式覆盖。

### 6.5 文案与国际化

- 中文产品名称继续使用“编组、移入编组、移出编组、整理编组、解散编组、删除编组”；英文使用 “group / move into group / move out of group / arrange group / disband group / delete group”。
- 若解散会移除编组级 Connection，成功反馈必须同时给出受影响数量和 Undo 能力，例如“已解散编组，并移除 2 条编组连接”；英文表达相同语义。
- Revision 冲突、跨组转移失败、非法嵌套和权限失败均提供中英文语义，不显示内部字段、堆栈或原始协议错误。
- Smart Group Node Member、Smart Group Media Member、Node Rest Geometry 和 Group Presentation 是规格与实现语言；除非用户任务需要解释，不要求直接显示为新增 UI 标签。

## 7. Functional rules

### 7.1 身份、内容与所有权

1. 已存在 Node 加入 Smart Group 后成为 Smart Group Node Member；其 Node ID、类型、内容、媒体、Generation Output、运行状态、元数据和成员自有 Connection 不得因编组而重建、复制或丢失。
2. 一个 Node 在任一 Canvas Revision 中最多由一个 Smart Group 直接拥有。创建编组、移入、复制、导入、同步和迁移均必须维护该约束。
3. Node Member 从 Smart Group A 移到 Smart Group B 时，A 的移除、B 的加入、两个编组展示更新及必要 Frame 协调属于一次 Canvas Mutation；任一校验失败则全部不提交。
4. 直接上传、粘贴或拖放到 Smart Group 且此前没有独立 Node 身份的媒体成为 Smart Group Media Member。系统不得伪造“原 Node 已被保留”的承诺。
5. Smart Group 拥有一个跨 Node Member 与 Media Member 的稳定总顺序。预览、下载、Generation Run 输入、复制粘贴、分享和导出读取同一顺序；不得固定把某一成员种类移到另一种类之前。
6. 同一个媒体在不同成员中的多次出现保持独立身份和顺序，不按 URL、文件名或内容哈希自动去重。

### 7.2 Node Rest Geometry 与 Group Presentation

7. Node Member 首次进入 Smart Group 时确定 Node Rest Geometry。它包含离开编组所需的普通画布尺寸、比例及相对布局依据，但不包含 Group Presentation 的缩略槽位。
8. 创建、移入、整理和 Resize Smart Group 只能改变 Group Presentation；不得把缩略宽高、裁切、缩放或组内局部坐标写成 Node Member 的还原尺寸。
9. 移动整个 Smart Group 会平移其成员的还原位置依据；移动量按 Smart Group 从成员进入或上次还原基准后的世界坐标差计算。它不改变还原尺寸和比例。
10. 整理 Smart Group 可以改变稳定成员顺序和组内展示布局。若用户动作表达重新排序，新顺序必须持久化；仅因容器宽度变化而发生的自动换行不改变语义顺序。
11. 若未来提供直接编辑组内某个成员真实尺寸的明确动作，该动作才可以更新 Node Rest Geometry；Smart Group 自身 Resize 不能隐式承担该意图。

### 7.3 移出与解散

12. Pointer 拖出 Node Member 时保留同一个 Node ID 和全部语义状态，恢复 Node Rest Geometry 的尺寸；最终位置以明确落点和稳定抓取锚点为准。
13. 通过菜单移出单个 Node Member 时，恢复其进入编组时的位置，并叠加 Smart Group 后来的整体移动量。即使与其他 Node 重叠也精确还原，不自动避让或移动既有内容。
14. 拖出 Smart Group Media Member 时，在落点创建一个具有新 ID 的普通 Image Node，使用媒体自然宽高比和普通 Image Node 的标准尺寸；成功提交后媒体不再由原 Smart Group 拥有。
15. 解散 Smart Group 时，所有 Node Member 保持原 ID，按 Node Rest Geometry 及 Smart Group 移动量恢复。所有 Media Member 按稳定顺序创建具有新 ID 的普通 Image Node，并以标准尺寸确定性排列，不能互相完全遮挡。
16. 解散只移除 Smart Group 自身及编组级 Connection，不删除成员内容。Node Member 自有 Connection 保留，恢复后继续绑定原端点。
17. 若没有成员，解散只移除空 Smart Group。若编组在动作开始后被其他协作者删除或成员关系改变，使用最新 Revision 重新校验，不能按过期快照复活或丢弃内容。

### 7.4 删除、Connection 与 Generation Run

18. 删除 Smart Group 表达删除容器及其拥有的 Node Member 和 Media Member；相关 Connection 在同一 Canvas Mutation 中删除。一次 Undo 必须完整恢复身份、成员顺序、几何和 Connection。
19. Node Member 在编组前已有或在编组内以成员身份创建的 Connection 始终绑定成员 Node ID；编组期间可以把端点视觉投影到 Smart Group 边界，但不得改写为编组端点。
20. 用户明确连接到 Smart Group 本身产生编组级 Connection。解散时不能猜测该 Connection 应转给哪个成员；它随 Smart Group 删除，并通过可感知反馈说明数量。Undo 可以恢复。
21. Generation Run 提交时冻结当次使用的有序成员输入。提交后的移入、移出、整理或解散只影响未来运行，不改变已提交 Run 的输入身份、顺序或结果投递目标。
22. Pending Node 可以作为 Node Member 保持其目标身份；在编组内完成、失败、恢复或被拖出后，Generation Run 的 Target Guard 仍以同一 Node ID 判断，不把结果投递到新建替身。

### 7.5 Frame、外部空间系统与旧数据

23. Frame 继续按空间关系包含 Smart Group，不拥有其成员。解散或拖出完成后，Frame 成员关系按恢复后的世界几何重新协调，不从 Smart Group 所有权直接复制。
24. 对选择、对齐、Node Placement、碰撞、虚拟化和 Smart Minimap 等外部空间系统，已编组内容投影为一个 Smart Group 原子项；隐藏成员不得成为重复图形或不可见障碍物。
25. 对预览、下载、分享、导出和 Prompt Authoring 等需要内容的只读消费者，Smart Group 按稳定总顺序展开成员；展开读取不得修改成员或生成迁移副作用。
26. 本期不创建新的 Smart Group 嵌套。旧数据若已包含嵌套，内层 Smart Group 作为具有身份的 Node Member 被安全保留；加载、移动或解散外层编组不得静默展平或删除内层编组。
27. 旧数据中只剩编组媒体而没有原 Node 身份及 Node Rest Geometry 的内容按 Smart Group Media Member 兼容。解散时创建标准尺寸 Image Node，不声称恢复无法证明的旧 ID 或旧尺寸。

### 7.6 原子性、恢复与派生行为

28. 创建、移入、转移、移出、解散、删除、成员排序及相应几何和 Connection 变化均以完整语义意图提交；成功、无变化、明确拒绝或确认未知之外，不存在部分成功。
29. 每次已提交意图使用一个 Operation ID、产生一个逻辑 Canvas Mutation 和一个 Undo 单元。Undo/Redo 恢复已确认的精确状态，不重新推断成员顺序、标准尺寸或位置。
30. 较新 Canvas Revision 仍允许完整意图成立时，Canvas Sync 可以协调后提交；若成员已被移动、删除、转组或权限失效导致意图不再成立，则整体拒绝并展示最新权威状态。
31. 断线前已发送但结果未知的操作以同一 Operation ID 恢复或重放；客户端不得通过新 ID 重复创建编组、成员或 Image Node。
32. 复制、Duplicate、粘贴和 Node Package 导入为 Smart Group 及其 Node Member 分配新的独立 ID，重映射内部 Connection、成员顺序和 Node Rest Geometry。副本解散不得引用或修改来源成员。
33. 导出、分享和只读查看不改变 Smart Group 的持久数据、Canvas Revision 或 Canvas Updated Time。

## 8. Domain and state model

Smart Group 是拥有成员的 Node，而不是仅靠空间范围推断的 Frame。它的成员集合是一个稳定有序序列，每一项恰好属于以下一种：

| Member kind | Existing identity | Owned while grouped | Result when extracted/disbanded |
| --- | --- | --- | --- |
| Smart Group Node Member | 已有稳定 Node ID | Node 本身、其顺序及 Group Presentation；Node 语义状态仍属于该 Node | 保留同一 Node ID 和状态，恢复 Node Rest Geometry |
| Smart Group Media Member | 没有独立 Node ID；媒体自身有稳定成员身份 | 媒体、其顺序及 Group Presentation | 创建具有新 Node ID 的普通 Image Node，使用标准尺寸 |

四个概念必须保持正交：

- **成员所有权**回答“内容属于哪个 Smart Group”。
- **成员顺序**回答“读取和展示时谁在前、谁在后”。
- **Node Rest Geometry**回答“Node Member 离开编组后多大、恢复到哪里”。
- **Group Presentation**回答“内容在编组内部当前如何紧凑展示”。

Node Member 的成员生命周期为：

```text
ordinary → grouped → ordinary
              └────→ grouped in another Smart Group
```

Media Member 的生命周期为：

```text
direct media in Smart Group → Image Node
```

删除 Smart Group 是独立终止路径，不等于上述可逆退出路径。只有删除才会同时删除拥有的内容。

## 9. Data and persistence

| Data | Authority | Boundary | Retention | Migration/recovery |
| --- | --- | --- | --- | --- |
| Smart Group 身份、外框与标题 | Smart Canvas 权威文档 | Workspace | 随 Canvas 保留，直到删除或解散 | 沿用现有 Canvas 迁移与 Revision 规则 |
| 有序成员身份与种类 | Smart Canvas 权威文档 | Workspace | 随 Smart Group 保留 | 旧 `items` / 直接媒体投影到统一语义顺序；具体版本模型由 ADR 决定 |
| Node Member 内容与状态 | 成员 Node | Workspace | 与 Node 同生命周期 | 不复制成媒体，不在加载时删除 Node |
| Node Rest Geometry | Smart Canvas 权威文档 | Workspace | 成员归属期间及 Undo/Redo 所需历史内 | 必须保存重载；不能只存在 DOM、手势缓存或进程内对象中 |
| Group Presentation | Smart Canvas 权威文档或由稳定输入确定的可重建投影 | Workspace / Device 界线由实现决定 | 至少保证跨重载结果稳定 | 若只保存必要输入，重建算法版本必须保持兼容 |
| 未提交拖拽预览 | 当前 Canvas Interaction | Device 临时状态 | 手势结束即清理 | 刷新或断线不提交半成品 |
| Generation Run 输入快照 | Generation Run 权威记录 | Workspace | 沿用 Generation Pipeline | 编组后续变化不回写历史 Run |

- 持久引用使用稳定身份，不保存依赖某台设备的绝对文件路径、DOM 索引或临时对象引用。
- 旧 Smart Group 媒体兼容迁移不得在只读加载时制造 Canvas Edit；只有用户提交编辑或既有受控迁移流程才写入新结构。
- 任何不可逆的数据迁移都必须可识别版本、可备份并有回退策略；不能仅靠前端加载后自动重写来消除旧格式。
- 删除遵守现有 Canvas / Workspace 备份和历史边界；本功能不新增秘密或跨 Workspace 共享数据。

## 10. API / WebSocket / Provider contracts

- 不新增 Provider 请求或公共 Provider 能力。编组、拖出、解散、删除、复制和恢复都不是 Generation Run。
- 可以扩展既有 Canvas 文档与 Canvas Mutation 的版本化载荷，但不新增旁路保存通道；HTTP / WebSocket 的授权、Revision、Operation ID、幂等和冲突语义继续由 Canvas Sync 统一拥有。
- 服务端或等价权威校验必须拒绝：同一 Node 被多个 Smart Group 直接拥有、成员引用不存在、重复成员身份、非法嵌套/循环、未完整携带还原所需状态，以及只提交转移的一半。
- 对外提交结果只有完整成功、no-op、明确拒绝或确认未知 / 恢复中。冲突响应携带足够的最新 Revision 信息供既有恢复路径重取状态，但不暴露内部存储或其他 Workspace 内容。
- 旧客户端遇到无法理解的新成员模型时不能保存一个会删除未知字段的降级快照；兼容策略与最低客户端版本由持久模型 ADR 明确。

## 11. Security and privacy

- 所有编组编辑复用目标 Canvas 的现有编辑权限；只读分享不得获得编辑端成员详情以外的新私有数据。
- Smart Group 聚合预览、下载和生成只访问当前账号原本可读取的媒体；成员模型不能成为跨 Workspace 引用或绕过 Managed Media 授权的通道。
- 错误和恢复反馈只显示业务身份、数量及可行动建议，不显示绝对路径、访问令牌、内部堆栈或其他协作者的秘密数据。
- 剪贴板和 Node Package 保持既有资源清理与安全边界；还原信息不得嵌入可执行内容。

## 12. Performance and reliability constraints

- Pointer Move、Resize 和组内排列预览只更新临时 Group Presentation；不得在每一帧写持久 Node Rest Geometry、提交 Mutation 或广播完整 Canvas。
- 创建、解散或转移的计算量应与受影响成员和内部 Connection 数量线性相关，不为每个成员单独保存或广播。
- Smart Minimap、Node Placement、选择和虚拟化只消费 Smart Group 的外部投影，避免对隐藏成员重复测量和绘制。
- 大型编组仍必须原子提交；不能为降低延迟拆成可被其他协作者观察到的多次成员删除与创建。达到既有 Canvas 容量边界时应在提交前拒绝并保持原状态。
- 失败、取消、断线、重复提交和页面切换均清理临时拖拽 / Resize 状态，不留下幽灵成员、重复所有权或不可见占位。
- 具体规模与帧耗 Gate 在实现前以当前 Canvas 容量基线确定；未测量前不新增绝对成员数量承诺。

## 13. Design system contract

- 复用生产 Smart Group Node 外壳、`ic-smart-node-toolbar`、`ic-menu`、`ic-icon-button`、Tooltip、Toast / 持续状态和现有 Focus Policy；不复制公共组件内部样式。
- Group Presentation 属于 Smart Group Node 家族的内容呈现；页面宿主提供成员投影和动作，公共组件不直接写 Canvas Store 或自行迁移成员。
- “解散编组”和“删除编组”在标签、辅助名称和结果上可区分；删除沿用危险动作层级，解散使用保留内容的普通动作层级。
- 拖出预览需要让用户看见将恢复的尺寸和落点，但不新增页面级阴影、品牌色、圆角或动效常量。
- 选中 Smart Group 内的图片时，仅图片呈现一层完整且不被裁切的选中反馈；Smart Group 可以继续承载工具栏与键盘路由所需的逻辑选择，但不得同时绘制容器选框。
- 自动截图覆盖 Light / Dark、Desktop / Narrow、Reduced Motion 和极端宽高比；人工验收确认缩略展示不会让用户误以为内容被永久改变。

## 14. Implementation decisions

- Smart Container 职责模块成为成员所有权、稳定顺序、Group Presentation、Node Rest Geometry、移入 / 移出 / 解散 / 删除计划及相关 Connection 协调的唯一业务所有者。页面拖拽、Resize、持久化和工具栏不得各自解释 `items` 与直接媒体。
- 对外提供较小的查询与命令边界：调用方请求解析 Smart Group、创建、移入/转移、移出、整理、解散或删除；模块内部完成校验、计划和一个 Canvas Mutation。具体函数名不构成产品合同。
- Node Geometry 对外区分 Smart Group 原子外框与成员还原几何；DOM 当前尺寸不是 Node Rest Geometry 的权威来源。
- Connection Layer 继续负责已提交 Connection 的索引和视觉投影，不拥有成员关系或解散策略。
- Preview、Download、Image Studio、Prompt Authoring、Share 和 Frame Export 通过统一只读成员解析结果消费内容，不依赖“图片一定已被吸收到 Smart Group”这一假设。
- Node Rest Geometry、统一成员顺序和旧双结构迁移遵守 [ADR-0010](../adr/0010-smart-group-member-authority.md)：Node 自身几何保持权威，Smart Group 增加统一有序投影，`items` / `images` 在兼容期由 Smart Container 协调写入。
- 不采用仅保存 `_originalRect` 的内存补丁，也不通过解散时猜测缩放倍数还原；两者无法覆盖保存重载、复制粘贴和协作。

## 15. Acceptance and testing

### Highest test seam

最高自动化接缝是两个独立编辑端通过真实 Canvas Sync 提交和观察 Smart Group Canvas Mutation，并在真实 Smart Canvas 页面执行 Pointer / Keyboard 旅程。纯模块测试负责穷举身份、顺序和几何计划，但不能替代真实页面、持久化重载与双端一致性。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
| 多类型创建并解散 | 真实页面 + Canvas Mutation | Image、Prompt、Prompt Generation、Text Annotation、Brush Stroke、Splitter、Batch Run、Pending 等合格 Node 保持原 ID、内容、尺寸和相对布局 |
| Image Node 往返 | 浏览器 + 持久化 | 单图、多媒体及 Generation Output Node 不被吸收删除；刷新后解散仍为同一 Node |
| Resize / 整理后解散 | 纯计划 + 浏览器 | 组内展示变化，Node Member 还原尺寸不变 |
| 移动后解散 | 纯计划 + 浏览器 | 每个 Node 的还原位置只叠加 Smart Group 整体移动量 |
| Pointer 拖出 Node Member | 浏览器 Pointer | 保持 ID 和还原尺寸，落点及抓取锚点稳定；取消不变化 |
| 拖出 Media Member | 浏览器 Pointer | 创建一个新 ID 的标准尺寸 Image Node，并从原编组移除该媒体 |
| 混合成员重排 | 纯模块 + 保存重载 | Node / Media 共用稳定总顺序，预览、下载与生成解析一致 |
| 组内图片选中 | 真实页面 Pointer + 计算样式 | 单图和网格图仅保留图片自身的一层选中反馈；Smart Group 外框不重复高亮，选框顶部不被裁切 |
| Smart Group A 转移到 B | 双端 Canvas Sync | 任一 Revision 只存在一个所有者；一次 Undo 恢复 A，不能出现双重归属 |
| 成员自有 Connection | 浏览器 + Connection Layer | 编组时视觉投影，解散后仍绑定原 Node ID |
| 编组级 Connection | Canvas Mutation + 浏览器 | 解散时同一操作删除并反馈数量；Undo 完整恢复 |
| 删除与解散对照 | 浏览器 + Undo/Redo | 解散保留内容；删除移除内容；两者均为一个 Undo 单元 |
| Generation Run 期间改变编组 | Generation Pipeline 集成 | 已提交 Run 使用冻结成员顺序；Pending Node 仍按同一 ID 接收结果 |
| Frame 内编组 | 浏览器 + Frame 协调 | 编组外部为原子项；解散后按恢复几何重新确定 Frame 空间成员 |
| Minimap / Placement / 虚拟化 | 真实页面 | 已编组成员不重复出现、不形成幽灵障碍，内容消费者仍可展开读取 |
| Duplicate / Clipboard / Node Package | Mutation + 导入导出 | 新 ID、内部引用和还原几何正确重映射；副本与来源独立 |
| 保存、重载与 Undo/Redo | 持久化集成 | 每个阶段身份、顺序、几何和 Connection 精确一致 |
| 同时转移、解散或删除 | 双端 Canvas Sync | 完整成功或明确冲突，无部分成员、重复所有者或旧快照覆盖 |
| 旧 `group.images` 数据 | 迁移 fixture + 浏览器 | 保持可读；按 Media Member 解散为标准尺寸节点；不伪造旧 ID |
| 旧嵌套 Smart Group | 兼容 fixture | 不新建、不静默展平；外层操作保留内层身份与内容 |
| 权限与断线 | HTTP/WebSocket + 浏览器 | 无权限不提交；未知结果复用 Operation ID；重连不重复创建成员 |
| 国际化与辅助技术 | i18n 校验 + 浏览器 | 中英文动作、反馈、辅助名称、Focus 返回和非颜色状态完整 |

### Human acceptance

| Role | Scene | Evidence / confirmation |
| --- | --- | --- |
| UI | Light/Dark × Desktop/Narrow；小/大编组；极端图片比例 | 紧凑展示清晰但不暗示永久缩放；解散与删除层级不同 |
| Interaction | Resize、整理、整组移动、成员拖出、跨组转移、取消和 Undo | 尺寸过渡、落点、抓取锚点、Focus 与一步撤销符合预期 |
| Product | 图片、提示词、标注、Pending、直接媒体和旧数据 | 能准确解释哪些保留原身份、哪些离开时新建 Node |
| Collaboration | 两个独立编辑端并发转移、解散、删除和重连 | 不出现双重归属、部分成功、成员消失或过期快照覆盖 |
| Accessibility | Keyboard、屏幕阅读语义、Reduced Motion | 所有动作可达，结果与冲突不依赖颜色或动画表达 |

### Regression neighbors

- Smart Canvas Selection、Selection Arrangement、Node Resize / Move、Node Placement、Virtualization 与 Smart Minimap。
- Frame 空间成员协调、分区图像导出和 Smart Group 作为 Frame 后代时的叠放。
- Connection 快速添加、端点投影、删除级联与 Duplicate Connection 继承。
- Image Studio、Smart Group 预览 / 下载、Prompt Authoring、多输入快速连接和 Generation Run 快照。
- Canvas Persistence、Canvas Sync、Undo/Redo、Clipboard、Node Package、分享页和旧画布迁移。
- 普通多媒体 Image Node 的拆分行为不随本功能静默改变。

## 16. Rollout, migration and rollback

- 首先引入能同时读取旧 Smart Group 和新成员语义的兼容层，再切换创建、移入和解散写路径；不能先停止读取旧数据。
- 迁移前准备包含直接媒体、已缩小非图片成员、旧嵌套、Connection、Frame 和 Generation Output 的真实脱敏 fixture，并验证备份与回退。
- 旧数据没有原 Node 身份时保持 Media Member 语义；不得为了“统一”创建看似原始但无法证明的 ID 或尺寸。
- 新写入启用前，旧客户端降级保存边界、最低兼容版本和迁移可逆性必须由 ADR 关闭。无法保证旧客户端保留未知字段时，应阻止不安全写入，而不是静默降级。
- 回退必须继续读取已发布的新成员数据，或先执行经过验证的逆向迁移；不能仅回退前端脚本后让新数据被旧加载逻辑吸收或删除。
- 实现完成后执行本规格第 15 节、i18n 校验、相关回归及真实双端人工 Gate。触及 Infinite Canvas UI 资产路径时执行 UI 资源版本同步；推送前遵守 VERSION / update-notes 规则。
- 只有目标行为与测试一致、迁移/回退及人工 Gate 通过后才毕业到 `docs/current/`；此前 Issue #28 保持 Review 前状态或实现中的状态，不因代码完成自动关闭。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product issue | [GitHub Issue #28](https://github.com/lazyq666/reroll-ai-canvas/issues/28) |
| Product map | [F05 Smart Canvas 创作与交互](../PROJECT-MAP.md#功能规格注册表) |
| Domain language | [`CONTEXT.md`](../../CONTEXT.md)、[编组与分区命名](../current/smart-canvas-container-terminology.md) |
| UI surfaces | Smart Canvas 的创建菜单、Smart Group Node、成员拖拽、浮动工具栏、上下文菜单、Toast、Smart Minimap |
| Current implementation seams | `static/js/smart-canvas/smart-container.js`、`canvas-interaction.js`、`canvas-mutation.js`、`connection-layer.js`、`node-geometry.js`、`viewport-selection.js`、`canvas-persistence.js`、`backend/infinite_canvas/canvas_realtime.py` |
| Content consumers | `generation-run.js`、`multi-input.js`、`image-studio.js`、`frame-image-export-host.js`、`canvas-share.js` |
| Automated evidence | `tests/test_smart_canvas_smart_container.py`、`tests/test_smart_canvas_canvas_interaction.py`、`tests/test_canvas_realtime.py`、`tests/smart_canvas_smart_group_toolbar_browser_smoke.cjs`、`tests/share_page_browser_smoke.cjs`；真实双端浏览器验收待补 |
| Related Current rules | [选区整理](../current/smart-canvas-selection-arrangement.md)、[Node 自动避让](../current/smart-canvas-node-auto-placement.md)、[创建副本 Connection 继承](../current/smart-canvas-duplicate-connection-inheritance.md)、[Generation Pipeline](../current/generation-pipeline.md)、[UI 设计与交互指南](../current/ui-design-guidelines.md) |
| ADRs | [ADR-0002](../adr/0002-ui-family-module-ownership.md)、[ADR-0010](../adr/0010-smart-group-member-authority.md) |

## 18. Open questions

没有尚未决定且会改变用户承诺的问题。实现已收束以下技术决定：

- Group Presentation 由 Smart Group 外框、统一成员顺序和成员内容确定性派生，不另存一套成员缩略几何。
- `memberOrderVersion: 1`、`memberOrder`、`items` 和带稳定 `groupMemberId` 的 `images` 共同构成兼容写入；Realtime 权威校验拒绝顺序投影不一致、重复 Node 所有权和移除版本化顺序的降级提交。
- 具体性能规模、双端冲突恢复、Keyboard / Focus、Reduced Motion 与跨平台表现仍是毕业到 Current 前的 Gate，不能以此削弱原子性、身份或顺序。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| 2026-09-04 | Fixed / Review pending | 组内图片选中时关闭 Smart Group 宿主选框和网格缩略图外扩选框，仅保留图片自身的完整选中反馈 | 单图与网格图真实浏览器 Pointer / 计算样式回归通过 |
| 2026-09-04 | Implemented / Review pending | Node 成员保留身份与原几何；直接媒体获得稳定成员 ID；新增跨类型顺序、派生展示、拖出/解组、唯一所有权、复制重映射、空间投影、分享投影与 Realtime 校验 | 228 项相关 Python 测试、16 项 Node 测试、Smart Group 与 Share 浏览器 smoke、3128-key i18n 校验通过；人工与真实双端 Gate 待完成 |
| 2026-09-04 | Approved | 从“解散后恢复图片尺寸”扩展为可逆编组、成员分类、几何分层、唯一所有权、Connection、协作、迁移和验收合同 | 用户确认；Issue #28；当前代码与测试路径遍历 |
