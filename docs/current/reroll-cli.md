# Reroll CLI：后台图片生成

- Status: Current；自动化、独立安装与真实 Provider 生成及下载已验证
- Tracked by: [LAZ-106](https://linear.app/lazyq/issue/LAZ-106/reroll-cli)，父任务 LAZ-105
- Approved source: LAZ-106 附件《Reroll CLI 需求文档》v1.0（2026-10-27）
- Feature: F17

## 目标与边界

Reroll 已初始化、打开 Workspace、配置可用图片模型且账号完成网页配对后，用户或脚本可在没有浏览器编辑端的情况下生成并下载一张图片。服务和 Provider 的启动、登录由现有产品负责。

本版支持文生图、单图和多图图生图、画幅比例、原生分辨率档位、有序重复参考输入、结构化结果、任务身份对账和下载恢复。视频、批量矩阵、画布 Node／Workflow 执行、精确像素输入和任意参数透传不在本版范围。CLI 不创建 Canvas、Node、新任务数据库或独立 Provider 调用链。

## 命令与本机交付

随 `tools/reroll-mcp` Python 包发布 `reroll` console command，安装与可执行文件位置见[包说明](../../tools/reroll-mcp/README.md)。服务地址只取 `REROLL_URL`，缺省为 `http://127.0.0.1:3000`；不自动探测或选择其他实例。连接错误显示实际目标地址。

| 命令 | 合同 |
| --- | --- |
| `reroll models [--json]` | 稳定 Provider／Model ID，以及 `image.generate`、`image.edit` 各自的能力、参考限制、比例与档位选项和声明默认值 |
| `reroll generate "提示词" --provider ID --model ID` | 默认等待生成并下载；全空白提示词在提交前失败，保留原提示词及换行 |
| `reroll result RUN_ID [--output DIR] [--json]` | 等待并取回同一已接收 Run，不触发第二次生成 |

生成接受可重复的 `--image PATH`、`--ratio`、`--resolution`、`--output`、`--request-id`、`--json`。Provider 和 Model 必填并精确匹配稳定身份，不按显示名模糊选择。拒绝 `--size`、`--width`、`--height` 和任意尺寸透传。`--output` 默认为执行目录下的 `reroll-output`；相对路径以本次工作目录为准。

只读取 `--image` 明确指定的文件，上传前验证所有文件可读、为有效图片并满足现有上传和操作能力限制。只上传内容和必要元数据，服务器不读取调用端磁盘路径。参考顺序和重复实例保持不变，超限明确失败，不截断或重排。

## 模型与尺寸

有参考图时使用 `image.edit`，无图时使用 `image.generate`，分别查询精确操作能力。显式比例和档位必须支持，否则在 Provider 调用前返回合法选项。档位大小写可规范为目录拼写，不降档、不忽略；2K 等档位不承诺固定像素尺寸。

省略设置时只采用目录明确声明的默认值，保存为本次 Run 设置；不适用参数省略时不发送、输出为 null，显式提供则失败。模型要求参数但没有默认值时要求补充，返回选项。提交前重新核对当前能力；无法满足原输入时失败，不换模型或更改设置。

`--ratio auto` 仅接受恰好一个参考输入，使用实际图片尺寸和既有图片画幅的 7% 归一化规则解析，同时冻结参考图的精确原始比例供输出物化。无图、两个以上输入、无法识别尺寸或匹配能力时要求明确比例；同图重复两次仍算两个输入。多参考图必须明确提供非 auto 比例。最终输出沿用现有 Provider 参数转换与画幅物化规则。

## 授权和服务端合同

首次连接继续使用现有网页配对及可撤销 Account 凭证。每次请求检查账号、Role、总接入开关、运行 scope 和账号偏好。逐条确认开启时直接返回 `confirmation_required`，CLI 不修改偏好；并发遵守已有账号上限。

| 接口 | 责任 |
| --- | --- |
| `POST /api/agent/v1/image-runs` | 验证请求身份、Prompt、模型、尺寸与有序 Managed Media 输入，提交或对账原 Run |
| `GET /api/agent/v1/image-runs/{id}` | 读取当前账号自己的 Run 状态、冻结设置与输出身份 |
| `GET /api/agent/v1/image-runs/by-request?request_id=...` | 在重新预检前找回当前账号已接收的请求；身份不作为 URL 路径解析，随后以原输入 POST 对账摘要，不重新生成 |
| `GET /api/agent/v1/image-runs/{id}/outputs/{index}` | 只下载该账号该 Run 的指定输出 |

服务端从已授权 Managed Media 解析参考输入，不接受本机路径或任意远端 URL。上传、模型、能力、配对沿用已有 Agent API。输出不能通过猜测 ID 跨账号访问，也不接受服务器路径或任意 URL 作为下载目标；Bridge 只允许上述受控路径。

网页与 Agent 后台入口共用平面图片请求编译合同，交给既有 GenerationRuns 完成持久化、执行、结果保存和恢复。新入口没有画布目标，不走 `run_tasks` 的编辑端租约；既有画布运行保持原合同。架构取舍见 [ADR-0019](../adr/0019-account-agent-canvas-authoring.md)。

## 请求身份、等待与错误

每次主动 generate 默认创建新 `request_id`。传输重试必须复用同一身份；相同身份与相同原始输入回读原 Run，相同身份与不同输入冲突。接收后的 Run 保留冻结设置，后续目录默认值变化不改变它。提交响应丢失时保留原身份并返回 unknown；不得换新身份自动提交。

generate 和 result 每次等待上限为 900 秒。到期只停止 CLI 等待，不取消服务端 Run。已知身份返回 pending 及原 Run ID；下载失败也保留身份，result 只取回原结果。用户中断不取消已经接收的任务，尽可能保留已有身份。

| 状态／情况 | 退出码 |
| --- | --- |
| `succeeded`：生成完成且本机文件已可读 | 0 |
| `failed`：输入、授权、能力、生成或下载失败 | 1 |
| 命令用法错误，包括未知或缺少参数 | 2 |
| `pending`：等待到期且已知 Run ID | 3 |
| `unknown`：提交是否接收尚未确认，保留 request_id | 4 |
| 用户主动中断 | 130 |

`--json` 下 stdout 只输出一个完整对象，进度和配对说明写 stderr。结果包含 status、request_id、run_id、provider_id、model、operation、settings（requested_ratio／ratio／requested_resolution／resolution）、有序 inputs（index／name／media_id）、outputs（绝对 path／width／height）、error（code／message／details）。任务未被接收时 run_id 为 null。不适用设置为 null。错误不得包含 Token、API Key 或其他凭据，常见错误提供可操作的中英文说明。

下载保持实际图片格式与扩展名；同名按序号避让，不覆盖已有文件；失败临时文件清理。只有校验后的最终文件已保存且可读，才能返回成功。

## 验收与验证入口

自动验收以 CLI 进程（stdout、退出码、本机图片）和 Agent HTTP API 为公共边界，外部 Provider 用可控替身；安装以临时独立环境验证，不改用户当前环境。真实 Provider 验收须使用已经授权的模型与样例，并实际下载检查图片。

| 编号 | 必需行为 |
| --- | --- |
| A01 | 配对后没有画布页面仍能文生图并下载 |
| A02 | 单图走 image.edit，参考、原文和尺寸真实参与请求 |
| A03 | 多图顺序及重复实例保留，超限拒绝 |
| A04 | 合法尺寸按能力执行，非法尺寸和停用模型在调用前拒绝 |
| A05 | auto 只接受可解析的单图 |
| A06 | 声明默认、不适用参数、多图明确比例遵守合同 |
| A07 | 拒绝精确像素及任意透传 |
| A08 | 单个 JSON、正确退出码、真实图片与尺寸 |
| A09 | 同身份重试只有一个 Run、不同输入冲突、未知响应保留身份 |
| A10 | 超时不取消、原结果恢复、下载重试不重新生成 |
| A11 | 未授权、撤销、总开关、逐条确认、账号隔离与并发上限 |
| A12 | 独立安装可调用 reroll、help、模型查询、地址与双语错误 |

真实服务验收使用已配置的 APIMart `gemini-3.1-flash-image-preview`，通过独立安装的 CLI 完成一次 `0.5K` 文生图和一次 `1K` 单图编辑，实际下载并检查 PNG、JPEG 文件及像素尺寸；再次执行 result 取回原任务。验收未使用浏览器编辑端。具体版本、验证结果与发布状态记录在 LAZ-106 和 PR。

自动化入口：`tests/test_agent_image_runs.py` 覆盖 HTTP 运行、账号归属、并发与冻结请求恢复；
`tests/test_flat_image_compilation.py` 对照新旧入口及删除 Provider 后拒绝改路；
`tests/test_reroll_cli.py` 将 CLI 进程／连接合同纳入标准测试；
`tests/test_reroll_cli_end_to_end.py` 用真实 CLI 子进程、HTTP 服务、生产编译器与模拟 Provider
验证无编辑端的模型查询、文生图、多图编辑、重复提交和本机文件下载；
`tests/test_agent_installer.py` 核对安装包及共享中英文文案。
