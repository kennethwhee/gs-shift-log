@echo off

cd /d "%~dp0"

set NODE_USE_SYSTEM_CA=1

node ".\ois-login.js" >> ".\ois-agent.log" 2>&1