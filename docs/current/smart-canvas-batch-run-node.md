# Smart Canvas 批量运行节点

> Status: Current  
> Last verified: 2026-08-26  
> Applies to: Smart Canvas 的 Batch Run Node（批量运行节点）

## 用户合同

Smart Canvas 将原“循环节点”呈现为“批量运行”。它按任务序号替换参考图变量和提示词变量，并复用现有 Smart Cascade / Generation Run 执行下游流程。它不是 Batch Generation 工作台，也不创建持久的 Generation Batch。

节点采用紧凑的节点内布局：

1. 头部显示“批量运行”和“按顺序替换输入并运行下游流程”。
2. “变量”区显示“参考图变量”“提示词变量”及各自选项数；开关继续决定对应变量是否参与执行。
3. 组合规则固定显示为“按顺序配对，较短列表从头重复”。首版不提供“全部组合”。
4. “执行”区提供“依次执行 / 并发执行”“每任务图片数”“任务序号”和“任务数量”。
5. 底部显示“将运行 N 个任务”，主要操作显示“运行 N 个任务”；运行中改为“停止批量运行”，停止请求处理中显示“正在停止批量运行…”。

提示词变量展开后继续使用现有 Prompt Composer。用户可以新增、删除提示词选项，并插入界面名为“任务序号”的 Token；已保存的 `《计数》` 与 `[计数]` 内容继续有效。

## 配对与任务数量

- 参考图与提示词都按任务序号顺序取值；任一列表到末尾后从第一个选项继续。
- “每任务图片数”大于 1 时，同一任务从当前参考图开始顺序取多张；到列表末尾后同样从头继续。
- 提示词同时来自上游与节点内选项时，两组提示词各自按顺序循环，并在同一任务中组合。
- 首版任务数量只由用户设置的“任务数量”决定，不根据变量选项数自动计算。
- “任务序号”决定本次运行从哪个序号开始；它不改变已保存的数据结构。

## 状态、失败与恢复

| 状态 | 节点表现 | 用户操作 |
| --- | --- | --- |
| 默认 | 显示变量、执行设置、任务汇总和运行按钮 | 调整设置或运行 |
| 变量关闭 | 对应编辑区折叠，已保存选项保留 | 再次开启后继续编辑 |
| 参考图为空 | 显示 0 个选项并提示连接上游图片 | 连接输入或关闭参考图变量 |
| 运行中 | 运行按钮变为停止操作 | 请求在当前任务后停止 |
| 正在停止 | 停止按钮禁用并显示停止中 | 等待当前任务结束 |
| 无可运行链路 | 保留节点配置并显示错误反馈 | 连接下游图片链路后重试 |

失败、恢复、日志、输出写回和权限继续遵循 [Generation Pipeline](generation-pipeline.md)；本界面不维护第二套任务状态。

## 数据与兼容边界

- 持久 Node 身份继续是 `smart-loop`，公共 Node `kind` 继续是 `loop`。
- 继续使用 `count`、`mode`、`showPrompt`、`imageInput`、`loopStart`、`imageBatchSize` 和 `variablePrompts`。
- `serial / parallel` 与 `《计数》` 继续作为兼容存储值；界面分别翻译为“依次执行 / 并发执行”和“任务序号”。
- 现有 Canvas Persistence、Connection、`fitSmartLoopNode`、Generation Run 与停止/状态查询合同保持不变，不需要数据迁移。

## 非目标

- 不根据变量数量自动派生任务数量。
- 不提供预计输出图片数、任务清单检查或任务预览。
- 不提供“全部组合”。
- 不接入 Batch Generation 后端、批次历史或工作台调度。
- 不新增独立的批量任务系统。

## 验收

- 静态合同确认节点继续使用现有 `ic-*` 控件和 `data-loop-*` 选择器，没有新增预览/批次入口。
- 浏览器回归覆盖变量开关、选项数、配对循环、依次/并发、三个数字设置、动态任务文案、提示词编辑与 Token、Light/Dark、Pointer 和 Keyboard。
- Nodes 组件库继续通过生产 Smart Canvas Fixture 展示 Batch Run 的依次与并发状态，不复制节点实现。

代表性测试：`tests/test_smart_canvas_node_components.py`、`tests/smart_canvas_loop_node_controls_browser_smoke.cjs`、`tests/smart_canvas_node_components_browser_smoke.cjs`。
