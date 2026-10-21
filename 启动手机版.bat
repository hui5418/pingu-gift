@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  正在启动 Pingu 的小世界（HTTPS，手机可用摄像头/隔空手势）...
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py --https --open
) else (
  python serve.py --https --open
)
echo.
pause
