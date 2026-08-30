import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],

  build: {
    outDir: path.resolve(__dirname, 'dist'),  // → frontend/dist (served by Express)
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core — always small initial bundle
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          // Chart.js — heavy, lazy-loaded after initial paint
          if (id.includes('node_modules/chart.js') || id.includes('node_modules/react-chartjs')) {
            return 'vendor-charts';
          }
          // XLSX / Excel parsing — only needed for upload flow
          if (id.includes('node_modules/xlsx') || id.includes('node_modules/exceljs')) {
            return 'vendor-xlsx';
          }
          // All other node_modules — shared vendor chunk
          if (id.includes('node_modules/')) {
            return 'vendor-misc';
          }
        },
      },
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

