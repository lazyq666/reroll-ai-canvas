# 最新 Dreamina CLI 与 APIMart 拆层能力核验

核验日期：2026-09-04。范围：官方公开分发包、API 文档与当前项目适配；未读取凭据、提交生成任务或产生 API 费用。

## 结论

- **最新公开分发的 Dreamina CLI 仍未提供原生拆层入口**；本次检查了官方当前下载包，不是仅检查本机旧版。
- **APIMart 已明确支持 `seedream-5-0-pro` 的 `layer_decomposition: true`**，公开请求参数和分层响应均有说明；但当前项目尚未接入该能力。

## 最新官方 Dreamina CLI

[官方安装脚本](https://jimeng.jianying.com/cli) 指向的 [版本清单](https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/version.json) 在核验时返回 `1.4.17`，发布日期为 `2026-08-18`。按脚本下载地址取得当下 `darwin_arm64` 包，仅放入临时目录检查，没有运行安装器或替换本机 CLI。

| 核验项 | 结果 |
| --- | --- |
| 二进制版本 / commit | `673dd28-dirty` / `673dd28` |
| 构建时间 | `2026-08-17T16:06:28Z` |
| SHA-256 | `a9dadf84a3708493cb64e15ec3bcaa714604b62e2e917e8114b7236e5809cdeb` |
| 根命令、`image2image`、`text2image` help | 无拆层子命令、`layer_decomposition` 参数或任意 JSON 透传入口 |
| `5.0Pro` 分辨率 | `1.5k` / `2k` / `4k`，与之前本机包不同，确认本次核验了另一分发版本 |

因此，通过这份最新公开 CLI 的已声明参数，不能直接调用图层拆分。普通多图数量、提示词或模型名不能代替专用参数；这不等于即梦所有产品界面或未公开内部接口均不支持。

## APIMart：官方 API 明确支持

[Seedream 5.0 Pro 参数文档](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation) 声明在普通 `POST /v1/images/generations` 接口启用拆层，模型 ID 为 `seedream-5-0-pro`，另支持别名 `seedream-5.0-pro`；不是独立 `layerize` 路由。最小请求形状如下，仅展示，未实际发送：

```json
{
  "model": "seedream-5-0-pro",
  "image_urls": ["https://your-cdn.example/input.png"],
  "layer_decomposition": true,
  "size": "2K"
}
```

- 拆层要求单张 PNG/JPEG，≤ 30 MB，总像素 262,144–36,000,000；`size` 仅 `1K` / `1.5K` / `2K` / `auto`。不能套用普通生成的 4K 或多参考图宣传。
- `prompt` 可省略以自动识别，也可用 `<bbox>left top right bottom</bbox>` 指定区域，坐标归一化到 0–1000。
- 输出为底图及最多 16 个透明 PNG 层；`output_format` 只控制底图。`n` 固定为 1，不是图层数。
- 轮询结果 `result.images[0]` 的 `url`、`sizes`、`output_formats`、`layers` 按索引对应，首项为底图；图层元数据包含 `z_index`、名称及 `bounding_box.absolute/normalized`。按层级和坐标重组后才能自行导出 PSD，API 未声明直接返回 PSD。
- 拆层先按 17 张输出预授权，完成后按实际底图与图层结算并退回差额，需要足够预授权余额。[参数、输出与计费依据](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation)

文档边界：模型页轮询样例使用 `success` 和根对象，而[通用任务状态文档](https://docs.apimart.ai/en/api-reference/tasks/status) 使用 `completed` 与 `data` 包装，存在不一致，实装时应核对真实响应并保留兼容解析。本次未验证具体账号权限或实际生成质量。

检索入口为[官方文档索引](https://docs.apimart.ai/llms.txt)及其 API manual；索引指向的 `openapi.json` 当前却是 Plant Store 示例，不能作为业务接口证据。上述结论依据实际模型参数页及其机器可读 Markdown，而非营销博客。

## 当前项目还缺什么

`http_impl.py` 的 APIMart 分支（核验时约 2639 行）仅提交普通生成参数，未传 `layer_decomposition`，也未专门解析分层数组。因此 APIMart 是可新增的拆层接入渠道，**不是仅在设置中换模型即可使用**；仍需实现专用请求、图层结果解析、画布摆放及可选 PSD 导出。
