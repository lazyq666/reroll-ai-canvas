# Composer 提示词优化

- Status：Implemented（真实 Provider 调用通过，2026-09-22 用户验收通过，待 PR 合入）
- Feature ID：F05
- Issue：[GitHub #117](https://github.com/lazyq666/reroll-ai-canvas/issues/117)，维护者任务 LAZ-37
- Domain terms：Canvas、Node、Prompt、Generation Settings、Model
- Related ADR：[UI 模块责任](../adr/0002-ui-family-module-ownership.md)

## 目标与范围

Administrator 和获授权 Designer 可在图片、视频 Composer 内把粗略需求整理为生成提示词。入口位于生成按钮左侧，生成仍为主操作。优化不创建 Node，也不自动生成媒体。只读访问者不能执行。

V1 不提供优化中心、新建自定义方案、历史列表或差异弹窗。设置菜单在「工作流设置」下一项提供「提示词优化」入口。Administrator 可分别配置「图片生成」和「视频生成」模块的文字 Model 与优化指令，并恢复当前模块的默认指令。设置页可分别选择图片与视频的默认优化方案，并编辑该方案指令；选择在保存后生效，旧设置默认智能优化。切换模块保留各自草稿。Designer 可执行优化，但不可打开设置页或保存设置。

设置保存到 Workspace Data，整个工作区共享。未指定 Model 时沿用现有默认文字模型选择规则；明确选择的 Model 不可用时不静默切换其他模型。每次优化读取当前已保存设置，因此保存后下一次优化生效。空白指令回退内置规则；每个方案最多 6000 个字符。设置加载失败时禁用编辑并允许重试，保存失败保留页面草稿。

## 交互合同

- 普通 Prompt Node 和 Prompt Generation Node 均不提供优化按钮、媒体模块选择或结果切换；只在图片／视频 Composer 内提供优化。
- 优化前隐藏下拉入口。成功后，下拉菜单只提供「优化提示词 1」和「原提示词」，以单选状态标记当前版本。切换不发请求，不新增状态行或额外按钮。
- 使用设置页为当前媒体模块保存的默认方案，Composer 不提供方案选择。有现成结果时禁用重复优化；主动编辑后清除这一组版本并重新允许优化。
- 空文本禁止执行，素材引用本身不算可优化文本。
- 请求执行期间显示 Loading，禁止重复提交，仍可编辑提示词。
- 成功直接替换输入，相邻箭头显示版本切换菜单，不增加 Composer 高度。生成提交、切换节点、返回原 Composer 或重载页面后，仍可在保存的两个版本间切换。输入未再次编辑时，Cmd/Ctrl+Z 切回原文并保留优化结果。
- 首次优化保存原始输入；未编辑结果时再次优化仍基于原始输入。用户编辑后重置起点。
- 切回原文恢复首次优化前的内容和素材引用。失败保留输入，可重试；两分钟未完成视为本次等待失败，不自动重试。
- 请求期间发生编辑、切换节点或图片／视频类型变化时，旧结果不可覆盖当前内容。
- 素材引用转为占位符发给文字模型，必须完整返回后才应用结果；返回的 HTML 只作为文字显示。
- 文案有中英文；使用现有 `ic-icon-button`、`ic-menu` 和 `ic-button`，继承 Light/Dark、键盘菜单和焦点合同。

## 实现责任

`static/js/smart-canvas/prompt-optimize.js` 管理方案、优化状态、引用恢复和撤销。`smart-canvas.js` 提供当前节点、编辑权限、模型调用和保存端口。`prompt-optimization-settings.html` / `.js` 提供管理员设置页，后端 `prompt_optimization.py` 校验并原子保存到工作区 `data/prompt-optimization.json`；该文件只包含模型标识与方案指令，不保存 Provider 连接或凭据。原文、最近一次优化结果与方案保存到媒体节点的 `promptOptimization.image` / `.video`，各包含 `sourceHtml`、`resultHtml`、`preset`；切换媒体类型相互隔离。与现有提示词草稿一起经 Canvas 保存通道持久化。旧节点无此字段时按未优化处理，旧普通 Prompt Node 的媒体偏好不再使用。正在执行的请求只存在页面内存，离开节点后结果不可覆盖其他节点。

图片默认规则聚焦静态构图、光线与材质；视频默认规则聚焦动作、时序、镜头与连续性。执行优化时严格读取对应媒体模块的配置。目标图片／视频模型与实际执行优化的文字模型相互独立。

## 验证与剩余 Gate

- `node tests/prompt_optimize_state.test.cjs`：通过。覆盖重复提交、原文复用、编辑失效、节点守卫、撤销和媒体方案边界。
- `node static/js/i18n/validate-i18n.js`：通过。
- `node tests/prompt_optimize_browser_smoke.cjs`：通过；真实页面发出 8 次模拟优化请求，无页面异常。覆盖普通提示词节点与文本生成入口排除、原文复用、版本切换、重复优化禁用、节点记录恢复、失败、编辑与节点切换守卫、空输入、引用与 HTML 文本处理、缺少文字模型、中英文、键盘菜单、Light/Dark、900px 窗口。
- Python 3.12 文档、i18n 缓存、样式缓存检查 9 项通过；相关 Composer、快捷入口和字符计数回归 56 项通过。Infinite Canvas UI 资源版本检查通过。
- 真实文字 Provider 调用已验证，2026-09-22 用户确认验收通过；待 PR 合入与发布检查，不视为已发布。

## 设置接口与验收补充

- `GET /api/prompt-optimization-settings`：Administrator / Designer 读取。缺少文件返回内置默认设置，损坏文件报错而不静默覆盖。
- `PUT /api/prompt-optimization-settings`：仅 Administrator 保存；结构为 `version: 2`，包含独立的 `image`、`video` 对象，各自保存 `default_preset`、`provider`、`model`、`instructions`。图片指令键为 `smart`、`preserve`、`visual`，视频额外包含 `camera`；拒绝未知字段及超长内容。读取旧版 `version: 1` 时将原配置复制到两模块，图片排除镜头规则；读取不改写原文件，下次保存写入 V2。
- 优化仍通过现有 `/api/canvas-llm`，提交前加载并校验所选文字模型的 `text.generate` 能力，携带 `catalog_revision`。目录过期时显示现有本地化更新提示。请求不发送图片或视频字节，引用以占位符保护。
- `tests/prompt_optimization_settings_browser.cjs`：设置保存与重载、切换模块与方案保留草稿、独立模型与指令保存、语言切换、保存失败保留草稿通过。
- `tests/test_prompt_optimization_settings.py`：工作区隔离、原子读写、损坏检测、字段限制，以及真实路由的未登录／管理员／设计师权限通过，共 5 项。
- 媒体 Composer 浏览器测试覆盖优化前隐藏、成功后显示、主动编辑后隐藏，以及配置指令和模型实际进入优化请求。

- `tests/test_prompt_optimization_request.py`：执行实际前端请求函数，将请求交给真实后端文字能力校验；修复前稳定复现缺失目录版本导致的 `409 catalog_changed`，修复后通过。浏览器回归同时检查目录版本、两个版本的菜单切换不发新请求、无额外状态行。

- `tests/composer_submission_feedback_browser_smoke.cjs` 新增优化后点击生成并返回原节点的完整交互检查：版本切换菜单仍显示，已有结果时优化禁用，原文与结果均可恢复。

- 优化和版本切换图标使用小号图标与次级文字色，保留禁用状态颜色；底部参数、优化动作和生成按钮垂直居中。
