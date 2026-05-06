@echo off
REM Launches the arc-agi2-viewer Vite dev server and opens it in the default browser.
REM First run does an `npm install` automatically; subsequent runs skip that step.
REM Ctrl+C to stop the server.

cd /d "%~dp0"

if not exist "node_modules" (
    echo [START_VIEWER] node_modules not found. Running npm install...
    call npm install
    if errorlevel 1 (
        echo [START_VIEWER] npm install failed. See output above.
        pause
        exit /b 1
    )
)

echo [START_VIEWER] Opening browser at http://localhost:5173/
start "" "http://localhost:5173/"

echo [START_VIEWER] Starting Vite dev server (Ctrl+C to stop)...
call npm run dev
