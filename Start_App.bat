@echo off
title JFL Network Operations Dashboard & QBR Generator
echo =======================================================================
echo   JFL Executive Dashboard & Automated QBR Generator
echo   Proactive Data Systems - Network Analytics Platform
echo =======================================================================
echo.
echo Starting server...

cd /d "%~dp0"

netstat -o -n -a | findstr ":3000 " >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Server is already running on http://localhost:3000
) else (
    echo Launching Node.js backend on http://localhost:3000...
    start /min "JFL Dashboard Backend" node backend/index.js
    timeout /t 2 /nobreak >nul
)

echo Opening Web Browser at http://localhost:3000 ...
start http://localhost:3000

echo.
echo JFL Executive Dashboard is ready!
echo Keep this window open or minimized while using the dashboard.
echo.
pause
