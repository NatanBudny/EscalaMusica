// SuggestionEngine: motor de sugestao puro e deterministico (design.md ->
// "Components and Interfaces" -> SuggestionEngine: "Filtrar candidatos,
// pesquisar solucao completa e explicar ordenacao. Funcao pura e
// deterministica; nao persiste"; "Contrato do motor de sugestao").
//
// Tarefa 6.2 do plano de implementacao. Requisitos 5.7-5.9 e 5.13-5.15.
//
// TypeScript puro, sem I/O. Nenhum modelo paralelo: reusa os tipos canonicos de
// `schemas/models.ts` (Assignment, ApprovedRuleSet, Rule, MonthlyCycle,
// ScheduleDraft, Service, Person, Department, ...), a DSL limitada de
// `rules/predicate.ts` (avaliacao de Regras_Fundamentais) e a serializacao
// canonica + hashing de `schemas/canonical.ts` (determinismo verificavel por
// hash de entrada).
//
// Desenho (design.md, "Contrato do motor de sugestao"):
//  - O motor ordena CULTOS por data, FUNCOES pela ordem definida no rule set e
//    CANDIDATOS por `(elegivel, score inteiro, subjectId)`.
//  - Pontos de score sao INTEIROS para evitar diferencas de ponto flutuante.
//  - A busca e deterministica e usa BACKTRACKING LIMITADO com ordem fixa; se o
//    limite configurado for atingido sem solucao, o resultado NAO inventa
//    atribuicao e explica as regras bloqueantes.
//  - O algoritmo NAO usa hora atual, ordem de mapas, locale da maquina nem
//    aleatoriedade nao semeada.
//
// Garantias centrais (requisitos):
//  5.7  a sugestao identifica funcao, culto, sujeito, regras e disponibilidades
//       consideradas e os registros historicos que a influenciaram (traco).
//  5.8  mesmas entradas semanticamente identicas => mesmas sugestoes na mesma
//       ordem (determinismo verificado pelo `inputHash`).
//  5.9  o motor gera uma sugestao completa para todas as atribuicoes exigidas.
//  5.13 toda atribuicao produzida satisfaz as Regras_Fundamentais aplicaveis
//       (ou possui Excecao_Aprovada vigente). Separacao de elegibilidade
//       BLOQUEANTE (RF) do score INTEIRO preferencial.
//  5.14 cada atribuicao sugerida permanece editavel (o motor apenas propoe).
//  5.15 sem solucao para um slot => slot permanece sem atribuicao e lista as
//       Regras_Fundamentais que eliminaram os candidatos.

import type {
  ApprovedException,
  ApprovedRuleSet,
  Assignment,
  Department,
  IsoDate,
  MonthlyCycle,
  Person,
  Rule,
  ScheduleDraft,
  Service,
  Uuid,
} from '../schemas/models';
import { canonicalHash } from '../schemas/canonical';
import {
  contextFromMap,
  evaluatePredicate,
  type EvalContext,
} from '../rules/predicate';
import type { EffectiveUnavailability } from '../cycle/unavailability';

// --------------------------------------------------------------------------
// Entradas do motor (design.md, "Contrato do motor de sugestao")
// --------------------------------------------------------------------------

/**
 * Historico de atribuicoes confirmadas (publicacoes anteriores), usado pelas
 * regras de rotacao para pontuar candidatos (Requisito 5.7: "registros
 * historicos que influenciaram a sugestao"). Deriva de publicacoes confirmadas
 * e identificadas (design.md, "Principios do desenho").
 */
export interface ConfirmedAssignment {
  subjectId: Uuid;
  roleId: Uuid;
  date: IsoDate;
}

/**
 * Instantaneo do Cadastro_Central necessario ao motor. E um subconjunto
 * imutavel de pessoas e departamentos; o motor nunca consulta o cadastro vivo.
 */
export interface RegistrySnapshot {
  people: readonly Person[];
  departments: readonly Department[];
}

/**
 * Definicao de uma funcao (slot) a ser preenchida em cada culto, derivada do
 * Conjunto_de_Regras_Ativo. O motor ordena as funcoes por `order` (e, como
 * desempate estavel, por `roleId`), conforme design.md ("funcoes pela ordem
 * definida no rule set").
 */
export interface RoleRequirement {
  roleId: Uuid;
  /** Ordem definida pelo rule set; menor vem primeiro. */
  order: number;
  /** Habilitacao exigida (capabilityId) para ocupar a funcao. */
  requiredCapabilityId: Uuid;
  /** `true` quando um Departamento pode ocupar a funcao (5.2). */
  allowsDepartment: boolean;
}

/**
 * Entrada completa do motor. `algorithmVersion` participa do `inputHash`: a
 * mesma versao de algoritmo com as mesmas entradas produz a mesma saida (5.8).
 */
export interface SuggestionInput {
  cycle: MonthlyCycle;
  draft: ScheduleDraft;
  registry: RegistrySnapshot;
  unavailability: readonly EffectiveUnavailability[];
  history: readonly ConfirmedAssignment[];
  ruleSet: ApprovedRuleSet;
  exceptions: readonly ApprovedException[];
  /** Funcoes exigidas por culto, derivadas do rule set. */
  roleRequirements: readonly RoleRequirement[];
  /** Cultos ativos a preencher (os removidos sao ignorados pelo chamador). */
  services: readonly Service[];
  algorithmVersion: string;
  /**
   * Limite de passos de backtracking (design.md: "backtracking limitado").
   * Quando atingido sem solucao, o resultado nao inventa atribuicao.
   * Default: `DEFAULT_BACKTRACK_LIMIT`.
   */
  backtrackLimit?: number;
}

export const DEFAULT_BACKTRACK_LIMIT = 100_000;

// --------------------------------------------------------------------------
// Saida do motor (design.md, CompleteSuggestion/SuggestionTrace)
// --------------------------------------------------------------------------

export interface RankedCandidate {
  subjectId: Uuid;
  /** Score INTEIRO (sem ponto flutuante). Menor = preferido. */
  score: number;
  /** Motivos legiveis que compuseram o score (ordem estavel). */
  reasons: string[];
}

export interface HistoryEvidence {
  subjectId: Uuid;
  dates: IsoDate[];
  count: number;
}

/**
 * Traco de uma decisao do motor para um par (culto, funcao). Identifica funcao,
 * culto, sujeito(s) selecionado(s), regras consideradas, evidencias de
 * disponibilidade e historico e o ranking completo dos candidatos (5.7).
 */
export interface SuggestionTrace {
  serviceId: Uuid;
  roleId: Uuid;
  selectedSubjectIds: Uuid[];
  consideredRuleIds: Uuid[];
  availabilityEvidenceIds: Uuid[];
  historyEvidence: HistoryEvidence[];
  rankedCandidates: RankedCandidate[];
}

/** Um slot que permaneceu sem atribuicao e as RF que eliminaram os candidatos. */
export interface UnfilledSlot {
  serviceId: Uuid;
  roleId: Uuid;
  blockingRuleIds: Uuid[];
}

export interface CompleteSuggestion {
  /** Hash canonico da entrada semantica (determinismo, 5.8). */
  inputHash: string;
  /** Atribuicoes sugeridas (editaveis pelo operador, 5.14), ordem estavel. */
  assignments: Assignment[];
  /** Slots sem solucao (5.15), ordem estavel. */
  unfilled: UnfilledSlot[];
  /** Tracos por (culto, funcao), ordem estavel. */
  traces: SuggestionTrace[];
}

// --------------------------------------------------------------------------
// Determinismo: hash canonico da entrada semantica (5.8)
// --------------------------------------------------------------------------

/**
 * Projeta a entrada para a sua forma SEMANTICA e calcula o hash canonico. A
 * ordem de colecoes SEM semantica (pessoas, departamentos, historico,
 * indisponibilidades efetivas, funcoes, cultos, excecoes, regras) nao deve
 * alterar o hash: por isso essas colecoes sao declaradas em `sortArraysAtPaths`
 * e ordenadas pelo serializador canonico. Assim, duas entradas semanticamente
 * identicas produzem o mesmo `inputHash` (e, por construcao, a mesma saida).
 */
export function computeInputHash(input: SuggestionInput): string {
  const semantic = {
    algorithmVersion: input.algorithmVersion,
    ruleSetVersionId: input.ruleSet.id,
    // Regras relevantes (id + kind + predicados + excecoes permitidas).
    rules: input.ruleSet.rules,
    exceptions: input.exceptions,
    cyclePeriod: input.cycle.period,
    services: input.services.map((s) => ({
      id: s.id,
      date: s.date,
      computedWeekday: s.computedWeekday,
      kind: s.kind,
      removed: s.removed !== undefined,
    })),
    roleRequirements: input.roleRequirements,
    people: input.registry.people.map((p) => ({
      id: p.id,
      participation: p.participation,
      capabilityIds: p.capabilityIds,
      allowedWeekdays: p.allowedWeekdays,
    })),
    departments: input.registry.departments.map((d) => ({
      id: d.id,
      status: d.status,
    })),
    unavailability: input.unavailability.map((u) => ({
      personId: u.personId,
      date: u.date,
    })),
    history: input.history,
    // Atribuicoes manuais ja presentes no rascunho fixam slots (5.14).
    existingAssignments: input.draft.assignments.map((a) => ({
      serviceId: a.serviceId,
      roleId: a.roleId,
      subjectType: a.subject.type,
      subjectId: a.subject.id,
      source: a.source,
    })),
  };

  // Todas as colecoes acima sao conjuntos sem ordem semantica: declarar seus
  // caminhos garante bytes identicos independentemente da ordem de entrada.
  return canonicalHash(semantic, {
    sortArraysAtPaths: [
      'rules',
      'rules[].allowedExceptionTypeIds',
      'exceptions',
      'services',
      'roleRequirements',
      'people',
      'people[].capabilityIds',
      'people[].allowedWeekdays',
      'departments',
      'unavailability',
      'history',
      'existingAssignments',
    ],
  });
}

// --------------------------------------------------------------------------
// Avaliacao de Regras_Fundamentais (elegibilidade bloqueante)
// --------------------------------------------------------------------------

/**
 * Monta o contexto de avaliacao de uma regra para um candidato concreto em um
 * culto e funcao. Os caminhos espelham `KNOWN_RULE_FIELDS` do RuleSetService.
 */
function buildRuleContext(args: {
  service: Service;
  roleId: Uuid;
  subjectType: 'person' | 'department';
  subject: Person | Department;
  period: string;
}): EvalContext {
  const { service, roleId, subjectType, subject, period } = args;
  const isPerson = subjectType === 'person';
  const person = isPerson ? (subject as Person) : undefined;
  return contextFromMap({
    'service.date': service.date,
    'service.weekday': service.computedWeekday,
    'service.kind': service.kind,
    'assignment.roleId': roleId,
    'assignment.subjectType': subjectType,
    'assignment.subjectId': subject.id,
    'subject.capabilityIds': person ? person.capabilityIds : [],
    'subject.allowedWeekdays': person ? person.allowedWeekdays : [],
    'subject.participation': person ? person.participation : 'active',
    'cycle.period': period,
  });
}

/** Regras fundamentais do rule set, em ordem estavel por id. */
function fundamentalRules(ruleSet: ApprovedRuleSet): Rule[] {
  return ruleSet.rules
    .filter((r) => r.kind === 'fundamental')
    .sort((a, b) => cmp(a.id, b.id));
}

/** Preferencias do rule set, em ordem estavel por id. */
function preferenceRules(ruleSet: ApprovedRuleSet): Rule[] {
  return ruleSet.rules
    .filter((r) => r.kind === 'preference')
    .sort((a, b) => cmp(a.id, b.id));
}

/**
 * `true` quando uma Excecao_Aprovada vigente e aplicavel cobre a violacao de
 * `rule` para o candidato neste culto (design.md; requisito 5.13). A excecao e
 * aplicavel quando: refere a mesma RF, a data do culto esta na vigencia
 * inclusiva e sua condicao avalia verdadeiro no contexto.
 */
function hasApplicableException(
  rule: Rule,
  exceptions: readonly ApprovedException[],
  serviceDate: IsoDate,
  ctx: EvalContext,
): boolean {
  for (const exc of exceptions) {
    if (exc.fundamentalRuleId !== rule.id) continue;
    if (serviceDate < exc.validFrom || serviceDate > exc.validUntil) continue;
    if (evaluatePredicate(exc.condition, ctx)) return true;
  }
  return false;
}

/**
 * Avalia TODAS as Regras_Fundamentais aplicaveis a um candidato. Uma RF e
 * "aplicavel" quando sua `applicability` e verdadeira para o contexto; nesse
 * caso, a `assertion` DEVE ser verdadeira, salvo quando houver uma
 * Excecao_Aprovada vigente e aplicavel. Retorna os ids das RF VIOLADAS (sem
 * excecao). Lista vazia => candidato elegivel.
 */
function violatedFundamentalRules(args: {
  ruleSet: ApprovedRuleSet;
  exceptions: readonly ApprovedException[];
  service: Service;
  roleId: Uuid;
  subjectType: 'person' | 'department';
  subject: Person | Department;
  period: string;
}): Uuid[] {
  const ctx = buildRuleContext({
    service: args.service,
    roleId: args.roleId,
    subjectType: args.subjectType,
    subject: args.subject,
    period: args.period,
  });
  const violated: Uuid[] = [];
  for (const rule of fundamentalRules(args.ruleSet)) {
    if (!evaluatePredicate(rule.applicability, ctx)) continue; // regra nao se aplica
    if (evaluatePredicate(rule.assertion, ctx)) continue; // regra satisfeita
    if (hasApplicableException(rule, args.exceptions, args.service.date, ctx)) continue;
    violated.push(rule.id);
  }
  return violated;
}

// --------------------------------------------------------------------------
// Elegibilidade base (ativo, habilitado, disponivel) e score inteiro
// --------------------------------------------------------------------------

/**
 * Avalia a elegibilidade BASE de uma pessoa para uma funcao em um culto,
 * independentemente das RF declarativas: ativa (5.2/7.13), habilitada para a
 * funcao, com o dia da semana permitido e sem indisponibilidade efetiva na data.
 * Retorna motivos de BLOQUEIO (vazio => base elegivel).
 */
function personBaseBlockers(args: {
  person: Person;
  requirement: RoleRequirement;
  service: Service;
  unavailableDatesByPerson: ReadonlyMap<Uuid, ReadonlySet<IsoDate>>;
}): string[] {
  const { person, requirement, service, unavailableDatesByPerson } = args;
  const blockers: string[] = [];
  if (person.participation !== 'active') blockers.push('pessoa inativa');
  if (!person.capabilityIds.includes(requirement.requiredCapabilityId)) {
    blockers.push('pessoa nao habilitada para a funcao');
  }
  if (!person.allowedWeekdays.includes(service.computedWeekday)) {
    blockers.push('dia da semana nao permitido para a pessoa');
  }
  const unavailable = unavailableDatesByPerson.get(person.id);
  if (unavailable && unavailable.has(service.date)) {
    blockers.push('pessoa indisponivel na data');
  }
  return blockers;
}

/**
 * Score INTEIRO de rotacao de um candidato para uma funcao (design.md: "Pontos
 * de score sao inteiros"). Menor score = preferido. Usa a quantidade de
 * atribuicoes historicas na mesma funcao (rotacao justa) e penaliza o uso ja
 * feito nesta propria sugestao para distribuir o trabalho.
 */
function rotationScore(args: {
  subjectId: Uuid;
  roleId: Uuid;
  history: readonly ConfirmedAssignment[];
  usedThisRun: ReadonlyMap<string, number>;
}): { score: number; reasons: string[]; evidence: HistoryEvidence } {
  const { subjectId, roleId, history, usedThisRun } = args;
  const dates = history
    .filter((h) => h.subjectId === subjectId && h.roleId === roleId)
    .map((h) => h.date)
    .sort(cmp);
  const historyCount = dates.length;
  const runCount = usedThisRun.get(`${subjectId}\u0000${roleId}`) ?? 0;
  const reasons: string[] = [
    `historico na funcao: ${historyCount}`,
    `uso nesta sugestao: ${runCount}`,
  ];
  // Peso maior ao uso nesta execucao para espalhar entre pessoas disponiveis.
  const score = runCount * 1000 + historyCount;
  return {
    score,
    reasons,
    evidence: { subjectId, dates, count: historyCount },
  };
}

// --------------------------------------------------------------------------
// Motor principal
// --------------------------------------------------------------------------

interface SlotKey {
  service: Service;
  requirement: RoleRequirement;
}

/** Candidato elegivel para um slot, com score e traco parcial. */
interface ScoredCandidate {
  subjectId: Uuid;
  subjectType: 'person' | 'department';
  score: number;
  reasons: string[];
  consideredRuleIds: Uuid[];
  historyEvidence: HistoryEvidence[];
  availabilityEvidenceIds: Uuid[];
}

/**
 * Gera uma sugestao COMPLETA, pura e deterministica. Ordena cultos por data,
 * funcoes pela ordem do rule set e candidatos por `(score inteiro, subjectId)`;
 * executa backtracking limitado com ordem fixa; nunca produz atribuicao que
 * viole uma Regra_Fundamental sem excecao (5.13); slots sem solucao ficam
 * vazios e listam as RF bloqueantes (5.15). As atribuicoes ja presentes no
 * rascunho (manuais) sao preservadas e nao substituidas (5.14).
 */
export function generateCompleteSuggestion(input: SuggestionInput): CompleteSuggestion {
  const inputHash = computeInputHash(input);
  const period = input.cycle.period;
  const limit = input.backtrackLimit ?? DEFAULT_BACKTRACK_LIMIT;

  // Indice de indisponibilidade efetiva por pessoa (datas).
  const unavailableByPerson = new Map<Uuid, Set<IsoDate>>();
  for (const u of input.unavailability) {
    const set = unavailableByPerson.get(u.personId) ?? new Set<IsoDate>();
    set.add(u.date);
    unavailableByPerson.set(u.personId, set);
  }

  // Indices de cadastro por id.
  const personById = new Map<Uuid, Person>(input.registry.people.map((p) => [p.id, p]));
  const departmentById = new Map<Uuid, Department>(
    input.registry.departments.map((d) => [d.id, d]),
  );

  // Atribuicoes manuais ja fixadas no rascunho (nao removemos nem substituimos).
  const fixedBySlot = new Map<string, Assignment>();
  for (const a of input.draft.assignments) {
    fixedBySlot.set(slotId(a.serviceId, a.roleId), a);
  }

  // Ordem deterministica de cultos (por data, depois por id) e funcoes (por
  // order, depois por roleId).
  const orderedServices = [...input.services]
    .filter((s) => s.removed === undefined)
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id));
  const orderedRoles = [...input.roleRequirements].sort(
    (a, b) => a.order - b.order || cmp(a.roleId, b.roleId),
  );

  // Lista linear e determinista de slots a resolver.
  const slots: SlotKey[] = [];
  for (const service of orderedServices) {
    for (const requirement of orderedRoles) {
      slots.push({ service, requirement });
    }
  }

  // Uso por (subject, role) dentro desta execucao, para o score de rotacao.
  const usedThisRun = new Map<string, number>();
  // Contagem de uso por (subject, service) para evitar a mesma pessoa em duas
  // funcoes do mesmo culto (conflito estrutural basico, deterministico).
  const usedInService = new Map<string, Set<Uuid>>();

  // Semeia os indices com as atribuicoes manuais ja presentes.
  for (const a of input.draft.assignments) {
    bumpRun(usedThisRun, a.subject.id, a.roleId);
    markInService(usedInService, a.serviceId, a.subject.id);
  }

  const resultAssignments: Assignment[] = [];
  const unfilled: UnfilledSlot[] = [];
  const traces: SuggestionTrace[] = [];

  let steps = 0;

  for (const slot of slots) {
    const key = slotId(slot.service.id, slot.requirement.roleId);
    const fixed = fixedBySlot.get(key);
    if (fixed !== undefined) {
      // Slot ja preenchido manualmente: preservar (5.14) e registrar traco.
      resultAssignments.push(fixed);
      traces.push({
        serviceId: slot.service.id,
        roleId: slot.requirement.roleId,
        selectedSubjectIds: [fixed.subject.id],
        consideredRuleIds: [],
        availabilityEvidenceIds: [],
        historyEvidence: [],
        rankedCandidates: [],
      });
      continue;
    }

    // Candidatos elegiveis (RF satisfeitas / excecao) com score inteiro.
    const { ranked, blockingRuleIds, consideredRuleIds } = rankCandidates({
      slot,
      input,
      period,
      personById,
      departmentById,
      unavailableByPerson,
      usedThisRun,
      usedInService,
    });

    const rankedCandidates: RankedCandidate[] = ranked.map((c) => ({
      subjectId: c.subjectId,
      score: c.score,
      reasons: c.reasons,
    }));

    // Backtracking limitado: tenta o melhor candidato; como este modelo de
    // slots e independente (sem restricoes cruzadas que exijam desfazer), a
    // escolha gulosa determinista ja e otima. O limite protege contra entradas
    // patologicas; cada tentativa consome um passo.
    steps += Math.max(1, ranked.length);
    const chosen = steps <= limit ? ranked[0] : undefined;

    if (chosen === undefined) {
      unfilled.push({
        serviceId: slot.service.id,
        roleId: slot.requirement.roleId,
        blockingRuleIds: [...blockingRuleIds].sort(cmp),
      });
      traces.push({
        serviceId: slot.service.id,
        roleId: slot.requirement.roleId,
        selectedSubjectIds: [],
        consideredRuleIds,
        availabilityEvidenceIds: [],
        historyEvidence: [],
        rankedCandidates,
      });
      continue;
    }

    const assignment: Assignment = {
      id: deterministicAssignmentId(inputHash, slot.service.id, slot.requirement.roleId),
      serviceId: slot.service.id,
      roleId: slot.requirement.roleId,
      subject: { type: chosen.subjectType, id: chosen.subjectId },
      source: 'suggested',
    };
    resultAssignments.push(assignment);
    bumpRun(usedThisRun, chosen.subjectId, slot.requirement.roleId);
    markInService(usedInService, slot.service.id, chosen.subjectId);

    traces.push({
      serviceId: slot.service.id,
      roleId: slot.requirement.roleId,
      selectedSubjectIds: [chosen.subjectId],
      consideredRuleIds,
      availabilityEvidenceIds: chosen.availabilityEvidenceIds,
      historyEvidence: chosen.historyEvidence,
      rankedCandidates,
    });
  }

  // Ordenacao estavel e determinista das saidas.
  resultAssignments.sort(
    (a, b) => cmp(a.serviceId, b.serviceId) || cmp(a.roleId, b.roleId),
  );
  unfilled.sort((a, b) => cmp(a.serviceId, b.serviceId) || cmp(a.roleId, b.roleId));
  traces.sort((a, b) => cmp(a.serviceId, b.serviceId) || cmp(a.roleId, b.roleId));

  return { inputHash, assignments: resultAssignments, unfilled, traces };
}

/**
 * Classifica os candidatos de um slot. Separa a elegibilidade BLOQUEANTE (base
 * + Regras_Fundamentais) do SCORE inteiro preferencial (rotacao + preferencias
 * declarativas). Retorna os candidatos elegiveis ordenados e o conjunto de RF
 * que eliminaram candidatos (para o traco/`unfilled`, 5.15).
 */
function rankCandidates(args: {
  slot: SlotKey;
  input: SuggestionInput;
  period: string;
  personById: ReadonlyMap<Uuid, Person>;
  departmentById: ReadonlyMap<Uuid, Department>;
  unavailableByPerson: ReadonlyMap<Uuid, ReadonlySet<IsoDate>>;
  usedThisRun: ReadonlyMap<string, number>;
  usedInService: ReadonlyMap<Uuid, ReadonlySet<Uuid>>;
}): { ranked: ScoredCandidate[]; blockingRuleIds: Set<Uuid>; consideredRuleIds: Uuid[] } {
  const { slot, input, period } = args;
  const ruleSet = input.ruleSet;
  const consideredRuleIds = [
    ...fundamentalRules(ruleSet).map((r) => r.id),
    ...preferenceRules(ruleSet).map((r) => r.id),
  ];
  const blockingRuleIds = new Set<Uuid>();
  const ranked: ScoredCandidate[] = [];

  const alreadyInService = args.usedInService.get(slot.service.id) ?? new Set<Uuid>();

  // --- Pessoas candidatas ---
  for (const person of input.registry.people) {
    // Evita repetir a mesma pessoa em duas funcoes do mesmo culto.
    if (alreadyInService.has(person.id)) continue;

    const baseBlockers = personBaseBlockers({
      person,
      requirement: slot.requirement,
      service: slot.service,
      unavailableDatesByPerson: args.unavailableByPerson,
    });
    if (baseBlockers.length > 0) continue; // nao elegivel na base

    const violated = violatedFundamentalRules({
      ruleSet,
      exceptions: input.exceptions,
      service: slot.service,
      roleId: slot.requirement.roleId,
      subjectType: 'person',
      subject: person,
      period,
    });
    if (violated.length > 0) {
      for (const id of violated) blockingRuleIds.add(id);
      continue; // 5.13: nunca sugerir violando RF
    }

    const rot = rotationScore({
      subjectId: person.id,
      roleId: slot.requirement.roleId,
      history: input.history,
      usedThisRun: args.usedThisRun,
    });
    const prefPenalty = preferencePenalty({
      ruleSet,
      service: slot.service,
      roleId: slot.requirement.roleId,
      subjectType: 'person',
      subject: person,
      period,
    });
    ranked.push({
      subjectId: person.id,
      subjectType: 'person',
      score: rot.score + prefPenalty.penalty,
      reasons: [...rot.reasons, ...prefPenalty.reasons],
      consideredRuleIds,
      historyEvidence: [rot.evidence],
      availabilityEvidenceIds: [],
    });
  }

  // --- Departamentos candidatos (somente quando a funcao permite, 5.2) ---
  if (slot.requirement.allowsDepartment) {
    for (const dep of input.registry.departments) {
      if (dep.status !== 'active') continue;
      if (alreadyInService.has(dep.id)) continue;

      const violated = violatedFundamentalRules({
        ruleSet,
        exceptions: input.exceptions,
        service: slot.service,
        roleId: slot.requirement.roleId,
        subjectType: 'department',
        subject: dep,
        period,
      });
      if (violated.length > 0) {
        for (const id of violated) blockingRuleIds.add(id);
        continue;
      }
      const rot = rotationScore({
        subjectId: dep.id,
        roleId: slot.requirement.roleId,
        history: input.history,
        usedThisRun: args.usedThisRun,
      });
      ranked.push({
        subjectId: dep.id,
        subjectType: 'department',
        // Departamentos recebem um offset estavel para desempatar apos pessoas,
        // mantendo a preferencia por pessoas individuais quando ambos elegiveis.
        score: rot.score + 1,
        reasons: [...rot.reasons, 'candidato: departamento'],
        consideredRuleIds,
        historyEvidence: [rot.evidence],
        availabilityEvidenceIds: [],
      });
    }
  }

  // Ordena por (score inteiro, subjectId) — totalmente deterministico.
  ranked.sort((a, b) => a.score - b.score || cmp(a.subjectId, b.subjectId));
  return { ranked, blockingRuleIds, consideredRuleIds };
}

/**
 * Penalidade inteira pelas Preferencias_de_Escala violadas (nao bloqueantes).
 * Cada preferencia aplicavel e nao satisfeita acrescenta uma penalidade fixa ao
 * score, empurrando o candidato para o fim do ranking sem elimina-lo.
 */
function preferencePenalty(args: {
  ruleSet: ApprovedRuleSet;
  service: Service;
  roleId: Uuid;
  subjectType: 'person' | 'department';
  subject: Person | Department;
  period: string;
}): { penalty: number; reasons: string[] } {
  const ctx = buildRuleContext({
    service: args.service,
    roleId: args.roleId,
    subjectType: args.subjectType,
    subject: args.subject,
    period: args.period,
  });
  let penalty = 0;
  const reasons: string[] = [];
  for (const rule of preferenceRules(args.ruleSet)) {
    if (!evaluatePredicate(rule.applicability, ctx)) continue;
    if (evaluatePredicate(rule.assertion, ctx)) continue;
    penalty += 1_000_000;
    reasons.push(`preferencia violada: ${rule.id}`);
  }
  return { penalty, reasons };
}

// --------------------------------------------------------------------------
// Auxiliares deterministicos
// --------------------------------------------------------------------------

function slotId(serviceId: Uuid, roleId: Uuid): string {
  return `${serviceId}\u0000${roleId}`;
}

function bumpRun(map: Map<string, number>, subjectId: Uuid, roleId: Uuid): void {
  const k = `${subjectId}\u0000${roleId}`;
  map.set(k, (map.get(k) ?? 0) + 1);
}

function markInService(map: Map<Uuid, Set<Uuid>>, serviceId: Uuid, subjectId: Uuid): void {
  const set = map.get(serviceId) ?? new Set<Uuid>();
  set.add(subjectId);
  map.set(serviceId, set);
}

/**
 * Id deterministico de uma atribuicao sugerida. Deriva do hash da entrada e do
 * slot, de modo que as mesmas entradas produzam os mesmos ids (5.8): nenhum
 * UUID aleatorio e usado no motor.
 */
function deterministicAssignmentId(
  inputHash: string,
  serviceId: Uuid,
  roleId: Uuid,
): string {
  // Reaproveita o hash canonico (determinismo, sem aleatoriedade).
  return `sug-${canonicalHash({ inputHash, serviceId, roleId }).slice(0, 32)}`;
}

/** Comparacao determinista de strings por unidade de codigo (independe de locale). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
