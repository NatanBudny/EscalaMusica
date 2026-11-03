import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Raiz do repositorio (um nivel acima de desktop-app). O teste de contrato do
// visualizador (tarefa 9.8) importa, SOMENTE PARA LEITURA, os modulos reais do
// visualizador legado em `<repo>/src/*.js`. Por padrao o Vite restringe o
// acesso de filesystem a raiz do projeto (desktop-app/), bloqueando esses
// imports. Liberamos explicitamente a raiz do repositorio para que o teste
// exercite os modulos legados sem copia-los. Nenhum artefato publico vigente e
// gravado: o teste apenas le os modulos e materializa o candidato em tmp.
const repoRoot = resolve(__dirname, '..');

// Teste de execucao unica por padrao (vitest run no script "test").
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Permite que o Vitest leia os modulos do visualizador legado na raiz do
      // repositorio (necessario para o teste de contrato 9.8).
      allow: [repoRoot],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
