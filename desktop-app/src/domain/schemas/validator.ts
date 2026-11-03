// Validador objetivo dos modelos canonicos.
//
// Responsabilidades:
//  1. Validacao estrutural por JSON Schema (formato, cardinalidade, versao).
//  2. Validacao semantica adicional que o JSON Schema nao expressa bem:
//     - intervalos de data coerentes (fim >= inicio);
//     - IDs unicos onde exigido.
//  3. Integridade referencial num conjunto de entidades (referencia quebrada).
//
// Garantia de pureza: o validador NUNCA modifica a entrada. Ele opera sobre os
// objetos recebidos apenas em leitura e retorna um relatorio. Isso atende ao
// criterio objetivo da tarefa: "falham sem mutacao".

import Ajv2020, { type ValidateFunction, type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { JSON_SCHEMAS } from './jsonSchemas';
import { SCHEMA_VERSION, type CanonicalEntityName } from './models';

export interface ValidationIssue {
  /** Caminho JSON ate o ponto do problema (ex.: `/leaves/0/end`). */
  path: string;
  /** Mensagem legivel em portugues. */
  message: string;
  /** Classe do problema, util para testes e UI. */
  kind:
    | 'schema'
    | 'unknown-version'
    | 'date-range'
    | 'duplicate-id'
    | 'broken-reference'
    | 'cardinality'
    | 'format';
}

export interface ValidationOutcome {
  valid: boolean;
  issues: ValidationIssue[];
}

// Instancia unica do Ajv (draft 2020-12) com formatos uuid/date/date-time.
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // Nao coagimos tipos: coercao mutaria/relaxaria a validacao de formato.
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);

// Compila cada schema uma vez e guarda a funcao validadora.
const COMPILED: Record<CanonicalEntityName, ValidateFunction> = (() => {
  const out = {} as Record<CanonicalEntityName, ValidateFunction>;
  for (const name of Object.keys(JSON_SCHEMAS) as CanonicalEntityName[]) {
    out[name] = ajv.compile(JSON_SCHEMAS[name]);
  }
  return out;
})();

function mapAjvErrorKind(err: ErrorObject): ValidationIssue['kind'] {
  if (err.keyword === 'format' || err.keyword === 'pattern') return 'format';
  if (err.keyword === 'const' && err.instancePath.endsWith('/schemaVersion')) {
    return 'unknown-version';
  }
  if (err.keyword === 'minItems' || err.keyword === 'maxItems' || err.keyword === 'uniqueItems') {
    return 'cardinality';
  }
  return 'schema';
}

function formatAjvError(err: ErrorObject): ValidationIssue {
  const path = err.instancePath || '/';
  const kind = mapAjvErrorKind(err);
  if (kind === 'unknown-version') {
    return {
      path,
      kind,
      message: `schemaVersion desconhecida; esperado "${SCHEMA_VERSION}"`,
    };
  }
  const detail = err.message ?? 'invalido';
  const extra =
    err.keyword === 'additionalProperties' &&
    typeof err.params === 'object' &&
    err.params !== null &&
    'additionalProperty' in err.params
      ? ` (${String((err.params as { additionalProperty: unknown }).additionalProperty)})`
      : '';
  return { path, kind, message: `${detail}${extra}` };
}

/**
 * Valida uma unica entidade contra seu JSON Schema e as regras semanticas
 * aplicaveis. Nao modifica a entrada.
 */
export function validateEntity(name: CanonicalEntityName, value: unknown): ValidationOutcome {
  const issues: ValidationIssue[] = [];
  const validate = COMPILED[name];
  const ok = validate(value);
  if (!ok && validate.errors) {
    for (const err of validate.errors) {
      issues.push(formatAjvError(err));
    }
  }

  // Regras semanticas adicionais aplicadas apenas sobre objetos.
  if (ok || issues.length === 0) {
    issues.push(...semanticChecks(name, value));
  } else {
    // Mesmo com erro de schema, ainda rodamos checagens semanticas baratas
    // quando a estrutura basica permite, para dar um relatorio mais completo.
    issues.push(...semanticChecks(name, value));
  }

  return { valid: issues.length === 0, issues };
}

/** Checagens semanticas por entidade que o JSON Schema nao cobre bem. */
function semanticChecks(name: CanonicalEntityName, value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof value !== 'object' || value === null) return issues;
  const obj = value as Record<string, unknown>;

  const dateRangeInvalid = (start: unknown, end: unknown): boolean =>
    typeof start === 'string' && typeof end === 'string' && end < start;

  switch (name) {
    case 'person': {
      const leaves = Array.isArray(obj.leaves) ? obj.leaves : [];
      leaves.forEach((leave, i) => {
        if (leave && typeof leave === 'object') {
          const l = leave as Record<string, unknown>;
          if (dateRangeInvalid(l.start, l.end)) {
            issues.push({
              path: `/leaves/${i}/end`,
              kind: 'date-range',
              message: 'data final do afastamento anterior a data inicial',
            });
          }
        }
      });
      const links = Array.isArray(obj.links) ? obj.links : [];
      links.forEach((link, i) => {
        if (link && typeof link === 'object') {
          const lk = link as Record<string, unknown>;
          if (lk.otherPersonId === obj.id) {
            issues.push({
              path: `/links/${i}/otherPersonId`,
              kind: 'broken-reference',
              message: 'vinculo referencia a propria pessoa (self-link)',
            });
          }
          if (dateRangeInvalid(lk.validFrom, lk.validUntil)) {
            issues.push({
              path: `/links/${i}/validUntil`,
              kind: 'date-range',
              message: 'validUntil anterior a validFrom',
            });
          }
        }
      });
      collectDuplicateIds(leaves, 'leaves', issues);
      collectDuplicateIds(links, 'links', issues);
      break;
    }
    case 'unavailability': {
      const scope = obj.scope as Record<string, unknown> | undefined;
      if (scope && scope.type === 'interval' && dateRangeInvalid(scope.start, scope.end)) {
        issues.push({
          path: '/scope/end',
          kind: 'date-range',
          message: 'intervalo com data final anterior a data inicial',
        });
      }
      break;
    }
    case 'approvedException': {
      if (dateRangeInvalid(obj.validFrom, obj.validUntil)) {
        issues.push({
          path: '/validUntil',
          kind: 'date-range',
          message: 'validUntil anterior a validFrom',
        });
      }
      break;
    }
    case 'approvedRuleSet': {
      if (dateRangeInvalid(obj.validFrom, obj.validUntil)) {
        issues.push({
          path: '/validUntil',
          kind: 'date-range',
          message: 'validUntil anterior a validFrom',
        });
      }
      const rules = Array.isArray(obj.rules) ? obj.rules : [];
      collectDuplicateIds(rules, 'rules', issues);
      break;
    }
    case 'publicAuthorization': {
      if (dateRangeInvalid(obj.validFrom, obj.validUntil)) {
        issues.push({
          path: '/validUntil',
          kind: 'date-range',
          message: 'validUntil anterior a validFrom',
        });
      }
      break;
    }
    default:
      break;
  }
  return issues;
}

function collectDuplicateIds(items: unknown[], field: string, issues: ValidationIssue[]): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (item && typeof item === 'object') {
      const id = (item as Record<string, unknown>).id;
      if (typeof id === 'string') {
        if (seen.has(id)) {
          issues.push({
            path: `/${field}/${i}/id`,
            kind: 'duplicate-id',
            message: `id duplicado em ${field}: ${id}`,
          });
        }
        seen.add(id);
      }
    }
  });
}

// --------------------------------------------------------------------------
// Validacao de grafo (integridade referencial)
// --------------------------------------------------------------------------

export interface EntitySet {
  people?: unknown[];
  departments?: unknown[];
  publicAuthorizations?: unknown[];
  cycles?: unknown[];
  services?: unknown[];
  externalInputs?: unknown[];
  unavailabilities?: unknown[];
  ruleSets?: unknown[];
  exceptions?: unknown[];
  drafts?: unknown[];
}

/**
 * Valida um conjunto coerente de entidades: cada item contra seu schema e as
 * referencias cruzadas (cultos->ciclo, insumos->culto, indisponibilidade->
 * ciclo/pessoa, excecao->regra fundamental, rascunho->ciclo/culto/sujeito).
 *
 * Nao modifica a entrada. Uma referencia para um ID inexistente produz uma
 * `ValidationIssue` com `kind: 'broken-reference'`.
 */
export function validateEntitySet(set: EntitySet): ValidationOutcome {
  const issues: ValidationIssue[] = [];

  const validateEach = (
    name: CanonicalEntityName,
    items: unknown[] | undefined,
    label: string,
  ): void => {
    (items ?? []).forEach((item, i) => {
      const r = validateEntity(name, item);
      for (const issue of r.issues) {
        issues.push({ ...issue, path: `/${label}/${i}${issue.path}` });
      }
    });
  };

  validateEach('person', set.people, 'people');
  validateEach('department', set.departments, 'departments');
  validateEach('publicAuthorization', set.publicAuthorizations, 'publicAuthorizations');
  validateEach('monthlyCycle', set.cycles, 'cycles');
  validateEach('service', set.services, 'services');
  validateEach('externalInput', set.externalInputs, 'externalInputs');
  validateEach('unavailability', set.unavailabilities, 'unavailabilities');
  validateEach('approvedRuleSet', set.ruleSets, 'ruleSets');
  validateEach('approvedException', set.exceptions, 'exceptions');
  validateEach('scheduleDraft', set.drafts, 'drafts');

  // Indices de IDs existentes.
  const idsOf = (items: unknown[] | undefined): Set<string> => {
    const s = new Set<string>();
    (items ?? []).forEach((it) => {
      if (it && typeof it === 'object') {
        const id = (it as Record<string, unknown>).id;
        if (typeof id === 'string') s.add(id);
      }
    });
    return s;
  };

  const personIds = idsOf(set.people);
  const departmentIds = idsOf(set.departments);
  const cycleIds = idsOf(set.cycles);
  const serviceIds = idsOf(set.services);
  const ruleSetIds = idsOf(set.ruleSets);
  const subjectIds = new Set<string>([...personIds, ...departmentIds]);

  const ref = (present: boolean, path: string, message: string): void => {
    if (!present) issues.push({ path, kind: 'broken-reference', message });
  };

  // services -> cycle
  (set.services ?? []).forEach((s, i) => {
    const svc = s as Record<string, unknown>;
    if (typeof svc.cycleId === 'string') {
      ref(
        cycleIds.has(svc.cycleId),
        `/services/${i}/cycleId`,
        `culto referencia ciclo inexistente: ${svc.cycleId}`,
      );
    }
  });

  // externalInputs -> service
  (set.externalInputs ?? []).forEach((e, i) => {
    const ei = e as Record<string, unknown>;
    if (typeof ei.serviceId === 'string') {
      ref(
        serviceIds.has(ei.serviceId),
        `/externalInputs/${i}/serviceId`,
        `insumo referencia culto inexistente: ${ei.serviceId}`,
      );
    }
  });

  // unavailabilities -> cycle, person
  (set.unavailabilities ?? []).forEach((u, i) => {
    const un = u as Record<string, unknown>;
    if (typeof un.cycleId === 'string') {
      ref(
        cycleIds.has(un.cycleId),
        `/unavailabilities/${i}/cycleId`,
        `indisponibilidade referencia ciclo inexistente: ${un.cycleId}`,
      );
    }
    if (typeof un.personId === 'string') {
      ref(
        personIds.has(un.personId),
        `/unavailabilities/${i}/personId`,
        `indisponibilidade referencia pessoa inexistente: ${un.personId}`,
      );
    }
  });

  // exceptions -> fundamental rule (presente em algum rule set)
  const ruleIds = new Set<string>();
  (set.ruleSets ?? []).forEach((rs) => {
    const r = rs as Record<string, unknown>;
    if (Array.isArray(r.rules)) {
      r.rules.forEach((rule) => {
        if (rule && typeof rule === 'object') {
          const id = (rule as Record<string, unknown>).id;
          if (typeof id === 'string') ruleIds.add(id);
        }
      });
    }
  });
  (set.exceptions ?? []).forEach((ex, i) => {
    const e = ex as Record<string, unknown>;
    if (typeof e.fundamentalRuleId === 'string') {
      ref(
        ruleIds.has(e.fundamentalRuleId),
        `/exceptions/${i}/fundamentalRuleId`,
        `excecao referencia regra inexistente: ${e.fundamentalRuleId}`,
      );
    }
  });

  // cycles -> ruleSetVersionId
  (set.cycles ?? []).forEach((c, i) => {
    const cy = c as Record<string, unknown>;
    if (typeof cy.ruleSetVersionId === 'string') {
      ref(
        ruleSetIds.has(cy.ruleSetVersionId),
        `/cycles/${i}/ruleSetVersionId`,
        `ciclo referencia conjunto de regras inexistente: ${cy.ruleSetVersionId}`,
      );
    }
  });

  // drafts -> cycle, assignments -> service & subject
  (set.drafts ?? []).forEach((d, i) => {
    const dr = d as Record<string, unknown>;
    if (typeof dr.cycleId === 'string') {
      ref(
        cycleIds.has(dr.cycleId),
        `/drafts/${i}/cycleId`,
        `rascunho referencia ciclo inexistente: ${dr.cycleId}`,
      );
    }
    const assignments = Array.isArray(dr.assignments) ? dr.assignments : [];
    assignments.forEach((a, j) => {
      const as = a as Record<string, unknown>;
      if (typeof as.serviceId === 'string') {
        ref(
          serviceIds.has(as.serviceId),
          `/drafts/${i}/assignments/${j}/serviceId`,
          `atribuicao referencia culto inexistente: ${as.serviceId}`,
        );
      }
      const subject = as.subject as Record<string, unknown> | undefined;
      if (subject && typeof subject.id === 'string') {
        ref(
          subjectIds.has(subject.id),
          `/drafts/${i}/assignments/${j}/subject/id`,
          `atribuicao referencia sujeito inexistente: ${subject.id}`,
        );
      }
    });
  });

  return { valid: issues.length === 0, issues };
}
