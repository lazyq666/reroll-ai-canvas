# Smart Canvas 灯光参考编辑器

- **Status**：Current
- **Feature ID**：F05（Smart Canvas 创作与交互）
- **Owners**：产品 / UI / 交互 / 前端 / 测试
- **Last verified**：2026-08-28（纯逻辑、静态合同、真实无头 Chrome 主链路与共享 Dialog 回归通过）
- **Applies to**：Issue #178
- **Historical research**：[图片打光能力调研](../archive/2026-08-27-issue-178-lighting-research.md)
- **Related ADRs**：[ADR-0002：UI family modules own component-specific implementation](../adr/0002-ui-family-module-ownership.md)
- **Domain terms**：Lighting Intent、Image Node、Generation Node、Prompt Authoring、Canvas Mutation

## 1. 一页摘要

Smart Canvas 为兼容的 Image Node 提供一个确定性的灯光参考编辑器。入口位于 `smartNodeFloatingPortal` 的“角度控制”之后。编辑器复用现有 Angle Control Modal 的共享 Dialog、关闭策略与左右两栏结构：左侧显示可拖拽的标准灯光球场景，右侧提供方位角、仰角、色温或 RGB、主光与环境光相对曝光、表观光源尺寸和阴影开关等精确参数。

编辑过程只更新版本化的 Lighting Intent 并执行实时 `renderer.render()`。左侧使用一颗兼具漫反射层次与集中高光的标准球表达方向、颜色、强度、光源尺寸和阴影；表观光源尺寸由固定采样的多束相邻方向光近似，使球面过渡与地面半影随尺寸产生可见变化。确认时画布创建一个下游图片 Generation Node、选中它并把英文 Prompt 直接填入 Composer；不导出图片或 JSON，不上传媒体，也不调用 Provider、Model 或 Generation Run。

精确 UI 数值仍是 Lighting Intent 和诊断预览的内部输入；默认英文图片编辑指令采用 **G4.1 Safe semantic baseline**。编译器把角度、Kelvin/RGB、EV 和角尺寸分别降级为方向桶、颜色词、Fill 关系和 hard / medium-soft / soft 可观察结果，不把这些数值描述成通用图片模型的精确合同。

## 2. Goals / Non-goals

### Goals

- 使用相机相对坐标和版本化 Schema 保存一份唯一的 Lighting Intent。
- 拖拽操作球与精确数值输入双向同步，`azimuth < 0` 始终表示相机左侧。
- 同一状态确定性生成语义一致、顺序固定的中文和英文 Prompt。
- 一次 Canvas Mutation 创建一个图片 Generation Node，把英文 Prompt 填入其 Composer，并让来源与新 Node 的 `metadata.lightingIntent` 保存同一快照。
- 再次从操作过的 Image Node 打开灯光参考时，恢复该 Node 最近保存的 Lighting Intent 继续微调。
- 关闭、取消、断连和重新渲染时释放 WebGL、Geometry、Material、ResizeObserver、Pointer 监听和 animation frame。

### Non-goals

- 不执行生成式重打光，不调用云端或本地模型。
- 不接入 Flux、Qwen、LoRA、Depth、Normal、Surface Map 或 HDR 环境图。
- 不把 Clean Reference 宣称为所有 Provider 都能识别的通用 Lightmap。
- 不导出 Clean Reference、Rig Diagram、Contact Sheet 或 Lighting Intent JSON。
- 不向 Workspace Managed Media 上传灯光参考文件；创建的 Generation Node 在用户主动运行前不产生 Pending Node 或 Generation Output。
- 不在二维来源图片表面进行物理放灯，也不覆盖来源 Image Node 的媒体；只更新其 Lighting Intent 元数据。
- 不把单个 WebGL Renderer 持久化进画布 Node。

## 3. 权威状态

```json
{
  "schema": "ic-lighting-intent/1",
  "coordinate_space": {
    "reference": "camera",
    "x": "camera_right",
    "y": "camera_up",
    "z": "toward_camera",
    "angle_unit": "degree"
  },
  "environment": { "relative_exposure_ev": -2 },
  "lights": [{
    "id": "key",
    "role": "key",
    "type": "directional",
    "azimuth_degrees": -45,
    "elevation_degrees": 35,
    "color_mode": "temperature",
    "temperature_kelvin": 4200,
    "rgb": "#ffd7b3",
    "relative_exposure_ev": 0,
    "angular_size_degrees": 8,
    "casts_shadow": true
  }],
  "compiler_version": "lighting-prompt/2"
}
```

- 默认值是完整有效状态，不依赖来源图片像素。
- 数值在进入状态时归一化；Prompt 只读取归一化快照。
- `x < 0` 是相机左侧，`x > 0` 是相机右侧；方位角零度位于相机前方，正仰角位于相机上方。
- `color_mode=temperature` 时色温是 Prompt 权威；`color_mode=rgb` 时规范化 Hex RGB 是 Prompt 权威。另一个字段只用于切换模式时保留用户输入。
- `lighting-prompt/2` 不把原始角度、Kelvin/Hex、EV 或 angular size 数字写入通用 Prompt；这些字段继续保存在 Lighting Intent 中。

## 4. 交互与状态

| 状态 | 左侧 | 右侧 | 主动作 |
| --- | --- | --- | --- |
| Default | 一颗兼具漫反射与集中高光的标准球、neutral floor 与来源缩略图 | 默认 Lighting Intent、同步 Prompt | 创建灯光参考 |
| Editing | Pointer 拖拽调整主光方向；预览按当前快照重绘 | 数值输入双向同步，Prompt 确定性重编译 | 可提交 |
| Submitting | 保留最后一帧，不再接受重复确认 | 参数保持可见，错误就地恢复 | Loading / 禁用 |
| Failure | 保留全部编辑状态 | 显示写回错误 | 可重试或取消 |
| Success | Dialog 关闭并释放资源 | 画布选中新 Generation Node，Composer 显示英文 Prompt | Undo 可一次撤回 |

Keyboard 用户可以通过右侧数值控件完成全部参数编辑和确认；拖拽不是唯一入口。颜色模式使用 Small `ic-segmented-control`，各 `ic-slider` 的可视宽度与选项/数值列对齐。来源缩略图只提供视觉上下文，但不显示额外说明文案。

## 5. Prompt compiler

编译器版本为 `lighting-prompt/2`，默认方案是 G4.1，不调用 LLM。中英文按同一语义顺序输出：

1. 只修改 Lighting 的编辑范围；
2. 不可见画外主光、颜色词、八方位与五高度方向桶；
3. 与光位一致的受光面、自阴影，以及仅在现有接影面上成立的投影方向；
4. angular size 映射的 hard / medium-soft / soft 光质和半影结果；
5. 由 `ambient EV - key EV` 映射的 Fill/对比关系，并保持原图整体曝光；
6. 身份、姿态、镜头、构图、几何、材质、纹理、视觉风格、背景、物体、标志和文字保持要求。

方向桶采用 front、front-left、left、rear-left、rear、rear-right、right、front-right；高度桶采用 below、eye-level、raised、high、overhead。Source Size 采用 `0.5°–2° = hard`、`>2°–10° = medium-soft`、`>10°–30° = soft`，只把可观察效果写入 Prompt。默认 `-45°/+35°、4200 K、8°、0/-2 EV、shadow on` 必须得到已测试的 G4.1 通用保守版：`image-left`、`warm-neutral-white`、`medium-soft`、影侧可读、保持平均亮度，不出现裸数值。

编译器无法从 Lighting Intent 判断输入属于孤立主体还是复杂环境，因此默认使用 G4.1 通用接影策略：只调整现有可见表面实际支持的投影，不强制新增地面、墙影或光斑。未选择的电影风格、时间、情绪和具体物体阴影位置不得进入 Prompt。中英文允许自然语序不同，但方向桶、颜色桶、光质、Fill、阴影开关和保持要求必须相同。

## 6. 写回

确认时读取 Dialog 已归一化的 Lighting Intent 和编译后的英文 Prompt，不再创建任何导出文件，也不调用 `/api/ai/upload`。一次 Canvas Mutation：

1. 在来源 Image Node 下游创建一个空的图片 Generation Node；
2. 创建来源到 Generation Node 的一条 `input` Connection；
3. 把英文 Prompt 写入 Generation Node 的 Composer 草稿；
4. 在来源与 Generation Node 上保存同一份 `metadata.lightingIntent` 和 compiler 版本；
5. 选中新 Generation Node 并打开 Composer，但不自动开始 Generation Run。

任一步失败时必须恢复来源 Node 原有元数据，不得留下半完成 Generation Node、Connection 或待提交 Undo 快照。

## 7. Ownership

- `static/js/infinite-canvas-ui/ai-processor-dialog.js`：共享 Dialog 的 Lighting Reference 结构、公共控件绑定和生命周期入口。
- `static/js/infinite-canvas-ui/ai-processor-dialog/styles.js`：该 Dialog 变体的组件家族样式。
- `static/js/smart-canvas/lighting-intent.js`：状态归一化、坐标换算与确定性中英文 Prompt。
- `static/js/smart-canvas/lighting-reference-controller.js`：单球 Three.js 预览、Pointer 控制和资源释放。
- `static/js/smart-canvas.js`：工具栏命令、Node 参数恢复和一次 Canvas Mutation Generation Node 写回。

## 8. Acceptance criteria

1. 工具栏入口只对可用 Image Node 显示，并紧跟“角度控制”。
2. 左侧拖拽和右侧数值输入始终读写同一 Lighting Intent。
3. 同一快照重复编译得到字节一致的 Prompt。
4. `azimuth < 0` 在预览中位于相机左侧，在 Prompt 中编译为相应 `image-left` 方向桶；左右镜像时受光面和投影落向同时互换。
5. 中英文 Prompt 语义相同，不包含未选择的风格语义，也不包含未经模型验收的裸角度、Kelvin/Hex、EV 或角尺寸数值。
6. 左侧只有一颗标准球；球面同时表达漫反射层次与集中高光并保留地面投影。仅改变 Source Size 时，最小/最大值的预览帧必须通过像素差分阈值。
7. 确认时没有图片/JSON 导出、下载或媒体上传请求。
8. 成功时一个图片 Generation Node、一条 `input` Connection、Composer Prompt 和来源/新 Node 的 Lighting Intent 快照一次写入，Undo 一次撤回。
9. Dialog 通过取消、关闭按钮、Escape、成功和 DOM 断连关闭后都无 WebGL/Observer/Pointer/animation frame 残留。
10. 自动化验收覆盖纯编译器、Source Size 像素差分、真实 Dialog 生命周期、零上传、参数恢复和 Generation Node/Composer 写回；人工 Gate 覆盖 Light/Dark、Pointer、Keyboard 与单球光照可读性。

## 9. Verification plan

| 层级 | 证据 |
| --- | --- |
| 纯逻辑 | Lighting Intent 归一化、八方位/五高度、颜色、Fill、三档 Source Size、阴影开关与 Prompt 确定性 |
| Dialog 浏览器 | 左右布局、单球预览、Pointer/数值同步、生命周期释放 |
| Smart Canvas 浏览器 | 工具栏顺序、Source Size 像素差分、零上传、参数恢复、Generation Node/Composer 写回、一次 Undo |
| 文档 | Current 处理器合同、UI 指南、CONTEXT 与 PROJECT-MAP 对齐 |

## 10. Rollback

回滚时删除 Lighting Reference 工具栏入口、Dialog 变体和两个 Lighting 模块；已经写入 Canvas 的旧普通 Prompt Node 与新 Generation Node 保持可读，不删除用户内容。未知 `metadata.lightingIntent` 必须由旧版本安全忽略。

## 11. Verification result

- `python3 -m unittest tests.test_issue_178_lighting_reference`：9/9 通过；覆盖八方位/五高度边界、颜色与 Fill 语义、三档 Source Size、阴影开关、无裸数值输出和 `lighting-prompt/2` 版本合同。
- `tests/issue_178_lighting_reference_browser_smoke.cjs`：真实无头 Chrome 通过；覆盖工具栏顺序、Source Size 像素差分、单球预览、Pointer 与精确数值同步、Small Segmented Control、Slider 对齐、辅助文案移除、零上传/下载、Generation Node、Composer Prompt、Node 参数恢复、单条 Connection、销毁和协作 Undo 请求。
- `tests/smart_canvas_angle_processor_lifecycle_browser_smoke.cjs`：通过。
- `tests/ai_processor_dialog_presets_browser_smoke.cjs`：通过。
- 人工视觉检查已覆盖单球的漫反射、集中高光与地面投影；待人工 Gate：Dark、窄屏参数滚动和完整 Keyboard 操作。
