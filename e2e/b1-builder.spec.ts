import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { axe, expect, test } from './fixtures.ts';
import { E2E } from './env.ts';

// B1 builder in the browser: sign-in (S01), workspace home (S02), application list (S03), create and import (S04),
// application home with export and delete (S05). The pilot workspace has developer "admin".
const SHOTS = join(import.meta.dirname, '../replica/clone-screens');
mkdirSync(SHOTS, { recursive: true });

async function shot(page: import('@playwright/test').Page, id: string, project: string) {
   await page.screenshot({ path: join(SHOTS, `${id}-${project === 'mobile' ? 390 : 1440}.png`), fullPage: true });
}

async function devLogin(page: import('@playwright/test').Page) {
   await page.goto('/builder');
   await expect(page).toHaveURL(/\/builder\/login\?return=%2Fbuilder$/);
   await page.getByLabel('Workspace').fill('pilot');
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await expect(page.getByRole('heading', { name: 'Workspace pilot', level: 1 })).toBeVisible();
}

test.describe('B1 builder', () => {
   test('B1-H1 sign in, create, export, import back, delete; axe on every screen', async ({ page, guard }, info) => {
      const project = info.project.name;
      const alias = `coba-${project}-${Date.now().toString(36)}`;

      await page.goto('/builder/login');
      expect(await axe(page)).toEqual([]);
      await shot(page, 'S01', project);
      // wrong password stays on the page with one message
      await page.getByLabel('Workspace').fill('pilot');
      await page.getByLabel('Nama pengguna').fill('admin');
      await page.getByLabel('Kata sandi').fill('bukan-sandinya');
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Workspace, nama pengguna, atau kata sandi salah');
      expect(await axe(page)).toEqual([]);

      await devLogin(page);
      await expect(page.getByRole('link', { name: 'Demo Permintaan Barang', exact: true })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await shot(page, 'S02', project);

      await page.goto('/builder/apps');
      await expect(page.getByRole('heading', { name: 'Aplikasi', level: 1 })).toBeVisible();
      await page.getByLabel('Cari aplikasi').fill('permintaan');
      await page.getByLabel('Cari aplikasi').press('Enter');
      await expect(page.getByRole('link', { name: 'Demo Permintaan Barang', exact: true })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await shot(page, 'S03', project);

      // create, with a validation round first
      await page.getByRole('link', { name: 'Buat aplikasi' }).click();
      await page.getByLabel('Alias').fill('Bukan Alias!');
      await page.getByRole('button', { name: 'Buat aplikasi' }).click();
      await expect(page.getByRole('alert')).toContainText('Periksa isian berikut');
      await expect(page.getByRole('alert')).toBeFocused();
      expect(await axe(page)).toEqual([]);
      await shot(page, 'S04', project);
      await page.getByLabel('Nama aplikasi').fill('Coba Builder');
      await page.getByLabel('Alias').fill(alias);
      await page.getByRole('button', { name: 'Buat aplikasi' }).click();
      await expect(page.getByRole('heading', { name: 'Coba Builder', level: 1 })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Aplikasi Coba Builder dibuat.' })).toBeVisible();
      expect(await axe(page)).toEqual([]);

      // export downloads the spec
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Ekspor YAML' }).click()]);
      expect(dl.suggestedFilename()).toBe(`${alias}.yaml`);
      const file = await dl.path();
      const text = readFileSync(file, 'utf8');
      expect(text).toContain(`app: ${alias}`);

      // import the same file back (replace), through the file picker
      await page.goto('/builder/apps/import');
      expect(await axe(page)).toEqual([]);
      await page.getByLabel('Pilih file YAML').setInputFiles(file);
      await expect(page.getByLabel('Isi spec')).toHaveValue(text);
      await page.getByRole('button', { name: 'Impor' }).click();
      await expect(page.getByRole('alert')).toContainText(`Aplikasi "${alias}" sudah ada`);
      await page.getByLabel('Ganti aplikasi bila alias sudah ada').check();
      await page.getByRole('button', { name: 'Impor' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Aplikasi diganti: 1 halaman' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Riwayat impor' }).getByRole('row')).toHaveCount(3);
      await shot(page, 'S05', project);

      // the new app runs: its home page asks for a sign-in
      const run = await page.request.get(`/r/pilot/${alias}/1`, { maxRedirects: 0 });
      expect(run.status()).toBe(303);

      // delete needs the alias
      await page.getByLabel(/Ketik alias/).fill('salah');
      await page.getByRole('button', { name: 'Hapus aplikasi' }).click();
      await expect(page.getByRole('alert')).toContainText('bukan alias aplikasi');
      await page.getByLabel(/Ketik alias/).fill(alias);
      await page.getByRole('button', { name: 'Hapus aplikasi' }).click();
      await expect(page).toHaveURL(/\/builder\/apps$/);
      await expect(page.getByRole('status').filter({ hasText: `(${alias}) dihapus` })).toBeVisible();
      guard.allow(/404/);
   });

   test('B1-K1 keyboard only: sign in and sign out', async ({ page }) => {
      await page.goto('/builder/login');
      // the workspace field has focus when the page opens
      await expect(page.getByLabel('Workspace')).toBeFocused();
      await page.keyboard.type('pilot');
      await page.keyboard.press('Tab');
      await page.keyboard.type('admin');
      await page.keyboard.press('Tab');
      await page.keyboard.type(E2E.password);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Workspace pilot', level: 1 })).toBeVisible();
      await page.getByRole('button', { name: 'Keluar' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText('Anda sudah keluar dari builder.')).toBeVisible();
      await expect(page.getByLabel('Workspace')).toHaveValue('pilot');
   });
});
