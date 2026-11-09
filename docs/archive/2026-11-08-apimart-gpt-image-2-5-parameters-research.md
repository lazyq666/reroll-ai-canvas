# APIMart GPT Image 2.5：质量与思考参数核对

核对日期：2026-11-08（Asia/Shanghai）。本文是公开资料与本地代码的调研归档，不是已交付的产品合同；没有执行真实生成或修改产品代码。

## 官方参数

APIMart 的 GPT Image 2.5 正式图像接口公开了 `quality`，没有列出独立的 `reasoning_effort`、`reasoning` 或 `thinking`。这只能确认公开合同，不证明服务端必然拒绝未公开字段，也不能把质量档位解释成内部推理等级。[正式文档][api]

| 模型 | 质量参数 | 默认值 | 独立思考／推理参数 |
| --- | --- | --- | --- |
| `gpt-image-2.5-flare` | `quality`: `auto`、`low`、`medium`、`high`、`xhigh`、`max` | `auto` | 正式参数表未公开 |
| `gpt-image-2.5-sunburst` | 同上 | `auto` | 正式参数表未公开 |
| `gpt-image-2.5-ext` | 正式参数表未公开 `quality` | 未确认 | 正式参数表未公开 |

前两个型号依据[GPT Image 2.5 文档][api]；Ext 依据[独立 Ext 文档][ext]。Ext 使用 `model=gpt-image-2.5-ext` 与 `version=flare|sunburst`，版本默认 `flare`，不能直接套用前两个型号的质量合同。

上述结论适用于 `POST /v1/images/generations`。[普通版][api]与[Ext][ext]均使用这个提交端点。

[官方模型页][model]表单显示 `Quality medium`，而[正式 API 参数表][api]声明默认 `auto`。网页初始选择不等于省略请求字段后的默认行为。

## 当前代码

以下位置是本次工作区的代码快照，行号可能随开发变化。

| 位置 | 已核对行为 |
| --- | --- |
| `static/js/smart-canvas.js:3598`、`:3968` | 普通 API 图片 Composer 调用尺寸选择组件，默认包含质量设置；质量入口位于画幅与分辨率弹层 |
| `static/js/infinite-canvas-ui/generation-settings-picker.js:11`、`:440` | 质量枚举与布局固定为四档：`auto`、`low`、`medium`、`high` |
| `backend/infinite_canvas/model_capabilities.py:816` | 图片基础能力合同同样只有四档；最终合同还可能叠加已发布能力，本行不能代表所有实例配置 |
| `static/js/smart-canvas/generation-provider.js:379`、`:406` | 前端校验并向本地图片任务 API 提交 `quality` |
| `backend/infinite_canvas/providers/http_impl.py:2724` | APIMart 通用图片分支构造上游请求体时遗漏 `quality`；该分支最终提交的是尺寸、分辨率、数量、参考图等字段 |
| `backend/main.py:3903` | `OnlineImageRequest` 有 `quality`，没有独立的思考或推理等级字段 |

因此当前有两个明确缺口：Composer 无法选择 `xhigh`、`max`，且该 APIMart 分支没有向上游传递用户选中的 `quality`。仅增加前端选项不能完成接入。

## 建议修复范围

1. 依据精确模型的已确认能力展示质量选项，Flare / Sunburst 支持完整六档；遵循统一能力目录及审核发布边界。
2. 同步能力校验、Composer 选项和 APIMart 请求组装，保证选择能实际进入上游请求。
3. 产品名称使用“质量 / Quality”；本次没有独立“思考等级 / 推理等级”的公开合同依据。Ext 应单独确认参数。
4. 后续实现需覆盖模型切换、持久化、语言切换和请求体回归；本文未实施这些修改。

## 验证边界

参数依据直接读取的 APIMart 正式 HTML 文档与模型页。公开 OpenAPI JSON 未成功读取，不以它作为证据；未测试未公开字段的服务端接收行为，也未执行付费生成。代码结论来自静态检查，未做浏览器验收。

[api]: https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation
[ext]: https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5-ext/generation
[model]: https://apimart.ai/model/gpt-image-2-5
