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
