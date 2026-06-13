@echo off
title Tally AI Bot Local Setup and Launcher
echo ==========================================================
echo 🚀 TALLY AI BOT — ONE-CLICK SETUP AND LAUNCHER (LOCAL MODE)
echo ==========================================================
echo.

:: Check for Winget
where winget >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Windows Package Manager winget is not installed.
    echo Please install it or manually install Node.js v18+ and astral-sh/uv.
    pause
    exit /b 1
)

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ⚙️ Node.js not found. Installing Node.js via winget...
    winget install --id OpenJS.NodeJS -e --accept-source-agreements --accept-package-agreements
    echo.
    echo [INFO] Node.js was successfully installed.
    echo Please close this window and double-click start_local.bat again to reload environment paths.
    pause
    exit /b 0
) else (
    echo ✅ Node.js is installed.
)

:: Check UV (Python manager)
where uv >nul 2>nul
if %errorlevel% neq 0 (
    echo ⚙️ uv not found. Installing uv via winget...
    winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements
    echo.
    echo [INFO] uv was successfully installed.
    echo Please close this window and double-click start_local.bat again to reload environment paths.
    pause
    exit /b 0
) else (
    echo ✅ uv Python manager is installed.
)

echo.
echo ⚙️ Installing Node.js dependencies for Bot Orchestrator...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install orchestrator dependencies.
    pause
    exit /b 1
)

echo.
echo ⚙️ Installing Node.js dependencies for Tally MCP Server...
cd tally-mcp-server
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Tally MCP dependencies.
    cd ..
    pause
    exit /b 1
)

echo ⚙️ Compiling Tally MCP Server...
call node node_modules\typescript\bin\tsc
if %errorlevel% neq 0 (
    echo [ERROR] Failed to compile Tally MCP server.
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo ⚙️ Synchronizing Python dependencies for WhatsApp MCP Server...
cd whatsapp-mcp\whatsapp-mcp-server
call uv sync
if %errorlevel% neq 0 (
    echo [ERROR] Failed to sync Python dependencies.
    cd ..\..
    pause
    exit /b 1
)
cd ..\..

echo.
echo ==========================================================
echo 🎉 SETUP COMPLETED SUCCESSFULLY!
echo ==========================================================
echo.
echo 📢 IMPORTANT REMINDERS:
echo 1. Make sure Tally Prime is running locally on port 9000.
echo 2. Open the desired company in Tally Prime.
echo 3. The WhatsApp Bridge will open in a separate window.
echo    Scan the QR code if pairing for the first time.
echo.
pause

echo.
echo 🚀 Launching Go WhatsApp Bridge in a new window...
start "WhatsApp Bridge" cmd /k "cd whatsapp-mcp\whatsapp-bridge && .\whatsapp-bridge.exe"

echo 🚀 Launching Tally AI Bot Orchestrator...
call npm start

pause
