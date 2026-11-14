import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { axe, expect, test } from './fixtures.ts';
import { E2E } from './env.ts';

// B3 / flow F01 in the browser: from the builder home to a running CRUD app, counting the developer's actions
// (recon F01: about 8). Workspace e2e (schema e2e_app with the emp tables), developer "admin".
const SHOTS = join(import.meta.dirname, '../replica/clone-screens');
mkdirSync(SHOTS, { recursive: true });
type Page = import('@playwright/test').Page;
const shot = (page: Page, id: string, project: string) =>
   page.screenshot({ path: join(SHOTS, `${id}-${project === 'mobile' ? 390 : 1440}.png`), fullPage: true });

test('B3-H1 F01: builder home → wizard → running app with report and form, within 8 actions', async ({ page }, info) => {
   const project = info.project.name;
   const name = `Departemen ${project} ${Date.now().toString(36)}`;
   const alias = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

   await page.goto('/builder/login');
   await page.getByLabel('Workspace').fill(E2E.ws);
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await expect(page.getByRole('heading', { name: `Workspace ${E2E.ws}`, level: 1 })).toBeVisible();

   let actions = 0;
   const act = async (step: Promise<unknown>) => { await step; actions++; };

   await act(page.getByRole('link', { name: 'Buat aplikasi' }).first().click());
   await expect(page.getByRole('heading', { name: 'Buat aplikasi', level: 1 })).toBeVisible();
   await expect(page.getByRole('checkbox', { name: 'jabatan' })).toBeVisible();
   expect(await axe(page)).toEqual([]);
   await act(page.getByLabel('Nama aplikasi').fill(name));
   await expect(page.getByLabel('Alias')).toHaveValue(alias);          // filled from the name
   await act(page.getByRole('checkbox', { name: 'departemen' }).check());
   await shot(page, 'S04-wizard', project);
   await act(page.getByRole('button', { name: 'Buat aplikasi' }).click());
   await expect(page.getByRole('status').filter({ hasText: `Aplikasi ${name} dibuat: 2 halaman dari 1 tabel.` })).toBeVisible();
   expect(await axe(page)).toEqual([]);

   await act(page.getByRole('link', { name: 'Jalankan', exact: true }).click());
   await act(page.getByLabel('Nama pengguna').fill(E2E.user));
   await act(page.getByLabel('Kata sandi').fill(E2E.password));
   await act(page.getByRole('button', { name: 'Masuk' }).click());
   await expect(page.getByRole('heading', { name: 'Departemen', level: 1 })).toBeVisible();
   await expect(page.getByRole('cell', { name: 'Gudang Bahan Baku' })).toBeVisible();
   expect(actions).toBeLessThanOrEqual(8);
   expect(await axe(page)).toEqual([]);
   await shot(page, 'S21-generated', project);

   // add a row through the generated dialog form
   const kota = `Semarang ${project}`;
   await page.getByRole('button', { name: 'Tambah' }).or(page.getByRole('link', { name: 'Tambah' })).first().click();
   const dialog = page.frameLocator('dialog[open] iframe');
   await dialog.getByLabel('Nama').fill(`Gudang ${kota}`);
   await dialog.getByLabel('Lokasi').fill(kota);
   await dialog.getByRole('button', { name: 'Simpan' }).click();
   await expect(page.getByRole('cell', { name: `Gudang ${kota}` })).toBeVisible();
});

test('B3-E1 wizard keeps choices after an error and explains tables it cannot build on', async ({ page }) => {
   await page.goto('/builder/login');
   await page.getByLabel('Workspace').fill(E2E.ws);
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await page.goto('/builder/apps/new');
   await expect(page.getByText('Report saja').first()).toBeVisible();   // jabatan: composite key without a default
   await page.getByRole('checkbox', { name: 'karyawan' }).check();
   await page.getByLabel('Alias').fill('emp');                          // taken by the example app
   await page.getByLabel('Nama aplikasi').fill('Bentrok');
   await page.getByRole('button', { name: 'Buat aplikasi' }).click();
   await expect(page.getByRole('alert')).toContainText('sudah dipakai');
   await expect(page.getByRole('alert')).toBeFocused();
   await expect(page.getByRole('checkbox', { name: 'karyawan' })).toBeChecked();
   expect(await axe(page)).toEqual([]);
});
