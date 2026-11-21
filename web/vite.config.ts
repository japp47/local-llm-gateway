// The web chat page. `npm run build:web` writes it to dist/web/, which the gateway serves.
// `npm run dev:web` serves it with live reload on :5173 and passes API calls to the gateway
// on :3000, keeping the browser's Host and Origin so the gateway's checks behave as in
// production (changeOrigin: false).
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const gateway = { target: 'http://localhost:3000', changeOrigin: false };

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // The gateway's Content-Security-Policy allows only same-origin files: no inline code.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
  server: { port: 5173, proxy: { '/v1': gateway, '/web/session': gateway } },
});
