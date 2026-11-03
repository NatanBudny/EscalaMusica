// Feature: gestao-leiga-de-escalas, Property 31: Contatos públicos correspondem exatamente às autorizações vigentes
//
// Property 31 (design.md): Para todo Cadastro_Central, instante e finalidade,
// `contatos.json` contém exatamente os campos autorizados para Pessoas_Canonicas
// ativas cujo sujeito, valor, finalidade e vigência coincidem; autorização
// ausente, expirada, revogada ou para valor diferente impede o telefone.
//
// Validates: Requirements 3.11, 10.7, 11.4, 11.15, 11.16
//
// Semântica verificada por esta propriedade, para TODO cadastro/instante/
// finalidade gerado:
//   (A) Correspondência exata de telefones: um telefone destinado aos
//       Dados_Publicos aparece no contato público SE E SOMENTE SE existe uma
//       autorização de `phone` com sujeito/valor(hash)/finalidade coincidentes,
//       estado `active` e vigência inclusiva cobrindo o instante `at` (11.4,
//       11.15, 11.16). Nada autorizado falta; nada não autorizado aparece.
//   (B) Bloqueio, nunca inclusão silenciosa: quando uma pessoa ativa POSSUI
//       telefone mas não há autorização vigente que o cubra, a projeção NÃO
//       emite o pacote — ela produz um bloqueio `phone-not-authorized` para
//       aquele sujeito (11.15, 7.20). O valor do telefone jamais é repetido no
//       bloqueio.
//   (C) Correspondência exata de aliases: os aliases públicos de uma pessoa
//       ativa são EXATAMENTE aqueles com autorização de `alias` vigente e
//       coincidente (3.12, 11.4). Alias sem autorização é descarte silencioso
//       (privado por padrão), não bloqueio.
//   (D) Somente pessoas ativas entram nos contatos (3.11); nome canônico é
//       público por classificação.
//
// Oráculo independente: `expectedContacts` recomputa, diretamente a partir do
// conjunto de autorizações geradas (sem chamar a projeção), quais pessoas/campos
// deveriam aparecer e quais telefones deveriam bloquear. A decisão do oráculo é
// comparada com o resultado de `projectPublic`. Testes de propriedade operam
// sobre funções puras do domínio (sem I/O).
//
// Datas: geradas de forma DETERMINÍSTICA a partir de offsets inteiros de dia
// sobre uma base fixa (sem `fc.date().toISOString()`), evitando flakiness.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { SCHEMA_VERSION } from '../schemas/models';
import { RegistryService } from '../registry/registry-service';
import { canonicalBytes, sha256Hex } from '../schemas/canonical';
import { projectPublic, type PublicProjectionInput } from './publicProjection';

// No mínimo 100 execuções; seed/replayPath visíveis em falha (abaixo).
const RUNS = 300;

const PERIOD = '2026-02';
const PURPOSE = 'Confirmacao de escala por WhatsApp';
const OTHER_PURPOSE = 'Outra finalidade qualquer';
const OPERATOR = '40404040-4040-4040-8040-404040404040';

/** Hash de valor igual ao default da projeção (SHA-256 do UTF-8 canônico). */
function hashValue(value: string): string {
  return sha256Hex(canonicalBytes(value));
}

// --------------------------------------------------------------------------
// Datas determinísticas: base fixa + offset inteiro de dias (sem fc.date()).
// --------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_EPOCH = Date.UTC(2026, 0, 1); // 2026-01-01

/** Converte um offset inteiro de dias em uma data civil `YYYY-MM-DD`. */
function isoDateFromOffset(dayOffset: number): string {
  const d = new Date(BASE_EPOCH + dayOffset * DAY_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Instante de criação/now determinístico (ISO completo, não gerado por fc). */
const NOW_UTC = '2026-01-01T00:00:00Z';

// --------------------------------------------------------------------------
// Modelo de caso gerado
// --------------------------------------------------------------------------

type AuthField = 'phone' | 'alias';

interface GenAuthorization {
  readonly ofPersonIndex: number; // qual pessoa (por índice) a autorização referencia
  readonly field: AuthField;
  /** 'self' = usa o valor real da pessoa; 'other' = valor diferente (hash não casa). */
  readonly valueMode: 'self' | 'other';
  /** 'this' = PURPOSE; 'other' = finalidade diferente. */
  readonly purposeMode: 'this' | 'other';
  readonly validFromOffset: number;
  /** undefined => sem limite superior. */
  readonly validUntilOffset: number | undefined;
  readonly revoked: boolean;
}

interface GenPerson {
  readonly active: boolean;
  readonly hasPhone: boolean;
  readonly phone: string; // E.164 válido
  readonly alias: string; // alias candidato (pode ou não ser autorizado)
}

interface GenCase {
  readonly people: readonly GenPerson[];
  readonly auths: readonly GenAuthorization[];
  readonly atOffset: number;
}

// --------------------------------------------------------------------------
// Geradores inteligentes
// --------------------------------------------------------------------------

/** Telefone E.164 válido: '+' seguido de 8..15 dígitos. */
const phoneArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 15 })
  .map((digits) => `+${digits.join('')}`);

const aliasArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 6 })
  .map((s) => `Al${s}`)
  // Garante um alias não vazio e estável.
  .map((s) => (s.trim().length > 0 ? s : 'Alias'));

const personArb: fc.Arbitrary<GenPerson> = fc.record({
  active: fc.boolean(),
  hasPhone: fc.boolean(),
  phone: phoneArb,
  alias: aliasArb,
});

/** Offsets de vigência: cobrem casados, expirados e futuros em torno de `at`. */
const offsetArb = fc.integer({ min: -20, max: 60 });

function authArb(personCount: number): fc.Arbitrary<GenAuthorization> {
  return fc
    .record({
      ofPersonIndex: fc.integer({ min: 0, max: Math.max(0, personCount - 1) }),
      field: fc.constantFrom('phone', 'alias') as fc.Arbitrary<AuthField>,
      valueMode: fc.constantFrom('self', 'other') as fc.Arbitrary<'self' | 'other'>,
      purposeMode: fc.constantFrom('this', 'other') as fc.Arbitrary<'this' | 'other'>,
      validFromOffset: offsetArb,
      hasUntil: fc.boolean(),
      validUntilOffset: offsetArb,
      revoked: fc.boolean(),
    })
    .map((r) => ({
      ofPersonIndex: r.ofPersonIndex,
      field: r.field,
      valueMode: r.valueMode,
      purposeMode: r.purposeMode,
      validFromOffset: r.validFromOffset,
      validUntilOffset: r.hasUntil ? r.validUntilOffset : undefined,
      revoked: r.revoked,
    }));
}

const caseArb: fc.Arbitrary<GenCase> = fc
  .array(personArb, { minLength: 1, maxLength: 5 })
  .chain((people) =>
    fc.record({
      people: fc.constant(people),
      auths: fc.array(authArb(people.length), { minLength: 0, maxLength: 8 }),
      atOffset: fc.integer({ min: 0, max: 40 }),
    }),
  );

// --------------------------------------------------------------------------
// IDs determinísticos por índice (UUID v4 válido e estável).
// --------------------------------------------------------------------------

function personId(i: number): string {
  const n = String(i).padStart(2, '0');
  return `${n}000000-0000-4000-8000-0000000000${n}`;
}

function authId(i: number): string {
  const n = String(i).padStart(2, '0');
  return `${n}111111-1111-4111-8111-1111111111${n}`;
}

// --------------------------------------------------------------------------
// Construção do cadastro a partir do caso gerado.
// --------------------------------------------------------------------------

function buildRegistry(gen: GenCase): RegistryService {
  const reg = new RegistryService();

  gen.people.forEach((p, i) => {
    const res = reg.addPerson({
      id: personId(i),
      canonicalName: `Pessoa ${String.fromCharCode(65 + i)} ${i}`,
      aliases: [{ value: p.alias }],
      ...(p.hasPhone ? { phoneE164: p.phone } : {}),
      now: NOW_UTC,
    });
    // Se, por acaso, dois aliases colidirem, o cadastro rejeita; nesse caso
    // recriamos a pessoa sem alias para manter a invariante do teste (o alias
    // deixa de ser candidato à autorização, o que o oráculo reflete lendo o
    // snapshot real do cadastro).
    if (!res.ok) {
      reg.addPerson({
        id: personId(i),
        canonicalName: `Pessoa ${String.fromCharCode(65 + i)} ${i}`,
        ...(p.hasPhone ? { phoneE164: p.phone } : {}),
        now: NOW_UTC,
      });
    }
    if (!p.active) {
      reg.deactivatePerson(personId(i), NOW_UTC);
    }
  });

  gen.auths.forEach((a, i) => {
    const p = gen.people[a.ofPersonIndex];
    if (!p) return;
    const realValue = a.field === 'phone' ? p.phone : p.alias;
    const value = a.valueMode === 'self' ? realValue : `${realValue}-DIFERENTE`;
    const purpose = a.purposeMode === 'this' ? PURPOSE : OTHER_PURPOSE;
    const validFrom = isoDateFromOffset(a.validFromOffset);
    const validUntil =
      a.validUntilOffset === undefined ? undefined : isoDateFromOffset(a.validUntilOffset);

    const res = reg.registerAuthorization({
      id: authId(i),
      subjectId: personId(a.ofPersonIndex),
      field: a.field,
      valueHash: hashValue(value),
      purpose,
      approvedBy: OPERATOR,
      validFrom,
      ...(validUntil !== undefined ? { validUntil } : {}),
      now: NOW_UTC,
    });
    if (res.ok && a.revoked) {
      reg.revokeAuthorization(authId(i));
    }
  });

  return reg;
}

// --------------------------------------------------------------------------
// Oráculo independente: recomputa contatos esperados a partir das autorizações.
// --------------------------------------------------------------------------

interface ExpectedContact {
  subjectId: string;
  canonicalName: string;
  aliases: string[];
  phoneE164?: string;
}

interface Expectation {
  /** Deve bloquear? (há pessoa ativa com telefone sem autorização vigente). */
  shouldBlock: boolean;
  /** Ids de pessoas que geram bloqueio de telefone. */
  blockedPersonIds: string[];
  /** Contatos esperados quando NÃO bloqueia. */
  contacts: ExpectedContact[];
}

/**
 * Oráculo: lê o snapshot REAL do cadastro (pessoas efetivamente criadas, com os
 * aliases que de fato persistiram) e avalia a vigência das autorizações de forma
 * independente de `projectPublic`.
 */
function expectedContacts(reg: RegistryService, at: string): Expectation {
  const snapshot = reg.snapshot();
  const inForce = (field: AuthField, subjectId: string, valueHash: string): boolean => {
    for (const a of snapshot.authorizations) {
      if (
        a.subjectId === subjectId &&
        a.field === field &&
        a.valueHash === valueHash &&
        a.purpose === PURPOSE &&
        a.status === 'active' &&
        at >= a.validFrom &&
        (a.validUntil === undefined || at <= a.validUntil)
      ) {
        return true;
      }
    }
    return false;
  };

  const contacts: ExpectedContact[] = [];
  const blockedPersonIds: string[] = [];

  for (const person of snapshot.people) {
    if (person.participation !== 'active') continue; // (D) só ativas (3.11)

    // (C) aliases: exatamente os autorizados e vigentes.
    const aliases = person.aliases
      .map((al) => al.value)
      .filter((v) => inForce('alias', person.id, hashValue(v)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const contact: ExpectedContact = {
      subjectId: person.id,
      canonicalName: person.canonicalName,
      aliases,
    };

    // (A)/(B) telefone: só com autorização vigente; senão bloqueio.
    if (person.phoneE164 !== undefined) {
      if (inForce('phone', person.id, hashValue(person.phoneE164))) {
        contact.phoneE164 = person.phoneE164;
      } else {
        blockedPersonIds.push(person.id);
      }
    }

    contacts.push(contact);
  }

  contacts.sort((a, b) => (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0));
  blockedPersonIds.sort();

  return { shouldBlock: blockedPersonIds.length > 0, blockedPersonIds, contacts };
}

// --------------------------------------------------------------------------
// Entrada da projeção (sem cultos/insumos: isolamos o eixo de contatos).
// --------------------------------------------------------------------------

function buildInput(reg: RegistryService, at: string): PublicProjectionInput {
  return {
    registry: reg,
    services: [],
    draft: {
      schemaVersion: SCHEMA_VERSION,
      cycleId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      revision: 'a'.repeat(64),
      assignments: [],
      publicFields: [],
      privateNotes: [],
      createdAt: NOW_UTC,
    },
    externalInputs: [],
    period: PERIOD,
    at,
    purpose: { phonePurpose: PURPOSE },
    valueHash: hashValue,
  };
}

// --------------------------------------------------------------------------
// Propriedade
// --------------------------------------------------------------------------

describe('Property 31: Contatos públicos correspondem exatamente às autorizações vigentes', () => {
  it('contatos públicos = exatamente campos autorizados vigentes; telefone sem autorização bloqueia', () => {
    fc.assert(
      fc.property(caseArb, (gen) => {
        const reg = buildRegistry(gen);
        const at = isoDateFromOffset(gen.atOffset);
        const expected = expectedContacts(reg, at);

        const result = projectPublic(buildInput(reg, at));

        if (expected.shouldBlock) {
          // (B) Não emite o pacote: produz bloqueios `phone-not-authorized`
          // exatamente para os sujeitos sem autorização vigente de telefone.
          expect(result.ok).toBe(false);
          if (result.ok) return;

          const blockedRefs = result.blocks
            .filter((b) => b.code === 'phone-not-authorized')
            .map((b) => b.reference)
            .sort();
          const expectedRefs = expected.blockedPersonIds.map((id) => `pessoa:${id}`).sort();
          expect(blockedRefs).toEqual(expectedRefs);

          // Nenhum bloqueio repete o valor do telefone (11.5/7.20).
          const serializedBlocks = JSON.stringify(result.blocks);
          for (const p of gen.people) {
            if (p.hasPhone) {
              expect(serializedBlocks).not.toContain(p.phone);
            }
          }
          return;
        }

        // Sem bloqueio: o pacote é emitido e os contatos correspondem EXATAMENTE
        // ao oráculo (nada autorizado falta, nada não autorizado aparece).
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const actual = result.dto.contacts.map((c) => ({
          subjectId: c.subjectId,
          canonicalName: c.canonicalName,
          aliases: [...c.aliases],
          ...(c.phoneE164 !== undefined ? { phoneE164: c.phoneE164 } : {}),
        }));

        expect(actual).toEqual(expected.contacts);

        // (A) Reforço: todo telefone presente tem autorização vigente e todo
        // alias presente também; o oráculo já garante a direção inversa.
        for (const c of result.dto.contacts) {
          if (c.phoneE164 !== undefined) {
            expect(
              reg.isPublicAuthorized({
                subjectId: c.subjectId,
                field: 'phone',
                valueHash: hashValue(c.phoneE164),
                purpose: PURPOSE,
                at,
              }),
            ).toBe(true);
          }
          for (const alias of c.aliases) {
            expect(
              reg.isPublicAuthorized({
                subjectId: c.subjectId,
                field: 'alias',
                valueHash: hashValue(alias),
                purpose: PURPOSE,
                at,
              }),
            ).toBe(true);
          }
        }
      }),
      {
        numRuns: RUNS,
        reporter: (out) => {
          if (out.failed) {
            // Superfície de seed/replayPath para reprodução determinística.
            const replay = out.counterexamplePath ?? '';
            throw new Error(
              `Property 31 falhou. seed=${out.seed} replayPath="${replay}" ` +
                `numRuns=${out.numRuns}. Contraexemplo: ${fc.stringify(out.counterexample)}`,
            );
          }
        },
      },
    );
  });
});
