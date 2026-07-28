@echo off
title JFL Network Operations Dashboard & QBR Generator
echo =======================================================================
echo   JFL Executive Dashboard & Automated QBR Generator
echo   Proactive Data Systems - Network Analytics Platform
echo =======================================================================
echo.
echo Starting JFL Executive Dashboard & Operations Server...

cd /d "%~dp0"

:: Clear any stale process listening on port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Launching Backend Server on http://localhost:3000 ...
start "JFL Dashboard Backend" node backend/index.js
timeout /t 3 /nobreak >nul

echo Opening Web Browser at http://localhost:3000 ...
start http://localhost:3000

echo.
echo JFL Executive Dashboard is ready at http://localhost:3000!
echo Keep this window open while using the dashboard.
echo.
pause
