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

Dari Cmder, di laptop yang sudah lolos checkpoint 1:

```cmd
cd /d D:\pandawapex
git pull
npm install
D:\Software\PGSQL\start-pg.bat
set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"
set "RPX_DEMO_PASSWORD=coba-lokal-123"
npm run rpx -- db migrate
npm run rpx -- demo setup
npm run rpx -- pilot setup
start-lokal.cmd
```

Hasil yang harus terlihat:

- `db migrate`: `applied 0006_builder.sql` (pertama kali) atau `database is up to date`.
- `demo setup`: `demo ready: ... Open /r/demo/emp`.
- `pilot setup`: `pilot ready: app ... (17 pages) ...`.
- `start-lokal.cmd`: `Server listening at http://127.0.0.1:8080`. Biarkan jendela ini terbuka.

PostgreSQL harus menyala **sebelum** `db migrate` dan `setup`; kalau belum, muncul `PostgreSQL tidak bisa dihubungi`
(versi lama: `error:` tanpa pesan). `demo setup` dan `pilot setup` memasang ulang aplikasi emp dan DEMO, jadi perubahan
pada kedua aplikasi itu tertimpa; aplikasi buatan sendiri tidak tersentuh.

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
- [ ] Buka halaman yang sama di dua tab, simpan di tab pertama lalu di tab kedua: tab kedua ditolak "Aplikasi sudah diubah developer lain"

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

Proxy sesi ini tidak bisa membuat tag di GitHub, jadi tag dibuat dari laptop (seperti `fase1-checkpoint`):

```cmd
cd /d D:\pandawapex
git pull
git tag -a fase2-checkpoint -m "Checkpoint 2: builder B1-B5" <commit merge PR dokumen ini>
git push origin fase2-checkpoint
```

Commit merge ditampilkan di halaman PR setelah di-merge, atau dengan `git log --oneline -1` setelah `git pull`.

## Langkah berikutnya

1. Catatan dari uji lokal Tim PANDAWA diperbaiki lebih dulu.
2. Uji penuh Fase 2 (`/replica-test`): semua flow builder dengan kasus tepi, dan bug dilaporkan di `replica/bugs.md`.
3. Interactive Grid: menutup must-have terakhir dan flow F06.
4. Dynamic Actions.
5. Developer toolbar dan debug (F10).
