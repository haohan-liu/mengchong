@echo off
setlocal
title QPet - Backup and Publish
set "PROJECT_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\publish-assistant.ps1" %*
set "SCRIPT_EXIT=%ERRORLEVEL%"
echo.
if not "%SCRIPT_EXIT%"=="0" echo The publish assistant did not finish. Read the error above.
echo Press any key to close this window.
pause >nul
exit /b %SCRIPT_EXIT%
