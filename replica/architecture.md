# Architecture: REPLICA APEX ("rpx", nama kerja), low-code runtime ala Oracle APEX di atas PostgreSQL

Sumber: `replica/recon.md`, `replica/features.csv` (2026-11-13). Fokus dokumen ini: **Fase 1**, yaitu runtime engine yang
membaca spec YAML, tanpa builder visual. Builder (Fase 2) hanya disinggung sejauh mempengaruhi keputusan sekarang.

## Prinsip

1. **Satu proses, satu database.** Tidak ada microservice. Engine adalah satu service Node yang stateless, sedangkan
   seluruh state (metadata, session, session state) ada di PostgreSQL.
2. **Metadata-driven seperti APEX, tapi engine di luar database.** APEX menjalankan engine-nya di dalam Oracle DB (PL/SQL,
   lewat ORDS). Replika menjalankan engine di app server. Kode milik developer (SQL & PL/pgSQL) tetap dieksekusi di PostgreSQL
   di bawah role workspace.
3. **Spec file adalah source of truth (Fase 1).** Aplikasi didefinisikan sebagai YAML di Git, lalu di-import ke tabel `rpx.*`.
   Builder Fase 2 menulis ke tabel yang sama dan bisa meng-export YAML yang sama.

## Stack

| layer | choice | why |
| --- | --- | --- |
| runtime | **Node.js 22 LTS + TypeScript, Fastify** | Tim sudah fasih JS/TS (Oracle JET, React/Vite di Access Vault), sehingga runtime dan builder Fase 2 memakai satu bahasa. Bottleneck ada di DB, bukan CPU, jadi keunggulan Go tidak sebanding dengan biaya belajar tim. Fastify: cepat, schema-validated routes, plugin system. |
| rendering | **Server-side HTML** (template engine Eta untuk theme) + pass substitusi sendiri untuk `&ITEM.` / `#COL#` | Model APEX memang server-rendered. SEO tidak relevan, tetapi first paint cepat dan tidak perlu SPA build per aplikasi. |
| client runtime | **htmx** untuk partial refresh region (IR paging/sort/filter, cascading LOV) + `rpx.js` kecil (vanilla TS) untuk modal dialog, notifikasi, dan nanti Dynamic Actions | Tanpa framework SPA. Region refresh = request GET yang mengembalikan potongan HTML, sama seperti perilaku APEX. |
| styling | CSS custom properties dari `/replica-design`, tanpa Universal Theme | Aset Universal Theme milik Oracle. |
| database | **PostgreSQL 16+**: on-prem KCSI, atau RDS untuk CLA Group (GLT/KDK) | Satu cluster: schema `rpx` (engine), `rpx_rt` (helper untuk user code), dan schema aplikasi per workspace. |
| DB access | **`pg` (node-postgres) + SQL mentah**, tanpa ORM | Engine mengeksekusi SQL dinamis milik developer. ORM tidak membantu dan justru menghalangi. Query metadata cukup sedikit, cukup ditulis manual dengan interface TS. |
| SQL translation | `bind.ts` (tokenizer sendiri, **sudah diprototipekan & dites**) | `:P1_X` → `$n` (SQL) atau `rpx_rt.v('P1_X')` (PL/pgSQL). Lihat `prototype/`. |
| spec | YAML (`yaml`) + JSON Schema (`ajv`) | Git-friendly dan bisa di-diff. Dengan begitu konsep APEXlang diadopsi tanpa memakai formatnya. |
| auth | Built-in accounts (`@node-rs/argon2`) + **OIDC** (`openid-client`) untuk Entra ID / Google Workspace KCSI | Dua scheme yang dibutuhkan subsidiary. Header-auth bisa ditambahkan untuk SSO di balik reverse proxy. |
| session | Cookie `rpx_sid` (httpOnly, Secure, SameSite=Lax) → `rpx.sessions`; item → `rpx.session_state` | Tidak ada session id di URL. Tetap stateless di app server, sehingga bisa scale ke >1 instance. |
| email | Nodemailer via SMTP relay internal | `could` di Fase 1; padanan `APEX_MAIL` sederhana. |
| jobs | Scheduler in-process (`croner`) + `pg_try_advisory_lock` agar hanya satu instance yang menjalankan | Tidak perlu infra tambahan. Bisa diganti `pg_cron` jika DBA mengizinkan. |
| files | Fase 1: tidak ada. Fase 2: S3-compatible (R2/S3/MinIO) | Upload item ada di `should`. |
| hosting | **Docker** di server KCSI di balik **Cloudflare Tunnel** (pola infra yang sudah dipakai); ECS/EC2 untuk CLA Group | Bukan Vercel: engine butuh connection pool yang hidup lama dan akses ke DB intranet. |
| payments | — | Produk internal. |
| tests | `node:test` (unit + integrasi ke PG nyata), Playwright untuk flow F04/F09 | Prototipe bind translator sudah dites dengan pola ini. |

Struktur repo (pnpm workspaces):

```
rpx/
  packages/engine/    render, accept, session, bind, IR engine, auth
  packages/spec/      JSON Schema + importer/exporter YAML <-> rpx.*
  packages/cli/       rpx ws create | app import | app export | user add
  packages/client/    rpx.js + htmx glue + CSS tokens
  apps/builder/       (Fase 2) React builder
  db/migrations/      0001_schema.sql, ...
  examples/emp/       spec contoh + data contoh
```

## Contoh spec (Fase 1)

```yaml
app: emp
name: Employees
parsing_schema: kdk_app
auth: { current: accounts, schemes: [ { name: accounts, type: builtin_accounts } ] }
pages:
  - page: 1
    name: Employees
    regions:
      - static_id: emp
        type: interactive_report
        source: { type: sql, sql: "select empno, ename, sal from emp where (:P1_MIN is null or sal >= :P1_MIN::numeric)" }
        columns:
          - { name: EMPNO, label: "#", is_pk: true, link: { page: 2, items: { P2_EMPNO: "#EMPNO#" }, clear_cache: "2" } }
          - { name: ENAME, label: Name }
          - { name: SAL,   label: Salary, data_type: number, format_mask: "999G999G990D00" }
  - page: 2
    name: Employee
    mode: modal
    regions:
      - static_id: emp_form
        type: form
        source: { type: table, table: emp }
        items:
          - { name: P2_EMPNO, type: hidden, source: { column: EMPNO, pk: true } }
          - { name: P2_ENAME, type: text, label: Name, required: true, source: { column: ENAME } }
          - { name: P2_SAL,   type: number, label: Salary, source: { column: SAL } }
    buttons:
      - { name: SAVE, label: Save, hot: true }
    validations:
      - { name: sal_positive, type: sql_expression, expression: ":P2_SAL::numeric > 0", error_msg: "Salary must be positive", item: P2_SAL }
    processes:
      - { name: init, point: before_header, type: form_init, region: emp_form }
      - { name: dml,  point: after_submit,  type: form_dml,  region: emp_form }
      - { name: close, point: after_submit, type: close_dialog, when_button: SAVE }
```

## Schema

Tables: **29** di schema `rpx` (21 metadata, 8 runtime) + 7 fungsi helper di `rpx_rt`. Lengkap di `replica/schema.sql`
(**sudah dijalankan & dites di PostgreSQL 16.15**).

| kelompok | tabel |
| --- | --- |
| workspace & user | `workspaces`, `workspace_schemas`, `dev_users`, `app_users` |
| aplikasi & shared | `applications`, `auth_schemes`, `authz_schemes`, `lovs`, `lov_entries`, `nav_lists`, `nav_entries`, `app_versions` |
| page & komponen | `pages`, `regions`, `region_columns`, `items`, `buttons`, `computations`, `validations`, `processes`, `branches`, `dynamic_actions`, `da_actions` |
| runtime | `sessions`, `session_state`, `collections`, `ir_saved_reports`, `debug_messages`, `activity_log` |

Keputusan schema:
- Semua id `uuid default gen_random_uuid()`, waktu `timestamptz`. `on delete` ditentukan eksplisit: komponen `cascade` ke
  parent-nya, referensi ke authz scheme `set null` (komponen tidak hilang ketika scheme dihapus), LOV yang dipakai item `restrict`.
- Polimorfisme komponen = **tabel per jenis + `attributes jsonb` per tipe**, divalidasi oleh JSON Schema di spec, bukan oleh DB.
- Constraint penting: satu auth scheme `is_current` per app (partial unique index); nama item unik per app dan UPPERCASE
  (`items_name_chk`); item aplikasi tidak boleh punya region; satu saved report default per region per user.
- `rpx.applications.parsing_schema` ber-FK ke `workspace_schemas`, sehingga app tidak bisa menunjuk schema milik workspace lain.

**Access rules: pemeriksaan di data layer + pemisahan role PostgreSQL** (tidak memakai RLS untuk metadata).
- Engine konek sebagai `rpx_engine`, satu-satunya role yang bisa membaca `rpx.*`. Setiap query metadata di engine selalu
  difilter `workspace_id` (lewat modul `repo/` tunggal; tidak ada query metadata di luar modul itu).
- Kode developer (report SQL, proses, validasi, LOV) **selalu** dijalankan dalam transaksi:
  `begin; set local role ws_<workspace>; set local search_path = <parsing_schema>; set local statement_timeout = ...;
  select rpx_rt.ctx_init(items, user, app, session); <code>; select rpx_rt.ctx_items(); commit|rollback`.
  Role `ws_*` tidak punya akses ke schema `rpx` (**sudah diverifikasi**: `permission denied for schema rpx`).
- Data aplikasi milik subsidiary boleh memakai PostgreSQL RLS sendiri berbasis `rpx_rt.app_user()`.

Verifikasi yang sudah dijalankan:
- `schema.sql` ter-apply bersih di PG 16.15.
- Check constraint nama item dan unique current auth scheme menolak data salah.
- Blok PL/pgSQL sebagai `ws_kdk` membaca item dengan `rpx_rt.v()`, menulis dengan `set_item()`, dan item kembali ke engine.
- `ws_kdk` ditolak saat membaca metadata `rpx`.
- `prototype/bind.test.ts`: 5/5 lulus, termasuk end-to-end ke PG (report dengan `$n` dan proses DO-block dengan item write-back).

## API (Fase 1)

URL pola: `/r/{workspace}/{app}/{page}` (page = nomor atau alias). Tidak ada session id di URL.

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `GET /r/:ws/:app/login` | render login page app | publik | — | HTML | F04 |
| `POST /r/:ws/:app/login` | autentikasi built-in accounts, buat session, jalankan on_new_session/after_authentication | publik (rate-limited) | username, password, csrf | 303 → home page | F04 |
| `GET /r/:ws/:app/oidc/start` | redirect ke IdP (PKCE + state) | publik | — | 302 | F04, F07 |
| `GET /r/:ws/:app/oidc/callback` | tukar code, provisioning `app_users`, buat session | publik | code, state | 303 → home | F04, F07 |
| `POST /r/:ws/:app/logout` | hapus session | user login | csrf | 303 → login | — |
| `GET /r/:ws/:app/:page` | **show page**: set item dari query string (cek checksum), clear cache, authz, computations/processes before_header, render | sesuai page.requires_auth + authz | `?P2_EMPNO=..&clear=2&cs=..` | HTML | F04, F09 |
| `POST /r/:ws/:app/:page` | **accept page**: simpan item, cek csrf & checksum item protected, lalu computations → validations → processes → branches | sama | form fields, `REQUEST`, csrf, `page_submission_id` | 303 (PRG) atau HTML dengan error inline | F04, F09 |
| `GET /r/:ws/:app/:page/region/:sid` | partial render region (IR search/sort/filter/paging, classic report paging) | sama + authz region | `q, sort, filters, page` | fragment HTML (htmx) | F04, F05 |
| `GET /r/:ws/:app/:page/region/:sid/download` | download IR (streaming cursor) | sama | `format=csv\|xlsx` + state IR | file | F05 |
| `GET /r/:ws/:app/:page/lov/:item` | opsi LOV / popup LOV / cascading (parent items dikirim) | sama + authz item | `q, parents{}`, `offset` | fragment HTML / JSON | F04 |
| `GET /healthz` | cek DB + versi engine | infra | — | JSON | — |
| CLI `rpx ws create` | buat workspace, role `ws_*`, grant schema | admin DB | nama, schemas | — | F01 (Fase 1) |
| CLI `rpx app import / export` | validasi spec → replace metadata app dalam 1 transaksi → `app_versions` → `NOTIFY rpx_app_changed` | dev/CI | file YAML | ringkasan | F08 |
| CLI `rpx user add / lock` | kelola `app_users` | admin | username, groups | — | — |

Total Fase 1: **11 route HTTP + 3 perintah CLI**. Fase 2 menambah `/builder/*` (S01–S19) dan `POST /r/:ws/:app/:page/ajax/:process` (Dynamic Actions).

Webhooks in/out: tidak ada di Fase 1.
Jobs:

| name | schedule | what |
| --- | --- | --- |
| `purge_sessions` | tiap 15 menit | hapus `sessions` yang `expires_at < now()` atau idle melewati `idle_timeout` (cascade ke session_state, collections, debug) |
| `purge_debug` | harian 01:00 WIB | hapus `debug_messages` > 7 hari |
| `purge_activity` | harian 01:15 WIB | hapus `activity_log` > 90 hari (ganti ke partisi bulanan jika volume besar) |

Cache metadata: engine menyimpan definisi app di memori per `spec_hash`. `LISTEN rpx_app_changed` membuat semua instance
membuang cache setelah import, sehingga deploy app tidak perlu restart engine.

## The parts that bite

- **SQL injection.** Nilai item **selalu** masuk sebagai parameter (`$n`) atau lewat `rpx_rt.v()`, tidak pernah lewat
  concat string. Filter/sort IR hanya menerima nama kolom yang ada di `region_columns` (whitelist) dan operator dari daftar
  tetap. Query user dibungkus `select * from (<user sql>) q where ... order by ... limit ...`.
- **Hak eksekusi user code.** Selalu `set local role ws_*` dan `statement_timeout`. Developer tetap dianggap tepercaya:
  user code bisa memanggil `set_config('rpx.app_user', ...)` sendiri. End user tidak pernah memasok kode.
  Konsekuensinya, review spec di Git adalah kontrol keamanan.
- **Connection pooling.** `set local` hanya berlaku di dalam transaksi, jadi setiap eksekusi user code wajib ada di dalam
  transaksi. Ini juga aman dengan PgBouncer mode transaction. Jangan pernah memakai `set` tanpa `local`.
- **Lost update.** Saat form_init, engine menghitung checksum baris (`md5(row(<kolom form>)::text)`) dan menyimpannya
  sebagai hidden field ber-HMAC. Saat form_dml, engine menjalankan `select ... for update`, menghitung ulang, lalu menolak
  jika berbeda. IG (Fase 2) memakai pola yang sama per baris.
- **Session State Protection.** Item dari URL harus disertai checksum HMAC-SHA256 (secret app + `sessions.checksum_salt`
  sesuai level: app/user/session). Item `restricted` tidak bisa di-set dari URL/POST sama sekali.
- **Idempotency / double submit.** POST membawa `page_submission_id` sekali pakai (disimpan di session state). Submit
  ganda ditolak secara halus. Setelah POST selalu redirect 303 (PRG).
- **Races.** Dua tab dalam satu session menulis item yang sama → `insert ... on conflict do update` (last write wins,
  sama seperti APEX). Import app saat ada user aktif → import dalam satu transaksi, cache invalidation lewat NOTIFY.
- **Time zones.** Semua kolom metadata `timestamptz`. Untuk tampilan, setiap transaksi user code menjalankan
  `set local timezone = <app/session tz>` (default `Asia/Jakarta`). Format mask Oracle (`DD-MON-YYYY`, `999G990D00`)
  diterjemahkan ke `to_char` PostgreSQL; daftar padanannya dibuat eksplisit dan dites.
- **Perbedaan dialek yang akan dikeluhkan developer APEX.** String kosong ≠ NULL di PostgreSQL (di Oracle `'' is null`).
  Engine menyimpan item kosong sebagai `NULL` agar `:P1_X is null` tetap berperilaku seperti APEX. Bind bertipe `text`,
  jadi perlu cast (`:P2_SAL::numeric`), mirip `to_number(:P2_SAL)` di APEX. Tidak ada ROWID, jadi Form/IG wajib PK.
- **Performa IR.** `count(*)` total mahal; default "row X–Y of more" (`limit pagesize+1`), total count opsional per region.
  Search menggunakan `ILIKE` pada kolom searchable; sarankan index `pg_trgm` untuk tabel besar. Download memakai cursor
  (streaming) dengan batas `max_rows`.
- **XSS/CSP.** Semua substitusi di-escape HTML secara default (`&ITEM!RAW.` hanya bila eksplisit). CSP dengan nonce
  sejak awal (APEX 26.1 sendiri baru bergerak ke arah ini).
- **Multi-tenancy.** Isolasi workspace = role `ws_*` + `workspace_schemas` + filter `workspace_id` di repo layer.
  Satu engine bisa melayani banyak subsidiary.
- **Rate limit.** Login: per IP + per username (`app_users.failed_logins`, lock setelah N kali).
- **Retensi data.** Session kedaluwarsa dihapus otomatis; `activity_log` 90 hari; tidak ada data pribadi di `debug_messages`
  selain username.

## Build order (Fase 1)

Perkiraan kasar untuk 2 developer: **6–8 minggu**. Yang dikejar adalah F04 (5 klik) berjalan di atas data nyata,
bukan paritas penuh.

| # | milestone | screens | tabel | routes / CLI | selesai jika |
| --- | --- | --- | --- | --- | --- |
| M0 | **Fondasi** (± 1 mgg) | — | migrasi 0001 (semua 29 tabel) | `rpx ws create`, `rpx app import` (subset spec) | `examples/emp` ter-import; role `ws_*` terbentuk |
| M1 | **Vertical slice, sengaja jelek** (± 1,5 mgg) | S20, S25 (classic report), S23 (page normal) | + `app_users`, `auth_schemes`, `sessions`, `session_state` | login, show, accept | F04 tanpa modal: login → report → klik baris → form → Save → kembali + pesan sukses. Membuktikan bind translator, role switch, session state, PRG |
| M2 | **Kebenaran runtime** (± 1,5 mgg) | S27 | `computations`, `validations`, `processes`, `branches`, `authz_schemes`, `nav_*` | (sama) | urutan accept sesuai docs; clear cache; SSP checksum; lost update; app items + substitution strings + escape; authz page/region/button; navigation menu + breadcrumb |
| M3 | **Items & LOV** (± 1 mgg) | S23 lengkap | `lovs`, `lov_entries` | `GET .../lov/:item` | semua item type inti, LOV static/SQL, cascading, popup LOV, format tanggal & timezone |
| M4 | **Interactive Report dasar + modal** (± 1,5 mgg) | S21, S23 modal | `region_columns` | `GET .../region/:sid`, `.../download` | search, sort, filter kolom, paging, CSV/XLSX; modal dialog + close + refresh parent → **F04 lengkap 5 klik** |
| M5 | **OIDC, operasional, pilot** (± 1 mgg) | S28 (tampilan minimal) | `debug_messages`, `activity_log` | `oidc/*`, `/healthz`, jobs, `rpx app export` | OIDC ke IdP KCSI, Docker + Cloudflare Tunnel, Playwright untuk F04/F09, **satu aplikasi kecil PANDAWA di-port sebagai pilot** |

Setelah Fase 1, status `features.csv`: **24 dari 30 must** selesai. Enam must yang tersisa semuanya builder
(daftar app, Create App/Page wizard, Page Designer, login developer, kelola user via UI); itulah isi Fase 2 bersama
Interactive Grid dan Dynamic Actions.

Urutan berikutnya:
2. Must-have sisa (Fase 2): S01–S07, S19.
3. Should-have: IG, Dynamic Actions, IR saved reports/highlight, faceted search, cards, debug viewer, collections, translations. Lalu could-have.
4. Perbaikan dari `/replica-entrepreneur`: belum dijalankan. Untuk produk internal, ganti "review publik" dengan keluhan developer PANDAWA terhadap APEX.

## Catatan untuk pilot

Pilih aplikasi yang **read-mostly, sedikit PL/SQL, dan tanpa ketergantungan EBS** (APPS schema, `fnd_*`), karena port PL/SQL→PL/pgSQL
adalah biaya terbesar per aplikasi. Sebelum memilih, cek dulu jumlah baris PL/SQL per app lewat
`apex_application_page_proc` / `apex_application_page_val` di instance APEX KCSI.
