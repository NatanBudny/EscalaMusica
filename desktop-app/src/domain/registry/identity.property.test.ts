import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  findIdentityCollisions,
  identityKey,
  isIdentityNamespaceUnique,
  tryInsertSubject,
  type IdentitySubject,
} from './index';

// Feature: gestao-leiga-de-escalas, Property 7: Namespace de identidade e globalmente unico
//
// Para todo Cadastro_Central, nenhum nome canonico ou alias normalizado de
// Pessoa_Canonica ou Departamento coincide sem distincao de maiusculas e
// minusculas com outro sujeito; toda tentativa de introduzir colisao falha e
// preserva o cadastro anterior.
//
// Valida: Requisito 3.7

// --------------------------------------------------------------------------
// Geradores
// --------------------------------------------------------------------------

// Fragmentos de nome com variacao de caixa, diacriticos e espacos, para
// exercitar o casefold Unicode e o colapso de espacos.
const nameFragmentArb = fc.oneof(
  fc.constantFrom('Ana', 'João', 'MARIA', 'josé', 'André', 'Dani', 'Louvor', 'Sonoplastia'),
  fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
);

// Nome "sujo": pode conter espacos extras nas extremidades e internos, alem de
// variacao de caixa. A identidade deve ser robusta a isso.
const dirtyNameArb = fc
  .array(nameFragmentArb, { minLength: 1, maxLength: 3 })
  .map((parts) => `  ${parts.join('   ')}  `)
  .filter((s) => s.trim().length > 0);

const kindArb = fc.constantFrom<'person' | 'department'>('person', 'department');

let counter = 0;
function nextId(): string {
  counter += 1;
  return `subject-${counter}`;
}

// Gera um sujeito com nome canonico e ate 3 aliases. Os rotulos podem colidir
// internamente; a construcao do cadastro resolve isso rejeitando duplicatas.
const rawSubjectArb: fc.Arbitrary<IdentitySubject> = fc
  .record({
    kind: kindArb,
    canonicalName: dirtyNameArb,
    aliases: fc.array(dirtyNameArb, { maxLength: 3 }),
  })
  .map(({ kind, canonicalName, aliases }) => ({
    id: nextId(),
    kind,
    canonicalName,
    aliases,
  }));

// Constroi um cadastro livre de colisoes inserindo sujeitos sequencialmente e
// descartando os que colidiriam. Garante a pre-condicao "cadastro valido".
function buildCollisionFreeRegistry(candidates: readonly IdentitySubject[]): IdentitySubject[] {
  let registry: readonly IdentitySubject[] = [];
  for (const candidate of candidates) {
    const result = tryInsertSubject(registry, candidate);
    if (result.ok) {
      registry = result.subjects;
    }
  }
  return [...registry];
}

const registryArb: fc.Arbitrary<IdentitySubject[]> = fc
  .array(rawSubjectArb, { maxLength: 12 })
  .map(buildCollisionFreeRegistry);

// --------------------------------------------------------------------------
// Propriedade
// --------------------------------------------------------------------------

describe('Property 7: namespace de identidade e globalmente unico', () => {
  it('um cadastro construido por insercao nunca contem colisao de identidade', () => {
    fc.assert(
      fc.property(registryArb, (registry) => {
        expect(isIdentityNamespaceUnique(registry)).toBe(true);
        expect(findIdentityCollisions(registry)).toEqual([]);

        // Reforco: verificar diretamente que nao ha duas chaves iguais entre
        // rotulos de sujeitos distintos.
        const keys = new Map<string, string>(); // key -> subjectId
        for (const subject of registry) {
          for (const value of [subject.canonicalName, ...subject.aliases]) {
            const key = identityKey(value);
            const owner = keys.get(key);
            if (owner !== undefined) {
              expect(owner).toBe(subject.id);
            } else {
              keys.set(key, subject.id);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('introduzir uma colisao falha e preserva o cadastro anterior', () => {
    fc.assert(
      fc.property(
        registryArb.filter((r) => r.length > 0),
        kindArb,
        // Qual rotulo existente sera copiado para forcar a colisao.
        fc.nat(),
        // Transformacoes que preservam a identidade (caixa e espacos).
        fc.boolean(),
        fc.boolean(),
        (registry, kind, pick, flipCase, padSpaces) => {
          // Colete todos os rotulos (valores) existentes no cadastro.
          const existingValues: string[] = [];
          for (const subject of registry) {
            existingValues.push(subject.canonicalName, ...subject.aliases);
          }
          const target = existingValues[pick % existingValues.length]!;

          // Produza um valor colidente aplicando transformacoes que a chave
          // de identidade deve ignorar (caixa e espacos nas extremidades).
          let colliding = target;
          if (flipCase) {
            colliding = colliding.toUpperCase();
          }
          if (padSpaces) {
            colliding = `   ${colliding}   `;
          }
          // Garante que o valor realmente colide pela chave, mesmo que as
          // transformacoes acima nao tenham alterado nada.
          expect(identityKey(colliding)).toBe(identityKey(target));

          const before = JSON.stringify(registry);

          const incoming: IdentitySubject = {
            id: 'novo-sujeito',
            kind,
            canonicalName: colliding,
            aliases: [],
          };

          const result = tryInsertSubject(registry, incoming);

          // A insercao deve falhar.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.collisions.length).toBeGreaterThan(0);
            // O cadastro anterior e preservado sem alteracao.
            expect(JSON.stringify(result.subjects)).toBe(before);
          }
          // A colecao original nao foi mutada.
          expect(JSON.stringify(registry)).toBe(before);
        },
      ),
      { numRuns: 200 },
    );
  });
});
