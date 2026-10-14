# APIMart Suno 音乐实验室：接口调研

调研日期：2026-10-13（Asia/Shanghai）。范围：音乐生成、导入音频、文件下载、异步任务与历史记录。本文件为调研与实测归档。前半部分来自官方文档；末节补充真实接口验证，当前产品承诺见 [Suno 音乐实验室](../current/suno-music-lab.md)。

## 后续更正：参考音频能力

本报告最初只检查了主 generation、uploadTask 和 download，遗漏了独立的参考创作端点。APIMart 支持 inspo（1–4 首参考生成）、uploadCover、uploadExtend 等能力；主 generation 不接收音频并不代表整套服务不支持。已完成 inspo 的 V6 Mini 真实验证。详见 [参考音频补充调研](../archive/2026-10-13-suno-reference-audio-research.md)。下文的独立导入建议仅描述当时实现边界，不足以满足用户后来明确的参考音乐需求。

## 结论与版本选择

当前直接访问的中英文生成文档、V6 总览和官网模型页一致列出三个公共版本：`v6`、`v6-wild`、`v6-mini`。请求的 `model` 固定为 `suno`，具体版本放在 `version`。自定义歌词模式与训练得到的自定义模型是两种不同能力；本期无需为了支持自定义歌词增加训练流程。[生成接口](https://docs.apimart.ai/en/api-reference/audios/suno/generation)、[V6 总览](https://docs.apimart.ai/en/api-reference/audios/suno/overview)、[当前模型页](https://apimart.ai/zh/model/suno)

搜索引擎仍缓存官网 2026-07-15 发布说明及旧模型价格，出现 `v3.5`、`v4`、`v4.5`、`v4.5+`、`v4.5-all`、`v5`、`v5.5`。但直接抓取当前官网模型页，选择器默认值和价格规格已为 V6 系列，旧版本仅出现在历史博客链接。不能根据搜索缓存宣称旧版本仍可用。推荐首期覆盖当前三个公共版本；若产品必须包含旧版，应先用服务端校验明确兼容情况。[历史发布说明](https://apimart.ai/log-updates)、[当前模型页](https://apimart.ai/zh/model/suno)

## 最小调用链

服务地址为 `https://api.apimart.ai`。下列端点使用 `Authorization: Bearer <API_KEY>`。密钥应留在应用后端，前端通过现有供应商配置调用。[Suno 总览](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

| 用途 | 方法与路径 | 请求要点 | 结果入口 |
| --- | --- | --- | --- |
| 生成音乐 | `POST /v1/music/generations` | `model: suno`，`version`，模式与文本 | `data[0].task_id` |
| 导入已有音频 | `POST /v1/music/generations/uploadTask` | 仅 `audioFilePath: 公网 HTTP(S) 音频 URL` | `data[0].task_id` |
| 查询音乐任务 | `GET /v1/music/tasks/{task_id}` | 可附 `?language=zh` 或 `en` | `data.status`、`data.result` |
| 准备下载文件 | `POST /v1/music/generations/download` | 来源任务、曲目序号、格式数组 | 新的下载任务 ID |

对应来源：[生成](https://docs.apimart.ai/en/api-reference/audios/suno/generation)、[导入](https://docs.apimart.ai/en/api-reference/audios/suno/upload)、[查询](https://docs.apimart.ai/en/api-reference/audios/suno/overview)、[下载](https://docs.apimart.ai/en/api-reference/audios/suno/wav)。旧 `/v1/music/generations/wav` 已废弃，新实现使用 `/download`。

## 生成参数与适合的表单控件

下表的字段名称、枚举和限制来自[生成接口](https://docs.apimart.ai/en/api-reference/audios/suno/generation)和[通用约定](https://docs.apimart.ai/en/api-reference/audios/suno/overview)；控件选择是本项目实现建议。

| 参数 | 官方约束 | 建议控件与行为 |
| --- | --- | --- |
| `version` | `v6` / `v6-wild` / `v6-mini` | 单选下拉框；默认 V6 |
| `custom` | 布尔；默认 `false` | 分段切换「灵感」「自定义」 |
| `instrumental` | 布尔；默认 `false` | 「纯音乐」开关 |
| `prompt` | 灵感必填，≤3000；自定义有人声必填，≤5000；自定义纯音乐可省略 | 多行文本框；标签随模式改为歌曲描述/歌词；Unicode 字符计数 |
| `title` | 自定义模式；≤80 | 单行输入 |
| `style` | 自定义模式；≤1000 | 短文本区；自由输入风格，不强制固定音乐分类 |
| `negative_tags` | 自定义模式；未注明长度上限 | 可选文本区「排除风格」 |
| `auto_lyrics` | 自定义模式；布尔 | 可选「允许改写歌词」开关；不是独立生成歌词接口 |
| `vocal_gender` | `Male` / `Female`；两种模式有效 | 自动/男声/女声单选；自动时省略字段；纯音乐时收起 |
| `style_weight` | 数值 0–1；两种模式有效 | 高级设置滑杆，0.01 步长；未启用时省略 |
| `weirdness_constraint` | 数值 0–1；两种模式有效 | 「创意度」滑杆，0.01 步长 |
| `audio_weight` | 数值 0–1；两种模式有效 | 「音频权重」高级滑杆；不能误称主接口支持参考音频 |
| `variety` | `off` / `normal` / `high` / `extra` / `max`；无固定默认值 | 含「自动」的下拉框；自动省略字段 |
| `max_mode` | 布尔；启用要求自定义模式；两倍价格 | 带价格提示的高级开关；默认关 |
| `audio_format` | `mp3` / `m4a` / `wav`；省略由服务决定 | 下拉框，可选自动 |
| `duration` | 自定义模式；整数 10–360 秒；只是目标时长 | 可选数字输入＋秒单位；不承诺精确时长 |
| `persona_id` | 自定义模式；与 `custom_model_id` 互斥 | 已有 Persona ID 高级输入可延后，不必搭建 Persona 创建流程 |
| `custom_model_id` | 训练任务返回的完整 UUID；与 `version`、`persona_id` 互斥 | 不属于首期公共版本选择；后续单独设计 |

实现注意：`style` 不能误写为其他操作使用的 `tags`；主生成使用 `weirdness_constraint`。自定义专用字段在灵感模式应不发送。零是合法权重，不能用 `value || default` 覆盖。前端 `Array.from(text).length` 比 UTF-16 的 `text.length` 更符合官方 Unicode 字符计数约定。`variety=max` 与 `max_mode=true` 独立，前者不能自动开启双倍费用。

## 上传：导入 URL，不是上传二进制

`uploadTask` 只收 JSON；合法内容是已公开可访问的音频直链。不能传本地路径、浏览器 `blob:` 地址，不能附加 `version`、`audio_format` 等未列字段。完成后以本次 `task_id` 和 `audio_index=1` 引用；可能只返回 `audio_id`，不保证可播放链接。[上传音频](https://docs.apimart.ai/en/api-reference/audios/suno/upload)

```json
{"audioFilePath":"https://example.com/audio.mp3"}
```

主生成端点没有 `audio_id`、`task_id`、`audio_url` 输入。导入音频不能直接作为该端点的参考条件；它服务于续写、翻唱等后续操作。此次最小范围可提供独立的导入记录，不应在「生成音乐」按钮上暗示上传音频会影响生成。[生成接口](https://docs.apimart.ai/en/api-reference/audios/suno/generation)、[上传音频](https://docs.apimart.ai/en/api-reference/audios/suno/upload)

本地文件若要支持拖放，需要先存入供应商能访问的对象存储，得到公网 URL。导入操作随后调用 `uploadTask`；参考新歌、直接改编和直接续写可以把该 URL 交给对应端点，无需额外导入，见上方补充调研。目前官方索引只列出 `POST /v1/uploads/images`；该端点明确限 JPEG/PNG/WebP/GIF、20 MB，图片保留 72 小时，不能将其文档推导为支持音频。未找到 `/v1/uploads/audios` 或 `/v1/uploads/files` 的官方文档。[上传图片文档](https://docs.apimart.ai/en/api-reference/uploads/images)、[完整索引](https://docs.apimart.ai/llms.txt)

仓库现有 `backend/infinite_canvas/providers/http_impl.py` 的 `upload_audio_for_apimart` 优先使用 `PUBLIC_BASE_URL`，否则依次尝试 `/v1/uploads/audios`、`/v1/uploads/files`、`/v1/uploads/images`。这是现有代码的兼容尝试，不构成 APIMart 官方支持证明。需要用小型合法音频真实验证，失败时给出明确的可操作提示。上传音频的大小、时长、输入格式上限在此端点文档中没有明确约定，不应把别的端点限制当作它的合同。

## 异步状态、响应与历史

三种 POST 都返回相同的提交外壳；`data` 是数组，提交成功不代表成品完成。

```json
{"code":200,"data":[{"status":"submitted","task_id":"task_example"}]}
```

查询响应 `data` 是对象。下面为根据官方结构构造的最小示例，数值和 ID 均非实测：

```json
{
  "code": 200,
  "data": {
    "id": "task_example",
    "status": "completed",
    "progress": 100,
    "created": 1789041600,
    "cost": 0.05,
    "credits_cost": 0.5,
    "result": {
      "music": [{
        "audio_id": "track_example",
        "status": "complete",
        "title": "Example",
        "lyrics": "Example lyrics",
        "tags": "acoustic",
        "duration": 119.8,
        "audio_url": "https://example.com/result.m4a",
        "image_url": "https://example.com/cover.jpg"
      }]
    }
  }
}
```

来源及补充规则：[任务查询](https://docs.apimart.ai/en/api-reference/audios/suno/overview)。可能还有 `estimated_time`、`image_large_url`、`display_tags` 和权重等元数据；不要要求每个可选字段存在。结果曲目数量不固定为两首。后续引用必须保留 `music[]` 原始的一基序号，即首项为 1，不随界面排序改变。音频 URL 不保证 `.mp3` 后缀。

状态包括 `pending`、`processing`、`completed`、`failed`、`unknown`。只有 `status` 判断完成，不能单靠进度。文档总览建议首次约 3 秒后查询，随后间隔 5–10 秒；生成页另写 3–5 秒，可取 5 秒作为保守交集。生成页的 30–120 秒是通常耗时，不是超时保证。失败读取 `data.error.message`，还有可选 `type`、`code`、`param`；已失败任务退款。[总览](https://docs.apimart.ai/en/api-reference/audios/suno/overview)、[生成](https://docs.apimart.ai/en/api-reference/audios/suno/generation)

建议持久化每次生成/导入/导出记录：本地记录 ID、供应商 ID、任务 ID、操作类型、请求参数快照、提交时间、状态、结果曲目原序号、已缓存文件。这样刷新页面仍能恢复查询，历史选择后可以查看当时参数、歌词和产物。`unknown` 或网络失败保留任务，不自动重发付费 POST；提供刷新状态。服务器没有取消 Suno 任务的端点，停止浏览器轮询不等于取消上游任务。[总览](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

## 下载、收费与保存

```json
{"model":"suno","task_id":"task_source","audio_index":1,"formats":["mp3","m4a","wav"]}
```

`formats` 至少一项，可用单值 `format` 代替，二者选一。格式不区分大小写，会去重；返回顺序跟随请求。来源任务须属当前账户、已完成并含可下载音轨。下载请求返回新的任务 ID，查询该 ID 的 `data.result.files[]`，每项为 `{format,url}`。`wavUrl` 仅是旧兼容字段。[下载音频文件](https://docs.apimart.ai/en/api-reference/audios/suno/wav)

文件通常提交时已准备好，可立即查询；仍未结束则每 2 秒查一次，文档建议最多等待 60 秒。等待结束并不代表应删除任务，产品可以保留它继续手动刷新。

每次提交下载请求都会收费，一次请求多格式只计一次；同一首歌重复提交或后来追加格式都会新增费用。导出进行中禁用重复按钮，成功后缓存 URL/本地文件，重新点击下载应复用产物。失败下载任务退款。返回一般为 APIMart 文件域；存储转存失败时可能给上游 CDN，生命周期不保证，应尽快下载到本地持久目录，而非只永久保存临时 URL。[下载文档](https://docs.apimart.ai/en/api-reference/audios/suno/wav)

2026-10-13 直接读取模型页显示基础档参考价格：生成 `0.5 Credits`、Max 生成 `1 Credit`、导入 `0.04 Credits`、下载请求 `0.016 Credits`；有其他折扣档，不能将网页价格写死为账户实扣金额。展示实际任务的 `credits_cost` / `cost`。当前模型页是价目参考，真实消费以账户与任务为准。[模型价目](https://apimart.ai/zh/model/suno)、[任务费用字段](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

## 错误和未知约束

提交可能出现 400 参数错误、401 密钥错误、402 余额不足、403 权限、429 频率限制、500/502 服务错误。下载的 403 `model_price_not_configured` 特指 `suno@download` 未配置价格，应联系供应商，不应诱导用户重复点击。提交前校验失败不创建或计费下载任务。[生成错误响应](https://docs.apimart.ai/en/api-reference/audios/suno/generation)、[下载错误](https://docs.apimart.ai/en/api-reference/audios/suno/wav)

没有找到 Suno 专属并发数、每分钟额度、导入大小限制、音乐成品统一保留期限。不可把图片 72 小时有效期或账户查询的 60 次/分钟套到 Suno。处理 429 时遵守返回的限流信息并延迟查询；不得因 POST 网络失败自动重试造成重复付费。

模型列表 `GET /v1/models?expand=category&category=audio` 可核对当前密钥权限，但官方明确音频模型暂没有参数 schema；`expand=parameters` 不能替代这里的音乐字段文档。公开 OpenAPI 文件当前未包含 music 路径。[模型元数据](https://docs.apimart.ai/en/api-reference/texts/models/list)、[公开 OpenAPI](https://docs.apimart.ai/api-reference/openapi.json)

## 首期界面建议

这些是根据任务范围的产品设计建议，不是 APIMart 强制要求。

1. 首页顶层导航保持「画布」「在线生成」，新增「实验室」；实验室内提供「Suno 音乐生成」卡片。
2. 工作区左侧为创作表单，右侧为历史列表及选中详情；窄屏改为上下布局，历史可展开。
3. 默认灵感模式只突出版本、描述、纯音乐和生成按钮；自定义模式展示歌词、标题、风格。权重、变化程度、格式、目标时长等放高级设置。
4. 生成按钮防重复提交，等待时可切换历史；展示真实状态而非伪造倒计时。
5. 历史区同时容纳生成记录和导入记录。曲目使用原始结果序号，每首独立播放器、歌词、时长、下载动作。无音频 URL 的导入记录显示成功状态和来源，不渲染坏播放器。
6. 下载格式用复选按钮/复选框多选。第一次执行说明「准备文件」，后续对已缓存格式显示直接下载。
7. 所有名称、提示、错误包装、可访问标签都放双语 i18n；供应商错误原因作为诊断数据呈现，不代替本地化操作提示。

## 上线前验证清单

- 合同测试：三版模型、两种模式、纯音乐、空值与字符上限、零权重、各枚举、Max/目标时长仅自定义可用。
- 异步测试：提交数组/查询对象、pending/processing/failed/unknown、多首及单首、缺封面/缺时长/缺播放 URL、重启恢复。
- 下载测试：来源曲目序号、三格式、多格式缓存、重复点击不重扣、过期远端 URL、本地文件名与下载响应。
- 真实 API：正常生成至少一次，上传合法公开音频一次，生成曲目导出至少一次；记录脱敏任务 ID、实际状态/结果形状和消费；严格不记录密钥。
- 本地文件托管：验证现有上传桥接端点是否真的接受音频；若不支持，需要 PUBLIC_BASE_URL/已有对象存储，并明确记录该限制。
- 浏览器检查：中英切换、各模式控件切换、首页入口、历史选中、播放下载、刷新恢复及移动布局。

## 待真实验证的关键差异

1. 当前文档和官网都列 V6，搜索缓存仍列旧版；以直接来源为准，旧版服务端是否仍兼容未知。
2. 官方没有二进制音频托管合同；仓库兼容尝试需要验证。
3. 导入完成结果未给完整 JSON 样例，可能只有 `audio_id`；实现不能强依赖 `music[].audio_url`。
4. `audio_weight` 对无音频输入的主生成实际效果没有进一步解释；保留准确名称，避免错误产品承诺。
5. `negative_tags` 和 Persona ID 没有文档长度上限；本地保护上限应标明是应用规则。

## 实现与真实验证补充（2026-10-13）

三个 V6 版本通过生产应用 API 各完成一次 10 秒自定义纯音乐生成，每次两首曲目，全部保存并下载。
单次生成返回 0.5 Credits。前置 V6 Mini 探测同样成功；v5.5 请求返回 400，明确提示旧版本已下线。
URL 导入返回 audio_id 而没有音频链接，消耗 0.04 Credits，产品按合法成功保存。
同一曲目一次准备 MP3/M4A/WAV 返回三个文件，共 0.016 Credits；应用下载验证格式与非空内容。
重复相同格式组合、交换格式次序及服务重启后均返回原有导出 Run，不再次提交收费请求。
四次成功生成加导入、导出合计 2.056 Credits。两个未文档化二进制上传候选路径实际为 404，未采用。

最终控件选择以仓库交互规范为准：延迟到提交生效的布尔项使用 Checkbox；数值使用 Slider/Number Input；
枚举使用 Select；创作模式使用横向 Radio Group。自动选项在 UI 使用非空 auto 值并在请求时省略。
公共版本之外的 custom_model_id 训练流程不在首期。实现、验收与恢复边界已毕业到 Current 规格。
