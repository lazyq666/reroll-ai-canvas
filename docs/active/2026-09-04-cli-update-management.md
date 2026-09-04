# 统一 CLI 版本检查与提醒

> 状态：Implemented（本机自动化通过；真实平台响应仍是发布前 Gate）  
> 日期：2026-09-04  
> 跟踪：GitHub Issue #30

## 目标

Reroll 服务每次启动后，异步检查当前 Workspace 已启用的 Dreamina、Codex 与 Antigravity CLI。Administrator 登录后在统一 Dialog 查看本机版本、官方稳定版本、发布日期、更新说明和来源，并可在本次进程内关闭提醒。Reroll 只告知版本，不安装、不更新、也不代为执行其他 CLI 的包管理器或安装脚本。

## 非目标

- 不恢复 Reroll 自身已移除的 `/api/check-update` 产品更新流程。
- 不提供任何 CLI 升级 API 或“更新”按钮，不调用 npm、Homebrew 或供应商安装脚本。
- 不自动安装缺失 CLI，不做后台定时检查或无人值守升级。
- 不把 CLI 新版本推断成新的 Model Capability。
- 不运行远端更新说明中的命令。

## 参与者与权限

- Administrator：可读取检查详情、手动复查和关闭本次会话提醒。
- Designer、Guest Account、Anonymous Share Visitor：不能读取本机 CLI 维护详情；所有角色都没有产品内 CLI 升级入口。
- Local Operator：可离开 Reroll 后自行决定是否按官方资料升级；不因此获得产品内 Administrator 权限。

三个管理员接口均位于 `/api/admin/cli-updates`，只提供读取、重新检查和关闭提醒，服务端再次校验 Role。CLI 路径、渠道和检查结果属于当前服务主机的 Device State 边界，不进入 Workspace Data；首版只在当前进程内缓存检查与提醒状态。

## 启动与通知

1. Application startup 完成必要的 Workspace 与 Generation Run 恢复后，以后台 Task 启动检查，不等待外部网络。
2. 只对 Provider 设置中已启用的三个 CLI 身份执行本机探测和远端请求；未启用项返回 `not_configured`。
3. 检查结果留在管理器内。Administrator 晚于检查完成登录仍能看到；早于完成登录时前端短轮询检查状态。
4. `update_available` 且本次进程未关闭提醒的项目组成 `notification_items`。关闭 Dialog 后，本次进程不再自动弹出；手动入口仍可重新检查，但没有任何可用更新时不显示 Dialog。

## 状态

| 状态 | 含义 | 是否通知 |
| --- | --- | --- |
| `not_configured` | Provider 未启用 | 否 |
| `not_installed` | 未发现可执行文件 | 否 |
| `check_failed` | 官方来源离线、超时、限流或元数据损坏 | 否；不冒充最新，可复查 |
| `uncomparable` | 版本命令失败，或本机只报告 commit/build 等不可比较身份 | 否；明确说明不能可靠比较并展示官方来源 |
| `current` | 本机版本等于或新于官方稳定版本 | 否 |
| `update_available` | 官方稳定版本严格更新且没有预发布降级 | 是；只显示官方来源，不执行升级 |

版本比较规范化 `vMAJOR.MINOR.PATCH[-prerelease]`；不能解析时不猜测。稳定版高于相同数字的预发布版；本机更高版本或更高预发布版本不被官方较低稳定版覆盖。

## 供应商适配

| CLI | 官方检查来源 | 渠道处理 |
| --- | --- | --- |
| Dreamina | 官方 `version.json` 的 version / release_date / release_notes | 本机只报告 commit/build 且官方没有映射时为 `uncomparable`，界面解释原因，不猜测新旧 |
| Codex | npm 安装读取 npm Registry 的官方包版本，Homebrew 安装读取 Cask 元数据，standalone 读取 `openai/codex` GitHub Latest Release；仅在版本一致时附加对应 GitHub release notes | 安装渠道只用于选择正确的官方版本来源，不用于执行升级 |
| Antigravity | 官方 Download 页中指向 `changelog?tab=cli` 的 CLI 版本标签及 CLI changelog | 解码官方 gzip 响应，并通过 CLI 专属链接排除 Antigravity Hub/IDE 和普通 Gemini CLI |

新增 CLI 只新增 `CliAdapter` 并注册，不复制启动、权限、提醒去重和 Dialog 流程。

## 检查安全合同

- 后端没有 CLI 升级路由、升级计划或包管理器 argv；浏览器没有“更新”动作。
- 本机只执行适配器固定的只读版本命令；发布说明与浏览器输入永远不能组成命令。
- 更新说明在后端去除标记、截断长度，前端始终通过 `textContent` 展示；官方链接使用固定适配器来源。
- gzip 响应解压后仍执行 2 MB 上限；超时、限流、压缩损坏或元数据损坏均返回 `check_failed`，不冒充“已是最新”。
- Dreamina commit/build 与官方发行号没有可验证映射时保留原始身份并解释限制。

## 界面

- App Shell 持有统一 `ic-dialog`，Administrator 进入后仅在至少一个已启用 CLI 存在可用更新时自动展示；没有可用更新时不渲染项目，也不显示 Dialog。
- Dialog 省略已是最新、未启用和未安装项目；存在可用更新时，同时保留 `uncomparable` 与 `check_failed` 项作为低强调度的灰色已知信息。
- 每项只显示一次 CLI 名称与状态、本机和官方版本关系、有效说明、官方发布日期和来源；可用更新使用绿色文字，无法判断或无法监测使用中性灰与灰度图标，不再叠加状态圆点、图标容器或第二层卡片背景。
- Dialog 只保留标题与关闭入口；关闭即代表本次进程不再提醒，没有重复的说明、数量、检查时间、页脚操作或升级按钮。
- API 设置的 CLI 列表只保留一个“检查 CLI 更新”入口；手动检查没有发现更新时使用轻量反馈，不打开空 Dialog。
- 动态进度、错误、空状态、按钮和可访问状态均提供中文与英文；语言切换会重绘动态内容。

## 验收与证据

已通过：

```sh
.venv/bin/python -m unittest tests.test_cli_updates tests.test_cli_update_http -v
NODE_PATH=/Users/luoyiqun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node tests/cli_updates_browser_smoke.cjs
```

Python 场景覆盖版本顺序、预发布、commit/build、恶意说明、未配置/未安装/版本命令失败、渠道适用性、gzip 解码、Hub 与 CLI 版本隔离、超时/限流、说明缺失、Provider 配置不可读、会话提醒去重和非管理员拒绝。HTTP 回归明确断言升级路径不存在。真实 App Shell 浏览器 smoke 覆盖自动 Dialog、只展示需关注项目、更新与无法判断的视觉分级、CLI 图标、版本关系、Dreamina 原因说明、中英文、纯文本说明、关闭即本次不再提醒、无更新不显示 Dialog，以及始终不存在更新按钮。

发布前仍需在隔离机器完成：Dreamina/Codex/Antigravity 三种真实版本输出；macOS、Windows、Linux 的官方页面响应复核；离线、代理、GitHub/官方站点限流的人工表现。未完成这些 Gate 前本文保持 Active，不晋升 Current。

## 修订记录

| 日期 | 状态 | 说明 |
| --- | --- | --- |
| 2026-09-04 | Implemented | 消融无效层级：设置页双入口合并为一次检查，移除灰底卡片、图标容器、状态圆点和只被单处调用的 DOM 包装函数 |
| 2026-09-04 | Implemented | 按确认的方案 A 消融提醒界面：只展示需关注项，突出唯一版本关系，无法判断置灰，无更新不显示 Dialog |
| 2026-09-04 | Implemented | 收紧为只读版本检查与提醒；移除升级 API/按钮；修复 Antigravity gzip 与 Hub/CLI 版本混淆；明确 Dreamina build identity 无法映射发行号 |
