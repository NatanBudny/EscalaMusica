// Testes baseados em propriedade do PublicationOrchestrator (tarefas 12.6-12.9).
//
// Property 35: Commit publico corresponde exatamente ao pacote (10.2,10.4,10.5,10.19)
// Property 36: Confirmacao publica exige igualdade integral (10.12-10.14,10.17,10.22)
// Property 37: Efeitos de confirmacao sao idempotentes (10.8,10.9,10.15,14.12,14.13)
// Property 39: Falhas preservam os estados declarados (12.4-12.7,12.10-12.12,14.10)
//
// **Validates: Requirements 10.2-10.22, 12.4-12.12, 14.10, 14.12, 14.13**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  advanceSaga,
  applyConfirmationEffects,
  applyPackage,
  markIncomplete,
  startPublication,
  verifyPublicSite,
  type ConfirmationEffects,
  type PublicationPackage,
  type PublicTree,
  type SagaState,
} from './publicationOrchestrator';

// --------------------------------------------------------------------------
// Geradores
// --------------------------------------------------------------------------

const pathArb = fc.stringMatching(/^[a-z][a-z0-9]{0,6}\.json$/);
const contentArb = fc.json();

const packageArb: fc.Arbitrary<PublicationPackage> = fc
  .record({
    files: fc.array(fc.record({ path: pathArb, content: contentArb }), { maxLength: 5 }),
    removals: fc.array(pathArb, { maxLength: 3 }),
  })
  .map(({ files, removals }) => {
    // Paths unicos entre files; remocoes distintas dos files.
    const seen = new Set<string>();
    const uniqFiles = files.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
    const uniqRemovals = [...new Set(removals)].filter((p) => !seen.has(p));
    return { packageId: 'pkg', period: '2026-02', files: uniqFiles, removals: uniqRemovals };
  });

const treeArb: fc.Arbitrary<PublicTree> = fc
  .array(fc.tuple(pathArb, contentArb), { maxLength: 5 })
  .map((pairs) => Object.fromEntries(pairs));

// --------------------------------------------------------------------------
// Property 35 — commit = diff exato
// --------------------------------------------------------------------------

describe('PublicationOrchestrator — Property 35: commit publico = diff exato do pacote', () => {
  it('o diff contem exatamente os caminhos do manifesto e nenhum outro', () => {
    // Feature: gestao-leiga-de-escalas, Property 35: Commit público corresponde exatamente ao pacote
    fc.assert(
      fc.property(treeArb, packageArb, (initial, pkg) => {
        const r = applyPackage(initial, pkg, '2026-02');
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        const touched = new Set([...r.diff.added, ...r.diff.changed, ...r.diff.removed]);
        // Todo caminho tocado pertence ao manifesto (files ou removals).
        const manifestPaths = new Set([...pkg.files.map((f) => f.path), ...pkg.removals]);
        for (const p of touched) expect(manifestPaths.has(p)).toBe(true);

        // Toda alteracao real da arvore corresponde ao diff relatado.
        for (const f of pkg.files) {
          expect(r.tree[f.path]).toBe(f.content);
        }
        for (const p of pkg.removals) {
          if (Object.prototype.hasOwnProperty.call(initial, p)) {
            expect(r.tree[p]).toBeUndefined();
            expect(r.diff.removed).toContain(p);
          }
        }
        // Nenhum caminho fora do manifesto mudou.
        for (const key of Object.keys(initial)) {
          if (!manifestPaths.has(key)) {
            expect(r.tree[key]).toBe(initial[key]);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('destino divergente rejeita sem mutacao', () => {
    // Feature: gestao-leiga-de-escalas, Property 35: Commit público corresponde exatamente ao pacote
    fc.assert(
      fc.property(treeArb, packageArb, (initial, pkg) => {
        const snapshot = JSON.stringify(initial);
        const r = applyPackage(initial, pkg, 'periodo-errado');
        expect(r.ok).toBe(false);
        expect(JSON.stringify(initial)).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});

// --------------------------------------------------------------------------
// Property 36 — confirmacao exige igualdade integral
// --------------------------------------------------------------------------

describe('PublicationOrchestrator — Property 36: confirmacao exige igualdade integral', () => {
  it('confirma sse todos os esperados conferem, todos os removidos ausentes e consultado', () => {
    // Feature: gestao-leiga-de-escalas, Property 36: Confirmação pública exige igualdade integral
    fc.assert(
      fc.property(packageArb, (pkg) => {
        // Site observado exatamente igual ao pacote -> confirma.
        const perfect: Record<string, string> = {};
        for (const f of pkg.files) perfect[f.path] = f.content;
        expect(verifyPublicSite(pkg, perfect).ok).toBe(true);

        // Sem consulta -> nunca confirma.
        expect(verifyPublicSite(pkg, undefined).ok).toBe(false);

        // Remover um arquivo esperado (se houver) -> nao confirma.
        if (pkg.files.length > 0) {
          const broken = { ...perfect };
          delete broken[pkg.files[0]!.path];
          expect(verifyPublicSite(pkg, broken).ok).toBe(false);
        }

        // Um removido ainda presente -> nao confirma.
        if (pkg.removals.length > 0) {
          const withRemoved = { ...perfect, [pkg.removals[0]!]: 'ainda-aqui' };
          expect(verifyPublicSite(pkg, withRemoved).ok).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// --------------------------------------------------------------------------
// Property 37 — efeitos de confirmacao idempotentes
// --------------------------------------------------------------------------

describe('PublicationOrchestrator — Property 37: efeitos de confirmacao idempotentes', () => {
  it('processar o mesmo packageId N vezes gera no maximo um confirmado e uma rotacao', () => {
    // Feature: gestao-leiga-de-escalas, Property 37: Efeitos de confirmação são idempotentes
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.dictionary(fc.stringMatching(/^[a-z]{1,5}$/), fc.integer({ min: 1, max: 5 }), { maxKeys: 5 }),
        fc.integer({ min: 1, max: 6 }),
        (packageId, rotation, times) => {
          let effects: ConfirmationEffects = { confirmedPackageIds: [], rotationContributions: {} };
          for (let i = 0; i < times; i++) {
            effects = applyConfirmationEffects(effects, packageId, rotation);
          }
          // No maximo um registro confirmado para o pacote.
          expect(effects.confirmedPackageIds.filter((id) => id === packageId)).toHaveLength(1);
          // Rotacao = exatamente a contribuicao do pacote (nunca acumulada).
          expect(effects.rotationContributions).toEqual(rotation);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// --------------------------------------------------------------------------
// Property 39 — falhas preservam estados declarados
// --------------------------------------------------------------------------

const STATES: readonly SagaState[] = ['private-synced', 'backed-up', 'pushed', 'pages-processing', 'confirmed'];

describe('PublicationOrchestrator — Property 39: falhas preservam estados declarados', () => {
  it('falha injetada em qualquer transicao mantem o registro recuperavel e nao confirma', () => {
    // Feature: gestao-leiga-de-escalas, Property 39: Falhas preservam os estados declarados
    fc.assert(
      fc.property(fc.integer({ min: 0, max: STATES.length - 1 }), (failAt) => {
        const ctx = { publicationId: 'pub-1', packageId: 'pkg-1', period: '2026-02', at: '2026-02-20T10:00:00Z' };
        let rec = startPublication(ctx);

        // Avanca ate (mas nao incluindo) o ponto de falha.
        for (let i = 0; i < failAt; i++) {
          const r = advanceSaga(rec, STATES[i]!, ctx.at);
          expect(r.ok).toBe(true);
          if (r.ok) rec = r.record;
        }
        const stateBeforeFailure = rec.state;

        // Injeta falha: marca incompleta em vez de avancar.
        const incomplete = markIncomplete(rec, 'incomplete', ctx.at, `falha em ${STATES[failAt]}`);

        // O estado anterior a falha e preservado nas tentativas; nunca confirmado.
        expect(incomplete.state).toBe('incomplete');
        expect(incomplete.confirmedAt).toBeUndefined();
        // A ultima tentativa confirmada nao existe; o registro continua retomavel
        // pelo mesmo publicationId (mesmo id).
        expect(incomplete.id).toBe(rec.id);
        expect(incomplete.attempts.some((a) => a.state === stateBeforeFailure)).toBe(
          stateBeforeFailure !== 'prepared' ? true : true,
        );
      }),
      { numRuns: 100 },
    );
  });
});
