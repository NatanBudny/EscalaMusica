// Feature: gestao-leiga-de-escalas, Property 30: Projeção pública não sofre interferência de dados privados
//
// Para todo estado privado, alterar aliases privados, notas administrativas,
// indisponibilidades, justificativas (overrides), auditoria, credenciais ou
// outros campos nao publicos NAO altera o Pacote_de_Publicacao; nenhum
// valor-sentinela privado aparece na previa, nos erros/bloqueios publicos ou
// nos bytes do pacote.
//
// Valida: Requisitos 3.12, 7.20, 8.3, 9.11, 10.21, 11.1, 11.2, 11.3, 11.5,
// 11.7, 13.8, 15.12.
//
// Estrategia (design.md, "Fronteira publica/privada" e "Nada publico por
// acidente"):
//   - Geramos um estado publico base (pessoas ativas, departamento, cultos,
//     rascunho, insumos publicos) e um conjunto arbitrario de DADOS PRIVADOS
//     a injetar (aliases privados, notas administrativas, justificativas de
//     override, notas privadas de culto, insumos privados e sentinelas de
//     segredo/token espalhadas em todas as categorias).
//   - NAO interferencia: a projecao SEM dados privados e a projecao COM os
//     dados privados injetados (variando SOMENTE campos privados) produzem
//     BYTES identicos. Varriar apenas campos privados deixa o pacote identico.
//   - NAO vazamento: o prefixo-sentinela PRIVATE_SENTINEL_PREFIX nunca aparece
//     no DTO (previa), nos bytes do pacote nem na serializacao de
//     bloqueios/erros publicos.
//
// Observacao sobre telefone: um telefone destinado aos Dados_Publicos SEM
// autorizacao vigente e um BLOQUEIO (nunca um descarte silencioso) e impede a
// emissao (requisitos 7.20, 11.15). Por isso, a comparacao de NAO interferencia
// usa apenas campos cujo descarte e silencioso e legitimo (aliases sem
// autorizacao, notas, overrides, insumos privados). O caso do telefone sem
// autorizacao e coberto em uma propriedade dedicada de NAO vazamento: mesmo
// bloqueado, nenhum valor/sentinela privado aparece nos bloqueios.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { SCHEMA_VERSION } from '../schemas/models';
import type { ExternalInput, ScheduleDraft, Service } from '../schemas/models';
import { RegistryService } from '../registry/registry-service';
import { canonicalBytes, sha256Hex } from '../schemas/canonical';
import {
  projectPublic,
  PRIVATE_SENTINEL_PREFIX,
  type PublicProjectionInput,
} from './publicProjection';

// --------------------------------------------------------------------------
// Constantes deterministicas
// --------------------------------------------------------------------------

const NOW_UTC = '2026-02-01T12:00:00Z';
const AT = '2026-02-15';
const PERIOD = '2026-02';
const PURPOSE = 'Confirmacao de escala por WhatsApp';
const CYCLE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ROLE_ID = '10101010-1010-4010-8010-101010101010';
const OPERATOR_ID = '40404040-4040-4040-8040-404040404040';

/** Hash de valor igual ao default da projecao (SHA-256 do UTF-8 canonico). */
function hashValue(value: string): string {
  return sha256Hex(canonicalBytes(value));
}

// --------------------------------------------------------------------------
// Geradores deterministicos de identificadores e valores de dominio
// --------------------------------------------------------------------------

/** UUID v4 deterministico a partir de um inteiro (IDs validos e distintos). */
function uuidFromInt(n: number): string {
  const hex = (n >>> 0).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/** Data civil `YYYY-MM-DD` deterministica (evita fc.date().toISOString() flaky). */
const isoDateArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2024, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

const weekdayArb = fc.constantFrom<Service['computedWeekday']>(
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
);

const serviceKindArb = fc.constantFrom<Service['kind']>('regular', 'extraordinary');

/**
 * Texto publico "limpo": nunca contem o prefixo-sentinela e nunca casa com os
 * padroes de segredo do scanner (restringe a letras/digitos/espaco). Assim o
 * conteudo publico base nunca dispara bloqueio por si so.
 */
const cleanTextArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9 ]{1,40}$/)
  .filter((s) => s.trim().length > 0 && !s.includes(PRIVATE_SENTINEL_PREFIX));

/**
 * Valor privado arbitrario que SEMPRE carrega o prefixo-sentinela, em todas as
 * categorias. Ele representa aquilo que jamais poderia ser publicado. Usamos o
 * prefixo como marcador verificavel de vazamento (design: "Nada publico por
 * acidente"). Nunca contem padroes que o scanner trataria como token real,
 * para que o unico marcador relevante seja o proprio prefixo.
 */
const privateSentinelArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(
      'ALIAS',
      'NOTA_ADMIN',
      'JUSTIFICATIVA',
      'OBS_PRIVADA',
      'NOTA_CULTO',
      'CREDENCIAL',
      'AUDITORIA',
      'INDISPONIBILIDADE',
    ),
    fc.stringMatching(/^[A-Za-z0-9]{0,12}$/),
  )
  .map(([cat, suffix]) => `${PRIVATE_SENTINEL_PREFIX}_${cat}_${suffix}`);

// --------------------------------------------------------------------------
// Especificacao de uma pessoa publica e dos dados privados a injetar
// --------------------------------------------------------------------------

interface PersonSpec {
  readonly nameSeed: string;
  readonly hasPhone: boolean; // telefone AUTORIZADO (entra no pacote) quando true
  readonly privateAliasCount: number; // aliases privados (sentinela) a injetar
  readonly adminNote: string | undefined; // nota administrativa privada (sentinela)
}

/** Telefone E.164 valido deterministico a partir de um indice. */
function phoneForIndex(i: number): string {
  const digits = String(5511900000000 + i).slice(0, 13);
  return `+${digits}`;
}

const personSpecArb: fc.Arbitrary<PersonSpec> = fc.record({
  nameSeed: cleanTextArb,
  hasPhone: fc.boolean(),
  privateAliasCount: fc.integer({ min: 0, max: 3 }),
  adminNote: fc.option(privateSentinelArb, { nil: undefined }),
});

interface StateSpec {
  readonly people: readonly PersonSpec[];
  readonly serviceCount: number;
  readonly serviceDate: string;
  readonly weekday: Service['computedWeekday'];
  readonly kind: Service['kind'];
  readonly publicTheme: string;
  readonly privateOverride: string; // sentinela
  readonly privateNote: string; // sentinela
  readonly privateInput: string; // sentinela
  readonly privateDeptName: boolean;
}

const stateSpecArb: fc.Arbitrary<StateSpec> = fc.record({
  people: fc.array(personSpecArb, { minLength: 1, maxLength: 4 }),
  serviceCount: fc.integer({ min: 1, max: 3 }),
  serviceDate: isoDateArb,
  weekday: weekdayArb,
  kind: serviceKindArb,
  publicTheme: cleanTextArb,
  privateOverride: privateSentinelArb,
  privateNote: privateSentinelArb,
  privateInput: privateSentinelArb,
  privateDeptName: fc.boolean(),
});

// --------------------------------------------------------------------------
// Construcao do estado a partir da especificacao
// --------------------------------------------------------------------------

const DEPT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface BuiltState {
  readonly input: PublicProjectionInput;
}

/**
 * Constroi o estado completo. Quando `withPrivate` e falso, NENHUM dado privado
 * (aliases privados, notas administrativas, justificativas de override, notas
 * privadas, insumos privados) e incluido. Quando verdadeiro, TODOS os dados
 * privados sentinela sao injetados. Os campos PUBLICOS sao identicos nos dois
 * casos, de modo que a projecao publica deve produzir bytes identicos.
 */
function buildState(spec: StateSpec, withPrivate: boolean): BuiltState {
  const reg = new RegistryService();

  // Pessoas (indices deterministicos). personIds[i] e o id da i-esima pessoa.
  const personIds: string[] = [];
  spec.people.forEach((p, i) => {
    const id = uuidFromInt(1000 + i);
    personIds.push(id);
    const name = `P${i} ${p.nameSeed}`.slice(0, 120);

    const aliases = withPrivate
      ? Array.from({ length: p.privateAliasCount }, (_unused, k) => ({
          value: `${PRIVATE_SENTINEL_PREFIX}_ALIAS_${i}_${k}`,
        }))
      : [];

    const phone = p.hasPhone ? phoneForIndex(i) : undefined;

    reg.addPerson({
      id,
      canonicalName: name,
      aliases,
      ...(phone !== undefined ? { phoneE164: phone } : {}),
      ...(withPrivate && p.adminNote !== undefined
        ? { administrativeNotes: p.adminNote }
        : {}),
      now: NOW_UTC,
    });

    // Autoriza o telefone (quando existir) para que entre no pacote tanto no
    // estado "sem privado" quanto "com privado" (campo publico autorizado).
    if (phone !== undefined) {
      reg.registerAuthorization({
        id: uuidFromInt(5000 + i),
        subjectId: id,
        field: 'phone',
        valueHash: hashValue(phone),
        purpose: PURPOSE,
        approvedBy: OPERATOR_ID,
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        now: NOW_UTC,
      });
    }
  });

  // Departamento ativo (nome canonico e publico por classificacao).
  reg.addDepartment({ id: DEPT_ID, canonicalName: 'Sonoplastia', now: NOW_UTC });

  // Cultos (campos publicos: date/computedWeekday/kind).
  const serviceIds: string[] = [];
  const services: Service[] = Array.from({ length: spec.serviceCount }, (_unused, i) => {
    const id = uuidFromInt(2000 + i);
    serviceIds.push(id);
    return {
      schemaVersion: SCHEMA_VERSION,
      id,
      cycleId: CYCLE_ID,
      date: spec.serviceDate,
      computedWeekday: spec.weekday,
      kind: spec.kind,
      externalInputIds: [],
    };
  });

  // Rascunho: atribuicoes publicas (pessoa + departamento) + campos publicos.
  // Justificativa de override e PRIVADA e so entra quando withPrivate.
  const assignments: ScheduleDraft['assignments'] = [];
  serviceIds.forEach((serviceId, si) => {
    personIds.forEach((pid, pi) => {
      assignments.push({
        id: `assign-${si}-${pi}`,
        serviceId,
        roleId: ROLE_ID,
        subject: { type: 'person', id: pid },
        source: 'manual',
        ...(withPrivate ? { preferenceOverrideReason: spec.privateOverride } : {}),
      });
    });
    assignments.push({
      id: `assign-${si}-dept`,
      serviceId,
      roleId: ROLE_ID,
      subject: { type: 'department', id: DEPT_ID },
      source: 'department-rule',
    });
  });

  const draft: ScheduleDraft = {
    schemaVersion: SCHEMA_VERSION,
    cycleId: CYCLE_ID,
    revision: 'a'.repeat(64),
    assignments,
    publicFields: serviceIds.map((serviceId) => ({
      serviceId,
      fields: { TEMA: spec.publicTheme },
    })),
    privateNotes: withPrivate
      ? serviceIds.map((serviceId, i) => ({
          id: `note-${i}`,
          serviceId,
          text: spec.privateNote,
        }))
      : [],
    createdAt: NOW_UTC,
  };

  // Insumos: um publico (tema) + um privado sentinela (so quando withPrivate).
  const externalInputs: ExternalInput[] = [];
  serviceIds.forEach((serviceId, i) => {
    externalInputs.push({
      schemaVersion: SCHEMA_VERSION,
      id: `input-pub-${i}`,
      serviceId,
      type: 'theme',
      value: spec.publicTheme,
      visibility: 'public',
      source: 'PDF do pregador',
      updatedAt: NOW_UTC,
      operatorId: OPERATOR_ID,
    });
    if (withPrivate) {
      externalInputs.push({
        schemaVersion: SCHEMA_VERSION,
        id: `input-priv-${i}`,
        serviceId,
        type: 'observation',
        value: spec.privateInput,
        visibility: 'private',
        source: 'interno',
        updatedAt: NOW_UTC,
        operatorId: OPERATOR_ID,
      });
    }
  });

  const input: PublicProjectionInput = {
    registry: reg,
    services,
    draft,
    externalInputs,
    period: PERIOD,
    at: AT,
    purpose: { phonePurpose: PURPOSE },
    valueHash: hashValue,
  };

  return { input };
}

// --------------------------------------------------------------------------
// Auxiliares de verificacao de vazamento
// --------------------------------------------------------------------------

/** Nenhum lugar da projecao (previa/pacote/erros) contem o prefixo-sentinela. */
function assertNoSentinelLeak(result: ReturnType<typeof projectPublic>): void {
  if (result.ok) {
    const preview = JSON.stringify(result.dto);
    const bytes = new TextDecoder().decode(result.bytes);
    expect(preview.includes(PRIVATE_SENTINEL_PREFIX), 'previa vazou sentinela').toBe(false);
    expect(bytes.includes(PRIVATE_SENTINEL_PREFIX), 'bytes vazaram sentinela').toBe(false);
  } else {
    const errors = JSON.stringify(result.blocks);
    expect(errors.includes(PRIVATE_SENTINEL_PREFIX), 'bloqueios vazaram sentinela').toBe(false);
  }
}

/**
 * Executa fc.assert e, em caso de falha, re-lanca preservando a mensagem da
 * fast-check (que contem o seed e o replay Path do contraexemplo), de modo que
 * a falha seja reproduzivel.
 */
function runProperty<T>(arb: fc.Arbitrary<T>, predicate: (value: T) => void): void {
  try {
    fc.assert(fc.property(arb, predicate), {
      numRuns: 200,
      verbose: true,
    });
  } catch (error) {
    // A mensagem da fast-check ja inclui "seed" e "Path" (replayPath) do
    // contraexemplo; preservamos exatamente para permitir o replay.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Property 30 falhou (reproduza com seed/Path abaixo):\n${message}`);
  }
}

// --------------------------------------------------------------------------
// Propriedade 30
// --------------------------------------------------------------------------

describe('Property 30: Projecao publica nao sofre interferencia de dados privados', () => {
  it('variar apenas campos privados nao altera os bytes do pacote (nao interferencia)', () => {
    runProperty(stateSpecArb, (spec) => {
      const clean = projectPublic(buildState(spec, false).input);
      const injected = projectPublic(buildState(spec, true).input);

      // Os campos publicos sao identicos; ambas as projecoes devem suceder.
      expect(clean.ok, 'projecao sem dados privados deveria suceder').toBe(true);
      expect(injected.ok, 'projecao com dados privados deveria suceder').toBe(true);
      if (!clean.ok || !injected.ok) return;

      // Nao interferencia: bytes e hash identicos (requisitos 11.1, 11.2, 13.8).
      const cleanBytes = new TextDecoder().decode(clean.bytes);
      const injectedBytes = new TextDecoder().decode(injected.bytes);
      expect(injectedBytes).toBe(cleanBytes);
      expect(injected.sha256).toBe(clean.sha256);
    });
  });

  it('nenhuma sentinela privada vaza na previa, nos bytes ou nos erros (nao vazamento)', () => {
    runProperty(stateSpecArb, (spec) => {
      const injected = projectPublic(buildState(spec, true).input);
      assertNoSentinelLeak(injected);
    });
  });

  it('telefone privado sem autorizacao bloqueia sem vazar o valor nem a sentinela', () => {
    // Injeta uma pessoa adicional com telefone destinado aos Dados_Publicos mas
    // SEM autorizacao vigente: deve gerar bloqueio (7.20, 11.15) cuja
    // serializacao nao repete o telefone nem qualquer sentinela (11.3, 11.5).
    const phoneDigits = '5511888887777';
    runProperty(stateSpecArb, (spec) => {
      const built = buildState(spec, true);
      const reg = built.input.registry;
      const unauthorizedId = uuidFromInt(9000);
      reg.addPerson({
        id: unauthorizedId,
        canonicalName: 'Sem Autorizacao',
        phoneE164: `+${phoneDigits}`,
        administrativeNotes: `${PRIVATE_SENTINEL_PREFIX}_NOTA_SEM_AUTH`,
        now: NOW_UTC,
      });

      const result = projectPublic(built.input);
      expect(result.ok, 'telefone sem autorizacao deveria bloquear').toBe(false);
      if (result.ok) return;

      const serializedBlocks = JSON.stringify(result.blocks);
      // O bloqueio nao repete o valor do telefone (11.3, 11.5, 7.20).
      expect(serializedBlocks.includes(phoneDigits)).toBe(false);
      expect(serializedBlocks.includes(`+${phoneDigits}`)).toBe(false);
      // Nenhuma sentinela privada aparece nos erros publicos.
      expect(serializedBlocks.includes(PRIVATE_SENTINEL_PREFIX)).toBe(false);
    });
  });
});
