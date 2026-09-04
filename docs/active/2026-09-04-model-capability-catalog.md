# 统一模型能力目录

- **Status**：Implementing（统一运行合同和手工 Evidence → Draft → Review → Publish 后端闭环已实现；下一步建设 Administrator 工作台界面，之后再接 AI 填表、自动采集与定时刷新）
- **Feature ID**：F08；关联 F05 / F09 / F12
- **Last verified**：2026-09-04；工作台/目录/媒体/生成恢复/应用组合专项 126 项，文档地图与相邻路由专项 51 项，3,128 个国际化键和三图单 Run 浏览器烟测通过；此前全项目 1882 项测试仍有 6 项非本功能专项失败，三栏 Administrator UI 与自动采集尚未完成，暂不进入 Review
- **Applies to**：[Issue #32](https://github.com/lazyq666/reroll-ai-canvas/issues/32)
- **Related ADRs**：[ADR-0009](../adr/0009-unified-model-capability-catalog.md)
- **Domain terms**：Provider、Model、Model Operation、Model Capability、Model Capability State、Model Capability Evidence、Model Capability Draft、Model Capability Review、Model Capability Review State、Model Capability Catalog、Generation Settings、Generation Run

## 1. 目标

为图片、视频和文字生成建立同一个能力查询与校验入口。用户选择模型后只看到当前能力允许的设置；输入或参数不合法时，在创建任务前得到明确原因。服务端执行相同校验，旧界面或手写请求不能绕过。

每项能力由 Provider、精确 Model ID 和 Model Operation 唯一识别，并携带 Schema 版本、目录 Revision、状态、来源、输入、输出和参数合同。媒体特有结构保留强类型子合同。

## 2. 非目标

- 本版本不显示、采集、保存或返回价格、计费、额度、积分、消耗等数据。
- 不根据模型名称猜测能力，不把 `unknown` 自动当成已支持。
- 不在本阶段承诺所有 Provider 都有在线结构化能力接口。
- 不改变 Provider 凭证、账号权限或 Generation History 的既有数据责任。

## 3. 参与者与权限

| Actor | 能力 |
| --- | --- |
| Administrator / Designer | 查询选中模型的公开能力；按能力生成；收到可修正的前置错误 |
| Administrator | 查看目录与审核状态；记录 Evidence；创建、提交、退回和发布 Draft；触发人工刷新 |
| Guest / Anonymous Share Visitor | 不获得新的生成或管理权限 |

能力目录不替代 Role、Project Access Grant、Canvas Visibility 或 Provider 凭证检查。

## 4. 合同与状态

支持的 Model Operation 至少包括 `text.generate`、`image.generate`、`image.edit`、`image.layer_decomposition` 和 `video.generate`。Model Capability State 只表达目录的内部确认程度：

- `supported`：已有确认依据；
- `unknown`：尚未确认。

状态不展示给用户，也不表达“不支持”、实验成熟度、实时 Provider 可用性或账号资格。具体输入或参数能否使用，由数量上下限、枚举和值域表达；用户只在设置实际不合法时看到可操作的错误。

统一合同必须包含 `capability_schema_version` 和 `catalog_revision`。图片、视频、文字的输入数量、输出边界和参数类型使用各自的明确结构；未声明项不能被界面自行补成“支持”。

### 4.1 图层拆分专用合同

`image.layer_decomposition` 是独立的 Model Operation，不能复用 `image.generate` 或 `image.edit` 的通用画幅与输出合同。首个确认能力身份是 `apimart + seedream-5-0-pro + image.layer_decomposition`：

- `image` 输入恰好一个，角色为 `source`；可选 `text` 输入最多一个，作为拆分要求；视频、音频和文件输入均为零。
- 参数只包含 `resolution_tier` 与 `count`。Resolution Tier 只允许 `auto / 1K / 1.5K / 2K`，默认 `2K`；`count` 的最小值、最大值和默认值均为 `1`，且不作为可编辑控件。
- 不声明 `aspect_ratio`、精确像素尺寸、`4K`、普通图片质量、透明背景开关或其他生成参数。Model Operation 本身表达拆层意图，Provider Adapter 负责映射为上游 `layer_decomposition: true`，客户端不另传一个可关闭的同名布尔参数。
- 输出 `kind` 为 `image_layer_decomposition`，一次 Generation Run 产生一个结构化结果：一张 PNG 底图和一个版本化 Layer Decomposition Manifest。
- Manifest 固定记录来源媒体、Provider、Model、Resolution Tier、Generation Run、上游任务、创建时间、底图 Managed Media、画布尺寸，以及 `1–16` 个透明 PNG 图层。每层固定记录 Managed Media、名称、描述、`z_index`、`left/top/right/bottom` 顺序的绝对像素坐标和 `0–1000` 归一化坐标、像素宽高与输出格式。
- 可选 `provider_raw_metadata` 只能保存有大小上限且已经脱敏的诊断快照；不得保存 API Key、签名 URL 中的秘密或无界上游响应。

该合同是 Issue #31 Provider 接入、Manifest 持久化和 Smart Canvas 重建的前置权威；只有合同落地不代表拆层请求、下载或画布交付已经实施。

## 5. 用户可观察行为

1. 图片生成数量按能力合同展示，不使用全局固定上限。
2. 切换模型后，超出新上限的旧数量保留为“超出当前范围”，用户可以重新选择；系统不静默截断。
3. 图片、视频和文字提交均携带当前目录 Revision。Revision 缺失或已变化时，服务端返回“模型能力已更新”，不代填当前版本，也不创建 Generation Run；客户端重新加载目录并按新合同检查后才可重试。
4. 输入类型、单项数量、跨媒体总量、跨媒体依赖、首尾帧角色/顺序或参数超限时返回结构化错误；前端提供中英文可读提示。
5. 一次图片生成意图只创建一个 Generation Run，`count` 是该 Run 的总输出数。Provider 不支持原生多输出时只能在 Run 内拆成子请求，不能把一个用户意图拆成多个 Run 绕过总量校验。
6. 已提交的 Generation Run 元数据冻结 Model Operation、目录 Revision 和能力 Schema 版本。

## 6. 刷新、失败与恢复

- 当前阶段从随版本发布的图片、视频、文字维护文件建立快照；管理员可以查看状态并人工刷新。
- 刷新必须先完整解析、检查 Schema，并拒绝任何价格或消耗字段，再整体发布新的 Revision。
- 解析失败时保留上一份有效快照和 Revision，状态接口记录错误；正在服务的请求不读取半份新目录。
- 浏览器查询失败时内部使用 `unknown` 回退和保守合同，不伪造已确认状态，也不展示状态标签。
- 后续阶段补充 Provider 文档/API 采集、缓存、退避重试、定时刷新和过期时间；完成前本规格保持 Active。

## 7. 能力资料填表与审核工作台

能力维护的最小单位是 `Provider + Model + Model Operation`，不能只按模型整体填表。同一个 Model 的文字生成、图片生成、图片编辑或视频生成必须分别保留证据和审核结论。

### 7.1 单向维护流程

1. **建立字段规范**：先固定统一外层合同及媒体专用字段，未定义字段不能由采集器自行扩展。
2. **采集 Evidence**：按 Provider 类型读取官方文档、结构化模型 API、CLI 帮助/版本资料或工作流 Schema，并保存来源地址或命令、取得时间、适用版本、内容摘要和可定位的原文位置。
3. **AI 生成 Draft**：AI 按一条 `Provider + Model + Model Operation` 记录逐字段提取；每个填写值都要关联 Evidence 和置信度，资料未说明时保持空白，不允许猜测。
4. **确定性校验**：提交人工审核前检查 Schema、字段类型、枚举、最小/最大关系、重复身份、资料冲突和禁止字段。
5. **人工 Review**：Administrator 在模型能力工作台查看证据、编辑表单、保存草稿、提交审核、退回或批准发布。
6. **原子 Publish**：批准后整体生成新的 Catalog Revision。重新采集只生成与已发布版本的差异草稿，不能直接覆盖当前目录。

当前后端闭环已经实现上述手工流程：Evidence 创建后不可由 Draft 偷换身份；Draft 每个已填写叶子字段必须绑定同一身份的 Evidence 与置信度；只有 `draft/returned → in_review → published` 的合法状态转换可以发布。草稿基于的 Catalog Revision 已过期时返回冲突；运行目录激活失败时回滚 Published 状态并继续使用上一 Revision。

自动提取不是能力事实权威。模型列表 API 可能只提供名称，CLI 帮助可能只描述命令，家族级文档也不一定证明某个精确模型的限制；这些情况下相关字段保持空白，Model Capability State 保持 `unknown`。审核完成也不自动等于 `supported`。

### 7.2 状态与时间分离

- Model Capability State 仍只有 `supported` / `unknown`，回答“是否有依据确认支持”。
- Model Capability Review State 只用于内部工作台，包含草稿、待审核、已发布和已退回，回答“维护流程进行到哪一步”。
- 生成界面不显示上述状态；仅根据已发布合同渲染控件和校验设置。
- Evidence 记录 `fetched_at`；Review 记录 `reviewed_at` 和审核人；确认支持时记录 `confirmed_at`；目录生效时记录 `published_at`。

### 7.3 工作台最小界面

- 左栏：Provider、Model、Model Operation 和 Review State 列表。
- 中栏：按身份、输入、输出和参数分组的可编辑表单。
- 右栏：逐字段 Evidence、原文位置、AI 提取依据、冲突提示及与当前已发布版本的差异。
- 操作：保存草稿、提交审核、退回修改、批准并发布。

后端已提供 Administrator-only 接口：

- `GET /api/admin/model-capability-workbench`：读取 Evidence、Draft、Review State、Published 投影和当前目录状态；
- `POST /api/admin/model-capability-evidence`：记录可追溯 Evidence；
- `PUT /api/admin/model-capability-drafts`：创建或继续编辑 Draft；
- `POST /api/admin/model-capability-drafts/{draft_id}/submit`：提交审核；
- `POST /api/admin/model-capability-drafts/{draft_id}/return`：附理由退回修改；
- `POST /api/admin/model-capability-drafts/{draft_id}/publish`：按预期 Revision 批准并原子激活。

页面级三栏工作台尚未实现，因此本规格仍为 Implementing。

工作台和采集层都禁止创建、保存或发布价格、金额、货币、计费、额度、Token/积分消耗字段；即使来源资料包含这些章节，也必须在提取前过滤并由 Schema 再次拒绝。

### 7.4 实施顺序

1. 手工 Evidence、Draft、Review、Publish 后端数据边界已实现；下一步用现有接口完成 Administrator 三栏工作台。
2. 再接入 APIMART 等文档/API，以及即梦 CLI、GPT/Codex CLI 的首批资料采集适配器。
3. 在稳定表单 Schema 上增加 AI 自动填表；逐字段 Evidence 与置信度绑定已经由后端强制执行。
4. 最后增加周期复查、差异草稿、退避与过期提醒。

## 8. 数据责任

能力目录是随产品发布或由受控采集更新的运行约束，不属于 Canvas 内容、Workspace 创作数据或 Generation History。工作台 Evidence、Draft、Review 与 Published 投影属于 Instance State，保存在 `<instance-state>/model-capability-workbench.json`，不随 Workspace 搬迁。Generation Run 只冻结用于复现校验的 Model Operation、Schema 版本和目录 Revision；Revision 只计算 Published 投影，不计算 Evidence 或未发布 Draft。

本期不得新增任何价格、金额、货币、计费单位、额度余额或消耗量字段；也不得把它们放入目录资源、后端响应、运行快照或持久化记录。

## 9. 验收

- 三种媒体通过同一查询接口返回一致的外层身份与 Revision。
- 公开合同中的 Model Capability State 只有 `supported` 和 `unknown`；未知模型不会被当成已确认。
- 图片数量、文字历史/图片/视频输入和视频参数超限均在 Provider 调用前被拒绝。
- 前端与后端对同一合同给出相同结论；过期 Revision 优先返回目录变化错误。
- 刷新成功产生新 Revision；刷新失败继续返回上一有效能力。
- 中英文错误文案完整，能力状态不渲染到用户界面，能力模块在媒体专用模块之前加载。
- 对公开能力合同和资源进行禁止字段回归，确认没有价格或消耗数据。
- AI 提取不能直接发布；每个自动填写值可以回到具体 Evidence，资料缺失时不会补猜测值。
- Review State 与 Model Capability State 分离；已审核但证据不足的记录仍可保持 `unknown`。
- 重新采集只产生差异草稿；批准发布前不会改变当前 Catalog Revision。
- 手工 Evidence 与 Draft 可在重启后恢复；每个填写值均绑定同身份 Evidence，矛盾上下限和禁止字段被拒绝。
- 只有待审核 Draft 可以发布；旧 Revision 发布冲突和目录激活失败都不会替换上一有效目录。
- 完成自动采集/缓存/定时刷新后，再进行 Light/Dark、键盘、窄屏、真实 Provider 和失败恢复的页面级验收，并评估毕业为 Current。

## 10. 代表性验证入口

- `tests/test_model_capabilities.py`
- `tests/test_model_capability_api.py`
- `tests/test_model_capability_workbench.py`
- `tests/test_smart_canvas_model_capabilities.py`
- `tests/test_image_capabilities.py`
- `tests/test_video_capabilities.py`
- `node static/js/i18n/validate-i18n.js`

## 11. 消融实验记录

2026-09-04 以当前未提交实现为基线，使用临时探针分别移除一项边界，再运行相同的图片、视频和文字场景。实验不直接修改正式代码。

| 消融项 | 观察结果 | 当前结论 |
| --- | --- | --- |
| 从运行时能力对象递归移除 `support_state`、来源和确认时间 | 4/4 组校验结果完全相同；首轮样本共移除 56 处 `support_state` | 这些数据不参与生成合法性判断。已先删除输入和参数中的重复状态，只保留每条 Model Capability 顶层两态；相同样本现只剩 4 处顶层状态。来源元数据是否移出运行合同留到管理员投影实验决定 |
| 移除 Catalog Revision 比对 | 过期 Revision 原本返回 `catalog_changed`；不提供 Revision 时旧实现却会通过 | Revision Guard 已改为 fail-closed：缺失与过期均拒绝。恢复路径固定为客户端重新加载目录后重试，服务端不代填 |
| 绕过服务端统一能力校验 | 超出合同上限的图片数量 5 可以进入 Image Generation Run | 服务端校验是必要权威，不能依赖浏览器 |
| 不加载前端统一能力校验 | 用户请求 5 张图片时旧实现会拆成 5 个 `n=1` 请求并全部提交 | 图片提交已改为一个用户意图、一个 Generation Run，并以总 `n` 在服务端校验；输出仍按独立 Pending Node 投射 |
| 只保留图片统一参数校验，消融旧图片合法性判断 | 统一层仍同时拒绝非法画幅、分辨率和透明 PNG | 已删除旧图片层的重复合法性判断；尺寸匹配、比例换算等媒体算法保留，但不再成为第二份约束权威 |
| 只保留视频统一数量校验，消融视频专用组合规则 | Seedance 2.0 仅提供音频时，旧统一层判定通过，专用层以 `visual-reference-required` 正确拒绝 | 统一 `input_rules` 已能表达参考素材总量、音频依赖视觉参考、首尾帧角色与互斥输入；专用层仍保留，待更多模型组合回归证明覆盖等价后再删除 |

下一轮实验优先验证：

1. 把 Model Capability State 和来源元数据从运行合同移到独立管理员投影后，现有生成链路、媒体专用能力和审核需求能否同时成立。
2. 扩充视频模型组合样本，比较统一 `input_rules` 与专用校验的判定集合；确认完全等价后再删除专用权威。
3. 为缺少 Revision 的真实旧页面/长时间驻留页面补充浏览器恢复验证，确保重新加载目录后的重试路径可理解且不重复提交。
