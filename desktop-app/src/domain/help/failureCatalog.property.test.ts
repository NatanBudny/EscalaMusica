// Feature: gestao-leiga-de-escalas, Property 46: Catalogo de falhas e
// documentacao permanecem sincronizados.
//
// Valida (Requisitos 15.10, 15.16; tarefa 17.5): todo codigo emitivel tem
// EXATAMENTE um procedimento vigente e nao ha procedimento orfao; alem disso, a
// documentacao gerada (markdown) contem cada codigo e cada bloco exigido.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { COMMAND_ERROR_CODES } from '../commands/errors';
import {
  allProcedures,
  codesWithoutProcedure,
  orphanProcedures,
  procedureFor,
  renderFailureCatalogMarkdown,
} from './failureCatalog';

describe('Property 46 — catalogo de falhas sincronizado (15.10, 15.16)', () => {
  it('nenhum codigo emitivel fica sem procedimento', () => {
    expect(codesWithoutProcedure()).toEqual([]);
  });

  it('nenhum procedimento fica orfao', () => {
    expect(orphanProcedures()).toEqual([]);
  });

  it('existe exatamente um procedimento por codigo emitivel', () => {
    const procedures = allProcedures();
    expect(procedures).toHaveLength(COMMAND_ERROR_CODES.length);
    const codes = procedures.map((p) => p.code).sort();
    const unique = [...new Set(codes)];
    expect(codes).toEqual(unique); // sem duplicatas
    expect(unique).toEqual([...COMMAND_ERROR_CODES].sort());
  });

  it('para todo codigo emitivel, ha um procedimento completo (>=100 execucoes)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...COMMAND_ERROR_CODES), (code) => {
        const p = procedureFor(code);
        expect(p).toBeDefined();
        if (!p) return;
        expect(p.symptom.length).toBeGreaterThan(0);
        expect(p.impact.length).toBeGreaterThan(0);
        expect(p.correction.length).toBeGreaterThan(0);
        expect(p.confirmation.length).toBeGreaterThan(0);
        // `preserved` nunca vazio (sempre dizemos o que foi preservado).
        expect(p.preserved.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('a documentacao gerada contem cada codigo e os blocos exigidos', () => {
    const md = renderFailureCatalogMarkdown();
    for (const code of COMMAND_ERROR_CODES) {
      expect(md).toContain(`\`${code}\``);
    }
    expect(md).toMatch(/Sintoma:/);
    expect(md).toMatch(/Preservado:/);
    expect(md).toMatch(/Impacto:/);
    expect(md).toMatch(/Correcao:/);
    expect(md).toMatch(/Confirmacao:/);
  });
});
