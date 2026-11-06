@echo off
title Visor DCS-5030L
cd /d "%~dp0"
node servidor-camara.js --open %*
pause
