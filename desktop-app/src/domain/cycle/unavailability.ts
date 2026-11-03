// Indisponibilidades e propagacao rastreavel (design.md -> "Data Models" ->
// Unavailability / EffectiveUnavailability; "Components and Interfaces" ->
// CycleService). Tarefa 4.2 do plano de implementacao.
//
// TypeScript puro, sem I/O, deterministico. Toda operacao:
//  - nunca muta a entrada (retorna um novo valor em caso de sucesso);
//  - retorna um resultado tipado; em falha, preserva o estado anterior
//    (ausencia de mutacao).
//
// Requisitos cobertos:
//  4.9  registrar uma Indisponibilidade exige exatamente uma Pessoa_Canonica e
//       uma ou mais datas do Ciclo_Mensal OU um intervalo inclusivo com data
//       inicial e data final.
//  4.10 indisponibilidade para o periodo inteiro (`whole-cycle`) aplica a
//       restricao a todas as datas existentes OU adicionadas posteriormente ao
//       mesmo Ciclo_Mensal (inclui cultos extraordinarios inseridos depois).
//  4.11 quando um vinculo propaga uma Indisponibilidade, identificar a
//       Indisponibilidade de origem e mostrar cada Pessoa_Canonica e cada data
//       afetada pela propagacao (origem + caminho de vinculos).
//  4.16 indisponibilidade com data fora do Ciclo_Mensal OU intervalo cuja data
//       final seja anterior a data inicial e rejeitada; as indisponibilidades
//       existentes sao preservadas e a data/intervalo invalido e indicado.
//  4.17 (parceiro) a alteracao/remocao de uma Indisponibilidade e auditavel; o
//       diff real e a auditoria sao responsabilidade da camada de comandos
//       (ver commands/*). Este modulo expoe operacoes puras e deterministicas
//       que produzem o estado anterior/posterior comparavel por essa camada.
//
// A "matriz pessoa x data" (saida de UI) e derivada aqui de forma pura: para
// cada par (pessoa, data) efetivo, indica se o efeito e direto ou propagado e,
// quando propagado, a Indisponibilidade de origem e o caminho de vinculos.

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
import { parseIsoDate, toPeriod } from './calendar';

// --------------------------------------------------------------------------
// Resultado tipado
// --------------------------------------------------------------------------

export type UnavailabilityErrorCode =
  | 'no-dates' // escopo `dates` vazio (4.9)
  | 'date-invalid' // data civil malformada
  | 'date-not-in-period' // data fora do Ciclo_Mensal (4.16)
  | 'interval-invalid' // data final anterior a inicial (4.16)
  | 'person-not-found' // pessoa inexistente no cadastro fornecido
  | 'not-found'; // indisponibilidade inexistente (remocao/alteracao)

export interface UnavailabilityError {
  code: UnavailabilityErrorCode;
  /** Mensagem legivel em portugues. */
  message: string;
  /** Data ou intervalo invalido, quando aplicavel (Requisito 4.16). */
  offendingValue?: string;
}

export type UnavailabilityResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: UnavailabilityError };

const ok = <T>(value: T): UnavailabilityResult<T> => ({ ok: true, value });
const fail = <T>(error: UnavailabilityError): UnavailabilityResult<T> => ({ ok: false, error });

// --------------------------------------------------------------------------
// Registro de uma indisponibilidade (Requisitos 4.9, 4.16)
// --------------------------------------------------------------------------

export interface RegisterUnavailabilityInput {
  id: Uuid;
  cycleId: Uuid;
  personId: Uuid;
  scope: UnavailabilityScope;
  source: string;
  now: string;
}

/**
 * Contexto do ciclo necessario para validar a indisponibilidade: o periodo
 * (`YYYY-MM`) e os cultos ATIVOS (nao removidos). As datas do escopo `dates` e
 * as extremidades de `interval` devem pertencer ao periodo do ciclo
 * (Requisito 4.16). O escopo `whole-cycle` nao enumera datas aqui: ele e
 * resolvido dinamicamente contra a lista de cultos no momento da derivacao
 * (Requisito 4.10), alcancando cultos adicionados depois.
 */
export interface CycleContext {
  /** Periodo canonico `YYYY-MM` do ciclo. */
  period: string;
}

/**
 * Valida e constroi uma Indisponibilidade (Requisitos 4.9, 4.16). Em falha,
 * nenhum efeito e produzido (o chamador preserva a colecao existente).
 *
 * Regras de validacao:
 *  - `dates`: ao menos uma data (4.9); toda data valida e pertencente ao
 *    periodo do ciclo (4.16).
 *  - `interval`: inicio e fim validos e pertencentes ao periodo; a data final
 *    nao pode ser anterior a inicial (intervalo invertido, 4.16).
 *  - `whole-cycle`: sempre valido estruturalmente; alcanca todas as datas
 *    existentes ou adicionadas depois (4.10), resolvido na derivacao.
 *
 * A validacao de datas usa o CALENDARIO (periodo), e nao a lista de cultos:
 * uma data valida do periodo pode ainda nao ter culto; a correspondencia com
 * cultos ocorre na derivacao do efeito.
 */
export function buildUnavailability(
  input: RegisterUnavailabilityInput,
  ctx: CycleContext,
): UnavailabilityResult<Unavailability> {
  const scopeCheck = validateScope(input.scope, ctx.period);
  if (!scopeCheck.ok) return fail(scopeCheck.error);

  const unavailability: Unavailability = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    cycleId: input.cycleId,
    personId: input.personId,
    scope: scopeCheck.value,
    source: input.source,
    createdAt: input.now,
  };
  return ok(unavailability);
}

/**
 * Valida o escopo e devolve uma forma normalizada:
 *  - `dates`: deduplicada e ordenada cronologicamente (ordem sem semantica);
 *  - `interval`/`whole-cycle`: inalterados.
 */
function validateScope(
  scope: UnavailabilityScope,
  period: string,
): UnavailabilityResult<UnavailabilityScope> {
  switch (scope.type) {
    case 'dates': {
      if (scope.dates.length === 0) {
        return fail({
          code: 'no-dates',
          message: 'informe ao menos uma data do Ciclo_Mensal para a indisponibilidade',
        });
      }
      for (const d of scope.dates) {
        const inPeriod = dateInPeriod(d, period);
        if (!inPeriod.ok) return fail(inPeriod.error);
      }
      // Dedup + ordena (a ordem das datas nao carrega semantica).
      const unique = [...new Set(scope.dates)].sort(compareIso);
      return ok({ type: 'dates', dates: unique });
    }
    case 'interval': {
      const startCheck = dateInPeriod(scope.start, period);
      if (!startCheck.ok) return fail(startCheck.error);
      const endCheck = dateInPeriod(scope.end, period);
      if (!endCheck.ok) return fail(endCheck.error);
      if (compareIso(scope.end, scope.start) < 0) {
        // Intervalo invertido (Requisito 4.16).
        return fail({
          code: 'interval-invalid',
          message: `intervalo invertido: a data final (${scope.end}) e anterior a inicial (${scope.start})`,
          offendingValue: `${scope.start}..${scope.end}`,
        });
      }
      return ok({ type: 'interval', start: scope.start, end: scope.end });
    }
    case 'whole-cycle':
      return ok({ type: 'whole-cycle' });
    default: {
      const never: never = scope;
      throw new Error(`escopo de indisponibilidade invalido: ${JSON.stringify(never)}`);
    }
  }
}

/** Verifica que uma data e civilmente valida e pertence ao periodo do ciclo. */
function dateInPeriod(date: IsoDate, period: string): UnavailabilityResult<true> {
  const parsed = parseIsoDate(date);
  if (parsed === null) {
    return fail({
      code: 'date-invalid',
      message: `data invalida: ${date}`,
      offendingValue: date,
    });
  }
  if (toPeriod(parsed.year, parsed.month) !== period) {
    return fail({
      code: 'date-not-in-period',
      message: `a data ${date} nao pertence ao periodo ${period} do Ciclo_Mensal`,
      offendingValue: date,
    });
  }
  return ok(true);
}

/** Compara duas datas ISO `YYYY-MM-DD` lexicograficamente (= cronologicamente). */
function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --------------------------------------------------------------------------
// Resolucao do escopo contra a lista de cultos (Requisito 4.10)
// --------------------------------------------------------------------------

/**
 * Datas de cultos ATIVOS (nao removidos) alcancadas pelo escopo da
 * indisponibilidade, no momento da derivacao. Resolver `whole-cycle` aqui e o
 * que garante o Requisito 4.10: a restricao alcanca as datas existentes e as
 * adicionadas depois (inclusive cultos extraordinarios), porque a derivacao
 * sempre usa a lista corrente de cultos.
 *
 * Para `dates`/`interval`, somente as datas que de fato possuem um culto ativo
 * sao efetivas (uma indisponibilidade so restringe dias com culto).
 */
export function resolveScopeDates(
  scope: UnavailabilityScope,
  services: readonly Service[],
): IsoDate[] {
  const activeDates = new Set(
    services.filter((s) => s.removed === undefined).map((s) => s.date),
  );

  let candidate: (date: IsoDate) => boolean;
  switch (scope.type) {
    case 'dates': {
      const set = new Set(scope.dates);
      candidate = (d) => set.has(d);
      break;
    }
    case 'interval': {
      candidate = (d) => compareIso(d, scope.start) >= 0 && compareIso(d, scope.end) <= 0;
      break;
    }
    case 'whole-cycle':
      candidate = () => true;
      break;
    default: {
      const never: never = scope;
      throw new Error(`escopo invalido: ${JSON.stringify(never)}`);
    }
  }

  return [...activeDates].filter(candidate).sort(compareIso);
}

// --------------------------------------------------------------------------
// Propagacao por vinculos (Requisito 4.11)
// --------------------------------------------------------------------------

/** Um passo do caminho de propagacao (um vinculo percorrido). */
export interface PropagationStep {
  linkId: Uuid;
  fromPersonId: Uuid;
  toPersonId: Uuid;
}

/**
 * Efeito efetivo de uma indisponibilidade sobre um par (pessoa, data). Quando
 * `propagationPath` e vazio, o efeito e direto (a propria pessoa da origem).
 * Quando nao vazio, o efeito foi propagado por vinculos a partir da origem.
 */
export interface EffectiveUnavailability {
  sourceUnavailabilityId: Uuid;
  personId: Uuid;
  date: IsoDate;
  propagationPath: PropagationStep[];
}

/**
 * Configuracao da propagacao. A propagacao de indisponibilidade por vinculos e
 * governada pelo Conjunto_de_Regras_Ativo (design.md): somente tipos de vinculo
 * explicitamente marcados propagam. Para manter este modulo puro e
 * desacoplado das regras, o chamador informa o conjunto de `typeId` que
 * propaga. Se vazio, nenhuma propagacao ocorre (somente efeitos diretos).
 */
export interface PropagationConfig {
  /** Tipos de vinculo (por `typeId`) que propagam indisponibilidade. */
  propagatingLinkTypeIds: ReadonlySet<Uuid>;
  /**
   * Instante civil (`YYYY-MM-DD`) usado para avaliar a vigencia dos vinculos.
   * Um vinculo so propaga quando vigente nesse instante (validFrom <= at e,
   * se houver validUntil, at <= validUntil). Quando ausente, a vigencia nao e
   * verificada (todos os vinculos do tipo que propaga sao considerados).
   */
  at?: IsoDate;
}

/** `true` quando o vinculo esta vigente no instante `at` (inclusivo). */
function linkActiveAt(link: PersonLink, at?: IsoDate): boolean {
  if (at === undefined) return true;
  if (compareIso(at, link.validFrom) < 0) return false;
  if (link.validUntil !== undefined && compareIso(at, link.validUntil) > 0) return false;
  return true;
}

/**
 * Constroi a lista de adjacencia da propagacao: para cada pessoa de origem, os
 * vinculos (vigentes e de tipo que propaga) que levam a outra pessoa. A
 * propagacao e tratada como NAO direcionada: um vinculo entre A e B propaga
 * nos dois sentidos, porque uma indisponibilidade compartilhada (ex.: casal,
 * transporte comum) afeta ambos independentemente de qual extremidade declarou
 * o vinculo. Isso tambem garante alcance quando so uma das pessoas registra o
 * vinculo no cadastro.
 */
function buildAdjacency(
  people: readonly Person[],
  config: PropagationConfig,
): Map<Uuid, PropagationStep[]> {
  const adjacency = new Map<Uuid, PropagationStep[]>();
  const addEdge = (from: Uuid, to: Uuid, linkId: Uuid): void => {
    const list = adjacency.get(from) ?? [];
    // Evita arestas duplicadas (mesmo linkId, mesmo sentido).
    if (!list.some((e) => e.linkId === linkId && e.toPersonId === to)) {
      list.push({ linkId, fromPersonId: from, toPersonId: to });
      adjacency.set(from, list);
    }
  };

  for (const person of people) {
    for (const link of person.links) {
      if (!config.propagatingLinkTypeIds.has(link.typeId)) continue;
      if (!linkActiveAt(link, config.at)) continue;
      // Aresta nos dois sentidos (propagacao nao direcionada).
      addEdge(person.id, link.otherPersonId, link.id);
      addEdge(link.otherPersonId, person.id, link.id);
    }
  }

  // Ordena as arestas de cada no para percurso determinista.
  for (const [key, list] of adjacency) {
    adjacency.set(
      key,
      [...list].sort((a, b) =>
        a.toPersonId < b.toPersonId
          ? -1
          : a.toPersonId > b.toPersonId
            ? 1
            : a.linkId < b.linkId
              ? -1
              : a.linkId > b.linkId
                ? 1
                : 0,
      ),
    );
  }
  return adjacency;
}

/**
 * Alcanca, por BFS a partir de `originPersonId`, o conjunto de pessoas
 * afetadas pela propagacao, com o CAMINHO MAIS CURTO (menos vinculos) ate cada
 * uma. A origem tem caminho vazio (efeito direto). Nenhuma pessoa aparece mais
 * de uma vez; nao ha ciclos (visitados sao marcados).
 */
function reachByLinks(
  originPersonId: Uuid,
  adjacency: Map<Uuid, PropagationStep[]>,
): Map<Uuid, PropagationStep[]> {
  const paths = new Map<Uuid, PropagationStep[]>();
  paths.set(originPersonId, []);
  const queue: Uuid[] = [originPersonId];

  while (queue.length > 0) {
    const current = queue.shift() as Uuid;
    const currentPath = paths.get(current) as PropagationStep[];
    const edges = adjacency.get(current) ?? [];
    for (const edge of edges) {
      if (paths.has(edge.toPersonId)) continue; // ja alcancado por caminho mais curto
      paths.set(edge.toPersonId, [...currentPath, edge]);
      queue.push(edge.toPersonId);
    }
  }
  return paths;
}

// --------------------------------------------------------------------------
// Derivacao do conjunto efetivo (Requisitos 4.10, 4.11)
// --------------------------------------------------------------------------

export interface DeriveEffectiveInput {
  unavailabilities: readonly Unavailability[];
  services: readonly Service[];
  people: readonly Person[];
  propagation: PropagationConfig;
}

/**
 * Deriva o conjunto EFETIVO de indisponibilidades: para cada indisponibilidade
 * registrada, resolve as datas do escopo contra os cultos ativos correntes
 * (4.10) e, a partir da pessoa de origem, propaga por vinculos vigentes do tipo
 * configurado (4.11). Cada item efetivo aponta para a Indisponibilidade de
 * origem e carrega o caminho de propagacao (vazio = direto).
 *
 * A saida e deterministica: ordenada por (origem, pessoa, data) e sem
 * duplicatas de (origem, pessoa, data).
 */
export function deriveEffectiveUnavailabilities(
  input: DeriveEffectiveInput,
): EffectiveUnavailability[] {
  const adjacency = buildAdjacency(input.people, input.propagation);
  const effects: EffectiveUnavailability[] = [];
  const seen = new Set<string>();

  for (const u of input.unavailabilities) {
    const dates = resolveScopeDates(u.scope, input.services);
    if (dates.length === 0) continue;

    const reach = reachByLinks(u.personId, adjacency);
    for (const [personId, path] of reach) {
      for (const date of dates) {
        const key = `${u.id}\u0000${personId}\u0000${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        effects.push({
          sourceUnavailabilityId: u.id,
          personId,
          date,
          propagationPath: path,
        });
      }
    }
  }

  effects.sort(compareEffect);
  return effects;
}

function compareEffect(a: EffectiveUnavailability, b: EffectiveUnavailability): number {
  if (a.sourceUnavailabilityId !== b.sourceUnavailabilityId) {
    return a.sourceUnavailabilityId < b.sourceUnavailabilityId ? -1 : 1;
  }
  if (a.personId !== b.personId) return a.personId < b.personId ? -1 : 1;
  return compareIso(a.date, b.date);
}

// --------------------------------------------------------------------------
// Matriz pessoa x data (saida de UI, Requisito 4.11)
// --------------------------------------------------------------------------

/** Uma celula da matriz: o efeito sobre um par (pessoa, data). */
export interface MatrixCell {
  personId: Uuid;
  date: IsoDate;
  /** `true` quando ha ao menos um efeito direto (origem = a propria pessoa). */
  direct: boolean;
  /** `true` quando ha ao menos um efeito propagado por vinculos. */
  propagated: boolean;
  /** Todos os efeitos que incidem nesta celula (direto e/ou propagado). */
  effects: EffectiveUnavailability[];
}

/** A matriz pessoa x data: celulas efetivas e seus eixos ordenados. */
export interface UnavailabilityMatrix {
  /** Pessoas (eixo das linhas), em ordem estavel. */
  personIds: Uuid[];
  /** Datas (eixo das colunas), em ordem cronologica. */
  dates: IsoDate[];
  /** Celulas com efeito, indexaveis por `cellKey(personId, date)`. */
  cells: MatrixCell[];
}

/** Chave estavel de uma celula (pessoa, data). */
export function cellKey(personId: Uuid, date: IsoDate): string {
  return `${personId}\u0000${date}`;
}

/**
 * Constroi a matriz pessoa x data a partir dos efeitos derivados. Cada celula
 * exibe EXATAMENTE os efeitos (diretos e propagados) que incidem sobre o par,
 * de forma que a UI possa mostrar a origem e o caminho de cada efeito
 * (Requisito 4.11). Celulas sem efeito nao aparecem.
 */
export function buildUnavailabilityMatrix(
  effects: readonly EffectiveUnavailability[],
): UnavailabilityMatrix {
  const byCell = new Map<string, MatrixCell>();
  const personSet = new Set<Uuid>();
  const dateSet = new Set<IsoDate>();

  for (const e of effects) {
    personSet.add(e.personId);
    dateSet.add(e.date);
    const key = cellKey(e.personId, e.date);
    const existing = byCell.get(key);
    const isDirect = e.propagationPath.length === 0;
    if (existing === undefined) {
      byCell.set(key, {
        personId: e.personId,
        date: e.date,
        direct: isDirect,
        propagated: !isDirect,
        effects: [e],
      });
    } else {
      existing.direct = existing.direct || isDirect;
      existing.propagated = existing.propagated || !isDirect;
      existing.effects.push(e);
    }
  }

  // Ordena os efeitos de cada celula de forma determinista.
  for (const cell of byCell.values()) {
    cell.effects.sort(compareEffect);
  }

  const personIds = [...personSet].sort(compareIso);
  const dates = [...dateSet].sort(compareIso);
  const cells = [...byCell.values()].sort((a, b) => {
    if (a.personId !== b.personId) return a.personId < b.personId ? -1 : 1;
    return compareIso(a.date, b.date);
  });

  return { personIds, dates, cells };
}

/**
 * Atalho de conveniencia: deriva os efeitos e constroi a matriz em uma chamada.
 */
export function buildMatrix(input: DeriveEffectiveInput): UnavailabilityMatrix {
  return buildUnavailabilityMatrix(deriveEffectiveUnavailabilities(input));
}
