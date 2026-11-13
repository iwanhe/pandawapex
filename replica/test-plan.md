# Test plan: pandawapex (Fase 1: M0–M4 + M3, backend)

Build: `f146862` (branch `build/e2e`)  Date: 2026-11-13  Env: lokal, PostgreSQL 16, seed `examples/emp`, Chrome 1440×900 dan 390×844

Yang dites adalah **clone kita sendiri** (`npm run e2e`, `npm test`), bukan Oracle APEX.

## Cakupan per flow (dari `recon.md`)

| flow | status build | dites |
| --- | --- | --- |
| F01 buat app dari tabel (builder) | belum dibangun (Fase 2) | — |
| F02 tambah page Report+Form (builder) | belum dibangun | — |
| F03 Page Designer | belum dibangun | — |
| **F04 end user edit data (core loop)** | M1 + M3 (item & LOV) + M4 (dialog) | ✅ e2e + integrasi |
| F05 personalisasi IR | M4 (dasar, tanpa saved reports) | ✅ e2e + integrasi |
| F06 Interactive Grid | Fase 2 | — |
| **F07 mengamankan app** | autentikasi (akun + SSO) + authorization scheme (M2) | ✅ |
| **F08 promosi DEV→PROD** | sebagian: import spec | ✅ import ulang saat user aktif |
| **F09 navigasi + session state** | M1 | ✅ e2e + integrasi |
| F10 debugging | M5 | — |

## Kasus

`auto`: **e2e** = Playwright (`e2e/*.spec.ts`, dijalankan di desktop dan mobile), **int** = `node:test` terhadap PostgreSQL (`test/*.test.ts`), **manual**.
Setiap tes e2e otomatis gagal bila ada console error atau respons 5xx, dan layar utama dipindai axe (WCAG 2.2 A/AA).

| case | flow | type | langkah | yang diharapkan | auto | hasil |
| --- | --- | --- | --- | --- | --- | --- |
| F04-H1 | F04 | happy | login → cari → buka baris → ubah jabatan → Simpan | kembali ke daftar, pesan sukses, DB berubah; axe bersih di report & form | e2e | ✅ |
| F04-H2 | F04 | happy | Tambah karyawan → isi → Simpan | baris baru, tombol Hapus tidak tampil saat form baru | e2e, int | ✅ |
| F04-H3 | F04 | happy | Hapus → batal, lalu Hapus → setuju | batal = tetap ada; setuju = terhapus; teks konfirmasi benar | e2e, int | ✅ |
| F04-E1 | F04 | edge: input kosong | Simpan form kosong | 3 error inline, ringkasan error difokus, link ke field, axe bersih | e2e, int | ✅ (setelah BUG-003) |
| F04-E2 | F04 | edge: aksen, emoji, panjang | nama `Ñoño Dédé Śrī 😀` + padding sampai 120 unit | tersimpan utuh, pesan sukses benar, tanpa scroll horizontal | e2e | ✅ |
| F04-E3 | F04 | edge: input sangat panjang | lewati `maxlength` browser, kirim 500 karakter | ditolak server dengan pesan field | e2e, int | ✅ (setelah BUG-001) |
| F04-E4 | F04 | edge: double click | dobel klik Simpan pada form baru | tepat satu baris | e2e | ✅ |
| F04-E4b | F04 | edge: double POST tanpa JS / replay | kirim POST yang sama 2× bersamaan, lalu sekali lagi | satu diproses, sisanya 409, tetap 1 baris | int | ✅ (setelah BUG-004) |
| F04-E5 | F04 | edge: dua tab sekaligus | tab A & B buka baris yang sama, A simpan, B simpan | B dihentikan "Data diubah pengguna lain", data A utuh | e2e, int | ✅ |
| F04-E6 | F04 | edge: tombol back | simpan, lalu Back | form tampil dengan data baru, tidak ada kiriman ulang | e2e | ✅ |
| F04-E7 | F04 | edge: session kedaluwarsa | session dihapus saat form terbuka, lalu Simpan | ke login "Sesi Anda berakhir", setelah login kembali ke form | e2e | ✅ (isian yang belum tersimpan hilang, lihat "to check") |
| F04-E8 | F04 | edge: keyboard saja | login, Tab ke baris, Enter, Simpan | flow selesai tanpa mouse | e2e | ✅ |
| F04-E9 | F04 | negatif: record dihapus | baris dihapus orang lain saat form terbuka, lalu Simpan | "Data sudah tidak ada", tidak ada error 500 | e2e | ✅ |
| F04-E10 | F04 | edge: lebar mobile | semua kasus F04 di 390px | lulus, tanpa scroll horizontal halaman | e2e (mobile) | ✅ |
| F04-N1 | F04 | negatif: kata sandi salah | salah kata sandi; user tak dikenal | pesan generik yang sama; axe bersih di login | e2e, int | ✅ |
| F04-N2 | F04 | negatif: akun dikunci | 5× salah | akun terkunci, login benar pun ditolak | e2e, int | ✅ |
| F04-N3 | F04 | negatif: rate limit | > batas login per menit dari 1 IP | 429 dengan halaman ramah | int | ✅ |
| F04-N4 | F04 | negatif: XSS | data berisi `<script>` | tampil sebagai teks; CSP `script-src 'self'` | int | ✅ |
| F04-N5 | F04 | negatif: ubah PK tersembunyi | ganti `P2_EMPNO` di form | 403 checksum | int | ✅ |
| F04-N6 | F04 | negatif: CSRF / tombol palsu | POST tanpa token; `REQUEST=DROP` | 403; 400 | int | ✅ |
| F04-N7 | F04 | negatif: proses gagal | PL/pgSQL `raise exception` | seluruh perubahan di-rollback, pesan proses tampil | int | ✅ |
| F04-N8 | F04 | negatif: token versi palsu/hilang | kirim tanpa `__rv` / dengan token palsu | ditolak sebagai lost update | int | ✅ |
| F04-I1 | F04 | happy: item & LOV | mutasi: departemen asal → popup LOV (cari, panah, Enter) → radio departemen tujuan → jabatan ter-refresh → tanggal-jam → setujui → Proses | tersimpan, pesan sukses; axe bersih di page dan saat dialog LOV terbuka | e2e, int | ✅ |
| F04-I2 | F04 | edge: cascade & keyboard | pilih karyawan, ganti departemen asal; Esc di dialog LOV | anak dikosongkan; Esc menutup daftar saja, fokus kembali ke field | e2e | ✅ |
| F04-I3 | F04 | happy: switch & checkbox group di modal | matikan Aktif, centang 2 keahlian, pilih Magang | DB: `aktif=false`, `keahlian='SQL:APEX'` | e2e, int | ✅ |
| F04-I4 | F04 | negatif: nilai di luar daftar | POST departemen 999, status palsu, keahlian palsu, switch "mungkin" | 422 dengan pesan per field, tidak ada yang tersimpan | int | ✅ |
| F04-I5 | F04 | negatif: endpoint LOV | tanpa session; user tanpa grup SDM; item page lain; parent hidden ditimpa lewat URL | 401; 403; 404; parent diabaikan | int | ✅ |
| F04-I6 | F04 | negatif: XSS di nilai LOV | nama karyawan berisi `<img onerror>` muncul di popup LOV dan sorotan | tampil sebagai teks | int | ✅ |
| F04-I7 | F04 | edge: zona waktu & DST | `timestamptz` lewat item datetime di app `Europe/Amsterdam`; simpan tanpa ubah; jam di celah DST | tampil 08:00 (CEST); tersimpan tetap; 02:30 → 03:30 | int | ✅ |
| F04-I8 | F04 | edge: nilai lama di luar daftar | `keahlian = 'SQL:LAMA'`, buka lalu simpan | `LAMA` tampil tercentang, simpan ditolak dengan alasan, data utuh | int | ✅ (setelah BUG-006) |
| F04-I9 | F04 | edge: session habis saat memilih | hapus session, buka popup LOV | ke login, lalu kembali ke Mutasi | e2e | ✅ (setelah BUG-007) |
| F04-I10 | F04 | edge: kontras & huruf khusus | border popup LOV; cari "ayşe" di "İSTANBUL Ayşe" | border = input lain; sorotan tepat | e2e, int | ✅ (setelah BUG-005, BUG-008) |
| F07-H1 | F07 | happy: SSO | tombol "Masuk dengan akun KCSI" → IdP → callback | masuk, kembali ke page yang diminta, grup tersimpan; tanpa form kata sandi; axe bersih | e2e, int | ✅ (mock IdP) |
| F07-H2 | F07 | happy: login kedua | SSO lagi dengan sub sama | akun yang sama, grup diperbarui | int | ✅ |
| F07-N1 | F07 | negatif: domain lain | akun `@contoh.com` | ditolak "tidak diizinkan" | e2e, int | ✅ |
| F07-N2 | F07 | negatif: state palsu / replay | ubah `state`; ulang callback | ditolak; replay ke login | int | ✅ |
| F07-N3 | F07 | negatif: callback di browser lain | buka callback tanpa session pemulai | tidak ada yang login | int | ✅ |
| F07-N4 | F07 | negatif: nama bentrok | SSO dengan username = akun lokal | 409, tidak digabung | int | ✅ |
| F07-N5 | F07 | negatif: secret belum diisi | env var kosong | halaman "Konfigurasi SSO belum lengkap" | int | ✅ |
| F07-M1 | F07 | manual: IdP sungguhan | login dengan Entra ID / Google Workspace KCSI | sama dengan F07-H1 | manual | ⏳ butuh app registration KCSI |
| F08-H1 | F08 | happy | import ulang spec (judul page berubah) saat user login | judul baru tampil setelah reload, user tetap login | e2e | ✅ |
| F09-H1 | F09 | happy | link baris → form; breadcrumb kembali | argumen item hilang dari URL, pencarian tetap diingat | e2e | ✅ |
| F09-H2 | F09 | happy | paging maju/mundur | "Baris 6–…", lalu kembali "Baris 1–5" | e2e, int | ✅ |
| F09-H3 | F09 | happy | menu → Tentang aplikasi | `&APP_USER.` tersubstitusi; axe bersih | e2e | ✅ |
| F09-E1 | F09 | edge: hasil kosong | cari yang tidak ada | empty state "Tidak ada data yang cocok"; axe bersih | e2e, int | ✅ |
| F09-E2 | F09 | edge: mobile drawer | buka/tutup navigasi, Esc | `aria-expanded` benar, fokus kembali ke tombol | e2e (mobile) | ✅ |
| F09-E3 | F09 | edge: back setelah logout | logout → Back → reload | tetap di login, data tidak tampil | e2e, int | ✅ |
| F09-E4 | F09 | edge: keyboard mobile | Tab dari atas saat drawer tertutup | fokus tidak masuk ke link drawer | e2e (mobile) | ✅ (setelah BUG-002) |
| F09-N1 | F09 | negatif: link diubah | ganti nilai item di URL | 403 "Checksum tidak cocok"; axe bersih | e2e, int | ✅ |
| F09-N2 | F09 | negatif: link dari session lain | buka link milik user lain | 403 | int | ✅ |
| F09-N3 | F09 | negatif: page tidak ada | `/r/e2e/emp/4242` | 404 ramah | e2e, int | ✅ |

## Ringkasan run terakhir

- **e2e**: 52 kasus (26 × 2 viewport), 50 dijalankan, **50 lulus**, 2 di-skip (kasus khusus mobile di proyek desktop).
- **integrasi/unit**: **43 lulus** (`npm test`).
- **manual**: 1 tertunda (F07-M1, IdP sungguhan).

## Tidak dites (alasan)

- Jaringan lambat / offline: aplikasi server-rendered tanpa mode offline. Perilakunya mengikuti browser.
- Zona waktu / DST: dites di F04-I7 (integrasi). Belum dites: user yang zona waktu browsernya berbeda dari zona waktu app; semua jam tampil dalam zona waktu app.
- Screen reader sungguhan (NVDA/VoiceOver): baru dicek otomatis lewat axe dan label/role di selector. Pengecekan manual masih diperlukan.
- Data user lain: aplikasi contoh tidak punya kepemilikan baris, jadi semua user melihat semua karyawan (by design). Isolasi antar-session dites lewat checksum/CSRF/lost update.

## Tambahan setelah modal + Interactive Report (2026-11-13)

| case | flow | type | yang diharapkan | auto | hasil |
| --- | --- | --- | --- | --- | --- |
| F04-H1..E9 | F04 | semua kasus F04 di atas, kini lewat **dialog** | sama, plus dialog tertutup dan daftar ter-refresh di tempat | e2e | ✅ |
| F04-E6' | F04 | edge: Esc / Batal | dialog tertutup tanpa menyimpan, fokus kembali ke link baris | e2e | ✅ |
| F04-E7' | F04 | edge: session habis di dalam dialog | seluruh jendela ke login, setelah login kembali ke daftar | e2e, int | ✅ |
| F05-H1 | F05 | happy | sort kolom (aria-sort), filter via panel → chip, unduh CSV, hapus chip | e2e, int | ✅ |
| F05-H2 | F05 | happy | XLSX valid, angka tersimpan sebagai angka | int | ✅ |
| F05-E1 | F05 | edge: nilai filter salah | pesan "harus angka" tampil setelah redirect, sekali | e2e, int | ✅ |
| F05-E2 | F05 | edge: tanpa hasil | empty state + tautan hapus pencarian & filter | e2e | ✅ |
| F05-N1 | F05 | negatif: injeksi | `%`, `' or 1=1 --`, kolom sort/filter palsu tidak berpengaruh | int | ✅ |
| F05-N2 | F05 | negatif: formula di CSV | sel `=…`/`-…` diawali `'` | int | ✅ |
| F05-N3 | F05 | negatif: unduh tanpa session / region salah | 303 ke login / 404 | int | ✅ |

Run terakhir: e2e 58/58 lulus, 2 di-skip (60 kasus), integrasi 66/66.

## Run sebelum pilot (2026-11-13, build `59f38fe` → `f67722d`, M0–M4 + M3)

| | jumlah | lulus | gagal | catatan |
| --- | ---: | ---: | ---: | --- |
| e2e (Playwright, desktop + 390 px) | 70 | 68 | 0 | 2 di-skip (kasus khusus mobile di proyek desktop); setiap tes: tanpa console error / 5xx, axe WCAG 2.2 AA |
| integrasi / unit (`npm test`) | 83 | 83 | 0 | PostgreSQL 16, satu database per file tes |
| manual | 1 | — | — | F07-M1 (IdP KCSI sungguhan) masih menunggu app registration |

Bug baru: **4** (S1 ×1, S3 ×2, S4 ×1), semuanya **fixed** dengan tes yang gagal dulu (`f67722d`). Bug terbuka S1/S2: **0**.
Satu tes e2e baru (F04-I1) sempat gagal di run penuh karena bergantung pada jumlah karyawan yang diubah spec lain; diperbaiki dengan
membandingkan ke database.

## Pilot DEMO Permintaan Barang (2026-11-13)

| case | flow | type | yang diharapkan | auto | hasil |
| --- | --- | --- | --- | --- | --- |
| PILOT-H1 | F04 | happy: permintaan → baris → submit → approve | nomor REQ-YYYY-NNNN, status SUBMITTED lalu APPROVED; axe bersih di report, dialog baris, inbox | e2e, int | ✅ |
| PILOT-H2 | F04 | happy: approval 2 level | > 10 jt: MANAGER lalu DIRECTOR; manager tidak bisa mengambil langkah direktur (tombol tidak ada, POST 400) | int | ✅ |
| PILOT-H3 | F04 | happy: home | KPI, chart pie & bar dengan tabel alternatif; axe bersih | e2e, int | ✅ |
| PILOT-E1 | F04 | edge: submit tanpa baris | "Permintaan belum memiliki baris item.", status tetap DRAFT | int | ✅ |
| PILOT-E2 | F04 | edge: terkunci setelah submit | field tampil sebagai teks, nilai kiriman diabaikan, Apply/Submit tidak ada; baris tidak bisa diubah | int | ✅ |
| PILOT-E3 | F04 | edge: setelah approved | hanya status yang bisa diubah (APPROVED → FULFILLED), keperluan tetap | int | ✅ |
| PILOT-E4 | F04 | edge: reject | tanpa catatan ditolak; dengan catatan → REJECTED, bisa diubah dan diajukan lagi | int | ✅ |
| PILOT-N1 | F07 | negatif: maker-checker | manager tidak bisa menyetujui permintaannya sendiri | int | ✅ |
| PILOT-N2 | F07 | negatif: tanpa role | user tanpa role ditolak scheme aplikasi; role baru dari admin berlaku di page view berikutnya | int | ✅ |
| PILOT-N3 | F07 | negatif: menu & tombol per role | Administration hanya ADMIN, Create item hanya WAREHOUSE, form permintaan bukan untuk WAREHOUSE | int | ✅ |

Run: integrasi 93/93, e2e 72/72 (2 di-skip). Bug baru dari axe: tabel scroll tidak bisa difokus keyboard, diperbaiki (lihat build-log).

