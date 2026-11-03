// Feature: gestao-leiga-de-escalas, Property 9: Desativação preserva o passado e restringe o futuro
//
// Para toda Pessoa_Canonica com qualquer conjunto de referências, desativá-la
// preserva atribuições, vínculos, afastamentos e auditoria existentes e a
// remove de todas as novas seleções elegíveis; exclusão com referências é
// rejeitada sem mutação.
//
// Validates: Requirements 3.9, 3.13

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { RegistryService, type RegistrySnapshot } from './registry-service';
import type { LeavePeriod, PersonLink, Uuid } from '../schemas/models';

const NOW = '2026-01-15T12:00:00Z';
const LATER = '2026-02-20T09:30:00Z';

// --------------------------------------------------------------------------
// Geradores
// --------------------------------------------------------------------------

const id = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

const uuidArb: fc.Arbitrary<Uuid> = fc.integer({ min: 1, max: 0xffffff }).map(id);

// Nomes ASCII com letras e espacos, dentro de 1-120. O trim evita nomes
// compostos somente por espacos e mantem a identidade legivel/unica.
const nameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24, unit: fc.constantFrom(...'abcdefghijklmno ') })
  .map((s) => s.trim())
  .filter((s) => s.length >= 1);

// Lista de pessoas com ids unicos; os nomes podem colidir (a construcao
// descarta os colidentes para manter o cadastro valido).
const peopleArb = fc.uniqueArray(fc.record({ id: uuidArb, canonicalName: nameArb }), {
  selector: (p) => p.id,
  minLength: 2,
  maxLength: 8,
});

const isoDateArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2024-01-01'), max: new Date('2027-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

// Um afastamento valido: fim ausente ou >= inicio.
const leaveArb = (seed: number): fc.Arbitrary<LeavePeriod> =>
  fc
    .tuple(isoDateArb, isoDateArb, fc.boolean())
    .map(([a, b, hasEnd]) => {
      const [start, end] = a <= b ? [a, b] : [b, a];
      return hasEnd
        ? { id: id(0x5000 + seed), start, end }
        : { id: id(0x5000 + seed), start };
    });

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Constroi um cadastro povoado com pessoas, afastamentos e vinculos. */
function buildRegistry(specs: readonly { id: Uuid; canonicalName: string }[]): {
  reg: RegistryService;
  created: Uuid[];
  linkTypeId: Uuid;
} {
  const reg = new RegistryService();
  const created: Uuid[] = [];
  for (const spec of specs) {
    const r = reg.addPerson({ id: spec.id, canonicalName: spec.canonicalName, now: NOW });
    if (r.ok) created.push(r.value.id);
  }
  const linkTypeId = id(0x7777);
  return { reg, created, linkTypeId };
}

// --------------------------------------------------------------------------
// Propriedade — ramo da desativacao (3.9)
// --------------------------------------------------------------------------

describe('Property 9: desativação preserva o passado e restringe o futuro (3.9)', () => {
  it('desativar remove da elegibilidade e nao remove nenhum dado existente', () => {
    fc.assert(
      fc.property(peopleArb, leaveArb(1), leaveArb(2), (specs, leaveA, leaveB) => {
        const { reg, created, linkTypeId } = buildRegistry(specs);
        fc.pre(created.length >= 2);

        const target = created[0] as Uuid;
        const other = created[1] as Uuid;
        const known = new Set<Uuid>([linkTypeId]);

        // Passado do alvo: afastamentos e um vinculo para outra pessoa.
        reg.addLeave(target, leaveA, NOW);
        reg.addLeave(target, leaveB, NOW);
        const link: PersonLink = {
          id: id(0x8001),
          typeId: linkTypeId,
          otherPersonId: other,
          validFrom: '2026-01-01',
        };
        reg.addLink(target, link, known, NOW);

        const before = reg.getPerson(target);
        expect(before).toBeDefined();
        if (!before) return;

        const selectableBefore = reg.selectablePersonIds();
        expect(selectableBefore).toContain(target);
        expect(reg.isSelectable(target)).toBe(true);

        const result = reg.deactivatePerson(target, LATER);
        expect(result.ok).toBe(true);

        const after = reg.getPerson(target);
        expect(after).toBeDefined();
        if (!after) return;

        // Restringe o futuro: deixa de ser elegivel a novas atribuicoes.
        expect(after.participation).toBe('inactive');
        expect(reg.isSelectable(target)).toBe(false);
        expect(reg.selectablePersonIds()).not.toContain(target);

        // Preserva o passado: nada e removido (afastamentos, vinculos,
        // aliases, habilitacoes, dias, autorizacoes). Apenas estado e carimbo
        // de atualizacao mudam.
        expect(after.leaves).toEqual(before.leaves);
        expect(after.links).toEqual(before.links);
        expect(after.aliases).toEqual(before.aliases);
        expect(after.capabilityIds).toEqual(before.capabilityIds);
        expect(after.allowedWeekdays).toEqual(before.allowedWeekdays);
        expect(after.publicContactAuthorizationIds).toEqual(
          before.publicContactAuthorizationIds,
        );
        expect(after.canonicalName).toBe(before.canonicalName);
        expect(after.id).toBe(before.id);
        expect(after.createdAt).toBe(before.createdAt);

        // A desativacao nao afeta outras pessoas do cadastro.
        const otherAfter = reg.getPerson(other);
        expect(otherAfter?.participation).toBe('active');
        expect(reg.selectablePersonIds()).toContain(other);
      }),
      { numRuns: 200 },
    );
  });

  it('desativacao e idempotente quanto a elegibilidade e ao restante do agregado', () => {
    fc.assert(
      fc.property(peopleArb, (specs) => {
        const { reg, created } = buildRegistry(specs);
        fc.pre(created.length >= 1);
        const target = created[0] as Uuid;

        expect(reg.deactivatePerson(target, NOW).ok).toBe(true);
        const once = reg.getPerson(target);
        expect(reg.deactivatePerson(target, LATER).ok).toBe(true);
        const twice = reg.getPerson(target);

        expect(twice?.participation).toBe('inactive');
        expect(reg.isSelectable(target)).toBe(false);
        // Nenhum dado de conteudo muda na segunda desativacao.
        expect(twice?.leaves).toEqual(once?.leaves);
        expect(twice?.links).toEqual(once?.links);
        expect(twice?.aliases).toEqual(once?.aliases);
      }),
      { numRuns: 100 },
    );
  });
});

// --------------------------------------------------------------------------
// Propriedade — ramo da protecao de referencias na exclusao (3.13)
// --------------------------------------------------------------------------

describe('Property 9: exclusão com referências é rejeitada sem mutação (3.13)', () => {
  it('pessoa referenciada por vinculo de outra nao pode ser excluida; o cadastro e preservado', () => {
    fc.assert(
      fc.property(peopleArb, (specs) => {
        const { reg, created, linkTypeId } = buildRegistry(specs);
        fc.pre(created.length >= 2);

        const target = created[0] as Uuid; // sera referenciado
        const referrer = created[1] as Uuid; // referencia o alvo
        const known = new Set<Uuid>([linkTypeId]);

        // `referrer` -> `target`: agora `target` e referenciado.
        const link: PersonLink = {
          id: id(0x9001),
          typeId: linkTypeId,
          otherPersonId: target,
          validFrom: '2026-01-01',
        };
        expect(reg.addLink(referrer, link, known, NOW).ok).toBe(true);

        const before: RegistrySnapshot = reg.snapshot();

        const result = reg.deletePerson(target);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('reference-protected');
        }

        // O agregado inteiro e preservado: a pessoa continua existindo e o
        // snapshot e identico ao anterior a tentativa.
        expect(reg.getPerson(target)).toBeDefined();
        expect(reg.snapshot()).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });

  it('pessoa referenciada por fonte externa nao pode ser excluida; sem mutação', () => {
    fc.assert(
      fc.property(peopleArb, fc.boolean(), (specs, externallyReferenced) => {
        const { reg, created } = buildRegistry(specs);
        fc.pre(created.length >= 1);
        const target = created[0] as Uuid;

        const before = reg.snapshot();
        const result = reg.deletePerson(target, (pid) =>
          externallyReferenced ? pid === target : false,
        );

        if (externallyReferenced) {
          // Referencia externa (regras, escalas, historico) bloqueia a exclusao.
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe('reference-protected');
          expect(reg.getPerson(target)).toBeDefined();
          expect(reg.snapshot()).toEqual(before);
        } else {
          // Sem referencias, a exclusao e permitida e o alvo deixa de existir.
          expect(result.ok).toBe(true);
          expect(reg.getPerson(target)).toBeUndefined();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('exclusão sem referências é permitida, provando que o bloqueio é da referência e não da pessoa', () => {
    fc.assert(
      fc.property(peopleArb, (specs) => {
        const { reg, created } = buildRegistry(specs);
        fc.pre(created.length >= 1);
        // O ultimo id criado nao e referenciado por ninguem.
        const lonely = created[created.length - 1] as Uuid;

        const result = reg.deletePerson(lonely);
        expect(result.ok).toBe(true);
        expect(reg.getPerson(lonely)).toBeUndefined();
        // As demais pessoas permanecem.
        for (const other of created.slice(0, -1)) {
          expect(reg.getPerson(other)).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});
