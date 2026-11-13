# Build log

Satu baris per screen/milestone. Format: ID · tanggal · status · yang belum · yang lebih sulit dari perkiraan.

## M0: Fondasi (2026-11-13), done

- Migrasi `db/migrations/0001_schema.sql` (dari `replica/schema.sql`) dan `0002_page_attributes.sql` (title/breadcrumb page, atribut tombol, default privileges).
- `rpx db migrate | ws create | app import | app check | user add`.
- Spec YAML v0 + JSON Schema (`src/spec/spec.schema.json`) + pemeriksaan semantik (nama item unik per app, prefix `P{page}_`, form wajib PK, target link/branch/nav harus ada).
- Import mengganti definisi app dalam satu transaksi; session dan session state tetap hidup.

## M1: Vertical slice (2026-11-13)

| ID | status | belum ada | catatan |
| --- | --- | --- | --- |
| S20 Login app | done | OIDC (M5), "lupa kata sandi" | Kata sandi argon2id. Akun terkunci setelah 5 kali gagal. Pesan error sama untuk user tak dikenal/kata sandi salah. Session id baru setelah login. |
| S25 Classic report | partial | Cards, faceted search (should) | Paging `limit n+1` ("Baris 1–5", tanpa count total). Kolom link memakai checksum. Ada empty state untuk "belum ada data" dan "tidak ada yang cocok". |
| S23 Form page | partial | Modal dialog (M4), popup LOV, cascading LOV (M3), lost-update (M2) | Form init/DML (insert/update/delete). Validasi inline + ringkasan error yang difokuskan. Nilai ketikan tetap ada saat error. |
| S27 Error / unauthorized | done | Error handling function per app (M2) | 403 checksum/CSRF, 404, 500 dengan kode referensi. |
| S21 IR, S22, S24, S26, S28 | not started | — | Sesuai urutan di `architecture.md` (M4/M5, Fase 2). |

Verifikasi:
- `npm test`: 27 tes lulus (unit bind translator, validasi spec, flow F04 lengkap, keamanan, proses PL/pgSQL) terhadap PostgreSQL 16 nyata, database baru per file tes.
- Screenshot 1440px dan 390px di `replica/clone-screens/`: S20, S25, S25-empty, S23, S23-error, S27.
- Keyboard saja: login (ketik, Tab, Enter) → Tab ke link baris → Enter → form → Simpan; ringkasan error menerima fokus.
- Tidak ada console error; tidak ada scroll horizontal di 390px (tabel di-scroll di dalam wadahnya).

Lebih sulit dari perkiraan:
- **Inferensi tipe bind.** `:P1_CARI is null` dan `'%' || :P1_CARI` gagal di PostgreSQL ("could not determine data type of parameter"). Solusinya: semua bind di SQL dikirim sebagai `$n::text`, persis seperti session state APEX (VARCHAR2). Konsekuensinya developer wajib melakukan cast eksplisit (`:P2_ID::int`). Ini sudah tercatat di arsitektur dan kini ditegakkan di engine.
- **Item di region static** (pola "parameter + tombol" tanpa tabel) belum terpikir di desain. Sekarang static region bisa memuat item.
- **Argumen URL setelah checksum** sengaja dibuang lewat redirect 303. Tujuannya agar alamat yang di-bookmark tidak membawa checksum milik session lama.

Penyimpangan dari `architecture.md` (disengaja, untuk ditinjau):
- Satu package npm (`src/engine`, `src/spec`, `src/cli`, `src/client`), belum pnpm workspaces. Akan dipecah saat builder Fase 2 masuk.
- Template HTML memakai tagged template TS yang auto-escape (`src/engine/html.ts`), bukan Eta. Hasilnya nol dependensi dan escaping default lebih aman.
- htmx belum dipakai. Paging dan pencarian masih full page (PRG). htmx masuk di M4 untuk refresh region IR.
- Invalidasi cache metadata memakai cek `spec_hash` per request (satu query kecil). `LISTEN rpx_app_changed` menyusul saat ada >1 instance.

## Backend: SSO OIDC + lost update (2026-11-13), done

- `authentication: { scheme: oidc, ... }` di spec. Client secret dibaca dari env var yang **namanya** disebut di spec.
  Discovery di-cache per issuer; discovery yang gagal tidak di-cache.
- Rute `/oidc/start` dan `/oidc/callback`: PKCE S256, state, dan nonce disimpan di session tamu dan dipakai sekali.
  Callback tanpa session yang cocok kembali ke login. Session id baru setelah login.
- User SSO dicocokkan per `(workspace, issuer, sub)` (migrasi 0003 menggantikan unique global). Grup diperbarui tiap login.
  Nama yang bentrok dengan akun lokal ditolak (409), bukan digabung.
- Lost update: token versi baris (hash + HMAC per session) di hidden field `__rv_<region>`; `form_dml` membaca ulang
  `FOR UPDATE` sebelum update/delete.
- Rate limit login & SSO per IP (`@fastify/rate-limit`), halaman 429 yang ramah.
- Tes: 41 lulus (+14), termasuk mock IdP lengkap (discovery, JWKS, PKCE, kode sekali pakai), dua editor bersaing,
  dan rate limit.

Lebih sulit dari perkiraan:
- `@fastify/rate-limit` hanya memasang hook pada rute yang didaftarkan **setelah** plugin selesai dimuat. Semua rute
  dipindah ke child plugin. Tanpa tes 429, ini akan lolos tanpa terlihat.
- Unique `(oidc_issuer, oidc_subject)` dari schema awal salah untuk multi-workspace. Ketahuan saat menulis provisioning.

## Test pass (2026-11-13)

- Playwright e2e (desktop 1440 + mobile 390) dengan pemindaian axe dan guard console/5xx: 50/50 lulus. Integrasi: 43/43.
- 4 bug ditemukan dan diperbaiki (S3×3, S4×1), masing-masing dengan tes yang gagal lebih dulu. Detail di `replica/bugs.md`.
- Page submission token (rencana M2) dibangun lebih awal karena BUG-004.

## M2: authorization, computations, kondisi (2026-11-13), done

| bagian | status | catatan |
| --- | --- | --- |
| Authorization schemes | done | `group_member` (grup akun lokal / klaim SSO), `exists_sql`, `not_exists_sql`, `fn_boolean`; evaluasi `once_per_session` (cache di `sessions.authz_cache`), `once_per_page_view`, `always`; dipasang di app, page, region, item, tombol, menu |
| Link/tombol/menu ke page terlarang | done | otomatis disembunyikan (nama di report jadi teks biasa). Ini lebih ramah daripada menampilkan link yang berakhir 403 |
| Computations | done | app: `on_new_session`, `after_authentication`, `before_header`; page: `before_header` (setelah form init), `after_submit` (sebelum validasi); tipe `static`, `item`, `sql_query`, `sql_expression`, `plpgsql_fn` |
| Application items | done | `restricted` secara default (tidak bisa diisi dari URL/form) |
| Kondisi | done | `item_not_null`, `item_null`, `item_equals`, `request_equals`, `sql_expression`, `sql_exists`, `never` pada region, item, tombol, menu, validasi, proses, branch, computation |
| Escape filter substitusi | done | `&X.` di-escape; `!HTML`, `!ATTR`, `!JS`, `!RAW`, `!STRIPHTML` |
| Akun dikunci | done | session yang masih terbuka langsung berakhir |
| UI builder untuk semua ini | not started | Fase 2 |

Verifikasi: `npm test` 53/53 (+10 tes M2), e2e 52/52 (+F04-N3 user tanpa grup SDM), screenshot S25-readonly, S27-forbidden, S23 (dengan computation masa kerja).

Lebih sulit dari perkiraan:
- **"Item yang dirender" harus diingat lintas request.** Dengan kondisi/otorisasi, item tersembunyi tidak boleh diterima dari POST,
  dan checksum item tersembunyi harus hanya mencakup yang dirender. Solusinya: daftar item & tombol yang dirender ditandatangani di form
  (`__ps`), menggantikan checksum lama. Validasi "tombol tidak dikenal" kini juga berdasarkan daftar ini.
- **PL/pgSQL function body** (`return ...;` seperti di APEX) tidak bisa dijalankan sebagai `DO`. Dibuat fungsi `pg_temp` sesaat
  di dalam savepoint. Butuh hak TEMP di database untuk role `ws_*` (default PostgreSQL: ada).
- Urutan before-header sengaja dibuat: form init → default item → computations, supaya computation bisa memakai baris yang baru diambil
  (contoh: masa kerja dari tanggal masuk).

## M4 (dimajukan): modal dialog + Interactive Report (2026-11-13), done

| ID | status | belum ada | catatan |
| --- | --- | --- | --- |
| S23 sebagai modal | done | ukuran dialog bisa diubah user | `mode: modal`: link (`data-dialog`) membuka `<dialog>` + iframe `?dialog=1`; `close_dialog` menutup lalu me-refresh `#main` di tempat (pesan sukses tampil); Batal / Esc menutup tanpa menyimpan; session habis di dalam dialog membawa seluruh jendela ke login. Tanpa JS tetap jalan sebagai halaman biasa |
| S21 Interactive Report | done (dasar) | saved reports, highlight, control break, aggregate, chart, pilih kolom | cari semua kolom, sort per kolom (`aria-sort`), filter angka/tanggal/teks/boolean + chip, paging, atur ulang, state per session, refresh region via fetch + live region |
| S21 download | done | — | CSV (BOM, netralisasi formula `= + - @`), XLSX (zip XML via `fflate`, angka sebagai angka, header beku), batas `max_download_rows` |
| Format kolom | partial | format mask lengkap (M3) | `format: number | integer | date` untuk tampilan saja (id-ID) |

Verifikasi: `npm test` 66/66 (+13: sort/filter/injeksi/unduhan/dialog), e2e 58/58 lulus, 2 di-skip (F04 ditulis ulang untuk dialog + F05 IR), screenshot S21, S21-390, S23-dialog, S23-dialog-390, tanpa console error.

Lebih sulit dari perkiraan:
- **Form bersarang.** Seluruh page adalah satu form POST, jadi kontrol pencarian/filter IR (GET) tidak boleh ada di dalamnya.
  Solusinya: form GET kosong di luar form utama, dan input memakai atribut `form="…"`.
- **Perintah report di URL.** `?daftar__fc=…` yang dimuat ulang akan menambah filter dua kali. Perintah diterapkan sekali lalu
  dialihkan (303) ke URL bersih; peringatan (mis. "harus angka") dibawa lewat session agar tetap terlihat setelah redirect.
- **Esc di dalam iframe** tidak sampai ke `<dialog>` induk. Halaman dialog meneruskannya lewat `postMessage`.
- `exceljs` membawa dependensi `uuid` lama dengan kerentanan moderat. Diganti XLSX buatan sendiri (± 60 baris) di atas `fflate`.

## M3: item & daftar pilihan (2026-11-13), done

| ID | status | belum ada | catatan |
| --- | --- | --- | --- |
| Item types | done | file upload, rich text, shuttle, select one bergaya combobox | `popup_lov`, `radio`, `checkbox`, `checkbox_group`, `switch`, `datetime`, `display_only` dengan `format`; radio/checkbox group memakai `<fieldset><legend>`, switch = `role="switch"` |
| Shared LOV | done | LOV dinamis dengan kolom tambahan (multi-column popup) | `lovs:` di tingkat app → `rpx.lovs` / `rpx.lov_entries`; item memakai `lov: NAMA` |
| Cascading LOV | done | — | `cascade: [ITEM]`; `GET …/:page/field/:item` merender ulang field anak dengan nilai parent saat itu, nilai anak dikosongkan, cucu ikut berantai |
| Popup LOV | done | multi-select | `GET …/:page/lov/:item?q=&p=` (25 per halaman, `ilike` literal, `<mark>`), dialog `sm` dengan combobox + listbox, panah/Enter/Esc, fokus kembali ke field |
| Cek nilai di server | done | — | nilai list harus ada di daftar (juga untuk SQL LOV), angka, tanggal, tanggal-jam, nilai checkbox/switch |
| Validasi baru | done | — | `fn_boolean`, `fn_returns_error`, `is_numeric`, `is_date`, `is_timestamp` |
| Format tanggal & zona waktu | partial | format mask bebas (`DD-MON-YYYY` dst.) | `datetime-local` + `timezone` app (`set_config('timezone')` per request); tampilan `date`/`datetime` di display only & report |

Verifikasi: `npm test` 79/79 (+13 di `test/m3.test.ts`), e2e +6 (F04-I1..I3 desktop & 390 px, axe bersih dengan dialog LOV terbuka),
screenshot page 4 dan dialog LOV (desktop, 390 px). Contoh: page 2 (switch, radio, checkbox group, shared LOV) dan page 4 "Mutasi"
(popup LOV yang mengikuti departemen asal, jabatan yang mengikuti departemen tujuan, validasi function body).

Lebih sulit dari perkiraan:
- **Browser tidak mengirim apa pun** untuk checkbox yang tidak dicentang atau radio yang tidak dipilih. Karena daftar item yang dirender
  ikut ditandatangani (`__ps`), server tahu item itu ada di form, jadi "tidak terkirim" bisa diartikan kosong / `off_value` dengan aman.
- **Parent cascade dari URL** adalah celah: kalau LOV difilter item tersembunyi (mis. departemen milik user), nilai parent di query string
  bisa melebarkan daftar. Hanya parent yang memang bisa diubah user (bukan hidden, display only, atau restricted) yang diterima.
- **Bentuk SQL LOV tidak diketahui** (1 atau 2 kolom, nama kolom bebas). Kolomnya dibaca sekali lewat `limit 0`, disimpan per versi spec,
  lalu pencarian dan cek keanggotaan dibungkus di sekitarnya.
- **Atribut `hidden`** kalah oleh `display: inline-flex` milik `.r-btn`; ditambah aturan global `[hidden] { display: none !important }`.

## Pilot: porting aplikasi DEMO "Demo Permintaan Barang" dari APEX (2026-11-13), done

Sumber: aplikasi Tim PANDAWA (install.sql Oracle, APEXlang, export f170134). Hasil dan pola terjemahan:
`examples/demo-permintaan/PORTING.md`.

| bagian | status | catatan |
| --- | --- | --- |
| Objek database | done | 5 tabel inti + 4 entitas, 4 package → 4 skema PL/pgSQL, 5 trigger, 10 view; pesan error bisnis identik |
| 17 halaman | done | termasuk 302 master-detail dari export f170134; login memakai login bawaan |
| Engine | done | kondisi `request_in`, item `read_only`, sort default IR, region chart (bar/pie), paginasi disembunyikan bila satu halaman, tabel scroll bisa difokus |
| Celah | dicatat | faceted search, sub-region, metric card, akun login dari UI, format mask bebas |

Verifikasi: `npm test` 93/93 (+10 tes pilot), e2e 72/72 lulus (+2 skenario pilot × 2 viewport), axe bersih di semua layar pilot.

Lebih sulit dari perkiraan:
- **Variabel package** (`g_bypass`) tidak ada di PL/pgSQL. Diganti setting transaksi (`set_config(..., true)`), yang juga
  otomatis hilang saat transaksi batal.
- **Audit di trigger**: PL/pgSQL tidak bisa mengisi field record polimorfik, jadi satu fungsi audit untuk semua tabel
  ditulis sebagai `jsonb_populate_record(new, ...)`.
- **axe menemukan bug a11y baru**: tabel di kolom sempit bisa di-scroll tetapi tidak bisa difokus keyboard. Diperbaiki untuk
  semua report.
