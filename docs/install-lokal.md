# Instalasi lokal (tanpa SSO)

SSO **tidak diperlukan**. Secara default aplikasi memakai akun lokal (`authentication: builtin_accounts`), dengan kata sandi
argon2id, penguncian setelah 5 kali gagal, dan batas percobaan per IP. SSO baru aktif bila sebuah spec menulis
`authentication: { scheme: oidc, ... }`. Jadi aplikasi bisa dipasang dan dicoba dulu, lalu SSO ditambahkan belakangan
tanpa mengubah aplikasinya selain blok `authentication`.

Ada dua cara. Pilih salah satu.

## A. Docker Compose (paling cepat)

Butuh Docker Desktop (Windows/macOS) atau Docker Engine (Linux).

```bash
git clone https://github.com/iwanhe/pandawapex.git
cd pandawapex
cp .env.example .env           # Windows PowerShell: Copy-Item .env.example .env
```

Isi minimal dua baris di `.env`:

```
RPX_SECRET=<64 karakter acak, mis. hasil: openssl rand -hex 32>
RPX_DEMO_PASSWORD=<kata sandi user demo, minimal 10 karakter>
```

```bash
docker compose up -d --build
```

Buka **http://localhost:8080/r/demo/emp**, lalu masuk sebagai `admin` dengan kata sandi `RPX_DEMO_PASSWORD`.

- PostgreSQL ikut berjalan di container, dan hanya bisa diakses dari komputer ini di port `55432`
  (user `postgres`, kata sandi `POSTGRES_PASSWORD`, default `postgres-lokal`). Port ini tidak bentrok dengan PostgreSQL lain.
- Service `setup` menjalankan `rpx demo setup` sekali: migrasi, workspace `demo`, data contoh, aplikasi `emp`, dan user.
  Aman dijalankan ulang (`docker compose run --rm setup`).
- Hapus semuanya beserta datanya: `docker compose down -v`.

## B. Tanpa Docker (Windows, langsung)

1. Pasang **PostgreSQL 16** (installer EDB, catat kata sandi `postgres`) dan **Node.js 22 LTS** (≥ 22.18).
2. Buat database kosong, misalnya lewat pgAdmin atau:
   ```powershell
   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "create database rpx"
   ```
3. Di folder repo:
   ```powershell
   npm install
   $env:DATABASE_URL = "postgres://postgres:<katasandi>@localhost:5432/rpx"
   $env:RPX_DEMO_PASSWORD = "<minimal 10 karakter>"
   npm run rpx -- demo setup

   # kunci acak untuk percobaan lokal; untuk server pakai generator kriptografis (openssl rand -hex 32)
   $env:RPX_SECRET = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
   npm start
   ```
4. Buka **http://localhost:8080/r/demo/emp** (user `admin`).

Catatan: role `postgres` dipakai di sini supaya cepat. Untuk server bersama atau produksi, jalankan engine dengan role
`rpx_engine` (lihat README).

## Menambah aplikasi sendiri

```powershell
npm run rpx -- ws create gudang --schema gudang_app      # workspace + role ws_gudang + schema
# buat tabel di schema gudang_app (psql / pgAdmin / migrasi Anda)
npm run rpx -- app check apps\penerimaan.yaml           # validasi tanpa database
npm run rpx -- app import apps\penerimaan.yaml --ws gudang
npm run rpx -- user add --ws gudang --username sri --password "<kata sandi>" --group Gudang
```

Aplikasi terbuka di `http://localhost:8080/r/gudang/<alias-app>`. `examples/emp/app.yaml` bisa dijadikan titik awal.

## Menyalakan SSO nanti

Tambahkan blok `authentication` di spec, isi secret di env, import ulang. Langkah konfigurasi Entra ID / Google Workspace
ada di [replica/backend.md](../replica/backend.md). Untuk masa transisi, `allow_builtin: true` membuat akun lokal tetap
bisa masuk di samping tombol SSO.
