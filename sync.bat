@echo off
chcp 65001 >nul
setlocal
title MtoPB version sync
cd /d "%~dp0"

tasklist /FI "IMAGENAME eq MtoPB.exe" 2>nul | find /I "MtoPB.exe" >nul
if not errorlevel 1 (
    echo.
    echo 请先关闭 MtoPB.exe，再运行版本同步。
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo 未找到 Node.js。请先安装 Node.js，或确保 node.exe 已加入 PATH。
    echo.
    pause
    exit /b 1
)

echo 正在从 config.yml 同步版本信息...
node "%~dp0resources\app\sync-version.mjs"
if errorlevel 1 (
    echo.
    echo 版本同步失败，请查看上方错误信息。
    echo.
    pause
    exit /b 1
)

echo.
echo 同步完成。
pause
endlocal
