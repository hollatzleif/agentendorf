import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3999);
// In der Cloud-Umgebung liegt ein vorinstalliertes Chromium hier; in CI installiert Playwright sein eigenes.
const chromiumPfad = process.env.PW_CHROMIUM ?? (process.env.CI ? undefined : '/opt/pw-browsers/chromium');
// WebGL ohne Grafikkarte (Software-Rendering) – fürs 3D-Dorf
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const start = { args, ...(chromiumPfad ? { executablePath: chromiumPfad } : {}) };

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: start,
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: start } },
    { name: 'handy', use: { ...devices['Pixel 7'], launchOptions: start } },
  ],
  webServer: {
    command: 'bash e2e/server-starten.sh',
    url: `http://127.0.0.1:${PORT}/api/gesundheit`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
