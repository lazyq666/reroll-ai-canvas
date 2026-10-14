# APIMart：参考音频生成纯音乐

- Status: Archived
- Current: [Suno 音乐实验室](../current/suno-music-lab.md)
- Tracking: [LAZ-85](https://linear.app/lazyq/issue/LAZ-85)

核查日期：2026-10-14（Asia/Shanghai）。只读取 APIMart 官方文档与模型价目，未发起收费调用，未改应用代码，也未触碰用户现有 `music.mp3` 草稿。

## 推荐结论

保留「纯音乐」选项。**单条参考音频＋纯音乐推荐使用 `POST /v1/music/generations/uploadCover`，显式传 `instrumental: true`。** 它直接接收一个公网 `audio_url`，不必先调用 uploadTask；本地文件可以复用现有托管步骤取得 URL。官方中英文页面都明确列出纯音乐参数。[英文 Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)、[中文 Upload Cover](https://docs.apimart.ai/cn/api-reference/audios/suno/upload-cover)

这条链路的创作语义是“根据参考音频改编”，应在 UI 和历史记录中如实说明。它不是原 inspo 的同名替代，不能不加说明地宣称两者输出效果相同。

## 五个候选接口比较

公共版本均为 `v6` / `v6-wild` / `v6-mini`，默认 V6；每个端点的字段仍须分别处理。下面路径均以 `/v1/music/generations` 为前缀。

| 接口 | 参考来源 | 纯音乐合同 | 结论与来源 |
| --- | --- | --- | --- |
| `/uploadCover` | 单个公网 `audio_url`；8 分钟边界见下方中英文差异 | 明确 `instrumental: true` | **首选**：单参考直接改编；[官方文档](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover) |
| `/coverSong` | `task_id`＋一基 `audio_index` | 未列 `instrumental` | 不作为明确纯音乐开关的依据；[官方文档](https://docs.apimart.ai/en/api-reference/audios/suno/cover-song) |
| `/inspo` | `audio_urls`，1–4 条公网音频 | 明确要求不发送 `instrumental` | 保留现有多参考能力，但不能承诺多参考的明确纯音乐控制；[官方文档](https://docs.apimart.ai/en/api-reference/audios/suno/inspo) |
| `/uploadExtend` | 单个公网 `audio_url`，源音频不足 8 分钟＋续写点 | 省略 `prompt` 时按器乐续写；禁止传 `instrumental` | 支持续写纯音乐，不等同重做整首且去掉原有人声；[官方文档](https://docs.apimart.ai/en/api-reference/audios/suno/upload-extend) |
| `/sample` | 必须是 uploadTask 来源＋采样起止点 | 明确 `instrumental: true` | 可行备选，但需要导入和区间选择，流程更长；[官方文档](https://docs.apimart.ai/en/api-reference/audios/suno/sample) |

多参考边界：目前核查的官方接口里，**没有同时明确支持“2–4 条参考音频”与 `instrumental=true` 的端点**。不能向 inspo 偷传该字段，不能只加入“no vocals”提示后把它描述为已受正式纯音乐参数控制，也不应默认只取首条音频。建议选中纯音乐后仍保存全部草稿和附件，提示此模式需指定一条参考；用户选定后再提交 uploadCover。现有单个 `music.mp3` 可以直接保留并复用。

时长的精确边界有翻译差异：英文 Upload Cover 写“under 8 minutes”，中文写“建议原音频不超过 8 分钟”。前者表达 `<480` 秒，后者是建议且表达 `≤480` 秒。收费前使用 `<480` 秒是合理的保守应用规则，但不能据此宣称“正好 480 秒一定被上游拒绝”已经证实；官方没有给容差、舍入规则或精确边界错误示例。[英文](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)、[中文](https://docs.apimart.ai/cn/api-reference/audios/suno/upload-cover)

## Upload Cover 的具体参数映射

以下约束来自 [Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)；主生成与操作接口名称差异也见 [Suno 总览](https://docs.apimart.ai/en/api-reference/audios/suno/overview)。

| 本地含义/已有字段 | Upload Cover 请求字段 | 处理规则 |
| --- | --- | --- |
| 上传后可访问地址 | `audio_url` | 单个 HTTP(S) 直链；不传本地路径、blob URL 或需登录链接 |
| 模型/版本 | `model: suno`、`version` | V6 三版本；不更改用户选择 |
| 纯音乐开关 | `instrumental: true` | 显式发送，不靠提示词代替 |
| 自定义模式 | `custom: true` | 使用风格/歌词类字段；纯音乐时歌词非必填，可省略 |
| 风格（原 `style`） | `tags` | 最多 1000 Unicode 字符；不得静默截断 |
| 创意度（原 `weirdness_constraint`） | `weirdness` | 0–1；零是有效值 |
| 参考影响程度 | `audio_weight` | 0–1；不能把 0.7 描述为“70% 相似度” |
| 风格权重 | `style_weight` | 0–1 |
| 目标时长（原 `duration`） | `duration_s` | 10–360 的整数，仅自定义模式；结果时长不保证精确 |
| 标题 | `title` | 最多 80 字符 |
| 负面风格 | `negative_tags` | 文档列出，未给专门长度上限 |
| 歌词 | `prompt` | 自定义歌词，最多 5000；纯音乐建议省略，保留本地草稿 |
| 灵感描述 | `gpt_description` | `custom=false` 时必填，最多 3000；不能当作歌词发送 |
| 歌词二次创作 | `auto_lyrics` | 该端点支持；纯音乐不需要，建议省略 |
| 人声性别 | `vocal_gender` | `Male` / `Female`；纯音乐建议省略，保留草稿选择 |
| 变化程度 | `variety` | `off` / `normal` / `high` / `extra` / `max` |
| Max | `max_mode` | 仅自定义模式；开启为两倍价格 |
| 输出格式 | `audio_format` | `mp3` / `m4a` / `wav` |

特别注意：如果现有输入框表达的是“歌曲描述”，可用 `custom=false`＋`gpt_description`，不要把它误传 `prompt` 当歌词。若为了保留高级权重及目标时长采用自定义模式，应明确让用户的创作描述落入风格字段，并执行 1000 字限制，不能无声丢失、截断或忽略 3000 字描述。两种有效请求示例如下，均为根据文档构造，尚未实测。

### 推荐：自定义风格＋纯音乐

```http
POST https://api.apimart.ai/v1/music/generations/uploadCover
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

```json
{
  "model": "suno",
  "version": "v6-mini",
  "audio_url": "https://example.com/hosted-reference.mp3",
  "custom": true,
  "instrumental": true,
  "tags": "Warm acoustic instrumental, soft piano, gentle strings",
  "title": "Morning Light",
  "audio_weight": 0.7,
  "style_weight": 0.6,
  "weirdness": 0.3,
  "duration_s": 60,
  "audio_format": "mp3"
}
```

这里故意不发歌词、`gpt_description`、人声性别、歌词改写开关。纯音乐自定义不需要为了满足必填而填假歌词。[Upload Cover 必填规则](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)

### 如果保留描述模式

```json
{
  "model": "suno",
  "version": "v6-mini",
  "audio_url": "https://example.com/hosted-reference.mp3",
  "custom": false,
  "instrumental": true,
  "gpt_description": "参考这段音乐，改编成适合阅读的温暖轻柔器乐曲",
  "audio_format": "mp3"
}
```

此模式不能附加仅自定义有效的 `duration_s`、Max；也不应同时把描述当歌词重复发送。[Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)

## 其他可行路线的准确边界

**Sample：**先用 `uploadTask` 导入一首，再提交 `/sample`，指定 `task_id`、`audio_index`、`start_s`、`end_s`、`custom:true`、`instrumental:true`、`tags`；纯音乐不必填写歌词。必须 `0 ≤ start_s < end_s ≤ 已知源时长`，两端点不自动提供默认值，没有目标时长字段。此接口文档没有 8 分钟限制，不能套用 uploadCover 的限制。[Sample](https://docs.apimart.ai/en/api-reference/audios/suno/sample)

**Upload Extend：**一个参考 URL，不足 8 分钟，必填 `continue_at`，满足 `1 ≤ continue_at < 源实际时长`；省略歌词表示器乐续写。不可发送 `custom`、`instrumental`、`gpt_description`。它改变的是续写部分，不承诺删除原音频的人声。[Upload Extend](https://docs.apimart.ai/en/api-reference/audios/suno/upload-extend)

**Cover Song：**只列任务引用，没有明确的纯音乐布尔字段；虽支持翻唱及风格转换，不应推断它与 uploadCover 全字段相同。对要明确纯音乐的历史曲目，可把可访问的实际音频 URL 作为 uploadCover 输入；这仍需遵守源时长和文件可访问要求。[Cover Song](https://docs.apimart.ai/en/api-reference/audios/suno/cover-song)、[Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)

## Run、下载与费用

Upload Cover 返回新的 `data[0].task_id`；提交响应结构为 `{code:200,data:[{status:"submitted",task_id:"..."}]}`。查询仍用 `GET /v1/music/tasks/{task_id}`；通用音乐结果在 `data.result.music[]`。因此可复用现有 Run 状态、历史、播放器和下载管线，同时保存 `upload_cover` 操作类型以及参考输入快照。[Upload Cover](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)、[任务总览](https://docs.apimart.ai/en/api-reference/audios/suno/overview)

下载接口明确允许已完成的 cover 等含可下载曲目的来源任务，使用源任务 ID、原始一基曲目序号和 `formats`；新下载任务结果仍是 `result.files[]`。不需要为纯音乐再做一种导出协议。重复准备下载会再次计费，缓存结果继续复用。[下载音频文件](https://docs.apimart.ai/en/api-reference/audios/suno/wav)

2026-10-14 当前模型页的普通价格档列出 `suno@upload_cover` 每次 0.5 Credits，Max 1 Credit；`suno@inspo` 普通档 0.68 Credits，`suno@download` 每次 0.016 Credits。页面同时有其他折扣档；真实费用以当前账户及任务返回 `credits_cost` / `cost` 为准，不能把普通档硬编码成该账户收费。Upload Cover 不要求预先创建 uploadTask，因此也不应为了复用现有界面额外提交一个收费导入任务。[模型价格](https://apimart.ai/zh/model/suno)、[Upload Cover 无需先导入](https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover)

## 实现与验证建议

- 保留纯音乐控件和用户已有单个音频草稿；切换模式只改变提交字段，不销毁附件或歌词等草稿。
- 单参考且纯音乐开：走 uploadCover；非纯音乐多参考仍可维持 inspo。具体路由在历史中可追溯，界面提示“参考改编”。
- 多参考且纯音乐开：明确提示需要指定一条；不能自动删掉其余文件，也不能假装传给支持多条的接口。
- 发送前可保守校验 source 时长不足 480 秒，并将此标为应用校验规则；音频 URL 须可公开访问，读取失败给出可恢复错误。没有文档化的字节数/编码限制不要捏造为供应商规则。
- 合同测试应验证 `instrumental:true`、准确 endpoint、`audio_url` 单值、字段重命名、纯音乐不要求 prompt、零权重、Max/时长模式限制、多参考不静默丢弃。
- 后续由主任务进行一次授权真实测试：用已有合法参考音频，完成 uploadCover → 查询 → 播放试听 → 导出，记录参数、真实费用与输出。只有完成这一步才可称整条链路实测通过。

未确认：模型实际保持原旋律程度、能否完全避免哼唱/人声残留、单次输出时长精度、旧版版本兼容、本地托管层具体限制。`instrumental=true` 是正式请求语义，不是对所有生成成品的绝对听感保证。

## 落地验收（2026-10-14）

已接入 `POST /api/music/covers` → uploadCover。真实测试使用合成参考音频，V6 Mini 生成两首 19.96 秒 MP3，WAV 导出与重复导出复用通过，合计 0.516 Credits。前文“尚未实测”描述的是调研阶段；当前参数和界面合同以 Current 为准。
