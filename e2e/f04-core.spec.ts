// F04: end user logs in, finds an employee in the interactive report, edits in the modal dialog, saves.
import { test, expect, login, axe, APP, empno, openEmployee, dialogFrame, searchReport } from './fixtures.ts';
import { E2E } from './env.ts';

/** per-project suffix: the desktop and mobile runs share one database */
const tag = () => test.info().project.name;

test.describe('F04 login -> report -> dialog form -> save', () => {
   test('F04-H1 edit and save an employee in the dialog', async ({ page, db }) => {
      await login(page);
      await expect(page).toHaveURL(`${APP}/1`);
      await expect(page.getByRole('table', { name: 'Daftar karyawan' })).toBeVisible();
      expect(await axe(page), 'report a11y').toEqual([]);

      const form = await openEmployee(page, 'Dewi Lestari');
      expect(await axe(page), 'dialog a11y').toEqual([]);
      await form.getByLabel('Jabatan').fill(`Analis QC Senior ${tag()}`);
      await form.getByRole('button', { name: 'Simpan' }).click();

      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page).toHaveURL(`${APP}/1`);
      await expect(page.getByRole('status').filter({ hasText: 'tersimpan' })).toContainText('Data karyawan Dewi Lestari tersimpan.');
      const r = await db.query(`select jabatan from ${E2E.schema}.karyawan where nama = 'Dewi Lestari'`);
      expect(r.rows[0].jabatan).toBe(`Analis QC Senior ${tag()}`);
      // the report region was refreshed in place and still shows the search
      await expect(page.getByLabel('Cari di Daftar karyawan')).toHaveValue('Dewi Lestari');
   });

   test('F04-H2 add a new employee', async ({ page, db }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      const form = await dialogFrame(page);
      await expect(form.getByRole('button', { name: 'Hapus' })).toHaveCount(0);
      await form.getByLabel('Nama lengkap').fill(`Siti Rahmawati ${tag()}`);
      await form.getByLabel('Departemen').selectOption({ label: 'Keuangan' });
      await form.getByLabel('Tanggal masuk').fill('2026-10-01');
      await form.getByLabel('Gaji per bulan (Rp)').fill('7100000');
      await form.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'tersimpan' })).toContainText(`Siti Rahmawati ${tag()} tersimpan`);
      expect(await empno(db, `Siti Rahmawati ${tag()}`)).toBeGreaterThan(0);
   });

   test('F04-H3 delete asks for confirmation; cancel keeps the row, accept deletes it', async ({ page, db }) => {
      await db.query(`insert into ${E2E.schema}.karyawan (nama, gaji) values ($1, 1000)`, [`Untuk Dihapus ${tag()}`]);
      await login(page);
      const form = await openEmployee(page, `Untuk Dihapus ${tag()}`);
      page.once('dialog', d => d.dismiss());
      await form.getByRole('button', { name: 'Hapus' }).click();
      await expect(form.getByLabel('Nama lengkap')).toBeVisible();
      expect(await empno(db, `Untuk Dihapus ${tag()}`)).toBeGreaterThan(0);
      page.once('dialog', d => { expect(d.message()).toBe('Hapus data karyawan ini?'); return d.accept(); });
      await form.getByRole('button', { name: 'Hapus' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect.poll(() => empno(db, `Untuk Dihapus ${tag()}`)).toBeUndefined();
   });

   test('F04-E1 empty required fields: inline errors inside the dialog, summary focused, a11y clean', async ({ page }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      const form = await dialogFrame(page);
      await form.getByRole('button', { name: 'Simpan' }).click();
      const summary = form.getByRole('alert');
      await expect(summary).toContainText('3 kesalahan perlu diperbaiki');
      await expect(summary).toBeFocused();
      await expect(form.getByLabel('Nama lengkap')).toHaveAttribute('aria-invalid', 'true');
      await expect(summary.getByRole('link', { name: 'Gaji per bulan (Rp) wajib diisi.' })).toHaveAttribute('href', '#P2_GAJI');
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await axe(page), 'dialog-with-errors a11y').toEqual([]);
   });

   test('F04-E2 accents, emoji and a 120-character name round-trip unchanged', async ({ page, db }) => {
      // 120 UTF-16 units: the browser's maxlength counts those, the server counts characters (119 here)
      const head = `Ñoño Dédé Śrī 😀 ${tag()} `;
      const name = head + 'x'.repeat(120 - head.length);
      expect(name.length).toBe(120);
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      const form = await dialogFrame(page);
      await form.getByLabel('Nama lengkap').fill(name);
      await form.getByLabel('Tanggal masuk').fill('2026-01-02');
      await form.getByLabel('Gaji per bulan (Rp)').fill('5000000');
      await form.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'tersimpan' })).toContainText('Ñoño Dédé Śrī 😀');
      expect(await empno(db, name)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
   });

   test('F04-E3 a name longer than the item maximum is refused by the server, not just the browser', async ({ page, db }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      const form = await dialogFrame(page);
      await form.getByLabel('Nama lengkap').evaluate((el: HTMLInputElement) => { el.removeAttribute('maxlength'); el.value = 'P'.repeat(500); });
      await form.getByLabel('Tanggal masuk').fill('2026-01-02');
      await form.getByLabel('Gaji per bulan (Rp)').fill('5000000');
      await form.getByRole('button', { name: 'Simpan' }).click();
      await expect(form.getByRole('alert')).toContainText('Nama lengkap maksimal 120 karakter.');
      expect(await empno(db, 'P'.repeat(500))).toBeUndefined();
   });

   test('F04-E4 double click on Simpan saves once', async ({ page, db }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      const form = await dialogFrame(page);
      await form.getByLabel('Nama lengkap').fill(`Klik Dua Kali ${tag()}`);
      await form.getByLabel('Tanggal masuk').fill('2026-03-03');
      await form.getByLabel('Gaji per bulan (Rp)').fill('4000000');
      await form.getByRole('button', { name: 'Simpan' }).dblclick();
      await expect(page.getByRole('dialog')).toBeHidden();
      const n = await db.query(`select count(*)::int as n from ${E2E.schema}.karyawan where nama = $1`, [`Klik Dua Kali ${tag()}`]);
      expect(n.rows[0].n).toBe(1);
   });

   test('F04-E5 two tabs edit the same employee: the second save is stopped (lost update)', async ({ page, context, db }) => {
      await login(page);
      const form1 = await openEmployee(page, 'Bambang Sutrisno');
      const tab2 = await context.newPage();
      const form2 = await openEmployee(tab2, 'Bambang Sutrisno');
      await form1.getByLabel('Jabatan').fill(`Supervisor Lini 3 ${tag()}`);
      await form1.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'tersimpan' })).toBeVisible();
      await form2.getByLabel('Gaji per bulan (Rp)').fill('99999999');
      await form2.getByRole('button', { name: 'Simpan' }).click();
      await expect(form2.getByRole('alert')).toContainText('Data diubah pengguna lain');
      const r = await db.query(`select jabatan, gaji from ${E2E.schema}.karyawan where nama = 'Bambang Sutrisno'`);
      expect(r.rows[0].jabatan).toBe(`Supervisor Lini 3 ${tag()}`);
      expect(r.rows[0].gaji).not.toBe('99999999.00');
   });

   test('F04-E6 Escape or Batal closes the dialog without saving; focus returns to the row link', async ({ page, db }) => {
      await login(page);
      const before = (await db.query(`select jabatan from ${E2E.schema}.karyawan where nama = 'Rina Kartikasari'`)).rows[0].jabatan;
      const form = await openEmployee(page, 'Rina Kartikasari');
      await form.getByLabel('Jabatan').fill('Tidak disimpan');
      await form.getByLabel('Jabatan').press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByRole('row').filter({ hasText: 'Rina Kartikasari' }).getByRole('link')).toBeFocused();
      const again = await openEmployee(page, 'Rina Kartikasari');
      await again.getByRole('button', { name: 'Batal' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      expect((await db.query(`select jabatan from ${E2E.schema}.karyawan where nama = 'Rina Kartikasari'`)).rows[0].jabatan).toBe(before);
   });

   test('F04-E7 session expires while the dialog is open: the whole window goes to login, then back to the list', async ({ page, db }) => {
      await login(page);
      const form = await openEmployee(page, 'Maria Ulfa');
      await db.query(`delete from rpx.sessions where username = $1`, [E2E.user]);
      await form.getByLabel('Jabatan').fill('Tidak tersimpan');
      await form.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('status')).toContainText('Sesi Anda berakhir');
      await page.getByLabel('Nama pengguna').fill(E2E.user);
      await page.getByLabel('Kata sandi').fill(E2E.password);
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();
      await expect(page).toHaveURL(`${APP}/1`);
   });

   test('F04-E8 keyboard only: login, open a row, save in the dialog', async ({ page }) => {
      await page.goto(`${APP}/1`);
      await page.keyboard.type(E2E.user);
      await page.keyboard.press('Tab');
      await page.keyboard.type(E2E.password);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${APP}/1`);
      for (let i = 0; i < 40; i++) {
         await page.keyboard.press('Tab');
         if (await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('tbody') !== null)) break;
      }
      await page.keyboard.press('Enter');
      await dialogFrame(page);
      const frame = () => page.frames().find(f => f.url().includes('dialog=1'))!;
      let onSave = false;
      for (let i = 0; i < 40 && !onSave; i++) {
         await page.keyboard.press('Tab');
         onSave = await frame().evaluate(() => document.activeElement?.getAttribute('value') === 'SIMPAN');
      }
      expect(onSave, 'Simpan reachable with Tab').toBe(true);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByRole('status').filter({ hasText: 'tersimpan' })).toBeVisible();
   });

   test('F04-E9 the row was deleted by someone else while the dialog was open', async ({ page, db }) => {
      await db.query(`insert into ${E2E.schema}.karyawan (nama, gaji) values ($1, 1000)`, [`Akan Hilang ${tag()}`]);
      await login(page);
      const form = await openEmployee(page, `Akan Hilang ${tag()}`);
      await db.query(`delete from ${E2E.schema}.karyawan where nama = $1`, [`Akan Hilang ${tag()}`]);
      await form.getByRole('button', { name: 'Simpan' }).click();
      await expect(form.getByRole('alert')).toContainText('Data sudah tidak ada');
   });

   test('F04-N1 wrong password, then unknown user: same generic message, a11y clean', async ({ page }) => {
      await login(page, E2E.user, 'salah-kata-sandi');
      await expect(page.getByRole('alert')).toContainText('Nama pengguna atau kata sandi salah.');
      expect(await axe(page), 'login a11y').toEqual([]);
      await login(page, 'tidak-ada', 'apa-saja-12345');
      await expect(page.getByRole('alert')).toContainText('Nama pengguna atau kata sandi salah.');
   });

   test('F04-N3 a user without the SDM group sees the list read-only and cannot open the form', async ({ page }) => {
      await login(page, E2E.user2, E2E.password);
      await expect(page.getByRole('table', { name: 'Daftar karyawan' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Tambah karyawan' })).toHaveCount(0);
      await expect(page.locator('a.r-cell-link')).toHaveCount(0);
      const res = await page.goto(`${APP}/2`);
      expect(res!.status()).toBe(403);
      await expect(page.getByText('Halaman ini hanya untuk tim SDM.')).toBeVisible();
   });

   test('F04-N2 five wrong passwords lock the account', async ({ page, db }) => {
      for (let i = 0; i < 5; i++) await login(page, E2E.user2, 'salah-' + i);
      await expect(page.getByRole('alert')).toContainText('Akun dikunci');
      await login(page, E2E.user2, E2E.password);
      await expect(page.getByRole('alert')).toContainText('Akun ini dikunci');
      await db.query(`update rpx.app_users set locked = false, failed_logins = 0 where username = $1`, [E2E.user2]);
   });
});

test.describe('F05 interactive report', () => {
   test('F05-H1 sort, filter with a chip, remove the chip, download CSV', async ({ page }) => {
      await login(page);
      await page.getByRole('link', { name: /^Gaji \(Rp\)/ }).click();
      await expect(page.getByRole('columnheader', { name: /Gaji \(Rp\)/ })).toHaveAttribute('aria-sort', 'ascending');
      await page.getByText('Filter', { exact: true }).click();
      await page.getByLabel('Kolom').selectOption({ label: 'Gaji (Rp)' });
      await page.getByLabel('Operator').selectOption({ label: '≥' });
      await page.getByLabel('Nilai').fill('10000000');
      await page.getByRole('button', { name: 'Terapkan' }).click();
      await expect(page.getByText('Gaji (Rp) ≥ 10000000')).toBeVisible();
      const rows = page.getByRole('table', { name: 'Daftar karyawan' }).locator('tbody tr');
      expect(await rows.count()).toBeLessThan(5);
      expect(await axe(page), 'report with chips a11y').toEqual([]);

      const download = page.waitForEvent('download');
      await page.getByRole('link', { name: 'CSV' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^emp-daftar-\d{4}-\d{2}-\d{2}\.csv$/);

      await page.getByRole('link', { name: 'Hapus filter Gaji (Rp) ≥ 10000000' }).click();
      await expect(page.getByText('Gaji (Rp) ≥ 10000000')).toHaveCount(0);
      await expect(page).toHaveURL(`${APP}/1`);
   });

   test('F05-E1 an invalid filter value is explained', async ({ page }) => {
      await login(page);
      await page.getByText('Filter', { exact: true }).click();
      await page.getByLabel('Kolom').selectOption({ label: 'Gaji (Rp)' });
      await page.getByLabel('Operator').selectOption({ label: '>' });
      await page.getByLabel('Nilai').fill('sejuta');
      await page.getByRole('button', { name: 'Terapkan' }).click();
      await expect(page.getByText('Nilai filter Gaji (Rp) harus angka.')).toBeVisible();
   });

   test('F05-E2 search with no match shows the empty state and a way out', async ({ page }) => {
      await login(page);
      await searchReport(page, 'zzz-tidak-ada');
      await expect(page.getByText('Tidak ada data yang cocok')).toBeVisible();
      await page.getByRole('link', { name: 'Hapus pencarian & filter' }).click();
      await expect(page.getByText(/^Baris 1–5/).first()).toBeVisible();
   });
});
