# Pilot porting: DEMO "Demo Permintaan Barang" (APEX → pandawapex)

Sumber: aplikasi Tim PANDAWA (`install.sql` Oracle, export APEXlang, export SQL `f170134`), dibuat oleh generator
pandawa-apexlang pada 2026-11-01. Tanggal porting: 2026-11-13.

**Hasil: seluruh 17 halaman jalan di pandawapex, termasuk workflow approval 2 level dengan maker-checker.**
Logika bisnis (package, trigger, view) dipindah ke PL/pgSQL dengan perilaku yang sama, dan diuji lewat halaman
oleh 5 user dengan role berbeda (10 tes integrasi + 2 skenario browser di desktop dan 390 px, semuanya lulus axe).

```bash
RPX_DEMO_PASSWORD='<min 10 karakter>' npm run rpx -- pilot setup
# buka http://localhost:8080/r/pandawa/demo
# user: admin (ADMIN), budi (REQUESTER), sari (MANAGER), dodi (DIRECTOR), gudang (WAREHOUSE); kata sandi sama
```

## Ukuran

| | APEX / Oracle | pandawapex / PostgreSQL |
| --- | ---: | ---: |
| Objek database (tabel, package, trigger, view, konfigurasi) | 1.139 baris `install.sql` | 726 baris `install.sql` + 60 baris `seed.sql` |
| Definisi aplikasi | 6.474 baris APEXlang (17 halaman + shared components) | 687 baris `app.yaml` |
| Komponen APEX (sensus `tools/apex_census.py`) | 156 | semua punya padanan; lihat catatan Dynamic Action |

## Status per halaman

| Page | Nama | Status | Catatan |
| --- | --- | --- | --- |
| 100 | Home | ✅ | KPI sebagai classic report (versi f170134 memakai *metric card*); chart pie & bar |
| 190 | Approval Inbox | ✅ | IR, urut terbaru dulu, link ke dialog 191 |
| 191 | Approval (modal) | ✅ | Approve/Reject hanya tampil bila `can_act_yn = 'Y'`; POST palsu ditolak 400 |
| 200 / 201 | Departments | ✅ | Create hanya untuk WAREHOUSE |
| 210 / 211 | Items | ✅ | versi f170134 memakai *faceted search* → di sini IR (lihat celah) |
| 300 / 301 | Permintaan Barang | ✅ | read-only per status, Submit for Approval, nomor REQ-YYYY-NNNN dari trigger |
| 302 | Detail Permintaan (master-detail, dari f170134) | ✅ | tata letak: panel kanan belum bisa menumpuk header + baris (lihat celah) |
| 310 / 311 | Baris Permintaan | ✅ | baris dari permintaan yang sudah diajukan tidak bisa diubah |
| 400 | Rekap Permintaan | ✅ | |
| 500 / 501 | Users & Roles | ✅ | role per username; akun login tetap dibuat lewat `rpx user add` |
| 510 / 511 | Document Types & Approval | ✅ | |
| 9999 | Login | diganti | login bawaan pandawapex (argon2, kunci akun, rate limit); "remember username" tidak dibawa |

**Dynamic Action:** 14 DA di APEX (7× tombol Cancel → tutup dialog, 7× setelah dialog ditutup → refresh report)
sudah tercakup perilaku bawaan: tombol `action: close_dialog`, dan halaman pemanggil selalu di-refresh setelah dialog
tertutup. Tidak ada DA yang perlu ditulis.

## Pola terjemahan PL/SQL → PL/pgSQL yang dipakai

| Oracle | PostgreSQL | contoh di `install.sql` |
| --- | --- | --- |
| package `apx_demo_approval_pkg` | **satu skema per package**; pemanggilan tetap `apx_demo_approval_pkg.submit(...)` | §5 |
| procedure | `create procedure` + `call` (juga di proses halaman) | `submit`, `approve`, `reject` |
| variabel package (`g_bypass`, `g_test_user`) | `set_config('apx_demo.bypass', 'on', true)` / `current_setting(...)`, berlaku per transaksi | `bypass()`, `set_bypass()` |
| `sys_context('APEX$SESSION','APP_USER')` | `current_setting('rpx.app_user')` (diisi engine per request) | `apx_demo_sec_pkg.app_user()` |
| `raise_application_error(-20101, msg)` | `raise exception '...' using hint = 'ORA-20101'` | semua pesan bisnis sama persis |
| `execute immediate` + `dbms_assert.simple_sql_name` | `execute format('... %I ...')` | `get_doc`, `set_doc_status` |
| `merge` lalu `update ... returning` | `insert ... on conflict do update ... returning` (satu perintah, aman bersamaan) | `next_no` |
| `%rowtype` sebagai parameter/return | tipe baris tabel (`apx_demo.apx_demo_doc_types`) | `get_type` |
| kolom virtual `line_amount` | `generated always as (qty * unit_price) stored` | tabel baris |
| `date` berisi jam (audit) / `sysdate` | `timestamp(0)` / `localtimestamp(0)`; tanggal murni tetap `date` | kolom `*_on` |
| trigger dengan `:new` + audit berulang | fungsi trigger + `jsonb_populate_record(new, apx_demo_audit(tg_op))` | §7 |
| ORA-04091 (mutating) saat delete cascade | tidak terjadi; induk sudah terhapus → trigger baris langsung lolos | `apx_demo_request_lines_trg` |
| `create force view` (urutan bebas) | urutan view harus benar | `request_summary_v` sebelum `dash_c2_s1_v` |
| bind `:P1_X` di halaman | `:P1_X::bigint` / `::date` (bind selalu text) | semua kondisi & proses |

Semua aturan bisnis diuji langsung di database sebelum dipasang ke halaman: nomor dokumen, submit tanpa baris ditolak,
kunci baris setelah submit, approval level 2 di atas 10 jt, maker-checker, reject wajib catatan, perubahan status ilegal.

## Yang ditambahkan ke engine karena pilot ini

| Kebutuhan dari DEMO | Fitur | Dipakai di |
| --- | --- | --- |
| `requestIsContainedInValue` | kondisi `request_in: [SAVE, CREATE]` | proses close dialog, validasi 301 |
| item read-only berdasarkan ekspresi | `read_only: <kondisi>` pada item: tampil sebagai teks, nilai kiriman diabaikan | 301 (terkunci setelah submit) |
| urutan default IR (`savedReport … sort`) | `sort: { column, dir }` pada interactive report | semua IR |
| chart JET (pie, bar) | region `type: chart` (SVG di server, tanpa library), tabel alternatif | Home |
| region tombol di classic report master-detail | (sudah ada) | 302 |
| report satu halaman tanpa navigasi halaman | paginasi disembunyikan bila semua baris muat | KPI, 302 |
| tabel yang bisa di-scroll harus bisa difokus keyboard | `.r-table-wrap` dengan `tabindex="0"` (ditemukan axe di pilot) | semua report |

## Celah yang tersisa (urutan prioritas)

1. **Faceted search** (versi f170134 halaman 210 dan 300). Di sini diganti IR dengan cari + filter. Butuh region baru.
2. **Sub-region / kolom bersarang.** Halaman 302 di APEX menaruh header dan baris di satu kolom kanan; grid pandawapex
   belum punya region di dalam region, jadi baris turun ke bawah. Fungsinya sama, tata letaknya berbeda.
3. **Metric card / KPI** (versi f170134 Home). Sementara memakai classic report satu baris.
4. **Akun login dari halaman Users & Roles.** Role diatur di aplikasi, tetapi akun login tetap dibuat lewat CLI.
   Ini bagian dari must-have "Kelola developer dan end user" (Fase 2).
5. **Pesan untuk nilai di luar daftar.** Mengubah baris milik permintaan yang sudah diajukan ditolak dengan
   "No. Permintaan: pilihan … tidak ada di daftar", bukan pesan trigger yang lebih jelas. APEX menampilkan nilai
   ekstra lalu membiarkan trigger menolak. Pertimbangkan opsi per item untuk melewati cek daftar.
6. **Format tanggal aplikasi** `DD-MON-YYYY`: pandawapex menampilkan `DD-MM-YYYY`. Format mask bebas belum ada.
7. Tidak dibawa karena tidak relevan: `nav-fix.js` (workaround Universal Theme), plugin settings, ikon aplikasi,
   pesan teks `APP_TEXT$DELETE_MSG` (diganti teks konfirmasi biasa).

## Catatan untuk porting berikutnya

- **Skema per package** membuat kode halaman nyaris tidak berubah. Skema-skema itu didaftarkan ke workspace
  (`rpx ws create pandawa --schema apx_demo --schema apx_demo_approval_pkg ...`) supaya role workspace bisa memakainya.
- Setiap fungsi diberi `set search_path = apx_demo, pg_temp` agar tidak bergantung pada search path pemanggil.
- Konfigurasi yang berisi nama tabel/kolom (doc_types) tetap huruf besar seperti di Oracle; kode memakai `lower()`.
- Bagian yang paling makan waktu adalah trigger dan dynamic SQL, bukan halaman. Halaman APEX hampir 1:1 ke YAML.
