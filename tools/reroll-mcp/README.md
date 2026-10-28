# Reroll MCP bridge

## Install from Reroll (recommended)

On the device running your Agent, open Reroll → account menu → **Agent access**.
Choose **Codex**, **Claude Desktop**, or **Claude Code**, and **macOS** or **Windows**.
Download and extract the installer, quit the selected app, then double-click
`Install.command` (macOS) or `Install.cmd` (Windows). Restart the app and ask it to
call Reroll. Match the request code in the webpage, approve, then retry in the Agent.
The installer does not install the Agent app itself or bypass its tool approvals.
For another device, use the server’s reachable LAN address in the browser before
downloading. `127.0.0.1` refers to the device running the Agent, not another server.

The ZIP contains only allowlisted bridge sources, a launcher, bilingual copy and the
selected server address. It carries no token, session cookie or account data. First
installation needs access to Astral, Python downloads and PyPI. The launcher installs
uv 0.11.32 privately and uses Python 3.12 with tomlkit 0.13.3; it does not edit shell
profiles or system Python. Windows uses a process-scoped PowerShell execution-policy
override, without changing the machine’s policy. If macOS blocks an unidentified
developer, verify the download source and allow opening it in Privacy & Security;
do not disable system protections. Extract the full ZIP before running the launcher.

Runtime location: `~/Library/Application Support/Reroll/agent` on macOS;
`%LOCALAPPDATA%\Reroll\agent` on Windows. Content-addressed `releases/` retain old
runtimes for rollback; `uv/`, `python/` and `cache/` are installer-managed dependencies.
Repeated installation reuses the release and does not add duplicate MCP entries.

| Client | Configuration updated |
| --- | --- |
| Codex | `$CODEX_HOME/config.toml`, default `~/.codex/config.toml`, `mcp_servers.reroll` |
| Claude Desktop on macOS | `~/Library/Application Support/Claude/claude_desktop_config.json`, `mcpServers.reroll` |
| Claude Desktop on Windows | `%APPDATA%\Claude\claude_desktop_config.json`, `mcpServers.reroll` |
| Claude Code | `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`), user-scope `mcpServers.reroll` |

Run the installer from the same environment as your app if you customize its config
location. Only the Reroll entry changes; unrelated MCP entries and settings survive,
and Codex TOML comments are retained. Existing credentials and allowed folders are
preserved for the same server address; changing the address starts fresh pairing
with empty folder access. The installer retains existing app approval/disable options;
if a project-specific Reroll entry shadows the user entry, remove that override in
the app. Managed enterprise restrictions still apply.

The installer validates configuration before downloading dependencies and replaces it
only after the bridge imports successfully. Each change gets a private
`.reroll-backup-<id>` file next to the original. Invalid/symlinked configurations,
concurrent installer runs and detected concurrent config edits fail without overwriting.
Quit the app before installation to avoid the app rewriting settings concurrently.
To roll back, quit the app and restore the backup. To uninstall, remove the `reroll`
MCP entry in the app, then delete its runtime folder. Revoke the server grant separately
in **Agent access**; runtime deletion does not revoke a token. Config backups may contain
existing credentials; keep them private. Pairing credentials remain in the separate
credential cache described below.

## Manual installation

Install on the computer running your Agent (Python 3.11+):

```sh
python -m pip install ./tools/reroll-mcp
```

For Claude, copy this configuration (use the installed executable's absolute
path when it is not on the client's PATH):

```json
{"mcpServers":{"reroll":{"command":"reroll-mcp","env":{"REROLL_URL":"http://127.0.0.1:3000","REROLL_ALLOWED_DIRS":"[]"}}}}
```

Call a Reroll tool, such as `list_models`. On first use it returns
`authorization_required` with the server address and a request code. Open Reroll in
the browser, sign in, match the code, and choose **Yes, allow**. Retry the tool to
continue. Approval grants canvas authoring and run requests to the approving Account;
it does not expire, and can be revoked in **Agent access**. It does not itself run
any generation. If Agent access is off, an Administrator's approval also enables it;
a Designer cannot enable the server. The browser must remain open for run execution.

Requests expire after 10 minutes. **No, deny**, Escape, and closing the dialog deny
access; the same denied request stays denied until expiry. Other open dialogs defer
the prompt. Pending prompts appear in visible workbench tabs; signing in or returning
to the tab discovers pending requests. Request names are supplied by the MCP client,
not verified identities: approve only a request you just initiated with a matching code.
The first account to approve owns the credential, including when multiple tabs are open.

The bridge saves credentials at `~/.config/reroll/mcp/`, separated by server address
and MCP client name, with private file permissions (`0600`). Restarts reuse them.
`REROLL_CLIENT_NAME` optionally overrides the name reported by the MCP client;
`REROLL_CREDENTIAL_DIR` optionally selects a dedicated credential folder. An unavailable
or malformed cache returns `credential_store_unavailable`. After revocation, the next
call returns `authorization_revoked`; retrying requests fresh browser approval.
Changing the name or server selects a separate credential. Explicit
`REROLL_AGENT_TOKEN` still overrides pairing for existing/manual configurations;
manual creation is under **Advanced** in Agent access.

`REROLL_ALLOWED_DIRS` is a JSON array of absolute directories; `[]` permits no local
reads. `REROLL_DOWNLOAD_DIR` optionally overrides `~/Downloads/Reroll`. Use the same
`REROLL_URL` as the browser. Restart the MCP process after environment changes.

Only trusted networks should use plain HTTP. The bridge never sends local paths,
never follows server redirects with credentials, and never overwrites downloads.
Connections go directly to `REROLL_URL`; ambient proxy environment variables are not used.
It uses the [official MCP Python SDK v1](https://py.sdk.modelcontextprotocol.io/v1/)
with a `<2` dependency boundary; it exposes stdio only.

When the user supplies a `Reroll workspace=... canvas=... nodes=...` line, start with
`read_node_reference(reference)` and pass the complete line. It verifies every target
and returns its latest persisted content, full text, type and version. Use the returned
explicit `canvas_id` for subsequent editing calls. Reading this explicit reference
preserves the session's existing Canvas lock and does not need an open editor.
On any failure, explain the diagnostic and wait for the user's decision. Do not edit
a valid subset or substitute a title search. Successful reading identifies objects;
the user's separate instruction determines whether to edit, and existing version
checks still apply. See [the reference contract](../../docs/current/node-references.md).

For work without a copied reference, start with `get_current_canvas`, `get_selection` and `get_model_capability`.
`create_generation_tasks` accepts 1–50 recipes; `capability.authoring.parameters` lists the fields
that can be authored through the existing Composer settings; refs support `node`, `node_name`,
`selection` (1-based), `asset`, `media`, `search` and `file`. A node's media `index`
is 0-based. Run with `dry_run=true` first: local files are represented by bounded
metadata, with no upload or Canvas write. Correct ambiguous or missing references,
then submit. A unique explicit `idempotency_key` lets the caller recover a lost
response; automatic transport retries reuse the generated key.

The recipe's `model` is an object, not a model-name string:

```json
{"kind":"image","prompt":"A quiet landscape","model":{"provider_id":"<provider from list_models>","model":"<model from list_models>"},"params":{"count":1}}
```

Use only parameters listed in `capability.authoring.parameters`; hidden catalog
defaults are validated automatically and do not need explicit overrides.

For video, pass `operation="video.generate"` to `get_model_capability`.
`output.audio.default` describes whether audio generation is enabled by default
(`null` means unconfirmed), while `output.audio.configurable` describes whether the
audio option can be adjusted. The maintained Dreamina Seedance 2.0/2.5 profiles
default to audio on and expose no audio toggle. Omit `params.generate_audio` when
it is absent from `authoring.parameters`. The legacy
`composer_options.generate_audio="unsupported"` describes the unavailable control;
it does not mean that generated video is silent. These fields describe generation
behavior; they do not inspect an individual output file's audio track.

The first selected Canvas stays locked until `use_canvas` or `create_canvas`.
`run_tasks` requires run scope and an open editor signed in to the same Account.
Without one, requests wait up to 24 hours. Authoring alone never triggers generation.

New submissions are placed near their existing reference Nodes. Without an
existing reference they are centered in the editor viewport, or near the Canvas
origin when offline, with deterministic avoidance in both axes. Existing Nodes
stay in place. Creation receipts include `frame_geometry` and `task_geometries`
(`{x, y, width, height}` in Canvas coordinates). Dry runs return planned geometry;
idempotent retries return the original receipt even after a later move. After
creation, independently call `get_generation_task` to verify its current
`geometry`, `frame_geometry`, model, parameters and inputs. `get_canvas` and
`get_selection` also return current Node geometry.

`get_task_status`, `download_outputs` and `undo_submission` operate on task or submission IDs.
Undo refuses subsequent edit conflicts and tasks that have started running.

## Editing an existing task without a browser

The bridge exposes 22 tools. Use `get_generation_task(node_id)` for the full persisted
prompt, settings, editability, node version and ordered input instances. `get_canvas`
only provides a 200-character summary and explicitly reports truncation.
Use `search_media` then `preview_media` to see actual image pixels (native MCP image
content, full frame and alpha preserved). Preview sources are `{media_id}`, `{asset_id}`,
`{node_id, media_index}` or `{node_id, output_id}`; ambiguous selections return candidates.
`max_edge` defaults to 1600 and supports 64–4096, without upscaling. Video/audio previews
are not included. Detail, preview and save only require the service and an approved
credential; no open editor is needed.

Call `update_generation_task` with `expected_node_revision` from the detail, `changes`,
and `dry_run=true`. Save with the same version, `dry_run=false`, and a stable
`idempotency_key`. Read `get_generation_task` independently afterward. Saving returns
the full persisted `after`, new node/canvas versions, `persisted:true` and
`generation_started:false`. A conflicting version changes nothing. A retry of the same
key/request returns the original saved result, even after subsequent edits.

Only specified fields change; `params` merges by key. If `refs` is supplied,
`refs_mode="replace"` replaces all effective media inputs; `{}` clears them. Preserve
desired inputs using the detail's `recipe.refs`, including `{input: reference_id}` for
task-scoped independent input instances. `{node, output_id}` binds a specific output;
multi-output sources never silently choose the latest. Historical references remain
stored but cannot reappear as inputs after replacement. Import local files explicitly
before an update. `return_after` is accepted; the full result is always returned.

Compatibility: calls without a version retain the original unchecked save behavior;
they cannot use dry run and do not provide the new readback guarantees. New callers
should always use the versioned flow. API-backed draft image/video tasks are editable;
other engines and runtime-dependent Loop/Splitter inputs are outside this P0 contract.
See the [full interface contract](../../docs/current/agent-task-editing.md).

After upgrading server code, restart the service. Reinstall/restart an installed bridge
to expose the new tools. Neither updating source files nor a test process upgrades an
already-running user service or client.

Tests:

```sh
python -m pip install tomlkit==0.13.3
python -m unittest discover -s tools/reroll-mcp/tests
```

<a id="reroll-cli"></a>

## Reroll image CLI / 图片命令行

The same Python package also installs `reroll`. It generates one image through the
running Reroll service, using its configured Providers. It does not start the service
or ask for a Provider API key. After initial browser pairing, no Canvas page or
browser needs to remain open for CLI image generation. MCP `run_tasks` continues to
use the browser editor; these are different execution entry points.

同一个 Python 包也提供 `reroll` 命令。它复用后台服务已配置的 Provider，一次生成并下载一张图片；
不负责启动服务，也不需要额外输入 Provider API Key。首次网页配对后，CLI 生图无需保持浏览器或
画布页面打开。原有 MCP `run_tasks` 仍由画布编辑端执行。

From the repository root, install once with Python 3.12 in an isolated environment:
在仓库根目录使用 Python 3.12 一次性安装：

```sh
python3.12 -m venv "$HOME/.local/share/reroll-cli"
"$HOME/.local/share/reroll-cli/bin/python" -m pip install ./tools/reroll-mcp
export PATH="$HOME/.local/share/reroll-cli/bin:$PATH"
reroll --help
```

The executable is `~/.local/share/reroll-cli/bin/reroll`. Add the `export PATH` line to
your shell profile (for example `~/.zshrc`) if you want it available in future terminals.
Reinstall from the updated checkout to upgrade. The package supports Python 3.11+;
Python 3.12 is the project-supported runtime. Pillow validates input files and the
actual downloaded image format and dimensions.

可执行文件位于 `~/.local/share/reroll-cli/bin/reroll`。将上述 `export PATH` 行加入 shell 配置
（例如 `~/.zshrc`），之后新开的终端也能直接调用。升级后从新代码重新安装。包要求 Python 3.11+，
项目验证使用 Python 3.12；Pillow 用于检查真实图片格式与尺寸。

On Windows PowerShell / Windows PowerShell 安装：

```powershell
py -3.12 -m venv "$env:LOCALAPPDATA\Reroll\cli"
& "$env:LOCALAPPDATA\Reroll\cli\Scripts\python.exe" -m pip install ./tools/reroll-mcp
$env:Path = "$env:LOCALAPPDATA\Reroll\cli\Scripts;$env:Path"
reroll --help
```

Windows executable: `%LOCALAPPDATA%\Reroll\cli\Scripts\reroll.exe`. Add its `Scripts`
folder to your user PATH for future terminals. The web MCP installer also includes
the `reroll` executable inside its installed release environment; it does not change
your shell PATH.

Windows 可执行文件为 `%LOCALAPPDATA%\Reroll\cli\Scripts\reroll.exe`。将该 `Scripts` 目录加入
用户 PATH，可供后续终端调用。网页 MCP 安装包的环境内也包含 `reroll`，但不会修改 shell PATH。

```sh
export REROLL_URL=http://127.0.0.1:3000
reroll models --json
reroll generate 'A quiet mountain landscape' \
  --provider '<provider_id>' --model '<model_id>' \
  --ratio 3:4 --resolution 2K --output ./results --json
reroll generate 'Keep image 1’s character and use image 2’s palette' \
  --provider '<provider_id>' --model '<model_id>' \
  --image ./character.png --image ./palette.png \
  --ratio 3:4 --resolution 2K --output ./results --json
reroll result '<run_id>' --output ./results --json
```

Use exact IDs and operation capabilities from `models`; `image.generate` and
`image.edit` can differ. Omitted ratio/tier values use only declared defaults.
`auto` needs exactly one reference input. Multiple images require an explicit ratio;
repeating one file still counts as two inputs. Reference order is preserved. Only
files explicitly passed with `--image` are read; uploads contain bytes and basenames.
`--size`, `--width`, `--height`, arbitrary Provider parameters, video and multiple
outputs are outside this version.

请使用 `models` 返回的准确身份与操作能力，文生图与图生图的能力可能不同。省略比例或档位时，
只采用目录声明的默认值。`auto` 必须恰好一张参考输入；多图必须明确指定比例，重复同一文件也
计为两张，顺序保持不变。CLI 只读取 `--image` 明确指定的文件，上传不包含本机完整路径。
本版不接受精确像素、任意 Provider 参数、视频或多张输出。

`REROLL_URL` defaults to `http://127.0.0.1:3000`; set it explicitly for another port
or device. The first command returns `authorization_required`: sign in at that
address, approve the matching request code, then retry. CLI credentials use the
existing private cache, with the default client name `Reroll CLI`; the MCP client's
grant is separate unless `REROLL_CLIENT_NAME` deliberately matches. Revocation and
account/role/Agent access settings are checked on each operation. Accounts requiring
per-run confirmation return `confirmation_required`; change that preference in
Reroll yourself if you want unattended CLI runs. The CLI does not change it.

`REROLL_URL` 默认指向 `http://127.0.0.1:3000`，使用其他端口或电脑时请显式设置。首次调用会返回
`authorization_required`；在对应服务登录、核对并批准识别码后，重试原命令即可。CLI 使用现有
私有授权缓存，默认名称为 `Reroll CLI`；除非主动设置相同的 `REROLL_CLIENT_NAME`，它与 MCP
客户端分别授权。每次操作仍检查授权、角色与接入设置。开启逐条确认的账号会收到
`confirmation_required`，请自行在 Reroll 已有设置中调整，CLI 不会修改该偏好。

Set `REROLL_LANGUAGE=zh` or `en` to select CLI copy; otherwise the shell locale is used.
In `--json` mode stdout contains one result object; progress and diagnostics go to
stderr. Success is returned only after a readable local image is saved. The default
output is `./reroll-output`, relative to the command's current directory. Existing
files are never overwritten; real format extensions and measured pixels are reported.

设置 `REROLL_LANGUAGE=zh` 或 `en` 选择文案；未设置时使用 shell 语言。`--json` 的 stdout
只有一个完整对象，进度写入 stderr。只有图片已下载且可读取才返回成功。输出目录默认为命令
所在目录下的 `./reroll-output`，同名文件追加序号，保留真实格式并返回实测像素尺寸。

| Exit / 退出码 | Meaning / 含义 |
| --- | --- |
| 0 | Image saved / 图片已保存 |
| 1 | Known input, authorization, generation or download failure / 已知失败 |
| 2 | Missing or unsupported command arguments / 命令用法错误 |
| 3 | Wait ended with a known Run ID; use `result` / 已知任务继续运行，使用 `result` 取回 |
| 4 | Submission unconfirmed; keep `request_id` and retry the original input / 提交结果未知，保留请求身份对账 |
| 130 | Interrupted; an accepted run is not canceled / 用户中断，已接收任务不取消 |

Waiting, including download, is limited to 900 seconds per command. A timeout or
Ctrl-C does not cancel the server task. Use `result <run_id>` after a known-run timeout
or download failure. For an unconfirmed submission, repeat `generate` with the
reported `--request-id` and the original prompt, images, ratio and resolution.
The same ID and inputs reconcile the original Run, including after model/default
changes; different inputs produce `request_conflict`. An ordinary new `generate`
uses a fresh ID. Never replace the ID automatically after an unknown response.

每次等待任务与下载最多 900 秒，超时或 Ctrl-C 不取消服务端任务。已知任务超时或下载失败后，
使用 `result <run_id>` 取回原结果。提交结果未知时，使用返回的 `--request-id`，以及原提示词、
图片、比例与档位原样重试 `generate`。即使模型或默认值后来变化，同一身份与输入仍对账原任务；
不同输入返回 `request_conflict`。普通的新 `generate` 自动创建新身份，不应在未知响应后自动换号。
