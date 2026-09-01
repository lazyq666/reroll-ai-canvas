# Canvas Mutation 单节点移动快速通道实现参考

- 状态：Current Implementation Reference
- 日期：2026-08-20

> 当前整体容量目标、正式 Gate 和大型既有 Canvas 风险以[实时协作性能与容量](realtime-collaboration-performance.md)为准；本文只解释单 Node 移动快速通道的实现边界和历史测量。

## Problem Statement

Smart Canvas 用户在多人同时移动 Node 时，会看到松手后的同步确认明显变慢。当前 9 个机器人、2160 次 Node 移动的真实验收中，Mutation 确认 P50 为 280.7 ms、P95 为 596.1 ms、P99 为 938.8 ms；第 1 到第 9 个队列位置的中位耗时逐级增加，平均每个位置约增加 50.7 ms，队尾中位耗时约 472 ms。

同一 Smart Canvas 的 Canvas Mutation 必须继续按照 Canvas Revision 有序提交，否则协作者会看到不同顺序或错误覆盖。问题不在于“存在队列”，而在于队列中的一次简单位置修改仍执行了整张 Smart Canvas 的通用流程：读取并解析全部 Node 和 Connection、加载历史、深拷贝完整 Canvas、执行结构校验，然后才更新一个 Node。

当前代表性 Smart Canvas 包含 461 个 Node 和 321 条 Connection。Node JSON 约 3.08 MB，Connection JSON 约 23 KB，实时协作状态约 181 KB。2160 次移动仅重复读取 Node 和 Connection 数据就超过 6.7 GB，尚未计入解析后的内存对象和深拷贝。

对当前 SQLite Authority 热路径的分阶段测量显示，在 200 条历史的情况下，一次普通 Node 位置 Mutation 的离线 P50 约 39–40 ms。其中整张 Smart Canvas 读取约 13 ms，通用 Mutation 应用、深拷贝和全图校验约 22–23 ms；历史加载约 1.5 ms，SQLite 提交和其他事务工作约 1.4 ms。因此首要问题不是 SQLite 落盘，也不是历史上限本身，而是位置修改仍然物化和处理完整 Smart Canvas。

用户需要在不改变 Canvas Revision、Canvas Sync、Undo、幂等、权限或多人冲突语义的前提下，让常见的单 Node 移动只处理目标 Node，从而显著缩短同一 Smart Canvas 队列中每一项的处理时间。

## Solution

为普通单 Node 位置 Canvas Mutation 建立服务端快速通道。快速通道只处理一个已存在 Node 的 `x`、`y` 或同时 `x/y` 更新，并复用现有 Canvas Store 提交边界。

一次符合条件的位置 Mutation 在同一个短 SQLite 事务中完成：验证权限与 operation ID 回执、读取当前 Canvas Revision、读取目标 Node 和必要的实时协作状态、应用字段版本与逆向变化、更新目标 Node、递增 Canvas Revision、追加 Mutation 历史和 Canvas Event、保存 operation receipt，然后提交。

快速通道保持当前 WebSocket 消息和 Canvas Commit 结果不变。客户端仍然在 Canvas Interaction 中本地预览拖动，只在交互完成时提交最终 Canvas Mutation；同一 Smart Canvas 仍由 Canvas Sync 按 Canvas Revision 排队。

任何不完全符合快速通道白名单的 Mutation 都自动使用现有通用路径，包括多 Node 移动、Node 创建或删除、Node 其他字段更新、Connection 变化、Smart Group 或 Frame 结构变化、Canvas 元数据更新、Generation Output 和 Undo。用户不需要看到或控制快速通道。

诊断原型已经证明该方向可行：在仍然保留 200 条历史和现有 181 KB 实时状态的条件下，目标 Node 路径三轮 P50 为 6.3–6.8 ms、P95 为 7.8–8.8 ms；与通用路径比较时，Node 内容、Canvas Revision、实时字段版本、历史、Canvas Event、operation receipt 及 Node/Connection 数量完全一致。

## User Stories

1. As a Smart Canvas 用户，我希望移动一个 Node 后快速收到同步确认，从而在多人编辑时保持操作节奏。
2. As a Smart Canvas 用户，我希望拖动过程继续由浏览器本地预览，从而不把每个 pointer move 都变成服务端写入。
3. As a Smart Canvas 用户，我希望松手只提交一次最终位置 Mutation，从而避免无意义地放大写入队列。
4. As a realtime 协作者，我希望同一 Smart Canvas 的位置 Mutation 仍按 Canvas Revision 有序确认，从而所有人看到相同顺序。
5. As a realtime 协作者，我希望其他用户移动 Node 时收到与当前协议相同的 Canvas Event，从而客户端不需要兼容新的消息格式。
6. As a realtime 协作者，我希望两个用户分别更新同一 Node 的 `x` 和 `y` 时继续遵循现有字段级合并语义，从而互不覆盖无关字段。
7. As a realtime 协作者，我希望两个用户连续更新同一位置字段时继续按照服务端确认顺序处理，从而结果确定且可解释。
8. As a Smart Canvas 用户，我希望移动后的 Node 在刷新和重新打开后保持正确位置，从而快速通道不会只修改内存状态。
9. As a Smart Canvas 用户，我希望移动操作继续进入 Undo 历史，从而可以撤销自己的位置修改。
10. As a Smart Canvas 用户，我希望 Undo 恢复移动前的位置，从而快速通道生成的逆向变化与通用路径一致。
11. As a Smart Canvas 用户，我希望他人在我移动后修改同一字段时，危险的 Undo 继续被拒绝，从而不会覆盖协作者的新工作。
12. As a Smart Canvas 用户，我希望他人在我移动后修改其他字段时，安全 Undo 仍能保留无关修改，从而协作内容不会回退。
13. As a reconnecting 用户，我希望断线重连后读取到连续 Canvas Revision 和最终 Node 位置，从而快速通道不会制造 Revision gap。
14. As a user retrying a timed-out Mutation，我希望使用同一 operation ID 重试时只生效一次，从而不会重复移动或重复增加 Revision。
15. As a user whose operation ID collides with different content，我希望收到现有明确错误，从而系统不会静默接受不一致操作。
16. As a user with an ahead base Revision，我希望 Mutation 按现有规则被拒绝并要求 Canvas Sync，从而客户端超前状态不会污染 Authority。
17. As a user submitting from a stale but allowed base Revision，我希望位置字段继续遵循现有字段版本语义，从而快速通道不会引入新的冲突规则。
18. As a user moving a Node that has already been deleted，我希望收到现有目标不存在错误，从而迟到更新不会复活 Node。
19. As a read-only or unauthorized 用户，我希望位置 Mutation 继续被权限边界拒绝，从而性能优化不会绕过访问控制。
20. As a Smart Canvas 用户，我希望移动 Prompt Node、媒体 Node 或其他普通 Node 时获得相同的性能收益，从而优化不局限于一种视觉类型。
21. As a Smart Canvas 用户，我希望移动 Smart Group 或 Frame 时，如果操作包含任何结构变化就自动使用通用路径，从而结构校验不会被跳过。
22. As a Smart Canvas 用户，我希望多选移动继续保持原子性，即使它暂时使用通用路径，从而不会为了速度拆成多个部分提交。
23. As a Smart Canvas 用户，我希望创建、删除、复制和粘贴 Node 继续使用完整校验，从而快速通道不会扩大到高风险操作。
24. As a Smart Canvas 用户，我希望 Connection 创建、删除和修改继续验证所有端点与重复关系，从而位置优化不会削弱 Connection 完整性。
25. As a Generation Run 用户，我希望 Generation Output 写回继续使用现有 Target Guard 和通用流程，从而异步结果不会错误覆盖 Node。
26. As a maintainer，我希望 Canvas Store 的公开提交接口保持不变，从而 Canvas Sync、HTTP 和 WebSocket 适配层不需要理解快速通道。
27. As a maintainer，我希望快速通道通过严格白名单选择，并在不确定时自动回退通用路径，从而新增 Mutation 类型默认安全。
28. As a maintainer，我希望快速通道与通用路径产生相同的用户可观察结果，从而优化可以由行为测试证明，而不是依赖内部实现断言。
29. As a maintainer，我希望位置 Mutation 的诊断指标标明快速通道是否命中及回退类别，从而性能回退可以定位。
30. As a maintainer，我希望诊断指标不记录 Node 内容、Prompt、凭据或完整 operation payload，从而性能观测不会泄漏 Workspace Data。
31. As a tester，我希望使用代表性大型 Smart Canvas 验证位置 Mutation，从而空画布上的微基准不会掩盖整图处理回退。
32. As a tester，我希望在历史达到 200 条时仍验证快速通道，从而长期协作不会逐渐退化。
33. As a tester，我希望正式 10 人压力测试验证确认延迟、Revision 连续和最终投影，从而单进程微基准不能代替真实协作验收。
34. As a release owner，我希望任何正确性失败、永久 Mutation 失败或性能 Gate 失败都会阻止发布，从而不能用平均值掩盖协作风险。
35. As a release owner，我希望测试环境先验证快速通道并保留已知可用版本作为回滚边界，从而无需在产品中维护双实现开关。
36. As a workspace administrator，我希望优化只修改当前 Workspace 的 Workspace Data，不触碰 Instance State、Device State 或 Device Cache，从而既有数据边界保持不变。
37. As a user working on another Smart Canvas，我希望短事务减少 SQLite Writer 占用，从而一个大 Smart Canvas 不再长时间拖慢同一 Authority 中的其他写入。
38. As a product designer，我希望优化不增加新的加载态、错误弹窗或设置项，从而交互模型保持简单，只表现为更快确认。

## Implementation Decisions

- 现有 Canvas Store 提交接口是唯一业务入口和最高测试接缝。Canvas Sync、HTTP Adapter 与 WebSocket Adapter 不直接判断或调用快速通道。
- 在 Canvas Store 内部增加位置 Mutation 路由器或等价深模块。它只负责判定白名单、执行单 Node 位置提交并返回现有 Canvas Commit。
- 快速通道首版只接受普通 Canvas Mutation，不接受带 `reverts_operation_id` 的 Undo Mutation。
- `changes` 只能包含 `node_updates`；所有其他 change 集合必须为空。
- 所有 `node_update` 必须指向同一个已存在 Node，字段路径只能是 `x` 或 `y`。一次 Mutation 可以同时更新 `x` 和 `y`。
- 客户端提交的内部 lineage、restore 或条件恢复元数据继续由现有规则拒绝；快速通道不能接受通用路径不允许的输入。
- 多 Node Mutation、Node unset、Node 创建或删除、Node 其他字段、Canvas 字段、Connection、Smart Group、Frame 结构、Generation Output 和日志变更全部回退通用路径。
- 白名单判定必须保守。未知字段、未知 action、异常 payload 或无法证明安全的变化都回退通用路径，而不是尝试部分加速。
- 快速通道在同一 SQLite Transaction 内读取并确认权限、Canvas Revision、operation receipt、目标 Node 和所需实时协作状态。
- 同一 Smart Canvas 继续由 Canvas Sync 的 operation lock 串行提交；不取消排队，不并行写同一个 Canvas Revision。
- SQLite Transaction 保持原子性：Node、Canvas Revision、实时字段版本、Mutation 历史、Canvas Event 和 operation receipt 要么全部提交，要么全部回滚。
- SQL COMMIT 成功后才能向调用方报告成功；失败不能留下部分 Node 更新或跳过的 Canvas Revision。
- operation receipt 继续作为精确幂等边界。同一 operation ID 和相同 intent 返回 duplicate 结果；相同 ID 与不同内容或 actor 继续返回 operation collision。
- base Revision 超前、目标 Node 不存在、权限失败和数据约束错误继续使用现有错误代码与 Canvas Revision 信息。
- 快速通道必须复用或提取现有字段版本、重叠路径、Node aggregate version、inverse 生成、history trim 和 seen-operation 语义，不能实现一套较弱的冲突模型。
- `x/y` 修改不改变 Smart Group 成员、Frame 空间所有权声明或 Connection 端点，因此快速通道不执行完整 Group 和 Connection 图遍历。任何同时涉及结构字段的 Mutation 必须回退。
- 快速通道只读取目标 Node 行，不读取或解析所有 Node 与 Connection。打开 Smart Canvas 的完整 Snapshot 路径不受影响。
- 首版允许继续读取现有实时状态和最多 200 条历史，因为原型已在该条件下达到目标；避免把历史存储重构变成首个交付的前置条件。
- 首版不要求数据库 schema migration。现有 Node、Canvas、realtime state、Mutation、Canvas Event 和 operation receipt 表继续作为 Authority。
- Canvas Event、Canvas Commit 和 WebSocket message contract 保持不变；快速通道不新增 ack 类型、Revision 类型或前端兼容分支。
- 客户端 Canvas Interaction、乐观位置预览和最终 Mutation 格式保持不变；本交付不改变 pointer move 采样或手势行为。
- 增加脱敏 timing trace：总提交时间、快速通道资格、是否命中、回退类别和主要存储阶段。不得记录完整 Node、Prompt、媒体 URL、凭据、Cookie 或完整 Mutation payload。
- 快速通道失败时不能在同一 operation 上盲目重试通用路径，因为部分执行状态不明确；只有在事务开始前的资格判定可以选择通用路径，事务异常统一回滚并返回错误。
- 发布不提供用户级开关或长期双路径配置。通用路径是自动安全回退，不是面向用户的模式。
- Workspace Data、Instance State、Device State 和 Device Cache 的既有 ADR 边界保持不变。快速通道只写当前 Workspace 的 Canvas Authority。
- 第一阶段成功后再单独评估历史按需查询、实时状态拆表和广播移出 operation lock；这些优化不得混入本交付。

## Testing Decisions

- 使用一个最高层行为接缝：通过真实 Canvas Store 提交 Canvas Intent，并从公开 Canvas projection、Canvas Commit/Canvas Event 和后续 Undo 行为观察结果。测试不直接断言私有 helper 名称、SQL 查询数量或具体路由器结构。
- 好测试只验证外部行为、原子性和性能 Gate。实现可以重构，只要 Canvas Revision、Node、Connection、Undo、幂等、错误和广播行为保持一致。
- 复用现有 Canvas Store、Canvas Realtime、Canvas Sync、WebSocket、SQLite rollback、多人性能 CLI 和 live collaboration acceptance 测试模式。
- 使用合成 Workspace 和临时 SQLite Authority，不读取或修改用户真实 Workspace，不调用外部 Provider，不消耗生成额度。
- 代表性性能 fixture 至少覆盖 461 个 Node、321 条 Connection、约 3 MB Node payload、约 181 KB realtime state 和 200 条历史。
- 验证只更新 `x`、只更新 `y`、同一 Mutation 同时更新 `x/y`，以及整数、浮点数、零值和负坐标。
- 验证 Node payload 的其他字段、全部 Connection、Smart Group、Frame、Canvas metadata 和顶层 payload 在位置 Mutation 后保持不变。
- 验证一次成功位置 Mutation 只增加一个 Canvas Revision，并生成一条对应 Canvas Event、Mutation 历史和 operation receipt。
- 验证同一 operation ID 的相同重试不会再次改变 Node 或增加 Revision；不同 payload 或 actor 的同 ID 提交返回 collision。
- 验证 base Revision ahead、目标 Node 已删除、无权限 actor、只读访问和约束错误沿用现有拒绝行为。
- 验证 stale but allowed base Revision 与当前字段版本合并规则保持一致。
- 验证两个 actor 依次修改同一 Node 的相同位置字段时，最终值、Revision 顺序和 Undo conflict 与通用语义一致。
- 验证两个 actor 修改同一 Node 的 `x` 与 `y` 时，两项结果都保留；修改不同 Node 时最终 projection 正确。
- 验证快速位置 Mutation 可以被当前 actor Undo；之后出现同字段写入时 Undo 被拒绝，只有无关字段写入时 Undo 保留无关变化。
- 验证历史达到 200 条后的 trim、刷新重载和后续 Undo 行为正确。
- 验证在 Node 更新、Revision 更新、history、event、receipt 或 commit 任一点注入失败时，重新打开只能看到提交前或提交后的完整状态，不得出现部分 Revision。
- 对每一种非白名单 Mutation 做回退行为测试：多 Node 移动、`width/height`、Node unset、创建、删除、Connection、Smart Group、Frame、Canvas metadata、Undo、Generation Output。
- 通过真实 WebSocket 验证发送者确认、其他协作者广播、operation ID、连续 Revision 和最终 Snapshot 一致；不得因快速通道新增消息分支。
- Store 级代表性性能验收在同一约定测试机器上要求单 Node 位置 Mutation P95 不超过 20 ms，目标 P95 不超过 12 ms；报告同时保留硬件、运行时和 fixture manifest。
- 正式多人验收要求 10 人、20 Mutation/秒时确认 P95 不超过 150 ms、P99 不超过 300 ms，零永久失败；40 Mutation/秒突发无静默丢弃，并在 30 秒内恢复稳态。
- 9 机器人长场景至少完成 2160 次位置 Mutation，验证全部确认、Revision 连续、operation ID 无重复无遗漏、最终 Node projection 一致。
- 性能报告必须包含 P50/P95/P99、队列位置分布、快速通道命中率、回退类别、最终 Revision、一致性结果和脱敏环境 manifest。
- Chrome 实浏览器验收必须保持 realtime connected，Node 可拖动，确认后位置收敛；console error、page error 和 unhandled rejection 为零。组件弃用 warning 单独记录，不作为快速通道错误。
- 当前认可基线的关键 P95/P99 若无说明恶化超过 20%，即使仍低于绝对 Gate，也判定性能回退。
- 所有正确性、原子性和性能 Gate 同时通过后才可发布；单次偶然快速或平均值达标不能代替 P95/P99 与零失败要求。

## Out of Scope

- 不取消同一 Smart Canvas 的 Canvas Revision 排队。
- 不让同一 Smart Canvas 的写入并行执行。
- 不为多 Node 移动、resize、创建、删除、Connection、Smart Group、Frame、Undo 或 Generation Output 建立快速通道。
- 不改变 Canvas Interaction、Canvas Selection、Canvas Viewport 或客户端乐观预览。
- 不改变 HTTP、WebSocket、Canvas Event 或 Canvas Commit 公共协议。
- 不重构完整 Snapshot 或 Canvas 打开流程。
- 不在本交付中把 200 条历史改成按需查询。
- 不在本交付中拆分 realtime state、field versions 或 seen operations schema。
- 不在本交付中删除或替换 operation receipt / Bloom 幂等机制。
- 不在本交付中把广播移出 Canvas Sync operation lock。
- 不引入 PostgreSQL、Redis、多 Worker、跨进程锁或数据库分片。
- 不改变 Workspace Data、Instance State、Device State 或 Device Cache 边界。
- 不修复 WebAwesome `size` 属性弃用 warning。
- 不提供用户级性能设置、兼容模式或长期 feature flag。

## Further Notes

- 当前真实验收的 P95 596.1 ms 超过 live acceptance CLI 默认 500 ms Gate，也远高于正式性能计划中的 150 ms Gate。实现后必须使用正式 150/300 ms P95/P99 标准，不能只把默认 Gate 放宽。
- 离线阶段计时比真实端到端确认更短，因为它不包含 Canvas Sync 排队、WebSocket、广播、事件循环调度和浏览器处理。阶段计时用于定位瓶颈，正式多人测试用于放行。
- 快速通道原型的等价性比较覆盖 Node、Canvas Revision、realtime state、Mutation history、Canvas Event、operation receipt 和 Node/Connection 数量；三轮 200-history 性能 P50 为 6.3–6.8 ms、P95 为 7.8–8.8 ms。
- 当前 realtime state 约 181 KB，其中 seen operations 占大部分。它不是本交付前置条件，但如果快速通道上线后仍不能稳定通过正式 Gate，应优先单独设计实时状态标准化，而不是取消 Revision 顺序。
- SQLite `BEGIN IMMEDIATE` 会竞争数据库级 Writer，因此缩短单 Node Transaction 不仅改善同一 Smart Canvas 队列，也会减少其他 Smart Canvas 写入被占用的时间。
- 本规格沿用项目词汇：Smart Canvas、Canvas Mutation、Canvas Revision、Canvas Sync、Canvas Interaction、Node、Connection、Smart Group、Frame、Workspace Data。

## Frontend Diagnosis Addendum（2026-08-20）

### 结论

本规格提出的服务端单 Node 位置 Mutation 快速通道方向仍然正确，但它只解决 Authority 提交和确认延迟，不能单独保证大画布的浏览器交互流畅。2026-08-20 的真实多人验收和 Chrome 主线程诊断确认，当前问题同时包含一个独立的前端接收侧瓶颈：浏览器收到远端单 Node `x/y` Mutation 后，仍会执行完整 Canvas document 复制、rebase 和整画布 render。Node 数量越多、用户编辑期间排队的远端 Mutation 越多，松开焦点后的主线程阻塞越严重。

机器人行为符合测试设计。机器人通过服务端和 WebSocket 表现为其他协作者，而不是直接点击当前浏览器的本地 UI。Bug 位于当前浏览器对合法远端 Mutation 的处理方式，不是机器人绕过服务器或错误操作 Composer。

Composer 模型和生成张数面板自动关闭是第二个已确认的前端问题。`render()` 安排的延迟动态参数刷新会重建模型和张数控件；如果用户在回调执行前打开面板，原控件会被新的 DOM 元素替换，面板随之关闭。画幅与分辨率组件已有打开状态恢复，因此症状不同。该面板问题可以在没有机器人、只有一次计划刷新时稳定复现；机器人 Mutation 只会增加刷新频率和触发概率。

因此，本轮工作的完整判断是：

- 服务端快速通道是必要优化，继续负责降低 Mutation 确认 P95/P99 和 SQLite Writer 占用。
- 前端远端位置应用快速通道也是必要优化，负责避免一个小位置变化触发整画布重渲染。
- 两条路径必须分别测试；服务端 Gate 通过不能替代浏览器主线程和人工体感 Gate。
- WebSocket、Canvas Event 和 Mutation contract 不需要改变；前端优化发生在现有消息进入浏览器后的应用阶段。

### 当前 Worktree 已完成的前端修复

- 增加公开测试接缝 `CanvasRealtimeApplier.apply(message)`，WebSocket handler 和本地交互期间的远端消息队列统一通过该入口应用消息。
- 为严格单 Node `x`、`y` 或 `x/y` Mutation 增加前端快速通道，只更新 confirmed/live Node 位置、Canvas Revision、目标 Node DOM 坐标、虚拟化边界和 Connection layer。
- 快速通道仅在 Revision 连续、目标 Node 同时存在于 confirmed/live projection、没有本地 pending save 或 in-flight Mutation，且 payload 完全符合严格白名单时命中。
- 多 Node、Node 其他字段、create/delete/unset、Connection、Canvas metadata、Frame/Smart Group 结构、Undo、Generation Output、异常或未知 payload 全部安全回退现有通用路径。
- Composer 拥有的模型、张数、生成设置、模板和 Mention overlay 打开时，延迟动态参数刷新不得替换其控件；关闭后再执行必要刷新。
- 扩充 editable target 识别，保证 `ic-select`、`ic-number-input`、`ic-switch`、`ic-generation-settings-picker` 等自定义控件参与既有本地交互保护。

合成真实浏览器回归使用 335 个 Node，并在 Composer 控件保持焦点期间排队 1080 条、由 9 个 actor 轮流发送的单 Node `x/y` Mutation。修复前同类场景主线程 flush 约 7.1 秒；当前结果为 67.9 ms，最终 Revision 为 1080，Node projection 与已挂载 DOM 坐标一致，选中 Node DOM identity 保持不变，离开视口的 Node 由虚拟化正常卸载，console/page error 为零。该结果证明前端根因和修复方向，但不代替正式多人端到端 Gate。

### 2026-08-20 Follow-up Execution Result

- 隔离临时 Workspace 的 9 机器人长场景以 241 轮执行：9 次测试 Node 创建后完成 2160 次严格位置 Mutation，共 2169 次确认。P50 为 106.559 ms、P95 为 122.736 ms、P99 为 134.754 ms，满足 150/300 ms Gate；operation ID 完整且无重复，Revision 1–2169 连续，最终 9 个 Node 的 x/y projection 与预期一致。
- 队列位置 1–9 各有 240 个位置样本，各位置 P95 为 122.608–123.162 ms，未再出现旧基线随队列位置线性增加的约 50.7 ms/位退化。
- 10 客户端短时 rate smoke 在 20 Mutation/秒稳态下 P95/P99 为 103.783/107.824 ms，在 40 Mutation/秒突发下为 102.861/118.929 ms；零永久失败，2.518 秒恢复，10 个最终 projection 一致。该 smoke 不是 45 分钟 formal-standard 的替代证据。
- `CanvasRealtimeApplier.apply(message)` 的 335 Node、1080 条排队位置 Mutation 回归连续 5 次 flush P50/P95/P99 为 66.2/66.4/66.4 ms，最长 Long Task P95 为 65 ms；Composer 无关位置直用、同 Node 本地拖动排队、混合 Revision 顺序、虚拟化跨界和 DOM identity 均通过。
- 验收 CLI 现在把 operation ID、轮次、队列位置写入脱敏 metrics，并将 P95、P99、Revision 连续性、operation ID 完整唯一和最终坐标 projection 都设为公开报告 Gate。系统性能 runner 同时移除了会把空临时 Workspace 错判为 `recovery_required` 的过时预写。
- 该阶段仍未完成 45 分钟 formal-standard 持续负载及代表性大画布人工 Chrome 交互 Gate，因此当时不能进入发布流程；后续真实大画布结果见下节。

### 真实大画布收尾验收（2026-08-20）

本轮在一张已有的大画布上完成 1 位人工参与者加 9 个机器人、241 轮的正式长场景；原始报告保存在未入库的本机证据目录中。测试开始时画布包含 317 个 Node 和 257 个 Generation Output；机器人创建 9 个测试 Node，随后完成 2160 次位置 Mutation，共收到 2169 次确认。

正确性 Gate 全部通过：2160 次移动无永久失败，operation ID 完整且唯一，确认 Revision 唯一且连续，9 条 WebSocket Revision stream 均追上最终 Revision `11260`，最终 Node x/y projection 无差异。测试期间两次人工 Generation Output 写回使 9 个机器人连接各收到一次 `4409` resync，共 18 次；修复后的验收脚本均成功重连、读取最新 Snapshot，并以原 operation ID 继续，没有重复提交或静默丢失。

端到端确认延迟为 P50 `154.422 ms`、P95 `246.365 ms`、P99 `454.473 ms`。因此本次报告仅因 `robot_ack_p95_gate_failed` 退出，未满足 P95 `150 ms` / P99 `300 ms` 的正式发布 Gate。排除 18 个 resync 相关长尾后，2151 个样本仍为 P50 `153.931 ms`、P95 `243.803 ms`、P99 `275.198 ms`，说明 P95 的主要剩余成本不是断线恢复，而是同一 Canvas Revision 串行队列仍随队列位置累积约 20–23 ms。第 1 位 P95 为 `87.656 ms`，第 9 位 P95 为 `275.198 ms`。

与优化前真实基线 P50/P95/P99 `280.7/596.1/938.8 ms` 相比，本轮分别改善约 45%/59%/52%。人工体验确认大画布交互比优化前明显流畅，未再次出现此前超过 10 秒的前端 UI 卡死；这与前端单 Node 位置增量应用的自动化结果一致。但本轮画布规模为 317 个初始 Node，而旧基线代表画布为 461 个 Node，因此该百分比只作为方向性证据，不能当作严格同 fixture 的性能对比，也不能覆盖失败的绝对 Gate。

人工生成图片和上传图片时仍会看到“画布已出现更早确认的 Node；请基于最新 Revision 重新放置新 Node。”这是当轮验收确认的另一个 Canvas 协作问题，不是机器人测试脚本误操作：当时服务端只要发现 Node create 使用了较旧的 base Revision，就会拒绝第一次放置，即使期间其他协作者只移动了无关 Node。客户端随后会 resync、基于最新 Snapshot 自动重试；本轮 Generation Output 最终成功创建，没有发现数据丢失。该问题后来由 Issue #96 收窄为基于较新竞争 Node 的实际占地碰撞判断；本段保留为原始验收事实。

本次收尾结论是：单 Node x/y 服务端快速通道、前端接收侧快速通道以及验收脚本的 `4409` 恢复均通过真实大画布正确性验证，并带来显著可感知改善；但正式 P95/P99 性能 Gate 仍未通过，45 分钟 formal-standard 也尚未执行。本文作为当前已交付功能的实现与验收参考；进入 `current/` 不代表发布性能验收通过。后续优先定位每个队列位置约 20–23 ms 的剩余串行成本；Node create placement conflict 已由 Issue #96 建立独立回归并完成服务端规则修正。

### 下一步执行顺序

1. **已完成。** 在隔离 Workspace 和临时 SQLite Authority 中重跑正式 9 机器人、2160 次位置 Mutation 长场景；不得使用用户真实 Workspace、真实 Provider 或生成额度。验证全部确认、Revision 连续、operation ID 无重复无遗漏、最终 Node projection 一致。
2. **短时 rate smoke 已完成，45 分钟 formal-standard 待完成。** 按正式 10 人、20 Mutation/秒场景重新测量端到端确认延迟。P95 必须不超过 150 ms、P99 不超过 300 ms，且零永久失败；40 Mutation/秒突发必须无静默丢弃并在 30 秒内恢复稳态。2026-08-20 最近一次既有真实报告（本轮前端修复完成前采集）P95 为 224.1 ms，仍未满足 150 ms Gate，不能以 live acceptance CLI 默认 500 ms Gate 代替。
3. **部分完成。** 已记录合成 Chrome Long Task、Revision、projection、虚拟化、DOM identity 和错误；正式人工轮次仍需补远端消息队列峰值、位置快速通道命中数、通用路径回退类别和完整 render 次数。指标必须脱敏，不记录 Prompt、媒体 URL、凭据或完整 Mutation payload。
4. **自动化修复已完成，真实多人复测待执行。** 已在 317 Node 的真实大画布上完成机器人持续移动期间的人工生成、上传和交互观察；主观流畅度明显改善，未再次出现此前超过 10 秒的 UI 卡死。当轮生成和上传 Node 时出现过宽的 placement conflict 提示，自动 resync/retry 后 Generation Output 成功落图。Issue #96 已增加无关移动、真实占地冲突和历史窗口边界回归；后续人工 Gate 仍须验证模型、张数、画幅与分辨率面板、Prompt 输入、本地拖动、缩放和平移，以及持续移动期间 placement conflict 不再误报。
5. **已完成并保留为回归。** 把 335 Node、1080 条排队位置 Mutation 的真实 Chrome 回归保留为前端防卡死测试。当前 hard budget 为 500 ms，目标保持在 100 ms 内；测试必须同时验证最终 Revision、projection、DOM 坐标、虚拟化边界和零浏览器错误，不能只断言耗时。
6. **已完成。** 增加交互重叠测试：本地拖动同一 Node 时继续排队远端同字段更新；Composer 输入聚焦时，若远端位置 Mutation 与本地编辑无关，应评估直接应用而非累计到 blur。任何提前应用都必须先证明不改变字段级合并、乐观预览和 Revision 顺序。
7. **代表性标题＋位置混合队列已完成，完整 Mutation 类型矩阵待完成。** 增加混合队列测试：位置 Mutation 中穿插标题、尺寸、创建、删除、Connection、Frame/Smart Group、Undo 和 Generation Output，验证位置消息可以命中前端快速通道，而其他消息仍按顺序走通用路径且不会被合并、跳过或越过 Revision。
8. 单独评估通用 render 的后续深模块化：按 dirty Node/Connection/Composer surface 更新，而不是继续扩大 `render()` 的条件分支。该工作应形成独立规格，不能把非位置 Mutation 悄悄纳入本快速通道。
9. 所有服务端正确性与性能 Gate、前端自动化 Gate、真实 Chrome Gate 和人工交互 Gate 同时通过后，才能把本规格状态改为完成并进入发布流程。

### 剩余风险

- Composer 聚焦时，与当前 Composer/选择无关且前方没有排队消息的严格位置更新现在可以直接应用；同 Node、本地拖动、选择框、merge hold 或已有队列仍保持排队。长时间聚焦期间的非位置或相关位置消息仍可能积累内存队列。
- 位置变化使 Node 进入或离开虚拟化范围时，前端仍可能执行一次受限 render；这是保持可见 Node 集合正确所必需的边界行为，需要继续通过 Long Task 和 DOM identity 观测防止退化为整画布重建。
- 非位置 Mutation 按安全原则继续使用通用路径。如果用户编辑期间累计大量混合 Mutation，blur 后仍可能产生明显刷新；解决它需要新的增量渲染设计，不能放宽本规格的 x/y 白名单。
- 隔离长场景和短时 20/s rate smoke 已低于正式延迟 Gate；修复后的真实大画布人工＋机器人长场景也已执行，人工流畅度明显改善且正确性 Gate 全部通过，但 P95/P99 为 246.365/454.473 ms，仍未达到 150/300 ms 正式 Gate。前端流畅度改善和服务端确认延迟仍是两个不同指标，任何一方达标都不能推导另一方已经达标。
- Issue #96 已把 Node create placement conflict 收窄为较新竞争 Node 的实际占地碰撞，并为超过 200 条保留历史的旧 base Revision 保留安全校验。自动化证明无关移动不再触发拒绝；真实多人持续移动期间的生成和上传仍需人工复测，才能关闭这项发布风险。
