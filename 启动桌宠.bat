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
    echo Repairing project dependencies for the first launch...
    where npm.cmd >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Node.js and npm were not found.
        echo Install Node.js 22 or later, then try again.
        goto :failed
    )
    rem npm install can say "up to date" when Electron's package folder remains
    rem but its downloaded binary was removed. Rebuild exactly from package-lock.
    set "ELECTRON_SKIP_BINARY_DOWNLOAD="
    set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
    call npm.cmd ci --include=dev
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        goto :failed
    )
    call :wait-for-electron
    if errorlevel 1 (
        echo [ERROR] Electron is still missing after dependency repair.
        echo Waited 60 seconds. Check antivirus quarantine, proxy settings, or the Electron mirror, then run again.
        goto :failed
    )
)

if not exist "dist\index.html" goto :build
if not exist "dist-electron\electron\main.js" goto :build
goto :refresh

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
goto :launch

:refresh
rem Source files may have changed while compiled output still exists. Refresh the
rem two desktop bundles so restarting the BAT always loads the current interface.
echo Refreshing the desktop interface...
call npm.cmd run build:renderer
if errorlevel 1 (
    echo [ERROR] The interface refresh failed.
    goto :failed
)
call npm.cmd run build:electron
if errorlevel 1 (
    echo [ERROR] The desktop process refresh failed.
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

:wait-for-electron
rem Electron's install script can finish downloading just after npm reports its
rem dependency tree is ready. Wait briefly instead of treating that race as a failure.
for /l %%I in (1,1,30) do (
    if exist "%ELECTRON_EXE%" exit /b 0
    timeout /t 2 /nobreak >nul
)
exit /b 1
