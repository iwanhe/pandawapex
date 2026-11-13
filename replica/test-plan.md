# Test plan: pandawapex (Fase 1, M0–M1 + backend)

Build: `f146862` (branch `build/e2e`)  Date: 2026-11-13  Env: lokal, PostgreSQL 16, seed `examples/emp`, Chrome 1440×900 dan 390×844

Yang dites adalah **clone kita sendiri** (`npm run e2e`, `npm test`), bukan Oracle APEX.

## Cakupan per flow (dari `recon.md`)

| flow | status build | dites |
| --- | --- | --- |
| F01 buat app dari tabel (builder) | belum dibangun (Fase 2) | — |
| F02 tambah page Report+Form (builder) | belum dibangun | — |
| F03 Page Designer | belum dibangun | — |
| **F04 end user edit data (core loop)** | M1 | ✅ e2e + integrasi |
| F05 personalisasi IR | M4 | — |
| F06 Interactive Grid | Fase 2 | — |
| **F07 mengamankan app** | sebagian: autentikasi (akun + SSO); authorization scheme = M2 | ✅ bagian autentikasi |
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
- Zona waktu / DST: belum ada kolom waktu (timestamptz) di contoh. `tgl_masuk` bertipe `date`. Dites saat item datetime masuk (M3).
- Screen reader sungguhan (NVDA/VoiceOver): baru dicek otomatis lewat axe dan label/role di selector. Pengecekan manual masih diperlukan.
- Data user lain: aplikasi contoh tidak punya kepemilikan baris, jadi semua user melihat semua karyawan (by design). Isolasi antar-session dites lewat checksum/CSRF/lost update.
