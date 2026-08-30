@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current Node.js LTS release, then run this setup again.
  pause
  exit /b 1
)

echo Installing the PriceTrack PH PC Collector...
call npm install
if errorlevel 1 goto :failed

call npx playwright install chromium
if errorlevel 1 goto :failed

if not exist ".env.local" (
  copy ".env.example" ".env.local" >nul
  echo.
  echo Notepad will open. Replace paste_your_existing_admin_token_here with your existing PriceTrack PH admin token, then save and close Notepad.
  start /wait notepad ".env.local"
)

echo.
echo Setup complete. Run Test-5-Products.bat first.
pause
exit /b 0

:failed
echo.
echo Setup did not finish. Check the error above, then run this file again.
pause
exit /b 1
