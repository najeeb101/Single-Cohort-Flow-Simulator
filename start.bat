@echo off
REM CS Intake Planner: one double-click starts the backend and the website, then opens the
REM planner in the browser. Close the two windows it opens to stop it.
setlocal
cd /d "%~dp0"

REM --- Python backend -------------------------------------------------------------------
set "PY=.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo First run: creating the Python environment. This takes a few minutes, once.
  py -m venv .venv || python -m venv .venv
  if not exist "%PY%" (
    echo Could not create the Python environment. Install Python 3.12 or newer from python.org and try again.
    pause
    exit /b 1
  )
  "%PY%" -m pip install -r requirements.txt
)

REM --- Website dependencies ------------------------------------------------------------
if not exist "web\node_modules" (
  echo First run: installing the website's packages. This takes a few minutes, once.
  pushd web
  call npm install
  popd
  if not exist "web\node_modules" (
    echo Could not install the website. Install Node.js 20 or newer from nodejs.org and try again.
    pause
    exit /b 1
  )
)

echo Starting the planner...
start "CS Intake Planner - backend" cmd /k ""%PY%" -m uvicorn src.api:app --port 8001"
start "CS Intake Planner - website" cmd /k "cd /d web && npm run dev"

REM Give both a moment to come up. Must be localhost, not 127.0.0.1 (see CLAUDE.md).
timeout /t 8 /nobreak >nul
start "" "http://localhost:3000"
endlocal
