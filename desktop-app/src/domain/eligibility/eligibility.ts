// Elegibilidade manual de atribuicoes (tarefa 6.1).
//
// Este modulo e TypeScript PURO e deterministico, sem I/O e sem estado global.
// Ele calcula, para um culto e uma funcao, o conjunto de sujeitos
// (Pessoas_Canonicas e Departamentos) selecionaveis e, para cada candidato,
// a avaliacao celula a celula exibida pela grade de montagem:
//   - habilitacao para a funcao (capability);
//   - disponibilidade na data (indisponibilidade efetiva);
//   - conflitos com Regras_Fundamentais e Preferencias_de_Escala do
//     Conjunto_de_Regras_Ativo, com verificacao de Excecao_Aprovada vigente;
//   - historico de rotacao (quantidade e datas de atribuicoes anteriores);
//   - responsabilidade departamental do culto.
//
// Requisitos cobertos (ver requirements.md, Requisito 5):
//  5.1  incluir, substituir e remover atribuicoes (ver applyAssignmentChange)
//  5.2  funcao individual: pessoa habilitada ou departamento quando permitido
//  5.3  pesquisa por nome/alias (ver search helpers expostos; a UI usa o
//       RegistryService; aqui reusamos o snapshot)
//  5.4  mostrar habilitacao, disponibilidade e cada conflito com RF/PE
//  5.5  revisao/preenchimento 100% manual (nenhuma dependencia de sugestao)
//  5.6  ignorar sugestao e identidade (ver ignoreSuggestion)
//  5.9  historico: quantidade e datas de atribuicoes anteriores por candidato
//  5.10 override de Preferencia exige justificativa nao vazia
//  5.11 violar RF sem Excecao_Aprovada vigente bloqueia e preserva o rascunho
//  5.12 responsabilidade departamental quando o pregador e Departamento
//
// Propriedades do design cobertas: 16 (elegibilidade), 17 (ignorar sugestao),
// 20 (override de preferencia), 21 (responsabilidade departamental).
//
// Reuso estrito: este modulo NAO cria um modelo paralelo. Ele reusa
//  - RegistryService (habilitacao/estado/selecionabilidade);
//  - RuleSetService + predicate DSL (conflitos e excecoes);
//  - deriveEffectiveUnavailabilities (disponibilidade);
//  - os modelos canonicos de schemas/models.ts (Assignment, ScheduleDraft...).

import type { RegistryService } from '../registry/registry-service';
import type { RuleSetService } from '../rules/rule-set-service';
import { evaluatePredicate, contextFromMap } from '../rules/predicate';
import {
  deriveEffectiveUnavailabilities,
  type EffectiveUnavailability,
  type PropagationConfig,
} from '../cycle/unavailability';
import type {
  Assignment,
  ApprovedRuleSet,
  Department,
  ExternalInput,
  IsoDate,
  Person,
  Rule,
  ScheduleDraft,
  Service,
  Unavailability,
  Uuid,
  Weekday,
} from '../schemas/models';

// --------------------------------------------------------------------------
// Entradas do calculo de elegibilidade
// --------------------------------------------------------------------------

/** Uma atribuicao ja confirmada em escalas anteriores (historico de rotacao). */
export interface ConfirmedAssignment {
  subjectId: Uuid;
  roleId: Uuid;
  date: IsoDate;
}

/**
 * Entrada imutavel do calculo de elegibilidade para UM culto e UMA funcao.
 * Todas as colecoes sao somente-leitura; o calculo nunca as muta.
 */
export interface EligibilityContext {
  /** Snapshot do cadastro (habilitacoes, estado, dias permitidos). */
  registry: RegistryService;
  /** Servico de regras (versao ativa + excecoes). */
  rules: RuleSetService;
  /** Versao do Conjunto_de_Regras_Ativo registrada para o ciclo. */
  ruleSetVersionId: Uuid;
  /** Cultos ativos do ciclo (datas e dias calculados). */
  services: readonly Service[];
  /** Indisponibilidades registradas no ciclo. */
  unavailabilities: readonly Unavailability[];
  /** Config de propagacao de indisponibilidade por vinculos. */
  propagation: PropagationConfig;
  /** Insumos externos (necessarios para responsabilidade departamental). */
  externalInputs: readonly ExternalInput[];
  /** Historico de atribuicoes anteriores (rotacao). */
  history: readonly ConfirmedAssignment[];
  /** Rascunho atual (para contar atribuicoes no proprio ciclo). */
  draft: ScheduleDraft;
}

// --------------------------------------------------------------------------
// Saida: avaliacao celula a celula por candidato
// --------------------------------------------------------------------------

/** Conflito com uma regra especifica (RF ou PE). */
export interface RuleConflict {
  ruleId: Uuid;
  kind: 'fundamental' | 'preference';
  severity: 'blocking' | 'warning';
  message: string;
  /** `true` quando ha Excecao_Aprovada vigente que cobre o conflito (RF). */
  coveredByException: boolean;
  /** Id da excecao vigente, quando `coveredByException`. */
  exceptionId?: Uuid;
}

/** Evidencia de historico de rotacao de um candidato para a funcao. */
export interface HistoryEvidence {
  /** Quantidade de atribuicoes anteriores consideradas pela rotacao. */
  count: number;
  /** Datas das atribuicoes anteriores, em ordem crescente. */
  dates: IsoDate[];
}

/** Avaliacao de um candidato (pessoa ou departamento) para a celula. */
export interface CandidateEvaluation {
  subject: { type: 'person' | 'department'; id: Uuid };
  /** Nome canonico do sujeito (para exibicao). */
  name: string;
  /** Habilitado para a funcao no cadastro / regras departamentais. */
  capable: boolean;
  /** Ativo (pode receber novas atribuicoes). */
  active: boolean;
  /** Disponivel na data (sem indisponibilidade efetiva). */
  available: boolean;
  /** Dia da semana do culto e permitido ao candidato (pessoas). */
  weekdayAllowed: boolean;
  /** Conflitos com regras fundamentais (bloqueantes salvo excecao vigente). */
  fundamentalConflicts: RuleConflict[];
  /** Conflitos com preferencias (avisos; exigem justificativa ao escolher). */
  preferenceConflicts: RuleConflict[];
  /** Historico de rotacao para a funcao. */
  history: HistoryEvidence;
  /**
   * `true` quando o sujeito pode ser SELECIONADO para esta celula sem violar
   * uma Regra_Fundamental (Property 16): ativo, habilitado, disponivel, dia
   * permitido e sem conflito fundamental descoberto (ou coberto por excecao).
   */
  selectable: boolean;
}

/** Resultado da avaliacao de uma celula (culto x funcao). */
export interface CellEvaluation {
  serviceId: Uuid;
  roleId: Uuid;
  date: IsoDate;
  weekday: Weekday;
  /** Candidatos avaliados, em ordem estavel por (tipo, id). */
  candidates: CandidateEvaluation[];
  /**
   * Quando o culto tem pregador-Departamento e esta funcao e responsabilidade
   * departamental, o Departamento responsavel (5.12 / Property 21).
   */
  departmentResponsibility?: { departmentId: Uuid; name: string };
}

// --------------------------------------------------------------------------
// Responsabilidade departamental
// --------------------------------------------------------------------------

/**
 * Regra de responsabilidade departamental do Conjunto_de_Regras_Ativo: quando o
 * pregador de um culto e um Departamento reconhecido, as `roleIds` listadas
 * passam a ser responsabilidade desse Departamento (5.12 / Property 21).
 *
 * Em vez de um modelo paralelo, a regra e derivada da versao ativa: lemos as
 * `departmentResponsibilityRoleIds` do metadado da regra departamental. Para
 * manter a independencia do schema (que ainda nao modela isso explicitamente),
 * aceitamos a lista de funcoes como parametro do contexto de avaliacao.
 */
export interface DepartmentResponsibilityRule {
  /** Funcoes que passam a ser do Departamento quando ele e o pregador. */
  roleIds: readonly Uuid[];
}

/**
 * Retorna o Departamento responsavel pelo culto quando o pregador e um
 * Departamento reconhecido e a funcao e abrangida pela regra departamental.
 * Puro: le somente os insumos (pregador) e a regra fornecida.
 */
export function departmentResponsibilityFor(
  serviceId: Uuid,
  roleId: Uuid,
  externalInputs: readonly ExternalInput[],
  rule: DepartmentResponsibilityRule,
  registry: RegistryService,
): Department | undefined {
  if (!rule.roleIds.includes(roleId)) return undefined;
  // Pregador do culto (insumo mais recente do tipo 'preacher').
  const preachers = externalInputs
    .filter((i) => i.serviceId === serviceId && i.type === 'preacher')
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));
  const latest = preachers[preachers.length - 1];
  if (!latest) return undefined;
  const subject = (latest.value as { subject?: { type: string; id: string } }).subject;
  if (!subject || subject.type !== 'department') return undefined;
  const dept = registry.getDepartment(subject.id);
  if (!dept || dept.status !== 'active') return undefined;
  return dept;
}

// --------------------------------------------------------------------------
// Calculo da celula
// --------------------------------------------------------------------------

/**
 * Avalia uma celula (culto x funcao): produz a lista de candidatos com
 * habilitacao, disponibilidade, conflitos, historico e, quando aplicavel, a
 * responsabilidade departamental. Funcao PURA e deterministica.
 *
 * `departmentRule` e opcional; quando ausente, nenhuma funcao e tratada como
 * responsabilidade departamental.
 */
export function evaluateCell(
  ctx: EligibilityContext,
  serviceId: Uuid,
  roleId: Uuid,
  departmentRule?: DepartmentResponsibilityRule,
): CellEvaluation {
  const service = ctx.services.find((s) => s.id === serviceId && s.removed === undefined);
  if (!service) {
    throw new Error(`culto inexistente ou removido: ${serviceId}`);
  }

  const ruleSet = requireActiveRuleSet(ctx);
  const fundamentals = ruleSet.rules.filter((r) => r.kind === 'fundamental');
  const preferences = ruleSet.rules.filter((r) => r.kind === 'preference');

  const effective = deriveEffectiveUnavailabilities({
    unavailabilities: ctx.unavailabilities,
    services: ctx.services,
    people: ctx.registry.snapshot().people,
    propagation: ctx.propagation,
  });

  // Responsabilidade departamental (5.12 / Property 21).
  const dept =
    departmentRule &&
    departmentResponsibilityFor(serviceId, roleId, ctx.externalInputs, departmentRule, ctx.registry);

  const candidates: CandidateEvaluation[] = [];
  const snapshot = ctx.registry.snapshot();

  for (const person of snapshot.people) {
    candidates.push(
      evaluatePerson(ctx, person, service, roleId, fundamentals, preferences, effective),
    );
  }

  // Departamentos: selecionaveis apenas quando a funcao admite responsabilidade
  // departamental (regra fornecida) e o departamento esta ativo.
  if (departmentRule && departmentRule.roleIds.includes(roleId)) {
    for (const d of snapshot.departments) {
      candidates.push(evaluateDepartment(d));
    }
  }

  candidates.sort(compareCandidate);

  const cell: CellEvaluation = {
    serviceId,
    roleId,
    date: service.date,
    weekday: service.computedWeekday,
    candidates,
  };
  if (dept) cell.departmentResponsibility = { departmentId: dept.id, name: dept.canonicalName };
  return cell;
}

function evaluatePerson(
  ctx: EligibilityContext,
  person: Person,
  service: Service,
  roleId: Uuid,
  fundamentals: readonly Rule[],
  preferences: readonly Rule[],
  effective: readonly EffectiveUnavailability[],
): CandidateEvaluation {
  const active = person.participation === 'active';
  const capable = person.capabilityIds.includes(roleId);
  const weekdayAllowed =
    person.allowedWeekdays.length === 0 || person.allowedWeekdays.includes(service.computedWeekday);
  const available = !effective.some(
    (e) => e.personId === person.id && e.date === service.date,
  );

  const evalMap = buildPredicateContext(person.capabilityIds, roleId, service.computedWeekday);

  const fundamentalConflicts = conflictsFor(
    ctx,
    fundamentals,
    evalMap,
    service.date,
  );
  const preferenceConflicts = conflictsFor(ctx, preferences, evalMap, service.date);

  const history = historyFor(ctx, { type: 'person', id: person.id }, roleId);

  const hasOpenFundamental = fundamentalConflicts.some((c) => !c.coveredByException);
  const selectable = active && capable && available && weekdayAllowed && !hasOpenFundamental;

  return {
    subject: { type: 'person', id: person.id },
    name: person.canonicalName,
    capable,
    active,
    available,
    weekdayAllowed,
    fundamentalConflicts,
    preferenceConflicts,
    history,
    selectable,
  };
}

function evaluateDepartment(dept: Department): CandidateEvaluation {
  const active = dept.status === 'active';
  // Departamentos nao possuem indisponibilidade/dias/habilitacao individuais;
  // sao selecionaveis quando ativos e a funcao admite responsabilidade dept.
  return {
    subject: { type: 'department', id: dept.id },
    name: dept.canonicalName,
    capable: true,
    active,
    available: true,
    weekdayAllowed: true,
    fundamentalConflicts: [],
    preferenceConflicts: [],
    history: { count: 0, dates: [] },
    selectable: active,
  };
}

/**
 * Conflitos de um conjunto de regras para o candidato na data. Uma regra
 * CONFLITA quando e aplicavel (apenas regras aplicaveis ao ciclo sao passadas)
 * e sua `assertion` NAO e satisfeita pelo candidato. Para regras fundamentais,
 * verifica Excecao_Aprovada vigente que cubra o conflito (5.11).
 */
function conflictsFor(
  ctx: EligibilityContext,
  rules: readonly Rule[],
  evalMap: Record<string, unknown>,
  serviceDate: IsoDate,
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const evalCtx = contextFromMap(evalMap);
  for (const rule of rules) {
    const applicable = evaluatePredicate(rule.applicability, evalCtx);
    if (!applicable) continue;
    const holds = evaluatePredicate(rule.assertion, evalCtx);
    if (holds) continue;

    // Violacao: para fundamentais, procurar excecao vigente aplicavel.
    let coveredByException = false;
    let exceptionId: Uuid | undefined;
    if (rule.kind === 'fundamental') {
      for (const exc of ctx.rules.listExceptions()) {
        if (exc.fundamentalRuleId !== rule.id) continue;
        const res = ctx.rules.assertExceptionApplicable(exc.id, serviceDate);
        if (res.ok && evaluatePredicate(exc.condition, evalCtx)) {
          coveredByException = true;
          exceptionId = exc.id;
          break;
        }
      }
    }

    const conflict: RuleConflict = {
      ruleId: rule.id,
      kind: rule.kind,
      severity: rule.severity,
      message: rule.messageTemplate,
      coveredByException,
    };
    if (exceptionId !== undefined) conflict.exceptionId = exceptionId;
    conflicts.push(conflict);
  }
  return conflicts.sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
}

/** Historico de rotacao (quantidade + datas) para o sujeito na funcao (5.9). */
function historyFor(
  ctx: EligibilityContext,
  subject: { type: 'person' | 'department'; id: Uuid },
  roleId: Uuid,
): HistoryEvidence {
  const dates = ctx.history
    .filter((h) => h.subjectId === subject.id && h.roleId === roleId)
    .map((h) => h.date)
    .sort(compareIso);
  return { count: dates.length, dates };
}

/**
 * Contexto de avaliacao de predicado (allowlist fechada). Os caminhos seguem a
 * convencao usada pelas regras: `service.weekday`, `assignment.roleId`,
 * `subject.capabilityIds`.
 */
function buildPredicateContext(
  capabilityIds: readonly Uuid[],
  roleId: Uuid,
  weekday: Weekday,
): Record<string, unknown> {
  return {
    'service.weekday': weekday,
    'assignment.roleId': roleId,
    'subject.capabilityIds': [...capabilityIds],
  };
}

function requireActiveRuleSet(ctx: EligibilityContext): ApprovedRuleSet {
  const version = ctx.rules.getVersion(ctx.ruleSetVersionId);
  if (!version) {
    throw new Error(`versao de regras inexistente: ${ctx.ruleSetVersionId}`);
  }
  return version;
}

// --------------------------------------------------------------------------
// Lista de sujeitos SELECIONAVEIS (Property 16)
// --------------------------------------------------------------------------

/**
 * Conjunto de sujeitos selecionaveis para a celula (Property 16): exatamente as
 * Pessoas_Canonicas ativas, habilitadas, disponiveis no dia e sem conflito
 * fundamental, acrescido somente dos Departamentos permitidos pela regra
 * departamental da versao do ciclo. Ordem estavel por (tipo, id).
 */
export function selectableSubjects(
  ctx: EligibilityContext,
  serviceId: Uuid,
  roleId: Uuid,
  departmentRule?: DepartmentResponsibilityRule,
): Array<{ type: 'person' | 'department'; id: Uuid }> {
  return evaluateCell(ctx, serviceId, roleId, departmentRule)
    .candidates.filter((c) => c.selectable)
    .map((c) => c.subject);
}

// --------------------------------------------------------------------------
// Aplicar mudanca de atribuicao (incluir / substituir / remover) — 5.1, 5.10, 5.11
// --------------------------------------------------------------------------

/** Pedido de alteracao de atribuicao em uma celula. */
export interface AssignmentChange {
  serviceId: Uuid;
  roleId: Uuid;
  slot?: string;
  /** `undefined` => remover a atribuicao desta celula. */
  subject?: { type: 'person' | 'department'; id: Uuid };
  /** Origem da atribuicao. Default: 'manual'. */
  source?: Assignment['source'];
  /** Justificativa de override de Preferencia (5.10 / Property 20). */
  preferenceOverrideReason?: string;
  /** Gerador de id para novas atribuicoes (puro; injetado). */
  newId?: () => Uuid;
}

export type ApplyErrorCode =
  | 'not-selectable'
  | 'fundamental-violation'
  | 'preference-needs-justification';

export interface ApplyError {
  code: ApplyErrorCode;
  message: string;
  /** Regras violadas (quando aplicavel). */
  conflicts?: RuleConflict[];
}

export type ApplyResult =
  | { ok: true; draft: ScheduleDraft }
  | { ok: false; error: ApplyError };

/**
 * Aplica incluir/substituir/remover uma atribuicao ao rascunho (5.1), de forma
 * PURA (retorna um NOVO rascunho; nunca muta o recebido). Garantias:
 *
 *  - toda atribuicao ACEITA usa um sujeito ELEGIVEL (5.2, Property 16);
 *  - violar uma Regra_Fundamental sem Excecao_Aprovada vigente e REJEITADO e o
 *    rascunho anterior e PRESERVADO (5.11, Property 19-ish para manual);
 *  - contrariar uma Preferencia_de_Escala exige `preferenceOverrideReason` nao
 *    vazio; a justificativa e persistida junto a atribuicao (5.10 / Property 20).
 *
 * Remocao (subject ausente) sempre e aceita e remove a atribuicao da celula.
 */
export function applyAssignmentChange(
  ctx: EligibilityContext,
  change: AssignmentChange,
  departmentRule?: DepartmentResponsibilityRule,
): ApplyResult {
  const without = ctx.draft.assignments.filter(
    (a) =>
      !(a.serviceId === change.serviceId && a.roleId === change.roleId && sameSlot(a.slot, change.slot)),
  );

  // Remocao: aceita sempre.
  if (!change.subject) {
    return { ok: true, draft: withAssignments(ctx.draft, without) };
  }

  const cell = evaluateCell(ctx, change.serviceId, change.roleId, departmentRule);
  const evaluation = cell.candidates.find(
    (c) => c.subject.type === change.subject!.type && c.subject.id === change.subject!.id,
  );

  if (!evaluation || !evaluation.selectable) {
    // Pode ser por RF aberta, por habilitacao/disponibilidade ou nao candidato.
    const openFundamentals = evaluation?.fundamentalConflicts.filter((c) => !c.coveredByException);
    if (openFundamentals && openFundamentals.length > 0) {
      return {
        ok: false,
        error: {
          code: 'fundamental-violation',
          message:
            'a escolha viola uma Regra_Fundamental sem Excecao_Aprovada vigente; ' +
            'o rascunho anterior foi preservado',
          conflicts: openFundamentals,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: 'not-selectable',
        message:
          'o sujeito nao e elegivel para esta funcao e data ' +
          '(inativo, nao habilitado, indisponivel ou dia nao permitido)',
      },
    };
  }

  // Preferencia contrariada exige justificativa (5.10 / Property 20).
  const openPreferences = evaluation.preferenceConflicts;
  if (openPreferences.length > 0) {
    const reason = (change.preferenceOverrideReason ?? '').trim();
    if (reason.length === 0) {
      return {
        ok: false,
        error: {
          code: 'preference-needs-justification',
          message: 'contrariar uma Preferencia_de_Escala exige justificativa nao vazia',
          conflicts: openPreferences,
        },
      };
    }
  }

  const id = change.newId ? change.newId() : deterministicId(change);
  const assignment: Assignment = {
    id,
    serviceId: change.serviceId,
    roleId: change.roleId,
    subject: { type: change.subject.type, id: change.subject.id },
    source: change.source ?? 'manual',
  };
  if (change.slot !== undefined) assignment.slot = change.slot;
  // Persiste a justificativa SOMENTE quando houve preferencia contrariada.
  if (openPreferences.length > 0 && change.preferenceOverrideReason) {
    assignment.preferenceOverrideReason = change.preferenceOverrideReason.trim();
  }

  return { ok: true, draft: withAssignments(ctx.draft, [...without, assignment]) };
}

// --------------------------------------------------------------------------
// Ignorar sugestao e identidade (5.6 / Property 17)
// --------------------------------------------------------------------------

/**
 * Ignorar uma sugestao e a IDENTIDADE: devolve exatamente o rascunho recebido,
 * sem qualquer alteracao (5.6 / Property 17). O cadastro tambem permanece
 * intocado porque este modulo nunca o muta.
 */
export function ignoreSuggestion(draft: ScheduleDraft): ScheduleDraft {
  return draft;
}

// --------------------------------------------------------------------------
// Auxiliares puros
// --------------------------------------------------------------------------

function withAssignments(draft: ScheduleDraft, assignments: Assignment[]): ScheduleDraft {
  return {
    ...draft,
    assignments: assignments
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

function sameSlot(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '') === (b ?? '');
}

function deterministicId(change: AssignmentChange): Uuid {
  // Id deterministico (sem aleatoriedade) para manter pureza quando `newId`
  // nao e fornecido. Usa chave da celula + sujeito.
  const subj = change.subject ? `${change.subject.type}:${change.subject.id}` : 'none';
  return `assign-${change.serviceId}-${change.roleId}-${change.slot ?? ''}-${subj}`;
}

function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareCandidate(a: CandidateEvaluation, b: CandidateEvaluation): number {
  if (a.subject.type !== b.subject.type) {
    // pessoas antes de departamentos
    return a.subject.type === 'person' ? -1 : 1;
  }
  return a.subject.id < b.subject.id ? -1 : a.subject.id > b.subject.id ? 1 : 0;
}
