@echo off
chcp 65001 >nul
title VibeCoding Setup

echo ============================================
echo   VibeCoding - Windows Setup
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=2" %%i in ('node -v 2^>nul') do set node_ver=%%i
echo [OK] Node.js %node_ver%

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Python not found. Some scripts need it (extract_user_msgs.py)
    echo       Install from https://python.org
)

:: Check npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] npm not found
    pause
    exit /b 1
)
echo.

:: Install dependencies
echo [1/4] Installing npm dependencies...
cd /d "%~dp0.."
call npm install
if %errorlevel% neq 0 (
    echo [FAIL] npm install failed
    pause
    exit /b 1
)
echo [OK] Dependencies installed
echo.

:: Create config.json from example
echo [2/4] Checking config.json...
if not exist config.json (
    if exist config.example.json (
        copy config.example.json config.json >nul
        echo [OK] Created config.json from config.example.json
        echo      Edit config.json to set your relay URL and paths
    ) else (
        echo [WARN] No config.example.json found. Create config.json manually.
    )
) else (
    echo [OK] config.json already exists
)
echo.

:: Token
echo [3/4] Checking token...
if not exist client\.vibecoding-token (
    echo %RANDOM%%RANDOM%%RANDOM%%RANDOM% > client\.vibecoding-token
    echo [OK] Generated token: client\.vibecoding-token
    echo      Share this token with your phone app
) else (
    echo [OK] Token exists
)
echo.

:: Check relay URL in config
echo [4/4] Quick check...
if exist config.json (
    findstr "relayUrl" config.json >nul && echo [OK] relayUrl found in config.json
)

echo.
echo ============================================
echo   Setup complete!
echo ============================================
echo.
echo Next steps:
echo   1. Set up relay on your server (see relay/README.md)
echo   2. Start PC client:  node client/client.js
echo   3. Start app dev:    cd app ^&^& npx expo start
echo.
pause
