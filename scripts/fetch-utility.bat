@echo off
REM Daily utility fetch — invoked by Windows Task Scheduler at 06:30 Taipei.
REM Uses %%~dp0 to derive paths at runtime, avoiding hardcoded Chinese in source.
REM See raw/UTILITY-AUTOMATION-PLAN.md.

set "SCRIPT_DIR=%~dp0"
set "ROOT=%~dp0.."
set "LOG=%ROOT%\raw\fetch-utility.log"

if not exist "%ROOT%\raw" mkdir "%ROOT%\raw"

echo. >> "%LOG%"
echo ===== %date% %time% ===== >> "%LOG%"
node "%SCRIPT_DIR%fetch-utility.js" >> "%LOG%" 2>&1

exit /b %ERRORLEVEL%
