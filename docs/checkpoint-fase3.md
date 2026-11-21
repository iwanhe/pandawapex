# Checkpoint 3: Dynamic Actions

2026-11-21 · Iwan Herdian

Checkpoint ketiga, setelah [checkpoint 2](checkpoint-fase2.md). Halaman sekarang bisa bereaksi **di browser tanpa
dikirim**: menyembunyikan dan menampilkan field, mengisi nilai, memuat ulang region, menanyakan konfirmasi, menampilkan
pesan, memindahkan kursor, dan menjalankan PL/pgSQL di server lalu menampilkan hasilnya. Semuanya bisa dibuat lewat
formulir di Page Designer. Referensi lengkapnya ada di
**[panduan-pengguna.md → Dynamic actions](panduan-pengguna.md#dynamic-actions-aksi-di-browser)**.

| Ukuran | Checkpoint 2 (2026-11-15) | Checkpoint 3 (2026-11-21) |
| --- | --- | --- |
| Repo | PR #9–#16 (main `2aacb1b`) | + PR #11, #17–#26 |
| Tes integrasi (`npm test`) | 144 lulus | **220 lulus**, 0 gagal |
| Tes browser (Playwright, 1440 + 390 px) | 90 lulus, 2 dilewati | **132 lulus**, 2 sengaja dilewati, axe WCAG 2.2 AA bersih |
| Feature parity | 68.1 / 100 | **71.0 / 100** |
| Must-have | 29 dari 30 | **29 dari 30** (sisa: Interactive Grid) |
| Cakupan komponen APEX nyata (sensus 35 aplikasi contoh) | 78.2% | **82.1%** (dynamic action dari 0% ke 46.1%) |
| Migrasi database terakhir | `0006` | **`0007_da_focus_alert.sql`** |

## Yang ada di checkpoint ini

| PR | Isi |
| --- | --- |
| #17 | Dokumen checkpoint 2 dan panduan penggunaan |
| #18 | Uji menyeluruh builder: 17 kasus tepi. Diperbaiki BUG-009 (dua penyimpanan bersamaan) dan BUG-010 (login setelah sesi developer habis kembali ke halaman yang diedit) |
| #11, #19 | Demo publik lewat Cloudflare Tunnel; semua dokumentasi ditulis ulang langkah demi langkah |
| #20, #21 | Operasional: `rpx backup` / `rpx restore`, `backup-lokal.cmd`, pembersihan session otomatis |
| #22 | **DA tahap 1**: tampil/sembunyi, enable/disable, isi dan kosongkan nilai, refresh region, konfirmasi, submit; event item berubah, mengetik, tombol diklik, halaman dibuka |
| #23 | **DA tahap 2**: `execute_server_code` (PL/pgSQL di server dengan *items to submit/return*), refresh region dengan nilai item terbaru |
| #24 | **DA tahap 3**: dynamic action di pohon Page Designer, diubah lewat formulir (atau YAML) |
| #25 | **DA tahap 4**: aksi `alert` dan `focus`. Butuh migrasi `0007` |
| #26 | Uji menyeluruh dynamic action (dialog modal, tombol header, cascade, rantai `set_value`, sesi habis, impor ulang saat halaman terbuka, dua developer); bagian dynamic action di panduan disusun ulang jadi referensi lengkap dengan padanan istilah APEX; dokumen ini. Bug baru: tidak ada |

## Memperbarui dari checkpoint 2

Untuk laptop Windows (Cmder + PostgreSQL portable) yang sudah memakai checkpoint 2. Data dan aplikasi buatan sendiri
tetap ada.

1. **Buka Cmder dan masuk ke folder repo.**
   ```cmd
   cd /d D:\pandawapex
   ```
2. **Ambil versi terbaru dan pasang dependensinya.**
   ```cmd
   git checkout main
   git pull
   npm install
   ```
   Hasil `npm install`: `up to date` atau `added/changed ... packages`, tanpa `EBADENGINE`.
3. **Nyalakan PostgreSQL** (bila belum).
   ```cmd
   D:\Software\PGSQL\start-pg.bat
   ```
4. **Pasang migrasi database.** Langkah ini **wajib**: tanpa migrasi `0007`, menyimpan aksi *Tampilkan pesan* (`alert`)
   atau *Pindahkan kursor ke item* (`focus`) ditolak database.
   ```cmd
   set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"
   npm run rpx -- db migrate
   ```
   Hasil: `applied 0007_da_focus_alert.sql` (dan migrasi lain yang belum terpasang), atau `database is up to date` bila
   sudah pernah dijalankan.
5. **Pasang ulang aplikasi contoh emp** supaya contoh dynamic action-nya ikut (halaman 2 dan 4).
   ```cmd
   set "RPX_DEMO_PASSWORD=coba-lokal-123"
   npm run rpx -- demo setup
   ```
   Hasil: `demo ready: ...`. Perintah ini menimpa perubahan Anda pada **aplikasi contoh emp** saja; aplikasi buatan
   sendiri dan aplikasi DEMO tidak tersentuh. Ingin menyimpan perubahan Anda di emp? Ekspor dulu dari builder.
6. **Jalankan.**
   ```cmd
   start-lokal.cmd
   ```
   Hasil: `Server listening at http://127.0.0.1:8080`. Biarkan jendela ini terbuka.
7. **Muat ulang browser dengan Ctrl+F5** supaya `rpx.js` dan CSS terbaru dipakai, bukan versi lama dari cache.

Bila langkah 4 menampilkan `PostgreSQL tidak bisa dihubungi`, PostgreSQL belum menyala; ulangi langkah 3.

Instalasi dari nol tetap mengikuti langkah 1–8 di [checkpoint-fase1.md](checkpoint-fase1.md#instalasi-sekali-saja),
lalu langkah 4–6 di atas.

## Alamat dan akun

| Yang dibuka | Alamat | Login |
| --- | --- | --- |
| Builder | http://localhost:8080/builder | workspace `demo`, user `admin`, kata sandi `RPX_DEMO_PASSWORD` |
| Data Karyawan (contoh dynamic action) | http://localhost:8080/r/demo/emp | `admin` (grup SDM) |
| DEMO Permintaan Barang | http://localhost:8080/r/pandawa/demo | lihat checkpoint 1 |

## Checklist checkpoint 3

Centang setelah dicoba di laptop. Sekitar 20 menit.

**Dynamic action di aplikasi (pengguna)**

- [ ] Data Karyawan → buka satu karyawan (halaman 2). Ubah *Status kerja* ke Magang: grup Keahlian hilang; ke Tetap: muncul lagi
- [ ] Buka karyawan yang sudah Magang: grup Keahlian langsung tersembunyi saat halaman terbuka
- [ ] Halaman Mutasi (4): pilih karyawan, isian *Posisi* langsung berisi jabatan dan departemen tanpa halaman berkedip
- [ ] Mutasi: isi beberapa field, klik **Kosongkan isian**, pilih **Batal**: tidak ada yang berubah
- [ ] Ulangi dan pilih **OK**: isian tujuan kosong, Status kembali Tetap, kursor di Departemen tujuan
- [ ] Ulangi dua langkah di atas hanya dengan keyboard (Tab, Spasi, Enter)
- [ ] Buka halaman Mutasi di DevTools mode ponsel (390 px): tombol dan konfirmasi tetap bisa dipakai

**Dynamic action di Page Designer (developer)**

- [ ] Builder → aplikasi emp → halaman 2: kelompok **Dynamic action** di pohon berisi `magang_tanpa_keahlian`; formulirnya sesuai contoh di panduan
- [ ] Buat aplikasi dari tabel (atau pakai aplikasi buatan sendiri), **Tambah dynamic action**: saat item A berubah dan kosong, sembunyikan item B; else tampilkan. **Simpan**, **Jalankan halaman**: perilakunya sesuai
- [ ] Tambah aksi *Tampilkan pesan* dan *Pindahkan kursor ke item*, simpan, coba lagi
- [ ] Isi item yang tidak ada lewat **Ubah sebagai YAML**: simpan ditolak dengan pesan yang menyebut aksinya
- [ ] Buka halaman yang sama di dua tab, simpan di tab pertama lalu di tab kedua: tab kedua mendapat pesan bentrok, isiannya tetap ada

**Server dan keamanan**

- [ ] Ubah kode `posisi_karyawan` (halaman 4) menjadi `begin raise exception 'Coba gagal.'; end;`, simpan, pilih karyawan: pesan **Aksi tidak berhasil.** dengan alasan *Coba gagal.*
- [ ] Kembalikan kodenya (atau jalankan ulang `demo setup`)
- [ ] Biarkan halaman Mutasi terbuka sampai sesi habis, lalu pilih karyawan: diarahkan ke login, lalu kembali ke halaman Mutasi

Daftar uji yang lebih rinci untuk tim ada di
[panduan-pengguna.md → Daftar uji dynamic action](panduan-pengguna.md#daftar-uji-dynamic-action-untuk-tim).

## Yang belum ada

| Belum | Sementara |
| --- | --- |
| Interactive Grid | form dialog per baris |
| Event dynamic action lain (*focus*, *lose focus*, *after refresh*, *custom*) | `change` atau tombol `defined_by_da` |
| *Execute JavaScript* | sengaja tidak didukung (Content Security Policy); pakai aksi bawaan atau `execute_server_code` |
| *Set Value* langsung dari SQL | `execute_server_code` + `items_to_return` |
| Region list, tab, dynamic content, cards | static/HTML region, Interactive Report |
| Drag-drop tata letak, developer toolbar (F10) | Lebar kolom + Naik/Turun; log server di jendela `start-lokal.cmd` |

## Tag checkpoint

Sesi Claude tidak bisa membuat tag di GitHub, jadi tag dibuat dari laptop **setelah PR #26 di-merge**:

```cmd
cd /d D:\pandawapex
git checkout main
git pull
git log -1 --oneline
git tag -a fase3-checkpoint -m "Checkpoint 3: Dynamic Actions (PR #22-#26)"
git push origin fase3-checkpoint
```

`git log -1` harus menampilkan commit merge PR #26. Untuk kembali melihat kode pada checkpoint ini nanti:
`git checkout fase3-checkpoint` (kembali ke versi terbaru dengan `git checkout main`).

## Langkah berikutnya

1. Catatan dari uji lokal Tim PANDAWA diperbaiki lebih dulu.
2. Region tambahan: list, tab, dynamic content, cards (±2 sesi).
3. Interactive Grid: menutup must-have terakhir dan flow F06 (±3 sesi).
4. Format angka/tanggal saat input, upload file (±1 sesi).
5. Developer toolbar dan debug (F10), saved report (±2 sesi).
