import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { canonicalHash, canonicalStringify } from '../schemas/canonical';
import { validateEntity } from '../schemas/validator';
import {
  CommandExecutor,
  type CommandEnvelope,
  type CommandSpec,
} from './commands';
import { diffStates, canonicalEqual } from './diff';
import { isSecretField } from './audit';

// Feature: gestao-leiga-de-escalas, Property 10: Toda alteração de domínio é auditada pelo diff real
//
// Para toda alteracao aceita de cadastro, insumo, indisponibilidade, regra,
// aprovacao ou publicacao, o Registro_de_Auditoria contem exatamente os campos
// alterados, valores anteriores e posteriores permitidos, operacao, data/hora
// e operador; campos inalterados e credenciais nao aparecem.
//
// Valida: Requisitos 3.10, 4.17, 6.4, 8.7, 10.10, 11.11, 14.4, 14.7, 14.11.
//
// Estrategia: geramos um estado "antes" e um "depois" arbitrarios (objetos
// planos com um subconjunto de chaves conhecidas, incluindo um campo de
// segredo `token`). Executamos um comando que substitui o estado pelo "depois",
// variando a categoria de alteracao (entityType) entre cadastro, insumo,
// indisponibilidade, regra, aprovacao e publicacao, de modo a exercitar todos
// os requisitos validados. Verificamos as invariantes do evento de auditoria
// resultante.

const OPERATOR = '00000000-0000-4000-8000-000000000001';
const ENTITY_ID = '00000000-0000-4000-8000-0000000000aa';
const AUDIT_ID = '00000000-0000-4000-8000-0000000000bb';
const NOW = '2026-01-15T12:00:00Z';

const uuidFromInt = (n: number): string =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

// Valores simples e serializaveis em JSON canonico.
const scalar = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
);

// Estado: objeto plano com chaves de um conjunto fixo (algumas opcionais),
// incluindo um campo de segredo `token`.
const stateArb = fc.record(
  {
    id: fc.constant(ENTITY_ID),
    name: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
    phone: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
    count: fc.option(fc.integer({ min: 0, max: 99 }), { nil: undefined }),
    flag: fc.option(fc.boolean(), { nil: undefined }),
    // Segredo com prefixo distintivo para que a verificacao de nao vazamento
    // nao sofra colisao com outros campos (strings curtas aleatorias).
    token: fc.option(
      fc.string({ minLength: 1, maxLength: 20 }).map((s) => `SECRET_ghp_${s}`),
      { nil: undefined },
    ),
    tags: fc.option(fc.array(scalar, { maxLength: 3 }), { nil: undefined }),
  },
  { requiredKeys: ['id'] },
);

type State = Record<string, unknown>;

// Categorias de alteracao cobertas pela Property 10. Cada entrada mapeia um
// requisito validado a um `entityType` concreto e uma acao representativa, de
// modo que o teste exercite cadastro, insumo, indisponibilidade, regra,
// aprovacao e publicacao (3.10, 4.17, 6.4, 8.7, 10.10, 11.11, 14.4, 14.7, 14.11).
const CHANGE_CATEGORIES = [
  { entityType: 'person', action: 'alterar-cadastro' }, // 3.10, 14.4
  { entityType: 'department', action: 'alterar-departamento' }, // 3.10
  { entityType: 'externalInput', action: 'alterar-insumo' }, // 4.17
  { entityType: 'unavailability', action: 'alterar-indisponibilidade' }, // 4.17
  { entityType: 'approvedRuleSet', action: 'alterar-regra' }, // 6.4
  { entityType: 'approval', action: 'registrar-aprovacao' }, // 8.7, 14.7
  { entityType: 'publicationRecord', action: 'registrar-publicacao' }, // 10.10, 14.11
] as const;

const changeCategoryArb = fc.constantFrom(...CHANGE_CATEGORIES);

function replaceSpec(
  category: (typeof CHANGE_CATEGORIES)[number] = CHANGE_CATEGORIES[0],
): CommandSpec<State, State> {
  return {
    entityType: category.entityType,
    entityId: ENTITY_ID,
    action: category.action,
    timestamp: NOW,
    auditEventId: AUDIT_ID,
    apply: (_prev, payload) => ({ ok: true, next: payload }),
  };
}

function env(operationId: string, expectedRevision: string, payload: State): CommandEnvelope<State> {
  return { operationId, operatorId: OPERATOR, baseCommit: null, expectedRevision, payload };
}

describe('Property 10: alteracoes auditadas pelo diff real', () => {
  it('o evento contem exatamente os campos alterados; inalterados e segredos nunca vazam valor', () => {
    fc.assert(
      fc.property(
        stateArb,
        stateArb,
        fc.integer({ min: 1, max: 1_000_000 }),
        changeCategoryArb,
        (before, after, seed, category) => {
          const exec = new CommandExecutor<State>(before as State);
          const rev0 = exec.getRevision();
          const res = exec.execute(env(uuidFromInt(seed), rev0, after as State), replaceSpec(category));

          // O comando sempre e aceito pela transicao; o resultado e sucesso.
          expect(res.ok).toBe(true);
          if (!res.ok) return;

          const diff = diffStates(before, after);
          const events = exec.getEmittedEvents();

          if (diff.changes.length === 0) {
            // Sem alteracao real: nenhuma revisao/evento novos.
            expect(res.revision).toBe(rev0);
            expect(events).toHaveLength(0);
            return;
          }

          // Com alteracao: uma nova revisao (hash canonico do "depois").
          expect(res.revision).toBe(canonicalHash(after));
          expect(res.revision).not.toBe(rev0);
          expect(events).toHaveLength(1);

          const ev = events[0];
          if (!ev) throw new Error('evento esperado');

          // A categoria de alteracao (cadastro, insumo, indisponibilidade,
          // regra, aprovacao, publicacao) e refletida fielmente no evento.
          expect(ev.entityType).toBe(category.entityType);
          expect(ev.action).toBe(category.action);
          expect(ev.audit.entityType).toBe(category.entityType);
          expect(ev.audit.action).toBe(category.action);
          expect(ev.audit.result).toBe('success');

          // Correlacao de operacao, operador e data/hora.
          expect(ev.audit.operatorId).toBe(OPERATOR);
          expect(ev.audit.timestamp).toBe(NOW);
          expect(ev.audit.operationId).toBe(uuidFromInt(seed));
          expect(ev.fromRevision).toBe(rev0);
          expect(ev.toRevision).toBe(res.revision);

          // Exatamente os campos alterados (comparacao de conjuntos de campos).
          const diffFields = new Set(diff.changes.map((c) => c.field));
          const auditFields = new Set(ev.audit.changes.map((c) => c.field));
          expect(auditFields).toEqual(diffFields);

          // O evento de auditoria e valido pelo schema (inclui additionalProperties:false).
          const outcome = validateEntity('auditEvent', ev.audit);
          expect(outcome.valid).toBe(true);

          const serialized = canonicalStringify(ev.audit);
          for (const change of ev.audit.changes) {
            if (isSecretField(change.field)) {
              // Campos de segredo nunca registram valor, apenas hash.
              expect(change.before).toBeUndefined();
              expect(change.after).toBeUndefined();
              // O valor do segredo (antes/depois) nunca aparece na serializacao.
              const beforeVal = (before as State)[change.field];
              const afterVal = (after as State)[change.field];
              if (typeof beforeVal === 'string' && beforeVal.length > 0) {
                expect(serialized.includes(JSON.stringify(beforeVal).slice(1, -1))).toBe(false);
              }
              if (typeof afterVal === 'string' && afterVal.length > 0) {
                expect(serialized.includes(JSON.stringify(afterVal).slice(1, -1))).toBe(false);
              }
            }
          }

          // Nenhum campo inalterado aparece no evento.
          for (const field of auditFields) {
            const sameValue = canonicalEqual((before as State)[field], (after as State)[field]);
            expect(sameValue).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('repetir o mesmo operationId nunca duplica revisao nem evento', () => {
    fc.assert(
      fc.property(stateArb, stateArb, fc.integer({ min: 1, max: 1_000_000 }), (before, after, seed) => {
        const exec = new CommandExecutor<State>(before as State);
        const op = uuidFromInt(seed);
        const rev0 = exec.getRevision();

        const first = exec.execute(env(op, rev0, after as State), replaceSpec());
        const revAfter = exec.getRevision();
        const eventsAfter = exec.getEmittedEvents().length;

        // Repeticoes com o mesmo operationId (varios payloads).
        exec.execute(env(op, rev0, after as State), replaceSpec());
        exec.execute(env(op, revAfter, { id: ENTITY_ID, name: 'outro' }), replaceSpec());

        // Nenhum efeito adicional.
        expect(exec.getRevision()).toBe(revAfter);
        expect(exec.getEmittedEvents().length).toBe(eventsAfter);
        // O resultado retornado e sempre o primeiro.
        const repeat = exec.execute(env(op, rev0, after as State), replaceSpec());
        expect(repeat).toEqual(first);
      }),
      { numRuns: 300 },
    );
  });

  it('os invalidadores de derivados disparam se e somente se a revisao muda', () => {
    fc.assert(
      fc.property(stateArb, stateArb, fc.integer({ min: 1, max: 1_000_000 }), (before, after, seed) => {
        const exec = new CommandExecutor<State>(before as State);
        let fired = 0;
        exec.registerInvalidator(() => (fired += 1));
        const rev0 = exec.getRevision();
        exec.execute(env(uuidFromInt(seed), rev0, after as State), replaceSpec());

        const changed = exec.getRevision() !== rev0;
        expect(fired).toBe(changed ? 1 : 0);
      }),
      { numRuns: 300 },
    );
  });
});
