# Agent MCP：读取、预览与修改节点

本合同对应 [LAZ-89](https://linear.app/lazyq/issue/LAZ-89) 的 P0，扩展
[Agent 编排规格](../active/2026-10-17-agent-mcp-canvas-authoring-spec.md)与
[ADR-0019](../adr/0019-account-agent-canvas-authoring.md)。使用已授权 Account 的
`authoring` 权限，沿用每次请求的 Canvas / Project / Private Canvas 访问检查。
服务与已配对 MCP 桥接可用即可；读取、预览和保存均不需要打开编辑器。
首次配对和独立的 `run_tasks` 仍遵循原有网页授权、编辑器执行合同。

## 完整读取

`get_generation_task(node_id, canvas="")` 对应
`GET /api/agent/v1/canvases/{canvas_id}/tasks/{node_id}`。
只接受当前指定画布内的精确 Node ID，不使用选区、视口或模糊匹配。
不存在返回 `node_not_found`；不是生成节点返回 `not_generation_task`；无权访问返回 `forbidden`。

| 字段 | 合同 |
| --- | --- |
| `canvas_id`, `node_id`, `frame_id` | 持久化对象身份；分区无成员归属时为 null |
| `state`, `editable`, `edit_block_reason` | 首期可改 API 模型的 draft；pending/running/failed/succeeded 或其他引擎只读 |
| `node_revision` | 不透明内容指纹，涵盖节点、有效媒体/文字输入与输入连接。目标节点或其输入变化会失效；无关节点编辑不会失效。它不是递增整数 |
| `canvas_revision` | 读取快照对应的 Canvas Revision |
| `geometry`, `frame_geometry` | 实际持久化的 `{x,y,width,height}`；无所属分区时 `frame_geometry` 为 null。`resolved_inputs[].position` 仍只表示输入顺序 |
| `recipe` | `prompt`, `title`, `kind`, `model`, `params`, `refs`，可用于部分更新 |
| `run_settings` | 节点实际保存的完整 Generation Settings，包括非 Agent 可编辑字段；不从目录默认值重建 |
| `resolved_inputs` | 按实际生成输入顺序排列的媒体清单 |
| `text_inputs` | 上游 Prompt/编组文字与本地 TXT 快照全文，保留独立来源；不混入可写回的本节点 `recipe.prompt` |
| `validation` | `valid`, `errors`, `warnings`；详情可返回有问题的节点，保存则拒绝可确定的错误 |

`recipe.prompt` 是本节点完整编写文本，保留中文、换行、引用标记与文末内容，不截断。
旧节点缺少文本字段时读取 HTML 中的文本与标记，再回退到已保存 `runPrompt`。
写入仍遵守既有 100,000 字符上限。`get_canvas` 保留 200 字摘要，并增加
`prompt_truncated` 与 `prompt_length`；完整内容只在详情接口读取。

创建回执返回 `frame_geometry` 和按 Node ID 索引的 `task_geometries`，由提交后的持久快照读取。
`get_canvas` 和 `get_selection` 摘要也提供 `geometry`。幂等重试保留原提交回执，
独立详情读取则反映节点后续移动后的当前位置。默认落位以参考节点附近为优先，详见 F17 规格。

对于旧完成视频被误写为 `referenceGenerationKind=image` 的节点，仅在已有
`generationOutputNode=true` 时以明确同类输出媒体、输出模式或冻结的生成模式纠正读取投影，
随后才回退已有身份。`recipe.kind/model/params` 使用对应视频设置；读取不迁移历史、
不修改原始 `run_settings`、提示词、引用或输出。

## 模型选择与兼容

`list_models` 与编辑器使用同一可见模型清单，遵守管理员显隐、排序与 Provider 边界。
仅即梦维护目录中确认属于同一模型的大小写别名共享身份，例如 `Seedance2.5` 与
`seedance2.5`；VIP、不同模型及其他 Provider 不合并。新配方规范为目录 Model ID，
已有大写草稿仍可校验、改标题或提示词，局部更新不重写未修改的 `runSettings`。
旧大小写能力记录仍可按相同身份读取。

原模型隐藏、删除或不可用时保留选择与时长，详情返回 `model_unavailable`，写入明确拒绝；
编辑器显示不可用选择并要求重新选择，运行入口同样拒绝。不能静默换成列表首项、
换 Provider 或按另一模型压缩时长。打开 Composer 不是发现错误的前提。

引用解析对照现有编辑器的 `promptAuthoring`、`referenceInstances` 和 Smart Container：

- 展开当前 input Connection 与旧 `inputNodeIds`，遵循同一来源节点去重规则。
- 编组遵循 `memberOrder`；旧编组遵循媒体在前、节点成员在后的顺序。返回最终来源路径。
- 有 live Connection 时优先使用它；否则按编辑器顺序使用已保存的配方/运行引用或自身媒体，叠加手动附带与提示词标记。
- 应用 `blockedInputRefs`、实例去重与 `inputRefOrder`。相同图片的两个独立引用实例保持两项。
- 每项提供 `reference_id`、`labels`、`binding_label`、按媒体类型计数的 `display_number`、整体 `position`、`kind`、`name`、来源节点/索引/输出/实例、`origin`、`source_path`、`media_id` 与 `preview_source`。
- `binding_label` 使用稳定的图片/视频/音频编号；`labels` 是提示词绑定别名，不能把编号当成别名。详情不改写提示词。
- 已有未固定输出的连线按编辑器 active output 规则读取，并给出 `active_output_binding` 警告和本次实际输出 ID；显式新绑定不能省略多输出选择。
- 旧手动引用没有实例 ID 时，读取返回确定的 `legacy-manual:` 身份，后续版本化保存补齐相同 ID；读取本身不迁移或写入。

## 视频音频能力

编写视频配方前以 `operation="video.generate"` 读取 `get_model_capability`。
`output.audio.default` 表示默认是否生成音频，`null` 表示尚未确认；
`output.audio.configurable` 表示当前接入是否允许调整音频参数。
`authoring.parameters` 只列出当前能力实际声明且能映射到 Composer 设置的参数。
当其中没有 `generate_audio` 时，配方省略该参数；显式填写会得到 `parameter_unknown`。

Dreamina 的 Seedance 2.0/2.5 返回 `output.audio={default:true, configurable:false}`：
默认生成音频，当前接入没有关闭开关。旧字段
`composer_options.generate_audio="unsupported"` 只描述开关能力，不能据此推断视频无声。
能力目录保留旧发布记录兼容，并在管理员保存后保持音频默认值与可控参数一致。
旧草稿里保存的不可控 `videoGenerateAudio` 仅从 `recipe.params` 中省略，原始
`run_settings` 和持久设置保持不变，仍可修改标题或提示词；这不允许显式提交该参数。
详细语义见[模型能力目录](../active/2026-09-04-model-capability-catalog.md#42-视频音频输出与参数控制)。
该返回值不检查单个视频文件的音轨，也不要求用实际生成来确认已维护的默认值。

## 图片预览

`preview_media(source, canvas="", max_edge=1600)` 对应只读的
`POST /api/agent/v1/canvases/{canvas_id}/media/preview`。
`source` 使用以下方式之一：

```json
{"media_id":"详情或搜索返回的受控 ID"}
{"asset_id":"资产库 ID"}
{"node_id":"source-node","media_index":0}
{"node_id":"source-node","output_id":"exact-output-id"}
```

索引从 0 开始，与输出 ID 互斥。节点只有一张图时可省略索引；多张时返回
`ambiguous_reference` 与候选，绝不自行选择最新输出。受控媒体 ID 仅在当前已授权
Canvas 的媒体/引用、当前 Account 的导入授权或可访问 Asset Library 中解析，不接收任意 URL 或服务器路径。

桥接返回一个元数据 TextContent 和一个原生 MCP ImageContent。HTTP 返回相同元数据及
PNG 的 base64；无需 Agent 另开浏览器或调用未公开的本地 HTTP。元数据含来源、文件名、
原始/预览尺寸、是否缩略、透明通道与原文件 SHA-256。
保留整幅画面和比例、应用 EXIF 朝向，只缩小不放大、不裁剪，PNG 保留 alpha。
`max_edge` 范围 64–4096；默认 1600。支持导入、生成、透明处理结果和资产库的可解码静态图片。
动图只预览首帧；不支持 SVG、视频抽帧或音频试听。
单文件最多 32 MiB、解码最多 4000 万像素、预览编码最多 12 MiB；超限返回 `preview_size_limit`。
失效返回 `media_unavailable`，类型不支持返回 `preview_type_unsupported`，解码失败返回 `preview_decode_failed`。
预览不改素材、不创建节点、不触发生成。

## 安全更新

`update_generation_task` 保留原工具名，版本化 HTTP PATCH 请求使用显式 envelope：

```json
{
  "changes": {
    "prompt": "完整新提示词 @图片1",
    "refs": {"图片1": {"node":"source-node", "output_id":"exact-output-id"}}
  },
  "expected_node_revision": "get_generation_task 返回的 node_revision",
  "dry_run": true,
  "refs_mode": "replace",
  "return_after": true
}
```

正式保存设 `dry_run: false`，MCP 调用必须带稳定 `idempotency_key`；HTTP 使用
`Idempotency-Key`。校验与保存均重新检查编辑状态、节点版本、素材/输出可访问性与实际文件、
结构化引用、Model Capability Catalog 的支持状态、输入类型/数量与参数组合。
未知能力返回 `capability_unknown`，不宣称校验成功。

- 只修改 `changes` 指定字段；`params` 按键合并。改提示词/引用不重建模型参数；标题、位置、分区、历史输出和历史运行引用保持原值。改参数时仅更新指定参数及其必要派生设置，记录当前目录 Revision，不填入无关默认值。
- `refs_mode` 只支持 `replace`：替换全部有效媒体输入，不删除来源节点，也不修改其他下游。`refs:{}` 清空，省略 `refs` 保持现有输入。
- `refs` 支持既有来源选择器，增加 `{node, output_id}` 与 `{input: reference_id}`。后者只解析当前目标节点已有实例，用于逐字复用详情中的 `recipe.refs`，保留同一素材多次独立引用。新增本地素材先独立 `import_media`，更新不隐式上传文件。
- 同一多输出来源的不同输出，或普通多媒体节点的部分输入，通过确定的手动快照表达，并返回 `snapshot_reference`；单输出连接仍实时关联来源。
- 替换时清除旧配方输入、旧媒体连线/legacy ID；历史引用留存并用既有 blocked-input 机制阻止回流。上游文字连接和 TXT 快照保持；混合编组的文字连接保留，旧媒体单独屏蔽。
- 不重排或自动改写提示词别名。已保存的结构化标记、保留的输入实例与显式 refs 提供确定绑定。`@6`、`@图2` 等保留形式无法绑定时返回 `unresolved_reference`；普通 email 或普通 `@word` 不一律当作素材引用。冲突标签返回 `duplicate_reference_label`。
- `dry_run` 使用相同校验与 Mutation 引擎返回拟保存 `after`，`persisted:false`；不写画布、不上传、不启动生成。拟保存版本不是新的持久化版本。
- 正式保存由 Canvas Sync 在同一画布操作锁内解析、校验、提交，并从存储重新读取完整 `after`。提示词和引用作为一次 Mutation 全部成功或全部不应用。
- 回执含 `submission_id`、`node_revision`、`canvas_revision`、`changed_fields`、`validation`、`after`、`persisted:true`、`generation_started:false`。`return_after` 为兼容可接受，服务始终返回完整 `after`。
- 原 Mutation 回执保存结果快照。同一键/同一请求重试返回原结果并标记 `duplicate:true`，即使节点后来又被改过；同键不同请求返回 `operation_collision`。回执保留期限沿用 Canvas Sync，不新增无限期操作日志。
- 过期版本返回 `revision_conflict` 与 `current_node_revision`，不得部分应用。重新读详情、合并，再用新幂等键提交。

兼容：旧 HTTP PATCH 仍可直接发送 recipe 字段；MCP 不传版本且不试校验时沿用此旧路径。
旧调用不具备节点版本保护和完整回执保证；新的闭环必须传版本。禁止把 `dry_run` 放进旧 recipe 字段。
API/MCP 的机器错误码和开发者描述继续使用 F17 约定的英文，不新增网页文案。

## 验证与边界

推荐流程：`use_canvas` → `get_generation_task` → `search_media` / `preview_media` →
`update_generation_task(dry_run=true)` → 正式保存 → 独立 `get_generation_task`。
确认提示词全文、引用身份/顺序、未改参数与版本一致后即可报告保存；不用截图证明持久化。

- `tests/test_agent_task_editing.py` 覆盖旧 UI 节点、长文本、7 个混合输入、确定输出、透明像素、权限、缺失文件、模型限制、版本冲突、零写入试校验、原子替换、清空、实例保留、参数保留与重试。
- `tests/agent_input_projection_contract.cjs` 对同一 fixture 执行编辑器实际函数，比较媒体身份与顺序，防止 Python 读取投影偏离 JS。
- `tools/reroll-mcp/tests/test_editing_protocol.py` 启动真实 stdio 桥接与隔离 HTTP/SQLite，完成上述流程，并重启桥接后独立读回；无编辑器连接、无 Generation Run、无付费 Provider。
- 运行回归：`python -m unittest tests.test_agent_api tests.test_agent_task_editing tests.test_canvas_sync tests.test_documentation_knowledge_map`；具备仓库与 MCP 测试依赖的 Python 环境执行 `python -m unittest discover -s tools/reroll-mcp/tests`。

首期不在后端执行 Provider，也不实现依赖运行轮次的 Loop/Splitter 输入求值；此类输入报告
`runtime_input_unsupported`，不会猜测。其他引擎节点仍可查看已保存详情但不可通过此编辑合同保存。
编辑器选中状态同步、模型 operation 自动推断、搜索分页与空格归一、连接列表精简、音视频预览
及网页回执文案属于 P1。服务重启加载后端代码，已安装桥接需要重新安装/重启以发现新增工具；
本合同的自动化验收不等同于更新用户正在运行的服务或已安装客户端。
