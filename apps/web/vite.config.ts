import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Agentendorf',
        short_name: 'Dorf',
        description: 'Leifs Agenten-Zentrale',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4efe4',
        theme_color: '#35624a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // API-Antworten werden nie zwischengespeichert – der Server ist die einzige Quelle der Wahrheit.
        runtimeCaching: [],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', ws: true, changeOrigin: false } },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 2000 },
});
