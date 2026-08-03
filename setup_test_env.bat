@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo   PyPeek 
echo ============================================================
echo.
echo  PyPeek 
echo   * 6 
echo   * pip 
echo   *  Python  Python 
echo   *  venv
echo.
echo :  300-600 MB
echo :  3-8 
echo.

:: 
:: 1.  Python
:: 

echo [1/6]  Python ...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   []  Python
    echo    Python: https://www.python.org/downloads/
    echo    "Add Python to PATH"
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo    Python: !PY_VER!

::  Python
echo    Python ...
set PY_COUNT=0
for /f "delims=" %%p in ('where python 2^>nul') do set /a PY_COUNT+=1
if !PY_COUNT! geq 2 (
    echo   [OK]  !PY_COUNT!  Python →  + 
) else (
    echo   []  1  Python → / Python
    echo          : python.org  (3.123.11)
)

:: 
:: 2. 
:: 

echo.
echo [2/6] ...
cd /d "%~dp0"
if not exist "tests\setup_test_envs.py" (
    echo   []  tests\setup_test_envs.py
    echo    PyPeek 
    pause
    exit /b 1
)
echo   : %cd%

:: 
:: 3.  Python  Python 
:: 

echo.
echo [3/6]  Python ...
echo   : flask, requests, pandas, pillow, six, pyyaml, colorama
python -m pip install --quiet flask requests pandas pillow six pyyaml colorama 2>nul
if %errorlevel% equ 0 (
    echo   [OK]  Python 
) else (
    echo   [] …
)

:: 
:: 4.  6  venv
:: 

echo.
echo [4/6]  6 ...
echo   ()
echo.
python tests\setup_test_envs.py
if %errorlevel% neq 0 (
    echo   [] setup_test_envs.py  %errorlevel%
)

:: 
:: 5.  venv
:: 

echo.
echo [5/6]  venv...

::  venv
set EXTRA_VENV=%USERPROFILE%\pypeek_extra_test_env
if exist "!EXTRA_VENV!" rmdir /s /q "!EXTRA_VENV!" 2>nul
python -m venv "!EXTRA_VENV!" 2>nul
if exist "!EXTRA_VENV!\Scripts\python.exe" (
    "!EXTRA_VENV!\Scripts\python.exe" -m pip install --quiet requests 2>nul
    echo   [OK] !EXTRA_VENV! ( requests)
) else (
    echo   []  venv
)

::  D  D 
if exist "D:\" (
    set D_VENV=D:\pypeek_test_env
    if exist "!D_VENV!" rmdir /s /q "!D_VENV!" 2>nul
    python -m venv "!D_VENV!" 2>nul
    if exist "!D_VENV!\Scripts\python.exe" (
        "!D_VENV!\Scripts\python.exe" -m pip install --quiet click 2>nul
        echo   [OK] !D_VENV! (D click)
    ) else (
        echo   [] D venv 
    )
)

:: 
:: 6.  pip 
:: 

echo.
echo [6/6]  pip ...
python -m pip cache purge >nul 2>&1
python -m pip install --quiet flask click requests numpy 2>nul
python -m pip uninstall -y flask click requests numpy 2>nul
python -m pip cache info 2>nul | findstr /c:"cache"
echo   [OK] pip 

:: 
:: 
:: 

echo.
echo ============================================================
echo   
echo ============================================================
echo.
echo   Python : !PY_VER!
echo.
echo    venv :
echo     tests\_test_envs\bare_env            →  
echo     tests\_test_envs\safe_uninstall      →  
echo     tests\_test_envs\dep_chain           →  
echo     tests\_test_envs\big_env             → 
echo     tests\_test_envs\to_delete           →  
echo     tests\_test_envs\my_project\*        →  
echo     !EXTRA_VENV!                        → 
if exist "D:\pypeek_test_env" (
    echo     D:\pypeek_test_env                  → 
)
echo.
echo    Python : flask, requests, pandas, pillow, six...
echo.
echo   []
echo     1.  start.bat  python main.py  PyPeek
echo     2.  .claude\testing-guide.md 
echo     3.  tests\_test_envs\ 
echo.

:: 
echo   
echo   :
echo   
if !PY_COUNT! lss 2 (
    echo   [ ]  Python  → +
)
echo   [ ] () Microsoft Store  Python →  Store 
echo   [ ] ()  Miniconda →  Conda 
echo.

pause
