#!/bin/bash

set -u

cd "$(dirname "$0")" || exit 1

HELPER_VERSION="0.7.3"
INSTALLER_SHA256="655810e482dc7e3deeefc4fec6bff15ea6aadd453ce8a1c95cd47eef8ffbd6ed"
INSTALLER_URL="https://github.com/Wangnov/gpt-image-2-skill/releases/download/v${HELPER_VERSION}/gpt-image-2-skill-installer.sh"
INSTALLER_FILE=""
MODE="${1:-install}"

cleanup() {
    if [ -n "$INSTALLER_FILE" ] && [ -f "$INSTALLER_FILE" ]; then
        rm -f "$INSTALLER_FILE"
    fi
}
trap cleanup EXIT

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

find_helper() {
    resolved="$(command -v gpt-image-2-skill 2>/dev/null || true)"
    if [ -n "$resolved" ] && [ -x "$resolved" ]; then
        printf "%s\n" "$resolved"
        return 0
    fi

    cargo_home="${CARGO_HOME:-$HOME/.cargo}"
    for candidate in \
        "$cargo_home/bin/gpt-image-2-skill" \
        "/opt/homebrew/bin/gpt-image-2-skill" \
        "/usr/local/bin/gpt-image-2-skill"
    do
        if [ -x "$candidate" ]; then
            printf "%s\n" "$candidate"
            return 0
        fi
    done
    return 1
}

verify_helper() {
    helper="$1"
    printf "\n[验证] 可执行文件：%s\n" "$helper"

    auth_output="$("$helper" --json auth inspect 2>&1)"
    auth_code=$?
    if [ "$auth_code" -ne 0 ]; then
        printf "[错误] helper 无法执行 auth inspect。\n" >&2
        return 1
    fi

    doctor_output="$("$helper" --json doctor 2>&1)"
    doctor_code=$?
    version="$(printf "%s\n" "$doctor_output" | sed -n 's/.*"version": "\([^"]*\)".*/\1/p' | head -n 1)"
    if [ -n "$version" ]; then
        printf "[完成] gpt-image-2-skill %s 已安装。\n" "$version"
    else
        printf "[完成] gpt-image-2-skill 已安装。\n"
    fi

    if printf "%s\n" "$auth_output" | grep -Eq '"ready"[[:space:]]*:[[:space:]]*true'; then
        printf "[认证] 已找到可用的 Codex 登录或 OpenAI API 凭据。\n"
    else
        printf "[提示] helper 已安装，但尚未找到可用凭据。可先运行 codex login，或在本机配置 OPENAI_API_KEY。\n"
    fi

    if [ "$doctor_code" -eq 0 ] && printf "%s\n" "$doctor_output" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
        printf "[网络] doctor 检查通过，服务端可访问。\n"
    else
        printf "[提示] 安装已完成，但 doctor 未完全通过；请检查网络、代理或登录状态。\n"
    fi
    printf "[下一步] 请刷新 Reroll 中的 Codex 连接状态；若仍显示旧状态，请重启服务。\n"
    return 0
}

case "$MODE" in
    install|--install|"")
        ;;
    check|--check)
        helper="$(find_helper || true)"
        [ -n "$helper" ] || fail "未找到 gpt-image-2-skill。"
        verify_helper "$helper" || fail "helper 验证失败。"
        finish 0
        ;;
    force|--force)
        ;;
    *)
        fail "未知参数：$MODE（支持 install、check、force）"
        ;;
esac

[ "$(uname -s 2>/dev/null)" = "Darwin" ] || fail "此脚本仅支持 macOS。"

helper="$(find_helper || true)"
if [ -n "$helper" ] && [ "$MODE" != "force" ] && [ "$MODE" != "--force" ]; then
    printf "[现有] 已找到 GPT Image 2 helper，跳过重复安装。\n"
    verify_helper "$helper" || fail "helper 验证失败。"
    finish 0
fi

command -v curl >/dev/null 2>&1 || fail "系统缺少 curl，无法下载安装器。"
command -v shasum >/dev/null 2>&1 || fail "系统缺少 shasum，无法验证安装器。"

INSTALLER_FILE="$(mktemp "${TMPDIR:-/tmp}/gpt-image-2-skill-installer.XXXXXX")" || fail "无法创建临时文件。"
printf "[下载] 正在获取 gpt-image-2-skill %s...\n" "$HELPER_VERSION"
if ! curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
    "$INSTALLER_URL" --output "$INSTALLER_FILE"
then
    fail "安装器下载失败，请检查网络。"
fi

actual_sha256="$(shasum -a 256 "$INSTALLER_FILE" | awk '{print $1}')"
if [ "$actual_sha256" != "$INSTALLER_SHA256" ]; then
    fail "安装器 SHA-256 校验失败，已拒绝执行。"
fi
printf "[安全] 安装器 SHA-256 校验通过。\n"

if ! sh "$INSTALLER_FILE"; then
    fail "gpt-image-2-skill 安装失败。"
fi

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
helper="$(find_helper || true)"
[ -n "$helper" ] || fail "安装器已结束，但未找到 gpt-image-2-skill 可执行文件。"
verify_helper "$helper" || fail "helper 已安装，但验证失败。"
finish 0
