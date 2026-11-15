# Checkpoint 2: builder (Fase 2, B1–B5)

2026-11-15 · Iwan Herdian

Checkpoint kedua, setelah [checkpoint Fase 1](checkpoint-fase1.md). Builder sudah bisa dipakai dari awal sampai akhir:
login developer, kelola akun, buat aplikasi dari tabel, tambah halaman, ubah halaman di Page Designer, ekspor dan impor.
Cara pemakaian lengkap ada di **[panduan-pengguna.md](panduan-pengguna.md)**.

| Ukuran | Checkpoint 1 (2026-11-13) | Checkpoint 2 (2026-11-15) |
| --- | --- | --- |
| Repo | PR #1–#8 | PR #9–#16 di-merge (main `2aacb1b`) |
| Tes integrasi (`npm test`) | 93 lulus | **144 lulus**, 0 gagal |
| Tes browser (Playwright, 1440 + 390 px) | 72 lulus, 2 dilewati | **90 lulus**, 2 sengaja dilewati, axe WCAG 2.2 AA bersih |
| Feature parity | 53.6 / 100 | **68.1 / 100** |
| Must-have | 22 dari 30 | **29 dari 30** (sisa: Interactive Grid di wizard Create Page) |
| Flow recon yang teruji | F04, F05, F07, F08, F09 | + **F01** (8 aksi), **F02** (3 aksi), **F03** |

## Yang ada di checkpoint ini

| Milestone | PR | Isi |
| --- | --- | --- |
| B1 fondasi builder | #10 | login developer per workspace (`/builder`), beranda workspace, daftar aplikasi, buat aplikasi kosong, impor/ekspor spec YAML, riwayat versi, hapus aplikasi, `rpx app export`, `rpx dev add` |
| B2 akun | #12 | pengguna aplikasi (grup, atur ulang kata sandi, kunci, hapus), developer (khusus administrator), ganti kata sandi sendiri |
| B3 wizard Create App | #13 | aplikasi dari tabel: Interactive Report + form dialog per tabel, foreign key jadi daftar pilihan, alasan bila tabel hanya bisa report |
| B4 wizard Create Page | #14 | report + form, report dari tabel atau query SQL (dicoba dulu tanpa mengubah data), form, halaman kosong |
| B5 Page Designer | #15 | struktur halaman + editor properti dari JSON Schema spec, tambah/urutkan/hapus komponen, hapus halaman, properti aplikasi, deteksi konflik antar developer |
| Perbaikan | #16 | CLI menjelaskan error koneksi PostgreSQL (dulu hanya `error:` di Windows) |

## Memperbarui dari checkpoint 1

Untuk laptop Windows (Cmder + PostgreSQL portable) yang sudah terpasang, baik dari checkpoint 1 maupun dari versi yang lebih
baru. Data dan aplikasi buatan sendiri tetap ada.

1. **Buka Cmder dan masuk ke folder repo.**
   ```cmd
   cd /d D:\pandawapex
   ```
2. **Ambil versi terbaru dan pasang dependensinya.**
   ```cmd
   git pull
   npm install
   ```
   Hasil `npm install`: `up to date` atau `added/changed ... packages`, tanpa `EBADENGINE`.
3. **Nyalakan PostgreSQL** (bila belum).
   ```cmd
   D:\Software\PGSQL\start-pg.bat
   ```
4. **Pasang migrasi database.**
   ```cmd
   set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"
   npm run rpx -- db migrate
   ```
   Hasil: `applied 0006_builder.sql` (pertama kali dari checkpoint 1) atau `database is up to date`.
5. **Hanya bila memperbarui dari checkpoint 1:** pasang ulang aplikasi contoh supaya akun developer `admin` untuk builder
   dibuat.
   ```cmd
   set "RPX_DEMO_PASSWORD=coba-lokal-123"
   npm run rpx -- demo setup
   npm run rpx -- pilot setup
   ```
   Hasil: `demo ready: ...` dan `pilot ready: app ... (17 pages) ...`. Kedua perintah memasang ulang aplikasi contoh emp
   dan DEMO, jadi perubahan Anda pada **kedua aplikasi contoh itu** tertimpa; aplikasi buatan sendiri tidak tersentuh.
   Lewati langkah ini bila laptop sudah pernah memakai builder.
6. **Jalankan.**
   ```cmd
   start-lokal.cmd
   ```
   Hasil: `Server listening at http://127.0.0.1:8080`. Biarkan jendela ini terbuka.

PostgreSQL harus menyala **sebelum** langkah 4 dan 5; kalau belum, muncul `PostgreSQL tidak bisa dihubungi`
(versi lama: `error:` tanpa pesan).

Instalasi dari nol tetap mengikuti langkah 1–8 di [checkpoint-fase1.md](checkpoint-fase1.md#instalasi-sekali-saja).

## Alamat dan akun

| Yang dibuka | Alamat | Login |
| --- | --- | --- |
| Builder | http://localhost:8080/builder | workspace `pandawa` atau `demo`, user `admin`, kata sandi `RPX_DEMO_PASSWORD` |
| DEMO Permintaan Barang | http://localhost:8080/r/pandawa/demo | `admin`, `budi`, `sari`, `dodi`, `gudang` (lihat checkpoint 1) |
| Data Karyawan | http://localhost:8080/r/demo/emp | `admin` (grup SDM), `tamu` |

Akun developer (`/builder`) dan akun pengguna aplikasi terpisah, walaupun keduanya bernama `admin` di setup contoh.

## Checklist checkpoint 2

Centang setelah dicoba di laptop. Urutannya membentuk satu skenario sekitar 20 menit.

**Builder dasar**

- [ ] Login builder (`pandawa` / `admin`). Beranda menampilkan aplikasi DEMO dan jumlah halaman 17
- [ ] Salah kata sandi menampilkan satu pesan umum; **Keluar** kembali ke halaman login
- [ ] **Aplikasi**: cari "permintaan", aplikasi DEMO muncul; **Ekspor** mengunduh `demo.yaml`

**Akun**

- [ ] **Pengguna aplikasi → Tambah pengguna** untuk diri sendiri (kata sandi minimal 10 karakter)
- [ ] Kata sandi 5 karakter ditolak dengan pesan di bawah isian
- [ ] **Akun saya**: ganti kata sandi developer, keluar, login dengan kata sandi baru

**Buat aplikasi (F01)**

- [ ] **Buat aplikasi**: ketik nama, alias terisi sendiri; skema `apx_demo`; centang dua tabel; **Buat aplikasi**
- [ ] Beranda aplikasi menampilkan pesan "... dibuat: N halaman dari 2 tabel"
- [ ] **Jalankan**, login dengan akun dari bagian Akun: report tampil, foreign key tampil sebagai nama
- [ ] **Tambah** membuka form dialog; simpan satu baris; baris muncul di report
- [ ] Tabel berlabel **Report saja** menjelaskan alasannya

**Tambah halaman (F02)**

- [ ] Beranda aplikasi → **Tambah halaman → Report**, sumber **Query SQL**, tulis query yang salah ketik: pesan PostgreSQL tampil, halaman tidak dibuat
- [ ] Perbaiki query, **Tambah halaman**: halaman baru ada di daftar dan di menu aplikasi
- [ ] **Report + form** dari tabel lain: dua halaman baru (N dan N+1)

**Page Designer (F03)**

- [ ] Klik nama halaman form: pohon menampilkan region, item, tombol, proses, branch
- [ ] Pilih satu item, ubah **Label** dan **Bantuan**, **Simpan**, lalu **Jalankan halaman**: label baru tampil
- [ ] **Lebar kolom** diisi 20: ditolak dengan "Perubahan tidak dapat disimpan"
- [ ] **Tambah region** di halaman report, isi judul dan HTML, **Naik**: region tampil di atas report saat dijalankan
- [ ] Hapus item yang dipakai link report: ditolak dengan alasan
- [ ] Buka halaman yang sama di dua tab, simpan di tab pertama lalu di tab kedua: tab kedua ditolak dengan pesan
      "Aplikasi sudah diubah di tab lain atau oleh developer lain", dan isian tab kedua tetap ada

**Properti, riwayat, impor**

- [ ] **Properti aplikasi**: ubah nama aplikasi, simpan; nama baru tampil di header aplikasi
- [ ] **Riwayat impor** mencatat setiap perubahan dengan `dev:admin`; **Unduh** versi lama, lalu **Aplikasi → Impor** dengan **Ganti**: aplikasi kembali ke versi itu
- [ ] Hapus aplikasi buatan sendiri (ketik alias): aplikasi hilang dari daftar, tabel di `apx_demo` tetap

## Yang belum ada

| Belum | Sementara |
| --- | --- |
| Interactive Grid (edit banyak baris di tabel) | form dialog per baris |
| Dynamic Actions (tampil/sembunyi, set nilai, refresh tanpa submit) | kondisi di sisi server, cascading LOV |
| Drag-drop tata letak di Page Designer | **Lebar kolom** dan **Mulai baris baru** di editor properti, urutan lewat Naik/Turun |
| Form untuk tabel dengan primary key diisi manual | report saja; atau tambahkan identity/serial |
| Kunci halaman eksplisit antar developer | deteksi konflik saat simpan |
| Undo | unduh versi dari riwayat lalu impor dengan Ganti |
| Developer toolbar dan debug per halaman (F10) | log server di jendela `start-lokal.cmd` |
| Faceted search, cards, metric card, region di dalam region | Interactive Report dengan filter |

## Tag checkpoint

Tag `fase1-checkpoint`, `fase2-checkpoint`, dan `fase2-checkpoint-final` sudah ada di GitHub. Untuk kembali melihat kode
pada checkpoint ini: `git checkout fase2-checkpoint-final` (kembali ke versi terbaru dengan `git checkout main`).

Tag dibuat dari laptop karena sesi Claude tidak bisa membuat tag di GitHub:

```cmd
cd /d D:\pandawapex
git pull
git tag -a <nama-tag> -m "<keterangan>" <commit>
git push origin <nama-tag>
```

## Setelah checkpoint 2

| PR | Isi |
| --- | --- |
| #18 | Uji menyeluruh builder: 17 kasus tepi baru. Diperbaiki: dua penyimpanan bersamaan dari versi yang sama tidak lagi menghapus salah satu perubahan diam-diam (BUG-009); setelah sesi developer berakhir, login kembali ke halaman yang sedang diedit (BUG-010) |
| #11 | Demo publik lewat Cloudflare Tunnel untuk Docker, Ubuntu, dan Windows ([cloudflare-local-demo.md](cloudflare-local-demo.md)); pengaturan baru `RPX_BUILDER_HOSTS` dan `RPX_TRUST_PROXY`; engine bisa berjalan sebagai role `rpx_engine` |

Kondisi terbaru: `npm test` 160 lulus, tes browser 96 lulus (2 sengaja dilewati). Tidak ada perubahan database sejak
`0006_builder.sql`, jadi memperbarui cukup dengan `git pull` (lihat langkah di atas).

## Langkah berikutnya

1. Catatan dari uji lokal Tim PANDAWA diperbaiki lebih dulu.
2. Interactive Grid: menutup must-have terakhir dan flow F06.
3. Dynamic Actions.
4. Developer toolbar dan debug (F10).
