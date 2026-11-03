// Feature: gestao-leiga-de-escalas, Property 13: Importação nunca resolve identidade ambígua
//
// Property 13 (design.md): Para todo item importado cujo nome tenha
// cardinalidade de correspondência diferente de um, o item permanece pendente,
// nenhuma associação é criada ou escolhida e o estado anterior permanece
// inalterado; somente uma decisão explícita pode resolver múltiplas
// correspondências.
//
// Validates: Requirements 4.12, 4.13, 9.14
//
// Semântica verificada por esta propriedade, para TODO lote de importação
// gerado contra um cadastro arbitrário de sujeitos de identidade:
//   (A) Cardinalidade decide a classificação — SEM fuzzy (4.12, 4.13, 9.14):
//       cada item de origem é resolvido por `resolveIdentityMatches`
//       (comparação EXATA por chave de identidade). O número de candidatos
//       distintos encontrados determina a classificação do item:
//         - exatamente 1 candidato -> `imported`/`transformed` (associado);
//         - 0 candidatos           -> `pending`, candidatos vazios;
//         - 2+ candidatos          -> `pending`, candidatos expostos sem
//                                     escolher nenhum.
//   (B) Nunca resolve ambíguo: nenhum item com cardinalidade != 1 recebe
//       classificação de associação (`imported`/`transformed`); e nenhum item
//       pendente fixa uma associação única (`candidateSubjectIds` nunca tem
//       tamanho 1 quando o item é `pending`). `neverResolvesAmbiguous` deve ser
//       verdadeiro para todo relatório aplicado.
//   (C) Correspondência é exata por identidade, nunca aproximada: o conjunto de
//       candidatos de um item é EXATAMENTE o conjunto de sujeitos cuja chave de
//       identidade (`trim + colapso de espaços + casefold`) coincide com a do
//       nome de origem. Nomes "próximos" (uma letra a mais/menos, acento
//       diferente) que não produzem a MESMA chave jamais correspondem.
//   (D) Pureza: a importação não muta `batch` nem `subjects` (o estado anterior
//       permanece inalterado — exigência literal de 4.13/Property 13).
//
// Estratégia dos geradores: um gerador inteligente constrói um cadastro de
// sujeitos (pessoas/departamentos) a partir de um pequeno alfabeto de nomes
// base, controlando deliberadamente a multiplicidade de cada chave (0, 1 ou
// vários sujeitos com o mesmo nome) para exercitar os três regimes de
// cardinalidade. Os nomes de origem são escolhidos entre: (i) um nome base
// existente com variações que preservam a chave (espaços/caixa), (ii) um nome
// base com perturbação que QUEBRA a chave (sufixo, troca de acento) e (iii) um
// nome totalmente ausente. Testes de propriedade não fazem I/O (funções puras).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  neverResolvesAmbiguous,
  resolveIdentityMatches,
  runImportPipeline,
  type ImportBatch,
  type ImportRecord,
} from './importPipeline';
import { identityKey } from '../registry/identity';
import type { IdentitySubject } from '../registry/identity';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath visíveis em falha.
const RUNS = 300;

// --------------------------------------------------------------------------
// Alfabeto de nomes base e geradores inteligentes.
// --------------------------------------------------------------------------

// Nomes base com chaves de identidade DISTINTAS entre si (nenhum colide com
// outro após trim+colapso+casefold). Inclui diacríticos para exercitar o
// casefold Unicode.
const BASE_NAMES = ['André', 'Dani', 'Ana', 'Louvor', 'Beto', 'Carla', 'Diác'] as const;

// Garante, em tempo de carga, que os nomes base têm chaves distintas — caso
// contrário o gerador de multiplicidade por nome não teria o significado
// pretendido.
{
  const keys = BASE_NAMES.map((n) => identityKey(n));
  const distinct = new Set(keys);
  if (distinct.size !== keys.length) {
    throw new Error('BASE_NAMES devem ter chaves de identidade distintas');
  }
}

/** Reveste um nome com variações que PRESERVAM a chave (espaços/caixa). */
function sameKeyVariant(name: string, mode: number): string {
  switch (mode % 4) {
    case 0:
      return name; // idêntico
    case 1:
      return `  ${name}  `; // espaços nas extremidades
    case 2:
      return name.toUpperCase(); // caixa alta
    default:
      return name.replace(/ /g, '   '); // espaços internos colapsáveis
  }
}

/** Perturba um nome QUEBRANDO a chave (nunca deve corresponder). */
function brokenKeyVariant(name: string, mode: number): string {
  switch (mode % 3) {
    case 0:
      return `${name}X`; // sufixo extra
    case 1:
      return name.slice(0, Math.max(1, name.length - 1)); // uma letra a menos
    default:
      return `${name}-${name}`; // duplicação com hífen
  }
}

// Sujeito de identidade: id estável, tipo e um nome base (sem aliases para
// manter a multiplicidade controlada exclusivamente por nome canônico).
interface SubjectSpec {
  readonly baseIndex: number;
  readonly kind: 'person' | 'department';
}

const subjectSpecArb: fc.Arbitrary<SubjectSpec> = fc.record({
  baseIndex: fc.integer({ min: 0, max: BASE_NAMES.length - 1 }),
  kind: fc.constantFrom('person', 'department') as fc.Arbitrary<'person' | 'department'>,
});

/** Constrói o cadastro de sujeitos com ids únicos e estáveis. */
function buildSubjects(specs: readonly SubjectSpec[]): IdentitySubject[] {
  return specs.map((spec, i) => ({
    id: `s-${i}`,
    kind: spec.kind,
    canonicalName: BASE_NAMES[spec.baseIndex]!,
    aliases: [],
  }));
}

// Descreve como gerar o nome de origem de um registro.
type NameMode =
  | { kind: 'sameKey'; baseIndex: number; variant: number }
  | { kind: 'brokenKey'; baseIndex: number; variant: number }
  | { kind: 'absent'; token: string };

const nameModeArb: fc.Arbitrary<NameMode> = fc.oneof(
  fc.record({
    kind: fc.constant('sameKey' as const),
    baseIndex: fc.integer({ min: 0, max: BASE_NAMES.length - 1 }),
    variant: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    kind: fc.constant('brokenKey' as const),
    baseIndex: fc.integer({ min: 0, max: BASE_NAMES.length - 1 }),
    variant: fc.integer({ min: 0, max: 2 }),
  }),
  fc.record({
    kind: fc.constant('absent' as const),
    // Token que não é prefixo/variação de nenhum nome base.
    token: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `zz-${s}-qq`),
  }),
);

function renderName(mode: NameMode): string {
  switch (mode.kind) {
    case 'sameKey':
      return sameKeyVariant(BASE_NAMES[mode.baseIndex]!, mode.variant);
    case 'brokenKey':
      return brokenKeyVariant(BASE_NAMES[mode.baseIndex]!, mode.variant);
    case 'absent':
      return mode.token;
  }
}

// Registro de origem: posição sempre válida (para isolar a resolução de
// identidade da validação de lote), nome derivado do modo gerado.
const recordArb: fc.Arbitrary<{ position: string; mode: NameMode }> = fc.record({
  position: fc.integer({ min: 0, max: 999 }).map((n) => `linha ${n}`),
  mode: nameModeArb,
});

interface Scenario {
  readonly specs: readonly SubjectSpec[];
  readonly records: ReadonlyArray<{ position: string; mode: NameMode }>;
  readonly sourceFile: string;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  specs: fc.array(subjectSpecArb, { minLength: 0, maxLength: 8 }),
  records: fc.array(recordArb, { minLength: 1, maxLength: 10 }),
  sourceFile: fc.constantFrom('lote.json', 'externos.json', 'indisp-2026-02.json'),
});

// --------------------------------------------------------------------------
// Oráculo independente de cardinalidade (espelha identidade EXATA, sem fuzzy).
// --------------------------------------------------------------------------

/** Conta quantos sujeitos têm a MESMA chave de identidade que `name`. */
function expectedCardinality(name: string, subjects: readonly IdentitySubject[]): number {
  const key = identityKey(name);
  const ids = new Set<string>();
  for (const s of subjects) {
    if (identityKey(s.canonicalName) === key) ids.add(s.id);
    for (const alias of s.aliases) if (identityKey(alias) === key) ids.add(s.id);
  }
  return ids.size;
}

// --------------------------------------------------------------------------
// Propriedade
// --------------------------------------------------------------------------

describe('Property 13: Importação nunca resolve identidade ambígua (4.12, 4.13, 9.14)', () => {
  it('cardinalidade != 1 permanece pendente, sem associação; cardinalidade 1 associa (sem fuzzy)', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const subjects = buildSubjects(scenario.specs);

        const records: ImportRecord[] = scenario.records.map((r) => ({
          position: r.position,
          name: renderName(r.mode),
        }));
        const batch: ImportBatch = { sourceFile: scenario.sourceFile, records };

        // (D) Pureza: congela cópias profundas das entradas para detectar mutação.
        const batchBefore = JSON.stringify(batch);
        const subjectsBefore = JSON.stringify(subjects);

        const result = runImportPipeline(batch, subjects);

        // Posições são sempre válidas -> o lote é aplicado (sem rejeição 9.5-9.7).
        expect(result.applied).toBe(true);
        if (!result.applied) return;

        // (B) Nunca resolve ambíguo, em bloco.
        expect(neverResolvesAmbiguous(result)).toBe(true);

        expect(result.items).toHaveLength(records.length);

        result.items.forEach((itemResult, index) => {
          const name = records[index]!.name;

          // (C) Correspondência EXATA por identidade (nunca fuzzy): o conjunto
          // de candidatos do pipeline é exatamente o do resolvedor por chave.
          const resolved = resolveIdentityMatches(name, subjects);
          expect(itemResult.candidateSubjectIds).toEqual(resolved);

          // Oráculo independente de cardinalidade confirma o resolvedor.
          const card = expectedCardinality(name, subjects);
          expect(itemResult.candidateSubjectIds).toHaveLength(card);

          const { classification } = itemResult.item;

          if (card === 1) {
            // (A) Exatamente uma correspondência -> associado (imported/transformed).
            expect(classification === 'imported' || classification === 'transformed').toBe(true);
            // Associação única efetivamente aplicada.
            expect(itemResult.candidateSubjectIds).toHaveLength(1);
          } else {
            // (A)/(B) 0 ou >1 -> pendente; nenhuma associação única escolhida.
            expect(classification).toBe('pending');
            // Pendente NUNCA fixa uma associação única.
            expect(itemResult.candidateSubjectIds).not.toHaveLength(1);
            // Quando ambíguo (>1), as opções ficam expostas para decisão explícita.
            if (card > 1) {
              expect(itemResult.candidateSubjectIds.length).toBeGreaterThanOrEqual(2);
            } else {
              expect(itemResult.candidateSubjectIds).toHaveLength(0);
            }
            // O item pendente nunca é classificado como associado.
            expect(classification).not.toBe('imported');
            expect(classification).not.toBe('transformed');
          }
        });

        // (D) Pureza: nenhuma mutação do estado anterior (4.13/Property 13).
        expect(JSON.stringify(batch)).toBe(batchBefore);
        expect(JSON.stringify(subjects)).toBe(subjectsBefore);
      }),
      { numRuns: RUNS },
    );
  });

  it('nome que QUEBRA a chave nunca corresponde a nenhum sujeito (jamais fuzzy)', () => {
    fc.assert(
      fc.property(
        fc.array(subjectSpecArb, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: BASE_NAMES.length - 1 }),
        fc.integer({ min: 0, max: 2 }),
        (specs, baseIndex, variant) => {
          const subjects = buildSubjects(specs);
          const broken = brokenKeyVariant(BASE_NAMES[baseIndex]!, variant);

          // Pré-condição do gerador: a perturbação realmente quebra a chave.
          // (Se por acaso coincidir com algum nome base, descartamos o caso.)
          fc.pre(identityKey(broken) !== identityKey(BASE_NAMES[baseIndex]!));
          for (const s of subjects) {
            fc.pre(identityKey(s.canonicalName) !== identityKey(broken));
          }

          const result = runImportPipeline(
            { sourceFile: 'lote.json', records: [{ position: 'linha 1', name: broken }] },
            subjects,
          );

          expect(result.applied).toBe(true);
          if (!result.applied) return;

          const item = result.items[0]!;
          // Sem correspondência exata -> pendente, candidatos vazios.
          expect(item.candidateSubjectIds).toEqual([]);
          expect(item.item.classification).toBe('pending');
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('nome ambíguo (>=2 sujeitos homônimos) nunca é auto-resolvido; expoe as opcoes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: BASE_NAMES.length - 1 }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (baseIndex, copies, variant) => {
          // Monta `copies` sujeitos distintos com o MESMO nome base (homônimos).
          const subjects: IdentitySubject[] = Array.from({ length: copies }, (_, i) => ({
            id: `dup-${i}`,
            kind: 'person' as const,
            canonicalName: BASE_NAMES[baseIndex]!,
            aliases: [],
          }));
          const sourceName = sameKeyVariant(BASE_NAMES[baseIndex]!, variant);

          const result = runImportPipeline(
            { sourceFile: 'lote.json', records: [{ position: 'linha 1', name: sourceName }] },
            subjects,
          );

          expect(result.applied).toBe(true);
          if (!result.applied) return;

          const item = result.items[0]!;
          // Permanece pendente: nenhuma das opções é escolhida.
          expect(item.item.classification).toBe('pending');
          // Todas as opções homônimas ficam expostas para decisão explícita.
          expect(item.candidateSubjectIds).toHaveLength(copies);
          expect(new Set(item.candidateSubjectIds).size).toBe(copies);
          expect(neverResolvesAmbiguous(result)).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
