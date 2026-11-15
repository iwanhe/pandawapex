import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { axe, expect, test } from './fixtures.ts';
import { E2E } from './env.ts';

// B2 in the browser (recon S19): application users, developers, own account. Pilot workspace, developer "admin".
const SHOTS = join(import.meta.dirname, '../replica/clone-screens');
mkdirSync(SHOTS, { recursive: true });
type Page = import('@playwright/test').Page;

const shot = (page: Page, id: string, project: string) =>
   page.screenshot({ path: join(SHOTS, `${id}-${project === 'mobile' ? 390 : 1440}.png`), fullPage: true });

async function devLogin(page: Page) {
   await page.goto('/builder/login');
   await page.getByLabel('Workspace').fill('pilot');
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await expect(page.getByRole('heading', { name: 'Workspace pilot', level: 1 })).toBeVisible();
}

test.describe('B2 accounts', () => {
   test('B2-H1 application user: add with a group, reset password, lock, unlock, delete', async ({ page }, info) => {
      const project = info.project.name;
      const name = `uji.${project}.${Date.now().toString(36)}`;
      await devLogin(page);
      await page.goto('/builder/users');
      await expect(page.getByRole('link', { name: 'budi', exact: true })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await shot(page, 'S19-users', project);

      await page.getByRole('link', { name: 'Tambah pengguna' }).first().click();
      await page.getByLabel('Nama pengguna').fill(name);
      await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('pendek');
      await page.getByLabel('Ulangi kata sandi').fill('pendek');
      await page.getByRole('button', { name: 'Tambah pengguna' }).click();
      await expect(page.getByRole('alert')).toContainText('minimal 10 karakter');
      expect(await axe(page)).toEqual([]);
      await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('sandi-uji-123');
      await page.getByLabel('Ulangi kata sandi').fill('sandi-uji-123');
      await page.getByLabel('Grup lain').fill('AUDIT');
      await page.getByRole('button', { name: 'Tambah pengguna' }).click();
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: `Pengguna ${name} ditambahkan.` })).toBeVisible();
      await expect(page.getByLabel('AUDIT')).toBeChecked();
      expect(await axe(page)).toEqual([]);
      await shot(page, 'S19-user', project);

      // the new account signs in to the pilot app
      const login = await page.request.get('/r/pilot/demo/login');
      expect(login.status()).toBe(200);

      await page.getByLabel('Kata sandi baru').fill('sandi-uji-456');
      await page.getByLabel('Ulangi kata sandi').fill('sandi-uji-456');
      await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
      await expect(page.getByRole('status').filter({ hasText: `Kata sandi ${name} diganti` })).toBeVisible();

      await page.getByRole('button', { name: 'Kunci akun' }).click();
      await expect(page.getByRole('status').filter({ hasText: `${name} dikunci.` })).toBeVisible();
      await page.getByRole('button', { name: 'Buka kunci' }).click();
      await expect(page.getByRole('status').filter({ hasText: `Kunci ${name} dibuka.` })).toBeVisible();

      await page.getByLabel(/^Ketik .* untuk mengonfirmasi$/).fill(name);
      await page.getByRole('button', { name: 'Hapus akun' }).click();
      await expect(page).toHaveURL(/\/builder\/users$/);
      await expect(page.getByRole('status').filter({ hasText: `Pengguna ${name} dihapus.` })).toBeVisible();
   });

   test('B2-H2 developers (administrator) and own account', async ({ page }, info) => {
      const project = info.project.name;
      const name = `dev-${project}-${Date.now().toString(36)}`;
      await devLogin(page);
      await page.goto('/builder/developers');
      await expect(page.getByText('(Anda)')).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await shot(page, 'S19-developers', project);

      await page.getByRole('link', { name: 'Tambah developer' }).click();
      await page.getByLabel('Nama pengguna').fill(name);
      await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('sandi-dev-123');
      await page.getByLabel('Ulangi kata sandi').fill('sandi-dev-123');
      await page.getByRole('button', { name: 'Tambah developer' }).click();
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await page.getByRole('button', { name: 'Jadikan administrator' }).click();
      await expect(page.getByRole('status').filter({ hasText: `${name} sekarang administrator.` })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await page.getByLabel(/^Ketik .* untuk mengonfirmasi$/).fill(name);
      await page.getByRole('button', { name: 'Hapus akun' }).click();
      await expect(page.getByRole('status').filter({ hasText: `Developer ${name} dihapus.` })).toBeVisible();

      await page.goto('/builder/account');
      await page.getByLabel('Kata sandi sekarang').fill('bukan-sandinya');
      await page.getByLabel('Kata sandi baru').fill('sandi-baru-123');
      await page.getByLabel('Ulangi kata sandi').fill('sandi-baru-123');
      await page.getByRole('button', { name: 'Ganti kata sandi' }).click();
      await expect(page.getByRole('alert')).toContainText('Kata sandi sekarang salah');
      await expect(page.getByRole('alert')).toBeFocused();
      expect(await axe(page)).toEqual([]);
      await shot(page, 'S19-account', project);
   });
});
