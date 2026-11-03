import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuracao do Vite para o frontend do aplicativo desktop isolado.
// A porta fixa e o clearScreen desligado seguem as recomendacoes do Tauri 2.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Tauri espera uma porta fixa e falha se ela nao estiver disponivel.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // O nucleo Rust e observado pelo proprio Tauri, nao pelo Vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  // Produz artefatos previsiveis para o empacotamento do Tauri.
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
