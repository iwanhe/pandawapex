import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { axe, expect, test } from './fixtures.ts';
import { E2E } from './env.ts';

// B5 / flow F03 in the browser: change a page in the Page Designer and see it in the running app.
// Works on its own application (made with the wizard) so the example app used by other specs stays as it is.
const SHOTS = join(import.meta.dirname, '../replica/clone-screens');
mkdirSync(SHOTS, { recursive: true });
type Page = import('@playwright/test').Page;
const shot = (page: Page, id: string, project: string) =>
   page.screenshot({ path: join(SHOTS, `${id}-${project === 'mobile' ? 390 : 1440}.png`), fullPage: true });

test('B5-H1 F03: edit an item label and a region in the Page Designer, add a region, run the page', async ({ page }, info) => {
   const project = info.project.name;
   const name = `Desain ${project} ${Date.now().toString(36)}`;
   await page.goto('/builder/login');
   await page.getByLabel('Workspace').fill(E2E.ws);
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await page.goto('/builder/apps/new');
   await page.getByLabel('Nama aplikasi').fill(name);
   await page.getByRole('checkbox', { name: 'departemen' }).check();
   await page.getByRole('button', { name: 'Buat aplikasi' }).click();
   await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

   // open page 2 (the form) in the designer
   await page.getByRole('link', { name: /^Ubah halaman 2/ }).click();
   await expect(page.getByRole('heading', { name: 'Halaman 2: Form departemen', level: 1 })).toBeVisible();
   await expect(page.getByRole('navigation', { name: 'Struktur halaman' })).toBeVisible();
   expect(await axe(page)).toEqual([]);
   await page.getByRole('link', { name: /Item P2_LOKASI/ }).click();
   await expect(page.getByRole('textbox', { name: /^Label/ })).toHaveValue('Lokasi');
   await page.getByRole('textbox', { name: /^Label/ }).fill('Kota');
   await page.getByRole('textbox', { name: /^Bantuan/ }).fill('Kota kantor departemen.');
   await page.getByRole('button', { name: 'Simpan' }).click();
   await expect(page.getByRole('status').filter({ hasText: 'Item P2_LOKASI disimpan.' })).toBeVisible();
   await expect(page.getByRole('textbox', { name: /^Label/ })).toHaveValue('Kota');
   await shot(page, 'S06', project);
   expect(await axe(page)).toEqual([]);

   // a wrong value: the reason is shown and focused, nothing saved
   await page.getByRole('textbox', { name: /^Lebar kolom/ }).fill('20');
   await page.getByRole('button', { name: 'Simpan' }).click();
   await expect(page.getByRole('alert')).toContainText('Perubahan tidak dapat disimpan');
   await expect(page.getByRole('alert')).toBeFocused();
   expect(await axe(page)).toEqual([]);

   // page 1: add a region with a text, move it above the report
   await page.getByLabel('Halaman', { exact: true }).selectOption('1');
   await expect(page.getByRole('heading', { name: 'Halaman 1: Departemen', level: 1 })).toBeVisible();
   await page.getByRole('button', { name: 'Tambah region' }).click();
   await expect(page.getByRole('status').filter({ hasText: 'Region Region baru ditambahkan.' })).toBeVisible();
   await page.getByRole('textbox', { name: /^Judul/ }).fill('Petunjuk');
   await page.getByRole('textbox', { name: /^Sumber: HTML/ }).fill('<p>Klik nomor departemen untuk mengubahnya.</p>');
   await page.getByRole('button', { name: 'Simpan' }).click();
   await expect(page.getByRole('status').filter({ hasText: 'disimpan' })).toBeVisible();
   await page.getByRole('button', { name: 'Naik' }).click();
   await expect(page.getByRole('link', { name: /Region Petunjuk/ })).toHaveAttribute('aria-current', 'true');

   // the running app shows both changes
   await page.goto(`/r/${E2E.ws}/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/1`);
   await page.getByLabel('Nama pengguna').fill(E2E.user);
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk' }).click();
   await expect(page.getByRole('heading', { name: 'Petunjuk' })).toBeVisible();
   await expect(page.getByText('Klik nomor departemen untuk mengubahnya.')).toBeVisible();
   await page.getByRole('button', { name: 'Tambah' }).or(page.getByRole('link', { name: 'Tambah' })).first().click();
   await expect(page.frameLocator('dialog[open] iframe').getByLabel('Kota')).toBeVisible();
});

test('B5-H2 S13: application properties', async ({ page }, info) => {
   await page.goto('/builder/login');
   await page.getByLabel('Workspace').fill(E2E.ws);
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await page.goto('/builder/apps/emp/properties');
   await expect(page.getByRole('textbox', { name: /^Nama/ }).first()).toHaveValue('Data Karyawan');
   expect(await axe(page)).toEqual([]);
   await shot(page, 'S13', info.project.name);
});
