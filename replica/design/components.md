# rpx design system: component specs

Pengganti Universal Theme **berdasarkan peran**, bukan nilai. Sistem ini original: palet, tipografi, ikon, dan copy dibuat
sendiri, tanpa CSS/JS/aset/nama Universal Theme maupun Font APEX.

- Token: `tokens.json` (sumber tunggal) → `python3 build_tokens.py` → `tokens.css` + `tailwind.preset.cjs` (untuk builder React Fase 2).
- Primitif: `components.css` (prefix kelas `r-`), galeri `primitives.html` (self-contained), screenshot `primitives-desktop.png`, `primitives-mobile.png`.
- Kontras: `python3 contrast.py tokens.json` → **29 pasangan, 0 gagal AA**. Jalankan ulang setiap kali palet berubah (terutama setelah `/replica-brand`).
- Font: **IBM Plex Sans / Plex Mono** (SIL OFL), di-host sendiri lewat `@fontsource`. Tidak bergantung CDN, jadi aman untuk intranet.
- Ikon: **Lucide** (ISC), inline SVG, `aria-hidden` (ikon tidak pernah satu-satunya pembawa makna).
- Bahasa UI default: Bahasa Indonesia. Semua label adalah *translatable text message* (feature "Translations", should).

## Kalibrasi yang masih terbuka

`replica/screens/` masih kosong, sehingga ukuran di bawah ini adalah **usulan**, bukan hasil ukur. Densitas dipilih untuk aplikasi
data bisnis: body 14px, control 34px, baris tabel ±36px. Ambil 3–4 screenshot dari aplikasi PANDAWA yang paling sering dipakai
(IR + form + modal) ke `replica/screens/`, lalu cek apakah densitas ini terasa sama padatnya bagi user. Yang disesuaikan
hanya angka token, bukan komponen.

## Pemetaan ke template engine (kolom `template` di schema)

| level | nilai | markup |
| --- | --- | --- |
| page (`pages.template`) | `standard` | `.r-shell` (header + side nav + main) |
| | `login` | `.r-login` |
| | `modal` | isi `.r-dialog__body` + `.r-dialog__footer`, dirender di dalam `<dialog>` halaman induk |
| | `minimal` | `.r-main` tanpa nav (untuk embed/print) |
| region (`regions.template`) | `standard` | `.r-region` + header/body/footer |
| | `plain` | `.r-region--plain` |
| | `collapsible` | `<details class="r-region">` |
| | `card` | `.r-card` (dipakai region Cards per baris) |
| item (`items.attributes.template`) | `required` / `optional` | `.r-field` + `.r-label` (+ `.r-label__req`) |
| button (`buttons.is_hot`) | hot / normal | `.r-btn--primary` / `.r-btn` |

Grid: `regions.grid.col_span` dan `items.grid.col_span` → `.r-col-{n}` di dalam `.r-row` / `.r-form` (12 kolom). Di bawah 640px
semua kolom menjadi 12.

---

## App shell
```
variants  standard (side nav), nav collapsed (data-nav="collapsed", 56px), mobile (<1024px: nav jadi drawer, data-nav="open")
sizes     header 48px, nav 240px, content padding 24px (12px mobile)
states    nav item: default, hover, current (aria-current="page", garis accent 3px kiri), collapsed (label sr-only)
tokens    header/nav: nav-bg, nav-text, nav-text-muted, nav-active-bg; canvas: bg
a11y      skip link "Lompat ke konten" sebagai elemen pertama; <header>, <nav aria-label>, <main id="main">;
          tombol menu punya aria-expanded; drawer mobile menutup dengan Esc dan mengembalikan fokus ke tombol
used on   semua page runtime (S21–S25), S27
```

## Breadcrumb
```
variants  default
states    item terakhir aria-current="page" (bukan link)
tokens    text-muted, separator border-strong, font sm
a11y      <nav aria-label="Breadcrumb"><ol>
used on   S21, S23, S24, S25
```

## Page head
```
variants  title saja, title + actions
tokens    title xl/600; actions = r-btn
a11y      satu <h1> per page (nama page)
used on   semua page runtime
```

## Region
```
variants  standard, plain, collapsible (<details>), dengan footer (tombol form)
states    default, collapsed, refreshing (aria-busy="true": body redup + spinner kanan atas), error (r-alert di dalam body)
tokens    surface, border, radius lg, shadow region, title md/600, footer surface-sunken
a11y      judul region = <h2>/<h3> sesuai hierarki; aria-busy diset htmx saat partial refresh; region yang
          di-refresh mengumumkan hasil lewat live region global ("Laporan diperbarui, 24 baris")
used on   S21–S25
```

## Button
```
variants  primary (hot), secondary (default), ghost, danger, icon-only
sizes     sm 28px, md 34px, lg 40px
states    default, hover, active (turun 1px), focus-visible (ring 2px focus, offset 2), disabled, loading (aria-busy:
          label transparan, spinner, lebar tidak berubah)
tokens    primary: accent / on-accent, hover accent-hover; danger: danger / on-accent; radius md; font base/600
a11y      <button> asli (atau <a> untuk navigasi); icon-only wajib aria-label; loading tetap menyimpan label untuk
          screen reader; tombol submit mengirim name=REQUEST
used on   semua; footer region S23; toolbar IR S21; dialog S22
```

## Field wrapper (label, help, error)
```
variants  required (tanda * merah, aria-hidden, plus atribut required), optional
states    default, error (aria-invalid="true" + border danger + pesan .r-error-text dengan ikon)
tokens    label sm/600 text; help sm text-muted; error sm/500 danger
a11y      <label for>; help & error dihubungkan lewat aria-describedby; setelah submit gagal, fokus pindah ke
          ringkasan error (r-alert--danger) yang berisi link ke tiap field
used on   S20, S23, S22
```

## Text / number / textarea / password
```
variants  text, number (rata kanan, tabular), textarea (min 84px, resize vertical), password, search (ikon kiri)
sizes     tinggi 34px
states    default, hover (border text-muted), focus (border + ring 1px focus), error, readonly (surface-sunken,
          border tipis), disabled (surface-sunken, text-muted, not-allowed)
tokens    surface, border-input (3.89:1 ✓), text, placeholder text-muted, radius md
a11y      placeholder bukan pengganti label; number memakai inputmode="decimal" dan format mask diterapkan di
          server, bukan via JS yang menggeser kursor
used on   S20, S23, S21 (search)
```

## Select list (static & dynamic LOV, cascading)
```
variants  dengan null option ("- Pilih -"), cascading (parent items)
states    default, focus, error, disabled, loading cascade (aria-busy pada field, opsi lama dikosongkan)
tokens    sama dengan text input + chevron (SVG, warna text-muted)
a11y      <select> native; saat parent berubah, anak di-refresh lewat GET .../lov/:item dan diumumkan
          di live region
used on   S23, S22
```

## Popup LOV
```
variants  modal (dialog sm), multi-select (checkbox per opsi)
states    idle, searching (aria-busy), hasil (kata yang cocok di-<mark>), tanpa hasil (r-empty kecil), terpilih
tokens    input-group (input + tombol ikon search), dialog sm, list option hover/selected accent-subtle
a11y      tombol pemicu aria-label "Pilih <label> dari daftar"; daftar role="listbox" + role="option" +
          aria-selected; panah atas/bawah memindah opsi, Enter memilih, Esc menutup dan fokus kembali ke input;
          nilai yang disimpan = return value, yang tampil = display value
used on   S23
```

## Date / datetime picker
```
variants  date, datetime; input-group dengan tombol kalender
states    default, focus, invalid (format salah atau di luar min/max), disabled
tokens    sama dengan input; kalender memakai dialog/popover sm
a11y      ketik langsung diterima (format mask app, default DD-MM-YYYY); tombol kalender aria-label
          "Buka kalender"; grid kalender pakai pola ARIA grid (panah, PageUp/Down = bulan, Home/End);
          nilai dikirim ke server sebagai ISO, ditampilkan sesuai timezone app/session
used on   S23, S22 (filter IR)
```

## Checkbox, radio group, switch
```
variants  checkbox, radio group (vertikal / inline), switch (on/off item)
states    default, checked, focus, disabled
tokens    accent-color accent; switch track border-input → accent, thumb surface
a11y      native input; group memakai <fieldset><legend>; switch = <input type="checkbox" role="switch">
used on   S23, S25 (facet)
```

## File browse
```
variants  single, multi; drop zone
states    idle, dragover (data-dragover: accent border + accent-subtle), uploading (progress), error (ukuran/tipe)
tokens    surface-sunken, border dashed border-input
a11y      dropzone membungkus <input type="file"> yang tetap bisa difokus dan dipakai lewat keyboard;
          batas ukuran/tipe disebutkan di help text sebelum user memilih
used on   S23 (Fase 2, should)
```

## Badge
```
variants  neutral, success, warning, danger, info
tokens    *-subtle background + teks warna peran (semua ≥ 5.6:1)
a11y      teks selalu ada (warna tidak pernah satu-satunya penanda status)
used on   S21, S25 (kolom status)
```

## Alert / notification / toast
```
variants  success, danger (daftar error dengan link ke field), warning (mis. lost update), info
placement inline di atas region/page, atau toast di kanan atas (sukses setelah PRG, auto-dismiss 5 dtk;
          error tidak pernah auto-dismiss)
tokens    border warna peran + *-subtle background; ikon warna peran
a11y      success/info/warning: role="status"; danger: role="alert"; tombol tutup aria-label "Tutup";
          auto-dismiss berhenti saat hover/fokus
used on   semua page runtime (pesan sukses proses, error validasi), S27
```

## Report table (Classic Report, IR, builder reports)
```
variants  default, compact, dengan control break (r-table__break), dengan total (tfoot)
states    loading (region aria-busy), empty (r-empty), filled, row hover, row selected (aria-selected,
          accent-subtle), kolom tersortir (aria-sort + ikon arah)
tokens    header surface-sunken / text-muted sm/600 sticky; baris border; angka rata kanan, tabular-nums
a11y      <table> asli dengan <caption> (boleh sr-only) dan th scope; header sort = <button> di dalam th;
          link baris punya teks bermakna (nomor dokumen), aksi baris icon-only punya aria-label berisi id baris;
          tabel lebar di-scroll di dalam .r-table-wrap, bukan seluruh halaman
used on   S21, S25, S03, S05, S09–S12, S19
```

## Interactive Report chrome
```
parts     toolbar (search + pemilih kolom + menu Aksi), chips filter aktif, tabel, paginasi
states    search berisi, filter aktif (chips), tidak ada hasil (empty + "Hapus semua filter"), max rows terlampaui
          (alert info), mengunduh (tombol loading)
tokens    toolbar border-bottom; chips surface + border-strong, pill; paginasi text-muted sm
a11y      search memakai label sr-only; tiap chip punya tombol hapus dengan aria-label lengkap;
          perubahan (cari/sort/filter/halaman) = GET partial lewat htmx, URL state ikut diperbarui
          (bisa di-bookmark & tombol back bekerja), hasil diumumkan di live region
used on   S21, S22
```

## Menu (Aksi IR, aksi baris)
```
variants  dengan ikon, dengan separator
states    closed, open, item hover/focus
tokens    surface, border, shadow pop, radius md
a11y      pola ARIA menu button: aria-haspopup="menu", aria-expanded; panah atas/bawah, Home/End,
          Esc menutup dan mengembalikan fokus; implementasi memakai Popover API (light dismiss)
used on   S21, S24
```

## Pagination
```
variants  "baris X–Y dari N" atau "X–Y dari lebih" (tanpa count total, lihat architecture.md)
states    halaman pertama (prev disabled), terakhir (next disabled)
a11y      tombol prev/next dengan aria-label; total baris ikut diumumkan setelah refresh
used on   S21, S25
```

## Empty state
```
variants  laporan kosong (belum ada data), hasil filter kosong (dengan aksi hapus filter), tidak berwenang
tokens    ikon 32px border-strong, judul md/600, teks text-muted
copy      selalu jelaskan apa yang bisa dilakukan berikutnya; tidak pernah cuma "No data found"
used on   S21, S25, S03 (belum ada app)
```

## Dialog (modal page, inline dialog, confirm)
```
variants  sm 480, md 720, lg 960; confirm (sm, tombol danger untuk aksi destruktif)
states    open (animasi masuk 180ms, nonaktif bila prefers-reduced-motion), loading isi, error dalam dialog
tokens    surface, radius lg, shadow dialog, backdrop rgba(17,24,39,.45), header title lg/600, footer surface-sunken
a11y      <dialog> native + showModal() (fokus terkunci, Esc menutup, latar inert); aria-labelledby ke judul;
          fokus awal ke field pertama; saat ditutup fokus kembali ke pemicu; modal page = fragmen HTML
          yang dimuat ke dialog, dan "close dialog" memicu refresh region pemanggil
used on   S22, S23 (modal), popup LOV, konfirmasi hapus
```

## Cards region
```
variants  link card, card statis
states    hover (border accent), empty
tokens    surface, border, radius lg; title md/600; meta sm text-muted
a11y      seluruh kartu satu <a>; judul kartu menjadi teks link; tidak ada link bersarang di dalam kartu
used on   S25
```

## Faceted search
```
variants  checkbox facet dengan count, (nanti) range, search
states    count berubah saat filter lain dipilih; facet tanpa nilai disembunyikan
tokens    legend 600, count xs text-muted
a11y      <fieldset><legend> per facet; perubahan me-refresh region terkait (aria-controls) dan diumumkan
used on   S25
```

## Login page
```
variants  built-in accounts, OIDC saja (satu tombol "Masuk dengan akun KCSI"), keduanya (dengan divider "atau")
states    default, kredensial salah (alert danger umum: tidak menyebut field mana yang salah), akun terkunci,
          session habis ("Sesi berakhir, silakan masuk lagi")
tokens    canvas bg, region standard, lebar 400px
a11y      autocomplete="username"/"current-password"; error diumumkan role="alert"
used on   S20
```

## Developer toolbar
```
variants  collapsed/expanded
tokens    nav-bg, nav-text, pill, shadow pop; fixed bottom-center
a11y      role="toolbar" dengan aria-label; hanya dirender untuk session developer; tidak ikut tercetak
used on   S26 (link ke S28 debug, session viewer)
```

## Komponen builder (Fase 2, belum dibangun)

Tree, Property Editor, layout grid drag-drop, code editor (CodeMirror 6, MIT), wizard, dan data table builder memakai token
yang sama lewat `tailwind.preset.cjs` di aplikasi builder React. Basis aksesibel yang disarankan: **React Aria Components**
(Apache-2.0), karena mencakup tree, grid, combobox, dan drag-drop dengan keyboard support. Spec detail ditulis saat Fase 2 dimulai.

## Yang sengaja **tidak** dipakai

- Universal Theme CSS/JS, theme style Vita/Redwood/Iris, Theme Roller, Font APEX.
- Nama kelas `t-*` / `u-*` ala UT, supaya tidak ada godaan menyalin.
- Warna merek Oracle. `accent` masih **placeholder biru**; nilainya diganti di `/replica-brand`.
- Dark mode: `should`, menyusul sebagai set token kedua (`[data-theme="dark"]`) yang juga harus lolos `contrast.py`.
