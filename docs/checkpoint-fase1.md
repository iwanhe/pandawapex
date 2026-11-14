# Checkpoint Fase 1: instalasi lokal Windows tanpa Docker

2026-11-13 · Iwan Herdian

Fase 1 (runtime) selesai di `main` commit `cc279c6`. Dokumen ini adalah titik cek: kalau semua langkah di bawah berhasil
di laptop Windows tanpa Docker, kita lanjut ke Fase 2 (builder). Untuk Docker Compose atau PowerShell, lihat
[install-lokal.md](install-lokal.md).

| Ukuran | Nilai di checkpoint |
| --- | --- |
| Repo | PR #1 sampai #8 sudah di-merge |
| Tes integrasi (`npm test`) | 93 lulus, 0 gagal |
| Tes browser (Playwright, desktop + 390 px) | 72 lulus, 2 sengaja dilewati, axe WCAG 2.2 AA bersih |
| Feature parity | 53.6 / 100; must-have 22 dari 30 |
| Must-have runtime saja | 93.8 / 100 (8 must-have tersisa semuanya builder dan akun developer) |
| Cakupan komponen APEX nyata | 78.2% dari 17.369 komponen di 35 aplikasi contoh Oracle (`tools/apex_census.py`) |
| Pilot porting | Aplikasi DEMO Permintaan Barang, 17 halaman, approval 2 level ([PORTING.md](../examples/demo-permintaan/PORTING.md)) |

Yang dipasang: aplikasi contoh **Data Karyawan** (`/r/demo/emp`) dan pilot **DEMO Permintaan Barang** (`/r/pandawa/demo`),
keduanya dengan login akun lokal (tanpa SSO).

## Prasyarat

Semua perintah di dokumen ini untuk **Cmder (cmd.exe, prompt `λ`)**. Versi minimal penting: Node 20 gagal menjalankan file `.ts`.

| Komponen | Versi minimal | Cara cek | Cara pasang |
| --- | --- | --- | --- |
| Windows | 10 / 11 | | |
| Git | apa saja | `git --version` | sudah ikut Cmder versi lengkap, atau `winget install Git.Git` |
| Node.js | **22.18** (disarankan LTS terbaru) | `node -v` | `winget install OpenJS.NodeJS.LTS`, lalu buka ulang Cmder |
| PostgreSQL | 14 (diuji di 16) | `"D:\Software\PGSQL\bin\psql.exe" --version` | portable di `D:\Software\PGSQL`, dinyalakan dengan `start-pg.bat` |
| Port bebas | 5432 (PostgreSQL), 8080 (pandawapex) | | bila 8080 dipakai ORDS/Tomcat, pakai 8090 (lihat Troubleshooting) |

User PostgreSQL yang dipakai saat setup harus **superuser** (membuat role `ws_demo`, `ws_pandawa` dan skema).
User `postgres` dari `initdb` sudah superuser.

## Instalasi (sekali saja)

Delapan langkah, sekitar 10 menit. Setiap langkah ditutup dengan hasil yang harus terlihat.

1. **Cek Node.js.** Jalankan `node -v`. Harus `v22.18` atau lebih baru; kalau `v20.x`, jalankan
   `winget install OpenJS.NodeJS.LTS`, tutup semua tab Cmder, buka lagi, lalu cek ulang.
2. **Nyalakan PostgreSQL.**
   ```cmd
   D:\Software\PGSQL\start-pg.bat
   set PG=D:\Software\PGSQL\bin
   "%PG%\pg_isready.exe" -h localhost
   ```
   Hasil: `server started`, lalu `localhost:5432 - accepting connections`.
3. **Buat database `rpx`.**
   ```cmd
   "%PG%\psql.exe" -h localhost -U postgres -c "create database rpx"
   ```
   Hasil: `CREATE DATABASE`. Baris `set PG=...` berlaku per tab Cmder; tanpa itu muncul `The system cannot find the path specified`.
4. **Ambil kode.**
   ```cmd
   cd /d D:\
   git clone https://github.com/iwanhe/pandawapex.git
   cd /d D:\pandawapex
   ```
   Clone yang sudah ada: cukup `git pull` di `D:\pandawapex`.
5. **Pasang dependensi.**
   ```cmd
   npm install
   ```
   Hasil: `added ... packages`, `found 0 vulnerabilities`, **tanpa** peringatan `EBADENGINE`
   (kalau ada, Node masih terlalu lama: kembali ke langkah 1).
6. **Isi environment** (berlaku per tab Cmder).
   ```cmd
   set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"
   set "RPX_DEMO_PASSWORD=coba-lokal-123"
   ```
   PostgreSQL dengan kata sandi: `postgres://postgres:KATASANDI@localhost:5432/rpx`; karakter `@ # / %` di kata sandi
   ditulis `%40 %23 %2F %25`.
7. **Pasang aplikasi contoh Data Karyawan.**
   ```cmd
   npm run rpx -- demo setup
   ```
   Hasil: `applied 0001_schema.sql` sampai `applied 0005_items_lov.sql`, lalu `demo ready: ... Open /r/demo/emp`.
8. **Pasang pilot DEMO Permintaan Barang.**
   ```cmd
   npm run rpx -- pilot setup
   ```
   Hasil: `pilot ready: app ... (17 pages); users admin (ADMIN), budi (REQUESTER), sari (MANAGER), dodi (DIRECTOR),
   gudang (WAREHOUSE) ... Open /r/pandawa/demo`.

Langkah 7 dan 8 aman dijalankan ulang: data contoh tidak digandakan, dan baris `NOTICE: ... already exists, skipping` itu normal.

## Menjalankan (setiap kali dipakai)

Repo sudah berisi [`start-lokal.cmd`](../start-lokal.cmd). Dari Cmder:

```cmd
D:\pandawapex\start-lokal.cmd
```

Skrip itu menyalakan PostgreSQL bila belum (lewat `start-pg.bat`, yang menunggu satu tombol ditekan), membuat
`RPX_SECRET` acak, lalu menjalankan `npm start`. Nilai bawaannya bisa diganti dengan `set` sebelum memanggil skrip:

| Variabel | Bawaan | Kapan diganti |
| --- | --- | --- |
| `PGHOME` | `D:\Software\PGSQL` | PostgreSQL ada di folder lain |
| `DATABASE_URL` | `postgres://postgres@localhost:5432/rpx` | PostgreSQL memakai kata sandi atau user lain |
| `HOST` | `127.0.0.1` (hanya laptop ini) | `0.0.0.0` agar bisa dibuka dari jaringan |
| `PORT` | `8080` | port 8080 dipakai ORDS/Tomcat |

- Hasil: log `Server listening at http://127.0.0.1:8080`. Biarkan tab terbuka; `Ctrl+C` untuk berhenti.
- `RPX_SECRET` dibuat acak setiap start, jadi semua user login ulang setelah restart. Wajar untuk percobaan.

| Aplikasi | Alamat |
| --- | --- |
| DEMO Permintaan Barang | http://localhost:8080/r/pandawa/demo |
| Data Karyawan | http://localhost:8080/r/demo/emp |
| Builder (Fase 2) | http://localhost:8080/builder |

## Akun login

Semua akun memakai kata sandi `RPX_DEMO_PASSWORD` dari langkah 6 (contoh: `coba-lokal-123`). Ganti user lewat
**Keluar** di kanan atas; dua user bersamaan bisa memakai jendela incognito.

| Aplikasi | Username | Role | Yang bisa dilakukan |
| --- | --- | --- | --- |
| DEMO | `budi` | REQUESTER | buat permintaan, tambah baris, Submit for Approval |
| DEMO | `sari` | MANAGER | approve / reject level 1; juga bisa membuat permintaan |
| DEMO | `dodi` | DIRECTOR | approve level 2 (nilai di atas 10 juta) |
| DEMO | `gudang` | WAREHOUSE | kelola Departments dan Items |
| DEMO | `admin` | ADMIN | semua menu, termasuk Users & Roles dan Document Types |
| Data Karyawan | `admin` | grup SDM | ubah, tambah, hapus karyawan; Mutasi |
| Data Karyawan | `tamu` | tanpa grup | hanya melihat |

**Builder** (`/builder`) memakai akun developer, terpisah dari akun aplikasi di atas: workspace `pandawa` atau `demo`,
username `admin`, kata sandi yang sama. Developer lain: `npm run rpx -- dev add --ws pandawa --username nama --password "min10karakter"`
(menjalankan ulang perintah ini juga membuka akun yang terkunci setelah 5 kali salah sandi).

User baru: `npm run rpx -- user add --ws pandawa --username nama --password "min10karakter"`, lalu beri role di DEMO
lewat **Administration → Users & Roles** (login sebagai `admin`).

## Checklist sebelum Fase 2

Centang setiap butir setelah dicoba di laptop. Semua harus lolos sebelum builder dimulai.

**Instalasi**

- [ ] `node -v` minimal v22.18 dan `npm install` tanpa `EBADENGINE`
- [ ] `demo setup` dan `pilot setup` selesai dengan `demo ready` / `pilot ready`
- [ ] `start-lokal.cmd` menyalakan PostgreSQL dan server dalam satu langkah

**DEMO Permintaan Barang**

- [ ] `budi`: **Permintaan Barang → Create**, isi Department dan Keperluan, Create. Nomor `REQ-2026-000x` terbentuk, status DRAFT
- [ ] `budi`: Submit permintaan itu sebelum ada baris. Ditolak dengan "Permintaan belum memiliki baris item."
- [ ] `budi`: **Detail Permintaan**, pilih permintaan, **Tambah baris**, lalu **Edit → Submit for Approval**. Status SUBMITTED, field terkunci
- [ ] `sari` (incognito): **Approval Inbox**, buka dokumen, **Approve**. Di bawah 10 juta langsung APPROVED
- [ ] REQ-2026-0002 (25,3 juta): setelah `sari` approve, muncul langkah level 2; `sari` tidak punya tombol Approve di langkah itu; `dodi` approve, status APPROVED
- [ ] `sari` mengajukan permintaannya sendiri: di inbox "Bisa Saya Proses" = N, tidak ada tombol Approve/Reject (maker-checker)
- [ ] Reject tanpa catatan ditolak ("Alasan penolakan wajib diisi."); dengan catatan status REJECTED dan `budi` bisa mengubah lalu mengajukan lagi
- [ ] `gudang` tidak bisa membuka form permintaan; `budi` tidak melihat menu Administration
- [ ] Home menampilkan Ringkasan, chart Permintaan per Status dan Nilai per Department, dan "Tampilkan sebagai tabel" bekerja

**Data Karyawan**

- [ ] `admin`: cari karyawan, buka di dialog, ubah, Simpan; daftar ter-refresh di tempat
- [ ] Unduh CSV dan Excel dari daftar karyawan
- [ ] `tamu`: hanya bisa melihat, tidak ada tombol Tambah

## Troubleshooting

Dua baris pertama sudah terjadi saat instalasi checkpoint ini.

| Gejala | Penyebab | Solusi |
| --- | --- | --- |
| `Unknown file extension ".ts"` saat `npm run rpx` | Node.js di bawah 22.18 (tercatat: v20.20.2) | upgrade Node (langkah 1), buka ulang Cmder, `npm install` lagi |
| `The system cannot find the path specified` saat menjalankan `"%PG%\psql.exe"` | `set PG=...` belum dijalankan di tab ini | jalankan `set PG=D:\Software\PGSQL\bin`, atau tulis path lengkap |
| `role "postgres" does not exist` | PostgreSQL dibuat dengan user Windows sebagai superuser | pakai `-U %USERNAME%` dan nama itu di `DATABASE_URL` |
| `password authentication failed` | kata sandi di `DATABASE_URL` salah atau belum di-encode | perbaiki URL (langkah 6) |
| `ECONNREFUSED ... 5432` | PostgreSQL belum menyala atau port lain | `start-pg.bat`; cek port di file itu |
| `EADDRINUSE ... 8080` | port 8080 dipakai ORDS/Tomcat | `set "PORT=8090"` sebelum `start-lokal.cmd`, buka `localhost:8090` |
| `DATABASE_URL is not set` | tab Cmder baru, variabel hilang | ulangi langkah 6 (untuk setup), atau pakai `start-lokal.cmd` (untuk menjalankan) |
| Halaman 403 "akun Anda belum didaftarkan" di DEMO | user login belum punya role DEMO | `admin` menambahkan role di Users & Roles |

## Memperbarui, mengulang, dan Fase 2

**Memperbarui ke versi terbaru** (data tetap ada; migrasi baru dipasang otomatis):

```cmd
cd /d D:\pandawapex
git pull
npm install
set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"
set "RPX_DEMO_PASSWORD=coba-lokal-123"
npm run rpx -- demo setup
npm run rpx -- pilot setup
```

**Mengulang dari nol** (semua data contoh dan perubahan hilang):

```cmd
"D:\Software\PGSQL\bin\psql.exe" -h localhost -U postgres -c "drop database rpx with (force)"
```

Lalu ulangi dari langkah 3.

**Fase 2 (builder)** dimulai setelah checklist di atas lolos. Urutannya mengikuti 8 must-have yang tersisa dan celah dari pilot:

1. Login developer per workspace, dan kelola akun developer serta end user dari UI (akun pilot saat ini masih lewat CLI).
   **B1 selesai untuk login developer**; kelola akun dari UI masih menyusul.
2. Daftar aplikasi: buat, hapus, impor, ekspor spec. **Selesai di B1.**
3. Create App wizard dari tabel (Report + Form), target 8 klik atau kurang.
4. Create Page wizard (Blank, Form, Report, IR, Modal).
5. Page Designer: tree + property editor, termasuk application properties dan application items.
6. Celah dari pilot DEMO: faceted search, region di dalam region, metric card.
