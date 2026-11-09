# LAZ-133：Agent 本地图片导入研究

- Status: Research / Draft，未实施；不替代现行合同。
- Date: 2026-11-07。
- Task: [LAZ-133 · MCP 优化](https://linear.app/lazyq/issue/LAZ-133/mcp-优化)。研究输入是“用户把电脑其他位置的图片地址复制到 Agent 对话，能否导入”；用户随后明确输入也可能是多个文件、单个或多个文件夹。任务状态 Todo、人工负责人 Lazyq 保留；本次未修改 Linear。
- Source snapshot: `fd4a961be8e0fde82e385bc7afbfbec0f786f7a3`。下文相对链接的行号对应本次源码快照。
- Scope: 仓库源码、规格、安装副本的只读核查及隔离测试。本次交付为研究笔记。

## 结论

仓库已经支持从 **Agent 所在电脑的允许目录** 导入本地图片：`import_media(file)` 读取文件并上传字节，服务器保存为 Managed Media。它不要求源图片位于 Reroll Workspace；约束来自桥接进程的 `REROLL_ALLOWED_DIRS`。该列表默认是 `[]`，此时任何本地文件都会被拒绝。[工具入口](../../tools/reroll-mcp/reroll_mcp.py#L164-L173)、[目录配置](../../tools/reroll-mcp/reroll_mcp.py#L23-L27)、[路径校验](../../tools/reroll-mcp/bridge.py#L151-L164)、[安装默认值](../../tools/reroll-mcp/installer/install.py#L49-L68)

因此，“完全没有本地图片导入能力”不符合源码事实；“在聊天中贴任意位置的地址即可使用”也不是当前合同。绝对文件路径需要落在允许目录内；`file://`、HTTP(S) 与 data URI 没有专用解析或导入入口。当前实现会把这些字符串交给 `Path`，在本次隔离样例中返回 `local_file_missing`。[路径入口](../../tools/reroll-mcp/bridge.py#L151-L164)、[上传入口](../../tools/reroll-mcp/bridge.py#L233-L248)、[现行安全合同](2026-10-17-agent-mcp-canvas-authoring-spec.md#L377-L385)

本机定向只读核查发现允许目录列表为空；仅输出目录、入口等非秘密配置，未展示或使用凭据。隔离复现确认空列表会在上传前返回 `local_path_forbidden`。这足以解释该配置下的失败，但 LAZ-133 未提供原始路径、调用参数或错误回执，不能据此唯一认定报告当时的根因。路径格式、文件可达性与实际运行的桥接版本仍应分别核对。

临时办法是由用户把具体素材目录加入允许列表，并重启 MCP 进程，继续使用现有上传链路。完整目标应按一次导入请求支持明确的文件和目录列表。结合用户对其他软件 MCP 的使用体验，建议基线信任已配对本地客户端的显式导入请求，读取限于本次给出的文件、目录及递归范围；沿用系统和 host 的实际权限，Reroll 不重复增加文件批准弹窗。额外的应用级路径批准可作为加强模式，属于产品选择。现行 ADR-0019 的静态允许目录合同需要随选定策略同步修订。[操作说明](../../tools/reroll-mcp/README.md#L94-L102)、[ADR-0019](../adr/0019-account-agent-canvas-authoring.md#L10-L16)

## 权限策略补充：Reroll 目录白名单是应用自己的选择

本次 `local_path_forbidden` 来自 Bridge 在 `open()` 前自行检查 `self.roots`。安装器将其默认设为空列表；网页配对成功也不会填入本机目录。因而这次直接阻断不是已证明的操作系统拒绝，也不是所有 MCP 工具必须实现的文件弹窗。[本地检查](../../tools/reroll-mcp/bridge.py#L151-L164)、[打开位置](../../tools/reroll-mcp/bridge.py#L233-L236)、[安装默认](../../tools/reroll-mcp/installer/install.py#L49-L61)

MCP 的传输规范定义工具通信如何到达本地子进程或远程服务；具体文件操作仍由执行该工具的程序实现。另一个软件如果让本机应用直接打开路径，可能沿用该应用已经具备的系统权限；也可能已有 host 授权，或实际只操作已打开文档/已上传素材。这里列的是解释路径，没有核查用户所指其他软件的实现，不能替它们断言权限模型。[MCP 传输规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)

前一轮将本地单文件/目录批准作为首选，增加了并非协议必需的交互。建议基础模式只接受已配对本地 MCP 客户端明确传入的文件和目录，目录枚举受本次路径及递归参数约束；系统、host 和账号权限继续由各自机制执行。该方案选择信任客户端的工具请求，不能声称仅凭 `path` 或模型可填的 `confirmed` 字段就证明了原始人类指令。需要更强本地隔离时，再提供静态目录限制或额外批准模式。此处是研究建议，尚未改变当前代码或已接受 ADR。

## 用户补充：多个文件、一个或多个文件夹

这是本次研究的最新范围，取代前一轮仅按单文件授权组织的建议。整体难度调整为中等：可以复用媒体上传和 Canvas Sync，需要补齐批次清单、调度、恢复与落位合同。以下是建议设计，尚未实施或做目录批次验收。

### 输入与授权

- 输入支持多个文件、单个文件夹和多个文件夹；建议同一请求也允许文件与文件夹混合。
- 基础模式按已授权客户端本次传入的目录及递归参数枚举文件，沿用系统与 host 权限；加强模式可在枚举前额外确认整批范围。两种模式均不为每张图片重复批准，也不扩大其他目录的搜索权限。
- 提供明确的子目录递归选项，固定在本次批次参数中；默认值仍需在实施规格确定。扫描只收受支持的图片，跳过隐藏条目和越界链接，报告不支持、不可读与超限项目。
- 本地生成有界、顺序稳定的候选清单，先提供图片数量、总大小与跳过摘要；条目数、总字节数和扫描成本需有批次限制。扫描时达到限制必须明确报告，不能把截断清单伪装成完整结果。

### 已有实现不能直接当作目录批次接口

`import_media` 的 `local_path` 最终要求 `is_file()`，即使目录已经在允许根下，也不能直接把文件夹作为上传参数。现有 `find_local_files` 会递归遍历全部配置根目录、收集并排序后只返回前 200 条，没有分页、完整总数或截断标记；它也没有本次指定目录参数。因此“搜索后循环上传”不能保证目录内容完整，也没有扫描成本上界。[文件校验](../../tools/reroll-mcp/bridge.py#L151-L164)、[搜索实现](../../tools/reroll-mcp/bridge.py#L166-L214)、[工具参数](../../tools/reroll-mcp/reroll_mcp.py#L164-L173)

Agent API 另有真实的吞吐限制：每 Account 在 60 秒窗口最多 30 次受限写入，上传每张文件都会计入；超限返回 429 `rate_limited` 和 `details.retry_after`。Bridge 当前只自动重试传输错误，并不根据该 429 信息等待重试。批量目录导入需要遵守这个共享额度并有可恢复的调度；增加上传并发本身不能解决限流。若调整成真正批量上传或改变额度，应单独明确限制与回归，不直接删除保护。[限流实现](../../backend/infinite_canvas/agent_api.py#L300-L308)、[上传计数](../../backend/infinite_canvas/agent_api.py#L2084-L2087)、[Bridge 重试](../../tools/reroll-mcp/bridge.py#L95-L149)

现有生成任务编排还将单次新增来源媒体限制在 100 项；这是原编排入口的限制，不能直接当作新目录导入的批准容量。新的普通图片批次应复用 Canvas Sync，并独立定义容量、分批与撤销单位。[现有上限](../../backend/infinite_canvas/agent_api.py#L1255-L1256)、[落位归属 ADR](../adr/0011-placement-intent-belongs-to-canvas-mutation.md)

### 去重、恢复与画布结果

- 父目录与子目录同时输入、同一路径重复输入时，按最终来源文件去重，避免重叠扫描造成重复节点。同内容文件沿用现有 Managed Media 摘要去重；不同来源是否合并画布节点需要另定，不能把存储去重自动解释成删除用户选择项。
- 每个条目固定本地来源身份、相对路径、大小及变化检测信息；重试复用同一批次及条目身份。扫描后被替换、删除的文件明确报告，不能用重扫结果悄悄改变已批准的内容集合。源绝对路径留在 Agent 设备，服务端只使用受控媒体身份。
- 上传逐文件记录完成、失败和跳过状态，遵守限流并支持取消后保留已完成进度、仅重试未完成项。字节上传和 Canvas Mutation 是两步，失败回执必须说明素材是否已保存、节点是否已落位；重试不能重复放图，也不能删除已被其他内容复用的媒体。
- 批次固定目标 Workspace 与 Canvas，切换、撤权和目标删除时显式停止或暂停。自动落位复用现有 Node Placement；建议保留输入目录顺序及来源分组，是否按文件夹创建分区在实施规格明确。不能因为新导入而挪动既有节点。[落位 Current](../current/smart-canvas-node-auto-placement.md#L8-L10)、[重试位置意图](../adr/0011-placement-intent-belongs-to-canvas-mutation.md)

批次按本轮文件快照处理。目录层级映射、子目录默认值、批次容量和撤销粒度属于实施前需要明确的合同；本轮补充不把这些建议写成已验证的产品行为。

## 已核实的实现

### 工具、传输与落盘

| 环节 | 当前事实 | 依据 |
| --- | --- | --- |
| MCP 配置 | `REROLL_ALLOWED_DIRS` 经 JSON 解析传给 Bridge，缺省为空；根目录先 `expanduser()`、严格解析真实路径 | [reroll_mcp.py:23](../../tools/reroll-mcp/reroll_mcp.py#L23-L27)、[bridge.py:52](../../tools/reroll-mcp/bridge.py#L52-L57) |
| 工具 schema | `import_media` 只有必填 `file: string`；`find_local_files` 有 `pattern`、`kind`、`query`。没有 URL、base64、bytes 或单文件授权参数 | [工具声明](../../tools/reroll-mcp/reroll_mcp.py#L164-L173)；本次用源码注册的 FastMCP `list_tools()` 只读核对 |
| 本地权限 | 显式拒绝路径中的 `..`；解析符号链接后的最终文件必须位于某个允许根目录内，并且是普通文件 | [bridge.py:151](../../tools/reroll-mcp/bridge.py#L151-L164) |
| 目录搜索 | 仅遍历允许目录；跳过隐藏文件、隐藏目录及目录符号链接；通过同一路径校验筛除越界文件；最多返回 200 条 | [bridge.py:166](../../tools/reroll-mcp/bridge.py#L166-L214) |
| 上传传输 | 本地打开文件，发送 `POST /api/agent/v1/media` multipart `file`；只传 basename、MIME 与内容，不发送源目录；传输重试复用同一幂等键 | [bridge.py:233](../../tools/reroll-mcp/bridge.py#L233-L248)、[bridge.py:95](../../tools/reroll-mcp/bridge.py#L95-L129) |
| HTTP schema | 路由参数是 `UploadFile = File(...)`，不是文件路径、URL 或 base64 JSON；JSON 替代上传在本次 fixture 中返回 422 `invalid_request` | [agent_api.py:2084](../../backend/infinite_canvas/agent_api.py#L2084-L2100)、[校验错误 envelope](../../backend/infinite_canvas/agent_api.py#L1792-L1808) |
| 格式与大小 | 路由检查扩展名白名单、MIME 类别、非空及单文件大小；生产配置包含常见图片、视频、音频与 TXT，默认上传上限 500 MiB，可由服务环境配置 | [agent_api.py:2088](../../backend/infinite_canvas/agent_api.py#L2088-L2100)、[生产白名单与默认值](../../backend/main.py#L1433-L1448)、[注入](../../backend/main.py#L12253-L12263) |
| 媒体身份与去重 | 内容 SHA-256 是媒体 ID；相同上传内容复用已有结果，上传授权记在当前 Account 名下；同幂等键不同内容/名称/MIME 返回冲突 | [agent_api.py:2101](../../backend/infinite_canvas/agent_api.py#L2101-L2129)、[回归测试](../../tests/test_agent_api.py#L592-L607) |
| Workspace 存储 | `import_bytes` 写临时文件后原子发布到当前 Workspace `input/imported/<sha256>.<ext>`，返回 `/assets/input/imported/...`，不保留源设备路径 | [media.py:128](../../backend/infinite_canvas/media.py#L128-L168)、[media.py:222](../../backend/infinite_canvas/media.py#L222-L253)、[ADR-0001](../adr/0001-workspace-data-boundary.md#L78-L82) |

这里的 `Bridge.roots` 是应用自己的静态目录列表。当前桥接源码没有调用 MCP 客户端的 `roots/list`，两者不能仅因名称相同而混用；实际实例创建只传入环境变量目录。[初始化](../../tools/reroll-mcp/reroll_mcp.py#L11-L30)、[目录使用](../../tools/reroll-mcp/bridge.py#L151-L174)

### 安装副本与源码存在差异

本机配置指向的安装副本通过 AST 读取可见 19 个 MCP 工具，与本会话公开的 Reroll 工具列表一致；当前仓库源码声明 25 个。安装副本缺少 `read_node_reference`、`get_generation_task`、`preview_media` 及三个局部修复工具。两份源码都有 `import_media`，所以工具版本差异不能解释成“旧版完全没有导入”。主线程对安装副本使用临时文件、空目录列表与 MockTransport，得到 `local_path_forbidden`、0 次 HTTP，与仓库源码一致。这些是本机检查结果，不代表所有用户的安装状态。[当前工具声明](../../tools/reroll-mcp/reroll_mcp.py)、[25 工具协议回归](../../tools/reroll-mcp/tests/test_protocol.py#L15-L31)

后续修复必须验收到实际安装副本；更新仓库不等于更新客户端已安装的代码。现有 README 已要求重新安装并重启桥接，安装器对同一服务地址保留已有目录配置，因此只重装也不会自动修复空目录权限。[升级说明](../../tools/reroll-mcp/README.md#L192-L194)、[安装器合并](../../tools/reroll-mcp/installer/install.py#L49-L68)

### “导入”与“放到画布”分属两步

单独 `import_media` 返回 `{media_id, url, name, kind}`，登记上传授权，不提交 Canvas Mutation。本次 HTTP fixture 比较上传前后完整 Canvas，内容和 Revision 均未变。[导入路由](../../backend/infinite_canvas/agent_api.py#L2084-L2129)

创建生成任务时，配方 `refs` 可以使用 `{"file":"本地路径"}`。Bridge 在 dry run 中只发送名称、类型与大小；正式提交时上传并改成 `{"media":"id"}`。服务端为尚无来源 Node 的媒体创建 Image Node，随后随任务一起经过现有 Canvas Sync 提交。[Bridge 配方转换](../../tools/reroll-mcp/bridge.py#L250-L282)、[来源 Node 创建](../../backend/infinite_canvas/agent_api.py#L1113-L1149)、[F17 第 29–30 条](2026-10-17-agent-mcp-canvas-authoring-spec.md#L223-L229)

修改已有生成任务则明确要求先独立 `import_media`，不能在验证或保存中隐式上传文件。[MCP 防护](../../tools/reroll-mcp/reroll_mcp.py#L267-L280)、[HTTP 防护](../../backend/infinite_canvas/agent_api.py#L2182-L2191)、[Current 合同](../current/agent-task-editing.md#L128-L142)

如果 LAZ-133 的最终目标包含“只把图片放到画布，不创建生成任务”，还需独立明确放置行为。不能为了得到 Image Node 而偷偷创建无关生成任务；新入口也应复用 Canvas Sync、权限、幂等与现有落位合同。[ADR-0019 写入边界](../adr/0019-account-agent-canvas-authoring.md#L35-L42)

## 输入形式支持边界

| 输入 | 当前支持 | 失败/注意事项 | 依据 |
| --- | --- | --- | --- |
| Agent 电脑上、允许目录内的绝对路径 | 支持；不要求在 Workspace 内 | 文件须存在且可读；本次上传成功 | [路径校验](../../tools/reroll-mcp/bridge.py#L151-L164)、[上传](../../tools/reroll-mcp/bridge.py#L233-L248) |
| 允许目录外的绝对路径 | 不支持 | `local_path_forbidden`；不存在路径先得到 `local_file_missing` | [bridge.py:151](../../tools/reroll-mcp/bridge.py#L151-L164) |
| `~/...` | 支持展开后再校验 | 不会因此获得整个 Home 的权限 | [bridge.py:152](../../tools/reroll-mcp/bridge.py#L151-L164) |
| 相对路径 | 实现会按桥接进程工作目录解析 | 不是稳定的跨客户端路径协议；README 要求配置绝对目录；建议显式文件使用绝对路径 | [bridge.py:152](../../tools/reroll-mcp/bridge.py#L151-L164)、[README](../../tools/reroll-mcp/README.md#L94-L96) |
| `file:///...`、URI 转义空格 | 没有 URI 解析 | 本次合法文件的 `as_uri()` 得 `local_file_missing` | [bridge.py:151](../../tools/reroll-mcp/bridge.py#L151-L164) |
| 指向允许目录外文件的符号链接 | 不支持 | 真实路径越界，`local_path_forbidden` | [bridge.py:156](../../tools/reroll-mcp/bridge.py#L155-L164)、[既有测试](../../tools/reroll-mcp/tests/test_bridge.py#L46-L61) |
| Managed Media ID / 已有画布、资产库来源 | 支持作为 `refs.media/node/asset` 等受控选择器 | 与文件路径入口不同；授权范围之外 ID 不解析 | [选择器与授权集合](../../backend/infinite_canvas/agent_api.py#L413-L489) |
| `/assets/...` URL 或服务器上的绝对文件路径 | 不能作为 `import_media` 的远端来源 | `import_media` 在 Agent 本机读路径；已有 `/assets` 媒体按受控身份使用，服务器 resolver 只读 Managed Media 根目录 | [bridge.py:233](../../tools/reroll-mcp/bridge.py#L233-L248)、[agent_media_path](../../backend/main.py#L12243-L12250) |
| 远程 HTTP(S) 图片 URL | 无 URL 抓取导入 | 本次作为文件字符串得到 `local_file_missing`；现行合同明确禁止服务端 URL 抓取，避免 SSRF | [路径实现](../../tools/reroll-mcp/bridge.py#L151-L164)、[F17 安全合同](2026-10-17-agent-mcp-canvas-authoring-spec.md#L383-L385) |
| `data:image/...;base64,...` / base64 JSON | 无 MCP 导入字段，也无此 HTTP JSON 合同 | 本次 data URI 文件字符串失败；HTTP JSON base64 缺少 multipart `file` | [工具声明](../../tools/reroll-mcp/reroll_mcp.py#L170-L173)、[HTTP 声明](../../backend/infinite_canvas/agent_api.py#L2084-L2085) |
| 原始 bytes | HTTP multipart 文件上传支持；MCP 工具未暴露 bytes 参数 | 客户端需先读取字节，上传文件名与 MIME；不能将 bytes API 等同模型可直接传二进制 | [Bridge 上传](../../tools/reroll-mcp/bridge.py#L233-L248)、[HTTP 导入](../../backend/infinite_canvas/agent_api.py#L2084-L2129) |

图片预览返回 base64/ImageContent 是读取输出能力，不是 base64 导入能力；预览只接受 `media_id`、`asset_id` 或精确 Node 来源，并重新核对可访问媒体。[预览 schema](../../backend/infinite_canvas/agent_api.py#L684-L714)、[MCP 输出](../../tools/reroll-mcp/reroll_mcp.py#L232-L248)

仓库另有网页 `/api/ai/import-local-image` 的服务器本地路径入口，包含 `file:` 解析及验图；它要求同源网页请求，Agent Bearer 不允许进入非 `/api/agent/v1/` 接口。它不能读取另一台 Agent 电脑的路径，不应拿它绕过桥接权限。[网页路径规范化](../../backend/main.py#L5868-L5891)、[网页路由](../../backend/main.py#L6950-L6963)、[Bearer 边界](../../backend/infinite_canvas/auth_system.py#L2149-L2169)

## 隔离验证

所有样例只使用临时目录、2×2/3×2 Pillow 图片、MockTransport 或 `AgentApiTests` 的临时 HTTP/SQLite fixture；没有连接用户服务、读取用户图片、调用真实 Provider 或运行生成。

### 路径与请求探针

直接调用仓库 `Bridge.import_media`，记录 MockTransport 收到的上传请求：

| Case | 结果 | 上传 HTTP 次数 |
| --- | --- | --- |
| 允许目录内绝对路径，文件名包含中文和空格 | 成功 | 1 |
| 同一文件，允许目录列表为空 | `local_path_forbidden` | 0 |
| 允许目录外绝对路径 | `local_path_forbidden` | 0 |
| 允许目录内符号链接指向外部文件 | `local_path_forbidden` | 0 |
| 含 `..` 的路径 | `local_path_forbidden` | 0 |
| 同一有效文件的 `Path.as_uri()` | `local_file_missing` | 0 |
| `https://example.invalid/image.png` | `local_file_missing` | 0 |
| `data:image/png;base64,AAAA` | `local_file_missing` | 0 |
| `/assets/input/imported/fixture.png` 当本地文件传入 | `local_file_missing` | 0 |

成功请求断言了 `/api/agent/v1/media`、multipart、原始图片字节存在、临时目录的绝对路径未进入请求正文。最小复现可运行：

```sh
.venv/bin/python - <<'PY'
from pathlib import Path
import sys, tempfile
import httpx
sys.path.insert(0, 'tools/reroll-mcp')
from bridge import Bridge, BridgeError

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    source = root / 'example.png'
    source.write_bytes(b'fixture-only')
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={'media_id': 'fixture'})
    def make(roots):
        return Bridge('http://fixture', 'fixture-token', roots,
            client=httpx.Client(base_url='http://fixture/',
                transport=httpx.MockTransport(respond)))
    for roots, value in [([], str(source)), ([root], str(source)),
                         ([root], source.as_uri())]:
        before = len(calls)
        try:
            make(roots).import_media(value)
            result = 'success'
        except BridgeError as error:
            result = error.code
        print(result, len(calls) - before)
PY
```

期望依次是 `local_path_forbidden 0`、`success 1`、`local_file_missing 0`。这是桥接行为复现，mock 不声称验证图片内容解码；正式验证探针另使用了可解码 PNG。

### HTTP 探针

复用 [AgentApiTests 临时 fixture](../../tests/test_agent_api.py#L45-L144)，单文件限制设为 1024 bytes：

| Case | 本次结果 |
| --- | --- |
| 合法 multipart PNG bytes | 200；落盘字节相等；完整 Canvas 和 Revision 不变；返回 `kind/media_id/name/url` |
| JSON `file` 路径 / `url` / base64 `data` | 均为 422 `invalid_request`，`body.file` 缺失 |
| 不支持扩展名 / 不支持 MIME | 400 `unsupported_media` |
| 空文件 / 1025-byte 文件 | 413 `media_size_limit` |
| 另一 Account，无来源 Canvas/资产库授权，只猜媒体 ID 下载 | 403 `forbidden` |

这些输出与 [上传路由](../../backend/infinite_canvas/agent_api.py#L2084-L2129)、[授权媒体集合及下载](../../backend/infinite_canvas/agent_api.py#L2131-L2148) 一致。

### 既有测试结果

```sh
.venv/bin/python -m unittest discover -s tools/reroll-mcp/tests -p test_bridge.py -v
# 5 tests passed

.venv/bin/python -m unittest \
  tests.test_agent_api.AgentApiTests.test_media_dedupe_and_dry_run_descriptor \
  tests.test_agent_api.AgentApiTests.test_upload_key_collision_and_cross_extension_dedup \
  tests.test_workspace_media -v
# 5 tests passed

.venv/bin/python -m unittest \
  tests.test_agent_task_editing.AgentTaskEditingTests.test_preview_import_transparency_output_and_library_are_exact \
  tests.test_agent_task_editing.AgentTaskEditingTests.test_missing_bytes_and_input_limits_reject_save_and_preview -v
# 2 tests passed
```

合计 12 个窄测试通过，覆盖 [目录隔离及 dry run 不泄露路径](../../tools/reroll-mcp/tests/test_bridge.py#L46-L80)、[媒体去重和来源节点共享](../../tests/test_agent_api.py#L451-L468)、[Workspace 复制/去重/搬迁](../../tests/test_workspace_media.py#L35-L102)、[透明图片预览](../../tests/test_agent_task_editing.py#L113-L134)、[文件丢失与输入限制](../../tests/test_agent_task_editing.py#L325-L337)。测试环境出现 Starlette 的 httpx 弃用提示，未导致失败。

主线程另执行 `.venv/bin/python -m unittest tests.test_documentation_knowledge_map`，7 tests passed；本研究文件的相对链接另做存在性与行号范围检查。

仓库 `.venv` 未装 MCP SDK；schema 只读核对使用已有独立 MCP Python 环境，把仓库 `tools/reroll-mcp` 放在 import 路径首位，直接读取源码注册的工具，没有启动真实服务或使用用户凭证。本轮没有宣称完成真实 stdio 导入、Windows 或跨机器验收；现有 [stdio 编辑协议测试](../../tools/reroll-mcp/tests/test_editing_protocol.py#L28-L53) 仍是后续集成接缝。

## 修复方向与取舍（建议，未实施）

### 临时操作：授权具体素材目录

由用户在其 MCP 客户端配置中把本次素材所在的具体目录加入 `REROLL_ALLOWED_DIRS`，保留其他配置，重启 MCP 后调用 `import_media`。这即可使用已存在的上传能力；不需要改 Provider、开放服务端磁盘读取或执行一次生成。不要为省事把 `/`、整个 Home 或服务器 Workspace 设为默认读权限。当前配置说明及重启要求已经写在 [MCP README](../../tools/reroll-mcp/README.md#L94-L102)，安装器同服务重装也会保留已有目录值。[安装器合并行为](../../tools/reroll-mcp/installer/install.py#L49-L68)

### 最小兼容路线：目录授权入口、诊断和 file URI

1. 给用户一个明确的本地目录授权/查看入口，改善默认空目录后的发现与恢复；授权应发生在 Agent 设备端。服务端网页不能拿服务器目录冒充另一台电脑的目录。配置归属继续是 Agent 设备的 Device State。[现行数据归属](2026-10-17-agent-mcp-canvas-authoring-spec.md#L309-L311)
2. 区分允许列表为空、文件位于列表外、文件不存在、不可读、路径形式不支持等诊断，并给出配置与重启方向。工具描述明确“本地路径/允许目录”，不把当前 `local_file_missing` 对 URI 的结果误说成图片不存在。[现行入口](../../tools/reroll-mcp/bridge.py#L151-L164)
3. 在 Bridge 路径解析前支持严格的本机 `file:` URI 规范化，处理中文、空格、URL 转义和平台路径，再执行相同真实路径/目录/文件检查。使用兼容当前 Python 3.12 的专门解析器；只对显式 URI 解码，普通路径保留 `%` 字面量。非本机 authority、远程 HTTP(S)、data URI 仍应明确拒绝，UNC 等形式需另定范围。网页已有规范化行为可作对照，但应提炼可测试的本地桥接规则，而不是调用服务器本机路径 API。[可参考实现](../../backend/main.py#L5868-L5891)

这条路线保持 ADR-0019 的允许目录模型，改动主要集中在 [Bridge](../../tools/reroll-mcp/bridge.py#L151-L164)、[安装器配置](../../tools/reroll-mcp/installer/install.py#L49-L68)、工具说明及配置文档。它不能宣称完整覆盖“无需预设目录，贴任意图片路径即可用”。

Python 官方资料确认 `Path.from_uri` 是 Python 3.13 新增，当前项目运行时应采用兼容 3.12 的解析办法；3.12 已提供平台相关的 `urllib.request.url2pathname`。这只是解析组件，仍需独立校验 URI 的 scheme、authority、绝对路径和最终文件授权。[Path.from_uri](https://docs.python.org/3.13/library/pathlib.html#pathlib.Path.from_uri)、[url2pathname](https://docs.python.org/3.12/library/urllib.request.html#urllib.request.url2pathname)

### 覆盖粘贴任意路径：显式请求与可选加强确认

基础模式由本地桥接处理已配对客户端明确传入的文件、目录列表，在本次来源与递归范围内有界扫描、验图和上传。静态目录列表可继续限制后台搜索；显式导入使用独立规则，保持两个入口的范围明确。

如果产品另提供加强确认模式，可以在本地绑定整批来源和递归范围后批准。若 host 支持 elicitation，可评估复用；必须按实际 SDK/客户端协商的能力检测，并有不支持时的确定退路。审批结果不能由模型提交的布尔字段替代。该模式是可选设计，不作为基础导入的实现前提；本轮未验证其 host 兼容性。

MCP 官方协议保留了客户端启动本地 stdio 子进程的方式；路径访问边界在本项目由 Bridge 实施。官方 elicitation 也要求客户端声明支持相应交互模式：2025-11-25 版本在初始化协商，2026-07-28 版本使用每请求能力元数据及新的交互返回形式。项目依赖 MCP Python SDK v1 / `<2`，不能直接把新版协议示例套到已安装客户端，也无需为修复当前导入问题整体升级协议。[stdio 传输](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)、[2025 elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)、[2026 elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)、[项目依赖](../../tools/reroll-mcp/pyproject.toml#L6-L10)

该路线要显式修订 [ADR-0019](../adr/0019-account-agent-canvas-authoring.md#L10-L16) 与 [F17 允许目录合同](2026-10-17-agent-mcp-canvas-authoring-spec.md#L377-L385)，说明受信任客户端、显式请求的来源范围、目录递归和变化后的重新校验，以及远程服务不能代读 Agent 磁盘的边界。加强模式另外定义批准主体、有效期与撤销。CLI 已有“只读取用户明确传入 `--image` 的文件”并验图的独立合同和代码，可借鉴文件校验，不能用它推定现有 MCP 目录权限已经改变。[CLI 合同](../current/reroll-cli.md#L24-L26)、[read_images](../../tools/reroll-mcp/reroll_cli.py#L101-L124)

不建议本期通过服务端 URL 抓取、全盘开放、让 Agent 直接编辑自己的允许目录，或直接复用网页服务器本地路径入口来实现本地访问批准。这些做法改变了现行权限和设备边界，且没有解决“批准是否来自用户”的问题。[F17 安全合同](2026-10-17-agent-mcp-canvas-authoring-spec.md#L377-L385)、[网页/Bearer 边界](../../backend/infinite_canvas/auth_system.py#L2149-L2169)

## 安全与数据归属约束

- **源路径只在 Agent 设备处理。** 文件必须先复制为 Managed Media，Canvas 与 Generation Run 只保存 Workspace 引用；不要把源绝对路径写进 Canvas、历史或服务端诊断日志。[ADR-0001](../adr/0001-workspace-data-boundary.md#L78-L82)、[F17](2026-10-17-agent-mcp-canvas-authoring-spec.md#L383-L385)
- **配对、文件读取与内容访问是不同权限。** 网页批准 Account 连接不等于授权读取任何本机目录；每次 API 仍检查账号状态、Role、Agent 开关，Canvas 使用现有编辑授权，媒体 ID 只在可访问 Canvas、资产库和当前 Account 上传集合中解析。[认证](../../backend/infinite_canvas/auth_system.py#L257-L272)、[Canvas 授权](../../backend/infinite_canvas/agent_api.py#L1906-L1910)、[known_media](../../backend/infinite_canvas/agent_api.py#L413-L424)
- **读取边界与普通文件校验继续生效。** 目录只作为授权扫描输入，实际上传对象仍须是普通文件；路径规范化后应按最终真实文件检查授权，拒绝设备、越界链接与遍历。任何新审批都要考虑批准后到打开前文件变化。本轮没有证明当前 `resolve` 后再 `open` 已消除所有竞争条件，不将其夸大为完整安全证明。[当前实现](../../tools/reroll-mcp/bridge.py#L151-L164)、[打开位置](../../tools/reroll-mcp/bridge.py#L233-L236)
- **保持已有上传和内容归属。** 复用 multipart Agent API、当前 Workspace 媒体服务、摘要去重与 Account 授权，不建立第二套媒体目录或第二个 Canvas 写入者。[导入路径](../../backend/infinite_canvas/agent_api.py#L2084-L2129)、[Workspace Media](../../backend/infinite_canvas/media.py#L222-L253)、[ADR-0019](../adr/0019-account-agent-canvas-authoring.md#L35-L42)
- **不要把扩展/MIME 校验称为图片内容验证。** 通用 Agent 上传当前不解码图片，既有测试使用伪图片字节也能导入；预览时才解码。若新增本地图片批次，应逐文件复用或提炼 CLI 的图片读取校验，并限定解码资源，保持原多媒体工具兼容。[导入测试](../../tests/test_agent_api.py#L451-L461)、[图片预览](../../backend/infinite_canvas/agent_api.py#L684-L749)、[CLI 校验](../../tools/reroll-mcp/reroll_cli.py#L101-L124)

## 后续实施验收清单（尚未执行）

| 场景 | 应确认的结果 | 推荐验证接缝 |
| --- | --- | --- |
| 用户贴允许目录内绝对路径，含中文/空格 | 可导入、字节和 SHA-256 一致，服务器无源目录路径 | Bridge mock + Agent API 临时 Workspace + 真实 stdio |
| 默认空列表 / 目录外文件或文件夹 | 静态目录模式有可操作诊断；显式请求模式仅处理本次输入范围；加强模式拒绝或取消批准后不枚举、读取或上传 | Bridge 公开工具 + 权限模式 fixture |
| 多文件、多目录、父子目录重叠、重复来源与同名文件 | 清单顺序稳定，重叠来源不重复，文件过滤与相对归属可核对 | 临时目录树 + 扫描清单合同 |
| 超过 200 项的目录 / 扫描数量、字节上限 | 分页或有界清单明确报告完整性，不静默丢失后续文件 | 扫描边界与截断回归 |
| 超过 30 次受限写入 / 中断后继续 | 遵守账号共享限流，处理 retry_after，恢复只补未完成项，节点不重复 | 模拟时钟 + Agent API + Canvas Sync |
| `file:` URI | 仅本机合法 URI 规范化；转义、中文、macOS/Windows 盘符覆盖；远程 authority 明确失败 | 表驱动路径测试 + 两平台实机 |
| traversal / symlink / 非普通文件 | 规范化和批准前后均不越权，错误不泄漏额外内容 | 临时文件和链接 fixture |
| HTTP(S)、data URI、base64 参数 | 明确说明支持范围，不意外发起远程抓取或按普通文件误读 | MCP schema + HTTP 请求计数 |
| 超限、空文件、伪图片、不可读文件 | 失败可恢复；批准范围不扩大；不产生媒体、Canvas 或 Run 的部分成功 | Bridge + Agent API + 图片解码 fixture |
| 重试、重复内容、跨 Account | 原有幂等/去重与访问隔离保持；不会借媒体 ID 越权 | 现有 Agent API 回归 |
| 只导入 / 用作任务参考 / 只放画布 | 三种用户意图明确定义；单独上传不误报已放画布，不自动触发生成 | HTTP Canvas 前后比较 + Canvas Sync 测试 |
| 已安装旧桥接 | 安装/升级/进程重启后实际工具 schema 与源码一致；原目录和凭据保留，支持恢复 | 安装器临时用户目录 + 实际客户端只读检查 |
| 可选加强批准使用 elicitation | 协商支持、一次批准本次范围、拒绝/取消、host 不支持、超时与文件变化均有确定行为 | 受控 MCP host + 真实目标客户端 |

验收完成后按 [变更文档矩阵](../agents/change-documentation.md#L19-L36) 更新真实改变的 F17/Current 合同、ADR 与配置说明；本研究不把建议写成已交付功能，也不修改现行权威。若涉及网页配置入口或动态文案，另按仓库要求补中英 i18n、语言切换及前端资源同步检查。[AGENTS.md](../../AGENTS.md#L19-L35)
