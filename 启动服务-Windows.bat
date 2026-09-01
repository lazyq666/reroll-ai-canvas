@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONUNBUFFERED=1"
set "PYTHON_VERSION=3.12"
set "UV_VERSION=0.11.32"
if defined INFINITE_CANVAS_UV_VERSION set "UV_VERSION=%INFINITE_CANVAS_UV_VERSION%"

rem Reuse an already prepared project environment without touching the network.
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if (3, 12) <= sys.version_info < (3, 13) else 1)" >nul 2>&1
    if not errorlevel 1 (
        "%~dp0.venv\Scripts\python.exe" "%~dp0backend\launcher.py" %*
        goto :done
    )
)

if defined INFINITE_CANVAS_STATE_DIR (
    set "STATE_DIR=%INFINITE_CANVAS_STATE_DIR%"
) else if defined LOCALAPPDATA (
    set "STATE_DIR=%LOCALAPPDATA%\Infinite Canvas"
) else (
    set "STATE_DIR=%USERPROFILE%\AppData\Local\Infinite Canvas"
)

set "RUNTIME_DIR=%STATE_DIR%\runtime"
set "INFINITE_CANVAS_UV_INSTALL_DIR=%RUNTIME_DIR%\uv"
set "UV_EXE=%INFINITE_CANVAS_UV_INSTALL_DIR%\uv.exe"
set "UV_PYTHON_INSTALL_DIR=%RUNTIME_DIR%\python"
set "UV_CACHE_DIR=%STATE_DIR%\cache\uv"
set "UV_NO_MODIFY_PATH=1"
set "INFINITE_CANVAS_UV_INSTALL_URL=https://astral.sh/uv/%UV_VERSION%/install.ps1"

if exist "%UV_EXE%" goto :uv_ready

where powershell >nul 2>&1
if errorlevel 1 goto :managed_python_failed

echo [环境] 首次运行，正在下载 Reroll 专用环境管理器...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $installer=Join-Path ([IO.Path]::GetTempPath()) ('infinite-canvas-uv-' + [guid]::NewGuid().ToString('N') + '.ps1'); try { Invoke-WebRequest -UseBasicParsing -Uri $env:INFINITE_CANVAS_UV_INSTALL_URL -OutFile $installer; $env:UV_UNMANAGED_INSTALL=$env:INFINITE_CANVAS_UV_INSTALL_DIR; $env:UV_NO_MODIFY_PATH='1'; & $installer } finally { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }"
if errorlevel 1 goto :managed_python_failed
if not exist "%UV_EXE%" goto :managed_python_failed

:uv_ready
echo [环境] 正在准备项目专用 Python %PYTHON_VERSION%（不会修改系统 Python）...
"%UV_EXE%" python install "%PYTHON_VERSION%"
if errorlevel 1 goto :managed_python_failed

set "PYTHON_PATH_FILE=%TEMP%\infinite-canvas-python-%RANDOM%-%RANDOM%.txt"
set "PYTHON_CMD="
"%UV_EXE%" python find --managed-python "%PYTHON_VERSION%" > "%PYTHON_PATH_FILE%"
if errorlevel 1 (
    del /q "%PYTHON_PATH_FILE%" >nul 2>&1
    goto :managed_python_failed
)
set /p "PYTHON_CMD="<"%PYTHON_PATH_FILE%"
del /q "%PYTHON_PATH_FILE%" >nul 2>&1
if not defined PYTHON_CMD goto :managed_python_failed

"%PYTHON_CMD%" -c "import sys; raise SystemExit(0 if (3, 12) <= sys.version_info < (3, 13) else 1)" >nul 2>&1
if errorlevel 1 goto :managed_python_failed
"%PYTHON_CMD%" "%~dp0backend\launcher.py" %*
goto :done

:managed_python_failed
echo [提示] 项目专用 Python 准备失败，正在尝试本机环境。

rem Preserve an offline fallback for machines that already have Python 3.12.
where py >nul 2>&1
if not errorlevel 1 (
    py -3.12 -c "import sys; raise SystemExit(0 if (3, 12) <= sys.version_info < (3, 13) else 1)" >nul 2>&1
    if not errorlevel 1 (
        echo [环境] 自动下载不可用，临时使用本机 Python 3.12。
        py -3.12 "%~dp0backend\launcher.py" %*
        goto :done
    )
)

where python >nul 2>&1
if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if (3, 12) <= sys.version_info < (3, 13) else 1)" >nul 2>&1
    if not errorlevel 1 (
        echo [环境] 自动下载不可用，临时使用本机 Python 3.12。
        python "%~dp0backend\launcher.py" %*
        goto :done
    )
)

echo.
echo [错误] 无法自动准备 Python 3.12。
echo 请检查网络连接后重新启动；工具不会修改或覆盖系统 Python。
set "EXIT_CODE=1"
goto :pause

:done
set "EXIT_CODE=%ERRORLEVEL%"

:pause
echo.
if not "%INFINITE_CANVAS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
