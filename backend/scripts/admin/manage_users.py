#!/usr/bin/env python3
"""Provision and maintain Reroll accounts on the local server."""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path
from typing import Optional, Sequence


BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from infinite_canvas.auth_system import AuthSystem, VALID_ROLES  # noqa: E402
from infinite_canvas.instance_state import InstanceState  # noqa: E402
from infinite_canvas.workspace_storage import (  # noqa: E402
    application_state_directory,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Reroll 本地账号管理")
    parser.add_argument(
        "--state-dir",
        default="",
        help="Device State 目录；省略时使用当前安装的默认目录",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create", help="创建账号")
    create.add_argument("username")
    create.add_argument("--password", help="密码；省略时安全输入")
    create.add_argument("--role", choices=sorted(VALID_ROLES), required=True)
    create.add_argument("--display-name", default="")

    commands.add_parser("list", help="列出账号")
    audit = commands.add_parser("audit", help="查看最近的账号与分享审计事件")
    audit.add_argument("--limit", type=int, default=100)

    for name, help_text in (("enable", "启用账号"), ("disable", "禁用账号")):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("user", help="用户名或用户 ID")

    role = commands.add_parser("set-role", help="修改角色")
    role.add_argument("user", help="用户名或用户 ID")
    role.add_argument("role", choices=sorted(VALID_ROLES))

    password = commands.add_parser("reset-password", help="重置密码并退出旧会话")
    password.add_argument("user", help="用户名或用户 ID")
    password.add_argument("--password", help="新密码；省略时安全输入")
    return parser


def _password(value: Optional[str], confirmation: bool = True) -> str:
    if value is not None:
        if not value:
            raise ValueError("密码不能为空")
        return value
    first = getpass.getpass("密码: ")
    if confirmation and first != getpass.getpass("再次输入密码: "):
        raise ValueError("两次输入的密码不一致")
    return first


def _resolve_user(auth: AuthSystem, value: str) -> dict:
    needle = str(value or "").strip().lower()
    user = next(
        (
            item
            for item in auth.list_users()
            if item["id"].lower() == needle or item["username"].lower() == needle
        ),
        None,
    )
    if not user:
        raise ValueError(f"账号不存在: {value}")
    return user


def _print_user(user: dict) -> None:
    print(
        "\t".join(
            [
                user["username"],
                user["role"],
                user["status"],
                user["display_name"],
                user["id"],
            ]
        )
    )


def _database_path(explicit: str, *, allow_create: bool = False) -> Path:
    value = str(explicit or "").strip()
    state_root = (
        Path(value).expanduser().resolve()
        if value
        else application_state_directory()
    )
    database = InstanceState(state_root).auth_database
    if not allow_create and not database.is_file():
        raise ValueError("当前安装的 Instance State 尚未初始化账号")
    return database


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parser().parse_args(argv)
    try:
        database_path = _database_path(
            args.state_dir,
            allow_create=args.command == "create",
        )
        print(f"账号文件: {database_path}", file=sys.stderr)
        auth = AuthSystem(database_path)
        if args.command == "create":
            user = auth.create_user(
                username=args.username,
                password=_password(args.password),
                role=args.role,
                display_name=args.display_name,
            )
            _print_user(user)
        elif args.command == "list":
            for user in auth.list_users():
                _print_user(user)
        elif args.command == "audit":
            for event in reversed(auth.list_audit_events(args.limit)):
                print(
                    "\t".join(
                        [
                            str(event["created_at"]),
                            event["action"],
                            event["actor_id"],
                            event["target_type"],
                            event["target_id"],
                            event["result"],
                        ]
                    )
                )
        elif args.command in {"enable", "disable"}:
            user = _resolve_user(auth, args.user)
            _print_user(
                auth.set_user_status(
                    user["id"], "active" if args.command == "enable" else "disabled"
                )
            )
        elif args.command == "set-role":
            user = _resolve_user(auth, args.user)
            _print_user(auth.set_user_role(user["id"], args.role))
        elif args.command == "reset-password":
            user = _resolve_user(auth, args.user)
            _print_user(auth.reset_password(user["id"], _password(args.password)))
        return 0
    except ValueError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
