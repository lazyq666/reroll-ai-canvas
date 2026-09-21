# 首次设置与逐服务连接（LAZ-12）

- Status：Implemented，等待真实供应商凭据与跨平台目录选择器验收后毕业。
- Feature ID：F01 / F02 / F10 / F13。
- Owners：产品、UI、交互、前后端。
- Last verified：2026-09-21。
- Issue：[GitHub #116](https://github.com/lazyq666/reroll-ai-canvas/issues/116)、[Linear LAZ-12](https://linear.app/lazyq/issue/LAZ-12)。
- 边界：[ADR-0001](../adr/0001-workspace-data-boundary.md)、[存储路径与旧数据迁移](../current/storage-layout-and-migration.md)。

## 目标与范围

首次使用者不用先理解 Provider、Protocol 和模型管理，就能连接已有的 AI 服务并开始创作。顺序为「创建管理员 → 选择作品保存位置 → 选择 AI 服务 → 逐个连接 → 准备完成」。不新增 Welcome 页，不要求显示名称，不预选任何服务。

此次不改变已有用户登录、设计师申请审批、Workspace 迁移、生成执行或高级模型管理。模型默认策略为：自动启用本次识别出的图片、视频、文本模型；HTTP 服务保留先前模型清单，CLI 使用当前检测清单。模型仍由现有发现与能力审核流程分类；此处不增加另一套分类规则。用户随后可在 API 设置和可用模型管理中调整。

## 界面与交互

1. 管理员表单先暂存在页面内存。位置检查通过后，复用原接口一起创建 Workspace 和管理员并自动登录。刷新前未提交的密码不持久化。
2. 保存位置默认沿用已配置位置，否则建议 `~/Documents/Reroll`。生成结果（图片、视频）、生成记录、画布和项目、创作资产使用四组 Lucide 图标与标题。弱提示说明账号、密钥、Token、CLI 登录状态和本机地址不随作品目录迁移。选择其他位置的文件夹图标位于输入框内，返回使用带可访问名称的箭头按钮。
3. 用户点击使用位置后先执行只读 Inspect；位置不存在时，通过本机专用接口准备空目录并重新检查。创建前检查路径边界、可写性和存储类型，不写入内容或改变当前工作区。非空、目录不可用、不支持的存储位置、与源码重叠均沿用原拒绝规则。发现已有 Workspace 时先显示打开分支。工作区准备后重启，恢复到选择服务。
4. API 服务包含 APIMart、ModelScope、RunningHub、火山引擎和其他 API；CLI 包含即梦、GPT CLI、Antigravity CLI。多选后按选择顺序连接，一次仅展示一个表单。APIMart 只要求 Key。其他 API 要求名称、URL 和 Key，自动识别失败才展示协议选择。
5. API 按「保存 → 验证 → 获取与分类模型 → 启用」执行。成功自动进入下一项；失败保留当前页输入，允许重试或稍后配置，不影响其他已连接服务。
6. CLI 自动检测安装、版本和登录。未安装提供安装指南；已安装但未登录提供命令或即梦扫码入口，并轮询检测。未知登录状态不能当作成功。GPT CLI 没有图片 helper 时不计入图片模型；仍可用已验证的文本来源完成。
7. 没有可用来源时显示重新选择入口。至少一个来源通过连接和模型检查后，显示「开始创作」，点击请求后端确认并直接进入现有 `/static/canvas-list.html`，不插入画布演示页。

生产页面使用公开 `ic-*` 组件、共享视觉变量和中英文资源，支持 Light/Dark 与键盘输入。无演示场景切换器。获批 Demo 保存在本地快照分支 `codex/laz-12-approved-demo`（`dc82e69`），不作为正式代码发布。

## 状态、权限与恢复

`onboarding_progress` 位于 Instance State 的 `auth.db`，记录 pending、服务配置指纹和发起安装目录的 scope。不保存明文密钥、密码或供应商账号输出。只有本次 `/api/setup` 创建的管理员会开启进度；旧安装无记录时不强制引导，共用账号库的其他源码目录也不被重定向。旧单行进度表通过事务性增加 scope 列升级，保留原进度。

已登录管理员访问首页或画布列表且本安装 pending 时返回 `/setup`。刷新或进程重启后从服务选择恢复，已经验证的服务保留；选择队列仅按用户保存服务 ID，敏感输入只存在内存。请求结果丢失时重新读取服务器状态，避免重复创建管理员。会话失效返回登录；已建号但未完成工作区重启时保留重启入口。

服务在检查期间若被另一页面修改，最终保存拒绝覆盖。完成时重新比较配置及凭据指纹；被修改或禁用的服务不能用作完成依据。进度只有在至少一个有效来源存在时结束。此判断代表连接和发现成功，不保证供应商额度、所有模型授权或真实生成始终成功。

## API 与数据归属

服务连接接口只允许本机管理员；目录准备只允许未建号时的本机请求。写操作均验证同源。

| 接口 | 用途 |
| --- | --- |
| `POST /api/setup/prepare-directory` | 仅未建号时可用；本机、同源请求确认后准备位置，拒绝源码重叠及不支持的存储 |
| `GET /api/admin/onboarding` | 获取本安装进度、已连接来源与作品位置，不返回凭据或指纹 |
| `GET /api/admin/onboarding/cli/{service}` | 获取安装、版本与登录布尔状态，不返回 CLI 原始输出 |
| `POST /api/admin/onboarding/connect` | 串联保存、验证和模型发现，通过 NDJSON 返回阶段和稳定错误码 |
| `POST /api/admin/onboarding/complete` | 重新检查来源，结束引导并返回画布列表地址 |

编排位于 `infinite_canvas/onboarding.py`；`main.py` 只组合已有配置保存、Provider 检测和模型发现。API Key 沿用 Device State 密钥存储，模型列表沿用现有配置归属，不写进浏览器存储或作品目录。连接异常只返回稳定错误码，不回传可能含密钥的供应商异常文本。

RunningHub 使用[官方账户状态接口](https://www.runninghub.cn/runninghub-api-doc-cn/api-425748943)验证 Key，不能用公共模型注册表成功代替鉴权。Codex 使用 `login status`。Antigravity 使用 CLI 自行处理的只读 `--print /usage`，不发起模型生成；无法识别报告时维持未知状态，依据见[官方非交互模式说明](https://antigravity.google/docs/cli/headless/)。即梦复用现有登录、额度与版本检查。

## 验证与毕业条件

2026-09-21 自动回归共 179 项通过；`node static/js/i18n/validate-i18n.js` 通过（3748 个键），`python3 scripts/sync_infinite_canvas_ui_version.py --check` 通过，`git diff --check` 无异常。

- HTTP 自动测试覆盖创建与恢复、旧安装不受影响、共享账号库的安装隔离、旧进度升级、本机管理员与跨站保护、无来源禁止完成、模型为空、密钥变更失效、多服务互不覆盖、错误脱敏及 CLI 登录状态。
- 真实保存适配器使用临时目录验证配置和密钥写入，模拟上游网络，验证多服务合并、并发更改保护和 RunningHub 鉴权。
- 正式页面已在内置浏览器验证账号输入、独立位置页、位置输入框内图标、重启后继续、服务多选、错误保留输入、自定义 API 协议选择、成功进入下一项、CLI 未安装、即梦登录轮询（模拟）、跳过、零来源阻止完成、Ready、语言切换、深色模式和键盘确认直接进入画布列表。测试服务使用临时账号与模拟供应商，不是生产供应商验收。
- 自动入口：`tests/test_onboarding.py`、`tests/test_onboarding_adapters.py`、`tests/test_onboarding_cli_status.py`、`tests/test_account_setup_ui.py`、`tests/test_setup_page_contract.py`。页面 fixture：`SETUP_PREVIEW=1 node tests/setup_browser_smoke.cjs`；独立浏览器 smoke 入口仍保留，当前这次验证由内置浏览器执行。
- 毕业前仍需：真实 API Key 的连接及生成、真实即梦扫码与 CLI 登录、Windows/macOS 原生目录选择与实际进程重启、窄屏人工验收。未使用用户现有密钥、账号或作品目录执行这些测试，因此保持 Active，不宣称 Current 或已发布。
