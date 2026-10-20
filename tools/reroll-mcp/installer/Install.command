#!/bin/bash
set -eu
cd "$(dirname "$0")"
umask 077
printf '%s\n' @@START@@
finish() {
    result=$?
    if [ "$result" -ne 0 ]; then printf '%s\n' @@FAIL@@; fi
    printf '%s\n' @@CLOSE@@
    read -r _ || true
    exit "$result"
}
trap finish EXIT
agent_root="$HOME/Library/Application Support/Reroll/agent"
export UV_UNMANAGED_INSTALL="$agent_root/uv"
export UV_PYTHON_INSTALL_DIR="$agent_root/python"
export UV_CACHE_DIR="$agent_root/cache"
export UV_NO_MODIFY_PATH=1
mkdir -p "$agent_root"
agent_uv="$UV_UNMANAGED_INSTALL/uv"
if [ ! -x "$agent_uv" ]; then
    agent_download=$(mktemp "$agent_root/uv-install.XXXXXX")
    if curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error https://astral.sh/uv/0.11.32/install.sh -o "$agent_download"; then
        sh "$agent_download"
        rm -f "$agent_download"
    else
        rm -f "$agent_download"
        exit 1
    fi
fi
"$agent_uv" run --no-project --isolated --managed-python --python 3.12 --with tomlkit==0.13.3 install.py --root "$agent_root" --uv "$agent_uv"
