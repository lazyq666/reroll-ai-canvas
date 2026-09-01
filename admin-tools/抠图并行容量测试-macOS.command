#!/bin/bash

set -u

SCRIPT_DIRECTORY="$(cd "$(dirname "$0")" && pwd)" || exit 1
PROJECT_ROOT="$(cd "$SCRIPT_DIRECTORY/.." && pwd)" || exit 1
cd "$PROJECT_ROOT" || exit 1

PYTHON=".venv/bin/python"
RUNNER="scripts/performance/run_matting_capacity.py"

pause_if_needed() {
    if [ "${INFINITE_CANVAS_NO_PAUSE:-0}" != "1" ] && [ -t 0 ]; then
        printf "\n按回车键关闭..."
        read -r _
    fi
}

finish() {
    code="$1"
    pause_if_needed
    exit "$code"
}

fail() {
    printf "\n[错误] %s\n" "$1" >&2
    finish 1
}

[ "$(uname -s 2>/dev/null)" = "Darwin" ] || fail "此入口仅支持 macOS。"
[ -x "$PYTHON" ] || fail "未找到项目虚拟环境 .venv。请先运行项目安装流程。"
[ -f "$RUNNER" ] || fail "未找到抠图容量测试脚本：$RUNNER"

printf '%s\n' \
    "========================================" \
    " Reroll：抠图并行容量测试" \
    "========================================" \
    "测试会依次运行并行 1、2、3、4，期间 CPU 与内存占用会明显升高。" \
    "报告将保存到 /private/tmp/ic-matting-capacity。" \
    ""

"$PYTHON" "$RUNNER" "$@"
RESULT=$?
finish "$RESULT"
