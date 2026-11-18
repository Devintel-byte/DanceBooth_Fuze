@echo off
rem Moves old builds, dev caches and retired Maltina files to the Recycle Bin.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0clean-old-builds.ps1"
pause
