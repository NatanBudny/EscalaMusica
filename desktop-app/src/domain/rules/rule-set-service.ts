// RuleSetService: versionar, aprovar, ativar e consultar o Conjunto_de_Regras
// Ativo e as excecoes aprovadas (design.md -> "Components and Interfaces" ->
// RuleSetService: "Versionar, aprovar e ativar regras/exceptions"; "Versoes
// aprovadas sao imutaveis").
//
// TypeScript puro, sem I/O, deterministico. Reusa os modelos canonicos de
// `schemas/models.ts` (ApprovedRuleSet, Rule, RulePredicate, ApprovedException)
// e a DSL limitada de `predicate.ts`. NENHUM modelo paralelo e criado.
//
// Requisitos cobertos (6.1-6.13, 6.15, 6.16):
//  6.1  cada ciclo associa-se a exatamente uma versao aprovada e identificada.
//  6.2  ao criar o ciclo, registra-se o id da versao e a associacao e preservada.
//  6.3  alterar uma regra cria uma NOVA versao identificada sem modificar as
//       versoes anteriores nem as associacoes de ciclos existentes.
//  6.4  alteracao registra autor, data/hora, motivo e conteudo anterior/posterior.
//  6.5  regra cuja vigencia nao intersecta nenhuma data do ciclo e desconsiderada.
//  6.6  duas regras mutuamente incompativeis para a mesma condicao/funcao/culto
//       impedem a ativacao e preservam a versao ativa anterior.
//  6.7  excecao aprovada registra id, RF afetada, condicao, vigencia,
//       justificativa, aprovador e data/hora.
//  6.8  data do culto fora da vigencia da excecao rejeita o uso da excecao.
//  6.10 versao sem aprovacao registrada nao pode ser designada a um ciclo.
//  6.11 a validacao de um ciclo usa exclusivamente a versao registrada.
//  6.12 nova versao aprovada registra id, aprovador, data/hora e vigencia.
//  6.13 o conjunto e a unica fonte versionada para montagem/sugestao/validacao.
//  6.15 regra ausente da versao associada ao ciclo tem seu uso rejeitado.
//  6.16 excecao exige justificativa de 1 a 1.000 caracteres (apos trim).
//
// INVARIANTE CENTRAL: operacoes rejeitadas NUNCA alteram a versao ativa nem o
// catalogo de versoes. O servico trabalha sobre copias; versoes aprovadas sao
// congeladas (imutaveis).

import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedException,
  ApprovedRuleSet,
  IsoDate,
  Rule,
  RulePredicate,
  SourceDecision,
  Utc,
  Uuid,
} from '../schemas/models';
import { validatePredicate, type PredicateIssue } from './predicate';

// --------------------------------------------------------------------------
// Resultado tipado
// --------------------------------------------------------------------------

export type RuleSetErrorCode =
  | 'invalid-predicate' // predicado fora da DSL / referencia de campo ausente
  | 'missing-reference' // RF/tipo de vinculo/campo referenciado nao existe
  | 'justification-length' // 6.16: justificativa fora de 1-1000 (apos trim)
  | 'exception-range' // validUntil anterior a validFrom
  | 'exception-out-of-validity' // 6.8: data fora da vigencia da excecao
  | 'rule-conflict' // 6.6: duas regras contraditorias
  | 'not-approved' // 6.10: versao sem aprovacao registrada
  | 'unknown-version' // versao nao existe no catalogo
  | 'version-exists' // id/versao ja utilizados
  | 'immutable-version' // tentativa de alterar versao aprovada/retirada
  | 'rule-not-in-version'; // 6.15: regra ausente da versao do ciclo

export interface RuleSetError {
  code: RuleSetErrorCode;
  /** Mensagem legivel em portugues. */
  message: string;
  /** Problemas de predicado detalhados, quando aplicavel. */
  predicateIssues?: PredicateIssue[];
  /** Ids das duas regras em conflito (6.6) e a condicao conflitante. */
  conflict?: { ruleIdA: Uuid; ruleIdB: Uuid; condition: string };
}

export type RuleSetResult<T> = { ok: true; value: T } | { ok: false; error: RuleSetError };

const ok = <T>(value: T): RuleSetResult<T> => ({ ok: true, value });
const fail = <T>(error: RuleSetError): RuleSetResult<T> => ({ ok: false, error });

// --------------------------------------------------------------------------
// Allowlist de campos conhecidos da DSL
// --------------------------------------------------------------------------

/**
 * Campos conhecidos que um predicado de regra pode referenciar. Uma referencia
 * fora desta lista e uma "referencia ausente" e invalida o predicado (design.md:
 * a ativacao compila predicados e detecta referencias ausentes).
 *
 * Os caminhos refletem o contexto de avaliacao de uma regra sobre um culto e
 * uma atribuicao (ver `predicate.ts`, `EvalContext`).
 */
export const KNOWN_RULE_FIELDS: ReadonlySet<string> = new Set<string>([
  'service.date',
  'service.weekday',
  'service.kind',
  'assignment.roleId',
  'assignment.slot',
  'assignment.subjectType',
  'assignment.subjectId',
  'subject.capabilityIds',
  'subject.allowedWeekdays',
  'subject.participation',
  'team.size',
  'team.genders',
  'cycle.period',
]);

// --------------------------------------------------------------------------
// Entradas dos comandos
// --------------------------------------------------------------------------

export interface DefineVersionInput {
  id: Uuid;
  /** Identificador legivel da versao (ex.: `v1`); unico no catalogo. */
  version: string;
  validFrom: IsoDate;
  validUntil?: IsoDate;
  rules: Rule[];
  sourceDecisions?: SourceDecision[];
  now: Utc;
}

export interface ApproveVersionInput {
  id: Uuid;
  approvedBy: Uuid;
  approvedAt: Utc;
  /** Vigencia da versao aprovada (6.12). */
  validFrom?: IsoDate;
  validUntil?: IsoDate;
}

export interface AmendRuleInput {
  /** Versao base a partir da qual se cria a nova versao (6.3). */
  baseVersionId: Uuid;
  /** Id da NOVA versao criada pela alteracao. */
  newVersionId: Uuid;
  newVersion: string;
  /** Regra alterada (mesmo `id`) ou adicionada. */
  rule: Rule;
  /** Dados de auditoria da alteracao (6.4). */
  author: Uuid;
  at: Utc;
  reason: string;
  now: Utc;
}

/** Registro de auditoria de alteracao de regra (6.4). */
export interface RuleAmendment {
  newVersionId: Uuid;
  ruleId: Uuid;
  author: Uuid;
  at: Utc;
  reason: string;
  /** Conteudo anterior (ausente quando a regra e nova). */
  before?: Rule;
  /** Conteudo posterior. */
  after: Rule;
}

export interface RegisterExceptionInput {
  id: Uuid;
  fundamentalRuleId: Uuid;
  condition: RulePredicate;
  validFrom: IsoDate;
  validUntil: IsoDate;
  justification: string;
  approvedBy: Uuid;
  approvedAt: Utc;
}

export const JUSTIFICATION_MIN = 1;
export const JUSTIFICATION_MAX = 1000;

// --------------------------------------------------------------------------
// Servico
// --------------------------------------------------------------------------

/**
 * Conjunto de regras versionado. Mantem um catalogo de versoes (por id), as
 * excecoes aprovadas e o historico de alteracoes. Versoes aprovadas sao
 * imutaveis: qualquer alteracao cria uma nova versao.
 */
export class RuleSetService {
  private versions: Map<Uuid, ApprovedRuleSet>;
  private exceptions: Map<Uuid, ApprovedException>;
  private readonly amendments: RuleAmendment[] = [];

  constructor(
    versions: readonly ApprovedRuleSet[] = [],
    exceptions: readonly ApprovedException[] = [],
  ) {
    this.versions = new Map(versions.map((v) => [v.id, clone(v)]));
    this.exceptions = new Map(exceptions.map((e) => [e.id, clone(e)]));
  }

  // ---- Consulta --------------------------------------------------------

  /** Retorna uma versao por id (copia defensiva) ou `undefined`. */
  getVersion(id: Uuid): ApprovedRuleSet | undefined {
    const v = this.versions.get(id);
    return v ? clone(v) : undefined;
  }

  /** Lista imutavel das versoes, em ordem estavel por id. */
  listVersions(): ApprovedRuleSet[] {
    return sortById([...this.versions.values()]).map(clone);
  }

  /** Historico de alteracoes de regra (6.4), em ordem de registro. */
  listAmendments(): RuleAmendment[] {
    return this.amendments.map(clone);
  }

  // ---- Definicao de versao (rascunho) ---------------------------------

  /**
   * Define uma nova versao em estado `draft`. Valida todos os predicados das
   * regras contra a DSL e a allowlist de campos (referencias ausentes). Rejeita
   * conflitos entre regras (6.6) antes mesmo da aprovacao, para nao permitir
   * aprovar um conjunto contraditorio. Nao altera versoes existentes.
   */
  defineVersion(input: DefineVersionInput): RuleSetResult<ApprovedRuleSet> {
    if (this.versions.has(input.id) || this.hasVersionLabel(input.version)) {
      return fail({
        code: 'version-exists',
        message: `versao ja existe: ${input.version} (${input.id})`,
      });
    }

    const predicateError = this.validateRulesPredicates(input.rules);
    if (predicateError) return fail(predicateError);

    const conflict = detectRuleConflicts(input.rules);
    if (conflict) return fail(conflict);

    const ruleSet: ApprovedRuleSet = {
      schemaVersion: SCHEMA_VERSION,
      id: input.id,
      version: input.version,
      status: 'draft',
      validFrom: input.validFrom,
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
      rules: input.rules.map(clone),
      sourceDecisions: (input.sourceDecisions ?? []).map(clone),
      createdAt: input.now,
    };
    this.versions.set(ruleSet.id, ruleSet);
    return ok(clone(ruleSet));
  }

  /**
   * Aprova uma versao em rascunho, registrando aprovador, data/hora e vigencia
   * (6.12). A partir dai a versao e imutavel. Revalida predicados e conflitos
   * para garantir que nenhuma versao contraditoria seja aprovada (6.6).
   */
  approveVersion(input: ApproveVersionInput): RuleSetResult<ApprovedRuleSet> {
    const current = this.versions.get(input.id);
    if (!current)
      return fail({ code: 'unknown-version', message: `versao inexistente: ${input.id}` });
    if (current.status !== 'draft') {
      return fail({
        code: 'immutable-version',
        message: `apenas rascunhos podem ser aprovados: ${current.version}`,
      });
    }

    const predicateError = this.validateRulesPredicates(current.rules);
    if (predicateError) return fail(predicateError);
    const conflict = detectRuleConflicts(current.rules);
    if (conflict) return fail(conflict);

    const approved: ApprovedRuleSet = {
      ...clone(current),
      status: 'approved',
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
    };
    this.versions.set(approved.id, approved);
    return ok(clone(approved));
  }

  /**
   * Altera uma regra criando uma NOVA versao (6.3) sem modificar a versao base
   * nem associacoes existentes. Registra a auditoria da alteracao (6.4). A nova
   * versao nasce como `draft` (precisa de aprovacao para uso em ciclo, 6.10).
   */
  amendRule(input: AmendRuleInput): RuleSetResult<ApprovedRuleSet> {
    const base = this.versions.get(input.baseVersionId);
    if (!base)
      return fail({
        code: 'unknown-version',
        message: `versao base inexistente: ${input.baseVersionId}`,
      });
    if (this.versions.has(input.newVersionId) || this.hasVersionLabel(input.newVersion)) {
      return fail({ code: 'version-exists', message: `versao ja existe: ${input.newVersion}` });
    }

    // A nova lista de regras substitui a regra de mesmo id ou adiciona.
    const before = base.rules.find((r) => r.id === input.rule.id);
    const nextRules = before
      ? base.rules.map((r) => (r.id === input.rule.id ? clone(input.rule) : clone(r)))
      : [...base.rules.map(clone), clone(input.rule)];

    const predicateError = this.validateRulesPredicates([input.rule]);
    if (predicateError) return fail(predicateError);
    const conflict = detectRuleConflicts(nextRules);
    if (conflict) return fail(conflict);

    const newVersion: ApprovedRuleSet = {
      schemaVersion: SCHEMA_VERSION,
      id: input.newVersionId,
      version: input.newVersion,
      status: 'draft',
      validFrom: base.validFrom,
      ...(base.validUntil !== undefined ? { validUntil: base.validUntil } : {}),
      rules: nextRules,
      sourceDecisions: base.sourceDecisions.map(clone),
      createdAt: input.now,
    };

    // A versao base permanece intacta (imutabilidade / 6.3).
    this.versions.set(newVersion.id, newVersion);
    this.amendments.push({
      newVersionId: input.newVersionId,
      ruleId: input.rule.id,
      author: input.author,
      at: input.at,
      reason: input.reason,
      ...(before ? { before: clone(before) } : {}),
      after: clone(input.rule),
    });
    return ok(clone(newVersion));
  }

  // ---- Designacao a um ciclo (6.1, 6.2, 6.10) --------------------------

  /**
   * Verifica se uma versao pode ser designada a um Ciclo_Mensal. A designacao
   * exige uma versao aprovada com aprovador e data/hora registrados (6.10);
   * caso contrario rejeita e indica os dados de aprovacao ausentes, preservando
   * a associacao vigente.
   */
  assertDesignable(versionId: Uuid): RuleSetResult<ApprovedRuleSet> {
    const v = this.versions.get(versionId);
    if (!v) return fail({ code: 'unknown-version', message: `versao inexistente: ${versionId}` });
    if (v.status !== 'approved' || v.approvedBy === undefined || v.approvedAt === undefined) {
      const missing: string[] = [];
      if (v.status !== 'approved') missing.push('status aprovado');
      if (v.approvedBy === undefined) missing.push('responsavel pela aprovacao');
      if (v.approvedAt === undefined) missing.push('data e hora da aprovacao');
      return fail({
        code: 'not-approved',
        message: `versao sem aprovacao registrada; ausentes: ${missing.join(', ')}`,
      });
    }
    return ok(clone(v));
  }

  // ---- Consulta de regras do ciclo (6.11, 6.15) ------------------------

  /**
   * Obtem uma regra pelo id DENTRO da versao associada ao ciclo. Rejeita o uso
   * de uma regra ausente da versao (6.15). Usa exclusivamente a versao
   * informada (6.11).
   */
  getRuleInVersion(versionId: Uuid, ruleId: Uuid): RuleSetResult<Rule> {
    const v = this.versions.get(versionId);
    if (!v) return fail({ code: 'unknown-version', message: `versao inexistente: ${versionId}` });
    const rule = v.rules.find((r) => r.id === ruleId);
    if (!rule) {
      return fail({
        code: 'rule-not-in-version',
        message: `regra ${ruleId} ausente da versao ${v.version}`,
      });
    }
    return ok(clone(rule));
  }

  /**
   * Regras aplicaveis a um ciclo: todas as regras da versao cuja vigencia
   * intersecta ao menos uma data de culto do ciclo (6.5). Regras sem intersecao
   * sao desconsideradas. `ruleValidFrom`/`ruleValidUntil` por regra sao opcionais
   * e, quando ausentes, a regra herda a vigencia da versao.
   */
  applicableRules(versionId: Uuid, cycleServiceDates: readonly IsoDate[]): RuleSetResult<Rule[]> {
    const v = this.versions.get(versionId);
    if (!v) return fail({ code: 'unknown-version', message: `versao inexistente: ${versionId}` });
    const dates = cycleServiceDates;
    const applicable = v.rules.filter(() =>
      // A vigencia e a da versao (modelo atual nao possui vigencia por regra).
      intersectsAnyDate(v.validFrom, v.validUntil, dates),
    );
    return ok(applicable.map(clone));
  }

  // ---- Excecoes aprovadas (6.7, 6.8, 6.16) -----------------------------

  /**
   * Registra uma Excecao_Aprovada (6.7): id, RF afetada, condicao, vigencia,
   * justificativa, aprovador e data/hora. Exige justificativa de 1 a 1.000
   * caracteres apos trim (6.16) e `validUntil >= validFrom`. A RF afetada deve
   * existir em ao menos uma versao do catalogo (referencia ausente => rejeita).
   * O predicado da condicao e validado pela DSL.
   */
  registerException(input: RegisterExceptionInput): RuleSetResult<ApprovedException> {
    const trimmed = input.justification.trim();
    if (trimmed.length < JUSTIFICATION_MIN || trimmed.length > JUSTIFICATION_MAX) {
      return fail({
        code: 'justification-length',
        message: `a justificativa deve ter de ${JUSTIFICATION_MIN} a ${JUSTIFICATION_MAX} caracteres apos o trim`,
      });
    }
    if (input.validUntil < input.validFrom) {
      return fail({
        code: 'exception-range',
        message: 'data final da vigencia anterior a data inicial',
      });
    }
    if (!this.fundamentalRuleExists(input.fundamentalRuleId)) {
      return fail({
        code: 'missing-reference',
        message: `excecao referencia Regra_Fundamental inexistente: ${input.fundamentalRuleId}`,
      });
    }
    const issues = validatePredicate(input.condition, { knownFields: KNOWN_RULE_FIELDS });
    if (issues.length > 0) {
      return fail({
        code: 'invalid-predicate',
        message: 'condicao da excecao usa predicado invalido',
        predicateIssues: issues,
      });
    }

    const exception: ApprovedException = {
      schemaVersion: SCHEMA_VERSION,
      id: input.id,
      fundamentalRuleId: input.fundamentalRuleId,
      condition: clone(input.condition),
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      justification: trimmed,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
    };
    this.exceptions.set(exception.id, exception);
    return ok(clone(exception));
  }

  /**
   * Verifica se uma Excecao_Aprovada pode suprimir um Bloqueio para uma data de
   * culto (6.8). Rejeita quando a data NAO esta no intervalo inclusivo
   * [validFrom, validUntil]; preserva os dados e indica a vigencia nao atendida.
   */
  assertExceptionApplicable(
    exceptionId: Uuid,
    serviceDate: IsoDate,
  ): RuleSetResult<ApprovedException> {
    const exc = this.exceptions.get(exceptionId);
    if (!exc) {
      return fail({ code: 'missing-reference', message: `excecao inexistente: ${exceptionId}` });
    }
    if (serviceDate < exc.validFrom || serviceDate > exc.validUntil) {
      return fail({
        code: 'exception-out-of-validity',
        message:
          `a data do culto (${serviceDate}) nao esta na vigencia da excecao ` +
          `[${exc.validFrom}, ${exc.validUntil}]`,
      });
    }
    return ok(clone(exc));
  }

  /** Excecoes registradas (copia defensiva), ordem estavel por id. */
  listExceptions(): ApprovedException[] {
    return sortById([...this.exceptions.values()]).map(clone);
  }

  // ---- Internos --------------------------------------------------------

  private hasVersionLabel(label: string): boolean {
    for (const v of this.versions.values()) if (v.version === label) return true;
    return false;
  }

  /** `true` quando a RF existe em alguma versao do catalogo. */
  private fundamentalRuleExists(ruleId: Uuid): boolean {
    for (const v of this.versions.values()) {
      if (v.rules.some((r) => r.id === ruleId && r.kind === 'fundamental')) return true;
    }
    return false;
  }

  /** Valida os predicados (applicability e assertion) de uma lista de regras. */
  private validateRulesPredicates(rules: readonly Rule[]): RuleSetError | null {
    for (const r of rules) {
      const issues: PredicateIssue[] = [
        ...validatePredicate(r.applicability, { knownFields: KNOWN_RULE_FIELDS }).map((i) => ({
          ...i,
          at: `rule[${r.id}].applicability.${i.at}`,
        })),
        ...validatePredicate(r.assertion, { knownFields: KNOWN_RULE_FIELDS }).map((i) => ({
          ...i,
          at: `rule[${r.id}].assertion.${i.at}`,
        })),
      ];
      if (issues.length > 0) {
        return {
          code: 'invalid-predicate',
          message: `regra ${r.id} usa predicado invalido`,
          predicateIssues: issues,
        };
      }
    }
    return null;
  }
}

// --------------------------------------------------------------------------
// Deteccao de conflitos entre regras (6.6)
// --------------------------------------------------------------------------

/**
 * Detecta duas regras mutuamente incompativeis para a MESMA condicao, funcao e
 * culto. No modelo atual, duas regras entram em conflito quando:
 *  - possuem a MESMA applicability (mesma condicao/funcao/culto, pelo JSON
 *    canonico do predicado); e
 *  - uma afirma `P` e a outra afirma `not(P)` (assertions mutuamente negadas).
 *
 * Esta e uma deteccao conservadora e deterministica: encontra contradicoes
 * sintaticas diretas (assertion versus sua negacao) sob a mesma aplicabilidade.
 * Retorna o erro de conflito com os dois ids e a condicao, ou `null`.
 */
export function detectRuleConflicts(rules: readonly Rule[]): RuleSetError | null {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i] as Rule;
      const b = rules[j] as Rule;
      if (!samePredicate(a.applicability, b.applicability)) continue;
      if (areContradictory(a.assertion, b.assertion)) {
        return {
          code: 'rule-conflict',
          message:
            `as regras ${a.id} e ${b.id} prescrevem resultados incompativeis ` +
            'para a mesma condicao, funcao e culto',
          conflict: { ruleIdA: a.id, ruleIdB: b.id, condition: stableKey(a.applicability) },
        };
      }
    }
  }
  return null;
}

/** `true` quando dois predicados sao estruturalmente identicos. */
function samePredicate(a: RulePredicate, b: RulePredicate): boolean {
  return stableKey(a) === stableKey(b);
}

/**
 * `true` quando duas assertions sao mutuamente contraditorias: uma e `not(X)` e
 * a outra e `X`, ou uma e `true` e a outra `false`.
 */
function areContradictory(a: RulePredicate, b: RulePredicate): boolean {
  if ((a.op === 'true' && b.op === 'false') || (a.op === 'false' && b.op === 'true')) return true;
  if (a.op === 'not' && a.args && a.args.length === 1) {
    if (samePredicate(a.args[0] as RulePredicate, b)) return true;
  }
  if (b.op === 'not' && b.args && b.args.length === 1) {
    if (samePredicate(b.args[0] as RulePredicate, a)) return true;
  }
  return false;
}

/** Chave canonica estavel de um predicado (JSON com chaves ordenadas). */
function stableKey(predicate: RulePredicate): string {
  return stableStringify(predicate);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`;
}

// --------------------------------------------------------------------------
// Vigencia (6.5)
// --------------------------------------------------------------------------

/**
 * `true` quando o intervalo de vigencia [from, until] (until opcional =>
 * aberto) intersecta ao menos uma das datas informadas (inclusive).
 */
function intersectsAnyDate(
  from: IsoDate,
  until: IsoDate | undefined,
  dates: readonly IsoDate[],
): boolean {
  return dates.some((d) => d >= from && (until === undefined || d <= until));
}

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

function sortById<T extends { id: Uuid }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
