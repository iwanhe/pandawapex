@echo off
rem ---------------------------------------------------------------------------
rem pandawapex lokal di Windows tanpa Docker (cmd / Cmder). Lihat docs/checkpoint-fase1.md.
rem Nilai bawaan di bawah bisa diganti dengan "set" sebelum menjalankan file ini.
rem ---------------------------------------------------------------------------
setlocal
if not defined PGHOME       set "PGHOME=D:\Software\PGSQL"
if not defined DATABASE_URL set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"
if not defined HOST         set "HOST=127.0.0.1"
if not defined PORT         set "PORT=8080"

rem nyalakan PostgreSQL bila belum (PostgreSQL portable dengan start-pg.bat)
"%PGHOME%\bin\pg_isready.exe" -h localhost -q
if errorlevel 1 if exist "%PGHOME%\start-pg.bat" call "%PGHOME%\start-pg.bat"

rem kunci HMAC acak per start: setelah restart semua user login ulang
for /f %%i in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set "RPX_SECRET=%%i"

cd /d "%~dp0"
echo pandawapex: http://localhost:%PORT%/r/pandawa/demo  dan  http://localhost:%PORT%/r/demo/emp
npm start
