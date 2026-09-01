# Batch Generation 结果画廊模型身份

- **Status**：Current
- **Feature ID**：F11
- **Owners**：产品 / UI / 前端 / 测试
- **Last verified**：2026-08-27
- **Applies to**：Batch Generation 专用工作台的批次详情
- **Supersedes**：无
- **Superseded by**：无
- **Related ADRs**：无
- **Domain terms**：Model、Provider、Generation Run、Generation Output、Workspace Data

## 1. 当前行为

批次详情默认使用结果画廊浏览 Generation Output。每张结果卡片在无需 Hover、选择或打开预览的情况下，持续显示该输出所属任务的模型身份，形式与模型选择器一致：Provider 图标加模型显示名称。

模型显示名称使用批次开始时冻结到任务中的名称快照。管理员随后修改模型名称，不回写已经创建的批次；历史结果继续表达生成时实际确认的配置。

## 2. 用户与权限

能够读取一个批次的用户可以看到其结果和模型身份；本能力不扩大 Batch Generation 原有的 owner、Administrator 或 Workspace 权限。无权读取批次的人不能通过结果画廊查询模型、任务或输出信息。

## 3. 功能规则

1. 每个已经交付到结果画廊的 Generation Output 都显示所属任务的模型身份。
2. 模型身份由 Provider 图标和任务的模型显示名称组成，并复用模型选择器使用的图标解析规则。
3. 显示名称优先使用任务快照中的 `model_name`；旧批次没有该值时回退到稳定的模型标识。
4. 无法识别 Provider 或 Model 时显示公共模型 fallback 图标，不留下空白图标坑位。
5. 长名称可以在卡片宽度内截断，但完整名称必须可由可访问文本或标题读取。
6. 模型身份常驻显示；Hover 提示、图片双击/键盘预览和单张下载不能成为读取模型身份的前提。
7. 一项任务产生多个 Generation Output 时，每个结果卡片都显示相同的任务模型快照。
8. 添加模型身份不得改变结果数量、下载地址、预览顺序或任务列表内容。

## 4. 数据与接口

批次任务中的 `provider_id`、`model` 和 `model_name` 属于冻结的 Batch Snapshot / Workspace Data。结果画廊继续通过现有批次详情读取合同取得任务和输出，不新增 HTTP、WebSocket 或 Provider 接口，也不在浏览器中实时查询当前模型名称来覆盖历史快照。

## 5. 设计系统合同

- 图标复用公共 Model Vendor Icons 表示，不维护结果画廊专用 Provider 映射。
- 名称、图标、间距、文字颜色和截断使用现有语义 Design Tokens。
- Light 与 Dark 主题使用同一结构；单色 Provider 图标继续遵守公共暗色适配。
- 结果卡片保留现有 Focus、双击预览、Enter / Space 预览和下载操作。

## 6. 验收

| 场景 | 最高测试接缝 | 预期行为 |
| --- | --- | --- |
| 自定义名称 | 真实批量生成页面 + 模拟批次 HTTP 响应 | 结果卡片显示 Provider 图标和冻结的自定义名称，不显示底层模型标识 |
| 旧数据回退 | 真实批量生成页面 + 缺少 `model_name` 的任务 | 显示模型标识和公共 fallback 图标 |
| Light / Dark | 真实页面浏览器验收 | 两种主题下模型身份在无 Hover 状态可见 |
| 相邻交互 | 真实页面浏览器验收 | 输出数量、下载动作和双击预览保持可用 |

自动化入口：

```bash
node tests/issue_87_batch_result_gallery_model_browser_smoke.cjs
```

## 7. Traceability

- Requirement：GitHub Issue #87
- Product map：[F11 Batch Generation 与专用工作台](../PROJECT-MAP.md#功能规格注册表)
- UI surface：`/static/online.html` 的批次详情结果画廊
- Browser acceptance：`tests/issue_87_batch_result_gallery_model_browser_smoke.cjs`
- Regression neighbors：批次任务列表、批次历史、图片预览、单张下载、模型选择器

## 8. Change log

| Date | Status | Change | Evidence |
| --- | --- | --- | --- |
| 2026-08-27 | Current | 结果画廊常驻显示 Provider 图标和生成时冻结的模型名称 | Issue #87 浏览器验收通过 |
