# Bugs

Hanya yang sudah direproduksi. Run: 2026-11-13, Chrome (system) 1440px & 390px, PostgreSQL 16.

| ID | severity | judul | status |
| --- | --- | --- | --- |
| BUG-001 | S3 | `max_length` item hanya ditegakkan browser | fixed in `f9490fc` |
| BUG-002 | S3 | Link navigasi mobile yang tertutup masih bisa dicapai dengan Tab | fixed in `f9490fc` |
| BUG-003 | S4 | Link di ringkasan error < 24px (WCAG 2.5.8 target size) | fixed in `f9490fc` |
| BUG-004 | S3 | Form yang sama bisa diproses dua kali (double POST / kirim ulang) | fixed in `f9490fc` |

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

## To check (belum direproduksi sebagai bug)

- **Isian hilang saat session kedaluwarsa** (F04-E7): setelah login ulang user kembali ke form, tetapi ketikannya hilang. APEX berperilaku serupa. Kalau terasa mengganggu bagi user gudang yang lama di satu form, pertimbangkan perpanjangan session otomatis.
- **Access log memuat argumen URL** (`P2_EMPNO=…`) sekali sebelum redirect 303. Sudah tercatat di `backend.md`, rencana redaksi di M5.
- **Format angka** di report memakai `to_char` + `replace` di SQL contoh. Format mask per item (M3) harus menggantikan pola ini.
