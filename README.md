<h1 align="center">
  <img src="static/images/brand/logo.png" alt="Reroll AI Canvas" width="64" valign="middle" /> Reroll AI Canvas
</h1>

<p align="center">
  <strong>跑在你自己电脑上的 AI 无限画布，给一起出图、出视频的小团队。</strong><br />
  提示词、参考素材、生成过程和结果都摊在同一张画布上，大家同时在场，谁改了什么一眼就能看到。
</p>

<p align="center">
  <b>简体中文</b> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/lazyq666/reroll-ai-canvas/actions/workflows/public-readiness.yml"><img src="https://github.com/lazyq666/reroll-ai-canvas/actions/workflows/public-readiness.yml/badge.svg" alt="Public readiness" /></a>
  <img src="https://img.shields.io/badge/license-source--available-f59e0b?style=flat" alt="License: source-available" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6366f1?style=flat" alt="Supported platforms: Windows, macOS, and Linux" />
</p>

<p align="center">
  <a href="#特色">特色</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#文档地图">文档地图</a> ·
  <a href="#原项目与作者">原项目与作者</a> ·
  <a href="#许可">许可</a>
</p>

<p align="center">
  <img src="docs/assets/reroll-ai-canvas-overview.png" alt="Reroll AI Canvas Smart Canvas 工作区，展示提示词、媒体节点、连接、分区与批量运行" width="960" />
</p>

> [!NOTE]
> Reroll AI Canvas 使用带非商业限制的源码公开许可（source-available），不是 OSI 定义的开源软件。使用、分发或二次开发前，请先读一遍 [LICENSE](LICENSE)。

> [!IMPORTANT]
> 本项目在 [hero8152/Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas) 的基础上修改而来，是独立维护的非官方衍生版本。原作者、原项目链接、版权声明与许可要求都完整保留。

## 特色

<table>
<tr>
<td width="48%" valign="middle">

### 实时多人协作

大家打开同一张 Smart Canvas 就能一起干活：谁的指针停在哪儿一目了然，选择、拖动、缩放、平移和快捷键都是接近 Figma 的熟悉手感。有人改了提示词、连了线、点了生成，所有人都会马上看到。

几个人同时改也不怕打架：服务端统一记录每一个版本，并发修改可以协调，出了问题也能恢复。

[实时协作说明 →](docs/current/realtime-collaboration-performance.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/e67f68b3-e5dd-4e43-adef-dcd82fdc8c87

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 账号、角色与分享

小团队的权限，本该简单。Reroll 只有三种角色：管理员把控全局，设计师专心创作，访客账号仅能登录受限入口，不能进入画布编辑或管理页面。新同事在登录页提交申请，管理员审核后按 Project 分配能进的项目；画布可以私有，也可以共享。

想给客户看稿？发一个只读链接就行，对方不用注册；项目结束了，随时一键撤销。权限会一直管到页面入口、画布编辑和生成任务。

[项目与权限地图 →](docs/PROJECT-MAP.md#用户和权限)

</td>
<td width="52%">

https://github.com/user-attachments/assets/7ffc8d13-75d1-4b9d-a53f-a5849caf7fdd

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 内置创作工具

常用的图片处理不用再来回导出、导入。在图片节点上直接用智能分层、角度控制、智能抠图、灯光参考、深度图和反推提示词就行。

处理结果就留在画布上，和原图连在一起，接着连线、对比、复用都很顺手。

[生成链路 →](docs/current/generation-pipeline.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/2ca6cc47-8b29-4feb-88f2-aa20c981b8d5

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 提示词模板库与资产库

好用的提示词和好素材，都值得再用一次。把它们收进 Workspace 的模板库和资产库，需要时搜一下、预览一眼，就能带回当前的画布。不用再翻聊天记录，也不用在几个软件之间来回搬。

[Workspace 资产库 →](docs/current/workspace-asset-library.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/f0a772c9-0aa5-4388-b4b2-c98910c7869b

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 局域网部署，本地优先

Reroll 跑在你自己的电脑上。画布、媒体文件和生成历史都存放在你选定的 Workspace 里；同一个可信局域网里的伙伴，打开浏览器就能加入。

只有在调用在线模型时，相关请求才会发给你配置的 AI 服务商。

[本机与局域网访问 →](docs/current/local-network-access.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/b9573ee8-578e-4312-8c9d-a2d730834f62

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 批量生成工作台

想一口气试几个提示词、几个模型？在独立的批量生成工作台里一次排好计划，提交前逐条确认任务清单，之后队列、进度和结果画廊都在同一个地方看。

画布里也有“批量运行”节点，可以按顺序替换变量，依次跑完相邻的生成流程。

[批量运行节点 →](docs/current/smart-canvas-batch-run-node.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/5834952d-1498-4a80-8c81-3e3358353db7

</td>
</tr>
</table>

<sub>短片由真实界面录屏和动效剪辑而成，其中抠图前后对比和局域网部分是示意动画。</sub>

**还有这些：** 用 Frame 和 Smart Group 给画布分区整理；图片、视频、音频、文字节点；读得懂的连线（Connection）；完整的生成历史；模型与 API 管理；兼容 ComfyUI、RunningHub、ModelScope 和 CLI；以及可以随身带走的加密配置备份。

---

## 快速开始

不用先装 Python。统一启动器会按需给 Reroll 单独准备一套 Python 3.12 环境，创建虚拟环境并安装锁定版本的依赖，不会动你系统里原有的 Python。

### 1. 启动 Reroll

| 平台 | 快速启动器 |
| --- | --- |
| Windows 10/11 | 双击 `启动服务-Windows.bat`（Start Reroll for Windows） |
| macOS | 第一次使用时右键打开 `启动服务-macOS.command`，以后直接双击即可（Start Reroll for macOS） |
| Linux / 终端 | 运行 `bash 启动服务-macOS.command` |

启动完成后，在浏览器打开 `http://127.0.0.1:3000/`。如果 3000 端口被占用了，启动器会自动顺延到 3001、3002 等端口。

> 第一次启动需要联网下载运行环境和依赖。之后生成时要不要联网，取决于你用的是在线 API 还是本地 ComfyUI。

通过 LaunchManager 等后台工具启动时，如在线 API 需要代理，请显式配置该启动项的网络环境，
并重新加载启动项使其生效。默认行为、变量和连接失败诊断见[生成管线的网络与超时说明](docs/current/generation-pipeline.md#后台启动的网络环境)；可选变量示例见 `.env.example`。

### 2. 创建管理员，连上 AI 服务

第一次打开时，Reroll 会带你走完几步：创建本机管理员，选择作品的保存位置，再挑选要用的 AI 服务并逐个连接。只要有一个服务通过了连接和模型检查，就可以点“开始创作”进入画布列表；其他服务以后在 API 设置里随时添加。已经装好的实例不会被要求重走一遍。

之后，其他人可以在登录页申请设计师账号。管理员在“账号管理”页面审核申请，并为设计师分配可以访问的 Project。访客账号不能进入画布编辑和管理页面。

### 3. 新建一张画布

选好 Workspace，在 Project 里新建一张 Smart Canvas。把参考素材拖进来，加上 Prompt 或 Generation Node，再用 Connection 把输入、参考和结果串起来。

如果要用本地 ComfyUI H3：管理员先在“工作流设置”里配置实例，并导入兼容的 API 工作流，之后就能在视频模型菜单里按工作流名称选用。Reroll 所在的机器需要能访问这个实例，还要装好可以通过 `PATH` 执行的 `ffprobe`（一般随 FFmpeg 一起提供），用来在提交前检查参考视频和音频。支持的模板、参数和验证范围见 [H3 工作流说明](docs/current/comfyui-h3-workflows.md)。

### 让外部 Agent 帮你编排画布

想让 Codex、Claude 桌面版或 Claude Code 直接在画布上帮你批量编排？三步就能连上：

1. 在要运行 Agent 的那台电脑上打开 Reroll，进入账号菜单的“应用连接”，选好应用和系统，点“下载安装”。
2. 解压后先退出所选的应用，再双击 `Install.command`（macOS）或 `Install.cmd`（Windows）。安装器会准备独立的运行环境，备份原有配置，并自动配好 MCP。
3. 重启应用。第一次调用 Reroll 时，在网页上核对识别码并点“同意”，之后就会一直保持连接，不需要手动填写配置或令牌。

还有几点需要知道：

- 在另一台设备上安装时，请用服务器的局域网地址打开网页再下载；`127.0.0.1` 只代表当前这台设备。
- 首次安装需要联网。安装器不会帮你安装 Codex 或 Claude 本身；系统也可能会请你确认是否打开下载的程序。
- 这项接入全局默认关闭，需要管理员批准并开启；设计师要等管理员启用接入后才能使用。管理员随时可以在“应用连接”里关闭所有连接。
- 桥接程序运行在 Agent 所在的电脑上，通过浏览器使用的地址连接 Reroll，支持批量编排、引用素材、预检、安全撤销和下载结果。
- 配对时会一并授予编排和 `run` 权限，运行任务需要这项权限；运行期间请保持同一账号的画布页面开着。允许读取的本地目录默认为空。

安装、环境变量和操作流程见 [MCP 桥接说明](tools/reroll-mcp/README.md)，验证范围见 [Agent MCP 规格](docs/active/2026-10-17-agent-mcp-canvas-authoring-spec.md)。

### 在命令行生成图片

`tools/reroll-mcp` 包同时提供 `reroll` 命令。用 `reroll models --json` 查看当前模型，再用
`reroll generate "提示词" --provider ID --model ID --ratio 3:4 --resolution 2K --json`
生成并下载一张图片；可重复添加 `--image ./参考.png` 做图生图。
首次在网页批准 CLI 配对后，日常生图只需保持 Reroll 后台运行。`REROLL_URL` 未设置时连接
`http://127.0.0.1:3000`，结果默认保存到当前目录的 `reroll-output`。中断或下载失败后，
可用 `reroll result RUN_ID --json` 取回原任务。账号须允许自动运行，CLI 不会修改确认偏好。
CLI 图片生成不设应用层并发上限；升级服务端并重启后生效，已有 CLI 无需重装。
账号“画布并发”设置仅用于 Agent 画布任务，具体边界见 [CLI 运行合同](docs/current/reroll-cli.md)。
一次性安装、终端可执行文件位置与环境要求见[CLI 安装说明](tools/reroll-mcp/README.md#reroll-cli)。


### 环境检查与依赖修复

```bash
# Windows
启动服务-Windows.bat check
启动服务-Windows.bat install --force

# macOS / Linux
./启动服务-macOS.command check
./启动服务-macOS.command install --force
```

服务运行期间，启动器会一直看护后端。想停下来时，建议在原来的启动窗口按 `Ctrl+C`；直接关掉启动窗口、终端标签页或外层启动任务也没关系，后端会发现看护已经断开，并安全收尾。请不要绕过统一启动入口直接运行后端，否则像切换 Workspace 这样的受控重启就没人接手了。

---

## 在两台电脑之间轮流使用工作区

如果你把本地 SQLite 工作区放在 OneDrive 里，想在两台电脑之间轮流使用，请走“保存位置 → 安全关闭并交接”，不要直接换机。

- 第一次交接成功后，下一次启动需要输入上一台电脑给出的交接编号。开始之前，先等两边的 OneDrive 都同步完成。
- 直接关闭标签页或终端，不算完成交接；如果是异常退出，需要回到原来那台电脑上恢复。
- 恢复页会列出具体的冲突文件。核对过编号和完整数据之后，你可以明确选择保留主记录，系统会先备份，再隔离多出来的记录副本。
- 关闭失败时，可以在列表里查看数据库副本之间的画布和节点差异。内容相同的副本默认已选中，不同的副本需要你自己核对。确认保留当前文件后，系统会先备份，再删除选中的副本并重试交接。数据库冲突不会自动合并。

这项功能已经完成本地测试，真实的双设备验收还在进行中。详见[工作区安全交接](docs/active/2026-09-27-workspace-handoff.md)。

也可以选用 [Turso 在线交接](docs/active/2026-09-29-online-workspace-handoff.md)：在这台关闭服务，另一台启动时就会自动验收，不用再输交接编号。

- 先升级并停止两端的服务，然后在每台电脑本机的 Device State 里配置私有的 `handoff-service.json`。
- 原来那台电脑执行 `python scripts/configure_handoff.py --initialize`，第二台执行 `python scripts/configure_handoff.py`。
- 令牌不放进仓库，也不放进 OneDrive；正式内容仍然保存在本地。
- 遇到网络失败、原设备还没交接，或者同步不完整的情况，Reroll 会拒绝打开工作区。

在线交接已经通过真实 Turso 的隔离测试，真实的双设备 OneDrive 验收还在进行中。配置细节和恢复边界见上面的说明。

---

## 文档地图

| 想了解什么 | 从这里开始 |
| --- | --- |
| 产品、设计与开发资料总入口 | [产品知识库](docs/README.md) |
| 产品边界、角色、技术栈与代码责任 | [项目地图](docs/PROJECT-MAP.md) |
| 统一的产品领域词汇 | [领域语言](CONTEXT.md) |
| UI 原则、组件状态与交互验收 | [UI 设计与交互指南](docs/current/ui-design-guidelines.md) |
| Generation Run、服务商适配与结果恢复 | [生成链路](docs/current/generation-pipeline.md) |
| Workspace、实例数据、密钥与迁移边界 | [存储路径与迁移](docs/current/storage-layout-and-migration.md) |
| 账号、局域网与部署注意事项 | [本机与局域网访问](docs/current/local-network-access.md) |
| 贡献代码或文档 | [贡献指南](CONTRIBUTING.md) |
| 安全问题的私密报告方式 | [安全政策](SECURITY.md) |

### 数据与部署边界

- 服务默认监听 `0.0.0.0`，方便同一可信局域网里的设备访问。如果只想让本机访问，在项目的 `.env` 里设置 `INFINITE_CANVAS_HOST=127.0.0.1` 并重启即可。
- 局域网访问不等于公网部署。要放到公网上，需要自己配置 HTTPS 反向代理、安全 Cookie、可信的访问边界和备份策略。
- 当前的协作服务按单个 Uvicorn Worker 设计，不支持多 Worker、多实例或跨服务器同步。
- Reroll 面向个人创作者和彼此信任的小团队，不是成熟的互联网多租户 SaaS。

---

## 参与贡献

欢迎提 Bug、需求、文档修正和实现建议：

- 提交前先搜一下[已有 Issues](https://github.com/lazyq666/reroll-ai-canvas/issues)，避免重复。
- 报 Bug 时尽量附上复现步骤、系统和浏览器版本；截图里请不要出现 API Key、Cookie、私网地址或本机绝对路径。
- 动手写代码之前，请先读一读[贡献指南](CONTRIBUTING.md)和项目根目录的 [AGENTS.md](AGENTS.md)。
- 改了前端资源之后，运行 `python3.12 scripts/sync_frontend_assets.py`，并提交生成的引用更新。升级后的页面普通刷新就能加载新代码，没变的资源继续走缓存；规则与验收见[前端资源版本](docs/current/frontend-asset-versions.md)。
- 产品里用户能看到的文案，需要同时提供中文和英文，并接入共享的 i18n 资源。

---

## 原项目与作者

- 原项目：[hero8152/Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas)
- 原作者 GitHub：[hero8152](https://github.com/hero8152)
- 原作者 Bilibili：[78652351](https://space.bilibili.com/78652351)
- 原项目视频教程：[YouTube](https://youtu.be/r_y_9ALr7fg)
- 原项目配套 Chrome 插件：[Chrome Web Store](https://chromewebstore.google.com/detail/ajfhnbklbmpfaaookhfakohabnpmlcic)

谢谢原作者把完整的项目公开出来。无限画布、模型调用、素材管理和创作工具这些核心基础，都来自原项目。如果某个问题只在 Reroll 衍生版本里出现，请先在本仓库反馈，别让原作者去排查与他的代码无关的问题。

---

## 许可

本项目沿用仓库中的 [LICENSE](LICENSE) 及原项目声明：

- 禁止将项目修改、封装后作为商业产品；商业使用须取得相应授权。
- 基于本项目二次开发的软件必须继续公开源码并注明来源作者。
- 二次开发时应同时保留原作者 `hero8152`、原项目链接，以及 Reroll 衍生版本的修改来源。

这是一份带非商业限制的源码公开许可，不是 MIT、Apache-2.0 等标准 OSI 开源许可证。随仓库分发的第三方代码、字体、图标和服务标识继续适用各自条款，详见[第三方声明](THIRD_PARTY_NOTICES.md)。许可解释以 [LICENSE](LICENSE) 和原项目权利人的说明为准。
