@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  正在启动 Pingu 的小世界...
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py --open
) else (
  python serve.py --open
)
echo.
pause
