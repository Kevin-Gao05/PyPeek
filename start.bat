@echo off
chcp 65001 >nul
echo ================================
echo   PyPeek - Python 环境查看器
echo ================================
echo.

:: 检查 Python 是否安装
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python。
    echo https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/2] 正在安装依赖...
pip install -r requirements.txt -q

echo [2/2] 正在启动 PyPeek...
python main.py

pause
