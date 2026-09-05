# Seedream 5.0 Pro 分层提示词与 Dialog 调整调研

核验日期：2026-09-05。仅调研和方案同步，未修改产品代码、未提交生成任务、未消耗积分。以下预设为依据公开范例编写的候选，不代表已实测效果或已批准实现。

## 官方规则与边界

- 火山官方 API 的 `prompt` 在拆层模式可省略，省略后自动识别主要元素；填写后按描述指定拆分意图。建议中文不超过 300 字、英文不超过 600 词，这是写作建议，并非这里声明的硬性截断限制。[火山参数文档](https://docs.volcengine.com/docs/82379/1541523?lang=zh)
- 必须通过 `layer_decomposition: true` 开启专用模式，单张图输入，产出 1 张底图和最多 16 个透明 PNG 元素层；提示词要求过多元素可能遗漏。文字输出仍是图像层。[火山参数文档](https://docs.volcengine.com/docs/82379/1541523?lang=zh)
- APIMart 文档提供拆层专用例子：用 `<bbox>left top right bottom</bbox>` 表示左上、右下角，数值归一化为 0–1000。它是当前服务渠道的接口依据，不应把屏幕坐标或原图像素直接塞进标签。[APIMart 拆层示例](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation)
- 字节官方展示文字、主体、背景和装饰拆层，以及遮挡背景补全，同时明确细文字和像素级编辑一致性仍有改进空间。因此“精确坐标”可以由前端计算保证，但分离结果不应宣称无损还原原 PSD 或绝对像素一致。[Seed 官方发布说明](https://seed.bytedance.com/en/blog/beyond-generation-it-understands-design-introducing-seedream-5-0-pro)

读取方式：火山页面正文提取失败后，读取其公开 HTML 中 `window._ROUTER_DATA` 的 `curDoc.MDContent`，只解析 JSON，未执行页面脚本。先读了本仓库 2026-09-04 两篇相关调研，再重新核验上述当前页面。

## 社区与服务商可追溯范例

| 来源 | 可借鉴内容 | 证据范围 |
| --- | --- | --- |
| [ComfyUI 官方示例工作流](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/api_bytedance_seedream_5_0_layer_separation.json) | 提示词把人物与船、背景、文字图标装饰分别归为三组 | 有实际工作流模板，可支撑“按设计职责分组”的写法；本轮未运行 |
| [ComfyUI ByteDance 节点源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api_nodes/nodes_bytedance.py) | 留空自动拆主要元素、自然语言指定元素、bbox 0–1000 定位 | 已读取 raw 源码中 `ByteDanceSeedreamLayerSeparationNode` 的 prompt tooltip |
| [Segmind 分层 API 文档](https://www.segmind.com/models/seedream-5-pro-layer-decomposition/api) | 逐个写对象及颜色/位置等辨别特征；示例单独列出橙色杯、绿色盆栽、书堆 | 服务商自身提示词与交互说明，不等于字节官方保证；其页面也描述框选变化自动改写 bbox |
| [Seedream_MCP 社区项目](https://github.com/tengmmvp/Seedream_MCP/blob/main/README.md) | 独立开关、可选 prompt、保留位置与层序后再编辑 | 证明社区已有拆层接入实践，未找到覆盖这四种通用粒度且有对比结果的完整提示词套装 |

结论：找到了可靠的分组与逐项描述范例，可以据此整理四个预设；不将营销转载、普通生图提示词或缺少结果的帖子称为“社区验证最佳提示词”。

## 四个候选预设

使用简短的“拆什么、如何分组、保持什么、背景如何处理”结构。层数表示期望分组，最终仍以模型输出为准。

| 选项 | 候选提示词 |
| --- | --- |
| 自动判断 | 识别图中主要元素，按适合独立编辑的内容拆分图层，自动决定分组。保留元素的外观与相对位置，并补全移除元素后的背景。 |
| 主体 / 背景 | 将前景主体整体提取为一个独立透明图层，其余内容保留在背景底图中。主体的附属细节保留在同一层，补全被主体遮挡的背景，保持原有构图与外观。 |
| 文字 / 主体 / 背景 | 按三组分离：文字与排版图形为一组，主要人物或产品为一组，其余场景为背景。保留文字内容、字体外观、元素相对位置与配色；补全移除前景后的背景。 |
| 每个物体独立 | 将图中可独立编辑的主要人物、产品、道具和装饰逐个拆为透明图层，同一物体的附属细节保留在一起。文字按完整文本块分组，其余保留为背景并补全遮挡区域；最多拆分 16 个元素层。 |

自动判断也可不传 prompt，走官方默认；若界面要求所有预设均有可编辑文本，采用上表文字。另提供“自定义”，与四种预设同处智能识别模式，输入框统一放在选项下方。实现时提供中英文资源和语言切换验证，用户自写的内容不自动翻译或覆盖。

框选生成的候选文本如下；`{…}` 仅是说明性占位符，实际必须使用用户框选数据：

```text
将图片进行精确图层分离，需分离的坐标为：区域 1 <bbox>{left1} {top1} {right1} {bottom1}</bbox>、区域 2 <bbox>{left2} {top2} {right2} {bottom2}</bbox>。将每个区域中的目标内容分别提取为独立图层，保留相对位置，并补全移除目标后的背景。
```

## Dialog 接入建议（待同步后实施）

当前 [ai-processor-dialog.js](../../static/js/infinite-canvas-ui/ai-processor-dialog.js) 的 `resetForOpen()` 每次清空分层 prompt；[smart-canvas.js](../../static/js/smart-canvas.js) 的 `openAiProcessorForSmartImage()` 尚无原图节点分层草稿回填。建议以原图节点及媒体身份保存草稿，字段包括模式、预设、自写文本、源图尺寸和框选区域；编辑和关闭时持久化，再次打开或刷新项目后恢复。两个模式分开保存草稿，切换时避免相互覆盖；同一节点替换媒体后，旧坐标不能直接套用。

模式只保留“智能识别”和“区域框选”。框选优先验证 [Cropper.js 2 的 CropperSelection](https://fengyuanchen.github.io/cropperjs/v2/api/cropper-selection.html)：现成支持 multiple、movable、resizable、keyboard 和 x/y/width/height，适合多矩形及八向手柄；[项目为 MIT 许可](https://github.com/fengyuanchen/cropperjs)。本项目只负责编号、草稿和坐标转换，避免重写拖动缩放引擎。[Annotorious](https://github.com/annotorious/annotorious) 为 BSD-3-Clause 的图片标注备选，若后续需要更完整的标注模型可再比较。

坐标路线：把预览中的框换算为原图像素范围，再按原图宽高归一化至 0–1000 并生成 bbox；处理图片留白、缩放和边界裁剪。提交原图，不提交带白框编号的截图。界面可展示原图像素坐标，但 API 文本使用归一化数值；存储源图尺寸与媒体身份以防旧框错位。

现有 [Issue #38](https://github.com/lazyq666/reroll-ai-canvas/issues/38) 与此方向重叠。本轮遵循用户“开始做之前先同步”的要求，未新建或修改 Issue，未开始功能实现。
