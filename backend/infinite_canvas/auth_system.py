"""Instance-owned account authentication for Reroll.

The module intentionally exposes a small surface:

- :class:`AuthSystem` owns one installation's SQLite account/session store.
- :func:`install_auth_routes` adds registration/login/logout/current-user HTTP contracts.

Self-registration creates a pending designer application and is capped for a
small team. An administrator must approve the application before login.
"""

from __future__ import annotations

import base64
import contextvars
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, Optional

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from .instance_state import InstanceState


SESSION_COOKIE = "ic_session"
VALID_ROLES = {"admin", "designer", "guest"}
VALID_STATUSES = {"active", "disabled"}
_CURRENT_USER: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar(
    "infinite_canvas_current_user", default=None
)

PUBLIC_EXACT_PATHS = {
    "/setup",
    "/api/setup",
    "/api/setup/status",
    "/api/setup/select-directory",
    "/api/setup/inspect-workspace",
    "/api/setup/open-workspace",
    "/login",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/registration",
    "/api/auth/logout",
    "/api/auth/me",
}
PUBLIC_PREFIXES = (
    "/share/",
    "/api/shares/",
    "/static/css/",
    "/static/js/",
    "/static/images/",
    "/static/vendor/",
)
ADMIN_ONLY_PREFIXES = (
    "/api/admin/",
    "/api/providers",
    "/api/config/token",
    "/api/comfyui/instances",
    "/api/workspace-storage-settings",
    "/api/runninghub/workflows",
    "/api/runninghub/app-info",
    "/api/jimeng/login",
    "/api/jimeng/logout",
    "/api/jimeng/help",
    "/api/codex/",
    "/api/gemini-cli/",
    "/api/update-from-",
    "/api/update-rollback",
    "/docs",
    "/redoc",
    "/openapi.json",
)
ADMIN_ONLY_HTML = {
    "/ui-component-library",
    "/static/account-management.html",
    "/static/api-settings.html",
    "/static/available-model-management.html",
    "/static/comfyui-settings.html",
    "/static/ui-component-library.html",
}


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    display_name: str = ""
    password: str


class InitialSetupRequest(BaseModel):
    username: str
    display_name: str = ""
    password: str
    workspace_directory: str = ""
    parent_dir: str = ""

    def selected_workspace_directory(self) -> str:
        return str(self.workspace_directory or self.parent_dir or "").strip()


class WorkspaceSelectionRequest(BaseModel):
    workspace_directory: str


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _derive_password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 600_000
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations, dklen=32
    )
    return f"pbkdf2_sha256${iterations}${_b64encode(salt)}${_b64encode(derived)}"


def hash_password(password: str) -> str:
    if len(password or "") < 8:
        raise ValueError("password must contain at least 8 characters")
    return _derive_password_hash(password)


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, raw_iterations, raw_salt, raw_hash = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        expected = _b64decode(raw_hash)
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            _b64decode(raw_salt),
            int(raw_iterations),
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


class AuthSystem:
    def __init__(
        self,
        database_path: Path | str,
        *,
        session_ttl_seconds: int = 7 * 24 * 60 * 60,
        secure_cookies: bool = False,
        max_accounts: int = 40,
        registration_enabled: bool = True,
        secure_directory: bool = False,
        legacy_workspace_id: str = "legacy-workspace",
    ) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.secure_directory = bool(secure_directory)
        self._secure_storage_permissions()
        self.session_ttl_seconds = int(session_ttl_seconds)
        self.secure_cookies = bool(secure_cookies)
        self.max_accounts = max(1, int(max_accounts))
        self.registration_enabled = bool(registration_enabled)
        self.legacy_workspace_id = (
            str(legacy_workspace_id or "").strip() or "legacy-workspace"
        )
        self._backup_existing_database_once()
        self._initialize()

    def _secure_storage_permissions(self) -> None:
        if self.secure_directory:
            try:
                self.database_path.parent.chmod(0o700)
            except OSError:
                pass
        for path in (
            self.database_path,
            Path(f"{self.database_path}-wal"),
            Path(f"{self.database_path}-shm"),
        ):
            if not path.exists():
                continue
            try:
                path.chmod(0o600)
            except OSError:
                pass

    def _backup_existing_database_once(self) -> None:
        if not self.database_path.is_file() or self.database_path.stat().st_size <= 0:
            return
        backup_dir = self.database_path.parent / "recovery"
        backup_path = backup_dir / f"{self.database_path.stem}.pre-v0-account-sharing.db"
        if backup_path.exists():
            return
        backup_dir.mkdir(parents=True, exist_ok=True)
        try:
            backup_dir.chmod(0o700)
        except OSError:
            pass
        source = sqlite3.connect(str(self.database_path), timeout=5)
        target = sqlite3.connect(str(backup_path), timeout=5)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        try:
            backup_path.chmod(0o600)
        except OSError:
            pass

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(str(self.database_path), timeout=5)
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA busy_timeout = 5000")
            connection.execute("PRAGMA foreign_keys = ON")
            with connection:
                yield connection
        finally:
            connection.close()
            self._secure_storage_permissions()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    avatar_color_slot INTEGER NOT NULL DEFAULT 0,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('admin', 'designer', 'guest')),
                    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at INTEGER NOT NULL,
                    last_seen_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    revoked_at INTEGER
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_user_id
                    ON sessions(user_id);

                CREATE TABLE IF NOT EXISTS user_canvas_view_states (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    workspace_id TEXT NOT NULL,
                    canvas_id TEXT NOT NULL,
                    center_x REAL NOT NULL,
                    center_y REAL NOT NULL,
                    scale REAL NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (user_id, workspace_id, canvas_id)
                );

                CREATE TABLE IF NOT EXISTS account_applications (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
                    requested_at INTEGER NOT NULL,
                    reviewed_at INTEGER,
                    reviewed_by TEXT REFERENCES users(id)
                );

                CREATE INDEX IF NOT EXISTS idx_account_applications_status
                    ON account_applications(status, requested_at);

                CREATE TABLE IF NOT EXISTS canvas_shares (
                    token_hash TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    canvas_id TEXT NOT NULL,
                    created_by TEXT NOT NULL REFERENCES users(id),
                    created_at INTEGER NOT NULL,
                    revoked_at INTEGER,
                    revoked_by TEXT REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS user_project_access_scopes (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    workspace_id TEXT NOT NULL,
                    configured_at INTEGER NOT NULL,
                    PRIMARY KEY (user_id, workspace_id)
                );

                CREATE TABLE IF NOT EXISTS user_project_permissions (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    workspace_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY (user_id, workspace_id, project_id)
                );

                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    actor_id TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    result TEXT NOT NULL,
                    details_json TEXT NOT NULL,
                    workspace_id TEXT,
                    created_at INTEGER NOT NULL
                );
                """
            )
            self._migrate_account_avatar_schema(connection)
            self._migrate_workspace_scoped_schema(connection)
            connection.executescript(
                """
                CREATE INDEX IF NOT EXISTS idx_user_canvas_view_states_canvas_id
                    ON user_canvas_view_states(workspace_id, canvas_id);
                CREATE INDEX IF NOT EXISTS idx_canvas_shares_canvas_id
                    ON canvas_shares(workspace_id, canvas_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_user_project_permissions_workspace
                    ON user_project_permissions(workspace_id, project_id);
                CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
                    ON audit_events(created_at);
                CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_id
                    ON audit_events(workspace_id, created_at);
                """
            )

    @staticmethod
    def _table_columns(
        connection: sqlite3.Connection,
        table: str,
    ) -> set[str]:
        return {
            str(row[1])
            for row in connection.execute(f'PRAGMA table_info("{table}")')
        }

    def _migrate_account_avatar_schema(
        self,
        connection: sqlite3.Connection,
    ) -> None:
        """Add and fully backfill the stable Account Avatar color slot."""

        if "avatar_color_slot" not in self._table_columns(connection, "users"):
            connection.execute(
                "ALTER TABLE users ADD COLUMN avatar_color_slot "
                "INTEGER NOT NULL DEFAULT 0"
            )
        connection.execute(
            """
            UPDATE users
            SET avatar_color_slot = 1 + ABS(RANDOM() % 10)
            WHERE avatar_color_slot NOT BETWEEN 1 AND 10
            """
        )

    def _migrate_workspace_scoped_schema(
        self,
        connection: sqlite3.Connection,
    ) -> None:
        """Assign legacy content-linked records to the current Workspace."""

        workspace_id = self.legacy_workspace_id
        if "workspace_id" not in self._table_columns(
            connection,
            "user_canvas_view_states",
        ):
            connection.executescript(
                """
                ALTER TABLE user_canvas_view_states
                    RENAME TO user_canvas_view_states_legacy;
                CREATE TABLE user_canvas_view_states (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    workspace_id TEXT NOT NULL,
                    canvas_id TEXT NOT NULL,
                    center_x REAL NOT NULL,
                    center_y REAL NOT NULL,
                    scale REAL NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (user_id, workspace_id, canvas_id)
                );
                """
            )
            connection.execute(
                """
                INSERT INTO user_canvas_view_states
                    (user_id, workspace_id, canvas_id, center_x, center_y,
                     scale, updated_at)
                SELECT user_id, ?, canvas_id, center_x, center_y, scale, updated_at
                FROM user_canvas_view_states_legacy
                """,
                (workspace_id,),
            )
            connection.execute("DROP TABLE user_canvas_view_states_legacy")

        if "workspace_id" not in self._table_columns(
            connection,
            "canvas_shares",
        ):
            connection.executescript(
                """
                ALTER TABLE canvas_shares RENAME TO canvas_shares_legacy;
                CREATE TABLE canvas_shares (
                    token_hash TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    canvas_id TEXT NOT NULL,
                    created_by TEXT NOT NULL REFERENCES users(id),
                    created_at INTEGER NOT NULL,
                    revoked_at INTEGER,
                    revoked_by TEXT REFERENCES users(id)
                );
                """
            )
            connection.execute(
                """
                INSERT INTO canvas_shares
                    (token_hash, workspace_id, canvas_id, created_by,
                     created_at, revoked_at, revoked_by)
                SELECT token_hash, ?, canvas_id, created_by,
                       created_at, revoked_at, revoked_by
                FROM canvas_shares_legacy
                """,
                (workspace_id,),
            )
            connection.execute("DROP TABLE canvas_shares_legacy")

        if "workspace_id" not in self._table_columns(
            connection,
            "audit_events",
        ):
            connection.execute(
                "ALTER TABLE audit_events ADD COLUMN workspace_id TEXT"
            )
            connection.execute(
                """
                UPDATE audit_events
                SET workspace_id = ?
                WHERE target_type IN ('canvas', 'project', 'workspace')
                """,
                (workspace_id,),
            )

    def audit(
        self,
        action: str,
        *,
        actor_id: str = "system",
        target_type: str = "system",
        target_id: str = "",
        result: str = "success",
        details: Optional[Dict[str, Any]] = None,
        workspace_id: Optional[str] = None,
    ) -> None:
        safe_details = {
            str(key): value
            for key, value in (details or {}).items()
            if str(key).lower() not in {"password", "token", "session", "api_key", "secret"}
        }
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO audit_events
                    (action, actor_id, target_type, target_id, result,
                     details_json, workspace_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(action or "unknown")[:80],
                    str(actor_id or "system")[:120],
                    str(target_type or "system")[:80],
                    str(target_id or "")[:200],
                    str(result or "unknown")[:40],
                    json.dumps(safe_details, ensure_ascii=False, separators=(",", ":")),
                    (str(workspace_id).strip() if workspace_id else None),
                    int(time.time()),
                ),
            )

    def list_audit_events(self, limit: int = 200) -> list[Dict[str, Any]]:
        limit = max(1, min(2000, int(limit)))
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM audit_events ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [
            {
                "id": row["id"],
                "action": row["action"],
                "actor_id": row["actor_id"],
                "target_type": row["target_type"],
                "target_id": row["target_id"],
                "result": row["result"],
                "details": json.loads(row["details_json"] or "{}"),
                "workspace_id": row["workspace_id"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    @staticmethod
    def public_user(row: sqlite3.Row | Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "avatar_color_slot": int(row["avatar_color_slot"]),
            "role": row["role"],
            "status": row["status"],
        }

    def create_user(
        self,
        *,
        username: str,
        password: str,
        role: str,
        display_name: str = "",
    ) -> Dict[str, Any]:
        username = str(username or "").strip()
        role = str(role or "").strip().lower()
        if not username:
            raise ValueError("username must not be empty")
        if role not in VALID_ROLES:
            raise ValueError(f"unsupported role: {role}")
        now = int(time.time())
        user_id = uuid.uuid4().hex
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO users
                        (id, username, display_name, avatar_color_slot,
                         password_hash, role, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
                    """,
                    (
                        user_id,
                        username,
                        (str(display_name or "").strip() or username)[:120],
                        secrets.randbelow(10) + 1,
                        hash_password(password),
                        role,
                        now,
                        now,
                    ),
                )
                row = connection.execute(
                    "SELECT * FROM users WHERE id = ?", (user_id,)
                ).fetchone()
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"username already exists: {username}") from exc
        user = self.public_user(row)
        self.audit(
            "account_created",
            actor_id="local-cli",
            target_type="user",
            target_id=user["id"],
            details={"username": user["username"], "role": user["role"]},
        )
        return user

    def needs_initial_setup(self) -> bool:
        with self._connect() as connection:
            return not bool(
                connection.execute("SELECT 1 FROM users LIMIT 1").fetchone()
            )

    def create_initial_admin(
        self,
        *,
        username: str,
        password: str,
        display_name: str = "",
    ) -> Dict[str, Any]:
        """Create the first administrator from user-supplied credentials."""
        username = str(username or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,31}", username):
            raise ValueError(
                "账号需为 3-32 位英文字母、数字或 _.-，且必须以字母或数字开头"
            )
        password_hash = hash_password(password)
        now = int(time.time())
        user_id = uuid.uuid4().hex
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                raise ValueError("初始化已经完成，不能再次创建管理员")
            connection.execute(
                """
                INSERT INTO users
                    (id, username, display_name, avatar_color_slot,
                     password_hash, role, status,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?)
                """,
                (
                    user_id,
                    username,
                    (str(display_name or "").strip() or username)[:120],
                    secrets.randbelow(10) + 1,
                    password_hash,
                    now,
                    now,
                ),
            )
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        user = self.public_user(row)
        self.audit(
            "initial_admin_created",
            actor_id="system",
            target_type="user",
            target_id=user["id"],
            details={"username": user["username"], "role": user["role"]},
        )
        return user

    def authenticate(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE username = ? COLLATE NOCASE",
                (str(username or "").strip(),),
            ).fetchone()
        if not row or row["status"] != "active":
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        return self.public_user(row)

    @staticmethod
    def public_application(row: sqlite3.Row | Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "role": "designer",
            "status": row["status"],
            "requested_at": row["requested_at"],
            "reviewed_at": row["reviewed_at"],
            "reviewed_by": row["reviewed_by"],
        }

    def submit_registration(
        self, *, username: str, password: str, display_name: str = ""
    ) -> Dict[str, Any]:
        if not self.registration_enabled:
            raise PermissionError("当前服务未开放自助注册")
        if not self.first_admin():
            raise PermissionError("首次管理员设置尚未完成")
        username = str(username or "").strip()
        now = int(time.time())
        application_id = uuid.uuid4().hex
        password_hash = hash_password(password)
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                existing_user = connection.execute(
                    "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE",
                    (username,),
                ).fetchone()
                if existing_user:
                    raise ValueError(f"账号已存在: {username}")
                active_count = connection.execute(
                    "SELECT COUNT(*) FROM users WHERE status = 'active'"
                ).fetchone()[0]
                pending_count = connection.execute(
                    "SELECT COUNT(*) FROM account_applications WHERE status = 'pending'"
                ).fetchone()[0]
                if int(active_count) + int(pending_count) >= self.max_accounts:
                    raise ValueError(
                        f"当前服务最多允许 {self.max_accounts} 个账号及待审核申请"
                    )
                existing_application = connection.execute(
                    "SELECT * FROM account_applications WHERE username = ? COLLATE NOCASE",
                    (username,),
                ).fetchone()
                if existing_application and existing_application["status"] == "pending":
                    raise ValueError(f"账号申请正在等待审核: {username}")
                display = (str(display_name or "").strip() or username)[:120]
                if existing_application:
                    application_id = existing_application["id"]
                    connection.execute(
                        """
                        UPDATE account_applications
                        SET display_name = ?, password_hash = ?, status = 'pending',
                            requested_at = ?, reviewed_at = NULL, reviewed_by = NULL
                        WHERE id = ?
                        """,
                        (display, password_hash, now, application_id),
                    )
                else:
                    connection.execute(
                        """
                        INSERT INTO account_applications
                            (id, username, display_name, password_hash, status,
                             requested_at, reviewed_at, reviewed_by)
                        VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL)
                        """,
                        (application_id, username, display, password_hash, now),
                    )
                row = connection.execute(
                    "SELECT * FROM account_applications WHERE id = ?", (application_id,)
                ).fetchone()
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"账号已存在: {username}") from exc
        application = self.public_application(row)
        self.audit(
            "account_application_submitted",
            actor_id="anonymous",
            target_type="account_application",
            target_id=application["id"],
            details={"username": application["username"]},
        )
        return application

    def registration_status(self) -> Dict[str, Any]:
        with self._connect() as connection:
            active_count = int(
                connection.execute(
                    "SELECT COUNT(*) FROM users WHERE status = 'active'"
                ).fetchone()[0]
            )
            pending_count = int(
                connection.execute(
                    "SELECT COUNT(*) FROM account_applications WHERE status = 'pending'"
                ).fetchone()[0]
            )
        has_admin = bool(self.first_admin())
        enabled = self.registration_enabled and has_admin
        return {
            "enabled": enabled,
            "max_accounts": self.max_accounts,
            "active_accounts": active_count,
            "pending_applications": pending_count,
            "remaining": max(0, self.max_accounts - active_count - pending_count),
            "reason": "" if enabled else (
                "disabled" if not self.registration_enabled else "admin_required"
            ),
        }

    def list_users(self) -> list[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM users ORDER BY created_at, username"
            ).fetchall()
        return [self.public_user(row) for row in rows]

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        return self.public_user(row) if row else None

    def get_user_project_ids(
        self,
        user_id: str,
        workspace_id: str,
    ) -> Optional[list[str]]:
        """Return an explicit Project allow-list, or ``None`` for legacy all-access."""

        normalized_user_id = str(user_id or "").strip()
        normalized_workspace_id = str(workspace_id or "").strip()
        if not normalized_user_id or not normalized_workspace_id:
            return None
        with self._connect() as connection:
            configured = connection.execute(
                """
                SELECT 1 FROM user_project_access_scopes
                WHERE user_id = ? AND workspace_id = ?
                """,
                (normalized_user_id, normalized_workspace_id),
            ).fetchone()
            if not configured:
                return None
            rows = connection.execute(
                """
                SELECT project_id FROM user_project_permissions
                WHERE user_id = ? AND workspace_id = ?
                ORDER BY project_id
                """,
                (normalized_user_id, normalized_workspace_id),
            ).fetchall()
        return [str(row["project_id"]) for row in rows]

    def set_user_project_ids(
        self,
        user_id: str,
        workspace_id: str,
        project_ids: list[str],
        *,
        actor_id: str,
    ) -> list[str]:
        """Replace one account's Project allow-list for a Workspace."""

        normalized_user_id = str(user_id or "").strip()
        normalized_workspace_id = str(workspace_id or "").strip()
        normalized_project_ids = sorted(
            {
                str(project_id or "").strip()
                for project_id in (project_ids or [])
                if str(project_id or "").strip()
            }
        )
        if not normalized_user_id or not normalized_workspace_id:
            raise ValueError("账号和工作区不能为空")
        now = int(time.time())
        with self._connect() as connection:
            user = connection.execute(
                "SELECT role FROM users WHERE id = ?",
                (normalized_user_id,),
            ).fetchone()
            if not user:
                raise ValueError("账号不存在")
            if user["role"] != "designer":
                raise ValueError("只有设计师账号需要设置项目权限")
            connection.execute(
                """
                INSERT INTO user_project_access_scopes
                    (user_id, workspace_id, configured_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, workspace_id) DO UPDATE SET
                    configured_at = excluded.configured_at
                """,
                (normalized_user_id, normalized_workspace_id, now),
            )
            connection.execute(
                """
                DELETE FROM user_project_permissions
                WHERE user_id = ? AND workspace_id = ?
                """,
                (normalized_user_id, normalized_workspace_id),
            )
            connection.executemany(
                """
                INSERT INTO user_project_permissions
                    (user_id, workspace_id, project_id, created_at)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        normalized_user_id,
                        normalized_workspace_id,
                        project_id,
                        now,
                    )
                    for project_id in normalized_project_ids
                ],
            )
        self.audit(
            "account_project_permissions_changed",
            actor_id=actor_id,
            target_type="user",
            target_id=normalized_user_id,
            details={"project_ids": normalized_project_ids},
            workspace_id=normalized_workspace_id,
        )
        return normalized_project_ids

    def user_with_project_access(
        self,
        user: Optional[Dict[str, Any]],
        workspace_id: str,
    ) -> Optional[Dict[str, Any]]:
        if not user:
            return None
        enriched = dict(user)
        enriched["project_ids"] = self.get_user_project_ids(
            enriched.get("id", ""),
            workspace_id,
        )
        return enriched

    @staticmethod
    def _canvas_view_state(row: sqlite3.Row | Dict[str, Any]) -> Dict[str, Any]:
        return {
            "center_x": float(row["center_x"]),
            "center_y": float(row["center_y"]),
            "scale": float(row["scale"]),
            "updated_at": int(row["updated_at"]),
        }

    def get_canvas_view_state(
        self,
        user_id: str,
        workspace_id: str,
        canvas_id: str,
    ) -> Optional[Dict[str, Any]]:
        """Return one account's private camera position for a canvas."""

        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT center_x, center_y, scale, updated_at
                FROM user_canvas_view_states
                WHERE user_id = ? AND workspace_id = ? AND canvas_id = ?
                """,
                (
                    str(user_id or ""),
                    str(workspace_id or ""),
                    str(canvas_id or ""),
                ),
            ).fetchone()
        return self._canvas_view_state(row) if row else None

    def save_canvas_view_state(
        self,
        user_id: str,
        workspace_id: str,
        canvas_id: str,
        *,
        center_x: float,
        center_y: float,
        scale: float,
    ) -> Dict[str, Any]:
        """Upsert a minimap-compatible camera position for one account."""

        normalized_user_id = str(user_id or "").strip()
        normalized_workspace_id = str(workspace_id or "").strip()
        normalized_canvas_id = str(canvas_id or "").strip()
        values = (float(center_x), float(center_y), float(scale))
        if (
            not normalized_user_id
            or not normalized_workspace_id
            or not normalized_canvas_id
        ):
            raise ValueError("user_id, workspace_id and canvas_id are required")
        if not all(math.isfinite(value) for value in values):
            raise ValueError("canvas view state must contain finite numbers")
        if abs(values[0]) > 1_000_000_000 or abs(values[1]) > 1_000_000_000:
            raise ValueError("canvas view center is out of range")
        if values[2] < 0.02 or values[2] > 8:
            raise ValueError("canvas view scale is out of range")
        updated_at = int(time.time() * 1000)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO user_canvas_view_states
                    (user_id, workspace_id, canvas_id, center_x, center_y,
                     scale, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, workspace_id, canvas_id) DO UPDATE SET
                    center_x = excluded.center_x,
                    center_y = excluded.center_y,
                    scale = excluded.scale,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized_user_id,
                    normalized_workspace_id,
                    normalized_canvas_id,
                    values[0],
                    values[1],
                    values[2],
                    updated_at,
                ),
            )
        return {
            "center_x": values[0],
            "center_y": values[1],
            "scale": values[2],
            "updated_at": updated_at,
        }

    def delete_canvas_view_states(
        self,
        workspace_id: str,
        canvas_id: str,
    ) -> int:
        """Remove private camera positions after a canvas is permanently purged."""

        with self._connect() as connection:
            cursor = connection.execute(
                """
                DELETE FROM user_canvas_view_states
                WHERE workspace_id = ? AND canvas_id = ?
                """,
                (str(workspace_id or ""), str(canvas_id or "")),
            )
        return max(0, int(cursor.rowcount or 0))

    def delete_user(self, user_id: str, *, actor_id: str) -> None:
        if user_id == actor_id:
            raise ValueError("不能删除当前登录的管理员账号")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if not row:
                raise ValueError("账号不存在")
            if row["role"] == "admin":
                admin_count = int(
                    connection.execute(
                        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'"
                    ).fetchone()[0]
                )
                if admin_count <= 1:
                    raise ValueError("不能删除最后一个启用的管理员账号")
            connection.execute(
                "UPDATE account_applications SET reviewed_by = NULL WHERE reviewed_by = ?",
                (user_id,),
            )
            connection.execute(
                "DELETE FROM canvas_shares WHERE created_by = ?", (user_id,)
            )
            connection.execute(
                "UPDATE canvas_shares SET revoked_by = NULL WHERE revoked_by = ?",
                (user_id,),
            )
            connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        self.audit(
            "account_deleted",
            actor_id=actor_id,
            target_type="user",
            target_id=user_id,
            details={"username": row["username"], "role": row["role"]},
        )

    def list_applications(self) -> list[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM account_applications
                WHERE status IN ('pending', 'rejected')
                ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,
                         requested_at, username
                """
            ).fetchall()
        return [self.public_application(row) for row in rows]

    def approve_application(
        self, application_id: str, actor_id: str
    ) -> Dict[str, Any]:
        now = int(time.time())
        user_id = uuid.uuid4().hex
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM account_applications WHERE id = ?",
                (application_id,),
            ).fetchone()
            if not row:
                raise ValueError("账号申请不存在")
            if row["status"] != "pending":
                raise ValueError("该账号申请已处理")
            active_count = int(
                connection.execute(
                    "SELECT COUNT(*) FROM users WHERE status = 'active'"
                ).fetchone()[0]
            )
            if active_count >= self.max_accounts:
                raise ValueError(f"当前服务最多允许 {self.max_accounts} 个启用账号")
            try:
                connection.execute(
                    """
                    INSERT INTO users
                        (id, username, display_name, avatar_color_slot,
                         password_hash, role, status,
                         created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'designer', 'active', ?, ?)
                    """,
                    (
                        user_id,
                        row["username"],
                        row["display_name"],
                        secrets.randbelow(10) + 1,
                        row["password_hash"],
                        now,
                        now,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError(f"账号已存在: {row['username']}") from exc
            connection.execute(
                """
                UPDATE account_applications
                SET status = 'approved', reviewed_at = ?, reviewed_by = ?
                WHERE id = ?
                """,
                (now, actor_id, application_id),
            )
            user = self._updated_user(connection, user_id)
        self.audit(
            "account_application_approved",
            actor_id=actor_id,
            target_type="user",
            target_id=user_id,
            details={"username": user["username"]},
        )
        return user

    def reject_application(
        self, application_id: str, actor_id: str
    ) -> Dict[str, Any]:
        now = int(time.time())
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE account_applications
                SET status = 'rejected', reviewed_at = ?, reviewed_by = ?
                WHERE id = ? AND status = 'pending'
                """,
                (now, actor_id, application_id),
            )
            if not cursor.rowcount:
                row = connection.execute(
                    "SELECT status FROM account_applications WHERE id = ?",
                    (application_id,),
                ).fetchone()
                if not row:
                    raise ValueError("账号申请不存在")
                raise ValueError("该账号申请已处理")
            row = connection.execute(
                "SELECT * FROM account_applications WHERE id = ?",
                (application_id,),
            ).fetchone()
        application = self.public_application(row)
        self.audit(
            "account_application_rejected",
            actor_id=actor_id,
            target_type="account_application",
            target_id=application_id,
            details={"username": application["username"]},
        )
        return application

    def first_admin(self) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM users
                WHERE role = 'admin'
                ORDER BY created_at, rowid
                LIMIT 1
                """
            ).fetchone()
        return self.public_user(row) if row else None

    def _updated_user(self, connection: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise ValueError("user does not exist")
        return self.public_user(row)

    def set_user_role(self, user_id: str, role: str) -> Dict[str, Any]:
        role = str(role or "").strip().lower()
        if role not in VALID_ROLES:
            raise ValueError(f"unsupported role: {role}")
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET role = ?, updated_at = ? WHERE id = ?",
                (role, int(time.time()), user_id),
            )
            if not cursor.rowcount:
                raise ValueError("user does not exist")
            user = self._updated_user(connection, user_id)
        self.audit("account_role_changed", actor_id="local-cli", target_type="user", target_id=user_id, details={"role": role})
        return user

    def set_user_status(self, user_id: str, status: str) -> Dict[str, Any]:
        status = str(status or "").strip().lower()
        if status not in VALID_STATUSES:
            raise ValueError(f"unsupported status: {status}")
        now = int(time.time())
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET status = ?, updated_at = ? WHERE id = ?",
                (status, now, user_id),
            )
            if not cursor.rowcount:
                raise ValueError("user does not exist")
            if status == "disabled":
                connection.execute(
                    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                    (now, user_id),
                )
            user = self._updated_user(connection, user_id)
        self.audit("account_status_changed", actor_id="local-cli", target_type="user", target_id=user_id, details={"status": status})
        return user

    def reset_password(
        self, user_id: str, password: str, *, actor_id: str = "local-cli"
    ) -> Dict[str, Any]:
        now = int(time.time())
        password_hash = hash_password(password)
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (password_hash, now, user_id),
            )
            if not cursor.rowcount:
                raise ValueError("user does not exist")
            connection.execute(
                "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                (now, user_id),
            )
            user = self._updated_user(connection, user_id)
        self.audit(
            "account_password_reset",
            actor_id=actor_id,
            target_type="user",
            target_id=user_id,
        )
        return user

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO sessions
                    (token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at)
                VALUES (?, ?, ?, ?, ?, NULL)
                """,
                (
                    self._token_hash(token),
                    user_id,
                    now,
                    now,
                    now + self.session_ttl_seconds,
                ),
            )
        return token

    def user_for_session(self, token: str) -> Optional[Dict[str, Any]]:
        if not token:
            return None
        now = int(time.time())
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.*
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ?
                  AND sessions.revoked_at IS NULL
                  AND sessions.expires_at > ?
                  AND users.status = 'active'
                """,
                (self._token_hash(token), now),
            ).fetchone()
            if row:
                connection.execute(
                    "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
                    (now, self._token_hash(token)),
                )
        return self.public_user(row) if row else None

    def revoke_session(self, token: str) -> None:
        if not token:
            return
        with self._connect() as connection:
            connection.execute(
                "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
                (int(time.time()), self._token_hash(token)),
            )

    def revoke_all_sessions(self) -> int:
        """Invalidate every browser identity belonging to this Workspace."""

        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL",
                (int(time.time()),),
            )
            return max(0, int(cursor.rowcount or 0))

    @staticmethod
    def _public_share(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "workspace_id": row["workspace_id"],
            "canvas_id": row["canvas_id"],
            "token_hash": row["token_hash"],
            "created_by": row["created_by"],
            "created_at": row["created_at"],
            "revoked_at": row["revoked_at"],
            "active": row["revoked_at"] is None,
        }

    def replace_canvas_share(
        self,
        workspace_id: str,
        canvas_id: str,
        actor_id: str,
    ) -> Dict[str, Any]:
        workspace_id = str(workspace_id or "").strip()
        canvas_id = str(canvas_id or "").strip()
        if not workspace_id or not canvas_id:
            raise ValueError("workspace_id and canvas_id must not be empty")
        token = secrets.token_urlsafe(32)
        token_hash = self._token_hash(token)
        now = int(time.time())
        with self._connect() as connection:
            had_active_share = bool(
                connection.execute(
                    """
                    SELECT 1 FROM canvas_shares
                    WHERE workspace_id = ? AND canvas_id = ?
                      AND revoked_at IS NULL
                    LIMIT 1
                    """,
                    (workspace_id, canvas_id),
                ).fetchone()
            )
            connection.execute(
                """
                UPDATE canvas_shares
                SET revoked_at = ?, revoked_by = ?
                WHERE workspace_id = ? AND canvas_id = ? AND revoked_at IS NULL
                """,
                (now, actor_id, workspace_id, canvas_id),
            )
            connection.execute(
                """
                INSERT INTO canvas_shares
                    (token_hash, workspace_id, canvas_id, created_by,
                     created_at, revoked_at, revoked_by)
                VALUES (?, ?, ?, ?, ?, NULL, NULL)
                """,
                (token_hash, workspace_id, canvas_id, actor_id, now),
            )
        self.audit(
            "share_regenerated" if had_active_share else "share_created",
            actor_id=actor_id,
            target_type="canvas",
            target_id=canvas_id,
            workspace_id=workspace_id,
        )
        return {
            "token": token,
            "token_hash": token_hash,
            "workspace_id": workspace_id,
            "canvas_id": canvas_id,
            "created_by": actor_id,
            "created_at": now,
            "active": True,
        }

    def resolve_canvas_share(
        self,
        token: str,
        workspace_id: str,
    ) -> Optional[Dict[str, Any]]:
        if not token or not workspace_id:
            return None
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM canvas_shares
                WHERE token_hash = ? AND workspace_id = ?
                  AND revoked_at IS NULL
                """,
                (self._token_hash(token), str(workspace_id)),
            ).fetchone()
        return self._public_share(row) if row else None

    def canvas_share_status(
        self,
        workspace_id: str,
        canvas_id: str,
    ) -> Dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM canvas_shares
                WHERE workspace_id = ? AND canvas_id = ?
                ORDER BY created_at DESC, rowid DESC
                LIMIT 1
                """,
                (str(workspace_id), canvas_id),
            ).fetchone()
        if not row:
            return {
                "workspace_id": str(workspace_id),
                "canvas_id": canvas_id,
                "active": False,
            }
        return self._public_share(row)

    def revoke_canvas_share(
        self,
        workspace_id: str,
        canvas_id: str,
        actor_id: str,
    ) -> bool:
        now = int(time.time())
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE canvas_shares
                SET revoked_at = ?, revoked_by = ?
                WHERE workspace_id = ? AND canvas_id = ? AND revoked_at IS NULL
                """,
                (now, actor_id, str(workspace_id), canvas_id),
            )
        changed = bool(cursor.rowcount)
        if changed:
            self.audit(
                "share_revoked",
                actor_id=actor_id,
                target_type="canvas",
                target_id=canvas_id,
                workspace_id=str(workspace_id),
            )
        return changed


def _set_session_cookie(response: Response, auth: AuthSystem, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=auth.secure_cookies,
        samesite="lax",
        max_age=auth.session_ttl_seconds,
        path="/",
    )


def _local_client(request: Request) -> bool:
    host = str(request.client.host if request.client else "").strip().lower()
    if host in {"localhost", "testclient"}:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def install_auth_routes(
    app: FastAPI,
    auth: AuthSystem,
    *,
    before_delete: Optional[
        Callable[[Dict[str, Any], Dict[str, Any]], None]
    ] = None,
    initial_setup_configurator: Optional[
        Callable[[str], Dict[str, Any]]
    ] = None,
    initial_directory_picker: Optional[Callable[[], str]] = None,
    initial_setup_status_provider: Optional[
        Callable[[], Dict[str, Any]]
    ] = None,
    initial_workspace_inspector: Optional[
        Callable[[str], Dict[str, Any]]
    ] = None,
    initial_workspace_opener: Optional[
        Callable[[str], Dict[str, Any]]
    ] = None,
    user_enricher: Optional[
        Callable[[Dict[str, Any]], Dict[str, Any]]
    ] = None,
) -> None:
    failed_logins: Dict[str, list[float]] = {}

    def setup_error(status_code: int, reason: str, detail: str) -> JSONResponse:
        """Keep setup diagnostics compatible while exposing a stable UI code."""

        return JSONResponse(
            status_code=status_code,
            content={"detail": detail, "reason": reason},
        )

    def public_session_user(user: Dict[str, Any]) -> Dict[str, Any]:
        return user_enricher(user) if user_enricher is not None else user

    @app.get("/api/setup/status")
    async def initial_setup_status():
        status = {"required": auth.needs_initial_setup()}
        if initial_setup_status_provider is not None:
            try:
                extra = initial_setup_status_provider()
                if isinstance(extra, dict):
                    status.update(extra)
            except (OSError, RuntimeError, ValueError):
                pass
        return status

    @app.post("/api/setup")
    async def initial_setup(
        payload: InitialSetupRequest,
        request: Request,
        response: Response,
    ):
        if not _local_client(request):
            return setup_error(
                403,
                "local_client_required",
                "只能在运行 Reroll 的电脑上设置工作区",
            )
        if _cross_site_write(request, "POST"):
            return setup_error(403, "cross_site_rejected", "已拒绝跨站初始化请求")
        if not auth.needs_initial_setup():
            return setup_error(409, "setup_already_complete", "初始化已经完成")
        username = payload.username.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,31}", username):
            return setup_error(
                400,
                "invalid_username",
                "账号需为 3-32 位英文字母、数字或 _.-，且必须以字母或数字开头",
            )
        if len(payload.password) < 8:
            return setup_error(400, "password_too_short", "密码至少需要 8 个字符")
        if initial_setup_configurator is None:
            return setup_error(
                503,
                "workspace_setup_unavailable",
                "工作区目录初始化不可用",
            )
        try:
            workspace = initial_setup_configurator(
                payload.selected_workspace_directory()
            )
            user = auth.create_initial_admin(
                username=username,
                password=payload.password,
                display_name=payload.display_name,
            )
        except (OSError, RuntimeError, ValueError) as exc:
            return setup_error(409, "workspace_setup_failed", str(exc))
        token = auth.create_session(user["id"])
        _set_session_cookie(response, auth, token)
        return {"user": public_session_user(user), "workspace": workspace}

    @app.post("/api/setup/select-directory")
    async def select_initial_setup_directory(request: Request):
        if not _local_client(request):
            return setup_error(
                403,
                "local_client_required",
                "只能在运行 Reroll 的电脑上选择工作区目录",
            )
        if _cross_site_write(request, "POST"):
            return setup_error(403, "cross_site_rejected", "已拒绝跨站目录选择请求")
        if not auth.needs_initial_setup():
            return setup_error(409, "setup_already_complete", "初始化已经完成")
        if initial_directory_picker is None:
            return setup_error(
                501,
                "directory_picker_unavailable",
                "当前系统不支持目录选择器",
            )
        try:
            selected = str(initial_directory_picker() or "").strip()
        except (OSError, RuntimeError, ValueError) as exc:
            return setup_error(500, "directory_picker_failed", str(exc))
        if not selected:
            return setup_error(400, "directory_required", "未选择目录")
        return {"workspace_directory": selected}

    @app.post("/api/setup/inspect-workspace")
    async def inspect_initial_workspace(
        payload: WorkspaceSelectionRequest,
        request: Request,
    ):
        if not _local_client(request):
            return setup_error(
                403,
                "local_client_required",
                "只能在运行 Reroll 的电脑上检查工作区目录",
            )
        if _cross_site_write(request, "POST"):
            return setup_error(403, "cross_site_rejected", "已拒绝跨站工作区检查请求")
        if not auth.needs_initial_setup():
            return setup_error(409, "setup_already_complete", "初始化已经完成")
        if initial_workspace_inspector is None:
            return setup_error(
                503,
                "workspace_inspection_unavailable",
                "工作区目录检查不可用",
            )
        directory = payload.workspace_directory.strip()
        if not directory:
            return setup_error(400, "directory_required", "请选择工作区目录")
        try:
            result = initial_workspace_inspector(directory)
        except (OSError, RuntimeError, ValueError) as exc:
            return setup_error(409, "workspace_inspection_failed", str(exc))
        return result

    @app.post("/api/setup/open-workspace")
    async def open_initial_workspace(
        payload: WorkspaceSelectionRequest,
        request: Request,
    ):
        if not _local_client(request):
            return setup_error(
                403,
                "local_client_required",
                "只能在运行 Reroll 的电脑上打开工作区",
            )
        if _cross_site_write(request, "POST"):
            return setup_error(403, "cross_site_rejected", "已拒绝跨站工作区打开请求")
        if not auth.needs_initial_setup():
            return setup_error(409, "setup_already_complete", "初始化已经完成")
        if initial_workspace_opener is None:
            return setup_error(
                503,
                "workspace_open_unavailable",
                "打开已有工作区暂不可用",
            )
        directory = payload.workspace_directory.strip()
        if not directory:
            return setup_error(400, "directory_required", "请选择工作区目录")
        try:
            result = initial_workspace_opener(directory)
        except (OSError, RuntimeError, ValueError) as exc:
            return setup_error(409, "workspace_open_failed", str(exc))
        return result

    @app.post("/api/auth/register", status_code=202)
    async def register(payload: RegisterRequest, request: Request):
        if _cross_site_write(request, "POST"):
            raise HTTPException(status_code=403, detail="已拒绝跨站注册请求")
        username = payload.username.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,31}", username):
            raise HTTPException(
                status_code=400,
                detail="账号需为 3-32 位英文字母、数字或 _.-，且必须以字母或数字开头",
            )
        if len(payload.password) < 8:
            raise HTTPException(status_code=400, detail="密码至少需要 8 个字符")
        try:
            application = auth.submit_registration(
                username=username,
                password=payload.password,
                display_name=payload.display_name,
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"application": application}

    @app.get("/api/auth/registration")
    async def registration_status():
        return auth.registration_status()

    @app.post("/api/auth/login")
    async def login(payload: LoginRequest, request: Request, response: Response):
        now = time.monotonic()
        remote = request.client.host if request.client else "local"
        rate_key = f"{remote}:{payload.username.strip().lower()}"
        failures = [stamp for stamp in failed_logins.get(rate_key, []) if now - stamp < 300]
        failed_logins[rate_key] = failures
        if len(failures) >= 5:
            retry_after = max(1, int(300 - (now - failures[0])))
            auth.audit(
                "login_failed",
                actor_id="anonymous",
                target_type="username",
                target_id=payload.username.strip().lower(),
                result="rate_limited",
                details={"remote": remote},
            )
            raise HTTPException(
                status_code=429,
                detail="登录失败次数过多，请稍后再试",
                headers={"Retry-After": str(retry_after)},
            )
        user = auth.authenticate(payload.username, payload.password)
        if not user:
            failures.append(now)
            auth.audit(
                "login_failed",
                actor_id="anonymous",
                target_type="username",
                target_id=payload.username.strip().lower(),
                result="denied",
                details={"remote": remote},
            )
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        failed_logins.pop(rate_key, None)
        token = auth.create_session(user["id"])
        auth.audit(
            "login_succeeded",
            actor_id=user["id"],
            target_type="session",
            details={"remote": remote},
        )
        _set_session_cookie(response, auth, token)
        return {"user": public_session_user(user)}

    @app.post("/api/auth/logout")
    async def logout(request: Request, response: Response):
        session_token = request.cookies.get(SESSION_COOKIE, "")
        user = auth.user_for_session(session_token)
        auth.revoke_session(session_token)
        auth.audit(
            "logout",
            actor_id=(user or {}).get("id") or "anonymous",
            target_type="session",
        )
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/auth/me")
    async def me(request: Request):
        user = auth.user_for_session(request.cookies.get(SESSION_COOKIE, ""))
        if not user:
            raise HTTPException(status_code=401, detail="未登录或登录已失效")
        return {"user": public_session_user(user)}

    def admin_from_request(request: Request) -> Dict[str, Any]:
        user = getattr(request.state, "user", None)
        if not user:
            raise HTTPException(status_code=401, detail="未登录或登录已失效")
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="仅管理员可以管理账号")
        return user

    @app.get("/api/admin/accounts")
    async def admin_accounts(request: Request):
        admin_from_request(request)
        return {
            "users": [public_session_user(user) for user in auth.list_users()],
            "applications": auth.list_applications(),
            "registration": auth.registration_status(),
        }

    @app.post("/api/admin/account-applications/{application_id}/approve")
    async def approve_account_application(application_id: str, request: Request):
        actor = admin_from_request(request)
        try:
            user = auth.approve_application(application_id, actor["id"])
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"user": user}

    @app.post("/api/admin/account-applications/{application_id}/reject")
    async def reject_account_application(application_id: str, request: Request):
        actor = admin_from_request(request)
        try:
            application = auth.reject_application(application_id, actor["id"])
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"application": application}

    @app.post("/api/admin/accounts/{user_id}/reset-password")
    async def reset_account_password(user_id: str, request: Request):
        actor = admin_from_request(request)
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
        temporary_password = "".join(secrets.choice(alphabet) for _ in range(18))
        try:
            user = auth.reset_password(
                user_id, temporary_password, actor_id=actor["id"]
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"user": user, "temporary_password": temporary_password}

    @app.delete("/api/admin/accounts/{user_id}")
    async def delete_account(user_id: str, request: Request):
        actor = admin_from_request(request)
        if user_id == actor["id"]:
            raise HTTPException(
                status_code=409, detail="不能删除当前登录的管理员账号"
            )
        target = auth.get_user(user_id)
        if not target:
            raise HTTPException(status_code=404, detail="账号不存在")
        try:
            if before_delete:
                before_delete(target, actor)
            auth.delete_user(user_id, actor_id=actor["id"])
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"ok": True}


def current_user() -> Optional[Dict[str, Any]]:
    user = _CURRENT_USER.get()
    return dict(user) if user else None


def require_current_user(*roles: str) -> Dict[str, Any]:
    user = current_user()
    if not user:
        raise HTTPException(status_code=401, detail="未登录或登录已失效")
    if roles and user.get("role") not in set(roles):
        raise HTTPException(status_code=403, detail="当前账号无权执行此操作")
    return user


def _is_public_path(path: str, method: str) -> bool:
    if method == "OPTIONS":
        return True
    if path in PUBLIC_EXACT_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)


def _is_admin_only(path: str, method: str) -> bool:
    if path in ADMIN_ONLY_HTML:
        return True
    if any(path.startswith(prefix) for prefix in ADMIN_ONLY_PREFIXES):
        return True
    if path.startswith("/api/workflows") and method not in {"GET", "HEAD"}:
        return not path.rstrip("/").endswith("/run")
    return False


def _cross_site_write(request: Request, method: str) -> bool:
    if method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return False
    if request.headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
        return True
    origin = request.headers.get("origin", "").strip().rstrip("/")
    if not origin:
        # Native/local clients may omit Origin; browsers include it on cross-site
        # credentialed writes, additionally covered by Sec-Fetch-Site above.
        return False
    same_origin = f"{request.url.scheme}://{request.url.netloc}".rstrip("/")
    configured = {
        item.strip().rstrip("/")
        for item in os.getenv("INFINITE_CANVAS_ALLOWED_ORIGINS", "").split(",")
        if item.strip()
    }
    return origin != same_origin and origin not in configured


def install_access_control(
    app: FastAPI,
    auth: AuthSystem,
    *,
    user_enricher: Optional[
        Callable[[Dict[str, Any]], Dict[str, Any]]
    ] = None,
) -> None:
    """Install default-deny session and coarse role enforcement.

    Resource-level canvas/share checks remain in their route handlers. This
    middleware establishes the outer boundary for every existing legacy route.
    """

    @app.middleware("http")
    async def account_access_control(request: Request, call_next):
        path = request.url.path
        method = request.method.upper()
        if auth.needs_initial_setup():
            setup_path = path in {
                "/setup",
                "/api/setup",
                "/api/setup/status",
                "/api/setup/select-directory",
                "/api/setup/inspect-workspace",
                "/api/setup/open-workspace",
            }
            static_path = any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)
            if not setup_path and not static_path and method != "OPTIONS":
                if path.startswith("/api/") or method not in {"GET", "HEAD"}:
                    return JSONResponse(
                        status_code=428,
                        content={"detail": "请先完成首次运行设置"},
                    )
                return RedirectResponse(url="/setup", status_code=303)
        if _is_public_path(path, method):
            return await call_next(request)

        user = auth.user_for_session(request.cookies.get(SESSION_COOKIE, ""))
        if not user:
            if path.startswith("/api/") or method not in {"GET", "HEAD"}:
                return JSONResponse(
                    status_code=401, content={"detail": "未登录或登录已失效"}
                )
            return RedirectResponse(url="/login", status_code=303)

        if user_enricher is not None:
            user = user_enricher(user)

        request.state.user = user
        token = _CURRENT_USER.set(user)
        try:
            if _cross_site_write(request, method):
                return JSONResponse(
                    status_code=403, content={"detail": "已拒绝跨站写入请求"}
                )
            if user.get("role") == "guest":
                if path.startswith("/api/"):
                    return JSONResponse(
                        status_code=403, content={"detail": "当前账号无权访问工作台资源"}
                    )
                return RedirectResponse(url="/login?reason=no-access", status_code=303)
            if _is_admin_only(path, method) and user.get("role") != "admin":
                if path.startswith("/api/"):
                    return JSONResponse(
                        status_code=403, content={"detail": "仅管理员可以访问此设置"}
                    )
                return RedirectResponse(url="/", status_code=303)
            return await call_next(request)
        finally:
            _CURRENT_USER.reset(token)

def auth_from_environment(
    instance_state: InstanceState | Path | str,
    *,
    workspace_directory: Path | str | None = None,
    workspace_id: str = "",
) -> AuthSystem:
    """Build the global AuthSystem from the single Instance State seam."""

    secure = str(os.getenv("AUTH_COOKIE_SECURE", "")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    state = (
        instance_state
        if isinstance(instance_state, InstanceState)
        else InstanceState(instance_state)
    )
    preparation = state.prepare_auth_database(
        workspace_directory=workspace_directory,
        workspace_id=workspace_id,
    )
    registration_enabled = str(
        os.getenv("AUTH_ALLOW_REGISTRATION", "1")
    ).strip().lower() not in {"0", "false", "no", "off"}
    try:
        max_accounts = int(os.getenv("AUTH_MAX_ACCOUNTS", "40"))
    except ValueError:
        max_accounts = 40
    auth = AuthSystem(
        preparation.database_path,
        secure_cookies=secure,
        max_accounts=max_accounts,
        registration_enabled=registration_enabled,
        secure_directory=True,
        legacy_workspace_id=workspace_id,
    )
    auth.instance_state = state
    auth.migration_status = preparation.migration_status
    auth.recovery_artifact = preparation.recovery_artifact
    return auth


__all__ = [
    "AuthSystem",
    "SESSION_COOKIE",
    "VALID_ROLES",
    "auth_from_environment",
    "current_user",
    "hash_password",
    "install_access_control",
    "install_auth_routes",
    "require_current_user",
    "verify_password",
]
