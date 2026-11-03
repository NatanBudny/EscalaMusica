// Teste baseado em propriedade — Property 33: Serializacao legada e canonica
// (tarefa 9.6).
//
// Property 33 (design.md): "Para todos os estados publicos semanticamente
// equivalentes, o LegacyExporter produz bytes identicos de `atual.json` e
// `contatos.json`, salvo metadados explicitamente variaveis, e ambos satisfazem
// os schemas consumidos pelo Visualizador_Atual."
//
// Este arquivo prova, com fast-check, as quatro facetas da canonicidade:
//
//   (A) Estabilidade: o mesmo estado publico produz os MESMOS bytes/hash em
//       execucoes repetidas (determinismo; nenhum metadado variavel escapa).
//   (B) Invariancia a ordenacao de ENTRADA: permutar a ordem dos cultos
//       (`services`) e dos contatos (`contacts`) — que sao colecoes SEM ordem
//       semantica para o artefato (atual.json ordena por DATA; contatos.json e
//       indexado por nome) — NAO altera os bytes de `atual.json`/`contatos.json`.
//   (C) Schema de `atual.json`: todo registro carrega EXATAMENTE as 14 chaves
//       conhecidas pelo visualizador, com `DATA` em DD/MM/YYYY e `DIA SEMANA`
//       nao vazio; nenhuma chave extra e emitida.
//   (D) Schema de `contatos.json`: objeto indexado por nome; cada entrada tem
//       `telefone` em `https://wa.me/<digitos>` e `apelidos` como array de
//       strings; as chaves sao ordenadas de forma estavel/canonica.
//
// Gera datas de forma deterministica e valida (ano/mes/dia constrangidos ao
// intervalo valido), evitando `fc.date().toISOString()` (flaky por fuso/formato).
//
// **Validates: Requirements 9.1, 9.2, 9.8, 10.16**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  PublicAssignment,
  PublicContactDTO,
  PublicProjectionDTO,
  PublicServiceDTO,
} from '../projection/publicProjection';
import type { Weekday } from '../schemas/models';
import { ATUAL_KEYS, exportLegacy, type LegacyExportConfig } from './legacyExporter';

// --------------------------------------------------------------------------
// Contrato de compatibilidade (roleId -> coluna legada) e config de exportacao
// --------------------------------------------------------------------------

const ROLE = {
  acomp: 'r-acomp',
  regente: 'r-regente',
  equipe: 'r-equipe',
  mensagem: 'r-mensagem',
  audiovisual: 'r-audiovisual',
  anciao: 'r-anciao',
  pregador: 'r-pregador',
  suporte: 'r-suporte',
} as const;

const CONFIG: LegacyExportConfig = {
  columns: {
    roleColumns: {
      [ROLE.acomp]: 'ACOMP',
      [ROLE.regente]: 'REGENTE LOUVOR',
      [ROLE.equipe]: 'EQUIPE LOUVOR',
      [ROLE.mensagem]: 'MENSAGEM MUSICAL',
      [ROLE.audiovisual]: 'AUDIOVISUAL',
      [ROLE.anciao]: 'ANCIÃO',
      [ROLE.pregador]: 'PREGADOR',
      [ROLE.suporte]: 'SUPORTE',
    },
    fieldColumns: {
      theme: 'TEMA CULTO',
      'sabbath-school-song': 'LOUVORES ES',
      'song-request': 'LOUVORES CULTO',
      observation: 'OBS',
    },
    listColumns: ['EQUIPE LOUVOR', 'MENSAGEM MUSICAL'],
    songColumns: ['LOUVORES ES', 'LOUVORES CULTO'],
  },
};

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const WA_RE = /^https:\/\/wa\.me\/\d{8,15}$/;

// --------------------------------------------------------------------------
// Geradores deterministicos e validos (sem fc.date().toISOString())
// --------------------------------------------------------------------------

/** Nome publico "seguro": sem delimitadores reservados, nao vazio apos trim. */
const safeName = fc
  .stringMatching(/^[A-Za-zÀ-ÿ0-9 ]{1,14}$/)
  .filter((s) => s.trim().length > 0 && !s.includes(',') && !s.includes('|'));

/** Data civil valida YYYY-MM-DD, construida a partir de inteiros (determinista). */
const isoDateArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2035 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }), // <=28 evita ambiguidade de meses/bissexto
  )
  .map(
    ([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  );

/** Telefone E.164 valido (+55 + 9 a 11 digitos) determinista. */
const phoneArb = fc
  .integer({ min: 100_000_000, max: 99_999_999_999 })
  .map((n) => `+55${n}`);

interface ServiceSeed {
  readonly serviceId: string;
  readonly date: string;
  readonly weekday: Weekday;
  readonly anciao: string;
  readonly pregador: string;
  readonly equipe: readonly string[];
  readonly theme: string;
}

const serviceSeedArb: fc.Arbitrary<ServiceSeed> = fc.record({
  serviceId: fc.uuid(),
  date: isoDateArb,
  weekday: fc.constantFrom(...WEEKDAYS),
  anciao: safeName,
  pregador: safeName,
  equipe: fc.array(safeName, { minLength: 0, maxLength: 3 }),
  theme: fc.oneof(fc.constant(''), safeName),
});

interface ContactSeed {
  readonly subjectId: string;
  readonly name: string;
  readonly phone: string;
}

const contactSeedArb: fc.Arbitrary<ContactSeed> = fc.record({
  subjectId: fc.uuid(),
  name: safeName,
  phone: phoneArb,
});

// --------------------------------------------------------------------------
// Construcao do estado publico a partir das seeds
// --------------------------------------------------------------------------

function buildService(seed: ServiceSeed): PublicServiceDTO {
  const assignments: PublicAssignment[] = [
    { serviceId: seed.serviceId, roleId: ROLE.anciao, name: seed.anciao, subjectType: 'person' },
    { serviceId: seed.serviceId, roleId: ROLE.pregador, name: seed.pregador, subjectType: 'person' },
    ...seed.equipe.map((n) => ({
      serviceId: seed.serviceId,
      roleId: ROLE.equipe,
      name: n,
      subjectType: 'person' as const,
    })),
  ];
  return {
    serviceId: seed.serviceId,
    date: seed.date,
    weekday: seed.weekday,
    kind: 'regular',
    publicFields: {},
    publicInputs: seed.theme === '' ? [] : [{ type: 'theme', value: seed.theme }],
    assignments,
  };
}

function buildContact(seed: ContactSeed): PublicContactDTO {
  // O nome canonico deriva de uma identidade ESTAVEL do seed (subjectId) e NAO
  // da posicao na entrada. Assim, permutar a ordem da lista de contatos nao
  // altera qual nome/telefone cada contato carrega — preservando a equivalencia
  // semantica exigida por Property 33.
  return {
    subjectId: seed.subjectId,
    canonicalName: `${seed.name}#${seed.subjectId}`,
    aliases: [],
    phoneE164: seed.phone,
  };
}

/**
 * Remove seeds que colidiriam no indice de `contatos.json` (mesmo nome canonico)
 * por uma chave ESTAVEL (independente de ordem). A deduplicacao e aplicada a
 * ambas as variantes de forma consistente, preservando a equivalencia semantica
 * sob permutacao: o conjunto resultante e o mesmo, so a ordem difere.
 */
function dedupeContacts(seeds: readonly ContactSeed[]): ContactSeed[] {
  const seen = new Set<string>();
  const out: ContactSeed[] = [];
  for (const s of seeds) {
    const key = `${s.name}#${s.subjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Remove cultos com `serviceId` repetido. `atual.json` ordena por (DATA,
 * serviceId); dois cultos com o MESMO serviceId tornariam o desempate ambiguo
 * sob permutacao. Como serviceId e a identidade estavel do culto, manter apenas
 * o primeiro por id preserva a equivalencia semantica entre as variantes.
 */
function dedupeServices(seeds: readonly ServiceSeed[]): ServiceSeed[] {
  const seen = new Set<string>();
  const out: ServiceSeed[] = [];
  for (const s of seeds) {
    if (seen.has(s.serviceId)) continue;
    seen.add(s.serviceId);
    out.push(s);
  }
  return out;
}

function buildDto(
  serviceSeeds: readonly ServiceSeed[],
  contactSeeds: readonly ContactSeed[],
): PublicProjectionDTO {
  return {
    period: '2026-08',
    services: serviceSeeds.map(buildService),
    contacts: contactSeeds.map(buildContact),
  };
}

/** Permutacao deterministica guiada por um array de indices do fast-check. */
function permute<T>(items: readonly T[], order: readonly number[]): T[] {
  const n = items.length;
  if (n <= 1) return [...items];
  // Fisher-Yates guiado pelos indices gerados (estavel e deterministico).
  const arr = [...items];
  for (let i = n - 1; i > 0; i--) {
    const j = (order[i % order.length] ?? 0) % (i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

// --------------------------------------------------------------------------
// Asserts de schema do visualizador
// --------------------------------------------------------------------------

function assertAtualSchema(records: readonly Record<string, unknown>[]): void {
  expect(Array.isArray(records)).toBe(true);
  for (const rec of records) {
    // Exatamente as 14 chaves, nenhuma a mais, nenhuma a menos.
    expect(Object.keys(rec).sort()).toEqual([...ATUAL_KEYS].sort());
    for (const key of ATUAL_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(rec, key)).toBe(true);
      expect(typeof rec[key]).toBe('string');
    }
    expect(rec['DATA']).toMatch(DATE_RE);
    expect(String(rec['DIA SEMANA']).trim().length).toBeGreaterThan(0);
  }
}

function assertContatosSchema(
  contatos: Record<string, { telefone: string; apelidos: unknown }>,
): void {
  expect(typeof contatos).toBe('object');
  expect(Array.isArray(contatos)).toBe(false);
  for (const nome of Object.keys(contatos)) {
    const entry = contatos[nome]!;
    expect(typeof entry.telefone).toBe('string');
    expect(entry.telefone).toMatch(WA_RE);
    expect(Array.isArray(entry.apelidos)).toBe(true);
    for (const alias of entry.apelidos as unknown[]) expect(typeof alias).toBe('string');
  }
}

/**
 * Verifica que a SERIALIZACAO canonica dos bytes ordena as chaves de contatos
 * de forma estavel (por unidade de codigo UTF-16), exatamente como o
 * serializador canonico garante. A ordem e verificada nos BYTES (nao no objeto
 * em memoria, cuja ordem de insercao e irrelevante para o artefato).
 */
function assertContatosKeysCanonicallyOrdered(bytes: Uint8Array): void {
  const parsed = decode(bytes) as Record<string, unknown>;
  const keys = Object.keys(parsed);
  const sorted = [...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  expect(keys).toEqual(sorted);
}

function decode(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

// --------------------------------------------------------------------------
// Property 33
// --------------------------------------------------------------------------

describe('LegacyExporter — Property 33: serializacao legada e canonica', () => {
  it('estados publicos semanticamente equivalentes produzem bytes identicos e satisfazem os schemas', () => {
    // Feature: gestao-leiga-de-escalas, Property 33: Serialização legada é canônica
    fc.assert(
      fc.property(
        fc.array(serviceSeedArb, { minLength: 0, maxLength: 6 }),
        fc.array(contactSeedArb, { minLength: 0, maxLength: 6 }),
        // Indices usados para permutar a ordem de entrada sem mudar a semantica.
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 8 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 8 }),
        (rawServiceSeeds, rawContactSeeds, svcOrder, ctcOrder) => {
          // Dedup por chave estavel ANTES de permutar: ambas as variantes
          // operam sobre exatamente o mesmo conjunto, diferindo so na ORDEM.
          const serviceSeeds = dedupeServices(rawServiceSeeds);
          const contactSeeds = dedupeContacts(rawContactSeeds);

          const dtoA = buildDto(serviceSeeds, contactSeeds);
          // Variante semanticamente equivalente: mesma colecao de cultos e
          // contatos, apenas em OUTRA ordem de entrada. A ordem desses arrays
          // nao tem significado para o artefato (atual.json ordena por DATA;
          // contatos.json e indexado por nome).
          const dtoB = buildDto(
            permute(serviceSeeds, svcOrder),
            permute(contactSeeds, ctcOrder),
          );

          const rA = exportLegacy(dtoA, CONFIG);
          const rB = exportLegacy(dtoB, CONFIG);

          // Como os nomes de contato sao unicos e nao ha delimitadores ambiguos
          // nem datas invalidas, ambas as exportacoes devem ser OK.
          expect(rA.ok).toBe(true);
          expect(rB.ok).toBe(true);
          if (!rA.ok || !rB.ok) return;

          // (C) e (D): schema do visualizador.
          assertAtualSchema(rA.atual.value);
          assertContatosSchema(rA.contatos.value);
          assertAtualSchema(decode(rA.atual.bytes) as Record<string, unknown>[]);
          assertContatosSchema(
            decode(rA.contatos.bytes) as Record<string, { telefone: string; apelidos: unknown }>,
          );
          // Chaves de contatos ordenadas de forma canonica nos BYTES emitidos.
          assertContatosKeysCanonicallyOrdered(rA.contatos.bytes);

          // (B) Invariancia a ordenacao de entrada: bytes/hash identicos.
          expect(rB.atual.sha256).toBe(rA.atual.sha256);
          expect(rB.contatos.sha256).toBe(rA.contatos.sha256);
          expect([...rB.atual.bytes]).toEqual([...rA.atual.bytes]);
          expect([...rB.contatos.bytes]).toEqual([...rA.contatos.bytes]);

          // (A) Estabilidade/determinismo: reexecutar o MESMO estado reproduz os
          // mesmos bytes (nenhum metadado variavel vaza para o artefato).
          const rA2 = exportLegacy(dtoA, CONFIG);
          expect(rA2.ok).toBe(true);
          if (!rA2.ok) return;
          expect(rA2.atual.sha256).toBe(rA.atual.sha256);
          expect(rA2.contatos.sha256).toBe(rA.contatos.sha256);
        },
      ),
      { numRuns: 200, verbose: true },
    );
  });
});
