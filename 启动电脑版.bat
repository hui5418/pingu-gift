@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  正在启动 Pingu 的小世界（电脑版）...
echo  会打开浏览器，地址是 http://127.0.0.1:8000/
echo  麦克风在这个地址下可用；关掉窗口即停止。
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py --http --open
) else (
  python serve.py --http --open
)
echo.
pause
