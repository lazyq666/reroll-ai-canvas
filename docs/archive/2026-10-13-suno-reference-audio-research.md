# APIMart Suno：参考音频生成补充调研

- Status: Archived — local reference creation implemented
- Verified: 2026-10-13（Asia/Shanghai）
- Tracking: [LAZ-85](https://linear.app/lazyq/issue/LAZ-85)

本文补充此前仅围绕主 generation、uploadTask、download 三个端点的调研。接口合同取自 APIMart 第一方文档；末节记录当前账户的付费 inspo 实测。本文保留调研当时的判断；后续已完成本地参考创作，当前产品行为以 [Suno 音乐实验室](../current/suno-music-lab.md) 为准。

## 核心结论

**APIMart 明确提供参考音乐生成能力。** 最直接的是 `inspo`：传入 1–4 个音频 URL，参考它们生成新歌。另有直接以音频 URL 翻唱的 `uploadCover`、直接续写的 `uploadExtend`。不能因为主 `POST /v1/music/generations` 没有音频输入字段，或 `uploadTask` 只接受 URL，就推导为整套 Suno API 不支持音频参考。[Inspo](https://docs.apimart.ai/en/api-reference/audios/suno/inspo)、[Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)、[Upload Extend](https://docs.apimart.ai/en/api-reference/audios/suno/upload-extend)

产品可以把「选择本地音频 → 获取供应商可访问的地址 → 发起参考生成」组织成一次操作。前一步是文件托管，后一步才是模型处理；二者技术上分开，不意味着用户必须手工提供 URL。具体托管入口仍需核实，但参考生成接口本身已经文档化。[Upload Cover 的音频输入要求](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)、[UploadTask 的 JSON 约定](https://docs.apimart.ai/en/api-reference/audios/suno/upload)

此前「上传是单独的资料记录，不能用于主 generation」仅准确描述那个端点的字段，不足以覆盖用户所说的「上传音乐用于参考」。若该用途是本期核心需求，应把 `inspo` 或 `uploadCover` 纳入实际创作链路，而非只完成 uploadTask 入库。

## 按创作意图选择接口

下列都是 `POST`，服务地址 `https://api.apimart.ai`，路径前缀 `/v1/music/generations`。表中用途采用文档能力描述；每行链接对应独立第一方接口文档。

| 用户意图 | 路径后缀 | 输入音频引用 | 关键条件 | 官方来源 |
| --- | --- | --- | --- | --- |
| 参考一首或多首音乐创作新歌 | `/inspo` | `audio_urls`：1–4 个公网 URL | 不需先 uploadTask | [Inspo](https://docs.apimart.ai/en/api-reference/audios/suno/inspo) |
| 给本地/外部音乐换风格、翻唱 | `/uploadCover` | 单个 `audio_url` | 源音频不足 8 分钟；不需先 uploadTask | [Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover) |
| 从本地/外部音乐的指定位置继续写 | `/uploadExtend` | 单个 `audio_url` | 源音频不足 8 分钟；`continue_at` 必填 | [Upload Extend](https://docs.apimart.ai/en/api-reference/audios/suno/upload-extend) |
| 翻唱历史中的某首曲目 | `/coverSong` | `task_id` + `audio_index` | 引用已有可解析源曲目 | [Cover Song](https://docs.apimart.ai/en/api-reference/audios/suno/cover-song) |
| 续写历史中的某首曲目 | `/extend` | `task_id` + `audio_index` | `continue_at` 必填 | [Extend](https://docs.apimart.ai/en/api-reference/audios/suno/extend) |
| 给上传的伴奏加演唱 | `/addVocals` | uploadTask 的 `task_id` + `audio_index` | 普通生成任务不能作为来源 | [Add Vocals](https://docs.apimart.ai/en/api-reference/audios/suno/add-vocals) |
| 给上传的人声加伴奏 | `/addInstrumental` | uploadTask 的 `task_id` + `audio_index` | 普通生成任务不能作为来源 | [Add Instrumental](https://docs.apimart.ai/en/api-reference/audios/suno/add-instrumental) |
| 选取上传音频片段创作歌曲 | `/sample` | uploadTask 的 `task_id` + `audio_index` | `start_s`、`end_s` 必填 | [Sample](https://docs.apimart.ai/en/api-reference/audios/suno/sample) |

`audio_index` 是源任务 `data.result.music[]` 原始数组的位置，从 1 开始，默认 1；不是 `audio_id`。普通任务引用不能直接改传 `audio_url`，直接 URL 类端点也不应误传任务 ID。[通用源曲目引用约定](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

## 版本及共同参数

本次逐一获取的上述八个端点均列出公共版本 `v6`、`v6-wild`、`v6-mini`；省略 `version` 默认为 `v6`。也可使用 `custom_model_id`，但它与公共 `version` 互斥；支持 Persona 的端点还规定与 `persona_id` 互斥。不能将“自定义歌词模式”的 `custom` 与训练模型 ID 混为一谈。[总览](https://docs.apimart.ai/en/api-reference/audios/suno/overview)、[Inspo](https://docs.apimart.ai/en/api-reference/audios/suno/inspo)、[Cover Song](https://docs.apimart.ai/en/api-reference/audios/suno/cover-song)

通用文本边界：描述 `gpt_description` ≤3000、歌词 `prompt` ≤5000、风格 `tags` ≤1000、标题 `title` ≤80，按 Unicode 字符计数；具体必填条件依端点决定。[通用文字限制](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

常见可选控制：`style_weight`、`weirdness`、`audio_weight` 均为 0–1；零有效。参考/衍生操作应使用 `tags`、`weirdness`，不要直接复用主 generation 的 `style`、`weirdness_constraint` 字段名。后者在多处作为旧兼容别名存在。[通用约定](https://docs.apimart.ai/en/api-reference/audios/suno/overview)、[Inspo 参数](https://docs.apimart.ai/en/api-reference/audios/suno/inspo)

共同枚举包括 `vocal_gender: Male | Female`、`variety: off | normal | high | extra | max`、`audio_format: mp3 | m4a | wav`。`max_mode` 开启时按普通价格的两倍计费，部分端点限定自定义模式。不能把 `variety=max` 等同开启 `max_mode`。[V6 约定](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

## 1. Inspo：直接参考音频生成新歌

**最接近“上传一段或多段音乐作为创作参考”。** `audio_urls` 必填，数组长度 1–4，内容为可公开访问的音频 URL。接口没有要求先导入为 uploadTask。[Inspo 官方文档](https://docs.apimart.ai/en/api-reference/audios/suno/inspo)

可选内容字段：`prompt`（歌词/内容）、`title`、`tags`、`negative_tags`、`auto_lyrics`；控制字段为三种权重、人声性别、变化程度、Max、输出格式。**明确不发送** `custom`、`instrumental`、`gpt_description`、`persona_id`、时长字段。[Inspo 参数及 Note](https://docs.apimart.ai/en/api-reference/audios/suno/inspo)

以下为本报告根据参数编写的示意请求，不是实测：

```json
{
  "model": "suno",
  "version": "v6",
  "audio_urls": ["https://example.com/reference.mp3"],
  "tags": "warm acoustic pop, soft piano",
  "audio_weight": 0.7,
  "style_weight": 0.6,
  "weirdness": 0.3,
  "audio_format": "mp3"
}
```

产品含义：可提供多文件参考区、风格、可选歌词、参考权重滑杆。不能沿用普通生成表单的「纯音乐」开关并向 inspo 发送 `instrumental`。文档只把 `audio_weight` 定义为音频权重，并未保证 0.7 对应 70% 相似度，也未保证保持旋律、节奏或音色的具体程度。[Inspo](https://docs.apimart.ai/en/api-reference/audios/suno/inspo)

未确认边界：inspo 文档未给单个参考的文件大小、时长、输入编码列表；**不能套用 uploadCover 的 8 分钟约束作为该端点官方规则**。也未说明多条参考如何分别加权，只有一个整体 `audio_weight`。

## 2. Upload Cover：外部音频直接翻唱改编

`audio_url` 为必填公网 HTTP(S) 直链，音源不足 8 分钟；无需先调用 uploadTask。`custom` 应显式提交：`false` 时 `gpt_description` 必填；`true` 时使用歌词/风格，且 `instrumental=false` 时 `prompt` 必填。`instrumental` 默认 false。[Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)

支持 `title`、`tags`、`negative_tags`、`auto_lyrics`、`persona_id`、人声性别及三种权重；`duration_s` 为 10–360 整数，仅自定义模式；`max_mode` 也要求自定义模式。还支持 `variety`、`audio_format`。[Upload Cover 参数](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)

示意请求：

```json
{
  "model": "suno",
  "version": "v6",
  "audio_url": "https://example.com/source.mp3",
  "custom": false,
  "gpt_description": "把这首歌改编成温暖、轻快的原声爵士风格"
}
```

适合界面上的「改编」模式：上传一首，指定新风格。文档承诺是翻唱/风格转换，没有详细说明原旋律、歌词、结构保持比例，需真实试听验证，不能在 UI 写“完全保留原旋律”。

## 3. Upload Extend：外部音频直接续写

输入 `audio_url`（不足 8 分钟）和 `continue_at`（秒）；续写点至少 1 秒，严格小于源音频时长。无需先调用 uploadTask。此端点固定使用自定义模式，**不发送** `custom`、`instrumental`、`gpt_description`。[Upload Extend](https://docs.apimart.ai/en/api-reference/audios/suno/upload-extend)

`prompt` 是续写歌词，省略时作为器乐续写。还支持标题、风格、排除风格、三种权重、人声性别、`auto_lyrics`、Persona、`duration_s`（10–360 整数）、变化程度、Max、输出格式。[Upload Extend 参数](https://docs.apimart.ai/en/api-reference/audios/suno/upload-extend)

示意请求：

```json
{
  "model": "suno",
  "version": "v6",
  "audio_url": "https://example.com/source.mp3",
  "continue_at": 25,
  "tags": "acoustic pop",
  "duration_s": 60
}
```

建议用播放器进度上的时间选择器设置续写点，并显示精确秒数。该请求未提供 `prompt`，根据此端点文档表达器乐续写。目标时长不是精确输出保证。

## 4. 历史曲目翻唱 Cover Song

`POST /v1/music/generations/coverSong` 使用 `task_id + audio_index`，不接受直接 URL 作为源。对上传的外部音乐可以先 uploadTask 后引用它；官方 uploadTask 文档明确将 cover/continuation 列为导入音频用途。[Cover Song](https://docs.apimart.ai/en/api-reference/audios/suno/cover-song)、[UploadTask](https://docs.apimart.ai/en/api-reference/audios/suno/upload)

`custom=false` 时必须填写 `gpt_description`；自定义时使用 `prompt`、`title`、`tags`、排除风格和权重等。官方专门给出仅提供目标 `tags` 的改编例子，自动判断为自定义；没有要求这一模式一定填写新歌词。实现可显式提供 custom，避免依赖推断。[Cover Song 模式说明](https://docs.apimart.ai/en/api-reference/audios/suno/cover-song)

它与 uploadCover 的参数并非完全相同：此端点未列 `instrumental`、`auto_lyrics`；支持 Persona、`duration_s`（仅自定义）、Max（仅自定义）、输出格式等。不能把统一表单所有参数不分端点一起传。即使某字段在当前模式不生效，提交了仍会校验其类型/长度/范围。[Cover Song 参数和 Warning](https://docs.apimart.ai/en/api-reference/audios/suno/cover-song)

## 5. 历史曲目续写 Extend

`POST /v1/music/generations/extend` 的来源为 `task_id + audio_index`；`continue_at` 必填，支持小数秒，范围 `1 ≤ continue_at < 原音频实际时长`。`custom` 默认 true，使用 `prompt` 作为续写歌词；只有显式 false 才使用 `gpt_description` 指引续写。[Extend](https://docs.apimart.ai/en/api-reference/audios/suno/extend)

支持风格、标题、负面风格、三种权重、人声性别、`auto_lyrics`、Persona、变化程度、输出格式；`duration_s` 和 Max 仅自定义模式适用。这里不是 uploadExtend，不能沿用后者“禁止发送 custom”的规则。[Extend 参数](https://docs.apimart.ai/en/api-reference/audios/suno/extend)

文档描述输出为 extended track，但未在该页保证结果一定是“原曲＋续写”的完整拼接文件；实际是否需要另走 concat 应通过结果试听确认，不应在历史播放器中擅自声称输出一定包含完整原曲。

## 6. Add Vocals / Add Instrumental

`/addVocals` 在已有伴奏/曲目上加人声；`/addInstrumental` 在已有声音/曲目上加伴奏。**这两个端点明确要求源任务必须由 uploadTask 创建，普通 generation 任务不能直接使用。** 传导入任务 ID 和曲目序号，不传 URL 或 audio_id。[Add Vocals](https://docs.apimart.ai/en/api-reference/audios/suno/add-vocals)、[Add Instrumental](https://docs.apimart.ai/en/api-reference/audios/suno/add-instrumental)

二者模式规则相同：`custom=false` 必填 `gpt_description`；自定义模式使用 `prompt`、`title`、`tags`、`negative_tags`、三种权重；人声性别两种模式生效。未显式 custom 时会由文本字段推断。支持变化程度、Max（要求自定义）、输出格式。**不支持** `auto_lyrics`、`persona_id`、`instrumental`、目标时长字段。[Add Vocals 参数](https://docs.apimart.ai/en/api-reference/audios/suno/add-vocals)、[Add Instrumental 参数](https://docs.apimart.ai/en/api-reference/audios/suno/add-instrumental)

调用顺序是：音频托管获得 URL → `uploadTask` → 等导入成功 → `addVocals` / `addInstrumental` → 等新任务完成。UI 需保留来源任务类型，不能对所有历史条目都无条件显示可执行动作。

## 7. Sample：指定音频片段作为种子

`POST /v1/music/generations/sample` 同样只接受 uploadTask 来源，必填 `start_s` 和 `end_s`，满足 `0 ≤ start_s < end_s`，且结束不能超过已知源时长；服务器不会默认替用户取 0–60 秒。[Sample](https://docs.apimart.ai/en/api-reference/audios/suno/sample)

支持 `instrumental`，默认 false；自定义且有人声时歌词必填，灵感模式时 `gpt_description` 必填。还可带风格、标题、排除风格、`auto_lyrics`、三种权重、人声性别、变化程度、Max（仅自定义）、格式；没有目标时长字段。[Sample 参数](https://docs.apimart.ai/en/api-reference/audios/suno/sample)

产品上适合“从一小段录音/旋律出发创作”。与 inspo 的多首总体参考不同，它显式要求一个采样区间，可以使用波形或双端范围选择器。

## 参数差异速查

“是”表示该页列出字段，不能理解为所有模式都生效。详细模式限制见各端点章节。

| 端点 | `custom` | `instrumental` | `auto_lyrics` | `persona_id` | 目标时长 | 输入音频 |
| --- | --- | --- | --- | --- | --- | --- |
| inspo | 禁止 | 禁止 | 是 | 禁止 | 禁止 | 1–4 URL |
| uploadCover | 显式提供 | 是 | 是 | 是 | `duration_s`，自定义 | 1 URL |
| uploadExtend | 禁止；固定自定义 | 禁止；省略歌词代表器乐 | 是 | 是 | `duration_s` | 1 URL＋续写点 |
| coverSong | 可选推断 | 未列 | 未列 | 是 | `duration_s`，自定义 | 任务＋曲目序号 |
| extend | 默认 true | 未列 | 是 | 是 | `duration_s`，自定义 | 任务＋曲目序号＋续写点 |
| addVocals | 可选推断 | 禁止 | 禁止 | 禁止 | 禁止 | uploadTask 来源 |
| addInstrumental | 可选推断 | 禁止 | 禁止 | 禁止 | 禁止 | uploadTask 来源 |
| sample | 可选推断 | 是 | 是 | 未列 | 禁止 | uploadTask 来源＋采样区间 |

来源：[Inspo](https://docs.apimart.ai/en/api-reference/audios/suno/inspo)、[Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)、[Upload Extend](https://docs.apimart.ai/en/api-reference/audios/suno/upload-extend)、[Cover Song](https://docs.apimart.ai/en/api-reference/audios/suno/cover-song)、[Extend](https://docs.apimart.ai/en/api-reference/audios/suno/extend)、[Add Vocals](https://docs.apimart.ai/en/api-reference/audios/suno/add-vocals)、[Add Instrumental](https://docs.apimart.ai/en/api-reference/audios/suno/add-instrumental)、[Sample](https://docs.apimart.ai/en/api-reference/audios/suno/sample)。

## 统一异步结果、历史与下载

这些操作都会返回新的 `data[0].task_id`。随后调用 `GET /v1/music/tasks/{task_id}`，完成后取 `data.result.music[]`。来源和新任务应分开保存，生成新记录不能覆盖原始输入音频的记录。曲目数组数量不固定；引用用原始序号。[统一任务约定](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

操作失败读取 `data.error.message`，不因浏览器超时自动重提付费 POST。`unknown` 保留记录供刷新，没有已文档化的服务端取消接口。[任务约定](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

后续文件导出可复用已有 `/download` 能力；下载源必须是已完成且含可下载曲目的任务。下载按请求收费，重复点击应复用准备好的文件。[下载](https://docs.apimart.ai/en/api-reference/audios/suno/wav)

## 建议纳入本期的交互

以下是基于上述能力的产品建议，不是 API 的强制结构。

1. 将创作入口按意图组织为「文字创作」「参考音乐」「改编」「续写」，避免把「上传」做成与创作脱节的单独结果。
2. 「参考音乐」对应 inspo：1–4 首音频卡片，支持播放、替换、移除；提供风格与参考权重。提示其作用是创作参考，避免承诺按比例复制。
3. 「改编」对应 uploadCover 或历史 coverSong：一个源音频＋目标风格；根据来源选择正确端点，对用户不暴露 API 名称。
4. 「续写」提供源音频播放器＋续写时间点；根据外部 URL 或已存在任务分别走 uploadExtend / extend。
5. 「加人声」「加伴奏」「片段创作」适合作为上传记录的后续操作，来源类型校验后才可用；可分后续迭代交付。
6. 高级选项由所选操作的合同决定。不能因为某控件在文字创作中存在，就在所有参考模式继续显示并提交。

## 已确认与仍待验证

已确认：以上是官方文档公开支持的参考、改编、续写、叠加创作接口；当前列出的公共版本是 V6 三种；inspo、uploadCover、uploadExtend 可直接用 URL，不需要先 uploadTask；addVocals/addInstrumental/sample 强制 uploadTask 来源。对应来源见各章节。

仍待验证：

- 本地文件的实际托管入口、大小/MIME/时长限制、公网可达性及保留期限；这是上传准备层，不影响已确认的模型参考能力。
- inspo 单条音频时长/大小上限和多参考混合效果；公开文档没有写出明确边界。
- 真实请求中 `audio_weight` 对听感影响，翻唱对原曲保留程度，续写输出是否包含原曲；不凭名称推断成品效果。
- inspo 已完成一次 V6 Mini 真实请求与文件下载，见下节。其余版本和参考端点的账户可用性、实际收费、耗时与输出结构仍待逐项实测。
- 旧版 Suno 是否仍兼容这些操作；当前页面只列 V6 系列，历史版本不能直接当作当前可选版本。

后续可用同一段自制/有权使用的音频继续验证 uploadCover、uploadExtend，并试听比较三种用途；本轮 inspo 成功只证明请求、异步完成和下载链路可用，不证明参考相似度或其他端点也已通过。


## 真实账户验证与本地文件接入缺口

2026-10-13，沿用用户在原任务中对当前环境 APIMart 计费测试的授权，用上一轮测试生成的 10 秒音频公网地址发起一次请求：

```json
{
  "model": "suno",
  "version": "v6-mini",
  "audio_urls": ["<上一轮自生成音频的公网直链>"],
  "tags": "instrumental, peaceful minimal piano, spacious ambient",
  "audio_weight": 0.7
}
```

这是实际参数的脱敏记录，不包含密钥。提交返回 HTTP 200，随后只查询同一个任务；没有因等待重复提交收费请求。结果依次经过 pending、processing、completed，最终进度 100。

| 实测项 | 结果 |
| --- | --- |
| 参考生成 | 成功，返回两首曲目 |
| 返回时长 | 148 秒、207.2 秒 |
| 第一首下载 | HTTP 200，audio/mpeg，3,334,809 字节 |
| 第二首下载 | HTTP 200，audio/mpeg，4,837,689 字节 |
| 实际收费 | credits_cost = 0.68；cost = 0.068 |

消费仅代表本次账户和请求，不作为固定价格写入产品。未对歌曲的主观相似度、纯音乐效果或其他版本作结论。本轮请求未经过实验室页面，因此不能宣称当前产品已实现参考音乐功能。

本机配置只核验相关键是否存在，未输出密钥：当前未配置 PUBLIC_MEDIA_BASE_URL / PUBLIC_BASE_URL。仓库虽有音频上传兼容辅助代码，但其尝试路径不代表已具备可用音频托管；上一轮对 APIMart `/v1/uploads/audios` 与 `/v1/uploads/files` 的请求均返回 404。不能用猜测接口代替上传合同。

本地音频选择仍可做成直接操作：浏览器选择/拖入文件 → 应用托管到供应商可读取的音频地址 → 调用 inspo。需要补齐托管机制、访问期限、文件大小/格式校验与清理边界。inspo / uploadCover / uploadExtend 均不需要为了获得任务 ID 再额外调用 uploadTask；只有要求导入任务来源的后续操作才需要它。不得把本机 localhost 或浏览器 blob 地址交给 APIMart。

优先实现建议是把「参考音乐」放回创作流程：支持本地选取 1–4 首、预听和移除、风格/歌词及整体参考权重；历史保留来源引用、操作类型、参数与结果。改编和续写采用各自端点的参数表。上述是下一步实施建议，尚未成为当前实现。


## 后续实现验收（2026-10-13）

已把 inspo 接入实验室：1–4 首本地选择/拖入、试听、移除，生成时通过既有临时托管服务转为公网 URL；用户无需手工填链接。原始参考保存在 Workspace Managed Media，随账号所属 Run 的历史提供试听和再次使用。新增实现与验证入口见[当前行为](../current/suno-music-lab.md)。

本地专门合成的 10 秒 440Hz 测试音经应用接口完成导入、Litterbox 托管、V6 Mini inspo、两首结果本地保存与下载；结果分别 228 秒和 231.8 秒，花费 0.68 Credits。历史参考可读取，参数和所有权边界由 API/浏览器回归覆盖。这里的测试音不含用户资料。
