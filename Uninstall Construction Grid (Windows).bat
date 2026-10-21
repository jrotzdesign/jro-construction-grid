@echo off
REM Removes the Construction Grid panel. Leaves PlayerDebugMode alone.
if exist "%APPDATA%\Adobe\CEP\extensions\com.jro.constructiongrid" rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\com.jro.constructiongrid"
echo Construction Grid removed. Restart Illustrator.
pause
