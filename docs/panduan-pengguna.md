# Panduan penggunaan pandawapex

Panduan ini untuk developer Tim PANDAWA yang membuat dan mengubah aplikasi di **builder** pandawapex, dan untuk
pengguna yang menjalankan aplikasinya. Instalasi di laptop Windows ada di [checkpoint-fase2.md](checkpoint-fase2.md).

Isi:

1. [Konsep dasar](#1-konsep-dasar)
2. [Masuk ke builder](#2-masuk-ke-builder)
3. [Mengelola akun](#3-mengelola-akun)
4. [Membuat aplikasi dari tabel](#4-membuat-aplikasi-dari-tabel)
5. [Menambah halaman](#5-menambah-halaman)
6. [Mengubah halaman di Page Designer](#6-mengubah-halaman-di-page-designer)
7. [Properti aplikasi](#7-properti-aplikasi)
8. [Ekspor, impor, dan riwayat versi](#8-ekspor-impor-dan-riwayat-versi)
9. [Menjalankan aplikasi (pengguna)](#9-menjalankan-aplikasi-pengguna)
10. [Perintah CLI](#10-perintah-cli)
11. [Catatan untuk developer APEX](#11-catatan-untuk-developer-apex)
12. [Pertanyaan umum](#12-pertanyaan-umum)

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
pengguna aplikasi untuk dirinya (bagian 3).

## 2. Masuk ke builder

1. Buka `http://<server>:8080/builder` (di laptop: http://localhost:8080/builder).
2. Isi **Workspace**, **Nama pengguna**, dan **Kata sandi** akun developer.

Aturan login:

- Salah kata sandi 5 kali → akun developer dikunci. Administrator membukanya di menu **Developer**, atau lewat CLI
  `rpx dev add` (bagian 10).
- Sesi builder berakhir setelah 1 jam tidak dipakai atau 8 jam sejak login.
- **Keluar** di kanan atas mengakhiri sesi. Nama Anda di kanan atas membuka **Akun saya** (ganti kata sandi).

Menu kiri:

| Menu | Isi |
| --- | --- |
| **Beranda** | ringkasan workspace: jumlah aplikasi, halaman, skema, developer; aplikasi yang terakhir diubah |
| **Aplikasi** | daftar aplikasi dengan pencarian; buat, impor, jalankan, ekspor |
| **Pengguna aplikasi** | akun login aplikasi dan grupnya |
| **Developer** | akun developer (hanya terlihat oleh administrator) |

## 3. Mengelola akun

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

## 4. Membuat aplikasi dari tabel

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

## 5. Menambah halaman

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

## 6. Mengubah halaman di Page Designer

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

Setiap **Simpan** diperiksa seperti impor dan masuk riwayat versi. Bila developer lain menyimpan perubahan pada
aplikasi yang sama setelah Anda membuka halaman ini, simpan Anda ditolak dengan pesan *Aplikasi sudah diubah developer lain*;
isian tetap di layar. Muat ulang, lalu ulangi perubahannya.

## 7. Properti aplikasi

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

## 8. Ekspor, impor, dan riwayat versi

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

## 9. Menjalankan aplikasi (pengguna)

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

**Sesi**: berakhir setelah lama tidak dipakai; pengguna diminta login lagi lalu kembali ke halaman semula.

## 10. Perintah CLI

Dijalankan dari folder repo dengan `npm run rpx -- <perintah>`. Butuh `DATABASE_URL` (user PostgreSQL superuser/owner).

| Perintah | Fungsi |
| --- | --- |
| `db migrate` | pasang migrasi database terbaru |
| `ws create <nama> --schema <skema>` | buat workspace dan role `ws_<nama>` dengan akses ke skema |
| `app import <file.yaml> --ws <ws>` | impor atau ganti aplikasi dari spec |
| `app export <alias> --ws <ws> [--out file]` | ekspor spec aplikasi |
| `app check <file.yaml>` | periksa spec tanpa database |
| `user add --ws <ws> --username <u> --password <p> [--group G]` | tambah atau perbarui pengguna aplikasi |
| `dev add --ws <ws> --username <u> --password <p> [--admin]` | tambah developer; dijalankan ulang = atur ulang kata sandi dan buka kunci |
| `demo setup` / `pilot setup` | pasang ulang aplikasi contoh emp (workspace `demo`) / DEMO (workspace `pandawa`) beserta developer `admin` |

## 11. Catatan untuk developer APEX

- **Bind selalu teks** (seperti VARCHAR2). Cast sendiri: `where empno = :P2_EMPNO::int`.
- **String kosong = NULL**, sehingga `:P1_CARI is null` berperilaku seperti di APEX.
- **Form wajib punya primary key**; PostgreSQL tidak punya ROWID.
- **Kode PL/pgSQL**: baca item dengan `:P1_X`, tulis dengan `perform rpx_rt.set_item('P1_X', nilai)`.
- **Substitusi** `&ITEM.` selalu di-escape; `&ITEM!RAW.` hanya untuk HTML yang dipercaya.
- **Pola porting** Oracle → PostgreSQL (package, variabel package, `APP_USER`, trigger audit, `merge`, `raise_application_error`)
  ada di [examples/demo-permintaan/PORTING.md](../examples/demo-permintaan/PORTING.md).
- Aturan spec lengkap: [README](../README.md#aturan-spec-yang-perlu-diketahui-developer-apex).

## 12. Pertanyaan umum

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

**Interactive Grid, Dynamic Actions, drag-drop tata letak?** Belum ada. Lihat bagian "Belum ada" di
[checkpoint-fase2.md](checkpoint-fase2.md#yang-belum-ada).
