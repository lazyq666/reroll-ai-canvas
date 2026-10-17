"""Reroll's local stdio MCP entry point (official MCP Python SDK)."""

import json
import os
from urllib.parse import quote
from mcp.server.fastmcp import FastMCP
from bridge import Bridge, BridgeError

mcp = FastMCP("Reroll Canvas")
bridge = None


def client():
    global bridge
    if bridge is None:
        name = os.environ.get('REROLL_CLIENT_NAME', '')
        if not name:
            try:
                name = mcp.get_context().session.client_params.clientInfo.name
            except (LookupError, ValueError, AttributeError):
                name = 'MCP Agent'
        bridge = Bridge(
            os.environ["REROLL_URL"],
            os.environ.get("REROLL_AGENT_TOKEN", ""),
            json.loads(os.environ.get("REROLL_ALLOWED_DIRS", "[]")),
            os.environ.get("REROLL_DOWNLOAD_DIR"),
            client_name=name,
            credential_directory=os.environ.get("REROLL_CREDENTIAL_DIR"),
        )
    return bridge


def call(function):
    try:
        client().authorize()
        return function()
    except BridgeError as error:
        return {"code": error.code, "message": str(error), "details": error.details}


def target(canvas=""):
    return "canvases/" + quote(client().canvas(canvas), safe="")


@mcp.tool()
def get_current_canvas() -> dict:
    """Resolve and lock this session's target Canvas. Never switches automatically."""
    return call(lambda: (client().canvas(), {"canvas": client().target})[1])


@mcp.tool()
def use_canvas(canvas: str) -> dict:
    """Select a Canvas by exact ID or unique partial name; ambiguity returns candidates."""
    return call(lambda: client().use_canvas(canvas))


@mcp.tool()
def list_canvases() -> dict:
    """List Canvases this Account can edit."""
    return call(lambda: client().request("GET", "canvases"))


@mcp.tool()
def create_canvas(title: str, idempotency_key: str = "") -> dict:
    """Create a Canvas in the default Project and lock it as the session target."""

    def create():
        result = client().request(
            "POST", "canvases", body={"title": title}, key=idempotency_key or None
        )
        client().target = result["canvas"]
        return result

    return call(create)


@mcp.tool()
def get_canvas(
    canvas: str = "",
    role: str = "",
    frame: str = "",
    query: str = "",
    selected: bool = False,
    offset: int = 0,
    limit: int = 200,
) -> dict:
    """Read a paginated, compact Canvas view. Maximum 200 Nodes per page."""
    return call(
        lambda: client().request(
            "GET",
            target(canvas),
            params={
                "role": role,
                "frame": frame,
                "query": query,
                "selected": str(selected).lower(),
                "offset": offset,
                "limit": limit,
            },
        )
    )


@mcp.tool()
def get_selection(canvas: str = "") -> dict:
    """Read this Account's private selection in stable visual order."""
    return call(lambda: client().request("GET", target(canvas) + "/selection"))


@mcp.tool()
def list_models() -> dict:
    """List configured generation Models without exposing Provider secrets."""
    return call(lambda: client().request("GET", "models"))


@mcp.tool()
def get_model_capability(
    provider: str, model: str, operation: str = "image.generate"
) -> dict:
    """Read authoritative input limits and parameter names before authoring a recipe."""
    return call(
        lambda: client().request(
            "GET",
            f'models/{quote(provider,safe="")}/{quote(model,safe="")}',
            params={"operation": operation},
        )
    )


@mcp.tool()
def search_media(query: str, canvas: str = "") -> dict:
    """Search Canvas media and the Workspace Asset Library."""
    return call(
        lambda: client().request(
            "GET",
            "media/search",
            params={"canvas": client().canvas(canvas), "query": query},
        )
    )


@mcp.tool()
def find_local_files(pattern: str = "*", kind: str = "", query: str = "") -> dict:
    """Search only configured allowed folders. Hidden files and escaping symlinks are excluded."""
    return call(lambda: client().find(pattern, kind, query))


@mcp.tool()
def import_media(file: str) -> dict:
    """Upload one allowed local file as content-deduplicated Managed Media."""
    return call(lambda: client().import_media(file))


@mcp.tool()
def create_generation_tasks(
    tasks: list[dict],
    canvas: str = "",
    title: str = "",
    dry_run: bool = False,
    idempotency_key: str = "",
) -> dict:
    """Atomically author 1–50 recipes; always dry_run first. Never starts generation.

    Recipe shape: {"prompt": "...", "kind": "image" | "video", "title": "...",
    "model": {"provider_id": "provider from list_models", "model": "model from list_models"},
    "params": {"count": 1, "aspect_ratio": "1:1", "resolution_tier": "1K"}, "refs": {}}.
    Model MUST be this nested object, not a string; do not put provider/provider_id at
    recipe top level or use model_id. Only prompt, kind, title, model, params, refs
    are accepted. Read get_model_capability for this model's supported param values.
    Refs maps @labels to source objects, e.g. {"hero": {"node": "node-id"}}.
    title, params and refs are optional. Dry run never uploads or mutates.
    """
    return call(
        lambda: client().submit(
            tasks, canvas, title, dry_run, key=idempotency_key or None
        )
    )


@mcp.tool()
def create_prompt_nodes(
    prompts: list[dict],
    canvas: str = "",
    title: str = "",
    dry_run: bool = False,
    idempotency_key: str = "",
) -> dict:
    """Create 1–50 ordinary Prompt Nodes, each with prompt and optional title."""
    return call(
        lambda: client().submit(
            prompts, canvas, title, dry_run, kind="prompts", key=idempotency_key or None
        )
    )


@mcp.tool()
def update_generation_task(
    node_id: str, changes: dict, canvas: str = "", idempotency_key: str = ""
) -> dict:
    """Update only specified recipe fields on a draft generation Node.

    Allowed changes: prompt, title, kind, model, params, refs. A model change must be
    {"model": {"provider_id": "...", "model": "..."}}, never a model string.
    """
    return call(
        lambda: client().request(
            "PATCH",
            target(canvas) + "/tasks/" + quote(node_id, safe=""),
            body=client().recipes([changes])[0],
            key=idempotency_key or None,
        )
    )


@mcp.tool()
def undo_submission(
    submission_id: str, canvas: str = "", idempotency_key: str = ""
) -> dict:
    """Safely undo this token's submission. Later edits and started Runs block undo."""
    return call(
        lambda: client().request(
            "POST",
            target(canvas) + "/submissions/" + quote(submission_id, safe="") + "/undo",
            body={},
            key=idempotency_key or None,
        )
    )


@mcp.tool()
def get_task_status(
    node_ids: list[str] = [], submission_id: str = "", canvas: str = ""
) -> dict:
    """Read task state and output download identities, including manually run tasks."""
    return call(
        lambda: client().request(
            "GET",
            target(canvas) + "/tasks",
            params={"node_ids": ",".join(node_ids), "submission_id": submission_id},
        )
    )


@mcp.tool()
def download_outputs(
    node_ids: list[str] = [], submission_id: str = "", canvas: str = ""
) -> dict:
    """Download outputs into the configured local download folder without overwriting files."""

    def download():
        result = get_task_status(node_ids, submission_id, canvas)
        return result if "code" in result else client().download(result["tasks"])

    return call(download)


@mcp.tool()
def run_tasks(node_ids: list[str], canvas: str = "", idempotency_key: str = "") -> dict:
    """Request up to 50 draft tasks to run in this Account's open editor. Requires run scope."""
    return call(
        lambda: client().request(
            "POST",
            target(canvas) + "/run-requests",
            body={"node_ids": node_ids},
            key=idempotency_key or None,
        )
    )


@mcp.tool()
def cancel_run_requests(request_ids: list[str], canvas: str = "") -> dict:
    """Cancel requests that have not been claimed by an editor."""
    return call(
        lambda: {
            "results": [
                client().request(
                    "DELETE", target(canvas) + "/run-requests/" + quote(r, safe="")
                )
                for r in request_ids
            ]
        }
    )


@mcp.prompt()
def author_canvas() -> str:
    """Guide for reference-aware, safe Canvas authoring."""
    return """Resolve get_current_canvas, get_selection and get_model_capability first. Use 1–50 recipes: {kind: image|video, prompt, title?, model: {provider_id, model}?, params: {}, refs: {label: source}}. Source is node, node_name, selection (1-based), asset, media, search or local file; node index is 0-based. Declare @labels explicitly; longest label wins and Chinese needs no spaces. Duplicate sources merge. Ask the user when references are ambiguous. First/last-frame video uses ordered first_frame / last_frame roles, never mixed with audio/video. All-around video must meet the catalog's combined limits. Always dry_run before submitting; dry_run does not upload local files. Keep the session target locked during batches. Authoring never runs or incurs generation costs. Only call run_tasks when requested; execution requires this Account's browser editor. Report the Canvas name and submission ID."""


def main():
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
