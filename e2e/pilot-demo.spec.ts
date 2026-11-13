import { axe, expect, login, test } from './fixtures.ts';
import { E2E } from './env.ts';

// Pilot "Demo Permintaan Barang" (ported from APEX): the whole approval loop in the browser, through dialogs.
const DEMO = '/r/pilot/demo';

test.describe('PILOT DEMO Permintaan Barang', () => {
   test('PILOT-H1 request -> lines -> submit (requester) -> approve (manager), axe on every screen', async ({ browser, db }) => {
      const purpose = `ATK e2e ${Date.now().toString(36)}`;
      const budi = await (await browser.newContext()).newPage();
      await login(budi, 'budi', E2E.password, `${DEMO}/300`);
      await expect(budi.getByRole('heading', { name: 'Permintaan Barang', level: 1 })).toBeVisible();
      expect(await axe(budi)).toEqual([]);

      // header in the modal dialog
      await budi.getByRole('link', { name: 'Create' }).click();
      const form = budi.frameLocator('dialog iframe');
      await form.getByLabel('Department').selectOption({ label: 'OPS - Operations' });
      await form.getByLabel('Keperluan').fill(purpose);
      await form.getByRole('button', { name: 'Create' }).click();
      await expect(budi.locator('dialog[open]')).toHaveCount(0);
      const req = (await db.query(`select request_id, request_no from apx_demo.apx_demo_requests where purpose = $1`, [purpose])).rows[0];
      expect(req.request_no).toMatch(/^REQ-\d{4}-\d{4}$/);

      // one line, from the master-detail page
      await budi.goto(`${DEMO}/302`);
      await budi.getByRole('link', { name: req.request_no }).click();
      await budi.getByRole('link', { name: 'Tambah baris' }).click();
      const line = budi.frameLocator('dialog iframe');
      await line.getByLabel('Item').selectOption({ label: 'ATK-001 - Kertas A4 80gsm (RIM)' });
      await line.getByLabel('Qty').fill('4');
      await line.getByLabel('Harga Satuan').fill('55000');
      expect(await axe(budi)).toEqual([]);
      await line.getByRole('button', { name: 'Create' }).click();
      await expect(budi.locator('dialog[open]')).toHaveCount(0);
      await expect(budi.locator('#lines').getByRole('cell', { name: '220.000' })).toBeVisible();

      // submit for approval (confirm dialog)
      budi.on('dialog', d => d.accept());
      await budi.getByRole('link', { name: 'Edit' }).click();
      await budi.frameLocator('dialog iframe').getByRole('button', { name: 'Submit for Approval' }).click();
      await expect(budi.locator('dialog[open]')).toHaveCount(0);
      await expect(budi.locator('#header').getByRole('cell', { name: 'SUBMITTED' })).toBeVisible();

      // manager approves from the inbox
      const sari = await (await browser.newContext()).newPage();
      await login(sari, 'sari', E2E.password, `${DEMO}/190`);
      expect(await axe(sari)).toEqual([]);
      await sari.getByRole('link', { name: req.request_no }).click();
      const appr = sari.frameLocator('dialog iframe');
      await appr.getByLabel(/Catatan/).fill('Disetujui');
      await appr.getByRole('button', { name: 'Approve' }).click();
      await expect(sari.locator('dialog[open]')).toHaveCount(0);
      await expect(sari.getByRole('status')).toContainText('Dokumen disetujui.');
      const st = (await db.query(`select status from apx_demo.apx_demo_requests where request_id = $1`, [req.request_id])).rows[0].status;
      expect(st).toBe('APPROVED');   // 220.000 is below the 10 jt limit: no director step
   });

   test('PILOT-H2 home with charts passes axe; administration is hidden from a requester', async ({ page }) => {
      await login(page, 'admin', E2E.password, `${DEMO}/100`);
      await expect(page.getByRole('img', { name: /Permintaan per Status/ })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Nilai per Department' })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await page.getByText('Tampilkan sebagai tabel').first().click();
      await expect(page.getByRole('table').nth(1)).toBeVisible();
      await page.getByRole('button', { name: 'Keluar' }).click();
      await login(page, 'budi', E2E.password, `${DEMO}/100`);
      await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);
   });
});
