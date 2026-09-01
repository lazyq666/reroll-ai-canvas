# Smart Canvas 预设图片处理器

> Status: Current<br>
> Last verified: 2026-08-28<br>
> Presets: Reverse Prompt、Outpaint、Angle Control、Lighting Reference

## 入口与共享合同

选中支持的 Image Node 后，浮动工具栏显示各预设入口。Preset Dialog 复用同一 Overlay、标题、关闭、运行状态、失败恢复与结果写回结构；不同 Preset 只拥有自己的输入、预览和执行参数。“灯光参考”位于 `smartNodeFloatingPortal` 的“角度控制”之后。

- Dialog 打开时保留来源 Node 身份；Node 被删除、权限失效或选择不再有效时停止写回。
- 运行中不能重复提交；关闭 Dialog 不等于取消已经交给 Provider 的 Generation Run。
- 调用 Model 的 Preset 成功后创建新的 Generation Output/Node；确定性的 Lighting Reference 只预配置图片 Generation Node 与 Composer，不自动开始 Generation Run。两类流程都不覆盖原图媒体。
- 失败保留用户输入和调整状态，并遵循[生成失败反馈](smart-canvas-generation-failure-feedback.md)。
- Prompt Library 只负责选择/插入 Prompt，不复制 Preset 的运行状态。

## Reverse Prompt

输入为当前图片，输出为可编辑 Prompt。Dialog 初始展示来源图片、Prompt Template 和文本 Model/Provider 选择。有效确认会先在来源图片下游创建并连接 Prompt Generation Node，然后立即关闭 Dialog；Provider 接单和后续 Generation Run 状态由 Canvas 中的新 Node 承载，不能让 Dialog 遮罩继续阻塞画布。

如果 Provider 接单前提交失败，系统回滚本次临时 Node，并重新打开 Dialog，保留用户选择的 Template 与 Model，同时在 Dialog 内和 Toast 中显示可恢复错误。已经接单的 Generation Run 继续按通用恢复流程生成下游 Prompt，不自动覆盖其他已有 Prompt。

## Outpaint

用户在预览画布中调整原图相对位置、扩展区域、目标比例/尺寸、填充色和可选 Prompt。

- 原图保持完整，不因拖动预览而裁切源文件。
- 输入尺寸受浏览器内存与 Provider 限制；超限时在提交前给出可恢复说明。
- 发送给模型的实际输入必须使用安全尺寸，并保持预览与结果比例的对应关系。
- 结果作为新 Node 放置并连接回来源；原始 Node 与历史保持不变。

## Angle Control

用户通过共享控制器调整水平角、俯仰、缩放/距离等可用维度，并看到相机方向的即时示意。控制器生成结构化参数与可读 Prompt；无效组合必须在提交前提示，未更改的维度不应制造随机参数。

## Lighting Reference

用户在共享 Large Dialog 中编辑一个版本化 Lighting Intent。Dialog 沿用 Angle Control 的左右结构：左侧是包含一颗 layered gray reference ball、neutral floor、Directional Key、Ambient Fill 和投影的 Three.js 操作区；球面通过漫反射层次和 clearcoat 集中高光共同表达灯光。表观光源尺寸由固定采样的多束相邻方向光近似，最小/最大尺寸必须让球面过渡和地面半影产生可测的像素变化。Pointer 拖拽主光方向，右侧方位角与仰角数值输入提供等价的 Keyboard 路径。`azimuth < 0` 固定表示相机左侧。

右侧同时提供色温 / RGB Small `ic-segmented-control`、主光相对曝光、环境补光相对曝光、表观光源尺寸、投影开关和只读中英文 Prompt；其中 Number Input、Color Field 和 Textarea 统一使用 Small Size，所有 Slider 与所在选项/数值列对齐。分组标题与来源缩略图不显示解释性辅助文案。Prompt 由 `lighting-prompt/2` 按 G4.1 Safe semantic baseline 确定性编译，不调用 LLM，不添加未选择的风格或情绪语义。精确数值保留在 Lighting Intent 与诊断预览中；通用 Prompt 使用八方位/五高度、颜色词、Fill 关系和 hard / medium-soft / soft 可观察结果，不发送未经模型验收的裸角度、Kelvin/Hex、EV 或角尺寸数值。编译器无法判断输入场景类型时采用保守接影策略，只调整现有表面支持的投影，不为了展示方向新增地面、墙影或光斑。

确认时不导出或上传 PNG/JSON。一次 Canvas Mutation 创建来源下游的图片 Generation Node 和一条 `input` Connection，把英文 Prompt 直接写入新 Node 的 Composer，并在来源与新 Node 上持久化同一 `metadata.lightingIntent`。新 Node 被选中且 Composer 打开，但该流程不创建 Generation Run、Pending Node 或 Generation Output。再次从操作过的 Image Node 打开时，从该 Node 恢复已保存的 Lighting Intent 继续微调。

写回失败保留 Dialog 状态，不修改来源、Node 或 Undo；取消、关闭、Escape、成功和 DOM 断连都必须释放 WebGL Context、Geometry、Material、ResizeObserver、Pointer 监听和 animation frame。

## 验收

- 入口只在兼容的 Image Node 与权限状态下出现。
- 四个 Preset 的初始、编辑、运行、成功、失败、关闭和目标失效状态完整。
- Keyboard 可以完成 Dialog 主任务，Focus 关闭后返回工具栏入口。
- Outpaint 预览几何与提交参数一致，源图不被覆盖。
- Angle Control 的可见值、Prompt 与 Provider 参数一致。
- Lighting Reference 的单球预览与英文 Prompt 使用同一左右坐标约定，Source Size 有可见像素变化；默认英文 Prompt 使用 G4.1 语义结构且不暴露未经验证的精确数值；确认时没有媒体上传或文件下载。
- Model Preset 结果通过 Generation Run、Target Guard 和 Canvas Mutation 写回；Lighting Reference 直接通过一次 Canvas Mutation 写回，并可在协作端收敛。

代表性测试：`tests/test_smart_canvas_outpaint.py`、`tests/test_infinite_canvas_ui_reverse_prompt_dialog.py`、`tests/test_issue_178_lighting_reference.py`、`tests/ai_processor_dialog_presets_browser_smoke.cjs`、`tests/smart_canvas_reverse_prompt_dialog_browser_smoke.cjs`、`tests/issue_178_lighting_reference_browser_smoke.cjs`。
