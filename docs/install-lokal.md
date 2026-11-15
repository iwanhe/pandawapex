# Instalasi lokal

Panduan ini memasang pandawapex di komputer Anda untuk dicoba dan untuk development. Setelah selesai, Anda punya:

- **builder** di http://localhost:8080/builder, tempat membuat dan mengubah aplikasi;
- dua aplikasi contoh: **Data Karyawan** (`/r/demo/emp`) dan pilot **DEMO Permintaan Barang** (`/r/pandawa/demo`);
- akun contoh untuk login, tanpa SSO.

SSO **tidak diperlukan**. Aplikasi memakai akun lokal (kata sandi argon2id, dikunci setelah 5 kali salah, batas percobaan
per IP). SSO bisa ditambahkan belakangan (lihat [akhir dokumen](#menyalakan-sso-nanti)).

## Pilih cara

| Komputer Anda | Cara | Bagian |
| --- | --- | --- |
| Windows, Linux, atau macOS yang sudah ada Docker | Docker Compose. Paling sedikit langkah, PostgreSQL ikut di container | [A](#a-docker-compose) |
| Windows, PostgreSQL dari installer resmi (EDB), terminal PowerShell | langsung di Windows | [B](#b-windows-dengan-postgresql-installer-powershell) |
| Windows, **Cmder + PostgreSQL portable** (cara Tim PANDAWA) | langsung di Windows | [checkpoint-fase1.md](checkpoint-fase1.md) |
| Linux (Ubuntu) atau macOS tanpa Docker | langsung di OS | [C](#c-linux-atau-macos-tanpa-docker) |

Setelah salah satu cara selesai, lanjut ke [Setelah terpasang](#setelah-terpasang).

### Istilah yang dipakai

| Istilah | Arti |
| --- | --- |
| **folder repo** | folder hasil `git clone`, berisi `package.json`. Semua perintah `npm` dijalankan dari sini |
| **terminal** | jendela perintah: PowerShell atau Cmder di Windows, Terminal di Linux/macOS |
| `DATABASE_URL` | alamat database untuk perintah `npm run rpx`, bentuknya `postgres://USER:KATASANDI@HOST:PORT/rpx` |
| `RPX_DEMO_PASSWORD` | kata sandi yang Anda pilih untuk semua akun contoh, **minimal 10 karakter** |
| `RPX_SECRET` | kunci acak untuk mengamankan link dan form; minimal 32 karakter |

Variabel yang di-`set` / `export` di terminal hanya berlaku di jendela itu. Bila Anda membuka jendela baru, isi lagi.

---

## A. Docker Compose

**Butuh:** Docker Desktop (Windows/macOS; di Windows memakai WSL 2) atau Docker Engine + plugin Compose (Linux), dan Git.
Cek dengan `docker compose version` dan `git --version`.

1. **Ambil kode.**
   ```bash
   git clone https://github.com/iwanhe/pandawapex.git
   cd pandawapex
   ```
2. **Buat file `.env`** dari contoh.
   ```bash
   cp .env.example .env              # Windows PowerShell: Copy-Item .env.example .env
   ```
3. **Isi dua baris di `.env`** (buka dengan editor teks apa saja):
   ```
   RPX_SECRET=<64 karakter acak>
   RPX_DEMO_PASSWORD=<kata sandi akun contoh, minimal 10 karakter>
   ```
   Membuat 64 karakter acak: `openssl rand -hex 32` (Linux, macOS, atau Git Bash di Windows).
   Baris lain di `.env` boleh dibiarkan kosong.
4. **Jalankan.**
   ```bash
   docker compose up -d --build
   ```
   Pertama kali butuh beberapa menit (mengunduh image dan memasang dependensi).
5. **Cek hasilnya.**
   ```bash
   docker compose ps
   ```
   Yang diharapkan: `db` dan `app` berstatus *running* / *healthy*, `setup` berstatus *exited (0)*.
   `setup` menjalankan migrasi, membuat workspace `demo` dan `pandawa`, memasang kedua aplikasi contoh, lalu berhenti.
   Itu normal.

Lanjut ke [Setelah terpasang](#setelah-terpasang).

**Catatan Docker**
- PostgreSQL di container hanya bisa diakses dari komputer ini, di port `55432` (user `postgres`, kata sandi
  `POSTGRES_PASSWORD` dari `.env`, bawaan `postgres-lokal`). Port ini dipilih supaya tidak bentrok dengan PostgreSQL lain.
- Menjalankan perintah CLI (`npm run rpx -- ...`) di Docker: `docker compose run --rm rpx <perintah>`.
  Contoh: `docker compose run --rm rpx ws create latihan --schema latihan_app`.
- Membuka psql: `docker compose exec db psql -U postgres -d rpx`.
- Menghentikan: `docker compose stop`. Menyalakan lagi: `docker compose start`.

---

## B. Windows dengan PostgreSQL installer (PowerShell)

Semua perintah di bagian ini untuk **PowerShell**. Memakai Cmder dan PostgreSQL portable? Ikuti
[checkpoint-fase1.md](checkpoint-fase1.md).

1. **Pasang Node.js 22 LTS dan Git.**
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   ```
   Tutup PowerShell, buka lagi, lalu cek `node -v`. Hasilnya harus **v22.18 atau lebih baru**. Node 20 gagal dengan pesan
   `Unknown file extension ".ts"`.
2. **Pasang PostgreSQL 16** dari installer resmi (https://www.postgresql.org/download/windows/). Saat instalasi:
   catat **kata sandi user `postgres`**, biarkan port **5432**. PostgreSQL berjalan sebagai Windows service, jadi otomatis
   menyala setiap Windows dinyalakan.
3. **Buat database `rpx`.**
   ```powershell
   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "create database rpx"
   ```
   Masukkan kata sandi `postgres`. Hasil: `CREATE DATABASE`.
4. **Ambil kode dan pasang dependensi.**
   ```powershell
   cd C:\
   git clone https://github.com/iwanhe/pandawapex.git
   cd C:\pandawapex
   npm install
   ```
   Hasil: `added ... packages`, tanpa peringatan `EBADENGINE` (kalau ada, Node terlalu lama: ulangi langkah 1).
5. **Isi variabel dan pasang aplikasi contoh.** Ganti `<katasandi>` dengan kata sandi `postgres` dari langkah 2. Karakter
   `@ # / %` di kata sandi ditulis `%40 %23 %2F %25`.
   ```powershell
   $env:DATABASE_URL = "postgres://postgres:<katasandi>@localhost:5432/rpx"
   $env:RPX_DEMO_PASSWORD = "coba-lokal-123"
   npm run rpx -- demo setup
   npm run rpx -- pilot setup
   ```
   Hasil: baris `applied 0001_schema.sql` sampai `applied 0006_builder.sql`, lalu `demo ready: ...` dan
   `pilot ready: app ... (17 pages) ...`. Baris `NOTICE: ... already exists, skipping` itu normal.
6. **Jalankan.** Repo berisi `start-lokal.cmd`, yang membuat `RPX_SECRET` acak lalu menyalakan server. Beri tahu letak
   PostgreSQL Anda dulu:
   ```powershell
   $env:PGHOME = "C:\Program Files\PostgreSQL\16"
   .\start-lokal.cmd
   ```
   Hasil: `Server listening at http://127.0.0.1:8080`. **Biarkan jendela ini terbuka** selama pandawapex dipakai;
   `Ctrl+C` untuk berhenti.

Setiap kali ingin memakai lagi: buka PowerShell, `cd C:\pandawapex`, isi `$env:DATABASE_URL` dan `$env:PGHOME`
seperti di atas, lalu `.\start-lokal.cmd`.

Lanjut ke [Setelah terpasang](#setelah-terpasang).

---

## C. Linux atau macOS tanpa Docker

1. **Pasang Node.js 22, PostgreSQL, dan Git.**

   Ubuntu 24.04:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs postgresql git
   sudo -u postgres createuser --superuser "$USER"      # user PostgreSQL bernama sama dengan user Linux Anda
   ```
   macOS (Homebrew):
   ```bash
   brew install node postgresql@16 git
   brew services start postgresql@16
   echo 'export PATH="$(brew --prefix postgresql@16)/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc   # agar createdb/psql dikenal
   ```
   Cek `node -v` (harus v22.18 atau lebih baru).
2. **Buat database dan ambil kode.**
   ```bash
   createdb rpx
   git clone https://github.com/iwanhe/pandawapex.git
   cd pandawapex
   npm install
   ```
3. **Isi variabel dan pasang aplikasi contoh.**
   ```bash
   export DATABASE_URL="postgres://$USER@/rpx?host=/var/run/postgresql"   # Ubuntu (lewat socket, tanpa kata sandi)
   # macOS Homebrew: export DATABASE_URL="postgres://$USER@localhost/rpx"
   export RPX_DEMO_PASSWORD='coba-lokal-123'
   npm run rpx -- demo setup
   npm run rpx -- pilot setup
   ```
   Hasil: `applied 0001_schema.sql` sampai `applied 0006_builder.sql`, `demo ready: ...`, `pilot ready: ...`.
4. **Jalankan.**
   ```bash
   export RPX_SECRET=$(openssl rand -hex 32)
   npm start
   ```
   Hasil: `Server listening at http://0.0.0.0:8080`. Biarkan terminal terbuka; `Ctrl+C` untuk berhenti.
   Untuk development, `npm run dev` memulai ulang server otomatis setiap file berubah.

Lanjut ke [Setelah terpasang](#setelah-terpasang).

---

## Setelah terpasang

### Alamat dan akun

| Yang dibuka | Alamat | Login |
| --- | --- | --- |
| **Builder** (developer) | http://localhost:8080/builder | Workspace `pandawa` atau `demo`, nama pengguna `admin` |
| **DEMO Permintaan Barang** | http://localhost:8080/r/pandawa/demo | `admin`, `budi`, `sari`, `dodi`, `gudang` |
| **Data Karyawan** | http://localhost:8080/r/demo/emp | `admin` (grup SDM, bisa mengubah), `tamu` (hanya melihat) |

Semua akun memakai kata sandi `RPX_DEMO_PASSWORD`. Peran tiap akun DEMO dijelaskan di
[checkpoint-fase1.md](checkpoint-fase1.md#akun-login).

Akun **developer** (untuk builder) dan akun **pengguna aplikasi** (untuk `/r/...`) adalah dua akun berbeda, walaupun di data
contoh keduanya bernama `admin`.

### Coba dalam 5 menit

1. Buka http://localhost:8080/r/demo/emp, login sebagai `admin`. Klik nomor karyawan di kolom **No.**: form terbuka
   sebagai dialog. Ubah **Jabatan**, **Simpan**. Daftar ter-refresh dan pesan sukses muncul.
2. Buka http://localhost:8080/builder di tab lain. Isi Workspace `demo`, nama pengguna `admin`, kata sandi Anda, **Masuk**.
3. Klik **Aplikasi**, lalu aplikasi **Data Karyawan**. Di region **Halaman**, klik nama halaman 2: Page Designer terbuka.
4. Di pohon kiri, klik item `P2_NAMA`. Ubah **Label** menjadi `Nama sesuai KTP`, **Simpan**.
5. Kembali ke tab aplikasi, buka lagi form karyawan: labelnya sudah berubah.

Langkah berikutnya: [membuat aplikasi pertama dari tabel sendiri](panduan-pengguna.md#2-tutorial-aplikasi-pertama-dari-tabel-sendiri).

---

## Memperbarui ke versi terbaru

Data dan aplikasi buatan sendiri tetap ada; migrasi database yang baru dipasang otomatis.

**Docker**
```bash
git pull
docker compose up -d --build
```

**Cmder + PostgreSQL portable**: lihat [checkpoint-fase2.md](checkpoint-fase2.md#memperbarui-dari-checkpoint-1).

**PowerShell (bagian B)**
```powershell
cd C:\pandawapex
git pull
npm install
$env:DATABASE_URL = "postgres://postgres:<katasandi>@localhost:5432/rpx"
npm run rpx -- db migrate
```

**Linux / macOS (bagian C)**
```bash
cd pandawapex
git pull
npm install
export DATABASE_URL="postgres://$USER@/rpx?host=/var/run/postgresql"   # macOS: postgres://$USER@localhost/rpx
npm run rpx -- db migrate
```

Hasil `db migrate`: `database is up to date`, atau `applied 00xx_....sql` bila ada migrasi baru. Setelah itu jalankan
server seperti biasa.

`demo setup` dan `pilot setup` **tidak perlu** dijalankan ulang saat memperbarui. Kalau dijalankan, kedua aplikasi contoh
dipasang ulang dan perubahan Anda pada aplikasi contoh itu hilang. Docker menjalankannya otomatis setiap kali image dibangun
ulang (`up -d --build` setelah `git pull`), jadi ekspor dulu (**Ekspor YAML** di builder) bila Anda mengubah aplikasi contoh. Aplikasi buatan sendiri tidak tersentuh.

## Mengulang dari nol

Semua aplikasi, akun, dan data contoh hilang.

| Cara | Perintah |
| --- | --- |
| Docker | `docker compose down -v`, lalu `docker compose up -d --build` |
| PowerShell | `& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "drop database rpx with (force)"`, lalu ulangi dari langkah B3 |
| Linux / macOS | `dropdb --force rpx`, lalu ulangi dari langkah C2 |
| Cmder + portable | lihat [checkpoint-fase1.md](checkpoint-fase1.md#memperbarui-dan-mengulang) |

## Membuat aplikasi sendiri

Ikuti tutorial langkah demi langkah di [panduan-pengguna.md, bagian 2](panduan-pengguna.md#2-tutorial-aplikasi-pertama-dari-tabel-sendiri):
membuat workspace dan tabel, lalu membuat aplikasinya dari builder.

Lewat CLI dan file YAML, tanpa builder:

```bash
npm run rpx -- ws create gudang --schema gudang_app      # workspace + role ws_gudang + skema
# buat tabel di skema gudang_app (psql / pgAdmin / migrasi Anda)
npm run rpx -- app check apps/penerimaan.yaml           # periksa spec tanpa database
npm run rpx -- app import apps/penerimaan.yaml --ws gudang
npm run rpx -- user add --ws gudang --username sri --password "min-10-karakter" --group Gudang
```

Aplikasi terbuka di `http://localhost:8080/r/gudang/<alias-app>`. `examples/emp/app.yaml` bisa dijadikan titik awal.

## Masalah yang sering muncul

| Gejala | Penyebab | Solusi |
| --- | --- | --- |
| `Unknown file extension ".ts"` | Node.js di bawah 22.18 | pasang Node 22 LTS, buka terminal baru, `npm install` lagi |
| `PostgreSQL tidak bisa dihubungi` / `ECONNREFUSED ... 5432` | PostgreSQL belum menyala atau port lain | nyalakan PostgreSQL (Windows: service *postgresql-x64-16*; Linux: `sudo systemctl start postgresql`), cek port |
| `password authentication failed` | kata sandi di `DATABASE_URL` salah, atau karakter khusus belum di-encode | perbaiki `DATABASE_URL` |
| `database "rpx" does not exist` | langkah membuat database terlewat | jalankan langkah pembuatan database |
| `DATABASE_URL is not set` | jendela terminal baru | isi lagi `DATABASE_URL` |
| `RPX_DEMO_PASSWORD must be set` | variabel kosong atau kurang dari 10 karakter | isi minimal 10 karakter |
| `EADDRINUSE ... 8080` | port 8080 dipakai aplikasi lain (ORDS, Tomcat) | isi `PORT=8090` (PowerShell `$env:PORT = "8090"`, Docker `APP_PORT=8090` di `.env`), buka `localhost:8090` |
| Docker: `setup` *exited (1)* | lihat pesannya: `docker compose logs setup` | biasanya `RPX_DEMO_PASSWORD` di `.env` kosong atau terlalu pendek |
| Login builder ditolak padahal kata sandi benar | salah isi Workspace, atau akun terkunci setelah 5 kali salah | Workspace `pandawa` atau `demo`; buka kunci dengan `npm run rpx -- dev add --ws demo --username admin --password "<sandi>"` |

Tabel yang lebih lengkap untuk Windows + Cmder ada di [checkpoint-fase1.md](checkpoint-fase1.md#troubleshooting).

## Menyalakan SSO nanti

Tambahkan blok `authentication` di spec aplikasi (di builder: **Properti aplikasi → Autentikasi**), isi secret di variabel
lingkungan, lalu simpan atau impor ulang. Langkah konfigurasi Entra ID / Google Workspace ada di
[replica/backend.md](../replica/backend.md#konfigurasi-sso-di-spec). Untuk masa transisi, `allow_builtin: true` membuat akun
lokal tetap bisa masuk di samping tombol SSO.

## Backup

Sebelum pandawapex dipakai untuk data yang penting, jadwalkan backup harian dan coba restore sekali:
[operasional.md](operasional.md).

## Membuka ke internet

Engine di atas memakai superuser `postgres` supaya cepat, dan cocok untuk laptop sendiri. Untuk server bersama atau demo
publik, ikuti [cloudflare-local-demo.md](cloudflare-local-demo.md): engine memakai role `rpx_engine`, builder di hostname
terpisah yang dilindungi Cloudflare Access, tanpa membuka port di router.
