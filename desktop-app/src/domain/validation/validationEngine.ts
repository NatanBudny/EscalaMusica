// ValidationEngine: motor de validacao PURO e deterministico (design.md ->
// "Components and Interfaces" -> ValidationEngine: "Avaliacao incremental e
// completa. Funcao pura; resultado identifica revisao e rule set").
//
// Tarefa 8.1 do plano de implementacao. Requisitos 4.15, 7.1-7.25, 12.4, 12.13,
// 14.5.
//
// TypeScript puro, sem I/O, sem estado global, sem aleatoriedade, sem hora atual
// nem locale da maquina. NENHUM modelo paralelo: reusa os tipos canonicos de
// `schemas/models.ts` (ValidationReport, ValidationFinding, ScheduleDraft,
// Service, ExternalInput, Unavailability, ApprovedRuleSet, Rule, ...), a DSL
// limitada de `rules/predicate.ts`, o RuleSetService (versao ativa + excecoes +
// vigencia 6.5/6.8), a derivacao de indisponibilidade efetiva de
// `cycle/unavailability.ts` e o hashing canonico de `schemas/canonical.ts`.
//
// Princípios do desenho aplicados (design.md, "Principios do desenho"):
//  4. "Validacao e sugestao sao puras." Mesmas entradas versionadas geram os
//     mesmos resultados. O engine NUNCA muta nenhuma entrada (12.13 / 12.4).
//
// Visao geral das garantias (requirements.md, Requisito 7):
//  7.1  validacao incremental: reavaliar apenas as regras que dependem do campo
//       alterado e substituir seus resultados; o conjunto final e IGUAL ao da
//       validacao completa (Property 25 / 14.5).
//  7.2  validacao completa avalia cada culto e cada atribuicao contra todas as
//       regras aplicaveis da versao registrada no ciclo.
//  7.3  cada achado informa culto/data, funcao/campo, valor/atribuicao, regra,
//       severidade, motivo e acao necessaria.
//  7.4  Regra_Fundamental violada => Bloqueio.
//  7.5  Preferencia_de_Escala nao atendida => Aviso.
//  7.6  data duplicada no rascunho => Bloqueio por ocorrencia, identificando os
//       cultos envolvidos.
//  7.7  nome individual sem correspondencia unica => Bloqueio (sem associacao).
//  7.8  equipe de louvor fora da quantidade definida => Bloqueio.
//  7.9  equipe de louvor fora da composicao de genero definida => Bloqueio.
//  7.10 quarta-feira com funcao propria de louvor => Bloqueio.
//  7.11 quarta-feira sem cada dado externo obrigatorio => Bloqueio (identifica).
//  7.12 sabado sem cada mensagem musical exigida => Bloqueio (identifica).
//  7.13 pessoa indisponivel na data da atribuicao => Bloqueio.
//  7.14 funcoes incompativeis no mesmo culto => Bloqueio (identifica).
//  7.15 funcao externa conflita com funcao propria sem excecao => Bloqueio.
//  7.16 habilitacao ausente ou dia nao permitido => Bloqueio.
//  7.17 regra de sequencia entre cultos => severidade definida pela regra.
//  7.18 limite mensal de mensagem musical ultrapassado => Bloqueio.
//  7.19 departamento no louvor com campo obrigatorio ausente/invalido => Bloqueio.
//  7.20 observacao publica com conteudo privado => Bloqueio (sem expor o valor).
//  7.21 observacao publica fora da convencao publica => Bloqueio.
//  7.22 pessoa que recebera comunicacao sem contato publico => Aviso.
//  7.23 enquanto houver Bloqueio ou validacao incompleta, publicacao desabilitada
//       (ver `canPublish`).
//  7.24 relatorio apresenta revisao/versao validadas e os totais e a relacao de
//       cada resultado (Property 29).
//  7.25 verificacao inconclusiva (dados ausentes/invalidos) => Bloqueio,
//       identificando a verificacao e os dados; rascunho preservado; acao para
//       repetir (12.4). Equivalente ao "falha inconclusiva vira bloqueio".
//
// Os identificadores dos achados sao DETERMINISTICOS (derivados do conteudo do
// achado), para que a mesma entrada produza exatamente o mesmo relatorio (7.24,
// Property 29) e para que a validacao incremental substitua achados por chave
// estavel (7.1 / Property 25).

import {
  contextFromMap,
  evaluatePredicate,
  type EvalContext,
} from '../rules/predicate';
import { canonicalHash } from '../schemas/canonical';
import {
  deriveEffectiveUnavailabilities,
  type EffectiveUnavailability,
  type PropagationConfig,
} from '../cycle/unavailability';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedException,
  ApprovedRuleSet,
  Assignment,
  Department,
  ExternalInput,
  IsoDate,
  Person,
  Rule,
  ScheduleDraft,
  Service,
  Unavailability,
  Uuid,
  ValidationFinding,
  ValidationReport,
  Weekday,
} from '../schemas/models';

// --------------------------------------------------------------------------
// Catalogo de verificacoes (regras estruturais nomeadas)
// --------------------------------------------------------------------------

/**
 * Catalogo COMPLETO de verificacoes estruturais do validador (7.6-7.22). Cada
 * verificacao tem um id estavel (`checkId`) usado para a validacao incremental
 * (7.1): quando um campo muda, somente as verificacoes que dependem desse campo
 * sao reavaliadas. Alem destas, o validador tambem avalia as regras da versao
 * (DSL) para RF/Preferencias genericas (7.4/7.5).
 */
export type StructuralCheckId =
  | 'duplicate-date' // 7.6
  | 'identity' // 7.7
  | 'team-size' // 7.8
  | 'team-gender' // 7.9
  | 'wednesday-own-worship' // 7.10
  | 'wednesday-required-external' // 7.11
  | 'saturday-messages' // 7.12
  | 'unavailability' // 7.13
  | 'incompatibility' // 7.14
  | 'external-own-worship-conflict' // 7.15
  | 'capability-weekday' // 7.16
  | 'sequence' // 7.17
  | 'monthly-message-limit' // 7.18
  | 'department-worship' // 7.19
  | 'private-in-public-observation' // 7.20
  | 'public-observation-convention' // 7.21
  | 'contact' // 7.22
  | 'rules-dsl'; // 7.4/7.5 (RF/Preferencias declarativas)

/** Todos os ids de verificacao, em ordem canonica estavel. */
export const STRUCTURAL_CHECK_IDS: readonly StructuralCheckId[] = [
  'duplicate-date',
  'identity',
  'team-size',
  'team-gender',
  'wednesday-own-worship',
  'wednesday-required-external',
  'saturday-messages',
  'unavailability',
  'incompatibility',
  'external-own-worship-conflict',
  'capability-weekday',
  'sequence',
  'monthly-message-limit',
  'department-worship',
  'private-in-public-observation',
  'public-observation-convention',
  'contact',
  'rules-dsl',
];

/**
 * Campos do rascunho/insumos dos quais cada verificacao DEPENDE. Usado pela
 * validacao incremental (7.1): alterar um campo invalida apenas as verificacoes
 * que dependem dele. Os nomes de campo sao estaveis e independem do schema de
 * UI; refletem as dimensoes semanticas avaliadas.
 */
export type ValidatedField =
  | 'service.date'
  | 'service.weekday'
  | 'assignment.subject'
  | 'assignment.role'
  | 'team'
  | 'external.elder'
  | 'external.preacher'
  | 'external.audio'
  | 'external.sabbath-school-song'
  | 'external.theme'
  | 'external.song-request'
  | 'external.observation'
  | 'unavailability'
  | 'registry.identity'
  | 'registry.capability'
  | 'registry.contact';

/** Mapa verificacao -> campos que a afetam (dependencias, 7.1). */
export const CHECK_DEPENDENCIES: Readonly<Record<StructuralCheckId, readonly ValidatedField[]>> = {
  'duplicate-date': ['service.date'],
  identity: ['assignment.subject', 'registry.identity'],
  'team-size': ['assignment.subject', 'assignment.role', 'team'],
  'team-gender': ['assignment.subject', 'assignment.role', 'team'],
  'wednesday-own-worship': ['service.weekday', 'assignment.role', 'assignment.subject'],
  'wednesday-required-external': [
    'service.weekday',
    'external.elder',
    'external.preacher',
    'external.audio',
    'external.sabbath-school-song',
    'external.theme',
    'external.song-request',
  ],
  'saturday-messages': ['service.weekday', 'assignment.role', 'assignment.subject'],
  unavailability: ['assignment.subject', 'unavailability', 'service.date'],
  incompatibility: ['assignment.subject', 'assignment.role'],
  'external-own-worship-conflict': ['assignment.role', 'external.elder', 'assignment.subject'],
  'capability-weekday': ['assignment.subject', 'assignment.role', 'service.weekday', 'registry.capability'],
  sequence: ['assignment.subject', 'assignment.role', 'service.date'],
  'monthly-message-limit': ['assignment.subject', 'assignment.role'],
  'department-worship': ['external.preacher', 'assignment.subject', 'assignment.role'],
  'private-in-public-observation': ['external.observation'],
  'public-observation-convention': ['external.observation'],
  contact: ['assignment.subject', 'registry.contact'],
  'rules-dsl': [
    'assignment.subject',
    'assignment.role',
    'service.weekday',
    'service.date',
    'registry.capability',
  ],
};

// --------------------------------------------------------------------------
// Configuracao estrutural derivada do Conjunto_de_Regras_Ativo
// --------------------------------------------------------------------------

/**
 * Parametros estruturais que o Conjunto_de_Regras_Ativo define para o ciclo e
 * que as verificacoes nomeadas consomem (7.8-7.19). O modelo de regras atual
 * (schemas/models.ts) nao modela estes parametros em campos dedicados, portanto
 * o chamador os informa como derivados DA MESMA versao de regras do ciclo
 * (nunca de valores livres de UI). Isso evita um modelo paralelo: a fonte unica
 * continua sendo o RuleSet; esta struct e apenas a leitura tipada do que a
 * versao prescreve.
 */
export interface RuleSetStructuralConfig {
  /** Funcoes consideradas "equipe de louvor" (para tamanho/genero/7.8-7.9). */
  worshipTeamRoleIds: readonly Uuid[];
  /** Tamanho exigido da equipe de louvor em culto normal (7.8). */
  worshipTeamSize?: number;
  /** Composicao de genero exigida: minimos por genero (7.9). */
  worshipTeamGender?: { minMale?: number; minFemale?: number };
  /** Funcoes PROPRIAS de louvor que NAO podem ocorrer na quarta (7.10). */
  wednesdayForbiddenWorshipRoleIds: readonly Uuid[];
  /** Tipos de insumo obrigatorios na quarta (7.11). */
  wednesdayRequiredExternalTypes: readonly ExternalInput['type'][];
  /** Numero exigido de mensagens musicais no sabado (7.12). Ex.: 2 (ES + Culto). */
  saturdayRequiredMessageCount?: number;
  /** Funcoes que representam "mensagem musical" (sabado/limite, 7.12/7.18). */
  musicalMessageRoleIds: readonly Uuid[];
  /** Pares de funcoes incompativeis no mesmo culto (7.14). Ordem interna irrelevante. */
  incompatibleRolePairs: readonly (readonly [Uuid, Uuid])[];
  /** Funcoes "externas" (ancião/pregador) que conflitam com funcao propria (7.15). */
  externalRoleIds: readonly Uuid[];
  /** Funcoes PROPRIAS do louvor que conflitam com funcao externa (7.15). */
  ownWorshipRoleIds: readonly Uuid[];
  /** Limite mensal de mensagem musical por pessoa (7.18). */
  monthlyMessageLimit?: number;
  /** Funcoes que o Departamento deve preencher quando assume o louvor (7.19). */
  departmentWorshipRequiredRoleIds: readonly Uuid[];
  /** Funcao do pregador (para detectar Departamento-pregador, 7.19). */
  preacherRoleId?: Uuid;
  /** Prefixo publico exigido para observacoes publicas (7.21). Ex.: "Aviso:". */
  publicObservationPrefix?: string;
  /** Finalidade de autorizacao de contato publico (7.22). */
  contactPurpose?: string;
  /** Funcoes que exigem comunicacao (contato publico) ao sujeito (7.22). */
  communicationRoleIds: readonly Uuid[];
  /** Regras de sequencia entre cultos (7.17), com a severidade definida na versao. */
  sequenceRules?: readonly SequenceRule[];
  /** Config de propagacao de indisponibilidade (reuso do modulo de cycle). */
  propagation: PropagationConfig;
}

/**
 * Regra de sequencia entre cultos (7.17): o mesmo sujeito na mesma funcao em
 * datas consecutivas separadas por menos de `minGapDays` dias. A severidade e a
 * definida pela versao de regras (pode ser bloqueante ou aviso).
 */
export interface SequenceRule {
  ruleId: Uuid;
  roleId: Uuid;
  minGapDays: number;
  severity: 'blocking' | 'warning';
}

// --------------------------------------------------------------------------
// Entrada completa do validador
// --------------------------------------------------------------------------

/**
 * Entrada imutavel da validacao. Todas as colecoes sao somente-leitura; o
 * engine nunca as muta (pureza, 12.13/12.4). O `registry` tambem e somente
 * leitura (pessoas/departamentos e autorizacoes de contato).
 */
export interface ValidationInput {
  cycleId: Uuid;
  draft: ScheduleDraft;
  /** Cultos do ciclo (removidos sao ignorados pelo engine). */
  services: readonly Service[];
  externalInputs: readonly ExternalInput[];
  unavailabilities: readonly Unavailability[];
  /** Cadastro somente leitura (pessoas/departamentos). */
  people: readonly Person[];
  departments: readonly Department[];
  /** Historico de atribuicoes confirmadas (sequencia entre ciclos, 7.17). */
  history?: readonly ConfirmedAssignment[];
  /** Versao ativa do Conjunto_de_Regras_Ativo registrada para o ciclo. */
  ruleSet: ApprovedRuleSet;
  exceptions: readonly ApprovedException[];
  /** Parametros estruturais derivados da MESMA versao de regras. */
  structural: RuleSetStructuralConfig;
  /**
   * Autorizacoes de contato publico vigentes por pessoa (7.22). O engine so
   * precisa saber se a pessoa TEM contato publico vigente; o chamador resolve a
   * autorizacao (sem vazar valor). Conjunto de ids de pessoas com contato ok.
   */
  peopleWithPublicContact?: ReadonlySet<Uuid>;
  /** Classificacao de observacoes como privadas por id de insumo (7.20). */
  privateObservationInputIds?: ReadonlySet<Uuid>;
}

/** Atribuicao confirmada de escalas anteriores (sequencia, 7.17). */
export interface ConfirmedAssignment {
  subjectId: Uuid;
  roleId: Uuid;
  date: IsoDate;
}

// --------------------------------------------------------------------------
// Achado interno (antes de virar ValidationFinding com id deterministico)
// --------------------------------------------------------------------------

interface RawFinding {
  checkId: StructuralCheckId;
  ruleId: Uuid;
  severity: 'blocking' | 'warning';
  serviceId?: Uuid;
  date?: IsoDate;
  roleOrField?: string;
  /** Referencia SEGURA (nunca conteudo privado nem segredo). */
  offendingReference?: string;
  reason: string;
  requiredAction: string;
}

// --------------------------------------------------------------------------
// API publica: validacao completa (7.2)
// --------------------------------------------------------------------------

/**
 * Executa a validacao COMPLETA do rascunho (7.2): avalia TODAS as verificacoes
 * estruturais e as regras da versao sobre todos os cultos e atribuicoes, SEM
 * modificar nenhuma entrada (12.13). Produz um `ValidationReport` canonico com
 * bloqueios, avisos, revisao, versao de regras, total de aprovacoes e a relacao
 * individual de cada achado (7.24).
 *
 * Uma verificacao que nao puder ser concluida por dados ausentes/invalidos
 * produz um Bloqueio inconclusivo (7.25): nenhuma entrada e modificada.
 */
export function validateComplete(input: ValidationInput): ValidationReport {
  const checkIds = STRUCTURAL_CHECK_IDS;
  const results = runChecks(input, checkIds);
  return assembleReport(input, results);
}

/**
 * Resultado intermediario por verificacao: os achados que a verificacao
 * produziu e se ela pode ser aplicada (`passed` quando nao produziu achado).
 * Mantemos o mapa por checkId para suportar a validacao incremental (7.1).
 */
export type CheckResults = Map<StructuralCheckId, RawFinding[]>;

// --------------------------------------------------------------------------
// API publica: validacao incremental (7.1 / 14.5 / Property 25)
// --------------------------------------------------------------------------

/**
 * Executa a validacao INCREMENTAL (7.1): dado o conjunto de campos alterados e
 * os resultados por verificacao da revisao anterior, reavalia SOMENTE as
 * verificacoes que dependem de algum campo alterado e substitui os resultados
 * dessas verificacoes, preservando os demais. O relatorio resultante e
 * IDENTICO ao de uma validacao completa da nova revisao (Property 25), porque:
 *  - o conjunto de verificacoes e fixo e exaustivo;
 *  - cada verificacao e pura e depende apenas das entradas atuais;
 *  - CHECK_DEPENDENCIES mapeia corretamente campo -> verificacoes dependentes;
 *  - verificacoes nao dependentes do campo produzem o MESMO resultado e podem
 *    ser reusadas sem reavaliacao.
 *
 * `previous` deve conter os resultados por verificacao da revisao ANTERIOR
 * (ver `runAllChecks`). Para a PRIMEIRA validacao, use `validateComplete`.
 */
export function validateIncremental(
  input: ValidationInput,
  previous: CheckResults,
  changedFields: readonly ValidatedField[],
): ValidationReport {
  const changed = new Set(changedFields);
  const toReevaluate = STRUCTURAL_CHECK_IDS.filter((checkId) =>
    CHECK_DEPENDENCIES[checkId].some((f) => changed.has(f)),
  );

  const merged: CheckResults = new Map(previous);
  const fresh = runChecks(input, toReevaluate);
  for (const checkId of toReevaluate) {
    merged.set(checkId, fresh.get(checkId) ?? []);
  }
  // Garante que verificacoes ausentes do `previous` (ex.: primeira vez) sejam
  // avaliadas; caso contrario a equivalencia com a completa quebraria.
  const missing = STRUCTURAL_CHECK_IDS.filter((c) => !merged.has(c));
  if (missing.length > 0) {
    const extra = runChecks(input, missing);
    for (const c of missing) merged.set(c, extra.get(c) ?? []);
  }

  return assembleReport(input, merged);
}

/**
 * Executa TODAS as verificacoes e devolve os resultados por verificacao. Util
 * como ponto de partida da validacao incremental (guardar os resultados da
 * revisao atual para reuso quando um campo mudar).
 */
export function runAllChecks(input: ValidationInput): CheckResults {
  return runChecks(input, STRUCTURAL_CHECK_IDS);
}

// --------------------------------------------------------------------------
// Execucao das verificacoes
// --------------------------------------------------------------------------

function runChecks(input: ValidationInput, checkIds: readonly StructuralCheckId[]): CheckResults {
  const results: CheckResults = new Map();
  const ctx = buildEngineContext(input);
  for (const checkId of checkIds) {
    results.set(checkId, runSingleCheck(checkId, input, ctx));
  }
  return results;
}

/** Contexto derivado (indices) compartilhado por todas as verificacoes. */
interface EngineContext {
  activeServices: Service[];
  personById: Map<Uuid, Person>;
  departmentById: Map<Uuid, Department>;
  assignmentsByService: Map<Uuid, Assignment[]>;
  externalByService: Map<Uuid, ExternalInput[]>;
  effectiveUnavailability: EffectiveUnavailability[];
  unavailableByPersonDate: Set<string>;
}

function buildEngineContext(input: ValidationInput): EngineContext {
  const activeServices = [...input.services]
    .filter((s) => s.removed === undefined)
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id));

  const personById = new Map<Uuid, Person>(input.people.map((p) => [p.id, p]));
  const departmentById = new Map<Uuid, Department>(input.departments.map((d) => [d.id, d]));

  const assignmentsByService = new Map<Uuid, Assignment[]>();
  for (const a of input.draft.assignments) {
    const list = assignmentsByService.get(a.serviceId) ?? [];
    list.push(a);
    assignmentsByService.set(a.serviceId, list);
  }
  for (const [, list] of assignmentsByService) {
    list.sort((a, b) => cmp(a.roleId, b.roleId) || cmp(a.id, b.id));
  }

  const externalByService = new Map<Uuid, ExternalInput[]>();
  for (const e of input.externalInputs) {
    const list = externalByService.get(e.serviceId) ?? [];
    list.push(e);
    externalByService.set(e.serviceId, list);
  }

  const effectiveUnavailability = deriveEffectiveUnavailabilities({
    unavailabilities: input.unavailabilities,
    services: input.services,
    people: input.people,
    propagation: input.structural.propagation,
  });
  const unavailableByPersonDate = new Set<string>(
    effectiveUnavailability.map((e) => `${e.personId}\u0000${e.date}`),
  );

  return {
    activeServices,
    personById,
    departmentById,
    assignmentsByService,
    externalByService,
    effectiveUnavailability,
    unavailableByPersonDate,
  };
}

function runSingleCheck(
  checkId: StructuralCheckId,
  input: ValidationInput,
  ctx: EngineContext,
): RawFinding[] {
  switch (checkId) {
    case 'duplicate-date':
      return checkDuplicateDate(ctx);
    case 'identity':
      return checkIdentity(input, ctx);
    case 'team-size':
      return checkTeamSize(input, ctx);
    case 'team-gender':
      return checkTeamGender(input, ctx);
    case 'wednesday-own-worship':
      return checkWednesdayOwnWorship(input, ctx);
    case 'wednesday-required-external':
      return checkWednesdayRequiredExternal(input, ctx);
    case 'saturday-messages':
      return checkSaturdayMessages(input, ctx);
    case 'unavailability':
      return checkUnavailability(ctx);
    case 'incompatibility':
      return checkIncompatibility(input, ctx);
    case 'external-own-worship-conflict':
      return checkExternalOwnWorshipConflict(input, ctx);
    case 'capability-weekday':
      return checkCapabilityWeekday(ctx);
    case 'sequence':
      return checkSequence(input, ctx);
    case 'monthly-message-limit':
      return checkMonthlyMessageLimit(input, ctx);
    case 'department-worship':
      return checkDepartmentWorship(input, ctx);
    case 'private-in-public-observation':
      return checkPrivateInPublicObservation(input, ctx);
    case 'public-observation-convention':
      return checkPublicObservationConvention(input, ctx);
    case 'contact':
      return checkContact(input, ctx);
    case 'rules-dsl':
      return checkRulesDsl(input, ctx);
    default: {
      const never: never = checkId;
      throw new Error(`verificacao desconhecida: ${String(never)}`);
    }
  }
}

// --------------------------------------------------------------------------
// 7.6 Data duplicada
// --------------------------------------------------------------------------

function checkDuplicateDate(ctx: EngineContext): RawFinding[] {
  const byDate = new Map<IsoDate, Service[]>();
  for (const s of ctx.activeServices) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  const findings: RawFinding[] = [];
  for (const [date, group] of byDate) {
    if (group.length <= 1) continue;
    const involved = group.map((g) => g.id).sort(cmp);
    // 7.6: Bloqueio para cada ocorrencia duplicada (alem da primeira).
    for (let i = 1; i < group.length; i++) {
      const svc = group[i] as Service;
      findings.push({
        checkId: 'duplicate-date',
        ruleId: 'estrutural:duplicidade-de-data',
        severity: 'blocking',
        serviceId: svc.id,
        date,
        roleOrField: 'service.date',
        offendingReference: `cultos: ${involved.join(', ')}`,
        reason: `a data ${date} aparece em mais de um culto do rascunho`,
        requiredAction: 'remova ou ajuste os cultos duplicados ate que cada data seja unica',
      });
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.7 Identidade nao unica (sujeito individual sem correspondencia unica)
// --------------------------------------------------------------------------

function checkIdentity(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const a of input.draft.assignments) {
    if (a.subject.type !== 'person') continue;
    const exists = ctx.personById.has(a.subject.id);
    if (exists) continue;
    // 7.7: nome individual sem correspondencia unica => Bloqueio sem associacao.
    findings.push({
      checkId: 'identity',
      ruleId: 'estrutural:identidade-nao-unica',
      severity: 'blocking',
      serviceId: a.serviceId,
      ...optDate(dateOf(ctx, a.serviceId)),
      roleOrField: a.roleId,
      offendingReference: `atribuicao: ${a.id}`,
      reason: 'a atribuicao referencia uma pessoa que nao corresponde de forma unica ao Cadastro_Central',
      requiredAction: 'selecione uma Pessoa_Canonica existente para a funcao',
    });
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.8 Tamanho da equipe de louvor
// --------------------------------------------------------------------------

function checkTeamSize(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const cfg = input.structural;
  if (cfg.worshipTeamSize === undefined || cfg.worshipTeamRoleIds.length === 0) return [];
  const teamRoles = new Set(cfg.worshipTeamRoleIds);
  const findings: RawFinding[] = [];
  for (const svc of ctx.activeServices) {
    if (svc.kind !== 'regular') continue;
    const team = (ctx.assignmentsByService.get(svc.id) ?? []).filter((a) =>
      teamRoles.has(a.roleId),
    );
    if (team.length === cfg.worshipTeamSize) continue;
    findings.push({
      checkId: 'team-size',
      ruleId: 'estrutural:tamanho-de-equipe',
      severity: 'blocking',
      serviceId: svc.id,
      date: svc.date,
      roleOrField: 'equipe-de-louvor',
      offendingReference: `tamanho: ${team.length}`,
      reason: `a equipe de louvor tem ${team.length} integrante(s); o exigido e ${cfg.worshipTeamSize}`,
      requiredAction: `ajuste a equipe para exatamente ${cfg.worshipTeamSize} integrante(s)`,
    });
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.9 Composicao de genero da equipe de louvor
// --------------------------------------------------------------------------

/**
 * Genero de uma pessoa, lido de uma nota administrativa estruturada quando
 * presente. O schema atual nao modela genero explicitamente; usamos uma
 * capability-convencao opcional (`gender:male` / `gender:female`) para nao criar
 * um modelo paralelo. Pessoas sem genero declarado tornam a verificacao
 * INCONCLUSIVA quando a regra de genero esta ativa (7.25).
 */
function genderOf(person: Person): 'male' | 'female' | undefined {
  if (person.capabilityIds.includes('gender:male')) return 'male';
  if (person.capabilityIds.includes('gender:female')) return 'female';
  return undefined;
}

function checkTeamGender(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const cfg = input.structural;
  if (cfg.worshipTeamGender === undefined || cfg.worshipTeamRoleIds.length === 0) return [];
  const teamRoles = new Set(cfg.worshipTeamRoleIds);
  const { minMale = 0, minFemale = 0 } = cfg.worshipTeamGender;
  const findings: RawFinding[] = [];

  for (const svc of ctx.activeServices) {
    if (svc.kind !== 'regular') continue;
    const team = (ctx.assignmentsByService.get(svc.id) ?? []).filter((a) =>
      teamRoles.has(a.roleId) && a.subject.type === 'person',
    );
    if (team.length === 0) continue;

    let male = 0;
    let female = 0;
    let unknown = 0;
    for (const a of team) {
      const person = ctx.personById.get(a.subject.id);
      const g = person ? genderOf(person) : undefined;
      if (g === 'male') male++;
      else if (g === 'female') female++;
      else unknown++;
    }

    // 7.25: genero ausente torna a verificacao inconclusiva => Bloqueio.
    if (unknown > 0) {
      findings.push(inconclusive('team-gender', {
        serviceId: svc.id,
        date: svc.date,
        roleOrField: 'equipe-de-louvor',
        offendingReference: `integrantes sem genero declarado: ${unknown}`,
        reason: 'nao foi possivel conferir a composicao de genero: ha integrante sem genero declarado',
        requiredAction: 'declare o genero das pessoas da equipe e repita a validacao',
      }));
      continue;
    }

    if (male < minMale || female < minFemale) {
      findings.push({
        checkId: 'team-gender',
        ruleId: 'estrutural:composicao-de-genero',
        severity: 'blocking',
        serviceId: svc.id,
        date: svc.date,
        roleOrField: 'equipe-de-louvor',
        offendingReference: `masc=${male}, fem=${female}`,
        reason: `a composicao de genero (masc=${male}, fem=${female}) nao atende ao minimo (masc>=${minMale}, fem>=${minFemale})`,
        requiredAction: 'ajuste a equipe para atender a composicao de genero exigida',
      });
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.10 Quarta-feira com funcao propria de louvor
// --------------------------------------------------------------------------

function checkWednesdayOwnWorship(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const forbidden = new Set(input.structural.wednesdayForbiddenWorshipRoleIds);
  if (forbidden.size === 0) return [];
  const findings: RawFinding[] = [];
  for (const svc of ctx.activeServices) {
    if (svc.computedWeekday !== 'wednesday') continue;
    for (const a of ctx.assignmentsByService.get(svc.id) ?? []) {
      if (!forbidden.has(a.roleId)) continue;
      findings.push({
        checkId: 'wednesday-own-worship',
        ruleId: 'estrutural:quarta-funcao-propria',
        severity: 'blocking',
        serviceId: svc.id,
        date: svc.date,
        roleOrField: a.roleId,
        offendingReference: `atribuicao: ${a.id}`,
        reason: 'a quarta-feira contem uma funcao propria de louvor que nao e permitida nesse dia',
        requiredAction: 'remova a funcao propria de louvor da quarta-feira',
      });
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.11 Quarta-feira sem dado externo obrigatorio
// --------------------------------------------------------------------------

function checkWednesdayRequiredExternal(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const required = input.structural.wednesdayRequiredExternalTypes;
  if (required.length === 0) return [];
  const findings: RawFinding[] = [];
  for (const svc of ctx.activeServices) {
    if (svc.computedWeekday !== 'wednesday') continue;
    const present = new Set((ctx.externalByService.get(svc.id) ?? []).map((e) => e.type));
    for (const type of required) {
      if (present.has(type)) continue;
      findings.push({
        checkId: 'wednesday-required-external',
        ruleId: 'estrutural:quarta-insumo-obrigatorio',
        severity: 'blocking',
        serviceId: svc.id,
        date: svc.date,
        roleOrField: `external.${type}`,
        offendingReference: `insumo ausente: ${type}`,
        reason: `a quarta-feira nao contem o dado externo obrigatorio: ${type}`,
        requiredAction: `informe o insumo externo obrigatorio (${type}) para a quarta-feira`,
      });
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.12 Sabado sem mensagens musicais exigidas
// --------------------------------------------------------------------------

function checkSaturdayMessages(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const cfg = input.structural;
  if (cfg.saturdayRequiredMessageCount === undefined || cfg.musicalMessageRoleIds.length === 0) {
    return [];
  }
  const messageRoles = new Set(cfg.musicalMessageRoleIds);
  const findings: RawFinding[] = [];
  for (const svc of ctx.activeServices) {
    if (svc.computedWeekday !== 'saturday') continue;
    const count = (ctx.assignmentsByService.get(svc.id) ?? []).filter((a) =>
      messageRoles.has(a.roleId),
    ).length;
    if (count >= cfg.saturdayRequiredMessageCount) continue;
    findings.push({
      checkId: 'saturday-messages',
      ruleId: 'estrutural:sabado-mensagens',
      severity: 'blocking',
      serviceId: svc.id,
      date: svc.date,
      roleOrField: 'mensagem-musical',
      offendingReference: `mensagens presentes: ${count}`,
      reason: `o sabado tem ${count} mensagem(ns) musical(is); o exigido e ${cfg.saturdayRequiredMessageCount}`,
      requiredAction: `inclua as ${cfg.saturdayRequiredMessageCount} mensagens musicais exigidas no sabado`,
    });
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.13 Pessoa indisponivel na data da atribuicao
// --------------------------------------------------------------------------

function checkUnavailability(ctx: EngineContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const svc of ctx.activeServices) {
    for (const a of ctx.assignmentsByService.get(svc.id) ?? []) {
      if (a.subject.type !== 'person') continue;
      if (!ctx.unavailableByPersonDate.has(`${a.subject.id}\u0000${svc.date}`)) continue;
      findings.push({
        checkId: 'unavailability',
        ruleId: 'estrutural:indisponibilidade',
        severity: 'blocking',
        serviceId: svc.id,
        date: svc.date,
        roleOrField: a.roleId,
        offendingReference: `atribuicao: ${a.id}`,
        reason: 'a pessoa esta indisponivel na data desta atribuicao',
        requiredAction: 'substitua a pessoa indisponivel ou revise a indisponibilidade registrada',
      });
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.14 Funcoes incompativeis no mesmo culto
// --------------------------------------------------------------------------

function checkIncompatibility(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const pairs = input.structural.incompatibleRolePairs;
  if (pairs.length === 0) return [];
  const findings: RawFinding[] = [];
  for (const svc of ctx.activeServices) {
    const assignments = ctx.assignmentsByService.get(svc.id) ?? [];
    // Mapa sujeito -> conjunto de funcoes que ocupa neste culto.
    const rolesBySubject = new Map<Uuid, Set<Uuid>>();
    for (const a of assignments) {
      const set = rolesBySubject.get(a.subject.id) ?? new Set<Uuid>();
      set.add(a.roleId);
      rolesBySubject.set(a.subject.id, set);
    }
    for (const [subjectId, roles] of rolesBySubject) {
      for (const [r1, r2] of pairs) {
        if (roles.has(r1) && roles.has(r2)) {
          const conflicting = [r1, r2].sort(cmp);
          findings.push({
            checkId: 'incompatibility',
            ruleId: 'estrutural:incompatibilidade',
            severity: 'blocking',
            serviceId: svc.id,
            date: svc.date,
            roleOrField: conflicting.join(' + '),
            offendingReference: `sujeito: ${subjectId}`,
            reason: `o sujeito ocupa funcoes incompativeis no mesmo culto: ${conflicting.join(' e ')}`,
            requiredAction: 'atribua funcoes incompativeis a sujeitos diferentes',
          });
        }
      }
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.15 Funcao externa conflita com funcao propria do louvor (sem excecao)
// --------------------------------------------------------------------------

function checkExternalOwnWorshipConflict(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const externalRoles = new Set(input.structural.externalRoleIds);
  const ownRoles = new Set(input.structural.ownWorshipRoleIds);
  if (externalRoles.size === 0 || ownRoles.size === 0) return [];
  const findings: RawFinding[] = [];

  for (const svc of ctx.activeServices) {
    const assignments = ctx.assignmentsByService.get(svc.id) ?? [];
    const rolesBySubject = new Map<Uuid, Set<Uuid>>();
    for (const a of assignments) {
      const set = rolesBySubject.get(a.subject.id) ?? new Set<Uuid>();
      set.add(a.roleId);
      rolesBySubject.set(a.subject.id, set);
    }
    for (const [subjectId, roles] of rolesBySubject) {
      const hasExternal = [...roles].some((r) => externalRoles.has(r));
      const hasOwn = [...roles].some((r) => ownRoles.has(r));
      if (!hasExternal || !hasOwn) continue;

      // 7.15: so ha conflito quando NAO existe Excecao_Aprovada vigente para o
      // ancião, o culto e as funcoes conflitantes.
      const covered = hasApplicableExternalException(input, svc, subjectId);
      if (covered) continue;

      findings.push({
        checkId: 'external-own-worship-conflict',
        ruleId: 'estrutural:externo-vs-louvor',
        severity: 'blocking',
        serviceId: svc.id,
        date: svc.date,
        roleOrField: 'externo+louvor',
        offendingReference: `sujeito: ${subjectId}`,
        reason: 'uma funcao externa conflita com uma funcao propria do louvor e nao ha Excecao_Aprovada vigente',
        requiredAction: 'registre uma Excecao_Aprovada vigente ou separe as funcoes conflitantes',
      });
    }
  }
  return sortFindings(findings);
}

function hasApplicableExternalException(
  input: ValidationInput,
  svc: Service,
  subjectId: Uuid,
): boolean {
  const ctx = contextFromMap({
    'service.date': svc.date,
    'service.weekday': svc.computedWeekday,
    'service.kind': svc.kind,
    'assignment.subjectId': subjectId,
    'cycle.period': input.ruleSet.validFrom.slice(0, 7),
  });
  for (const exc of input.exceptions) {
    if (svc.date < exc.validFrom || svc.date > exc.validUntil) continue;
    if (evaluatePredicate(exc.condition, ctx)) return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// 7.16 Habilitacao ausente ou dia nao permitido
// --------------------------------------------------------------------------

function checkCapabilityWeekday(ctx: EngineContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const svc of ctx.activeServices) {
    for (const a of ctx.assignmentsByService.get(svc.id) ?? []) {
      if (a.subject.type !== 'person') continue;
      const person = ctx.personById.get(a.subject.id);
      if (!person) continue; // identidade ja tratada em 7.7
      const capable = person.capabilityIds.includes(a.roleId);
      const weekdayAllowed =
        person.allowedWeekdays.length === 0 ||
        person.allowedWeekdays.includes(svc.computedWeekday);
      if (capable && weekdayAllowed) continue;
      const restriction = !capable ? 'habilitacao ausente' : 'dia da semana nao permitido';
      findings.push({
        checkId: 'capability-weekday',
        ruleId: 'estrutural:habilitacao-ou-dia',
        severity: 'blocking',
        serviceId: svc.id,
        date: svc.date,
        roleOrField: a.roleId,
        offendingReference: `atribuicao: ${a.id}`,
        reason: `a atribuicao viola uma restricao do Cadastro_Central: ${restriction}`,
        requiredAction: !capable
          ? 'escolha uma pessoa habilitada para a funcao'
          : 'escolha uma pessoa cujo cadastro permita o dia da semana do culto',
      });
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.17 Regra de sequencia entre cultos (severidade definida pela versao)
// --------------------------------------------------------------------------

function checkSequence(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const rules = input.structural.sequenceRules ?? [];
  if (rules.length === 0) return [];
  const findings: RawFinding[] = [];

  // Datas por (sujeito, funcao), do rascunho e do historico, ordenadas.
  const historyByKey = new Map<string, IsoDate[]>();
  const push = (subjectId: Uuid, roleId: Uuid, date: IsoDate): void => {
    const k = `${subjectId}\u0000${roleId}`;
    const list = historyByKey.get(k) ?? [];
    list.push(date);
    historyByKey.set(k, list);
  };
  for (const h of input.history ?? []) push(h.subjectId, h.roleId, h.date);
  for (const svc of ctx.activeServices) {
    for (const a of ctx.assignmentsByService.get(svc.id) ?? []) {
      push(a.subject.id, a.roleId, svc.date);
    }
  }

  for (const rule of rules) {
    for (const svc of ctx.activeServices) {
      for (const a of ctx.assignmentsByService.get(svc.id) ?? []) {
        if (a.roleId !== rule.roleId) continue;
        const dates = (historyByKey.get(`${a.subject.id}\u0000${a.roleId}`) ?? [])
          .slice()
          .sort(cmp);
        // Ha outra data da mesma funcao a menos de minGapDays?
        const tooClose = dates.some(
          (d) => d !== svc.date && Math.abs(dayDiff(d, svc.date)) < rule.minGapDays,
        );
        if (!tooClose) continue;
        findings.push({
          checkId: 'sequence',
          ruleId: rule.ruleId,
          severity: rule.severity,
          serviceId: svc.id,
          date: svc.date,
          roleOrField: a.roleId,
          offendingReference: `atribuicao: ${a.id}`,
          reason: `a atribuicao viola a regra de sequencia (intervalo minimo de ${rule.minGapDays} dias)`,
          requiredAction: 'distribua a funcao com o intervalo minimo exigido entre os cultos',
        });
      }
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.18 Limite mensal de mensagem musical por pessoa
// --------------------------------------------------------------------------

function checkMonthlyMessageLimit(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const cfg = input.structural;
  if (cfg.monthlyMessageLimit === undefined || cfg.musicalMessageRoleIds.length === 0) return [];
  const messageRoles = new Set(cfg.musicalMessageRoleIds);
  const countBySubject = new Map<Uuid, number>();
  for (const svc of ctx.activeServices) {
    for (const a of ctx.assignmentsByService.get(svc.id) ?? []) {
      if (!messageRoles.has(a.roleId)) continue;
      countBySubject.set(a.subject.id, (countBySubject.get(a.subject.id) ?? 0) + 1);
    }
  }
  const findings: RawFinding[] = [];
  for (const [subjectId, count] of countBySubject) {
    if (count <= cfg.monthlyMessageLimit) continue;
    findings.push({
      checkId: 'monthly-message-limit',
      ruleId: 'estrutural:limite-mensal-mensagem',
      severity: 'blocking',
      roleOrField: 'mensagem-musical',
      offendingReference: `sujeito: ${subjectId}`,
      reason: `o sujeito ultrapassa o limite mensal de mensagem musical: ${count} de ${cfg.monthlyMessageLimit}`,
      requiredAction: `reduza as atribuicoes de mensagem musical do sujeito ao limite de ${cfg.monthlyMessageLimit}`,
    });
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.19 Departamento no louvor com campo obrigatorio ausente/invalido
// --------------------------------------------------------------------------

function checkDepartmentWorship(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const cfg = input.structural;
  if (cfg.departmentWorshipRequiredRoleIds.length === 0 || cfg.preacherRoleId === undefined) {
    return [];
  }
  const requiredRoles = cfg.departmentWorshipRequiredRoleIds;
  const findings: RawFinding[] = [];

  for (const svc of ctx.activeServices) {
    // O pregador e um Departamento reconhecido?
    const dept = preacherDepartmentFor(svc.id, ctx);
    if (!dept) continue;

    const assignments = ctx.assignmentsByService.get(svc.id) ?? [];
    for (const roleId of requiredRoles) {
      const filled = assignments.filter((a) => a.roleId === roleId);
      if (filled.length === 0) {
        findings.push({
          checkId: 'department-worship',
          ruleId: 'estrutural:departamento-louvor',
          severity: 'blocking',
          serviceId: svc.id,
          date: svc.date,
          roleOrField: roleId,
          offendingReference: `departamento: ${dept.id}`,
          reason: 'o Departamento assumiu o louvor, mas um campo obrigatorio da regra departamental esta ausente',
          requiredAction: `preencha a funcao obrigatoria (${roleId}) exigida pela regra departamental`,
        });
        continue;
      }
      // Valor nao permitido: a funcao deve ser preenchida pelo mesmo Departamento.
      for (const a of filled) {
        if (a.subject.type === 'department' && a.subject.id === dept.id) continue;
        findings.push({
          checkId: 'department-worship',
          ruleId: 'estrutural:departamento-louvor',
          severity: 'blocking',
          serviceId: svc.id,
          date: svc.date,
          roleOrField: roleId,
          offendingReference: `atribuicao: ${a.id}`,
          reason: 'a funcao obrigatoria da regra departamental nao foi atribuida ao mesmo Departamento',
          requiredAction: `atribua a funcao (${roleId}) ao Departamento responsavel pelo louvor`,
        });
      }
    }
  }
  return sortFindings(findings);
}

function preacherDepartmentFor(serviceId: Uuid, ctx: EngineContext): Department | undefined {
  const preachers = (ctx.externalByService.get(serviceId) ?? [])
    .filter((e) => e.type === 'preacher')
    .slice()
    .sort((a, b) => cmp(a.updatedAt, b.updatedAt));
  const latest = preachers[preachers.length - 1];
  if (!latest) return undefined;
  const subject = (latest.value as { subject?: { type: string; id: string } }).subject;
  if (!subject || subject.type !== 'department') return undefined;
  const dept = ctx.departmentById.get(subject.id);
  if (!dept || dept.status !== 'active') return undefined;
  return dept;
}

// --------------------------------------------------------------------------
// 7.20 Observacao publica com conteudo privado (sem expor o valor)
// --------------------------------------------------------------------------

function checkPrivateInPublicObservation(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const privateIds = input.privateObservationInputIds ?? new Set<Uuid>();
  const findings: RawFinding[] = [];
  for (const e of input.externalInputs) {
    if (e.type !== 'observation') continue;
    // Uma observacao publica que carrega conteudo classificado como privado.
    const classifiedPrivate = e.visibility === 'private' || privateIds.has(e.id);
    if (e.visibility === 'public' && classifiedPrivate) {
      findings.push({
        checkId: 'private-in-public-observation',
        ruleId: 'estrutural:privado-em-observacao-publica',
        severity: 'blocking',
        serviceId: e.serviceId,
        ...optDate(dateOf(ctx, e.serviceId)),
        roleOrField: 'external.observation',
        // NUNCA inclui o conteudo privado; apenas o id do insumo (7.20).
        offendingReference: `observacao: ${e.id}`,
        reason: 'a observacao publica contem conteudo classificado como Dado_Privado',
        requiredAction: 'reclassifique a observacao como privada ou remova o conteudo privado',
      });
    }
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.21 Observacao publica fora da convencao publica
// --------------------------------------------------------------------------

function checkPublicObservationConvention(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const prefix = input.structural.publicObservationPrefix;
  if (prefix === undefined || prefix.length === 0) return [];
  const findings: RawFinding[] = [];
  for (const e of input.externalInputs) {
    if (e.type !== 'observation') continue;
    if (e.visibility !== 'public') continue;
    const text = typeof e.value === 'string' ? e.value : stringValueOf(e.value);
    if (text === undefined) {
      // 7.25: nao foi possivel conferir a convencao (valor ausente/invalido).
      findings.push(inconclusive('public-observation-convention', {
        serviceId: e.serviceId,
        ...optDate(dateOf(ctx, e.serviceId)),
        roleOrField: 'external.observation',
        offendingReference: `observacao: ${e.id}`,
        reason: 'nao foi possivel conferir a convencao publica: o valor da observacao esta ausente ou invalido',
        requiredAction: 'informe o texto da observacao publica e repita a validacao',
      }));
      continue;
    }
    if (text.startsWith(prefix)) continue;
    findings.push({
      checkId: 'public-observation-convention',
      ruleId: 'estrutural:convencao-observacao-publica',
      severity: 'blocking',
      serviceId: e.serviceId,
      ...optDate(dateOf(ctx, e.serviceId)),
      roleOrField: 'external.observation',
      offendingReference: `observacao: ${e.id}`,
      reason: `a observacao publica nao atende a convencao exigida (prefixo "${prefix}")`,
      requiredAction: `inicie a observacao publica com o prefixo "${prefix}"`,
    });
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.22 Pessoa que recebera comunicacao sem contato publico (Aviso)
// --------------------------------------------------------------------------

function checkContact(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const roles = new Set(input.structural.communicationRoleIds);
  if (roles.size === 0) return [];
  const withContact = input.peopleWithPublicContact ?? new Set<Uuid>();
  const findings: RawFinding[] = [];
  // Agrupa por pessoa para um unico aviso por pessoa, listando as atribuicoes.
  const affectedByPerson = new Map<Uuid, Assignment[]>();
  for (const svc of ctx.activeServices) {
    for (const a of ctx.assignmentsByService.get(svc.id) ?? []) {
      if (a.subject.type !== 'person') continue;
      if (!roles.has(a.roleId)) continue;
      if (withContact.has(a.subject.id)) continue;
      const list = affectedByPerson.get(a.subject.id) ?? [];
      list.push(a);
      affectedByPerson.set(a.subject.id, list);
    }
  }
  for (const [personId, assignments] of affectedByPerson) {
    const refs = assignments.map((a) => a.id).sort(cmp).join(', ');
    findings.push({
      checkId: 'contact',
      ruleId: 'estrutural:contato-publico-ausente',
      severity: 'warning',
      roleOrField: 'contato',
      offendingReference: `pessoa: ${personId}; atribuicoes: ${refs}`,
      reason: 'a pessoa que recebera comunicacao nao possui contato publico aprovado no Cadastro_Central',
      requiredAction: 'autorize um contato publico para a pessoa ou confirme o aviso',
    });
  }
  return sortFindings(findings);
}

// --------------------------------------------------------------------------
// 7.4/7.5 Regras declarativas (DSL): RF => Bloqueio, Preferencia => Aviso
// --------------------------------------------------------------------------

function checkRulesDsl(input: ValidationInput, ctx: EngineContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const period = input.ruleSet.validFrom.slice(0, 7);
  const serviceDates = ctx.activeServices.map((s) => s.date);

  for (const rule of input.ruleSet.rules) {
    // 6.5: regra sem intersecao com nenhuma data de culto e desconsiderada.
    if (!ruleIntersectsCycle(input.ruleSet, serviceDates)) continue;

    for (const svc of ctx.activeServices) {
      for (const a of ctx.assignmentsByService.get(svc.id) ?? []) {
        const subject =
          a.subject.type === 'person'
            ? ctx.personById.get(a.subject.id)
            : ctx.departmentById.get(a.subject.id);
        const evalCtx = buildRuleContext(svc, a, subject, period);
        if (!evaluatePredicate(rule.applicability, evalCtx)) continue; // nao aplica
        if (evaluatePredicate(rule.assertion, evalCtx)) continue; // satisfeita

        // RF violada: procurar excecao vigente aplicavel (7.4 vs excecao).
        if (rule.kind === 'fundamental' && hasRuleException(input, rule, svc, evalCtx)) continue;

        findings.push({
          checkId: 'rules-dsl',
          ruleId: rule.id,
          severity: rule.kind === 'fundamental' ? 'blocking' : 'warning',
          serviceId: svc.id,
          date: svc.date,
          roleOrField: a.roleId,
          offendingReference: `atribuicao: ${a.id}`,
          reason:
            rule.kind === 'fundamental'
              ? `a atribuicao viola a Regra_Fundamental ${rule.id}`
              : `a atribuicao nao atende a Preferencia_de_Escala ${rule.id}`,
          requiredAction: rule.messageTemplate,
        });
      }
    }
  }
  return sortFindings(findings);
}

function hasRuleException(
  input: ValidationInput,
  rule: Rule,
  svc: Service,
  evalCtx: EvalContext,
): boolean {
  for (const exc of input.exceptions) {
    if (exc.fundamentalRuleId !== rule.id) continue;
    if (svc.date < exc.validFrom || svc.date > exc.validUntil) continue;
    if (evaluatePredicate(exc.condition, evalCtx)) return true;
  }
  return false;
}

function buildRuleContext(
  svc: Service,
  a: Assignment,
  subject: Person | Department | undefined,
  period: string,
): EvalContext {
  const person = subject && 'participation' in subject ? (subject as Person) : undefined;
  return contextFromMap({
    'service.date': svc.date,
    'service.weekday': svc.computedWeekday,
    'service.kind': svc.kind,
    'assignment.roleId': a.roleId,
    'assignment.slot': a.slot ?? '',
    'assignment.subjectType': a.subject.type,
    'assignment.subjectId': a.subject.id,
    'subject.capabilityIds': person ? [...person.capabilityIds] : [],
    'subject.allowedWeekdays': person ? [...person.allowedWeekdays] : [],
    'subject.participation': person ? person.participation : 'active',
    'cycle.period': period,
  });
}

/** 6.5: a versao intersecta o ciclo quando ao menos uma data esta na vigencia. */
function ruleIntersectsCycle(ruleSet: ApprovedRuleSet, serviceDates: readonly IsoDate[]): boolean {
  return serviceDates.some(
    (d) => d >= ruleSet.validFrom && (ruleSet.validUntil === undefined || d <= ruleSet.validUntil),
  );
}

// --------------------------------------------------------------------------
// Montagem do relatorio canonico (7.24 / Property 29)
// --------------------------------------------------------------------------

/**
 * Monta o `ValidationReport` a partir dos resultados por verificacao. Cada
 * achado recebe um `findingId` DETERMINISTICO (hash canonico do seu conteudo),
 * para que a mesma entrada produza exatamente o mesmo relatorio. Bloqueios e
 * avisos sao conjuntos DISJUNTOS (7.24/Property 29); as contagens correspondem
 * as relacoes apresentadas; `passedCount` = total de verificacoes aplicadas que
 * nao produziram nenhum achado.
 */
function assembleReport(input: ValidationInput, results: CheckResults): ValidationReport {
  const all: ValidationFinding[] = [];
  let passedCount = 0;

  for (const checkId of STRUCTURAL_CHECK_IDS) {
    const raws = results.get(checkId) ?? [];
    if (raws.length === 0) {
      passedCount += 1; // verificacao aplicada sem achado => aprovada
      continue;
    }
    for (const raw of raws) all.push(toFinding(raw));
  }

  // Dedup por findingId (uma mesma condicao nunca aparece duas vezes).
  const byId = new Map<Uuid, ValidationFinding>();
  for (const f of all) if (!byId.has(f.findingId)) byId.set(f.findingId, f);
  const unique = [...byId.values()].sort(compareFinding);

  const blocking = unique.filter((f) => f.severity === 'blocking');
  const warnings = unique.filter((f) => f.severity === 'warning');

  return {
    schemaVersion: SCHEMA_VERSION,
    reportId: deterministicReportId(input),
    cycleId: input.cycleId,
    draftRevision: input.draft.revision,
    ruleSetVersion: input.ruleSet.version,
    status: 'complete',
    blocking,
    warnings,
    passedCount,
    // Instante canonico derivado da revisao: puro e deterministico (nao usa a
    // hora atual da maquina, mantendo a validacao reproducivel).
    createdAt: deterministicCreatedAt(input),
  };
}

function toFinding(raw: RawFinding): ValidationFinding {
  const base: ValidationFinding = {
    findingId: deterministicFindingId(raw),
    ruleId: raw.ruleId,
    severity: raw.severity,
    reason: raw.reason,
    requiredAction: raw.requiredAction,
  };
  if (raw.serviceId !== undefined) base.serviceId = raw.serviceId;
  if (raw.date !== undefined) base.date = raw.date;
  if (raw.roleOrField !== undefined) base.roleOrField = raw.roleOrField;
  if (raw.offendingReference !== undefined) base.offendingReference = raw.offendingReference;
  return base;
}

// --------------------------------------------------------------------------
// Gate de publicacao (7.23)
// --------------------------------------------------------------------------

/**
 * 7.23: a publicacao SO e permitida quando a validacao da revisao atual esta
 * COMPLETA e sem Bloqueios. Qualquer bloqueio (inclusive os inconclusivos de
 * 7.25) ou status != 'complete' mantem a publicacao desabilitada.
 */
export function canPublish(report: ValidationReport): boolean {
  return report.status === 'complete' && report.blocking.length === 0;
}

// --------------------------------------------------------------------------
// Achado inconclusivo (7.25): verificacao que nao pode concluir vira Bloqueio
// --------------------------------------------------------------------------

function inconclusive(
  checkId: StructuralCheckId,
  parts: {
    serviceId?: Uuid;
    date?: IsoDate;
    roleOrField?: string;
    offendingReference?: string;
    reason: string;
    requiredAction: string;
  },
): RawFinding {
  return {
    checkId,
    ruleId: `inconclusivo:${checkId}`,
    severity: 'blocking',
    ...(parts.serviceId !== undefined ? { serviceId: parts.serviceId } : {}),
    ...(parts.date !== undefined ? { date: parts.date } : {}),
    ...(parts.roleOrField !== undefined ? { roleOrField: parts.roleOrField } : {}),
    ...(parts.offendingReference !== undefined
      ? { offendingReference: parts.offendingReference }
      : {}),
    reason: parts.reason,
    requiredAction: parts.requiredAction,
  };
}

// --------------------------------------------------------------------------
// Ids e ordenacao deterministicos
// --------------------------------------------------------------------------

/** Id deterministico do achado: hash canonico do seu conteudo (sem o id). */
function deterministicFindingId(raw: RawFinding): Uuid {
  return `vf-${canonicalHash({
    checkId: raw.checkId,
    ruleId: raw.ruleId,
    severity: raw.severity,
    serviceId: raw.serviceId ?? null,
    date: raw.date ?? null,
    roleOrField: raw.roleOrField ?? null,
    offendingReference: raw.offendingReference ?? null,
    reason: raw.reason,
    requiredAction: raw.requiredAction,
  }).slice(0, 32)}`;
}

/** Id deterministico do relatorio: funcao do ciclo, revisao e versao de regras. */
function deterministicReportId(input: ValidationInput): Uuid {
  return `vr-${canonicalHash({
    cycleId: input.cycleId,
    draftRevision: input.draft.revision,
    ruleSetVersion: input.ruleSet.version,
  }).slice(0, 32)}`;
}

/** Instante canonico derivado da revisao (determinismo, nao usa Date.now). */
function deterministicCreatedAt(input: ValidationInput): string {
  // Usa o `createdAt` do rascunho como instante de referencia da validacao, que
  // ja e um valor versionado e estavel para a revisao avaliada.
  return input.draft.createdAt;
}

function compareFinding(a: ValidationFinding, b: ValidationFinding): number {
  return (
    cmp(a.severity, b.severity) ||
    cmp(a.serviceId ?? '', b.serviceId ?? '') ||
    cmp(a.ruleId, b.ruleId) ||
    cmp(a.roleOrField ?? '', b.roleOrField ?? '') ||
    cmp(a.findingId, b.findingId)
  );
}

function sortFindings(findings: RawFinding[]): RawFinding[] {
  return findings
    .slice()
    .sort(
      (a, b) =>
        cmp(a.serviceId ?? '', b.serviceId ?? '') ||
        cmp(a.ruleId, b.ruleId) ||
        cmp(a.roleOrField ?? '', b.roleOrField ?? '') ||
        cmp(a.offendingReference ?? '', b.offendingReference ?? ''),
    );
}

// --------------------------------------------------------------------------
// Auxiliares puros
// --------------------------------------------------------------------------

function dateOf(ctx: EngineContext, serviceId: Uuid): IsoDate | undefined {
  return ctx.activeServices.find((s) => s.id === serviceId)?.date;
}

/**
 * Spread condicional de `date`: inclui a chave apenas quando definida, para
 * respeitar `exactOptionalPropertyTypes` (nunca atribuir `date: undefined`).
 */
function optDate(date: IsoDate | undefined): { date?: IsoDate } {
  return date === undefined ? {} : { date };
}

function stringValueOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const text = (value as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return undefined;
}

/** Diferenca em dias (inteiro) entre duas datas civis ISO `YYYY-MM-DD`. */
function dayDiff(a: IsoDate, b: IsoDate): number {
  const da = Date.UTC(
    Number(a.slice(0, 4)),
    Number(a.slice(5, 7)) - 1,
    Number(a.slice(8, 10)),
  );
  const db = Date.UTC(
    Number(b.slice(0, 4)),
    Number(b.slice(5, 7)) - 1,
    Number(b.slice(8, 10)),
  );
  return Math.round((da - db) / 86_400_000);
}

/** Comparacao determinista de strings por unidade de codigo (independe de locale). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Reexporta tipos usados pelas assinaturas publicas para conveniencia dos
// chamadores e testes (sem criar modelo paralelo).
export type { ValidationFinding, ValidationReport, Weekday };
