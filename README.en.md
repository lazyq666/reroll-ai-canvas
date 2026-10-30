<h1 align="center">
  <img src="static/images/brand/logo.png" alt="Reroll AI Canvas" width="64" valign="middle" /> Reroll AI Canvas
</h1>

<p align="center">
  <strong>Make AI images and video together, on one shared canvas.</strong><br />
  Prompts, references and every generated result sit side by side, and everyone sees and edits them at the same time.<br />
  It runs on your own computer; teammates on your network just open a browser.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b>
</p>

<p align="center">
  <a href="https://github.com/lazyq666/reroll-ai-canvas/actions/workflows/public-readiness.yml"><img src="https://github.com/lazyq666/reroll-ai-canvas/actions/workflows/public-readiness.yml/badge.svg" alt="Public readiness" /></a>
  <img src="https://img.shields.io/badge/license-source--available-f59e0b?style=flat" alt="License: source-available" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6366f1?style=flat" alt="Supported platforms: Windows, macOS, and Linux" />
</p>

<p align="center">
  <a href="#what-it-does-for-you">What it does</a> ·
  <a href="#get-started-in-three-steps">Get started</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="#going-further">Going further</a> ·
  <a href="#license-and-credits">License</a>
</p>

<p align="center">
  <img src="docs/assets/reroll-ai-canvas-overview.png" alt="The Reroll Smart Canvas: prompt, image and video nodes linked together, with sections and a batch run alongside" width="960" />
</p>

## Sound familiar?

- The prompts that worked are buried somewhere in a chat history.
- A project has dozens of images, and nobody remembers which prompt or model made which one.
- Changing an angle, relighting or cutting out a subject means bouncing between several apps.
- Showing a client a draft means exporting, packing and sending files, and doing it all again after every round.
- You'd rather not upload your team's assets and work to someone else's server.

Reroll brings all of that onto one canvas.

## What it does for you

<table>
<tr>
<td width="48%" valign="middle">

### Everyone on the same canvas

Open the same canvas and work together. You can see where everyone's pointer is. When someone edits a prompt, draws a link or hits generate, everyone sees it right away. Edits made at the same time are reconciled, and mistakes can be recovered.

[Real-time collaboration →](docs/current/realtime-collaboration-performance.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/d3bb0d76-85bc-460c-b5a2-c11912522e57

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### Clear about who can see and edit what

There are just three kinds of account: Administrators run things, Designers create, and Guests can sign in to a few limited pages but can't edit canvases or open admin pages. New teammates request an account, and once an Administrator approves it, they get access project by project.

To show a client a draft, send a read-only link. They don't need to sign up, and you can take it back with one click when the project is done.

[Accounts and permissions →](docs/PROJECT-MAP.md#用户和权限)

</td>
<td width="52%">

https://github.com/user-attachments/assets/8035eb0e-05ef-4996-8d34-3780d51d552c

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### Everyday edits without switching apps

Pick an image and split it into layers you can edit separately, change the camera angle, relight it or cut out the subject. You can also make a depth map or turn the image back into a prompt.

Results appear right next to the original, ready to use or compare.

[Generation pipeline →](docs/current/generation-pipeline.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/89c20860-08b5-4769-8cee-7f4639d38e58

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### Save good prompts, reuse them in one click

Save the prompts that work as templates and keep your go-to assets in the asset library. Next time, search, take a look and drop them back onto the canvas, without digging through chat history.

[Asset library →](docs/current/workspace-asset-library.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/0fcb8b20-a045-40c7-85bb-1cc4bffe9997

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### Your data stays on your computer

Reroll runs on your own computer. Canvases, images, videos and generation history are stored in a folder you choose, and teammates on the same network connect from their browser.

When you use an online model, generation requests are sent to the AI provider you configured.

[Local and LAN access →](docs/current/local-network-access.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/0627e45c-3178-462f-a17d-a90a3969985f

</td>
</tr>
<tr>
<td width="48%" valign="middle">

### Line up dozens of images at once

Want to try 4 prompts × 2 models? Set it up once in batch generation, check the task list before you submit, then follow progress and results in one place.

On the canvas, **Batch run** swaps a set of variables in one by one and runs each step in turn.

[Batch run →](docs/current/smart-canvas-batch-run-node.md)

</td>
<td width="52%">

https://github.com/user-attachments/assets/384dafd2-91be-4a68-8330-ff1f91e98861

</td>
</tr>
</table>

<sub>These clips combine real screen recordings with animation; the background-removal comparison and the LAN segment are illustrative.</sub>

Beyond that, you can organize the canvas into sections; work with image, video, audio and text; and look back through every generation. Reroll connects to ComfyUI, RunningHub, ModelScope and more, and your settings can be backed up encrypted and moved to another computer.

> Most of the documentation linked below is written in Chinese.

---

## Get started in three steps

**1. Start it.** No need to install Python first: the launcher sets up what it needs and leaves your existing Python alone.

| System | How to start |
| --- | --- |
| Windows 10/11 | Double-click `启动服务-Windows.bat` (Start Reroll for Windows) |
| macOS | The first time, right-click `启动服务-macOS.command` and choose Open; after that, double-click it |
| Linux | Run `bash 启动服务-macOS.command` in a terminal |

**2. Open your browser.** Go to `http://127.0.0.1:3000/`. If port 3000 is taken, it moves on to 3001, 3002 and so on.

**3. Follow the setup.** Create the Administrator account, choose where your work is saved, connect at least one AI service, then click **Start creating**. You can add more services later in **API settings**.

After that, teammates can request accounts on the sign-in page; approve them in **Account management** and assign their projects.

> The first launch needs an internet connection to download the runtime.

---

## FAQ

**Does it cost anything?**
Reroll itself is free for personal use and use inside a company. When you generate with online models, you pay your own provider for that usage.

**Can I build a commercial product with it?**
No. You may not modify or repackage Reroll into a commercial product; commercial use needs authorization first. Reroll is source-available, not open source in the traditional sense. See the [LICENSE](LICENSE).

**Where is my work stored?**
On your own computer, in the folder you choose. When you use an online model, generation requests are sent to the AI provider you configured.

**Does it need to stay online?**
The first install does. After that, it depends on whether you use online models or a local ComfyUI.

**Can I put it on the public internet?**
We don't recommend doing that directly. Reroll is built for individuals and small, trusted teams on a local network. To expose it publicly you'd need your own HTTPS, access control and backups, and it currently runs on a single machine only. To allow only this computer, set `INFINITE_CANVAS_HOST=127.0.0.1` in `.env` and restart. See [local and LAN access](docs/current/local-network-access.md).

---

## Going further

- **Generate video with a local ComfyUI:** connect your ComfyUI and workflows in **Workflow settings**; see the [H3 workflow notes](docs/current/comfyui-h3-workflows.md).
- **Let Codex or Claude work on your canvas:** download the installer from **App connections** in the account menu, then click **Yes, allow** once in the browser to connect. An Administrator has to turn this on first. See the [MCP bridge guide](tools/reroll-mcp/README.md).
- **Generate images from the terminal:** `reroll generate "your prompt" …` generates and downloads an image. CLI generation has no application concurrency cap after a server update and restart; existing CLI installations keep working. **Canvas tasks at once** applies only to Agent canvas tasks. See the [Reroll CLI guide](docs/current/reroll-cli.md).
- **Start Reroll in the background with LaunchManager or similar:** if your online services need a proxy, configure that job's network environment; see [network setup for background launches](docs/current/generation-pipeline.md#后台启动的网络环境).
- **Take turns on two computers (OneDrive):** before switching, use **Storage location → Close workspace for handoff**; see [workspace handoff](docs/active/2026-09-27-workspace-handoff.md). [Turso online handoff](docs/active/2026-09-29-online-workspace-handoff.md) skips typing the handoff code. Real two-device acceptance is still in progress.

## Troubleshooting

If Reroll won't start or dependencies are broken, run the check and repair:

```bash
# Windows
启动服务-Windows.bat check
启动服务-Windows.bat install --force

# macOS / Linux
./启动服务-macOS.command check
./启动服务-macOS.command install --force
```

To stop the service, press `Ctrl+C` in the launcher window; closing the window also shuts it down safely. Always start Reroll through the launcher rather than running the backend directly, or the automatic restart needed when you switch storage locations won't work.

---

## Contributing

Bug reports, feature requests and ideas are welcome. Search the [existing issues](https://github.com/lazyq666/reroll-ai-canvas/issues) first, and include steps to reproduce plus your OS and browser versions when reporting a bug. Keep API keys, cookies, private network addresses and local paths out of screenshots.

Before changing code, read the [contributing guide](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). For product background, start with the [knowledge base](docs/README.md) and the [project map](docs/PROJECT-MAP.md). Please report security issues privately as described in the [security policy](SECURITY.md).

---

## License and credits

Reroll is source-available under a license with non-commercial restrictions; the [LICENSE](LICENSE) is authoritative:

- Individuals and companies may use it themselves; modifying or packaging it into a commercial product is prohibited, and commercial use requires authorization.
- Software built on this code must remain open source and credit the original author.

Third-party code, fonts, icons and service marks distributed with the repository remain under their own terms; see the [third-party notices](THIRD_PARTY_NOTICES.md).

Reroll was originally built on [hero8152/Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas); as its license requires, we credit the original author, hero8152.
