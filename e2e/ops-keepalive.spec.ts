import { APP, expect, login, test } from './fixtures.ts';
import { E2E } from './env.ts';

// Keep-alive (rpx.js): working in a page keeps the session from idling out; a tab that is merely open does not.
type Page = import('@playwright/test').Page;

function pings(page: Page) {
   const seen: number[] = [];
   page.on('response', r => { if (new URL(r.url()).pathname.endsWith('/keepalive')) seen.push(r.status()); });
   return seen;
}

test('builder: typing pings /builder/keepalive at the next 5-minute tick; an idle tab stays quiet', async ({ page }) => {
   await page.clock.install();
   await page.goto('/builder/login');
   await page.getByLabel('Workspace').fill(E2E.ws);
   await page.getByLabel('Nama pengguna').fill('admin');
   await page.getByLabel('Kata sandi').fill(E2E.password);
   await page.getByRole('button', { name: 'Masuk', exact: true }).click();
   await page.goto('/builder/apps');
   const seen = pings(page);

   await page.clock.fastForward('11:00');                      // two ticks without touching the page
   expect(seen).toEqual([]);

   await page.getByRole('searchbox', { name: 'Cari aplikasi' }).fill('sedang mengetik');
   const pong = page.waitForResponse(r => new URL(r.url()).pathname === '/builder/keepalive');
   await page.clock.fastForward('05:00');
   expect((await pong).status()).toBe(204);

   await page.clock.fastForward('05:00');                      // no new activity: no new ping
   expect(seen).toEqual([204]);
});

test('application: typing in a form keeps the session; once the session is gone the page stops asking', async ({ page, db }) => {
   await page.clock.install();
   await login(page);
   await page.goto(`${APP}/3`);                                // "Tentang aplikasi": a plain page of the same application
   const seen = pings(page);

   await page.keyboard.press('Tab');                           // any key press counts as activity
   const pong = page.waitForResponse(r => new URL(r.url()).pathname === `${APP}/keepalive`);
   await page.clock.fastForward('05:00');
   expect((await pong).status()).toBe(204);

   const cookies = await page.context().cookies();
   const sid = cookies.find(c => c.name === `rpx_${E2E.ws}_emp`)!.value;
   await db.query('delete from rpx.sessions where id = $1', [sid]);
   await page.keyboard.press('Tab');
   const gone = page.waitForResponse(r => new URL(r.url()).pathname === `${APP}/keepalive`);
   await page.clock.fastForward('05:00');
   expect((await gone).status()).toBe(401);

   await page.keyboard.press('Tab');
   await page.clock.fastForward('10:00');
   expect(seen).toEqual([204, 401]);                           // stopped after the 401
});

test('the login page does not ping', async ({ page }) => {
   await page.clock.install();
   await page.goto(`${APP}/login`);
   const seen = pings(page);
   await page.getByLabel('Nama pengguna').fill('seseorang');
   await page.clock.fastForward('06:00');
   expect(seen).toEqual([]);
});
