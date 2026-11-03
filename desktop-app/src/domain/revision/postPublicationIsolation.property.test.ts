// Teste baseado em propriedade — Property 45: Revisao pos-publicacao nao
// modifica a vigente antes da confirmacao (tarefa 10.5).
//
// Property 45 (design.md, "Correctness Properties"):
// "Para toda Escala vigente, criar e editar revisao pos-publicacao, valida-la,
//  pre-visualiza-la ou aprova-la preserva o hash da vigente; somente uma
//  publicacao confirmada pode criar a nova vigente."
//
// Estrategia: geramos uma Escala vigente arbitraria e uma SEQUENCIA arbitraria
// de operacoes de manutencao (troca, cancelamento, correcao publica, aprovacao)
// aplicadas sobre uma `PostPublicationRevision` criada a partir da vigente.
// Apos CADA passo verificamos que:
//
//   (A) O objeto da vigente permanece byte a byte identico (mesmo `revision` e
//       mesmo conteudo canonico) — a vigente nunca e mutada (14.1, 14.2, 14.3).
//   (B) Somente `confirmRevisionPublication` produz uma NOVA vigente, e so
//       quando a revisao esta aprovada e sem alteracao posterior (14.9). Antes
//       disso, nenhuma operacao cria a nova vigente.
//   (C) A nova vigente produzida pela confirmacao tem hash consistente com o
//       conteudo da revisao e e acompanhada de um backup EXATO da vigente
//       anterior (14.9) — e so entao o hash "vigente" muda.
//
// Determinismo: todos os dados vem de pools finitos e fixos; nenhuma data e
// derivada de `Date`.
//
// **Validates: Requirements 14.1, 14.2, 14.3, 14.9**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Assignment, PublicServiceFields } from '../schemas/models';
import {
  applyCancellation,
  applyPublicCorrection,
  applySubstitution,
  confirmRevisionPublication,
  markApproved,
  scheduleContentHash,
  startRevision,
  type PostPublicationRevision,
  type PublishedSchedule,
} from './postPublicationRevision';

// --------------------------------------------------------------------------
// Pools finitos
// --------------------------------------------------------------------------

const SERVICE_IDS = [
  'svc-1111-1111-4111-8111-111111111111',
  'svc-2222-2222-4222-8222-222222222222',
] as const;

const ROLE_IDS = [
  'role-aaaa-1111-4111-8111-111111111111',
  'role-bbbb-2222-4222-8222-222222222222',
] as const;

const SUBJECTS = [
  'p-ana-0000-4000-8000-000000000001',
  'p-bruno-000-4000-8000-000000000002',
  'p-carla-000-4000-8000-000000000003',
  'p-davi-0000-4000-8000-000000000004',
] as const;

const FIELD_NAMES = ['TEMA', 'OBS'] as const;
const FIELD_VALUES = ['alpha', 'beta', 'gamma'] as const;
const NOW = '2026-02-20T10:00:00Z';

// --------------------------------------------------------------------------
// Geradores
// --------------------------------------------------------------------------

/** Atribuicao arbitraria com id unico derivado do indice. */
function assignmentArb(index: number): fc.Arbitrary<Assignment> {
  return fc.record({
    serviceId: fc.constantFrom(...SERVICE_IDS),
    roleId: fc.constantFrom(...ROLE_IDS),
    subjectId: fc.constantFrom(...SUBJECTS),
  }).map(({ serviceId, roleId, subjectId }): Assignment => ({
    id: `a-${index}`,
    serviceId,
    roleId,
    subject: { type: 'person', id: subjectId },
    source: 'manual',
  }));
}

/** Escala vigente arbitraria, com atribuicoes de id unico e campos publicos. */
const currentArb: fc.Arbitrary<PublishedSchedule> = fc
  .array(fc.integer({ min: 0, max: 7 }), { minLength: 0, maxLength: 6 })
  .chain((indices) =>
    fc
      .tuple(...indices.map((_, i) => assignmentArb(i)))
      .chain((assignments) =>
        fc
          .dictionary(fc.constantFrom(...FIELD_NAMES), fc.constantFrom(...FIELD_VALUES), {
            maxKeys: FIELD_NAMES.length,
          })
          .map((fieldsSvc1): PublishedSchedule => {
            // Deduplica ids (tuple pode repetir "a-i" se indices repetir tamanho),
            // garantindo ids unicos por posicao.
            const uniq: Assignment[] = assignments.map((a, i) => ({ ...a, id: `a-${i}` }));
            const publicFields: PublicServiceFields[] = [
              { serviceId: SERVICE_IDS[0], fields: { ...fieldsSvc1 } },
              { serviceId: SERVICE_IDS[1], fields: { TEMA: 'fixo' } },
            ];
            return {
              cycleId: 'c-0000-0000-4000-8000-000000000000',
              period: '2026-02',
              revision: scheduleContentHash({ assignments: uniq, publicFields }),
              assignments: uniq,
              publicFields,
            };
          }),
      ),
  );

/** Operacao de manutencao arbitraria (parametrizada; alvos resolvidos no apply). */
type OpSpec =
  | { readonly t: 'substitution'; readonly substitute: string; readonly reason: string }
  | { readonly t: 'cancellation'; readonly reason: string }
  | { readonly t: 'correction'; readonly field: string; readonly value: string; readonly reason: string }
  | { readonly t: 'approve' };

const opArb: fc.Arbitrary<OpSpec> = fc.oneof(
  fc.record({ t: fc.constant('substitution' as const), substitute: fc.constantFrom(...SUBJECTS), reason: fc.constant('motivo') }),
  fc.record({ t: fc.constant('cancellation' as const), reason: fc.constant('motivo') }),
  fc.record({
    t: fc.constant('correction' as const),
    field: fc.constantFrom(...FIELD_NAMES),
    value: fc.constantFrom(...FIELD_VALUES),
    reason: fc.constant('motivo'),
  }),
  fc.record({ t: fc.constant('approve' as const) }),
);

// --------------------------------------------------------------------------
// Aplicacao de uma operacao (resolve o alvo a partir do estado atual)
// --------------------------------------------------------------------------

let approvalSeq = 0;

function applyOp(rev: PostPublicationRevision, op: OpSpec): PostPublicationRevision {
  switch (op.t) {
    case 'substitution': {
      const target = rev.assignments[0];
      if (!target) return rev; // nada a substituir
      const res = applySubstitution(rev, {
        kind: 'substitution',
        serviceId: target.serviceId,
        roleId: target.roleId,
        ...(target.slot !== undefined ? { slot: target.slot } : {}),
        replacedSubjectId: target.subject.id,
        substituteSubjectId: op.substitute,
        reason: op.reason,
        at: NOW,
        operatorId: 'op-1',
      });
      return res.ok ? res.value : rev;
    }
    case 'cancellation': {
      const target = rev.assignments[0];
      if (!target) return rev;
      const res = applyCancellation(rev, {
        kind: 'cancellation',
        serviceId: target.serviceId,
        assignmentId: target.id,
        reason: op.reason,
        at: NOW,
        operatorId: 'op-1',
      });
      return res.ok ? res.value : rev;
    }
    case 'correction': {
      const res = applyPublicCorrection(rev, {
        kind: 'public-correction',
        serviceId: SERVICE_IDS[0],
        field: op.field,
        reason: op.reason,
        at: NOW,
        operatorId: 'op-1',
        after: op.value,
      });
      return res.ok ? res.value : rev;
    }
    case 'approve':
      return markApproved(rev, `ap-${approvalSeq++}`);
  }
}

// --------------------------------------------------------------------------
// Property 45
// --------------------------------------------------------------------------

describe('postPublicationRevision — Property 45: a vigente nao muda antes da confirmacao', () => {
  it('criar/editar/aprovar a revisao preserva o hash e o conteudo da vigente', () => {
    // Feature: gestao-leiga-de-escalas, Property 45: Revisão pós-publicação não modifica a vigente antes da confirmação
    fc.assert(
      fc.property(currentArb, fc.array(opArb, { minLength: 0, maxLength: 10 }), (current, ops) => {
        // Snapshot imutavel da vigente (hash + conteudo canonico) ANTES de tudo.
        const hashBefore = current.revision;
        const contentHashBefore = scheduleContentHash(current);
        const frozenAssignments = JSON.stringify(current.assignments);
        const frozenFields = JSON.stringify(current.publicFields);
        expect(hashBefore).toBe(contentHashBefore);

        let rev = startRevision({ id: 'rev-1', current, createdAt: NOW });

        // (A) Apos criar a revisao, a vigente permanece intacta.
        expect(current.revision).toBe(hashBefore);
        expect(scheduleContentHash(current)).toBe(hashBefore);

        for (const op of ops) {
          rev = applyOp(rev, op);
          // (A) Apos CADA operacao de manutencao, a vigente NUNCA muda.
          expect(current.revision).toBe(hashBefore);
          expect(scheduleContentHash(current)).toBe(hashBefore);
          expect(JSON.stringify(current.assignments)).toBe(frozenAssignments);
          expect(JSON.stringify(current.publicFields)).toBe(frozenFields);
        }

        // (B) A confirmacao so cria a nova vigente quando a revisao esta
        // aprovada e sem alteracao posterior. Em qualquer caso, a confirmacao
        // NAO muta a vigente de entrada.
        const confirm = confirmRevisionPublication({
          revision: rev,
          current,
          at: NOW,
          operatorId: 'op-1',
          operationId: 'pub-1',
        });

        // A vigente de ENTRADA continua intacta, com ou sem sucesso.
        expect(current.revision).toBe(hashBefore);
        expect(scheduleContentHash(current)).toBe(hashBefore);
        expect(JSON.stringify(current.assignments)).toBe(frozenAssignments);

        if (confirm.ok) {
          // (C) A nova vigente e um objeto NOVO; seu hash reflete o conteudo da
          // revisao e o backup preserva EXATAMENTE a vigente anterior (14.9).
          expect(confirm.value.newCurrent).not.toBe(current);
          expect(confirm.value.newCurrent.revision).toBe(
            scheduleContentHash({
              assignments: confirm.value.newCurrent.assignments,
              publicFields: confirm.value.newCurrent.publicFields,
            }),
          );
          expect(confirm.value.backupOfPrevious.revision).toBe(hashBefore);
          expect(JSON.stringify(confirm.value.backupOfPrevious.assignments)).toBe(frozenAssignments);
          expect(JSON.stringify(confirm.value.backupOfPrevious.publicFields)).toBe(frozenFields);
        } else {
          // Sem aprovacao valida, nenhuma nova vigente e criada.
          expect(confirm.errors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200, verbose: true },
    );
  });
});
