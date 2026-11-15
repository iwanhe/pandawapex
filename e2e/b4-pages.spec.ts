import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { axe, expect, test } from './fixtures.ts';
import { E2E } from './env.ts';

// B4 / flow F02 in the browser: add pages to an application from its home page (recon F02: about 6 actions).
const SHOTS = join(import.meta.dirname, '../replica/clone-screens');
mkdirSync(SHOTS, { recursive: true });
type Page = import('@playwright/test').Page;
const shot = (page: Page, id: string, project: string) =>
   page.screenshot({ path: join(SHOTS, `${id}-${project === 'mobile' ? 390 : 1440}.png`), fullPage: true });

async function devLogin(page: Page) {
   await page.goto('/builder/login');
   await page.getByLabel('Workspace').fill(E2E.ws);
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await expect(page.getByRole('heading', { name: `Workspace ${E2E.ws}`, level: 1 })).toBeVisible();
}

test('B4-H1 F02: add a report + form page and a SQL report to an application', async ({ page }, info) => {
   const project = info.project.name;
   const name = `Halaman ${project} ${Date.now().toString(36)}`;
   await devLogin(page);
   // an empty application to add pages to
   await page.goto('/builder/apps/new');
   await page.getByLabel('Nama aplikasi').fill(name);
   await page.getByRole('button', { name: 'Buat aplikasi' }).click();
   await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

   let actions = 0;
   const act = async (step: Promise<unknown>) => { await step; actions++; };
   await act(page.getByRole('link', { name: 'Tambah halaman' }).click());
   await expect(page.getByRole('heading', { name: 'Tambah halaman', level: 1 })).toBeVisible();
   await expect(page.getByRole('textbox', { name: 'Nomor halaman' })).toHaveValue('2');
   await expect(page.getByRole('radio', { name: 'Report + form', exact: true })).toBeChecked();
   await expect(page.getByRole('textbox', { name: 'Query SQL' })).toBeHidden();            // only for a report from SQL
   expect(await axe(page)).toEqual([]);
   await act(page.getByLabel(/^Tabel di skema/).selectOption('departemen'));
   await shot(page, 'S07', project);
   await act(page.getByRole('button', { name: 'Tambah halaman' }).click());
   await expect(page.getByRole('status').filter({ hasText: 'Halaman 2 dan 3 (Departemen) ditambahkan.' })).toBeVisible();
   expect(actions).toBeLessThanOrEqual(6);
   await expect(page.getByRole('heading', { name: 'Halaman (3)' })).toBeVisible();

   // a report from SQL, with an error first
   await page.getByRole('link', { name: 'Tambah halaman' }).click();
   await page.getByRole('radio', { name: 'Report', exact: true }).check();
   await page.getByRole('radio', { name: 'Query SQL', exact: true }).check();
   await expect(page.getByLabel(/^Tabel di skema/)).toBeHidden();
   await page.getByLabel('Nama halaman').fill('Lokasi');
   await page.getByRole('textbox', { name: 'Query SQL' }).fill('select lokasi, count(*) jumlah from departemen group by lokasii');
   await page.getByRole('button', { name: 'Tambah halaman' }).click();
   await expect(page.getByRole('alert')).toContainText('Query tidak bisa dijalankan');
   await expect(page.getByRole('alert')).toBeFocused();
   await expect(page.getByRole('textbox', { name: 'Query SQL' })).toBeVisible();          // the choice survives the round trip
   expect(await axe(page)).toEqual([]);
   await page.getByRole('textbox', { name: 'Query SQL' }).fill('select lokasi, count(*) jumlah from departemen group by lokasi');
   await page.getByRole('button', { name: 'Tambah halaman' }).click();
   await expect(page.getByRole('status').filter({ hasText: 'Halaman 4 (Lokasi) ditambahkan.' })).toBeVisible();

   // run the new report
   await page.getByRole('link', { name: 'Jalankan halaman 2' }).click();
   await page.getByLabel('Nama pengguna').fill(E2E.user);
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk' }).click();
   await expect(page.getByRole('heading', { name: 'Departemen', level: 1 })).toBeVisible();
   await expect(page.locator('#r-nav a', { hasText: 'Lokasi' })).toHaveCount(1);   // menu entry (the drawer is closed on mobile)
});
