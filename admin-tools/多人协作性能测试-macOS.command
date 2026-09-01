#!/bin/bash

set -u

SCRIPT_DIRECTORY="$(cd "$(dirname "$0")" && pwd)" || exit 1
PROJECT_ROOT="$(cd "$SCRIPT_DIRECTORY/.." && pwd)" || exit 1
cd "$PROJECT_ROOT" || exit 1

PYTHON=".venv/bin/python"
ACCEPTANCE_SCRIPT="scripts/performance/run_live_collaboration_acceptance.py"
REPORT_ROOT="/private/tmp/ic-live-acceptance"
DRY_RUN=0

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

show_help() {
    printf '%s\n' \
        "用法：双击此文件，或在终端运行：" \
        "  ./admin-tools/多人协作性能测试-macOS.command [--dry-run]" \
        "" \
        "默认运行 9 个机器人 + 1 位人工参与者的协作验收。" \
        "机器人只操作画布，不会发起 AI 生成。" \
        "--dry-run 只显示即将执行的配置，不连接服务。"
}

prompt_default() {
    label="$1"
    default_value="$2"
    if [ -t 0 ]; then
        printf "%s [%s]：" "$label" "$default_value" >&2
        read -r entered
        if [ -n "$entered" ]; then
            printf '%s\n' "$entered"
        else
            printf '%s\n' "$default_value"
        fi
    else
        printf '%s\n' "$default_value"
    fi
}

prompt_optional() {
    label="$1"
    if [ -t 0 ]; then
        printf "%s：" "$label" >&2
        read -r entered
        printf '%s\n' "$entered"
    else
        printf '\n'
    fi
}

prompt_yes_no() {
    label="$1"
    default_value="$2"
    if [ -t 0 ]; then
        printf "%s [%s]：" "$label" "$default_value" >&2
        read -r entered
        if [ -z "$entered" ]; then
            entered="$default_value"
        fi
    else
        entered="$default_value"
    fi
    case "$entered" in
        y|Y|yes|YES|Yes|是|1|true|TRUE)
            printf '1\n'
            ;;
        n|N|no|NO|No|否|0|false|FALSE)
            printf '0\n'
            ;;
        *)
            return 2
            ;;
    esac
}

case "${1:-}" in
    "")
        ;;
    --dry-run)
        DRY_RUN=1
        ;;
    -h|--help)
        show_help
        finish 0
        ;;
    *)
        fail "未知参数：${1}（支持 --dry-run、--help）"
        ;;
esac

[ -f "$ACCEPTANCE_SCRIPT" ] || fail "未找到多人验收脚本：$ACCEPTANCE_SCRIPT"

printf '%s\n' \
    "========================================" \
    " Reroll：10 人协作验收" \
    "========================================" \
    "9 个机器人负责画布操作；你是第 10 位参与者。" \
    "机器人不会发起 AI 生成，也不会修改 Provider 设置。" \
    "测试开始前会自动打开画布，并等待你按 Enter。" \
    ""

PORT="${INFINITE_CANVAS_ACCEPTANCE_PORT:-}"
if [ -z "$PORT" ]; then
    PORT="$(prompt_default "服务端口" "3001")"
fi
case "$PORT" in
    ''|*[!0-9]*) fail "端口必须是 1 到 65535 的整数。" ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail "端口必须是 1 到 65535 的整数。"

ADMIN_USERNAME="${INFINITE_CANVAS_ACCEPTANCE_ADMIN_USERNAME:-}"
if [ -z "$ADMIN_USERNAME" ]; then
    ADMIN_USERNAME="$(prompt_default "管理员账号" "admin")"
fi
[ -n "$ADMIN_USERNAME" ] || fail "管理员账号不能为空。"

if [ "${INFINITE_CANVAS_ACCEPTANCE_CANVAS_ID+x}" = "x" ]; then
    CANVAS_ID="$INFINITE_CANVAS_ACCEPTANCE_CANVAS_ID"
else
    CANVAS_ID="$(prompt_optional "已有 Canvas ID（留空则新建测试画布）")"
fi
case "$CANVAS_ID" in
    *[!A-Za-z0-9._:-]*) fail "Canvas ID 只能包含字母、数字、点、下划线、冒号和短横线。" ;;
esac
[ "${#CANVAS_ID}" -le 128 ] || fail "Canvas ID 最长为 128 个字符。"

ROBOT_ROUNDS="${INFINITE_CANVAS_ACCEPTANCE_ROBOT_ROUNDS:-}"
if [ -z "$ROBOT_ROUNDS" ]; then
    ROBOT_ROUNDS="$(prompt_default "机器人轮数（120 约 2 分钟；240 约 4 分钟）" "120")"
fi
case "$ROBOT_ROUNDS" in
    ''|*[!0-9]*) fail "机器人轮数必须是 1 到 3600 的整数。" ;;
esac
[ "$ROBOT_ROUNDS" -ge 1 ] && [ "$ROBOT_ROUNDS" -le 3600 ] || fail "机器人轮数必须是 1 到 3600 的整数。"

if [ "${INFINITE_CANVAS_ACCEPTANCE_REQUIRE_HUMAN_GENERATION+x}" = "x" ]; then
    REQUIRE_HUMAN_GENERATION="$(prompt_yes_no "" "$INFINITE_CANVAS_ACCEPTANCE_REQUIRE_HUMAN_GENERATION")" || fail "人工生成选项请输入 y 或 n。"
else
    REQUIRE_HUMAN_GENERATION="$(prompt_yes_no "是否把你的一次人工生成纳入通过条件？(y/n)" "y")" || fail "人工生成选项请输入 y 或 n。"
fi

CLEANUP_TEST_CANVAS=0
if [ -z "$CANVAS_ID" ]; then
    if [ "${INFINITE_CANVAS_ACCEPTANCE_CLEANUP_TEST_CANVAS+x}" = "x" ]; then
        CLEANUP_TEST_CANVAS="$(prompt_yes_no "" "$INFINITE_CANVAS_ACCEPTANCE_CLEANUP_TEST_CANVAS")" || fail "自动删除选项请输入 y 或 n。"
    else
        CLEANUP_TEST_CANVAS="$(prompt_yes_no "测试后自动删除新建画布？首轮建议保留 (y/n)" "n")" || fail "自动删除选项请输入 y 或 n。"
    fi
fi

BASE_URL="http://127.0.0.1:${PORT}"
COMMAND=(
    "$PYTHON"
    "$ACCEPTANCE_SCRIPT"
    --base-url "$BASE_URL"
    --admin-username "$ADMIN_USERNAME"
    --robot-count 9
    --robot-rounds "$ROBOT_ROUNDS"
    --round-interval-seconds 1
    --human-generation-grace-seconds 180
    --open-human-canvas
    --report-root "$REPORT_ROOT"
)

if [ -n "$CANVAS_ID" ]; then
    COMMAND+=(--canvas-id "$CANVAS_ID")
fi
if [ "$REQUIRE_HUMAN_GENERATION" = "1" ]; then
    COMMAND+=(--require-human-generation)
fi
if [ "$CLEANUP_TEST_CANVAS" = "1" ]; then
    COMMAND+=(--cleanup-test-canvas)
fi

printf '\n[配置] 服务：%s\n' "$BASE_URL"
printf '[配置] 画布：%s\n' "${CANVAS_ID:-新建测试画布}"
printf '[配置] 参与者：9 个机器人 + 1 位人工\n'
printf '[配置] 机器人轮数：%s\n' "$ROBOT_ROUNDS"
if [ "$REQUIRE_HUMAN_GENERATION" = "1" ]; then
    printf '[配置] 人工生成：需要完成 1 次\n'
else
    printf '[配置] 人工生成：不作为通过条件\n'
fi
printf '[配置] 报告目录根路径：%s\n' "$REPORT_ROOT"

if [ "$DRY_RUN" -eq 1 ]; then
    printf '\n[预览] 未连接服务。将执行：\n'
    printf '%q ' "${COMMAND[@]}"
    printf '\n'
    finish 0
fi

[ "$(uname -s 2>/dev/null)" = "Darwin" ] || fail "此入口仅支持 macOS。"
[ -x "$PYTHON" ] || fail "未找到项目虚拟环境 .venv。请先运行项目安装流程。"

printf '\n[开始] 接下来会隐藏输入管理员密码。\n'
"${COMMAND[@]}"
code=$?

if [ "$code" -eq 0 ]; then
    printf '\n[完成] 多人协作验收通过。上方 JSON 中包含本次 report_directory。\n'
else
    printf '\n[未通过] 验收脚本退出码：%s。请保留上方 report_directory 供诊断。\n' "$code" >&2
fi
finish "$code"
