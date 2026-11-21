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
      // the last action moves the cursor to the first destination department (none is chosen after clearing)
      await expect(page.getByRole('group', { name: /Departemen tujuan/ }).getByRole('radio').first()).toBeFocused();
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

      test('DA-H7 execute_server_code: the total comes back without a page submit; an error stops the next actions', async ({ page }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         const total = page.locator('#P1_TOTAL');
         await page.getByLabel('Gaji pokok').fill('1000');
         await Promise.all([
            page.waitForResponse(r => r.url().endsWith(`${DA_APP}/1/da`) && r.status() === 200),
            page.getByRole('button', { name: 'Hitung total' }).click(),
         ]);
         await expect(total).toHaveText('1.100');
         await expect(page.getByLabel('Sapaan')).toHaveValue('dihitung');     // the action after it ran
         await expect(page).toHaveURL(new RegExp(`${DA_APP}/1$`));
         expect(await axe(page)).toEqual([]);

         // the code raises: a message in the form, the next action does not run, keyboard only
         await page.getByLabel('Sapaan').fill('');
         await page.getByLabel('Gaji pokok').fill('-5');
         await page.getByRole('button', { name: 'Hitung total' }).focus();
         await Promise.all([
            page.waitForResponse(r => r.url().endsWith(`${DA_APP}/1/da`) && r.status() === 422),
            page.keyboard.press('Enter'),
         ]);
         const alert = page.getByRole('alert');
         await expect(alert).toContainText('Aksi tidak berhasil.');
         await expect(alert).toContainText('Gaji pokok tidak boleh negatif.');
         await expect(total).toHaveText('1.100');
         await expect(page.getByLabel('Sapaan')).toHaveValue('');
         expect(await axe(page)).toEqual([]);

         // a good call again removes the message
         await page.getByLabel('Gaji pokok').fill('10');
         await page.getByRole('button', { name: 'Hitung total' }).click();
         await expect(total).toHaveText('11');
         await expect(page.getByRole('alert')).toHaveCount(0);
      });

      test('DA-H9 alert and focus: an empty salary shows a message and puts the cursor back', async ({ page }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         const gaji = page.getByLabel('Gaji pokok');
         await gaji.fill('500');
         await gaji.press('Tab');
         let message = '';
         page.once('dialog', d => { message = d.message(); return d.accept(); });
         await gaji.fill('');
         await gaji.press('Tab');                     // change fires when leaving the field
         await expect.poll(() => message).toBe('Gaji pokok belum diisi.');
         await expect(gaji).toBeFocused();
      });

      test('DA-E1 inside a modal dialog: server code returns into the dialog, its error is shown as text', async ({ page }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         await page.getByRole('link', { name: 'Buka dialog' }).or(page.getByRole('button', { name: 'Buka dialog' })).click();
         await expect(page.getByRole('dialog', { name: 'Dialog uji' })).toBeVisible();
         const frame = page.frameLocator('dialog iframe');
         await frame.getByLabel('Angka').fill('21');
         await frame.getByRole('button', { name: 'Kali dua' }).click();
         await expect(frame.locator('#P2_HASIL')).toHaveText('42');
         let dialogs = 0;
         page.on('dialog', d => { dialogs++; return d.dismiss(); });
         await frame.getByLabel('Angka').fill('-3');
         await frame.getByRole('button', { name: 'Kali dua' }).click();
         const alert = frame.getByRole('alert');
         await expect(alert).toContainText('Angka <img src=x onerror=alert(1)> -3 ditolak.');
         expect(await alert.locator('img').count(), 'markup in the message stays text').toBe(0);
         expect(dialogs).toBe(0);
         await expect(frame.locator('#P2_HASIL')).toHaveText('42');
         expect(await axe(page)).toEqual([]);
      });

      test('DA-E2 a defined_by_da button in the page header works like one in a region', async ({ page }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         await page.getByRole('button', { name: 'Isi dari header' }).click();
         await expect(page.getByLabel('Sapaan')).toHaveValue('dari header');
         await expect(page.getByLabel('Sapaan')).toBeFocused();
      });

      test('DA-E3 a cascading list that is refreshed keeps the state a dynamic action gave it', async ({ page }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         const karyawan = page.getByLabel('Karyawan', { exact: true });
         await expect(karyawan).toBeDisabled();                 // switch off: disabled on load
         await Promise.all([
            page.waitForResponse(r => r.url().includes('/field/P1_KARYAWAN')),
            page.getByLabel('Departemen').selectOption({ label: 'Keuangan' }),
         ]);
         await expect(karyawan.locator('option')).not.toHaveCount(1);   // the list now has the department's people
         await expect(karyawan).toBeDisabled();                 // ... and is still disabled after it was replaced
         await page.getByRole('switch', { name: 'Kirim lewat email' }).check();
         await expect(karyawan).toBeEnabled();
      });

      test('DA-E4 two dynamic actions that feed each other stop by themselves', async ({ page }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         await page.getByLabel('Cermin A').fill('halo');
         await page.getByLabel('Cermin A').press('Tab');
         await expect(page.getByLabel('Cermin B')).toHaveValue('halo');
         await page.getByLabel('Cermin B').fill('dunia');
         await page.getByLabel('Cermin B').press('Tab');
         await expect(page.getByLabel('Cermin A')).toHaveValue('dunia');
         // the page still answers
         await page.getByRole('button', { name: 'Isi dari header' }).click();
         await expect(page.getByLabel('Sapaan')).toHaveValue('dari header');
      });

      test('DA-E5 the session ends before a server call: the page goes to the login and back', async ({ page, db }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         await page.getByLabel('Gaji pokok').fill('100');
         await db.query(`delete from rpx.sessions where app_user_id = (select id from rpx.app_users where username = $1 limit 1)`, [E2E.user]);
         await page.getByRole('button', { name: 'Hitung total' }).click();
         await expect(page.getByLabel('Nama pengguna')).toBeVisible();
         await page.getByLabel('Nama pengguna').fill(E2E.user);
         await page.getByLabel('Kata sandi').fill(E2E.password);
         await page.getByRole('button', { name: 'Masuk', exact: true }).click();
         await expect(page.getByRole('button', { name: 'Hitung total' })).toBeVisible();
      });

      test('DA-H8 refresh with items to submit: the report follows the chosen department without a reload', async ({ page, db }) => {
         await login(page, E2E.user, E2E.password, `${DA_APP}/1`);
         const region = page.getByRole('region', { name: 'Jumlah karyawan' });
         await page.getByLabel('Nama').fill('tetap di sini');
         const n = async (dept: string) => String((await db.query(`select count(*)::int as n from ${E2E.schema}.karyawan k
            join ${E2E.schema}.departemen d using (deptno) where d.nama = $1`, [dept])).rows[0].n);
         await page.getByLabel('Departemen').selectOption({ label: 'Keuangan' });
         await expect(region.getByRole('cell')).toHaveText(await n('Keuangan'));
         await page.getByLabel('Departemen').selectOption({ label: 'Produksi' });
         await expect(region.getByRole('cell')).toHaveText(await n('Produksi'));
         await expect(page.getByLabel('Nama')).toHaveValue('tetap di sini');
         // the choice is in session state: a reload shows the same filter
         await page.reload();
         await expect(page.getByLabel('Departemen')).toHaveValue(/\d+/);
         await expect(region.getByRole('cell')).toHaveText(await n('Produksi'));
      });
   });

   test('DA-H6 emp page 4: choosing an employee shows the current position (server code, popup LOV)', async ({ page, db }) => {
      await db.query(`update ${E2E.schema}.karyawan k set deptno = d.deptno, jabatan = 'Akuntan'
                      from ${E2E.schema}.departemen d where d.nama = 'Keuangan' and k.nama = 'Rina Kartikasari'`);
      await login(page, E2E.user, E2E.password, `${APP}/4`);
      await page.getByRole('button', { name: 'Pilih Karyawan dari daftar' }).click();
      const dlg = page.getByRole('dialog', { name: 'Karyawan' });
      await dlg.getByLabel('Cari').fill('rina');
      await expect(dlg.getByRole('option')).toHaveCount(1);
      await dlg.getByLabel('Cari').press('ArrowDown');
      await dlg.getByLabel('Cari').press('Enter');
      await expect(page.locator('#P4_POSISI')).toHaveText('Akuntan di Keuangan');
      expect(await axe(page)).toEqual([]);
   });
});
