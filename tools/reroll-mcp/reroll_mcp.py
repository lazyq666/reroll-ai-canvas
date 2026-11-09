"""Reroll's local stdio MCP entry point (official MCP Python SDK)."""

import json
import os
from urllib.parse import quote
from mcp.server.fastmcp import FastMCP
from mcp.types import ImageContent, TextContent
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
    """Read a compact Canvas view with current geometry. Maximum 200 Nodes per page."""
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
def read_node_reference(reference: str) -> dict:
    """Read ALL exact targets in a copied `Reroll workspace=... canvas=... nodes=...` line.

    Reads latest saved content, including full text and generation task details.
    Explicit reference routing does not use or change the session's Canvas lock,
    current selection, service or Workspace. Possession does not grant access.
    Only after the entire reference succeeds, use existing editing tools with
    the returned explicit canvas_id and node revisions for the user's request.
    On ANY failure, report the problem and await the user's decision; never
    substitute names or edit a valid subset. This read never generates or edits.
    """
    return call(lambda: client().request("POST", "node-references/read", body={"reference": reference}))


@mcp.tool()
def get_selection(canvas: str = "") -> dict:
    """Read this Account's private selection and geometry in stable visual order."""
    return call(lambda: client().request("GET", target(canvas) + "/selection"))


@mcp.tool()
def list_models() -> dict:
    """List configured generation Models without exposing Provider secrets."""
    return call(lambda: client().request("GET", "models"))


@mcp.tool()
def get_model_capability(
    provider: str, model: str, operation: str = "image.generate"
) -> dict:
    """Read authoritative input limits and parameter names before authoring a recipe.

    For video use operation="video.generate". output.audio.default describes
    default audio generation (null means unconfirmed); output.audio.configurable
    describes whether it can be controlled. An unavailable generate_audio toggle
    does not imply silent output. Only author fields in authoring.parameters.
    """
    return call(
        lambda: client().request(
            "GET",
            f'models/{quote(provider,safe="")}/{quote(model,safe="")}',
            params={"operation": operation},
        )
    )


@mcp.tool()
def generate_image(prompt: str, provider_id: str, model: str, request_id: str,
                   images: list[dict] | None = None, params: dict | None = None) -> dict:
    """Start one persistent image Run without an editor. Read get_model_capability first.

    Images are imported media_id/name pairs. Params accepts quality, output_format,
    frame_size, ratio, resolution, n, frame_count, frame_duration_ms, output_compression,
    and svg: {model}. GIF size is per frame. Reuse request_id to reconcile submission.
    """
    return call(lambda: client().request("POST", "image-runs", body={
        **(params or {}), "prompt": prompt, "provider_id": provider_id, "model": model,
        "request_id": request_id, "images": images or [],
    }, key=request_id))


@mcp.tool()
def get_image_run(run_id: str) -> dict:
    """Read or recover the original image Run without submitting another generation."""
    return call(lambda: client().request("GET", "image-runs/" + quote(run_id, safe="")))


@mcp.tool()
def download_image_run(run_id: str) -> dict:
    """Save original GIF, SVG or raster outputs into the configured download folder."""
    return call(lambda: client().download([
        client().request("GET", "image-runs/" + quote(run_id, safe=""))
    ]))


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
    Placement is near existing refs, else centered in the editor viewport (origin
    when offline), with two-dimensional obstacle avoidance. The receipt includes
    frame_geometry and task_geometries. Independently read get_generation_task
    after creation to verify current geometry, model, parameters and inputs.
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
def get_generation_task(node_id: str, canvas: str = "") -> dict:
    """Read a persisted task by exact ID, including its unabridged prompt, settings,
    node_revision, editability, geometry, frame_geometry, effective inputs and validation. Does not
    require an editor. Use this before update_generation_task and again after save.
    """
    return call(lambda: client().request("GET", target(canvas) + "/tasks/" + quote(node_id, safe="")))


@mcp.tool()
def preview_media(source: dict, canvas: str = "", max_edge: int = 1600) -> list[TextContent | ImageContent]:
    """See actual image pixels without a browser. Source is exactly one of:
    {media_id: id}, {asset_id: id}, {node_id: id, media_index: 0}, or
    {node_id: id, output_id: id}. Ambiguous sources return candidates, never the
    latest output. max_edge is 64–4096; images only shrink, retain the whole frame
    and transparency. Video/audio preview is not supported. Read-only, no uploads.
    """
    result = call(lambda: client().request("POST", target(canvas) + "/media/preview",
                 body={"source": source, "max_edge": max_edge}))
    if "code" in result:
        return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]
    return [TextContent(type="text", text=json.dumps(result["metadata"], ensure_ascii=False)),
            ImageContent(type="image", **result["image"])]


@mcp.tool()
def update_generation_task(
    node_id: str, changes: dict, canvas: str = "", idempotency_key: str = "",
    expected_node_revision: str = "", dry_run: bool = False, refs_mode: str = "replace",
    return_after: bool = True,
) -> dict:
    """Validate or atomically update specified fields on a persisted draft task.

    Allowed changes: prompt, title, kind, model, params, refs. A model change must be
    {"model": {"provider_id": "...", "model": "..."}}, never a model string.
    First get_generation_task, then pass its expected_node_revision and dry_run=true.
    Save using the same expected version and a stable idempotency_key. Refs replace
    ALL effective media inputs; omitted fields stay unchanged, params merge by key.
    Refs support {node: id, output_id: id} or {node: id, index: 0}; multiple outputs
    require explicit selection. Preserve existing independent input instances using
    {input: reference_id} from get_generation_task; this selector is task-scoped.
    Import local files separately with import_media.
    Always returns full after/validation; return_after is accepted for compatibility.
    Never starts generation. Calls without a version retain legacy unchecked-save
    behavior and cannot dry_run; use the versioned form for reliable editing.
    """
    def update():
        if expected_node_revision and not dry_run and not idempotency_key:
            raise BridgeError("idempotency_key_required")
        if "refs" in changes and not isinstance(changes["refs"], dict):
            raise BridgeError("invalid_refs")
        if any("file" in ref for ref in changes.get("refs", {}).values() if isinstance(ref, dict)):
            raise BridgeError("import_media_first")
        body = ({"changes": changes, "expected_node_revision": expected_node_revision,
                 "dry_run": dry_run, "refs_mode": refs_mode, "return_after": return_after}
                if expected_node_revision or dry_run else changes)
        return client().request("PATCH", target(canvas) + "/tasks/" + quote(node_id, safe=""),
                                body=body, key=idempotency_key or None)
    return call(update)


@mcp.tool()
def get_image_repair(node_id: str, canvas: str = "", image_index: int = 0) -> dict:
    """Read the existing Local repair draft for an exact image node and 0-based index.

    Returns original width/height, revision, strokes, full repair prompt, model,
    crop (null until the editor computes it), and repair run requests/output IDs.
    Use preview_media with preview_source to inspect the original before drawing.
    Coordinates are ORIGINAL image pixels, never thumbnail or Canvas coordinates.
    """
    return call(lambda: client().request("GET", target(canvas) + "/image-repairs/" + quote(node_id, safe=""),
                                        params={"image_index": image_index}))


@mcp.tool()
def update_image_repair(node_id: str, changes: dict, expected_revision: str,
                        canvas: str = "", image_index: int = 0, dry_run: bool = True,
                        idempotency_key: str = "") -> dict:
    """Prepare the SAME Local repair panel used by the app; never generates.

    First get_image_repair and preview_media. changes can contain prompt (the
    Repair requirements field), strokes, model:{provider_id,model}, aspect_ratio,
    resolution_tier, count, transparent_png. Omitted fields remain unchanged.
    strokes REPLACES the selection (up to 64), e.g.
    [{tool:"brush",size:42,points:[{x:100,y:120},{x:180,y:150}]},
     {tool:"rectangle",points:[{x:200,y:200},{x:300,y:280}]}].
    Points/brush size use original image pixels. A closed brush path only selects
    its bounding region; it is NOT a pixel mask. The existing green crop frame,
    crop editing and rectangular feathered composite remain unchanged.
    Preview with dry_run=true, then save with dry_run=false, the same revision and
    a stable idempotency_key; independently get_image_repair again. Saved strokes
    and prompt appear when opening Local repair and remain manually editable.
    An empty strokes list clears the selection. Empty aspect_ratio/resolution_tier
    selects automatic sizing. Model defaults like the existing panel.
    """
    def update():
        if not idempotency_key and not dry_run:
            raise BridgeError("idempotency_key_required")
        return client().request("PATCH", target(canvas) + "/image-repairs/" + quote(node_id, safe=""),
                                body={"image_index": image_index, "changes": changes,
                                      "expected_revision": expected_revision, "dry_run": dry_run},
                                key=idempotency_key or None)
    return call(update)


@mcp.tool()
def run_image_repair(node_id: str, expected_revision: str, canvas: str = "",
                     image_index: int = 0, idempotency_key: str = "") -> dict:
    """Run a saved Local repair through this Account's open canvas editor.

    Call only when the user requests generation. Requires run scope and respects
    the Account's confirmation preference. Read get_image_repair first and pass
    its revision; a changed image/draft is rejected. A stable idempotency_key is
    required. Uses the same crop, prompt, generation and feathered paste-back as
    the panel. Preserves the source and creates connected result nodes. Query
    get_image_repair.run_requests for state/output_node_ids, then get_task_status
    or download_outputs for those result IDs. Repeating this key never reruns it.
    """
    def run():
        if not idempotency_key:
            raise BridgeError("idempotency_key_required")
        return client().request("POST", target(canvas) + "/run-requests",
                                body={"node_ids": [node_id], "image_repair": {
                                    "image_index": image_index, "expected_revision": expected_revision}},
                                key=idempotency_key)
    return call(run)


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
    return """If the user supplies a copied Reroll node reference, call read_node_reference with the complete line first. On any failure, report it and wait for the user; never edit a valid subset or substitute another object. After whole-reference success, use its explicit canvas_id and node versions for the requested work. The read preserves the existing Canvas lock. Otherwise resolve get_current_canvas and get_selection. For Local repair, use get_image_repair and preview_media, update_image_repair with original-pixel brush/rectangle strokes and prompt (dry_run first, then versioned save), and independently read back. Only when generation is requested, use run_image_repair with the saved revision and a stable key; inspect its output_node_ids via get_image_repair. This is the existing crop-and-paste repair, not a pixel mask. Read get_model_capability before authoring. Use 1–50 recipes: {kind: image|video, prompt, title?, model: {provider_id, model}?, params: {}, refs: {label: source}}. Source is node, node_name, selection (1-based), asset, media, search or local file; node index is 0-based, output_id pins an exact generation output. Declare @labels explicitly; longest label wins and Chinese needs no spaces. Duplicate sources merge; task-scoped input identities preserve separate existing instances. Ask the user when references are ambiguous. First/last-frame video uses ordered first_frame / last_frame roles, never mixed with audio/video. All-around video must meet the catalog's combined limits. Always dry_run before submitting; dry_run does not upload local files. To edit an existing task: get_generation_task, search_media and preview_media, update_generation_task with expected_node_revision and dry_run=true, save with the same version and a stable idempotency_key, then independently get_generation_task again. Refs replace all media inputs; retain desired inputs from recipe.refs. No browser is required for these reads or edits. Keep the session target locked during batches. Authoring never runs or incurs generation costs. Only call run_tasks when requested; execution requires this Account's browser editor. Report the Canvas name and submission ID."""


def main():
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
