# Parity: pandawapex vs Oracle APEX (2026-11-13)

Build: branch `build/local-install` (di atas M0, M1, backend, dan test pass). Parity di sini berarti **mengerjakan pekerjaan yang sama**,
bukan tampilan yang sama.

## Angka

| ukuran | skor | catatan |
| --- | --- | --- |
| **Feature parity (seluruh slice)** | **35.9 / 100** | 60 fitur dihitung (must ×3, should ×2, could ×1, partial = ½) |
| Must-have selesai | **12 / 30** (+7 parsial) | 18 belum selesai |
| Lingkup runtime saja (tanpa builder, SQL Workshop, AI, migrasi) | 43.2 / 100 | 47 fitur |
| Must-have runtime saja | 62.5 / 100 | 24 fitur |
| Layout score per screen | **belum diukur** | `replica/screens/` kosong; lihat di bawah |
| Bug terbuka S1/S2 | 0 | `replica/bugs.md` |

**Verdict: not shippable** sebagai pengganti APEX. 18 must-have belum selesai, terutama builder (Fase 2), Interactive Report,
modal dialog, dan authorization scheme. Ini sesuai rencana. Fase 1 menargetkan runtime, dan runtime sudah lebih dari separuh jalan
untuk must-have-nya. Tapi angka keseluruhannya memang 36%, bukan lebih.

Yang **sudah layak**: menjalankan aplikasi CRUD sederhana (report + form + validasi + proses PL/pgSQL) dari spec YAML,
dengan login akun lokal atau SSO, di instalasi lokal. Itu cukup untuk pilot internal, bukan untuk menggantikan aplikasi PANDAWA.

## Layout diff: kenapa belum ada angkanya

Layout diff membandingkan screenshot asli dengan screenshot clone pada viewport dan state yang sama. Screenshot APEX harus
diambil dari **instance APEX milik KCSI sendiri** (bukan scraping), dan folder `replica/screens/` masih kosong. Begitu tersedia:

```bash
# simpan sebagai replica/screens/S21.png (IR), S23.png (form), S20.png (login), ukuran 1440x900
python3 tools/imgdiff.py replica/screens/S23.png replica/clone-screens/S23.png --out replica/diffs/S23.png
```

Ekspektasi realistis: struktur form dan login akan mendekati ("close", 75+), sedangkan report akan jauh berbeda sampai
Interactive Report (toolbar, menu Actions) dibangun di M4.

## Behaviour diff (flow yang sudah dibangun)

Sisi APEX ditulis dari dokumentasi publik dan pola standar Create App wizard (Report + Form dengan modal), bukan dari pengukuran.

| flow | APEX | clone | keputusan |
| --- | --- | --- | --- |
| F04 edit data | IR → ikon edit → **form modal** → Apply Changes → dialog tertutup, report di-refresh di tempat | report → link baris → **form halaman penuh** → Simpan → kembali ke report + pesan | **fix (M4)**: modal + refresh region. Jumlah klik sama (3 setelah login), tapi konteks report hilang |
| F04 cari data | IR: ketik lalu Enter, langsung ter-filter; filter jadi chip | field "Cari nama" + tombol Cari; filter diingat di session | **fix (M4)** lewat IR. Untuk report klasik, perilaku clone sudah setara |
| F04 lost update | menolak simpan bila baris berubah sejak dibuka (checksum baris) | sama, plus berlaku untuk delete; versi tidak "disegarkan" diam-diam saat validasi gagal | **keep** |
| F04 kirim ganda | ada proteksi submit ganda (page submission) | token sekali pakai, kiriman kedua dapat halaman 409 yang menjelaskan | **keep** |
| F04 error validasi | inline + notifikasi | inline + ringkasan berisi link ke field, fokus otomatis ke ringkasan | **keep** (lebih aksesibel) |
| F09 URL | session id terlihat di URL (`f?p=…:SESSION`) atau friendly URL dengan `session=` | session hanya di cookie; argumen item dibuang dari address bar setelah dicek | **keep** (URL aman dibagikan/di-bookmark) |
| F09 checksum | link dengan item diberi checksum (Session State Protection) | sama, terikat ke session | **keep** |
| F07 login | akun APEX / skema autentikasi lain, SSO lewat konfigurasi | akun lokal + OIDC (PKCE) di spec, provisioning & grup dari IdP | **keep**. Authorization scheme (pemakai grup) = **fix (M2)** |
| F08 deploy | export/import SQL atau APEXlang; aplikasi diganti, session pengguna tetap | import spec YAML; session tetap; versi tercatat di `app_versions` | **keep**. Export spec = fix |
| session habis | redirect ke login, lalu kembali | sama | keep |
| bind variable | `:P1_X` bertipe VARCHAR2, konversi implisit Oracle | `:P1_X` bertipe text, **cast eksplisit** wajib (`::int`) | **keep, dokumentasikan**. Ini perbedaan yang paling terasa bagi developer PANDAWA |

## Lima yang dibangun berikutnya (urutan)

1. **Authorization schemes + application computations (M2)**: memakai grup dari SSO/akun lokal untuk page/region/tombol/menu. Must-have keamanan; tanpa ini setiap user yang login bisa melihat semua page.
2. **Modal dialog page + close dialog + refresh region (M4, dimajukan)**: memulihkan pola F04 yang paling dikenal user APEX.
3. **Interactive Report dasar (M4)**: search, sort, filter kolom, paging, download CSV/XLSX. Dua must-have, dan layar yang paling sering dipakai.
4. **Item & LOV lengkap (M3)**: popup LOV, cascading LOV, switch/radio/checkbox, format mask & tanggal-jam.
5. **Export spec + daftar aplikasi read-only**: langkah pertama menuju builder. Setelah itu baru Create App wizard dan Page Designer (Fase 2).

Setelah 1–3 selesai, ukur ulang: must-have runtime diperkirakan di sekitar 80%.

---

## Lampiran: output `parity.py`

### Parity: 35.9 / 100

features 35.9  (60 counted, must-haves 12 of 30 done)

Not shippable yet: 18 must-have features are not done.

### By area, weakest first
- sql workshop                   0.0  (2 features)
- data sources                   0.0  (1 features)
- extensibility                  0.0  (1 features)
- migration                      0.0  (1 features)
- ai                             0.0  (1 features)
- builder                        6.8  (8 features)
- items                         18.8  (3 features)
- lifecycle                     25.0  (3 features)
- ui                            25.0  (2 features)
- regions                       32.1  (13 features)
- workspace                     50.0  (3 features)
- shared components             50.0  (2 features)
- runtime                       52.4  (17 features)
- security                      66.7  (3 features)

### Missing, in build order
- [must] builder: Application items & computations on login, no  (S14)
- [must] builder: Create App wizard dari tabel (Report+Form), no  (F01; target <= 8 klik)
- [must] builder: Create Page wizard (Blank/Form/Report/IR/IG/Modal), no  (S07)
- [must] builder: Daftar aplikasi + create/delete app, no  (S03)
- [must] builder: Page Designer: tree + property editor, no  (S06; versi awal boleh tanpa drag-drop grid)
- [must] items: Cascading LOV (parent items), no
- [must] regions: Interactive Report: download CSV/XLSX, no
- [must] regions: Interactive Report: search + sort + filter + pagination, no  (hard part #1)
- [must] runtime: Modal dialog page + close dialog + refresh parent, no  (F04 core loop)
- [must] security: Authorization schemes (exists SQL / function boolean / group), no  (S11; evaluation point)
- [must] workspace: Login developer per workspace, no  (S01)
- [must] builder: Application properties + substitution strings, partial  (M1: lewat spec YAML (substitutions, timezone); belum ada UI)
- [must] items: Item types inti: text/number/date/select/popup LOV/switch/textarea/hidden/display only, partial  (M1: text, number, textarea, date, select, hidden, display_only, password; popup LOV/switch/radio/checkbox belum)
- [must] runtime: Accept page: computations > validations > processes > branches, partial  (M1: validations, processes, branches; computations belum (M2))
- [must] runtime: Substitution &ITEM. dengan escape filters, partial  (M1: &ITEM. selalu di-escape HTML; filter !RAW/!JS/!ATTR belum)
- [must] shared components: List of Values static & SQL, partial  (M1: LOV inline per item (static/SQL) untuk select; shared LOV belum)
- [must] shared components: Navigation menu + breadcrumb, partial  (M1: menu dari spec + breadcrumb parent; kondisi/otorisasi per entri belum)
- [must] workspace: Kelola developer dan end user (accounts), partial  (M1: end user via CLI rpx user add; developer accounts & UI belum)
- [should] builder: Page Designer: layout grid drag-drop, no
- [should] builder: Page locking antar developer, no
- [should] items: File upload item, no  (simpan ke bytea atau object storage)
- [should] regions: Cards region, no
- [should] regions: Faceted search, no
- [should] regions: IR control break + aggregate + highlight, no
- [should] regions: IR saved reports (private/public/default), no  (F05)
- [should] regions: Interactive Grid editable (add/update/delete), no  (hard part #4)
- [should] runtime: Activity log (page views + timing), no
- [should] runtime: Collections (padanan APEX_COLLECTION) di jsonb, no
- [should] runtime: Debug messages per page view, no  (S28)
- [should] runtime: Developer Toolbar + session state viewer, no  (S26)
- [should] runtime: Dynamic Action: execute server code (PL/pgSQL) dengan items to submit/return, no
- [should] runtime: Dynamic Actions: show/hide/set value/refresh/submit, no  (hard part #5)
- [should] ui: Translations berbasis text message, no  (fitur 26.1; ID/EN untuk subsidiary)
- [should] lifecycle: Export / import aplikasi sebagai spec file (YAML), partial  (M0: import + validasi JSON Schema/semantik; export belum)
- [should] runtime: Error handling function + pesan ramah, partial  (M1: halaman error ramah + kode referensi; error handling function per app belum)
- [should] ui: Theme/template engine sendiri (page/region/report/button), partial  (M1: template page/region/login/error di kode (design system rpx); belum bisa dipilih/diubah per app)
- [could] ai: AI: buat page dari bahasa natural, no  (fase lanjut)
- [could] data sources: REST data source (region dari REST API), no
- [could] extensibility: Template components / custom plugin API, no
- [could] lifecycle: Diff antar versi spec aplikasi, no
- [could] lifecycle: Importer APEXlang .apx, no  (hanya jika lisensi APEXlang mengizinkan pihak ketiga)
- [could] migration: Converter aplikasi APEX lama ke spec replika, no  (termasuk translasi PL/SQL→PL/pgSQL; proyek terpisah)
- [could] regions: Charts region, no  (pakai library open source (mis. ECharts) bukan Oracle JET)
- [could] regions: IR chart view / group by / pivot, no
- [could] regions: Master-detail IG, no
- [could] runtime: Email via SMTP (padanan APEX_MAIL), no
- [could] sql workshop: SQL Workshop: Object Browser, no  (S18)
- [could] sql workshop: SQL Workshop: SQL Commands, no  (S17)

### Left out on purpose (not scored)
- Kompatibilitas penuh PL/SQL dan Oracle SQL: database target PostgreSQL; kode user ditulis PL/pgSQL
- Parity seluruh package APEX_* PL/SQL API: hanya padanan inti
- Universal Theme / Iris style / Font APEX: aset milik Oracle; buat design system sendiri
- Format export SQL APEX (f100.sql): format internal Oracle
- VPD / Real Application Security: fitur Oracle DB; di PG pakai Row Level Security bila perlu
- ORDS REST enabling / RESTful Services module: di luar slice; PostgREST bila perlu
- Oracle Spatial / vector tile Map region: fitur Oracle DB
- AI Agents / NL Interactive Report: di luar slice; bergantung provider AI
- Workflow & Approvals (Human Tasks): di luar slice
- Automations (scheduler): di luar slice; pg_cron bila perlu
- Progressive Web App: di luar slice
- Data Reporter / Search Configurations: di luar slice
- Nama dan branding Oracle APEX: butuh nama sendiri (/replica-brand)
- Instance cloud oracleapex.com / OCI APEX Service: layanan Oracle

