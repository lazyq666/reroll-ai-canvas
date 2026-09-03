# Seedream 5.0 Pro 图层拆分与即梦 CLI 接入核验

> 核验日期：2026-09-04。只读查阅官方文档、本机 CLI help/version 和项目源码；未调用生成接口、未消耗生成积分、未升级 CLI、未修改生成功能。本文是调查记录，不是已批准的实现方案。

## 结论

Seedream 5.0 Pro 确实提供专用图层拆分模式，但**当前安装的 Dreamina CLI 公开命令，以及 Reroll 当前的即梦适配，不能原生调用该模式**。选择 `5.0Pro` 只选择模型，不等于开启图层拆分。官方 API 的能力不能直接推定为即梦 CLI 的能力。

## 官方能力与适用场景

字节官方发布说明展示了把一张完整海报拆为文字、主体、背景及装饰等独立透明层，并补全原本被主体遮挡的背景。由此适合成品海报重排、电商素材复用、插画元素提取与分层二次编辑；不意味着无损恢复原始 PSD，官方也指出细文字与像素级编辑一致性仍有改进空间。[官方发布说明](https://seed.bytedance.com/en/blog/beyond-generation-it-understands-design-introducing-seedream-5-0-pro)

火山方舟的图片生成 API 明确区分普通生成与图层拆分，后者要求 `layer_decomposition: true`，只支持 Seedream 5.0 Pro。当前文档对应模型为 `doubao-seedream-5-0-pro-260628`，调用地址为 `https://ark.cn-beijing.volces.com/api/v3/images/generations`。这不是即梦 CLI 命令或登录协议。[火山官方 API](https://docs.volcengine.com/docs/82379/1541523?lang=zh)

主要约束如下：

- 输入恰好一张 PNG/JPEG，可使用 URL 或 Base64；不超过 30 MB，宽高比在 1/16 至 16，总像素在 512×512 至 6000×6000 之间。这里是像素乘积约束，不是两边各自的长度约束。
- prompt 可省略，省略时自动识别主要元素；也可用描述指定拆分意图。
- 输出一张底图和最多 16 个透明 PNG 元素层，返回层序、名称、描述与边界框。
- 拆层分辨率档位为 auto、1K、1.5K、2K，不是普通图像生成的完整分辨率选项。
- 任一层失败，整个请求失败，不支持部分成功；超过层数上限的意图可能丢失部分层信息。
- `output_format` 仅控制底图格式，元素层始终是 PNG；接口不直接输出 PSD 或原生可编辑文字对象。
- 图层应按 `bounding_box.absolute` 缩放、定位，再按 `z_index` 叠放；下载 URL 会在生成后 24 小时内失效。

以上约束来自[火山官方参数与响应文档](https://docs.volcengine.com/docs/82379/1541523?lang=zh)。本轮网页正文提取器未成功读取该站点，但其公开 HTML 的 `window._ROUTER_DATA` → `loaderData['docs/(libid)/(docid$)/page'].curDoc.MDContent` 含完整文档；使用 JSON 解析读取，未执行网页脚本。

## 可确认的接入渠道

| 渠道 | 核验结果 |
| --- | --- |
| 火山方舟 HTTP API | 官方参数页明确支持，需对应 API 凭据和模型访问权限 |
| BytePlus ModelArk | 官方 API 同样有图层拆分参数；具体模型 ID、地域和账户条件应按该渠道文档确认 |
| ComfyUI 的 ByteDance 拆层节点 | 有现成专用 API 调用与图层重组代码，不走本项目的 dreamina CLI |
| fal Layerize | 服务商提供独立 Layerize 接口，使用该服务的账户、密钥与计费 |
| 本机 Dreamina CLI | help 中未开放图层拆分命令或参数，不能据支持 Pro 普通生图推断支持拆层 |
| 即梦网页/App | 本轮未核验具体拆层入口及账户开放范围；不能由模型发布或 API 可用反推每个产品入口均已开放 |

来源：[BytePlus API](https://docs.byteplus.com/en/docs/ModelArk/1541523)、[ComfyUI 源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api_nodes/nodes_bytedance.py)、[fal API](https://fal.ai/models/bytedance/seedream/v5/pro/layerize/api)。API 账户与权限需单独核验，不能假设即梦 CLI 的 OAuth 登录或会员额度可以直接复用。

## 本机 CLI 实证

依次执行了 `dreamina -h`、`dreamina image2image -h`、`dreamina text2image -h`、`dreamina query_result -h`、`dreamina version -h` 和 `dreamina version`。

- 本机版本报告为 `a857341-dirty`，commit `a857341`，build time `2026-07-31T16:28:32Z`。这是当前安装版本，不宣称是最新发布版本。
- 根帮助没有拆层子命令。
- 两个图片命令都支持 `5.0` 和 `5.0Pro`；图片参数为 prompt、参考图、session、比例、尺寸、模型、generate_num 与 poll，没有 `layer_decomposition`、透明背景、输出格式或任意 JSON 透传入口。
- `generate_num` 是普通生成图片数量，不能当作拆层数量。
- `query_result` 只提供 submit_id 与 download_dir。
- version 命令尝试初始化本地日志，被沙箱拒绝写入，但版本 JSON 正常返回。没有为此请求额外权限，也没有提交网络生成任务。

因此本轮结论是“当前公开 CLI 路径未开放”，不是断言模型内部不支持，也不是断言未来 CLI 永不支持。

## 当前项目实际接入

`generate_jimeng_provider_image` 只根据是否有参考图选择 `image2image` 或 `text2image`，传普通生成参数；没有专用拆层参数。模型规范化区分 `5.0Pro` 和 `5.0`，测试也明确验证两者区别。[CLI 实现](../../backend/infinite_canvas/providers/cli_impl.py)、[对应测试](../../tests/test_remote_generation_contracts.py)

结果处理递归收集媒体 URL，保留 raw 响应，但没有解释拆层 bbox/z-index 并组装分层文档的路径。项目能力资源将即梦 5.0/5.0Pro 标为普通生图能力，未声明透明 PNG 或多层输出能力。[能力资源](../../resources/image-model-capabilities.json)

现有 `generate_volcengine_provider_image` 也只组装 model、prompt、size、response_format 和 image。因此“设置里新增一个火山 Pro 模型”本身仍不足以启用拆层，还要修改请求能力及结果处理。[HTTP 实现](../../backend/infinite_canvas/providers/http_impl.py)

## 对项目的建议

普通生图继续保留即梦 CLI；把拆层作为独立图片处理能力，通过火山方舟/BytePlus 或已验证服务商的专用 API 接入，显式开启拆层模式，并保存 RGBA、层名、顺序和几何信息，再接入画布及 PSD 导出。这是建议，不是已完成的改动。

首轮真实测试需另获用户授权，并验证文字保真、遮挡补全、半透明边缘、重组误差、层数、延迟和成本。不要用“换成 Pro”或“在普通 prompt 中写拆层”替代专用接口验证。
