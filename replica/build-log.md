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
