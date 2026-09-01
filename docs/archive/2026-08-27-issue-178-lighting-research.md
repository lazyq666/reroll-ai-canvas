# Issue #178：图片打光能力调研

- Status: Archived research
- Date: 2026-08-27
- Source: GitHub Issue #178
- Scope: 图片打光关键词、图片光照分析、确定性像素处理、生成式重打光，以及它们在 Smart Canvas 中的产品边界
- Authority: 本文记录源码级调研结论，不是已批准 Feature Spec；实现前应把选定范围写入 Active Spec

## 结论摘要

Issue 中的两个项目名字都含“打光”，实际能力完全不同：

1. **ComfyUI-Lighting-Assistant 不是重打光模型。**“打光关键词生成器”只是静态字典选择后拼接两个 `STRING`；“图片打光分析器”把 `IMAGE` 临时写成 PNG、编码为 Base64，与分析指令一起请求 llama.cpp 的 `/v1/chat/completions`，再返回分析文本、关键词和状态。两者都不产生重打光图片。其示例“打光生成器”工作流也只有关键词生成、文本预览和一批静态示例图。[关键词节点源码](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L448-L524)；[分析节点源码](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L526-L600)；[示例工作流](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/workflows/%E6%89%93%E5%85%89%E7%94%9F%E6%88%90%E5%99%A8.json)
2. **ComfyTV Relight 会生成新图片。**前端 3D 灯光球先渲染并上传 PNG，作为光照参考图；下游 Flux2 Klein Relight 工作流接收主体图、光照参考图和辅助 Prompt，经 Flux 2 Klein 9B、Sun-direction LoRA、Reference Latent、采样与 VAE 解码后保存重打光图片。[灯光球渲染上传](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/src/composables/widgets/useLightBall.ts#L148-L195)；[工作流输入映射](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/workflows/image/flux2klein-relight_preset.json#L1-L47)；[生成工作流](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/workflows/image/flux2klein-relight.json)
3. “打光”至少应拆成四类产品能力：**文本生成、视觉分析、确定性像素处理、生成式重打光**。它们的输入、输出、成本、可逆性和失败方式不同，不能共用一个模糊的“打光”执行合同。
4. 对 Reroll，生成式重打光最合适的入口是现有 Image Node 浮动工具栏的第 4 个“AI 处理”Preset。普通 Image Node 不应因此获得 Prompt Authoring 资格；分析文本应按 Reverse Prompt 现有合同创建下游 Prompt Generation Node，重打光结果应经 Generation Run 创建新的 Generation Output，不覆盖原图。[现有 AI 处理器合同](../current/smart-canvas-preset-ai-processors.md)
5. “灯光方向、参考图、Lightmap、Prompt”等是**特定 Relight Provider/Workflow 的输入能力**，不是所有图片 Model 都有的 Generation Setting。它们应由精确工作流能力声明，未知能力不能靠模型名猜测。[现有 Image Model Capability 原则](../current/smart-canvas-image-output-capabilities.md#5-模型能力合同)

## 一、四类能力矩阵

| 能力类别 | 代表实现 | 主要输入 | 直接输出 | 是否调用生成模型 | 是否真正改变图片光照 | 建议产品身份 |
| --- | --- | --- | --- | --- | --- | --- |
| 文本生成 | Lighting Assistant 关键词节点 | 方向、质量、颜色、光效、氛围枚举，自定义词 | Prompt 关键词、说明 `STRING` | 否 | 否 | Prompt 辅助；最终进入 Prompt Node 或 Prompt Generation Node |
| 视觉分析 | Lighting Assistant 图片分析节点 | 图片、分析指令、视觉语言模型 | 分析文本、关键词、状态 `STRING` | 是，VLM 文本生成 | 否 | Reverse Prompt 的光照分析模板；创建下游 Prompt Generation Node |
| 确定性像素处理 | `comfyui-relight` | 图片、可选前景 Mask、灯位、颜色/亮度/渐变 | 处理后图片、Mask、调试图 | 否 | 只改变现有像素；不重建被遮挡内容 | 本地 Image Processor 或 Image Studio 非生成预览 |
| 生成式重打光 | ComfyTV、IC-Light、Magnific Relight | 主体图，加 Prompt、参考图、背景图、控制图之一或组合 | 新的重打光图片 | 是，扩散/图像编辑模型或远端 API | 是 | AI 处理 Relight Preset → Generation Run → 新 Generation Output |

矩阵中的“确定性像素处理”与“生成式重打光”都输出图片，但前者基于确定的遮罩、渐变、颜色校正和加色运算，不能可靠恢复新的物理阴影、镜面反射或遮挡关系；后者可能重建这些内容，也可能改动主体身份、文字和几何。`comfyui-relight` 的源码直接创建径向/方向渐变 Mask，并以加色、色彩校正、Sobel 边缘和方向因子合成结果；它明确不执行 diffusion pass。[Mask 与渐变实现](https://github.com/EnragedAntelope/comfyui-relight/blob/ec7576bc6dd7157c52cb4d29f459f3555d5162dd/relight.py#L304-L351)；[加色和轮廓光实现](https://github.com/EnragedAntelope/comfyui-relight/blob/ec7576bc6dd7157c52cb4d29f459f3555d5162dd/relight.py#L451-L528)；[项目说明](https://github.com/EnragedAntelope/comfyui-relight/blob/ec7576bc6dd7157c52cb4d29f459f3555d5162dd/README.md#L7-L31)

## 二、ComfyUI-Lighting-Assistant：输出文本，不输出重打光图片

调研固定在提交 `08c7dd547977ab0944eb5f2697d71b2b91036c71`。

### 2.1 关键词节点是静态字典到 STRING

源码内置五组表：光源方向、光线质量、光线颜色、特殊光效和氛围风格。`generate_lighting_keywords()` 读取被选条目的 `keywords` 与 `description`，用中文逗号和换行拼接；`LightingKeywordGenerator` 声明两个返回值都是 `STRING`，没有 `IMAGE` 输出，也没有模型请求。[字典和拼接逻辑](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L52-L282)；[节点输入输出](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L492-L524)

所以它的真实数据流是：

```text
枚举选择 + 自定义关键词
        ↓ 静态查表、字符串拼接
打光关键词 STRING + 详细说明 STRING
        ↓ 可选：连接到下游文本编码/图像生成工作流
```

它本身不能验证模型是否理解某个摄影术语，也不保证方向、阴影和材质响应能被下游模型兑现。

### 2.2 图片分析节点发送“图片 + 指令”，得到文本

`LightingImageAnalyzer` 接收 ComfyUI `IMAGE`，把 Tensor 转成 `uint8` 后写到 `NamedTemporaryFile(delete=False)`；辅助函数再读取文件、Base64 编码，以 `text` 和 `image_url` 两个 content part 发送到用户填写的 llama.cpp 地址 `/v1/chat/completions`。成功时读取 `choices[0].message.content`，经关键词提取后返回 `分析结果 / 提取的关键词 / 状态` 三个 `STRING`。[请求格式](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L285-L343)；[Image Tensor 到返回文本](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L526-L600)

llama.cpp 官方服务文档确认 OpenAI-compatible chat endpoint 接收 `messages`，多模态 `image_url.url` 可以是 Base64 data URI；这与插件请求形态一致，但多模态支持仍由具体 llama.cpp 版本和带视觉投影器的模型决定。[llama.cpp server 文档](https://github.com/ggml-org/llama.cpp/blob/cb300598d5f90189cb69d2702f4930aaf99d32a2/tools/server/README.md#L1309-L1339)

真实数据流是：

```text
ComfyUI IMAGE + 分析 Prompt
        ↓ 临时 PNG / Base64
llama.cpp 视觉语言模型
        ↓ 文本 completion
分析报告 STRING + 关键词 STRING + 状态 STRING
```

因此这个节点适合做“识别现有打光并生成可编辑 Prompt”，不适合承诺“重新给图片打光”。

### 2.3 示例预览不是渲染结果

仓库虽然定义了 `LightingPreview`，它只按优先级返回仓库 `images/` 中预置 PNG 的路径或黑色占位图；而且该类没有加入 `NODE_CLASS_MAPPINGS`，正常安装不会注册为可添加节点。[Preview 实现与注册表](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L692-L785)

随仓库提供的“打光生成器”示例工作流主要由一个 `LightingKeywordGenerator`、两个 `PreviewAny` 和 28 个 `LoadImage` 组成；这些图片是术语示例，不是根据用户原图计算出来的预览或结果。[示例工作流](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/workflows/%E6%89%93%E5%85%89%E7%94%9F%E6%88%90%E5%99%A8.json)

### 2.4 直接移植的工程风险

- `llamacpp_url` 是用户可写字符串，插件直接从服务端发起请求，且没有本节点级认证字段。若复制到多用户 Reroll 服务，会扩大到 SSRF、内网访问和 Provider 凭证边界；应复用受控 Provider Adapter，不接受任意 URL。[节点请求源码](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L306-L318)
- 临时文件使用 `delete=False`，完成和失败路径都没有删除，长期运行会残留用户图片。实现时应使用 Workspace/受控临时目录并在 `finally` 清理。[临时文件路径](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L548-L592)
- 节点把临时文件写成 PNG，却在 data URI 中固定声明 `image/jpeg`；同时 `image.squeeze(0)` 假设批次只有一张图。移植时应从真实编码格式生成 MIME，并显式校验单图输入或逐张处理。[落盘与请求源码](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L285-L318)；[Tensor 转换](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L582-L592)
- 关键词提取用 `list(set(...))` 去重，输出顺序可能不稳定，不适合直接作为可复现运行快照。应保持预定义顺序或做稳定去重。[提取逻辑](https://github.com/exo101/ComfyUI-Lighting-Assistant/blob/08c7dd547977ab0944eb5f2697d71b2b91036c71/nodes.py#L376-L446)

## 三、ComfyTV Relight：控制图 + Prompt + 生成工作流

调研固定在提交 `276a9ed59fe7b1287c2927a8222d286cc1c51fcd`，避免快速演进的 `main` 让结论漂移。

### 3.1 前端 3D 灯光球真正输出的是 PNG 控制图

ComfyTV 后端 `RelightStage` 自己不执行 diffusion：它把 `light_render_url` 转为 `COMFYTV_IMAGE` 输出，并把 `light_prompt` 原样作为 `STRING` 输出，真正的生成发生在连接的 Image Stage Workflow。[Stage 节点源码](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/nodes/stages/model_edits.py#L260-L302)

Relight 卡片嵌入 `SceneCanvas` 和灯光控制面板，支持预设、增删灯、灯型、位置、颜色和 Transform Gizmo。灯光变化写入 `lights_data`，随后把固定输出视角渲染成 Canvas、编码为 PNG Blob、上传到 `comfytv/lightball/`，并把 URL 写入 `light_render_url` 输出槽。[Relight 卡片](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/src/components/stages/RelightStageCard.vue#L8-L40)；[状态与上传](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/src/composables/widgets/useLightBall.ts#L20-L25)；[PNG 生成](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/src/composables/widgets/useLightBall.ts#L156-L195)

前端还原样暴露 `mainPrompt` 为第二输出槽，并没有把 3D 参数转换成唯一权威的文本；光照几何的主要控制信号是 PNG light-ball，Prompt 是辅助信号。[输出槽同步](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/src/components/stages/RelightStageCard.vue#L98-L114)

### 3.2 工作流接收两张图，实际生成新图片

Preset 把主体图映射到 `images[0]`，把灯光球或任意光照参考图映射到 `images[1]`，Prompt 默认是 `match the sun direction from the reference`。两个输入分别经 VAE Encode，作为链式 `ReferenceLatent` conditioning 进入装载了 Sun-direction LoRA 的 Flux 2 Klein 模型，采样后 VAE Decode，最终由 `SaveImage` 返回 URL。[Preset 合同](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/workflows/image/flux2klein-relight_preset.json#L1-L47)；[完整工作流](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/workflows/image/flux2klein-relight.json)

对应 LoRA 的模型卡也明确：触发词是 `match the sun direction from the reference`，主要面向室外，把太阳移动到相对相机的目标仰角和旋转角；已有明确主光方向的图片更难修改，固定 seed 可降低连续结果闪烁。[Sun Direction LoRA 模型卡](https://huggingface.co/eric-venti-seeds/Sun-Direction-Lora-Flux2Klein9B)

这给出一个重要边界：ComfyTV 控制器能编辑彩色光、点光、聚光和多灯预设，但 v1 LoRA 模型卡只承诺太阳方向，且把 hardness、color、intensity 列为后续改进方向。因此“UI 能表达”不等于“模型能准确兑现”；首版最多应把单一室外太阳方向作为待验证能力，不能先承诺三点布光、颜色、软硬度和多光源精确迁移。[灯光预设源码](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/src/widgets/three/light/lightPresets.ts#L22-L42)；[LoRA 模型卡](https://huggingface.co/eric-venti-seeds/Sun-Direction-Lora-Flux2Klein9B)

LoRA 作者给出的完整说明还包含“先把明确原始光向处理成阴天/无明确光向，再施加太阳方向”的两段逻辑；ComfyTV 当前 Workflow 只有一次 4-step 生成。由此推断，已有强方向光的输入比阴天输入更容易不稳定，必须以真实边界探针确认，而不能从控制器外观推断能力。[作者工作流说明](https://huggingface.co/eric-venti-seeds/Sun-Direction-Lora-Flux2Klein9B)；[ComfyTV Workflow](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/workflows/image/flux2klein-relight.json)

真实数据流是：

```text
灯光方向/颜色/强度等结构化参数
        ↓ 浏览器 3D 场景渲染
lighting-reference.png ─┐
主体图 ─────────────────┼→ Flux2 Klein + Sun-direction LoRA → 新图片
辅助 Prompt ────────────┘
```

关键设计价值不是某个 Prompt，而是把人可操作的灯光参数转换成**模型训练时认识的视觉控制表示**。这也意味着灯光球的相机、材质、背景、尺寸和训练约定是工作流能力的一部分，不能随意替换为通用示意图。

### 3.3 对 Flux 的依赖：交互层不依赖，当前生成工作流强依赖

ComfyTV 的 3D 灯光球编辑器与 Flux 没有算法级耦合：它只把灯型、位置、颜色等参数渲染成普通 PNG，并输出一段 Prompt；理论上可以继续作为任何 Relight Provider 的前端控制器。但**灯光球 PNG 的含义并不模型无关**。当前 Sun-direction LoRA 的固定版本明确以 FLUX.2 Klein 9B 为基座，并明确说明“使用 ball reference image”“把 overcast image 和 ball image 作为 latent reference”；因此真正学会“从球上高光/阴影推断太阳相对相机方向”的是这项训练约定，不是 PNG 格式本身。[Sun-direction LoRA 固定模型卡](https://huggingface.co/eric-venti-seeds/Sun-Direction-Lora-Flux2Klein9B/blob/b45c97ebee7bd366cbbef5f6d937271c15b81bbd/README.md#L94-L127)

ComfyUI 核心 `ReferenceLatent` 节点本身也不是 Flux 专用：它只是把 VAE latent 追加到 conditioning 的 `reference_latents`，描述中限定为“如果模型支持”。但 ComfyTV 当前图里的 FLUX.2 Klein checkpoint、Flux2 VAE/latent 形状、采样设置和 Sun-direction LoRA 是一套完整合同；尤其 LoRA 的权重只适配其声明的 FLUX.2 Klein 基座。把 checkpoint 文件名替换成 Qwen、SD 1.5 或其他编辑模型，既不会让它们自动理解相同 latent，也无法加载同一 LoRA。[ComfyUI `ReferenceLatent` 固定源码](https://github.com/Comfy-Org/ComfyUI/blob/77739723a36ea503f875c121b03e9c4288aa4914/comfy_extras/nodes_edit_model.py#L6-L27)；[ComfyTV 固定工作流](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/workflows/image/flux2klein-relight.json)

所以答案是：**可以换模型实现同样的产品结果，但通常不是“换一个 checkpoint”式替换；需要为新模型改 Workflow，并选择或训练与其控制表示匹配的 Adapter/LoRA。**可选路线如下：

| 路线 | 官方确认的重打光输入 | 是否输出重打光图 | 对方向/环境的显式控制 | ComfyTV 灯光球 PNG 能否直接复用 |
| --- | --- | --- | --- | --- |
| 当前 ComfyTV / FLUX.2 Klein Sun-direction LoRA | 主体图 + 灯光球/参考图 + 触发 Prompt | 是 | 球参考编码太阳仰角、旋转；v1 主要室外 | **可以**，这是该 LoRA 明示的训练合同 |
| IC-Light SD 1.5 | 前景图 + Prompt，或前景图 + 背景图 | 是 | 文本控制氛围；背景图迁移环境关系；没有 Lightmap、Normal、Depth 或 HDR 环境图输入 | **不能按现有合同直接复用**；球不是其“背景图”语义，需另训控制器或改用 Prompt/真实背景参考 |
| Qwen-Image-Edit-2509 Relight / Qwen-Image-Edit-2511 | 主体图 + Prompt；模型家族支持多图编辑，2509 官方 ComfyUI 模板另载 Relight LoRA | 是 | 官方示例用“twilight / warm color temperature / soft light / blurred shadows”等文本；未定义结构化方向、Lightmap、Normal、Depth 或 HDR 环境图合同 | **可作为第二张图试验，但不能视为已支持**；要稳定解释同一种球，需边界测试或面向球参考微调/LoRA |
| Magnific / Comfy API Relight | 主体图 + 可选 Prompt + `reference_image` 或 `lightmap`（二选一） | 是 | 正式支持参考图迁移或 Lightmap，并有 transfer strength、preserve details、change background | 球可在格式上作为参考图上传，但官方没有承诺理解“球→灯向”；更稳妥是输出该 API 期望的 Lightmap 或使用真实参考图 |
| Neural Gaffer（专用研究模型） | 分割后的主体图 + 目标 HDR 环境图 | 是 | 环境图可旋转方位，直接表达环境光；不依赖 Normal/Depth 显式分解 | **不能直接复用**；应把灯光参数转换成 HDR environment map。官方实现仅 256×256，身份细节保持是已知限制 |
| LightIt（专用可控研究模型） | 源图 + target shading；其照明建模还使用 Normal、光方向和光源立体角生成 shading | 是 | 显式目标 Shading/Normal，可包含投影阴影；Depth 用于训练数据中的 Normal 估计，不是产品级用户输入合同 | **不能直接复用**；需要先估计几何并把灯参数渲染成目标 Shading，或针对球表示重新训练控制网络 |

IC-Light 的两套固定权重合同分别是 `text + foreground` 和 `text + foreground + background`，并没有球、Lightmap 或环境图输入。[IC-Light 固定说明](https://github.com/lllyasviel/IC-Light/blob/bcf3f29ca85be8a4686215f477b546f5030be8b7/README.md#L1-L9) Qwen 官方的 `Qwen-Image-Edit-2511` 明确支持多图输入，并称已把社区 Lighting Enhancement LoRA 能力集成到基座；但它公开的输入仍是图片列表和 Prompt，没有宣称灯光球或物理控制图协议。[Qwen-Image-Edit-2511 模型卡](https://huggingface.co/Qwen/Qwen-Image-Edit-2511#quick-start) Comfy-Org 的固定 Qwen-Image-Edit-2509 Relight 模板则加载专用 Relight LoRA，示例只连接一张源图，以文本描述黄昏、暖色温、软光和模糊阴影；虽然子图保留 `image2/image3`，示例没有用球证明方向控制。[Qwen Relight 固定工作流](https://github.com/Comfy-Org/workflow_templates/blob/2d86395a736fa1daca29e2b4234412afd76b62d0/templates/image_qwen_image_edit_2509_relight.json)

Magnific 的官方 API 把 Lightmap 与参考图定义为互斥字段，因此最接近一个可替换的云端正式合同；但“Lightmap”不能自动等同于“灯光球照片”。[Comfy API Relight 字段](https://docs.comfy.org/api-reference/freepik/relight-an-image#request-body) Neural Gaffer 的官方实现接收目标环境图、可按方位旋转，并输出重打光图片；其 README 同时记录当前公开 checkpoint 为 256×256且 VAE 可能损伤细节，适合作为显式环境光路线的技术证据，不宜直接作为产品默认质量基线。[Neural Gaffer 固定实现](https://github.com/Haian-Jin/Neural_Gaffer/blob/754ae817cff70985efe9f825c6a014e968bb1067/README.md#31-relighting-in-the-wild-single-image-input) LightIt 论文则证明了另一条“Normal + 光方向/立体角 → target shading → identity-preserving relighting”的路线；它要求不同的控制编码与模型训练，不能消费 Sun-direction LoRA 的球语义。[LightIt 官方论文](https://openaccess.thecvf.com/content/CVPR2024/papers/Kocsis_LightIt_Illumination_Modeling_and_Control_for_Diffusion_Models_CVPR_2024_paper.pdf)

对 Reroll，较稳妥的架构是保留同一套灯光 UI 和结构化灯参数，再按 Provider 选择控制编码器：Flux Sun-direction 输出灯光球 PNG；Qwen/IC-Light 输出 Prompt 或真实背景参考；Magnific 输出 Lightmap/参考图；Neural Gaffer 输出 HDR 环境图；LightIt 类模型输出 Normal/Shading。这样替换模型不会迫使产品重做交互，但每个 Provider 仍需独立验证哪些滑杆真的能被兑现。

结合当前仓库，最低成本的非 Flux 探针是先复用已经登记的 `Qwen/Qwen-Image-Edit-2511`：现有 ModelScope Adapter 会把一张或多张 `image_url` 与 Prompt 发送给图片编辑模型，不需要先引入新的 Provider 协议。[当前模型登记](../../backend/main.py#L1570-L1577)；[ModelScope 图片编辑请求](../../backend/infinite_canvas/providers/modelscope_impl.py#L526-L542) 第一轮只验证“源图 + 明确光照 Prompt → 新图片”的语义重打光；第二轮再评估 Comfy-Org 的 Qwen Relight LoRA Workflow。两轮都不能自动证明灯光球方向控制，只有模型级探针通过后，才能把第二张球图加入正式能力声明。

## 四、相似实现如何传递光照意图

### 4.1 IC-Light：文本或背景条件直接生成重打光图片

IC-Light 官方仓库发布两类模型：文本条件模型和背景条件模型；两者都接收前景图。模型说明分别把权重定义为“text + foreground”和“text + foreground + background”条件。[官方说明](https://github.com/lllyasviel/IC-Light/blob/bcf3f29ca85be8a4686215f477b546f5030be8b7/README.md#L1-L9)；[权重合同](https://github.com/lllyasviel/IC-Light/blob/bcf3f29ca85be8a4686215f477b546f5030be8b7/README.md#L235-L243)

文本条件 Demo 把前景编码成额外 latent conditioning，把 Prompt 编码成文本条件；“Left / Right / Top / Bottom”不是普通模型参数，而是生成黑白渐变 initial latent，扩散管线输出 latent 后再 VAE Decode 成图片。[文本条件执行](https://github.com/lllyasviel/IC-Light/blob/bcf3f29ca85be8a4686215f477b546f5030be8b7/gradio_demo.py#L235-L336)

背景条件 Demo 同时编码前景图和背景图，将二者拼成 conditioning，再经 diffusion 和 VAE Decode 返回图片；因此它能用背景的照明环境协调前景，而不只是输出一段建议文字。[背景条件执行](https://github.com/lllyasviel/IC-Light/blob/bcf3f29ca85be8a4686215f477b546f5030be8b7/gradio_demo_bg.py#L235-L323)

对产品的启示是：Relight 控制可以是 Prompt、背景/参考图或初始 latent，不必强制统一成灯光球；但每种 Provider/Workflow 必须明确声明自己消费哪一种表示。

### 4.2 确定性 `comfyui-relight`：即时且可复现，但不是物理重建

`comfyui-relight` 明确定位为“不重新生成图片”的本地确定性处理：最多 3 个二维灯位，使用径向或方向渐变、亮度/对比度/饱和度/色温/Gamma、前景 Mask 和 Sobel 边缘近似轮廓光，输出图片、标准化 Mask 与调试图。[README](https://github.com/EnragedAntelope/comfyui-relight/blob/ec7576bc6dd7157c52cb4d29f459f3555d5162dd/README.md#L7-L46)；[输出合同](https://github.com/EnragedAntelope/comfyui-relight/blob/ec7576bc6dd7157c52cb4d29f459f3555d5162dd/relight.py#L249-L253)

这条路径适合作为低延迟、无计费、可撤销的 Image Studio 调整或生成式提交前预览；不应标注成可以理解三维几何的 AI Relight。源码所谓“3D occlusion”由前景 Mask、边缘梯度与二维灯位近似，而不是深度/Normal 重建。[轮廓 Mask 计算](https://github.com/EnragedAntelope/comfyui-relight/blob/ec7576bc6dd7157c52cb4d29f459f3555d5162dd/relight.py#L469-L528)

### 4.3 ComfyUI 官方 Magnific 节点：远端异步生成式重打光

ComfyUI 内置 `MagnificImageRelightNode` 接收一张源图、可选 Prompt、可选参考图及 transfer strength/style/preserve details 等参数，输出 `IMAGE`。执行时它把图片上传到 Comfy API，提交 `/proxy/freepik/v1/ai/image-relight`，轮询 task ID，再下载生成图为 Tensor；节点标记为 API Node，并显示单次价格徽标。[固定提交源码](https://github.com/Comfy-Org/ComfyUI/blob/77739723a36ea503f875c121b03e9c4288aa4914/comfy_api_nodes/nodes_magnific.py#L512-L681)；[提交、轮询和下载](https://github.com/Comfy-Org/ComfyUI/blob/77739723a36ea503f875c121b03e9c4288aa4914/comfy_api_nodes/nodes_magnific.py#L684-L749)

官方 API 还支持 `transfer_light_from_lightmap` 或 `transfer_light_from_reference_image`，两者互斥，并立即返回 `task_id` 与初始状态；这证明 Lightmap/参考图可以成为正式 Provider 合同，而不是只能塞进 Prompt。[Comfy API Relight](https://docs.comfy.org/api-reference/freepik/relight-an-image)

这条路径最接近 Reroll 现有异步 Generation Run，但会把用户图片上传到外部服务、产生计费，并需要 Provider Adapter 管理凭证、远端任务恢复和失败诊断。

### 4.4 DiffusionLight：输出 HDR 光照表示，不直接输出重打光结果

DiffusionLight 的目标是从单张图片估计环境光：先用 diffusion inpaint 生成多曝光 chrome ball，再把球投影成 LDR environment map，最后合成 HDR environment map。其最终产物可供物体插入等下游任务使用，并不是把输入图片直接重打光。[固定提交的官方流程](https://github.com/DiffusionLight/DiffusionLight/blob/7130ec43739d6c9fe1e70cf5f0389b8f72f5ddbc/README.md#L45-L82)

它说明“光照分析”的输出不一定是文字；未来若 Reroll 支持 3D 合成，可把 HDR environment map 作为一种可复用的 Generated Media / Workflow 输出。但对 Issue #178 的首版图片重打光不是必要依赖。

## 五、对 Reroll 的建议

### 5.1 产品入口：扩展现有 AI 处理 Preset

当前合同已经规定：选中兼容 Image Node 后，从浮动工具栏进入“AI 处理”；成功结果创建新的 Generation Output/Node，不覆盖原图；Reverse Prompt 会先创建下游 Prompt Generation Node；Outpaint 与 Angle Control 已共享 Dialog、失败恢复、Target Guard 和 Canvas Mutation。[Smart Canvas 预设 AI 处理器](../current/smart-canvas-preset-ai-processors.md)

因此建议：

1. 在该入口增加第 4 个 **Relight** Preset，而不是让普通 Image Node 打开 Prompt Authoring。
2. Relight Dialog 保存来源 Image Node 身份，显示来源图、控制方式、兼容 Provider/Workflow、实时控制预览和可选 Prompt。
3. “分析现有打光并生成关键词”复用 Reverse Prompt 的光照分析 Prompt Template：确认后创建并连接 Prompt Generation Node，输出保持可编辑文本。
4. “生成重打光结果”创建 Generation Run 和 Pending Node；成功后创建新的 Image Generation Output 并连接回来源图，原图、历史和已存在连接不被覆盖。
5. 确定性预览只作为 Dialog 内临时派生状态；除非用户明确“应用本地效果”，否则不把预览冒充 Provider 最终输出。

这与 Issue #161 已形成的 Current 行为一致：Image Node 持有媒体或 Generation Output，但只有具有明确生成身份的 Generation Node 承担 Prompt Authoring；普通 Image Node 不能因为被上传、粘贴或已经有图片而获得 Composer 资格。[领域词汇](../../CONTEXT.md#node-与空间结构)；[当前生成链路](../current/generation-pipeline.md#41-解析输入和设置)

### 5.2 Provider/Workflow 能力合同

不要新增一个对所有图片 Model 可见的 `lighting_direction` Generation Setting。建议由精确 Relight Provider/Workflow 声明：

```json
{
  "operation": "image_relight",
  "input_modes": ["prompt", "reference_image", "lightmap", "light_ball"],
  "source_image": {"required": true, "count": 1},
  "reference_image": {"max_count": 1},
  "supports_mask": false,
  "supports_background_change": true,
  "supports_seed": true,
  "output_kind": "image"
}
```

字段只表达 Provider/Workflow 已确认能力：

- ComfyTV Flux2 Klein Workflow：`prompt + light_ball/reference_image`；
- IC-Light FC：`prompt + source/foreground + initial latent preference`；
- IC-Light FBC：`prompt + foreground + background`；
- Magnific：`prompt + reference_image`，API 还可支持 `lightmap`；
- 确定性本地处理：`mask + structured 2D lights`，不属于 Model Capability。

运行快照至少冻结控制方式、结构化参数、Prompt、每个 Reference Input Instance、Provider/Workflow 身份、seed 与是否改变背景。灯光球 PNG、Lightmap 或背景参考图作为运行输入媒体快照保存，不能只保存 UI 滑杆后依赖浏览器重算。

### 5.3 推荐的实施顺序

1. **先统一能力与结果合同。**写 Active Spec，定义 Relight Preset 的兼容入口、四种控制表示、权限、失败/恢复、输入快照和“不覆盖原图”。
2. **先接一个已有 Provider/Workflow 形成真实闭环。**若优先复用现有 ComfyUI/RunningHub，选择一个明确接收源图和参考图/控制图、输出单图的工作流；若优先缩短服务端模型部署，可评估 Magnific，但必须显式展示计费与外部上传。
3. **再做灯光球控制器。**控制器应输出结构化灯参数和确定尺寸的 PNG 控制图；Provider Capability 决定哪一个进入请求，不能假设所有模型都认识同一种球。
4. **把光照分析做成 Reverse Prompt 模板。**这项投入小，但命名必须是“分析/生成关键词”，不能使用会让用户期待改图的“应用打光”。
5. **最后评估本地确定性预览。**它可提高交互即时性，但与最终生成结果存在视觉差异，必须分别标识“预览效果”和“生成结果”。

### 5.4 方案取舍

| 方案 | 优点 | 主要限制 | 建议角色 |
| --- | --- | --- | --- |
| 静态关键词 | 快、免费、完全本地 | 不看图、不兑现光照 | Prompt 快捷选择 |
| VLM 光照分析 | 能解释现有画面并产出关键词 | 输出是概率文本，不改图 | Reverse Prompt 模板 |
| 确定性像素处理 | 快、可复现、无远端计费 | 2D 近似，无法可靠重建阴影/反射 | 即时预览或本地轻处理 |
| ComfyTV 式灯光球 + Workflow | 方向控制直观，实际出图，可留在 ComfyUI | 控制图强依赖 LoRA 训练约定；模型与 GPU 成本高 | 高级本地 Relight Workflow |
| IC-Light | 专用 Relight，文本/背景两种条件 | 默认实现较旧；前景分离依赖和许可证需处理 | 本地专用 Provider 候选 |
| Magnific API | 官方节点合同清晰，Prompt/参考图/Lightmap 路径完整 | 外部上传、计费、凭证与远端恢复 | 云端 Provider 候选 |

## 六、许可证与可复用性

| 项目 | 仓库许可事实 | 可复用结论 |
| --- | --- | --- |
| ComfyUI-Lighting-Assistant | 固定提交的仓库根目录没有 `LICENSE` 文件，GitHub 仓库元数据也未识别许可证。[仓库树](https://github.com/exo101/ComfyUI-Lighting-Assistant/tree/08c7dd547977ab0944eb5f2697d71b2b91036c71) | 不能默认复制其 Python 代码、静态关键词表或预览图；可依据调研独立实现功能与数据结构，若要复制需先取得授权。 |
| ComfyTV | 项目代码为 MIT，要求保留版权与许可声明。[LICENSE](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/LICENSE) | 可按 MIT 复用代码思想或实现，但内置 Workflow 引用的 Flux2 Klein、文本编码器、VAE 与 Sun-direction LoRA 是独立产物，分发、托管或商业使用前要分别核验模型许可。[模型文件清单](https://github.com/jtydhr88/ComfyTV/blob/276a9ed59fe7b1287c2927a8222d286cc1c51fcd/docs/models.md#L139-L144) |
| IC-Light | 仓库代码为 Apache-2.0。[LICENSE](https://github.com/lllyasviel/IC-Light/blob/bcf3f29ca85be8a4686215f477b546f5030be8b7/LICENSE) | 代码可按 Apache-2.0 复用；但官方 README 明确提醒默认 BRIA RMBG 1.4 仅非商用，商业产品必须替换前景分离器或另行取得许可。[模型说明](https://github.com/lllyasviel/IC-Light/blob/bcf3f29ca85be8a4686215f477b546f5030be8b7/README.md#L235-L243) |
| `comfyui-relight` | MIT。[LICENSE](https://github.com/EnragedAntelope/comfyui-relight/blob/ec7576bc6dd7157c52cb4d29f459f3555d5162dd/LICENSE) | 可作为确定性算法参考；若复制实质代码需保留 MIT 声明。 |

许可证结论只覆盖仓库声明，不替代对模型权重、训练数据、示例图片、第三方依赖和服务条款的逐项审查。

特别是 ComfyTV 当前内置 Relight Workflow 指向 FLUX.2 Klein 9B：虽然 Sun Direction LoRA 页面标记为 Apache-2.0，其 Black Forest Labs 基座模型标记为 FLUX Non-Commercial License，并给出约 29 GB VRAM；Adapter 的许可不能自动替代基座许可，不能因为 ComfyTV 外壳是 MIT 就把该 Workflow 当作可商用默认方案。[Sun Direction LoRA 模型卡](https://huggingface.co/eric-venti-seeds/Sun-Direction-Lora-Flux2Klein9B)；[FLUX.2 Klein 9B 官方模型卡](https://huggingface.co/black-forest-labs/FLUX.2-klein-9B) 同一厂商的 4B 基座为 Apache-2.0、允许商业使用，官方参考显存约 13 GB，且已有同作者的 4B Sun Direction LoRA，可作为进一步验证候选；仍需单独核验 LoRA 权重许可和效果，不能自动替换后宣称等价。[FLUX.2 Klein 4B 官方模型卡](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)；[4B Sun Direction LoRA](https://huggingface.co/eric-venti-seeds/Sun-Direction-Lora-Flux2Klein4B)

## 七、实施前验证清单

本次调研是固定提交的源码与官方 API 文档审阅，没有下载模型或执行 GPU/付费 Provider。实现决策前应做窄范围真实验证：

1. 用同一组人像、商品、室内、室外和含文字图片测试候选 Provider，记录身份/几何/文字保持、主光方向兑现、阴影和反射合理性。
2. 对每种控制方式保存真实请求快照：源图、Prompt、参考图/Lightmap/灯光球、seed、模型与工作流版本。
3. 验证生成结果经过 Workspace Materialization、Target Guard、Canvas Mutation、Generation History 和协作端收敛；迟到结果不得覆盖原图或新运行。
4. 验证 Image Node 被删除、权限失效、关闭 Dialog、Provider 排队、远端超时、恢复和重复提交。
5. 对外部 API 明示上传与计费，对本地工作流记录模型显存、耗时、冷启动和支持画幅。
6. 对灯光球工作流做模型级边界探针，证明方向、仰角、颜色、软硬光中哪些真的被模型兑现；UI 不展示未经确认的控制维度。
7. 完成许可证清单后才把代码、静态术语表、预览图或模型权重纳入发布包。

## 八、不接本地模型或 LoRA 时，更值得参考的方向

本节收束到一个不同于生成式 Relight 的产品目标：**Reroll 只负责让用户直观设计光照意图，并确定性输出结构化参数、中英文 Prompt 和光照参考图；是否把这些输出交给某个云端图片 Model，是后续独立选择。**在这个目标下，ComfyTV 仍可作为一个实现参考，但不应成为产品合同或唯一交互范式。

### 8.1 专业交互范式：从“拖一个球”升级为“编辑想要的光效”

最强的交互参考不是另一个 AI 工作流，而是 HDR Light Studio 的 **LightPaint**。它让用户直接在 Render View 中点击想要的结果，并按目标区分五种放灯方法：

- `Reflection`：点击希望出现高光/反射的位置；
- `Illumination`：点击希望被照亮的表面；
- `Shade`：点击希望处在阴影中的表面；
- `Rim`：忽略几何，把光放到画面边缘或主体背后；
- `Shadow`：点击希望投影阴影落下的位置。

LightPaint 的价值是把“XYZ、旋转角是多少”改写成“我想让哪里亮、哪里出现高光、阴影落到哪里”。其官方文档同时说明这些方法依赖 3D 表面、法线或相机关系；因此没有 Depth/Normal/Surface Map 时，Reroll **不能假装可以在任意二维照片上复制 LightPaint 的物理放灯**。首版可把这些方法用于标准代理物（matte ball、chrome ball、地面）和布光示意图，后续获得几何表示后再开放“点原图放光”。[HDR Light Studio LightPaint 官方说明](https://help.lightmap.co.uk/hdrlightstudio/reference-render-view-lightpaint.html)；[LightPaint 功能页](https://www.lightmap.co.uk/hdrlightstudio/features/lightpaint/)

DaVinci Resolve Relight 是第二个高度相关参考：它把 Directional、Point Source、Spotlight 的图形控制柄直接叠在 Viewer 中；Directional 用方位/仰角，Point/Spot 用 3D emitter position，Spot 另有二维 target，并允许把 Surface Map 作为单独输入或输出。这个范式适合 Reroll 的“画面上看到控制柄 + 侧栏精确数值”，但官方流程也再次证明：二维控制柄要真正作用于照片，背后仍需要 Surface Map；在本项目不执行 Relight 的 MVP 中，控制柄只编辑 `Lighting Intent`，不应展示为已经改变原图。[Blackmagic Design 官方 Relight 指南，第 47–50 页](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_18.5_New_Features_Guide.pdf)

`set.a.light 3D` 的重要参考不是渲染算法，而是**交付物**：同一灯光设置同时提供相机预览、Studio Top View、器材/灯位和最终 Set Plan，并能导出包含相机设置、尺寸和相关数值的 JPG/PDF。对 Reroll，这比只导出一个“漂亮灯光球”更完整：创作者既要给模型一张视觉参考，也要给自己或协作者一张能复现的布光图。[set.a.light 3D 官方手册：Setup/View/Export](https://www.elixxier.com/wp-content/uploads/2022/09/set_a_light_3d_v2_5_manual_v1.07_en.pdf#page=19)；[Set Plan 输出说明](https://www.elixxier.com/wp-content/uploads/2022/09/set_a_light_3d_v2_5_manual_v1.07_en.pdf#page=72)

因此推荐的交互由三种视图组成，而不是只保留 ComfyTV 的单个球：

1. **Effect View（默认）**：matte ball + chrome ball + 接影地面；直接拖动主光手柄，实时看明暗、高光和投影变化。
2. **Rig View**：相机相对的俯视/侧视灯位图；支持精确方位角、仰角、距离、尺寸和目标点。
3. **Output View**：并排预览干净参考图、带标注 Contact Sheet，以及确定性生成的中英文 Prompt。

首版只需要一个 Directional Key 和一个 Ambient Fill；多灯、Point、Spot、Rect 可在 schema 中预留，但不应为了显得专业而让 MVP 的参考图变得含义不清。

### 8.2 可复用的开源实现：Sphere-Light-Render-ComfyUI 比 ComfyTV 更贴近此目标

[`Sphere-Light-Render-ComfyUI`](https://github.com/eric-venti-seeds/Sphere-Light-Render-ComfyUI) 虽然 README 把输出接到 Flux Sun-direction LoRA，但它的**前半段完全可以脱离模型使用**：

- 浏览器端用 Three.js 渲染 512×512 灰色 matte sphere、接影平面、AmbientLight 和 DirectionalLight；
- 将方位角、仰角确定性转换为三维灯位；
- 每次参数变化重新渲染并导出 PNG data URL；
- 除手动方向外，另有城市/经纬度 + 日期时间推导真实太阳位置，以及从照片 EXIF 读取 GPS、朝向和时间；
- 为多个节点共享一个 WebGL context，再复制快照，避免每个节点各占一个 context。

这些能力正好覆盖“不运行本地模型，只输出准确 Prompt 和参考图”的核心。其当前代码为 MIT；城市数据来自 GeoNames，标记为 CC BY 4.0；内置 Three.js 也是 MIT。若复用城市数据必须保留对应署名，若只复用手动灯位和浏览器渲染则无需引入 GeoNames 数据。[项目 README 与许可说明](https://github.com/eric-venti-seeds/Sphere-Light-Render-ComfyUI/blob/main/README.md#license--credits)；[球、地面、方向光和 PNG 输出源码](https://github.com/eric-venti-seeds/Sphere-Light-Render-ComfyUI/blob/main/js/preview.js)；[方位/仰角到灯位的纯函数](https://github.com/eric-venti-seeds/Sphere-Light-Render-ComfyUI/blob/main/js/light.js)

它的局限也很明确：当前 UI 主要通过字段/滑杆改变 rotation、elevation 和 intensity，预览本身不是一个可直接拖灯的专业编辑器。Reroll 可用 Three.js 官方 `TransformControls` 补上 mouse/touch 拖动、世界/局部空间、平移/旋转和 snapping；用 `DirectionalLight`、`PointLight`、`SpotLight`、`RectAreaLight` 构造后续灯型。Three.js 官方同时提醒 `RectAreaLight` 在当前实现中不支持投影阴影，所以“参考图必须展示接影”时，首版 Directional/Spot 的结果更可信。[Three.js TransformControls](https://threejs.org/docs/pages/TransformControls.html)；[DirectionalLight](https://threejs.org/docs/pages/DirectionalLight.html)；[PointLight](https://threejs.org/docs/pages/PointLight.html)；[SpotLight](https://threejs.org/docs/pages/SpotLight.html)；[RectAreaLight 限制](https://threejs.org/docs/pages/RectAreaLight.html)；[Three.js MIT License](https://github.com/mrdoob/three.js/blob/dev/LICENSE)

专业软件 HDR Light Studio、DaVinci Resolve 和 set.a.light 3D 均为商业软件，本节只把官方公开交互和输出范式作为设计参考，不主张复制其素材、图标、界面代码或产品术语。

### 8.3 结构化灯光参数：内部合同不应是一串 Prompt

应先保存一个与模型无关的 `Lighting Intent`，再由确定性编译器生成文本与图片。现有标准提供了两个合适锚点：

- OpenUSD `UsdLux` 的目标就是在创作环境与 renderer 间传递灯光设置，并尽可能跨环境可移植；它包含 Cylinder、Disk、Distant、Dome、Rect、Sphere 等灯型，共享 intensity/exposure、RGB/色温，并以 Shadow、Shaping API 承载阴影、聚焦、锥角和 IES。[OpenUSD UsdLux 官方概览](https://openusd.org/release/api/usd_lux_page_front.html)
- glTF `KHR_lights_punctual` 是更小的已批准交换合同，只包含 directional、point、spot；共享 linear RGB、intensity、range，Point/Spot 强度用 candela，Directional 用 lux，Spot 有 inner/outer cone angle，方向由节点局部 `-Z` 与 transform 决定。[Khronos KHR_lights_punctual 规范](https://raw.githubusercontent.com/KhronosGroup/glTF/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md)

Reroll 不必直接把 UI 状态存成完整 USD，也不应直接采用 glTF 的限制。建议内部使用一个明确坐标系和单位的轻量 schema，并保留向 USD/glTF 映射的可能：

```json
{
  "schema": "ic-lighting-intent/1",
  "coordinate_space": {
    "reference": "camera",
    "x": "camera_right",
    "y": "camera_up",
    "z": "toward_camera",
    "angle_unit": "degree",
    "distance_unit": "meter"
  },
  "camera": {"vertical_fov_degrees": 35},
  "environment": {
    "linear_rgb": [1, 1, 1],
    "relative_exposure_ev": -2
  },
  "lights": [
    {
      "id": "key",
      "role": "key",
      "type": "directional",
      "direction_to_light": [-0.579, 0.574, 0.579],
      "azimuth_degrees": -45,
      "elevation_degrees": 35,
      "color": {
        "mode": "temperature",
        "temperature_kelvin": 4200,
        "linear_rgb": [1.0, 0.72, 0.52]
      },
      "relative_exposure_ev": 0,
      "angular_size_degrees": 8,
      "casts_shadow": true
    }
  ],
  "style_tags": [],
  "preservation": ["subject", "composition", "materials", "colors", "text", "camera"],
  "compiler_version": "lighting-prompt/1"
}
```

这里的 `direction_to_light` 是从主体指向光源的单位向量；`azimuth_degrees=0` 表示相机正面，负数为画面左侧，正数为画面右侧；`elevation_degrees=0` 是水平线，`90` 是正上方。相对曝光以主光为 `0 EV`，比使用“强/很强”更可复现。若以后接物理 renderer，再按灯型补充 lux/candela/lumen；没有真实场景尺度时不要伪造物理单位。

MVP 只允许 `directional` 主光，但 schema 后续可按 OpenUSD/glTF 语义扩展 `point`、`spot`、`rect`、`dome`，分别增加 `position`、`range`、`target`、`inner/outer cone`、`width/height` 或 environment map。这样 UI、Prompt 和参考图共用一个权威状态，不会出现“滑杆是左光、Prompt 写右光、PNG 又是另一个角度”的漂移。

### 8.4 光照参考图：单个 matte ball 不够，推荐输出一个 bundle

不同参考表示承载的信号不同，不能都称为模糊的 `lightmap`：

| 表示 | 主要承载的信号 | 不擅长表达 | MVP |
| --- | --- | --- | --- |
| **Matte gray ball** | 漫反射明暗、主光方向、光比、颜色倾向；低频、易读 | 精细环境反射和小光源形状 | 必须 |
| **Chrome ball** | 环境的高频方向、亮源位置/形状、颜色和镜面反射 | 漫反射观感、投影阴影 | 必须 |
| **Cast-shadow floor** | 阴影落向、相对长度、接触关系、边缘软硬 | 任意主体的自遮挡 | 必须 |
| **Rig diagram** | 相机、主体、灯位、角色、角度和尺寸的显式几何关系 | 最终材质响应，不是照片 | 必须 |
| **HDR equirectangular environment map** | 某一点全方向、宽动态的入射辐射，可直接用于 IBL | 近场灯位置、遮挡和接触阴影 | V2 可选 |
| **Provider lightmap / surface map** | 某个服务或算法约定的每像素控制量 | 没有统一跨 Provider 语义 | 仅在精确 Provider 合同要求时生成 |
| **Contact sheet** | 将上述多种视图和参数放在一张人可读交付图中 | 本身不增加新的物理信号；文字可能干扰模型 | 必须，但只用于人和协作 |

Debevec 的官方 Light Probe 资料把 light probe 定义为记录某一点全方向入射光的 HDR 图，并说明可由 mirrored ball 拍摄后转换成 latitude-longitude map，用作 image-based lighting；这支持 chrome ball/HDRI 作为方向和环境辐射表示。[Debevec Light Probe Gallery](https://www.pauldebevec.com/Probes/) Three.js `LightProbe` 则明确只存储空间中的光照信息，当前 diffuse probe 等价于 irradiance environment map，并用球谐编码；这解释了为什么 diffuse/matte 表示更偏低频照度、chrome 表示保留更多高频反射信息。[Three.js LightProbe](https://threejs.org/docs/pages/LightProbe.html) Blender 官方灯光说明还指出，更大的发光尺寸会产生更软的阴影和镜面高光，因此球下接影平面的 penumbra 是“软硬光”比文字标签更可靠的视觉信号。[Blender Light Objects](https://docs.blender.org/manual/en/latest/render/lights/light_object.html)

推荐每次导出两个 PNG，而不是把带字 Contact Sheet 直接冒充模型参考：

1. `lighting-reference-clean.png`：无文字、固定相机和色彩管理；matte ball、chrome ball 与 neutral floor 同场渲染，包含真实投影。
2. `lighting-contact-sheet.png`：四宫格放 clean render、俯视 rig、侧视 rig、关键参数与中英文 Prompt，供人查看、分享和审阅。

`lighting-intent.json` 是唯一权威；两张 PNG 和两个 Prompt 都必须由同一个快照生成。若日后支持 HDR，另加 `lighting-environment.exr`，不要用 8-bit PNG 冒充 HDRI。

### 8.5 从参数确定性生成中英文 Prompt，不调用 LLM

Prompt 生成应是一个版本化 compiler，而不是再调用一次 LLM。固定流程如下：

1. 校验 schema、坐标范围、单位和必填字段；按 `role → id` 稳定排序灯光。
2. 从数值查固定双语词典：例如 azimuth 的八方向分桶、elevation 的低/平/高/顶光分桶；同时保留精确角度。
3. 软硬度只由 `angular_size_degrees` 或明确的 emitter size 推导；色彩只由 Kelvin/RGB 推导。
4. 按固定顺序输出：保留要求 → 主光类型/方向/角度 → 色温/颜色 → 相对强度 → 环境补光 → 阴影 → 用户明确选择的 style tags。
5. 未提供的字段直接省略；绝不补写“电影感、伦勃朗光、自然窗光、夕阳”等未经选择的语义。

例如上面的 JSON 可稳定编译为：

```text
ZH：保持主体、构图、材质、原始颜色、文字和相机不变。使用来自相机左前方 45°、仰角 35° 的定向主光，色温 4200K，主光相对曝光 0 EV；环境补光比主光低 2 EV。使用由 8° 表观光源尺寸产生的柔和但方向明确的阴影，并确保阴影方向与主光一致。

EN: Preserve the subject, composition, materials, original colors, text, and camera. Use a directional key light from 45° camera-left/front at 35° elevation, 4200K, with relative key exposure at 0 EV; keep ambient fill 2 EV below the key. Produce soft but directional shadows consistent with an apparent source size of 8° and keep all shadow directions consistent with the key light.
```

为了避免伪准确，compiler 还应遵守三条硬规则：没有几何就不声称阴影会落在画面某个具体物体上；没有选择 `sun` 就不把 directional light 写成 sunlight；没有明确风格标签就不生成摄影流派或情绪词。输出保存 `compiler_version`，以便将来词典更新后仍能重现旧 Prompt。

### 8.6 推荐给 Reroll 的无模型 MVP

当前最合适的首版不是第 4 个“AI 重打光”Preset，而是一个**不执行 Generation Run 的 Lighting Reference 工具**：

1. 用户从 Image Node 或独立创作入口打开工具；来源图只作为视觉上下文，不上传到第三方，也不被修改。
2. 默认显示 matte/chrome/floor 代理场景；拖动主光手柄，或输入 azimuth/elevation；调整 Kelvin/RGB、相对 EV、表观光源尺寸和环境补光。
3. 所有改动只更新 `Lighting Intent`；浏览器本地 Three.js 实时重渲染预览。
4. 确认时一次性产出 Prompt 与参考媒体：可编辑的中英文 Prompt、clean reference、rig diagram/contact sheet 和 JSON sidecar。
5. 若放回 Smart Canvas，Prompt 进入新的可编辑 Prompt Node；参考图进入新的 Image Node/Managed Media。因为没有 Provider 或 Model 执行，这次操作是 Canvas Mutation，不应伪装成 Generation Run、Pending Node 或 Generation Output。

建议 MVP 输出合同为：

```json
{
  "kind": "lighting_reference_bundle",
  "version": 1,
  "intent": {"schema": "ic-lighting-intent/1"},
  "prompts": {
    "zh-CN": {"text": "...", "compiler": "lighting-prompt/1"},
    "en-US": {"text": "...", "compiler": "lighting-prompt/1"}
  },
  "assets": [
    {"role": "clean_reference", "mime": "image/png", "width": 1024, "height": 1024},
    {"role": "rig_diagram", "mime": "image/png", "width": 1024, "height": 1024},
    {"role": "contact_sheet", "mime": "image/png", "width": 2048, "height": 1536}
  ]
}
```

MVP 的验收重点也随之变化：同一 JSON 重复导出必须字节级或像素容差内稳定；方位左右不能因相机/坐标约定翻转；中英文必须表达同一组字段；clean PNG 不得含 UI、标签或选择框；Contact Sheet 必须能让另一个人仅凭图和数值复现灯位；任何导出失败都不能修改来源 Image Node。

这条路线保留了用户真正看重的“灯光球交互”，同时把价值从某个 Flux/LoRA 的私有视觉协议提升为长期可复用的 **Lighting Intent → Prompt + Reference Bundle**。未来接任何云端图片 Model 时，只需新增消费这些输出的 Provider/Workflow 能力验证，不必重做灯光编辑器。

### 8.7 与当前仓库架构的适配度：渲染内核适合，ComfyUI 插件不能即插即用

当前仓库不是带 npm bundler 的 React/Vue 应用，也不是 ComfyUI 前端；它由 FastAPI 提供静态页面，前端以原生 ES Module、Web Components 和 `SmartCanvasModules` 组成。因此，`Sphere-Light-Render-ComfyUI` 不能作为插件目录直接安装，但它的纯渲染部分与现有技术栈高度匹配。

| 边界 | 当前仓库已有能力 | 适配判断 |
| --- | --- | --- |
| Three.js | 已本地镜像 Three.js r160；`angle-3d.js` 已有 Scene、Camera、Renderer、ResizeObserver、requestAnimationFrame 与完整 `dispose()` 生命周期；Image Studio 也有按需 Three.js 全景 Renderer。[Three.js 清单](../../static/vendor/MANIFEST.md)；[视角控制器](../../static/js/angle-3d.js)；[Image Studio](../../static/js/smart-canvas/image-studio.js) | **直接匹配**；不需要引入 npm、CDN 或第二份 Three.js |
| 球与阴影渲染 | 上游 `preview.js` 的核心只是标准 Three.js：matte sphere、ground plane、AmbientLight、DirectionalLight、shadow map 和固定相机；`lightPosition()` 又是无 ComfyUI 依赖的纯函数。[上游 Preview](https://github.com/eric-venti-seeds/Sphere-Light-Render-ComfyUI/blob/main/js/preview.js)；[纯灯位函数](https://github.com/eric-venti-seeds/Sphere-Light-Render-ComfyUI/blob/main/js/light.js) | **可移植**；应独立重写成项目模块而不是复制整份插件 |
| PNG 产出与媒体保存 | 当前已有 `canvas.toBlob('image/png')`、`FormData` 上传到 `/api/ai/upload`、Workspace 内容寻址媒体保存和返回 `/assets/...` URL 的路径。[几何与上传模块](../../static/js/smart-canvas/ai-processor-geometry.js)；[Workspace Media](../../backend/infinite_canvas/media.py) | **直接匹配**；不需要 ComfyUI 的 Base64 widget 或后端 Decode 节点 |
| Dialog 与控制组件 | 已有 `ic-dialog`、slider、number input、color field、tabs 等 Web Components；Angle Control 已证明可以在 Dialog 打开时动态挂载 Three.js controller，关闭或断连时释放。[AI Processor Dialog](../../static/js/infinite-canvas-ui/ai-processor-dialog.js) | **组件匹配，但应新增独立 Lighting Reference Dialog** |
| Canvas 写回 | `Canvas Mutation` 已统一负责 Prompt/Image Node 创建、连接、布局、Undo 和持久化。[Canvas Mutation](../../static/js/smart-canvas/canvas-mutation.js) | **直接匹配**；确认后可一次创建 Prompt Node 与多个 Image Node |
| ComfyUI 插件胶水 | 上游 `preview.js` 直接依赖 `../../scripts/app.js`、LiteGraph node/widget、`app.graph.setDirtyCanvas()`、widget callback 和 `serializeValue()`；这些对象在本项目不存在。[上游 Preview](https://github.com/eric-venti-seeds/Sphere-Light-Render-ComfyUI/blob/main/js/preview.js) | **完全不匹配**；这一层必须删除并按项目组件合同重接 |

不能原样复制的具体点包括：

1. 上游自带一份 `three.module.js`，本项目已经固定使用 r160；应统一导入 `/static/vendor/js/three-0.160.0.module.js`，并把已废弃的 `renderer.outputEncoding` 改为 `renderer.outputColorSpace = THREE.SRGBColorSpace`。
2. 上游每次交互都调用 `toDataURL()` 把整张 PNG 编成 Base64，目的是填充 ComfyUI 隐藏 widget；本项目预览时只需 `renderer.render()`，确认导出时才用 `canvas.toBlob()`，避免持续分配大字符串。
3. 上游的“单一共享 WebGL Renderer + 每节点 2D 快照”用于绕过大量 ComfyUI Node 同时占用 WebGL context 的限制。本项目推荐只在一个模态工具中保留活动 Renderer，关闭时 `dispose()`，输出回画布的是静态 PNG，不应让每个 Image Node 常驻一个 WebGL context。
4. Three.js r160 核心包不包含 `TransformControls` examples module；若需要专业三维操纵器，必须把对应版本的官方 addon 纳入 `static/vendor/`、补版本与完整性记录，或首版先用自有球面拖拽手柄和方位/仰角数值控件。
5. 现有 `IcAiProcessorDialog` 把 Processor 限定为 Reverse Prompt、Outpaint、Angle Control，并要求选择 Model；无模型 Lighting Reference 不应伪装为该组件的新 AI Processor。更合适的是新增 `IcLightingReferenceDialog`，复用基础 `IcDialog` 和选择控件。
6. `/api/ai/upload` 当前只接受 TXT、图片、视频和音频扩展名，不接受 JSON。MVP 可把完整 `lightingIntent` 快照同时写入新 Prompt/Image Node 的元数据，并提供浏览器端 `lighting-intent.json` 下载；若要求 JSON 成为 Workspace Managed Artifact，则需新增明确的后端 Artifact 合同，不能把它伪装成 TXT。

推荐的项目内模块边界是：

```text
IcLightingReferenceDialog
        ↓ 只分发用户意图事件
lighting-intent.js
        ├─ schema 校验、坐标换算、稳定快照
        └─ lighting-prompt-compiler.js → ZH / EN Prompt
        ↓
lighting-reference-renderer.js
        ├─ 复用本地 Three.js r160
        ├─ preview render
        └─ exportCleanBlob / exportRigBlob / exportContactSheetBlob
        ↓
/api/ai/upload → Workspace Media
        ↓
Canvas Mutation → Prompt Node + Image Node(s)
```

由此给出的适配结论是：**技术路线适合，渲染与灯位数学约有较高复用价值；完整 ComfyUI 插件不是即插即用，宿主胶水、输出合同和产品 UI 都需要按 Reroll 重新实现。**最稳妥的落地方式是把上游当作算法与视觉基准，用本项目现有的 Angle Controller 生命周期、Web Components、Workspace Media 和 Canvas Mutation 重新装配，而不是直接复制插件目录。
