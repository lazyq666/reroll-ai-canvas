# LAZ-139：APIMART 已选模型官方参数审计

核对日期：2026-11-13，Asia/Shanghai。性质：Chrome 验收的研究补充，不是参数发布或真实生成验收。

网页按原厂与 APIMART 分别核对。本文记录证据与差异，不代表已把这些参数发布到运行中的服务。部分 APIMART Markdown 页无法通过网页工具打开，使用只读 HTTPS GET 获取同一官方 URL 正文。

## 1. 结论与证据边界

- **明确超出 APIMART 文档**：Banana Pro 的参考图 20／输出 4，应对照 14／1；Banana2 的 20／8，应对照 14／1；四个 GPT Image 型号的参考图 20，应对照 16。[A1][A2][A4][A5][L]
- **保守限制，不等于请求会失败**：GPT Image 2.6 当前普通出图上限 1，服务文档允许 4；Seedream 普通参考图上限 1，文档允许 10。是否扩展仍取决于产品合同与运行实现。[A5][A6][L]
- **仍未知**：Banana2.1 的 APIMART 平台不设固定参考张数，但原厂推荐/支持至 14；不能把本地 20 标为已确认，也不能声称 APIMART 必定拒绝第 15 张。Midjourney Imagine 文档未给参考图硬上限，不能从 Blend 的上限反推。[A3][G3][A7][A8]
- **自动填参不是全字段确认**：本地多个记录的扩展 schema 只声明 `image_urls` 是数组、`n` 默认 1、`quality` 是字符串，没有相应 `maxItems`、`maximum`、`enum`。旧值被保留与 LAZ-139 的缺失值保留约定一致；不能因记录带 `auto_fill` 就把所有旧值重新认定为官方能力。[A0][L][R1]
- **分层已有独立操作**：Seedream 的已发布 `image.layer_decomposition` 为 supported；Banana2 和两个 GPT 2.6 的同名记录为 unknown。存在记录不等于支持，分层的 1 份结果也不等于只产出 1 张图。[A6][V1][L]

下文“未声明”表示所读资料未提供可直接调用的字段或精确限制，不等同于原厂明确不支持。表内 APIMART 值描述对应精确 ID 的接口；原厂同名、同系列或别名不能替代供应商合同。`flare/sunburst` 确实也存在于 OpenAI 官方目录，但这不证明 APIMART 的端点、数量、流式输出、格式规则与原厂完全一致。[O0][A4][A5]

## 2. 图片模型：APIMART 请求合同

“参考图”指带图编辑/参考生成，不要求纯文生图操作接收图片。原厂与 APIMART 的自动画幅，也不等于本项目“跟随唯一参考图并物化裁切”的自动画幅。[R2]

| 精确 Model ID | 普通输出数量 / 参考图限制 | 分辨率 / 比例 | quality / 输出 / 透明 / 分层 | 来源 |
| --- | --- | --- | --- | --- |
| `gemini-3-pro-image-preview` | `n=1`；参考 ≤14，单图 ≤30MB | `1K,2K,4K`；G10 + `auto` | 未声明 quality、可选输出格式、透明背景、分层参数 | [A1] |
| `gemini-3.1-flash-image-preview` | `n=1`；参考 ≤14，单图 ≤10MB | `0.5K,1K,2K,4K`；G14 + `auto` | 未声明上述四类参数；有 `google_search`、`google_image_search`，不是通用 prompt enhancement | [A2] |
| `gemini-nano-banana-2.1` | `n=1..4`；平台无固定参考图张数，单图 ≤20MB，上游仍有限制 | `1K,2K,4K`；G14 + `auto`；`0.5K/512` 明确拒绝 | 未声明 quality、可选输出格式、透明背景、分层；不能借用 `-ext` 的 `n=1` | [A3] |
| `gpt-image-2.5-flare` | `n=1..4`；参考 ≤16，只接收公开 HTTP(S) 图片 URL | `1k,2k,4k`；P15 + `auto` 或受约束像素尺寸 | Q6；`png,jpeg,webp`；透明仅 PNG/WebP；未声明分层 | [A4] |
| `gpt-image-2.5-sunburst` | `n=1..4`；参考 ≤16，只接收公开 HTTP(S) 图片 URL | `1k,2k,4k`；P15 + `auto` 或受约束像素尺寸 | Q6；`png,jpeg,webp`；透明仅 PNG/WebP；未声明分层 | [A4] |
| `gpt-image-2.6-flare` | 静态/GIF `n=1..4`，SVG `n=1`；参考 ≤16，URL/Data URL | `1k,2k,4k`；静态/SVG 为 P15 + `auto` 或像素；GIF 独立规则 | Q6；`png,jpeg,webp,gif,svg`；透明有格式/模式条件；未声明分层 | [A5] |
| `gpt-image-2.6-sunburst` | 静态/GIF `n=1..4`，SVG `n=1`；参考 ≤16，URL/Data URL | 同上 | 同上；`complexity=low,medium,high` 是规划量，不是 quality | [A5] |
| `midjourney` | Imagine 是四图网格工作流；没有普通 `n=1..4` 合同；Imagine 参考图最大值未声明；Blend 为 2..4、每图 ≤12MiB | `size` 映射 `--ar`；无统一 `1K/2K/4K` resolution 枚举；`hd` 依版本 | 结构化 quality 为字符串 `0.25,0.5,1,2`，须再核版本；未声明透明、输出格式选择、分层 | [A7][A8][A9][M1] |
| `seedream-5-0-pro` | 普通 `n=1`；参考 ≤10、每图 ≤30MB；分层恰好 1 张输入 | `1K,1.5K,2K`；S10 + `auto` 或像素；分层另有规则 | 无通用 quality；`jpeg,png`；条件透明；支持分层；提示词优化只声明 `standard` | [A6] |

以上限制是文档合同，不是本次实际提交结果。

| 枚举 / 尺寸规则 | 完整取值或限制 | 来源 |
| --- | --- | --- |
| G10 | `1:1,2:3,3:2,3:4,4:3,4:5,5:4,9:16,16:9,21:9` | [A1][G0] |
| G14 | G10 加 `1:4,4:1,1:8,8:1`；14 个固定比例，`auto` 不计入 | [A2][A3][G0] |
| P15 | `1:1,3:2,2:3,4:3,3:4,5:4,4:5,16:9,9:16,2:1,1:2,21:9,9:21,3:1,1:3` | [A4][A5] |
| S10 | `1:1,4:3,3:4,16:9,9:16,3:2,2:3,2:1,1:2,21:9` | [A6] |
| Q6 | `auto,low,medium,high,xhigh,max`；`auto` 是选择方式，不是固定的实际画质 | [A4][A5][O1] |
| GPT 静态/SVG 像素 | 宽高均为 16 的倍数；边长 ≤3840；长短边比 ≤3；总像素 655,360..8,294,400。APIMART `4k + 1:1` 为 2880×2880，不是 4096×4096；精确像素时忽略 resolution | [A4][A5][O1] |
| Seedream 普通像素 | 总像素 921,600..4,624,220；宽高比 1/16..16；精确 `size` 优先于 resolution。可调用自定义像素不代表项目应开放该控件 | [A6][V1][R2] |

## 3. 原厂与 APIMART 的关键差异

| 对象 | 原厂证据 | APIMART 差异 / 不能推导的内容 | 来源 |
| --- | --- | --- | --- |
| Banana Pro / Banana2 | 当前 Google 页面使用 `gemini-3-pro-image`、`gemini-3.1-flash-image`；均至 14 参考图，分别 G10/G14，后者有 512px 档。原厂提醒未必严格遵守提示词要求的出图张数 | APIMART 所选 `-preview` 是 standard/Ext 路径，另有 `-preview-official`；两者不能按名称直接合并。所选接口明确 `n=1`，原厂页面不能替它扩到 4/8 | [G0][G1][G2][A1][A2] |
| Banana2.1 | Google 明确最多 14 参考图，1K/2K/4K，无 0.5K | APIMART 不设平台固定张数，不代表模型无限输入；该 ID 是官方版，`-ext` 为另一 ID，数量和总文件大小限制不同 | [G3][A3] |
| GPT 2.5 / 2.6 数量与传输 | OpenAI Image generate/edit API schema 为 `n=1..10`，编辑至 16 输入图；原厂返回 Base64 | APIMART 普通输出上限 4，返回异步 task + CDN URL；2.5 参考图仅 HTTP(S)，2.6 增加 Data URL。不从原厂 `10` 覆盖 APIMART 的 `4` | [O2][O3][A4][A5] |
| GPT 2.6 GIF | 本次读取的 OpenAI guide 和 API reference 均写 2..16 帧 | APIMART 也是 2..16，却仍有“上游 64 帧”的比较句；这句与当前原厂不一致，不能形成“原厂 64 / 渠道 16”的确定结论 | [O1][O2][O3][A5] |
| GPT 2.6 SVG | OpenAI guide 说 edit endpoint 不支持 SVG；API reference 的 edit 格式定义又含 SVG 并要求项目权限，存在文档口径差异 | APIMART 明确 generation 入口支持带参考图的 SVG；`n=1`、必须 `svg.model`。不要据旧文本生 SVG 约定自动清空参考图，也不要未经验收直接扩展项目功能 | [O1][O3][A5][R3] |
| Seedream 5.0 Pro | 原厂精确 ID 为 `doubao-seedream-5-0-pro-260628`；普通单图、至 10 参考图；分层 1 底图 + 至16层。优化模式 `standard,fast` | APIMART `seedream-5-0-pro` 增加 resolution 与固定比例映射；仅 `standard`，不能自动填 `fast`。`response_format` 在 APIMART 此页是 output_format 的兼容别名，不能套原厂 URL/Base64 含义 | [V1][V2][A6] |
| Midjourney | 原厂版本决定参数：V7 quality 为 `1,2,4`；V8.1/8.2 有 SD/HD；版本表最大比例 14:1，HD 为 4:1 | APIMART Imagine quality 表列 `0.25,0.5,1,2`，不足以证明所选版本接受每一项；没有统一模型 `quality=high` 或通用 4K 字段。先明确 version/action，不能填枚举并集 | [M1][M2][M3][A7] |

原厂没有给出上述 Google 模型在此接口语境下可直接映射的固定 `n` 上限；保留未知，不把提示词、多候选、异步 Batch 请求数当成单请求出图数量。Google 示例返回图片/PNG 不等于 APIMART 声明可选择 `output_format=png,jpeg,webp`。[G0][A1][A2][A3]

## 4. 条件能力：透明、分层、GIF、SVG

| 能力 | 应保留的条件；不能压扁为全局布尔值 | 来源 |
| --- | --- | --- |
| Seedream 透明 | 普通透明编辑需恰好 1 张**已有 Alpha**的输入，并选 PNG；不支持从纯文本直接承诺透明。不能借用 Seedream 5.5 的原生 RGBA 能力 | [A6][V1] |
| Seedream 分层 | `layer_decomposition=true`；恰好 1 张 PNG/JPEG，≤30MB、262,144..36,000,000 像素；size 仅 `auto,1K,1.5K,2K`，默认 auto。返回 1 底图 + 至16透明 PNG 层；output_format 仅控制底图。层有坐标和 z_index，普通 n 仍为1 | [A6][V1][V2] |
| GPT 透明/格式 | 静态 Alpha 只用 PNG/WebP，JPEG 无 Alpha；压缩 0..100 只适用 JPEG/WebP。SVG 文生默认透明；APIMART 参考图 SVG 默认 opaque，需显式 transparent | [A4][A5][O1] |
| GPT GIF | APIMART 默认 9 帧、200ms、512×512/帧；2..16 帧，时长至少20ms、10ms步进；n 为动画份数。帧与拼帧总面积受共同约束；不能照搬静态分辨率菜单；不接受 mask/markup/compression | [A5] |
| GPT SVG / markup | APIMART SVG 需指定 author model，至16参考图，n=1；无 mask/markup/compression。markup 是输入标注覆层，不是输出图层拆分；quality、complexity、author reasoning 是三个独立参数 | [A5][O1][O3] |
| 通用提示词增强 | Google Search grounding、Seedream standard 优化、GPT Responses 自动改写并非同一开关；GPT 2.6 APIMART 明确不接受 `prompt_rewriter`。不能只按字段名称相似自动映射 | [A2][A5][A6][O5] |

Seedream 的纯 Markdown `**layer\_decomposition**` 字段与旧 ParamField 表达相同；本研究未改解析器，不重复正在进行的格式修复。

## 5. 两个文本模型

| Model ID | 原厂能力与明确限制 | APIMART 可确认 / 待确认 | 本地已发布记录的解释 | 来源 |
| --- | --- | --- | --- | --- |
| `gemini-3.7-flash` | 输入文字/图像/视频/音频/PDF，输出文字；输入 1,048,576 tokens、输出65,536；thinking `low,medium,high`，不支持 minimal；有函数调用、结构化输出、Search/Maps grounding、代码执行等；无原生生图。Google 已标 deprecated，原厂请求路由到3.8 | 原生 Gemini 协议页确认多模态字段，通用 Chat 页不能证明这个精确 ID 的全部工具与限额；APIMART 是否也路由3.8未知 | 本地图片8、视频3且每项6帧、音频/PDF为0，reasoning枚举空、工具/结构化输出隐藏；这是产品限制或待接入，不能当原厂最大值，也不能因支持视频就认定当前走原生视频 | [G4][A11][A12][L] |
| `gpt-5.5` | 文字/图片输入、文字输出；上下文1,050,000、最大输出128,000；effort `none,low,medium,high,xhigh`，默认medium；支持 streaming、函数调用、结构化输出。可通过 Responses 调用 image_generation 工具，不是模型本身直接输出图片 | APIMART Responses 文档提供图像输入与工具入口，但不构成该 ID 每个工具、采样参数、上下文额度的专属保证；SVG 文档有它作为 author 的例子 | 同样图片8、视频3×6帧不能写成原厂原生视频能力。隐藏 temperature/top_p 无法证明可在所有 reasoning 档位使用；不得填 max/minimal | [O4][O5][A10][A5][L] |

APIMART 元数据文档明确：chat/audio 暂无 `parameters` 合同，只有分类与能力标签。两个文本模型的具体输入张数、APIMART 上下文/输出上限、reasoning 映射和工具权限仍应未知；原厂值只能作研究依据，不能冒充本账户供应商确认值。[A0]

## 6. 与本次 Chrome / 已发布值逐项对照

L 为只读 published 记录；U 为用户本次提供的 Chrome 观察。本次未操作 Chrome，也未重做浏览器验收。读取时没有写回状态。表中的本地“参考/输出”主要引用 `media_contract.image_input_maximum/output_count_maximum`；`image.generate.inputs.image.maximum` 多为0，表示纯文生图操作边界，不能将0与带图编辑的14/16直接比较。[L][U]

| 模型 | 本地参考/输出上限 | 判定与后续验收重点 | 来源 |
| --- | --- | --- | --- |
| Banana Pro | 20 / 4 | 文档14 / 1，明确超限；本地7比例比G10少 `4:5,5:4,21:9`。本次匹配到 generate，未见独立 edit 记录，需另核操作发布覆盖 | [L][A1] |
| Banana2 | 20 / 8 | generate 的媒体摘要及 edit 都保留20/8；文档14/1，明确冲突。0.5K/1K/2K/4K与14比例匹配 | [L][A2][G0] |
| Banana2.1 | 20 / 4 | 输出4匹配；参考20未经确认，不是已证实 APIMART 拒绝值。当前7比例缺G14其余7项；1K/2K/4K匹配 | [L][A3][G3] |
| GPT2.5 Flare | 20 / 4 | 参考超出16；输出4匹配。7比例、空formats、透明false、四档隐藏quality，均不足以完整表达文档支持 | [L][A4] |
| GPT2.5 Sunburst | 20 / 4 | 同上，不能因与Flare同系列就省略此精确ID的发布验收 | [L][A4] |
| GPT2.6 Flare | 20 / 1 | 参考超出16；静态上限1较文档4保守，但SVG的1正确。7比例、空formats、四档隐藏quality不足；透明true需格式条件 | [L][A5] |
| GPT2.6 Sunburst | 20 / 1 | 同上；本次已有六档quality，但仍 visible/editable=false，不能归入“所有型号都只有四档” | [L][A5] |
| Midjourney | 20 / 4 | 20未知；4可能表示网格分图，不能当 `n`。1K/2K/4K与auto/low/medium/high不属于该接口确认枚举；隐藏质量项也不能算创作控件已启用 | [L][A7][M1][M2] |
| Seedream5 Pro | 1 / 1 | 普通参考限制较文档10保守；普通输出1正确。generate透明true与edit透明false不能表达“已有Alpha单图编辑”的条件；ratios/formats空、custom=false为覆盖缺口，不能宣称供应商不支持。独立分层已supported | [L][A6][V1] |

### Banana2 Chrome 观察的明确判定

| Chrome 观察 | 判定 | 来源 |
| --- | --- | --- |
| 参考图最大20 | 与APIMART及Google的14冲突；本地edit也为20，未获新schema上限确认 | [U][L][A2][G0] |
| 输出最大8 | 与APIMART `n=1`冲突；若产品用8次独立请求实现，应单独标为产品批量能力，本次未验证 | [U][L][A2] |
| auto/low/medium/high全部选中 | APIMART未声明该quality枚举；published为隐藏、不可编辑，因此是配置残留/覆盖待核，不能断言用户正在提交四种质量 | [U][L][A2] |
| `.5K/1K/2K/4K` | 档位含义匹配；实际请求值必须是文档 `0.5K`，不能提交显示缩写 `.5K` | [U][A2] |
| 14比例 | 数量匹配；本次published完整集合等于G14，未混入9:21 | [U][L][A2] |
| 无透明/自定义尺寸/提示词增强/分层 | 不应凭其他模型补开。该接口没有相应明确参数；Search enhancement不能直接替代提示词增强；分层记录unknown不等于supported | [U][L][A2] |

### 已存 schema 为什么不能证明20/8

本次读取的相关 `media_contract.model_parameters.input_schema.properties`：大部分图片模型 `image_urls` 没有 `maxItems`，`n` 有 `default:1` 却没有 `maximum`，`quality` 没有 `enum`；Seedream 的 `resolution` 有明确 `["1K","1.5K","2K"]`。Banana2 的旧 edit 记录没有这一扩展schema/auto_fill，但仍保留20/8。上述是本次读取结果；未读取 backups/evidence/drafts 来推断历史来源。[L]

所以可确认“字段未被本次schema证明”，但仅凭当前快照无法精确追溯哪次人工设置或哪条默认代码产生旧值。实现中的缺失字段保留逻辑解释了为什么它们没有被本次刷新覆盖，不能替代独立历史审计。[R1][L]

## 7. 不可安全自动填入的字段

1. 缺 `maximum/maxItems/enum` 的数字与字符串，不用全局默认补成“已确认”；`default:1` 不是 `maximum:1`，`type:string` 也不是四档quality支持声明。[A0][L]
2. 原厂枚举不跨到 APIMART：OpenAI `n=10`、Seedream `fast`、Google thinking/grounding、Midjourney不同version的quality，都需对应渠道与操作证据。[O2][V1][G4][M1][A5][A6][A7]
3. 无条件透明布尔值不足以描述Seedream；普通count不足以描述分层、GIF份数和SVG；不能因2.6 SVG需1就把静态输出也锁1。[A5][A6]
4. 未声明不是false；保留原值可以符合迁移约定，但应与“本次来源确认”分开。格式为空、quality隐藏、unknown分层记录，均不能单靠存在/缺失判为支持/不支持。[R1][L]
5. 原厂自定义尺寸支持不自动推翻项目禁止任意尺寸的产品约定；需要区分Provider capability与产品是否开放控件。[R2][A4][A6]
6. 局部文档不一致先保留疑点：APIMART关于上游64帧的句子；OpenAI SVG edit guide/schema口径；Midjourney quality与版本表。此次未通过付费生成消除这些疑点。[A5][O1][O2][O3][M1][A7]

建议下一步验收顺序：先确认Banana Pro/2的数量超限及GPT参考超限；再检查Seedream透明的操作条件；最后评估保守限制扩展。本文只提供证据，不执行自动修正，不宣称LAZ-139整体通过。

## 来源

所有网络来源均于2026-11-13读取；引用的是正文而非搜索结果摘要。索引只用于发现页面，不作为单模型上限证据。未调用带用户凭据的模型接口。

- [A0] [APIMART 模型扩展schema](https://docs.apimart.ai/en/api-reference/texts/models/list.md)；[入口索引](https://docs.apimart.ai/llms.txt)、[API manual索引](https://docs.apimart.ai/_llms/en/api-manual.txt)。
- [A1] [APIMART Banana Pro](https://docs.apimart.ai/en/api-reference/images/gemini-3-pro/generation.md)。
- [A2] [APIMART Banana2](https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation.md)。
- [A3] [APIMART Banana2.1](https://docs.apimart.ai/en/api-reference/images/gemini-nano-banana-2.1/generation.md)。
- [A4] [APIMART GPT Image2.5](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation.md)。
- [A5] [APIMART GPT Image2.6](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6/generation.md)。
- [A6] [APIMART Seedream5 Pro](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md)。
- [A7] [APIMART Midjourney Imagine](https://docs.apimart.ai/en/api-reference/images/midjourney/imagine.md)。
- [A8] [APIMART Midjourney Blend](https://docs.apimart.ai/en/api-reference/images/midjourney/blend.md)。
- [A9] [APIMART Midjourney 总览](https://docs.apimart.ai/en/api-reference/images/midjourney/generation.md)。
- [A10] [APIMART Responses](https://docs.apimart.ai/en/api-reference/texts/openai/responses.md)。
- [A11] [APIMART Gemini native](https://docs.apimart.ai/en/api-reference/texts/gemini/quickstart.md)。
- [A12] [APIMART Chat Completions](https://docs.apimart.ai/en/api-reference/texts/general/chat-completions.md)。
- [G0] [Google 图片生成](https://aistudio.google.com/docs/image-generation)。
- [G1] [Google Gemini3 Pro Image](https://aistudio.google.com/docs/models/gemini-3-pro-image)。
- [G2] [Google Gemini3.1 Flash Image](https://aistudio.google.com/docs/models/gemini-3.1-flash-image)。
- [G3] [Google Nano Banana2.1](https://aistudio.google.com/docs/models/gemini-nano-banana-2.1)。
- [G4] [Google Gemini3.7 Flash](https://aistudio.google.com/docs/models/gemini-3.7-flash)。
- [O0] [OpenAI 模型目录](https://developers.openai.com/api/docs/models)。
- [O1] [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)。
- [O2] [OpenAI Generate API](https://developers.openai.com/api/reference/resources/images/methods/generate)。
- [O3] [OpenAI Edit API](https://developers.openai.com/api/reference/resources/images/methods/edit)。
- [O4] [OpenAI GPT5.5](https://developers.openai.com/api/docs/models/gpt-5.5)。
- [O5] [OpenAI Responses image generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation)。
- [V1] [火山引擎图片生成API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)。
- [V2] [火山引擎Seedream5.0 Pro/Flash](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh)。
- [M1] [Midjourney Quality](https://docs.midjourney.com/hc/en-us/articles/32176522101773-Quality)。
- [M2] [Midjourney Version](https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version)。
- [M3] [Midjourney Aspect Ratio](https://docs.midjourney.com/hc/en-us/articles/31894244298125-Aspect-Ratio)。
- [L] 用户授权的 `model-capability-workbench.json` 中 `published.capabilities`，仅匹配 `provider_id=apimart` 与本文11个ID；报告只摘录能力字段，不复制身份、密钥或其他模型数据。状态可能随并行验收继续变化。
- [U] 本次实际 Chrome 会话中观察到的详情表单；旧值保留行为另由当前实现核对。
- [R1] [LAZ-139已确认行为与缺失值保留](2026-11-13-laz-139-model-selection.md)。
- [R2] [当前图片能力与产品画幅合同](../current/smart-canvas-image-output-capabilities.md)。
- [R3] [LAZ-135 GIF/SVG实施规格](2026-11-05-apimart-gpt-image-2-6-gif-svg-plan.md)。本文发现的供应商文档变化不自动改变其实施/验收状态。
