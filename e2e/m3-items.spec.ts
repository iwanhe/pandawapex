import { APP, axe, expect, login, test } from './fixtures.ts';
import { E2E } from './env.ts';

// M3 item types in the browser: popup LOV (search, keyboard, cascade), cascading select from a radio group,
// datetime, required checkbox (page 4 "Mutasi"); switch and checkbox group on the modal employee form.

test.describe('F04-I items and lists of values', () => {
   test.beforeEach(async ({ db }) => {
      // order-independent: Rina back in Keuangan as Akuntan, Dewi without skills and active
      await db.query(`update ${E2E.schema}.karyawan k set deptno = d.deptno, jabatan = 'Akuntan', status_kerja = 'TETAP'
                      from ${E2E.schema}.departemen d where d.nama = 'Keuangan' and k.nama = 'Rina Kartikasari'`);
      await db.query(`update ${E2E.schema}.karyawan set keahlian = null, aktif = true where nama = 'Dewi Lestari'`);
   });

   test('F04-I1 transfer with popup LOV (keyboard), cascading select, datetime and approval', async ({ page, db }) => {
      await login(page, E2E.user, E2E.password, `${APP}/4`);
      await expect(page.getByRole('heading', { name: 'Mutasi jabatan' })).toBeVisible();
      expect(await axe(page)).toEqual([]);

      // popup LOV filtered by its cascade parent
      await page.getByLabel('Departemen asal').selectOption({ label: 'Keuangan' });
      await page.getByRole('button', { name: 'Pilih Karyawan dari daftar' }).click();
      const dlg = page.getByRole('dialog', { name: 'Karyawan' });
      await expect(dlg).toBeVisible();
      // other specs may add people to Keuangan: compare with the database, not a fixed number
      const inKeu = (await db.query(`select count(*)::int as n from ${E2E.schema}.karyawan k join ${E2E.schema}.departemen d using (deptno)
                                     where d.nama = 'Keuangan' and k.aktif`)).rows[0].n;
      await expect(dlg.getByRole('option')).toHaveCount(inKeu);
      await expect(dlg.getByRole('option', { name: /Rina Kartikasari/ })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await dlg.getByLabel('Cari').fill('rina');
      await expect(dlg.getByRole('option')).toHaveCount(1);
      await expect(dlg.locator('mark')).toHaveText('Rina');
      await dlg.getByLabel('Cari').press('ArrowDown');
      await dlg.getByLabel('Cari').press('Enter');
      await expect(dlg).toBeHidden();
      await expect(page.locator('#P4_EMPNO')).toHaveValue('Rina Kartikasari (Akuntan)');
      await expect(page.locator('#P4_EMPNO')).toBeFocused();

      // the job list follows the target department
      await Promise.all([
         page.waitForResponse(r => r.url().includes('/field/P4_JABATAN_BARU')),
         page.getByRole('radio', { name: 'Produksi' }).check(),
      ]);
      const jobs = page.getByLabel('Jabatan baru');
      await expect(jobs.locator('option')).toHaveText(['- Pilih jabatan -', 'Analis QC', 'Operator Mesin', 'Supervisor Lini 2']);
      await jobs.selectOption('Operator Mesin');
      await page.getByLabel('Berlaku mulai').fill('2099-01-01T07:30');
      await page.getByRole('radio', { name: 'Kontrak' }).check();
      await page.getByRole('checkbox', { name: 'K3' }).check();

      // the approval box is required (browser first, server too)
      await page.getByRole('button', { name: 'Proses mutasi' }).click();
      await expect(page).toHaveURL(/\/4$/);
      await page.getByRole('checkbox', { name: /Atasan langsung sudah menyetujui/ }).check();
      await page.getByRole('button', { name: 'Proses mutasi' }).click();
      await expect(page.getByRole('status')).toContainText('Mutasi karyawan tercatat.');
      const row = (await db.query(`select k.jabatan, k.status_kerja, k.keahlian, d.nama as dept from ${E2E.schema}.karyawan k
                                   join ${E2E.schema}.departemen d using (deptno) where k.nama = 'Rina Kartikasari'`)).rows[0];
      expect(row).toEqual({ jabatan: 'Operator Mesin', status_kerja: 'KONTRAK', keahlian: 'K3', dept: 'Produksi' });
   });

   test('F04-I2 changing a parent clears the child; Escape closes only the list', async ({ page }) => {
      await login(page, E2E.user, E2E.password, `${APP}/4`);
      await page.getByRole('button', { name: 'Pilih Karyawan dari daftar' }).click();
      const dlg = page.getByRole('dialog', { name: 'Karyawan' });
      await dlg.getByRole('option', { name: /Yusuf Hidayat/ }).click();
      const shown = page.locator('#P4_EMPNO');
      await expect(shown).toHaveValue('Yusuf Hidayat (Pengembang APEX)');

      await shown.press('Enter');
      await expect(dlg).toBeVisible();
      await expect(dlg.getByLabel('Cari')).toBeFocused();
      await dlg.getByLabel('Cari').press('Escape');
      await expect(dlg).toBeHidden();
      await expect(page).toHaveURL(/\/4$/);
      await expect(shown).toBeFocused();

      await shown.press('ArrowDown');
      await dlg.getByRole('option', { name: /Sri Wahyuni/ }).click();
      await Promise.all([
         page.waitForResponse(r => r.url().includes('/field/P4_EMPNO')),
         page.getByLabel('Departemen asal').selectOption({ label: 'Produksi' }),
      ]);
      await expect(page.locator('#P4_EMPNO')).toHaveValue('');
   });

   test('F04-I3 switch and checkbox group on the modal form', async ({ page, db }) => {
      await login(page);
      await page.getByLabel('Cari di Daftar karyawan').fill('Dewi');
      await page.getByLabel('Cari di Daftar karyawan').press('Enter');
      await page.getByRole('link', { name: /^\d+$/ }).first().click();
      const form = page.frameLocator('dialog iframe');
      const aktif = form.getByRole('switch', { name: 'Aktif' });
      await expect(aktif).toBeChecked();
      await aktif.uncheck();
      await form.getByRole('checkbox', { name: 'SQL' }).check();
      await form.getByRole('checkbox', { name: 'APEX' }).check();
      await form.getByRole('radio', { name: 'Magang' }).check();
      await form.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      const row = (await db.query(`select aktif, keahlian, status_kerja from ${E2E.schema}.karyawan where nama = 'Dewi Lestari'`)).rows[0];
      expect(row).toEqual({ aktif: false, keahlian: 'SQL:APEX', status_kerja: 'MAGANG' });
      await db.query(`update ${E2E.schema}.karyawan set status_kerja = 'TETAP' where nama = 'Dewi Lestari'`);
   });
});

test.describe('F04-I bugs from the pre-pilot pass', () => {
   test('BUG-005: the popup LOV box looks like an input you can use (border contrast)', async ({ page }) => {
      await login(page, E2E.user, E2E.password, `${APP}/4`);
      const border = (sel: string) => page.locator(sel).evaluate(e => getComputedStyle(e).borderTopColor);
      expect(await border('#P4_EMPNO')).toBe(await border('#P4_DEPT_ASAL'));
   });

   test('BUG-007: list requests after the session ended lead to the login page', async ({ page, db, guard }) => {
      guard.allow(/401/);
      await login(page, E2E.user, E2E.password, `${APP}/4`);
      await db.query(`delete from rpx.sessions where app_user_id = (select id from rpx.app_users where username = $1 limit 1)`, [E2E.user]);
      await page.getByRole('button', { name: 'Pilih Karyawan dari daftar' }).click();
      await expect(page.getByLabel('Nama pengguna')).toBeVisible();
      // after signing in again the user comes back to the transfer page
      await page.getByLabel('Nama pengguna').fill(E2E.user);
      await page.getByLabel('Kata sandi').fill(E2E.password);
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${APP}/4$`));
   });
});
