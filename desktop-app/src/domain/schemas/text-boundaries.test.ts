// Suite de testes unitarios por borda dos LIMITES DE TEXTO do dominio puro
// (Tarefa 2.8), dirigida pela validacao de schema (sem I/O).
//
// Cobre as bordas obrigatorias do desenho (design.md, "Exemplos e bordas
// obrigatorios"):
//   - 1/500/501 caracteres -> campo `reason` do afastamento (maxLength 500);
//   - 1/1000/1001 caracteres -> campo `justification` da excecao aprovada
//     (minLength 1, maxLength 1000).
//
// A validacao e pura: `validateEntity` NUNCA modifica a entrada. Cada caso
// confirma o resultado esperado (aceito nas bordas inferior/limite, recusado
// acima do limite) sem qualquer efeito colateral.

import { describe, expect, it } from 'vitest';

import { validFixtures } from './fixtures';
import type { CanonicalEntityName } from './models';
import { validateEntity } from './validator';

/** String de comprimento exato `n` (caractere ASCII simples). */
const text = (n: number): string => 'x'.repeat(n);

/** Clona profundamente uma fixture valida para edicao sem afetar a original. */
function validEntityClone(name: CanonicalEntityName): unknown {
  return structuredClone(validFixtures[name]);
}

describe('limites de texto (bordas 1/500/501): reason do afastamento', () => {
  function personWithLeaveReason(len: number): unknown {
    const person = validEntityClone('person') as { leaves: Array<Record<string, unknown>> };
    person.leaves = [{ id: '11111111-1111-4111-8111-111111111111', start: '2026-02-01', reason: text(len) }];
    return person;
  }

  it('1 caractere e aceito (borda inferior)', () => {
    const out = validateEntity('person', personWithLeaveReason(1));
    expect(out.valid).toBe(true);
  });

  it('500 caracteres sao aceitos (borda superior)', () => {
    const out = validateEntity('person', personWithLeaveReason(500));
    expect(out.valid).toBe(true);
  });

  it('501 caracteres sao recusados (acima da borda), sem mutacao da entrada', () => {
    const input = personWithLeaveReason(501) as { leaves: Array<{ reason: string }> };
    const before = input.leaves[0]!.reason;
    const out = validateEntity('person', input);
    expect(out.valid).toBe(false);
    // Entrada preservada (pureza do validador).
    expect(input.leaves[0]!.reason).toBe(before);
    expect(input.leaves[0]!.reason).toHaveLength(501);
  });
});

describe('limites de texto (bordas 1/1000/1001): justification da excecao', () => {
  function exceptionWithJustification(len: number): unknown {
    const ex = validEntityClone('approvedException') as Record<string, unknown>;
    ex.justification = text(len);
    return ex;
  }

  it('1 caractere e aceito (borda inferior)', () => {
    const out = validateEntity('approvedException', exceptionWithJustification(1));
    expect(out.valid).toBe(true);
  });

  it('1000 caracteres sao aceitos (borda superior)', () => {
    const out = validateEntity('approvedException', exceptionWithJustification(1000));
    expect(out.valid).toBe(true);
  });

  it('0 caractere e recusado (abaixo da borda inferior)', () => {
    const out = validateEntity('approvedException', exceptionWithJustification(0));
    expect(out.valid).toBe(false);
  });

  it('1001 caracteres sao recusados (acima da borda), sem mutacao da entrada', () => {
    const input = exceptionWithJustification(1001) as { justification: string };
    const before = input.justification;
    const out = validateEntity('approvedException', input);
    expect(out.valid).toBe(false);
    expect(input.justification).toBe(before);
    expect(input.justification).toHaveLength(1001);
  });
});
