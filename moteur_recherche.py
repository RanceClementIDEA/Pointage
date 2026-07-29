@echo off
REM ============================================================
REM  Suivi de prix PC - Lanceur Windows
REM  Double-cliquez sur ce fichier pour ouvrir le menu.
REM ============================================================

cd /d "%~dp0"
title Suivi de prix PC

REM Cherche Python dans l'ordre le plus probable
where py >nul 2>&1
if %errorlevel%==0 (
    py demarrer.py
    goto :fin
)

where python >nul 2>&1
if %errorlevel%==0 (
    python demarrer.py
    goto :fin
)

where python3 >nul 2>&1
if %errorlevel%==0 (
    python3 demarrer.py
    goto :fin
)

echo.
echo   ============================================================
echo    Python n'est pas installe (ou pas trouve).
echo   ============================================================
echo.
echo    1. Telechargez Python sur : https://www.python.org/downloads/
echo    2. IMPORTANT : cochez "Add Python to PATH" pendant l'installation
echo    3. Relancez ce fichier
echo.
pause
exit /b 1

:fin
echo.
pause
