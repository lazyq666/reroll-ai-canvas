# ADR-0009: 统一模型能力目录作为生成约束权威

- Status: Accepted
- Date: 2026-09-04

## Context

图片、视频和文字生成各自已有部分能力规则，但身份、状态和限制表达不同。前端也保留了固定数量、兼容默认值和局部校验，导致同一个 Provider / Model 在界面、任务入口和适配器处可能得到不同答案。目录刷新期间如果请求只记住模型名称，也无法证明一次 Generation Run 使用了哪一版约束。

能力来源并不总是完整：有些来自项目维护资料，有些来自 Provider 的结构化响应，还有些只能明确标记为未确认。价格、额度和消耗属于另一类产品与数据责任，本期不需要进入能力判断。

## Decision

建立统一的 Model Capability Catalog，以 `Provider + Model + Model Operation` 作为能力身份，并为每项能力提供统一外层合同：Schema 版本、目录 Revision、Model Capability State、来源元数据、输入、输出和参数定义。图片、视频和文字的专有合同仍由各自模块拥有，通过统一外层合同暴露，不把所有媒体差异压成一套宽泛参数。

Model Capability State 只允许 `supported` 和 `unknown`：前者表示目录已有确认依据，后者表示尚未确认。它是内部目录事实，不作为用户界面标签，也不承载“不支持”、实验成熟度、实时 Provider 可用性或账号资格；具体输入和参数是否合法由合同中的数量、枚举和值域表达。

能力维护采用 Evidence → Draft → Review → Publish 的单向边界。Provider 文档、结构化 API、CLI 帮助或工作流 Schema 先保存为可追溯的 Model Capability Evidence；自动提取只能产生 Model Capability Draft，不能直接改写正式目录。Administrator 在独立的模型能力工作台核对字段与逐字段证据后，才能整体发布新的目录 Revision。重新采集发现变化时同样产生差异草稿，不覆盖正在服务的版本。

模型能力工作台记录属于 Instance State：它服务于安装级 Administrator 和所有 Workspace 共用的运行目录，不随 Workspace 内容搬迁，也不进入 Device Cache 或 Provider 秘密。Evidence、Draft、Review 和 Published 投影保存在同一个原子替换的版本化状态文件中；运行目录 Revision 只计算 Published 能力投影，保存 Evidence、编辑 Draft 或退回审核都不能改变生成合同。发布写入和运行目录激活作为一个模块操作执行；激活失败时恢复发布前状态并继续服务上一 Revision。

Model Capability Review State 与 Model Capability State 分离。前者描述草稿、待审核、已发布和已退回等内部维护进度；后者仍只描述是否已有依据确认某项操作受支持。一次审核可以确认资料仍不足，因此审核完成并不自动把 `unknown` 改为 `supported`。

Smart Canvas 使用同一目录渲染合法设置并在提交前预检；服务端在进入 Provider Adapter 前使用同一目录再次校验。前端不是能力权威，缺少精确资料时目录记录 `unknown`，前端只使用保守合同，不得从模型名称推断为已确认支持。

目录刷新采用“完整校验后整体发布”的最后有效快照。失败时继续服务上一 Revision，并向管理员状态接口保留失败信息。一次 Generation Run 冻结目录 Revision；提交缺少 Revision 或携带的 Revision 已过期时，服务端都拒绝请求，不代填当前版本。客户端必须重新加载目录、按新能力检查设置后再提交。

一次用户生成意图对应一个 Generation Run。图片生成数量是该 Run 的总输出数量；前端不能为绕过合同而拆成多个 `n=1` 请求。Provider 不支持原生多输出时，执行层可以在同一 Run 内拆成可恢复的子请求，但不改变用户意图、幂等边界或目录校验单位。

目录合同禁止加入价格、计费、额度或消耗字段。本决定也不新增任何此类持久化参数。

## Alternatives considered

- **继续维护三套媒体 API 和前端固定值**：改动较小，但无法保证同一模型身份、状态、Revision 和生成前拦截一致。
- **把全部媒体参数合并为一张扁平表**：查询简单，但会削弱图片、视频和文字各自的强类型边界，并使新增能力不断扩大公共接口。
- **只相信前端校验**：交互响应快，但旧客户端或手写请求仍可绕过限制。
- **刷新失败时发布部分新数据**：可以让部分更新更快生效，但同一次运行可能观察到混合 Revision，无法审计。
- **把价格和消耗并入能力目录**：减少一次查询，却把生成约束与商业核算耦合；本版本没有该产品需求。

## Consequences

- 新媒体能力必须先选择明确 Model Operation，并映射到统一外层合同。
- 前端控件与后端校验共享 Revision；固定上限和静默截断不再是合法降级方式。
- 缺少 Revision 的旧客户端会收到可恢复的目录变化错误，而不是由服务端猜测并代填当前版本。
- 多输出图片在一个 Generation Run 中校验总数；内部子请求不是新的用户意图。
- 媒体专用模块可以独立演进，但必须通过目录边界提供两态确认程度和具体约束。
- 用户界面不展示 Model Capability State；只有参数缺失、超限或目录 Revision 变化等可操作问题才反馈给用户。
- 自动采集、缓存和定时刷新可以后续加入，而不改变调用方接口。
- 自动提取是录入辅助，不是能力事实权威；缺少证据的字段必须保持空白或未确认。
- 工作台状态属于 Instance State；Workspace 搬迁、Device Cache 清理或 Provider 凭证更新不改变审核记录。
- 每个 Draft 已填写的叶子字段必须绑定同一 `Provider + Model + Model Operation` 身份下的 Evidence 和置信度；矛盾上下限或禁止字段不能进入审核。
- 模型能力工作台是 Administrator 的维护界面；普通生成界面不读取或展示 Review State、Evidence 置信度或内部确认标签。
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
