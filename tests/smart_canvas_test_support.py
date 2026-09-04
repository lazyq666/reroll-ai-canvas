from pathlib import Path


SMART_CANVAS_SCRIPT_PATHS = (
    Path("static/js/model-vendor-icons.js"),
    Path("static/js/smart-canvas/node-kinds.js"),
    Path("static/js/smart-canvas/node-geometry.js"),
    Path("static/js/smart-canvas/canvas-far-presentation.js"),
    Path("static/js/smart-canvas/node-placement.js"),
    Path("static/js/smart-canvas/canvas-virtualization.js"),
    Path("static/js/smart-canvas/image-studio-geometry.js"),
    Path("static/js/smart-canvas/canvas-persistence.js"),
    Path("static/js/smart-canvas/viewport-selection.js"),
    Path("static/js/smart-canvas/canvas-mutation.js"),
    Path("static/js/smart-canvas/smart-container.js"),
    Path("static/js/smart-canvas/canvas-interaction.js"),
    Path("static/js/smart-canvas/image-studio.js"),
    Path("static/js/smart-canvas/model-capabilities.js"),
    Path("static/js/smart-canvas/image-capabilities.js"),
    Path("static/js/smart-canvas/generation-settings.js"),
    Path("static/js/smart-canvas/prompt-authoring.js"),
    Path("static/js/smart-canvas/generation-provider.js"),
    Path("static/js/smart-canvas/generation-pending.js"),
    Path("static/js/smart-canvas/generation-output.js"),
    Path("static/js/smart-canvas/smart-matting.js"),
    Path("static/js/smart-canvas/generation-run.js"),
    Path("static/js/smart-canvas/generation-recovery.js"),
    Path("static/js/smart-canvas/generation-cascade.js"),
    Path("static/js/smart-canvas/connection-layer.js"),
    Path("static/js/smart-canvas.js"),
)


def read_smart_canvas_scripts(root: Path) -> str:
    """Return every Smart Canvas Module plus its host as one searchable source."""
    sections = []
    for relative_path in SMART_CANVAS_SCRIPT_PATHS:
        source = (root / relative_path).read_text(encoding="utf-8")
        sections.append(f"\n/* source: {relative_path.as_posix()} */\n{source}")
    return "".join(sections)
