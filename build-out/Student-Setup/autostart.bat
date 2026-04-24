@echo off
:LOOP
cd /d "C:\PCAgent"
set SERVER_URL=http://192.168.0.5:3001
"C:\PCAgent\node.exe" agent.js
timeout /t 5 /nobreak >NUL
goto LOOP
