@echo off
setlocal
title QPet - Setup Development Environment
set "PROJECT_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\setup-dev-environment.ps1" %*
set "SCRIPT_EXIT=%ERRORLEVEL%"
echo.
if not "%SCRIPT_EXIT%"=="0" echo The setup assistant did not finish. Read the error above.
echo Press any key to close this window.
pause >nul
exit /b %SCRIPT_EXIT%
