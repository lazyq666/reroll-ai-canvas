@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_gpt_image_2_helper_windows.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%INFINITE_CANVAS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
