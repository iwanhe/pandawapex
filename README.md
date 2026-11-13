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
- [Build log](replica/build-log.md)
