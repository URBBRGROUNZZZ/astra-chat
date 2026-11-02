import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHROME_CHANNEL } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.PLAYWRIGHT_CHROME_CHANNEL } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: { command: 'npm run dev -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
