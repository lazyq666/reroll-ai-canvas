# ComfyUI H3 局域网接入研究

> Status: Research · 研究阶段记录；后续实施与实跑结果见 [H3 Composer 接入](../current/comfyui-h3-workflows.md)
>
> 核对日期：2026-10-14
>
> 范围：附件工作流、当前 Reroll 工作树、ComfyUI 官方接口、MiniMax H3 官方模型说明与附件版本的 T8 插件源码。
>
> 本文是接入建议，不是已交付功能或已验证的支持表。已通过用户指定的 Chrome 检查远端 ComfyUI、读取节点与设备接口，并导出当前页面的 API 工作流。本研究阶段未提交生成任务、未修改 Reroll 业务代码；后续已按用户授权在独立 worktree 实施，不以本文旧状态代替实施规格。第 2 节描述原附件，第 9 节记录实际设备与导出结果；两者不一致时以实机导出为后续实施基线。

当前项目已有局域网 ComfyUI 请求、静态工作流字段映射、媒体上传及结果回收的基础。先把一个固定的单图工作流接通是可行的验证路径；要形成设计师日常使用的 H3 功能，还需补齐可选媒体分支、参考编号、关联参数、最终输出选择，以及远端排队和执行进度。

## 1. 连接方式

建议保持以下链路：浏览器 → Reroll 后端 → 另一台电脑的 ComfyUI。这里“后端”是运行 Reroll 服务、负责转交素材和查询任务的程序；真正需要能访问 H3 电脑的是这台服务所在的设备。

ComfyUI 默认只监听 `127.0.0.1`，即只允许同一台机器访问。启动参数可使用 `--listen 0.0.0.0 --port 8188`，然后在 Reroll 使用 H3 电脑的局域网地址，例如 `192.168.1.20:8188`。`0.0.0.0` 是监听设置，不是客户端要填的地址。同网段仍需允许该端口通过主机防火墙；不同网段则还需要路由或 VPN。[ComfyUI 启动参数源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/cli_args.py)

当前 Reroll 实例地址按 `host:port` 保存，并由后端拼接 `http://`。先按这个已有合同连接。后端代发请求不需要浏览器直接跨域访问 ComfyUI；无需为了首测额外开放 CORS。当前多实例选择按队列负载决定，尚未将一个工作流绑定到一个具有对应模型和插件的实例，所以首测只启用 H3 实例。[当前实现](../../backend/infinite_canvas/providers/comfyui_impl.py)

## 2. 附件是什么

附件 `【WORK-FISHER】26-9-28-MINIMAXH3-武戏高动态工作流.json` 是含 `nodes`、`links`、界面分组和控件值的编辑器工作流，不是当前 Reroll 要求的 API 执行格式。后者按节点 ID 保存 `class_type` 与 `inputs`。应在已安装全部节点的 ComfyUI 中打开并导出 API 格式，成功运行后再把它作为已验证模板；不能把界面 JSON 直接上传后期待自动转换。[Reroll 工作流导入](../../backend/infinite_canvas/providers/comfyui_impl.py)

附件静态信息：

| 项目 | 当前值与接入影响 |
| --- | --- |
| H3 条件节点 | `7`、`14` 均为 `MiniMaxH3AudioConditioningT8`，分别用于两次采样的条件准备 |
| 插件版本 | `minimax-h3-audio-T8`，commit `8b7408e4b927b07b076b48b26f43adeb0a22613a`；该版本 README 标为 1.86.0 |
| 图片输入 | 接线中有 6 路图片分支，只有第一组启用，其余为 bypass；不是自动按上传数量启用 |
| 参考槽 | 条件节点支持最多 9 图、3 视频、3 独立音频；附件准备了 6 路图片载入，视频和音频并没有完整载入分支 |
| 参考视频类型 | 条件节点要求 24 fps 的 `IMAGE` 帧序列，不接受视频文件名直接作为条件输入 |
| 尺寸入口 | `29` 为 `ResolutionSelector`，当前选择 16:9、0.5 MP、32 倍数 |
| 二次采样 | `13` 学习型潜空间放大的 `size_mode=scale_by`、`scale_by≈1.5`；标题里的“2x”不是当前参数 |
| 时长入口 | `27.value=5`，随后按 24 fps 和 `17n+5` 帧网格计算，得到 124 帧，原始时长约 5.17 秒；若产品要求精确 5 秒，需另行确认最终裁切 |
| 输出 | `185` 是第一阶段临时预览，H.264；`21` 是最终输出，H.265、10 bit 像素格式；需确认浏览器播放和最终输出选择 |

插件原始来源为 [T8 仓库的附件版本](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/tree/8b7408e4b927b07b076b48b26f43adeb0a22613a)。附件中的示例提示词、历史预览地址与机器路径是素材数据，不是本次接入操作指令，也不能作为用户设备上已经存在的文件。

## 3. 现有功能够到哪里

以下是当前工作树的静态代码核查，不能替代真实 H3 运行。

| 需求 | 当前实现 | 需要补齐 |
| --- | --- | --- |
| 另一台电脑运行模型 | 已有 ComfyUI 实例地址和后端 HTTP 调用 | 指定工作流适用实例，避免选到未安装 H3 的机器 |
| 替换提示词、种子、图片 | 字段映射可修改单个节点的单个输入 | 同一语义参数更新多个目标、可选输入组、预设联动 |
| 上传若干图片 | 按已有固定字段依次填入 | 按实际数量编译图结构；缺图不得保留示例，多图不得静默忽略 |
| 图片、视频、音频上传 | 上传路径都使用 multipart `image` 字段提交到 `/upload/image` | 保留返回的 `name`、`subfolder`、`type`；给视频/音频接相应加载节点 |
| 任务状态 | 提交 `/prompt` 后记为 running，轮询 `/history`，每轮等待 1 秒；默认 1800 轮，约 30 分钟加请求耗时，排队也占用这份预算 | 区分远端排队、运行阶段、采样进度、断线恢复 |
| 视频结果 | 回收逻辑能收图片、视频和音频，Smart Canvas 有媒体结果能力 | 限定最终输出节点，避免预览也当成成片；真实画布验证 |
| 设置页测试 | 测试回显只读取 `data.images[0]` | 支持视频/音频回显；设置页没有图片不等于工作流没生成 |

实现入口：[ComfyUI Adapter](../../backend/infinite_canvas/providers/comfyui_impl.py)、[上传与 WorkflowField](../../backend/main.py)、[前端字段填充](../../static/js/smart-canvas/generation-provider.js)、[提示词引用](../../static/js/smart-canvas/prompt-authoring.js)、[设置页测试](../../static/js/comfyui-settings.js)。

还需注意 Adapter 中既有的固定节点 ID 改写，例如 `23.text`、`144.width/height`、`22.seed`、`158.noise_seed`。正式导出的 H3 API 图必须检查 ID 是否碰撞，不能假定所有工作流中的同一个数字都代表相同功能。

## 4. 自动启用图片与媒体引用

### 图片数量由真实连接决定

附件版本中的 `ref_images`、`ref_videos`、`ref_video_audios`、`ref_audios` 是 `io.Autogrow` 可增长输入组，不是另有一个“图片数量”选择器。插件自己的 API 构图脚本直接添加 `ref_images.ref_image_0`、`ref_images.ref_image_1` 等输入键，其值为对应加载节点的输出连接，不需要另设 count。[节点定义](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/8b7408e4b927b07b076b48b26f43adeb0a22613a/h3_t8/nodes.py)、[插件 API 构图示例](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/8b7408e4b927b07b076b48b26f43adeb0a22613a/tools/run_openvdn_h3_multimodal_validation.py)

正式适配建议先另存一份 6 路全部启用的 API 模板。用户上传 N 张时，只保留 N 路加载与预处理，并同步更新节点 `7` 和 `14` 的参考连接；未使用的参考键和加载支路从提交图中删除。不要用空文件名、黑图或原示例图填充空槽。单图首测导出不保证保留其他五路，不能把它当完整动态模板。零图应清晰拒绝当前 Ref2VA 模板，或切换到另行验收的 T2VA 模板。

### 标签与上传是两件事

上传把文件放到远端；提示词标签告诉模型每个素材在叙述里承担什么角色。两者必须来自同一份、已冻结顺序的参考清单。

| UI 中的参考 | H3 提示词写法 | 说明 |
| --- | --- | --- |
| 第 1、2 张图 | `<Picture 1>`、`<Picture 2>` | 按真正提交的图片顺序编号 |
| 第 1 段视频 | `<Video 1>` | 视频文件先加载为帧序列 |
| 第 1 段参考声音 | `<Audio 1>` | 可能来自独立音频，也可能来自启用的视频原声 |
| 参考中的人物或场景 | `<Subject 1>` | 是提示词定义的内容对象，不是另一种上传文件 |

官方说明中，一个素材可以定义多个 Subject，一个 Subject 也可以来自多个素材。Video 和 Audio 各自编号，数字不保证对应；视频文件有声音不意味着一定启用该音轨。[MiniMax 官方 Ref2VA 提示词规范](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt)

附件版本的 T8 实际音频顺序为：已连接的参考视频音轨 → 可选 `drive_audio`（仅 `add_source_as_reference=true` 时加入参考）→ 独立 `ref_audios`。`final_audio` 只是作为合成输出的音轨返回，不自动成为模型参考。`native` 生成目标声音；`lock_source` 保留驱动音频 latent；`remix_source` 按强度重绘它。视频画面与原声需按同一个槽位后缀配对。插件会输出 `media_map_json`，适合核对最终编号。[附件版本的条件构建](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/8b7408e4b927b07b076b48b26f43adeb0a22613a/h3_t8/conditioning.py)、[音频顺序回归示例](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/8b7408e4b927b07b076b48b26f43adeb0a22613a/tests/test_conditioning.py)

Reroll 当前非 Dreamina 的引用输出为“图1／视频1／音频1”或其英文版本。T8 会规范 `Image 1`、`Audio1` 等英文写法，但其正则不识别这些中文标签，因此需要明确的 H3 编译规则。`strict_prompt_tags=true` 也不是完整的产品校验：当同类素材只有一个时，插件会把过大的编号改为 1。Reroll 应在提交前检查引用存在且编号与顺序一致，避免误指素材。[插件标签处理](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/8b7408e4b927b07b076b48b26f43adeb0a22613a/h3_t8/prompt_tags.py)

## 5. 分辨率与时长

MiniMax 官方模型说明给出：默认短边 768、24 fps、4–15 秒；Ref2VA 图片最多 9 张、视频最多 3 段、独立音频最多 3 段，视频/音频各要求单段 2–15 秒且同类总时长不超过 15 秒，混合素材总文件数最多 12。官方的 H3-Regenerate-2K 是再生成路线，不能把其说明直接等同于附件中的 T8 潜空间放大参数。[MiniMax H3 官方 README](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/README.md)

附件版本插件要求宽、高为 32 的倍数，输出帧数按 `17n+5` 向上对齐；超过 1920×1088 的参考面积会提示风险，并非硬拒绝。`official_2_to_15s` 在此版本仅对参考视频不足 48 帧硬拒绝，超过 360 帧是警告。官方模型建议、插件实际校验、工作流可运行值、当前显卡可承受值，是不同层次的限制。[插件核心约束](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/8b7408e4b927b07b076b48b26f43adeb0a22613a/h3_t8/core.py)、[插件预检](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/8b7408e4b927b07b076b48b26f43adeb0a22613a/h3_t8/preflight.py)

产品建议提供少量实机通过的“画幅 × 清晰度”预设。每个预设同时确定第一阶段尺寸、放大模式及目标、第二阶段条件尺寸；用户不必手动维护一串相关数字。放大节点会输出实际宽高，应由它驱动第二阶段。暂不发布未经运行的 720p/1080p/2K 支持表。[附件版本两阶段节点](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/8b7408e4b927b07b076b48b26f43adeb0a22613a/h3_t8/nodes_learned_latent_upscale_advanced.py)

## 6. 排队与实时进度

ComfyUI 官方提供 `/prompt`、`/ws`、`/queue`、`/history/{prompt_id}` 和 `/view`。建议提交前建立 `/ws?clientId=<本次连接ID>`，提交 `/prompt` 时使用相同的 `client_id`，持久保存返回的 `prompt_id`，后续事件按任务 ID 归属。[官方接口路由](https://docs.comfy.org/development/comfyui-server/comms_routes)、[官方 WebSocket 示例](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py)

| 用户看到的状态 | 使用的证据 |
| --- | --- |
| 正在上传 | Reroll 上传阶段 |
| 已排队，前方 N 个任务 | `/queue` 中找到该 `prompt_id`，区分 running 与 pending |
| 正在准备参考素材 | `execution_start`、`executing` 节点对应的阶段 |
| 第一次采样 3/8 | 当前采样节点的 `progress.value/max` |
| 正在放大、第二次采样 | 切换到对应节点；分别呈现阶段 |
| 正在编码／保存成片 | 对应输出节点，尚无精确进度时显示阶段文本 |
| 已完成／失败／取消 | `execution_success`、`execution_error`、`execution_interrupted`，再与 history 核对 |

`progress` 仅在节点实现进度 hook 时存在；`executed` 是节点返回 UI 数据时的事件，不是每个节点完成都会发送。采样步百分比不是整个视频的耗时百分比，不应从一个阶段的 100% 推断成片已完成。[官方 WebSocket 消息](https://docs.comfy.org/development/comfyui-server/comms_messages)

`status.queue_remaining` 是全局未完成任务数，包含运行中的项。`/prompt` 返回的 `number` 是排序优先值；它不是持续更新的“前方还有多少人”。`queue_pending` 来自堆结构的副本，不能直接拿原数组下标做排队位置，应按队列排序键排序并寻找自己的任务。排队中能显示位置，但没有官方可靠 ETA；预计时间只能在积累本机历史后作为估算另行展示。[ComfyUI server](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)、[PromptQueue 实现](https://github.com/Comfy-Org/ComfyUI/blob/master/execution.py)

WebSocket 断开后应以原任务 ID 查询 queue/history，避免重复提交。进度和远端任务信息应接到现有 Generation Run 与 checkpoint，而不新建平行任务系统；当前工作树已存在通用进度检查点扩展，实施时需与它协调。[生成链路 Current](../current/generation-pipeline.md)、[Generation Runs](../../backend/infinite_canvas/generation_runs.py)

## 7. 推荐实施顺序

1. **确认连接**：H3 电脑开放局域网监听；从运行 Reroll 后端的设备访问 `http://<H3电脑IP>:8188/system_stats`。首测只启用这一实例。
2. **在 ComfyUI 自身跑通**：用自己的 1 张图片、适合约 5 秒的简短提示词和附件当前尺寸先生成，确认最终视频有画面和声音；缩短提示词时间线，避免附件中长剧情与 5 秒参数不一致。
3. **导出最小 API 图**：保存为短文件名，例如 `H3-ref1-5s.json`；核对全体 `class_type`、模型文件名、真实输入键与输出节点。不要手工把编辑器 JSON 当成 API 图。
4. **用现有设置验证静态接入**：候选映射是 `121.image`（图片）、`97.prompt`（提示词）、`27.value`（时长）、`29.aspect_ratio` 与 `29.megapixels`（尺寸）、`11.noise_seed`（种子）、`177.value`（附件另一参数入口，按导出后实际连线确认用途）。这些 ID/键必须以实际 API 导出重新核对；Get/Set 等界面辅助节点可能被消解。两个阶段是否同步引用同一输入也需检查。
5. **正式支持 1–6 图**：另外导出全分支启用模板，按实际素材数量删减连接和支路，冻结参考顺序，编译 `<Picture N>` 等标签，加入明确超限/缺失错误。再分别增加视频与音频加载和原声开关。
6. **增加经过验证的尺寸预设**：维护整套两阶段设置；明确显示最终像素尺寸与真实/裁切后时长。
7. **接入队列和进度**：WebSocket 推送加 queue/history 恢复；复用已有 Generation Run；设置页和画布都验证视频输出，最终输出只收指定节点。

建议先验收第 1–4 步再进入完整产品适配。最小实机验收应包含：单图成功、两次提交产生真实排队、缺少模型/节点的错误、断线后恢复同一任务，以及最终视频播放。正式动态适配再覆盖 1/2/6 图、顺序调整、删除参考、超限、视频原声开关、音频标签、两阶段尺寸一致和中英文切换。

## 8. 跟踪与尚待验证项

已有相关工作为 [LAZ-50 下一版本首次引导接入本地 ComfyUI](https://linear.app/lazyq/issue/LAZ-50/下一版本首次引导接入本地-comfyui)，另有 WORK-6 记录 ComfyUI 与 H3 设备准备。它们不能替代一个已经确认范围的 H3 适配实现任务；本轮未创建重复任务、未改变状态。

Core 版本、实际 API 导出、所需节点类型和模型文件的可选清单已在第 9 节核对。仍待确认自定义节点的实际安装 commit、模型文件能否正确加载、尺寸及显存上限、参考音频行为、各阶段真实推送的进度、预览和最终输出的运行时字段、H.265 浏览器播放，以及排队加生成耗时是否超过当前约 30 分钟的轮询预算。上述未验证项不阻止准备接入方案，但阻止宣称已完成 H3 接入。

## 9. 2026-10-14 远端只读核查

用户提供了局域网 ComfyUI 服务；具体设备地址仅保留在本地配置中。以下是核查时的快照，队列、可选文件与设备负载会变化。浏览器访问成功确认了本机到该设备的连通性；本轮没有通过 Reroll 后端完成上传、提交和下载闭环。

| 核查对象 | 观察结果 | 证据与边界 |
| --- | --- | --- |
| 设备与版本 | Windows；ComfyUI `0.36.0`；Python `3.12.10`；PyTorch `2.10.0+cu130`；RTX 4080，约 16 GiB 显存；约 64 GiB 内存 | `/system_stats`；硬件规格不能证明某尺寸能跑通 |
| 节点注册 | 共注册 4745 种节点；导出工作流使用的 31 种全部可找到 | `/object_info`；不代表所有节点版本兼容性已运行验证 |
| 模型与辅助权重 | 工作流用到的 12 个文件名均出现在对应加载节点的可选清单中 | 两个 VAE、文本编码器、主模型、六个 LoRA、semantic bridge、latent upscaler；未读取或校验文件内容 |
| 当前队列与历史 | `running=0`、`pending=0`；`/history?max_items=5` 返回空对象 | `/queue`、`/history?max_items=5`；仅表示检查时没有这些记录，不推断从未运行过 |
| 当前素材 | `121.image` 中的参考图文件名不在 `LoadImage.image` 可选列表 | 首次生成前需更换有效素材或确认并上传原图；不能把保存的文件名当成已存在 |
| API 导出 | 已通过页面 Export (API) 得到 `H3-live-api-2026-10-14.json`，49 个节点、31 种类型 | 静态检查未发现悬空节点连接；未调用 `/prompt` 做服务端执行验证 |
| 可复用媒体节点 | `LoadAudio`、`VHS_LoadVideo` 均已安装；后者输出 IMAGE 帧、帧数、AUDIO、视频信息 | 可以在新模板中连接；当前导出没有这两类加载节点 |
| 可复用辅助节点 | `MiniMaxH3PromptTagsT8`、`MiniMaxH3PreflightT8` 已安装 | 可用作插件侧预检辅助；仍需 Reroll 自己校验素材清单与引用关系 |

导出文件 SHA-256：`d7cc28829fef78eddae737795cfd775e32c6795d7b39d6dc26bcdba5ead5f874`。原始导出作为本地研究附件保留，不随研究文档写入仓库；它包含完整示例提示词。后续若页面有改动，应重新导出并记录哈希。

### 9.1 实际导出修正了哪些判断

1. **当前时长是 6 秒。** `27.value=6`，节点 `30` 按公式生成 158 帧；以 `21.frame_rate=24` 计算，名义视频长度约 6.58 秒。实际封装后的时长仍需读取成片。原附件的 5 秒是另一快照，不能继续当作当前设置。
2. **两阶段当前都直接读原图。** `7`、`14` 的 `ref_images.ref_image_0` 都连接 `["121", 0]`；`115` 的缩放输出只通往 `100` 图片预览。不能以预览尺寸推断模型实际收到的参考图尺寸。接入应明确选择保留原图路径或采用经验证的预处理路径，并同时接到两阶段。
3. **当前 API 图只保留一路图。** 多图正式模板需要从完整分支导出或按明确规则生成，不能仅增加表单控件而沿用单图图结构。
4. **两阶段宽高已有内部联动。** `7` 读取 `29` 的宽高，`14` 读取 `13` 放大后输出的宽高；应保留该连接。`13.size_mode=scale_by` 时，真正有效的是约 1.5 倍，`target_width=1280`、`target_height=704` 不是当前生效的目标尺寸。
5. **两处输出需要明确区分。** `185` 保存临时 H.264 预览；`21` 保存 H.265、`yuv420p10le` 的最终视频。页面出现了 “Unable to play media”，但本轮未确定是旧文件缺失、链接还是编码兼容原因，不能据此断定 H.265 不受支持。产品接入应明确成片节点；首测可采用经验证的 H.264/yuv420p 输出配置来检查画布播放。
6. **素材数量上限已由远端 schema 确认。** 条件节点为 `COMFY_AUTOGROW_V3`：图 0–9、视频 0–3、视频音轨 0–3、独立音频 0–3。这里是输入槽上限；官方的混合素材总数、时长约束及本模板最低素材要求仍须另行校验。
7. **尺寸字段有明确类型。** `ResolutionSelector` 比例是枚举，包含横、竖、方等八项；宽高步长为 32；放大支持 `scale_by`、`target_megapixels`、`target_dimensions`。这些是节点允许填写的范围，不能作为本机性能支持表。

### 9.2 单图基线字段

| 产品参数 | 当前 API 目标 | 接入注意 |
| --- | --- | --- |
| 参考图 | `121.image` | 必须是绑定实例上传后实际返回的路径 |
| 提示词 | `97.prompt` | 仍经过共享文本连接后进入两阶段；提交标签按 H3 规则编译 |
| 时长 | `27.value` | 需公开说明帧网格，或制定精确裁切策略 |
| 画幅 | `29.aspect_ratio` | 传完整枚举值，例如 `16:9 (Widescreen)` |
| 第一阶段像素量 | `29.megapixels` | 联合最终放大预设管理，避免暴露两个互相矛盾的清晰度字段 |
| 随机种子 | `11.noise_seed` | 两阶段共享；重试是否复用由现有任务规则决定 |
| 最终输出 | 节点 `21` | `185` 单列为中间预览，`100` 只是参考图预览 |

## 10. 收敛后的补齐范围与实施顺序

建议复用现有工作流设置、Smart Canvas 与 Generation Run。新增能力集中在一个工作流编译步骤和现有 ComfyUI 执行通道：前者把用户的素材、提示词和参数整理成可提交的 API 图；后者负责向绑定机器上传、提交、接收进度及取回成片。

2026-10-14 用户澄清后的范围：日常使用时直接在 Reroll 选择时长和分辨率，不暴露两阶段尺寸、像素量、放大倍率或节点编号；H3 标签转换不得改变现有 API 生成链路。以下能力表是完整增强范围，并非单台机器首版全部必做。最小版本优先复用已有能力：

- **地址**：现有全局实例配置只保留 H3 地址时，执行自然落到这一台。每个工作流独立绑定实例是多机增强；当前 `reserve_best_backend` 自动选机，不是逐工作流绑定。
- **成片**：现有回收已支持视频，但没有按节点 ID 配置最终输出的入口。可先制作仅保留最终输出的接入模板，移除中间预览输出；保留所有预览的模板才需要显式结果选择。`save_output=false` 仅表示临时文件，不代表 Reroll 会忽略它；现有过滤只针对部分图片预览。
- **时长**：现有数字或下拉字段即可映射 `27.value`，无需另造预设系统。帧网格导致的实际长度偏差由适配层处理；若产品承诺精确秒数，成片须验收视频与音频同步裁切。
- **分辨率**：先为此 H3 模板配置少量已验证档位，在 Reroll 下拉中显示名称和实际尺寸。由适配层写入该模板的尺寸参数，第二阶段继续沿现有连接取得真实宽高。是否泛化为所有工作流的多目标预设编辑器可以后置。首版沿用当前 16:9；可变画幅是独立可选扩展。
- **引用隔离**：复用编辑器、素材列表和稳定引用身份；保留结构化引用至提交边界。仅当执行目标明确是 H3 工作流时，在该次提交的副本中生成 H3 标签和对应媒体连接。现有 API 及其他 ComfyUI 工作流继续使用原规则，不能把普通“图1”标签全局替换为 H3 标签，也不能反向改写公共草稿。以相同输入比较改动前后 API 请求及重试快照，作为回归验收。

| 顺序 | 要补齐的能力 | 用户可见结果 | 主要改动入口 |
| --- | --- | --- | --- |
| 1 | 工作流绑定实例、保留完整上传结果、最终输出选择、视频测试回显 | 一张图能从 Reroll 提交给这台 H3 电脑，最终只收到可播放成片 | `WorkflowConfig`、上传路由、`comfyui_impl.py`、`comfyui-settings.js` |
| 2 | 动态素材组、H3 标签、提交前预检 | 上传几张就使用几张，重排后引用仍正确；缺图和超限在排队前提示 | 独立的纯图编译模块、工作流配置、`prompt-authoring.js`、`generation-provider.js` |
| 3 | 尺寸与时长预设 | 用户只选画幅、清晰度、时长，两个阶段参数保持一致 | 配置中的多目标绑定和预设；两阶段尺寸连线继续由图负责 |
| 4 | 队列、阶段进度、断线恢复 | 排队位置、第一采样、放大、第二采样、编码、结果保存都能被正确表达 | ComfyUI transport、ProviderRuntime、RuntimeExecutor、Generation Run、画布 pending task |
| 5 | 视频、音频及视频原声适配 | 在同一参考区添加多种素材并获得正确编号 | 新模板中的媒体加载分支、媒体清单、音轨开关、H3 标签编译 |

顺序 1 是静态单图闭环；顺序 2–4 构成可日常使用的多图版本；顺序 5 扩展为完整多模态版本。长耗时实机调试时应尽早接入基础阶段日志，避免等待界面完成后才排查状态。

### 10.1 当前代码中需要一起修正的具体缺口

- **上传与实例归属**：`/api/upload` 当前向所有实例广播，只返回最后一次成功的 `comfy_name`；前端 `generationProviderComfyName` 缓存也不带实例。需要上传前固定实例，保存 `backend + name/subfolder/type`，避免某台上传失败或同名文件重命名后任务在另一台执行。不要把上传缓存跨机器复用。
- **配置表达能力**：现有 `WorkflowField` 只有单个 `node/input`，`WorkflowConfig` 只有 fields 与 mini_cards。需要可选媒体组、多目标绑定、参数预设、最终输出节点、实例绑定和输出媒体类型，同时兼容旧静态配置。节点 schema 应从绑定实例读取，识别新旧 COMBO 表达及动态输入；导入前报告缺失节点、无效枚举和文件依赖。
- **动态图与标签的一致性**：以冻结的参考实例清单生成图和提示词。两个条件节点使用同一顺序；不按 URL 去重不同参考实例，不通过全文替换“图1”处理引用。未使用分支应从 API 图移除；不保留示例路径或空字符串输入。
- **工作流无关的固定 ID 改写**：历史逻辑中数字 ID 的含义只属于对应旧模板，不能作用到任意导入图。当前实际导出没有 `22/23/144/158`，本次未发现这组碰撞；正式升级应把旧模板特例限定在其配置范围。
- **进度链尚未贯通**：Generation Run 已有 `progress` 接口与公开 metadata，但生产 `RuntimeExecutor.execute`、`ProviderRuntime.execute_workflow` 目前只传 checkpoint。需要把实时进度从 ComfyUI 接到这个通道，再让 `generationProviderWaitComfyTask` 消费；该前端函数目前只等终态。
- **阶段切换与任务恢复**：`_checkpoint_progress` 目前只合并有值字段，进入编码等没有百分比的阶段时可能保留上阶段 100%。需要明确清空旧阶段值，并为排队位置提供受限的结构化字段；断线、重启使用原 `prompt_id` 查询恢复，不重新提交。超时预算应区分排队与实际运行；恢复记录持久保存模板版本、实例和输出规则。
- **预览、成片与媒体类型**：首次执行与重启恢复需共用同一个输出筛选规则。工作流输出类型应驱动画布占位状态，当前 `generationProviderRunComfyTask` 接受任务时写死 `kind:'image'`，不适合 H3 视频。设置页需同时支持视频、音频结果。可播放预览与原始高质量下载可以分别管理。

### 10.2 验收范围

1. 单图有效素材 → 上传 → 排队 → 生成 → 下载 → Workspace/画布播放；验证声音、最终输出节点与实际时长。
2. 图编译覆盖 1/2/6 图、0 图拒绝、超限拒绝；两阶段顺序相同；删除素材后无示例文件残留、空输入和悬空连接；旧静态工作流保持行为。
3. 标签覆盖排序、删除、相同 URL 的不同引用实例、中英文切换；视频原声开关改变 Audio 编号时引用仍正确；不存在的引用提前拒绝。
4. 尺寸预设分别实测横、竖、方；核对 32 倍数、两阶段尺寸、显存、最终帧数与时长；未实测组合不宣称支持。
5. 两台机器有同名文件、单台上传失败、离线、旧上传缓存时，仍在绑定实例使用正确素材。
6. 排队 → 第一采样 → 放大 → 第二采样 → 编码 → 保存 → 成功；覆盖缓存节点、无 progress 事件、WS 断线、重复与迟到事件、重启恢复、失败/取消，确保不重复提交和不串任务。
7. 同时存在 `185` 与 `21` 时，首次和恢复都只交付同一成片；设置页与画布均能播放，刷新后进度可恢复；相关动态文案提供中英文并检查切换。

实施后的回归邻居包括 `tests/composer_mixed_media_reference_test.cjs`、`tests/composer_submission_feedback.test.cjs`、`tests/test_generation_runs.py`、`tests/test_provider_registry.py`、`tests/test_generation_task_restart_queries.py`、`tests/test_canvas_generation_idempotency.py`、`tests/test_workflow_storage_layout.py` 和相关 HTTP 契约测试。新增前端行为按仓库要求完成 i18n、浏览器验收与前端资源版本同步。本轮仅更新研究记录，不把未实施能力写入 Current，也不变更既有 Linear 状态。
