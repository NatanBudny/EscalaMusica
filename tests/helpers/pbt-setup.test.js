/**
 * Smoke test to verify fast-check + ESM setup works correctly.
 */
import { fc, arbId, arbNome, arbCadastro, pessoaFixa, arbSlot } from './pbt-setup.js';

describe('PBT Setup - Smoke Tests', () => {
  test('fast-check is importable and functional', () => {
    expect(fc).toBeDefined();
    expect(typeof fc.assert).toBe('function');
    expect(typeof fc.property).toBe('function');
  });

  test('arbId generates positive integers', () => {
    fc.assert(
      fc.property(arbId, (id) => {
        return id >= 1 && id <= 9999 && Number.isInteger(id);
      })
    );
  });

  test('arbNome generates non-empty uppercase strings', () => {
    fc.assert(
      fc.property(arbNome, (nome) => {
        return nome.length >= 2 && nome === nome.toUpperCase();
      })
    );
  });

  test('arbCadastro generates valid cadastro structure', () => {
    fc.assert(
      fc.property(arbCadastro(2, 5), (cadastro) => {
        const ids = cadastro.pessoas.map(p => p.id);
        const uniqueIds = new Set(ids);
        // All IDs unique
        if (uniqueIds.size !== ids.length) return false;
        // proximo_id = max(ids) + 1
        if (cadastro.proximo_id !== Math.max(...ids) + 1) return false;
        // All IDs positive
        if (!ids.every(id => id > 0)) return false;
        return true;
      })
    );
  });

  test('pessoaFixa creates valid pessoa with defaults', () => {
    const p = pessoaFixa(1, 'TESTE');
    expect(p.id).toBe(1);
    expect(p.nome).toBe('TESTE');
    expect(p.ativo).toBe(true);
    expect(p.habilitacoes.equipe).toBe(true);
  });

  test('arbSlot generates valid slot values', () => {
    const validSlots = ['regente', 'equipe', 'mm_es', 'mm_culto', 'mm_domingo'];
    fc.assert(
      fc.property(arbSlot, (slot) => {
        return validSlots.includes(slot);
      })
    );
  });
});
