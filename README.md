<h1 align="center">
  <img src="static/images/brand/logo.png" alt="Reroll AI Canvas" width="64" valign="middle" /> Reroll AI Canvas
</h1>

<p align="center">
  <strong>几个人一起用 AI 出图、出视频，就在同一块画布上。</strong><br />
  提示词、参考图和每一次生成的结果都摆在一起，大家同时看、同时改。<br />
  装在自己电脑上，同事在局域网里打开浏览器就能用。
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
  <a href="#能帮你做什么">能帮你做什么</a> ·
  <a href="#三步用起来">三步用起来</a> ·
  <a href="#常见问题">常见问题</a> ·
  <a href="#进阶用法">进阶用法</a> ·
  <a href="#许可与致谢">许可与致谢</a>
</p>

<p align="center">
  <img src="docs/assets/reroll-ai-canvas-overview.png" alt="Reroll 的智能画布：提示词、图片和视频节点用连线串在一起，旁边是分区和批量运行" width="960" />
</p>

## 你可能也遇到过

- 好用的提示词散在聊天记录里，下次想用翻半天也找不到。
- 一个项目出了几十张图，已经说不清哪张是用什么提示词、哪个模型生成的。
- 改个角度、换个光、抠个图，都要在好几个软件之间导来导去。
- 给客户看稿得先导出、打包、发文件，改一版再来一遍。
- 不太放心把团队的素材和作品都传到别人的服务器上。

Reroll 把这些事都收进一块画布里。

## 能帮你做什么

<table>
<tr>
<td width="48%" valign="middle">

### 一群人改同一块画布

打开同一块画布就能一起干活，每个人的指针在哪儿都看得见。有人改了提示词、连了线、点了生成，所有人那边马上就变。几个人同时改也能协调好，改出问题还能恢复。

[了解实时协作 →](docs/current/realtime-collaboration-performance.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/e67f68b3-e5dd-4e43-adef-dcd82fdc8c87

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 谁能看、谁能改，一眼清楚

只有三种账号：管理员管全局，设计师做创作，访客只能进有限的几个页面，不能编辑画布，也进不了管理页面。新同事自己申请账号，管理员批准后，按项目给权限。

给客户看稿，发一个只读链接就行，对方不用注册；项目结束，一键收回。

[了解账号和权限 →](docs/PROJECT-MAP.md#用户和权限)

</td>
<td width="52%">

https://github.com/user-attachments/assets/7ffc8d13-75d1-4b9d-a53f-a5849caf7fdd

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 常用修图，不用切软件

选中一张图，就能拆成几个可以单独改的图层、换个拍摄角度、重新打光、把主体抠出来，还能生成深度图，或者从图片反推出提示词。

处理完的结果直接出现在原图旁边，接着用、拿来比都方便。

[了解生成流程 →](docs/current/generation-pipeline.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/2ca6cc47-8b29-4feb-88f2-aa20c981b8d5

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 好提示词存下来，下次一点就用

把用得顺手的提示词存成模板，把常用素材收进资产库。下次搜一下、看一眼，一点就放回画布，不用再翻聊天记录。

[了解资产库 →](docs/current/workspace-asset-library.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/f0a772c9-0aa5-4388-b4b2-c98910c7869b

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 数据就在你自己电脑上

Reroll 装在你自己的电脑上。画布、图片视频和生成记录，都存在你选定的文件夹里；同一个局域网里的同事，用浏览器就能连进来。

用在线模型生成时，生成请求会发给你自己配置的 AI 服务商。

[了解本机与局域网访问 →](docs/current/local-network-access.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/b9573ee8-578e-4312-8c9d-a2d730834f62

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### 一次排好几十张图

想试 4 个提示词 × 2 个模型？在批量生成里一次排好，提交前把任务清单过一遍，然后进度和结果都在一个地方看。

画布上也可以用“批量运行”，把一组变量依次换进去、挨个跑完。

[了解批量运行 →](docs/current/smart-canvas-batch-run-node.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/5834952d-1498-4a80-8c81-3e3358353db7

</td>
</tr>
</table>

<sub>短片由真实界面录屏和动画剪辑而成，其中抠图前后对比和局域网部分是示意动画。</sub>

除此之外，画布上还能用分区整理内容，放图片、视频、音频和文字，随时翻看生成记录。它可以接 ComfyUI、RunningHub、ModelScope 等服务，配置也能加密备份、带到另一台电脑。

---

## 三步用起来

**1. 启动。** 不用先装 Python，启动器会自己准备好运行环境，不会动你电脑上原有的 Python。

| 系统 | 怎么启动 |
| --- | --- |
| Windows 10/11 | 双击 `启动服务-Windows.bat` |
| macOS | 第一次右键选“打开” `启动服务-macOS.command`，以后直接双击 |
| Linux | 在终端运行 `bash 启动服务-macOS.command` |

**2. 打开浏览器。** 访问 `http://127.0.0.1:3000/`。如果 3000 端口被占用，会自动换成 3001、3002……

**3. 跟着引导走一遍。** 创建管理员账号，选好作品的保存位置，连上至少一个 AI 服务，然后点“开始创作”。其他服务以后可以在“API 设置”里再加。

之后，同事可以在登录页申请账号；你在“账号管理”里批准，再给他们分配项目。

> 第一次启动需要联网，用来下载运行环境。

---

## 常见问题

**要花钱吗？**
Reroll 本身不收费，个人和公司内部都可以用。用在线模型生成时，按你自己的服务商账户计费。

**能拿去做商业产品吗？**
不能。不允许把 Reroll 改一改、包装成商业产品出售；需要商用请先取得授权。它是源码公开项目，不是传统意义上的开源软件，详见 [LICENSE](LICENSE)。

**作品和素材存在哪？**
存在你自己电脑上、你选定的文件夹里。用在线模型生成时，生成请求会发给你配置的 AI 服务商。

**需要一直联网吗？**
第一次安装需要。之后要不要联网，看你用的是在线模型，还是本地的 ComfyUI。

**能放到公网上给外面的人用吗？**
不建议直接这么做。Reroll 是给个人和互相信任的小团队在局域网里用的。真要放到公网，需要自己配好 HTTPS、访问控制和备份。另外，它目前只支持单机运行。只想让本机访问的话，在 `.env` 里设置 `INFINITE_CANVAS_HOST=127.0.0.1` 并重启。详见[本机与局域网访问](docs/current/local-network-access.md)。

---

## 进阶用法

- **用本地 ComfyUI 生成视频：** 在“工作流设置”里接入你的 ComfyUI 和工作流，见 [H3 工作流说明](docs/current/comfyui-h3-workflows.md)。
- **让 Codex 或 Claude 帮你操作画布：** 在账号菜单的“应用连接”里下载安装包，装好后在网页上点一次“同意”就能连上，管理员需要先开启这项功能。见 [MCP 桥接说明](tools/reroll-mcp/README.md)。
- **在终端里直接生成图片：** 用 `reroll generate "提示词" …` 生成并下载图片，见 [Reroll CLI 说明](docs/current/reroll-cli.md)。
- **用 LaunchManager 等工具在后台启动：** 如果在线服务需要代理，要给启动项单独配置网络环境，见[后台启动的网络环境](docs/current/generation-pipeline.md#后台启动的网络环境)。
- **在两台电脑之间轮流使用（OneDrive）：** 换电脑前用“保存位置 → 安全关闭并交接”，见[工作区安全交接](docs/active/2026-09-27-workspace-handoff.md)；也可以用 [Turso 在线交接](docs/active/2026-09-29-online-workspace-handoff.md)，省去手动输入交接编号。

## 遇到问题

启动不了或依赖坏了，先跑一遍检查和修复：

```bash
# Windows
启动服务-Windows.bat check
启动服务-Windows.bat install --force

# macOS / Linux
./启动服务-macOS.command check
./启动服务-macOS.command install --force
```

想停止服务，在启动窗口按 `Ctrl+C` 就行；直接关掉窗口也会安全退出。请始终用启动器来启动，不要直接运行后端，否则切换保存位置时需要的自动重启会失效。

---

## 参与贡献

欢迎提 Bug、需求和改进建议。提之前先搜一下[已有 Issues](https://github.com/lazyq666/reroll-ai-canvas/issues)；报 Bug 时附上复现步骤、系统和浏览器版本。截图里不要露出 API Key、Cookie、内网地址或本机路径。

想改代码，先读[贡献指南](CONTRIBUTING.md)和 [AGENTS.md](AGENTS.md)。产品资料从[产品知识库](docs/README.md)和[项目地图](docs/PROJECT-MAP.md)开始看。安全问题请按[安全政策](SECURITY.md)私下报告。

---

## 许可与致谢

Reroll 使用带非商业限制的源码公开许可，完整条款以 [LICENSE](LICENSE) 为准：

- 个人和公司可以自己使用；禁止修改、封装成商业产品，商用须取得授权。
- 基于本项目二次开发的软件，必须继续公开源码，并注明来源作者。

随仓库分发的第三方代码、字体、图标和服务标识，各自适用自己的条款，见[第三方声明](THIRD_PARTY_NOTICES.md)。

Reroll 最初基于 [hero8152/Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas) 开发，按其许可注明原作者 hero8152。
