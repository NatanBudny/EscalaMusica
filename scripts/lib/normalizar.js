/**
 * Módulo de normalização de nomes para fuzzy matching.
 * Usado por resolverPessoaPorNome e demais scripts que comparam nomes
 * da enquete WhatsApp contra o cadastro unificado (pessoas.json).
 *
 * Transformações aplicadas (nesta ordem):
 * 1. Converte para string (fallback vazio)
 * 2. NFD normalize + strip de diacríticos
 * 3. Uppercase
 * 4. Remove dígitos
 * 5. Remove caractere '?'
 * 6. Colapsa espaços múltiplos em um só
 * 7. Trim
 * 8. Remove sufixos comuns de igreja ("IASD CENTRAL", "IASD", "CENTRAL")
 */

const SUFIXOS_COMUNS = ['IASD CENTRAL', 'IASD', 'CENTRAL'];

/**
 * Normaliza um nome para comparação/matching.
 * @param {string|*} valor - Valor a normalizar (convertido para string se necessário)
 * @returns {string} Nome normalizado em uppercase, sem acentos, sem sufixos de igreja
 */
export default function normalizar(valor) {
  let resultado = String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[0-9]/g, '')
    .replace(/[?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove sufixos comuns (ordem do mais longo para o mais curto garante match correto)
  for (const sufixo of SUFIXOS_COMUNS) {
    if (resultado.endsWith(` ${sufixo}`)) {
      resultado = resultado.slice(0, -(sufixo.length + 1)).trim();
      break;
    }
    if (resultado === sufixo) {
      resultado = '';
      break;
    }
  }

  return resultado;
}
