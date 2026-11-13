// F08 (part built so far): re-importing an app spec while users are signed in.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, login, APP } from './fixtures.ts';
import { E2E } from './env.ts';

const ROOT = join(import.meta.dirname, '..');

test('F08-H1 a new app version goes live without logging users out', async ({ page }) => {
   await login(page);
   await expect(page.getByRole('heading', { level: 1, name: 'Karyawan' })).toBeVisible();
   const spec = readFileSync(join(ROOT, 'examples/emp/app.yaml'), 'utf8')
      .replace(/parsing_schema: \w+/, `parsing_schema: ${E2E.schema}`)
      .replace('name: Karyawan\n', 'name: Karyawan\n    title: Daftar Karyawan Aktif\n');
   const file = join(mkdtempSync(join(tmpdir(), 'rpx-')), 'app.yaml');
   writeFileSync(file, spec);
   const env = { ...process.env, DATABASE_URL: E2E.dbUrl };
   try {
      execFileSync(process.execPath, [join(ROOT, 'src/cli/rpx.ts'), 'app', 'import', file, '--ws', E2E.ws], { env, stdio: 'pipe' });
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Daftar Karyawan Aktif' })).toBeVisible();
      await expect(page).toHaveURL(`${APP}/1`);                          // still signed in
   } finally {
      // put the original back for the other specs
      writeFileSync(file, readFileSync(join(ROOT, 'examples/emp/app.yaml'), 'utf8').replace(/parsing_schema: \w+/, `parsing_schema: ${E2E.schema}`));
      execFileSync(process.execPath, [join(ROOT, 'src/cli/rpx.ts'), 'app', 'import', file, '--ws', E2E.ws], { env, stdio: 'pipe' });
   }
});
