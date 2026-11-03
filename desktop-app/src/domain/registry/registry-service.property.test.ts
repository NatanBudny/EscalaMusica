// Testes baseados em propriedade do RegistryService.
//
// Estas propriedades complementam os testes numerados do desenho (Property 7,
// 8, 9) exercitando as regras de CONJUNTO aplicadas pelo servico sobre muitos
// cadastros gerados: unicidade global de identidade, preservacao de estado em
// falhas, elegibilidade apos desativacao e vigencia das autorizacoes publicas.
//
// Valida (reforco): Requisitos 3.7, 3.9, 11.4, 11.15, 11.16.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { RegistryService } from './registry-service';
import { findIdentityCollisions, type IdentitySubject } from './identity';
import type { Uuid } from '../schemas/models';

const NOW = '2026-01-15T12:00:00Z';

const id = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

const uuidArb: fc.Arbitrary<Uuid> = fc.integer({ min: 1, max: 0xffffff }).map(id);
// Nomes com letras ASCII e espacos, dentro de 1-120; evita colisoes triviais
// de string vazia e mantem a identidade legivel.
const nameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40, unit: fc.constantFrom(...'abcdefghij ') })
  .map((s) => s.trim())
  .filter((s) => s.length >= 1);

interface PersonSpec {
  id: Uuid;
  canonicalName: string;
}

// Lista de pessoas com ids unicos (nomes podem colidir de proposito).
const peopleArb: fc.Arbitrary<PersonSpec[]> = fc.uniqueArray(
  fc.record({ id: uuidArb, canonicalName: nameArb }),
  {
    selector: (p) => p.id,
    maxLength: 12,
  },
);

describe('RegistryService property: unicidade global de identidade (3.7)', () => {
  it('o snapshot aceito nunca contem colisao de identidade', () => {
    fc.assert(
      fc.property(peopleArb, (specs) => {
        const reg = new RegistryService();
        for (const spec of specs) {
          reg.addPerson({ id: spec.id, canonicalName: spec.canonicalName, now: NOW });
        }
        const snap = reg.snapshot();
        const subjects: IdentitySubject[] = snap.people.map((p) => ({
          id: p.id,
          kind: 'person',
          canonicalName: p.canonicalName,
          aliases: p.aliases.map((a) => a.value),
        }));
        expect(findIdentityCollisions(subjects)).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  it('insercoes colidentes falham e preservam o cadastro', () => {
    fc.assert(
      fc.property(nameArb, uuidArb, uuidArb, (name, a, b) => {
        fc.pre(a !== b);
        const reg = new RegistryService();
        expect(reg.addPerson({ id: a, canonicalName: name, now: NOW }).ok).toBe(true);
        const before = reg.snapshot();
        // Mesmo nome em caixa diferente -> colisao.
        const r = reg.addPerson({ id: b, canonicalName: name.toUpperCase(), now: NOW });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe('identity-collision');
        expect(reg.snapshot()).toEqual(before); // sem mutacao
      }),
      { numRuns: 200 },
    );
  });
});

describe('RegistryService property: desativacao (3.9)', () => {
  it('desativar remove da elegibilidade e preserva o restante do agregado', () => {
    fc.assert(
      fc.property(
        peopleArb.filter((xs) => xs.length >= 1),
        (specs) => {
          const reg = new RegistryService();
          const created: Uuid[] = [];
          for (const spec of specs) {
            const r = reg.addPerson({ id: spec.id, canonicalName: spec.canonicalName, now: NOW });
            if (r.ok) created.push(r.value.id);
          }
          fc.pre(created.length >= 1);
          const target = created[0] as Uuid;
          const before = reg.getPerson(target)!;

          const r = reg.deactivatePerson(target, NOW);
          expect(r.ok).toBe(true);
          const after = reg.getPerson(target)!;

          expect(after.participation).toBe('inactive');
          expect(reg.isSelectable(target)).toBe(false);
          expect(reg.selectablePersonIds()).not.toContain(target);
          // Campos nao-estado preservados.
          expect(after.canonicalName).toBe(before.canonicalName);
          expect(after.aliases).toEqual(before.aliases);
          expect(after.links).toEqual(before.links);
          expect(after.leaves).toEqual(before.leaves);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('RegistryService property: autorizacao publica por vigencia (11.15, 11.16)', () => {
  const HASH = 'c'.repeat(64);
  const PURPOSE = 'contato-publico';
  const isoArb = fc
    .date({ min: new Date('2024-01-01'), max: new Date('2027-12-31'), noInvalidDate: true })
    .map((d) => d.toISOString().slice(0, 10));

  it('autoriza se e somente se o instante esta na vigencia inclusiva e ativa', () => {
    fc.assert(
      fc.property(isoArb, isoArb, isoArb, (d1, d2, at) => {
        const [from, until] = d1 <= d2 ? [d1, d2] : [d2, d1];
        const reg = new RegistryService();
        const pid = id(1);
        reg.addPerson({ id: pid, canonicalName: 'Ana', now: NOW });
        reg.registerAuthorization({
          id: id(0xa001),
          subjectId: pid,
          field: 'phone',
          valueHash: HASH,
          purpose: PURPOSE,
          approvedBy: id(0xbb),
          validFrom: from,
          validUntil: until,
          now: NOW,
        });

        const authorized = reg.isPublicAuthorized({
          subjectId: pid,
          field: 'phone',
          valueHash: HASH,
          purpose: PURPOSE,
          at,
        });
        const expected = at >= from && at <= until;
        expect(authorized).toBe(expected);
      }),
      { numRuns: 300 },
    );
  });

  it('autorizacao revogada nunca autoriza, independentemente do instante', () => {
    fc.assert(
      fc.property(isoArb, (at) => {
        const reg = new RegistryService();
        const pid = id(1);
        reg.addPerson({ id: pid, canonicalName: 'Ana', now: NOW });
        reg.registerAuthorization({
          id: id(0xa001),
          subjectId: pid,
          field: 'phone',
          valueHash: HASH,
          purpose: PURPOSE,
          approvedBy: id(0xbb),
          validFrom: '2020-01-01',
          validUntil: '2030-12-31',
          now: NOW,
        });
        reg.revokeAuthorization(id(0xa001));
        expect(
          reg.isPublicAuthorized({
            subjectId: pid,
            field: 'phone',
            valueHash: HASH,
            purpose: PURPOSE,
            at,
          }),
        ).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
