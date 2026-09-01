#!/usr/bin/env python3
"""Preview and execute a verified legacy-data migration."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from infinite_canvas.device_cache import (  # noqa: E402
    application_cache_directory,
)
from infinite_canvas.legacy_migration import (  # noqa: E402
    LegacyMigrationError,
    build_migration_plan,
    execute_migration,
)
from infinite_canvas.workspace_storage import (  # noqa: E402
    application_state_directory,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "把旧版混合数据拆分到 Workspace、Device Cache 和 Device State"
        )
    )
    parser.add_argument("--source", help="旧数据目录，例如 refactor-data")
    parser.add_argument("--workspace", help="不存在或为空的目标工作区")
    parser.add_argument(
        "--cache-dir",
        default=str(application_cache_directory()),
        help="Device Cache 目录；默认使用操作系统标准位置",
    )
    parser.add_argument(
        "--state-dir",
        default=str(application_state_directory()),
        help="Device State 目录；默认使用操作系统标准位置",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只输出路径对照和容量，不写入也不删除",
    )
    parser.add_argument(
        "--delete-source",
        action="store_true",
        help="全部复制并校验成功后删除旧数据目录",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="跳过执行前的 DELETE 确认（适合已完成备份的自动化）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 输出完整路径对照",
    )
    return parser


def _input_path(value: str | None, prompt: str) -> str:
    if value:
        return value
    return input(prompt).strip()


def _print_summary(plan) -> None:
    workspace_count = len(plan.workspace_items)
    cache_count = len(plan.cache_items)
    print(f"旧数据：{plan.source}")
    print(f"目标工作区：{plan.workspace}")
    print(f"Device Cache：{plan.cache}")
    print(f"Device State：{plan.state}")
    print(
        f"文件：{len(plan.items)}（工作区 {workspace_count}，"
        f"缓存 {cache_count}），共 {plan.total_bytes / 1024 / 1024:.1f} MB"
    )
    if plan.discarded:
        print(f"系统元数据：{len(plan.discarded)} 个（不迁移）")
    if plan.unknown:
        print("未识别或冲突文件：")
        for item in plan.unknown[:20]:
            print(f"  - {item}")


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        source = _input_path(args.source, "旧数据目录：")
        workspace = _input_path(args.workspace, "新工作区目录：")
        plan = build_migration_plan(
            source,
            workspace,
            args.cache_dir,
            args.state_dir,
        )
        if args.json:
            print(json.dumps(plan.public(), ensure_ascii=False, indent=2))
        else:
            _print_summary(plan)
        if plan.unknown:
            raise LegacyMigrationError(
                "存在未识别或冲突文件；未写入目标，也不会删除来源"
            )
        if args.dry_run:
            print("预览完成：未写入目标，也未删除来源。")
            return 0
        if args.delete_source and not args.yes:
            confirmation = input(
                "确认已完成备份，并在成功后删除旧数据？请输入 DELETE："
            ).strip()
            if confirmation != "DELETE":
                print("已取消：没有写入或删除任何数据。")
                return 2
        result = execute_migration(
            plan,
            delete_source=args.delete_source,
        )
        print(f"迁移完成，报告：{result.report_path}")
        if result.source_deleted:
            print("旧数据已在完整校验后自动删除。")
        else:
            print("旧数据已保留；使用 --delete-source 可在验证后自动删除。")
        return 0
    except (LegacyMigrationError, OSError, ValueError) as exc:
        print(f"迁移失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
