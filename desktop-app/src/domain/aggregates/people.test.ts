// Suite de testes unitarios por exemplo e borda dos agregados do dominio puro
// (Tarefa 2.8). Cobre, SEM I/O, as cardinalidades e limites de texto/telefone
// definidos no desenho (design.md, "Exemplos e bordas obrigatorios"):
//
//  - nome canonico 1/120/121 caracteres;
//  - 20/21 aliases; alias 1/120/121 caracteres;
//  - 50/51 vinculos; 1000/1001 afastamentos;
//  - telefone com '+', 8/15 digitos e caracteres proibidos;
//  - predicados de estado (participation), dias da semana e coerencia de datas.
//
// Estas funcoes sao puras e deterministicas; nenhuma delas faz I/O. Os casos
// complementam (sem duplicar) o PBT de invariantes em `people.property.test.ts`.

import { describe, expect, it } from 'vitest';

import {
  LIMITS,
  addAlias,
  addLeave,
  addLink,
  createDepartment,
  createPerson,
  deactivatePerson,
  setAllowedWeekdays,
  setPhone,
} from './people';
import type {
  LeavePeriod,
  PersonAlias,
  PersonLink,
  Uuid,
  Weekday,
} from '../schemas/models';

const NOW = '2026-01-15T12:00:00Z';
const SELF: Uuid = '00000000-0000-4000-8000-000000000001';
const OTHER: Uuid = '00000000-0000-4000-8000-000000000002';
const TYPE_A: Uuid = '00000000-0000-4000-8000-0000000000aa';
const TYPE_B: Uuid = '00000000-0000-4000-8000-0000000000bb';

/** Repete um caractere `n` vezes (gerador de strings de comprimento exato). */
const repeat = (n: number): string => 'a'.repeat(n);

/** Cria uma pessoa minima valida para servir de base aos testes de mutacao. */
function basePerson() {
  const res = createPerson({ id: SELF, canonicalName: 'Base', now: NOW });
  if (!res.ok) throw new Error('fixture invalida');
  return res.value;
}

/** Gera `count` aliases validos distintos. */
function aliases(count: number): PersonAlias[] {
  return Array.from({ length: count }, (_v, i) => ({ value: `alias-${i}` }));
}

/** Gera `count` afastamentos validos distintos. */
function leaves(count: number): LeavePeriod[] {
  return Array.from({ length: count }, (_v, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    start: '2026-01-01',
  }));
}

/** Gera `count` vinculos validos para pessoas de destino distintas e tipos conhecidos. */
function links(count: number): { links: PersonLink[]; known: Set<Uuid> } {
  const known = new Set<Uuid>();
  const out: PersonLink[] = Array.from({ length: count }, (_v, i) => {
    const typeId: Uuid = `00000000-0000-4000-8000-1${String(i).padStart(11, '0')}`;
    known.add(typeId);
    return {
      id: `00000000-0000-4000-8000-2${String(i).padStart(11, '0')}`,
      typeId,
      otherPersonId: `00000000-0000-4000-8000-3${String(i).padStart(11, '0')}`,
      validFrom: '2026-01-01',
    };
  });
  return { links: out, known };
}

describe('agregados do dominio: limites de texto (nome canonico)', () => {
  it('nome com 1 caractere e aceito (borda inferior)', () => {
    const r = createPerson({ id: SELF, canonicalName: repeat(LIMITS.nameMin), now: NOW });
    expect(r.ok).toBe(true);
  });

  it('nome com 120 caracteres e aceito (borda superior)', () => {
    const r = createPerson({ id: SELF, canonicalName: repeat(LIMITS.nameMax), now: NOW });
    expect(r.ok).toBe(true);
  });

  it('nome com 0 caracteres e recusado', () => {
    const r = createPerson({ id: SELF, canonicalName: '', now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('canonical-name-length');
  });

  it('nome com 121 caracteres e recusado (acima da borda)', () => {
    const r = createPerson({ id: SELF, canonicalName: repeat(LIMITS.nameMax + 1), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('canonical-name-length');
  });

  it('departamento aplica os mesmos limites de nome', () => {
    expect(createDepartment({ id: SELF, canonicalName: repeat(1), now: NOW }).ok).toBe(true);
    expect(createDepartment({ id: SELF, canonicalName: repeat(120), now: NOW }).ok).toBe(true);
    expect(createDepartment({ id: SELF, canonicalName: '', now: NOW }).ok).toBe(false);
    expect(createDepartment({ id: SELF, canonicalName: repeat(121), now: NOW }).ok).toBe(false);
  });
});

describe('agregados do dominio: cardinalidade de aliases (20/21)', () => {
  it('20 aliases sao aceitos (borda)', () => {
    const r = createPerson({ id: SELF, canonicalName: 'P', aliases: aliases(20), now: NOW });
    expect(r.ok).toBe(true);
  });

  it('21 aliases sao recusados (acima da borda), preservando nada gravado', () => {
    const r = createPerson({ id: SELF, canonicalName: 'P', aliases: aliases(21), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('alias-count');
  });

  it('alias com 1 e 120 caracteres sao aceitos; 0 e 121 sao recusados', () => {
    const base = 'P';
    expect(
      createPerson({ id: SELF, canonicalName: base, aliases: [{ value: repeat(1) }], now: NOW }).ok,
    ).toBe(true);
    expect(
      createPerson({ id: SELF, canonicalName: base, aliases: [{ value: repeat(120) }], now: NOW })
        .ok,
    ).toBe(true);
    const zero = createPerson({
      id: SELF,
      canonicalName: base,
      aliases: [{ value: '' }],
      now: NOW,
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe('alias-length');
    const over = createPerson({
      id: SELF,
      canonicalName: base,
      aliases: [{ value: repeat(121) }],
      now: NOW,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('alias-length');
  });

  it('addAlias respeita o limite: 20 ok, o 21o falha e preserva o anterior', () => {
    let person = basePerson();
    for (let i = 0; i < 20; i++) {
      const r = addAlias(person, { value: `a-${i}` }, NOW);
      expect(r.ok).toBe(true);
      if (r.ok) person = r.value;
    }
    expect(person.aliases).toHaveLength(20);
    const over = addAlias(person, { value: 'excedente' }, NOW);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('alias-count');
    // O agregado anterior nao foi alterado pela tentativa recusada.
    expect(person.aliases).toHaveLength(20);
  });
});

describe('agregados do dominio: cardinalidade de vinculos (50/51)', () => {
  it('50 vinculos sao aceitos (borda)', () => {
    const { links: l, known } = links(50);
    const r = createPerson({
      id: SELF,
      canonicalName: 'P',
      links: l,
      knownLinkTypeIds: [...known],
      now: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it('51 vinculos sao recusados (acima da borda)', () => {
    const { links: l, known } = links(51);
    const r = createPerson({
      id: SELF,
      canonicalName: 'P',
      links: l,
      knownLinkTypeIds: [...known],
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('link-count');
  });

  it('addLink rejeita self-link, tipo desconhecido e duplicidade, preservando o anterior', () => {
    const person = basePerson();
    const known = new Set<Uuid>([TYPE_A, TYPE_B]);

    const self = addLink(
      person,
      { id: 'l1', typeId: TYPE_A, otherPersonId: SELF, validFrom: '2026-01-01' },
      known,
      NOW,
    );
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error.code).toBe('link-self');

    const unknown = addLink(
      person,
      { id: 'l2', typeId: 'tipo-desconhecido', otherPersonId: OTHER, validFrom: '2026-01-01' },
      known,
      NOW,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('link-unknown-type');

    const first = addLink(
      person,
      { id: 'l3', typeId: TYPE_A, otherPersonId: OTHER, validFrom: '2026-01-01' },
      known,
      NOW,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dup = addLink(
      first.value,
      { id: 'l4', typeId: TYPE_A, otherPersonId: OTHER, validFrom: '2026-01-01' },
      known,
      NOW,
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('link-duplicate');
    // A tentativa recusada nao alterou o vinculo ja presente.
    expect(first.value.links).toHaveLength(1);
  });
});

describe('agregados do dominio: cardinalidade de afastamentos (1000/1001)', () => {
  it('1000 afastamentos sao aceitos (borda)', () => {
    const r = createPerson({ id: SELF, canonicalName: 'P', leaves: leaves(1000), now: NOW });
    expect(r.ok).toBe(true);
  });

  it('1001 afastamentos sao recusados (acima da borda)', () => {
    const r = createPerson({ id: SELF, canonicalName: 'P', leaves: leaves(1001), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('leave-count');
  });

  it('addLeave rejeita data final anterior a inicial, preservando o anterior', () => {
    const person = basePerson();
    const invalid = addLeave(
      person,
      { id: 'lv1', start: '2026-02-10', end: '2026-02-01' },
      NOW,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('leave-range');
    expect(person.leaves).toHaveLength(0);
  });

  it('addLeave aceita data final igual a inicial (intervalo de 1 dia)', () => {
    const person = basePerson();
    const r = addLeave(person, { id: 'lv2', start: '2026-02-01', end: '2026-02-01' }, NOW);
    expect(r.ok).toBe(true);
  });
});

describe('agregados do dominio: telefone E.164 (8/15 digitos e caracteres proibidos)', () => {
  it('telefone com 8 digitos apos "+" e aceito (borda inferior)', () => {
    const r = createPerson({
      id: SELF,
      canonicalName: 'P',
      phoneE164: `+${repeatDigits(8)}`,
      now: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it('telefone com 15 digitos apos "+" e aceito (borda superior)', () => {
    const r = createPerson({
      id: SELF,
      canonicalName: 'P',
      phoneE164: `+${repeatDigits(15)}`,
      now: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it('telefone com 7 e 16 digitos sao recusados (fora das bordas)', () => {
    const short = createPerson({
      id: SELF,
      canonicalName: 'P',
      phoneE164: `+${repeatDigits(7)}`,
      now: NOW,
    });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.code).toBe('phone-format');
    const long = createPerson({
      id: SELF,
      canonicalName: 'P',
      phoneE164: `+${repeatDigits(16)}`,
      now: NOW,
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.code).toBe('phone-format');
  });

  it('telefone sem "+" ou com caracteres proibidos e recusado', () => {
    for (const bad of ['12345678', '+55 11 99999', '+55-1199999999', '+5511abc99999', '++551199999999']) {
      const r = createPerson({ id: SELF, canonicalName: 'P', phoneE164: bad, now: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('phone-format');
    }
  });

  it('setPhone permite remover (undefined) e substituir por um valido', () => {
    const person = basePerson();
    const removed = setPhone(person, undefined, NOW);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.phoneE164).toBeUndefined();
    const set = setPhone(person, `+${repeatDigits(11)}`, NOW);
    expect(set.ok).toBe(true);
    if (set.ok) expect(set.value.phoneE164).toBe(`+${repeatDigits(11)}`);
  });
});

describe('agregados do dominio: predicados de estado e dias da semana', () => {
  it("participation aceita 'active'/'inactive' e recusa outros valores", () => {
    expect(createPerson({ id: SELF, canonicalName: 'P', participation: 'active', now: NOW }).ok).toBe(
      true,
    );
    expect(
      createPerson({ id: SELF, canonicalName: 'P', participation: 'inactive', now: NOW }).ok,
    ).toBe(true);
    const bad = createPerson({
      id: SELF,
      canonicalName: 'P',
      // Valor invalido proposital para exercitar o predicado.
      participation: 'suspenso' as unknown as 'active',
      now: NOW,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('participation-invalid');
  });

  it('deactivatePerson torna o estado inativo preservando o restante', () => {
    const person = basePerson();
    const off = deactivatePerson(person, NOW);
    expect(off.participation).toBe('inactive');
    expect(off.id).toBe(person.id);
    expect(off.canonicalName).toBe(person.canonicalName);
  });

  it('dias da semana: 7 distintos aceitos; 8 (com duplicata) e duplicidade recusados', () => {
    const all: Weekday[] = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];
    const seven = setAllowedWeekdays(basePerson(), all, NOW);
    expect(seven.ok).toBe(true);

    const eight = setAllowedWeekdays(basePerson(), [...all, 'monday'], NOW);
    expect(eight.ok).toBe(false);
    if (!eight.ok) expect(eight.error.code).toBe('weekday-count');

    const dup = setAllowedWeekdays(basePerson(), ['monday', 'monday'], NOW);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('weekday-duplicate');
  });

  it('conjunto vazio de dias da semana e aceito (0 dias)', () => {
    const r = setAllowedWeekdays(basePerson(), [], NOW);
    expect(r.ok).toBe(true);
  });
});

/** Repete o digito '0' seguido de '1's para formar exatamente `n` digitos. */
function repeatDigits(n: number): string {
  return '1'.repeat(n);
}
