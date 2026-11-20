import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * E197: Quelltext-Karten des Editors (Monaco, TypeScript-Worker …) wären über 40 MB im Image – die braucht niemand.
 * Die Karten der eigenen App bleiben.
 */
const editorOhneKarten = () => ({
  name: 'dorf-editor-ohne-karten',
  apply: 'build' as const,
  closeBundle() {
    const ordner = path.resolve(import.meta.dirname, 'dist/assets/editor');
    if (!fs.existsSync(ordner)) return;
    for (const n of fs.readdirSync(ordner)) if (n.endsWith('.map')) fs.rmSync(path.join(ordner, n));
  },
});

export default defineConfig({
  // E179: Bauzeit der Seite (Einstellungen zeigen sie neben dem Dorf-Stand)
  define: { __BAU_ZEIT__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    editorOhneKarten(),
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
        // E197: Editor (Monaco, Sprachen, Worker, xterm) nie vorab laden – nur wer die Editor-Seite öffnet, holt ihn (online)
        globIgnores: ['assets/editor/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', ws: true, changeOrigin: false } },
  },
  // E197: alles, was zum Editor im Codehaus gehört, liegt in assets/editor/ (siehe globIgnores oben)
  worker: { format: 'es', rollupOptions: { output: { entryFileNames: 'assets/editor/[name]-[hash].js', chunkFileNames: 'assets/editor/[name]-[hash].js' } } },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        chunkFileNames: (c) => (c.moduleIds.some((id) => /node_modules\/(monaco-editor|@xterm)\/|\/src\/codeeditor\//.test(id)) ? 'assets/editor/[name]-[hash].js' : 'assets/[name]-[hash].js'),
        assetFileNames: (a) => ((a.names ?? []).some((n) => /codicon|^(CodeEditor|editor)\.css$/.test(n)) ? 'assets/editor/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
});
