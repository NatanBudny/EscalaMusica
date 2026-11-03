// Teste baseado em propriedade — Property 34: Formatos suportados preservam
// round-trip (tarefa 9.7).
//
// Property 34 (tasks.md 9.7): "Formatos suportados preservam round-trip."
// Formaliza os Requisitos 9.9, 9.10 e 16.4:
//
//   9.9  — exportar o estado da gestao em formato DOCUMENTADO e VERSIONADO que
//          possa ser reimportado reconstruindo TODAS as entidades, valores e
//          associacoes sem acrescimos, perdas ou alteracoes.
//   9.10 — um ciclo exportar -> importar -> exportar SEM edicao produz os
//          MESMOS BYTES, salvo os metadados de geracao declarados como
//          variaveis (metadata.generatedAt, metadata.exporterVersion).
//   16.4 — os formatos portaveis sao reimportaveis entre instalacoes
//          compativeis preservando o conteudo.
//
// Para TODO conjunto de entidades valido e coerente (integridade referencial
// intacta) e para QUAISQUER metadados de geracao, esta propriedade prova:
//
//   (A) Reimportacao bem-sucedida (9.9): importPortable aceita o documento
//       exportado e reconstroi exatamente as mesmas entidades por categoria.
//   (B) Invariancia a metadados variaveis (9.10): a segunda exportacao, feita
//       com generatedAt/exporterVersion DIFERENTES, reproduz os mesmos bytes
//       ESTAVEIS da primeira (mesmo stableSha256), enquanto os bytes do
//       documento COMPLETO mudam quando os metadados mudam.
//   (C) Idempotencia de bytes estaveis (9.10/16.4): export -> import -> export
//       preserva stableBytes byte a byte; roundTrip() reporta preserved=true.
//   (D) Fidelidade da serializacao (16.4): o documento serializado em texto
//       canonico e re-parseado reimporta para as mesmas entidades (nao ha
//       perda ao atravessar a fronteira de texto, como entre instalacoes).
//
// Gera conjuntos COERENTES selecionando categorias inteiras do conjunto base
// (validEntitySet + auditoria), de modo que a integridade referencial nunca
// seja quebrada por construcao. Isso cobre desde o conjunto vazio ate o
// conjunto completo, exercitando todas as categorias documentadas.
//
// **Validates: Requirements 9.9, 9.10, 16.4**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validFixtures, validEntitySet } from '../schemas/fixtures';
import {
  exportPortable,
  importPortable,
  portableStringify,
  roundTrip,
  type PortableEntities,
} from './portableFormat';

// --------------------------------------------------------------------------
// Categorias e dependencias referenciais
// --------------------------------------------------------------------------
//
// Para manter a integridade referencial sob selecao de subconjuntos, tratamos
// o conjunto coerente como blocos que so podem ser incluidos JUNTOS. O
// validEntitySet e internamente coerente; selecionar "tudo ou nada" por bloco
// evita referencias quebradas (ex.: um culto exige seu ciclo; uma excecao
// exige sua regra fundamental; a pessoa exige a autorizacao publica que
// referencia).

/** Valores coerentes de cada categoria, derivados do conjunto base. */
const BASE = {
  people: validEntitySet.people ?? [],
  departments: validEntitySet.departments ?? [],
  publicAuthorizations: validEntitySet.publicAuthorizations ?? [],
  ruleSets: validEntitySet.ruleSets ?? [],
  exceptions: validEntitySet.exceptions ?? [],
  cycles: validEntitySet.cycles ?? [],
  services: validEntitySet.services ?? [],
  drafts: validEntitySet.drafts ?? [],
  externalInputs: validEntitySet.externalInputs ?? [],
  unavailabilities: validEntitySet.unavailabilities ?? [],
  auditEvents: [validFixtures.auditEvent],
} as const satisfies Required<PortableEntities>;

/**
 * Monta um conjunto COERENTE a partir de flags por bloco. Os blocos respeitam
 * as dependencias referenciais do validEntitySet:
 *   - registry  : pessoas + departamentos + autorizacoes publicas (as pessoas
 *                 referenciam capacidades/autorizacoes; mantidos juntos).
 *   - rules     : ruleSets + exceptions (a excecao referencia a regra).
 *   - cycle     : ciclos + cultos + insumos + indisponibilidades + rascunhos
 *                 (todos pendem do ciclo/culto). Requer registry por causa dos
 *                 sujeitos referenciados (pessoa) — por isso cycle implica
 *                 registry no gerador.
 *   - audit     : eventos de auditoria (sem integridade referencial cruzada no
 *                 conjunto; validados isoladamente).
 */
interface BlockFlags {
  readonly registry: boolean;
  readonly rules: boolean;
  readonly cycle: boolean;
  readonly audit: boolean;
}

function buildEntities(flags: BlockFlags): PortableEntities {
  // cycle depende de registry (sujeitos pessoa) e de rules (ruleSetVersionId do
  // ciclo aponta para o ruleSet). Forcamos essas implicacoes para garantir
  // coerencia referencial por construcao.
  const registry = flags.registry || flags.cycle;
  const rules = flags.rules || flags.cycle;
  const cycle = flags.cycle;

  return {
    people: registry ? [...BASE.people] : [],
    departments: registry ? [...BASE.departments] : [],
    publicAuthorizations: registry ? [...BASE.publicAuthorizations] : [],
    ruleSets: rules ? [...BASE.ruleSets] : [],
    exceptions: rules ? [...BASE.exceptions] : [],
    cycles: cycle ? [...BASE.cycles] : [],
    services: cycle ? [...BASE.services] : [],
    drafts: cycle ? [...BASE.drafts] : [],
    externalInputs: cycle ? [...BASE.externalInputs] : [],
    unavailabilities: cycle ? [...BASE.unavailabilities] : [],
    auditEvents: flags.audit ? [...BASE.auditEvents] : [],
  };
}

// --------------------------------------------------------------------------
// Geradores
// --------------------------------------------------------------------------

const blockFlagsArb: fc.Arbitrary<BlockFlags> = fc.record({
  registry: fc.boolean(),
  rules: fc.boolean(),
  cycle: fc.boolean(),
  audit: fc.boolean(),
});

/** Instante RFC 3339 UTC valido e deterministico (metadado variavel). */
const generatedAtArb = fc
  .tuple(
    fc.integer({ min: 1970, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(([y, mo, d, h, mi, s]) => {
    const p = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}Z`;
  });

/** Versao do exportador variavel (metadado variavel). */
const exporterVersionArb = fc.stringMatching(/^[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}$/);

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

function entitiesEqual(a: PortableEntities, b: Required<PortableEntities>): void {
  expect(b.people).toEqual([...(a.people ?? [])]);
  expect(b.departments).toEqual([...(a.departments ?? [])]);
  expect(b.publicAuthorizations).toEqual([...(a.publicAuthorizations ?? [])]);
  expect(b.ruleSets).toEqual([...(a.ruleSets ?? [])]);
  expect(b.exceptions).toEqual([...(a.exceptions ?? [])]);
  expect(b.cycles).toEqual([...(a.cycles ?? [])]);
  expect(b.services).toEqual([...(a.services ?? [])]);
  expect(b.drafts).toEqual([...(a.drafts ?? [])]);
  expect(b.externalInputs).toEqual([...(a.externalInputs ?? [])]);
  expect(b.unavailabilities).toEqual([...(a.unavailabilities ?? [])]);
  expect(b.auditEvents).toEqual([...(a.auditEvents ?? [])]);
}

// --------------------------------------------------------------------------
// Property 34
// --------------------------------------------------------------------------

describe('portableFormat — Property 34: formatos suportados preservam round-trip', () => {
  it('export -> import -> export preserva entidades e bytes estaveis, ignorando metadados variaveis', () => {
    // Feature: gestao-leiga-de-escalas, Property 34: Formatos suportados preservam round-trip
    fc.assert(
      fc.property(
        blockFlagsArb,
        generatedAtArb,
        exporterVersionArb,
        generatedAtArb,
        exporterVersionArb,
        (flags, gen1, exp1, gen2, exp2) => {
          const entities = buildEntities(flags);

          // 1a exportacao com os primeiros metadados.
          const first = exportPortable(entities, {
            generatedAt: gen1,
            exporterVersion: exp1,
          });

          // (A) Reimportacao bem-sucedida reconstruindo as mesmas entidades (9.9).
          const imported = importPortable(first.document);
          expect(imported.ok).toBe(true);
          if (!imported.ok) return;
          entitiesEqual(entities, imported.entities);
          expect(imported.metadata.generatedAt).toBe(gen1);
          expect(imported.metadata.exporterVersion).toBe(exp1);

          // 2a exportacao SEM edicao, mas com metadados DIFERENTES.
          const second = exportPortable(imported.entities, {
            generatedAt: gen2,
            exporterVersion: exp2,
          });

          // (B)/(C) Bytes estaveis identicos mesmo com metadados distintos (9.10, 16.4).
          expect(second.stableSha256).toBe(first.stableSha256);
          expect([...second.stableBytes]).toEqual([...first.stableBytes]);

          // Quando ao menos um metadado varia, os bytes do documento COMPLETO
          // diferem; quando ambos coincidem, os bytes completos sao iguais.
          const metadataDiffers = gen1 !== gen2 || exp1 !== exp2;
          if (metadataDiffers) {
            expect(second.sha256).not.toBe(first.sha256);
          } else {
            expect(second.sha256).toBe(first.sha256);
          }

          // (C) O helper roundTrip concorda com a verificacao manual.
          const outcome = roundTrip(entities, { generatedAt: gen1, exporterVersion: exp1 });
          expect(outcome.reimportOk).toBe(true);
          expect(outcome.stableBytesEqual).toBe(true);
          expect(outcome.preserved).toBe(true);
          expect(outcome.issues).toEqual([]);

          // (D) Fidelidade atraves da fronteira de TEXTO (entre instalacoes):
          // serializar em texto canonico, re-parsear e reimportar preserva tudo.
          const reparsed: unknown = JSON.parse(portableStringify(first.document));
          const importedFromText = importPortable(reparsed);
          expect(importedFromText.ok).toBe(true);
          if (!importedFromText.ok) return;
          entitiesEqual(entities, importedFromText.entities);
        },
      ),
      { numRuns: 200, verbose: true },
    );
  });

  it('determinismo: a mesma entrada e os mesmos metadados produzem os mesmos bytes completos', () => {
    // Feature: gestao-leiga-de-escalas, Property 34: Formatos suportados preservam round-trip
    fc.assert(
      fc.property(blockFlagsArb, generatedAtArb, exporterVersionArb, (flags, gen, exp) => {
        const entities = buildEntities(flags);
        const a = exportPortable(entities, { generatedAt: gen, exporterVersion: exp });
        const b = exportPortable(entities, { generatedAt: gen, exporterVersion: exp });
        expect(b.sha256).toBe(a.sha256);
        expect([...b.bytes]).toEqual([...a.bytes]);
      }),
      { numRuns: 100 },
    );
  });
});
