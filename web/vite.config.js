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
  server: {
    // Bind to all interfaces so other devices on the LAN can reach the app
    // at http://192.168.68.58:5173 (whatever the host machine's LAN IP is).
    host: true,
    port: 5173,
    // Also let Vite share LAN-served WebSocket HMR with those clients.
    strictPort: true,
    proxy: { '/api': 'http://localhost:4041' },
  },
});
