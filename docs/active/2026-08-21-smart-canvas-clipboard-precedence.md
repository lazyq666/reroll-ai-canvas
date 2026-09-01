# Smart Canvas 复制与粘贴的剪贴板优先级

- **Status**：Implemented（整体体验已确认；正式人工与真实环境 Gate 见 Issue #212）
- **Feature ID**：F05
- **Owners**：产品 / 交互 / 前端 / 测试
- **Last verified**：2026-08-30（用户确认整体体验；macOS 真实无头 Chrome 与聚焦自动回归通过；跨平台逐项矩阵、只读权限真实页、完整应用重启与合并后完整仓库回归由 Issue #212 跟踪）
- **Applies to**：Issue #114
- **Supersedes**：无；补全现有 Smart Canvas 文档未定义的系统剪贴板与节点复制载荷优先级
- **Superseded by**：无
- **Related ADRs**：[ADR-0001：Workspace Data、Instance State、Device State 与 Device Cache 的边界](../adr/0001-workspace-data-boundary.md)
- **Domain terms**：Smart Canvas、Node、Canvas Selection、Canvas Interaction、Canvas Mutation、Canvas Viewport

## 1. 一页摘要

Smart Canvas 支持复制 Node，并在同一浏览器标签页中跨 Canvas 粘贴。当前 Node 副本保存在应用内部；普通文字和图片则保存在操作系统剪贴板。因为两者没有共同的“最后一次复制”判断，用户先复制 Node、再复制普通文字后，在画布按 Cmd/Ctrl+V 仍会粘贴旧 Node。

本规格确立“最后一次复制优先”：通用粘贴入口必须以系统剪贴板当前内容为准。只有系统剪贴板仍携带与当前会话 Node 复制载荷匹配的应用标记时，Cmd/Ctrl+V 才能创建 Node；后续复制的文字、图片或其他内容会覆盖此前 Node 的通用粘贴资格。

本变更不把普通文字粘贴到画布解释为创建文字 Node。画布空白处收到普通文字时不创建 Node，也不改变 Canvas。外部图片继续按现有规则粘贴为媒体内容。

## 2. Problem Statement

用户复制 Canvas Selection 后，应用将 Node 数据保存在当前浏览器会话中。这个载荷不会随操作系统剪贴板中的普通复制动作更新或失效。

当用户随后在应用内输入区域、网页或其他应用中复制文字，再回到 Smart Canvas 按 Cmd/Ctrl+V 时，当前实现只看到旧 Node 载荷仍然存在，便阻止本次原生粘贴并创建 Node。用户可见结果违反所有常见创作工具中“最后一次复制决定下一次粘贴”的预期，也可能在 Canvas 中产生非预期的 Canvas Mutation。

当前实现还同时具有原生 `paste` 事件和延迟键盘兜底两条 Node 粘贴路径。只修正其中一条，另一条仍可能创建旧 Node。

## 3. Goals / Non-goals

### Goals

- Cmd/Ctrl+V 始终遵守系统剪贴板中最后一次复制的内容类型。
- 复制 Node 后立即按 Cmd/Ctrl+V，继续粘贴该 Node 或 Canvas Selection。
- 复制 Node 后再复制普通文字，回到 Canvas 按 Cmd/Ctrl+V 不得粘贴旧 Node。
- 复制 Node 后再复制图片，Cmd/Ctrl+V 只执行图片粘贴，不执行 Node 粘贴。
- 再次复制 Node 后，Node 粘贴资格恢复，并继续支持同一标签页内跨 Canvas 使用。
- 原生 `paste` 事件和任何键盘兜底必须共享同一个剪贴板归属判断，不得重复执行或产生竞态。
- 普通文字粘贴、无效标记和剪贴板权限失败不得产生 Canvas Mutation。

### Non-goals

- 不把粘贴到 Canvas 空白处的普通文字自动转换为 Prompt Node 或 Text Annotation Node。
- 不新增剪贴板历史、多个 Node 复制槽、恢复上一次 Node 副本或跨应用 Node 交换能力。
- 不扩大 Node 复制载荷的生命周期；它仍只服务当前浏览器标签页会话，不在应用重启后保留。
- 不改变复制或粘贴 Node 时的内容、Connection、刚性集合放置、Canvas Selection、Undo 或 Canvas Sync 规则。
- 不改变 Pointer 右键菜单中显式“粘贴节点”命令的产品定位；该命令仍是 Node 专用入口。已观察到普通文字或媒体覆盖 Node 后，旧载荷失效，菜单沿用现有不可用状态；实现不得让该命令影响 Cmd/Ctrl+V 的最后复制优先级。
- 不新增页面、公共 `ic-*` 组件、Design Token 或视觉布局。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| Administrator | 已登录且可编辑目标 Smart Canvas | 复制 Canvas Selection，并按本规格粘贴当前有效内容 | 通过粘贴绕过既有 Canvas 编辑权限 |
| Designer | 已登录且拥有目标 Project 的编辑权限 | 复制 Canvas Selection，并按本规格粘贴当前有效内容 | 在无权编辑的 Canvas 中创建 Node 或媒体 |
| Guest Account | 已登录但没有 Canvas 编辑权限 | 使用系统原生剪贴板处理非 Canvas 编辑内容 | 通过 Cmd/Ctrl+V 提交 Canvas Mutation |
| Anonymous Share Visitor | 通过 Share Link 只读查看 | 使用浏览器允许的页面选择与复制 | 粘贴 Node、上传媒体或提交 Canvas Mutation |

## 5. User stories

1. 作为复制 Node 的创作者，我希望立即粘贴时得到相同 Node，从而继续现有跨 Canvas 创作流程。
2. 作为复制 Node 后又复制文字的创作者，我希望文字成为最新内容，从而避免误粘贴旧 Node。
3. 作为复制 Node 后又复制图片的创作者，我希望画布只处理图片，从而避免同时出现图片和旧 Node。
4. 作为重新复制 Node 的创作者，我希望 Node 再次成为可粘贴内容，从而获得可预测的“最后一次复制优先”行为。
5. 作为在输入框编辑文字的创作者，我希望普通文字继续粘贴到输入框，并且不创建 Canvas Node。
6. 作为切换到同一标签页中另一个 Canvas 的创作者，我希望有效的 Node 副本仍可粘贴。
7. 作为遇到剪贴板权限或格式失败的创作者，我希望系统不创建错误内容，并给出可恢复的结果。
8. 作为连续按两次 Cmd/Ctrl+V 的创作者，我希望每次只执行一次符合当前剪贴板归属的粘贴。

## 6. User journey and interaction contract

### Entry and exit

- 用户先形成 Canvas Selection，再通过 Cmd/Ctrl+C 或现有 Node 复制命令复制 Node。
- 用户可留在当前 Smart Canvas，也可在同一浏览器标签页内切换到另一个可编辑 Smart Canvas。
- 用户在 Canvas 非文本编辑区域按 Cmd/Ctrl+V，系统根据本次系统剪贴板内容选择唯一粘贴行为。
- 成功粘贴 Node 或图片后沿用现有选择、放置、视口显示和 Undo 行为；普通文字或无效内容不改变 Canvas。

### Happy path：Node 仍是最后复制内容

1. 用户选择一个或多个 Node，执行复制。
2. 系统保存当前 Node 复制载荷，并在系统剪贴板写入与该载荷匹配的应用专用标记。
3. 用户在 Canvas 非文本编辑区域按 Cmd/Ctrl+V。
4. 系统确认标记有效且与当前会话载荷匹配。
5. 系统通过现有复制事务创建 Node，并且一次按键只产生一次 Canvas Mutation。

### Happy path：普通文字覆盖 Node

1. 用户复制一个或多个 Node。
2. 用户随后在任意支持系统复制的位置复制普通文字。
3. 新的系统复制替换此前 Node 标记。
4. 用户回到 Canvas 按 Cmd/Ctrl+V。
5. 系统识别本次内容不是有效 Node，也不是受支持的媒体，不创建 Node，不改变 Canvas。

### Observable states

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| empty | 当前会话没有 Node 复制载荷 | Canvas 保持原状 | 复制 Node、复制外部内容 | 完成一次复制 |
| node-owned | 系统剪贴板标记与当前 Node 载荷匹配 | 现有“已复制 Node”反馈 | Cmd/Ctrl+V、切换 Canvas、再次复制 | 其他复制覆盖，或会话结束 |
| external-text | 系统剪贴板当前为普通文字/HTML；旧 Node 载荷已失效 | Canvas 空白处粘贴不创建内容；输入区域沿用原生文字粘贴 | 再次复制或在输入区域粘贴 | 新复制发生 |
| external-media | 系统剪贴板当前包含受支持媒体；旧 Node 载荷已失效 | 沿用现有媒体粘贴结果 | Undo、继续编辑或再次粘贴 | 新复制发生 |
| invalid-node-marker | 存在 Node 标记，但版本、复制标识或会话载荷不匹配 | Canvas 保持原状 | 重新复制 Node 或复制其他内容 | 获得有效复制内容 |
| clipboard-failure | Node 数据已准备，但系统剪贴板标记写入或读取失败 | 明确失败反馈；不得声称 Cmd/Ctrl+V 已可用 | 重试复制、使用现有显式 Node 操作 | 成功复制或用户离开 |
| forbidden | 当前用户无编辑权限 | 沿用现有只读/无权限反馈 | 浏览或离开 | 权限恢复 |

### Input, pointer and keyboard

- macOS 使用 Cmd+C / Cmd+V；其他平台使用 Ctrl+C / Ctrl+V。
- 文本输入、Prompt Authoring、可编辑 Node 表面和 Modal 输入区继续优先使用原生文字复制与粘贴。
- Canvas 非文本编辑区域的 Cmd/Ctrl+V 必须根据系统剪贴板实际格式只选择一个行为。
- 受支持媒体优先走现有媒体粘贴路径；媒体处理后不得再触发延迟 Node 粘贴。
- 普通文字或无效 Node 标记属于已处理的粘贴结果，任何延迟兜底不得再次创建 Node。
- Pointer 右键菜单的“粘贴节点”继续表示显式 Node 专用命令，不扩展为普通文字粘贴入口。

### Responsive and themes

- 本变更没有新增布局或视觉表面；Desktop 与现有 Narrow 视口使用相同优先级。
- Light/Dark 不改变复制、格式识别或粘贴结果。
- 不新增视觉验收 Gate；只需确认现有 Toast、菜单和 Focus 没有回退。

### Copy and internationalization

- 成功时继续使用现有“已复制 {count} 个节点”和跨 Canvas 提示。
- 如果 Node 载荷保存成功但系统剪贴板标记失败，反馈不得继续声称 Cmd/Ctrl+V 可用。
- 普通文字粘贴到 Canvas 空白处默认静默无操作，不新增“创建文字节点”或错误 Toast。
- 应用专用剪贴板格式标识属于不可翻译技术标识，不进入用户文案。

## 7. Functional rules

1. 通用 Cmd/Ctrl+V 的唯一内容权威是本次系统剪贴板事件提供的格式与有效 Node 标记。
2. Node 复制载荷单独存在于应用会话中，不足以证明 Node 仍是最后复制内容。
3. 复制 Node 时必须为本次复制生成不可猜测或足够唯一的复制标识，并把其版本与标识写入系统剪贴板的应用专用格式。
4. 系统剪贴板标记只保存识别所需的版本和复制标识，不保存完整 Node、Prompt、媒体 URL、Generation Settings 或 Connection 数据。
5. Node 粘贴前，系统剪贴板标记必须与当前标签页会话中的 Node 复制载荷版本和复制标识同时匹配。
6. 匹配失败、标记缺失或载荷缺失时，Cmd/Ctrl+V 不得使用旧 Node 载荷创建 Node。
7. 普通文字、HTML 或其他非 Node 内容覆盖系统剪贴板并被应用观察到后，此前 Node 复制载荷必须失效，不再具备 Cmd/Ctrl+V 或显式“粘贴节点”的使用资格。
8. 受支持图片、视频、音频或文件继续优先使用现有媒体粘贴规则，并且一次粘贴不同时创建 Node 副本。
9. 普通文字粘贴到 Canvas 非文本编辑区域不创建 Prompt Node、Text Annotation Node 或其他 Node，也不提交 Canvas Mutation。
10. 普通文字粘贴到可编辑区域继续交给该区域处理，不得被 Canvas 粘贴逻辑阻止。
11. 任意原生 `paste` 事件一旦确认内容类型，即视为本次 Cmd/Ctrl+V 已处理；延迟键盘兜底不得再次执行。
12. 未经有效系统剪贴板标记确认的键盘兜底不得创建 Node。无法确认时宁可不粘贴，也不得粘贴旧 Node。
13. 复制标记有效时允许连续多次 Cmd/Ctrl+V；每次按键各创建一次 Node 粘贴事务。
14. 再次复制 Node 会创建新的复制标识，并取代此前 Node 复制资格。
15. 同一标签页内切换 Canvas 后，有效标记和会话载荷继续匹配时可以粘贴 Node。
16. 页面重载后只有现有会话恢复规则允许恢复的载荷可以参与匹配；应用完全重启后不得恢复 Node 粘贴资格。
17. 应用内复制文字或图片的已知入口必须立即使此前 Node 标记和载荷失效；外部应用的复制最迟在下一次通用粘贴事件中被识别并使载荷失效。
18. Node 粘贴继续使用现有刚性集合、内部 Connection、落点、选择、Undo、保存和 Canvas Sync 合同。
19. 无编辑权限时，任何有效剪贴板内容都不得提交 Canvas Mutation。
20. 剪贴板格式或权限错误不得回退为使用旧 Node 载荷。

## 8. Domain and state model

本规格不新增持久领域对象。它只规定一次 Canvas Interaction 如何决定是否提交 Canvas Mutation。

涉及三类状态：

- **系统剪贴板内容**：由操作系统拥有，下一次复制会整体取代上一次可粘贴内容。
- **Node 复制载荷**：当前浏览器标签页会话保存的临时副本数据，用于在标记匹配后重建 Node。
- **复制标识**：系统剪贴板中的应用专用、无业务内容标记，用于证明 Node 载荷仍对应最后一次复制。

```text
复制 Node
  → 保存 Node 复制载荷
  → 写入匹配标记
  → node-owned

node-owned
  ├─ Cmd/Ctrl+V + 标记匹配 → 一次 Node Canvas Mutation → node-owned
  ├─ 复制普通文字         → external-text
  ├─ 复制媒体             → external-media
  └─ 会话结束             → empty
```

Canvas Selection 只决定复制时包含哪些 Node，不属于系统剪贴板或持久 Smart Canvas 内容。粘贴成功后创建的新 Node 才属于 Workspace Data，并通过现有 Canvas Mutation 与 Canvas Sync 保存。

## 9. Data and persistence

| Data | Authority | Boundary | Retention | Migration/recovery |
| --- | --- | --- | --- | --- |
| Node 复制载荷 | 当前浏览器标签页会话 | 浏览器临时状态；不属于 Workspace / Instance / Device 持久数据 | 被下一次已观察到的非 Node 复制覆盖，或标签页会话结束 | 无迁移；无效或旧版本安全忽略 |
| 复制标识 | 操作系统剪贴板 | Device 临时外部状态 | 被下一次复制覆盖 | 不恢复；失配时安全忽略 |
| 粘贴创建的 Node/Connection | Smart Canvas 文档 / Canvas Sync | Workspace Data | 随 Canvas 生命周期 | 沿用现有保存、同步和恢复 |
| 粘贴交互去重状态 | 当前页面 | 浏览器短暂内存 | 单次按键/事件窗口 | 页面重载时丢弃 |

完整 Node 数据不得写入系统剪贴板标记。Node 复制载荷不得迁移到 Workspace Data、Instance State、Device State 或 Device Cache。

## 10. API / WebSocket / Provider contracts

| Contract | Caller | Observable result | Errors/recovery |
| --- | --- | --- | --- |
| 浏览器 Copy/Paste Event | Smart Canvas 交互层 | 写入/读取应用专用标记并识别当前内容类型 | 格式或权限失败时不使用旧 Node 载荷 |
| Canvas Mutation duplicate | 已确认有效 Node 标记的粘贴意图 | 创建一次 Node/Connection 副本事务 | 无载荷、无权限或失配时不调用 |
| Canvas 保存与同步 | 当前编辑端 | 持久化粘贴产生的 Node 与 Connection | 沿用现有重试、Revision 和恢复 |

不改变公开 HTTP、WebSocket 或 Provider 协议，也不新增后端剪贴板接口。

## 11. Security and privacy

- 系统剪贴板中的应用标记不得包含 Prompt、节点标题、媒体 URL、Generation Settings、Connection 或其他 Canvas 内容。
- 复制标识只用于同一应用会话内匹配，不作为认证、授权或跨用户能力凭证。
- 粘贴前继续执行现有 Canvas 编辑权限判断；有效标记不能绕过权限。
- 系统剪贴板读取只发生在用户主动复制/粘贴相关手势中，不进行后台轮询或持续监听。
- 未知格式、伪造标记、版本不匹配或缺失会话载荷必须安全无操作。

## 12. Performance and reliability constraints

- 剪贴板判断必须在一次用户粘贴事件内完成，不引入网络请求、后端读写或 Canvas 全量扫描。
- 应用专用标记保持小型，只包含版本和复制标识。
- 一次 Cmd/Ctrl+V 最多提交一次 Canvas Mutation。
- 媒体粘贴、文字粘贴和 Node 粘贴必须互斥。
- 事件去重不得依赖容易跨按键误判的长时间窗口；状态只覆盖当前粘贴意图。
- 浏览器无法确认剪贴板归属时采用安全无操作，不回退到旧 Node。
- 本变更不得降低 Node 跨 Canvas 粘贴、连续粘贴、Undo、保存或重载后的文档一致性。

## 13. Design system contract

- 不新增或修改 `ic-*` 公共组件、Design Token、Focus Policy 或合法组合。
- 沿用现有 Node 复制 Toast、Smart Canvas 快捷键说明和“粘贴节点”菜单项。
- 剪贴板失败若需要反馈，使用现有 Toast 合同，不新增 Dialog 或持久 Alert。
- 本变更没有新的 Light/Dark、Desktop/Narrow 或视觉状态矩阵。

## 14. Implementation decisions

- 系统剪贴板负责证明“最后一次复制的类型”；会话 Node 载荷负责保存重建数据。两者必须通过同一个复制标识匹配。
- Node 复制通过浏览器 Copy Event 写入应用专用格式；标记只携带版本和复制标识。
- Node 载荷继续使用当前标签页会话边界，不扩大到持久本机存储或 Workspace Data。
- 原生 `paste` 事件是通用粘贴的最高入口，集中完成媒体、Node、普通文字和未知格式分发。
- 现有延迟键盘兜底必须删除、收敛到同一分发器，或要求本次粘贴已经确认有效 Node 标记；不得只凭会话载荷存在执行。
- 应用内所有已知文字/图片复制入口通过同一失效接口清除当前 Node 会话载荷；外部内容在下一次通用粘贴事件中触发相同失效。
- Pointer “粘贴节点”保持显式 Node 专用入口；载荷失效后沿用现有禁用/隐藏行为，其可用状态不改变 Cmd/Ctrl+V 的系统剪贴板判断。

这些决定不需要新 ADR：它们修正浏览器交互优先级，不改变 Workspace、Instance、Device、公开协议或持久数据边界。

## 15. Acceptance and testing

### Highest test seam

最高接缝是通过真实 Smart Canvas 页面执行 Node 复制、系统文字/媒体复制和 Cmd/Ctrl+V，观察最终 Node 数量、媒体内容、一次 Undo 与跨 Canvas 行为。纯函数或静态源码检查不能替代浏览器 Clipboard Event 验收。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
| Node → Cmd/Ctrl+V | Browser | 只创建一份 Node 副本；一次 Undo 完整撤销 |
| Node → Node → Cmd/Ctrl+V | Browser | 只粘贴最后一次复制的 Canvas Selection |
| Node → 普通文字 → Canvas Cmd/Ctrl+V | Browser | Node 数量、Connection 和 Canvas Revision 均不变 |
| Node → HTML/富文本 → Canvas Cmd/Ctrl+V | Browser | 不粘贴旧 Node，不创建新内容 |
| Node → 普通文字 → 输入框 Cmd/Ctrl+V | Browser | 文字进入输入框，Node 数量不变 |
| Node → 图片 → Cmd/Ctrl+V | Browser | 只执行媒体粘贴，不创建 Node 副本 |
| 普通文字 → Node → Cmd/Ctrl+V | Browser | Node 成为最后复制内容并正常粘贴 |
| Node → 切换同标签页 Canvas → Cmd/Ctrl+V | Browser | 有效 Node 跨 Canvas 粘贴一次 |
| Node → 连续两次 Cmd/Ctrl+V | Browser | 每次各产生一次副本，无单次重复创建 |
| 伪造/旧版本/失配标记 | Browser/interaction | 安全无操作，不使用旧会话载荷 |
| 剪贴板标记写入失败 | Browser/interaction | 不声称快捷键可用；Cmd/Ctrl+V 不粘贴旧 Node |
| 媒体 paste 与键盘兜底竞态 | Browser | 只产生媒体，不在延迟后增加 Node |
| 普通文字 paste 与键盘兜底竞态 | Browser | 90ms 及更长等待后 Node 数量仍不变 |
| Pointer 空白画布右键菜单 | Browser/interaction | 顺序为上传媒体、提示词、生成图片/视频 → 分割线 → 编组、分区、分隔符、批量运行 → 分割线 → 粘贴节点；“生成图片/视频”创建 Generation Node，不得降级为 Upload Node |
| 无编辑权限 | Browser/HTTP integration | 不提交 Canvas Mutation |
| 应用完全重启 | Browser | 旧 Node 复制资格不可恢复 |

### Human acceptance

| Role | Scene | Evidence / confirmation |
| --- | --- | --- |
| Interaction | macOS Cmd 与 Windows/Linux Ctrl 的复制顺序矩阵 | 最后一次复制始终决定通用粘贴结果 |
| Product | Node、文字、图片交替复制 | 不出现旧 Node；普通文字不自动创建文字 Node |
| UI | 现有 Toast、Focus、右键菜单 | 没有新增视觉模式；失败反馈可理解且不误导 |
| Test | 跨 Canvas、连续粘贴、等待延迟兜底 | 每个意图最多一次 Mutation，旧载荷不复活 |

2026-08-30：用户确认 Clipboard 整体体验验收完成。公开发布前仍按 Issue #212 逐项记录 Windows/macOS 复制顺序、产品、UI、交互、无编辑权限真实页、应用完全重启和合并后完整仓库回归证据。

### Regression neighbors

- Canvas Selection 的单选、多选与 Container 展开。
- Copy/Paste 的内部 Connection 重建与刚性集合放置。
- 同一标签页跨 Canvas 的 Node 复制载荷。
- 外部图片、视频、音频和文件粘贴。
- Prompt Authoring、Prompt Node、Modal、搜索与普通输入框的原生复制粘贴。
- Pointer 右键菜单“复制”“创建副本”“粘贴节点”。
- Cmd/Ctrl+D 创建副本，不能与 Cmd/Ctrl+C/V 混淆。
- Undo、Canvas Revision、保存、重载与 Realtime Collaboration。

### Implementation verification（2026-08-21）

- `NODE_PATH=/private/tmp/ic-empty-prompt-playwright/node_modules node tests/issue_114_clipboard_precedence_browser_smoke.cjs`：通过。真实无头 Google Chrome 覆盖 Node→Node、Node→文字→Canvas、Node→文字→输入框、Node→图片、文字→Node、连续粘贴、同标签页跨 Canvas、失配标记、标记写入失败、180ms 后旧 Node 不复活；同时确认一次 Undo、内部 Connection、刚性集合放置和显式“粘贴节点”失效状态。
- `.venv/bin/python -m unittest tests.test_issue_114_clipboard_precedence`：3 项通过。确认模块加载顺序、标记只含版本与复制标识、失配拒绝及 90ms 兜底移除。
- `node --check static/js/smart-canvas.js`、`node --check static/js/smart-canvas/clipboard-ownership.js`、`node --check tests/issue_114_clipboard_precedence_browser_smoke.cjs`、`git diff --check`：通过。
- `.venv/bin/python -m unittest tests.test_smart_canvas_interaction_optimizations.SmartCanvasInteractionOptimizationTests.test_copy_as_image_and_session_scoped_cross_canvas_node_clipboard`：通过。
- 2026-08-29 文档清理后，`tests.test_documentation_knowledge_map` 的 7 项知识地图检查全部通过。
- 尚未完成：Issue #212 中的跨平台逐项人工矩阵、无编辑权限真实页验证、应用完全重启后的旧资格不可恢复，以及合并后的完整仓库回归。未完成前不得提升为 `Verified`、`Current` 或 `Done`。

## 16. Rollout, migration and rollback

- 不迁移 Canvas、Node、Connection 或 Workspace 数据。
- 旧会话载荷没有复制标识时视为无效；用户重新复制 Node 即可恢复。
- 发布 Gate 是真实 Chrome 浏览器中的复制顺序矩阵、媒体邻居、输入框回归、跨 Canvas 与一次 Undo 通过。
- 若应用专用格式在支持浏览器中不可用，降级为不通过 Cmd/Ctrl+V 粘贴 Node，并保留明确失败反馈；不得回退到旧载荷猜测。
- 回滚只涉及前端剪贴板分发，不需要数据降级或后端回滚。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product map | [F05 Smart Canvas 创作与交互](../PROJECT-MAP.md#功能规格注册表) |
| Tracked work | Issue #114；Issue #212 发布前人工与真实环境验收 |
| Current placement reference | [Smart Canvas 节点自动避让](../current/smart-canvas-node-auto-placement.md) |
| Related Current Spec | [创建副本 Connection 继承规则](../current/smart-canvas-duplicate-connection-inheritance.md) |
| UI surfaces | Smart Canvas 非文本编辑区域、文本编辑区域、Node 右键菜单 |
| Implementation seams | 浏览器 Copy/Paste Event 分发、Node 会话复制载荷、Canvas Mutation duplicate |
| Automated tests | Smart Canvas Clipboard browser smoke；现有 shell、interaction、context-menu 回归 |
| ADRs | [ADR-0001](../adr/0001-workspace-data-boundary.md) |

## 18. Open questions

无。普通文字粘贴到 Canvas 自动创建文字 Node 属于独立产品能力，不阻塞本修复。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| 2026-08-21 | Approved | 根据 Issue #114 建立复制/粘贴优先级规格 | 用户确认“最后一次复制优先”；普通文字覆盖 Node，Canvas 空白处不自动创建文字 Node |
| 2026-08-21 | Implemented | 引入系统剪贴板标记与会话 Node 载荷的复制标识匹配，统一原生 paste 分发并移除 90ms Node 兜底 | macOS 真实无头 Chrome 顺序矩阵、媒体、输入框、跨 Canvas、连续粘贴、失配、写入失败、Undo、内部 Connection 与刚性放置通过；人工与跨平台 Gate 待完成 |
| 2026-08-27 | Implemented | 重组空白画布右键菜单的三组命令顺序 | 上传/生成入口拆分为独立行为，粘贴节点保持底部独立分组；页面级浏览器验收覆盖顺序、分割线与默认聚焦 |
| 2026-08-30 | Implemented | 用户确认 Clipboard 整体体验；建立 Issue #212 跟踪公开发布前的跨平台逐项人工与真实环境 Gate | 产品体验确认不替代 Windows/macOS 矩阵、只读权限、完整重启与合并后完整回归证据 |
