# pandawapex

Low-code runtime ala Oracle APEX di atas **PostgreSQL**, untuk kebutuhan internal KCSI / Tim PANDAWA.
Clean-room: dibangun dari dokumentasi publik dan pengamatan perilaku, tanpa kode, aset, atau nama milik Oracle.

> Status: **Fase 1, M0–M1**. Runtime membaca aplikasi dari spec YAML; builder visual menyusul di Fase 2.

## Cara kerja singkat

1. Developer menulis aplikasi sebagai YAML (`examples/emp/app.yaml`): page, region, item, button, proses, branch.
2. `rpx app import` memvalidasi spec dan menyimpannya ke tabel metadata `rpx.*`.
3. Engine (Node + Fastify) merender page dari metadata, menyimpan session state di PostgreSQL, dan menjalankan
   SQL/PL/pgSQL milik developer di bawah role workspace (`ws_*`), bukan sebagai role engine.

Bind variable ala APEX (`:P2_EMPNO`) diterjemahkan ke parameter PostgreSQL (`$1`) untuk SQL,
atau ke `rpx_rt.v('P2_EMPNO')` di dalam blok PL/pgSQL.

## Menjalankan lokal

Cara tercepat (Docker Compose, tanpa SSO) dan cara Windows tanpa Docker: **[docs/install-lokal.md](docs/install-lokal.md)**.

Manual, langkah demi langkah:

Prasyarat: Node.js ≥ 22.18 (TypeScript dijalankan langsung lewat type stripping), PostgreSQL ≥ 16.

```bash
npm install
export DATABASE_URL=postgres://postgres@localhost/rpx     # role superuser/owner untuk migrasi & CLI
export RPX_SECRET=$(openssl rand -hex 32)                 # kunci HMAC checksum URL & item

npm run rpx -- db migrate
npm run rpx -- ws create demo --schema demo_app
psql "$DATABASE_URL" -f examples/emp/seed.sql             # tabel contoh di schema demo_app
npm run rpx -- app import examples/emp/app.yaml --ws demo
npm run rpx -- user add --ws demo --username iwan --password 'rahasia123'

npm run dev                                               # http://localhost:8080/r/demo/emp/1
```

Semua variabel lingkungan ada di [`.env.example`](.env.example). Untuk produksi, jalankan engine dengan role `rpx_engine` (`RPX_DATABASE_URL`), bukan superuser, dan set `RPX_SECURE_COOKIES=1` serta `RPX_PUBLIC_URL` di balik HTTPS.

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

```bash
# butuh role PostgreSQL yang boleh CREATE DATABASE dan CREATE ROLE (superuser lokal)
export TEST_DATABASE_URL=postgres://postgres@localhost/postgres
npm test            # unit + integrasi; tiap file tes membuat database sementara
npm run typecheck
```

## Struktur

```
db/migrations/      migrasi SQL (0001 = schema rpx + rpx_rt)
src/engine/         server, session, render (show), accept, bind translator, report & form
src/spec/           JSON Schema spec + importer YAML -> rpx.*
src/cli/            rpx db migrate | ws create | app import | user add
src/client/         tokens.css + components.css (design system) + rpx.js
examples/emp/       aplikasi contoh (report + form karyawan)
test/               tes integrasi (node:test) terhadap PostgreSQL nyata
replica/            dokumen perencanaan: recon, arsitektur, design system, build log
```

## Dokumen

- [Recon map](replica/recon.md) · [Feature matrix](replica/features.csv)
- [Arsitektur](replica/architecture.md) · [Schema](db/migrations/0001_schema.sql)
- [Design system](replica/design/components.md)
- [Build log](replica/build-log.md) · [Test plan](replica/test-plan.md) · [Bugs](replica/bugs.md) · [Parity](replica/parity.md)
