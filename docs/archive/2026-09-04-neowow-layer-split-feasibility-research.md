# Neowow 图层拆分与 Reroll 落地可行性调研

> 调研日期：2026-09-04  
> 结论：**可以立项，建议分阶段交付。** 先做“异步 AI 拆层 → 多个独立 Image Node + Smart Group”，再评估是否需要完整的分层编辑器。  
> 证据边界：本文只读检查了指定 Neowow 工作流、该页面公开加载的前端静态资源，以及当前 Reroll 仓库源码与文档；没有提交拆层任务、没有消耗积分、没有修改 Neowow 工作流。未创建 GitHub Issue。

## 1. 一句话判断

Neowow 的“图层拆分”不是浏览器本地抠图：浏览器负责选择拆分意图、把框选区域编码进提示词、提交异步任务、轮询状态，以及在 Fabric.js 编辑器里重建/编辑结果；真正的多层生成、背景补全和层元数据生成发生在服务端。Reroll 已有可复用的异步 Generation Run、多输出物化、Image Node、Smart Group、目标失效保护和 BiRefNet RGBA 抠图基础，因此**产品和架构上可落地**；最大的不确定性在上游模型/工作流的质量、成本、许可证、显存与 Alpha/几何合同，而不在画布基础设施。[Neowow 工作流](https://neowow.cn/workflow?sessionId=2060187233825792000)；[Neowow `LayerSplitDialog`](https://neowow.cn/assets/LayerSplitDialog-Dd7qpZUg.js)；[Reroll Generation Run](../current/generation-pipeline.md)；[Reroll 预设图片处理器](../current/smart-canvas-preset-ai-processors.md)

建议不要把“拆层”和“类似 Photoshop 的图层编辑器”绑成一个首发范围。前者可复用现有生成链路，属于中等工作量；后者包含画板、图层顺序、变换、混合模式、调色、阴影、历史、自动保存、合成、PSD 导出和二次 AI 编辑，是独立的大功能。[Neowow `ImageLayerEditorDialog`](https://neowow.cn/assets/ImageLayerEditorDialog-2XmfNFqU.js)

## 2. Neowow 已确认的用户流程

### 2.1 拆分入口与参数

对一个图片节点执行“图层拆分”会打开独立对话框。对话框有三种模式：

| 模式 | 已确认行为 |
| --- | --- |
| 智能识别 `auto` | 无需输入；可选“自动判断”“主体 / 背景”“文字 / 主体 / 背景”“每个物体独立”四种粒度 |
| 自然语言 `text` | 用户用一句话说明怎么拆，并可点击示例提示词填入 |
| 区域框选 `region` | 在图片上画多个矩形，可移动、八方向缩放、删除或清空；再在可编辑说明中插入对应区域编号 |

四个自动粒度实际对应的 prompt 分别是空字符串、`将人物主体与背景分离，背景补全为完整一层`、`把画面拆成背景、主体、文字三层`、`把图片中每个物体拆分为独立图层`。这说明“智能识别”并非四个独立 API，而是同一服务配不同提示词。[Neowow `LayerSplitDialog`](https://neowow.cn/assets/LayerSplitDialog-Dd7qpZUg.js)

区域坐标先按展示图片宽高归一化到 `[0,1]`，最小框宽高均为 `0.01`；提交前将四角乘以 1000 并四舍五入，嵌入 prompt：`<bbox>x1 y1 x2 y2</bbox>`。前端没有上传 mask，也没有向接口发送独立的 `regions` 字段。这个设计把框选 UI 与后端协议松耦合，但也意味着服务端必须理解这套 prompt 标记语法。[Neowow `LayerSplitDialog`](https://neowow.cn/assets/LayerSplitDialog-Dd7qpZUg.js)

可选输出档位是 `1K` / `2K`，默认 `2K`；按钮展示的积分分别为 25 / 40。静态前端只能证明界面显示这些数值，不能证明服务端最终扣费规则或积分是否会动态变化。[Neowow `LayerSplitDialog`](https://neowow.cn/assets/LayerSplitDialog-Dd7qpZUg.js)

### 2.2 异步任务与画布结果

确认后，前端创建一个与来源图片相连的异步工具节点。节点初始具有 `type: "layerSplit"`、标签“图层拆分”、空 `inputImageUrls`、`status`、`taskId` 和 `layerEditable: true`。成功后 `resultData` 写入该节点的 `inputImageUrls`；从历史恢复时，`IMAGE_LAYER_SPLIT` 记录的 `urls` 也恢复为同一个节点的多张图片，而不是创建多个下游节点。[Neowow `WorkflowCanvas` 实现](https://neowow.cn/assets/WorkflowCanvas-CVx8Xsqs.js)

因此 Neowow 画布上的拆层结果形态是“一个特殊图片节点持有多个 URL，并可进入图层编辑器”。这是 Neowow 的前端数据选择，不是拆层模型本身要求的结果形态。[Neowow `WorkflowCanvas` 实现](https://neowow.cn/assets/WorkflowCanvas-CVx8Xsqs.js)

### 2.3 图层编辑器

成功节点的“图层编辑”按钮向编辑器传入 `initialImages`、已保存的 `initialState`、`nodeKey`、`sessionId` 和 `taskId`。编辑器使用 Fabric.js；它可按 task record 的元数据恢复原始布局，也支持普通 URL 列表以居中图片方式初始化。[Neowow `WorkflowCanvas` 实现](https://neowow.cn/assets/WorkflowCanvas-CVx8Xsqs.js)；[Neowow `ImageLayerEditorDialog`](https://neowow.cn/assets/ImageLayerEditorDialog-2XmfNFqU.js)

恢复拆层布局时，前端按 `z_index` 排序；从层的 `size`（如 `宽x高`）得到底图坐标系；若层有 `bounding_box.absolute: [x1,y1,x2,y2]`，则缩放并放置到对应位置；没有 bounding box 的层铺满画板。可确认的层记录消费字段为：

```json
{
  "url": "https://.../layer.png",
  "name": "可选层名",
  "z_index": 1,
  "size": "2048x2048",
  "bounding_box": {
    "absolute": [120, 80, 900, 1700]
  }
}
```

字段的可选性来自前端防御式读取；仅凭前端静态代码不能断言服务端每次都返回完整对象。[Neowow `ImageLayerEditorDialog`](https://neowow.cn/assets/ImageLayerEditorDialog-2XmfNFqU.js)

编辑器覆盖了图层可见性/锁定、顺序、移动/缩放/旋转/翻转、不透明度、混合模式、亮度/对比度/饱和度、阴影、单层抠图/裁剪、宫格拼接、Undo/Redo、10 秒自动保存、合成新图片节点、PNG/JPG/分层 PSD 导出，以及对选中透明层发起自然语言二次编辑。二次编辑保留原层，在其上方生成新层。[Neowow `ImageLayerEditorDialog`](https://neowow.cn/assets/ImageLayerEditorDialog-2XmfNFqU.js)

## 3. 可确认的 HTTP 合同

### 3.1 创建拆层任务

```http
POST /agent/story-canvas/layer-split
Content-Type: application/json

{
  "nodeKey": "来源节点 ID",
  "sessionId": "画布/会话 ID",
  "imageUrl": "输入图片 URL",
  "prompt": "非空时才携带",
  "size": "1K | 2K"
}
```

前端要求响应包装为成功结果，且 `data.taskId` 非空；也读取可选 `data.status`。对话框 emit 的对象虽然包含 `mode`，但 `LayerSplitToolHandler` 调 API 时没有传 `mode`，API body 也没有 `mode`。所以服务端看见的是图片、prompt 和 size，三种 UI 模式是纯前端编写 prompt 的方式。[Neowow 主 bundle](https://neowow.cn/assets/index-CHJhl0hM.js)；[Neowow `WorkflowCanvas` 实现](https://neowow.cn/assets/WorkflowCanvas-CVx8Xsqs.js)

### 3.2 状态轮询与完整层记录

前端把活动任务加入统一轮询器，立即查询一次，此后每 10 秒批量查询：

```http
POST /agent/story-canvas/batch-query-status

{"taskIds":["task-id-1","task-id-2"]}
```

轮询项消费 `taskId`、`nodeKey`、`dataType`、`status`、`resultData`、`errorMessage`、`queuedByConcurrencyLimit`、`aheadCount`、`userId`；仅在 `SUCCESS` / `FAILED` 时回调并移除任务。队列提示和 orphan 检查也由这个通用管理器负责。[Neowow `batchPollingManager`](https://neowow.cn/assets/batchPollingManager-A_rPyuJT.js)

拆层成功后，前端还会查询：

```http
GET /agent/story-canvas/query-generation-record?taskId=...
```

若响应数据含非空 `layers`，则将其保存为节点的 `layerSplitLayers`；编辑器恢复布局时也通过同一接口重新读取 `layers`。这表明 `resultData`/历史 `urls` 适合快速预览，而 `layers` 记录承担顺序、尺寸与 bounding box 等更完整的编辑元数据。[Neowow 主 bundle](https://neowow.cn/assets/index-CHJhl0hM.js)；[Neowow `WorkflowCanvas` 实现](https://neowow.cn/assets/WorkflowCanvas-CVx8Xsqs.js)；[Neowow `ImageLayerEditorDialog`](https://neowow.cn/assets/ImageLayerEditorDialog-2XmfNFqU.js)

## 4. 前后端职责边界

| 职责 | Neowow 前端可确认 | 服务端可合理确定 | 仍未知 |
| --- | --- | --- | --- |
| 拆分意图 | 模式、预设、文本、bbox prompt 编码 | 解析 prompt 并执行任务 | 是否有结构化 prompt/parser 版本 |
| 图像处理 | 不在浏览器生成拆层结果 | 生成各层、补全背景、返回 URL/元数据 | 模型、工作流、推理框架、是否后处理 |
| 任务生命周期 | 建占位节点、10 秒批量轮询、成功/失败写回 | 持久 task、状态、并发队列、结果记录 | 重试、幂等、超时、清理策略 |
| 图层编辑 | Fabric.js 重建和大部分编辑；合成/导出 | 托管层图片、保存状态/上传结果、二次 AI 编辑 | PSD 兼容范围与服务端保存模式 |
| 计费 | 展示 25/40 积分 | 应由服务端权威校验/扣费 | 实际计费与退款规则 |

**不能从这些资源确认 Neowow 使用了哪个模型。** 即使接口、字段和 Qwen-Image-Layered 的能力相似，也不能据此归因。本文只把模型当成 Reroll 的候选方案，不当作 Neowow 实现事实。

## 5. Reroll 的现有基础与接入点

### 5.1 可以直接复用

1. **图片处理入口与目标保护**：现有预设图片处理器已经规定，Dialog 保留来源 Node 身份；目标删除、权限失效或选择无效时停止写回；运行中防重复提交；成功创建新 Generation Output/Node，不覆盖原图。[预设图片处理器](../current/smart-canvas-preset-ai-processors.md)
2. **异步 Generation Run 与恢复**：Reroll 已有统一的提交、持久状态、Target Guard、恢复和输出发布链路，不应再复制一套 Neowow 风格的内存轮询任务表。[Generation Run](../current/generation-pipeline.md)；[`generation-run.js`](../../static/js/smart-canvas/generation-run.js)；[`generation-recovery.js`](../../static/js/smart-canvas/generation-recovery.js)
3. **多输出独立 Node**：生成输出模块已经能为多个结果创建多个独立输出 Node、继承连接并保持稳定 output identity。这比把层塞进一个特殊图片节点更符合 Reroll 的 Node 语义。[`generation-output.js`](../../static/js/smart-canvas/generation-output.js)；[`generation_output.py`](../../backend/infinite_canvas/generation_output.py)
4. **Smart Group**：多个层结果可以放入一个显式拥有有序成员的 Smart Group，同时每层仍是正常 Image Node，可单独下载、连接、复用和保存。[领域词汇](../../CONTEXT.md)；[`smart-container.js`](../../static/js/smart-canvas/smart-container.js)
5. **本地 RGBA 处理基础**：BiRefNet 服务已有固定权重/摘要、设备缓存、有界执行和 RGBA PNG Alpha 合成；前端已有异步提交、轮询、恢复与新输出节点写回。它只能产出 foreground，不等价于多层生成，但证明了本地分割和透明结果的基础设施可用。[`matting_service.py`](../../backend/infinite_canvas/matting_service.py)；[`smart-matting.js`](../../static/js/smart-canvas/smart-matting.js)
6. **透明输出能力合同**：模型能力已经显式区分是否支持透明 PNG，未知能力按不支持处理。这可扩展为“支持 layered image output”的精确 Provider/Model 能力，不能从模型名猜。[图片模型能力规格](../current/smart-canvas-image-output-capabilities.md)；[`image_capabilities.py`](../../backend/infinite_canvas/image_capabilities.py)

### 5.2 必须补齐

- Provider/Model 能力需新增一条明确、版本化的“多层 RGBA 输出”合同：最大层数、分辨率、是否可变层数、是否返回完整画布 RGBA 或裁切层、bbox/z-index/name 语义、是否补全背景、并发/显存/超时及许可证。
- Generation Run 结果要保存层顺序与几何元数据，而不仅是 URL 数组；每个层文件必须成为 Workspace Managed Media，并与同一次 Run、来源媒体和参数快照关联。
- Canvas Mutation 应一次性发布全部层 Node、连接和 Smart Group，避免协作端看到半套结果；来源或目标失效时不得写回。
- 所有用户文案必须同时进入中英文 i18n；真实页面需要覆盖初始、框选、提交、排队、成功、部分结果、失败、恢复、关闭、Keyboard、Light/Dark 与协作收敛。
- 需审计 Provider 的格式转换。ComfyUI 路径存在 `convert_output_to_jpg` 分支；拆层结果若误入该分支会丢失 Alpha，因此拆层能力必须强制保留 PNG/RGBA，并对每层实际文件做 Alpha/尺寸检查。[`comfyui_impl.py`](../../backend/infinite_canvas/providers/comfyui_impl.py)；[图片模型能力规格](../current/smart-canvas-image-output-capabilities.md)

## 6. 推荐产品与数据形态

### MVP：AI 拆层，不做完整编辑器

1. 选中一个 Image Node，在现有图片处理菜单打开“图层拆分”。
2. 首版提供“自动判断 / 主体与背景 / 文字主体背景 / 每个物体独立 / 自定义描述”；区域框选可同批交付，也可作为第二个小里程碑。
3. 提交为一次普通但带 `processor/model capability` 快照的 Generation Run。
4. 成功后创建 N 个同尺寸 RGBA Image Node；按 `z_index` 有序放入一个 Smart Group，并把来源 Connection 继承到每个结果或连接到 Group（需在 Feature Spec 中选定一个唯一规则）。
5. 每个 Node 保存 `layerRole/name`、`zIndex`、原始画布尺寸、bbox（如有）、Run ID、来源媒体 identity 和模型/工作流 revision。
6. 提供“合并预览/导出合成图”，但编辑仍用已有 Node 变换和画布能力。

采用独立 Node 的理由：它符合 Reroll 当前领域模型和多输出发布方式；单层可以继续参与 Connection、Generation Run、素材库和下载；无需先引入 Fabric.js 的第二套画布状态、Undo、自动保存和协作模型。[领域词汇](../../CONTEXT.md)；[`generation-output.js`](../../static/js/smart-canvas/generation-output.js)

### 后续：专用分层编辑器

只有用户验证明确需要同画板合成、混合模式、PSD、单层二次 AI 编辑时再立第二阶段。届时必须先决定：编辑器状态是 Canvas Node 的持久内容、独立复合媒体文档，还是仅一次性导出工具；这会影响领域词、Canvas Mutation、Realtime 协作、Undo、Managed Media 垃圾回收和分享只读呈现，属于需要 Feature Spec 并可能需要 ADR 的责任边界变化。[文档完成门禁](../agents/change-documentation.md)

## 7. 上游实现候选（不是 Neowow 归因）

官方 Qwen-Image-Layered 仓库声明可把图像分解为多张 RGBA 层，支持可变层数与递归分解，许可证为 Apache-2.0；能力形态与本项目目标匹配，可用于技术 spike。它只是一个候选，必须在目标硬件上实测显存、延迟、中文意图服从、文字层质量、背景补全、透明边缘、层间重组和可重复性。[QwenLM 官方 `Qwen-Image-Layered`](https://github.com/QwenLM/Qwen-Image-Layered/blob/main/README.md)

如果目标环境不适合本地模型，可把同一能力合同落到 ComfyUI/RunningHub/HTTP Provider 工作流；前端与 Canvas 发布逻辑不应依赖某个具体工作流。现有 Reroll Provider 适配层已经提供这些类别的接入基础。[`providers/`](../../backend/infinite_canvas/providers/)

## 8. 两阶段建议与验收门

### 阶段一：技术 spike + MVP

- 用 10–20 张覆盖人物、商品、文字海报、透明物和复杂遮挡的固定测试集，比较至少一个本地方案与一个可用远端方案；记录 RGBA 重组误差、背景补全、文字完整率、延迟、峰值资源、失败率、成本、许可证和权重 revision/SHA256。
- 只有至少一种方案能稳定返回可重组的 RGBA 层且资源/成本可接受，才进入产品实现；否则暂停。
- 由维护者创建 Feature Spec/Issue 后，交付能力合同、Provider adapter、Generation Run、Managed Media、原子多 Node/Group 发布与恢复，以及含预设/自定义 prompt、状态反馈和中英文 i18n 的 Dialog。
- 验收 Alpha、尺寸、z-index、并发、失败、目标失效、刷新恢复、多人协作和 Undo；不引入完整第二画布。

### 阶段二：区域控制与专用编辑器（需求验证后）

- 区域框选优先提交结构化 `regions`，由后端 adapter 编译成模型特定 bbox prompt；增加层列表、合成预览、显隐和快速导出。
- 只有用户确需混合模式、PSD 与单层二次 AI 编辑时，才设计专用编辑器及其持久化、协作、自动保存和历史合同。

## 9. 立项前必须回答的未知项

1. 第一版由本地、ComfyUI、RunningHub 还是 HTTP Provider 执行？支持哪些操作系统/GPU？
2. 产品承诺的是语义层、对象层，还是仅前景/背景？“自动判断”的质量阈值是什么？
3. 层是否一律与原图同尺寸 RGBA？若返回裁切层，bbox 是绝对像素还是归一化坐标，端点是否包含？
4. 是否必须补全无遮挡背景？文字是保留像素层，还是进一步 OCR 成可编辑 Text Node？
5. 最大层数、输入像素、超时、并发、磁盘膨胀和中间文件清理上限是什么？部分层成功时整体失败还是允许部分发布？

## 10. 最终建议

**建议立项，但先立“多层图像生成与画布发布”MVP，不立“完整图层编辑器”大而全项目。** 技术 spike 先验证一个上游方案；通过后复用 Reroll 的 Generation Run、Managed Media、多个 Image Node 与 Smart Group，建立结构化层元数据和 RGBA 质量门。这样能在较低架构风险下交付用户真正要的“把一张图拆成可继续使用的层”，同时为未来区域控制和专业编辑器留下清晰扩展点。
