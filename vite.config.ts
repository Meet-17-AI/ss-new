import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Point the dev server at an already-deployed API instead of a local one, so the
    // UI can be worked on without booting a backend (whose startup crons send real
    // client emails). Defaults to the local backend.
    const apiTarget = env.VITE_API_TARGET || 'http://localhost:3002';
    const crmTarget = env.VITE_CRM_TARGET || 'http://localhost:3003';
    return {
      server: {
        port: 3004,
        host: '0.0.0.0',
        proxy: {
          '/api/crm': {
            target: crmTarget,
            changeOrigin: true,
          },
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
