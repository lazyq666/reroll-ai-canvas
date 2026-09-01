"""Canvas resource-level permission rules for account-enabled V0."""

from __future__ import annotations

from typing import Any, Dict, Optional


VALID_VISIBILITIES = {"shared", "private"}


def can_access_project(
    user: Optional[Dict[str, Any]], project_id: str
) -> bool:
    if not user or user.get("role") not in {"admin", "designer"}:
        return False
    if user.get("role") == "admin":
        return True
    allowed = user.get("project_ids")
    # Accounts created before Project-scoped permissions keep their historical
    # all-Project access until an administrator saves an explicit selection.
    if allowed is None:
        return True
    return (str(project_id or "").strip() or "default") in {
        str(value) for value in allowed
    }


def ensure_canvas_access_fields(
    canvas: Dict[str, Any],
    initial_admin: Optional[Dict[str, Any]],
    owner: Optional[Dict[str, Any]] = None,
) -> bool:
    """Idempotently migrate a historical canvas to the V0 access schema."""
    if not initial_admin or not initial_admin.get("id"):
        return False
    changed = False
    admin_id = str(initial_admin["id"])
    defaults = {
        "owner_id": admin_id,
        "visibility": "shared",
        "created_by": admin_id,
        "updated_by": admin_id,
    }
    for key, value in defaults.items():
        if not canvas.get(key):
            canvas[key] = value
            changed = True
    owner = owner or initial_admin
    if (
        not canvas.get("owner_username")
        and owner
        and str(owner.get("id") or "") == str(canvas.get("owner_id") or "")
        and str(owner.get("username") or "").strip()
    ):
        canvas["owner_username"] = str(owner["username"]).strip()
        changed = True
    if canvas.get("visibility") not in VALID_VISIBILITIES:
        canvas["visibility"] = "shared"
        changed = True
    return changed


def user_owns_canvas(
    user: Optional[Dict[str, Any]], canvas: Dict[str, Any]
) -> bool:
    if not user:
        return False
    if str(canvas.get("owner_id") or "") == str(user.get("id") or ""):
        return True
    owner_username = str(canvas.get("owner_username") or "").strip().casefold()
    username = str(user.get("username") or "").strip().casefold()
    return bool(owner_username and username and owner_username == username)


def can_access_canvas(
    user: Optional[Dict[str, Any]], canvas: Dict[str, Any], *, write: bool = False
) -> bool:
    del write  # A Project grant gives designers read/write access within its boundary.
    if not user or user.get("role") not in {"admin", "designer"}:
        return False
    if not can_access_project(user, canvas.get("project") or "default"):
        return False
    if canvas.get("visibility") == "private":
        return user_owns_canvas(user, canvas)
    return True


def set_canvas_visibility(
    canvas: Dict[str, Any], visibility: str, actor: Dict[str, Any]
) -> Dict[str, Any]:
    visibility = str(visibility or "").strip().lower()
    if visibility not in VALID_VISIBILITIES:
        raise ValueError(f"unsupported visibility: {visibility}")
    if actor.get("role") != "admin":
        raise PermissionError("only administrators may change canvas visibility")
    if not user_owns_canvas(actor, canvas):
        raise PermissionError("administrators may only change their own canvas visibility")
    canvas["visibility"] = visibility
    return canvas


__all__ = [
    "VALID_VISIBILITIES",
    "can_access_canvas",
    "can_access_project",
    "ensure_canvas_access_fields",
    "set_canvas_visibility",
    "user_owns_canvas",
]
