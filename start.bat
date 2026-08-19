@echo off
setlocal
set "ROOT=%~dp0"

echo Starting UniStream (backend + frontend)...

start "UniStream Backend" cmd /k "cd /d "%ROOT%backend" && call venv\Scripts\activate.bat && uvicorn main:app --reload --host 127.0.0.1 --port 8000"

start "UniStream Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

timeout /t 5 /nobreak >nul
start "" http://localhost:3000

endlocal
