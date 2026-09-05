# ADR-0009: 统一模型能力目录作为生成约束权威

- Status: Accepted
- Date: 2026-09-04
- Amended: 2026-09-05：移除独立资料刷新，只保留模型拉取中的能力提取；导入按当前编辑器合同校验。

## Context

图片、视频和文字生成各自已有部分能力规则，但身份、状态和限制表达不同。前端也保留了固定数量、兼容默认值和局部校验，导致同一个 Provider / Model 在界面、任务入口和适配器处可能得到不同答案。目录刷新期间如果请求只记住模型名称，也无法证明一次 Generation Run 使用了哪一版约束。

能力来源并不总是完整：有些来自项目维护资料，有些来自 Provider 的结构化响应，还有些只能明确标记为未确认。价格、额度和消耗属于另一类产品与数据责任，本期不需要进入能力判断。

## Decision

建立统一的 Model Capability Catalog，以 `Provider + Model + Model Operation` 作为能力身份，并为每项能力提供统一外层合同：Schema 版本、目录 Revision、Model Capability State、来源元数据、输入、输出和参数定义。图片、视频和文字的专有合同仍由各自模块拥有，通过统一外层合同暴露，不把所有媒体差异压成一套宽泛参数。

Model Capability State 只允许 `supported` 和 `unknown`：前者表示目录已有确认依据，后者表示尚未确认。它是内部目录事实，不作为用户界面标签，也不承载“不支持”、实验成熟度、实时 Provider 可用性或账号资格；具体输入和参数是否合法由合同中的数量、枚举和值域表达。

能力维护采用 Evidence → Draft → Review → Publish 的单向边界。Provider 文档、结构化 API、CLI 帮助或工作流 Schema 先保存为可追溯的 Model Capability Evidence；外部研究结果和自动采集只能产生待核对数据，不能绕过 Administrator 直接改写正式目录。Administrator 从可用模型中的模型详情核对字段与证据后，才能整体发布新的目录 Revision。重新采集发现变化时同样产生差异草稿，不覆盖正在服务的版本。

API 设置页拉取模型时同时形成一次有界、脱敏的 Model Discovery Snapshot，并把其中可确定映射的字段交给同一 Evidence / Draft 边界。首批仅覆盖 Dreamina、Gemini API 与 APIMART：Dreamina 复用本次拉取已读取的 CLI 帮助和版本，不重复执行命令；Gemini API 只保留 `/models` 返回的生成方法、输入/输出 Token 上限和采样默认值等结构化字段，并以 `unknown` 草稿等待人工确认 Model Operation；APIMART 官方域名使用 `/v1/models?expand=parameters` 同时取得类别、能力标签与有界 JSON Schema，并在模型列表包含 `seedream-5-0-pro` 时继续读取既有的严格 Markdown 来源。能力采集失败不得把一次成功的模型列表拉取变成失败。

模型能力工作台记录属于 Instance State：它服务于安装级 Administrator 和所有 Workspace 共用的运行目录，不随 Workspace 内容搬迁，也不进入 Device Cache 或 Provider 秘密。Evidence、Draft、Review 和 Published 投影保存在同一个原子替换的版本化状态文件中；运行目录 Revision 只计算 Published 能力投影，保存 Evidence、编辑 Draft 或退回审核都不能改变生成合同。发布写入和运行目录激活作为一个模块操作执行；激活失败时恢复发布前状态并继续服务上一 Revision。

Model Capability Review State 与 Model Capability State 分离。前者描述草稿、待审核、已发布和已退回等内部维护进度；后者仍只描述是否已有依据确认某项操作受支持。一次审核可以确认资料仍不足，因此审核完成并不自动把 `unknown` 改为 `supported`。

Reroll 不内置 AI 搜索或 AI 填表执行器。确定性 Model Discovery Snapshot 先减少可直接取得字段的人工查找量；剩余缺口由 Administrator 在 ChatGPT、Codex 或其他外部研究工具中使用工作台生成的查找要求补齐，再把结果作为版本化、Provider 无关的能力包导入。导入包必须逐字匹配当前 Model ID 与显示名称，每个确认的 Model Operation 都必须带可追溯官方来源；未明确的能力必须省略。Reroll 只负责格式校验、当前模型匹配、预览和原子应用，不持有外部 AI 会话，也不消耗其额度。

外部查找要求将 `match` 回填身份与 `research` 线索分离，不输出内部渠道 ID。渠道自定义名称、显示名称和纯数字 Model ID 不能当作公开身份；必须通过实际平台域名、官方模型目录或 CLI 版本映射核对。每个模型的可导入字段由服务端生成 JSON Schema，编辑器候选和导入校验使用同一合同；候选不等于已支持值。当前完整操作格式不表达未知字段，缺少任一必填事实就省略该操作，禁止用零值填空。校验保证身份、格式、枚举、范围及可表达性，不认证来源真实性；管理员仍负责核对。

Administrator 的产品界面不直接暴露上述维护实现，也不设置独立的“模型能力”页签或第二张模型表。可用模型已经按图片、视频和文字分类，并显示 Provider ID；每行最右侧的编辑动作按稳定 Model ID 打开模型详情，同一 Model ID 在多个 Provider 出现时进入同一份 Model Profile。图片模型详情只呈现一个“图片能力”区块；`image.generate` 与 `image.edit` 继续作为内部运行合同，参考图支持和最大数量作为同一区块的条件能力维护，不能因为 Provider 端点或命令不同而成为两个同级产品分类。Administrator 在详情 Dialog 中通过开关、单选和多选维护常用能力，矩阵模块把一次产品选择翻译为关联 Provider 的详细合同、人工 Evidence 与 Published 记录，并只激活一次 Catalog Revision。可用模型行只从当前运行目录投影少量高价值功能标签，首批为拆分图层与透明 PNG；未审核 Draft 不参与标签判断。可编辑显示名称不参与稳定身份，不同 Model ID 也不根据相似名称自动合并。

视频模型详情同样只呈现一个“视频能力”区块。产品投影明确维护图片、视频、音频和三者合计数量，单个与合计参考媒体时长、纯音频输入、输出时长、清晰度、画幅及附加能力；首尾帧视频和全能参考视频作为两个 Video Generation Mode 单独确认。矩阵模块把这些产品字段回写到统一 `inputs`、`input_rules`、`output`、`parameters` 和视频专有合同，Composer 只展示已保存为支持的模式，不能再从 Model 名称推断模式。

详情接口和外部研究包中的 `video` 对象只是面向产品表单的读写投影，不是第二份持久化能力合同。保存时直接更新上述统一合同和既有视频命令合同；Composer 直接消费命令合同，不再从中间“视频档案”重建运行参数。

同一 Model ID 的平台能力不一致时，产品表默认显示所有关联平台都能满足的安全交集：数量取较小上限，枚举取共同选项，布尔能力必须每个平台都明确支持。这样合并一行不会把某个平台的扩展能力误报为整个模型都可用；管理员明确保存的新选择才会作为同一模型规则应用到所有关联平台。

Smart Canvas 使用同一目录渲染合法设置并在提交前预检；服务端在进入 Provider Adapter 前使用同一目录再次校验。前端不是能力权威，缺少精确资料时目录记录 `unknown`，前端只使用保守合同，不得从模型名称推断为已确认支持。

运行目录仍采用完整校验后整体激活的最后有效快照。根据 2026-09-05 产品决定，移除独立资料检查入口、刷新 API、启动/周期调度、可配置 JSON 来源及其缓存和退避配置。资料提取仅由 API 设置页主动拉取模型触发，复用 Provider 响应与已读 CLI 帮助；不另起 CLI。APIMART 官方模型拉取包含 Seedream 5.0 Pro 时仍可读取其严格 Markdown 参数页作为本次拉取的补充，失败不影响模型清单。证据与草稿仍属于 Instance State，不自动发布。一次 Generation Run 冻结目录 Revision；提交缺少 Revision 或携带的 Revision 已过期时，服务端都拒绝请求，不代填当前版本。客户端必须重新加载目录、按新能力检查设置后再提交。

一次用户生成意图对应一个 Generation Run。图片生成数量是该 Run 的总输出数量；前端不能为绕过合同而拆成多个 `n=1` 请求。Provider 不支持原生多输出时，执行层可以在同一 Run 内拆成可恢复的子请求，但不改变用户意图、幂等边界或目录校验单位。

目录合同禁止加入价格、计费、额度或消耗字段。本决定也不新增任何此类持久化参数。

## Alternatives considered

- **继续维护三套媒体 API 和前端固定值**：改动较小，但无法保证同一模型身份、状态、Revision 和生成前拦截一致。
- **把全部媒体参数合并为一张扁平表**：查询简单，但会削弱图片、视频和文字各自的强类型边界，并使新增能力不断扩大公共接口。
- **只相信前端校验**：交互响应快，但旧客户端或手写请求仍可绕过限制。
- **刷新失败时发布部分新数据**：可以让部分更新更快生效，但同一次运行可能观察到混合 Revision，无法审计。
- **把价格和消耗并入能力目录**：减少一次查询，却把生成约束与商业核算耦合；本版本没有该产品需求。
- **在 Reroll 内置 AI 搜索与填表**：可以减少一次复制粘贴，但会把联网研究、模型选择、AI 额度和失败状态带入管理员产品；改为复制查找要求并导入固定格式结果。

## Consequences

- 新媒体能力必须先选择明确 Model Operation，并映射到统一外层合同。
- 前端控件与后端校验共享 Revision；固定上限和静默截断不再是合法降级方式。
- 缺少 Revision 的旧客户端会收到可恢复的目录变化错误，而不是由服务端猜测并代填当前版本。
- 多输出图片在一个 Generation Run 中校验总数；内部子请求不是新的用户意图。
- 媒体专用模块可以独立演进，但必须通过目录边界提供两态确认程度和具体约束。
- 用户界面不展示 Model Capability State；只有参数缺失、超限或目录 Revision 变化等可操作问题才反馈给用户。
- 模型发现资料仅由主动拉取模型触发，经确定性解析进入 Evidence / Draft；保存并应用仍是目录发布边界。
- API 设置的模型拉取可以顺带创建 Model Capability Evidence 与待审核 Draft；浏览器只得到汇总反馈，不得到内部快照或完整上游响应。
- 首批 Provider 范围固定为 Dreamina、Gemini API 与 APIMART；其他 OpenAI 兼容网关即使复用相同协议，也不能据此套用 APIMART 证据。
- 模型拉取中的 APIMART Markdown 补充只保留审核过的参数摘要；结构变化时本次来源失败，不产生宽松草稿。
- 不再创建、读取或写入资料来源缓存；去重使用已有 Evidence / Draft / Published，历史缓存可删除。
- 外部研究包只是录入载体，不是能力事实权威；缺少官方来源的能力不能导入，未确认项必须省略。
- 工作台状态属于 Instance State；Workspace 搬迁、Device Cache 清理或 Provider 凭证更新不改变审核记录。
- 可用模型列表是能力维护的唯一模型入口；图片、视频和文字分类、Provider ID 与显示顺序不在详情 Dialog 中重复。不能把“已有 Draft”误当成“已有 Model”；模型拉取仍返回本次资料与建议数量。
- 一次 Model Profile 保存要么同时更新所有关联 Provider，要么全部回滚；浏览器不负责逐平台拼接发布流程。
- 每个 Draft 已填写的叶子字段必须绑定同一 `Provider + Model + Model Operation` 身份下的 Evidence 和置信度；矛盾上下限或禁止字段不能进入审核。
- 可用模型中的模型详情 Dialog 是 Administrator 的能力维护界面；普通生成界面不读取或展示 Review State、Evidence 置信度或内部确认标签。可用模型行内功能 Tag 只表达当前目录已确认的高价值功能，不表达审核状态。
- 价格、额度和消耗若未来成为独立需求，需要另行定义领域和数据边界，不能直接扩展本目录。

## References

- [Issue #32](https://github.com/lazyq666/reroll-ai-canvas/issues/32)
- [Model Capability Catalog Active Spec](../active/2026-09-04-model-capability-catalog.md)
- [图片输出能力](../current/smart-canvas-image-output-capabilities.md)
- [当前生成链路](../current/generation-pipeline.md)
- `backend/infinite_canvas/model_capabilities.py`
- `static/js/smart-canvas/model-capabilities.js`
- `tests/test_model_capabilities.py`
- `tests/test_model_capability_api.py`
