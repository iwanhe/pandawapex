# Panduan operasional

Panduan ini untuk orang yang menjaga pandawapex tetap berjalan: membuat backup, memulihkan dari backup, dan memahami apa
yang dikerjakan server secara otomatis. Semua langkah ditulis berurutan; kerjakan dari atas ke bawah.

| Hal | Siapa yang mengerjakan | Bagian |
| --- | --- | --- |
| **Backup database** | Anda (dijadwalkan sekali, lalu berjalan sendiri) | [1](#1-backup) |
| **Restore** dari backup | Anda, saat diperlukan | [2](#2-restore) |
| Menghapus session yang kedaluwarsa | server, otomatis tiap 15 menit | [3](#3-session) |
| Menjaga sesi tetap hidup selama pengguna bekerja | browser, otomatis | [3](#3-session) |
| Menyensor nilai di log akses | server, otomatis | [4](#4-log) |

Perintah di panduan ini ditulis untuk empat cara instalasi. Pakai kolom yang sesuai:

| Cara instalasi | Menjalankan perintah `rpx` | Membuka `psql` |
| --- | --- | --- |
| **Cmder** + PostgreSQL portable | `npm run rpx -- <perintah>` setelah `set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"` | `"D:\Software\PGSQL\bin\psql.exe" -h localhost -U postgres -d postgres` |
| **PowerShell** + PostgreSQL installer | `npm run rpx -- <perintah>` setelah `$env:DATABASE_URL = "postgres://postgres:<katasandi>@localhost:5432/rpx"` | `& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d postgres` |
| **Linux / macOS** | `npm run rpx -- <perintah>` setelah `export DATABASE_URL=...` (lihat [install-lokal.md](install-lokal.md)) | `psql postgres` |
| **Docker** | `docker compose run --rm rpx <perintah>` (tanpa `DATABASE_URL`) | `docker compose exec db psql -U postgres -d postgres` |

Semua perintah dijalankan dari folder repo.

---

## 1. Backup

### Isi backup

Satu backup terdiri dari **dua file yang selalu berpasangan**, bernama sama kecuali akhirannya:

| File | Isi |
| --- | --- |
| `rpx-<database>-<tanggal>-<jam>.dump` | seluruh database: definisi aplikasi, riwayat versi, akun, dan semua tabel aplikasi beserta datanya |
| `rpx-<database>-<tanggal>-<jam>.roles.sql` | role PostgreSQL yang dibutuhkan database itu (`ws_<workspace>`, `rpx_engine`, `rpx_user_code`) |

File kedua diperlukan karena di PostgreSQL role tersimpan di server, bukan di database. Tanpa file itu, backup yang
dipulihkan di server lain kehilangan semua hak akses workspace dan aplikasinya gagal dijalankan.

Yang **tidak** ikut: session yang sedang login (setelah restore semua pengguna login ulang), dan file konfigurasi
(`.env` pada Docker, `/etc/pandawapex.env` pada Ubuntu). Simpan file konfigurasi itu secara terpisah di tempat yang aman.

Backup berisi data aplikasi dan hash kata sandi. Perlakukan folder backup sebagai data rahasia.

### 1.1 Membuat backup sekali (untuk mencoba)

**Cmder + PostgreSQL portable**

```cmd
cd /d D:\pandawapex
backup-lokal.cmd
```

`backup-lokal.cmd` menyalakan PostgreSQL bila belum menyala, lalu menulis backup ke `D:\pandawapex\backups` dan menyimpan
14 backup terakhir. Letak PostgreSQL, folder tujuan, dan jumlah yang disimpan bisa diganti dengan `set` sebelum
menjalankannya: `PGHOME`, `RPX_BACKUP_DIR`, `RPX_BACKUP_KEEP`.

**PowerShell + PostgreSQL installer**

```powershell
cd C:\pandawapex
$env:DATABASE_URL = "postgres://postgres:<katasandi>@localhost:5432/rpx"
$env:PGHOME = "C:\Program Files\PostgreSQL\16"
npm run rpx -- backup --keep 14
```

**Linux / macOS**

```bash
cd pandawapex
export DATABASE_URL="postgres://$USER@/rpx?host=/var/run/postgresql"   # macOS: postgres://$USER@localhost/rpx
npm run rpx -- backup --keep 14
```

**Docker**

```bash
docker compose run --rm rpx backup --keep 14
```

Hasil yang harus terlihat (nama file mengikuti tanggal dan jam):

```
backup selesai: backups/rpx-rpx-20261115-170000.dump (0.2 MB)
role          : backups/rpx-rpx-20261115-170000.roles.sql
Kedua file itu satu pasang. Salin keduanya ke tempat lain selain komputer ini.
```

Kedua file ada di folder `backups` di dalam folder repo. Catatan:

- `--keep 14` menghapus backup yang lebih lama sehingga hanya 14 terakhir yang tersisa. Tanpa `--keep`, tidak ada yang dihapus.
- `--dir <folder>` menulis ke folder lain, mis. `--dir E:\backup-pandawapex`.
- Pada Docker, jam di nama file adalah UTC (WIB dikurangi 7 jam), dan file di folder `backups` dimiliki `root`.
- Aplikasi boleh tetap berjalan dan dipakai selama backup.

### 1.2 Menjadwalkan backup harian

**Windows (Task Scheduler)**. Di Cmder atau Command Prompt:

```cmd
schtasks /create /tn "pandawapex backup" /tr "D:\pandawapex\backup-lokal.cmd" /sc daily /st 17:00
```

Uji sekali, lalu periksa bahwa file baru muncul di `D:\pandawapex\backups`:

```cmd
schtasks /run /tn "pandawapex backup"
dir D:\pandawapex\backups
```

Tugas ini berjalan saat Anda sedang login dan komputer menyala pada jam itu. Pilih jam ketika laptop biasanya menyala.
Menghapus jadwal: `schtasks /delete /tn "pandawapex backup"`.

**Linux (cron)**. Jalankan `crontab -e`, lalu tambahkan satu baris (ganti folder dan `DATABASE_URL` sesuai instalasi):

```cron
0 2 * * * cd /opt/pandawapex && DATABASE_URL='postgres://postgres:<katasandi>@localhost/rpx' npm run -s rpx -- backup --dir /var/backups/pandawapex --keep 14 >> /var/log/pandawapex-backup.log 2>&1
```

**Docker di Linux (cron)**:

```cron
0 2 * * * cd /opt/pandawapex && docker compose run --rm -T rpx backup --keep 14 >> /var/log/pandawapex-backup.log 2>&1
```

### 1.3 Menyalin backup ke tempat lain

Backup di komputer yang sama tidak menolong bila disk komputer itu rusak. Salin folder `backups` secara berkala ke disk
lain, NAS, atau penyimpanan perusahaan. Selalu salin **kedua file** dari satu backup.

### 1.4 Menguji backup

Backup baru terbukti berguna setelah pernah dipulihkan. Sekali sebulan, kerjakan [2.1](#21-memulihkan-ke-database-baru)
dengan backup terbaru, periksa hasilnya, lalu hapus database uji itu:

```sql
drop database rpx_restore;
```

---

## 2. Restore

Restore **tidak pernah menimpa database yang sedang dipakai**. Backup selalu dipulihkan ke database baru (atau database
kosong). Setelah diperiksa, barulah database itu dipakai server ([2.2](#22-memakai-database-hasil-restore)).

### 2.1 Memulihkan ke database baru

Ganti `<file>` dengan nama file `.dump` yang ingin dipulihkan. File `.roles.sql` pasangannya harus ada di folder yang sama.

| Cara instalasi | Perintah |
| --- | --- |
| Cmder | `set "PGHOME=D:\Software\PGSQL"` lalu `npm run rpx -- restore backups\<file>.dump --to rpx_restore` |
| PowerShell | `npm run rpx -- restore backups\<file>.dump --to rpx_restore` (dengan `DATABASE_URL` dan `PGHOME` seperti di 1.1) |
| Linux / macOS | `npm run rpx -- restore backups/<file>.dump --to rpx_restore` |
| Docker | `docker compose run --rm rpx restore backups/<file>.dump --to rpx_restore` |

Hasil yang harus terlihat:

```
database rpx_restore dibuat
semua role sudah ada
data dipulihkan
restore selesai ke database "rpx_restore": 2 workspace, 2 aplikasi, 7 pengguna aplikasi, 2 developer.
Database "rpx_restore" belum dipakai server. Langkah berikutnya: docs/operasional.md, bagian "Memakai database hasil restore".
```

Arti tiap baris:

- `semua role sudah ada` muncul di server yang sama. Di server baru tertulis `role dibuat: ...`. Role yang sudah ada tidak
  pernah diubah, termasuk kata sandinya.
- `data dipulihkan`: seluruh isi backup masuk dalam satu transaksi. Bila ada yang gagal, tidak ada yang tersimpan dan
  perintah berhenti dengan pesan error.
- Bila backup berasal dari versi pandawapex yang lebih lama, migrasi yang lebih baru dipasang otomatis dan disebutkan.
- Angka di baris `restore selesai` adalah isi backup. Cocokkan dengan yang Anda harapkan.

Nama di `--to` harus database yang belum ada, atau database kosong. Bila database itu sudah berisi tabel, perintah menolak
dan tidak mengubah apa pun.

### 2.2 Memakai database hasil restore

Server membaca database bernama `rpx`. Cara paling sederhana adalah menukar nama: database lama menjadi `rpx_lama`,
database hasil restore menjadi `rpx`.

1. **Hentikan server pandawapex.**

   | Cara instalasi | Perintah |
   | --- | --- |
   | Cmder / PowerShell | tekan `Ctrl+C` di jendela `start-lokal.cmd` |
   | Linux dengan systemd | `sudo systemctl stop pandawapex` |
   | Docker | `docker compose stop app` |

2. **Buka psql** (kolom *Membuka psql* di tabel paling atas), lalu jalankan:

   ```sql
   alter database rpx rename to rpx_lama;
   alter database rpx_restore rename to rpx;
   ```

   Hasil: `ALTER DATABASE` dua kali. Keluar dengan `\q`.
   Pesan `database "rpx" is being accessed by other users` berarti server belum berhenti, atau masih ada psql / pgAdmin
   lain yang terhubung ke `rpx`. Tutup dulu, lalu ulangi.

3. **Jalankan server lagi** (`start-lokal.cmd`, `sudo systemctl start pandawapex`, atau `docker compose start app`).

4. **Periksa**: buka aplikasi, login (semua pengguna harus login ulang), lihat datanya.

5. Setelah yakin, **hapus database lama** dari psql: `drop database rpx_lama;`

### 2.3 Memulihkan di server baru

Dipakai saat pindah server atau komputer lama tidak bisa dipakai lagi.

**Tanpa Docker**

1. Pasang pandawapex sampai langkah membuat database `rpx`, **tanpa** `demo setup` dan `pilot setup`
   ([install-lokal.md](install-lokal.md) atau [checkpoint-fase1.md](checkpoint-fase1.md)).
2. Salin kedua file backup ke folder `backups` di folder repo.
3. Pulihkan langsung ke `rpx` (boleh, karena masih kosong):
   `npm run rpx -- restore backups/<file>.dump --to rpx`
4. Jalankan server seperti biasa.

**Docker**

1. Di server baru: `git clone`, salin file `.env` lama (atau buat baru dari `.env.example`), salin kedua file backup ke
   folder `backups`.
2. Nyalakan database saja:
   ```bash
   docker compose up -d db
   ```
3. Pulihkan ke `rpx`:
   ```bash
   docker compose run --rm rpx restore backups/<file>.dump --to rpx
   ```
   Hasil: `role dibuat: rpx_engine, rpx_user_code, ws_...`, lalu `restore selesai ...`.
4. Nyalakan semuanya:
   ```bash
   docker compose up -d --build
   ```
   Pada Docker, langkah ini juga memasang ulang dua aplikasi contoh (emp dan DEMO) dan mengatur ulang kata sandi akun
   contoh ke `RPX_DEMO_PASSWORD`. Aplikasi dan akun buatan sendiri tidak tersentuh.

Role yang dibuat ulang dari file `.roles.sql` hanya mendapat hak login (bila sebelumnya bisa login) dan kata sandinya.
Hak superuser tidak pernah ikut dipulihkan.

---

## 3. Session

**Pembersihan otomatis.** Session aplikasi dan sesi builder yang sudah kedaluwarsa (lewat batas waktu, atau terlalu lama
tidak dipakai) dihapus server tiap 15 menit, bersama isian yang tersimpan di session itu. Tidak ada yang perlu dijadwalkan.

| Keperluan | Cara |
| --- | --- |
| Mengubah selang waktu | variabel `RPX_PURGE_MINUTES` (menit; bawaan 15). Pada Docker: isi di `.env` |
| Mematikan pembersihan otomatis | `RPX_PURGE_MINUTES=0` |
| Menjalankan sekali dengan tangan | `npm run rpx -- session purge` (Docker: `docker compose run --rm rpx session purge`) |

Hasil perintah manual: `removed 3 application session(s) and 1 developer session(s)`. Di log server, pembersihan yang
menghapus sesuatu tercatat sebagai `expired sessions removed`.

**Sesi tetap hidup selama pengguna bekerja.** Batas "tidak dipakai" (bawaan 1 jam, untuk aplikasi maupun builder) dihitung
dari **aktivitas terakhir** di halaman: mengetik, mengeklik, atau mengisi form. Halaman mengirim tanda ke server paling
sering tiap 5 menit, hanya bila ada aktivitas. Akibatnya:

- pengguna yang lama mengisi satu form panjang tidak lagi kehilangan isiannya karena sesi habis;
- tab yang hanya terbuka tanpa disentuh tetap berakhir setelah batas waktu;
- batas total sejak login (bawaan 8 jam) tidak berubah.

---

## 4. Log

Server menulis satu baris log per permintaan ke jendela tempat server dijalankan
(Docker: `docker compose logs -f app`; systemd: `journalctl -u pandawapex -f`).

Alamat di log hanya memuat jalur dan **nama** argumen. Nilainya diganti `*`, sehingga nilai item, kata pencarian, dan
kode login SSO tidak pernah tersimpan di log:

```
"url":"/r/pandawa/demo/2?P2_ID=*&cs=*"
```

Isi form dan kata sandi tidak pernah ditulis ke log.

---

## Masalah yang sering muncul

| Gejala | Penyebab | Solusi |
| --- | --- | --- |
| `pg_dump tidak ditemukan` | folder PostgreSQL tidak dikenal | isi `PGHOME` dengan folder PostgreSQL, mis. `set "PGHOME=D:\Software\PGSQL"` |
| `pg_dump gagal: ... server version mismatch` | `pg_dump` lebih lama daripada server PostgreSQL | pakai `pg_dump` dari versi PostgreSQL yang sama dengan server (arahkan `PGHOME` ke sana) |
| `database "..." tidak berisi pandawapex` | `DATABASE_URL` menunjuk database yang salah | periksa nama database di akhir `DATABASE_URL` |
| `file role tidak ditemukan` | file `.roles.sql` tidak ikut disalin | taruh file `.roles.sql` pasangannya di folder yang sama dengan `.dump` |
| `database "..." sudah berisi tabel` | nama di `--to` sudah dipakai | pilih nama lain, mis. `--to rpx_restore2`, atau hapus database uji lama |
| `PostgreSQL tidak bisa dihubungi` | PostgreSQL belum menyala | nyalakan dulu (`start-pg.bat`, service PostgreSQL, atau `docker compose up -d db`) |
| Backup terjadwal Windows tidak muncul | laptop mati atau belum login pada jam itu | jalankan `schtasks /run /tn "pandawapex backup"`, atau pindahkan jam jadwal |
| Docker: tidak bisa menghapus file di `backups` | file dimiliki `root` | `sudo rm backups/<file>` |
