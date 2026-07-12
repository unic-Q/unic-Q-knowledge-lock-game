@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo Starting local editor server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
start "Knowledge Lock Editor Server" /min node game-server.mjs
timeout /t 1 /nobreak > nul
start "" http://127.0.0.1:8010/editor.html?fresh=%RANDOM%
