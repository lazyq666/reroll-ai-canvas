# Canvas Updated Time 语义

- **Status**：Implemented / Archived
- **Feature ID**：F06（关联 F04 Canvas List）
- **Owners**：产品 / 交互 / 前端 / 后端 / 测试
- **Last verified**：2026-08-21（实现、自动化与真实 Chromium 回归通过）
- **Applies to**：Issue #102
- **Supersedes**：修复前 [Canvas Sync 实施合同](../current/canvas-sync-implementation.md)中的 Touch 更新时间规则
- **Superseded by**：[Canvas Sync 实施合同](../current/canvas-sync-implementation.md)
- **Related ADRs**：无
- **Domain terms**：Canvas、Classic Canvas、Smart Canvas、Canvas Edit、Canvas Updated Time、Canvas Mutation、Canvas Revision、Canvas Selection、Canvas Viewport、Canvas Interaction

## 1. 一页摘要

Canvas List 展示的更新时间只回答一个问题：“这个 Canvas 的内容或身份上一次真正被编辑是什么时候？”

进入、浏览或重新连接 Canvas，不是 Canvas Edit。选择 Node、滚动查看 Prompt、移动 Canvas Viewport、打开面板或完成一个没有产生内容差异的手势，也不是 Canvas Edit。这些动作不得写入 Canvas，不得改变 Canvas Updated Time、最近编辑人或 Smart Canvas Revision。

只有一次已成功提交、并且确实改变持久 Canvas 内容或身份的 Canvas Edit，才能推进 Canvas Updated Time。

## 2. Problem Statement

当前兼容逻辑把“打开 Canvas”投影成 Touch 写入，并复用 Canvas Updated Time 表示最近访问时间。因此用户只浏览 Canvas，Canvas List 仍会显示一个新的更新时间，造成“内容刚被修改”的错误理解。

Smart Canvas 打开时还可能执行旧数据整理或运行状态清理。如果这些整理通过普通 Canvas Mutation 保存，也会让读取行为伪装成用户编辑。

## 3. Goals / Non-goals

### Goals

- Canvas Updated Time 只随真实 Canvas Edit 改变。
- Classic Canvas 与 Smart Canvas 对“编辑”和“浏览”采用同一产品语义。
- 进入、选择、滚动、缩放、平移、预览和无差异操作保持 Canvas 只读。
- 旧客户端仍可安全调用兼容 Touch 合同，但调用结果不能改变 Canvas 编辑事实。
- 通过最高公共接缝证明被排除的交互没有 Canvas 写入。

### Non-goals

- 不新增 Last Opened Time、最近访问人、浏览历史或 Presence 产品能力。
- 不改变 Canvas Selection 与 Canvas Viewport 的个人状态归属。
- 不改变 Smart Canvas Mutation 的合并、幂等、Undo 或权限规则。
- 不回填或猜测已有 Canvas 历史上哪些更新时间来自旧 Touch；旧时间保留原值。
- 不改变 Canvas List 的视觉布局或时间格式。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Administrator | 已登录且可访问目标 Canvas | 浏览或提交获授权的 Canvas Edit | 通过浏览、管理动作或兼容 Touch 改变 Canvas Updated Time |
| Designer | 已登录且拥有目标 Project 访问权 | 浏览或提交获授权的 Canvas Edit | 通过浏览、选择、滚动或 Viewport 操作改变 Canvas Updated Time |
| Anonymous Share Visitor | 持有有效 Share Link | 只读浏览 Shared Canvas | 写入 Canvas、Canvas Updated Time、最近编辑人或 Revision |

## 5. User stories

1. 作为创作者，我希望打开 Canvas 后列表时间保持不变，从而相信它表示最近编辑而非最近访问。
2. 作为创作者，我希望选择 Node 和滚动查看长 Prompt 不留下内容写入。
3. 作为创作者，我希望一次成功的内容编辑及时更新时间，从而判断作品最近何时发生变化。
4. 作为协作者，我希望其他人只浏览时不会产生虚假的远端更新或 Revision。
5. 作为维护者，我希望旧 Touch 调用成为无写入的兼容合同，不再污染编辑语义。

## 6. User journey and interaction contract

### Entry and exit

- 从 Canvas List 进入 Classic Canvas 或 Smart Canvas 只读取所需内容和权限。
- 返回 Canvas List 时，若期间没有 Canvas Edit，卡片上的 Canvas Updated Time 与进入前完全相同。
- 登录恢复、页面刷新、Realtime 重连和关闭页面遵守同一规则。

### Happy path

1. 用户进入 Canvas，浏览并选择不同 Node。
2. 用户在 Prompt Node、Prompt Generation Node 或 Prompt Authoring 编辑器中滚动查看文本。
3. 系统可以更新本地 UI 或个人 Viewport 状态，但不提交 Canvas 写入。
4. 用户真正修改内容并成功提交。
5. 系统更新持久 Canvas、Canvas Updated Time 和最近编辑人；Smart Canvas 同时推进 Revision。

### Observable states

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| browsing | 进入、刷新、重连或只读查看 | 正常 Canvas 内容 | 选择、滚动、平移、缩放、打开预览 | 离开或开始编辑 |
| editing | 用户改变持久内容或身份 | 本地编辑反馈 | 提交、取消、Undo/Redo | 提交成功或放弃 |
| committed | 非空 Canvas Edit 被接受 | 更新后的内容 | 继续编辑或离开 | 下一次交互 |
| no-op | 手势结束但内容无差异 | 内容不变 | 继续浏览或编辑 | 下一次交互 |
| rejected | 权限、冲突或校验失败 | 明确失败反馈 | 重试、同步或放弃 | 新提交成功或离开 |
| recovering | 网络或页面连接恢复 | 恢复提示或最新快照 | 等待、重试 | 同步完成或失败 |

### Input, pointer and keyboard

- 单击、右键或键盘切换 Canvas Selection 不构成 Canvas Edit。
- Pointer drag 只有在最终产生超过既有交互阈值且成功提交的位置或尺寸差异时才构成 Canvas Edit。
- Prompt Node、Prompt Generation Node 与 Prompt Authoring 编辑器中的滚轮、触控板和滚动条只改变查看位置。
- Canvas Viewport 的平移、缩放、Minimap 导航和 Zoom Preview 不是 Canvas Edit。
- 输入后又恢复为已确认值，或在提交前取消，不改变 Canvas Updated Time。

## 7. Functional rules

1. Canvas Updated Time 必须等于最近一次成功提交的非空 Canvas Edit 的完成时间。
2. 创建 Canvas 时初始化 Canvas Updated Time；创建不是 Touch 或浏览。
3. 打开、读取、刷新、聚焦、失焦、离开、Realtime 连接、重连、心跳和 Presence 不得改变 Canvas Updated Time、最近编辑人或 Canvas Revision。
4. Canvas Selection、Canvas Viewport、当前工具、Hover、Pointer 状态、面板开关、预览与滚动位置不得进入持久 Canvas。
5. 在 Prompt Node、Prompt Generation Node 或 Prompt Authoring 编辑器中滚动查看内容不得产生 Canvas 写入。
6. 未移动的 Node 点击、低于提交阈值的拖拽、取消的交互、被拒绝的提交、重复 Operation ID 和空差异提交不得改变 Canvas Updated Time。
7. Node 或 Connection 的创建、删除、移动、调整尺寸、内容修改、Canvas 持久设置修改、Generation Output 发布，以及真正改变内容的 Undo/Redo，属于 Canvas Edit。
8. Canvas 标题或图标等持久身份修改属于 Canvas Edit。
9. Pin、Canvas List 位置、Project 归类、Canvas Visibility、Share Link、Trash、Restore、Purge 和 owner transfer 是内容管理动作，不得推进 Canvas Updated Time；Purge 删除记录本身，不产生新的更新时间。
10. Classic Canvas 只有在提交的持久快照相对已确认内容存在差异时才更新 Canvas Updated Time；空快照保存必须是无写入结果。
11. Smart Canvas 只有在非空 Canvas Mutation 被接受时才同时推进 Canvas Revision 与 Canvas Updated Time。
12. 读取时的旧数据规范化只能存在于内存。等价的持久格式迁移必须由独立迁移流程执行，并保留 Canvas Updated Time、最近编辑人和逻辑 Revision。
13. 如果恢复动作确实新增、删除或改变用户可见内容，它必须作为独立 Canvas Edit 提交；不能伪装成打开或浏览的副作用。
14. 兼容 Touch 调用不得写入 Canvas，也不得改变 Canvas Updated Time、最近编辑人或 Revision。
15. 产品不使用 Canvas Updated Time 表示最近访问，也不在本功能中另存 Last Opened Time。

## 8. Domain and state model

Canvas Edit 是跨 Classic Canvas 与 Smart Canvas 的产品概念：

- Classic Canvas 可以通过存在真实差异的持久快照完成 Canvas Edit。
- Smart Canvas 通过被接受的非空 Canvas Mutation 完成 Canvas Edit。
- Canvas Interaction 只是一段本地手势；它可以被放弃，也可以在结束时产生 Canvas Edit。
- Canvas Selection 与 Canvas Viewport 永远不是 Canvas Edit。

Canvas Updated Time 与最近编辑人共同描述最近一次 Canvas Edit。Canvas Revision 继续表达 Smart Canvas 共享状态的顺序身份；三者不能被访问行为推进。

## 9. Data and persistence

| Data | Authority | Boundary | Retention | Migration/recovery |
| --- | --- | --- | --- | --- |
| Canvas 持久内容与身份 | Canvas Store / Canvas Sync | Workspace Data | 随 Canvas 生命周期 | 逻辑等价迁移保留编辑时间与 Revision |
| `updated_at`（Canvas Updated Time 的存储表示） | Canvas Store | Workspace Data | 随 Canvas 生命周期 | 不回填旧 Touch 历史 |
| `updated_by`（最近编辑人） | Canvas Store | Workspace Data | 随 Canvas 生命周期 | 与 Canvas Updated Time 保持同一 Canvas Edit 语义 |
| Canvas Revision | Canvas Sync | Workspace Data | 随 Smart Canvas 生命周期 | 等价迁移不得推进 |
| Canvas Selection | 浏览器编辑端 | 本地临时状态 | 页面会话 | 不迁移 |
| Canvas Viewport | 个人 View State | Instance State | 按现有个人视图规则 | 可独立保存，但不得写 Canvas |
| Prompt 滚动位置 | 浏览器编辑端 | 本地临时状态 | 当前页面 | 不迁移 |

底层数据库或文件的物理修改时间不是 Canvas Updated Time 的权威来源。

## 10. API / WebSocket / Provider contracts

| Contract | Caller | Observable result | Errors/recovery |
| --- | --- | --- | --- |
| 读取 Canvas | Canvas 页面、Share 页面 | 返回当前 Canvas，不产生写入 | 权限失败保持只读失败 |
| 兼容 Touch | 旧页面或旧客户端 | 返回未改变的 Canvas 投影；不写入 | 可保留兼容响应形状 |
| Classic 快照提交 | Classic Canvas | 非空差异成功后更新时间；空差异不写 | 冲突或失败保留原时间 |
| Smart Canvas Mutation | Realtime Client Connection | 非空 Mutation 成功后推进 Revision 与时间 | 重复、空差异或拒绝保留原值 |
| 个人 View State | Smart Canvas | 只读写个人 Viewport | 失败不降级为 Canvas 写入 |

## 11. Security and privacy

- 所有真实 Canvas Edit 继续在提交边界重新检查权限。
- 浏览不产生虚假的 `updated_by`，避免把访问者错误标记为最近编辑人。
- Anonymous Share Visitor 的浏览不能触发任何 Canvas 或 Instance 私有状态写入。

## 12. Performance and reliability constraints

- 单纯进入和浏览 Canvas 不产生 Canvas Store 写事务或协作广播。
- 高频 Selection、Pointer、滚轮和 Viewport 事件不进入 Canvas Sync 队列。
- 重试与重复 Operation ID 保持幂等，不得重复推进 Canvas Updated Time。
- 网络恢复读取最新快照，但不因连接恢复创建 Canvas Edit。

## 13. Design system contract

- 不新增 UI 组件、Token 或视觉状态。
- Canvas List 继续使用现有时间展示；变化仅来自数据语义纠正。
- 无需单独视觉验收，但需要真实页面行为验收。

## 14. Implementation decisions

- Canvas 打开流程不得调用任何用于表示最近访问的 Canvas 写命令。
- 兼容 Touch 合同保留响应兼容时，必须实现为 Canvas 无写入操作；不再拥有更新时间职责。
- Classic Canvas 在持久化前比较已确认内容与提交内容，空差异不得进入写事务。
- Smart Canvas 打开期的数据规范化与持久迁移分离；打开期不能借规范化提交 Mutation。
- Canvas Updated Time 和最近编辑人由接受 Canvas Edit 的同一原子提交更新。

这些决定不需要 ADR：它们修正可观察产品语义，没有引入新的长期存储边界或难以逆转的架构选择。

## 15. Acceptance and testing

### Highest test seam

最高接缝是带真实认证、Canvas Store、HTTP/WebSocket 和真实 Canvas 页面事件的浏览器验收；接口测试用于锁定时间、最近编辑人与 Revision 的精确值。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
| 打开 Classic Canvas 后返回列表 | Browser + HTTP | `updated_at`、`updated_by` 与内容保持不变，无 Canvas 写请求 |
| 打开干净 Smart Canvas | Browser + WebSocket | 只接收 Snapshot；时间、编辑人和 Revision 不变 |
| 打开含旧表示的 Smart Canvas | Browser + migration fixture | 页面可读；打开本身不提交 Mutation，等价迁移不改变编辑事实 |
| 单击或切换不同 Node | Browser | Selection 改变，Canvas Store、时间和 Revision 不变 |
| 滚动三类 Prompt 查看区域 | Browser | 滚动位置改变，无 Canvas Mutation、时间或 Revision 变化 |
| 平移、缩放、Minimap、Zoom Preview | Browser + View State | 可保存个人 Viewport，但 Canvas Store、时间和 Revision 不变 |
| 低于阈值的拖拽或取消编辑 | Browser | 无 Canvas Edit，时间不变 |
| 直接调用兼容 Touch | HTTP | 响应成功兼容，Canvas 记录逐字段不变 |
| 提交 Classic 非空内容差异 | HTTP + Store | 内容、时间和最近编辑人原子更新 |
| 提交 Smart 非空 Mutation | WebSocket + Store | 内容、Revision、时间和最近编辑人原子更新一次 |
| 重复、空差异或被拒绝提交 | HTTP/WebSocket | 时间、编辑人和 Revision 不变 |
| Visibility、Share、Project、Pin、Trash/Restore | HTTP + Store | 管理结果生效，Canvas Updated Time 保持不变 |
| 远端协作者提交真实编辑 | 双页面 Browser | 两端看到内容与新时间；只浏览的一端不会产生额外更新 |

### Human acceptance

| Role | Scene | Evidence / confirmation |
| --- | --- | --- |
| Interaction | 打开、选择、滚动、Viewport 与取消手势 | Canvas List 时间保持不变 |
| Product | 真实编辑与内容管理动作对比 | 只有 Canvas Edit 改变更新时间 |
| Test | 旧客户端 Touch 与旧 Canvas fixture | 兼容响应存在，但无访问型 Canvas 写入 |

### Regression neighbors

- Classic Canvas 的 `updated_at` 冲突检测。
- Smart Canvas Revision、Undo、幂等与双页面同步。
- Canvas List 时间展示、Pin、Project、Trash 与 Restore。
- 个人 Canvas Viewport 保存与恢复。
- 打开期旧数据迁移和 Generation Recovery。

## 16. Rollout, migration and rollback

- 不回写历史数据，也不尝试推断旧 Touch 造成的时间。
- 旧客户端调用 Touch 时得到兼容响应，但不再改变 Canvas。
- 发布 Gate 必须先通过 Touch、打开、选择、滚动、Viewport 和真实编辑验收矩阵。
- 若回退应用，旧版本可能重新执行 Touch；回退说明需明确该已知语义退化。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| GitHub Issue | #102 检查画布更新规则 |
| Product map | [F06 Realtime Collaboration 与 Canvas Sync](../PROJECT-MAP.md#功能规格注册表) |
| Current authority | [Canvas Sync 实施合同](../current/canvas-sync-implementation.md) |
| UI surfaces | Canvas List、Classic Canvas、Smart Canvas、Share Page |
| Implementation seams | Canvas Store、Canvas Sync、Classic Persistence、Smart Canvas Persistence、Viewport Selection |
| Automated tests | Canvas Sync contract、Canvas Store、Viewport Selection、Prompt Interaction、真实页面 Browser smoke |
| ADRs | 无 |

## 18. Open questions

无。产品已决定 Canvas Updated Time 只表达 Canvas Edit，不表达访问。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| 2026-08-21 | Approved | 明确 Touch、浏览、Selection、Viewport 与 Prompt 滚动不得推进 Canvas Updated Time；只有 Canvas Edit 可以更新时间 | Issue #102 与已确认的 Touch drift |
| 2026-08-21 | Implemented | Store、legacy Sync、HTTP/WebSocket、打开流程、Classic/Smart no-op 与管理动作已对齐；开发规格归档 | 自动化测试与 `canvas_updated_time_browser_smoke.cjs` |
