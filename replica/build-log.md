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

## Fase 2 B1: fondasi builder (2026-11-13), done

| layar | status | catatan |
| --- | --- | --- |
| S01 login developer | done | `/builder/login`: workspace + username + sandi; sesi `rpx_dev` (path `/builder`) terpisah dari sesi aplikasi; CSRF double-submit sebelum login, token sesi sesudahnya; rate limit; kunci setelah 5 gagal; sesi 8 jam, idle 1 jam; akun dikunci → sesinya hilang |
| S02 beranda workspace | done | jumlah aplikasi, halaman, skema, developer; 5 aplikasi terakhir diubah |
| S03 daftar aplikasi | done | cari nama/alias (wildcard `%`/`_` dicari harfiah), jalankan, ekspor; dua empty state |
| S04 buat / impor | done | buat aplikasi kosong (1 halaman beranda); impor dari file (FileReader → textarea, form tetap urlencoded) atau tempel; konfirmasi ganti bila alias sudah ada; daftar masalah spec |
| S05 beranda aplikasi | done | ringkasan, daftar halaman, riwayat impor 20 terakhir + unduh teks persis per versi, hapus dengan ketik alias |
| CLI | done | `rpx app export`, `rpx dev add`; `demo setup` / `pilot setup` membuat developer `admin` |

Semua query builder dibatasi ke workspace developer yang login; aplikasi workspace lain dijawab 404, sama dengan yang tidak ada.
`imported_by` dari builder tercatat `dev:<username>`.

Verifikasi: `npm test` 108/108 (+3 ekspor bolak-balik, +12 builder), e2e 76/76 (+2 skenario builder × 2 viewport), axe bersih
di S01–S05, screenshot `replica/clone-screens/S01..S05-{1440,390}.png`.

Lebih sulit dari perkiraan:
- **Ekspor yang bisa diimpor ulang persis sama**: spec dibangun ulang dari tabel metadata, bukan teks impor terakhir, jadi setiap
  nilai default harus dihilangkan dengan aturan yang sama seperti importer mengisinya. Diuji dengan snapshot 16 tabel untuk emp,
  DEMO, dan spec "kitchen sink".
- **Timestamp sebagai teks**: pool engine sengaja mengembalikan `timestamptz` sebagai teks; builder mengubahnya ke Date sendiri.

Belum (B2 dan seterusnya): kelola akun developer dan end user dari UI, Create App wizard dari tabel, Create Page wizard, Page Designer.

## Fase 2 B2: kelola akun dari builder (2026-11-14), done

| layar | status | catatan |
| --- | --- | --- |
| S19 pengguna aplikasi | done | `/builder/users`: daftar + cari + paging 50; tambah (nama, email, kata sandi, grup); detail: grup, atur ulang kata sandi (sesi pengguna diakhiri), kunci / buka kunci, hapus dengan ketik nama |
| S19 developer | done | `/builder/developers`, khusus administrator: tambah, jadikan administrator / developer biasa, atur ulang kata sandi, kunci, hapus; akun sendiri dialihkan ke Akun saya, jadi administrator tidak bisa mengunci atau menurunkan dirinya |
| S19 akun saya | done | `/builder/account`: ganti kata sandi (cek sandi lama, rate limit); sesi lain milik developer itu berakhir, sesi ini tetap |

Grup yang ditawarkan diambil dari authorization scheme `group_member` semua aplikasi di workspace (dengan nama aplikasinya) dan
grup yang sudah dipakai pengguna. Perubahan grup berlaku langsung: cache otorisasi "once per session" milik pengguna itu dikosongkan.
Akun SSO tanpa kata sandi tidak punya form atur ulang, dan halamannya menjelaskan bahwa grup SSO ditimpa klaim IdP saat login.

Verifikasi: `npm test` 117/117 (+9 di `test/b2.test.ts`), e2e 80/80 (+2 skenario × 2 viewport, axe bersih), screenshot
`S19-users`, `S19-user`, `S19-developers`, `S19-account` (1440 dan 390). Parity 58.7 → 59.8, must-have 25/30.

Lebih sulit dari perkiraan:
- **Kolom `citext` dalam array** (`array_agg(alias)`) tidak di-parse driver pg dan datang sebagai teks `{emp}`; perlu cast `::text[]`.
- **Grup harus berlaku tanpa login ulang.** Grup dibaca per request, tetapi hasil scheme `once_per_session` disimpan di sesi;
  tanpa mengosongkan cache itu, pengguna yang baru diberi grup tetap ditolak sampai login ulang.

Belum: wizard Create App dari tabel (B3), wizard Create Page, Page Designer.

## Fase 2 B3: wizard Create App dari tabel (2026-11-15), done

| layar | status | catatan |
| --- | --- | --- |
| S04 wizard | done | satu layar: nama (alias terisi otomatis), skema (daftar tabel dimuat ulang saat skema diganti; tanpa JS lewat tombol), batasi ke grup (opsional), pilih tabel/view dengan keterangan apa yang akan dibuat dan alasannya bila tidak bisa |
| Generator | done | per tabel: Interactive Report (FK ditampilkan sebagai nama dari tabel referensi lewat left join, maks 12 kolom, sort kolom teks pertama) + form dialog (`form_init` / `form_dml` / `close_dialog`, tombol Tambah, Hapus dengan konfirmasi) |
| Tipe kolom → item | done | angka → number, date → date, timestamp → datetime, boolean → switch, varchar > 250 → textarea, enum → select (LOV statis), FK → select (LOV SQL bersama per tabel referensi), bytea/json/array tidak dipakai, kolom generated tidak diedit, NOT NULL tanpa default → wajib |
| Aturan tabel | done | report + form bila ada PK dengan default (identity/serial/uuid default) dan role workspace punya INSERT/UPDATE/DELETE; report saja untuk view, tanpa PK, PK tanpa default, tanpa hak tulis, atau kolom wajib bertipe tak didukung; tidak bisa bila tanpa SELECT atau nama tabel perlu kutip |
| Beranda aplikasi | done | pemberitahuan bila workspace belum punya pengguna aplikasi (akun developer tidak bisa login ke aplikasi) |

Flow F01 diukur di e2e: dari beranda builder sampai Interactive Report hasil wizard tampil = **8 aksi** (buat aplikasi, nama,
centang tabel, buat, jalankan, nama pengguna, kata sandi, masuk), sesuai target recon. Form dialog hasil wizard menambah baris.

Verifikasi: `npm test` 124/124 (+7 di `test/b3.test.ts`, termasuk 11 tabel kasus tepi: enum, uuid, view, tanpa PK, PK komposit,
bytea wajib, tanpa hak SELECT, tanpa hak tulis, nama campur huruf besar), e2e 84/84 (+2 × 2 viewport, axe bersih),
screenshot `S04-wizard`, `S21-generated` (1440 dan 390). Parity 59.8 → 62.0, must-have 26/30.

Lebih sulit dari perkiraan:
- **PK alami** (tanpa default) belum bisa ditambah lewat form, karena engine menganggap PK terisi = ubah baris. Wizard jujur
  membuat report saja dan menulis alasannya; dukungan PK alami dicatat untuk nanti.
- **Hak akses dicek untuk role workspace**, bukan untuk koneksi builder (superuser), termasuk tabel referensi FK; kalau tidak,
  halaman yang dibuat wizard gagal saat dijalankan pengguna.
- **Tes kadang gagal saat teardown**: koneksi pool yang menganggur menerima "terminating connection" saat database tes di-drop,
  dan karena pool tidak punya listener `error`, Node menganggapnya error tak tertangani. Ini juga celah di produksi (restart
  database bisa mematikan server), jadi `createPool` sekarang memasang listener yang mencatat lalu melanjutkan.

Belum: wizard Create Page (B4), Page Designer (B5), dukungan PK alami di form.

## Fase 2 B4: wizard Create Page (2026-11-15), done (tanpa Interactive Grid)

| layar | status | catatan |
| --- | --- | --- |
| S07 wizard | done | dari beranda aplikasi (tombol *Tambah halaman* di region Halaman); jenis halaman sebagai kartu pilihan; field yang tidak relevan disembunyikan dengan JS (tanpa JS semua tampil, server mengabaikan yang tidak dipakai) |
| Report + form | done | dua nomor halaman (N dan N+1), form dialog, link baris + tombol Tambah |
| Report | done | dari tabel (termasuk tabel "report saja") atau dari query SQL; query dicoba dulu sebagai role workspace dengan skema parsing, semua bind `null`, `limit 0`, timeout 5 detik, di transaksi yang di-rollback; kolom dan tipenya diambil dari hasil itu |
| Form | done | dialog atau halaman biasa; setelah simpan/batal kembali ke halaman pilihan |
| Halaman kosong | done | satu region teks |
| Cara menyimpan | done | spec aplikasi diekspor, halaman ditambahkan, lalu diimpor lagi: lewat pemeriksaan yang sama dengan impor biasa dan tercatat di riwayat versi (`dev:<username>`) |

Aturan: nomor halaman 1–99998 dan belum dipakai (report + form butuh dua nomor); alias halaman unik; LOV yang sudah ada dengan nama
sama tetapi isi berbeda tidak ditimpa (LOV baru diberi akhiran, mis. `DEPARTEMEN_2`); query harus diawali SELECT/WITH, tidak boleh
lebih dari satu perintah, setiap kolom harus punya nama sederhana dan unik.

Flow F02 diukur di e2e: dari beranda aplikasi sampai halaman report + form tersimpan = **3 aksi** (tambah halaman, pilih tabel,
tambah), target recon sekitar 6.

Verifikasi: `npm test` 132/132 (+8 di `test/b4.test.ts`: halaman baru dipakai pengguna aplikasi, form normal kembali ke halaman 1,
report SQL dengan bind, 8 query yang ditolak tanpa mengubah data, 10 isian salah, isolasi workspace), e2e 86/86 (+1 × 2 viewport,
axe bersih), screenshot `S07` (1440 dan 390). Parity 62.0 → 63.0; must-have 26/30 selesai + 3 sebagian.

Lebih sulit dari perkiraan:
- **Memeriksa query tanpa menjalankannya.** `limit 0` di dalam subquery + transaksi yang di-rollback + role workspace mencegah
  perubahan data, termasuk CTE `delete … returning` (ditolak PostgreSQL di dalam FROM) dan beberapa perintah sekaligus (ditolak
  protokol extended).
- **Nama aksesibel kartu pilihan** awalnya berisi seluruh deskripsi, sehingga "Report" juga cocok dengan "Report + form" dan
  "query SQL". Judul kartu kini menjadi label, deskripsinya `aria-describedby`.

Belum: Interactive Grid di wizard (menunggu region IG di engine), classic report, hapus/ubah halaman (Page Designer, B5).

## Fase 2 B5: Page Designer + properti aplikasi (2026-11-15), done (tanpa drag-drop)

| layar | status | catatan |
| --- | --- | --- |
| S06 Page Designer | done | `/builder/apps/:alias/pages/:no`; kiri: pohon halaman (region → item, tombol, kolom; validasi, proses, branch, computation) dengan tombol tambah; kanan: editor properti komponen terpilih; pindah halaman lewat pilihan di atas pohon; tombol naik/turun/hapus; hapus halaman dengan ketik nomor |
| Editor properti | done | dibuat dari `spec.schema.json`: enum → select, boolean → (bawaan)/ya/tidak, integer → angka, SQL/HTML/kode → textarea mono, objek kecil (source, sort, chart) dipecah jadi field sendiri, struktur bersarang (kondisi, link, LOV, cascade) sebagai YAML; label dan bantuan dalam bahasa Indonesia, kunci spec ditampilkan kecil di samping label |
| S13 Properti aplikasi | done | `/builder/apps/:alias/properties`: semua atribut tingkat aplikasi kecuali alias dan halaman (menu, LOV, otorisasi, application items, computations, autentikasi sebagai YAML) |
| Beranda aplikasi | done | nama halaman membuka Page Designer, kolom *Jalankan* per halaman, tombol *Properti aplikasi* |

Setiap simpan: spec diekspor, satu komponen diubah, lalu diimpor lagi (pemeriksaan sama dengan impor, satu entri riwayat versi).
**Konflik antar developer** dicegah dengan token versi (spec hash): bila aplikasi berubah sejak form dibuka, simpan ditolak 409 dan isian
tetap di layar. Menghapus komponen yang masih dirujuk (mis. item yang dipakai link report) ditolak dengan daftar letak rujukannya.

Verifikasi: `npm test` 142/142 (+10 di `test/b5.test.ts`), e2e 90/90 (+2 × 2 viewport, axe bersih), screenshot `S06`, `S13`
(1440 dan 390). Parity 63.0 → 68.1; must-have 29/30 (sisa: Create Page wizard tanpa Interactive Grid).

Lebih sulit dari perkiraan:
- **Editor generik tanpa kehilangan data.** Komponen disalin utuh lalu hanya field yang tampil yang ditimpa, sehingga anak (item di
  region, region di halaman) dan atribut lain tidak hilang; urutan kunci dipertahankan agar ekspor tetap rapi.
- **Bug tata letak di HP yang baru terlihat dengan tombol ketiga**: aksi di kepala halaman tidak turun baris dan membuat halaman
  bisa digeser ke samping di 390 px. `.r-page-head__actions` kini `flex-wrap`.
- **Deskripsi di JSON Schema berbahasa Inggris** (untuk penulis spec); editor memakai teks bantuan sendiri.

Belum: drag-drop grid tata letak, kunci halaman eksplisit, undo (riwayat versi bisa diunduh dan diimpor ulang).

## Checkpoint 2 (2026-11-15)

Builder B1–B5 dan perbaikan CLI (PR #9–#16) di-merge. `npm test` 144/144, e2e 90/90 (2 skip), parity 68.1, must-have 29/30.
Dicoba di laptop Windows pengguna (Cmder, PostgreSQL portable): migrasi, setup, dan builder berjalan; satu temuan
(`error:` kosong saat PostgreSQL belum menyala) diperbaiki di #16. Dokumen: `docs/checkpoint-fase2.md` (memperbarui,
checklist, yang belum ada) dan `docs/panduan-pengguna.md` (cara pakai builder dan aplikasi).

## Uji menyeluruh Fase 2: builder B1–B5 (2026-11-15), done

17 kasus edge baru (`test/f2-edge.test.ts`, `e2e/f2-edge.spec.ts`). Dua bug ditemukan dan diperbaiki di `03e4211`:
BUG-009 (S2) penyimpanan bersamaan dari versi yang sama menghapus satu perubahan tanpa pemberitahuan. Sekarang versi dicek di
dalam transaksi impor dengan advisory lock per aplikasi. BUG-010 (S3): setelah sesi berakhir, login kembali ke halaman form,
tidak lagi ke beranda. `npm test` 156/156, e2e 96/96 (2 skip). Tidak ada S1/S2 terbuka.

## Pengerasan operasional (2026-11-15), done

| bagian | status | catatan |
| --- | --- | --- |
| Pembersihan session | done | engine menghapus session aplikasi dan developer yang kedaluwarsa atau idle tiap `RPX_PURGE_MINUTES` (bawaan 15), per batch, satu instance sekaligus; `rpx session purge` untuk cron |
| Log akses | done | nilai argumen URL diganti `*` (item, pencarian, kode OIDC); nama argumen dan jalur tetap |
| Keep-alive | done | `GET /r/:ws/:app/keepalive` dan `/builder/keepalive`; `rpx.js` mengirim paling sering tiap 5 menit dan hanya bila ada ketikan/klik sejak kiriman terakhir; berhenti setelah 401; halaman login tidak mengirim |
| Backup / restore | done | `rpx backup [--dir] [--keep]`, `rpx restore <file> --to <db>`; `backup-lokal.cmd`; service `rpx` (profil tools) di Compose, image memuat `pg_dump` 16 dari PGDG; panduan `docs/operasional.md` |

Verifikasi: `test/ops.test.ts` (10 tes) dan `e2e/ops-keepalive.spec.ts` (3 × 2 viewport, memakai jam palsu Playwright). Alur Docker
dijalankan sungguhan: backup, merusak data, restore ke `rpx_restore`, tukar nama database, lalu restore ke server baru (volume
kosong) yang membuat ulang role `rpx_engine`, `rpx_user_code`, `ws_demo`, `ws_pandawa`.

Lebih sulit dari perkiraan:
- **Role bukan bagian dari database.** `pg_dump` satu database tidak membawa role, sehingga restore di server lain kehilangan
  semua grant ke `ws_*` dan aplikasinya gagal. `pg_dumpall --roles-only` membawa semua role cluster dan, saat dipulihkan,
  menimpa kata sandi role yang sudah ada (termasuk `postgres`). Jadi file role dibuat sendiri dari `pg_shdepend`: hanya role
  yang dirujuk database ini, dibuat bila belum ada, tanpa SUPERUSER/CREATEROLE/CREATEDB, dan role yang sudah ada tidak disentuh.
- **Bentuk `DATABASE_URL` lewat socket** (`postgres://user@/db?host=/dir`, dipakai di panduan Linux) ditolak `new URL()`.
  Koneksi untuk `pg_dump` kini diurai oleh `pg` sendiri.
- **`pg_dump` harus sama versinya dengan server.** Debian di image `node:22-slim` membawa klien 15, server 16; image kini
  memasang klien 16 dari repositori PGDG.
- **`pg_restore` yang lebih baru daripada server** (di CI: klien 17/18, server 16) membuka koneksi dengan `SET
  transaction_timeout`, yang tidak dikenal server 16. Dalam satu transaksi itu membatalkan semuanya. Restore mencoba dulu
  secara atomik; bila gagal hanya karena parameter tak dikenal, diulang per perintah dan diterima hanya bila itu
  satu-satunya jenis error. Error lain menggagalkan restore dan database yang baru dibuat dihapus lagi.
- **Keep-alive tanpa melemahkan batas idle.** Mengirim tanda selama tab terbuka akan membuat laptop yang ditinggal tetap
  login sampai 8 jam. Tanda hanya dikirim bila ada aktivitas sejak kiriman sebelumnya.

`backup-lokal.cmd` dijalankan di laptop Windows pengguna (2026-11-15): berhasil. Temuan: `start-pg.bat` diakhiri `pause`,
yang akan menahan backup terjadwal; skrip kini memanggilnya dengan `< nul`. Belum: jadwal Task Scheduler.

## Dynamic Actions tahap 1 (2026-11-17), done (tanpa execute server code)

Event `change`, `key_release`, `click` (tombol `defined_by_da`), `page_load`; kondisi di browser (`item_equals`,
`item_not_equals`, `item_in`, `item_not_in`, `item_null`, `item_not_null`) dengan cabang `actions`/`else`; aksi `show`, `hide`,
`enable`, `disable`, `set_value` (nilai tetap atau dari item lain), `clear`, `refresh`, `confirm`, `submit_page`; `on_load`.
Disimpan di tabel `rpx.dynamic_actions`/`rpx.da_actions` yang sudah ada sejak 0001 (tidak ada migrasi baru), ikut ekspor/impor,
dan bisa diubah sebagai YAML di Page Designer. Sensus komponen: 78.2% → 82.1%.

Verifikasi: `npm test` 195/195 (+24 di `test/da.test.ts`, kitchen sink ekspor dengan dynamic action, Page Designer), e2e 112/112
(+5 × 2 viewport di `e2e/da.spec.ts`, axe bersih). Parity 68.1 → 68.8. Contoh: emp halaman 2 (Magang menyembunyikan Keahlian)
dan halaman 4 (tombol *Kosongkan isian*); aplikasi uji `e2e/da-app.yaml`.

Yang lebih sulit dari perkiraan:

- **REQUEST dari browser.** Server hanya menerima REQUEST dari tombol yang dirender (ditandatangani di form). Request
  `submit_page` ikut ditandatangani, tetapi hanya untuk dynamic action yang tombolnya memang tampil; nama tombol lain
  tidak boleh dipakai sebagai request, supaya kondisi dan otorisasi tombol itu tidak bisa dilewati.
- **Field yang di-disable.** Browser tidak mengirim field disabled; untuk checkbox itu berarti "dikosongkan" di server.
  Field yang di-disable dynamic action diaktifkan lagi tepat sebelum submit, jadi nilainya tetap terkirim.
- **Keadaan setelah halaman dimuat ulang sebagian.** Setelah dialog ditutup (refresh isi halaman) dan setelah cascading
  LOV mengganti field, aksi `on_load` dijalankan lagi supaya field yang tersembunyi tidak muncul kembali.

Belum (DA2): `execute_server_code` dengan items to submit/return, refresh dengan nilai item terbaru, editor formulir.

## Dynamic Actions tahap 2 (2026-11-18), done (tanpa editor formulir)

`execute_server_code` dengan `code`, `items_to_submit`, `items_to_return`; `refresh` dengan `items_to_submit`. Disimpan di
kolom `items_to_submit`/`items_to_return` dan `attributes.code` tabel `rpx.da_actions` (sudah ada sejak 0001, tanpa migrasi).
Endpoint baru `POST /r/:ws/:app/:page/da` (JSON). Contoh: emp halaman 4 (posisi karyawan saat dipilih), aplikasi uji
`e2e/da-app.yaml` (total gaji, filter report).

Verifikasi: `npm test` 211/211 (+16 di `test/da-server.test.ts`), e2e 118/118 (+3 × 2 viewport, axe bersih).
Parity 68.8 → 70.3.

Yang lebih sulit dari perkiraan:

- **Siapa boleh memanggil apa.** Browser hanya menyebut nama dynamic action dan urutan aksinya; kode diambil dari definisi
  halaman. Daftar dynamic action yang dikirim ke browser ikut ditandatangani di form state (`__ps`), sehingga dynamic action
  yang tombolnya tersembunyi (kondisi/otorisasi) tidak bisa dipanggil walau namanya ditebak.
- **Hidden item terlindungi ikut tanda tangan form state.** Panggilan pertama ditolak 403 karena nilainya tidak ikut
  terkirim; `rpx.js` kini selalu menyertakan hidden item halaman.
- **Cascading LOV saat nilai dicek.** Nilai yang dikirim harus sudah ada di session state sebelum dicek, kalau tidak popup LOV
  yang difilter item lain menolak pilihan yang sah. Bila ada yang gagal, session state dikembalikan ke keadaan sebelumnya.

Belum (DA3): editor formulir di Page Designer, aksi `focus` dan `alert`.
