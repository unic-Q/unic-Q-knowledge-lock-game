@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo Starting local game server...
start "Knowledge Lock Server" /min node game-server.mjs
timeout /t 1 /nobreak > nul
start "" http://127.0.0.1:8010/index.html?fresh=%RANDOM%
