import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/env.ts';

// Use the system Chrome when present (CI images and this sandbox), else Playwright's own Chromium.
const chrome = process.env.PW_CHROME ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

export default defineConfig({
   testDir: 'e2e',
   fullyParallel: false,
   workers: 1,                         // one shared database; tests are written to be order-independent
   retries: 0,
   reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
   use: {
      baseURL: `http://localhost:${E2E.port}`,
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      launchOptions: chrome ? { executablePath: chrome, args: ['--no-sandbox'] } : {},
   },
   projects: [
      { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
      { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
   ],
   webServer: {
      command: 'node e2e/serve.ts',
      url: `http://localhost:${E2E.port}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
   },
});
