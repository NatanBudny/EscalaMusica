// Teste baseado em propriedade — Property 47: Gates de homologacao sao
// necessarios e suficientes (tarefa 14.5).
//
// Property 47 (design.md): "Para todo resultado de migracao, comparacao e teste
// de restauracao, a homologacao e permitida se e somente se nao ha rejeitados,
// pendentes ou divergencias e a restauracao foi concluida com integridade;
// qualquer Bloqueio impede homologacao e preserva o processo atual."
//
// Estrategia: geramos contagens arbitrarias de rejeitados/pendentes/divergencias
// e um booleano de restauracao, e provamos a BICONDICIONAL: `allowed` e
// verdadeiro SE E SOMENTE SE todas as contagens sao zero e a restauracao foi
// verificada (tabela-verdade completa por amostragem).
//
// **Validates: Requirements 16.7, 16.11, 16.12**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  evaluateHomologationGate,
  type ComparisonReport,
  type MigrationReport,
  type RestoreRehearsalResult,
} from './migrationService';

function migrationWith(rejected: number, pending: number): MigrationReport {
  return {
    items: [],
    totals: { imported: 0, transformed: 0, rejected, pending },
    committable: rejected === 0,
  };
}

function comparisonWith(divergence: number): ComparisonReport {
  return { comparisons: [], divergenceCount: divergence, equivalent: divergence === 0 };
}

function restoreWith(verified: boolean): RestoreRehearsalResult {
  return { verified, issues: verified ? [] : ['falha'] };
}

describe('MigrationService — Property 47: gates de homologacao necessarios e suficientes', () => {
  it('allowed <=> (rejeitados==0 && pendentes==0 && divergencias==0 && restauracao ok)', () => {
    // Feature: gestao-leiga-de-escalas, Property 47: Gates de homologação são necessários e suficientes
    fc.assert(
      fc.property(
        fc.nat({ max: 5 }),
        fc.nat({ max: 5 }),
        fc.nat({ max: 5 }),
        fc.boolean(),
        (rejected, pending, divergence, restoreVerified) => {
          const gate = evaluateHomologationGate({
            migration: migrationWith(rejected, pending),
            comparison: comparisonWith(divergence),
            restore: restoreWith(restoreVerified),
          });

          const expected = rejected === 0 && pending === 0 && divergence === 0 && restoreVerified;
          expect(gate.allowed).toBe(expected);

          // Quando bloqueado, ha ao menos um motivo (preserva o processo atual).
          if (!gate.allowed) {
            expect(gate.reasons.length).toBeGreaterThan(0);
          } else {
            expect(gate.reasons).toEqual([]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
