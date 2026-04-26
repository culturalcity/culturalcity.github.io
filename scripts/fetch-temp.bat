@echo off
chcp 65001 >nul
cd /d "%~dp0..\"
node scripts\fetch-temp.js
