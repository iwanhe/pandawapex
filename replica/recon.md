# Recon map: Oracle APEX (web) → replika di atas PostgreSQL

Scope: **Runtime engine + builder inti**. Builder deklaratif untuk page (Form, Interactive Report,
Interactive Grid, Classic Report, LOV, item, validasi, computation, proses, branch, Dynamic Action dasar),
shared components inti (LOV, Authentication, Authorization, Navigation Menu, Application Items,
Substitution Strings, Theme/Template), serta runtime (render page, accept page, session state, f?p/friendly URL,
auth/authz, Developer Toolbar, debug). Database metadata dan data aplikasi: **PostgreSQL**.
For: Internal KCSI / Tim PANDAWA, yaitu subsidiary atau workload yang tidak berjalan di Oracle DB (landscape SAP, AWS/CLA Group).
Date: 2026-11-13
Baseline yang dipelajari: Oracle APEX 26.1 (rilis Mei 2026)

---

## 0. Aturan main (clean-room)

- Yang direplika adalah **perilaku dan pola UX**. Kode, aset, dan nama milik Oracle tidak ikut diambil.
- **Tidak boleh**: menyalin JS/CSS APEX (`apex.*` libraries, Universal Theme, Font APEX), membaca atau mengadaptasi
  source package `WWV_FLOW_*`, membongkar export internal, atau memakai nama/branding "APEX"/"Oracle" pada produk.
- **Boleh**: dokumentasi publik (App Builder User's Guide, API Reference, data dictionary view `APEX_*`
  yang terdokumentasi), release notes, video publik, dan pengamatan di instance APEX milik KCSI sendiri
  (dijalankan Iwan sendiri, kecepatan manusia, tanpa crawler).
- **Lisensi**: APEX adalah fitur no-cost dari Oracle Database dan terikat lisensi Oracle DB. Tujuan internal
  (tidak dijual sebagai produk pesaing) jauh lebih aman, tetapi tetap minta Legal mengecek klausul lisensi
  Oracle KCSI sebelum proyek berjalan. Jika arah proyek berubah ke komersial, studi ulang hanya dari sumber publik.
- **APEXlang (`.apx`)**: Oracle menyebutnya "open", tetapi halaman release notes belum mencantumkan lisensi
  maupun hak pakai oleh pihak ketiga. Untuk sementara replika memakai **format spec sendiri** (YAML/JSON).
  Importer `.apx` tetap `could` dan bergantung pada lisensi resmi. Catatan: `github.com/apexlang` adalah
  proyek IDL lain yang **tidak berkaitan** dengan Oracle APEXlang.

## 1. Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | App Builder User's Guide 26.1: Concepts | https://docs.oracle.com/en/database/oracle/apex/26.1/htmdb/application-builder-concepts.html | page processing/rendering, session state, URL syntax, substitution strings; inti runtime |
| 2 | Substitution strings 26.1 | https://docs.oracle.com/en/database/oracle/apex/26.1/htmdb/about-using-substitution-strings.html | `&ITEM.`, `#COL#`, escape filters, built-in strings |
| 3 | Built-in substitution list (24.1 TOC) | https://docs.oracle.com/en/database/oracle/apex/24.1/htmdb/toc.htm | APP_ID, APP_SESSION, APP_USER, dll. |
| 4 | Release notes 26.1: New Features | https://docs.oracle.com/en/database/oracle/apex/26.1/htmrn/new-features.html | APEXlang, Static ID, AI, Trigger Action, CSP |
| 5 | What's new 26.1 (marketing) | https://www.oracle.com/apex/whats-new-261/ | positioning, Iris style, Template Components |
| 6 | Blog: IR 26.1 | https://blogs.oracle.com/apex/whats-new-in-interactive-reports-in-oracle-apex-26-1 | NL IR, row selection, Max Rows |
| 7 | Blog: APEXlang | https://blogs.oracle.com/apex/introducing-apexlang-the-future-of-generative-application-development-with-oracle-apex | model spec deklaratif sebagai source of truth |
| 8 | APEX API Reference (APEX_UTIL, APEX_SESSION, APEX_COLLECTION, APEX_ERROR) | https://docs.oracle.com/en/database/oracle/apex/26.1/aeapi/ | API runtime yang perlu padanan PostgreSQL |
| 9 | APEX dictionary views (`APEX_APPLICATION_PAGES`, `..._PAGE_ITEMS`, `..._PAGE_REGIONS`, `..._PAGE_PROC`, `..._PAGE_DA`, `..._LOVS`) | https://docs.oracle.com/en/database/oracle/apex/26.1/htmdb/ (Utilities → APEX Views) | **bukti terkuat untuk data model metadata**, karena terdokumentasi publik |
| 10 | Instance APEX milik KCSI (FRITS, SIPP, MARVEL, GLT apps) | internal, digerakkan Iwan sendiri | state nyata: empty, error, modal, IR saved report |
| 11 | Pembanding Postgres low-code: CYPEX | https://cybertec-postgresql.com/products/cybertec-cypex-postgresql-low-code-development-platform | produk komersial yang memposisikan diri sebagai penerus APEX/Forms di Postgres; **opsi buy** |
| 12 | Pembanding open source: SQLPage, Budibase, ToolJet | https://alternativeto.net/software/oracle-apex/ | baseline build-vs-buy |

## 2. Core loop

**Developer mendefinisikan page secara deklaratif di atas tabel/SQL (region + item + proses). Engine
merender page itu, menyimpan session state per user, dan menjalankan validasi/proses saat submit, tanpa developer
menulis HTML/JS.** Bagi end user, core loop-nya adalah Report → klik baris → Form (modal) → Save → Report ter-refresh.

## 3. Screens

### Builder (developer)

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Workspace sign-in | `/builder` | login developer per workspace | form login, workspace field | empty, error (salah password), locked |
| S02 | Workspace home | setelah login | hub: App Builder, SQL Workshop, Admin | tile nav, recent apps | first-time (belum ada app), filled |
| S03 | App Builder: daftar aplikasi | S02 → App Builder | list app, search, import, create | card/report toggle, search, toolbar | empty, filled, search no-result |
| S04 | Create Application wizard | S03 → Create | buat app: nama, pages awal, features, theme | wizard, page-type picker, drawer | default, validation error |
| S05 | Application home | klik app di S03 | daftar page, run app, shared components, export | page report, toolbar (Run, Export, Supporting Objects) | 1 page, banyak page |
| S06 | **Page Designer** | S05 → klik page | editor utama: tree (Rendering/Processing/Dynamic Actions/Shared), layout grid, Property Editor | 3-pane split, tree, drag-drop grid, property editor, code editor, gallery | page kosong, filled, validation error (merah di property), save conflict (page locked) |
| S07 | Create Page wizard | S05/S06 → Create Page | buat Form, Report, IR, IG, Report+Form, Blank, Modal | page-type gallery, source (table/SQL), nav options | table picker kosong, SQL invalid |
| S08 | Shared Components hub | S05 → Shared Components | navigasi ke semua shared component | link grid per kategori | - |
| S09 | List of Values editor | S08 → LOV | LOV static/dinamis, return/display column | form, static entries grid, SQL editor | static, dynamic, SQL error |
| S10 | Authentication Schemes | S08 → Authentication | daftar & edit scheme (APEX accounts, custom, social/OIDC, header) | report, form, "make current" | satu current scheme |
| S11 | Authorization Schemes | S08 → Authorization | scheme Exists SQL / PL/SQL boolean, evaluation point | form, code editor | - |
| S12 | Navigation Menu / Lists | S08 → Lists | menu kiri app + list entries, conditions | tree list, entry form | empty, nested |
| S13 | Application Definition | S05 → Edit Application Properties | nama, alias, compatibility, substitution strings, globalization, security (SSP, checksum) | tabs form | - |
| S14 | Application Items & Computations | S08 → Application Items/Computations | item global app, computation on login | report + form | - |
| S15 | Themes & Templates | S08 → Themes | theme aktif, template page/region/report/label/button, theme style | report, template editor | - |
| S16 | Export / Import | S05 → Export, S03 → Import | export app (SQL atau APEXlang), import + install | form, file upload, install summary | sukses, incompatible version (lihat kasus 26.1→23.2) |
| S17 | SQL Workshop: SQL Commands | S02 → SQL Workshop | eksekusi SQL ad-hoc | editor, result grid, explain | error, result kosong |
| S18 | SQL Workshop: Object Browser | S02 → SQL Workshop | lihat/buat tabel, kolom, index | tree + tabs | - |
| S19 | Workspace admin: users & groups | S02 → Administration | kelola developer dan end user (APEX accounts) | report + form | - |

### Runtime (end user + developer saat run)

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S20 | Login page app | `/ords/r/{ws}/{alias}/login` atau `f?p=APP:LOGIN` | login end user | form, auth scheme | empty, invalid credentials, session expired |
| S21 | Page dengan **Interactive Report** | `/r/{ws}/{alias}/{page}` | eksplor data: search, filter, sort, control break, aggregate, highlight, chart, download, saved reports | search bar, Actions menu, column header menu, pagination | loading, no data found, filled, max rows exceeded |
| S22 | Dialog IR (Filter/Highlight/Aggregate/Save Report/Download) | S21 → Actions | personalisasi report | modal dialog, form | validation error |
| S23 | **Form page** (normal & modal dialog) | klik link di S21 / Create button | create/update/delete 1 baris | page items (text, select, date, popup LOV, switch, file), buttons, validasi inline | create mode, edit mode, error inline + notification, success message, lost-update detected |
| S24 | **Interactive Grid** (editable) | page IG | edit banyak baris inline, add/delete row, save | grid, toolbar, row actions, cell editors | read-only, edit mode, dirty cell, row error, saving |
| S25 | Classic Report / Cards + Faceted Search | page | tampilan data ringan + facet di kiri | report template, facet panel | no data, filtered |
| S26 | Developer Toolbar + Session viewer | bawah page saat developer run | lihat session state, debug, edit page, quick edit | toolbar, session dialog | hanya terlihat oleh developer |
| S27 | Error / Unauthorized page | runtime error, authz gagal | pesan error terstandar | error template | inline vs page error, 401/403 |
| S28 | Debug messages viewer | S26 → Debug / View Debug | trace render/accept per langkah | report waktu per step | - |

Total: **28 screen** (19 builder, 9 runtime).

## 4. Flows

```
F01 Developer membuat aplikasi CRUD dari tabel
    S02 -> S03 -> S04 (pilih tabel, page Report+Form) -> S05 -> Run -> S20 -> S21
    happy path clicks: ~8
    edge: tabel tanpa PK, kolom tipe tidak didukung, nama alias bentrok, user tidak punya grant
```
```
F02 Developer menambah page Report + Form
    S05 -> S07 (Interactive Report + Form, table X, modal) -> S06
    happy path clicks: ~6
    edge: SQL source invalid, PK composite/ROWID (di PG: tidak ada ROWID → wajib PK), page number sudah dipakai
```
```
F03 Developer mengubah page di Page Designer
    S06: tambah item (drag ke grid) -> set LOV -> tambah validasi -> tambah proses -> tambah DA (on change → set value / refresh region) -> Save -> Run
    happy path clicks: ~12
    edge: page dikunci developer lain, referensi item yang dihapus, SQL di property gagal di-parse
```
```
F04 End user mengedit data (core loop runtime)
    S20 login -> S21 cari/filter -> klik edit -> S23 (modal) ubah -> Save -> validasi -> proses DML -> close dialog -> S21 refresh + success message
    happy path clicks: 5
    edge: validasi gagal (error inline), lost update (baris diubah user lain), session timeout saat submit, tidak ter-otorisasi
```
```
F05 End user mempersonalisasi IR
    S21 -> Actions -> Filter -> S22 -> apply -> Actions -> Save Report (private/public) -> reload tetap tersimpan
    happy path clicks: ~7
    edge: filter tipe salah (tanggal), saved report atas kolom yang sudah dihapus developer
```
```
F06 End user edit massal di Interactive Grid
    S24 -> Edit -> ubah sel / add row / delete -> Save -> server memproses per baris -> grid refresh
    happy path clicks: 4+
    edge: sebagian baris gagal validasi, konflik checksum, row baru tanpa default PK
```
```
F07 Developer mengamankan app
    S08 -> S10 (pilih/aktifkan auth scheme) -> S11 (buat authz scheme) -> S06 (pasang di page/region/button) -> Run sebagai user tanpa role -> S27
    happy path clicks: ~10
    edge: scheme salah mengunci developer sendiri, evaluation point once-per-session vs per-page
```
```
F08 Promosi DEV -> UAT -> PROD
    S05 -> S16 export (spec file) -> commit git -> S16 import di target -> install -> run
    happy path clicks: ~6
    edge: ID bentrok, versi engine target lebih lama (kasus nyata 26.1.3 → 23.2.6 gagal import), shared component hilang
```
```
F09 Navigasi + session state antar page
    S21 klik link (set P2_ID=..., clear cache page 2) -> S23 menampilkan nilai -> branch kembali -> item tetap tersimpan di session
    happy path clicks: 1-2
    edge: URL tampering (checksum), item protected, nilai lama tertinggal karena cache tidak di-clear
```
```
F10 Developer debugging
    Run -> S26 Debug on -> ulangi aksi -> S28 lihat trace + timing -> S06 perbaiki
    edge: error di proses PL/pgSQL tampil sebagai pesan ramah ke end user, detail hanya di debug
```

Total: **10 flow**. Angka yang harus dikalahkan: F04 = 5 klik, F01 = ~8 klik dari nol sampai app jalan.

## 5. Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | hot (primary), normal, text, danger, icon-only | default, hover, focus, disabled, processing (spinner) | semua |
| Text field | text, number, email, password, with-autocomplete | default, focus, readonly, required, error | S01, S20, S23, S06 |
| Select / Select List | static, dynamic LOV, cascading (parent item) | default, loading (cascade), null option, error | S23, S06 |
| Popup LOV | inline, modal, multi-select | searching, no result, selected | S23 |
| Date picker | date, datetime, inline | default, invalid, min/max | S23, S22 |
| Switch / Checkbox / Radio group | | | S23 |
| File browse | single, multi, drag-drop | uploading, error ukuran/tipe | S23 |
| Rich text / Code editor | SQL, PL/pgSQL, JS, CSS, HTML | syntax error highlight, validate | S06, S09, S11, S17 |
| Interactive Report | default, with saved reports, with chart view, group by, pivot | loading, empty, filled, error | S21 |
| Interactive Grid | read-only, editable, master-detail | view, edit, dirty, row-error, saving | S24 |
| Classic Report / Cards | template-based | empty, filled, paginated | S25 |
| Faceted search | checkbox, range, search | counts updating | S25 |
| Modal dialog | page-as-dialog, inline dialog, confirm | open, close-with-refresh, cancel | S22, S23 |
| Notification / Toast | success, error (list), warning | auto-dismiss, sticky | runtime |
| Region container | standard, collapsible, tabs, hero, card | collapsed/expanded | runtime |
| Navigation menu | side, top, breadcrumb | active, collapsed | runtime |
| Tree (builder) | rendering, processing, DA tree | selected, error badge, drag | S06 |
| Property Editor | grouped properties, show common/all | changed, error, inherited | S06 |
| Layout grid (builder) | 12-column grid, gallery drag-drop | drop target, overflow | S06 |
| Wizard | multi-step, single-step with drawer | next/back, validation | S04, S07 |
| Developer Toolbar | | collapsed, expanded | S26 |
| Data table (builder reports) | sortable, searchable | empty, filled | S03, S05, S09-S12, S19 |

## 6. Inferred data model (PostgreSQL)

Bukti utama untuk metadata adalah **APEX dictionary views** yang terdokumentasi publik. Nama kolom di bawah ini
sengaja ditulis ulang (bukan tiruan nama internal WWV_*), cukup untuk menangkap konsepnya.

### Metadata (builder)

```
Workspace        id, name, schemas[] (PG schema yang boleh dipakai), created_at
                 evidence: S02, S19, APEX_WORKSPACES         confidence: high
DevUser          id, workspace_id, username, email, pwd_hash, is_admin, is_developer, locked
                 evidence: S19                                confidence: high
Application      id, workspace_id, alias, name, version, parsing_schema, theme_id, auth_scheme_id,
                 home_page_id, login_page_id, compatibility, session_timeout, idle_timeout,
                 ssp_enabled, substitutions (jsonb), globalization (jsonb), static_id
                 evidence: S13, APEX_APPLICATIONS             confidence: high
Page             id, app_id, page_no, alias, name, mode (normal|modal|non-modal), template_id,
                 authz_scheme_id, protection_level, read_only_cond, js, css, help, locked_by
                 evidence: S06, APEX_APPLICATION_PAGES        confidence: high
Region           id, page_id, parent_region_id, name, static_id, type (static|classic_report|ir|ig|form|cards|chart|faceted|plugin),
                 source_type (table|sql|function), source (text), position (slot), seq, grid (jsonb: row/col/span),
                 template_id, attributes (jsonb, per tipe), condition (jsonb), authz_scheme_id
                 evidence: S06, APEX_APPLICATION_PAGE_REGIONS confidence: high
RegionColumn     id, region_id, name, label, type, format_mask, link (jsonb), hidden, sortable, heading_align
                 evidence: S21/S24, APEX_APPLICATION_PAGE_IR_COL / _IG_COLUMNS  confidence: high
Item             id, page_id (null = application item), region_id, name (P{page}_X), type, label, seq, grid (jsonb),
                 source (jsonb: db column|static|sql|expression), default (jsonb), lov_id / inline_lov,
                 cascade_parent_items[], required, format_mask, protection (unrestricted|checksum|restricted),
                 encrypt, condition, authz_scheme_id
                 evidence: S06/S23, APEX_APPLICATION_PAGE_ITEMS confidence: high
Button           id, page_id, region_id, name, label, action (submit|redirect|da), request, hot, position, condition
                 evidence: S06, APEX_APPLICATION_PAGE_BUTTONS confidence: high
Computation      id, page_id|app_id, item_name, point (before_header|after_submit|on_login), type, expression, seq
                 evidence: S06/S14                            confidence: high
Validation       id, page_id, name, type (not_null|sql_exists|expression|function_returns_error), expression,
                 error_message, associated_item, when_button, seq
                 evidence: S06, APEX_APPLICATION_PAGE_VAL     confidence: high
Process          id, page_id|app_id, name, point (before_header|after_submit|ajax_callback|on_load),
                 type (form_init|form_dml|ig_dml|plpgsql|clear_cache|close_dialog|plugin), code, when_button,
                 success_msg, error_msg, seq
                 evidence: S06, APEX_APPLICATION_PAGE_PROC    confidence: high
Branch           id, page_id, point (after_submit), target (page/url), when_button, condition, seq
                 evidence: S06, APEX_APPLICATION_PAGE_BRANCHES confidence: high
DynamicAction    id, page_id, name, event (change|click|page_load|dialog_closed|custom), selection (item|button|region|jquery),
                 client_condition (jsonb), seq
DAAction         id, da_id, fire_when (true|false), type (set_value|show|hide|refresh|submit|execute_server_code|execute_js|confirm),
                 affected (jsonb), attributes (jsonb), items_to_submit[], items_to_return[], seq
                 evidence: S06, APEX_APPLICATION_PAGE_DA / _DA_ACTS confidence: high
Lov              id, app_id, name, type (static|sql), source, return_col, display_col, extra_cols (jsonb)
LovEntry         id, lov_id, display, return_value, seq
                 evidence: S09, APEX_APPLICATION_LOVS         confidence: high
AuthScheme       id, app_id, name, type (builtin_accounts|custom_fn|oidc|header|no_auth), attributes (jsonb), is_current
AuthzScheme      id, app_id, name, type (exists_sql|not_exists_sql|fn_boolean|role|group), source, evaluation (once_per_session|per_page|per_component), error_msg
                 evidence: S10/S11                            confidence: high
NavList          id, app_id, name;  NavListEntry: id, list_id, parent_id, label, icon, target, condition, authz_scheme_id, seq
                 evidence: S12                                confidence: high
Theme / Template id, app_id, type (page|region|report|label|button|list|breadcrumb|popup_lov), name, markup (text), css_classes, options (jsonb)
                 evidence: S15                                confidence: medium (akan diganti template engine sendiri)
AppVersion       id, app_id, spec (jsonb/text), exported_at, exported_by, engine_version
                 evidence: S16                                confidence: guess (untuk fitur export/diff)
```

### Runtime

```
AppUser          id, workspace_id, username, email, pwd_hash, groups[], locked, last_login
                 evidence: S19/S20 (APEX accounts)            confidence: high
Session          id (bigint acak), app_id, username, created_at, last_seen, idle_timeout, debug_level, csrf_token
                 evidence: konsep APP_SESSION, APEX_WORKSPACE_SESSIONS  confidence: high
SessionState     session_id, app_id, item_name, value (text), page_id, updated_at   (PK: session_id+item_name)
                 evidence: Session viewer S26, docs session state confidence: high
Collection       session_id, name, seq, c001..c050 → di PG cukup: data jsonb, n001.., d001.. opsional
                 evidence: APEX_COLLECTION API                confidence: high
IrSavedReport    id, region_id, owner (user|null=public), name, is_default, settings (jsonb: filters, sorts, breaks, highlights, aggs, columns)
                 evidence: S21/S22                            confidence: high
DebugMessage     session_id, page_view_id, ts, elapsed_ms, level, component, message
                 evidence: S28                                confidence: high
ActivityLog      ts, app_id, page_id, username, session_id, elapsed_ms, error
                 evidence: APEX_WORKSPACE_ACTIVITY_LOG        confidence: high
```

Relationships: Workspace 1-n Application, Workspace 1-n DevUser/AppUser · Application 1-n Page, Lov, AuthScheme, AuthzScheme, NavList, Template ·
Page 1-n Region (Region bisa nested) · Region 1-n RegionColumn, Item, Button · Page 1-n Computation, Validation, Process, Branch, DynamicAction ·
DynamicAction 1-n DAAction · Session 1-n SessionState, Collection, DebugMessage · Region 1-n IrSavedReport.

Catatan desain untuk replica-architect: APEX menyimpan metadata di tabel relasional. Untuk replika, kombinasi
**tabel per komponen + `attributes jsonb` per tipe** jauh lebih ringan, dan spec file (YAML) bisa diturunkan langsung
dari metadata. PostgreSQL tidak punya ROWID, jadi setiap Form/IG **wajib PK**.

## 7. Feature matrix

See `features.csv`. Must: 30, should: 18, could: 12, skip: 14.

## 8. Out of scope (cannot or should not be cloned)

- **Kompatibilitas PL/SQL & Oracle SQL.** Kode user di replika ditulis dalam PostgreSQL SQL / PL/pgSQL. Aplikasi PANDAWA
  yang sudah ada tidak akan jalan apa adanya. Converter APEX → replika adalah proyek terpisah (`could`).
- **Seluruh API `APEX_*` (100+ package).** Hanya padanan inti yang dibuat: session state, util, collection, error, debug, mail (lewat SMTP).
- **Fitur Oracle Database**: VPD/RAS, Oracle Text, Spatial/vector tiles, Data Pump, ORDS-specific REST enabling. (Untuk REST di PG bisa pakai PostgREST.)
- **Universal Theme, Font APEX, theme style Iris, ikon & ilustrasi Oracle.** Buat design system sendiri (lanjut di `/replica-design`).
- **Format export SQL APEX (`f100.sql`) & APEXlang `.apx`.** Pakai format spec sendiri. Importer `.apx` hanya jika lisensinya jelas.
- **AI features 26.1** (AI Agents, NL Interactive Report, AI Application Generator): bergantung pada provider dan bukan core loop. Masuk `could` untuk fase lanjut.
- **Workflow / Approvals / Automations / Search Config / PWA / Maps / Data Reporter.** Di luar slice.
- **Branding & nama "APEX".** Produk internal butuh nama sendiri (lihat `/replica-brand`).

## 9. Size

Screens 28, flows 10, entities ±27 (21 metadata + 6 runtime).

Hard parts (urut dari yang paling berisiko):
1. **Engine Interactive Report.** Membungkus SQL user secara dinamis dengan filter, sort, control break, aggregate,
   highlight, pagination, dan download, lalu menjaga semuanya tetap aman dari SQL injection dan performan di PostgreSQL.
2. **Page Designer.** Editor 3-pane dengan tree, grid drag-drop, dan property editor yang dinamis per tipe komponen.
   Ini UI paling mahal di seluruh proyek.
3. **Bind variable & substitution engine.** `:P1_X` → parameter `$n` PostgreSQL (parsing SQL, bukan string replace),
   `&ITEM.` dengan escape filter, plus session state + checksum/Session State Protection.
4. Interactive Grid (DML multi-baris, lost-update detection via checksum/version kolom).
5. Runtime client Dynamic Actions (event → actions, AJAX refresh region, items to submit/return).
6. Eksekusi kode user (PL/pgSQL anonymous block via `DO` tidak bisa mengembalikan nilai → perlu pola function sementara/sandbox schema & role per workspace).

Size: **XL untuk slice ini sebagai satu proyek, jadi perlu di-rescope.** Rekomendasi pemecahan:
- **Fase 1 (M, beberapa minggu):** runtime engine dari spec YAML (tanpa builder visual): Form, Classic Report, IR dasar
  (search, sort, filter, pagination), LOV, session state, auth APEX-accounts + OIDC, authz, navigation.
- **Fase 2 (L, ~1 kuartal):** builder (Create App/Page wizard + Page Designer sederhana), Interactive Grid, Dynamic Actions, export/import.
- **Fase 3:** fitur IR lanjutan (saved reports, highlight, chart, group by), SQL Workshop, debug viewer.

Build vs buy: sebelum memulai Fase 2, bandingkan dengan **CYPEX** (komersial, memang menargetkan migrasi APEX/Forms ke PostgreSQL)
dan **SQLPage** (open source, ringan, SQL-first). Jika kebutuhan KCSI cukup dipenuhi oleh salah satunya, Fase 2 bisa dipangkas.
