# Bugs

Hanya yang sudah direproduksi. Run: 2026-11-13, Chrome (system) 1440px & 390px, PostgreSQL 16. Run kedua (sebelum pilot, M0–M4 + M3): build `59f38fe`. Run ketiga (uji menyeluruh Fase 2, builder B1–B5): build `e2cce86`, 2026-11-15.

| ID | severity | judul | status |
| --- | --- | --- | --- |
| BUG-001 | S3 | `max_length` item hanya ditegakkan browser | fixed in `f9490fc` |
| BUG-002 | S3 | Link navigasi mobile yang tertutup masih bisa dicapai dengan Tab | fixed in `f9490fc` |
| BUG-003 | S4 | Link di ringkasan error < 24px (WCAG 2.5.8 target size) | fixed in `f9490fc` |
| BUG-004 | S3 | Form yang sama bisa diproses dua kali (double POST / kirim ulang) | fixed in `f9490fc` |
| BUG-006 | S1 | Nilai radio / checkbox group di luar daftar hilang diam-diam saat simpan | fixed in `f67722d` |
| BUG-007 | S3 | Popup LOV / cascade setelah session habis hanya bilang "coba lagi" | fixed in `f67722d` |
| BUG-005 | S3 | Kotak popup LOV tampak nonaktif (kontras border 1.3:1) | fixed in `f67722d` |
| BUG-008 | S4 | Sorotan hasil pencarian LOV bergeser untuk huruf seperti "İ" | fixed in `f67722d` |
| BUG-009 | S2 | Builder: dua penyimpanan dari versi yang sama sama-sama "berhasil", satu perubahan hilang diam-diam | fixed in `03e4211` |
| BUG-010 | S3 | Builder: form dikirim setelah sesi developer berakhir, setelah login dibawa ke beranda, bukan ke halaman tadi | fixed in `03e4211` |

Tidak ada S1/S2 yang terbuka.

---

### BUG-001: `max_length` item hanya ditegakkan browser

- Severity: S3
- Flow / case: F04 / F04-E3
- Screen: S23
- Build: `452e54d`  Browser / device: Chrome, 1440px & 390px

Steps
1. Login, klik "Tambah karyawan".
2. Hapus atribut `maxlength` dari "Nama lengkap" (atau kirim POST langsung) dan isi 500 karakter.
3. Isi field wajib lain, klik Simpan.

Expected: ditolak dengan pesan "Nama lengkap maksimal 120 karakter."
Actual: tersimpan 500 karakter (kolom `text` tidak membatasi).
Evidence: `e2e/f04-core.spec.ts` F04-E3 (gagal sebelum fix), `test/flow.test.ts` "BUG-001".
Suspected cause: `max_length` hanya dirender sebagai atribut HTML; `validate()` tidak memeriksanya.
Status: fixed in `f9490fc`. Server kini menghitung **karakter** (code point). Atribut `maxlength` browser menghitung unit UTF-16, sehingga emoji dihitung 2 di browser dan 1 di server; server lebih longgar, tidak pernah lebih ketat.

### BUG-002: Link navigasi mobile yang tertutup masih bisa dicapai dengan Tab

- Severity: S3
- Flow / case: F09 / F09-E4 (ditemukan oleh F09-H3 di 390px)
- Screen: semua page runtime (app shell)
- Build: `452e54d`  Browser / device: Chrome, 390px

Steps
1. Buka aplikasi di lebar 390px, login.
2. Tekan Tab berulang dari awal halaman tanpa membuka menu.

Expected: fokus melewati drawer navigasi yang tertutup.
Actual: fokus masuk ke link "Karyawan" / "Tentang aplikasi" yang berada di luar layar (fokus tidak terlihat; screen reader juga membacanya).
Evidence: Playwright "element is outside of the viewport" di F09-H3 [mobile]; tes F09-E4.
Suspected cause: drawer hanya digeser `translateX(-100%)`.
Status: fixed in `f9490fc`. Saat tertutup drawer diberi `visibility: hidden` (dengan transisi tertunda supaya animasi tetap jalan), sehingga keluar dari tab order dan accessibility tree.

### BUG-003: Link di ringkasan error < 24px

- Severity: S4
- Flow / case: F04 / F04-E1
- Screen: S23 (state error)
- Build: `452e54d`  Browser / device: Chrome, 1440px & 390px

Steps
1. Tambah karyawan, klik Simpan dengan form kosong.
2. Jalankan axe (WCAG 2.2 AA).

Expected: tidak ada pelanggaran.
Actual: `target-size` pada tiga link `a[href$="#P2_..."]` di ringkasan error.
Evidence: F04-E1 axe report.
Status: fixed in `f9490fc` (`.r-alert li > a` min-height 24px), di `replica/design/components.css` dan `src/client/components.css`.

### BUG-004: Form yang sama bisa diproses dua kali

- Severity: S3 (proteksi JS mencegahnya pada pemakaian normal; tanpa JS, saat browser mengirim ulang, atau saat replay terjadi duplikasi data)
- Flow / case: F04 / F04-E4b
- Screen: S23
- Build: `452e54d`

Steps
1. Buka form karyawan baru.
2. Kirim POST yang sama dua kali bersamaan (atau ulangi POST setelah berhasil).

Expected: hanya satu yang diproses.
Actual: dua lalu tiga baris "Dobel" tersimpan (`statuses 303 303 rows 2`, `after replay rows 3`).
Evidence: `test/flow.test.ts` "BUG-004".
Suspected cause: belum ada page submission id (direncanakan M2).
Status: fixed in `f9490fc`. Setiap render form membawa token sekali pakai (`__sid`, disimpan di session state, maks. 50 form terbuka per session). Kiriman kedua mendapat 409 "Formulir sudah dikirim".

---

### BUG-006: Nilai radio / checkbox group di luar daftar hilang diam-diam saat simpan

- Severity: S1 (kehilangan data tanpa peringatan)
- Flow / case: F04 / F04-I3
- Screen: S23 (form karyawan, dialog)
- Build: `59f38fe`  Browser / device: integrasi (`node:test`), sama di Chrome

Steps
1. Di database, isi `keahlian = 'SQL:LAMA'` untuk satu karyawan (nilai lama yang tidak ada di daftar KEAHLIAN).
2. Buka form karyawan itu, ubah apa saja (atau tidak sama sekali), klik Simpan.

Expected: nilai `LAMA` tetap terlihat, dan simpan ditolak dengan alasan yang jelas sampai user memutuskan.
Actual: `LAMA` tidak dirender, jadi tidak ikut terkirim; simpan sukses dan `keahlian` menjadi `SQL`.
Evidence: `test/m3.test.ts` "BUG-006" (gagal sebelum fix).
Suspected cause: select sudah menampilkan nilai di luar daftar, tapi radio / checkbox group hanya merender opsi dari LOV.
Status: fixed in `f67722d`. Nilai di luar daftar dirender sebagai opsi tercentang; cek daftar menolak simpan
("pilihan "LAMA" tidak ada di daftar") sampai user menghapus centangnya. Data lama tidak pernah hilang diam-diam.

### BUG-007: Popup LOV / cascade setelah session habis hanya bilang "coba lagi"

- Severity: S3
- Flow / case: F04 / F04-I1
- Screen: page 4 (Mutasi)
- Build: `59f38fe`  Browser / device: Chrome, 1440px & 390px

Steps
1. Login, buka Mutasi.
2. Session berakhir (dihapus / timeout).
3. Klik "Pilih Karyawan dari daftar".

Expected: dibawa ke login, lalu kembali ke Mutasi.
Actual: dialog berisi "Daftar pilihan gagal dimuat. Coba lagi." Mencoba lagi tidak pernah berhasil.
Evidence: `e2e/m3-items.spec.ts` "BUG-007" (gagal sebelum fix).
Status: fixed in `f67722d`. Respons 401 dari endpoint LOV/field memuat ulang halaman; server mengarahkan ke login dengan
alamat kembali. Isian yang belum disimpan hilang, sama seperti F04-E7.

### BUG-005: Kotak popup LOV tampak nonaktif

- Severity: S3 (WCAG 1.4.11 kontras non-teks)
- Flow / case: F04 / F04-I1
- Screen: page 4, field Karyawan
- Build: `59f38fe`  Browser / device: Chrome, 1440px & 390px

Steps: buka Mutasi, bandingkan field Karyawan dengan Departemen asal.
Expected: border sama dengan input lain (`border-input`, 3.89:1).
Actual: border `#DFE3E8` (± 1.3:1) karena gaya umum `.r-input[readonly]`; field terlihat nonaktif.
Evidence: `e2e/m3-items.spec.ts` "BUG-005", screenshot `m3-page4-*.png` sebelum fix.
Status: fixed in `f67722d`.

### BUG-008: Sorotan hasil pencarian LOV bergeser

- Severity: S4
- Flow / case: F04 / F04-I1
- Build: `59f38fe`

Steps: popup LOV berisi "İSTANBUL Ayşe", cari "ayşe".
Expected: `<mark>Ayşe</mark>`. Actual: sorotan bergeser satu huruf, karena `toLocaleLowerCase` mengubah "İ" menjadi dua karakter.
Evidence: `test/m3.test.ts` "BUG-008".
Status: fixed in `f67722d` (regex case-insensitive pada teks asli).

### BUG-009: Builder: dua penyimpanan dari versi yang sama sama-sama "berhasil", satu perubahan hilang diam-diam

- Severity: S2 (perubahan developer hilang tanpa pemberitahuan; jendelanya sempit, tetapi tidak ada cara mengetahuinya)
- Flow / case: F03 / F03-E3, F02 / F02-E4
- Screen: S06 Page Designer, S07 wizard Create Page, S13 properti aplikasi
- Build: `e2cce86`

Steps
1. Developer `admin` dan developer `budi` membuka dua item berbeda di halaman 2 aplikasi contoh (versi sama).
2. Keduanya menekan Simpan pada saat yang hampir bersamaan (tes: dua POST serentak).

Expected: keduanya tersimpan berurutan, atau satu tersimpan dan yang lain mendapat 409 "Aplikasi sudah diubah" dengan isiannya tetap.
Actual: keduanya 303 + pesan "disimpan", tetapi hanya satu label yang ada di aplikasi. Hal yang sama terjadi bila wizard Create Page dan Page Designer menyimpan bersamaan (wizard tidak memeriksa versi sama sekali).
Evidence: `test/f2-edge.test.ts` "two developers saving at the same moment" dan "the page wizard racing a designer save" (gagal sebelum fix: `codes 303,303 saved 1`).
Suspected cause: token versi dicek **sebelum** impor, di luar transaksi impor. Dua request lolos pengecekan, lalu impor kedua menimpa seluruh definisi aplikasi dengan spec yang belum memuat perubahan pertama.
Status: fixed in `03e4211`. `importText` menerima versi yang diharapkan dan mengeceknya di dalam transaksi impor, di bawah advisory lock per aplikasi. Penyimpanan yang basi mendapat 409 dengan isian tetap (designer, properti, wizard halaman) atau pesan "alias sudah dipakai" (wizard aplikasi, impor tanpa "Ganti"). Pesan konflik di designer kini juga menyebut tab lain dan menjelaskan bahwa Simpan lagi berarti menimpa versi terbaru.

### BUG-010: Builder: form dikirim setelah sesi developer berakhir, setelah login dibawa ke beranda

- Severity: S3 (ada jalan lain: buka lagi halamannya dari menu)
- Flow / case: F03 / F03-E4
- Screen: S01 login, S06
- Build: `e2cce86`

Steps
1. Buka Page Designer, biarkan lebih dari 1 jam (batas idle).
2. Ubah label lalu Simpan → halaman login "sesi berakhir".
3. Login.

Expected: kembali ke Page Designer pada komponen yang sama.
Actual: masuk ke beranda builder; developer harus mencari lagi aplikasi, halaman, dan komponennya.
Evidence: `test/f2-edge.test.ts` "session expired while editing" (gagal sebelum fix: `return` = null).
Suspected cause: alamat kembali hanya diisi untuk GET.
Status: fixed in `03e4211`. Untuk POST dipakai Referer, tetapi hanya bila dari host yang sama dan di dalam `/builder` (bukan halaman login). Referer dari situs lain atau dari runtime `/r/...` diabaikan. Isian yang diketik tetap hilang (sama seperti runtime, lihat "To check").

## To check (belum direproduksi sebagai bug)

- **Isian builder hilang saat sesi developer berakhir** (lanjutan BUG-010): developer kembali ke halaman yang benar, tetapi perubahan yang belum tersimpan hilang. Batas idle builder 1 jam. Bila tim sering kena, pertimbangkan perpanjangan sesi otomatis selama tab builder terbuka.
- **Query SQL report di wizard Create Page hanya dideskripsikan** (`limit 0`), tidak dijalankan. Query yang lambat (`pg_sleep`) tetap diterima dan baru dihentikan saat runtime oleh `statement_timeout` 30 detik. Disengaja, tapi developer tidak mendapat peringatan saat membuat halaman.
- **Isian hilang saat session kedaluwarsa** (F04-E7): setelah login ulang user kembali ke form, tetapi ketikannya hilang. APEX berperilaku serupa. Kalau terasa mengganggu bagi user gudang yang lama di satu form, pertimbangkan perpanjangan session otomatis.
- **Access log memuat argumen URL** (`P2_EMPNO=…`) sekali sebelum redirect 303. Sudah tercatat di `backend.md`, rencana redaksi di M5.
- **Format angka** di report memakai `to_char` + `replace` di SQL contoh. Format mask per item (M3) harus menggantikan pola ini.
- **Switch pada kolom boolean yang boleh null**: nilai `null` tampil sebagai "off" dan tersimpan sebagai `N` (false) saat form disimpan. Untuk kolom `not null` (contoh: `aktif`) tidak masalah. Untuk kolom nullable, pakai radio Ya/Tidak/(kosong).
- **Refresh setelah error validasi** mengirim ulang POST lama → halaman 409 "Formulir sudah dikirim". Ketikan tidak hilang di browser (Back), tapi pesannya bisa membingungkan. Perilaku token sekali pakai ini disengaja (BUG-004).
- **Nilai checkbox group yang mengandung `:`** tidak bisa dibedakan dari pemisah. Belum ada di data contoh; spec check bisa menolak `return` ber-`:` pada LOV yang dipakai checkbox group.
- **Angka dengan pemisah ribuan** (`7.250.000`) ditolak dengan "pakai titik untuk desimal". Pesan benar tapi bisa membingungkan user yang memang mengetik titik; pertimbangkan format mask input di Fase 2.

