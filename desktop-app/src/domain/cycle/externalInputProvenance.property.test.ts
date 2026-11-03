// Feature: gestao-leiga-de-escalas, Property 11: Insumos respeitam tipos, limites e proveniência
//
// Property 11 (design.md): Para todo Insumo_Externo aceito, o tipo do sujeito,
// as cardinalidades e os tamanhos de texto respeitam o schema, observações têm
// exatamente uma classificação pública ou privada e fonte, data/hora e operador
// estão presentes.
//
// Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
//
// Semântica verificada por esta propriedade, para TODA tentativa de registro
// (válida ou inválida) gerada:
//   (A) Aceitação <=> validade total: `register` aceita o insumo se e somente
//       se o valor respeita a forma do seu tipo, as cardinalidades e os
//       comprimentos de borda (4.2-4.6), a observação possui exatamente uma
//       classificação pública/privada (4.7) e a proveniência (fonte, operador,
//       data/hora) está presente (4.8).
//   (B) Sem mutação em falha: toda rejeição preserva o estado anterior do
//       serviço (o snapshot não muda).
//   (C) Proveniência registrada: todo insumo aceito grava fonte, operador e
//       data/hora exatamente como informados (4.8); observação aceita deriva a
//       visibilidade da classificação (4.7).
//
// Estratégia dos geradores: um gerador inteligente constrói, por tipo, um valor
// VÁLIDO (dentro dos limites) e, com probabilidade controlada, injeta UMA
// violação conhecida (cardinalidade fora de 1..20, texto 0/201, observação sem
// classificação, sujeito ausente etc.) e/ou uma proveniência inválida. O
// oráculo de validade (`isFullyValid`) é computado de forma independente do
// serviço, a partir dos mesmos limites públicos, e comparado com a decisão de
// `register`. Testes de propriedade não fazem I/O (funções puras do domínio).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXTERNAL_INPUT_LIMITS,
  ExternalInputService,
  type Provenance,
  type RegisterExternalInput,
} from './externalInputService';
import type { ExternalInput, ExternalInputType } from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath visíveis em falha.
const RUNS = 300;

const L = EXTERNAL_INPUT_LIMITS;

const TYPES: readonly ExternalInputType[] = [
  'elder',
  'preacher',
  'audio',
  'sabbath-school-song',
  'theme',
  'song-request',
  'observation',
];

// --------------------------------------------------------------------------
// Oráculo de validade independente do serviço (espelha Property 11 / 4.2-4.8).
// --------------------------------------------------------------------------

function provenanceValid(p: Provenance | undefined): boolean {
  return (
    p !== undefined &&
    typeof p.source === 'string' &&
    p.source.trim().length > 0 &&
    typeof p.operatorId === 'string' &&
    p.operatorId.length > 0 &&
    typeof p.updatedAt === 'string' &&
    p.updatedAt.length > 0
  );
}

const nonEmptyId = (id: unknown): boolean => typeof id === 'string' && id.length > 0;
const lenOk = (t: unknown, min: number, max: number): boolean =>
  typeof t === 'string' && t.length >= min && t.length <= max;

/** Validade do VALOR conforme o tipo (independente do serviço). */
function valueValid(type: ExternalInputType, value: unknown): boolean {
  switch (type) {
    case 'elder':
      return nonEmptyId((value as { personId?: unknown }).personId);
    case 'preacher': {
      const s = (value as { subject?: { type?: unknown; id?: unknown } }).subject;
      return (
        s !== undefined &&
        (s.type === 'person' || s.type === 'department') &&
        nonEmptyId(s.id)
      );
    }
    case 'audio': {
      const ids = (value as { personIds?: unknown }).personIds;
      if (!Array.isArray(ids)) return false;
      if (ids.length < L.audioMin || ids.length > L.audioMax) return false;
      if (!ids.every(nonEmptyId)) return false;
      return new Set(ids).size === ids.length; // sem duplicidade
    }
    case 'sabbath-school-song':
      return lenOk((value as { title?: unknown }).title, L.textMin, L.textMax);
    case 'theme':
      return lenOk((value as { text?: unknown }).text, L.textMin, L.textMax);
    case 'song-request':
      return lenOk((value as { description?: unknown }).description, L.textMin, L.textMax);
    case 'observation': {
      const v = value as { text?: unknown; classification?: unknown };
      const classOk = v.classification === 'public' || v.classification === 'private';
      return classOk && lenOk(v.text, L.observationMin, L.observationMax);
    }
    default:
      return false;
  }
}

function isFullyValid<T extends ExternalInputType>(input: RegisterExternalInput<T>): boolean {
  return provenanceValid(input.provenance) && valueValid(input.type, input.value);
}

// --------------------------------------------------------------------------
// Geradores inteligentes: valor válido por tipo + injeção de violações.
// --------------------------------------------------------------------------

const idArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `p-${s}`);

/** Texto de comprimento exato (evita variações de code point). */
const textOfLen = (n: number): string => 'x'.repeat(n);

/** Comprimento de texto: bordas válidas (1,200) e inválidas (0,201). */
const textLenArb = (min: number, max: number) =>
  fc.constantFrom(0, min, Math.floor((min + max) / 2), max, max + 1);

/** Observação: comprimentos de borda 0/1/1000/1001. */
const obsLenArb = fc.constantFrom(0, L.observationMin, 500, L.observationMax, L.observationMax + 1);

/** Gera um valor (potencialmente inválido) para o tipo informado. */
function valueArb(type: ExternalInputType): fc.Arbitrary<unknown> {
  switch (type) {
    case 'elder':
      // Id válido ou vazio (violação).
      return fc.oneof(idArb.map((personId) => ({ personId })), fc.constant({ personId: '' }));
    case 'preacher':
      return fc.oneof(
        fc.record({
          subject: fc.record({
            type: fc.constantFrom('person', 'department') as fc.Arbitrary<'person' | 'department'>,
            id: idArb,
          }),
        }),
        // Violação: id vazio.
        fc.constant({ subject: { type: 'person' as const, id: '' } }),
      );
    case 'audio':
      // Cardinalidade 0..21 (0 e 21 violam); às vezes injeta duplicata.
      return fc
        .integer({ min: 0, max: L.audioMax + 1 })
        .chain((n) =>
          fc.record({
            personIds: fc.constant(Array.from({ length: n }, (_, i) => `p-${i}`)),
            dup: fc.boolean(),
          }),
        )
        .map(({ personIds, dup }) =>
          dup && personIds.length >= 2
            ? { personIds: [personIds[0], ...personIds.slice(1, -1), personIds[0]] }
            : { personIds },
        );
    case 'sabbath-school-song':
      return textLenArb(L.textMin, L.textMax).map((n) => ({ title: textOfLen(n) }));
    case 'theme':
      return textLenArb(L.textMin, L.textMax).map((n) => ({ text: textOfLen(n) }));
    case 'song-request':
      return textLenArb(L.textMin, L.textMax).map((n) => ({ description: textOfLen(n) }));
    case 'observation':
      return fc.record({
        text: obsLenArb.map(textOfLen),
        // Inclui `undefined` (sem classificação) como violação de 4.7.
        classification: fc.constantFrom('public', 'private', undefined),
      });
    default:
      return fc.constant({});
  }
}

/** Gera uma proveniência válida ou com exatamente um campo ausente/em branco. */
const provenanceArb: fc.Arbitrary<Provenance> = fc
  .record({
    source: fc.constantFrom('PDF anciaos', 'mensagem do pregador', '', '   '),
    operatorId: fc.constantFrom('op-1', 'op-2', ''),
    updatedAt: fc.constantFrom('2026-02-01T10:00:00Z', ''),
  })
  .map((p) => p as Provenance);

interface GenCase {
  type: ExternalInputType;
  value: unknown;
  provenance: Provenance;
}

const caseArb: fc.Arbitrary<GenCase> = fc
  .constantFrom(...TYPES)
  .chain((type) =>
    fc.record({
      type: fc.constant(type),
      value: valueArb(type),
      provenance: provenanceArb,
    }),
  );

// --------------------------------------------------------------------------
// Propriedade
// --------------------------------------------------------------------------

describe('Property 11: Insumos respeitam tipos, limites e proveniência (4.2-4.8)', () => {
  it('register aceita sse e somente se o insumo e totalmente valido; falha nao muta', () => {
    fc.assert(
      fc.property(caseArb, fc.string({ minLength: 1, maxLength: 6 }), (c, idSuffix) => {
        const svc = new ExternalInputService();
        const before = svc.snapshot();

        const input = {
          id: `i-${idSuffix}`,
          serviceId: 'svc-1',
          type: c.type,
          value: c.value,
          provenance: c.provenance,
        } as RegisterExternalInput<ExternalInputType>;

        const expected = isFullyValid(input);
        const result = svc.register(input);

        // (A) Aceitação <=> validade total.
        expect(result.ok).toBe(expected);

        if (result.ok) {
          // (C) Proveniência registrada exatamente (4.8).
          const saved: ExternalInput = result.value;
          expect(saved.source).toBe(c.provenance.source);
          expect(saved.operatorId).toBe(c.provenance.operatorId);
          expect(saved.updatedAt).toBe(c.provenance.updatedAt);
          expect(saved.type).toBe(c.type);

          // Observação aceita deriva a visibilidade da classificação (4.7);
          // qualquer outro insumo aceito é privado por padrão.
          if (c.type === 'observation') {
            const cls = (c.value as { classification: 'public' | 'private' }).classification;
            expect(saved.visibility).toBe(cls);
          } else {
            expect(saved.visibility).toBe('private');
          }

          // Insumo salvo aparece exatamente uma vez no estado.
          expect(svc.snapshot().inputs).toHaveLength(1);
        } else {
          // (B) Sem mutação em falha: o estado permanece idêntico ao anterior.
          expect(svc.snapshot()).toEqual(before);
          expect(svc.snapshot().inputs).toHaveLength(0);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('observacao exige classificacao publica ou privada antes de salvar (4.7)', () => {
    fc.assert(
      fc.property(
        obsLenArb.map(textOfLen),
        fc.constantFrom('public', 'private', undefined, 'secreta' as unknown as undefined),
        (text, classification) => {
          const svc = new ExternalInputService();
          const input = {
            id: 'obs-1',
            serviceId: 'svc-1',
            type: 'observation' as const,
            value: { text, classification },
            provenance: {
              source: 'conferencia',
              operatorId: 'op-1',
              updatedAt: '2026-02-01T10:00:00Z',
            },
          } as RegisterExternalInput<'observation'>;

          const r = svc.register(input);
          const classOk = classification === 'public' || classification === 'private';
          const lenOk2 = text.length >= L.observationMin && text.length <= L.observationMax;

          expect(r.ok).toBe(classOk && lenOk2);
          if (!r.ok) {
            // Sem classificação válida => erro específico e nenhum insumo salvo.
            if (!classOk) expect(r.error.code).toBe('observation-missing-classification');
            expect(svc.snapshot().inputs).toHaveLength(0);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('nenhum insumo sem proveniencia completa e salvo (4.8)', () => {
    fc.assert(
      fc.property(provenanceArb, (prov) => {
        const svc = new ExternalInputService();
        // Valor sempre válido para isolar a proveniência como única variável.
        const r = svc.register({
          id: 'i-1',
          serviceId: 'svc-1',
          type: 'theme',
          value: { text: 'Gratidao' },
          provenance: prov,
        });
        expect(r.ok).toBe(provenanceValid(prov));
        if (!r.ok) {
          expect(r.error.code).toBe('missing-provenance');
          expect(svc.snapshot().inputs).toHaveLength(0);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
