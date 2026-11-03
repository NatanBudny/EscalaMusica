// Testes unitarios do RegistryService (requisitos 3.1-3.15, 11.4, 11.15, 11.16).
//
// Cobrem os casos de borda objetivos definidos no desenho:
//  - limites 20/21 aliases, 50/51 vinculos, 1000/1001 afastamentos;
//  - telefone E.164 com 8/15 digitos (validos) e formatos invalidos;
//  - referencias invalidas e protecao de referencias na exclusao;
//  - unicidade global de identidade;
//  - desativacao preservando passado e restringindo futuro;
//  - autorizacao publica por valor, finalidade e vigencia.

import { describe, expect, it } from 'vitest';

import { RegistryService } from './registry-service';
import { LIMITS } from '../aggregates/people';
import { validateEntity } from '../schemas/validator';
import type { LeavePeriod, PersonAlias, PersonLink, Uuid } from '../schemas/models';

const NOW = '2026-01-15T12:00:00Z';

// UUID v4 deterministico a partir de um inteiro.
const id = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

const phoneDigits = (n: number): string => `+${'9'.repeat(n)}`;

const aliases = (count: number): PersonAlias[] =>
  Array.from({ length: count }, (_, i) => ({ value: `alias-${i}` }));

const leaves = (count: number): LeavePeriod[] =>
  Array.from({ length: count }, (_, i) => ({ id: id(0x10000 + i), start: '2026-01-01' }));

function makePerson(reg: RegistryService, n: number, name: string): Uuid {
  const r = reg.addPerson({ id: id(n), canonicalName: name, now: NOW });
  if (!r.ok) throw new Error(`setup falhou: ${JSON.stringify(r.error)}`);
  return r.value.id;
}

describe('RegistryService: criacao e invariantes de agregado', () => {
  it('cria pessoa valida e o snapshot passa no validador (3.1)', () => {
    const reg = new RegistryService();
    const r = reg.addPerson({ id: id(1), canonicalName: 'Ana Souza', now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const outcome = validateEntity('person', r.value);
      expect(outcome.valid, JSON.stringify(outcome.issues)).toBe(true);
      expect(r.value.id).toBe(id(1));
    }
  });

  it('cria departamento valido (3.5)', () => {
    const reg = new RegistryService();
    const r = reg.addDepartment({ id: id(2), canonicalName: 'Louvor', now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateEntity('department', r.value).valid).toBe(true);
  });

  it('rejeita id duplicado entre sujeitos (pessoa e departamento)', () => {
    const reg = new RegistryService();
    expect(reg.addPerson({ id: id(1), canonicalName: 'Ana', now: NOW }).ok).toBe(true);
    const dup = reg.addDepartment({ id: id(1), canonicalName: 'Equipe', now: NOW });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('duplicate-id');
  });
});

describe('RegistryService: limites de borda (aliases, vinculos, afastamentos)', () => {
  it('aceita 20 aliases e rejeita 21 (3.1)', () => {
    const reg = new RegistryService();
    const okCase = reg.addPerson({
      id: id(1),
      canonicalName: 'Ana',
      aliases: aliases(LIMITS.aliasMax),
      now: NOW,
    });
    expect(okCase.ok).toBe(true);

    const overCase = reg.addPerson({
      id: id(2),
      canonicalName: 'Bia',
      aliases: aliases(LIMITS.aliasMax + 1),
      now: NOW,
    });
    expect(overCase.ok).toBe(false);
    if (!overCase.ok) expect(overCase.error.code).toBe('alias-count');
    // Estado preservado: apenas a pessoa valida existe.
    expect(reg.snapshot().people).toHaveLength(1);
  });

  it('aceita 1000 afastamentos e rejeita 1001 (3.3, 3.14)', () => {
    const reg = new RegistryService();
    const okCase = reg.addPerson({
      id: id(1),
      canonicalName: 'Ana',
      leaves: leaves(LIMITS.leaveMax),
      now: NOW,
    });
    expect(okCase.ok).toBe(true);

    const overCase = reg.addPerson({
      id: id(2),
      canonicalName: 'Bia',
      leaves: leaves(LIMITS.leaveMax + 1),
      now: NOW,
    });
    expect(overCase.ok).toBe(false);
    if (!overCase.ok) expect(overCase.error.code).toBe('leave-count');
  });

  it('aceita 50 vinculos e rejeita 51 (3.4)', () => {
    const reg = new RegistryService();
    // Cria 51 pessoas-alvo distintas + o tipo de vinculo.
    const typeId = id(0x5000);
    const targets: Uuid[] = [];
    for (let i = 0; i < LIMITS.linkMax + 1; i++) {
      targets.push(makePerson(reg, 0x6000 + i, `Alvo ${i}`));
    }
    const mkLinks = (count: number): PersonLink[] =>
      targets.slice(0, count).map((otherPersonId, i) => ({
        id: id(0x7000 + i),
        typeId,
        otherPersonId,
        validFrom: '2026-01-01',
      }));

    const okCase = reg.addPerson({
      id: id(1),
      canonicalName: 'Ana',
      links: mkLinks(LIMITS.linkMax),
      knownLinkTypeIds: [typeId],
      now: NOW,
    });
    expect(okCase.ok).toBe(true);

    const overCase = reg.addPerson({
      id: id(2),
      canonicalName: 'Bia',
      links: mkLinks(LIMITS.linkMax + 1),
      knownLinkTypeIds: [typeId],
      now: NOW,
    });
    expect(overCase.ok).toBe(false);
    if (!overCase.ok) expect(overCase.error.code).toBe('link-count');
  });
});

describe('RegistryService: telefone E.164 (3.8)', () => {
  it('aceita telefones de 8 e 15 digitos', () => {
    const reg = new RegistryService();
    const r8 = reg.addPerson({
      id: id(1),
      canonicalName: 'Ana',
      phoneE164: phoneDigits(LIMITS.phoneMin),
      now: NOW,
    });
    expect(r8.ok).toBe(true);
    const r15 = reg.addPerson({
      id: id(2),
      canonicalName: 'Bia',
      phoneE164: phoneDigits(LIMITS.phoneMax),
      now: NOW,
    });
    expect(r15.ok).toBe(true);
  });

  it('rejeita 7 e 16 digitos e formatos invalidos', () => {
    const reg = new RegistryService();
    for (const [n, phone] of [
      ['a', phoneDigits(LIMITS.phoneMin - 1)],
      ['b', phoneDigits(LIMITS.phoneMax + 1)],
      ['c', '5511999998888'], // sem '+'
      ['d', '+55abc12345'], // caractere invalido
    ] as const) {
      const r = reg.addPerson({
        id: id(n.charCodeAt(0)),
        canonicalName: `P${n}`,
        phoneE164: phone,
        now: NOW,
      });
      expect(r.ok, `telefone ${phone} deveria falhar`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('phone-format');
    }
    expect(reg.snapshot().people).toHaveLength(0);
  });

  it('setPhone preserva o telefone anterior quando o novo e invalido', () => {
    const reg = new RegistryService();
    const pid = makePerson(reg, 1, 'Ana');
    expect(reg.setPhone(pid, phoneDigits(10), NOW).ok).toBe(true);
    const bad = reg.setPhone(pid, '+123', NOW);
    expect(bad.ok).toBe(false);
    expect(reg.getPerson(pid)?.phoneE164).toBe(phoneDigits(10));
  });
});

describe('RegistryService: unicidade global de identidade (3.6, 3.7)', () => {
  it('rejeita alias que coincide (sem caixa) com nome de outro sujeito', () => {
    const reg = new RegistryService();
    makePerson(reg, 1, 'Maria Clara');
    const r = reg.addPerson({
      id: id(2),
      canonicalName: 'Joao',
      aliases: [{ value: '  maria   clara ' }], // normaliza para "maria clara"
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('identity-collision');
      expect(r.error.collisions && r.error.collisions.length).toBeGreaterThan(0);
    }
    // Preserva o cadastro anterior.
    expect(reg.snapshot().people).toHaveLength(1);
  });

  it('rejeita departamento com nome colidindo com pessoa', () => {
    const reg = new RegistryService();
    makePerson(reg, 1, 'Sonoplastia');
    const r = reg.addDepartment({ id: id(2), canonicalName: 'SONOPLASTIA', now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('identity-collision');
  });

  it('addAlias reavalia a unicidade e rejeita colisao', () => {
    const reg = new RegistryService();
    makePerson(reg, 1, 'Pedro');
    const pid = makePerson(reg, 2, 'Paulo');
    const r = reg.addAlias(pid, { value: 'pedro' }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('identity-collision');
    // O agregado nao recebeu o alias.
    expect(reg.getPerson(pid)?.aliases).toHaveLength(0);
  });
});

describe('RegistryService: vinculos com referencia (3.4, 3.15)', () => {
  it('rejeita vinculo para pessoa inexistente (referencia invalida)', () => {
    const reg = new RegistryService();
    const a = makePerson(reg, 1, 'Ana');
    const typeId = id(0x5000);
    const r = reg.addLink(
      a,
      { id: id(0x9000), typeId, otherPersonId: id(0xdead), validFrom: '2026-01-01' },
      new Set([typeId]),
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  it('aceita vinculo valido entre duas pessoas existentes', () => {
    const reg = new RegistryService();
    const a = makePerson(reg, 1, 'Ana');
    const b = makePerson(reg, 2, 'Bia');
    const typeId = id(0x5000);
    const r = reg.addLink(
      a,
      { id: id(0x9000), typeId, otherPersonId: b, validFrom: '2026-01-01' },
      new Set([typeId]),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.links).toHaveLength(1);
  });

  it('rejeita self-link preservando o agregado', () => {
    const reg = new RegistryService();
    const a = makePerson(reg, 1, 'Ana');
    const typeId = id(0x5000);
    const r = reg.addLink(
      a,
      { id: id(0x9000), typeId, otherPersonId: a, validFrom: '2026-01-01' },
      new Set([typeId]),
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('link-self');
    expect(reg.getPerson(a)?.links).toHaveLength(0);
  });
});

describe('RegistryService: desativacao e protecao de referencias (3.9, 3.13)', () => {
  it('desativar preserva vinculos/afastamentos e remove da elegibilidade', () => {
    const reg = new RegistryService();
    const a = makePerson(reg, 1, 'Ana');
    const b = makePerson(reg, 2, 'Bia');
    const typeId = id(0x5000);
    reg.addLink(
      a,
      { id: id(0x9000), typeId, otherPersonId: b, validFrom: '2026-01-01' },
      new Set([typeId]),
      NOW,
    );
    reg.addLeave(a, { id: id(0x9100), start: '2026-02-01' }, NOW);

    expect(reg.isSelectable(a)).toBe(true);
    const r = reg.deactivatePerson(a, NOW);
    expect(r.ok).toBe(true);
    const after = reg.getPerson(a)!;
    expect(after.participation).toBe('inactive');
    expect(after.links).toHaveLength(1); // preservado
    expect(after.leaves).toHaveLength(1); // preservado
    expect(reg.isSelectable(a)).toBe(false);
    expect(reg.selectablePersonIds()).not.toContain(a);
    expect(reg.selectablePersonIds()).toContain(b);
  });

  it('bloqueia exclusao quando a pessoa e referenciada por vinculo de outra', () => {
    const reg = new RegistryService();
    const a = makePerson(reg, 1, 'Ana');
    const b = makePerson(reg, 2, 'Bia');
    const typeId = id(0x5000);
    // Ana referencia Bia.
    reg.addLink(
      a,
      { id: id(0x9000), typeId, otherPersonId: b, validFrom: '2026-01-01' },
      new Set([typeId]),
      NOW,
    );

    const r = reg.deletePerson(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('reference-protected');
    expect(reg.getPerson(b)).toBeDefined(); // preservada
  });

  it('bloqueia exclusao por referencia externa (regras/escalas/historico)', () => {
    const reg = new RegistryService();
    const a = makePerson(reg, 1, 'Ana');
    const r = reg.deletePerson(a, (pid) => pid === a); // referencia externa
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('reference-protected');
    expect(reg.getPerson(a)).toBeDefined();
  });

  it('permite exclusao quando nao ha referencias', () => {
    const reg = new RegistryService();
    const a = makePerson(reg, 1, 'Ana');
    const r = reg.deletePerson(a);
    expect(r.ok).toBe(true);
    expect(reg.getPerson(a)).toBeUndefined();
  });
});

describe('RegistryService: autorizacoes publicas de contato (11.4, 11.15, 11.16)', () => {
  const PHONE_HASH = 'a'.repeat(64);
  const PURPOSE = 'confirmacao-whatsapp';

  function regWithPerson(): { reg: RegistryService; pid: Uuid } {
    const reg = new RegistryService();
    const pid = makePerson(reg, 1, 'Ana');
    return { reg, pid };
  }

  it('registra autorizacao, indexa no agregado e valida o schema (11.4)', () => {
    const { reg, pid } = regWithPerson();
    const r = reg.registerAuthorization({
      id: id(0xa001),
      subjectId: pid,
      field: 'phone',
      valueHash: PHONE_HASH,
      purpose: PURPOSE,
      approvedBy: id(0xbb),
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateEntity('publicAuthorization', r.value).valid).toBe(true);
    expect(reg.getPerson(pid)?.publicContactAuthorizationIds).toContain(id(0xa001));
  });

  it('autoriza somente dentro da vigencia inclusiva (11.15, 11.16)', () => {
    const { reg, pid } = regWithPerson();
    reg.registerAuthorization({
      id: id(0xa001),
      subjectId: pid,
      field: 'phone',
      valueHash: PHONE_HASH,
      purpose: PURPOSE,
      approvedBy: id(0xbb),
      validFrom: '2026-03-01',
      validUntil: '2026-06-30',
      now: NOW,
    });
    const q = (at: string) =>
      reg.isPublicAuthorized({
        subjectId: pid,
        field: 'phone',
        valueHash: PHONE_HASH,
        purpose: PURPOSE,
        at,
      });

    expect(q('2026-02-28')).toBe(false); // antes
    expect(q('2026-03-01')).toBe(true); // borda inicial inclusiva
    expect(q('2026-05-10')).toBe(true); // dentro
    expect(q('2026-06-30')).toBe(true); // borda final inclusiva
    expect(q('2026-07-01')).toBe(false); // depois
  });

  it('nega quando valor, finalidade ou sujeito divergem', () => {
    const { reg, pid } = regWithPerson();
    reg.registerAuthorization({
      id: id(0xa001),
      subjectId: pid,
      field: 'phone',
      valueHash: PHONE_HASH,
      purpose: PURPOSE,
      approvedBy: id(0xbb),
      validFrom: '2026-01-01',
      now: NOW,
    });
    const base = {
      subjectId: pid,
      field: 'phone',
      valueHash: PHONE_HASH,
      purpose: PURPOSE,
      at: '2026-05-01',
    } as const;
    expect(reg.isPublicAuthorized(base)).toBe(true);
    expect(reg.isPublicAuthorized({ ...base, valueHash: 'b'.repeat(64) })).toBe(false); // outro valor
    expect(reg.isPublicAuthorized({ ...base, purpose: 'outra' })).toBe(false); // outra finalidade
    expect(reg.isPublicAuthorized({ ...base, subjectId: id(0xff) })).toBe(false); // outro sujeito
    expect(reg.isPublicAuthorized({ ...base, field: 'alias' })).toBe(false); // outro campo
  });

  it('revogacao impede a autorizacao (11.4)', () => {
    const { reg, pid } = regWithPerson();
    reg.registerAuthorization({
      id: id(0xa001),
      subjectId: pid,
      field: 'phone',
      valueHash: PHONE_HASH,
      purpose: PURPOSE,
      approvedBy: id(0xbb),
      validFrom: '2026-01-01',
      now: NOW,
    });
    const q = () =>
      reg.isPublicAuthorized({
        subjectId: pid,
        field: 'phone',
        valueHash: PHONE_HASH,
        purpose: PURPOSE,
        at: '2026-05-01',
      });
    expect(q()).toBe(true);
    const rev = reg.revokeAuthorization(id(0xa001));
    expect(rev.ok).toBe(true);
    expect(q()).toBe(false);
  });

  it('rejeita autorizacao com vigencia invertida e sujeito inexistente', () => {
    const { reg, pid } = regWithPerson();
    const inverted = reg.registerAuthorization({
      id: id(0xa001),
      subjectId: pid,
      field: 'phone',
      valueHash: PHONE_HASH,
      purpose: PURPOSE,
      approvedBy: id(0xbb),
      validFrom: '2026-12-31',
      validUntil: '2026-01-01',
      now: NOW,
    });
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.error.code).toBe('authorization-range');

    const noSubject = reg.registerAuthorization({
      id: id(0xa002),
      subjectId: id(0xdead),
      field: 'phone',
      valueHash: PHONE_HASH,
      purpose: PURPOSE,
      approvedBy: id(0xbb),
      validFrom: '2026-01-01',
      now: NOW,
    });
    expect(noSubject.ok).toBe(false);
    if (!noSubject.ok) expect(noSubject.error.code).toBe('not-found');
  });

  it('revogar id inexistente falha sem alterar o estado', () => {
    const { reg } = regWithPerson();
    const r = reg.revokeAuthorization(id(0xffff));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('authorization-not-found');
  });
});

describe('RegistryService: snapshot e isolamento', () => {
  it('snapshot retorna copias defensivas (mutacao externa nao afeta o estado)', () => {
    const reg = new RegistryService();
    makePerson(reg, 1, 'Ana');
    const snap = reg.snapshot();
    const first = (snap.people as unknown as { canonicalName: string }[])[0];
    expect(first).toBeDefined();
    first!.canonicalName = 'ALTERADO';
    expect(reg.getPerson(id(1))?.canonicalName).toBe('Ana');
  });

  it('reconstrucao a partir de snapshot preserva os dados', () => {
    const reg = new RegistryService();
    makePerson(reg, 1, 'Ana');
    makePerson(reg, 2, 'Bia');
    const rebuilt = new RegistryService(reg.snapshot());
    expect(rebuilt.snapshot().people).toHaveLength(2);
  });
});
