@echo off
setlocal
cd /d "%~dp0"
echo Instalando dependencias do frontend...
call npm --prefix frontend install --registry=https://registry.npmjs.org
if errorlevel 1 goto erro
echo Compilando e atualizando a pasta docs...
call npm run build
if errorlevel 1 goto erro
echo.
echo Frontend atualizado com sucesso.
pause
exit /b 0
:erro
echo.
echo Falha ao atualizar o frontend. Verifique sua conexao com a internet e tente novamente.
pause
exit /b 1
