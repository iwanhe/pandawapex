import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { E2E } from './env.ts';

export const APP = `/r/${E2E.ws}/emp`;
export const SSO_APP = `/r/${E2E.ws}/sso`;

interface Fixtures {
   /** console errors and 5xx responses seen during the test; asserted empty after each test */
   guard: { errors: string[]; allow: (re: RegExp) => void };
   db: pg.Pool;
}

const pool = new pg.Pool({ connectionString: E2E.dbUrl, max: 2 });

export const test = base.extend<Fixtures>({
   guard: [async ({ page }, use) => {
      const errors: string[] = [];
      const allowed: RegExp[] = [];
      page.on('console', m => {
         // the browser logs every 4xx resource as a console error; those statuses are asserted in the tests
         if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`);
      });
      page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
      page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
      await use({ errors, allow: re => allowed.push(re) });
      expect(errors.filter(e => !allowed.some(re => re.test(e))), 'no console errors and no 5xx').toEqual([]);
   }, { auto: true }],
   db: async ({}, use) => { await use(pool); },
});
export { expect };

export async function login(page: Page, user = E2E.user, password = E2E.password, path = `${APP}/1`) {
   await page.goto(path);
   await page.getByLabel('Nama pengguna').fill(user);
   await page.getByLabel('Kata sandi').fill(password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
}

/** Accessibility scan (WCAG 2.x A/AA). Returns violations as "rule: target" strings for readable diffs. */
export async function axe(page: Page): Promise<string[]> {
   const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
   return r.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')}`));
}

export async function empno(db: pg.Pool, nama: string): Promise<number> {
   return (await db.query(`select empno from ${E2E.schema}.karyawan where nama = $1`, [nama])).rows[0]?.empno;
}

/** Search the interactive report (region refresh, no page load). */
export async function searchReport(page: Page, text: string) {
   const box = page.getByLabel('Cari di Daftar karyawan');
   await box.fill(text);
   await Promise.all([
      page.waitForResponse(r => r.url().includes('daftar__q=') ),
      box.press('Enter'),
   ]);
   await expect(page.getByLabel('Cari di Daftar karyawan')).toHaveValue(text);
}

/** Open the edit dialog of an employee from the report; returns the dialog's frame. */
export async function openEmployee(page: Page, nama: string) {
   await page.goto(`${APP}/1`);
   await searchReport(page, nama);
   const row = page.getByRole('row').filter({ hasText: nama });
   await expect(row).toHaveCount(1);
   await row.getByRole('link').first().click();
   return dialogFrame(page);
}

export async function dialogFrame(page: Page) {
   await expect(page.getByRole('dialog', { name: 'Form karyawan' })).toBeVisible();
   const frame = page.frameLocator('dialog iframe');
   await expect(frame.getByLabel('Nama lengkap')).toBeVisible();
   return frame;
}
