@echo off
rem ---------------------------------------------------------------------------
rem Backup database pandawapex di Windows tanpa Docker (cmd / Cmder / Task Scheduler).
rem Lihat docs/operasional.md. Nilai bawaan di bawah bisa diganti dengan "set" sebelum menjalankan file ini.
rem ---------------------------------------------------------------------------
setlocal
if not defined PGHOME          set "PGHOME=D:\Software\PGSQL"
if not defined DATABASE_URL    set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"
if not defined RPX_BACKUP_DIR  set "RPX_BACKUP_DIR=%~dp0backups"
if not defined RPX_BACKUP_KEEP set "RPX_BACKUP_KEEP=14"

rem nyalakan PostgreSQL bila belum (PostgreSQL portable dengan start-pg.bat)
"%PGHOME%\bin\pg_isready.exe" -h localhost -q
if errorlevel 1 if exist "%PGHOME%\start-pg.bat" call "%PGHOME%\start-pg.bat"

cd /d "%~dp0"
call npm run -s rpx -- backup --dir "%RPX_BACKUP_DIR%" --keep %RPX_BACKUP_KEEP%
exit /b %errorlevel%
