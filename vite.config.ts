import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Point the dev server at an already-deployed API instead of a local one, so the
    // UI can be worked on without booting a backend (whose startup crons send real
    // client emails). Defaults to the local backend.
    const apiTarget = env.VITE_API_TARGET || 'http://localhost:3002';
    return {
      server: {
        port: 5173,
        host: '0.0.0.0',
        proxy: {
          // Note: this prefix also covers /api/crm/todo and /api/crm-audit-logs,
          // which used to be routed to a separate backend on :3003. That backend
          // was a stale fork and is gone; panel-backend serves both, as it already
          // does in production.
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
