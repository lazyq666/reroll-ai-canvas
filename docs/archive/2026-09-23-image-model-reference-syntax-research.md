# 图片模型多素材引用写法调研

调研日期：2026-09-23。范围：Google Nano Banana 系列、OpenAI GPT Image 2 与 GPT Image 2.5。先核对官方资料，再通过已配置的 Google Gemini API 和 APIMART 做小样本计费测试。

## 结论

1. **可共用「正文原位引用素材」的交互结构，但不宜把 `@图片1` 当作所有模型都支持的专用语法。** Google 与 OpenAI 官方示例都在提示词正文按输入顺序称呼「第一张图」「第二张图」或 `image 1`、`image 2`，并分别通过请求的图片列表传入真实素材。官方示例没有要求使用 `@图片N`。[Google 多图合成示例](https://ai.google.dev/gemini-api/docs/image-generation#advanced_composition_combining_multiple_images)；[OpenAI 多图提示示例](https://developers.openai.com/api/docs/guides/image-prompting#combine-references)。
2. **编号必须和请求中的图片顺序一致。** Google 的示例先传裙子图、再传模特图，提示词说「first image」的裙子和「second image」的模特；OpenAI 的多图编辑示例把图片依次放在 `image` 数组，提示词通过自然语言描述其用途。这种编号是模型读取请求内容时的语义指代，不是像 Imagen 3 `referenceId` 那样的 API 层显式绑定。[Google 请求示例](https://ai.google.dev/gemini-api/docs/image-generation#advanced_composition_combining_multiple_images)；[OpenAI 编辑请求示例](https://developers.openai.com/api/docs/guides/image-generation#edit-images)；[Google Imagen 3 的显式 `referenceId` 示例](https://cloud.google.com/vertex-ai/generative-ai/docs/image/subject-customization)。
3. **OpenAI 官方多图示例使用顺序指代并说明两图关系。** 示例把场景图作为 image 1、狗的照片作为 image 2，正文以「second image」「image 1」指定素材和位置；这说明自然语言编号是可采用的提示方式，不意味着 API 会解析 `@` 标记。[OpenAI 多图提示示例](https://developers.openai.com/api/docs/guides/image-prompting#combine-references)。

## 模型名称和输入方式

| 产品名 | 当前官方模型 ID | 多图输入和提示词示例 |
| --- | --- | --- |
| Nano Banana | `gemini-2.5-flash-image` | 输入含文字与图片；Google 的图片生成指南把多图合成描述为按「image 1 / image 2」引用。见 [模型页](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image) 和 [生成指南](https://ai.google.dev/gemini-api/docs/image-generation)。 |
| Nano Banana 2 / Pro | `gemini-3.1-flash-image` / `gemini-3-pro-image` | 官方 Interactions API 示例的 `input` 数组按顺序放两张 `type: "image"`，再放 `type: "text"`；文字写 `first image`、`second image`。见 [生成指南](https://ai.google.dev/gemini-api/docs/image-generation#advanced_composition_combining_multiple_images)。 |
| GPT Image 2 | `gpt-image-2` | 官方多图示例以 image 1 / image 2 指代输入图。见 [模型页](https://developers.openai.com/api/docs/models/gpt-image-2) 和 [提示词示例](https://developers.openai.com/api/docs/guides/image-prompting#combine-references)。 |
| GPT Image 2.5 | `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` | 官方 Image API 示例通过 `client.images.edit(image=[...], prompt=...)` 传多图；Responses API 示例通过多个 `input_image` 块传多图。提示词示例称 `image 1`、`second image`。见 [模型选择](https://developers.openai.com/api/docs/guides/image-prompting#choose-a-model)、[多图请求](https://developers.openai.com/api/docs/guides/image-generation#edit-images) 和 [提示词示例](https://developers.openai.com/api/docs/guides/image-prompting#combine-references)。 |

## 对 Composer 的建议

保留用户在句中插入素材的编辑体验，但让输出语法由目标提供商决定：

- Dreamina 全能参考：继续编译为已针对其 CLI 验证过的 `@图片1` 等写法。
- Google Nano Banana 与 OpenAI GPT Image：将图片 token 编译为 `图 1` / `Image 1` 一类自然语言索引，并可附简短角色描述；实际图片仍按相同顺序传入 API。例：`把图 2 的服装穿到图 1 的人物身上，保留图 1 的姿势与背景。`
- 不要自动把 `@图片1` 推广为通用格式。若想统一显示层写法，可以在编辑器中保留相同的素材 chip，只在提交前按提供商转换。

限制：官方示例说明这种写法可用，没有证明任意张数、任意提示词下的指代总是准确。具体提供商接入仍需核对项目使用的 API 或代理层图片排序，并用两张内容明显不同的测试图做端到端验证。

## 计费测试：两图顺序指代

2026-09-23 使用两张临时绘制的 768 × 768 PNG：图 1 是红屋顶、绿门的房子场景；图 2 是蓝黄两色雨伞。六次请求均按图 1、图 2 的顺序传入相同素材。正文要求保留图 1 场景，把图 2 主体放在右侧，避免角色交换。

| 模型与接口 | 仅正文原位指代 `图1` / `图2` | 现行「参考素材映射表＋用户需求」 | 目视结果 |
| --- | --- | --- | --- |
| Gemini `gemini-3.1-flash-image`，Google 原生 `generateContent` | 成功 | 成功 | 两次都保留房子，并把蓝黄雨伞放在右侧。 |
| `gpt-image-2`，APIMART `/v1/images/generations` | 成功 | 成功 | 两次都保留房子，并把蓝黄雨伞放在右侧。 |
| `gpt-image-2.5-flare`，APIMART `/v1/images/generations` | 成功 | 成功 | 两次都保留房子，并把蓝黄雨伞放在右侧。 |

原位版本的完整正文：`以图1的场景为底图，保留它的主要构图。把图2的主要物体自然地放在场景右侧。不要把图2的背景带入画面，也不要把图1和图2的角色交换。` 现行版本在这段文字前面添加 `参考素材：\n图1：image1-house.png\n图2：image2-umbrella.png\n\n用户需求：\n`。两个版本都单独发送了图片数据，没有依赖文件名让模型读取图片。APIMART 四次任务返回的 `credits_cost` 合计 0.59208；Google 两次调用的费用未从响应中读取。

该测试证明这两个格式在所选三条路径的一次双图任务中均可用，不能推出原位版本更准确，也不能证明其他代理、模型、图片数量或复杂场景会稳定对应。请求直接使用与项目适配器相同的图片数组/消息片段结构，没有通过 Smart Canvas UI 提交；UI 到 Provider 的完整链路仍需另验。
