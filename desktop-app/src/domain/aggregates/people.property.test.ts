import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  addAlias,
  addLeave,
  addLink,
  createDepartment,
  createPerson,
  deactivatePerson,
  setAllowedWeekdays,
  setPhone,
  LIMITS,
  type AggregateResult,
} from './people';
import { validateEntity } from '../schemas/validator';
import type {
  Department,
  LeavePeriod,
  Person,
  PersonAlias,
  PersonLink,
  Uuid,
  Weekday,
} from '../schemas/models';

// Feature: gestao-leiga-de-escalas, Property 8: Agregados de pessoa e departamento preservam invariantes
//
// Para todo comando de criacao ou alteracao aceito, Pessoas_Canonicas e
// Departamentos satisfazem seus limites de nomes, aliases, telefone, estado,
// habilitacoes, dias, afastamentos e vinculos, seus IDs permanecem estaveis, e
// nenhuma operacao aceita self-link, vinculo duplicado, tipo desconhecido,
// intervalo invertido ou referencia invalida.
//
// Valida: Requisitos 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.14, 3.15.
//
// Estrategia: o validador de schema + semantica (`validateEntity`) e usado como
// oraculo das invariantes estruturais. Toda saida aceita (`ok`) deve passar no
// validador. Comandos que violam uma invariante devem ser rejeitados (`!ok`) e
// preservar o agregado anterior (ausencia de mutacao, comprovada por clone).

const NOW = '2026-01-15T12:00:00Z';

// --- Geradores de valores de dominio ---------------------------------------

// UUID v4 deterministico a partir de um inteiro, para IDs validos e distintos.
const uuidFromInt = (n: number): Uuid => {
  const hex = (n >>> 0).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
};

const uuidArb: fc.Arbitrary<Uuid> = fc.integer({ min: 1, max: 0xffffff }).map(uuidFromInt);

// Nome dentro dos limites 1-120.
const validNameArb = fc.string({ minLength: LIMITS.nameMin, maxLength: LIMITS.nameMax });

const validAliasArb: fc.Arbitrary<PersonAlias> = fc
  .string({ minLength: LIMITS.aliasMin, maxLength: LIMITS.nameMax })
  .map((value) => ({ value }));

// Telefone E.164 valido: '+' seguido de 8 a 15 digitos.
const validPhoneArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 9 }), {
    minLength: LIMITS.phoneMin,
    maxLength: LIMITS.phoneMax,
  })
  .map((digits) => `+${digits.join('')}`);

const weekdayArb: fc.Arbitrary<Weekday> = fc.constantFrom<Weekday>(
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
);

// Conjunto de dias da semana sem duplicidade (0-7).
const weekdaysArb: fc.Arbitrary<Weekday[]> = fc
  .uniqueArray(weekdayArb, { maxLength: LIMITS.weekdayMax })
  .map((xs) => [...xs]);

const isoDateArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2100-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

// Afastamento com data final >= inicial (ou sem data final). O `id` recebe um
// placeholder; IDs unicos sao atribuidos ao montar a lista para evitar colisao
// (o validador rejeita ids duplicados).
const validLeaveArb: fc.Arbitrary<LeavePeriod> = fc
  .tuple(isoDateArb, isoDateArb, fc.boolean())
  .map(([a, b, withEnd]) => {
    const [start, end] = a <= b ? [a, b] : [b, a];
    return withEnd ? { id: uuidFromInt(0), start, end } : { id: uuidFromInt(0), start };
  });

// Reatribui IDs unicos e deterministicos a uma lista de afastamentos.
const withUniqueLeaveIds = (leaves: LeavePeriod[], offset: number): LeavePeriod[] =>
  leaves.map((l, i) => ({ ...l, id: uuidFromInt(offset + i) }));

// --- Geradores de pessoa valida --------------------------------------------

interface ValidPersonSpec {
  id: Uuid;
  canonicalName: string;
  aliases: PersonAlias[];
  phoneE164?: string;
  participation: 'active' | 'inactive';
  capabilityIds: Uuid[];
  allowedWeekdays: Weekday[];
  leaves: LeavePeriod[];
  links: PersonLink[];
  knownLinkTypeIds: Uuid[];
}

// Gera uma pessoa valida completa, incluindo vinculos coerentes (tipos
// conhecidos, sem self-link, sem duplicidade de (tipo, destino)).
const validPersonSpecArb: fc.Arbitrary<ValidPersonSpec> = fc
  .record({
    id: uuidArb,
    canonicalName: validNameArb,
    aliases: fc.array(validAliasArb, { maxLength: LIMITS.aliasMax }),
    phoneE164: fc.option(validPhoneArb, { nil: undefined }),
    participation: fc.constantFrom<'active' | 'inactive'>('active', 'inactive'),
    capabilityIds: fc.uniqueArray(uuidArb, { maxLength: 8 }),
    allowedWeekdays: weekdaysArb,
    leaves: fc.array(validLeaveArb, { maxLength: 6 }).map((ls) => withUniqueLeaveIds(ls, 0x700000)),
    linkTypeIds: fc.uniqueArray(uuidArb, { minLength: 1, maxLength: 4 }),
    linkTargets: fc.uniqueArray(uuidArb, { maxLength: 6 }),
  })
  .map((r) => {
    // Monta vinculos unicos por (tipo, destino), excluindo self-link.
    const targets = r.linkTargets.filter((t) => t !== r.id);
    const links: PersonLink[] = [];
    const used = new Set<string>();
    let linkCounter = 0;
    for (const typeId of r.linkTypeIds) {
      for (const otherPersonId of targets) {
        const key = `${typeId}::${otherPersonId}`;
        if (used.has(key)) continue;
        used.add(key);
        links.push({
          id: uuidFromInt(0x800000 + linkCounter++),
          typeId,
          otherPersonId,
          validFrom: '2026-01-01',
        });
        if (links.length >= LIMITS.linkMax) break;
      }
      if (links.length >= LIMITS.linkMax) break;
    }
    return {
      id: r.id,
      canonicalName: r.canonicalName,
      aliases: r.aliases,
      ...(r.phoneE164 !== undefined ? { phoneE164: r.phoneE164 } : {}),
      participation: r.participation,
      capabilityIds: r.capabilityIds,
      allowedWeekdays: r.allowedWeekdays,
      leaves: r.leaves,
      links,
      knownLinkTypeIds: r.linkTypeIds,
    };
  });

// Oraculo: todo agregado aceito deve passar no validador de schema + semantica.
function expectValidPerson(person: Person): void {
  const outcome = validateEntity('person', person);
  expect(outcome.valid, JSON.stringify(outcome.issues)).toBe(true);
}

function expectValidDepartment(dep: Department): void {
  const outcome = validateEntity('department', dep);
  expect(outcome.valid, JSON.stringify(outcome.issues)).toBe(true);
}

function assertAccepted<T>(r: AggregateResult<T>): T {
  expect(r.ok, r.ok ? '' : JSON.stringify((r as { error: unknown }).error)).toBe(true);
  if (!r.ok) throw new Error('inesperado: comando rejeitado');
  return r.value;
}

// ---------------------------------------------------------------------------

describe('Property 8: Agregados de pessoa e departamento preservam invariantes', () => {
  it('toda criacao aceita produz um agregado que satisfaz as invariantes', () => {
    fc.assert(
      fc.property(validPersonSpecArb, (spec) => {
        const r = createPerson({ ...spec, now: NOW });
        const person = assertAccepted(r);
        // Invariantes estruturais (3.1-3.5, 3.8) via oraculo.
        expectValidPerson(person);
        // ID preservado (nao muda na criacao).
        expect(person.id).toBe(spec.id);
        // Limites explicitos do dominio.
        expect(person.aliases.length).toBeLessThanOrEqual(LIMITS.aliasMax);
        expect(person.allowedWeekdays.length).toBeLessThanOrEqual(LIMITS.weekdayMax);
        expect(new Set(person.allowedWeekdays).size).toBe(person.allowedWeekdays.length);
        expect(person.leaves.length).toBeLessThanOrEqual(LIMITS.leaveMax);
        expect(person.links.length).toBeLessThanOrEqual(LIMITS.linkMax);
      }),
      { numRuns: 200 },
    );
  });

  it('todo departamento aceito satisfaz as invariantes (3.5)', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: uuidArb,
          canonicalName: validNameArb,
          aliases: fc.array(validAliasArb, { maxLength: LIMITS.aliasMax }),
          status: fc.constantFrom<'active' | 'inactive'>('active', 'inactive'),
        }),
        (spec) => {
          const dep = assertAccepted(createDepartment({ ...spec, now: NOW }));
          expectValidDepartment(dep);
          expect(dep.id).toBe(spec.id);
          expect(dep.aliases.length).toBeLessThanOrEqual(LIMITS.aliasMax);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('mutacoes aceitas preservam o ID e as invariantes', () => {
    fc.assert(
      fc.property(validPersonSpecArb, validLeaveArb, validPhoneArb, (spec, leave, phone) => {
        const base = assertAccepted(createPerson({ ...spec, now: NOW }));

        // addLeave (respeita o limite de 1.000, aqui sempre valido).
        if (base.leaves.length < LIMITS.leaveMax) {
          const withLeave = assertAccepted(addLeave(base, leave, NOW));
          expect(withLeave.id).toBe(base.id);
          expectValidPerson(withLeave);
        }

        // setPhone com telefone valido e com remocao.
        const withPhone = assertAccepted(setPhone(base, phone, NOW));
        expect(withPhone.id).toBe(base.id);
        expect(withPhone.phoneE164).toBe(phone);
        expectValidPerson(withPhone);

        const noPhone = assertAccepted(setPhone(base, undefined, NOW));
        expect(noPhone.phoneE164).toBeUndefined();
        expectValidPerson(noPhone);

        // deactivatePerson preserva id e demais campos (3.9 parcial, invariante).
        const off = deactivatePerson(base, NOW);
        expect(off.id).toBe(base.id);
        expect(off.participation).toBe('inactive');
        expectValidPerson(off);
      }),
      { numRuns: 200 },
    );
  });

  it('rejeita nome fora de 1-120 sem produzir agregado (3.1)', () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.oneof(fc.constant(''), fc.string({ minLength: 121, maxLength: 200 })),
        (id, badName) => {
          const r = createPerson({ id, canonicalName: badName, now: NOW });
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.code).toBe('canonical-name-length');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejeita telefone invalido (3.8)', () => {
    const badPhoneArb = fc.oneof(
      fc.constant('5511999998888'), // sem '+'
      fc.constant('+123'), // menos de 8 digitos
      fc.constant(`+${'9'.repeat(16)}`), // mais de 15 digitos
      fc.constant('+55abc12345'), // caractere invalido
    );
    fc.assert(
      fc.property(uuidArb, validNameArb, badPhoneArb, (id, name, phone) => {
        const r = createPerson({ id, canonicalName: name, phoneE164: phone, now: NOW });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe('phone-format');
      }),
      { numRuns: 100 },
    );
  });

  it('rejeita afastamento invertido e excesso de afastamentos (3.3, 3.14)', () => {
    // Intervalo invertido.
    fc.assert(
      fc.property(
        uuidArb,
        validNameArb,
        uuidArb,
        fc.tuple(isoDateArb, isoDateArb).filter(([a, b]) => a !== b),
        (id, name, leaveId, [d1, d2]) => {
          const [start, end] = d1 > d2 ? [d1, d2] : [d2, d1]; // end < start
          const r = createPerson({
            id,
            canonicalName: name,
            leaves: [{ id: leaveId, start, end }],
            now: NOW,
          });
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.code).toBe('leave-range');
        },
      ),
      { numRuns: 100 },
    );

    // Excesso: 1001 afastamentos.
    const tooMany: LeavePeriod[] = Array.from({ length: LIMITS.leaveMax + 1 }, (_, i) => ({
      id: uuidFromInt(0x900000 + i),
      start: '2026-01-01',
    }));
    const over = createPerson({
      id: uuidFromInt(1),
      canonicalName: 'Teste',
      leaves: tooMany,
      now: NOW,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('leave-count');
  });

  it('rejeita self-link, tipo desconhecido e vinculo duplicado (3.4, 3.15)', () => {
    fc.assert(
      fc.property(uuidArb, uuidArb, uuidArb, (id, typeId, otherId) => {
        fc.pre(id !== otherId);

        // self-link
        const selfLink = createPerson({
          id,
          canonicalName: 'Teste',
          links: [{ id: uuidFromInt(10), typeId, otherPersonId: id, validFrom: '2026-01-01' }],
          knownLinkTypeIds: [typeId],
          now: NOW,
        });
        expect(selfLink.ok).toBe(false);
        if (!selfLink.ok) expect(selfLink.error.code).toBe('link-self');

        // tipo desconhecido (conjunto de tipos conhecidos vazio)
        const unknownType = createPerson({
          id,
          canonicalName: 'Teste',
          links: [
            { id: uuidFromInt(11), typeId, otherPersonId: otherId, validFrom: '2026-01-01' },
          ],
          knownLinkTypeIds: [],
          now: NOW,
        });
        expect(unknownType.ok).toBe(false);
        if (!unknownType.ok) expect(unknownType.error.code).toBe('link-unknown-type');

        // duplicado: mesmo (tipo, destino)
        const dup = createPerson({
          id,
          canonicalName: 'Teste',
          links: [
            { id: uuidFromInt(12), typeId, otherPersonId: otherId, validFrom: '2026-01-01' },
            { id: uuidFromInt(13), typeId, otherPersonId: otherId, validFrom: '2026-02-01' },
          ],
          knownLinkTypeIds: [typeId],
          now: NOW,
        });
        expect(dup.ok).toBe(false);
        if (!dup.ok) expect(dup.error.code).toBe('link-duplicate');
      }),
      { numRuns: 150 },
    );
  });

  it('rejeita excesso de aliases e dias duplicados (3.1, 3.2)', () => {
    const tooManyAliases: PersonAlias[] = Array.from({ length: LIMITS.aliasMax + 1 }, (_, i) => ({
      value: `alias-${i}`,
    }));
    const aliasOver = createPerson({
      id: uuidFromInt(1),
      canonicalName: 'Teste',
      aliases: tooManyAliases,
      now: NOW,
    });
    expect(aliasOver.ok).toBe(false);
    if (!aliasOver.ok) expect(aliasOver.error.code).toBe('alias-count');

    const dupWeekday = createPerson({
      id: uuidFromInt(1),
      canonicalName: 'Teste',
      allowedWeekdays: ['monday', 'monday'],
      now: NOW,
    });
    expect(dupWeekday.ok).toBe(false);
    if (!dupWeekday.ok) expect(dupWeekday.error.code).toBe('weekday-duplicate');
  });

  it('comandos rejeitados nao mutam o agregado anterior (ausencia de mutacao)', () => {
    fc.assert(
      fc.property(validPersonSpecArb, uuidArb, (spec, strayTypeId) => {
        const base = assertAccepted(createPerson({ ...spec, now: NOW }));
        const snapshot = structuredClone(base);

        // Tentativa invalida: adicionar vinculo com tipo desconhecido.
        const unknownType = uuidFromInt(0xabcdef);
        fc.pre(!spec.knownLinkTypeIds.includes(unknownType) && unknownType !== strayTypeId);
        const badTarget = uuidFromInt(0xfed);
        fc.pre(badTarget !== base.id);

        const rejected = addLink(
          base,
          { id: uuidFromInt(0x1000), typeId: unknownType, otherPersonId: badTarget, validFrom: '2026-01-01' },
          new Set(spec.knownLinkTypeIds),
          NOW,
        );
        expect(rejected.ok).toBe(false);
        // O agregado base permanece identico (nenhuma mutacao).
        expect(base).toEqual(snapshot);

        // Tentativa invalida: alias longo demais.
        const badAlias = addAlias(base, { value: 'x'.repeat(121) }, NOW);
        expect(badAlias.ok).toBe(false);
        expect(base).toEqual(snapshot);

        // Tentativa invalida: dias duplicados.
        const badDays = setAllowedWeekdays(base, ['sunday', 'sunday'], NOW);
        expect(badDays.ok).toBe(false);
        expect(base).toEqual(snapshot);
      }),
      { numRuns: 150 },
    );
  });
});
