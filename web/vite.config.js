import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  // Build straight into the server so a single Express process serves the app.
  // server/public is committed (git-ignore only excludes `dist/`), so a deploy
  // is just `git pull` + pm2 restart — no build step on the server.
  build: {
    outDir: path.resolve(__dirname, '../server/public'),
    emptyOutDir: true,
  },
  server: {
    // Bind to all interfaces so other devices on the LAN can reach the app
    // at http://192.168.68.58:5173 (whatever the host machine's LAN IP is).
    host: true,
    port: 5173,
    // Also let Vite share LAN-served WebSocket HMR with those clients.
    strictPort: true,
    // Vite blocks non-IP/localhost Host headers by default. We access the app
    // via a *.nip.io hostname (required for Google Sign-In, which rejects raw
    // IPs). The leading dot allows any subdomain — e.g. 192.168.68.11.nip.io
    // and 192.168.0.133.nip.io — so this keeps working across IP changes.
    allowedHosts: ['.nip.io'],
    // Dev only — the API server runs on 1215 (same port it serves the built
    // app on in production).
    proxy: { '/api': 'http://localhost:1215' },
  },
});
