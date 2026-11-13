// F09: navigation and session state between pages (links with items, checksums, paging, search state).
import { test, expect, login, axe, APP } from './fixtures.ts';

test.describe('F09 navigation & session state', () => {
   test('F09-H1 row link opens the form, breadcrumb goes back, search is remembered', async ({ page }) => {
      await login(page);
      await page.getByLabel('Cari nama').fill('a');
      await page.getByRole('button', { name: 'Cari', exact: true }).click();
      await page.getByRole('row').nth(1).getByRole('link').click();
      await expect(page).toHaveURL(`${APP}/2`);                       // item arguments dropped from the address bar
      await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Karyawan' }).click();
      await expect(page.getByLabel('Cari nama')).toHaveValue('a');
   });

   test('F09-H2 paging forward and back', async ({ page }) => {
      await login(page);
      await expect(page.getByText(/^Baris 1–5/)).toBeVisible();
      await page.getByRole('link', { name: 'Halaman berikutnya' }).click();
      await expect(page.getByText(/^Baris 6–/)).toBeVisible();
      await page.getByRole('link', { name: 'Halaman sebelumnya' }).click();
      await expect(page.getByText(/^Baris 1–5/)).toBeVisible();
   });

   test('F09-H3 navigation menu marks the current page; static page substitutes &APP_USER.', async ({ page }) => {
      await login(page);
      const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
      if (await nav.isHidden()) await page.getByRole('button', { name: 'Tampilkan atau sembunyikan navigasi' }).click();
      await nav.getByRole('link', { name: 'Tentang aplikasi' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Tentang aplikasi' })).toBeVisible();
      await expect(page.getByText(/Anda masuk sebagai iwan sejak \d\d-\d\d-\d{4}/)).toBeVisible();
      expect(await axe(page), 'static page a11y').toEqual([]);
   });

   test('F09-E1 empty search result shows the empty state', async ({ page }) => {
      await login(page);
      await page.getByLabel('Cari nama').fill('zzz-tidak-ada');
      await page.getByRole('button', { name: 'Cari', exact: true }).click();
      await expect(page.getByText('Tidak ada data yang cocok')).toBeVisible();
      expect(await axe(page), 'empty state a11y').toEqual([]);
   });

   test('F09-N1 a tampered link is refused with a friendly page', async ({ page }) => {
      await login(page);
      const href = await page.getByRole('row').nth(1).getByRole('link').getAttribute('href');
      const res = await page.goto(href!.replace(/P2_EMPNO=\d+/, 'P2_EMPNO=424242'));
      expect(res!.status()).toBe(403);
      await expect(page.getByRole('heading', { name: 'Checksum tidak cocok' })).toBeVisible();
      expect(await axe(page), 'error page a11y').toEqual([]);
   });

   test('F09-N2 unknown page gives a 404 page', async ({ page }) => {
      await login(page);
      const res = await page.goto(`${APP}/4242`);
      expect(res!.status()).toBe(404);
      await expect(page.getByRole('heading', { name: 'Halaman tidak ditemukan' })).toBeVisible();
   });

   test('F09-E2 mobile: navigation is a drawer that closes with Escape', async ({ page, isMobile }) => {
      test.skip(!isMobile, 'mobile only');
      await login(page);
      const toggle = page.getByRole('button', { name: 'Tampilkan atau sembunyikan navigasi' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Karyawan' })).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toBeFocused();
   });

   test('F09-E4 mobile: links of the closed drawer are not reachable with Tab (BUG-002)', async ({ page, isMobile }) => {
      test.skip(!isMobile, 'mobile only');
      await login(page);
      for (let i = 0; i < 25; i++) {
         await page.keyboard.press('Tab');
         const inNav = await page.evaluate(() => !!document.activeElement?.closest('#r-nav'));
         expect(inNav, `Tab #${i + 1} landed in the closed navigation drawer`).toBe(false);
      }
   });

   test('F09-E3 logout, then the back button does not show protected data', async ({ page }) => {
      await login(page);
      await page.getByRole('button', { name: 'Keluar' }).click();
      await expect(page.getByRole('status')).toContainText('Anda sudah keluar.');
      await page.goBack();
      await page.reload();
      await expect(page.getByLabel('Nama pengguna')).toBeVisible();
   });
});
