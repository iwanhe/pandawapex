# Panduan penggunaan pandawapex

Panduan ini untuk developer Tim PANDAWA yang membuat dan mengubah aplikasi di **builder** pandawapex, dan untuk
pengguna yang menjalankan aplikasinya. Belum terpasang? Ikuti [install-lokal.md](install-lokal.md) dulu.

Baru pertama kali memakai builder? Baca bagian 1, lalu kerjakan tutorial di bagian 2 dari awal sampai akhir.

Isi:

1. [Konsep dasar](#1-konsep-dasar)
2. [Tutorial: aplikasi pertama dari tabel sendiri](#2-tutorial-aplikasi-pertama-dari-tabel-sendiri)
3. [Masuk ke builder](#3-masuk-ke-builder)
4. [Mengelola akun](#4-mengelola-akun)
5. [Membuat aplikasi dari tabel](#5-membuat-aplikasi-dari-tabel)
6. [Menambah halaman](#6-menambah-halaman)
7. [Mengubah halaman di Page Designer](#7-mengubah-halaman-di-page-designer)
8. [Properti aplikasi](#8-properti-aplikasi)
9. [Ekspor, impor, dan riwayat versi](#9-ekspor-impor-dan-riwayat-versi)
10. [Menjalankan aplikasi (pengguna)](#10-menjalankan-aplikasi-pengguna)
11. [Perintah CLI](#11-perintah-cli)
12. [Catatan untuk developer APEX](#12-catatan-untuk-developer-apex)
13. [Pertanyaan umum](#13-pertanyaan-umum)

## 1. Konsep dasar

| Istilah | Arti | Padanan di APEX |
| --- | --- | --- |
| **Workspace** | wadah aplikasi, developer, dan pengguna aplikasi; terhubung ke satu atau beberapa skema PostgreSQL | workspace |
| **Skema** | skema PostgreSQL tempat tabel aplikasi; kode aplikasi berjalan sebagai role workspace (`ws_<nama>`) | parsing schema |
| **Aplikasi** | kumpulan halaman dengan alias, mis. `demo`; dibuka di `/r/<workspace>/<alias>` | application |
| **Halaman** | bernomor (1, 2, 100, …); berisi region, validasi, proses, branch | page |
| **Region** | blok di halaman: teks/HTML, classic report, Interactive Report, form, grafik | region |
| **Item** | isian di region, bernama `P<halaman>_<NAMA>`, mis. `P2_NAMA` | page item |
| **Developer** | akun untuk builder (`/builder`) | developer / workspace admin |
| **Pengguna aplikasi** | akun untuk login ke aplikasi; berlaku untuk semua aplikasi di workspace; akses diatur lewat **grup** | end user + group |
| **Spec** | definisi aplikasi dalam YAML; builder menyimpan setiap perubahan sebagai spec baru di riwayat versi | export file / APEXlang |

Akun developer dan akun pengguna aplikasi terpisah. Developer yang ingin mencoba aplikasinya sendiri perlu membuat akun
pengguna aplikasi untuk dirinya (bagian 4).

## 2. Tutorial: aplikasi pertama dari tabel sendiri

Dalam tutorial ini Anda membuat aplikasi **Stok Barang** dari nol: satu workspace baru, satu tabel, lalu aplikasinya dibuat
lewat builder. Waktu sekitar 20 menit. Syarat: pandawapex sudah terpasang dan aplikasi contoh bisa dibuka
([install-lokal.md](install-lokal.md)).

Langkah 1–4 memakai terminal (sekali saja per workspace). Langkah 5–11 dilakukan di browser.

### Langkah 1. Buka terminal di folder repo dan isi `DATABASE_URL`

Pakai perintah yang sesuai cara instalasi Anda:

| Cara instalasi | Perintah |
| --- | --- |
| Cmder + PostgreSQL portable | `cd /d D:\pandawapex` lalu `set "DATABASE_URL=postgres://postgres@localhost:5432/rpx"` |
| PowerShell + installer | `cd C:\pandawapex` lalu `$env:DATABASE_URL = "postgres://postgres:<katasandi>@localhost:5432/rpx"` |
| Linux / macOS | `cd pandawapex` lalu `export DATABASE_URL="postgres://$USER@/rpx?host=/var/run/postgresql"` (macOS: `postgres://$USER@localhost/rpx`) |
| Docker | `cd pandawapex`. Tidak perlu `DATABASE_URL`; perintah `npm run rpx -- …` di bawah diganti `docker compose run --rm rpx …` |

PostgreSQL harus sudah menyala.

### Langkah 2. Buat workspace dan skema

Workspace adalah wadah aplikasi, developer, dan pengguna. Skema adalah tempat tabel aplikasi di PostgreSQL.

```bash
npm run rpx -- ws create latihan --schema latihan_app
```

Hasil: `workspace latihan ready (role ws_latihan)`. Perintah ini membuat skema `latihan_app` dan role `ws_latihan`.
Kode aplikasi nanti berjalan sebagai role itu, sehingga hanya bisa menyentuh tabel di skema `latihan_app`.

### Langkah 3. Buat tabel

Buka psql:

| Cara instalasi | Perintah |
| --- | --- |
| Cmder + PostgreSQL portable | `"D:\Software\PGSQL\bin\psql.exe" -h localhost -U postgres -d rpx` |
| PowerShell + installer | `& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d rpx` |
| Linux / macOS | `psql rpx` |
| Docker | `docker compose exec db psql -U postgres -d rpx` |

Tempel SQL berikut, lalu tekan Enter:

```sql
create table latihan_app.barang (
  id      integer generated always as identity primary key,
  nama    varchar(100) not null,
  stok    integer not null default 0,
  harga   numeric(12,2),
  aktif   boolean not null default true
);
insert into latihan_app.barang (nama, stok, harga) values ('Kertas A4', 20, 55000), ('Tinta printer', 5, 120000);
```

Hasil: `CREATE TABLE` dan `INSERT 0 2`. Keluar dari psql dengan `\q`.

Dua hal penting:
- **Primary key memakai `generated always as identity`** (nomor otomatis). Tabel dengan primary key yang diisi manual
  hanya bisa dibuatkan report, belum form.
- Tabel dibuat oleh user yang sama dengan yang menjalankan `ws create` (`postgres`), sehingga role `ws_latihan` otomatis
  mendapat hak baca dan tulis. Kalau tabel dibuat oleh user lain, berikan hak sendiri:
  `grant select, insert, update, delete on latihan_app.barang to ws_latihan;`

### Langkah 4. Buat akun developer untuk workspace ini

Ganti `budi` dan kata sandinya dengan milik Anda (kata sandi minimal 10 karakter):

```bash
npm run rpx -- dev add --ws latihan --username budi --password "sandi-budi-123" --admin
```

Hasil: `developer budi ready in workspace latihan; sign in at /builder`. `--admin` membuat Anda administrator workspace,
sehingga bisa menambah developer lain dari builder.

### Langkah 5. Pastikan server berjalan dan masuk ke builder

1. Jalankan server bila belum (`start-lokal.cmd`, `npm start`, atau Docker sudah berjalan).
2. Buka http://localhost:8080/builder.
3. Isi **Workspace** `latihan`, **Nama pengguna** `budi`, **Kata sandi** dari langkah 4, klik **Masuk**.

Hasil: halaman **Beranda** workspace latihan, dengan 0 aplikasi.

### Langkah 6. Buat aplikasi dari tabel

1. Klik **Buat aplikasi**.
2. **Nama aplikasi**: `Stok Barang`. **Alias** terisi sendiri menjadi `stok-barang`.
3. **Skema parsing**: `latihan_app` (satu-satunya pilihan).
4. **Batasi ke grup**: biarkan kosong.
5. Di daftar tabel, centang **barang**. Kolom *Yang dibuat* harus berbunyi **Report + form**.
6. Klik **Buat aplikasi**.

Hasil: beranda aplikasi dengan pesan *Aplikasi Stok Barang dibuat: 2 halaman dari 1 tabel*. Halaman 1 adalah report
**Barang**, halaman 2 adalah **Form barang** (dialog). Ada juga peringatan bahwa workspace belum punya pengguna aplikasi:
itu dikerjakan di langkah berikutnya.

### Langkah 7. Buat akun pengguna aplikasi

Akun developer tidak bisa dipakai untuk login ke aplikasi. Buat akun pengguna:

1. Menu kiri **Pengguna aplikasi → Tambah pengguna**.
2. **Nama pengguna** `sri`, **Kata sandi** dan **Ulangi kata sandi** minimal 10 karakter. Email dan grup boleh kosong.
3. Klik **Tambah pengguna**.

Hasil: pesan *Pengguna sri ditambahkan*.

### Langkah 8. Jalankan aplikasinya

1. Menu kiri **Aplikasi** → klik **Stok Barang** → tombol **Jalankan** (kanan atas). Aplikasi terbuka di
   `http://localhost:8080/r/latihan/stok-barang`.
2. Login sebagai `sri`.
3. Report **Barang** menampilkan dua baris: Kertas A4 dan Tinta printer.
4. Klik **Tambah**. Form terbuka sebagai dialog dengan isian Nama, Stok, Harga, dan Aktif. Isi `Map plastik`, stok `50`,
   harga `3500`, lalu **Simpan**.

Hasil: dialog tertutup, report memuat tiga baris, dan pesan sukses tampil. Coba juga klik nomor di kolom pertama untuk
mengubah baris, **Cari**, dan **CSV**.

### Langkah 9. Ubah label di Page Designer

1. Kembali ke tab builder, buka beranda aplikasi **Stok Barang**.
2. Di region **Halaman**, klik **Form barang** (halaman 2). Page Designer terbuka: pohon komponen di kiri, properti di kanan.
3. Di pohon, klik **Item P2_HARGA**.
4. Ubah **Label** menjadi `Harga satuan (Rp)`, isi **Bantuan** dengan `Harga per satuan, tanpa titik ribuan.`
5. Klik **Simpan**. Hasil: pesan *Item P2_HARGA disimpan*.
6. Di tab aplikasi, buka lagi form barang: label dan teks bantuan baru sudah tampil.

### Langkah 10. Simpan spec aplikasi

Di beranda aplikasi, klik **Ekspor YAML**. File `stok-barang.yaml` terunduh: seluruh definisi aplikasi dalam satu file teks.
Simpan di repositori Git proyek Anda. File ini bisa diimpor ulang di server lain (bagian 9).

### Langkah 11. Selanjutnya

- Tambah halaman report dari query SQL atau halaman kosong: [bagian 6](#6-menambah-halaman).
- Batasi menu atau halaman untuk grup tertentu: buat aturan otorisasi di [Properti aplikasi](#8-properti-aplikasi), lalu
  beri grup ke pengguna di **Pengguna aplikasi**.
- Tabel lain: buat di psql seperti langkah 3, lalu di beranda aplikasi **Tambah halaman → Report + form**.

Menghapus hasil latihan: di beranda aplikasi paling bawah, hapus aplikasi dengan mengetik aliasnya. Tabel di
`latihan_app` tetap ada; hapus dengan `drop schema latihan_app cascade;` di psql bila tidak diperlukan lagi.

## 3. Masuk ke builder

1. Buka `http://<server>:8080/builder` (di laptop: http://localhost:8080/builder).
2. Isi **Workspace**, **Nama pengguna**, dan **Kata sandi** akun developer.

Aturan login:

- Salah kata sandi 5 kali → akun developer dikunci. Administrator membukanya di menu **Developer**, atau lewat CLI
  `rpx dev add` (bagian 11).
- Sesi builder berakhir setelah 1 jam tanpa aktivitas atau 8 jam sejak login. Mengetik dan mengeklik di halaman builder
  terhitung aktivitas, jadi sesi tidak habis selama Anda sedang mengisi form; tab yang hanya terbuka tetap berakhir.
  Setelah login lagi, Anda kembali ke halaman yang sedang dibuka, tetapi perubahan yang belum disimpan hilang.
- Lupa kata sandi developer: administrator workspace mengatur ulang di menu **Developer**, atau dari terminal
  `npm run rpx -- dev add --ws <workspace> --username <nama> --password "<sandi-baru>"` (sekaligus membuka kunci).
- Di server demo publik, builder hanya bisa dibuka dari hostname tertentu (pengaturan `RPX_BUILDER_HOSTS`). Di alamat lain
  `/builder` menjawab *Halaman tidak ditemukan*.
- **Keluar** di kanan atas mengakhiri sesi. Nama Anda di kanan atas membuka **Akun saya** (ganti kata sandi).

Menu kiri:

| Menu | Isi |
| --- | --- |
| **Beranda** | ringkasan workspace: jumlah aplikasi, halaman, skema, developer; aplikasi yang terakhir diubah |
| **Aplikasi** | daftar aplikasi dengan pencarian; buat, impor, jalankan, ekspor |
| **Pengguna aplikasi** | akun login aplikasi dan grupnya |
| **Developer** | akun developer (hanya terlihat oleh administrator) |

## 4. Mengelola akun

### Pengguna aplikasi

**Pengguna aplikasi → Tambah pengguna**: isi nama pengguna, email (opsional), kata sandi (minimal 10 karakter), dan grup.

- **Grup** menentukan akses. Daftar grup yang ditawarkan diambil dari aturan otorisasi aplikasi di workspace (jenis
  `group_member`), lengkap dengan nama aplikasi yang memakainya. Grup lain bisa diketik di **Grup lain**, dipisah koma.
- Perubahan grup langsung berlaku, pengguna tidak perlu login ulang.
- **Atur ulang kata sandi** mengeluarkan pengguna dari semua sesinya.
- **Kunci akun** menolak login dan mengakhiri sesi yang terbuka. **Buka kunci** juga mengosongkan hitungan salah sandi.
- **Hapus akun**: ketik nama penggunanya untuk konfirmasi. Data yang pernah dibuat pengguna di tabel aplikasi tidak tersentuh.
- Akun SSO muncul sendiri setelah login pertama. Grupnya ditimpa klaim dari IdP setiap login.

Peran yang disimpan di tabel aplikasi sendiri (mis. REQUESTER/MANAGER di aplikasi DEMO) tetap diatur dari halaman
administrasi aplikasi itu, bukan dari builder.

### Developer (khusus administrator)

**Developer → Tambah developer**: nama, email, kata sandi, dan centang **Administrator workspace** bila developer itu juga
boleh mengelola developer lain. Di halaman developer: jadikan administrator / developer biasa, atur ulang kata sandi,
kunci, hapus. Akun sendiri tidak bisa dikunci, diturunkan, atau dihapus dari sini.

### Akun saya

Ganti kata sandi sendiri: isi kata sandi sekarang, kata sandi baru, dan ulangi. Sesi builder Anda di perangkat lain berakhir.

## 5. Membuat aplikasi dari tabel

**Aplikasi → Buat aplikasi** (atau tombol yang sama di Beranda):

1. **Nama aplikasi**. Alias terisi otomatis dari nama (huruf kecil, angka, `-`, `_`); bisa diubah. Alias menjadi alamat
   `/r/<workspace>/<alias>` dan tidak bisa diganti setelah aplikasi dibuat.
2. **Skema parsing**. Mengganti skema memuat ulang daftar tabel.
3. **Batasi ke grup** (opsional): hanya anggota grup ini yang bisa membuka aplikasi.
4. **Halaman dari tabel**: centang tabel atau view (maksimal 10). Kolom **Yang dibuat** menjelaskan hasilnya:

| Label | Arti | Kapan |
| --- | --- | --- |
| **Report + form** | Interactive Report + form dialog untuk tambah, ubah, hapus | tabel punya primary key dengan nilai default (identity, serial, atau `default gen_random_uuid()`), dan role workspace punya hak INSERT, UPDATE, DELETE |
| **Report saja** | Interactive Report tanpa form | view; tabel tanpa primary key; primary key tanpa default (diisi manual); tanpa hak tulis; kolom wajib bertipe yang belum didukung |
| **Tidak bisa** | tidak bisa dipilih | role workspace tidak punya hak SELECT; nama tabel memakai huruf besar atau karakter khusus |

5. **Buat aplikasi**. Tanpa tabel yang dicentang, aplikasi berisi satu halaman beranda kosong.

Yang dibuat untuk tiap tabel: halaman report (nomor ganjil: 1, 3, 5, …), halaman form dialog (nomor genap berikutnya),
dan satu entri menu. Isian form mengikuti tipe kolom:

| Tipe kolom | Isian |
| --- | --- |
| `int`, `numeric`, `float` | angka |
| `date` | tanggal |
| `timestamp`, `timestamptz` | tanggal dan jam |
| `boolean` | switch |
| `varchar` lebih dari 250 karakter | teks panjang (textarea) |
| enum | daftar pilihan dari nilai enum |
| foreign key | daftar pilihan dari tabel rujukan; di report tampil namanya, bukan nomornya |
| `bytea`, `json`, array | tidak dipakai di form |
| kolom generated | tampil di report, tidak diedit |

Kolom `NOT NULL` tanpa default menjadi wajib diisi. Setelah dibuat, beranda aplikasi memberi tahu bila workspace belum
punya pengguna aplikasi.

## 6. Menambah halaman

Di beranda aplikasi, region **Halaman → Tambah halaman**. Pilih jenisnya:

| Jenis | Hasil | Isian yang dipakai |
| --- | --- | --- |
| **Report + form** | Interactive Report + form dialog; memakai nomor N dan N+1 | tabel |
| **Report** | Interactive Report hanya baca | tabel, atau **query SQL** |
| **Form** | form satu baris tabel, sebagai dialog atau halaman biasa | tabel, **Buka sebagai dialog**, **Setelah simpan atau batal, kembali ke** |
| **Halaman kosong** | satu region teks | nama halaman |

Isian umum: **Nama halaman** (kosong = nama tabel), **Nomor halaman** (terisi nomor bebas berikutnya), **Tambahkan ke menu navigasi**.

**Report dari query SQL**:

- Harus diawali `SELECT` atau `WITH`, satu perintah saja. Titik koma di akhir boleh.
- Item boleh dipakai sebagai bind, mis. `where :P20_CARI is null or nama ilike '%' || :P20_CARI || '%'`. Nilainya selalu teks; cast
  bila perlu (`:P20_ID::int`).
- Setiap kolom harus punya nama sederhana yang unik. Beri alias untuk ekspresi: `count(*) as jumlah`, bukan `count(*)` saja
  bila ada lebih dari satu.
- Saat **Tambah halaman**, query dicoba dulu sebagai role workspace tanpa mengambil data, lalu dibatalkan. Kesalahan
  (kolom tidak ada, tanpa hak akses) ditampilkan dengan pesan PostgreSQL dan halaman tidak dibuat.

## 7. Mengubah halaman di Page Designer

Buka dari beranda aplikasi: klik **nama halaman** di region Halaman. Tombol **Jalankan** di baris yang sama membuka
halaman itu di aplikasi.

**Kiri: struktur halaman.** Pohon berisi halaman → region (dengan item, tombol, kolom) → validasi, proses, branch, computation.
Klik komponen untuk mengeditnya. Tombol **Tambah region**, **Item**, **Tombol**, **Tambah validasi**, **Tambah proses**,
**Tambah branch**, **Tambah computation** membuat komponen baru dengan nilai awal, lalu langsung membukanya. Pilihan
**Halaman** di atas pohon berpindah ke halaman lain.

**Kanan: editor properti.** Semua atribut komponen bisa diubah. Nama kunci spec tampil kecil di samping label
(mis. `col_span`) agar mudah dicocokkan dengan file YAML.

| Kontrol | Untuk |
| --- | --- |
| pilihan dengan **(bawaan)** | nilai tetap; **(bawaan)** berarti memakai default engine |
| ya / tidak / (bawaan) | atribut boolean |
| isian angka | nomor halaman tujuan, lebar kolom (1–12), panjang maksimal |
| kotak teks panjang | SQL, HTML, kode PL/pgSQL, ekspresi validasi |
| kotak **YAML** | struktur bersarang; kosongkan untuk menghapus |

Contoh isi kotak YAML:

```yaml
# Kondisi: tampil hanya saat mengubah data
item_not_null: P2_ID
```

```yaml
# Kondisi: hanya untuk tombol tertentu
request_in: [SIMPAN, HAPUS]
```

```yaml
# Link kolom report / tujuan tombol
page: 2
items: { P2_ID: "#ID#" }
clear_cache: "2"
```

```yaml
# Daftar pilihan (LOV) langsung di item; atau tulis nama LOV bersama, mis. DEPARTEMEN
sql: select nama as d, deptno as r from departemen order by 1
```

Tombol di atas editor:

- **Naik / Turun** mengubah urutan (urutan region di halaman, urutan proses dan validasi saat dijalankan).
- **Hapus …** menghapus komponen. Komponen yang masih dirujuk tempat lain (mis. item yang dipakai link report) tidak
  dihapus; pesannya menyebut letak rujukannya.
- **Hapus halaman** (saat halaman dipilih): ketik nomor halaman. Halaman beranda tidak bisa dihapus; halaman yang masih
  dirujuk link, branch, atau menu juga ditolak dengan daftar rujukannya.

Setiap **Simpan** diperiksa seperti impor dan masuk riwayat versi. Bila aplikasi yang sama diubah setelah Anda membuka
halaman ini (oleh developer lain, atau oleh Anda sendiri di tab lain), simpan Anda ditolak dengan pesan *Aplikasi sudah diubah
di tab lain atau oleh developer lain*. Isian Anda tetap di formulir. Pilih salah satu:

- **Simpan** lagi: isian Anda menimpa versi terbaru (perubahan orang lain pada komponen ini hilang);
- muat ulang halaman untuk melihat versi terbaru dulu, lalu ulangi perubahan Anda.

Hal yang sama berlaku untuk **Properti aplikasi** dan wizard **Tambah halaman**.

### Dynamic actions (aksi di browser)

Dynamic action menjalankan aksi **di browser, tanpa mengirim halaman**: menyembunyikan field saat pilihan tertentu
dipilih, mengisi field dari field lain, mengosongkan isian, memuat ulang satu region, atau menanyakan konfirmasi sebelum
mengirim. Ini padanan *Dynamic Actions* di APEX, versi pertama (lihat "Yang belum ada" di bawah).

**Langkah 1. Buka tempat menulisnya.** Di Page Designer klik **Halaman** (node paling atas pohon). Di editor kanan ada
kotak **Dynamic actions** (YAML). Kotak ini berisi daftar; satu dynamic action = satu entri `- name: ...`.
Di file spec, tulis di bawah halaman dengan kunci `dynamic_actions:` (sejajar dengan `regions:` dan `processes:`).

**Langkah 2. Tulis dynamic action-nya.** Contoh dari aplikasi contoh emp (halaman 2): karyawan magang tidak diisi keahliannya.

```yaml
- name: magang_tanpa_keahlian         # nama unik di halaman ini
  event: change                       # kapan berjalan
  items: [P2_STATUS_KERJA]            # item yang diawasi
  when: { item_equals: { item: P2_STATUS_KERJA, value: MAGANG } }   # kondisi (boleh tidak ada)
  actions:                            # dijalankan bila kondisi benar
    - { action: hide, items: [P2_KEAHLIAN] }
  else:                               # dijalankan bila kondisi salah
    - { action: show, items: [P2_KEAHLIAN] }
```

**Langkah 3. Simpan, lalu jalankan halamannya.** Pilih *Magang*: grup Keahlian hilang. Pilih *Tetap*: muncul lagi. Saat
halaman dibuka untuk karyawan yang sudah magang, grup itu langsung tersembunyi (lihat `on_load` di bawah).

Bila ada yang salah (nama item salah ketik, aksi tanpa target), simpan ditolak dengan pesan yang menyebut dynamic action
dan aksinya, sama seperti impor spec.

**Event** (`event:`)

| event | berjalan saat | wajib diisi |
| --- | --- | --- |
| `change` | nilai salah satu item berubah | `items: [...]` |
| `key_release` | tombol keyboard dilepas di item teks (setiap ketikan) | `items: [...]` |
| `click` | tombol diklik | `button: NAMA`; tombolnya harus ber-`action: defined_by_da` |
| `page_load` | halaman selesai dibuka | — |

**Kondisi** (`when:`, opsional, dicek di browser terhadap nilai item saat itu)

| kondisi | contoh |
| --- | --- |
| `item_equals` / `item_not_equals` | `{ item_equals: { item: P2_STATUS, value: "Y" } }` |
| `item_in` / `item_not_in` | `{ item_in: { item: P2_STATUS, values: [A, B] } }` |
| `item_null` / `item_not_null` | `{ item_null: P2_CATATAN }` |

Nilai dibandingkan sebagai teks, sama seperti yang dikirim ke server: switch/checkbox bernilai `on_value`/`off_value`
(bawaan `Y`/`N`), checkbox group digabung dengan `:` (mis. `SQL:K3`), item kosong = `""`.

**Aksi** (`actions:` dan `else:`, dijalankan berurutan)

| aksi | target | isian lain | keterangan |
| --- | --- | --- | --- |
| `show` / `hide` | `items`, `regions`, `buttons` | | region ditulis dengan `static_id`-nya |
| `enable` / `disable` | `items`, `buttons` | | field yang di-disable tetap ikut terkirim saat submit |
| `set_value` | `items` | `value: teks` **atau** `from_item: P1_X` | memicu `change` pada item tujuan |
| `clear` | `items` | | mengosongkan; checkbox jadi tidak dicentang |
| `refresh` | `regions` | | memuat ulang region dari server tanpa mengganggu isian lain |
| `confirm` | — | `message: teks` | **Batal** menghentikan aksi-aksi berikutnya |
| `submit_page` | — | `request: NAMA` | mengirim halaman; proses dan branch melihat `NAMA` sebagai REQUEST |

`on_load: true/false` pada aksi menentukan apakah aksi itu juga dijalankan saat halaman dibuka. Bawaannya `true` untuk
`show`, `hide`, `enable`, `disable` (agar halaman langsung tampil dalam keadaan yang benar) dan `false` untuk `set_value`
dan `clear`. `refresh`, `confirm`, dan `submit_page` tidak pernah berjalan saat halaman dibuka.

**Tombol yang dikendalikan dynamic action.** Tombol biasa langsung mengirim halaman. Bila tombol harus bertanya dulu atau
hanya mengubah isian di browser, beri `action: defined_by_da` lalu buat dynamic action `event: click` untuknya.
Contoh dari halaman 4 (Mutasi):

```yaml
regions:
  - static_id: mutasi
    # ...
    buttons:
      - { name: KOSONGKAN, label: Kosongkan isian, style: ghost, action: defined_by_da }
dynamic_actions:
  - name: kosongkan_isian
    event: click
    button: KOSONGKAN
    actions:
      - { action: confirm, message: Kosongkan semua isian tujuan mutasi? }
      - { action: clear, items: [P4_DEPT_TUJUAN, P4_JABATAN_BARU, P4_BERLAKU, P4_KEAHLIAN, P4_SETUJU] }
      - { action: set_value, items: [P4_STATUS], value: TETAP }
```

Bila dynamic action klik berakhir dengan `submit_page` tanpa `request`, REQUEST-nya nama tombol itu, jadi proses cukup
memakai `when_button: NAMA_TOMBOL` seperti tombol biasa. `request` lain boleh dipakai (mis. `CATAT`); di proses gunakan
`condition: { request_equals: CATAT }`. Nama tombol lain di halaman tidak boleh dipakai sebagai `request`.

**Penting soal keamanan.** Menyembunyikan atau men-disable field di browser hanya kenyamanan bagi pengguna; orang yang
paham bisa mengubahnya. Yang melindungi data tetap aturan di server: `read_only`, `condition`, `authorization`, dan
validasi. Tombol yang tidak tampil karena kondisi/otorisasinya, dynamic action kliknya juga tidak dikirim ke browser,
dan REQUEST-nya ditolak server.

**Yang belum ada** (direncanakan di sesi berikut): `execute_server_code` (menjalankan PL/pgSQL dari dynamic action dengan
*items to submit/return*), `refresh` region dengan nilai item terbaru (*items to submit*), editor dynamic action berbentuk
formulir di Page Designer. *Execute JavaScript* sengaja tidak didukung (halaman memakai Content Security Policy yang
melarang skrip inline). Event *after close dialog* tidak perlu ditulis: halaman pemanggil otomatis di-refresh setelah
dialognya ditutup.

## 8. Properti aplikasi

Beranda aplikasi → **Properti aplikasi**. Berisi atribut tingkat aplikasi: nama, versi, skema parsing, halaman beranda,
zona waktu, substitution strings, autentikasi, otorisasi aplikasi, menu navigasi, daftar pilihan bersama (LOV), aturan
otorisasi, application items, dan computations aplikasi. Alias tidak bisa diubah di sini.

Contoh:

```yaml
# Substitution strings: dipakai di teks sebagai &COMPANY.
COMPANY: KCSI
KOTA: Kudus
```

```yaml
# Aturan otorisasi (Otorisasi): dipasang di halaman/region/item/tombol/menu dengan nama
- name: pengelola_sdm
  type: group_member
  source: SDM
  error_msg: Halaman ini hanya untuk tim SDM.
```

```yaml
# Menu navigasi
- { label: Karyawan, icon: users, page: 1 }
- { label: Mutasi, icon: pencil, page: 4, authorization: pengelola_sdm }
```

## 9. Ekspor, impor, dan riwayat versi

- **Ekspor YAML** (beranda aplikasi, atau tombol Ekspor di daftar aplikasi) mengunduh spec aplikasi saat ini. File ini
  cocok disimpan di Git.
- **Aplikasi → Impor**: pilih file YAML atau tempel isinya. Bila alias sudah ada, centang **Ganti aplikasi bila alias sudah
  ada**. Workspace tujuan selalu workspace Anda. Data di tabel dan sesi pengguna tidak tersentuh.
- **Riwayat impor** di beranda aplikasi mencatat setiap perubahan: dari impor, wizard, maupun Page Designer, beserta siapa
  yang mengubah (`dev:<nama>`). **Unduh** memberi teks persis versi itu.
- **Mengembalikan perubahan**: unduh versi lama dari riwayat, lalu impor dengan opsi Ganti.
- **Memindahkan aplikasi** (DEV → UAT → PROD): ekspor di server asal, impor di server tujuan, atau lewat CLI
  `rpx app export` / `rpx app import`.
- **Hapus aplikasi** (beranda aplikasi, paling bawah): ketik alias. Tabel dan data di skema tidak disentuh.

## 10. Menjalankan aplikasi (pengguna)

Alamat aplikasi: `/r/<workspace>/<alias>`, mis. http://localhost:8080/r/pandawa/demo. Pengguna login dengan akun
pengguna aplikasi (atau tombol SSO bila aplikasi memakai SSO).

**Interactive Report**

- **Cari** mencari di semua kolom.
- Klik judul kolom untuk mengurutkan; klik lagi untuk membalik.
- **Filter** menambah syarat per kolom (angka, tanggal, teks); syarat tampil sebagai chip yang bisa dihapus satu per satu.
- **Atur ulang** mengembalikan tampilan awal. Pencarian, urutan, dan filter diingat selama sesi.
- **CSV** dan **Excel** mengunduh data sesuai filter dan urutan di layar.

**Form**

- Link di kolom report atau tombol **Tambah** membuka form, biasanya sebagai dialog. **Esc** atau **Batal** menutup tanpa menyimpan.
- Field wajib bertanda `*`. Kesalahan tampil di bawah field dan diringkas di atas form.
- Bila data diubah orang lain sejak form dibuka, simpan ditolak agar perubahan orang lain tidak tertimpa. Buka ulang lalu ulangi.
- Daftar pilihan panjang memakai dialog pencarian (popup LOV): ketik untuk menyaring, panah atas/bawah, Enter untuk memilih.

**Sesi**: berakhir setelah lama tanpa aktivitas (bawaan 1 jam). Mengetik atau mengeklik di halaman terhitung aktivitas,
jadi sesi tidak habis di tengah mengisi form panjang. Setelah sesi berakhir, pengguna diminta login lagi lalu kembali ke
halaman semula.

## 11. Perintah CLI

Dijalankan dari folder repo dengan `npm run rpx -- <perintah>` (Docker: `docker compose run --rm rpx <perintah>`).
Butuh `DATABASE_URL` (user PostgreSQL superuser/owner). Backup dan restore dijelaskan langkah demi langkah di
[operasional.md](operasional.md).

| Perintah | Fungsi |
| --- | --- |
| `db migrate` | pasang migrasi database terbaru |
| `ws create <nama> --schema <skema>` | buat workspace dan role `ws_<nama>` dengan akses ke skema |
| `app import <file.yaml> --ws <ws>` | impor atau ganti aplikasi dari spec |
| `app export <alias> --ws <ws> [--out file]` | ekspor spec aplikasi |
| `app check <file.yaml>` | periksa spec tanpa database |
| `user add --ws <ws> --username <u> --password <p> [--group G]` | tambah atau perbarui pengguna aplikasi |
| `dev add --ws <ws> --username <u> --password <p> [--admin]` | tambah developer; dijalankan ulang = atur ulang kata sandi dan buka kunci |
| `backup [--dir folder] [--keep n]` | backup database dan role ke folder (bawaan `backups`); `--keep` menyimpan n backup terakhir |
| `restore <file.dump> --to <database>` | pulihkan backup ke database baru atau kosong; tidak pernah menimpa database yang berisi |
| `session purge` | hapus session kedaluwarsa (server melakukannya otomatis tiap 15 menit) |
| `demo setup` / `pilot setup` | pasang ulang aplikasi contoh emp (workspace `demo`) / DEMO (workspace `pandawa`) beserta developer `admin` |

## 12. Catatan untuk developer APEX

- **Bind selalu teks** (seperti VARCHAR2). Cast sendiri: `where empno = :P2_EMPNO::int`.
- **String kosong = NULL**, sehingga `:P1_CARI is null` berperilaku seperti di APEX.
- **Form wajib punya primary key**; PostgreSQL tidak punya ROWID.
- **Kode PL/pgSQL**: baca item dengan `:P1_X`, tulis dengan `perform rpx_rt.set_item('P1_X', nilai)`.
- **Substitusi** `&ITEM.` selalu di-escape; `&ITEM!RAW.` hanya untuk HTML yang dipercaya.
- **Pola porting** Oracle → PostgreSQL (package, variabel package, `APP_USER`, trigger audit, `merge`, `raise_application_error`)
  ada di [examples/demo-permintaan/PORTING.md](../examples/demo-permintaan/PORTING.md).
- Aturan spec lengkap: [README](../README.md#aturan-spec-yang-perlu-diketahui-developer-apex).

## 13. Pertanyaan umum

**Saya sudah login ke builder tapi tidak bisa login ke aplikasi.** Akun developer dan pengguna aplikasi terpisah. Buat akun
di **Pengguna aplikasi**.

**Tabel saya hanya mendapat "Report saja".** Lihat alasannya di kolom **Yang dibuat**. Paling sering: primary key diisi manual
(tanpa identity/serial/default). Form untuk primary key manual belum didukung.

**Tabel tidak muncul di wizard.** Pastikan tabel ada di skema yang dipilih dan role workspace (`ws_<workspace>`) punya hak
SELECT: `grant select on <skema>.<tabel> to ws_<workspace>;`. Tabel yang dibuat setelah `ws create` mendapat hak otomatis
lewat default privileges bila dibuat oleh user yang sama.

**Perubahan saya hilang setelah `demo setup` / `pilot setup`.** Kedua perintah memasang ulang aplikasi contoh emp dan DEMO.
Ekspor dulu bila perubahannya ingin disimpan. Aplikasi buatan sendiri tidak tersentuh.

**Bisakah dua developer mengubah aplikasi yang sama?** Bisa, bergantian. Bila bertabrakan, simpan yang kedua ditolak tanpa
menimpa yang pertama. Belum ada kunci halaman eksplisit.

**Builder menjawab *Halaman tidak ditemukan*.** Server dijalankan dengan `RPX_BUILDER_HOSTS` (mode demo publik). Buka
builder lewat hostname yang terdaftar, atau, di laptop sendiri, jalankan server di jendela terminal baru tanpa variabel itu.

**Saya mengubah aplikasi contoh lalu perubahannya hilang setelah memperbarui pakai Docker.** Docker menjalankan
`demo setup` dan `pilot setup` setiap kali image dibangun ulang. Ekspor aplikasi contoh sebelum memperbarui, atau buat
aplikasi sendiri.

**Interactive Grid, drag-drop tata letak?** Belum ada. Lihat bagian "Belum ada" di
[checkpoint-fase2.md](checkpoint-fase2.md#yang-belum-ada).
