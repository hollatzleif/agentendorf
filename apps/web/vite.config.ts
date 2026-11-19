import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // E179: Bauzeit der Seite (Einstellungen zeigen sie neben dem Dorf-Stand)
  define: { __BAU_ZEIT__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // E179: registriert wird in src/aktualisierung.ts (mit Prüfen, Hinweis und Neuladen nur im Hintergrund)
      injectRegister: false,
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
        // Langes Drücken auf das App-Symbol (Android/Desktop): direkt dorthin
        shortcuts: [
          { name: 'Heute', short_name: 'Heute', url: '/heute', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'To-dos', short_name: 'To-dos', url: '/gebaeude/Marktplatz?reiter=todo', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Kalender', short_name: 'Kalender', url: '/gebaeude/Marktplatz?reiter=kalender', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Notizen', short_name: 'Notizen', url: '/gebaeude/Rathaus?reiter=notizen', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // E179: neue Fassung übernimmt sofort auch offene Seiten → controllerchange → Hinweis/Neuladen
        clientsClaim: true,
        skipWaiting: true,
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
