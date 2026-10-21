@echo off
REM Construction Grid - Windows installer for Illustrator 2026
setlocal
set EXT_ID=com.jro.constructiongrid
set DEST=%APPDATA%\Adobe\CEP\extensions
echo.
echo   Construction Grid - installer
echo.
if not exist "%DEST%" mkdir "%DEST%"
if exist "%DEST%\%EXT_ID%" rmdir /s /q "%DEST%\%EXT_ID%"
mkdir "%DEST%\%EXT_ID%"
for %%d in (CSXS css fonts js jsx) do xcopy /e /i /y "%~dp0%%d" "%DEST%\%EXT_ID%\%%d" >nul
copy /y "%~dp0index.html" "%DEST%\%EXT_ID%\" >nul
copy /y "%~dp0.debug" "%DEST%\%EXT_ID%\" >nul
echo   Panel installed to %DEST%\%EXT_ID%
for %%v in (9 10 11 12 13 14) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo   PlayerDebugMode enabled
echo.
echo   Restart Illustrator, then Window ^> Extensions ^> Construction Grid.
pause
