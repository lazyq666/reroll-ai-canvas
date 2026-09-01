# Smart Canvas 创建副本的 Connection 继承规则

- **Status**：Current
- **Feature ID**：F05
- **Owners**：产品 / 交互 / 前端 / 测试
- **Last verified**：2026-08-21（实现、聚焦回归、一次 Undo、协作确认与重载验收通过）
- **Applies to**：Issue #83
- **Supersedes**：无；补全现有 Current 文档未定义的外部 Connection 继承规则
- **Superseded by**：无
- **Related ADRs**：无
- **Domain terms**：Smart Canvas、Node、Connection、Canvas Mutation、Canvas Selection、Canvas Interaction、Smart Group

## 1. 一页摘要

用户复制 Smart Canvas 中的一段创作分支时，副本应从相同的直接输入继续创作，但不应自动接入原分支的下游。

例如原始关系为 `A → B → C`，对 B 创建副本 B1 后，系统创建 `A → B1`，但不创建 `B1 → C`。多选时保留选区内部的完整结构；例如同时复制 B、C，得到 `A → B1 → C1`，但不创建 `C1 → D`。

本规格只改变“创建副本”的 Connection 继承方向，并注销 Option/Alt+Shift 拖动的特殊“保留连接”语义。Node 内容、生成配方、位置、选区内部关系、保存、协作同步和一次 Undo 边界保持不变。

## 2. Problem Statement

当前“创建副本”会复制所有与选区相接的 Connection。原始关系为 `A → B → C` 时，对 B 创建副本会同时得到 `A → B1` 与 `B1 → C`，把用户未选择的下游 C 自动接到新分支上。

Current 文档只定义了副本的放置、相对布局和选区内部 Connection，没有定义外部输入与外部输出的继承边界；现有实现和测试则把两种方向都保留。用户无法预测副本是否会改变原有下游流程。

## 3. Goals / Non-goals

### Goals

- 创建副本只继承指向选区的直接外部 `input` Connection。
- 创建副本保留所有选区内部 Connection，并将两端映射到对应副本。
- 创建副本不产生任何从副本指向选区外 Node 的 Connection。
- 右键“创建副本”和 Cmd/Ctrl+D 使用同一规则。
- 普通 Option/Alt 拖动继续只复制选区内部 Connection。
- 移除 Option/Alt+Shift 拖动的特殊 Connection 继承语义和说明。
- 异常或悬空的历史 Connection 不得使创建副本失败。

### Non-goals

- 不改变 Copy/Paste 的关系规则。
- 不改变 Node 内容、Generation Output 当前结果、生成配方、设置或输入快照。
- 不扫描、清理或回写历史画布中的旧副本关系。
- 不维护外部 `flow` 或 `history` 输入的继承。
- 不新增 Loop Node 专属行为。
- 不在本 Issue 中改变 Smart Group 的端口、连接校验或执行语义。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Administrator | 已登录且可编辑目标 Smart Canvas | 通过所有支持入口创建副本并撤销 | 绕过既有 Canvas 编辑权限 |
| Designer | 已登录且拥有目标 Project 的编辑权限 | 通过所有支持入口创建副本并撤销 | 在只读或无权限 Canvas 中创建副本 |
| Guest Account | 已登录但没有 Canvas 编辑权限 | 查看被允许的非编辑页面 | 创建副本或提交 Canvas Mutation |
| Anonymous Share Visitor | 通过 Share Link 只读查看 | 查看 Shared Canvas | 创建副本或提交 Canvas Mutation |

## 5. User stories

1. 作为复制单个中间 Node 的创作者，我希望副本继承该 Node 的直接输入但不自动连接原 Node 的下游，从而安全地开始新分支。
2. 作为复制连续多个 Node 的创作者，我希望选区内部结构完整复制，并保留进入选区的直接 `input`，从而得到可继续工作的独立分支。
3. 作为复制多输入 Node 的创作者，我希望副本保留全部直接输入、顺序与关系元数据，从而不破坏素材组合或生成配方。
4. 作为重复创建副本的创作者，我希望每次操作都以操作开始时的实际直接输入为准，从而获得可预测结果。
5. 作为使用右键菜单或键盘快捷键的创作者，我希望两个入口产生完全一致的 Node 与 Connection。
6. 作为使用 Option/Alt 拖动的创作者，我希望 Shift 不再切换另一套隐藏的 Connection 继承规则。
7. 作为撤销操作的创作者，我希望新增 Node 与 Connection 作为一次 Canvas Mutation 被完整撤销。
8. 作为重新打开画布或参与实时协作的创作者，我希望副本关系沿用现有保存与同步机制保持一致。
9. 作为打开少量历史画布的创作者，我希望无效或悬空 Connection 不会让创建副本报错。

## 6. User journey and interaction contract

### Entry and exit

- 用户先形成 Canvas Selection，再通过 Node 右键菜单的“创建副本”或 Cmd/Ctrl+D 执行。
- 操作成功后，副本按既有刚性布局规则放置并成为当前 Canvas Selection。
- 用户可通过一次 Undo 同时移除本次新增的 Node 与 Connection。
- 普通 Option/Alt 拖动仍在拖动开始时创建副本；同时按住 Shift 不再改变关系规则。

### Happy path

1. 用户在 `A → B → C` 中选择 B。
2. 用户执行“创建副本”。
3. 系统创建 B1，保留 B 的内容和直接外部 `input`。
4. 系统创建 `A → B1`，不创建 `B1 → C`。
5. 系统按既有布局显示并选择 B1，保存一次 Canvas Mutation。

### Observable states

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| ready | Canvas Selection 至少包含一个可复制 Node | 原 Node 与既有 Connection | 创建副本、复制、删除或取消选择 | 执行或取消 |
| committed | 创建副本成功 | 副本、内部关系与直接外部 `input` | 继续编辑、再次复制或 Undo | 下一次 Canvas Mutation |
| recovered | 历史关系含无效端点 | 可解析部分被复制，无崩溃 | 继续编辑或 Undo | 下一次操作 |
| forbidden | 当前用户无编辑权限 | 现有只读反馈 | 浏览或离开 | 权限恢复 |
| offline/recovering | 保存或实时连接暂时不可用 | 沿用现有 Canvas 恢复反馈 | 等待、重试或离开 | 同步恢复或失败 |

### Input, pointer and keyboard

- Pointer：Node 右键菜单“创建副本”执行本规格。
- Keyboard：Cmd+D（macOS）或 Ctrl+D（其他平台）执行相同行为。
- Pointer modifier：Option/Alt 拖动只复制选区内部 Connection；Option/Alt+Shift 没有独立语义，等同普通 Option/Alt 拖动。
- Copy/Paste：继续只复制选区内部 Connection，不继承外部输入。

### Responsive and themes

- 本变更不新增视觉布局、组件或主题状态。
- Desktop 与现有支持的 Narrow 视口沿用相同 Connection 规则。
- Light/Dark 只需确认没有入口回退，不需要新增视觉 Gate。

### Copy and internationalization

- 继续使用现有“创建副本”文案与 Cmd/Ctrl+D 快捷键提示。
- 删除 Option/Alt+Shift 的特殊行为说明；不新增替代文案。

## 7. Functional rules

将原 Canvas Selection 记为 S，对应副本集合记为 S'：

1. 两端都在 S 中的 Connection 必须复制，并将 `from` 与 `to` 都映射到 S' 中对应 Node。
2. 选区内部的 `input`、`flow`、`history` Connection 均按规则 1 复制，并保留关系元数据。
3. 从 S 外部 Node 指向 S 内 Node 的 `input` Connection 必须复制；外部来源保持不变，目标映射到 S'。
4. 从 S 内 Node 指向 S 外 Node 的任何 Connection 都不得复制。
5. 从 S 外指向 S 内的 `flow` 或 `history` Connection 不得复制。
6. 外部输入只包含直接 Connection；系统不得递归复制更上游 Node 或关系。
7. 多个直接外部 `input` 必须全部保留，并沿用现有输入顺序与元数据。
8. 规则按 Connection 方向与类型判断，不按 Node 类型分支。
9. `A → B → C` 复制 B 必须得到 `A → B1`，不得得到 `B1 → C`。
10. `A → B → C → D` 同时复制 B、C 必须得到 `A → B1 → C1`，不得得到 `C1 → D`。
11. 无法解析端点的历史 Connection 必须安全跳过或规范化，不得阻止可复制 Node 完成操作。
12. Node 内容、位置、刚性布局、选择、保存、同步和一次 Undo 边界保持现状。

## 8. Domain and state model

Connection 是 Node 之间的有向联系。本文不使用“父级/子级”作为判定条件，而使用可观察方向：

- **外部输入 Connection**：`from` 在 S 外，`to` 在 S 内。
- **外部输出 Connection**：`from` 在 S 内，`to` 在 S 外。
- **选区内部 Connection**：`from` 与 `to` 都在 S 内。

创建副本是一次 Canvas Mutation。Canvas Selection 是本地状态，只决定本次 S 的成员；创建完成的 Node 与 Connection 属于 Smart Canvas 的持久内容。

Smart Group 在本规格中遵守通用规则，不增加例外。其未来“只允许作为输入源、没有左侧 in”方向属于独立规格。

## 9. Data and persistence

| Data | Authority | Boundary | Retention | Migration/recovery |
| --- | --- | --- | --- | --- |
| 副本 Node | Smart Canvas 文档 / Canvas Sync | Workspace Data | 随 Canvas 生命周期 | 不迁移旧副本 |
| 新 Connection | Smart Canvas 文档 / Canvas Sync | Workspace Data | 随 Canvas 生命周期 | 无效旧端点安全跳过 |
| Canvas Selection | 当前浏览器编辑端 | 本地临时状态 | 当前页面会话 | 不迁移 |
| Undo 记录 | 现有 Canvas Mutation 历史 | 当前编辑会话 | 现有上限 | 一次撤销本次全部新增内容 |

不新增存储字段、格式版本或数据迁移。

## 10. API / WebSocket / Provider contracts

| Contract | Caller | Observable result | Errors/recovery |
| --- | --- | --- | --- |
| Canvas Mutation duplicate | Smart Canvas 交互入口 | 返回副本 Node；文档只新增符合本规格的 Connection | 无有效 Node 时无操作；异常旧关系安全跳过 |
| Canvas 保存与同步 | 当前编辑端 | 持久化同一组副本 Node 与 Connection | 沿用现有重试、冲突与恢复 |
| Realtime 广播 | Canvas Sync | 其他客户端看到相同副本关系 | 沿用现有 Revision 与 resync |

不改变公开 HTTP、WebSocket 或 Provider 协议。

## 11. Security and privacy

- 继续使用既有 Canvas 编辑权限边界。
- 创建副本不读取或发送新的用户数据、秘密或外部资源。
- 只读用户不能通过快捷键或 Pointer 入口绕过权限提交 Canvas Mutation。

## 12. Performance and reliability constraints

- 关系筛选只遍历本次选区和当前 Canvas Connection，不递归遍历上游图。
- 创建副本继续作为一次原子用户意图处理，不产生额外保存或实时广播。
- 无效历史 Connection 的防御处理不得中断可复制 Node 的创建。
- 本变更不得降低现有 Undo、保存、重载和协作一致性。

## 13. Design system contract

- 不新增或修改 `ic-*` 公共组件、Design Token、Focus Policy 或视觉模式。
- 保留现有右键菜单“创建副本”和快捷键展示。
- 删除的 Option/Alt+Shift 特殊语义不需要替代 UI。

## 14. Implementation decisions

- Canvas Mutation 的 duplicate 接口继续拥有 Node 克隆、ID 映射和 Connection 重建责任。
- “保留外部关系”收敛为“只保留外部 `input` 入向关系”，避免新增多个方向布尔开关。
- 显式传入的剪贴板 Connection 集合继续只按选区内部关系处理，不改变 Copy/Paste。
- Option/Alt 拖动不再根据 Shift 启用外部关系继承；Shift 可继续参与其他既有选择/交互，但不改变副本 Connection。
- 不按 Node 类型分支；无法解析端点的 Connection 在关系重建阶段被过滤。

这些决定不需要 ADR：它们修正现有可观察交互合同，不改变长期架构或数据边界。

## 15. Acceptance and testing

### Highest test seam

最高接缝是通过真实 Smart Canvas 页面执行右键“创建副本”和 Cmd/Ctrl+D，观察最终 Node、Connection、一次 Undo 与重载后的文档。Canvas Mutation 公共接口测试负责覆盖方向和类型矩阵。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
| `A → B → C` 右键复制 B | Browser | 存在 `A → B1`，不存在 `B1 → C`；一次 Undo 恢复原图 |
| `A → B → C` 通过 Cmd/Ctrl+D 复制 B | Browser | 与右键结果一致 |
| 同时复制 B、C | Canvas Mutation | 存在 `A → B1 → C1`，不存在 `C1 → D` |
| 多个外部 `input` | Canvas Mutation | B1 保留全部直接输入、顺序和元数据 |
| 内部三种 Connection | Canvas Mutation | `input`、`flow`、`history` 都映射到副本 |
| 外部非 `input` 入向 | Canvas Mutation | 不复制 `flow` 或 `history` |
| Option/Alt+Shift 拖动 | Browser/interaction | 行为等同普通 Option/Alt 拖动，没有特殊外部关系 |
| Copy/Paste | Browser | 继续只重建选区内部 Connection |
| 悬空旧 Connection | Canvas Mutation | 创建副本成功，不报错 |
| 保存后重载 | Browser + Canvas persistence | 副本关系保持，未出现外部输出 |

### Verification result

| Gate | Result | Evidence |
| --- | --- | --- |
| Connection 方向与类型矩阵 | PASS | `tests.test_smart_canvas_canvas_mutation` |
| Option/Alt+Shift 等同普通 Option/Alt | PASS | `tests.test_smart_canvas_canvas_interaction` |
| 快捷键说明移除 | PASS | `StudioShellUiRegressionTests.test_shortcut_labels_follow_device_platform` |
| 右键与 Cmd/Ctrl+D | PASS | `tests/issue_83_smart_canvas_duplicate_browser_smoke.cjs` |
| 一次 Undo 与协作确认后重载 | PASS | 同一聚焦 Browser smoke；Undo 恢复 `A → B → C`，重载后保持 `A → B1` 且无 `B1 → C` |
| JavaScript 语法与补丁格式 | PASS | `node --check`、`git diff --check` |

本变更没有新增视觉状态，用户已在规格访谈中确认交互边界，因此不设置额外人工视觉 Gate。

### Human acceptance

| Role | Scene | Evidence / confirmation |
| --- | --- | --- |
| Interaction | 单选与多选分支复制 | 下游未选 Node 不被新副本连接 |
| Product | 右键、快捷键、Option/Alt 拖动对比 | 各入口符合已确认边界 |
| Test | Undo、重载与少量历史异常数据 | 不残留 Connection、不恢复被排除关系、不崩溃 |

### Regression neighbors

- Copy/Paste 的内部 Connection 重建。
- Option/Alt 拖动副本和 Canvas Selection。
- 刚性多选放置与 Container 展开。
- Generation Output 的 active output、配方、设置和输入快照。
- Connection 的 `inputNodeIds`、顺序和 source output 元数据。
- Undo、保存、重载和 Realtime Collaboration。

## 16. Rollout, migration and rollback

- 行为只影响变更发布后的新建副本，不修改既有 Canvas。
- 不运行迁移；少量历史异常 Connection 只在操作时安全跳过。
- 回滚可恢复旧关系筛选逻辑，不涉及存储降级或数据转换。
- 发布 Gate 是聚焦 Mutation 测试、真实浏览器行为、知识地图测试及相邻回归通过。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product map | [F05 Smart Canvas 创作与交互](../PROJECT-MAP.md#功能规格注册表) |
| Tracked work | Issue #83 |
| Current placement reference | [Smart Canvas 节点自动避让](../current/smart-canvas-node-auto-placement.md) |
| Historical context | [V0 Smart Canvas 右键菜单与导航需求](../archive/V0-smart-canvas-context-menu-and-navigation-requirements.md) |
| UI surfaces | Smart Canvas Node 右键菜单、Cmd/Ctrl+D、Option/Alt 拖动 |
| Implementation seams | Canvas Mutation duplicate；Canvas Interaction drag begin |
| Automated tests | Smart Canvas Canvas Mutation 测试；Smart Canvas shell browser smoke |
| ADRs | 无 |

## 18. Open questions

无。Smart Group 的 source-only 方向已明确拆为独立规格，不阻塞本功能。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| 2026-08-21 | Implementing | 将 Issue #83 已批准规格同步为 Active Spec，并开始实现 | 用户确认关系矩阵、入口边界、未来生效与 Smart Group 拆分 |
| 2026-08-21 | Verified | 实现关系继承规则，注销 Option/Alt+Shift 特殊语义，完成聚焦 Mutation、Interaction 与真实 Browser 验收 | 右键与 Cmd/Ctrl+D、Undo、协作确认后重载、配方不变均通过 |
