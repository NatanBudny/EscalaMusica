/**
 * Módulo de fuzzy matching para resolução de nomes da enquete WhatsApp
 * contra o cadastro unificado (pessoas.json).
 *
 * Usa Dice coefficient (bigram similarity) como métrica de similaridade.
 * Zero dependências externas em runtime.
 */

import normalizar from './normalizar.js';

/**
 * Extrai bigramas de uma string.
 * @param {string} str - String já normalizada
 * @returns {Map<string, number>} Mapa de bigrama → contagem
 */
function bigramas(str) {
  const mapa = new Map();
  for (let i = 0; i < str.length - 1; i++) {
    const par = str.slice(i, i + 2);
    mapa.set(par, (mapa.get(par) || 0) + 1);
  }
  return mapa;
}

/**
 * Calcula o Dice coefficient entre duas strings.
 * Fórmula: 2 * |intersecção de bigramas| / (|bigramas A| + |bigramas B|)
 *
 * @param {string} a - Primeira string (já normalizada)
 * @param {string} b - Segunda string (já normalizada)
 * @returns {number} Valor entre 0 e 1 (1 = idêntico)
 */
function diceCoefficient(a, b) {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0.0;

  const bigramasA = bigramas(a);
  const bigramasB = bigramas(b);

  let intersecao = 0;
  for (const [par, countA] of bigramasA) {
    const countB = bigramasB.get(par) || 0;
    intersecao += Math.min(countA, countB);
  }

  const totalA = a.length - 1;
  const totalB = b.length - 1;

  return (2 * intersecao) / (totalA + totalB);
}

/**
 * Fuzzy match de texto livre contra o mapa de nomes/aliases.
 * Usado pelo vinculador para resolver nomes da enquete.
 *
 * Estratégia:
 * 1. Normaliza o texto de entrada
 * 2. Tenta match exato contra as chaves do mapa
 * 3. Se não encontra, calcula similaridade (Dice coefficient) contra todas as chaves
 * 4. Retorna o melhor match acima do threshold
 *
 * Determinismo: quando múltiplos matches empatam, a chave com menor valor
 * lexicográfico vence.
 *
 * @param {string} texto - Texto livre (nome da enquete)
 * @param {Map<string, object>} porNome - Mapa construído por carregarPessoas (chave normalizada → Pessoa)
 * @param {number} [threshold=0.6] - Confiança mínima para aceitar match
 * @returns {{ pessoa: object, confianca: number } | null} Melhor match ou null
 */
export function resolverPessoaPorNome(texto, porNome, threshold = 0.6) {
  if (!texto || typeof texto !== 'string') return null;

  const normalizado = normalizar(texto);
  if (!normalizado) return null;

  // Tentativa 1: match exato
  const exato = porNome.get(normalizado);
  if (exato) {
    return { pessoa: exato, confianca: 1.0 };
  }

  // Tentativa 2: fuzzy match via Dice coefficient
  let melhorConfianca = 0;
  let melhorChave = null;
  let melhorPessoa = null;

  for (const [chave, pessoa] of porNome) {
    const similaridade = diceCoefficient(normalizado, chave);

    if (similaridade > melhorConfianca) {
      melhorConfianca = similaridade;
      melhorChave = chave;
      melhorPessoa = pessoa;
    } else if (similaridade === melhorConfianca && similaridade > 0) {
      // Desempate: menor chave lexicográfica (determinismo)
      if (chave < melhorChave) {
        melhorChave = chave;
        melhorPessoa = pessoa;
      }
    }
  }

  if (melhorConfianca >= threshold) {
    return { pessoa: melhorPessoa, confianca: melhorConfianca };
  }

  return null;
}
