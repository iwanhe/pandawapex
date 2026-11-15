# pandawapex

Low-code runtime ala Oracle APEX di atas **PostgreSQL**, untuk kebutuhan internal KCSI / Tim PANDAWA.
Clean-room: dibangun dari dokumentasi publik dan pengamatan perilaku, tanpa kode, aset, atau nama milik Oracle.

> **Status: Fase 2, checkpoint 2** (builder B1–B5), ditambah uji menyeluruh builder dan panduan demo publik lewat
> Cloudflare Tunnel. Yang sudah bisa: menjalankan aplikasi (report, form, dialog, daftar pilihan, otorisasi, SSO) dan
> membuatnya dari builder visual (wizard dari tabel, Page Designer, akun, ekspor/impor).
> Belum ada: Interactive Grid, Dynamic Actions, drag-drop tata letak ([daftar lengkap](docs/checkpoint-fase2.md#yang-belum-ada)).

## Mulai dari sini

Baru pertama kali? Pilih baris yang sesuai, lalu ikuti dokumennya dari atas ke bawah.

| Saya ingin… | Baca | Waktu |
| --- | --- | --- |
| memasang di laptop Windows dengan **Cmder + PostgreSQL portable** (cara Tim PANDAWA) | [docs/checkpoint-fase1.md](docs/checkpoint-fase1.md) | ± 15 menit |
| memasang dengan **Docker** (Windows, Linux, macOS) | [docs/install-lokal.md, bagian A](docs/install-lokal.md#a-docker-compose) | ± 10 menit |
| memasang di Windows dengan **PostgreSQL installer + PowerShell** | [docs/install-lokal.md, bagian B](docs/install-lokal.md#b-windows-dengan-postgresql-installer-powershell) | ± 15 menit |
| memasang di **Linux / macOS tanpa Docker** | [docs/install-lokal.md, bagian C](docs/install-lokal.md#c-linux-atau-macos-tanpa-docker) | ± 15 menit |
| **memperbarui** instalasi yang sudah ada ke versi terbaru | [docs/install-lokal.md#memperbarui-ke-versi-terbaru](docs/install-lokal.md#memperbarui-ke-versi-terbaru) | ± 5 menit |
| membuat **aplikasi pertama** dari tabel sendiri | [docs/panduan-pengguna.md, bagian 2](docs/panduan-pengguna.md#2-tutorial-aplikasi-pertama-dari-tabel-sendiri) | ± 20 menit |
| memakai builder sehari-hari (wizard, Page Designer, akun, ekspor) | [docs/panduan-pengguna.md](docs/panduan-pengguna.md) | |
| membuat **backup**, memulihkan, memahami session dan log | [docs/operasional.md](docs/operasional.md) | ± 15 menit |
| membuka demo ke **internet** lewat Cloudflare Tunnel | [docs/cloudflare-local-demo.md](docs/cloudflare-local-demo.md) | ± 30 menit |
| memindahkan aplikasi APEX ke pandawapex | [examples/demo-permintaan/PORTING.md](examples/demo-permintaan/PORTING.md) | |
| mengubah kode pandawapex (tes, struktur folder) | bagian [Tes](#tes) dan [Struktur](#struktur) di bawah | |

Setelah terpasang, alamat yang dipakai (port bawaan 8080):

| Yang dibuka | Alamat | Login bawaan |
| --- | --- | --- |
| Builder (untuk developer) | http://localhost:8080/builder | workspace `pandawa` atau `demo`, user `admin` |
| Aplikasi pilot DEMO Permintaan Barang | http://localhost:8080/r/pandawa/demo | `admin`, `budi`, `sari`, `dodi`, `gudang` |
| Aplikasi contoh Data Karyawan | http://localhost:8080/r/demo/emp | `admin`, `tamu` |

Semua akun contoh memakai kata sandi yang Anda isi di `RPX_DEMO_PASSWORD` saat instalasi.

## Cara kerja singkat

1. Developer membuat aplikasi di builder (`/builder`), atau menulisnya sebagai YAML (`examples/emp/app.yaml`):
   page, region, item, button, proses, branch. Builder juga menyimpan setiap perubahan sebagai spec YAML.
2. Spec divalidasi lalu disimpan ke tabel metadata `rpx.*` (lewat builder atau `rpx app import`), dengan riwayat versi.
3. Engine (Node + Fastify) merender page dari metadata, menyimpan session state di PostgreSQL, dan menjalankan
   SQL/PL/pgSQL milik developer di bawah role workspace (`ws_*`), bukan sebagai role engine.

Bind variable ala APEX (`:P2_EMPNO`) diterjemahkan ke parameter PostgreSQL (`$1`) untuk SQL,
atau ke `rpx_rt.v('P2_EMPNO')` di dalam blok PL/pgSQL.

## Builder

Builder ada di `/builder` dan memakai **akun developer**, yang terpisah dari akun pengguna aplikasi. `demo setup` dan
`pilot setup` membuat developer `admin`; developer lain dibuat dari menu **Developer** di builder atau dengan
`npm run rpx -- dev add`. Panduan lengkap: [docs/panduan-pengguna.md](docs/panduan-pengguna.md).

| Di builder | Isi |
| --- | --- |
| Beranda, Aplikasi | ringkasan workspace, daftar aplikasi, impor/ekspor spec YAML, riwayat versi, hapus aplikasi |
| Buat aplikasi | wizard dari tabel: Interactive Report + form dialog per tabel |
| Tambah halaman | report + form, report dari tabel atau query SQL, form, halaman kosong |
| Page Designer | struktur halaman + editor properti untuk semua atribut spec; simpan bersamaan oleh dua developer terdeteksi |
| Properti aplikasi | nama, beranda, substitution strings, menu, LOV, otorisasi, application items |
| Pengguna aplikasi, Developer, Akun saya | akun login aplikasi dan grupnya, akun developer, ganti kata sandi |

## Perintah CLI

Dijalankan dari folder repo. Semua perintah kecuali `app check` butuh `DATABASE_URL` (user PostgreSQL superuser/pemilik database).

```bash
npm run rpx -- db migrate                                   # pasang migrasi database terbaru
npm run rpx -- demo setup                                   # aplikasi contoh Data Karyawan (workspace demo)
npm run rpx -- pilot setup                                  # pilot DEMO Permintaan Barang (workspace pandawa)
npm run rpx -- ws create gudang --schema gudang_app         # workspace baru + role ws_gudang + akses ke skema
npm run rpx -- app check apps/penerimaan.yaml               # periksa spec tanpa database
npm run rpx -- app import apps/penerimaan.yaml --ws gudang  # impor atau ganti aplikasi
npm run rpx -- app export demo --ws pandawa --out demo.yaml # ekspor spec aplikasi
npm run rpx -- user add --ws gudang --username sri --password 'min-10-karakter' --group Gudang
npm run rpx -- dev add --ws gudang --username budi --password 'min-10-karakter' --admin
npm run rpx -- backup --keep 14                             # backup database + role ke folder backups
npm run rpx -- restore backups/<file>.dump --to rpx_restore # pulihkan ke database baru (tidak menimpa yang berjalan)
npm run rpx -- session purge                                # hapus session kedaluwarsa (server juga melakukannya otomatis)
```

Pada instalasi Docker, perintah yang sama dijalankan dengan `docker compose run --rm rpx <perintah>`,
mis. `docker compose run --rm rpx backup --keep 14`.

Detail tiap perintah: [panduan-pengguna.md, bagian 11](docs/panduan-pengguna.md#11-perintah-cli).

## Konfigurasi

Engine dan CLI dikonfigurasi lewat variabel lingkungan. Daftar lengkap dengan penjelasan ada di [`.env.example`](.env.example).

| Variabel | Untuk | Kapan diisi |
| --- | --- | --- |
| `DATABASE_URL` | koneksi superuser/pemilik untuk CLI (migrasi, setup, impor) | selalu, saat menjalankan `npm run rpx` |
| `RPX_DATABASE_URL` | koneksi engine; bila kosong memakai `DATABASE_URL` | produksi/demo publik: role `rpx_engine` |
| `RPX_SECRET` | kunci acak ≥ 32 karakter untuk checksum URL dan form | selalu (`start-lokal.cmd` membuatnya otomatis) |
| `PORT`, `HOST` | port dan alamat dengar (bawaan `8080`, `0.0.0.0`; `start-lokal.cmd` memakai `127.0.0.1`) | port 8080 sudah dipakai |
| `RPX_PURGE_MINUTES` | selang pembersihan session kedaluwarsa, dalam menit (bawaan `15`; `0` = mati) | jarang perlu diubah |
| `PGHOME` | folder PostgreSQL, untuk `rpx backup` / `rpx restore` bila `pg_dump` tidak ada di PATH | Windows |
| `RPX_SECURE_COOKIES` | `1` = cookie hanya lewat HTTPS | di balik HTTPS |
| `RPX_PUBLIC_URL` | alamat publik, untuk callback SSO | di balik domain / SSO |
| `RPX_TRUST_PROXY` | proxy yang dipercaya untuk IP klien: `true` (bawaan), `false`, `1` | `1` di balik Cloudflare Tunnel |
| `RPX_BUILDER_HOSTS` | hostname yang boleh membuka builder; `none` = builder mati | demo publik |

Untuk pemakaian lokal biasa, empat variabel terakhir (`RPX_SECURE_COOKIES` sampai `RPX_BUILDER_HOSTS`) tidak perlu diisi.
Demo publik:
[docs/cloudflare-local-demo.md](docs/cloudflare-local-demo.md).

SSO (Microsoft Entra ID / Google Workspace / IdP OIDC lain): lihat [replica/backend.md](replica/backend.md#konfigurasi-sso-di-spec).

## Aturan spec yang perlu diketahui developer APEX

- **Bind selalu bertipe text** (seperti VARCHAR2 di APEX). Cast sendiri bila perlu: `where empno = :P2_EMPNO::int`, `:P2_GAJI::numeric > 0`.
- **String kosong disimpan sebagai NULL**, jadi `:P1_CARI is null` berperilaku seperti di APEX.
- **Form wajib punya primary key** (tidak ada ROWID di PostgreSQL). Tandai item PK dengan `source: { column: ..., pk: true }`.
- **Proses `form_dml`**: tombol bernama `DELETE` atau `HAPUS` menghapus baris. Tombol lain menyisipkan baris bila PK kosong, atau memperbarui bila PK terisi.
- **Kode PL/pgSQL** ditulis sebagai isi blok (boleh dengan `declare ... begin ... end;`). Baca item dengan `:P1_X`, tulis dengan `perform rpx_rt.set_item('P1_X', nilai)`.
- Nama item `P{halaman}_NAMA`, huruf besar, unik per aplikasi. `rpx app check file.yaml` memvalidasi tanpa database.
- **Otorisasi**: definisikan sekali di `authorization:` (mis. `type: group_member, source: SDM`), lalu pasang dengan `authorization: <nama>` di page, region, item, tombol, atau entri menu. Link dan tombol ke page yang tidak boleh dibuka otomatis disembunyikan. Grup berasal dari `rpx user add --group` atau klaim grup SSO.
- **Computations**: app (`on_new_session`, `after_authentication`, `before_header`) dan page (`before_header` setelah form init, `after_submit` sebelum validasi). Tipe `plpgsql_fn` adalah isi fungsi dengan `return ...;`.
- **Kondisi**: `condition: { item_equals: { item: P1_MODE, value: edit } }`, `request_equals`, `sql_exists`, `sql_expression`, `item_null`, `item_not_null`, `never`.
- **Substitusi** `&ITEM.` selalu di-escape. Gunakan `&ITEM!RAW.` hanya untuk HTML yang memang Anda percaya.
- **Modal**: `mode: modal` pada page membuat link ke page itu terbuka sebagai dialog. Tambahkan proses `{ type: close_dialog }` agar setelah simpan dialog tertutup dan daftar di belakangnya ter-refresh; tombol `action: close_dialog` = Batal.
- **Interactive Report**: `type: interactive_report` + `source.sql`. Kolom bisa diberi `searchable`, `sortable`, `format: number|integer|date`; unduhan CSV/Excel dibatasi `max_download_rows` (default 10.000).
- **Contoh porting dari APEX**: `examples/demo-permintaan/` (17 halaman, approval 2 level, package → skema PL/pgSQL). Pola terjemahan dan celah yang tersisa ada di `PORTING.md`; pasang dengan `npm run rpx -- pilot setup`.
- **Chart**: `type: chart`, `chart: { type: bar | pie }`, `source.sql` mengembalikan `label, value`.
- **Item read-only**: `read_only: <kondisi>` menampilkan item sebagai teks dan mengabaikan nilai kirimannya. Kondisi `request_in: [SAVE, CREATE]` untuk tombol yang ditekan.
- **Item & daftar pilihan (M3)**: `select`, `popup_lov` (dialog pencarian), `radio`, `checkbox_group` (nilai digabung `:`), `checkbox`/`switch` (`on_value`/`off_value`, default `Y`/`N`), `date`, `datetime`, `display_only` (`format`). Daftar pilihan ditulis langsung di item (`lov: { sql: ... }` / `static`) atau sekali di `lovs:` lalu dipakai dengan namanya (`lov: DEPARTEMEN`). `cascade: [P4_DEPT]` memuat ulang daftar anak saat parent berubah. Server selalu menolak nilai yang tidak ada di daftar, angka yang bukan angka, dan tanggal yang tidak valid.
- **Validasi**: selain `not_null`, `regex`, `sql_*`, ada `fn_boolean` (isi fungsi PL/pgSQL, `return true` = valid), `fn_returns_error` (mengembalikan teks error atau `null`), `is_numeric`, `is_date`, `is_timestamp`.

## Tes

Butuh role PostgreSQL yang boleh `CREATE DATABASE` dan `CREATE ROLE` (superuser lokal). Setiap file tes membuat database
sementara sendiri lalu menghapusnya.

```bash
export TEST_DATABASE_URL=postgres://postgres@localhost/postgres   # Windows cmd: set "TEST_DATABASE_URL=..."
npm run typecheck        # pemeriksaan tipe TypeScript
npm test                 # unit + integrasi (node:test) terhadap PostgreSQL nyata

npx playwright install chromium   # sekali saja, mengunduh browser untuk tes e2e
npm run e2e              # tes browser (desktop 1440 px + mobile 390 px), dengan pemeriksaan aksesibilitas axe
```

Tes e2e menjalankan server sendiri di port 8099 dengan database `rpx_e2e`. CI (`.github/workflows`) menjalankan semua
langkah di atas plus instalasi Docker untuk setiap pull request.

## Struktur

```
db/migrations/      migrasi SQL (0001 = schema rpx + rpx_rt, ..., 0006 = builder)
src/engine/         server, session, render halaman, proses, bind translator, report & form
src/spec/           JSON Schema spec + importer YAML -> rpx.* + exporter rpx.* -> YAML
src/builder/        builder (/builder): login & sesi developer, akun, wizard Create App / Create Page,
                    Page Designer + properti aplikasi, introspeksi tabel, generator halaman, impor/ekspor
src/cli/            rpx db migrate | ws create | app import/export/check | user add | dev add | demo/pilot setup |
                    backup | restore | session purge
src/client/         tokens.css + components.css (design system) + rpx.js (perilaku di browser)
examples/emp/       aplikasi contoh Data Karyawan (report + form dialog)
examples/demo-permintaan/  pilot porting dari APEX (17 halaman, approval 2 level)
docs/               instalasi, panduan pengguna, panduan operasional, checkpoint, demo publik
test/               tes integrasi (node:test) terhadap PostgreSQL nyata
e2e/                tes browser Playwright
tools/              skrip pendukung: skor parity, sensus komponen APEX, diff screenshot
replica/            dokumen perencanaan: recon, arsitektur, design system, build log, test plan, bugs
Dockerfile, docker-compose.yml, docker-compose.cloudflare.yml   instalasi Docker dan overlay Cloudflare Tunnel
start-lokal.cmd     menjalankan pandawapex di Windows tanpa Docker (Cmder)
backup-lokal.cmd    backup database di Windows tanpa Docker (bisa dijadwalkan dengan Task Scheduler)
.env.example        daftar semua variabel lingkungan
```

## Dokumen

- [Instalasi lokal](docs/install-lokal.md) · [Checkpoint 1: Windows + Cmder dari nol](docs/checkpoint-fase1.md) · [Checkpoint 2: builder](docs/checkpoint-fase2.md)
- [Panduan penggunaan](docs/panduan-pengguna.md) · [Panduan operasional: backup, restore, session, log](docs/operasional.md) · [Demo publik via Cloudflare Tunnel](docs/cloudflare-local-demo.md) · [Porting dari APEX](examples/demo-permintaan/PORTING.md)
- [Recon map](replica/recon.md) · [Feature matrix](replica/features.csv)
- [Arsitektur](replica/architecture.md) · [Schema](db/migrations/0001_schema.sql)
- [Design system](replica/design/components.md)
- [Build log](replica/build-log.md) · [Test plan](replica/test-plan.md) · [Bugs](replica/bugs.md) · [Parity](replica/parity.md)
