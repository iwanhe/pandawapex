import { APP, axe, dialogFrame, expect, login, openEmployee, test } from './fixtures.ts';
import { E2E } from './env.ts';

// Dynamic actions in the browser (DA1), on the example app:
//  - page 2 (modal form): status "Magang" hides the skills group (change + page load, with else)
//  - page 4 (mutasi): the "Kosongkan isian" button asks first, then clears fields and sets the status back

test.describe('DA dynamic actions', () => {
   test('DA-H1 change shows and hides a field; the state is applied again when the page is shown with errors', async ({ page }) => {
      await login(page);
      await page.getByRole('link', { name: 'Tambah karyawan' }).click();
      const form = await dialogFrame(page);
      const skills = form.getByRole('group', { name: 'Keahlian' });
      await expect(skills).toBeVisible();
      await form.getByRole('radio', { name: 'Magang' }).check();
      await expect(skills).toBeHidden();
      await form.getByRole('radio', { name: 'Kontrak' }).check();
      await expect(skills).toBeVisible();

      // keyboard only: arrow keys move through the radio group and fire change
      await form.getByRole('radio', { name: 'Kontrak' }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(form.getByRole('radio', { name: 'Magang' })).toBeChecked();
      await expect(skills).toBeHidden();
      expect(await axe(page), 'a11y with the group hidden').toEqual([]);

      // submit with missing fields: the server renders the page again with Magang chosen, the DA hides the group on load
      await form.getByRole('button', { name: 'Simpan' }).click();
      await expect(form.getByRole('alert')).toContainText('kesalahan perlu diperbaiki');
      await expect(form.getByRole('radio', { name: 'Magang' })).toBeChecked();
      await expect(skills).toBeHidden();
   });

   test('DA-H2 a defined_by_da button: confirm, cancel keeps the values, accept clears them', async ({ page }) => {
      await login(page, E2E.user, E2E.password, `${APP}/4`);
      const berlaku = page.getByLabel('Berlaku mulai');
      const setuju = page.getByRole('checkbox', { name: /Atasan langsung sudah menyetujui/ });
      await berlaku.fill('2099-01-01T07:30');
      await page.getByRole('radio', { name: 'Kontrak' }).check();
      await page.getByRole('checkbox', { name: 'K3' }).check();
      await setuju.check();
      const kosongkan = page.getByRole('button', { name: 'Kosongkan isian' });

      page.once('dialog', d => { expect(d.message()).toBe('Kosongkan semua isian tujuan mutasi?'); return d.dismiss(); });
      await kosongkan.click();
      await expect(berlaku).toHaveValue('2099-01-01T07:30');
      await expect(setuju).toBeChecked();
      await expect(page).toHaveURL(/\/4$/);                 // a defined_by_da button never submits by itself

      page.once('dialog', d => d.accept());
      await kosongkan.focus();
      await page.keyboard.press('Enter');                  // keyboard works like a click
      await expect(berlaku).toHaveValue('');
      await expect(setuju).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'K3' })).not.toBeChecked();
      await expect(page.getByRole('radio', { name: 'Tetap' })).toBeChecked();
      await expect(page.getByRole('status')).toHaveCount(0);   // nothing was submitted
      expect(await axe(page)).toEqual([]);
   });

   test('DA-H3 an existing employee on Magang opens with the skills hidden', async ({ page, db }) => {
      const nama = 'Dewi Lestari';
      await db.query(`update ${E2E.schema}.karyawan set status_kerja = 'MAGANG' where nama = $1`, [nama]);
      try {
         await login(page);
         const form = await openEmployee(page, nama);
         await expect(form.getByRole('radio', { name: 'Magang' })).toBeChecked();
         await expect(form.getByRole('group', { name: 'Keahlian' })).toBeHidden();
      } finally {
         await db.query(`update ${E2E.schema}.karyawan set status_kerja = 'TETAP' where nama = $1`, [nama]);
      }
   });

   test.describe('playground app', () => {
      const DA_APP = `/r/${E2E.ws}/da`;

      test('DA-H4 enable/disable on load and on change; a disabled field is still posted', async ({ page }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         const email = page.getByLabel('Alamat email');
         await expect(email).toBeDisabled();                // switch off: disabled as soon as the page loads
         await page.getByRole('switch', { name: 'Kirim lewat email' }).check();
         await expect(email).toBeEnabled();
         await email.fill('sri@kcsi.co.id');
         await page.getByRole('switch', { name: 'Kirim lewat email' }).uncheck();
         await expect(email).toBeDisabled();
         expect(await axe(page)).toEqual([]);

         // key release copies the name while typing
         await page.getByLabel('Nama').pressSequentially('Sri');
         await expect(page.getByLabel('Sapaan')).toHaveValue('Sri');

         // confirm + submit_page with the button's REQUEST; the process sees the disabled field's value
         page.once('dialog', d => d.accept());
         await page.getByRole('button', { name: 'Kirim' }).click();
         await expect(page.getByRole('status')).toContainText('Terkirim.');
         await expect(page.locator('#P1_HASIL')).toHaveText('terkirim ke sri@kcsi.co.id untuk Sri');
      });

      test('DA-H5 refresh reloads one region in place and keeps what was typed elsewhere', async ({ page, db }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         const count = async () => Number((await db.query(`select count(*)::int as n from ${E2E.schema}.karyawan`)).rows[0].n);
         const region = page.getByRole('region', { name: 'Jumlah karyawan' });
         await expect(region.getByRole('cell')).toHaveText(String(await count()));
         await page.getByLabel('Nama').fill('belum disimpan');
         await db.query(`insert into ${E2E.schema}.karyawan (nama, gaji) values ('Penambah Jumlah DA', 1)`);
         try {
            await Promise.all([
               page.waitForResponse(r => r.url().endsWith(`${DA_APP}/1`) && r.request().method() === 'GET'),
               page.getByRole('button', { name: 'Muat ulang jumlah' }).click(),
            ]);
            await expect(region.getByRole('cell')).toHaveText(String(await count()));
            await expect(page.getByLabel('Nama')).toHaveValue('belum disimpan');
         } finally {
            await db.query(`delete from ${E2E.schema}.karyawan where nama = 'Penambah Jumlah DA'`);
         }
      });
   });
});
