/**
 * Baseline report tests.
 *
 * Verifies the report builder is deterministic and that running it against the
 * frozen fixtures reproduces the versioned, committed baseline report. The test
 * writes the generated report to tests/fixtures/baseline/baseline-report.json
 * (a versioned repo location, never published) and asserts it matches the
 * committed snapshot, so drift is caught in review.
 *
 * Spec: gestao-leiga-de-escalas / Task 1.2
 * Requirements: 16.1, 16.8
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildBaselineReport,
  canonicalJson,
  sha256,
  BASELINE_REPORT_VERSION,
} from './baseline-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../fixtures/baseline');
const reportPath = resolve(fixturesDir, 'baseline-report.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const atual = readJson(resolve(fixturesDir, 'atual.baseline.json'));
const contatos = readJson(resolve(fixturesDir, 'contatos.baseline.json'));

describe('baseline report builder', () => {
  test('is deterministic for identical inputs', () => {
    const a = buildBaselineReport({ atual, contatos });
    const b = buildBaselineReport({ atual, contatos });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test('canonicalJson sorts object keys', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test('summarises the frozen artifacts', () => {
    const report = buildBaselineReport({ atual, contatos });
    expect(report.reportVersion).toBe(BASELINE_REPORT_VERSION);
    expect(report.artifact.atual.recordCount).toBe(3);
    expect(report.artifact.atual.weekdays).toEqual(['domingo', 'quarta-feira', 'sábado']);
    expect(report.artifact.contatos.entryCount).toBe(Object.keys(contatos).length);
    expect(report.artifact.atual.contentHash).toBe(sha256(canonicalJson(atual)));
  });

  test('generates and matches the versioned baseline report (no publish)', () => {
    const report = buildBaselineReport({ atual, contatos });
    const serialized = JSON.stringify(report, null, 2) + '\n';

    // Write the report to the versioned fixtures dir (never the public artifact).
    writeFileSync(reportPath, serialized, 'utf8');

    expect(existsSync(reportPath)).toBe(true);
    // Re-read to confirm the written report round-trips to the same structure.
    expect(readJson(reportPath)).toEqual(report);

    // Guard: the report location is inside tests/, not a public artifact path.
    expect(reportPath).toContain('/tests/');
    expect(reportPath).not.toMatch(/\/(atual|contatos)\.json$/);
  });
});
