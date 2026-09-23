import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// FastAPI(8000) を /api にプロキシする。
// これで Stage を OBS のブラウザソースから開いても同一オリジンで API を叩ける。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // /api/bus は WebSocket。Editor <-> Stage の中継に使う。
        ws: true,
      },
    },
  },
});
