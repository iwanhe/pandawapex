# Demo publik lewat Cloudflare Tunnel

Panduan ini membuka pandawapex yang berjalan di server atau laptop lokal ke internet lewat **Cloudflare Tunnel**. Tidak ada
port yang dibuka di router dan PostgreSQL tidak ikut terekspos. Satu tunnel melayani dua hostname:

| Hostname | Untuk | Perlindungan |
| --- | --- | --- |
| `demo.domain-anda.com` | pengguna aplikasi (`/r/...`) | login aplikasi pandawapex; WAF dan rate limit Cloudflare |
| `builder.domain-anda.com` | developer (`/builder`) | Cloudflare Access (hanya email yang diizinkan), lalu login developer pandawapex |

Builder dilindungi tiga lapis:
1. Cloudflare Access di hostname builder.
2. `RPX_BUILDER_HOSTS`: pandawapex sendiri menjawab **404 untuk `/builder` di hostname lain**. `demo.domain-anda.com/builder`
   tetap tertutup walaupun aturan Access salah atur.
3. Login developer pandawapex (kunci akun setelah 5 kali gagal, rate limit per IP).

Ganti `domain-anda.com` dengan domain Anda yang sudah aktif di Cloudflare.

## Pilih cara pasang

| Server | Cara | Bagian |
| --- | --- | --- |
| Ubuntu dengan Docker | overlay Docker Compose (paling sedikit langkah) | [A](#a-docker-ubuntu-atau-windows-dengan-docker-desktop) |
| Windows dengan Docker Desktop | overlay Docker Compose | [A](#a-docker-ubuntu-atau-windows-dengan-docker-desktop) |
| Ubuntu tanpa Docker | Node + PostgreSQL di host, cloudflared sebagai service systemd | [B](#b-ubuntu-tanpa-docker) |
| Windows tanpa Docker (Cmder + PostgreSQL portable, seperti [checkpoint-fase1](checkpoint-fase1.md)) | `start-lokal.cmd`, cloudflared sebagai Windows service | [C](#c-windows-tanpa-docker-cmder--postgresql-portable) |
| Uji cepat tanpa domain | Quick Tunnel `trycloudflare.com` | [D](#d-uji-cepat-tanpa-domain-quick-tunnel) |

Semua cara memakai bagian [1](#1-siapkan-di-cloudflare) dan diakhiri dengan [checklist](#4-sebelum-dibuka-ke-publik) serta
[verifikasi](#5-verifikasi).

---

## 1. Siapkan di Cloudflare

### 1.1 Buat tunnel

1. Cloudflare dashboard → **Networking → Tunnels** (di tampilan lama: Zero Trust → Networks → Tunnels) → **Create tunnel**.
2. Pilih tipe **Cloudflared**, beri nama misalnya `pandawapex`.
3. Di langkah *Install and run connector*, dashboard menampilkan perintah pemasangan untuk OS yang dipilih (Docker, Debian/Ubuntu,
   Windows), lengkap dengan **token** tunnel.
   - Cara A (Docker): salin **hanya token**-nya (teks panjang setelah `--token`), untuk `.env`.
   - Cara B dan C: perintah `cloudflared service install <token>` dari dashboard dipakai di bagian B2/C3.

   Token ini rahasia: jangan ditempel di GitHub, issue, atau chat. Kalau bocor, buat ulang token di halaman tunnel.

### 1.2 Hostname publik

Di tab **Published application routes / Public Hostnames** tunnel, tambahkan dua route:

| Hostname | Type | URL untuk cara A (Docker) | URL untuk cara B / C (tanpa Docker) |
| --- | --- | --- | --- |
| `demo.domain-anda.com` | HTTP | `app:8080` | `localhost:8080` |
| `builder.domain-anda.com` | HTTP | `app:8080` | `localhost:8080` |

Di Docker, `localhost` menunjuk ke container cloudflared itu sendiri, jadi harus memakai nama service `app`. Tanpa Docker,
cloudflared berjalan di mesin yang sama dengan pandawapex, sehingga memakai `localhost`.

DNS untuk kedua hostname dibuat otomatis oleh Cloudflare saat route disimpan.

### 1.3 Cloudflare Access untuk builder

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**.
2. Domain: `builder.domain-anda.com`, tanpa path.
3. Policy: **Allow**, *Include* → *Emails* → email developer Tim PANDAWA (atau grup IdP perusahaan).
4. Simpan, lalu uji dengan email yang diizinkan dan yang tidak.

Jangan pasang Access di `demo.domain-anda.com` atau di seluruh domain: pengguna demo cukup memakai login aplikasi.

### 1.4 Aturan tambahan (disarankan)

- **Security → WAF**: aktifkan managed rules dan buat rate limiting rule untuk `demo.domain-anda.com`.
- Blokir `/healthz` dari luar: custom rule *Hostname equals demo.domain-anda.com AND URI Path equals /healthz → Block*.
  Endpoint itu hanya untuk pemeriksaan kesehatan lokal.

---

## A. Docker (Ubuntu, atau Windows dengan Docker Desktop)

Prasyarat: instalasi Docker dari [install-lokal.md](install-lokal.md#a-docker-compose) sudah berjalan di
`http://localhost:8080`. Ubuntu memakai Docker Engine + plugin Compose ([docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)).
Windows memakai Docker Desktop dengan WSL 2.

### A1. Isi `.env`

```bash
cat .env.cloudflare.example >> .env          # Windows PowerShell: Get-Content .env.cloudflare.example | Add-Content .env
```

Lalu buka `.env` dan isi:

| Variabel | Isi |
| --- | --- |
| `RPX_SECRET` | `openssl rand -hex 32` |
| `RPX_DEMO_PASSWORD` | kata sandi demo baru, minimal 10 karakter, **berbeda** dari yang dipakai lokal |
| `POSTGRES_PASSWORD` | kata sandi kuat untuk superuser database (hanya dipakai setup) |
| `CLOUDFLARE_TUNNEL_TOKEN` | token dari langkah 1.1 |
| `RPX_ENGINE_PASSWORD` | `openssl rand -hex 24` (huruf/angka saja, minimal 16 karakter) |
| `RPX_PUBLIC_URL` | `https://demo.domain-anda.com` |
| `RPX_BUILDER_HOSTS` | `builder.domain-anda.com` (atau `none` untuk mematikan builder) |

Belum ada `openssl` di Windows? Pakai Git Bash (ikut terpasang dengan Git for Windows), atau
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.

> Mengganti `POSTGRES_PASSWORD` setelah database terlanjur dibuat tidak mengubah kata sandi di database. Untuk instalasi
> percobaan yang belum berisi data penting, mulai bersih dengan `docker compose down -v`.

### A2. Jalankan

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml ps
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml logs -f cloudflared
```

Yang diharapkan:
- `setup` dan `engine-role` berstatus *exited (0)*, `engine-role` mencetak `role rpx_engine siap`.
- `app` berstatus *healthy*.
- Log `cloudflared` berisi `Registered tunnel connection` (biasanya empat kali).

Yang dilakukan overlay `docker-compose.cloudflare.yml`:
- **engine-role** memberi kata sandi ke role `rpx_engine` (dibuat migrasi). App kemudian tersambung sebagai `rpx_engine`, bukan
  superuser `postgres`. `postgres` hanya dipakai `setup` untuk migrasi dan data contoh.
- **app** mendapat `RPX_SECURE_COOKIES=1`, `RPX_PUBLIC_URL`, `RPX_TRUST_PROXY=1` (IP klien diambil dari alamat yang ditambahkan
  Cloudflare, bukan dari header buatan klien) dan `RPX_BUILDER_HOSTS`.
- **cloudflared** membaca token dari variabel `TUNNEL_TOKEN` (tidak tampil di daftar proses). Tanpa port, read-only, tanpa
  capability.

Port 8080 dan 55432 tetap hanya terbuka di `127.0.0.1` komputer itu. Jangan menambah port forwarding di router.

Lanjut ke [checklist](#4-sebelum-dibuka-ke-publik).

---

## B. Ubuntu tanpa Docker

Contoh untuk Ubuntu 24.04 (PostgreSQL 16 tersedia di repositori bawaan). Aplikasi dipasang di `/opt/pandawapex` dan
dijalankan systemd sebagai user `pandawapex`.

### B1. pandawapex

```bash
# Node.js 22 (repositori Ubuntu masih versi lama) dan PostgreSQL
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql git
node --version                                    # harus >= 22.18

# kode
sudo useradd --system --home /opt/pandawapex --shell /usr/sbin/nologin pandawapex
sudo git clone https://github.com/iwanhe/pandawapex.git /opt/pandawapex
cd /opt/pandawapex && sudo npm ci --omit=dev && sudo chown -R pandawapex: /opt/pandawapex

# database, kata sandi superuser (untuk setup), data contoh
sudo -u postgres psql -c "create database rpx"
sudo -u postgres psql -c "alter role postgres with password '<sandi-postgres>'"
DATABASE_URL='postgres://postgres:<sandi-postgres>@localhost/rpx' RPX_DEMO_PASSWORD='<sandi-demo-baru>' \
  npm run rpx -- demo setup
DATABASE_URL='postgres://postgres:<sandi-postgres>@localhost/rpx' RPX_DEMO_PASSWORD='<sandi-demo-baru>' \
  npm run rpx -- pilot setup                      # opsional

# role engine (dibuat oleh migrasi), diberi kata sandi
ENGINE_PW=$(openssl rand -hex 24); echo "$ENGINE_PW"
sudo -u postgres psql -d rpx -c "alter role rpx_engine with login password '$ENGINE_PW'"
```

Simpan konfigurasi engine di file yang hanya bisa dibaca root (systemd membacanya sebelum menjalankan service):

```bash
sudo install -m 600 /dev/null /etc/pandawapex.env
sudo tee /etc/pandawapex.env >/dev/null <<EOF
RPX_DATABASE_URL=postgres://rpx_engine:$ENGINE_PW@localhost:5432/rpx
RPX_SECRET=$(openssl rand -hex 32)
HOST=127.0.0.1
PORT=8080
RPX_SECURE_COOKIES=1
RPX_PUBLIC_URL=https://demo.domain-anda.com
RPX_TRUST_PROXY=1
RPX_BUILDER_HOSTS=builder.domain-anda.com
EOF
```

`/etc/systemd/system/pandawapex.service`:

```ini
[Unit]
Description=pandawapex engine
After=network.target postgresql.service

[Service]
User=pandawapex
WorkingDirectory=/opt/pandawapex
EnvironmentFile=/etc/pandawapex.env
ExecStart=/usr/bin/node src/engine/main.ts
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now pandawapex
curl -fsS http://127.0.0.1:8080/healthz          # {"ok":true}
```

`HOST=127.0.0.1` membuat engine hanya bisa dicapai dari mesin itu, yaitu oleh cloudflared. Itu syarat `RPX_TRUST_PROXY=1`.

### B2. cloudflared

Repositori resmi Cloudflare:

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

Pasang sebagai service dengan perintah dari dashboard (langkah 1.1, pilih Debian):

```bash
sudo cloudflared service install <TOKEN>
sudo systemctl status cloudflared                 # active (running)
```

Di dashboard, status tunnel berubah menjadi **Healthy**. Route memakai `localhost:8080` (langkah 1.2).

Memperbarui nanti:

```bash
sudo apt-get update && sudo apt-get install --only-upgrade cloudflared && sudo systemctl restart cloudflared
cd /opt/pandawapex && sudo -u pandawapex git pull && sudo npm ci --omit=dev && sudo chown -R pandawapex: . \
  && DATABASE_URL='postgres://postgres:<sandi-postgres>@localhost/rpx' npm run rpx -- db migrate \
  && sudo systemctl restart pandawapex
```

Lanjut ke [checklist](#4-sebelum-dibuka-ke-publik).

---

## C. Windows tanpa Docker (Cmder + PostgreSQL portable)

Untuk laptop atau PC yang sudah menjalankan pandawapex seperti di [checkpoint-fase1.md](checkpoint-fase1.md) dan
[checkpoint-fase2.md](checkpoint-fase2.md) (`start-lokal.cmd`, PostgreSQL di `D:\Software\PGSQL`).

### C1. Kata sandi role engine

Di Cmder, dari folder repo, dengan PostgreSQL menyala:

```bat
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
"D:\Software\PGSQL\bin\psql" -U postgres -d rpx -c "alter role rpx_engine with login password '<hasil-di-atas>'"
```

### C2. Jalankan pandawapex dalam mode publik

Variabel yang di-`set` sebelum `start-lokal.cmd` tetap dipakai oleh script itu. Engine membaca `RPX_DATABASE_URL` lebih dulu
daripada `DATABASE_URL`:

```bat
set RPX_DATABASE_URL=postgres://rpx_engine:<sandi-engine>@localhost:5432/rpx
set RPX_PUBLIC_URL=https://demo.domain-anda.com
set RPX_SECURE_COOKIES=1
set RPX_TRUST_PROXY=1
set RPX_BUILDER_HOSTS=builder.domain-anda.com
start-lokal.cmd
```

`start-lokal.cmd` sudah memakai `HOST=127.0.0.1`, jadi engine hanya bisa dicapai dari laptop itu (oleh cloudflared).
Biarkan jendelanya terbuka, dan atur *Power & sleep* supaya laptop tidak tidur selama demo.

Dengan `RPX_BUILDER_HOSTS`, `http://localhost:8080/builder` di laptop itu juga 404. Untuk memakai builder secara lokal,
tambahkan `localhost` ke daftar: `set RPX_BUILDER_HOSTS=builder.domain-anda.com,localhost`.

### C3. cloudflared

Di Command Prompt **sebagai Administrator**:

```bat
winget install --id Cloudflare.cloudflared
```

Buka jendela Administrator baru (agar PATH terbaru terbaca), lalu jalankan perintah dari dashboard (langkah 1.1, pilih Windows):

```bat
cloudflared.exe service install <TOKEN>
sc query cloudflared
```

`STATE` harus `RUNNING`, dan di dashboard tunnel berstatus **Healthy**. Route memakai `localhost:8080` (langkah 1.2).
Service ini ikut menyala saat Windows dinyalakan. pandawapex sendiri baru menyala setelah `start-lokal.cmd` dijalankan.

cloudflared di Windows tidak memperbarui dirinya sendiri. Sesekali jalankan:

```bat
winget upgrade --id Cloudflare.cloudflared
net stop cloudflared && net start cloudflared
```

Lanjut ke [checklist](#4-sebelum-dibuka-ke-publik).

---

## D. Uji cepat tanpa domain (Quick Tunnel)

Untuk melihat demo dari HP atau komputer lain dalam beberapa menit, tanpa domain dan tanpa akun Cloudflare:

```bash
cloudflared tunnel --url http://localhost:8080
```

cloudflared mencetak alamat acak `https://<kata-acak>.trycloudflare.com`. Alamat itu berlaku selama perintah berjalan;
tekan Ctrl+C untuk menutupnya. Karena tidak ada Cloudflare Access, **matikan builder** dan pakai data contoh saja:

- Docker: tambahkan `RPX_BUILDER_HOSTS=none`, `RPX_TRUST_PROXY=1`, `RPX_SECURE_COOKIES=1` ke `.env`, jalankan
  `docker compose up -d` biasa (tanpa overlay), lalu jalankan quick tunnel di host.
- Tanpa Docker: `set RPX_BUILDER_HOSTS=none`, `set RPX_TRUST_PROXY=1`, `set RPX_SECURE_COOKIES=1` sebelum `start-lokal.cmd`.

cloudflared untuk perintah ini dipasang seperti di B2 (Ubuntu) atau C3 (Windows); service tidak perlu dipasang.

Quick Tunnel ditujukan untuk uji coba, bukan untuk demo yang dibagikan luas.

---

## 4. Sebelum dibuka ke publik

- [ ] **Engine tersambung sebagai `rpx_engine`**, bukan `postgres`. Cek:
      `select usename, count(*) from pg_stat_activity where datname = 'rpx' group by 1;`
      Docker: `docker compose exec db psql -U postgres -d rpx -c "<query di atas>"`.
- [ ] **Kata sandi demo diganti.** `demo setup` dan `pilot setup` memberi kata sandi yang sama (`RPX_DEMO_PASSWORD`) ke
      semua user contoh dan ke developer `admin`. Lewat `builder.domain-anda.com`:
      *Pengguna aplikasi* → buka tiap user → atur ulang kata sandi, kunci atau hapus yang tidak dipakai.
      *Akun saya* untuk kata sandi developer `admin`.
- [ ] **Data contoh saja.** Jangan memuat data karyawan, pelanggan, keuangan, atau data produksi.
- [ ] **Builder tertutup di hostname demo**: `https://demo.domain-anda.com/builder` menjawab 404.
- [ ] **Builder di balik Access**: `https://builder.domain-anda.com` meminta login Cloudflare, dan email lain ditolak.
- [ ] **`RPX_TRUST_PROXY=1` hanya bila engine tidak bisa dicapai langsung** (Docker dengan port `127.0.0.1`, atau
      `HOST=127.0.0.1`). Bila engine juga terbuka di LAN, pakai `RPX_TRUST_PROXY=false`.
- [ ] **Tidak ada port forwarding** 8080 atau 5432 di router.
- [ ] `/healthz` diblokir di Cloudflare (langkah 1.4).
- [ ] Backup database terjadwal dan restore pernah dicoba ([operasional.md](operasional.md)).

## 5. Verifikasi

Dari perangkat di luar jaringan lokal (misalnya HP dengan data seluler):

| Buka | Yang diharapkan |
| --- | --- |
| `https://demo.domain-anda.com/r/demo/emp` | halaman login aplikasi; login dengan kata sandi baru berhasil |
| `https://demo.domain-anda.com/r/pandawa/demo` | pilot Demo Permintaan Barang (bila `pilot setup` dijalankan) |
| `https://demo.domain-anda.com/builder` | 404 "Halaman tidak ditemukan" |
| `https://builder.domain-anda.com/builder` | login Cloudflare Access, lalu login developer pandawapex |
| `https://builder.domain-anda.com/builder` dengan email yang tidak diizinkan | ditolak oleh Cloudflare |
| `https://demo.domain-anda.com/healthz` | diblokir oleh aturan WAF |
| IP publik rumah/kantor port 8080 atau 5432 | tidak bisa dibuka |

## 6. Operasional

| | Docker | Ubuntu tanpa Docker | Windows tanpa Docker |
| --- | --- | --- | --- |
| Status | `docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml ps` | `systemctl status pandawapex cloudflared` | `sc query cloudflared`, jendela `start-lokal.cmd` |
| Log | `... logs -f app cloudflared` | `journalctl -u pandawapex -u cloudflared -f` | jendela `start-lokal.cmd`; Event Viewer untuk cloudflared |
| Restart tunnel | `... restart cloudflared` | `sudo systemctl restart cloudflared` | `net stop cloudflared && net start cloudflared` |
| Perbarui pandawapex | `git pull`, lalu `... up -d --build` | lihat akhir B2 | `git pull`, `npm install`, `npm run rpx -- db migrate`, jalankan ulang |
| Matikan | `... down` (data tetap ada) | `sudo systemctl stop pandawapex cloudflared` | tutup jendela, `net stop cloudflared` |

`...` = `docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml`. Jangan memakai `down -v` kecuali memang ingin
menghapus database.

## Troubleshooting

| Gejala | Penyebab dan solusi |
| --- | --- |
| **502 Bad Gateway** di hostname | route mengarah ke alamat yang salah (Docker: `app:8080`; tanpa Docker: `localhost:8080`) atau pandawapex belum menyala (`/healthz` di server) |
| `Provided Tunnel token is not valid` di log cloudflared | token terpotong atau salah salin; salin ulang dari halaman tunnel |
| `engine-role` gagal: "hanya boleh huruf, angka" | `RPX_ENGINE_PASSWORD` berisi karakter lain; buat ulang dengan `openssl rand -hex 24` |
| `password authentication failed for user "rpx_engine"` | kata sandi di `RPX_DATABASE_URL` berbeda dengan di database; ulangi `alter role rpx_engine ...` (Docker: `docker compose ... up -d` menjalankan `engine-role` lagi) |
| `password authentication failed for user "postgres"` di `setup` (Docker) | `POSTGRES_PASSWORD` diganti setelah database dibuat; kembalikan, atau mulai bersih dengan `down -v` |
| Builder 404 di `builder.domain-anda.com` | nilai `RPX_BUILDER_HOSTS` tidak sama persis dengan hostname (tanpa `https://`, tanpa garis miring) |
| Login berhasil tapi kembali ke halaman login | `RPX_SECURE_COOKIES=1` dipakai lewat `http://` dari komputer lain; buka lewat hostname `https://` |
| Rate limit login mengenai semua pengguna sekaligus | `RPX_TRUST_PROXY=false` padahal lewat cloudflared, sehingga semua permintaan terlihat dari IP cloudflared; pakai `1` |
