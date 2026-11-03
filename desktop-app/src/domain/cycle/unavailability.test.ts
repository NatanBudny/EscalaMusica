// Testes unitarios do modulo de indisponibilidades e propagacao rastreavel.
//
// Cobrem os requisitos da tarefa 4.2:
//  4.9  registro exige >= 1 data OU intervalo; escopo `dates` vazio e rejeitado.
//  4.10 `whole-cycle` alcanca datas existentes E cultos adicionados depois
//       (inclusive extraordinarios), porque a derivacao usa a lista corrente.
//  4.11 propagacao por vinculos aponta a Indisponibilidade de origem e o
//       caminho; a matriz pessoa x data mostra exatamente efeitos diretos e
//       propagados.
//  4.16 data fora do ciclo e intervalo invertido sao rejeitados preservando o
//       estado (nenhuma indisponibilidade e produzida).

import { describe, expect, it } from 'vitest';

import {
  buildMatrix,
  buildUnavailability,
  buildUnavailabilityMatrix,
  cellKey,
  deriveEffectiveUnavailabilities,
  resolveScopeDates,
  type CycleContext,
  type PropagationConfig,
} from './unavailability';
import { SCHEMA_VERSION } from '../schemas/models';
import type { Person, PersonLink, Service, Unavailability, Uuid } from '../schemas/models';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const PERIOD = '2025-01';
const ctx: CycleContext = { period: PERIOD };

const u = (tag: string): Uuid => `00000000-0000-4000-8000-0000000000${tag}` as Uuid;

const P_A = u('a1');
const P_B = u('b2');
const P_C = u('c3');
const LINK_TYPE_SPOUSE = u('70'); // propaga
const LINK_TYPE_OTHER = u('71'); // nao propaga

function makeService(id: string, date: string, removed = false): Service {
  const base: Service = {
    schemaVersion: SCHEMA_VERSION,
    id: u(id),
    cycleId: u('cc'),
    date,
    computedWeekday: 'wednesday',
    kind: 'regular',
    externalInputIds: [],
  };
  if (removed) {
    return { ...base, removed: { reason: 'x', removedAt: '2025-01-01T00:00:00Z', operatorId: u('op') } };
  }
  return base;
}

function makePerson(id: Uuid, links: PersonLink[] = []): Person {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: `Pessoa ${id.slice(-2)}`,
    aliases: [],
    participation: 'active',
    publicContactAuthorizationIds: [],
    capabilityIds: [],
    allowedWeekdays: [],
    leaves: [],
    links,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

function link(id: string, typeId: Uuid, otherPersonId: Uuid, validUntil?: string): PersonLink {
  return {
    id: u(id),
    typeId,
    otherPersonId,
    validFrom: '2025-01-01',
    ...(validUntil !== undefined ? { validUntil } : {}),
  };
}

function makeUnavailability(
  id: string,
  personId: Uuid,
  scope: Unavailability['scope'],
): Unavailability {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: u(id),
    cycleId: u('cc'),
    personId,
    scope,
    source: 'teste',
    createdAt: '2025-01-01T00:00:00Z',
  };
}

const registerInput = (personId: Uuid, scope: Unavailability['scope'], id = 'i1') => ({
  id: u(id),
  cycleId: u('cc'),
  personId,
  scope,
  source: 'teste',
  now: '2025-01-05T12:00:00Z',
});

// --------------------------------------------------------------------------
// 4.9 / 4.16 — registro e validacao
// --------------------------------------------------------------------------

describe('buildUnavailability: validacao do registro (4.9, 4.16)', () => {
  it('aceita um conjunto de datas do periodo e deduplica/ordena (4.9)', () => {
    const r = buildUnavailability(
      registerInput(P_A, { type: 'dates', dates: ['2025-01-15', '2025-01-04', '2025-01-15'] }),
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scope).toEqual({ type: 'dates', dates: ['2025-01-04', '2025-01-15'] });
    expect(r.value.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('rejeita escopo de datas vazio (4.9)', () => {
    const r = buildUnavailability(registerInput(P_A, { type: 'dates', dates: [] }), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('no-dates');
  });

  it('aceita um intervalo valido (inicio <= fim) dentro do periodo (4.9)', () => {
    const r = buildUnavailability(
      registerInput(P_A, { type: 'interval', start: '2025-01-04', end: '2025-01-18' }),
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scope).toEqual({ type: 'interval', start: '2025-01-04', end: '2025-01-18' });
  });

  it('aceita intervalo degenerado (inicio == fim) (4.9)', () => {
    const r = buildUnavailability(
      registerInput(P_A, { type: 'interval', start: '2025-01-04', end: '2025-01-04' }),
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  it('rejeita intervalo invertido (fim < inicio) indicando o intervalo (4.16)', () => {
    const r = buildUnavailability(
      registerInput(P_A, { type: 'interval', start: '2025-01-18', end: '2025-01-04' }),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('interval-invalid');
    expect(r.error.offendingValue).toBe('2025-01-18..2025-01-04');
  });

  it('rejeita data fora do periodo do ciclo indicando a data (4.16)', () => {
    const r = buildUnavailability(
      registerInput(P_A, { type: 'dates', dates: ['2025-01-04', '2025-02-01'] }),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('date-not-in-period');
    expect(r.error.offendingValue).toBe('2025-02-01');
  });

  it('rejeita intervalo cuja extremidade esta fora do periodo (4.16)', () => {
    const r = buildUnavailability(
      registerInput(P_A, { type: 'interval', start: '2025-01-28', end: '2025-02-02' }),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('date-not-in-period');
  });

  it('rejeita data civilmente invalida', () => {
    const r = buildUnavailability(
      registerInput(P_A, { type: 'dates', dates: ['2025-01-32'] }),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('date-invalid');
  });

  it('aceita escopo de ciclo inteiro sem enumerar datas (4.10)', () => {
    const r = buildUnavailability(registerInput(P_A, { type: 'whole-cycle' }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scope).toEqual({ type: 'whole-cycle' });
  });
});

// --------------------------------------------------------------------------
// 4.10 — resolucao do escopo contra os cultos (inclui cultos adicionados depois)
// --------------------------------------------------------------------------

describe('resolveScopeDates: escopo x cultos (4.10)', () => {
  const s1 = makeService('01', '2025-01-01');
  const s2 = makeService('02', '2025-01-04');
  const s3 = makeService('03', '2025-01-05');

  it('whole-cycle alcanca exatamente as datas dos cultos ativos', () => {
    const dates = resolveScopeDates({ type: 'whole-cycle' }, [s1, s2, s3]);
    expect(dates).toEqual(['2025-01-01', '2025-01-04', '2025-01-05']);
  });

  it('whole-cycle alcanca culto extraordinario adicionado depois', () => {
    const extra = makeService('04', '2025-01-20');
    const dates = resolveScopeDates({ type: 'whole-cycle' }, [s1, s2, s3, extra]);
    expect(dates).toContain('2025-01-20');
    expect(dates).toHaveLength(4);
  });

  it('whole-cycle ignora cultos removidos', () => {
    const removed = makeService('05', '2025-01-11', true);
    const dates = resolveScopeDates({ type: 'whole-cycle' }, [s1, removed]);
    expect(dates).toEqual(['2025-01-01']);
  });

  it('dates resolve apenas as datas que possuem culto ativo', () => {
    const dates = resolveScopeDates(
      { type: 'dates', dates: ['2025-01-04', '2025-01-09'] },
      [s1, s2, s3],
    );
    // 2025-01-09 nao tem culto -> nao e efetiva.
    expect(dates).toEqual(['2025-01-04']);
  });

  it('interval resolve as datas de culto dentro do intervalo inclusivo', () => {
    const dates = resolveScopeDates(
      { type: 'interval', start: '2025-01-04', end: '2025-01-05' },
      [s1, s2, s3],
    );
    expect(dates).toEqual(['2025-01-04', '2025-01-05']);
  });
});

// --------------------------------------------------------------------------
// 4.11 — propagacao rastreavel por vinculos
// --------------------------------------------------------------------------

describe('deriveEffectiveUnavailabilities: propagacao (4.11)', () => {
  const services = [makeService('01', '2025-01-04'), makeService('02', '2025-01-05')];
  const noProp: PropagationConfig = { propagatingLinkTypeIds: new Set() };
  const spouseProp: PropagationConfig = { propagatingLinkTypeIds: new Set([LINK_TYPE_SPOUSE]) };

  it('efeito direto: origem com caminho vazio, uma celula por data', () => {
    const people = [makePerson(P_A)];
    const un = makeUnavailability('i1', P_A, { type: 'whole-cycle' });
    const effects = deriveEffectiveUnavailabilities({
      unavailabilities: [un],
      services,
      people,
      propagation: noProp,
    });
    expect(effects).toHaveLength(2);
    for (const e of effects) {
      expect(e.personId).toBe(P_A);
      expect(e.sourceUnavailabilityId).toBe(un.id);
      expect(e.propagationPath).toEqual([]);
    }
  });

  it('propaga por vinculo que propaga, registrando origem e caminho (um salto)', () => {
    // A tem vinculo de conjuge com B.
    const people = [makePerson(P_A, [link('l1', LINK_TYPE_SPOUSE, P_B)]), makePerson(P_B)];
    const un = makeUnavailability('i1', P_A, { type: 'dates', dates: ['2025-01-04'] });
    const effects = deriveEffectiveUnavailabilities({
      unavailabilities: [un],
      services,
      people,
      propagation: spouseProp,
    });
    // A (direto) e B (propagado) na data 2025-01-04.
    expect(effects).toHaveLength(2);
    const direct = effects.find((e) => e.personId === P_A);
    const prop = effects.find((e) => e.personId === P_B);
    expect(direct?.propagationPath).toEqual([]);
    expect(prop?.sourceUnavailabilityId).toBe(un.id);
    expect(prop?.propagationPath).toEqual([
      { linkId: u('l1'), fromPersonId: P_A, toPersonId: P_B },
    ]);
  });

  it('nao propaga por vinculo de tipo que nao propaga', () => {
    const people = [makePerson(P_A, [link('l1', LINK_TYPE_OTHER, P_B)]), makePerson(P_B)];
    const un = makeUnavailability('i1', P_A, { type: 'dates', dates: ['2025-01-04'] });
    const effects = deriveEffectiveUnavailabilities({
      unavailabilities: [un],
      services,
      people,
      propagation: spouseProp,
    });
    expect(effects).toHaveLength(1);
    expect(effects[0]?.personId).toBe(P_A);
  });

  it('propaga nos dois sentidos mesmo quando so uma pessoa declara o vinculo', () => {
    // So B declara o vinculo com A; a indisponibilidade de A deve alcancar B.
    const people = [makePerson(P_A), makePerson(P_B, [link('l1', LINK_TYPE_SPOUSE, P_A)])];
    const un = makeUnavailability('i1', P_A, { type: 'dates', dates: ['2025-01-04'] });
    const effects = deriveEffectiveUnavailabilities({
      unavailabilities: [un],
      services,
      people,
      propagation: spouseProp,
    });
    const prop = effects.find((e) => e.personId === P_B);
    expect(prop).toBeDefined();
    expect(prop?.propagationPath).toEqual([
      { linkId: u('l1'), fromPersonId: P_A, toPersonId: P_B },
    ]);
  });

  it('propaga por multiplos saltos com o caminho mais curto (A->B->C)', () => {
    const people = [
      makePerson(P_A, [link('l1', LINK_TYPE_SPOUSE, P_B)]),
      makePerson(P_B, [link('l2', LINK_TYPE_SPOUSE, P_C)]),
      makePerson(P_C),
    ];
    const un = makeUnavailability('i1', P_A, { type: 'dates', dates: ['2025-01-04'] });
    const effects = deriveEffectiveUnavailabilities({
      unavailabilities: [un],
      services,
      people,
      propagation: spouseProp,
    });
    const c = effects.find((e) => e.personId === P_C);
    expect(c?.propagationPath).toEqual([
      { linkId: u('l1'), fromPersonId: P_A, toPersonId: P_B },
      { linkId: u('l2'), fromPersonId: P_B, toPersonId: P_C },
    ]);
  });

  it('nao propaga por vinculo fora de vigencia no instante avaliado', () => {
    const people = [
      makePerson(P_A, [link('l1', LINK_TYPE_SPOUSE, P_B, '2024-12-31')]),
      makePerson(P_B),
    ];
    const un = makeUnavailability('i1', P_A, { type: 'dates', dates: ['2025-01-04'] });
    const effects = deriveEffectiveUnavailabilities({
      unavailabilities: [un],
      services,
      people,
      propagation: { propagatingLinkTypeIds: new Set([LINK_TYPE_SPOUSE]), at: '2025-01-04' },
    });
    expect(effects.every((e) => e.personId === P_A)).toBe(true);
  });

  it('propagacao com ciclo de vinculos nao gera duplicatas nem laco infinito', () => {
    // A<->B<->C<->A, todos conjuges.
    const people = [
      makePerson(P_A, [link('l1', LINK_TYPE_SPOUSE, P_B), link('l3', LINK_TYPE_SPOUSE, P_C)]),
      makePerson(P_B, [link('l2', LINK_TYPE_SPOUSE, P_C)]),
      makePerson(P_C),
    ];
    const un = makeUnavailability('i1', P_A, { type: 'dates', dates: ['2025-01-04'] });
    const effects = deriveEffectiveUnavailabilities({
      unavailabilities: [un],
      services,
      people,
      propagation: spouseProp,
    });
    // Tres pessoas, uma data, sem duplicatas.
    expect(effects).toHaveLength(3);
    const persons = new Set(effects.map((e) => e.personId));
    expect(persons).toEqual(new Set([P_A, P_B, P_C]));
  });

  it('whole-cycle propagado alcanca culto extraordinario adicionado depois (4.10 + 4.11)', () => {
    const people = [makePerson(P_A, [link('l1', LINK_TYPE_SPOUSE, P_B)]), makePerson(P_B)];
    const un = makeUnavailability('i1', P_A, { type: 'whole-cycle' });
    const extra = makeService('09', '2025-01-25');
    const effects = deriveEffectiveUnavailabilities({
      unavailabilities: [un],
      services: [...services, extra],
      people,
      propagation: spouseProp,
    });
    // B deve ser afetado inclusive na nova data extraordinaria.
    const bOnExtra = effects.find((e) => e.personId === P_B && e.date === '2025-01-25');
    expect(bOnExtra).toBeDefined();
    expect(bOnExtra?.propagationPath).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------
// 4.11 — matriz pessoa x data
// --------------------------------------------------------------------------

describe('buildUnavailabilityMatrix: matriz pessoa x data (4.11)', () => {
  const services = [makeService('01', '2025-01-04'), makeService('02', '2025-01-05')];
  const spouseProp: PropagationConfig = { propagatingLinkTypeIds: new Set([LINK_TYPE_SPOUSE]) };

  it('exibe exatamente as celulas com efeito, com direto e propagado por celula', () => {
    const people = [makePerson(P_A, [link('l1', LINK_TYPE_SPOUSE, P_B)]), makePerson(P_B)];
    const un = makeUnavailability('i1', P_A, { type: 'whole-cycle' });
    const matrix = buildMatrix({
      unavailabilities: [un],
      services,
      people,
      propagation: spouseProp,
    });

    expect(new Set(matrix.personIds)).toEqual(new Set([P_A, P_B]));
    expect(matrix.dates).toEqual(['2025-01-04', '2025-01-05']);
    // 2 pessoas x 2 datas = 4 celulas com efeito.
    expect(matrix.cells).toHaveLength(4);

    const cellA = matrix.cells.find((c) => c.personId === P_A && c.date === '2025-01-04');
    expect(cellA?.direct).toBe(true);
    expect(cellA?.propagated).toBe(false);

    const cellB = matrix.cells.find((c) => c.personId === P_B && c.date === '2025-01-04');
    expect(cellB?.direct).toBe(false);
    expect(cellB?.propagated).toBe(true);
    expect(cellB?.effects[0]?.sourceUnavailabilityId).toBe(un.id);
    expect(cellB?.effects[0]?.propagationPath).toHaveLength(1);
  });

  it('uma celula acumula efeito direto e propagado de origens distintas', () => {
    // B fica indisponivel diretamente (i2) e propagado de A (i1) na mesma data.
    const people = [makePerson(P_A, [link('l1', LINK_TYPE_SPOUSE, P_B)]), makePerson(P_B)];
    const i1 = makeUnavailability('i1', P_A, { type: 'dates', dates: ['2025-01-04'] });
    const i2 = makeUnavailability('i2', P_B, { type: 'dates', dates: ['2025-01-04'] });
    const matrix = buildMatrix({
      unavailabilities: [i1, i2],
      services,
      people,
      propagation: spouseProp,
    });
    const cellB = matrix.cells.find((c) => c.personId === P_B && c.date === '2025-01-04');
    expect(cellB?.direct).toBe(true);
    expect(cellB?.propagated).toBe(true);
    expect(cellB?.effects).toHaveLength(2);
    // Ambas as origens estao representadas.
    expect(new Set(cellB?.effects.map((e) => e.sourceUnavailabilityId))).toEqual(
      new Set([i1.id, i2.id]),
    );
  });

  it('matriz vazia quando nao ha efeitos', () => {
    const matrix = buildUnavailabilityMatrix([]);
    expect(matrix.personIds).toEqual([]);
    expect(matrix.dates).toEqual([]);
    expect(matrix.cells).toEqual([]);
  });

  it('cellKey e estavel e distingue pares diferentes', () => {
    expect(cellKey(P_A, '2025-01-04')).toBe(cellKey(P_A, '2025-01-04'));
    expect(cellKey(P_A, '2025-01-04')).not.toBe(cellKey(P_B, '2025-01-04'));
    expect(cellKey(P_A, '2025-01-04')).not.toBe(cellKey(P_A, '2025-01-05'));
  });
});
