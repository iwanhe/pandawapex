import { expect, test } from './fixtures.ts';
import { E2E } from './env.ts';

// Fase 2 full pass: builder edge cases that need a real browser (keyboard only, Back after logout, two tabs).
type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

/** Press Tab until the element has focus (keyboard only, no clicks). */
async function tabTo(page: Page, target: Locator, max = 80) {
   for (let i = 0; i < max; i++) {
      if (await target.evaluate(el => el === document.activeElement).catch(() => false)) return;
      await page.keyboard.press('Tab');
   }
   throw new Error(`not reachable with Tab: ${target}`);
}

async function devLogin(page: Page) {
   await page.goto('/builder/login');
   await page.getByLabel('Workspace').fill(E2E.ws);
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await expect(page.getByRole('heading', { name: `Workspace ${E2E.ws}`, level: 1 })).toBeVisible();
}

test('F01-E1 / F03-E1 keyboard only: create an app with the wizard and change a label in the Page Designer', async ({ page }, info) => {
   const name = `Papan ketik ${info.project.name} ${Date.now().toString(36)}`;
   await page.goto('/builder/login');
   await tabTo(page, page.getByLabel('Workspace'));
   await page.keyboard.type(E2E.ws);
   await tabTo(page, page.getByLabel('Nama pengguna'));
   await page.keyboard.type('admin');
   await tabTo(page, page.getByLabel('Kata sandi'));
   await page.keyboard.type(E2E.password);
   await page.keyboard.press('Enter');
   await expect(page.getByRole('heading', { name: `Workspace ${E2E.ws}`, level: 1 })).toBeVisible();

   await tabTo(page, page.getByRole('main').getByRole('link', { name: 'Buat aplikasi' }).first());
   await page.keyboard.press('Enter');
   await expect(page.getByRole('heading', { name: 'Buat aplikasi', level: 1 })).toBeVisible();
   await expect(page.getByLabel('Nama aplikasi')).toBeFocused();       // autofocus
   await page.keyboard.type(name);
   await tabTo(page, page.getByRole('checkbox', { name: 'departemen' }));
   await page.keyboard.press('Space');
   await tabTo(page, page.getByRole('button', { name: 'Buat aplikasi' }));
   await page.keyboard.press('Enter');
   await expect(page.getByRole('status').filter({ hasText: `Aplikasi ${name} dibuat` })).toBeVisible();

   await tabTo(page, page.getByRole('link', { name: /^Ubah halaman 2/ }));
   await page.keyboard.press('Enter');
   await expect(page.getByRole('heading', { name: 'Halaman 2: Form departemen', level: 1 })).toBeVisible();
   await tabTo(page, page.getByRole('link', { name: /Item P2_LOKASI/ }));
   await page.keyboard.press('Enter');
   const label = page.getByRole('textbox', { name: /^Label/ });
   await expect(label).toHaveValue('Lokasi');
   await tabTo(page, label);
   await page.keyboard.press('ControlOrMeta+A');
   await page.keyboard.type('Kota');
   await page.keyboard.press('Enter');                                   // submits the property form
   await expect(page.getByRole('status').filter({ hasText: 'Item P2_LOKASI disimpan.' })).toBeVisible();
   await expect(label).toHaveValue('Kota');
});

test('B1-E8 Back after logout does not show builder data again', async ({ page }) => {
   await devLogin(page);
   await page.goto('/builder/apps');
   await expect(page.getByRole('heading', { name: 'Aplikasi', level: 1 })).toBeVisible();
   await page.goto('/builder');
   const menu = page.getByRole('button', { name: /Menu/ });
   if (await menu.isVisible()) await menu.click();
   await page.getByRole('button', { name: 'Keluar' }).click();
   await expect(page.getByLabel('Workspace')).toBeVisible();
   await page.goBack();
   await expect(page.getByLabel('Workspace')).toBeVisible();
   await expect(page.getByRole('heading', { name: 'Aplikasi', level: 1 })).toHaveCount(0);
});

test('F03-E2 two tabs: the second save is refused, keeps what was typed, a second save overwrites on purpose', async ({ page, context }, info) => {
   const name = `Dua tab ${info.project.name} ${Date.now().toString(36)}`;
   await devLogin(page);
   await page.goto('/builder/apps/new');
   await page.getByLabel('Nama aplikasi').fill(name);
   await page.getByRole('checkbox', { name: 'departemen' }).check();
   await page.getByRole('button', { name: 'Buat aplikasi' }).click();
   await page.getByRole('link', { name: /^Ubah halaman 2/ }).click();
   await page.getByRole('link', { name: /Item P2_LOKASI/ }).click();
   const url = page.url();

   const other = await context.newPage();
   await other.goto(url);
   await other.getByRole('textbox', { name: /^Label/ }).fill('Dari tab dua');
   await other.getByRole('button', { name: 'Simpan' }).click();
   await expect(other.getByRole('status').filter({ hasText: 'disimpan' })).toBeVisible();

   await page.getByRole('textbox', { name: /^Label/ }).fill('Dari tab satu');
   await page.getByRole('button', { name: 'Simpan' }).click();
   const warning = page.getByRole('status').filter({ hasText: 'Aplikasi sudah diubah di tab lain' });
   await expect(warning).toBeVisible();
   await expect(warning).toBeFocused();
   await expect(page.getByRole('textbox', { name: /^Label/ })).toHaveValue('Dari tab satu');
   // saving again is a deliberate overwrite of the newer version
   await page.getByRole('button', { name: 'Simpan' }).click();
   await expect(page.getByRole('status').filter({ hasText: 'Item P2_LOKASI disimpan.' })).toBeVisible();
   await other.close();
});
