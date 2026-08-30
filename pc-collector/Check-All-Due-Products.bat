@echo off
setlocal
cd /d "%~dp0"
call npm run check-all
echo.
pause
