@echo off
setlocal

set "OIS_AGENT_DIR=%~dp0"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NODE_USE_SYSTEM_CA=1"

cd /d "%OIS_AGENT_DIR%"

"%NODE_EXE%" --use-system-ca "%OIS_AGENT_DIR%ois-login.js" >> "%OIS_AGENT_DIR%ois-agent.log" 2>&1

endlocal