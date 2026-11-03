// Testes baseados em propriedade do BackupService (tarefas 11.8, 11.9, 11.10).
//
// Property 41: Backup detecta qualquer alteracao de conteudo (13.3, 13.4, 13.7)
// Property 42: Backup faz round-trip do estado coberto (13.1, 13.2, 13.5, 13.6, 13.11)
// Property 43: Retencao nunca elimina publicacao oficial (13.9, 13.10)
//
// **Validates: Requirements 13.1-13.11**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { RetentionPolicy } from '../config/model';
import {
  applyRetention,
  createBackup,
  exportBackup,
  importBackup,
  restoreBackup,
  verifyIntegrity,
  type BackupFile,
  type BackupPackage,
} from './backupService';

// --------------------------------------------------------------------------
// Geradores
// --------------------------------------------------------------------------

const safePathSegment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/);

const filePathArb = fc
  .array(safePathSegment, { minLength: 1, maxLength: 3 })
  .map((segs) => segs.join('/') + '.json');

const fileArb: fc.Arbitrary<BackupFile> = fc.record({
  path: filePathArb,
  content: fc.json(),
});

/** Lista de arquivos com paths unicos (o manifesto indexa por path). */
const filesArb = fc
  .array(fileArb, { minLength: 1, maxLength: 6 })
  .map((files) => {
    const seen = new Set<string>();
    return files.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
  })
  .filter((files) => files.length >= 1);

function buildPackage(files: readonly BackupFile[], official: boolean): BackupPackage {
  return createBackup({
    id: 'bk-prop',
    period: '2026-02',
    sourceVersion: 'v1',
    createdAt: '2026-02-20T10:00:00Z',
    operatorId: 'op-1',
    categories: ['registry'],
    officialPublication: official,
    files,
  });
}

// --------------------------------------------------------------------------
// Property 41 — detecta qualquer alteracao
// --------------------------------------------------------------------------

describe('BackupService — Property 41: deteccao de alteracao', () => {
  it('backup integro verifica ok; alterar/remover/acrescentar byte o classifica corrompido', () => {
    // Feature: gestao-leiga-de-escalas, Property 41: Backup detecta qualquer alteração de conteúdo
    fc.assert(
      fc.property(filesArb, fc.integer({ min: 0, max: 1000 }), (files, pick) => {
        const p = buildPackage(files, false);
        // Integro => ok.
        expect(verifyIntegrity(p).ok).toBe(true);

        // Alteracao: muda 1 byte de um arquivo.
        const i = pick % files.length;
        const tampered: BackupPackage = {
          ...p,
          files: p.files.map((f, j) => (j === i ? { ...f, content: f.content + ' ' } : f)),
        };
        const r1 = verifyIntegrity(tampered);
        expect(r1.ok).toBe(false);
        if (!r1.ok) {
          expect(r1.issues.some((iss) => iss.path === files[i]!.path)).toBe(true);
        }

        // Remocao: tira 1 arquivo.
        const removed: BackupPackage = { ...p, files: p.files.filter((_, j) => j !== i) };
        expect(verifyIntegrity(removed).ok).toBe(false);

        // Acrescimo: adiciona arquivo fora do manifesto.
        const added: BackupPackage = { ...p, files: [...p.files, { path: 'extra/novo.json', content: '1' }] };
        expect(verifyIntegrity(added).ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

// --------------------------------------------------------------------------
// Property 42 — round-trip
// --------------------------------------------------------------------------

describe('BackupService — Property 42: round-trip do estado coberto', () => {
  it('criar -> exportar -> importar -> restaurar reconstroi categorias/valores e metadados', () => {
    // Feature: gestao-leiga-de-escalas, Property 42: Backup faz round-trip do estado coberto
    fc.assert(
      fc.property(filesArb, fc.boolean(), (files, official) => {
        const p = buildPackage(files, official);
        const restored = restoreBackup(importBackup(exportBackup(p)));
        expect(restored.ok).toBe(true);
        if (!restored.ok) return;

        // Metadados de origem preservados.
        expect(restored.manifest.id).toBe(p.manifest.id);
        expect(restored.manifest.period).toBe(p.manifest.period);
        expect(restored.manifest.sourceVersion).toBe(p.manifest.sourceVersion);
        expect(restored.manifest.officialPublication).toBe(official);

        // Conteudo coberto identico (comparando por path).
        const original = new Map(files.map((f) => [f.path, f.content]));
        expect(restored.files.length).toBe(files.length);
        for (const f of restored.files) {
          expect(f.content).toBe(original.get(f.path));
        }
      }),
      { numRuns: 200 },
    );
  });
});

// --------------------------------------------------------------------------
// Property 43 — retencao preserva publicacao oficial
// --------------------------------------------------------------------------

const backupMetaArb = fc.record({
  id: fc.uuid(),
  createdAt: fc
    .tuple(fc.integer({ min: 2018, max: 2027 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
    .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00Z`),
  officialPublication: fc.boolean(),
});

describe('BackupService — Property 43: retencao nunca elimina publicacao oficial', () => {
  it('respeita quantidade/tempo e mantem todo backup oficial', () => {
    // Feature: gestao-leiga-de-escalas, Property 43: Retenção nunca elimina publicação oficial
    fc.assert(
      fc.property(
        fc
          .array(backupMetaArb, { minLength: 0, maxLength: 20 })
          .map((bs) => {
            const seen = new Set<string>();
            return bs.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
          }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 24 }),
        (backups, maxBackups, maxAgeMonths) => {
          const policy: RetentionPolicy = {
            maxBackups,
            maxAgeMonths,
            preserveOfficialPublications: true,
          };
          const now = '2027-12-31T00:00:00Z';
          const d = applyRetention(backups, policy, now);

          const keepSet = new Set(d.keep);
          const removeSet = new Set(d.remove);

          // Todo oficial e mantido (nunca removido).
          for (const b of backups) {
            if (b.officialPublication) {
              expect(keepSet.has(b.id)).toBe(true);
              expect(removeSet.has(b.id)).toBe(false);
            }
          }

          // keep e remove particionam o conjunto, sem interseccao.
          expect(keepSet.size + removeSet.size).toBe(backups.length);
          for (const id of keepSet) expect(removeSet.has(id)).toBe(false);

          // Quantidade: no maximo maxBackups backups NAO oficiais sao mantidos.
          const keptNonOfficial = backups.filter((b) => keepSet.has(b.id) && !b.officialPublication).length;
          expect(keptNonOfficial).toBeLessThanOrEqual(maxBackups);
        },
      ),
      { numRuns: 200 },
    );
  });
});
