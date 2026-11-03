// Teste baseado em propriedade — Property 44: Divergencia Git nunca causa
// sobrescrita automatica (tarefa 11.11).
//
// Property 44 (design.md): "Para todo `baseCommit` e heads local/remoto
// divergentes, sincronizar sem uma selecao explicita do operador nao altera
// nenhum remoto; apos escolhas explicitas, o resultado contem todas as mudancas
// nao conflitantes e exatamente as escolhas feitas para conflitos."
//
// Estrategia:
//   (A) Para quaisquer commits com remoteHead != baseCommit e != localCommit,
//       `decidePush` NUNCA retorna 'push' (bloqueia divergencia; sem force).
//   (B) Para quaisquer conjuntos de mudancas local/remoto, `reconcile` so
//       auto-combina campos DISJUNTOS; qualquer colisao vira conflito e
//       `requiresOperatorChoice` fica verdadeiro — nenhuma sobrescrita
//       automatica. Apos `applyChoices`, o resultado contem TODAS as mudancas
//       nao conflitantes e EXATAMENTE a escolha feita para cada conflito.
//
// **Validates: Requirement 13.15**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { decidePush } from './gitPolicy';
import {
  applyChoices,
  conflictId,
  reconcile,
  type ConflictChoice,
  type FieldChange,
} from './reconcile';

// --------------------------------------------------------------------------
// (A) push bloqueia divergencia
// --------------------------------------------------------------------------

const commitArb = fc.stringMatching(/^[a-f0-9]{6,12}$/);

describe('Property 44 (A): push nunca sobrescreve um remoto divergente', () => {
  it('remoteHead diferente de base e de local => nunca "push"', () => {
    // Feature: gestao-leiga-de-escalas, Property 44: Divergência Git nunca causa sobrescrita automática
    fc.assert(
      fc.property(commitArb, commitArb, commitArb, (base, local, remote) => {
        fc.pre(remote !== base && remote !== local);
        const d = decidePush({ baseCommit: base, localCommit: local, remoteHead: remote });
        expect(d.action).toBe('block-diverged');
      }),
      { numRuns: 300 },
    );
  });

  it('remoteHead == base => fast-forward permitido (sem force)', () => {
    // Feature: gestao-leiga-de-escalas, Property 44: Divergência Git nunca causa sobrescrita automática
    fc.assert(
      fc.property(commitArb, commitArb, (base, local) => {
        fc.pre(local !== base);
        const d = decidePush({ baseCommit: base, localCommit: local, remoteHead: base });
        expect(d.action).toBe('push');
      }),
      { numRuns: 200 },
    );
  });
});

// --------------------------------------------------------------------------
// (B) reconciliacao: sem sobrescrita automatica; escolhas respeitadas
// --------------------------------------------------------------------------

const ENTITIES = ['e1', 'e2', 'e3'] as const;
const FIELDS = ['f1', 'f2'] as const;

const changeArb: fc.Arbitrary<FieldChange> = fc
  .record({
    entityId: fc.constantFrom(...ENTITIES),
    field: fc.constantFrom(...FIELDS),
    change: fc.constantFrom('set' as const, 'delete' as const),
    value: fc.integer({ min: 0, max: 5 }),
  })
  .map((c) => (c.change === 'delete' ? { entityId: c.entityId, field: c.field, change: 'delete' as const } : c));

/** Deduplica por (entity,field) mantendo o primeiro (uma mudanca por campo). */
function dedupe(changes: readonly FieldChange[]): FieldChange[] {
  const seen = new Set<string>();
  const out: FieldChange[] = [];
  for (const c of changes) {
    const k = `${c.entityId}\u0000${c.field}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

describe('Property 44 (B): reconciliacao exige escolha e respeita exatamente as escolhas', () => {
  it('so auto-combina campos disjuntos; conflitos exigem escolha; resultado = nao-conflitantes + escolhas', () => {
    // Feature: gestao-leiga-de-escalas, Property 44: Divergência Git nunca causa sobrescrita automática
    fc.assert(
      fc.property(
        fc.array(changeArb, { maxLength: 6 }),
        fc.array(changeArb, { maxLength: 6 }),
        fc.array(fc.constantFrom('local' as const, 'remote' as const), { minLength: 6, maxLength: 6 }),
        (rawLocal, rawRemote, choiceSeq) => {
          const local = dedupe(rawLocal);
          const remote = dedupe(rawRemote);
          const r = reconcile({ local, remote });

          // Nenhuma auto-combinacao em campo colidido: toda chave auto-combinada
          // aparece em no maximo um dos lados OU e identica nos dois.
          const localKeys = new Map(local.map((c) => [`${c.entityId}\u0000${c.field}`, c]));
          const remoteKeys = new Map(remote.map((c) => [`${c.entityId}\u0000${c.field}`, c]));
          for (const m of r.autoMerged) {
            const k = `${m.entityId}\u0000${m.field}`;
            const inL = localKeys.get(k);
            const inR = remoteKeys.get(k);
            const both = inL !== undefined && inR !== undefined;
            if (both) {
              // So pode auto-combinar se forem identicos.
              expect(JSON.stringify(inL)).toBe(JSON.stringify(inR));
            }
          }

          // Se ha conflito, requiresOperatorChoice e verdadeiro.
          expect(r.requiresOperatorChoice).toBe(r.conflicts.length > 0);

          // Monta escolhas deterministicas para cada conflito (exceto 'special',
          // que nao ha aqui pois nao passamos special changes).
          const choices = new Map<string, ConflictChoice>();
          r.conflicts.forEach((c, i) => {
            choices.set(conflictId(c), choiceSeq[i % choiceSeq.length] as ConflictChoice);
          });

          const final = applyChoices(r, choices);

          // O resultado contem todas as mudancas auto-combinadas.
          for (const m of r.autoMerged) {
            expect(final.some((f) => JSON.stringify(f) === JSON.stringify(m))).toBe(true);
          }
          // E exatamente a escolha feita para cada conflito.
          for (const c of r.conflicts) {
            if (c.type === 'special') continue;
            const choice = choices.get(conflictId(c));
            const expected = choice === 'local' ? c.local : c.remote;
            expect(final.some((f) => JSON.stringify(f) === JSON.stringify(expected))).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
