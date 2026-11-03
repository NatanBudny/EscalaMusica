// Feature: gestao-leiga-de-escalas, Property 12: Indisponibilidade efetiva é rastreável
//
// Property 12 (design.md):
// "Para toda indisponibilidade válida e grafo de vínculos vigente, o conjunto
//  efetivo contém exatamente cada par pessoa-data alcançado pelo escopo e pelas
//  propagações permitidas, incluindo cultos adicionados depois quando o escopo
//  é o ciclo inteiro, e cada item derivado aponta para a origem e caminho de
//  propagação."
//
// Validates: Requirements 4.9, 4.10, 4.11
//
// Estratégia: geradores inteligentes constroem um conjunto de pessoas com um
// grafo de vínculos vigente (alguns tipos propagam, outros não; alguns fora de
// vigência), uma lista de cultos ativos/removidos para um período, e uma ou mais
// indisponibilidades válidas de escopos variados (`dates`, `interval`,
// `whole-cycle`). Sobre esse universo verificamos:
//
//   P12.a  RASTREABILIDADE DIRETA/PROPAGADA — para cada item efetivo, a origem
//          (`sourceUnavailabilityId`) existe; `propagationPath` vazio ⇔ a pessoa
//          é a própria origem (efeito direto); caminho não vazio ⇔ propagado, e
//          o caminho é uma cadeia conectada de vínculos vigentes que PROPAGAM,
//          partindo da origem até a pessoa (4.11).
//
//   P12.b  EXATIDÃO DO CONJUNTO — o conjunto `(origem, pessoa, data)` produzido
//          é EXATAMENTE o esperado por um oráculo independente: para cada
//          indisponibilidade, resolver o escopo contra os cultos ativos
//          correntes (oráculo próprio, sem reusar a lógica sob teste) e alcançar
//          por BFS não direcionado o fecho de pessoas via vínculos que propagam
//          e vigentes (4.9, 4.10, 4.11). Sem itens faltando nem sobrando.
//
//   P12.c  CULTO ADICIONADO DEPOIS (4.10) — acrescentar um culto extraordinário
//          ao mesmo período faz o escopo `whole-cycle` alcançar a nova data para
//          toda pessoa já alcançada, preservando exatamente os efeitos anteriores.
//
//   P12.d  MATRIZ PESSOA × DATA (4.11) — a matriz mostra exatamente os pares com
//          efeito; cada célula tem `direct`/`propagated` coerentes com seus
//          efeitos, e a união de todas as células é igual ao conjunto efetivo.
//
// O oráculo NÃO chama `resolveScopeDates`/`deriveEffectiveUnavailabilities`: ele
// reimplementa, de forma simples e independente, a seleção de datas por escopo e
// o alcance por vínculos, para servir de referência de corretude.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildMatrix,
  deriveEffectiveUnavailabilities,
  type EffectiveUnavailability,
  type PropagationConfig,
} from './unavailability';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  IsoDate,
  Person,
  PersonLink,
  Service,
  Unavailability,
  UnavailabilityScope,
  Uuid,
} from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath aparecem em falha.
const RUNS = 300;

const PERIOD_YEAR = 2025;
const PERIOD_MONTH = 1; // janeiro: 31 dias, facilita datas 2025-01-DD.

// --------------------------------------------------------------------------
// Helpers de construção (fixtures determinísticas por índice).
// --------------------------------------------------------------------------

const personId = (i: number): Uuid =>
  `00000000-0000-4000-8000-9e${String(i).padStart(10, '0')}` as Uuid;

const linkId = (i: number): Uuid =>
  `00000000-0000-4000-8000-11${String(i).padStart(10, '0')}` as Uuid;

const unavId = (i: number): Uuid =>
  `00000000-0000-4000-8000-ff${String(i).padStart(10, '0')}` as Uuid;

// Dois tipos de vínculo: um que propaga, outro que não.
const TYPE_PROPAGATES = '00000000-0000-4000-8000-00000000aaaa' as Uuid;
const TYPE_INERT = '00000000-0000-4000-8000-00000000bbbb' as Uuid;

const isoDay = (day: number): IsoDate =>
  `${PERIOD_YEAR}-${String(PERIOD_MONTH).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const makeService = (day: number, removed: boolean): Service => {
  const base: Service = {
    schemaVersion: SCHEMA_VERSION,
    id: `00000000-0000-4000-8000-5e${String(day).padStart(10, '0')}` as Uuid,
    cycleId: unavId(0),
    date: isoDay(day),
    computedWeekday: 'wednesday',
    kind: 'regular',
    externalInputIds: [],
  };
  if (removed) {
    return {
      ...base,
      removed: { reason: 'x', removedAt: '2025-01-01T00:00:00Z', operatorId: personId(0) },
    };
  }
  return base;
};

// --------------------------------------------------------------------------
// Geradores inteligentes.
// --------------------------------------------------------------------------

// Vínculo de uma pessoa `i` para outra pessoa `j` (i != j), com tipo e vigência.
interface EdgeSpec {
  from: number;
  to: number;
  type: Uuid;
  active: boolean; // vigente no instante avaliado?
}

// Grafo de vínculos: para N pessoas, um conjunto arbitrário de arestas.
const edgeSpecArb = (n: number): fc.Arbitrary<EdgeSpec[]> =>
  fc.array(
    fc.record({
      from: fc.integer({ min: 0, max: n - 1 }),
      to: fc.integer({ min: 0, max: n - 1 }),
      type: fc.constantFrom(TYPE_PROPAGATES, TYPE_INERT),
      active: fc.boolean(),
    }),
    { minLength: 0, maxLength: n * 2 },
  );

// O instante de avaliação (fixo) para vigência dos vínculos.
const AT: IsoDate = '2025-01-15';

// Constrói o array de Person com os vínculos. Um vínculo "não vigente" recebe
// `validUntil` anterior a AT; um vigente recebe `validFrom` <= AT.
function buildPeople(n: number, edges: EdgeSpec[]): Person[] {
  const linksByPerson = new Map<number, PersonLink[]>();
  edges.forEach((e, idx) => {
    if (e.from === e.to) return; // ignora self-link no grafo de teste
    const list = linksByPerson.get(e.from) ?? [];
    list.push({
      id: linkId(idx),
      typeId: e.type,
      otherPersonId: personId(e.to),
      validFrom: '2025-01-01',
      ...(e.active ? {} : { validUntil: '2025-01-10' }), // expira antes de AT
    });
    linksByPerson.set(e.from, list);
  });
  const people: Person[] = [];
  for (let i = 0; i < n; i++) {
    people.push({
      schemaVersion: SCHEMA_VERSION,
      id: personId(i),
      canonicalName: `Pessoa ${i}`,
      aliases: [],
      participation: 'active',
      publicContactAuthorizationIds: [],
      capabilityIds: [],
      allowedWeekdays: [],
      leaves: [],
      links: linksByPerson.get(i) ?? [],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    });
  }
  return people;
}

// Escopo arbitrário usando apenas dias dentro do período (1..31).
const scopeArb: fc.Arbitrary<UnavailabilityScope> = fc.oneof(
  fc
    .uniqueArray(fc.integer({ min: 1, max: 28 }), { minLength: 1, maxLength: 6 })
    .map((days) => ({ type: 'dates' as const, dates: days.map(isoDay) })),
  fc
    .tuple(fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 28 }))
    .map(([a, b]) => ({ type: 'interval' as const, start: isoDay(Math.min(a, b)), end: isoDay(Math.max(a, b)) })),
  fc.constant({ type: 'whole-cycle' as const }),
);

interface Universe {
  people: Person[];
  n: number;
  services: Service[];
  activeDays: number[]; // dias com culto ativo
  unavailabilities: Unavailability[];
  propagation: PropagationConfig;
}

const universeArb: fc.Arbitrary<Universe> = fc
  .integer({ min: 1, max: 5 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      edges: edgeSpecArb(n),
      // Dias com culto: subconjunto não vazio de 1..28, mais flags de removido.
      serviceDays: fc.uniqueArray(fc.integer({ min: 1, max: 28 }), {
        minLength: 1,
        maxLength: 8,
      }),
      removedMask: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
      // 1..3 indisponibilidades, cada uma de uma pessoa e um escopo.
      unavs: fc.array(
        fc.record({ person: fc.integer({ min: 0, max: n - 1 }), scope: scopeArb }),
        { minLength: 1, maxLength: 3 },
      ),
    }),
  )
  .map(({ n, edges, serviceDays, removedMask, unavs }) => {
    const sortedDays = [...serviceDays].sort((a, b) => a - b);
    const services = sortedDays.map((day, i) => makeService(day, removedMask[i] === true));
    const activeDays = services.filter((s) => s.removed === undefined).map((s) => Number(s.date.slice(-2)));
    const people = buildPeople(n, edges);
    const unavailabilities: Unavailability[] = unavs.map((spec, i) => ({
      schemaVersion: SCHEMA_VERSION,
      id: unavId(i + 1),
      cycleId: unavId(0),
      personId: personId(spec.person),
      scope: spec.scope,
      source: 'teste',
      createdAt: '2025-01-01T00:00:00Z',
    }));
    return {
      people,
      n,
      services,
      activeDays,
      unavailabilities,
      propagation: { propagatingLinkTypeIds: new Set([TYPE_PROPAGATES]), at: AT },
    };
  });

// --------------------------------------------------------------------------
// Oráculo independente (NÃO reusa a lógica sob teste).
// --------------------------------------------------------------------------

/** Datas de cultos ativos alcançadas por um escopo, segundo o oráculo. */
function oracleScopeDates(scope: UnavailabilityScope, activeDates: Set<IsoDate>): IsoDate[] {
  const all = [...activeDates];
  let selected: IsoDate[];
  switch (scope.type) {
    case 'dates': {
      const set = new Set(scope.dates);
      selected = all.filter((d) => set.has(d));
      break;
    }
    case 'interval':
      selected = all.filter((d) => d >= scope.start && d <= scope.end);
      break;
    case 'whole-cycle':
      selected = all;
      break;
  }
  return selected.sort();
}

/**
 * Fecho de pessoas alcançadas a partir de `origin` por vínculos NÃO direcionados
 * que propagam e estão vigentes em AT. Retorna o conjunto de índices de pessoa.
 */
function oracleReach(origin: number, people: Person[]): Set<number> {
  const indexById = new Map<Uuid, number>();
  people.forEach((p, i) => indexById.set(p.id, i));

  // Lista de adjacência não direcionada considerando só vínculos que propagam
  // e vigentes em AT.
  const adj = new Map<number, Set<number>>();
  const addEdge = (a: number, b: number): void => {
    const s = adj.get(a) ?? new Set<number>();
    s.add(b);
    adj.set(a, s);
  };
  people.forEach((p, i) => {
    for (const l of p.links) {
      if (l.typeId !== TYPE_PROPAGATES) continue;
      // Vigência: validFrom <= AT e (sem validUntil OU AT <= validUntil).
      if (AT < l.validFrom) continue;
      if (l.validUntil !== undefined && AT > l.validUntil) continue;
      const j = indexById.get(l.otherPersonId);
      if (j === undefined) continue;
      addEdge(i, j);
      addEdge(j, i);
    }
  });

  const reached = new Set<number>([origin]);
  const queue = [origin];
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    for (const nb of adj.get(cur) ?? []) {
      if (!reached.has(nb)) {
        reached.add(nb);
        queue.push(nb);
      }
    }
  }
  return reached;
}

/** Conjunto esperado de chaves `origem\0pessoa\0data` segundo o oráculo. */
function oracleEffectiveKeys(universe: Universe): Set<string> {
  const indexById = new Map<Uuid, number>();
  universe.people.forEach((p, i) => indexById.set(p.id, i));
  const activeDates = new Set(
    universe.services.filter((s) => s.removed === undefined).map((s) => s.date),
  );
  const keys = new Set<string>();
  for (const un of universe.unavailabilities) {
    const dates = oracleScopeDates(un.scope, activeDates);
    if (dates.length === 0) continue;
    const originIdx = indexById.get(un.personId);
    if (originIdx === undefined) continue;
    const reached = oracleReach(originIdx, universe.people);
    for (const pIdx of reached) {
      for (const d of dates) {
        keys.add(`${un.id}\u0000${universe.people[pIdx]?.id ?? ''}\u0000${d}`);
      }
    }
  }
  return keys;
}

const effectKey = (e: EffectiveUnavailability): string =>
  `${e.sourceUnavailabilityId}\u0000${e.personId}\u0000${e.date}`;

/**
 * Valida que `path` é uma cadeia conectada de vínculos vigentes que propagam,
 * partindo de `originId` e terminando em `targetId`. Oráculo estrutural do 4.11.
 */
function pathIsValidChain(
  path: EffectiveUnavailability['propagationPath'],
  originId: Uuid,
  targetId: Uuid,
  people: Person[],
): boolean {
  if (path.length === 0) return originId === targetId;
  // O primeiro salto parte da origem; cada salto encadeia no anterior.
  if (path[0]?.fromPersonId !== originId) return false;
  for (let k = 0; k < path.length; k++) {
    const step = path[k];
    if (step === undefined) return false;
    if (k > 0 && path[k - 1]?.toPersonId !== step.fromPersonId) return false;
    // O vínculo deve existir, propagar e ser vigente, em qualquer sentido.
    const a = people.find((p) => p.id === step.fromPersonId);
    const b = people.find((p) => p.id === step.toPersonId);
    const linkMatches = (person?: Person, other?: Uuid): boolean =>
      (person?.links ?? []).some(
        (l) =>
          l.id === step.linkId &&
          l.typeId === TYPE_PROPAGATES &&
          l.otherPersonId === other &&
          AT >= l.validFrom &&
          (l.validUntil === undefined || AT <= l.validUntil),
      );
    if (!linkMatches(a, step.toPersonId) && !linkMatches(b, step.fromPersonId)) return false;
  }
  return path[path.length - 1]?.toPersonId === targetId;
}

// --------------------------------------------------------------------------
// Propriedade.
// --------------------------------------------------------------------------

describe('Property 12: indisponibilidade efetiva é rastreável (4.9, 4.10, 4.11)', () => {
  it('o conjunto efetivo é exatamente o alcançado pelo escopo e propagações, com origem e caminho (P12.a, P12.b)', () => {
    fc.assert(
      fc.property(universeArb, (universe) => {
        const effects = deriveEffectiveUnavailabilities({
          unavailabilities: universe.unavailabilities,
          services: universe.services,
          people: universe.people,
          propagation: universe.propagation,
        });

        // (P12.b) Exatidão: conjunto de chaves igual ao oráculo, sem sobra/falta.
        const actualKeys = new Set(effects.map(effectKey));
        const expectedKeys = oracleEffectiveKeys(universe);
        expect(actualKeys).toEqual(expectedKeys);
        // Sem duplicatas de (origem, pessoa, data).
        expect(actualKeys.size).toBe(effects.length);

        // (P12.a) Rastreabilidade: cada item aponta para a origem e carrega um
        // caminho estruturalmente válido; vazio ⇔ direto (pessoa == origem).
        const unavById = new Map(universe.unavailabilities.map((u) => [u.id, u]));
        for (const e of effects) {
          const origin = unavById.get(e.sourceUnavailabilityId);
          expect(origin).toBeDefined();
          if (origin === undefined) continue;
          const isDirect = e.propagationPath.length === 0;
          expect(isDirect).toBe(e.personId === origin.personId);
          expect(
            pathIsValidChain(e.propagationPath, origin.personId, e.personId, universe.people),
          ).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('whole-cycle alcança culto adicionado depois para toda pessoa já alcançada, preservando os efeitos anteriores (P12.c, 4.10)', () => {
    // Universo restrito a pelo menos uma indisponibilidade `whole-cycle`, para
    // garantir que o caso 4.10 seja exercitado.
    const universeWithWhole = universeArb
      .map((universe) => {
        const unavailabilities = universe.unavailabilities.map((u, i) =>
          i === 0 ? { ...u, scope: { type: 'whole-cycle' as const } } : u,
        );
        return { ...universe, unavailabilities };
      })
      // Precisa existir um dia livre (sem culto) no período para inserir o extra.
      .filter((universe) => universe.activeDays.length < 28);

    fc.assert(
      fc.property(universeWithWhole, (universe) => {
        const baseInput = {
          unavailabilities: universe.unavailabilities,
          services: universe.services,
          people: universe.people,
          propagation: universe.propagation,
        };
        const before = deriveEffectiveUnavailabilities(baseInput);

        // Escolhe um dia (1..28) sem culto para o novo culto extraordinário.
        const occupied = new Set(universe.services.map((s) => Number(s.date.slice(-2))));
        let freeDay = -1;
        for (let d = 1; d <= 28; d++) {
          if (!occupied.has(d)) {
            freeDay = d;
            break;
          }
        }
        fc.pre(freeDay > 0);
        const extra = makeService(freeDay, false);
        const after = deriveEffectiveUnavailabilities({
          ...baseInput,
          services: [...universe.services, extra],
        });

        const beforeKeys = new Set(before.map(effectKey));
        const afterKeys = new Set(after.map(effectKey));

        // Os efeitos anteriores são preservados integralmente.
        for (const k of beforeKeys) expect(afterKeys.has(k)).toBe(true);

        // A indisponibilidade whole-cycle (índice 0) alcança a nova data para
        // cada pessoa que ela já alcançava em alguma data anterior.
        const wholeUnav = universe.unavailabilities[0];
        if (wholeUnav !== undefined) {
          const personsReachedBefore = new Set(
            before
              .filter((e) => e.sourceUnavailabilityId === wholeUnav.id)
              .map((e) => e.personId),
          );
          const newDate = extra.date;
          for (const pid of personsReachedBefore) {
            const expectedKey = `${wholeUnav.id}\u0000${pid}\u0000${newDate}`;
            expect(afterKeys.has(expectedKey)).toBe(true);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('a matriz pessoa × data mostra exatamente os pares com efeito, com direct/propagated coerentes (P12.d, 4.11)', () => {
    fc.assert(
      fc.property(universeArb, (universe) => {
        const input = {
          unavailabilities: universe.unavailabilities,
          services: universe.services,
          people: universe.people,
          propagation: universe.propagation,
        };
        const effects = deriveEffectiveUnavailabilities(input);
        const matrix = buildMatrix(input);

        // Pares (pessoa, data) do conjunto efetivo.
        const effectPairs = new Set(effects.map((e) => `${e.personId}\u0000${e.date}`));
        const cellPairs = new Set(matrix.cells.map((c) => `${c.personId}\u0000${c.date}`));
        expect(cellPairs).toEqual(effectPairs);

        // A união dos efeitos das células é igual ao conjunto efetivo (por chave
        // origem/pessoa/data), sem perdas nem acréscimos.
        const cellEffectKeys = new Set(
          matrix.cells.flatMap((c) => c.effects.map(effectKey)),
        );
        const allEffectKeys = new Set(effects.map(effectKey));
        expect(cellEffectKeys).toEqual(allEffectKeys);

        // Coerência de cada célula: direct/propagated refletem seus efeitos, e
        // todos os seus efeitos incidem sobre o próprio par (pessoa, data).
        for (const cell of matrix.cells) {
          const hasDirect = cell.effects.some((e) => e.propagationPath.length === 0);
          const hasPropagated = cell.effects.some((e) => e.propagationPath.length > 0);
          expect(cell.direct).toBe(hasDirect);
          expect(cell.propagated).toBe(hasPropagated);
          expect(cell.effects.length).toBeGreaterThan(0);
          for (const e of cell.effects) {
            expect(e.personId).toBe(cell.personId);
            expect(e.date).toBe(cell.date);
          }
        }

        // Eixos da matriz contêm exatamente as pessoas e datas com efeito.
        expect(new Set(matrix.personIds)).toEqual(new Set(effects.map((e) => e.personId)));
        expect(new Set(matrix.dates)).toEqual(new Set(effects.map((e) => e.date)));
      }),
      { numRuns: RUNS },
    );
  });
});
