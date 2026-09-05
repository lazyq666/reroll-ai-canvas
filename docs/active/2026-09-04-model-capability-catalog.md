# 统一模型能力目录

- **Status**：Implemented（统一运行合同、资料采集、按 Model ID 聚合的产品能力表和外部研究包导入已实现，等待产品验收后毕业为 Current）
- **Feature ID**：F08；关联 F05 / F09 / F12
- **Last verified**：2026-09-05；156 项模型能力、模型详情、API 设置与资源版本相关 Python 测试、8 项文档/i18n 回归、i18n 3388 keys 校验和真实 Chrome smoke 均通过；本机 Dreamina CLI 实际解析得到 24 条候选，APIMART 官方 Markdown 实际解析得到 1 条候选，二者均未发布。已验证无独立模型能力页签、图片与视频详情单一区块、视频参考素材数量/时长/模式完整回显与保存、Composer 模式投影、不支持参考模式时拒绝带参考素材提交、Composer 画幅与数量控件复用、多选分辨率、可用模型行内功能 Tag、无内置 AI 入口、查找要求复制、固定 JSON 粘贴、校验不写入、预览后应用、同 Model ID 跨平台原子发布、已保存值不被差异 Draft 预填、异常回滚、`image.layer_decomposition` 固定约束、Light/Dark、390px 窄屏和双语反馈
- **Applies to**：[Issue #32](https://github.com/lazyq666/reroll-ai-canvas/issues/32)
- **Related ADRs**：[ADR-0009](../adr/0009-unified-model-capability-catalog.md)
- **Domain terms**：Provider、Model、Model Profile、Model Discovery Snapshot、Model Capability Matrix、Model Operation、Model Capability、Video Model Capability、First-and-Last-Frame Video、All-around Reference Video、Model Capability State、Model Capability Evidence、Model Capability Draft、Model Capability Review、Model Capability Review State、Model Capability Catalog、Generation Settings、Generation Run

## 1. 目标

为图片、视频和文字生成建立同一个能力查询与校验入口。用户选择模型后只看到当前能力允许的设置；输入或参数不合法时，在创建任务前得到明确原因。服务端执行相同校验，旧界面或手写请求不能绕过。

每项能力由 Provider、精确 Model ID 和 Model Operation 唯一识别，并携带 Schema 版本、目录 Revision、状态、来源、输入、输出和参数合同。媒体特有结构保留强类型子合同。

## 2. 非目标

- 本版本不显示、采集、保存或返回价格、计费、额度、积分、消耗等数据。
- 不根据模型名称猜测能力，不把 `unknown` 自动当成已支持。
- 不在本阶段承诺所有 Provider 都有在线结构化能力接口。
- API 设置页的首批随拉取采集只覆盖 Dreamina、Gemini API 与 APIMART；其他 Provider 仍走外部研究和人工审核。
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

该合同已由 Issue #31 的 Provider 接入、Manifest 持久化和 Smart Canvas 重建消费。运行链路、恢复边界与图层交付以[当前生成链路](../current/generation-pipeline.md#44-智能分层的专用交付)为准；能力目录仍只负责声明和校验边界，不承担请求、下载或画布交付。

## 5. 用户可观察行为

1. 图片生成数量按能力合同展示，不使用全局固定上限。
2. 切换模型后，超出新上限的旧数量保留为“超出当前范围”，用户可以重新选择；系统不静默截断。
3. 图片、视频和文字提交均携带当前目录 Revision。Revision 缺失或已变化时，服务端返回“模型能力已更新”，不代填当前版本，也不创建 Generation Run；客户端重新加载目录并按新合同检查后才可重试。
4. 输入类型、单项数量、跨媒体总量、跨媒体依赖、首尾帧角色/顺序或参数超限时返回结构化错误；前端提供中英文可读提示。
5. 一次图片生成意图只创建一个 Generation Run，`count` 是该 Run 的总输出数。Provider 不支持原生多输出时只能在 Run 内拆成子请求，不能把一个用户意图拆成多个 Run 绕过总量校验。
6. 已提交的 Generation Run 元数据冻结 Model Operation、目录 Revision 和能力 Schema 版本。
7. API 设置页从 Provider 或 CLI 拉取的模型是可选候选；Administrator 明确取消或删除模型并保存后，渲染、保存和重新加载都保留该选择。CLI 默认模型只在首次添加平台或主动切换到对应 CLI 协议时初始化，不能覆盖后续人工选择。
8. Dreamina、Gemini API 或 APIMART 拉取模型成功后，状态栏同时反馈本次提取的能力资料数和新增待审核建议数；能力资料采集失败只显示附加提示，不丢失模型清单，也不阻止选择模型。
9. Model Profile 已经“保存并应用”后，保存状态按稳定 Model ID 判断；后续模型拉取产生的差异 Draft 只更新资料与审核计数，不把任何建议值填入该模型的产品能力表编辑器。只有尚未保存过的 Model Profile 才允许 Draft 作为首次填写建议。
10. 可用模型是能力维护的唯一模型列表：图片、视频和文字页签内的每一行在最右侧提供“编辑”，按 Model ID 打开模型详情 Dialog。页面不再提供独立“模型能力”页签，也不在详情中重复显示模型类型或平台；图片详情只显示一个“图片能力”区块，不把生成图片和编辑图片列成两个同级分类，参考图支持作为条件能力维护；视频详情只显示一个“视频能力”区块，维护各类参考素材数量与合计、单个与合计参考媒体时长、纯音频输入、输出时长、首尾帧视频和全能参考视频；Composer 只展示已保存为支持的视频参考模式，两个模式均不支持时拒绝携带参考素材创建任务；拆分图层和透明 PNG 作为行内功能 Tag 展示，并且只来自当前运行目录，不读取未审核 Draft。

## 6. 刷新、失败与恢复

- 随版本发布的图片、视频、文字维护文件仍是基础快照；管理员可以查看状态并人工检查来源。
- API 设置页每次模型拉取先形成内部 Model Discovery Snapshot，浏览器响应只返回资料数、建议数和失败摘要，不返回 Snapshot 或完整 CLI 帮助。首批适配如下：
  - Dreamina 复用同一次拉取中六个图片/视频命令的 CLI 帮助，并附本机版本；明确提取图片生成/编辑的 Model、输入图数量、输出数量、画幅和清晰度，以及视频的命令组合、参考素材数量、时长、画幅和分辨率。当前 `seedance2.5` 帮助只声明 `480p / 720p`，不得沿用旧的 `1080p` 推测。
  - Gemini API 复用 `/v1beta/models` 同一响应，只白名单保留 `supportedGenerationMethods`、输入/输出 Token 上限、采样默认值、版本和 Thinking 标记；不保存 description 或未知字段。`generateContent` 候选先以 `unknown` 和中等置信度进入 `text.generate` Draft，由人工确认输出类型及 Model Operation 后再发布。
  - APIMART 只在协议为 APIMART 且 Base URL 属于 `apimart.ai` / `apib.ai` 官方域名时，把模型请求升级为 `/v1/models?expand=parameters`，复用响应中的 `category`、`capability_tags` 和有界 `input_schema`，把标准参数的枚举、范围和默认值映射为待审核候选。若列表包含 `seedream-5-0-pro`，再读取其官方 Markdown；只有一张输入、像素/文件上限、拆层分辨率、单输出和结构化图层标记全部存在时生成图层拆分 Evidence 与 Draft。扩展 Schema 属于 best-effort，候选保持人工审核边界；页面结构变化或返回 HTML 时对应来源失败。复用 APIMART 协议的第三方网关不能继承这些证据。
- 启动时的 APIMART、Dreamina 和可配置公网结构化 JSON 来源继续使用 ETag / Last-Modified 条件请求与周期复查；模型拉取触发的采集使用同一个确定性解析和 Evidence / Draft 物化边界。
- 来源检查在启动旁路执行，不阻塞应用可用；默认每 24 小时复查。单进程内并发检查合并为一次，失败后从 5 分钟开始指数退避，最长 6 小时，并加入抖动。
- 外部响应、条件请求标识和去重摘要属于 Device Cache。内容变化只创建逐字段 Evidence 与 Draft，不提交审核、不发布，也不改变当前 Catalog Revision；仅取得时间变化不会重复创建审核工作。
- 产品能力表以 Model ID 对应的 Published 值为已保存权威；一个 Model Profile 存在任一 Published 记录时，刷新产生的 Draft 不参与该模型任何编辑器值的投影，避免 Administrator 再次打开页面时误把待审核建议当成已保存值。
- 刷新必须先完整解析、检查 Schema，并拒绝任何价格或消耗字段。解析、来源或缓存写入失败时保留上一份有效目录和 Revision，管理员状态接口保留失败原因；正在服务的请求不读取半份新目录。
- 浏览器查询失败时内部使用 `unknown` 回退和保守合同，不伪造已确认状态，也不展示状态标签。

结构化来源使用以下最小传输合同；每条 `records` 必须是一个精确能力身份，`capability` 是候选 Patch，`evidence` 提供可追溯位置。`capability` 可省略，此时只采集 Evidence。单响应最多 2 MiB / 1,000 条，最多配置 20 个来源。

```json
{
  "version": 1,
  "records": [
    {
      "provider_id": "apimart",
      "model_id": "seedream-5-0-pro",
      "operation": "image.layer_decomposition",
      "confidence": "high",
      "capability": {
        "support_state": "supported",
        "inputs": {},
        "output": {},
        "parameters": {}
      },
      "evidence": {
        "source_type": "official_docs",
        "source_locator": "https://example.invalid/model",
        "fetched_at": "2026-09-04T08:00:00Z",
        "applicable_version": "2026-09-04",
        "content_location": "Layer decomposition parameters",
        "excerpt": "One source image is required."
      }
    }
  ]
}
```

## 7. 能力资料填表与审核工作台

能力维护的最小单位是 `Provider + Model + Model Operation`，不能只按模型整体填表。同一个 Model 的文字生成、图片生成、图片编辑或视频生成必须分别保留证据和审核结论。

### 7.1 单向维护流程

1. **建立字段规范**：先固定统一外层合同及媒体专用字段，未定义字段不能由采集器自行扩展。
2. **采集 Evidence**：优先复用 Provider 模型拉取产生的 Model Discovery Snapshot；再按 Provider 类型读取官方文档、结构化模型 API、CLI 帮助/版本资料或工作流 Schema，并保存来源地址或命令、取得时间、适用版本、内容摘要和可定位的原文位置。
3. **外部研究并导入**：只对 Snapshot 未覆盖或仍需确认的字段，由 Administrator 在 ChatGPT、Codex 或其他工具中完成资料搜索，再按固定格式导入。Reroll 不运行 AI；每个确认值必须附官方来源，资料未说明的 Model Operation 必须省略。
4. **确定性校验**：提交人工审核前检查 Schema、字段类型、枚举、最小/最大关系、重复身份、资料冲突和禁止字段。
5. **人工 Review**：Administrator 在模型能力工作台查看证据、编辑表单、保存草稿、提交审核、退回或批准发布。
6. **原子 Publish**：批准后整体生成新的 Catalog Revision。重新采集只生成与已发布版本的差异草稿，不能直接覆盖当前目录。

当前后端闭环已经实现上述手工流程：Evidence 创建后不可由 Draft 偷换身份；Draft 每个已填写叶子字段必须绑定同一身份的 Evidence 与置信度；只有 `draft/returned → in_review → published` 的合法状态转换可以发布。草稿基于的 Catalog Revision 已过期时返回冲突；运行目录激活失败时回滚 Published 状态并继续使用上一 Revision。

外部研究结果不是能力事实权威。模型列表 API 可能只提供名称，CLI 帮助可能只描述命令，家族级文档也不一定证明某个精确模型的限制；这些情况下相关 Model Operation 不得进入导入包，Model Capability State 保持 `unknown`。审核完成也不自动等于 `supported`。

### 7.2 状态与时间分离

- Model Capability State 仍只有 `supported` / `unknown`，回答“是否有依据确认支持”。
- Model Capability Review State 只用于内部工作台，包含草稿、待审核、已发布和已退回，回答“维护流程进行到哪一步”。
- 生成界面不显示上述状态；仅根据已发布合同渲染控件和校验设置。
- Evidence 记录 `fetched_at`；Review 记录 `reviewed_at` 和审核人；确认支持时记录 `confirmed_at`；目录生效时记录 `published_at`。

### 7.3 产品能力表

- 可用模型页面是唯一列表入口，并以图片、视频和文字页签完成类型分组；每个 Provider 模型行已经显示 Provider ID，不再创建第二张按平台或类型分列的能力表。
- 每行最右侧提供“编辑”按钮，按稳定 Model ID 打开基于 `capability-editor` 的模型详情 Dialog；同一 Model ID 出现在多个 Provider 时进入同一份 Model Profile，保存仍原子应用到所有关联 Provider。
- 可编辑显示名称不作为稳定身份；不同 Model ID 即使名称相近也不自动合并，确需合并时必须使用明确别名映射。
- 可用模型行可以显示少量已确认且对选择有价值的功能 Tag；首批只包括拆分图层和透明 PNG。Tag 从当前 Catalog 的安全交集投影，未审核 Draft 即使会为尚未保存的模型预填详情，也不能产生 Tag。
- Administrator 在详情 Dialog 中使用开关、单选和多选设置可接收素材、数量、清晰度、画幅和附加能力；Dialog 不重复显示类型或平台。图片模型把 `image.generate` 与 `image.edit` 合并为一个产品区块，以“支持参考图”和最大参考图数量表达输入差异，保存时再翻译为内部 Model Operation 合同。画幅直接复用 Composer 的多选画幅控件，生成数量复用 Composer 的数量选择器，分辨率使用与 Composer 一致的分段选项视觉并保留能力范围所需的多选语义。
- 视频模型把 `video.generate` 投影为一个产品区块：图片、视频、音频与三者合计分别维护最大数量；单个视频/音频与视频/音频合计分别维护时长范围；纯音频输入、首尾帧视频和全能参考视频使用独立开关。输出时长维护范围，清晰度与画幅复用和图片能力一致的选择交互。保存时，矩阵把这些值翻译为 `inputs`、`input_rules`、`output`、`parameters` 与视频专有合同；Composer 根据已保存模式隐藏不支持的参考模式。
- Provider ID、Inputs / Output / Parameters JSON、逐字段路径、Evidence ID 和 Catalog Revision 不在主界面出现；资料只提供面向产品的完整度与可追溯摘要。
- “检查资料”和“导入能力数据”保留为可用模型页面级工具；导入提供可复制的查找要求和固定格式，Reroll 本身不发起 AI 请求。查找要求按即梦 CLI、Gemini CLI、GPT CLI、APIMART 等当前实际渠道动态分组；每个渠道条目必须同时给出渠道 ID/名称、精确 Model ID、显示名称及别名、图片/视频/文字类型和该渠道可用的 Model Operation，避免把 `3.0` 等短 ID 脱离渠道误认成具体模型。
- 同一 Model ID 出现在多个渠道时，外部研究应逐渠道核对官方名称与参数差异；Provider 无关的导入包仍只接受一个合并模型，并采用跨渠道安全交集。渠道资料冲突或只有部分渠道明确支持的值不得扩大成共同能力。
- 导入分为校验预览与应用两步。预览必须核对 Schema 版本、Model ID、显示名称、当前可用 Model Operation、五类输入数量和每项官方来源；数据变化后必须重新预览。应用对整个导入包执行一次原子发布，任一记录失败则全部回滚。
- Administrator 的“保存并应用”同时表达人工核对与批准。后台为关联 Provider 生成同一模型选择的审计记录，并在一次原子目录激活中整体应用，不能出现跨平台只发布一半的状态。

产品导入包固定使用以下 Provider 无关格式。`model_id` 与 `name` 必须逐字来自工作台生成的当前模型清单；同一 Model ID 不按平台拆分。只写有官方资料明确支持的 Model Operation，`inputs` 五个键表示各类素材的最大数量；`video.generate` 可以额外携带与详情 Dialog 同构的 `video` 对象，包含参考素材合计、单个与合计参考媒体时长、纯音频输入、两种视频模式和输出时长，其他 Operation 必须省略该对象。`sources.type` 只允许 `official_docs`、`structured_api`、`cli_help` 或 `workflow_schema`。本格式禁止价格、计费、额度、积分、Token 消耗和余额数据。

```json
{
  "schema_version": 1,
  "models": [
    {
      "model_id": "seedream-5-0-pro",
      "name": "Seedream 5.0 Pro",
      "operations": [
        {
          "operation": "image.layer_decomposition",
          "confirmed": true,
          "inputs": {
            "text": 1,
            "image": 1,
            "video": 0,
            "audio": 0,
            "file": 0
          },
          "resolutions": ["auto", "1K", "1.5K", "2K"],
          "aspect_ratios": [],
          "output_count_maximum": 1,
          "options": [],
          "sources": [
            {
              "type": "official_docs",
              "url": "https://example.invalid/official-model-docs",
              "title": "Layer decomposition",
              "excerpt": "A short passage that directly supports these values."
            }
          ]
        }
      ]
    }
  ]
}
```

后端已提供 Administrator-only 接口：

- `GET /api/admin/model-capability-matrix`：读取按 Model ID 合并的现有模型与产品能力选项；
- `PUT /api/admin/model-capability-matrix`：把一行产品选项原子应用到该模型的所有关联 Provider；
- `POST /api/admin/model-capability-matrix/import`：校验预览或原子应用一个外部研究包；

- `GET /api/admin/model-capability-workbench`：读取 Evidence、Draft、Review State、Published 投影和当前目录状态；
- `POST /api/admin/model-capability-evidence`：记录可追溯 Evidence；
- `PUT /api/admin/model-capability-drafts`：创建或继续编辑 Draft；
- `POST /api/admin/model-capability-drafts/{draft_id}/submit`：提交审核；
- `POST /api/admin/model-capability-drafts/{draft_id}/return`：附理由退回修改；
- `POST /api/admin/model-capability-drafts/{draft_id}/publish`：按预期 Revision 批准并原子激活。

旧三栏合同编辑器不再作为产品界面。底层 Evidence、Draft、Review 和 Published 记录仍保留为审计与恢复实现，产品能力表通过单一矩阵接口隐藏这些细节。

工作台和采集层都禁止创建、保存或发布价格、金额、货币、计费、额度、Token/积分消耗字段；即使来源资料包含这些章节，也必须在提取前过滤并由 Schema 再次拒绝。

### 7.4 实施顺序

1. 手工 Evidence、Draft、Review、Publish 后端数据边界已经实现；Administrator 产品能力表替代三栏开发者界面。
2. Dreamina、Gemini API、APIMART 的模型拉取旁路采集已接入：复用同一响应或 CLI 帮助，生成 Evidence 和 Draft，并向 API 设置页返回汇总反馈；任何采集失败不影响模型清单。
3. Dreamina CLI 周期来源、可配置结构化来源、Device Cache、周期复查、差异草稿和退避已经实现；Dreamina 解析覆盖图片生成、图片编辑与视频生成的明确字段。
4. APIMART 官方 Markdown 的端到端 Gate 已通过；适配器缺少任一已审核语义标记时 fail-closed。只提供模型名称的后续来源仍必须保持 Evidence-only，不把名称猜成能力。
5. 内置 AI 搜索与填表已经移除；产品提供当前模型查找要求、固定格式、粘贴导入、校验预览和原子应用，用于补齐确定性 Model Discovery Snapshot 之外的缺口。

## 8. 数据责任

能力目录是随产品发布或由受控采集更新的运行约束，不属于 Canvas 内容、Workspace 创作数据或 Generation History。Model Discovery Snapshot 只在一次模型拉取请求内短暂存在，脱敏后才可物化为工作台记录，且不返回浏览器。工作台 Evidence、Draft、Review 与 Published 投影属于 Instance State，保存在 `<instance-state>/model-capability-workbench.json`，不随 Workspace 搬迁。Generation Run 只冻结用于复现校验的 Model Operation、Schema 版本和目录 Revision；Revision 只计算 Published 投影，不计算 Snapshot、Evidence 或未发布 Draft。

本期不得新增任何价格、金额、货币、计费单位、额度余额或消耗量字段；也不得把它们放入目录资源、后端响应、运行快照或持久化记录。

## 9. 验收

- 三种媒体通过同一查询接口返回一致的外层身份与 Revision。
- 公开合同中的 Model Capability State 只有 `supported` 和 `unknown`；未知模型不会被当成已确认。
- 图片数量、文字历史/图片/视频输入和视频参数超限均在 Provider 调用前被拒绝。
- 前端与后端对同一合同给出相同结论；过期 Revision 优先返回目录变化错误。
- 刷新成功产生新 Revision；刷新失败继续返回上一有效能力。
- 中英文错误文案完整，能力状态不渲染到用户界面，能力模块在媒体专用模块之前加载。
- 对公开能力合同和资源进行禁止字段回归，确认没有价格或消耗数据。
- Reroll 不发起 AI 搜索或填表；外部研究包的每个确认操作必须附官方来源，资料缺失时不能导入猜测值。
- Review State 与 Model Capability State 分离；已审核但证据不足的记录仍可保持 `unknown`。
- 重新采集只产生差异草稿；批准发布前不会改变当前 Catalog Revision。
- Model Profile 已有 Published 值时，重新采集的差异草稿不会预填或覆盖该模型的任何产品能力表编辑项；资料与待审核计数仍可见，其他尚未保存的模型仍可获得首次填写建议。
- 可用模型页面没有独立模型能力页签；每行“编辑”打开模型详情 Dialog，类型和平台不重复显示。图片详情只显示一个“图片能力”区块，参考图开关在保存时翻译为内部图片编辑合同；视频详情只显示一个“视频能力”区块，并可完整回显和保存参考素材数量、输入时长、纯音频、输出时长、首尾帧与全能参考模式；拆分图层与透明 PNG Tag 只依据当前 Catalog。
- API 设置页拉取 Dreamina、Gemini API 与 APIMART 模型时复用同一份来源资料，返回采集汇总；内部 Snapshot 不返回浏览器，能力采集失败不影响模型列表成功。
- Gemini API 的结构化字段在人工确认 Model Operation 前保持 `unknown`；Dreamina 与 APIMART 仅把帮助或官方文档明确声明的字段标记为 `supported`。
- 手工 Evidence 与 Draft 可在重启后恢复；每个填写值均绑定同身份 Evidence，矛盾上下限和禁止字段被拒绝。
- 只有待审核 Draft 可以发布；旧 Revision 发布冲突和目录激活失败都不会替换上一有效目录。
- 自动采集/缓存/定时刷新、Light/Dark、键盘、390px 窄屏和失败恢复已有自动化覆盖；真实 Provider 与最终人工验收通过后评估毕业为 Current。

### 图片参数候选补全（2026-09-05）

模型详情的图片能力编辑器提供附件 APIMART 参数核查表涉及的全部 19 种固定画幅：`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`1:2`、`2:1`、`1:3`、`3:1`、`9:21`、`21:9`、`1:4`、`4:1`、`1:8`、`8:1`。分辨率候选为 `auto`、`0.5K`、`1K`、`1.5K`、`2K`、`4K`，同时保留目录中已有的其他档位。图片和视频详情及生成面板的固定画幅按 `1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16`、`5:4`、`4:5`、`21:9`、`1:4`、`4:1`、`1:8`、`8:1` 排列；其他已有比例随后显示。已有勾选不置顶、不改变排序；原图等特殊选项保留独立语义。分辨率数值递增，从 `0.5K` 开始，`auto` 等非数值选项位于末尾。候选不代表模型已支持；打开详情保持已有合同的勾选，管理员选择并保存后才更新模型能力。Provider 的 `auto` 画幅不是固定宽高比，本次不改变既有自动画幅语义或添加精确像素编辑。

验证：`tests/model_capability_workbench_browser_smoke.cjs` 检查全部候选实际渲染、图片和视频画幅顺序、初始勾选不扩张、`0.5K` / `1:8` / `5:4` 选择后同时写入生成和编辑合同，并通过中英文、Light/Dark、390px 窄屏回归。

## 10. 代表性验证入口

- `tests/test_model_capabilities.py`
- `tests/test_model_capability_api.py`
- `tests/test_model_capability_workbench.py`
- `tests/test_model_capability_refresh.py`
- `tests/test_model_capability_matrix.py`
- `tests/model_capability_workbench_browser_smoke.cjs`
- `tests/test_smart_canvas_model_capabilities.py`
- `tests/test_image_capabilities.py`
- `tests/test_video_capabilities.py`
- `tests/test_generation_settings_integration.py`
- `tests/api_settings_jimeng_model_delete_browser_smoke.cjs`
- `tests/test_api_settings_standard_contract.py`
- `node static/js/i18n/validate-i18n.js`

## 11. 消融实验记录

2026-09-04 至 2026-09-05 记录以下实验：可删除候选在固定回归通过后保留简化；必要边界使用临时探针验证，不把失败的消融写入正式代码。

API 设置的 CLI 模型选择另以“拉取 → 删除 → 保存 → 重新加载”为固定反馈回路，完成了以下前后端消融：

| 消融项 | 观察结果 | 当前结论 |
| --- | --- | --- |
| 移除前端渲染和保存阶段对 CLI 默认模型的重复注入，并删除 Jimeng 专用列表规范化 helper | Jimeng `4.7` 与 Codex `gpt-image-2` 删除后，界面状态、保存请求和重新加载均保持删除；首次添加 CLI 仍得到默认候选 | 默认注入只属于 `initializeCliProvider` 接口；渲染和保存调用方不再了解默认列表 |
| 移除后端 `merge_default_api_providers` 中 Jimeng、Codex 与 Antigravity 的两个 CLI 特例循环 | CLI 保存/加载删除回归与旧模型 ID 清理均通过；协议、地址和类别规范化可由既有 `normalize_provider` seam 一次完成 | 删除 merge 层的第二份模型权威，把 CLI 数据规范化集中到一个 seam |
| 临时清空 Dreamina CLI 帮助读取失败时的内置图片、视频回退清单 | 返回 `source: fallback`，但图片和视频列表都为空，模型发现断言立即失败 | 回退清单承担真实失败恢复职责，保留；它不参与覆盖用户已保存的选择 |
| 删除新增的持久化 `media_contract.video_profile`，并让 Composer 直接读取既有 `media_contract.commands` | 模型详情的数量、时长、模式保存回显及 Composition 模式选择回归保持通过；运行合同不再保存同一组视频事实的第二份副本 | `video` 只保留为详情接口/导入包的临时产品投影，持久化权威仍是统一合同与视频命令合同 |
| 把入口层的“来源工厂 + 公开采集器列表”两步调用压成 `ModelCapabilityRefreshManager.collect_model_discovery(...)` | Dreamina、Gemini API、APIMART 和非首批兼容网关边界回归保持通过，模型列表失败隔离不变 | 模型拉取入口只提交发现快照，不再知道来源适配器的选择与构造 |
| 删除未上线 `video_profile` 的迁移清理、实现细节断言，以及详情编辑器中已不可达的旧图片 Operation 分支 | 154 项相关 Python 回归、模型详情 Chrome smoke 与 API 设置保存/重载 smoke 通过 | 不为未发布结构保留兼容层；图片/视频只走各自单一区块，通用 Operation 编辑器只承担仍可到达的文字模型路径 |

| 消融项 | 观察结果 | 当前结论 |
| --- | --- | --- |
| 从运行时能力对象递归移除 `support_state`、来源和确认时间 | 4/4 组校验结果完全相同；首轮样本共移除 56 处 `support_state` | 这些数据不参与生成合法性判断。已先删除输入和参数中的重复状态，只保留每条 Model Capability 顶层两态；相同样本现只剩 4 处顶层状态。来源元数据是否移出运行合同留到管理员投影实验决定 |
| 移除 Catalog Revision 比对 | 过期 Revision 原本返回 `catalog_changed`；不提供 Revision 时旧实现却会通过 | Revision Guard 已改为 fail-closed：缺失与过期均拒绝。恢复路径固定为客户端重新加载目录后重试，服务端不代填 |
| 绕过服务端统一能力校验 | 超出合同上限的图片数量 5 可以进入 Image Generation Run | 服务端校验是必要权威，不能依赖浏览器 |
| 不加载前端统一能力校验 | 用户请求 5 张图片时旧实现会拆成 5 个 `n=1` 请求并全部提交 | 图片提交已改为一个用户意图、一个 Generation Run，并以总 `n` 在服务端校验；输出仍按独立 Pending Node 投射 |
| 只保留图片统一参数校验，消融旧图片合法性判断 | 统一层仍同时拒绝非法画幅、分辨率和透明 PNG | 已删除旧图片层的重复合法性判断；尺寸匹配、比例换算等媒体算法保留，但不再成为第二份约束权威 |
| 只保留视频统一数量校验，消融视频专用组合规则 | Seedance 2.0 仅提供音频时，旧统一层判定通过，专用层以 `visual-reference-required` 正确拒绝 | 统一 `input_rules` 已能表达参考素材总量、音频依赖视觉参考、首尾帧角色与互斥输入；专用层仍保留，待更多模型组合回归证明覆盖等价后再删除 |

后续可选消融（不阻塞本期合同、工作台与刷新交付）：

1. 把 Model Capability State 和来源元数据从运行合同移到独立管理员投影后，现有生成链路、媒体专用能力和审核需求能否同时成立。
2. 扩充视频模型组合样本，比较统一 `input_rules` 与专用校验的判定集合；确认完全等价后再删除专用权威。
3. 为缺少 Revision 的真实旧页面/长时间驻留页面补充浏览器恢复验证，确保重新加载目录后的重试路径可理解且不重复提交。
