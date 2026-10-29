import { defineConfig, devices } from '@playwright/test';

// Browser tests against the dev server (it exposes window.__editor for checking the drawing).
// CI installs Playwright's Chromium; locally the installed Google Chrome is used.
const PORT = 5199;
const chrome = process.env.CI ? {} : { channel: 'chrome' as const };
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}/grid-icon/`, ...chrome },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...chrome }, testIgnore: /phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'], ...chrome }, testMatch: /phone/ },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/grid-icon/`,
    reuseExistingServer: !process.env.CI,
  },
});
