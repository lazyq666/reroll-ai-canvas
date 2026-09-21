<h1 align="center">
  <img src="static/images/brand/logo.png" alt="Reroll AI Canvas" width="64" valign="middle" /> Reroll AI Canvas
</h1>

<p align="center">
  <strong>面向图片与视频生成的本地优先 AI 无限画布工作台。</strong><br />
  在一张可协作的画布中组织提示词、参考素材、生成流程与结果。<br />
  <sub>A local-first AI canvas for image and video generation, visual workflows, asset management, and small-team collaboration.</sub>
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
> Reroll AI Canvas 使用带非商业限制的源码公开许可（source-available），不是 OSI 定义的开源软件。使用、分发或二次开发前请阅读 [LICENSE](LICENSE)。

> [!IMPORTANT]
> 本项目基于 [hero8152/Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas) 修改开发，是独立维护的非官方衍生版本。原作者、原项目链接、版权声明与许可要求均予以保留。

## 特色

<table>
<tr>
<td width="48%" valign="middle">

### 实时多人协作

在同一张 Smart Canvas 中查看协作者和实时指针，并以接近 Figma 的选择、拖动、缩放、平移与快捷键习惯共同编辑。服务端权威 Revision 与结构化 Mutation 让并发修改可协调、可恢复。

[实时协作说明 →](docs/current/realtime-collaboration-performance.md)

</td>
<td width="52%">

<!-- GIF PLACEHOLDER: 多位协作者的实时指针与画布编辑 -->

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 账号、角色与分享

内置管理员、设计师和访客角色，支持账号申请与审核、按 Project 授权、私有或共享 Canvas，以及可随时撤销的只读分享链接。权限边界覆盖页面入口、画布编辑与生成任务。

[项目与权限地图 →](docs/PROJECT-MAP.md#用户角色与权限)

</td>
<td width="52%">

<!-- GIF PLACEHOLDER: 账号申请、角色、Project 授权与只读分享的概念演示 -->

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 内置创作工具

从图片节点直接使用智能分层、角度控制、智能抠图、灯光参考、深度图和反推提示词。常用处理入口与结果都留在 Canvas 上，便于继续连接、比较和复用。

[生成链路 →](docs/current/generation-pipeline.md)

</td>
<td width="52%">

<!-- GIF PLACEHOLDER: 六种快速工具依次切换的剪辑 -->

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 提示词模板库与资产库

在 Workspace 中整理可复用的 Prompt Template 与创作素材。搜索、预览并把模板或媒体带回当前工作流，减少重复输入和跨应用搬运。

[Workspace 资产库 →](docs/current/workspace-asset-library.md)

</td>
<td width="52%">

<!-- GIF PLACEHOLDER: 提示词模板库与 Workspace 资产库 -->

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 局域网部署，本地优先

Reroll 服务运行在自己的电脑上；Canvas、Managed Media 与生成历史保存在用户选择的 Workspace。默认可从可信局域网访问，只有调用在线模型时才把相关请求发送给所配置的 AI 服务商。

[本机与局域网访问 →](docs/current/local-network-access.md)

</td>
<td width="52%">

<!-- GIF PLACEHOLDER: 本机 Workspace 与局域网设备访问 -->

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 批量生成工作台

将多模型、多任务的生成计划集中到独立工作台，持续跟踪队列、任务状态和结果；在 Smart Canvas 中也可以用“批量运行”节点按序替换变量并执行相邻生成流程。

[批量运行节点 →](docs/current/smart-canvas-batch-run-node.md)

</td>
<td width="52%">

<!-- GIF PLACEHOLDER: 批量生成工作台与结果画廊 -->

</td>
</tr>
</table>

**更多能力：** Frame 与 Smart Group、图片/视频/音频/文字节点、可读的 Connection、生成历史、模型与 API 管理、ComfyUI / RunningHub / ModelScope / CLI 兼容，以及可迁移的加密配置备份。

---

## 快速开始

无需预先安装 Python。统一启动器会按需准备 Reroll 专用的 Python 3.12 环境、创建虚拟环境并安装锁定版本的依赖，不会覆盖系统 Python。

### 1. 启动 Reroll

| 平台 | 快速启动器 |
| --- | --- |
| Windows 10/11 | 双击 `启动服务-Windows.bat`（Start Reroll for Windows） |
| macOS | 首次使用时右键打开 `启动服务-macOS.command`，以后可直接双击（Start Reroll for macOS） |
| Linux / 终端 | 运行 `bash 启动服务-macOS.command` |

启动完成后访问 `http://127.0.0.1:3000/`。若 3000 端口已占用，启动器会自动尝试 3001、3002 等后续端口。

> 首次启动需要联网下载运行环境和依赖。AI 生成是否需要联网，取决于你使用在线 API 还是本地 ComfyUI。

### 2. 创建管理员并审核账号

首次进入时创建本机管理员账号。之后，其他用户可以在登录页提交设计师账号申请；管理员在“账号管理”页面审核申请，并为设计师分配可访问的 Project。访客账号不能进入 Canvas 编辑或管理通道。

### 3. 新建 Canvas

选择 Workspace 后，在 Project 中新建 Smart Canvas。拖入参考素材、添加 Prompt 或 Generation Node，再用 Connection 组织输入、参考与结果之间的关系。

### 环境检查与依赖修复

```bash
# Windows
启动服务-Windows.bat check
启动服务-Windows.bat install --force

# macOS / Linux
./启动服务-macOS.command check
./启动服务-macOS.command install --force
```

启动器会在服务运行期间持续监督后端。建议在原启动窗口按 `Ctrl+C` 停止；关闭启动窗口、终端标签页或外层启动任务时，后端也会检测到监督关系断开并完成安全清理。不要绕过统一启动入口直接运行后端，否则 Workspace 切换等受控重启无法由启动器接续。

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

- 服务默认监听 `0.0.0.0`，便于同一可信局域网内的设备访问；如需仅允许本机访问，可在项目 `.env` 中设置 `INFINITE_CANVAS_HOST=127.0.0.1` 并重启。
- 局域网访问不等于公网部署。公网环境需要自行配置 HTTPS 反向代理、安全 Cookie、可信访问边界和备份策略。
- 当前协作服务按单个 Uvicorn Worker 设计，不支持多 Worker、多实例或跨服务器同步。
- Reroll 面向个人创作者与可信小团队，不是成熟的互联网多租户 SaaS。

---

## 参与贡献

欢迎提交 Bug、需求、文档修正与实现建议：

- 提交前先搜索[已有 Issues](https://github.com/lazyq666/reroll-ai-canvas/issues)，避免重复。
- Bug 请尽量提供可复现步骤、系统和浏览器版本；截图中不要包含 API Key、Cookie、私网地址或本机绝对路径。
- 开始编码前请阅读[贡献指南](CONTRIBUTING.md)和项目根目录的 [AGENTS.md](AGENTS.md)。
- 产品中的用户可见文案需要同时提供中文与英文，并接入共享 i18n 资源。

---

## 原项目与作者

- 原项目：[hero8152/Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas)
- 原作者 GitHub：[hero8152](https://github.com/hero8152)
- 原作者 Bilibili：[78652351](https://space.bilibili.com/78652351)
- 原项目视频教程：[YouTube](https://youtu.be/r_y_9ALr7fg)
- 原项目配套 Chrome 插件：[Chrome Web Store](https://chromewebstore.google.com/detail/ajfhnbklbmpfaaookhfakohabnpmlcic)

感谢原作者公开完整项目，为无限画布、模型调用、素材管理与创作工具提供了核心基础。如果问题只出现在 Reroll 衍生版本中，请优先在本仓库反馈，避免给原作者增加与其代码无关的排查负担。

---

## 许可

本项目沿用仓库中的 [LICENSE](LICENSE) 及原项目声明：

- 禁止将项目修改、封装后作为商业产品；商业使用须取得相应授权。
- 基于本项目二次开发的软件必须继续公开源码并注明来源作者。
- 二次开发时应同时保留原作者 `hero8152`、原项目链接，以及 Reroll 衍生版本的修改来源。

这是一份带非商业限制的源码公开许可，不是 MIT、Apache-2.0 等标准 OSI 开源许可证。随仓库分发的第三方代码、字体、图标和服务标识继续适用各自条款，详见[第三方声明](THIRD_PARTY_NOTICES.md)。许可解释以 [LICENSE](LICENSE) 和原项目权利人的说明为准。
