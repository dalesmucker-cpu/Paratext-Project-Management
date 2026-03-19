@echo off
setlocal

set "TARGET=%USERPROFILE%\.paratext-10-studio\installed-extensions\paratext-project-manager"

echo.
echo  Instalando: Paratext Project Manager
echo  Destino:    %TARGET%
echo.

:: Create target folder if it doesn't exist
if not exist "%TARGET%" (
    mkdir "%TARGET%"
    if errorlevel 1 (
        echo  ERROR: No se pudo crear la carpeta de destino.
        pause
        exit /b 1
    )
)

:: Copy all files from the folder where this .bat lives
xcopy /E /Y /I "%~dp0*" "%TARGET%\" >/dev/null
if errorlevel 1 (
    echo  ERROR: No se pudieron copiar los archivos.
    pause
    exit /b 1
)

echo  Instalacion completada.
echo.
echo  Reinicia Paratext 10 para cargar la extension.
echo.
pause
