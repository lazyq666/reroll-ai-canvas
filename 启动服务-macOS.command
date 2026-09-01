#!/bin/bash

set -u

cd "$(dirname "$0")" || exit 1

PYTHON_VERSION="3.12"
UV_VERSION="${INFINITE_CANVAS_UV_VERSION:-0.11.32}"
INSTALLER_FILE=""

cleanup() {
    if [ -n "$INSTALLER_FILE" ] && [ -f "$INSTALLER_FILE" ]; then
        rm -f "$INSTALLER_FILE"
    fi
}
trap cleanup EXIT

is_compatible_python() {
    [ -n "$1" ] && [ -x "$1" ] && \
        "$1" -c "import sys; raise SystemExit(0 if (3, 12) <= sys.version_info < (3, 13) else 1)" \
            >/dev/null 2>&1
}

run_launcher() {
    export PYTHONUTF8=1
    export PYTHONUNBUFFERED=1
    exec "$1" backend/launcher.py "${@:2}"
}

# Reuse an already prepared project environment without touching the network.
if is_compatible_python ".venv/bin/python"; then
    run_launcher ".venv/bin/python" "$@"
fi

if [ -n "${INFINITE_CANVAS_STATE_DIR:-}" ]; then
    STATE_DIR="${INFINITE_CANVAS_STATE_DIR/#\~/$HOME}"
elif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    STATE_DIR="$HOME/Library/Application Support/Infinite Canvas"
elif [ -n "${XDG_STATE_HOME:-}" ]; then
    STATE_DIR="$XDG_STATE_HOME/infinite-canvas"
else
    STATE_DIR="$HOME/.local/state/infinite-canvas"
fi

RUNTIME_DIR="$STATE_DIR/runtime"
UV_INSTALL_DIR="$RUNTIME_DIR/uv"
UV_BIN="$UV_INSTALL_DIR/uv"

export UV_NO_MODIFY_PATH=1
export UV_PYTHON_INSTALL_DIR="$RUNTIME_DIR/python"
export UV_CACHE_DIR="$STATE_DIR/cache/uv"

ensure_uv() {
    if [ -x "$UV_BIN" ]; then
        return 0
    fi
    if ! command -v curl >/dev/null 2>&1; then
        echo "[提示] 系统缺少 curl，无法自动下载项目运行环境。"
        return 1
    fi

    echo "[环境] 首次运行，正在下载 Reroll 专用环境管理器..."
    mkdir -p "$UV_INSTALL_DIR" || return 1
    INSTALLER_FILE="$(mktemp "${TMPDIR:-/tmp}/infinite-canvas-uv.XXXXXX")" || return 1
    if ! curl --proto '=https' --tlsv1.2 \
        --fail --location --silent --show-error \
        "https://astral.sh/uv/$UV_VERSION/install.sh" \
        --output "$INSTALLER_FILE"
    then
        echo "[提示] 环境管理器下载失败，请检查网络连接。"
        return 1
    fi
    if ! env \
        UV_UNMANAGED_INSTALL="$UV_INSTALL_DIR" \
        UV_NO_MODIFY_PATH=1 \
        sh "$INSTALLER_FILE"
    then
        echo "[提示] 环境管理器安装失败。"
        return 1
    fi
    rm -f "$INSTALLER_FILE"
    INSTALLER_FILE=""
    [ -x "$UV_BIN" ]
}

if ensure_uv; then
    echo "[环境] 正在准备项目专用 Python ${PYTHON_VERSION}（不会修改系统 Python）..."
    if "$UV_BIN" python install "$PYTHON_VERSION"; then
        MANAGED_PYTHON="$(
            "$UV_BIN" python find --managed-python "$PYTHON_VERSION" 2>/dev/null
        )"
        if is_compatible_python "$MANAGED_PYTHON"; then
            run_launcher "$MANAGED_PYTHON" "$@"
        fi
    fi
    echo "[提示] 项目专用 Python 准备失败，正在尝试本机环境。"
fi

# Preserve an offline fallback for machines that already have Python 3.12.
PATH_PYTHON_312="$(command -v python3.12 2>/dev/null || true)"
PATH_PYTHON_3="$(command -v python3 2>/dev/null || true)"
for CANDIDATE in \
    "$PATH_PYTHON_312" \
    "/opt/homebrew/bin/python3.12" \
    "/usr/local/bin/python3.12" \
    "/opt/homebrew/bin/python3" \
    "/usr/local/bin/python3" \
    "$PATH_PYTHON_3" \
    "/usr/bin/python3"
do
    if is_compatible_python "$CANDIDATE"; then
        echo "[环境] 自动下载不可用，临时使用本机 Python 3.12。"
        run_launcher "$CANDIDATE" "$@"
    fi
done

echo ""
echo "[错误] 无法自动准备 Python 3.12。"
echo "请检查网络连接后重新启动；工具不会修改或覆盖系统 Python。"
exit 1
