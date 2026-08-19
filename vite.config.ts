import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Point the dev server at an already-deployed API instead of a local one, so the
    // UI can be worked on without booting a backend (whose startup crons send real
    // client emails). Defaults to the local backend.
    const apiTarget = env.VITE_API_TARGET || 'http://localhost:3001';
    return {
      server: {
        port: 5173,
        host: '0.0.0.0',
        proxy: {
          // The panel's own API only. The CRM is a SEPARATE application with its
          // own backend (crm-backend, :3003 locally) and its own frontend on
          // :3000 — the switcher leaves this origin to reach it.
          //
          // A previous version of this comment claimed the :3003 backend "was a
          // stale fork and is gone". It is not gone; it is the live production
          // CRM at crm.backend.srv1169280.hstgr.cloud.
          '/api': {
            target: apiTarget,
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
