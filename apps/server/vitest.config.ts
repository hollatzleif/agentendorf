import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 20000, include: ['test/**/*.test.ts'], globalSetup: ['test/vorbereitung.ts'] } });
