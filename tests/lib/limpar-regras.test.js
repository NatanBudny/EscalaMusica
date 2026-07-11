/**
 * Tests for scripts/limpar-regras.js
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');
const SCRIPT = resolve(ROOT, 'scripts', 'manutencao', 'limpar-regras.js');

describe('limpar-regras.js', () => {
  const inputPath = resolve(ROOT, 'processos', 'regras', 'regras.snapshot.json');

  test('removes restricoes_pessoais and keeps other sections', () => {
    const outputPath = resolve(tmpdir(), `limpar-regras-test-${Date.now()}.json`);

    try {
      execSync(`node "${SCRIPT}" --output="${outputPath}"`, { cwd: ROOT, encoding: 'utf-8' });

      const result = JSON.parse(readFileSync(outputPath, 'utf-8'));

      // restricoes_pessoais must be gone
      expect(result).not.toHaveProperty('restricoes_pessoais');

      // Required sections must be preserved
      expect(result).toHaveProperty('versao');
      expect(result).toHaveProperty('ultima_atualizacao');
      expect(result).toHaveProperty('papeis');
      expect(result).toHaveProperty('regras_fundamentais');
      expect(result).toHaveProperty('preferencias');
      expect(result).toHaveProperty('times');
      expect(result).toHaveProperty('features_futuras');
      expect(result).toHaveProperty('glossario');

      // Verify data integrity - sections match original
      const original = JSON.parse(readFileSync(inputPath, 'utf-8'));
      expect(result.regras_fundamentais).toEqual(original.regras_fundamentais);
      expect(result.preferencias).toEqual(original.preferencias);
      expect(result.papeis).toEqual(original.papeis);
      expect(result.glossario).toEqual(original.glossario);
      expect(result.features_futuras).toEqual(original.features_futuras);
    } finally {
      try { rmSync(outputPath); } catch {}
    }
  });

  test('prints confirmation message on success', () => {
    const outputPath = resolve(tmpdir(), `limpar-regras-msg-${Date.now()}.json`);

    try {
      const stdout = execSync(`node "${SCRIPT}" --output="${outputPath}"`, {
        cwd: ROOT,
        encoding: 'utf-8',
      });

      expect(stdout).toContain('restricoes_pessoais');
      expect(stdout).toContain('removida com sucesso');
      expect(stdout).toContain('Concluído');
    } finally {
      try { rmSync(outputPath); } catch {}
    }
  });

  test('output is valid JSON with trailing newline', () => {
    const outputPath = resolve(tmpdir(), `limpar-regras-json-${Date.now()}.json`);

    try {
      execSync(`node "${SCRIPT}" --output="${outputPath}"`, { cwd: ROOT, encoding: 'utf-8' });

      const raw = readFileSync(outputPath, 'utf-8');
      expect(raw.endsWith('\n')).toBe(true);
      expect(() => JSON.parse(raw)).not.toThrow();
    } finally {
      try { rmSync(outputPath); } catch {}
    }
  });
});
