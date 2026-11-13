# Backend: status & checklist

Konteks: produk **internal** KCSI. Pembayaran (Stripe), sign-up publik, dan penghapusan akun mandiri tidak relevan,
jadi tidak dibangun. Email transaksional berstatus `could` (`APEX_MAIL` equivalent) dan belum dibangun.

## Auth

| bagian | status | catatan |
| --- | --- | --- |
| Akun bawaan (built-in accounts) | ✅ | argon2id; kunci setelah 5 gagal; pesan error seragam; session id baru setelah login |
| **SSO OIDC** | ✅ | authorization code + **PKCE (S256) + state + nonce**, `openid-client` v6. Satu IdP per aplikasi. |
| Provisioning user SSO | ✅ | dicocokkan lewat `(workspace, issuer, sub)`; user baru dibuat otomatis (`provision: true`) |
| Grup dari IdP | ✅ | `groups_claim` → `app_users.groups`, diperbarui setiap login (dipakai authorization schemes di M2) |
| Pembatasan domain | ✅ | `allowed_domains` dicek terhadap email atau klaim `hd`; `email_verified: false` ditolak |
| Benturan nama | ✅ | nama SSO yang sama dengan akun lokal **tidak** digabung (409); admin yang memutuskan |
| Gabungan SSO + kata sandi | ✅ | `allow_builtin: true` menampilkan tombol SSO dan form kata sandi |
| Session | ✅ | cookie httpOnly, SameSite=Lax, Secure di produksi (`RPX_SECURE_COOKIES=1`), path per aplikasi; idle + absolute timeout |
| Keluar dari semua perangkat | ⬜ | belum. Rencana: `rpx user logout-all` / tombol admin |
| Single logout ke IdP | ⬜ | belum. Keluar hanya mengakhiri session aplikasi, bukan session di Entra/Google |

### Konfigurasi SSO di spec

```yaml
authentication:
  scheme: oidc
  allow_builtin: false              # true = tampilkan juga form kata sandi
  oidc:
    issuer: https://login.microsoftonline.com/<TENANT_ID>/v2.0
    client_id: <APPLICATION_CLIENT_ID>
    client_secret_env: RPX_OIDC_SECRET_KCSI   # NAMA env var, bukan secret-nya
    scopes: openid profile email              # default
    username_claim: preferred_username        # default; fallback ke email lalu sub
    groups_claim: roles                       # opsional
    allowed_domains: [kcsi.co.id]             # opsional
    button_label: Masuk dengan akun KCSI
```

Redirect URI yang didaftarkan di IdP: `${RPX_PUBLIC_URL}/r/<workspace>/<app>/oidc/callback` (satu per aplikasi).

### Yang perlu dibuat oleh admin KCSI (bukan oleh Claude)

**Microsoft Entra ID** (bila KCSI memakai Microsoft 365):
1. Entra admin center → App registrations → New registration. Platform **Web**, redirect URI seperti di atas.
2. Certificates & secrets → client secret baru → simpan di env server (`RPX_OIDC_SECRET_KCSI`). Catat tanggal kedaluwarsanya.
3. Token configuration → tambahkan optional claim `email`.
4. Untuk grup: lebih mudah memakai **App roles** (klaim `roles`, isinya nama yang Anda tentukan) daripada klaim
   `groups`, karena `groups` berisi object ID dan bisa terpotong bila user punya banyak grup.
5. Issuer: `https://login.microsoftonline.com/<TENANT_ID>/v2.0`.

**Google Workspace**:
1. Google Cloud console (project milik KCSI) → OAuth consent screen dengan user type **Internal**. Aplikasi internal tidak perlu
   verifikasi Google, jadi tidak ada antrean review berminggu-minggu.
2. Credentials → OAuth client ID → Web application → redirect URI seperti di atas.
3. Issuer `https://accounts.google.com`, `allowed_domains: [<domain-workspace>]` (dicek lewat klaim `hd`/email).
   Google tidak mengirim grup di ID token. Grup diatur manual (`rpx user add --group`) atau lewat Directory API (belum dibangun).

Langkah-langkah di atas ditulis dari pengetahuan umum tentang kedua konsol. Nama menu bisa berubah, jadi cocokkan dengan
dokumentasi resmi saat mengonfigurasi.

## Database

| bagian | status | catatan |
| --- | --- | --- |
| Migrasi di repo, dijalankan script | ✅ | `db/migrations/000N_*.sql`, `rpx db migrate` (advisory lock, satu transaksi per file) |
| Aturan akses | ✅ | **pemeriksaan di data layer + role PostgreSQL**: engine = `rpx_engine`, kode developer = `SET LOCAL ROLE ws_*` tanpa akses ke `rpx` (dites) |
| Isolasi antar-user | ✅ | session, checksum URL, dan token versi baris terikat ke salt per session (dites: link dari session lain → 403) |
| **Lost update** | ✅ | form_init menandatangani hash baris (HMAC per session); form_dml membaca ulang `FOR UPDATE` dan menolak bila berbeda. Berlaku untuk update dan delete. Validasi gagal tidak "menyegarkan" versi diam-diam |
| Seed data realistis | ✅ | `examples/emp/seed.sql` (nama fiktif) |
| Backup | ⬜ | **tanggung jawab infra**: aktifkan backup harian PostgreSQL (pgBackRest / snapshot RDS) sebelum go-live. Belum diverifikasi |

## Email & jobs

| bagian | status |
| --- | --- |
| Email transaksional (SMTP relay internal) | ⬜ could, belum |
| Job pembersihan session/debug/activity | ⬜ M5 (`purge_sessions`, dsb. di `architecture.md`) |

## Integrasi

Tidak ada integrasi pihak ketiga di Fase 1 selain IdP. SAP/EBS lewat REST data source masuk `could`.

## Security checklist

- [x] secrets hanya di env (`.env*` di `.gitignore`, `.env.example` tanpa nilai); spec hanya menyimpan **nama** env var client secret
- [x] input divalidasi di server: spec (JSON Schema + aturan semantik), form (tipe item, tombol harus ada di page, item restricted/display-only diabaikan), URL (nama item dikenal + checksum)
- [x] otorisasi pada setiap baca/tulis, dites dengan user/session kedua (checksum lintas session, lost update dua editor)
- [x] rate limit pada login kata sandi dan rute SSO (default 20/menit/IP, `RPX_LOGIN_RATE_LIMIT`) + kunci akun
- [x] webhooks: tidak ada di Fase 1
- [x] upload: belum ada fitur upload (akan dibatasi ukuran/tipe saat item File dibuat)
- [~] data di URL: argumen item (mis. `P2_EMPNO`) dibuang dari address bar lewat redirect 303, tetapi masih tercatat sekali di access log Fastify. Body dan kata sandi tidak pernah di-log. Rencana: redaksi query string di logger (M5)
- [x] `npm audit --omit=dev`: 0 kerentanan (2026-11-13)
- [ ] kebijakan privasi internal: catat pemroses data (host server, IdP Microsoft/Google). Perlu dari Legal/IT governance KCSI
- [x] CSRF token di semua POST, CSP ketat (`script-src 'self'`), output di-escape secara default
