# Test plan: pandawapex (Fase 1: M0–M4 + M3, backend)

Build: `f146862` (branch `build/e2e`)  Date: 2026-11-13  Env: lokal, PostgreSQL 16, seed `examples/emp`, Chrome 1440×900 dan 390×844

Yang dites adalah **clone kita sendiri** (`npm run e2e`, `npm test`), bukan Oracle APEX.

## Cakupan per flow (dari `recon.md`)

| flow | status build | dites |
| --- | --- | --- |
| **F01 buat app dari tabel (builder)** | B3 wizard Create App | ✅ e2e (8 aksi) + integrasi |
| **F02 tambah page Report+Form (builder)** | B4 wizard Create Page | ✅ e2e (3 aksi) + integrasi |
| **F03 Page Designer** | B5 Page Designer + properti aplikasi | ✅ e2e + integrasi |
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


## Fase 2 B1: builder (2026-11-13)

| ID | Flow | Jenis | Hasil yang diharapkan | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| B1-H1 | builder | happy | login developer → beranda → cari aplikasi → buat → ekspor → impor balik (ganti) → hapus; axe bersih di setiap layar | e2e (2 viewport), int | ✅ |
| B1-H2 | builder | happy | ekspor → impor → ekspor menghasilkan teks spec yang sama; metadata 16 tabel identik (emp, DEMO, kitchen sink) | int | ✅ |
| B1-E1 | builder | edge: tanpa sesi | GET ke halaman builder → login lalu kembali ke alamat semula; alamat kembali di luar `/builder` diabaikan | int | ✅ |
| B1-E2 | builder | edge: idle 1 jam / logout / cookie lama dipakai ulang | kembali ke login dengan pesan sesi berakhir | int | ✅ |
| B1-E3 | builder | edge: impor alias yang sudah ada | 409, spec tetap di kotak; dengan centang "Ganti" berhasil, riwayat bertambah | e2e, int | ✅ |
| B1-E4 | builder | edge: impor YAML rusak / spec tidak valid / skema bukan milik workspace | 422 dengan daftar masalah, tidak ada yang tersimpan | int | ✅ |
| B1-E5 | builder | edge: textarea mengirim CRLF | diimpor sama dengan LF | int | ✅ |
| B1-E6 | builder | edge: cari `%` | dicari harfiah, bukan wildcard | int | ✅ |
| B1-E7 | builder | edge: keyboard saja | login dan keluar tanpa mouse | e2e | ✅ |
| B1-N1 | builder | negatif: sandi salah / workspace salah / akun aplikasi | satu pesan yang sama, 401 | e2e, int | ✅ |
| B1-N2 | builder | negatif: 5 kali salah | akun dikunci; `rpx dev add` membuka; akun dikunci → sesi terbuka hilang | int | ✅ |
| B1-N3 | builder | negatif: data workspace lain | daftar kosong; buka, ekspor, hapus aplikasi workspace lain → 404 | int | ✅ |
| B1-N4 | builder | negatif: POST tanpa token CSRF | login 403, hapus 403 | int | ✅ |
| B1-N5 | builder | negatif: hapus dengan alias salah | 422, aplikasi tetap ada | e2e, int | ✅ |
| B1-N6 | builder | negatif: unduh versi milik aplikasi lain / id tidak valid | 404 | int | ✅ |

Run: `npm test` 108/108, e2e 76/76 (2 skip, sama seperti sebelumnya). Bug baru: tidak ada.

## Fase 2 B2: kelola akun (2026-11-14)

| ID | Flow | Jenis | Hasil yang diharapkan | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| B2-H1 | akun | happy: pengguna aplikasi | tambah dengan grup → atur ulang sandi → kunci → buka → hapus; akun baru bisa login ke aplikasi workspace; axe bersih | e2e (2 viewport), int | ✅ |
| B2-H2 | akun | happy: developer | administrator menambah developer, menjadikannya administrator, menghapusnya; axe bersih | e2e, int | ✅ |
| B2-H3 | akun | happy: ganti sandi sendiri | sandi baru berlaku, sesi lain berakhir, sesi ini tetap | int | ✅ |
| B2-E1 | akun | edge: grup berubah saat pengguna sedang login | akses ke halaman ber-grup langsung berubah (diberi dan dicabut) tanpa login ulang | int | ✅ |
| B2-E2 | akun | edge: banyak pengguna, cari `%` | paging 50 per halaman; `%` dicari harfiah | int | ✅ |
| B2-E3 | akun | edge: developer dinaikkan / diturunkan saat sesinya terbuka | menu dan akses Developer berubah di request berikutnya | int | ✅ |
| B2-N1 | akun | negatif: isian salah | nama dipakai, email salah, sandi < 10, konfirmasi beda, nama grup berspasi, sandi baru sama dengan lama → 422 dengan pesan per field | e2e, int | ✅ |
| B2-N2 | akun | negatif: reset / kunci | sesi pengguna berakhir; sandi lama ditolak; akun terkunci ditolak login | int | ✅ |
| B2-N3 | akun | negatif: developer biasa | halaman dan POST Developer → 403, tidak ada perubahan | int | ✅ |
| B2-N4 | akun | negatif: administrator pada akun sendiri | kunci, turunkan, hapus diri sendiri → dialihkan ke Akun saya, tidak ada perubahan | int | ✅ |
| B2-N5 | akun | negatif: workspace lain / id tidak valid / tanpa token CSRF | 404 / 404 / 403 | int | ✅ |
| B2-N6 | akun | negatif: sandi sekarang salah | 422, ringkasan error difokuskan | e2e, int | ✅ |

Run: `npm test` 117/117, e2e 80/80 (2 skip). Bug baru: tidak ada.

## Fase 2 B3: wizard Create App (2026-11-15)

| ID | Flow | Jenis | Hasil yang diharapkan | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| B3-H1 | F01 | happy | beranda builder → Buat aplikasi → nama → centang tabel → Buat → Jalankan → login → Interactive Report tampil, ≤ 8 aksi; Tambah lewat form dialog berhasil; axe bersih | e2e (2 viewport), int | ✅ (8 aksi) |
| B3-H2 | F01 | happy: tiga tabel | 5 halaman (2 report + form, 1 report saja), menu per tabel, FK tampil sebagai nama, enum/timestamp/boolean/textarea di form, baris tersimpan dengan default kolom | int | ✅ |
| B3-H3 | F01 | happy: batasi ke grup | anggota grup bisa membuka; bukan anggota 403 dengan pesan grup | int | ✅ |
| B3-E1 | F01 | edge: tabel tanpa PK, PK komposit tanpa default, view, kolom wajib bytea, tanpa hak tulis | report saja, dengan alasan tertulis | int, e2e | ✅ |
| B3-E2 | F01 | edge: tanpa hak SELECT, nama tabel campur huruf besar | checkbox nonaktif dengan alasan; dikirim paksa → ditolak | int | ✅ |
| B3-E3 | F01 | edge: tanpa tabel dipilih | satu halaman beranda kosong; beranda aplikasi memberi tahu bila belum ada pengguna aplikasi | int | ✅ |
| B3-E4 | F01 | edge: tanpa JavaScript, ganti skema | tombol "Tampilkan tabel" lewat GET; token CSRF dibuang dari alamat (303), isian tetap | int | ✅ |
| B3-N1 | F01 | negatif: alias bentrok, grup tidak valid, > 10 tabel, tabel yang tidak ada | 422 dengan pesan, pilihan tetap tercentang, ringkasan error difokuskan, tidak ada aplikasi dibuat | e2e, int | ✅ |
| B3-N2 | F01 | negatif: kolom wajib dikosongkan di form hasil wizard | 422 | int | ✅ |

Run: `npm test` 124/124 (3× berturut-turut setelah perbaikan listener pool), e2e 84/84 (2 skip). Bug baru: 1 (tes kadang gagal saat
teardown karena pool tanpa listener `error`; juga berisiko di produksi), diperbaiki.

## Fase 2 B4: wizard Create Page (2026-11-15)

| ID | Flow | Jenis | Hasil yang diharapkan | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| B4-H1 | F02 | happy | beranda aplikasi → Tambah halaman → pilih tabel → Tambah: halaman N dan N+1, menu, riwayat versi `dev:admin`; pengguna aplikasi menambah baris lewat form; ≤ 6 aksi; axe bersih | e2e (2 viewport), int | ✅ (3 aksi) |
| B4-H2 | F02 | happy: report dari SQL | kolom dan tipe dari query, bind item boleh, titik koma di akhir dibuang; halaman tampil dengan data | e2e, int | ✅ |
| B4-H3 | F02 | happy: form saja | halaman biasa, kembali ke halaman pilihan setelah simpan; LOV lama dengan nama sama tidak ditimpa (`DEPARTEMEN_2`) | int | ✅ |
| B4-H4 | F02 | happy: halaman kosong | alias dari nama, menu dengan ikon dokumen | int | ✅ |
| B4-E1 | F02 | edge: query salah / tanpa alias / kolom ganda / tanpa hak | pesan dari PostgreSQL atau penjelasan; tidak ada halaman dibuat | e2e, int | ✅ |
| B4-E2 | F02 | edge: query yang mengubah data | `delete`, `select 1; delete`, CTE `delete … returning` ditolak, jumlah baris tidak berubah | int | ✅ |
| B4-E3 | F02 | edge: isian dan pilihan tetap setelah error | jenis, sumber SQL, nama tetap; ringkasan error difokuskan | e2e, int | ✅ |
| B4-N1 | F02 | negatif: nomor halaman dipakai / 0 / bukan angka / N+1 dipakai | 422, menyebut nomor bebas berikutnya | int | ✅ |
| B4-N2 | F02 | negatif: tabel tanpa form untuk jenis form, tabel tidak ada, halaman kembali tidak ada, jenis tidak dikenal | 422 dengan alasan | int | ✅ |
| B4-N3 | F02 | negatif: aplikasi workspace lain, tanpa token CSRF | 404, 403 | int | ✅ |

Run: `npm test` 132/132, e2e 86/86 (2 skip). Bug baru: tidak ada.

## Fase 2 B5: Page Designer + properti aplikasi (2026-11-15)

| ID | Flow | Jenis | Hasil yang diharapkan | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| B5-H1 | F03 | happy | buka halaman dari beranda aplikasi → pilih item di pohon → ubah label dan bantuan → simpan → pesan sukses; tampil di aplikasi yang berjalan; axe bersih | e2e (2 viewport), int | ✅ |
| B5-H2 | F03 | happy: struktur | tambah region/item/tombol/validasi/proses/branch, naik/turun, hapus; urutan tersimpan | e2e, int | ✅ |
| B5-H3 | F03 | happy: YAML dan halaman | kondisi tombol lewat YAML; ukuran dialog dan judul halaman; region di halaman tidak hilang | int | ✅ |
| B5-H4 | S13 | happy: properti aplikasi | nama dan substitution strings tersimpan, halaman tidak tersentuh; axe bersih | e2e, int | ✅ |
| B5-H5 | F08 | happy: setelah banyak perubahan | ekspor → impor → ekspor tetap sama | int | ✅ |
| B5-E1 | F03 | edge: dua developer | simpan kedua ditolak 409, isian tetap, perubahan pertama utuh | int | ✅ |
| B5-E2 | F03 | edge: komponen yang tidak ada di URL | jatuh ke properti halaman; halaman tidak ada 404 | int | ✅ |
| B5-N1 | F03 | negatif: isian salah | YAML rusak, field wajib kosong, bukan angka, nama item tidak cocok nomor halaman, lebar kolom 20, nomor halaman diubah → 422, tidak ada yang tersimpan, ringkasan difokuskan | e2e, int | ✅ |
| B5-N2 | F03 | negatif: hapus yang masih dirujuk | item yang dipakai link report, halaman yang dirujuk, halaman beranda → ditolak dengan alasan | int | ✅ |
| B5-N3 | F03 | negatif: konfirmasi salah | nomor halaman salah → tidak dihapus | int | ✅ |
| B5-N4 | F03 | negatif: workspace lain, tanpa token CSRF | 404, 403 | int | ✅ |

Run: `npm test` 142/142, e2e 90/90 (2 skip). Bug baru: 1 (S3, aksi kepala halaman tidak turun baris di 390 px sehingga halaman bisa
digeser ke samping), diperbaiki.

## Uji menyeluruh Fase 2: builder B1–B5 (2026-11-15, build `e2cce86` → `03e4211`)

Kasus baru dari daftar edge case `replica-test` yang belum dicakup tes per milestone. Tes: `test/f2-edge.test.ts` (int) dan
`e2e/f2-edge.spec.ts` (desktop + mobile).

| ID | Flow | Jenis | Hasil yang diharapkan | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| F01-E5 | F01/F02/F03 | edge: markup di nama aplikasi, nama halaman, label, bantuan | di-escape di semua layar builder dan runtime | int | ✅ |
| F01-E6 | F01 | edge: input sangat panjang, aksen, emoji | nama 500 karakter dan alias 200 → 422; "Pengajuan Cuti — Ñoño 🎉" tersimpan dan tampil; alias ber-aksen → 422 | int | ✅ |
| F02-E5 | F02 | edge: nama halaman 400 karakter / hanya emoji; label item 5000 karakter | 422 / diterima / diterima | int | ✅ |
| B2-E4 | akun | edge: nama pengguna 61 karakter, emoji, spasi | 422 | int | ✅ |
| F02-E6 | F02 | edge: kirim ganda wizard halaman | satu halaman, satu menu | int (+ guard kirim ganda di klien) | ✅ |
| F03-E3 | F03 | edge: dua developer menyimpan bersamaan | keduanya tersimpan atau satu 409; tidak ada yang hilang diam-diam | int | ✅ setelah fix (BUG-009) |
| F02-E4 | F02/F03 | edge: wizard halaman bersamaan dengan simpan designer | sama seperti di atas; 409 menyimpan isian | int | ✅ setelah fix (BUG-009) |
| F03-E2 | F03 | edge: dua tab | simpan kedua → peringatan difokuskan, isian tetap; simpan lagi = menimpa dengan sengaja | e2e | ✅ |
| S13-E1 | S13 | edge: properti dari tab lama setelah halaman ditambah di tab lain | 409, halaman baru tetap ada | int | ✅ |
| F03-E4 | F03 | edge: sesi berakhir saat mengedit | login lalu kembali ke komponen yang sama; Referer dari situs lain, runtime, atau login diabaikan | int | ✅ setelah fix (BUG-010) |
| F02-N4 | F02 | negatif: SQL report membaca `rpx.dev_users`, `rpx.sessions`, `rpx.app_users`, `rpx.app_versions` | 422 (role workspace tidak punya hak) | int | ✅ |
| F02-E7 | F02 | edge: query lambat (`pg_sleep(20)`) | wizard tidak menunggu (< 5 detik) | int | ✅ (lihat "To check") |
| F03-E5 | F03 | edge: ganti nama item yang masih dirujuk | 422 dengan alasan, nama lama tetap | int | ✅ |
| F03-N5 | F03 | negatif: aplikasi dihapus di tab lain lalu Simpan | 404 dengan tautan ke daftar aplikasi | int | ✅ |
| B1-E8 | builder | edge: Back setelah keluar | `Cache-Control: no-store` di halaman builder; Back menampilkan login, bukan data | int, e2e | ✅ |
| B1-E9 | builder | edge: spec > 1 MB | 413 berupa halaman HTML dengan tautan kembali | int | ✅ |
| F01-E1 | F01/F03 | edge: keyboard saja | login → wizard → buat aplikasi → designer → ubah label → simpan, tanpa mouse | e2e (2 viewport) | ✅ |

Tidak dites: jaringan lambat dan offline (semua layar builder dirender server, tanpa state di klien selain guard kirim ganda);
zona waktu (waktu di builder selalu ditampilkan dalam Asia/Jakarta, disengaja untuk KCSI).

Run: `npm test` 156/156, e2e 96/96 (2 skip). Bug baru: 2 (S2 BUG-009, S3 BUG-010), keduanya diperbaiki dengan tes yang gagal
lebih dulu. Tidak ada S1/S2 yang terbuka.

## Pengerasan operasional (2026-11-15)

Tes: `test/ops.test.ts` (int) dan `e2e/ops-keepalive.spec.ts` (desktop + mobile).

| ID | Bagian | Jenis | Hasil yang diharapkan | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| OPS-H1 | session | happy | session kedaluwarsa dan idle (aplikasi dan developer) terhapus bersama state-nya; session hidup tetap bekerja dengan state-nya | int | ✅ |
| OPS-E1 | session | edge: dua instance | purge kedua tidak jalan selama yang pertama memegang kunci; purge yang gagal (database mati) hanya tercatat, server tidak jatuh; `0` menit = mati | int | ✅ |
| OPS-H2 | log | happy | `?P1_CARI=…`, checksum, `code` OIDC, pencarian builder: nilainya tidak ada di log; jalur, nama argumen, dan status ada | int | ✅ |
| OPS-H3 | keep-alive | happy | aplikasi dan builder: 204, `last_seen_at` diperbarui, `expires_at` tidak; tanpa session 401 dan tidak membuat session; sudah idle 401 | int | ✅ |
| OPS-H4 | keep-alive | happy: browser | mengetik lalu 5 menit → satu kiriman 204; tab diam 11 menit → tidak ada kiriman; tanpa aktivitas baru → tidak ada kiriman kedua | e2e | ✅ |
| OPS-E2 | keep-alive | edge | session dihapus → 401 → halaman berhenti mengirim; halaman login tidak mengirim | e2e | ✅ |
| OPS-H5 | backup | happy: bencana | backup → database dan role workspace dihapus → restore: role dibuat ulang, jumlah baris sama, session kosong, cookie lama ditolak, login dengan sandi lama, **simpan form sebagai role workspace berhasil**, builder dan riwayat versi ada | int | ✅ |
| OPS-H6 | backup | happy: pilot | aplikasi DEMO (5 skema, fungsi, trigger, view) sama sebelum dan sesudah; login dan beranda 200; di server yang sama role tidak disentuh | int | ✅ |
| OPS-E3 | backup | edge | `--keep 1` menghapus pasangan file lama; `--keep 0` ditolak; database tanpa pandawapex ditolak; file `.partial` tidak tersisa | int | ✅ |
| OPS-N1 | restore | negatif | tujuan sudah berisi tabel, nama tidak valid, file tidak ada, file role tidak ada → ditolak, tidak ada database dibuat | int | ✅ |
| OPS-E5 | restore | edge: `pg_restore` lebih baru dari server | parameter tak dikenal (`transaction_timeout`) ditoleransi dan data lengkap; error lain ditolak, database yang baru dibuat dihapus lagi; database kosong yang sudah ada dibiarkan dengan pesan | int (pg_restore tiruan), CI (versi asli) | ✅ |
| OPS-E4 | backup | edge: bentuk koneksi | URL dengan sandi ter-encode, port, `sslmode`, dan bentuk socket `postgres://user@/db?host=/dir` | int | ✅ |
| OPS-H7 | backup | happy: Docker | `docker compose run --rm rpx backup` → rusak data → restore ke `rpx_restore` → tukar nama → data kembali; server baru (volume kosong): role dibuat, `up` berhasil | manual (dijalankan), CI (backup + restore) | ✅ |
| OPS-M1 | backup | manual: Windows | `backup-lokal.cmd` di laptop Windows (Cmder, PostgreSQL portable) | manual | ✅ 2026-11-15: dua file terbentuk. Temuan: `start-pg.bat` berhenti di `pause`; diperbaiki dengan `< nul` |
| OPS-M2 | backup | manual: Windows | jadwal Task Scheduler (`schtasks`) | manual | ⏳ belum dijalankan |

## Dynamic Actions tahap 1 (2026-11-17)

Aplikasi contoh emp (halaman 2 dan 4) dan aplikasi uji `e2e/da-app.yaml` (semua jenis aksi di satu halaman).

| ID | Area | Jenis | Kasus | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| DA-S1 | spec | negatif | 17 kesalahan ditolak dengan pesan yang menyebut halaman, dynamic action, dan aksinya: nama ganda, event tanpa item/tombol, item/region/tombol tak dikenal, klik pada tombol submit, aksi tanpa target, `set_value` ke display only, `else` tanpa `when`, `submit_page` tanpa request atau memakai nama tombol lain, submit/confirm saat page load, `on_load` pada refresh, atribut yang tidak berlaku | int | ✅ |
| DA-S2 | spec | negatif | `execute_js` dan aksi tak dikenal ditolak skema; tombol `defined_by_da` dengan `target`/`confirm` ditolak | int | ✅ |
| DA-S3 | spec | happy | ekspor → impor menulis baris `dynamic_actions`/`da_actions` yang sama; nilai bawaan (`on_load`, request = nama tombol) tidak ditulis di hasil ekspor | int | ✅ |
| DA-R1 | render | happy | JSON dynamic action ada di halaman; `</script>` di pesan di-escape; tombol `defined_by_da` = `type="button"`; semua tombol punya `data-button` | int | ✅ |
| DA-R2 | render | keamanan | tombol yang tidak tampil (kondisi/otorisasi): dynamic action kliknya tidak dikirim dan REQUEST-nya ditolak 400 | int | ✅ |
| DA-R3 | submit | happy | `submit_page` dengan nama tombol (proses `when_button`) dan dengan request sendiri (`request_equals`) | int | ✅ |
| DA-B1 | builder | happy/negatif | Page Designer: dynamic action tampil sebagai kotak YAML di node Halaman; isian salah ditolak 422 dengan alasannya; isian benar tersimpan | int | ✅ |
| DA-H1 | browser | happy | change radio → hide/show (`else`), keyboard (panah), setelah gagal validasi keadaan diterapkan lagi saat halaman dimuat; axe bersih | e2e | ✅ |
| DA-H2 | browser | happy | tombol `defined_by_da`: confirm Batal tidak mengubah apa pun dan tidak submit; OK (lewat Enter) mengosongkan isian, radio kembali ke Tetap | e2e | ✅ |
| DA-H3 | browser | happy | data yang sudah Magang dibuka di dialog: grup Keahlian langsung tersembunyi (`on_load`) | e2e | ✅ |
| DA-H4 | browser | happy | enable/disable saat load dan saat switch berubah; key release menyalin nilai; confirm + submit_page; field yang di-disable tetap terkirim | e2e | ✅ |
| DA-H5 | browser | happy | refresh region memuat ulang satu region dari server tanpa menghapus isian lain | e2e | ✅ |

Run: `npm test` 195/195, e2e 112/112 (2 skip). Bug baru: tidak ada.

## Dynamic Actions tahap 2 (2026-11-18)

Tes: `test/da-server.test.ts` (int), tambahan di `test/export.test.ts`, `e2e/da.spec.ts` (DA-H6..H8). Aplikasi uji
`e2e/da-app.yaml` ditambah filter departemen dan tombol *Hitung total*; aplikasi emp halaman 4 menampilkan posisi karyawan.

| ID | Area | Jenis | Kasus | Cara | Status |
| --- | --- | --- | --- | --- | --- |
| DA2-S1 | spec | negatif | `execute_server_code` tanpa `code`; `code` di aksi lain; `items_to_submit` di selain execute/refresh; `items_to_return` di refresh; kirim display only; kembalikan hidden terlindungi; item tak dikenal; `on_load` | int | ✅ |
| DA2-S2 | spec | happy | ekspor → impor dengan `code`, `items_to_submit`, `items_to_return` identik | int | ✅ |
| DA2-R1 | keamanan | negatif | isi kode tidak pernah ada di JSON halaman | int | ✅ |
| DA2-C1 | panggil | happy | item dikirim lalu di-bind, item dikembalikan (nilai + teks tampil terformat), insert di kode di-commit, nilai tersimpan di session state | int | ✅ |
| DA2-C2 | panggil | negatif | `raise exception`: 422 dengan pesannya, insert dibatalkan, session state tidak berubah | int | ✅ |
| DA2-C3 | panggil | negatif | nilai tidak valid (bukan angka, di luar daftar): 422 dengan pesan field, kode tidak jalan | int | ✅ |
| DA2-C4 | panggil | happy | refresh dengan `items_to_submit`: nilai tersimpan, region menampilkan nilai baru | int | ✅ |
| DA2-C5 | panggil | keamanan | dynamic action yang tombolnya tidak tampil, nama tak dikenal, aksi bukan server, indeks salah: 400 | int | ✅ |
| DA2-C6 | panggil | keamanan | tanpa token CSRF 403; form state dipalsukan untuk menambah dynamic action 403; tanpa sesi 401; tidak ada data berubah | int | ✅ |
| DA-H6 | browser | happy | Mutasi: pilih karyawan lewat popup LOV (keyboard), posisi saat ini tampil; axe bersih | e2e | ✅ |
| DA-H7 | browser | happy/negatif | Hitung total tanpa submit, aksi berikutnya jalan; kode gagal → pesan di formulir, aksi berikutnya tidak jalan (keyboard); panggilan berikutnya yang berhasil menghapus pesan; axe bersih | e2e | ✅ |
| DA-H8 | browser | happy | filter departemen memuat ulang report di tempat, isian lain tetap; setelah reload filter yang sama tetap berlaku | e2e | ✅ |

Run: `npm test` 211/211, e2e 118/118 (2 skip). Bug baru: tidak ada.
