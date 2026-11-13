// F07 (part built so far): signing in with the organisation's IdP. Uses the local mock IdP started by serve.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, axe, SSO_APP } from './fixtures.ts';

const issuer = () => JSON.parse(readFileSync(join(import.meta.dirname, '.state.json'), 'utf8')).issuer as string;
async function nextUser(u: object) {
   await fetch(`${issuer()}/__next_user`, { method: 'POST', body: JSON.stringify(u) });
}

test.describe('F07 SSO sign-in', () => {
   test('F07-H1 SSO button signs in through the IdP and lands on the requested page', async ({ page, db }) => {
      await nextUser({ sub: 'e2e-sso-1', email: 'sri.wahyuni@kcsi.co.id', preferred_username: 'sri.wahyuni@kcsi.co.id', groups: ['Gudang'] });
      await page.goto(`${SSO_APP}/3`);
      await expect(page.getByLabel('Kata sandi')).toHaveCount(0);           // SSO-only app: no password form
      expect(await axe(page), 'sso login a11y').toEqual([]);
      await page.getByRole('link', { name: 'Masuk dengan akun KCSI' }).click();
      await expect(page).toHaveURL(`${SSO_APP}/3`);
      await expect(page.getByText(/Anda masuk sebagai sri\.wahyuni@kcsi\.co\.id sejak/)).toBeVisible();
      const u = await db.query(`select groups from rpx.app_users where oidc_subject = 'e2e-sso-1'`);
      expect(u.rows[0].groups).toEqual(['Gudang']);
   });

   test('F07-N1 an account from another domain is refused', async ({ page }) => {
      await nextUser({ sub: 'e2e-sso-x', email: 'tamu@contoh.com', preferred_username: 'tamu@contoh.com' });
      await page.goto(`${SSO_APP}/1`);
      await page.getByRole('link', { name: 'Masuk dengan akun KCSI' }).click();
      await expect(page.getByRole('alert')).toContainText('tidak diizinkan');
   });
});
