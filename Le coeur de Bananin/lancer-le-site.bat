@echo off
REM Lance un serveur local et ouvre le site dans le navigateur.
REM Necessaire car le navigateur bloque les modules JavaScript (three.js, etc.)
REM quand le site est ouvert directement en double-cliquant sur index.html.
cd /d "%~dp0"
start "" http://localhost:8080
npx http-server -p 8080 -c-1
