import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],

  server: {
    port: 5173,

    proxy: {
      "/api": {
        target: "https://qbr-dashboard-backend.onrender.com",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

