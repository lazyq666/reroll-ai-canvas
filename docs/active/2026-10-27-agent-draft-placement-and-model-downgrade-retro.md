# Agent 草稿落位、模型降级与视频任务类型误写复盘

> Status: Implemented（三个问题已修复；真实 Chrome 无付费持久闭环通过，发布状态以关联 PR 为准）
> Date: 2026-10-27
> Related: [Agent MCP 画布编排与批量生成](2026-10-17-agent-mcp-canvas-authoring-spec.md)、[Agent MCP 节点读取、图片预览与安全修改](../current/agent-task-editing.md)
> Code snapshot: `e2a37cf0e283c4c4f65a27fa7d3281828a2cf483` 加当前工作区未提交改动；分支 `docs/agent-draft-placement-model-retro`。下文以函数名定位，行号可能随修复变化。
> Authorization: 用户已授权在新聊天修复本文三个问题，并明确要求保留当前全部未提交改动。下文保留修复前的历史证据与机制；最终实现及验收见文末。

## 核实结论与证据范围

草稿落位存在不以参考节点为锚点、只向右避让的问题。模型降级曾真实写回存储，之后又恢复；不是仅有界面显示差异。另发现视频生成完成后任务类型被误写为图片的独立缺陷。

本轮交叉核对了仓库代码、已登录浏览器的 `/api/config`、MCP 详情、生成日志，以及当前 Workspace 的 `canvas-content.sqlite3`。API 与 SQLite 快照的画布版本均为 **1741**。SQLite 使用 `mode=ro&immutable=1` 和 `PRAGMA query_only=ON` 只读访问；该模式忽略 WAL，重新执行时必须重新比较现场版本，不能把旧快照当作最新状态。

证据强度分别如下：

- **历史事实**：`canvas_mutations.changes_json` 中的创建与字段修改、实际生成日志，以及当前持久详情。
- **可重复的代码行为**：直接执行仓库真实函数的最小复现；模型复现使用现场模型清单，但不等同于捕获了当时浏览器调用栈。
- **仍未知**：创建时临时 Editor Context、完整的原始 Agent 工具调用记录，以及当时每次前端调用的栈。

## 事件对象与历史时间线

画布为「日常工作」：`0be687391ff345f28c49110dbb9c3b0c`。两个节点均使用 `图片1 → smart_9dr8ex7kdix9`、`图片2 → smart_f7sq95umb9xm`。

| 版本 | 节点 ID | 原始标题 | 原始配方 | 最终执行与输出 |
| --- | --- | --- | --- | --- |
| v2 | `agent:09e3b850f7e58de6a5afadce6b6e8100ef62f30ff446b754e3e6c4b2ca7d8cf4:task:0` | 上下文压缩-女巫机器人 v2 图标纸条 | `jimeng / Seedance2.5`、22 秒、3:4、720p、`multimodal_all_around` | `seedance2.0_vip / 15 秒`；`multi2video-41.mp4` |
| v3（本文主要对象） | `agent:f3d010fcc06a97292ecdeb575bab9db336398e6dc8a8841849df466b242bcd49:task:0` | 上下文压缩-女巫机器人 v3 记事板 | 同上，模型名称也是大写 `Seedance2.5` | 恢复后执行 `seedance2.5 / 22 秒`；`multi2video-42.mp4` |

两次正式提交的持久回执均为 `success`、`warnings: []`。未找到原始 dry run 工具调用记录，不能独立确认当时 dry run 的完整返回内容。

| 画布版本 | 相关历史记录 |
| --- | --- |
| **1714** | 创建 v2，保存 `Seedance2.5 / 22 秒`。 |
| **1718、1720** | v2 模型被改成 `seedance2.0_vip`；随后保存 15 秒并冻结该运行设置。实际生成日志也记录 2.0 VIP、15 秒。 |
| **1728** | 创建 v3，`agentRecipe` 与 `runSettings` 都保存大写 `Seedance2.5 / 22 秒`。frame 为 `(11581.31044, 0)`，task 为 `(11645.31044, 64)`。 |
| **1730、1731** | v3 连续两次移动，task 先到 `(10275.89562, 4870.37752)`，再到 `(6906.06110, 12294.75396)`。 |
| **1732** | v3 的 `runSettings.videoModel` 被保存为 `seedance2.0_vip`，`videoDuration` 被保存为 `15`。**降级已写回存储。** |
| **1733、1734** | v3 模型先改回小写 `seedance2.5`，时长再改回 `22`。 |
| **1735** | v3 开始运行，`generationInputSnapshot.settings` 冻结为 `seedance2.5 / 22 秒`。 |
| **1737** | 原复盘提及的正确回读发生在恢复之后，不能据此推断从未降级或降级未写回。 |
| **1740** | v3 生成完成后的画布变更把 `referenceGenerationKind` 保存为 `image`。 |

v3 实际生成日志为 `812edfb59a5f4d05a23a4e112894b99d`，Run 为 `run_1fe0c248e43641958583b65cd63b2eb5`；冻结请求为 `jimeng / seedance2.5 / 22 / 3:4 / 720p`。v2 日志为 `aaf12cad7ef948a5bad7c27742d56f12`，Run 为 `run_9803de67680241a89742e918415075d9`；冻结请求为 `jimeng / seedance2.0_vip / 15 / 3:4 / 720p`。浏览器播放器分别显示 22 秒与 15 秒。

## 问题 1：草稿落位远离参考图

### 已确认的机制与历史

落位由 [`AgentAPI.layout()`](../../backend/infinite_canvas/agent_api.py) 决定：

1. **refs 不作为落位锚点。** 起点取当前账号、当前画布最近 60 秒有效 Editor Context 的视口中心；没有有效视口时，取全画布最右边界加 `NODE_GAP`。参考节点仍作为普通障碍参与碰撞计算，因此不能说其坐标完全不参与。
2. **避让只沿 x 轴向右。** 每次把 x 推到碰撞障碍右边界加 gap，y 不变；没有最近空位或最大距离约束。
3. **frame 左上角等于视口中心。** 没有扣除 frame 半宽、半高，因此整体向右下偏。
4. **常规 MCP 工具无法表达或回读位置。** 创建参数没有 placement，创建回执只有 `frame_id`；`get_canvas`、`get_selection`、`get_generation_task` 均不返回几何坐标。`resolved_inputs[].position` 表示输入顺序。

真实函数复现结果：

| 输入条件 | frame 左上角 | 判定 |
| --- | --- | --- |
| 1000×600 视口、参考图在原点 | `(500, 300)` | 左上角直接落在视口中心 |
| 同一参考图移到 `y=-100000` | `(500, 300)` | 没有以 refs 为锚点 |
| 100 个同水平密集障碍 | `(30044, 300)` | 只向右避让可产生远距离偏移 |
| 无 Editor Context，远方无关节点 `x=50000` | `(50344, 0)` | 全画布最右节点决定兜底落点 |

v3 创建坐标可从版本 1728 直接确认，但创建时的临时 Editor Context 未保留，尚不能确定本次具体命中了哪个起点分支。版本 1739 的生成结果事件不在可逆 mutation 链中，因此本轮没有把不完整逆推当作精确历史参考图距离或当时最右边界。

仓库中的 `read_node_reference` 可在用户提供节点引用时返回包含坐标的完整 `content`，但创建、更新任务工具仍不支持调位；已安装 MCP 工具是否含该入口也需按实际版本判断。

### 修复方向与验收

- 默认以可解析的参考节点包围盒为锚点，在附近寻找位置；无参考节点时以视口兜底，并让整个 frame 居中。
- 在二维空间中确定性地搜索邻近空位，继续使用共享 gap，保持既有节点位置和用户有意重叠不变。
- 返回提交后 frame 与任务节点的实际几何，详情可独立回读核对。可选的显式 placement 参数属于接口设计选择，不应替代正确默认行为。
- 回归覆盖多参考节点、密集障碍、远处无关节点、无在线视口、不同缩放及重复提交，确认幂等重试不会再创建或重排节点。

现有 F17 规格约定“视口中心附近、无视口取全画布右侧”。默认改为参考节点附近属于本次授权的行为调整；实现时应同步该规格，并遵守 [ADR-0011](../adr/0011-placement-intent-belongs-to-canvas-mutation.md) 与 [Agent authoring ADR](../adr/0019-account-agent-canvas-authoring.md) 的 Mutation、幂等和位置意图边界。

## 问题 2：模型被替换成 2.0 VIP，22 秒被缩为 15 秒

### 已复现的直接路径

[`smartModelCatalog()`](../../static/js/smart-canvas.js) 在即梦能力目录加载后，把目录条目的模型名称规范为小写，但没有同时规范节点保存的选择值。`smartCatalogEntry()` 仍做大小写精确比较，找不到时退回同一 Provider 的第一项；`sanitizeSmartApiSelection()` 把这项写入设置。随后 [`smartVideoCapabilityReconcile()`](../../static/js/smart-canvas/video-capabilities.js) 按新模型上限把 22 秒压成 15 秒。

现场 `/api/config` 中，即梦可见目录顺序为：

```text
seedance2.0_vip, seedance2.0fast_vip, Seedance2.5, Seedance2.0,
seedance2.0fast, seedance2.0mini, seedance2.5
```

这些条目均可见。原始 `api_providers[id=jimeng].video_models` 顺序为：

```text
seedance2.0fast, seedance2.0_vip, seedance2.0fast_vip, seedance2.0mini,
seedance2.5, Seedance2.0, Seedance2.5
```

用这份现场清单执行仓库真实函数，结果为：

| 保存的模型值 | 能力目录未加载 | 能力目录已加载 |
| --- | --- | --- |
| `seedance2.5` | 保留 2.5、22 秒 | 保留 2.5、22 秒 |
| `Seedance2.5` | 保留大写值、22 秒 | **变成 `seedance2.0_vip / 15 秒`** |

这与历史保存变化吻合，但本轮未捕获当时浏览器调用栈。原复盘把“能力未加载”视为主要时序条件不适用于这份配置；**只把校正延后到能力加载完成，仍会复现错误。**

### 其他已核实的边界

- **后端没有在创建时转小写。** `AgentAPI.compile()` 按原始模型值校验并写入。版本 1728 和真实 AgentAPI 临时 SQLite 测试都保存大写 `Seedance2.5 / 22`；小写来自后续画布修改。
- **MCP 与前端可见性来源不同。** 实际 MCP `list_models` 使用 [`agent_available_models()`](../../backend/main.py)，直接枚举启用 Provider 的原始列表，只返回 `provider_id / model / kind`，忽略隐藏设置；前端 `/api/config` 使用 `available_models(..., include_hidden=False)`。原复盘引用的第 696 行属于能力矩阵，不是 MCP 列表入口。
- **隐藏条件可导致同类错误，但当前现场未命中。** 合成的“2.5 隐藏、2.0 VIP 可见”清单可复现降级；不能据此认定是本次历史原因。
- **第二轮模型检查也有大小写缺口。** `providerVideoModels()` 返回原始平台列表；若它只有大写值，目录已经规范成小写后仍可能在第二轮精确匹配中退回第一项。该场景已复现，当前现场列表则同时包含两种写法。
- **早期校正并非总执行。** `sanitizeSmartApiSelection(..., {notify:true})` 在 composer 未激活时直接返回；其他不带 notify 的调用仍可改写。`renderDynamicParams()` 后的 `persistActiveSmartSettings()` 会把设置写入前端节点；历史版本 1732 已进一步证实其可被保存到服务端。

### 修复方向与验收

- 对权威目录确认属于同一模型的大小写别名，统一目录、保存选择、Provider 列表及后端校验的身份解析；保持 Provider 边界，不合并不同模型或 VIP 版本。
- 可用模型的隐藏、排序和自定义显示名以 entry ID 保存；别名去重或 ID 变化时须保持这些设置的兼容，避免隐藏项重新出现或顺序、名称丢失。其他 Provider 的大小写语义保持原合同。
- 兼容存量大写草稿。不能仅把 `list_models` 改成小写而保留后端原始精确校验，否则旧草稿会报 `model_unavailable`，连只改标题都失败；该失败也已在临时 SQLite 中复现。
- 已指定的模型不可用或被隐藏时，保留原选择并给出可操作的校验结果，或在写入前明确拒绝；不要静默选择另一个模型或压缩时长。显隐规则应在 MCP 与前端保持一致。
- 创建后的详情、打开 composer 后的设置、保存回读与运行冻结参数保持一致。回归覆盖大小写、能力加载前后、隐藏、删除模型和旧草稿局部编辑。
- 新增产品提示必须中英双语并接入 i18n；实现不应依赖用户先打开 composer 才能发现模型已失效。

## 问题 3：视频生成完成后，任务类型被误写为图片

### 已确认的根因与影响

[`generationOutputSplitCompletedImages()`](../../static/js/smart-canvas/generation-output.js) 在检查“单个输出或非图片无需拆分”之前，先调用 `generationOutputEnsureReferenceKind(source, 'image')`。`smart-image` 同时承载图片和视频，前置判断不会排除视频；preferred kind 又优先于已有类型，因此视频也被先改成图片。

`generationOutputCompletePending()`、`generationOutputCompleteQueued()` 和 `generationOutputCompleteTask()` 都会调用该 helper。直接加载完整仓库文件并执行真实视频完成函数，复现得到：

```text
referenceGenerationKind = image
outputKind = video
images[0].kind = video
runSettings.apiKind = video
runSettings.videoModel = seedance2.5
runSettings.videoDuration = 22
```

历史版本 1740 确认 v3 的错误类型已持久化，v2 在版本 1726 也发生相同字段修改。当前 `get_generation_task` 因此返回 `recipe.kind=image` 与空模型；[`task_recipe()`](../../backend/infinite_canvas/agent_api.py) 信任错误 kind，读取的是图片字段 `provider_id/model`，而不是仍保留的 `videoProvider/videoModel`。视频模型设置和视频输出本身没有丢失。

### 修复方向与验收

- 在图片拆分前正确识别输出类型，视频完成时保持 `referenceGenerationKind=video`。
- 覆盖 pending、queued、task 三条完成路径，以及单图、多图拆分的既有行为。
- 以完成后持久化、重新加载、MCP 独立回读为验收，保证 `recipe.kind/model/params` 与实际视频设置一致；只有 DOM 显示“视频”不足以通过。
- 核查已存在的错误 kind 数据如何安全读取或修复。对类型字段、视频媒体与运行设置不一致的旧节点建立回归，不覆盖有效提示词、引用、输出和模型设置。

## Agent 流程结论

未找到原创建会话的工具调用记录，不能断言 Agent “只看 success、从未回读”。现有 MCP 的独立回读说明主要约束编辑已有任务后的保存；常规详情本来不返回坐标，不能把未通过它核对位置直接归责于 Agent。

大写 `Seedance2.5` 当时由 `list_models` 公开且被后端接受。优先使用能力目录的规范 ID 可降低误触，但系统仍须兼容自己公开并接受的别名。应补充创建后独立回读模型、参数、引用和位置的协议及工具能力，作为验收闭环。

## 复现与修复交接

本轮没有修改实现、现有画布或触发新的 Provider 生成。保留的本机临时脚本为：

```sh
python3 /private/tmp/reroll-history-verify.py
node /private/tmp/reroll-model-verify.cjs
node /private/tmp/reroll-model-verify.cjs --assert-preserved
```

历史脚本只打印目标节点允许字段，不输出提示词、凭证、token ID 或请求哈希；其几何逆推因缺少 mutation 1739 会明确停止，但原始创建坐标与模型修改均来自直接记录。该缺口对应已应用的生成结果事件，不能假装完整逆推。模型脚本的 10 个场景均验证通过；最后一条命令作为修复前的失败检查，实际报出 `actual: seedance2.0_vip`、`expected: seedance2.5`。这些临时文件不是长期测试权威，修复时应转化为仓库回归用例。

新聊天继续使用当前仓库、当前分支，先检查 `git status` 和 diff，再在原有改动上增量修复。当前未提交的模型能力、视频能力、Agent 参数与测试改动必须保留，尤其是 Seedance 默认音频输出与可写参数的分离：旧 `videoGenerateAudio` 值可保留在 `runSettings`，但不可写的 `generate_audio` 不应重新暴露为可编辑 recipe 参数；局部编辑也不应重写无关旧设置。

交接前已执行以下相关基线，**41 个测试通过**；这是现有能力改动的保护基线，不表示本文三个问题已经修复：

```sh
.venv/bin/python -m unittest \
  tests.test_agent_api.AgentApiTests.test_seedance_capability_reports_default_audio_and_recipe_omits_toggle \
  tests.test_agent_task_editing.AgentTaskEditingTests.test_legacy_seedance_audio_flag_is_not_an_editable_recipe_parameter \
  tests.test_model_capabilities tests.test_model_capability_matrix
```

完成条件是三个问题各有能捕获原症状的回归、相关现有测试通过、真实页面完成无付费生成的交互验证，并按 [变更文档约定](../agents/change-documentation.md) 对齐受影响规格。前端改动结束后运行资源版本同步及 `--check`；新增提示运行 i18n 校验、相关回归和语言切换检查。涉及提交到远程时，再执行仓库的版本、更新说明和 public readiness 合同。

## 本地修复与验收（2026-10-27）

三个问题已在原工作区、原分支增量修复。交接前 15 个已修改文件的 385 行非空新增内容中，
384 行仍逐字保留；唯一更新是本复盘导航标题，移除了“待验证”。Seedance 默认音频与
可写参数分离、旧 runSettings 及局部编辑保留规则均继续通过回归。未 reset、stash、clean、
切换分支、创建 worktree、提交或推送，也未改写事件中的真实画布节点。

- **落位**：以本批可解析的现存参考节点包围盒中心为锚点，在二维空间按距离和稳定方向顺序避让。
  无参考节点时整个分区以画布坐标视口居中，无在线视口时以原点为锚点。沿用 NODE_GAP、
  同一 Mutation 锁及 exact 提交意图，既有节点不移动。创建回执、详情、画布和选区均返回实际几何；
  幂等重试返回原提交几何，独立读取返回当前位置。
- **模型**：只对维护目录确认的即梦大小写别名统一身份，不跨 Provider 或合并 VIP。
  MCP 和编辑器共用可见模型清单，保留旧显隐、排序、自定义名称及发布能力。
  失效模型保留原选择、时长和参数，选择器显示不可用，保存或运行明确拒绝；
  无须先打开 Composer。无 Composer 运行旧大写草稿时，仅在请求副本中规范 Model ID。
  已知旧大小写条目从 Provider 清单移除后，其 ID 仍能恢复管理员设置。
  完整模型备份按逻辑条目校验，兼容新包与旧版大小写双条目，保留原 Provider 清单；
  任一旧别名隐藏仍保持隐藏，重复原始条目或缺失模型继续拒绝。
  PR 前复查另补旧模型页保存回归：旧页面同时列出大小写别名时，任一仍隐藏即保持隐藏；
  规范页面单条目仍可显式恢复显示，防止旧页面保存其他设置时重新显示模型。
- **视频类型**：拆图前先判定实际输出类型。Pending、Queued、Task 三条完成路径均保留 video。
  旧完成节点以明确同类输出媒体、输出模式、冻结设置安全读取；普通上传不因此变成生成节点。
  Agent 读取不迁移历史，保留原始提示词、引用、输出与 runSettings。

长期回归入口：`tests/test_agent_placement.py`、`tests/test_agent_model_identity.py`、
`tests/test_available_model_aliases.py`、`tests/smart_model_selection.test.cjs`、
`tests/smart_canvas_generation_video_kind_regression.cjs`，以及真实 stdio MCP 编辑协议测试。
原临时模型脚本的前置断言描述修复前的错误行为，不再作为修复后验收；其场景已转入仓库测试。

真实 Chrome 验收入口为 `node tests/agent_draft_repairs_browser_smoke.cjs`：使用临时 SQLite、
真实账号认证、Agent HTTP、CanvasSync 与 WebSocket，加载实际 Smart Canvas HTML 与 JS。
完成输出由测试注入，未调用 Provider；网络断言零生成请求，页面异常为空。三条完成路径经
真实保存、重载及独立 Agent HTTP 回读后仍为 video / seedance2.5 / 22 秒。
旧错误类型在首次页面保存前即可独立正确读取；大写草稿打开 Composer 后保持模型身份与 22 秒。
隐藏模型的中英文不可用选项、拒绝提示及再次保存重载保持原值均通过。

验收覆盖编辑器、持久化及 MCP 读取闭环，不宣称真实 Provider 生成或最终发布完成。
截图：`/tmp/reroll-draft-repairs-video-reloaded.png`、
`/tmp/reroll-draft-repairs-unavailable-en.png`、`/tmp/reroll-draft-repairs-unavailable-zh.png`。
F17、ADR-0019、Agent 编辑合同、生成管线、API 模型设置合同和 MCP 协议说明已同步。

最终验证结果：

- Python 组合回归 **233 项：232 通过、1 项按默认配置跳过**。覆盖 Agent 创建/编辑/几何、
  模型能力、视频完成与恢复、设置备份/导入事务/HTTP 集成、画布持久化、文档地图、
  i18n 缓存、前端资产和更新源。跳过项为单独开关的 retained-cache 浏览器测试，
  不能由本次专用 Chrome 测试推断其已执行。
- `.venv/bin/python -m unittest discover -s tools/reroll-mcp/tests -p 'test_*.py'`：**15 项通过**，
  含真实 stdio → HTTP → SQLite 创建、保存、独立进程几何与旧视频详情回读。
- `npm run test:node-contracts`：通过。新增模型/类型 JS 回归也已由 Python 入口执行。
- `node tests/agent_draft_repairs_browser_smoke.cjs`：真实 Chrome 无付费闭环通过。
- `node static/js/i18n/validate-i18n.js`：**4677 keys**；
  `python3 scripts/sync_frontend_assets.py --check`：**465 managed、0 updated**；
  `git diff --check`：通过。

本节记录本地验收阶段，沿用 LAZ-88/LAZ-89，维持 In Review；当时尚未提交或发布。
后续按用户要求提交 PR，提交、完整 Public readiness 与远端检查记录由关联 PR 承载；
PR 开放期间不代表已合入 main。日常已运行服务未重启，后端修复在下次加载本工作区代码时生效。
