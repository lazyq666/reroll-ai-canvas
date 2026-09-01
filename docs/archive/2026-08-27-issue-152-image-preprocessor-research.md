# Issue #152：图片预处理器生态与本项目接入调研

- Status: Archived research
- Date: 2026-08-27
- Source: GitHub Issue #152
- Scope: 类似 ComfyUI ControlNet Auxiliary Preprocessors 的图片预处理能力；重点回答社区热度、转深度图选型和 Reroll 接入难度
- Authority: 本文是源码级调研，不是已批准 Feature Spec；确定产品范围后仍需补充用户行为、失败恢复和验收合同

## 结论摘要

1. **社区事实标准是 `comfyui_controlnet_aux` 节点包。** 2026-08-27 调研时，Comfy Registry API 返回约 **259 万次包下载**和约 **4,161 GitHub stars**；其量级显著高于专用的 Depth Anything V2、SAM2、Marigold 和 AnyLine 节点包。[Registry API](https://api.comfy.org/nodes/comfyui_controlnet_aux)；[源码仓库](https://github.com/Fannovel16/comfyui_controlnet_aux)
2. **公开数据不能给 Canny、DWPose、LineArt、Depth Anything 排出可信的包内调用榜。** Registry 统计到节点包，不统计包内具体节点的执行次数；Hugging Face 的 `downloads` 是近期对受统计文件发出的 GET/HEAD 请求，不是独立用户。本文因此把“包下载量”“模型下载请求”“stars”分别呈现，绝不相加。[Comfy Registry API](https://docs.comfy.org/api-reference/registry/retrieves-a-list-of-nodes)；[Hugging Face 统计口径](https://huggingface.co/docs/hub/models-download-stats)
3. Comfy 官方知识库把 `DWPreprocessor`、`LineArtPreprocessor`、`CannyEdgePreprocessor`、`DepthAnythingPreprocessor`、`OpenPosePreprocessor` 列为该事实标准包的 Key Nodes。这是目前最可靠的“常用类别”证据，但不是五者的内部名次。[Comfy 官方知识页固定版本](https://github.com/Comfy-Org/workflow_templates/blob/2d86395a736fa1daca29e2b4234412afd76b62d0/site/knowledge/custom-nodes/comfyui-controlnet-aux.md)
4. **只做 Issue #152 的“转深度图”，首选 Depth Anything V2 Small。** 它是维护中的通用单目相对深度模型，24.8M 参数；Transformers 版本在调研时显示约 159.7 万次近期下载请求。更关键的是，Small 的模型许可为 Apache-2.0，而 Base/Large/Giant 是 CC-BY-NC-4.0，不适合作为默认商业产品依赖。[官方模型说明与许可](https://github.com/DepthAnything/Depth-Anything-V2/blob/a561b849ebae10a6f5ef49e26c83cbbcd36c71bf/README.md#license)；[Small Transformers 模型页](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf)
5. **ComfyUI 节点包对本项目不是即插即用。** 它的节点包装层依赖 ComfyUI 的 Tensor、节点注册、模型目录和设备管理；完整依赖又包含 PyTorch、TorchVision、OpenCV、MediaPipe、Albumentations 等。本项目当前只有 Pillow、NumPy、SciPy 和 CPU `onnxruntime`，没有 PyTorch、OpenCV、Transformers 或 ComfyUI 运行时。[上游依赖](https://github.com/Fannovel16/comfyui_controlnet_aux/blob/e8b689a513c3e6b63edc44066560ca5919c0576e/pyproject.toml)；[本项目依赖](../../requirements.txt)
6. **算法可以接，整包不应嵌入。** 推荐做一个项目原生 `Image Processor` 接口，先接 `Canny + Depth Anything V2 Small`；复用现有 BiRefNet ONNX 的 Device Cache、校验下载、资源上限、单 Worker 队列和结果写回模式。DWPose 与可商用线稿模型作为下一批，OpenPose 原实现因非商业许可不进入默认产品。

## 一、什么叫“下载量最大、使用量最大”

### 1.1 可获得的数据及其限制

| 指标 | 能说明什么 | 不能说明什么 |
| --- | --- | --- |
| Comfy Registry `downloads` | 某个发布到 Registry 的**节点包**累计被下载的强度 | 包内某个节点被执行多少次；Git clone/旧 Manager 渠道的完整历史；独立用户数 |
| Hugging Face `downloads` | 某个模型仓库近期受统计文件的请求热度 | 独立用户数、成功推理数；不同仓库之间完整一致的安装量 |
| GitHub stars | 社区关注和项目知名度 | 安装量、活跃使用量、产品质量或商用许可 |
| Comfy 官方 Key Nodes | 官方知识内容认为值得首先介绍的代表节点 | Key Nodes 之间的真实调用排序 |

因此，本调研可以回答“哪个节点包是事实标准”“哪些类别最常见”“哪个深度模型有最强直接热度证据”，但不能诚实地声称“DWPose 比 Canny 多运行 30%”。若产品必须得到内部精确排行，需要自己的匿名遥测或从 Comfy 官方取得节点级统计。

### 1.2 节点包热度

以下数据采样于 2026-08-27；Registry 多缓存分片会有轻微波动，故以约数呈现。所有数字都是**节点包下载**，不是包内单个预处理器的下载量。

| 节点包 | Registry 下载量（约） | Registry 返回的 GitHub stars（约） | 主要用途 | 判断 |
| --- | ---: | ---: | --- | --- |
| [`comfyui_controlnet_aux`](https://api.comfy.org/nodes/comfyui_controlnet_aux) | 259 万 | 4,161 | Canny、Depth、Pose、LineArt、HED、Normal、Segmentation 等全套 ControlNet hint map | **通用预处理事实标准** |
| [`comfyui-rmbg`](https://api.comfy.org/nodes/comfyui-rmbg) | 85 万 | 2,086 | RMBG、BiRefNet、BEN、SAM 等抠图/分割 | 广义图片预处理热门，但本项目已有 BiRefNet 抠图 |
| [`comfyui-segment-anything-2`](https://api.comfy.org/nodes/comfyui-segment-anything-2) | 42.5 万 | 1,214 | SAM2 图片/视频分割 | 蒙版类热门，资源成本明显高于首版深度图 |
| [`comfyui-depthanythingv2`](https://api.comfy.org/nodes/comfyui-depthanythingv2) | 33.5 万 | 430 | Depth Anything V2 专用节点 | **“转深度图”最直接的专包热度证据** |
| [`comfyui-marigold`](https://api.comfy.org/nodes/comfyui-marigold) | 5.5 万 | 569 | 扩散式深度/法线估计 | 质量路线有价值，但比 Depth Anything 更重、更慢 |
| [`comfyui-anyline`](https://api.comfy.org/nodes/comfyui-anyline) | 4.7 万 | 498 | AnyLine 线稿/边缘 | 线稿专包有使用基础，但不是首版深度需求 |

`ComfyUI-Florence2` 约有 159.5 万下载，但它是检测、描述、OCR、分割等多任务 VLM 节点包，不是典型的 ControlNet 像素 hint-map 预处理器，不能直接与 Canny/Depth/DWPose 混排。[Registry API](https://api.comfy.org/nodes/comfyui-florence2)

### 1.3 建议视为“最常用的一组”，而不是伪造的 1—5 名

结合事实标准包、Comfy 官方 Key Nodes 和专用节点包热度，产品应首先认识下面五类：

| 类别 | 代表预处理器 | 输出 | 社区证据 | 本项目优先级 |
| --- | --- | --- | --- | --- |
| 边缘 | Canny | 二值/三通道边缘图 | 官方 Key Node；无需模型权重 | **MVP** |
| 深度 | Depth Anything V2 | 单目相对深度 hint map | 官方 Key Node；专包约 33.5 万；Small-hf 约 159.7 万近期下载请求 | **Issue #152 首选** |
| 人体姿态 | DWPose | 骨架图 + 可选关键点 JSON | 官方 Key Node；DWPose 官方明确用于替换 ControlNet OpenPose | 第二批 |
| 线稿 | LineArt / TEED / AnyLine | 线稿或软边缘图 | 官方 Key Node；AnyLine 专包约 4.7 万 | 第二批，先完成权重许可审计 |
| 分割/蒙版 | SAM2 / BiRefNet | mask、alpha、分割对象 | SAM2 专包约 42.5 万；RMBG 约 85 万 | 本项目已有抠图，先整合入口而非重复造能力 |

OpenPose 仍然知名，GitHub 约 3.4 万 stars，但其原始许可证明确限制为 academic/non-profit noncommercial research。即使 `comfyui_controlnet_aux` 外壳是 Apache-2.0，也不能把它覆盖到 OpenPose 派生代码和权重；产品默认应使用许可更清楚的 DWPose 路线，并避免复制该节点包中注明“CMU non-commercial”的 OpenPose 派生模块。[OpenPose 固定许可证](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/5c5d96523ef917bd30301245fdc8343937cae48d/LICENSE)；[上游 OpenPose 派生模块的许可注释](https://github.com/Fannovel16/comfyui_controlnet_aux/blob/e8b689a513c3e6b63edc44066560ca5919c0576e/src/custom_controlnet_aux/open_pose/__init__.py#L1-L7)

## 二、Issue #152 的深度模型选型

### 2.1 推荐 Depth Anything V2 Small，而不是“默认最大模型”

| 项目 | Depth Anything V2 Small | Base / Large / Giant | MiDaS / ZoeDepth | Marigold |
| --- | --- | --- | --- | --- |
| 输出定位 | 通用单目**相对深度** | 通用单目相对深度 | 较老的相对/度量深度路线 | 扩散式深度估计 |
| 参数量 | 24.8M | 97.5M / 335.3M / 1.3B | 依具体模型 | 扩散模型级运行成本 |
| 许可 | **Apache-2.0** | **CC-BY-NC-4.0** | 各模型分别审计 | Apache-2.0 代码，权重分别审计 |
| 当前生态信号 | Small-hf 约 159.7 万近期下载请求；官方仓库持续维护 | 更大不等于产品更合适 | MiDaS、ZoeDepth 官方仓库已归档 | Comfy 专包约 5.5 万，速度与资源成本更高 |
| 本项目判断 | **默认首选** | 默认禁用；商用前专项审核 | 仅作回归比较基线 | 后续质量档，不做本地默认 |

Depth Anything V2 官方说明 Small/ Base/ Large/ Giant 的参数量，并明确 Small 与其余尺寸的不同许可。[官方固定 README](https://github.com/DepthAnything/Depth-Anything-V2/blob/a561b849ebae10a6f5ef49e26c83cbbcd36c71bf/README.md#pre-trained-models)

### 2.2 必须先定义“深度图”的产品合同

Depth Anything V2 默认输出是**相对深度**，不是以米为单位的真实距离。实现不能只返回一张看似灰度正确的 PNG，还应固定以下事实：

- `depth_kind`: `relative`；若未来支持 metric depth，必须使用另一个明确的 processor/model ID。
- `polarity`: 建议固定 `near_white`，即近处 255、远处 0；若模型原始输出相反，在适配层一次性转换。
- `normalization`: 例如对有效像素做每图 min-max，写入 `normalization=minmax_per_image`；不能让换模型后黑白含义悄悄翻转。
- `source_size`、`inference_size`、`output_size`: 保持原图长宽比，记录实际模型输入；输出默认回到原图尺寸。
- `bit_depth`: UI/ControlNet 预览可用 8-bit PNG；若后续进入几何、合成或重复处理，应允许 16-bit 单通道资产，避免把精度永久压成 256 级。
- `processor_version`、`model_revision`、`model_sha256`、参数快照：保证缓存、复现和问题定位。

推荐的最小结果元数据：

```json
{
  "processor_id": "depth-anything-v2-small",
  "processor_version": 1,
  "output_kind": "depth_map",
  "depth_kind": "relative",
  "polarity": "near_white",
  "normalization": "minmax_per_image",
  "source_size": [1920, 1080],
  "inference_size": [896, 504],
  "output_size": [1920, 1080],
  "bit_depth": 8,
  "model_revision": "pinned-revision",
  "model_sha256": "...",
  "parameters": {}
}
```

## 三、能否即插即用

答案分成三种：**ComfyUI 插件目录不能；远端 ComfyUI 工作流可以运行但不是本地能力；算法/权重可以在项目原生适配层中复用。**

### 3.1 为什么 `comfyui_controlnet_aux` 不能直接塞进本项目

上游节点包装器直接导入 `comfy.model_management`，接收/返回 ComfyUI `IMAGE` Tensor，并通过 `NODE_CLASS_MAPPINGS` 注册节点；设备由 ComfyUI 选择，模型则在首次执行时从 Hugging Face 下载。[Depth Anything V2 wrapper](https://github.com/Fannovel16/comfyui_controlnet_aux/blob/e8b689a513c3e6b63edc44066560ca5919c0576e/node_wrappers/depth_anything_v2.py)；[DWPose wrapper](https://github.com/Fannovel16/comfyui_controlnet_aux/blob/e8b689a513c3e6b63edc44066560ca5919c0576e/node_wrappers/dwpose.py)

本项目相反：

- 服务端是 Python 3.12、FastAPI、单进程/单 Worker；前端是原生 ES Module 和 Web Components，而不是 ComfyUI/LiteGraph 宿主。[项目地图](../PROJECT-MAP.md)
- 运行依赖只有 Pillow、NumPy、SciPy、PyMatting 和 `onnxruntime` 等，没有 PyTorch、TorchVision、OpenCV、Transformers 或 MediaPipe。[requirements.txt](../../requirements.txt)
- 启动器会显式探测固定依赖集合；把 PyTorch 全家桶塞入主依赖会改变 Windows/macOS/Linux 的安装体积、轮子兼容和启动合同。[launcher.py](../../backend/launcher.py)

上游完整节点包声明 20 多个依赖，包括 `torch`、`torchvision`、`opencv-python`、`mediapipe`、`fvcore`、`trimesh[easy]`、`albumentations`、`matplotlib` 等。即使安装成功，仍缺少 ComfyUI 宿主 API，不能得到本项目的权限、Workspace Media、队列、Pending Node、重启恢复和 Canvas Mutation 语义。[上游固定依赖](https://github.com/Fannovel16/comfyui_controlnet_aux/blob/e8b689a513c3e6b63edc44066560ca5919c0576e/pyproject.toml)

### 3.2 本项目已经有合适的原生实现先例

现有 BiRefNet 抠图能力已经证明了一条更适合本项目的路线：

- 模型存放在可删除重建的 Device Cache，而不是 Workspace Data。[Device Cache](../../backend/infinite_canvas/device_cache.py)
- 模型使用固定 URL、文件名和摘要，临时下载完成且校验通过后再原子发布。[Matting Service](../../backend/infinite_canvas/matting_service.py)
- ONNX Session 延迟创建并复用，限制 CPU 线程、源图像素和 Alpha refinement 像素量。
- 服务端使用单 Worker 有界队列、每用户任务上限、公开状态和失败信息；结果写到 Workspace Managed Media，并创建新的输出 Node，不覆盖来源图片。[后端队列](../../backend/main.py)；[前端任务生命周期](../../static/js/smart-canvas/smart-matting.js)

图片预处理器可以复用其中的模型缓存、校验下载和资源限制，但不应直接复制当前只存在于进程内的 `MATTING_JOBS` 状态机。现有 [Generation Run](../current/generation-pipeline.md) 已拥有身份、恢复、Target Guard、Generation History 和 Canvas Mutation 写回；首版应优先把本地处理器接到这条公共生命周期后面。若产品决定另立持久的 `Image Processing Run`，它会成为新的领域概念和状态权威，实施前必须更新 `CONTEXT.md`、写 ADR，并说明为什么 Generation Run 不能承载，而不能在路由中静默增加第二套任务系统。

### 3.3 每个候选的真实接入难度

| 预处理器 | 上游运行栈/权重 | 当前项目直接满足 | 主要缺口 | 适配判断 |
| --- | --- | --- | --- | --- |
| Canny | OpenCV；无模型权重 | NumPy/Pillow | 当前没有 OpenCV；需要尺寸、阈值、颜色通道和输出合同 | **接近即插即用**，增加 `opencv-python-headless` 或实现受测的等价算法即可 |
| Depth Anything V2 Small（上游 PyTorch） | PyTorch；24.8M 参数；原始 `.pth` 约 99.2 MB | Pillow/NumPy | 没有 torch/transformers；需前后处理、设备和权重缓存 | **不能直接用，但适配清晰** |
| Depth Anything V2 Small（ONNX） | 社区转换 ONNX：FP32 约 99.1 MB、FP16 约 49.6 MB、INT8/uint8 约 27.3 MB | 已有 `onnxruntime` 与模型缓存先例 | ONNX 转换并非原作者发布；需固定 revision/hash并做像素回归、CPU 性能和跨平台验证 | **本项目首选工程路线**。[ONNX 模型页](https://huggingface.co/onnx-community/depth-anything-v2-small) |
| DWPose | 官方 ONNX pose 约 134.4 MB + YOLOX detector 约 216.7 MB；Apache-2.0 | 已有 `onnxruntime` | 两阶段推理、约 351 MB 权重、CPU 性能、关键点 JSON/渲染合同；不能复制带 OpenPose 非商业注释的派生模块 | **可做第二批，不是零成本**。[官方 DWPose](https://github.com/IDEA-Research/DWPose/blob/3dca5db79d9f9ffdd378753ddf6ec66535aace88/README.md#dwp-ose-for-controlnet)；[权重页](https://huggingface.co/yzd-v/DWPose) |
| Realistic LineArt | 两个 PyTorch 权重各约 17.2 MB，来源 `lllyasviel/Annotators` | Pillow/NumPy | 没有 torch；权重模型卡为 `license: other`；需要商业许可结论 | **技术中等、许可先阻塞**。[权重页](https://huggingface.co/lllyasviel/Annotators) |
| OpenPose | PyTorch/Caffe 派生；body/hand/face 权重合计约 510 MB | 无 | 原许可证只允许非商业研究；依赖重、CPU 慢 | **默认不接** |
| SAM2 | PyTorch、较大权重、GPU 价值明显 | 无 | 交互式点/框提示、显存/内存、视频状态和许可/权重矩阵 | **另立分割能力，不塞进深度 MVP** |

ONNX 文件尺寸和 SHA256 可由 Hugging Face 模型 API/LFS 元数据取得；正式实现必须把选择的文件、revision、SHA256 和许可证落入项目模型清单，不能每次跟随 `main`。[Depth Anything Small API](https://huggingface.co/api/models/depth-anything/Depth-Anything-V2-Small?blobs=true)；[DWPose API](https://huggingface.co/api/models/yzd-v/DWPose?blobs=true)

### 3.4 复用现有 ComfyUI Provider 的边界

当前项目确实已经能连接一个或多个外部 ComfyUI：上传输入图片、提交 `/prompt`、轮询 `/history/{prompt_id}`、下载结果。因此，用户自行在 ComfyUI 中安装 `comfyui_controlnet_aux` 后，本项目可以通过一个固定 Workflow 间接得到预处理结果。[ComfyUI adapter](../../backend/infinite_canvas/providers/comfyui_impl.py)

但这条路线目前不能承诺“即插即用”：

- 后端选择只检查 `/queue`、当前负载和输入图是否存在，没有按实例查询 `/object_info` 来验证所需 custom node 是否安装。
- 多实例之间没有验证节点版本、模型权重和参数能力一致；一个工作流可能被调度到缺节点或缺权重的实例。
- 输出受外部服务生命周期影响，离线、权限、首次模型下载和队列失败都与本地处理不同。
- 如果把“本地预处理”做成隐藏的 ComfyUI Workflow，用户必须另外安装和维护 ComfyUI，违背真正本地即用的预期。

所以外部 ComfyUI 应作为**可选 Provider 路线**：先增加精确 capability probe 和实例一致性检查；产品默认仍使用本项目原生处理器。

## 四、推荐产品与架构方案

### 4.1 首版范围

1. 在选中单张 Image Node 时，将现有“抠图”入口收敛为“图片处理”菜单；首版动作：
   - `转深度图`：Depth Anything V2 Small；
   - `边缘图`：Canny；
   - `抠图`：复用已有 BiRefNet，不替换模型。
2. 三者都是确定性/推理型派生媒体处理，界面不要求用户选择生成 Provider/Model；运行记录仍冻结内部的 processor/model revision、参数与来源媒体。它们与 Reverse Prompt/Outpaint/Angle Control 共用 Image Node 的处理入口，但要以分组和文案区分“本地预处理”与“生成式 AI 处理”。
3. 成功时创建新的 Image Node 和 Managed Media，连接来源，不覆盖原图；来源被删除、权限失效或 Canvas Revision 目标保护失败时不得盲写回。
4. 失败保留来源图，不留下半成品媒体；首次下载应显示“下载模型”和进度/失败，不能让第一次请求看起来像推理卡死。

### 4.2 建议模块边界

```text
Image Processor Menu / Dialog
        ↓ processor_id + parameters + source identity
Generation Run → Local Image Processor Adapter
        ↓
ImageProcessorRegistry
        ├─ canny-v1
        ├─ depth-anything-v2-small-v1
        └─ birefnet-matting-v1（迁移现有实现）
        ↓
Bounded Local Execution
        ├─ ModelManifest / Device Cache / verified download
        ├─ shared image decode, EXIF, pixel and size limits
        └─ per-processor preprocess → inference → postprocess
        ↓
Managed Media + immutable result metadata
        ↓
Target Guard → Canvas Mutation → new Image Node + Connection
```

接口应按 `processor_id` 声明：输入 MIME/像素上限、参数 schema、输出 kind/bit-depth、模型是否就绪、下载字节、设备、并发限制、版本和许可证。UI 不从名字猜“哪个模型能输出 depth”。这是一条候选实现 seam，不是已经批准的新领域名；实现阶段若公开它或改变现有模块责任，需要按仓库文档门禁更新领域、ADR 和项目地图。

### 4.3 分阶段建议

| 阶段 | 内容 | 原因 |
| --- | --- | --- |
| P0 技术探针 | 用 15—30 张边界图片比较官方 PyTorch Small 与候选 ONNX FP32/INT8；测 CPU 时间、峰值 RSS、输出极性和像素差 | 先证明 ONNX 转换可靠，避免把社区转换直接当权威 |
| P1 MVP | Canny + Depth Anything V2 Small + 已有 BiRefNet 统一入口和运行合同 | 满足 Issue #152，并建立可扩展 seam |
| P2 | DWPose；关键点 JSON 作为明确的结构化结果或 Node 元数据 | 姿态价值高，但权重/CPU/输出合同更复杂 |
| P3 | TEED/AnyLine 或另一套完成商业许可审计的 LineArt；可选 16-bit depth | 扩大常见 ControlNet hint map |
| 独立需求 | SAM2/交互分割、视频预处理、法线、光流、度量深度 | 交互、资源和结果合同不同，不应塞进首版 |

## 五、实施前必须关闭的风险

1. **许可清单**：逐项记录代码许可证、权重许可证、模型来源、固定 revision 和随产品分发/运行时下载方式。节点包 Apache-2.0 不代表包内所有权重都是 Apache-2.0。
2. **设备基线**：当前 `onnxruntime` 是 CPU 默认；不要在 UI 暗示 CUDA/MPS。若未来加 GPU，按 Windows DirectML/CUDA、macOS CoreML、Linux CUDA 分别验证，不使用“自动 GPU”这一模糊承诺。
3. **依赖体积**：不要为了两个处理器引入整个 `comfyui_controlnet_aux`。Canny 使用 headless OpenCV 或项目内实现；Depth 走一个经验证的 ONNX 模型。
4. **模型供应链**：禁止不固定 revision 的首次 HF 下载；使用临时文件、SHA256、原子发布、超时、重试和离线错误，模型只进入 Device Cache。
5. **资源隔离**：复用或抽取单 Worker 有界队列；限制解码像素、模型输入长边、每用户活动任务和历史状态数量；避免多个 ONNX Session 同时抢占所有 CPU 核。
6. **结果可复现性**：缓存键至少包含源媒体内容摘要、processor ID/version、model SHA256、全部参数、输出规格；不能只使用源文件 mtime。
7. **深度语义**：验收必须覆盖近/远极性、纯色/低纹理、透明 PNG、EXIF 旋转、极端宽高比、多人/室内/室外、超大图片和重复运行一致性。
8. **Comfy 多实例能力**：若提供外部 Workflow 路线，提交前必须逐实例验证 `/object_info`、所需节点版本和模型可用性；否则只允许用户固定到明确实例，不做盲负载均衡。
9. **任务权威**：首版优先复用 Generation Run；若验证后必须新增 `Image Processing Run`，先完成领域词、状态恢复、历史归属、Target Guard 和 ADR 决策，不能复制现有易失的抠图任务字典。

## 六、最终建议

对 Issue #152，建议批准的方向是：

> 将需求定义为一个可扩展的本地 Image Processor 能力，首个模型使用 Apache-2.0 的 Depth Anything V2 Small；工程上优先验证固定 SHA256 的 ONNX FP32/INT8，复用现有 BiRefNet 的 Device Cache 与有界任务队列。首版同时提供无权重的 Canny，并把现有抠图归入同一用户入口。不要安装整个 `comfyui_controlnet_aux`，不要默认使用 CC-BY-NC 的 Base/Large/Giant，也不要把 OpenPose 非商业实现带入产品。

这不是“一行 pip install 后直接上线”，但也不需要新建独立 AI 服务。对本项目而言，Depth Anything V2 Small 属于**中等工作量、低架构风险**：主要工作在模型前后处理、权重供应链、Generation Run/处理器能力合同和真实 CPU 验证；现有 ONNX 抠图链路已经覆盖模型运行基础设施，现有 Generation Run 覆盖持久任务与安全写回基础设施。
