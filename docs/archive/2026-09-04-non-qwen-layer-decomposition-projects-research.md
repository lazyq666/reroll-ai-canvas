# 非 Qwen 图层拆分项目调研

> 调研日期：2026-09-04。本文是候选调查，不是已批准的产品方案或实现说明。只读核验公开 GitHub README、源码和服务商 API 文档；未安装、运行第三方项目，未上传图片或调用付费生成 API。

## 1. 结论与证据边界

存在类似项目，但要区分三类：**真正生成式拆层服务的开源客户端工作流**、**由 agent 编排的补背景/重生成/PSD 方案**、**仅把现成图片写进 PSD 的工具**。目前最贴近 Neowow 可见协议的非 Qwen 实践，是 ComfyUI 的 **Seedream 5.0 Pro Layer Separation + ComfyUI-PSD-Layers**，而不是 Gemini 四阶段生图演示。[ComfyUI 拆层节点](https://github.com/Comfy-Org/ComfyUI/blob/30bdda1ef13a3a34fce2cd2fec633f15d832122a/comfy_api_nodes/nodes_bytedance.py#L1201)；[PSD 节点](https://github.com/coeyes/ComfyUI-PSD-Layers)

用户观察到细节变化、布局接近，与生成式拆层相容，但不能独立证明后台一定“先检测所有物体，再逐个生成”。专用模型也可以一次请求输出多层。Neowow 的已观察协议与 Seedream 的 `<bbox>` 千分坐标、PNG、`z_index`、`bounding_box.absolute` 高度吻合，是**值得优先验证的线索，不是同源确认**。前次调查的证据与限制见[Neowow 调研](2026-09-04-neowow-layer-split-feasibility-research.md)。

## 2. 主要候选

| 候选 | 实际路线 | 与目标的关系 | 可用性与许可 |
| --- | --- | --- | --- |
| ComfyUI Seedream 拆层节点 + coeyes/ComfyUI-PSD-Layers | Seedream 专用 API → RGBA/坐标 → 智能对象 PSD | 最接近完整可运行工作流；不是本地开放权重 | 有代码和工作流；需要服务账户/额度。ComfyUI 为 GPL-3.0，PSD 插件为 MIT |
| 360CVGroup/RevealLayer | 原图 + 检测框 → FLUX.1-dev + 专用权重 → 多 RGBA | 最贴近用户描述的自部署技术路线 | 研究原型；无 PSD 导出，基础模型许可需另外核验 |
| shitagaki-lab/see-through | SDXL LayerDiff3D + 深度/语义分析 → 多层 → PSD | 原生角色拆层/补遮挡并导出 PSD | 动漫角色专用，不是通用海报拆层；有推理入口和权重引用 |
| Abirhossainzozo/layerly-creatives | Agent 识别布局 → 宿主生成/编辑图片 → 图层布局 JSON → PSD | 最接近“通用生图模型重建元素”的编排思路 | 有脚本与案例；不是自动拆分服务器。PolyForm Noncommercial，商业许可另行提供 |
| binggandata/bggg-skills/bggg-creator-image2psd | Agent 判断层 → imagegen 辅助重建/补洞 → 透明资产 → PSD | 可借鉴 manifest、对齐与导出；图层智能由 agent 提供 | 有独立 Python writer；MIT；本身无模型 API 拆层程序 |

### 2.1 ComfyUI + Seedream + PSD 插件：最直接的现成链路

开源工作流不是开源模型：ComfyUI 公开了调用和结果处理，拆层模型实际托管在 ByteDance/BytePlus 服务侧。节点固定使用 `seedream-5-0-pro-260628`；请求模型明确发送 `layer_decomposition: true` 和 `output_format: png`，没有调用 Qwen 模型的代码路径。[模型常量](https://github.com/Comfy-Org/ComfyUI/blob/30bdda1ef13a3a34fce2cd2fec633f15d832122a/comfy_api_nodes/nodes_bytedance.py#L107)；[请求结构](https://github.com/Comfy-Org/ComfyUI/blob/30bdda1ef13a3a34fce2cd2fec633f15d832122a/comfy_api_nodes/apis/bytedance.py#L43)

输入一张原图，prompt 可空（自动识别）、自然语言指定，或使用 `<bbox>left top right bottom</bbox>` 的 0–1000 坐标。代码接收背景和元素 URL，按 `z_index` 排序，解析 `bounding_box.absolute` 后设置图层坐标；支持全画布结果及紧裁切结果。[节点输入及输出](https://github.com/Comfy-Org/ComfyUI/blob/30bdda1ef13a3a34fce2cd2fec633f15d832122a/comfy_api_nodes/nodes_bytedance.py#L1201)；[请求及重组代码](https://github.com/Comfy-Org/ComfyUI/blob/30bdda1ef13a3a34fce2cd2fec633f15d832122a/comfy_api_nodes/nodes_bytedance.py#L1351)

服务商公开接口将该功能称为 Layerize，返回 2–17 层（背景加最多 16 个元素）。这是非 Qwen 的专用拆层服务，不需要用户另写逐对象 GPT/Gemini 循环。[fal Layerize API](https://fal.ai/models/bytedance/seedream/v5/pro/layerize/api)

`coeyes/ComfyUI-PSD-Layers` 接收上述节点的图片、mask 与 bbox 输出，按层序写智能对象 PSD。仓库包含现成 `seedream_separation_to_psd.json`、保存/载入节点和离线 smoke tests。其保存节点还支持显隐与层序调整，不需要重新运行模型即可重新导出。[配套工作流](https://github.com/coeyes/ComfyUI-PSD-Layers/blob/bb77319f54950395c43800fb7bb7935cd852985b/example_workflows/seedream_separation_to_psd.json)；[保存节点代码](https://github.com/coeyes/ComfyUI-PSD-Layers/blob/bb77319f54950395c43800fb7bb7935cd852985b/__init__.py#L127)

许可分别见 [ComfyUI LICENSE](https://github.com/Comfy-Org/ComfyUI/blob/30bdda1ef13a3a34fce2cd2fec633f15d832122a/LICENSE) 和 [插件 MIT LICENSE](https://github.com/coeyes/ComfyUI-PSD-Layers/blob/bb77319f54950395c43800fb7bb7935cd852985b/LICENSE)。代码许可不代表获得托管模型权重或免费 API。

**无需 ComfyUI 的配套导出工具**：同作者的 [Fal.ai-Seedream5-Layers-To-Save-PSD](https://github.com/coeyes/Fal.ai-Seedream5-Layers-To-Save-PSD) 提供 Python CLI、tkinter GUI 和平台构建。它只消费已经完成的 fal JSON，并不负责生成或调用 Layerize。`make_psd.py` 106–181 行下载 RGBA，使用 `z_index` 排序、背景尺寸建画布、`bounding_box.absolute` 设变换，并嵌入原始 PNG。[核心源码](https://github.com/coeyes/Fal.ai-Seedream5-Layers-To-Save-PSD/blob/19b4b9dca705732dcdc35cf3eb6e11e9da302543/make_psd.py#L106)；[MIT LICENSE](https://github.com/coeyes/Fal.ai-Seedream5-Layers-To-Save-PSD/blob/19b4b9dca705732dcdc35cf3eb6e11e9da302543/LICENSE)

缺口：模型后端仍是闭源付费服务；本轮没有实测透明边缘、遮挡补全、文字保真与原图重组误差。第三方插件规模较小，不能把作者的兼容性声明当成独立验证结果。

### 2.2 Layerly Creatives：最贴近用户假设的 agent 编排

工作流让 agent 盘点参考图元素的百分比位置和尺寸，准备独立 cutout，按同坐标写 `layout.json`。对已有平面设计，无法干净提取的对象可按同对象/角度重生成；移除对象后的 plate 使用宿主图像编辑工具补全。随后渲染图层、查看边缘审计图，再用 `ag-psd` 导出。文字可以重建为 PSD type layer，而不必都是图片。[布局与参考图流程](https://github.com/Abirhossainzozo/layerly-creatives/blob/b63b13e58d39ebef5882ae40609a98ca57ac3ef8/skills/layerly-creatives/SKILL.md#L49)；[重建限制](https://github.com/Abirhossainzozo/layerly-creatives/blob/b63b13e58d39ebef5882ae40609a98ca57ac3ef8/skills/layerly-creatives/SKILL.md#L110)

公开脚本允许 Gemini 或 OpenAI，默认模型分别为 `gemini-2.5-flash-image` 和 `gpt-image-1`，OpenAI 路径可设置透明 PNG。**关键限制**：`gen_image.py` 只把文字 prompt 发到生成接口，没有输入参考图、mask 或 bbox 的参数；真实参考图编辑依赖宿主工具与 agent 额外编排。因此它证明这套创作方法已有公开实现，但不是现成“一张图片进、全自动多层出”的服务。[生成脚本](https://github.com/Abirhossainzozo/layerly-creatives/blob/b63b13e58d39ebef5882ae40609a98ca57ac3ef8/skills/layerly-creatives/scripts/gen_image.py#L32)

它没有强制 Qwen 依赖。可作为流程与 QA 参考；不能直接按 MIT 项目处理，因为作者使用 [PolyForm Noncommercial 1.0.0](https://github.com/Abirhossainzozo/layerly-creatives/blob/b63b13e58d39ebef5882ae40609a98ca57ac3ef8/LICENSE)，商业使用另设许可。未核验当前 API 模型是否仍对所有账户开放。

### 2.3 BGGG image2psd：透明资产和 PSD 组装参考

这个项目把语义理解与生成留给 agent/imagegen：可补背景、重建独立主体，再把图片和栅格文字写成分层 PSD。若要求位置不变，推荐全尺寸透明画布，各层放 `(0,0)`。提供 manifest、PNG 单层输出、预览和纯 Python PSD writer。[README](https://github.com/binggandata/bggg-skills/tree/1034ee5805f3fd5b010a4f57affa4aa796ab75d5/bggg-creator-image2psd)；[流程定义](https://github.com/binggandata/bggg-skills/blob/1034ee5805f3fd5b010a4f57affa4aa796ab75d5/bggg-creator-image2psd/SKILL.md#L44)

代码中的 `assemble` 读取现有图片，按 manifest 的 `x/y` 定位、处理 alpha，然后写 PSD；`split-colors` 是颜色聚类，不是语义物体分解。脚本没有封装自动对象识别与逐对象重绘 API。不要把“支持 AI 生图到 PSD”误读为自带拆层模型。[图层定位](https://github.com/binggandata/bggg-skills/blob/1034ee5805f3fd5b010a4f57affa4aa796ab75d5/bggg-creator-image2psd/scripts/image2psd.py#L398)；[PSD writer](https://github.com/binggandata/bggg-skills/blob/1034ee5805f3fd5b010a4f57affa4aa796ab75d5/bggg-creator-image2psd/scripts/image2psd.py#L481)；[MIT LICENSE](https://github.com/binggandata/bggg-skills/blob/1034ee5805f3fd5b010a4f57affa4aa796ab75d5/bggg-creator-image2psd/LICENSE)

## 3. 检查后不列为真正拆层的项目

- [Mohammed-AB/ai-layer-designer](https://github.com/Mohammed-AB/ai-layer-designer) 是 Gemini 四次提示词生成，并把四张图写入 PSD。检查 `generate-layers/index.ts` 可见每次请求仅包含该阶段 prompt 和同一张可选 reference，并没有传入前一次生成结果，也没有 alpha 分离、对象 bbox 或遮挡补全。它是阶段图/PSD 演示，不等价于从原图还原独立 RGBA 对象。[生成代码](https://github.com/Mohammed-AB/ai-layer-designer/blob/4ce9206d49826a4627d555f364ef19857697e55b/supabase/functions/generate-layers/index.ts#L30)
- [l1thin/stratum](https://github.com/l1thin/stratum) 的 README 描述 rembg/U-2-Net、轮廓和 OCR，属于抠图与文字整理，不是生成式重绘补全；README 同时声明保留权利、需作者明确许可，因此不能当作可随意集成的开源实现。

## 4. 开放权重研究路线

以下由本次并行调查的主代理核验；同样只读检查，没有运行推理。

### 4.1 RevealLayer：原图 + bbox → 生成式 RGBA 拆层

[360CVGroup/RevealLayer](https://github.com/360CVGroup/RevealLayer) 的输入 JSON 包含 `full_image` 和 `detections[].bbox`，推理使用基于 FLUX.1-dev 的自定义 transformer、专用权重和透明解码器。可生成被遮挡部分，而非只在原图上切 mask；代码保存 `bg_rgba.png`、`layer_N_rgba.png` 和 alpha，并进行合成。这是本轮找到最贴近“定位后交给生成模型重建对象”的自部署项目，但没有 PSD 输出。[README](https://github.com/360CVGroup/RevealLayer/blob/main/README.md)；[infer.py](https://github.com/360CVGroup/RevealLayer/blob/main/infer.py)

已检查的脚本按 1024 分辨率工作，并加入全画布层、截断总层数到 12；不能仅凭模型宣传将其当作无层数限制的完整产品。仓库存在权重层数不匹配、小文字表现和 V2 发布状态的讨论；README 中 V2 在线演示不等于当前仓库已发布可自行运行的 V2 权重。[源码](https://github.com/360CVGroup/RevealLayer/blob/main/infer.py)；[项目问题列表](https://github.com/360CVGroup/RevealLayer/issues)

项目权重页标注 Apache 2.0，但还要遵守 FLUX.1-dev 的基础模型许可；不能由适配器/项目许可推断整套模型可以无条件商用。Reroll 还需补检测框来源、PSD 导出和质量验证。[RevealLayer 权重](https://huggingface.co/qihoo360/RevealLayer)；[FLUX.1-dev 模型页](https://huggingface.co/black-forest-labs/FLUX.1-dev)

### 4.2 See-through：动漫角色完整拆层到 PSD

原作者仓库为 [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through)。其 README 将流程描述为 SDXL 的 LayerDiff 3D 透明图层生成、微调 Marigold 深度估计和语义分层，再通过 `inference/scripts/inference_psd.py` 导出 PSD；支持最多 23 个角色语义层及遮挡补全。默认 1280 分辨率给出的显存参考为约 12–16 GB。这是面向动漫角色/Live2D 的专门实现，不应等同于任意商品图、中文海报和复杂照片的通用拆层器。[原作者说明与运行入口](https://github.com/shitagaki-lab/see-through)

项目已提供推理代码和模型引用，但本轮没有部署，也未完成代码、各基础模型和训练数据许可的组合审查。用于商业集成前需要逐项核验，不能直接根据 GitHub 可访问就判断可商用。

### 4.3 仅作底层组件：LayerDiffuse

[LayerDiffuse](https://github.com/lllyasviel/LayerDiffuse) 提供 SDXL/SD1.5 透明生成相关能力，可供自建流程使用，但不等价于自动检测任意原图全部物体并输出 PSD。不要和上面两项完整拆层研究实现混为同一成熟度。

## 5. 对 Reroll 的选型含义

若目标是最快验证 Neowow 类结果，应先试验 **Seedream Layerize 的输出质量与几何合同**，借鉴上述客户端/PSD 导出，而不是先建立对象识别加 N 次生成的复杂后台。若目标是允许用户自选 GPT/Gemini 等通用图像 API，Layerly 的资产清单、独立补背景、重生成与逐层 QA 更有参考价值，但还需要工程化 reference/mask 输入、失败重试、成本上限和合成误差检查。这是基于代码覆盖面的实现建议，不是已验证的质量结论。

验证矩阵应至少包含：遮挡后方补全、毛发和半透明物、接触阴影/投影、文字与 logo、位置/比例对齐、单层删除后背景完整性、PSD 往返读写。没有真实结果测试前，不承诺“无损拆分”或“每个物体都可独立恢复”。
