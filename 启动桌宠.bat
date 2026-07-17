@echo off
setlocal EnableExtensions

rem Switch to this BAT file's directory. This also supports Chinese paths.
cd /d "%~dp0"
if errorlevel 1 (
    echo [ERROR] Cannot open the project directory.
    goto :failed
)

set "ELECTRON_EXE=node_modules\electron\dist\electron.exe"

if not exist "package.json" (
    echo [ERROR] package.json was not found.
    echo Keep this BAT file in the project root directory.
    goto :failed
)

if not exist "%ELECTRON_EXE%" (
    echo Installing project dependencies for the first launch...
    where npm.cmd >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Node.js and npm were not found.
        echo Install Node.js 22 or later, then try again.
        goto :failed
    )
    call npm.cmd install
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        goto :failed
    )
    if not exist "%ELECTRON_EXE%" (
        echo [ERROR] Electron is still missing after npm install.
        goto :failed
    )
)

if not exist "dist\index.html" goto :build
if not exist "dist-electron\electron\main.js" goto :build
goto :launch

:build
echo Building the desktop companion. Please wait...
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js and npm were not found.
    goto :failed
)
call npm.cmd run build
if errorlevel 1 (
    echo [ERROR] Project build failed.
    goto :failed
)
if not exist "dist\index.html" (
    echo [ERROR] The renderer build is missing.
    goto :failed
)
if not exist "dist-electron\electron\main.js" (
    echo [ERROR] The Electron build is missing.
    goto :failed
)

:launch
echo Starting the desktop companion...
if defined PET_BAT_VALIDATE_ONLY (
    echo BAT validation passed.
    exit /b 0
)
start "" "%ELECTRON_EXE%" "." >nul 2>&1
if errorlevel 1 (
    echo [ERROR] The desktop companion failed to start.
    goto :failed
)
exit /b 0

:failed
echo.
pause
exit /b 1
