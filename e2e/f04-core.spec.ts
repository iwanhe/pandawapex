// F04: end user logs in, finds an employee in the report, edits in the form, saves.
import { test, expect, login, axe, APP, empno, openEmployee } from './fixtures.ts';
import { E2E } from './env.ts';

/** per-project suffix: the desktop and mobile runs share one database */
const tag = () => test.info().project.name;

test.describe('F04 login -> report -> form -> save', () => {
   test('F04-H1 edit and save an employee', async ({ page, db }) => {
      await login(page);
      await expect(page).toHaveURL(`${APP}/1`);
      await expect(page.getByRole('table', { name: 'Daftar karyawan' })).toBeVisible();
      expect(await axe(page), 'report a11y').toEqual([]);

      await openEmployee(page, 'Dewi Lestari');
      expect(await axe(page), 'form a11y').toEqual([]);
      await page.getByLabel('Jabatan').fill('Analis QC Senior');
      await page.getByRole('button', { name: 'Simpan' }).click();

      await expect(page).toHaveURL(`${APP}/1`);
      await expect(page.getByRole('status')).toContainText('Data karyawan Dewi Lestari tersimpan.');
      const r = await db.query(`select jabatan from ${E2E.schema}.karyawan where nama = 'Dewi Lestari'`);
      expect(r.rows[0].jabatan).toBe('Analis QC Senior');
   });

   test('F04-H2 add a new employee', async ({ page, db }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      await expect(page.getByRole('button', { name: 'Hapus' })).toHaveCount(0);
      await page.getByLabel('Nama lengkap').fill('Siti Rahmawati');
      await page.getByLabel('Departemen').selectOption({ label: 'Keuangan' });
      await page.getByLabel('Tanggal masuk').fill('2026-10-01');
      await page.getByLabel('Gaji per bulan (Rp)').fill('7100000');
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('status')).toContainText('Siti Rahmawati tersimpan');
      expect(await empno(db, 'Siti Rahmawati')).toBeGreaterThan(0);
   });

   test('F04-H3 delete asks for confirmation; cancel keeps the row, accept deletes it', async ({ page, db }) => {
      await db.query(`insert into ${E2E.schema}.karyawan (nama, gaji) values ($1, 1000)`, [`Untuk Dihapus ${tag()}`]);
      await login(page);
      await openEmployee(page, `Untuk Dihapus ${tag()}`);
      page.once('dialog', d => d.dismiss());
      await page.getByRole('button', { name: 'Hapus' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Form karyawan' })).toBeVisible();
      expect(await empno(db, `Untuk Dihapus ${tag()}`)).toBeGreaterThan(0);
      page.once('dialog', d => { expect(d.message()).toBe('Hapus data karyawan ini?'); return d.accept(); });
      await page.getByRole('button', { name: 'Hapus' }).click();
      await expect(page).toHaveURL(`${APP}/1`);
      expect(await empno(db, `Untuk Dihapus ${tag()}`)).toBeUndefined();
   });

   test('F04-E1 empty required fields: inline errors, focus on the summary, a11y clean', async ({ page }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      await page.getByRole('button', { name: 'Simpan' }).click();
      const summary = page.getByRole('alert');
      await expect(summary).toContainText('3 kesalahan perlu diperbaiki');
      await expect(summary).toBeFocused();
      await expect(page.getByLabel('Nama lengkap')).toHaveAttribute('aria-invalid', 'true');
      // the summary links jump to the field
      await summary.getByRole('link', { name: 'Gaji per bulan (Rp) wajib diisi.' }).click();
      await expect(page).toHaveURL(/#P2_GAJI$/);
      expect(await axe(page), 'form-with-errors a11y').toEqual([]);
   });

   test('F04-E2 accents, emoji and a 120-character name round-trip unchanged', async ({ page, db }) => {
      // 120 UTF-16 units: the browser's maxlength counts those, the server counts characters (119 here)
      const head = 'Ñoño Dédé Śrī 😀 ';
      const name = head + 'x'.repeat(120 - head.length);
      expect(name.length).toBe(120);
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      await page.getByLabel('Nama lengkap').fill(name);
      await page.getByLabel('Tanggal masuk').fill('2026-01-02');
      await page.getByLabel('Gaji per bulan (Rp)').fill('5000000');
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('status')).toContainText('Ñoño Dédé Śrī 😀');
      expect(await empno(db, name)).toBeGreaterThan(0);
      // a long name does not break the layout on any width
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
   });

   test('F04-E3 a name longer than the item maximum is refused by the server, not just the browser', async ({ page, db }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      // bypass the maxlength attribute the way a script or an old browser would
      await page.getByLabel('Nama lengkap').evaluate((el: HTMLInputElement) => { el.removeAttribute('maxlength'); el.value = 'P'.repeat(500); });
      await page.getByLabel('Tanggal masuk').fill('2026-01-02');
      await page.getByLabel('Gaji per bulan (Rp)').fill('5000000');
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('alert')).toContainText('Nama lengkap');
      expect(await empno(db, 'P'.repeat(500))).toBeUndefined();
   });

   test('F04-E4 double click on Simpan saves once', async ({ page, db }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      await page.getByLabel('Nama lengkap').fill(`Klik Dua Kali ${tag()}`);
      await page.getByLabel('Tanggal masuk').fill('2026-03-03');
      await page.getByLabel('Gaji per bulan (Rp)').fill('4000000');
      await page.getByRole('button', { name: 'Simpan' }).dblclick();
      await expect(page).toHaveURL(`${APP}/1`);
      const n = await db.query(`select count(*)::int as n from ${E2E.schema}.karyawan where nama = $1`, [`Klik Dua Kali ${tag()}`]);
      expect(n.rows[0].n).toBe(1);
   });

   test('F04-E5 two tabs edit the same employee: the second save is stopped (lost update)', async ({ page, context, db }) => {
      await login(page);
      await openEmployee(page, 'Bambang Sutrisno');
      const tab2 = await context.newPage();
      await openEmployee(tab2, 'Bambang Sutrisno');
      await page.getByLabel('Jabatan').fill(`Supervisor Lini 3 ${tag()}`);
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('status')).toContainText('tersimpan');
      await tab2.getByLabel('Gaji per bulan (Rp)').fill('99999999');
      await tab2.getByRole('button', { name: 'Simpan' }).click();
      await expect(tab2.getByRole('alert')).toContainText('Data diubah pengguna lain');
      const r = await db.query(`select jabatan, gaji from ${E2E.schema}.karyawan where nama = 'Bambang Sutrisno'`);
      expect(r.rows[0].jabatan).toBe(`Supervisor Lini 3 ${tag()}`);
      expect(r.rows[0].gaji).not.toBe('99999999.00');
   });

   test('F04-E6 back button after saving shows the form again without resubmitting', async ({ page, db }) => {
      await login(page);
      await openEmployee(page, 'Rina Kartikasari');
      await page.getByLabel('Jabatan').fill('Akuntan Pajak');
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page).toHaveURL(`${APP}/1`);
      const before = (await db.query(`select count(*)::int as n from ${E2E.schema}.karyawan`)).rows[0].n;
      await page.goBack();
      await expect(page.getByLabel('Jabatan')).toHaveValue('Akuntan Pajak');
      await expect(page.getByRole('button', { name: 'Simpan' })).toBeEnabled();
      expect((await db.query(`select count(*)::int as n from ${E2E.schema}.karyawan`)).rows[0].n).toBe(before);
   });

   test('F04-E7 session expires while the form is open: back to login, then back to the page', async ({ page, db }) => {
      await login(page);
      await openEmployee(page, 'Maria Ulfa');
      await db.query(`delete from rpx.sessions where username = $1`, [E2E.user]);
      await page.getByLabel('Jabatan').fill('Tidak tersimpan');
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('status')).toContainText('Sesi Anda berakhir');
      await page.getByLabel('Nama pengguna').fill(E2E.user);
      await page.getByLabel('Kata sandi').fill(E2E.password);
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();
      await expect(page).toHaveURL(`${APP}/2`);
   });

   test('F04-E8 keyboard only: login, open a row, save', async ({ page }) => {
      await page.goto(`${APP}/1`);
      await page.keyboard.type(E2E.user);
      await page.keyboard.press('Tab');
      await page.keyboard.type(E2E.password);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${APP}/1`);
      // Tab to the first row link
      for (let i = 0; i < 40; i++) {
         await page.keyboard.press('Tab');
         if (await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('tbody') !== null)) break;
      }
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name: 'Form karyawan' })).toBeVisible();
      await page.getByRole('button', { name: 'Simpan' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${APP}/1`);
   });

   test('F04-E9 the row was deleted by someone else while the form was open', async ({ page, db }) => {
      await db.query(`insert into ${E2E.schema}.karyawan (nama, gaji) values ($1, 1000)`, [`Akan Hilang ${tag()}`]);
      await login(page);
      await openEmployee(page, `Akan Hilang ${tag()}`);
      await db.query(`delete from ${E2E.schema}.karyawan where nama = $1`, [`Akan Hilang ${tag()}`]);
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('alert')).toContainText('Data sudah tidak ada');
   });

   test('F04-N1 wrong password, then unknown user: same generic message, a11y clean', async ({ page }) => {
      await login(page, E2E.user, 'salah-kata-sandi');
      await expect(page.getByRole('alert')).toContainText('Nama pengguna atau kata sandi salah.');
      expect(await axe(page), 'login a11y').toEqual([]);
      await login(page, 'tidak-ada', 'apa-saja-12345');
      await expect(page.getByRole('alert')).toContainText('Nama pengguna atau kata sandi salah.');
   });

   test('F04-N2 five wrong passwords lock the account', async ({ page, db }) => {
      for (let i = 0; i < 5; i++) await login(page, E2E.user2, 'salah-' + i);
      await expect(page.getByRole('alert')).toContainText('Akun dikunci');
      await login(page, E2E.user2, E2E.password);
      await expect(page.getByRole('alert')).toContainText('Akun ini dikunci');
      await db.query(`update rpx.app_users set locked = false, failed_logins = 0 where username = $1`, [E2E.user2]);
   });
});
