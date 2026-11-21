@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo [0/1] Closing RackCheck if it is running...
taskkill /F /IM RackCheck.exe > nul 2>&1
timeout /t 2 /nobreak > nul
echo [1/1] Building RackCheck.exe...
python -m pip install -q -r requirements.txt pyinstaller || goto :fail
python -m PyInstaller --noconfirm RackCheck.spec || goto :fail
echo.
echo Done. dist\RackCheck.exe
pause
exit /b 0
:fail
echo.
echo Build failed. Check the messages above.
pause
exit /b 1
