/**
 * Property-Based Testing (PBT) helpers for EscalaMusica.
 * Exports common fast-check arbitraries for Pessoa, cadastro structures,
 * and utility functions used across PBT tests.
 */

import fc from 'fast-check';

// --- Arbitraries for basic fields ---

/** Arbitrary for valid person ID (positive integer) */
export const arbId = fc.integer({ min: 1, max: 9999 });

/** Arbitrary for canonical name (UPPER, non-empty, no special chars) */
export const arbNome = fc.string({ minLength: 2, maxLength: 20, unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ '.split('')) })
  .map(s => s.trim().replace(/\s+/g, ' '))
  .filter(s => s.length >= 2);

/** Arbitrary for gender */
export const arbGenero = fc.constantFrom('M', 'F');

/** Arbitrary for perfil_canto */
export const arbPerfilCanto = fc.constantFrom('base', 'participacao', null);

/** Arbitrary for phone (digits only, 10-13 chars, or empty string) */
export const arbTelefone = fc.oneof(
  fc.string({ minLength: 10, maxLength: 13, unit: fc.constantFrom(...'0123456789'.split('')) }),
  fc.constant('')
);

/** Arbitrary for dias_permitidos */
export const arbDiasPermitidos = fc.oneof(
  fc.constant(null),
  fc.subarray(['sabado', 'domingo'], { minLength: 1 })
);

// --- Arbitraries for nested structures ---

/** Arbitrary for habilitacoes.mensagem_musical */
export const arbMensagemMusical = fc.record({
  es: fc.boolean(),
  culto: fc.boolean(),
  domingo: fc.boolean(),
});

/** Arbitrary for habilitacoes */
export const arbHabilitacoes = fc.record({
  regente: fc.boolean(),
  equipe: fc.boolean(),
  mensagem_musical: arbMensagemMusical,
});

/** Arbitrary for afastamento (null or active object) */
export const arbAfastado = fc.oneof(
  fc.constant(null),
  fc.record({
    ativo: fc.boolean(),
    ate: fc.oneof(fc.constant(null), fc.constant('2026-12-31')),
    motivo: fc.constantFrom('solicitacao pessoal', 'viagem', 'saude', 'mudanca'),
  })
);

// --- Arbitrary for a full Pessoa ---

/**
 * Generates a single Pessoa object with the given id and nome.
 * Uses default values for other fields with randomization.
 */
export function arbPessoaWith(id, nome) {
  return fc.record({
    id: fc.constant(id),
    nome: fc.constant(nome),
    aliases: fc.constant([]),
    telefone: arbTelefone,
    genero: arbGenero,
    ativo: fc.boolean(),
    perfil_canto: arbPerfilCanto,
    notas: fc.constant(''),
    habilitacoes: arbHabilitacoes,
    afastado: arbAfastado,
    vinculos: fc.constant([]),
    dias_permitidos: arbDiasPermitidos,
  });
}

/**
 * Generates a minimal valid Pessoa with explicit id/nome and sensible defaults.
 */
export function pessoaFixa(id, nome, overrides = {}) {
  return {
    id,
    nome,
    aliases: [],
    telefone: '',
    genero: 'M',
    ativo: true,
    perfil_canto: 'base',
    notas: '',
    habilitacoes: {
      regente: false,
      equipe: true,
      mensagem_musical: { es: false, culto: false, domingo: false },
    },
    afastado: null,
    vinculos: [],
    dias_permitidos: null,
    ...overrides,
  };
}

/**
 * Generates a valid pessoas.json structure with N pessoas having unique IDs and names.
 * Ensures proximo_id = max(ids) + 1.
 * @param {number} minPessoas - Minimum number of pessoas (default 2)
 * @param {number} maxPessoas - Maximum number of pessoas (default 15)
 */
export function arbCadastro(minPessoas = 2, maxPessoas = 15) {
  return fc.integer({ min: minPessoas, max: maxPessoas }).chain(n => {
    const nomes = Array.from({ length: n }, (_, i) => `PESSOA${String(i + 1).padStart(2, '0')}`);
    const ids = Array.from({ length: n }, (_, i) => i + 1);

    const pessoasArbs = ids.map((id, i) => arbPessoaWith(id, nomes[i]));

    return fc.tuple(...pessoasArbs).map(pessoas => ({
      versao: '1.0.0',
      proximo_id: Math.max(...ids) + 1,
      ultima_atualizacao: '2026-01-01',
      grupos: {},
      departamentos_contato: {},
      pessoas,
    }));
  });
}

/**
 * Generates an arbitrary ISO date string (YYYY-MM-DD) in 2026.
 */
export const arbDataISO = fc.record({
  mes: fc.integer({ min: 1, max: 12 }),
  dia: fc.integer({ min: 1, max: 28 }),
}).map(({ mes, dia }) => `2026-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);

/**
 * Generates an arbitrary slot type.
 */
export const arbSlot = fc.constantFrom('regente', 'equipe', 'mm_es', 'mm_culto', 'mm_domingo');

// Re-export fast-check for convenience
export { fc };
