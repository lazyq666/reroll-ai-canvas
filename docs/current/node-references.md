# Smart Canvas 节点引用与 Agent 精确读取

> Status: Current  
> Source: [LAZ-90](https://linear.app/lazyq/issue/LAZ-90)  
> Scope: 已授权 Account 在 Smart Canvas 中复制对象身份，并由 Agent 读取最新持久内容

## 复制行为

选中节点后使用常规右键菜单的“复制节点引用 / Copy node reference”，或在画布交互上下文
按 macOS `⌘L`、Windows `Ctrl+L`。菜单显示当前平台的快捷键；原有节点包复制/粘贴和
Shift 扩展菜单的“复制节点 ID”继续保留。

- 动作开始时固定当前 Workspace、Canvas 和显式 Node 选区，按选区顺序去重并保留完整 ID。
  等待期间改变选区不会替换本次目标。Smart Group、Frame 仅引用自身，不展开成员；
  节点内媒体/输出的局部高亮不增加媒体索引或 Output ID。
- 通过现有 Canvas Sync checkpoint 提交待保存变化并等待服务器确认，最多 5 秒。
  随后由同账号的只读确认接口检查同一 Workspace、Canvas 和全部目标仍可访问。
  只有确认完成且剪贴板写入成功才显示包含数量的成功提示。
- 浏览器支持 `ClipboardItem` 时，在原始用户操作中发起写入，以 Promise 提供保存确认后的文本。
  保存失败、身份变化、容量超限、剪贴板拒绝分别给出可重试反馈，不报告成功。
  保存失败独立于剪贴板 Promise 收敛，浏览器仍在等待时也能结束本次动作。
- 输入框、节点文字编辑、Composer 编辑、弹窗、无显式选区、非画布焦点不拦截快捷键。
  Shift、Alt、两个主修饰键同时按下和重复 keydown 不触发本动作。
- 菜单、等待/失败反馈、单复数数量提示支持中英文切换；不增加说明面板。

引用只表达身份，不含名字、提示词、媒体、凭证、账号资料或本地路径。它不是 URL、Share Link、
内容快照或生成用的 Reference Input Instance。复制本身不创建节点、不生成，也不另建持久化通道。

## 文本合同

```text
Reroll workspace=<encoded-workspace-id> canvas=<encoded-canvas-id> nodes=<encoded-node-id>,<encoded-node-id>
```

固定前缀、字段名与字段顺序；字段间恰好一个 ASCII 空格。每个完整 ID 使用 UTF-8
`encodeURIComponent` 转义，逗号只分隔 Node ID。服务端严格反转义，支持中文、空格、`%`、
`=`、逗号等身份字符；拒绝空 ID、控制字符、无效 UTF-8/百分号转义、额外字段、行尾或第二行。
重复 Node ID 按第一次出现的顺序去重。最多 1,000 个输入 ID、131,072 字节编码文本；
超过限制整体失败，不截断为前一页。ID 不限定为 UUID 或固定长度。

## 读取与编辑边界

MCP `read_node_reference(reference)` 对应
`POST /api/agent/v1/node-references/read`，请求体为 `{"reference":"整行文本"}`。
服务、当前 Workspace 和 Account 授权沿用 [ADR-0019](../adr/0019-account-agent-canvas-authoring.md)。
服务端先验证 Workspace，再通过既有 Canvas/Project/Private Canvas 权限检查读取一个持久快照，
最后确认所有显式目标存在。读取不依赖打开的编辑器、当前选区、Editor Context 或节点名称。

| 成功字段 | 含义 |
| --- | --- |
| `workspace_id`, `canvas_id`, `node_ids` | 验证后的精确身份与去重后的有序目标 |
| `canvas_revision` | 本次完整读取快照的 Canvas Revision |
| `nodes[].node_id`, `type` | 每个显式目标的身份和节点类型 |
| `nodes[].content` | 该节点的完整已保存对象，文本不截断；容器保留自己的成员/组织信息 |
| `nodes[].node_revision` | 沿用已有读取投影的内容指纹 |
| `nodes[].generation_task` | 生成节点额外返回[完整详情](agent-task-editing.md)，包括全文、参数、有效输入与更新所需版本 |

二进制媒体仍通过独立的 `preview_media` 读取。引用读取不会把容器成员加入 `nodes`，不会
创建 Run、修改 Canvas、授权访问或切换 Workspace/服务。MCP 将整行直接送到明确的读取入口，
不调用模糊名称解析，也不改变已锁定的另一张 Canvas。

Agent 收到引用时，先读取整份引用。全部成功后，按用户的实际指令使用既有编辑工具，明确传入
结果中的 `canvas_id`；修改生成节点继续使用已有 `expected_node_revision` 和 dry run 流程。
失败时说明诊断并等待用户决定，不替换对象、不自动修改有效子集。本功能不提供跨节点编辑事务。
复制后改名、编辑或关闭编辑器不使身份过期；再次读取返回最新持久内容。读完后的并发变化仍需
由后续权限和版本检查发现，读取不保证目标永久有效。

| 失败码 | 诊断 |
| --- | --- |
| `invalid_node_reference` | 格式、字段或身份编码无效 |
| `node_reference_too_large` | 超出数量或字节限制，details 提供对应上限 |
| `workspace_mismatch` | 引用不属于服务当前 Workspace；不回退到同名/同局部 ID 对象 |
| `forbidden` | Canvas 不存在、已删除或当前 Account 无权访问；统一隐藏未授权存在性 |
| `node_not_found` | 已授权 Canvas 中至少一个目标缺失；details 只列缺失 ID，响应不含有效子集 |

网页保存后的确认使用 `POST /api/canvases/{canvas_id}/node-reference`，请求体相同，返回身份和
Canvas Revision，不返回内容。它使用现有登录 Session 和同一完整目标检查；路径与文本的
Canvas 不同返回 `canvas_mismatch`。初始 Workspace 身份来自 Canvas Sync 的
`canvas_snapshot.workspace_id` 元数据，不写入 Canvas 内容。

## 验证入口

- `tests/test_node_references.py`：真实授权/SQLite 的全文、容器、版本、最新内容、失效整体失败、
  Workspace 隔离、权限、转义、205 个目标和容量限制。
- `tools/reroll-mcp/tests/test_node_reference_protocol.py`：真实 stdio → HTTP → SQLite，已锁定另一张
  Canvas、失败诊断、独立桥接重启读回及零生成；无需编辑器。
- `tests/node_reference_copy.test.cjs`：平台修饰键、固定捕获、保存失败和剪贴板等待的独立收敛。
- `tests/node_reference_browser.cjs` 与隔离 `tests/node_reference_fixture.py`：完整页面、真实剪贴板、
  保存延迟/超时与重试、浏览器 Permissions Policy 拒绝、多选/容器/局部媒体、双语和 Light/Dark。
- 原生 Chrome 验收使用 macOS 系统按键、右键菜单与实际粘贴，再将相同文本交给真实 MCP 读取。
  Windows 分支由针对性回归覆盖，未声称完成 Windows 实机验收。执行结果与截图记录在 LAZ-90。

本地实现与验收不等同于推送或部署。服务端需重启加载，已安装 MCP 桥接需更新/重启发现新工具。
