#!/usr/bin/env python3
"""Reroll cross-platform installer and launcher.

The platform entry files bootstrap a project-owned Python when necessary and
then delegate here. Virtual-environment creation, dependency installation,
validation, port handling and browser startup remain shared by every platform.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import signal
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from infinite_canvas.installation import installation_identity
from infinite_canvas.workspace_storage import application_state_directory

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
VENV_DIR = PROJECT_DIR / ".venv"
REQUIREMENTS_FILE = PROJECT_DIR / "requirements.txt"
REQUIREMENTS_LOCK_FILE = PROJECT_DIR / "requirements.lock.txt"
PACKAGES_DIR = PROJECT_DIR / "packages"
GET_PIP_FILE = PROJECT_DIR / "get-pip.py"
INSTALLATION_ID = installation_identity(PROJECT_DIR)
DEVICE_STATE_DIR = application_state_directory(PROJECT_DIR)
STATE_FILE = DEVICE_STATE_DIR / "launcher-state.json"
ENV_FILE = PROJECT_DIR / ".env"


def instance_state_file(
    project_dir: Path = PROJECT_DIR,
    state_dir: Path = DEVICE_STATE_DIR,
) -> Path:
    """Keep launcher instance records isolated between project checkouts."""

    project_digest = installation_identity(project_dir)[:16]
    return state_dir / f"instance-{project_digest}.json"


def launch_claim_file(
    project_dir: Path = PROJECT_DIR,
    state_dir: Path = DEVICE_STATE_DIR,
) -> Path:
    """Keep launcher locks isolated between project checkouts."""

    project_digest = installation_identity(project_dir)[:16]
    return state_dir / f"launch-{project_digest}.lock"


INSTANCE_FILE = instance_state_file()
LAUNCH_CLAIM_FILE = launch_claim_file()
MAIN_FILE = BACKEND_DIR / "main.py"
PORT = 3000
PORT_SCAN_LIMIT = 100
LOCAL_URL = f"http://127.0.0.1:{PORT}/"
RUNTIME_STATUS_URL = f"http://127.0.0.1:{PORT}/api/runtime/status"
RESTART_EXIT_CODE = 75
SUPERVISOR_FD_ENV = "INFINITE_CANVAS_SUPERVISOR_FD"
SUPERVISOR_PID_ENV = "INFINITE_CANVAS_SUPERVISOR_PID"
MIN_PYTHON = (3, 12)
MAX_PYTHON = (3, 13)

DEPENDENCY_PROBE = (
    "import cryptography, fastapi, httpx, numpy, onnxruntime, socksio, "
    "pydantic, pymatting, requests, scipy, uvicorn; "
    "import multipart; from PIL import Image"
)

PYTHON_PROBE = r"""
import json
import sys

venv_ready = True
try:
    import ensurepip
    import venv
    import xml.parsers.expat
except Exception:
    venv_ready = False

print(json.dumps({
    "version": list(sys.version_info[:3]),
    "executable": sys.executable,
    "venv_ready": venv_ready,
}))
""".strip()


class LauncherError(RuntimeError):
    """A user-facing launcher error."""


class _LaunchClaim:
    def __init__(self, handle, windows: bool) -> None:
        self._handle = handle
        self._windows = windows

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            return
        self._handle = None
        try:
            handle.seek(0)
            if self._windows:
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _acquire_launch_claim(
    claim_file: Path = LAUNCH_CLAIM_FILE,
) -> Optional[_LaunchClaim]:
    claim_file.parent.mkdir(parents=True, exist_ok=True)
    handle = claim_file.open("a+b")
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(
                handle.fileno(),
                fcntl.LOCK_EX | fcntl.LOCK_NB,
            )
    except OSError:
        handle.close()
        return None
    return _LaunchClaim(handle, os.name == "nt")


@dataclass(frozen=True)
class Runtime:
    executable: Path
    version: Tuple[int, int, int]
    kind: str

    @property
    def label(self) -> str:
        version = ".".join(str(part) for part in self.version)
        return f"{self.executable} (Python {version}, {self.kind})"


def platform_label(
    system: Optional[str] = None, machine: Optional[str] = None
) -> str:
    system_name = system or platform.system() or os.name
    architecture = machine or platform.machine() or "unknown"
    return f"{system_name} {architecture}"


def venv_python_path(
    root: Path = VENV_DIR, os_name: Optional[str] = None
) -> Path:
    selected_os = os_name or os.name
    if selected_os == "nt":
        return root / "Scripts" / "python.exe"
    return root / "bin" / "python"


def dependency_requirements_file(
    lock_file: Path = REQUIREMENTS_LOCK_FILE,
    requirements_file: Path = REQUIREMENTS_FILE,
) -> Path:
    """Prefer the reviewed, hash-pinned lock while retaining source fallback."""

    return lock_file if lock_file.is_file() else requirements_file


def requirements_digest(path: Optional[Path] = None) -> str:
    selected = path or dependency_requirements_file()
    return hashlib.sha256(selected.read_bytes()).hexdigest()


def local_package_dirs(root: Path = PACKAGES_DIR) -> List[Path]:
    if not root.is_dir():
        return []
    directories = [root]
    directories.extend(
        child for child in sorted(root.iterdir()) if child.is_dir()
    )
    return directories


def load_project_environment(path: Path = ENV_FILE) -> None:
    """Load device-local launcher settings without overriding the shell."""
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        return
    except OSError as exc:
        raise LauncherError(f"无法读取启动配置 {path}：{exc}") from exc

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if (
            not key
            or not (key[0].isalpha() or key[0] == "_")
            or not all(
                character.isalnum() or character == "_"
                for character in key
            )
        ):
            continue
        value = value.strip()
        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in {"'", '"'}
        ):
            value = value[1:-1]
        os.environ.setdefault(key, value)


def application_response_matches(body: str) -> bool:
    normalized = body.lower()
    has_project_title = (
        "<title>ai studio</title>" in normalized
        or (
            "<title>" in normalized
            and any(
                title in normalized
                for title in ("reroll</title>", "infinite canvas</title>")
            )
        )
    )
    has_project_mark = any(
        asset in normalized
        for asset in (
            "/static/images/brand/wordmark.svg",
            "/static/images/brand/logo.svg",
            "/static/images/brand/logo.png",
            "/static/images/brand/favicon.png",
        )
    )
    return has_project_title and has_project_mark


def server_bind_host() -> str:
    return str(os.getenv("INFINITE_CANVAS_HOST") or "127.0.0.1").strip()


def preferred_server_port() -> int:
    raw_port = str(os.getenv("INFINITE_CANVAS_PORT") or PORT).strip()
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise LauncherError(
            "INFINITE_CANVAS_PORT 必须是 1 到 65535 之间的整数。"
        ) from exc
    if not 1 <= port <= 65535:
        raise LauncherError(
            "INFINITE_CANVAS_PORT 必须是 1 到 65535 之间的整数。"
        )
    return port


def local_url(port: int = PORT) -> str:
    return f"http://127.0.0.1:{port}/"


def _configure_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _unique_commands(
    commands: Iterable[Sequence[str]],
) -> List[Tuple[str, ...]]:
    result: List[Tuple[str, ...]] = []
    seen = set()
    for command in commands:
        normalized = tuple(str(part) for part in command if str(part))
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _base_python_candidates() -> List[Tuple[str, ...]]:
    # The platform bootstrap invokes this module with the project-managed
    # interpreter. Prefer it so the venv does not accidentally become tied to
    # a different system Python that happens to be on PATH.
    candidates: List[Sequence[str]] = [(sys.executable,)]
    if os.name == "nt":
        py_launcher = shutil.which("py")
        system_python = shutil.which("python")
        if py_launcher:
            candidates.append((py_launcher, "-3.12"))
        if system_python:
            candidates.append((system_python,))
    else:
        for path in (
            shutil.which("python3.12") or "",
            "/opt/homebrew/bin/python3.12",
            "/usr/local/bin/python3.12",
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            shutil.which("python3") or "",
            "/usr/bin/python3",
        ):
            if path:
                candidates.append((path,))
    return _unique_commands(candidates)


def _probe_python(command: Sequence[str]) -> Optional[Dict[str, object]]:
    try:
        completed = subprocess.run(
            [*command, "-c", PYTHON_PROBE],
            cwd=str(PROJECT_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    try:
        info = json.loads(completed.stdout.strip().splitlines()[-1])
        version = tuple(int(part) for part in info["version"])
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    if version < MIN_PYTHON or version >= MAX_PYTHON:
        return None
    info["version"] = version
    return info


def _pip_available(executable: Path) -> bool:
    completed = subprocess.run(
        [str(executable), "-m", "pip", "--version"],
        cwd=str(PROJECT_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return completed.returncode == 0


def _runtime_from_path(path: Path, kind: str) -> Optional[Runtime]:
    if not path.is_file():
        return None
    info = _probe_python((str(path),))
    if not info:
        return None
    return Runtime(
        # Do not resolve symlinks here. On macOS a venv's python executable is
        # commonly a symlink to the base interpreter, but invoking the symlink
        # is what activates the virtual environment's sys.prefix/site-packages.
        executable=Path(os.path.abspath(str(path))),
        version=info["version"],  # type: ignore[arg-type]
        kind=kind,
    )


def _existing_runtime() -> Optional[Runtime]:
    runtime = _runtime_from_path(venv_python_path(), "项目虚拟环境")
    if runtime and _pip_available(runtime.executable):
        return runtime
    return None


def _portable_windows_runtime() -> Optional[Runtime]:
    if os.name != "nt":
        return None
    return _runtime_from_path(
        PROJECT_DIR / "python" / "python.exe", "Windows 便携环境"
    )


def resolve_runtime(create: bool = True) -> Optional[Runtime]:
    existing = _existing_runtime()
    if existing:
        return existing

    if not create:
        return _portable_windows_runtime()

    print("[环境] 正在准备项目专用 Python 环境...")
    for command in _base_python_candidates():
        info = _probe_python(command)
        if not info or not info.get("venv_ready"):
            continue
        version = ".".join(str(part) for part in info["version"])
        print(f"[环境] 使用基础 Python {version}：{' '.join(command)}")
        completed = subprocess.run(
            [*command, "-m", "venv", "--clear", str(VENV_DIR)],
            cwd=str(PROJECT_DIR),
            check=False,
        )
        if completed.returncode != 0:
            print("[提示] 该 Python 无法创建虚拟环境，正在尝试其他版本。")
            continue
        runtime = _existing_runtime()
        if runtime:
            print(f"[完成] 已创建虚拟环境：{runtime.executable}")
            return runtime

    portable = _portable_windows_runtime()
    if portable:
        print("[环境] 未找到可创建虚拟环境的系统 Python。")
        print("[环境] 改用项目自带的 Windows 便携 Python。")
        return portable

    minimum = ".".join(str(part) for part in MIN_PYTHON)
    raise LauncherError(
        f"找不到可用的 Python {minimum}.x。\n"
        "请通过项目根目录的统一启动脚本运行；它会自动下载项目专用 "
        "Python，且不会修改系统 Python。"
    )


def _ensure_pip(runtime: Runtime) -> None:
    if _pip_available(runtime.executable):
        return
    if not GET_PIP_FILE.is_file():
        raise LauncherError("当前 Python 没有 pip，项目中也缺少 get-pip.py。")
    print("[依赖] 当前环境没有 pip，正在安装...")
    completed = subprocess.run(
        [str(runtime.executable), str(GET_PIP_FILE), "--quiet"],
        cwd=str(PROJECT_DIR),
        check=False,
    )
    if completed.returncode != 0 or not _pip_available(runtime.executable):
        raise LauncherError("pip 安装失败，请检查 Python 环境和网络后重试。")


def dependency_status(runtime: Runtime) -> Tuple[bool, str]:
    completed = subprocess.run(
        [str(runtime.executable), "-c", DEPENDENCY_PROBE],
        cwd=str(PROJECT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if completed.returncode == 0:
        return True, ""
    detail = completed.stderr.strip() or completed.stdout.strip()
    if len(detail) > 1200:
        detail = detail[-1200:]
    return False, detail


def _load_state() -> Dict[str, object]:
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return {"runtimes": {}}
    if not isinstance(data, dict) or not isinstance(data.get("runtimes"), dict):
        return {"runtimes": {}}
    return data


def _runtime_key(runtime: Runtime) -> str:
    identity = "|".join(
        (
            platform.system(),
            platform.machine(),
            str(runtime.executable),
            ".".join(str(part) for part in runtime.version),
        )
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _record_dependencies(runtime: Runtime) -> None:
    state = _load_state()
    runtimes = state.setdefault("runtimes", {})
    assert isinstance(runtimes, dict)
    runtimes[_runtime_key(runtime)] = {
        "requirements_sha256": requirements_digest(),
        "python": str(runtime.executable),
        "updated_at": int(time.time()),
    }
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary.replace(STATE_FILE)


def _recorded_requirements_digest(runtime: Runtime) -> Optional[str]:
    state = _load_state()
    runtimes = state.get("runtimes")
    if not isinstance(runtimes, dict):
        return None
    record = runtimes.get(_runtime_key(runtime))
    if not isinstance(record, dict):
        return None
    digest = record.get("requirements_sha256")
    return digest if isinstance(digest, str) else None


def install_dependencies(runtime: Runtime, force: bool = False) -> None:
    dependency_file = dependency_requirements_file()
    if not dependency_file.is_file():
        raise LauncherError("项目中缺少 requirements.lock.txt 和 requirements.txt。")

    _ensure_pip(runtime)
    valid, detail = dependency_status(runtime)
    if valid and not force:
        recorded_digest = _recorded_requirements_digest(runtime)
        if recorded_digest is None:
            _record_dependencies(runtime)
            print("[依赖] 已安装且验证通过，无需重复安装。")
            return
        if recorded_digest == requirements_digest():
            print("[依赖] 已安装且验证通过，无需重复安装。")
            return
        print(f"[依赖] {dependency_file.name} 已更新，正在同步依赖。")

    if not valid and detail:
        last_line = detail.splitlines()[-1]
        print(f"[依赖] 检测到缺失或不可用的依赖：{last_line}")

    print("[依赖] 正在安装项目依赖...")
    command = [
        str(runtime.executable),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--prefer-binary",
        "--upgrade",
    ]
    if force:
        command.append("--force-reinstall")
    for package_dir in local_package_dirs():
        command.extend(("--find-links", str(package_dir)))
    command.extend(("-r", str(dependency_file)))

    completed = subprocess.run(command, cwd=str(PROJECT_DIR), check=False)
    if completed.returncode != 0:
        raise LauncherError(
            "依赖安装失败。请确认网络可用，或补充与当前系统和 Python "
            "版本匹配的离线 packages。"
        )

    valid, detail = dependency_status(runtime)
    if not valid:
        raise LauncherError(f"依赖安装完成，但导入验证失败：\n{detail}")
    _record_dependencies(runtime)
    print("[完成] 所有项目依赖均可正常使用。")


def _port_is_open(host: str = "127.0.0.1", port: int = PORT) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.4):
            return True
    except OSError:
        return False


def _find_available_port(
    start_port: int, scan_limit: int = PORT_SCAN_LIMIT
) -> int:
    if scan_limit < 1:
        raise LauncherError("自动端口扫描数量必须大于 0。")
    candidates = list(
        range(start_port, min(65535, start_port + scan_limit - 1) + 1)
    )
    if len(candidates) < scan_limit:
        candidates.extend(
            range(PORT, min(65535, PORT + scan_limit - len(candidates) - 1) + 1)
        )
    for port in candidates:
        if not _port_is_open(port=port):
            return port
    raise LauncherError(
        f"从端口 {start_port} 开始检查了 {scan_limit} 个端口，"
        "但没有找到可用端口。请关闭部分本地服务后重试。"
    )


def _application_is_running(url: str = LOCAL_URL) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1.0) as response:
            body = response.read(32768).decode("utf-8", errors="ignore")
    except (OSError, urllib.error.URLError, ValueError):
        return False
    return application_response_matches(body)


def _open_browser_when_ready(url: str = LOCAL_URL) -> None:
    for _ in range(80):
        if _application_is_running(url):
            try:
                webbrowser.open(url, new=2)
            except Exception:
                pass
            return
        time.sleep(0.25)
    print(f"[提示] 浏览器未自动打开，请手动访问：{url}")


def _runtime_status_payload(
    url: str = RUNTIME_STATUS_URL,
) -> Optional[Dict[str, object]]:
    try:
        with urllib.request.urlopen(url, timeout=1.0) as response:
            payload = json.loads(response.read(32768).decode("utf-8"))
    except (
        OSError,
        urllib.error.URLError,
        ValueError,
        json.JSONDecodeError,
    ):
        return None
    return payload if isinstance(payload, dict) else None


def _runtime_is_healthy(
    url: str = RUNTIME_STATUS_URL,
    *,
    expected_installation_id: Optional[str] = None,
) -> bool:
    payload = _runtime_status_payload(url)
    if payload is None:
        return False
    if (
        expected_installation_id is not None
        and str(payload.get("installation_id") or "")
        != expected_installation_id
    ):
        return False
    return payload.get("stage") in {
        "ready",
        "setup_required",
        "recovery_required",
    }


def _runtime_matches_installation(
    url: str,
    expected_installation_id: str = INSTALLATION_ID,
) -> bool:
    payload = _runtime_status_payload(url)
    if payload is None:
        return False
    return (
        str(payload.get("installation_id") or "")
        == expected_installation_id
    )


def existing_instance_url(
    state_file: Path = INSTANCE_FILE,
    expected_installation_id: str = INSTALLATION_ID,
) -> Optional[str]:
    try:
        record = json.loads(state_file.read_text(encoding="utf-8"))
        port = int(record.get("port"))
        int(record.get("pid"))
        recorded_installation_id = str(
            record.get("installation_id") or ""
        )
        if recorded_installation_id != expected_installation_id:
            raise ValueError("instance record belongs to another installation")
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        try:
            state_file.unlink()
        except FileNotFoundError:
            pass
        return None
    url = f"http://127.0.0.1:{port}/"
    if _runtime_matches_installation(
        f"{url}api/runtime/status",
        expected_installation_id,
    ):
        return url
    try:
        state_file.unlink()
    except FileNotFoundError:
        pass
    return None


def _write_instance_state(
    pid: int,
    port: int = PORT,
    state_file: Path = INSTANCE_FILE,
    installation_id: str = INSTALLATION_ID,
) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    temporary = state_file.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            {
                "pid": int(pid),
                "port": int(port),
                "installation_id": installation_id,
                "updated_at": int(time.time()),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    temporary.replace(state_file)


def _clear_instance_state(
    pid: int,
    state_file: Path = INSTANCE_FILE,
) -> None:
    try:
        record = json.loads(state_file.read_text(encoding="utf-8"))
        if int(record.get("pid")) != int(pid):
            return
        state_file.unlink()
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return


def _record_instance_when_ready(
    child: subprocess.Popen,
    port: int = PORT,
) -> None:
    status_url = f"{local_url(port)}api/runtime/status"
    for _ in range(120):
        if child.poll() is not None:
            return
        if _runtime_is_healthy(
            status_url,
            expected_installation_id=INSTALLATION_ID,
        ):
            _write_instance_state(child.pid, port)
            return
        time.sleep(0.25)


def _wait_for_runtime_health(
    timeout_seconds: float = 30.0,
    port: int = PORT,
) -> bool:
    status_url = f"{local_url(port)}api/runtime/status"
    deadline = time.monotonic() + max(0.0, float(timeout_seconds))
    while time.monotonic() < deadline:
        if _runtime_is_healthy(
            status_url,
            expected_installation_id=INSTALLATION_ID,
        ):
            return True
        time.sleep(0.25)
    return False


def _spawn_application(
    runtime: Runtime,
    port: int = PORT,
    *,
    takeover_workspace: bool = False,
) -> subprocess.Popen:
    environment = os.environ.copy()
    environment.pop("INFINITE_CANVAS_WORKSPACE_TAKEOVER", None)
    if takeover_workspace:
        environment["INFINITE_CANVAS_WORKSPACE_TAKEOVER"] = "1"
    environment["PYTHONUNBUFFERED"] = "1"
    environment.setdefault("INFINITE_CANVAS_HOST", server_bind_host())
    environment["INFINITE_CANVAS_PORT"] = str(port)
    environment["INFINITE_CANVAS_PROJECT_DIR"] = str(PROJECT_DIR)
    environment.pop(SUPERVISOR_FD_ENV, None)
    environment[SUPERVISOR_PID_ENV] = str(os.getpid())
    environment.setdefault(
        "INFINITE_CANVAS_INSTANCE_STATE_DIR",
        str(application_state_directory() / "instance-state"),
    )
    process_group_options: Dict[str, object]
    if os.name == "nt":
        process_group_options = {
            "creationflags": subprocess.CREATE_NEW_PROCESS_GROUP,
        }
    else:
        process_group_options = {"start_new_session": True}
    supervisor_read_fd: Optional[int] = None
    supervisor_guard_fd: Optional[int] = None
    if os.name != "nt":
        supervisor_read_fd, supervisor_guard_fd = os.pipe()
        environment[SUPERVISOR_FD_ENV] = str(supervisor_read_fd)
        process_group_options["pass_fds"] = (supervisor_read_fd,)
    try:
        child = subprocess.Popen(
            [str(runtime.executable), "-m", "infinite_canvas"],
            cwd=str(BACKEND_DIR),
            env=environment,
            **process_group_options,
        )
    except Exception:
        if supervisor_guard_fd is not None:
            os.close(supervisor_guard_fd)
        raise
    finally:
        if supervisor_read_fd is not None:
            os.close(supervisor_read_fd)
    child._infinite_canvas_supervisor_guard_fd = supervisor_guard_fd
    threading.Thread(
        target=_record_instance_when_ready,
        args=(child, port),
        daemon=True,
    ).start()
    return child


def _close_supervisor_guard(child: subprocess.Popen) -> None:
    guard_fd = getattr(
        child,
        "_infinite_canvas_supervisor_guard_fd",
        None,
    )
    child._infinite_canvas_supervisor_guard_fd = None
    if not isinstance(guard_fd, int):
        return
    try:
        os.close(guard_fd)
    except OSError:
        pass


def _interrupt_child(child: subprocess.Popen) -> None:
    if os.name == "nt":
        child.send_signal(signal.CTRL_BREAK_EVENT)
        return
    os.killpg(child.pid, signal.SIGINT)


def _stop_child_after_interrupt(
    child: subprocess.Popen,
    *,
    grace_period_seconds: float = 10.0,
) -> int:
    print("[关闭] 正在安全清理；再次按 Ctrl+C 可强制退出。")
    try:
        _interrupt_child(child)
    except OSError:
        return int(child.wait())
    try:
        return int(
            child.wait(timeout=max(0.0, float(grace_period_seconds)))
        )
    except (KeyboardInterrupt, subprocess.TimeoutExpired):
        print("[关闭] 清理未完成，正在强制结束应用进程。")
        child.kill()
        return int(child.wait())


def wait_for_child(
    child: subprocess.Popen,
    *,
    grace_period_seconds: float = 10.0,
) -> int:
    try:
        try:
            return int(child.wait())
        except KeyboardInterrupt:
            return _stop_child_after_interrupt(
                child,
                grace_period_seconds=grace_period_seconds,
            )
    finally:
        _close_supervisor_guard(child)


def supervise_application(
    runtime: Runtime,
    port: int = PORT,
    *,
    takeover_workspace: bool = False,
) -> int:
    """Allow later controlled restarts after each replacement becomes healthy."""
    def spawn() -> subprocess.Popen:
        if takeover_workspace:
            return _spawn_application(
                runtime,
                port,
                takeover_workspace=True,
            )
        return _spawn_application(runtime, port)

    restarted = False
    child = spawn()
    while True:
        exit_code = wait_for_child(child, grace_period_seconds=10.0)
        _clear_instance_state(child.pid)
        if exit_code != RESTART_EXIT_CODE:
            return exit_code
        if restarted:
            raise LauncherError(
                "自动重启后的服务尚未恢复可用便再次请求重启，"
                "已停止以避免重启循环。"
            )
        restarted = True
        print("[重启] 已收到受控重启请求，正在原终端重新启动。")
        child = spawn()
        try:
            healthy = _wait_for_runtime_health(
                timeout_seconds=30.0,
                port=port,
            )
        except KeyboardInterrupt:
            exit_code = _stop_child_after_interrupt(
                child,
                grace_period_seconds=10.0,
            )
            _clear_instance_state(child.pid)
            return exit_code
        if healthy:
            restarted = False
        else:
            print(
                "[失败] 自动重启后约 30 秒仍未恢复健康状态；"
                "已停止继续重试，并保留当前进程供启动页诊断。"
            )


def _lan_ip() -> Optional[str]:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        address = probe.getsockname()[0]
    except OSError:
        try:
            address = socket.gethostbyname(socket.gethostname())
        except OSError:
            return None
    finally:
        probe.close()
    if not address or address.startswith("127."):
        return None
    return address


def start_application(
    runtime: Optional[Runtime],
    open_browser: bool = True,
    *,
    launch_claim: Optional[_LaunchClaim] = None,
    takeover_workspace: bool = False,
) -> int:
    if not MAIN_FILE.is_file():
        raise LauncherError("项目中缺少 main.py。")

    preferred_port = preferred_server_port()
    selected_port = preferred_port
    selected_url = local_url(selected_port)
    existing_url = existing_instance_url()
    if existing_url:
        print(f"[运行] Reroll 已经启动：{existing_url}")
        if open_browser:
            try:
                webbrowser.open(existing_url, new=2)
            except Exception:
                pass
        return 0
    if _port_is_open(port=preferred_port):
        selected_port = _find_available_port(preferred_port + 1)
        selected_url = local_url(selected_port)
        print(
            f"[端口] {preferred_port} 已被其他程序占用，"
            f"已自动切换到 {selected_port}。"
        )

    owns_launch_claim = launch_claim is None
    launch_claim = launch_claim or _acquire_launch_claim()
    if launch_claim is None:
        raise LauncherError(
            "另一个启动器正在启动或监督 Reroll。"
            "请使用原终端，或稍后重试。"
        )

    try:
        existing_url = existing_instance_url()
        if existing_url:
            print(f"[运行] Reroll 已经启动：{existing_url}")
            if open_browser:
                try:
                    webbrowser.open(existing_url, new=2)
                except Exception:
                    pass
            return 0
        if runtime is None:
            raise LauncherError("无法准备 Python 运行环境。")
        print("")
        print("============================================")
        print("  Reroll")
        print("============================================")
        print(f"本机访问：{selected_url}")
        host = server_bind_host()
        lan_ip = (
            _lan_ip()
            if host not in {"127.0.0.1", "::1", "localhost"}
            else None
        )
        if lan_ip:
            print(f"局域网访问：http://{lan_ip}:{selected_port}/")
        else:
            print(
                "网络模式：仅本机（如需局域网访问，请显式设置 "
                "INFINITE_CANVAS_HOST=0.0.0.0）"
            )
        print("按 Ctrl+C 停止服务。")
        if takeover_workspace:
            print(
                "[接管] 已确认原设备服务关闭；"
                "本次启动将替换其他设备残留的工作区占用状态。"
            )
        print("")
        if open_browser:
            threading.Thread(
                target=_open_browser_when_ready,
                args=(selected_url,),
                daemon=True,
            ).start()
        if takeover_workspace:
            return supervise_application(
                runtime,
                port=selected_port,
                takeover_workspace=True,
            )
        return supervise_application(runtime, port=selected_port)
    finally:
        if owns_launch_claim:
            launch_claim.release()


def check_environment() -> int:
    print(f"系统：{platform_label()}")
    runtime = resolve_runtime(create=False)
    if not runtime:
        print("Python 环境：未创建")
        return 1
    print(f"Python 环境：{runtime.label}")
    if not _pip_available(runtime.executable):
        print("pip：不可用")
        return 1
    print("pip：可用")
    valid, detail = dependency_status(runtime)
    print(f"项目依赖：{'正常' if valid else '缺失或不可用'}")
    if detail:
        print(detail)
    preferred_port = preferred_server_port()
    preferred_url = local_url(preferred_port)
    if _port_is_open(port=preferred_port):
        owner = (
            "Reroll"
            if _application_is_running(preferred_url)
            else "其他程序"
        )
        print(f"首选端口 {preferred_port}：已被{owner}占用")
        if owner == "其他程序":
            fallback_port = _find_available_port(preferred_port + 1)
            print(f"自动备用端口 {fallback_port}：可用")
    else:
        print(f"首选端口 {preferred_port}：可用")
    return 0 if valid else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Reroll 统一启动与维护入口"
    )
    parser.add_argument(
        "action",
        nargs="?",
        default="start",
        choices=("start", "install", "check"),
        help="start=自动准备并启动，install=安装/修复依赖，check=检查环境",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="重新安装全部依赖（仅 install/start）",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="启动后不自动打开浏览器",
    )
    parser.add_argument(
        "--takeover-workspace",
        action="store_true",
        help=(
            "确认原设备服务已经关闭，并接管 OneDrive 中残留的工作区占用状态"
        ),
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    _configure_console()
    os.chdir(str(PROJECT_DIR))
    load_project_environment()
    args = build_parser().parse_args(argv)
    print(f"[启动器] 当前系统：{platform_label()}")

    launch_claim: Optional[_LaunchClaim] = None
    try:
        if args.action == "check":
            return check_environment()
        if args.action == "start":
            if existing_instance_url():
                return start_application(
                    None,
                    open_browser=not args.no_browser,
                )
        launch_claim = _acquire_launch_claim()
        if launch_claim is None:
            raise LauncherError(
                "另一个启动器正在准备或监督 Reroll。"
                "请使用原终端，或稍后重试。"
            )
        runtime = resolve_runtime(create=True)
        if runtime is None:
            raise LauncherError("无法准备 Python 运行环境。")
        print(f"[启动器] Python：{runtime.label}")
        install_dependencies(runtime, force=args.force)
        if args.action == "install":
            print("[完成] 依赖安装完成，现在可以直接运行统一启动入口。")
            return 0
        return start_application(
            runtime,
            open_browser=not args.no_browser,
            launch_claim=launch_claim,
            takeover_workspace=args.takeover_workspace,
        )
    except LauncherError as exc:
        print("")
        print(f"[错误] {exc}", file=sys.stderr)
        return 1
    finally:
        if launch_claim is not None:
            launch_claim.release()


if __name__ == "__main__":
    raise SystemExit(main())
