// Progresso visual da montagem (ESM puro, sem DOM), testado em tests/montador/.
//
// Conta as funções preenchidas e pendentes dos cultos de tipo 'louvor'. A
// equipe conta `equipe.tamanho` vagas; cada slot de MM e o regente contam uma
// vaga. Um culto com `assumidoPor` (grupo assume o culto) é considerado
// completo. Cultos de quarta, departamentais e sem louvor não entram na conta.
//
// Feature: melhoras-domingao (E. Montagem) — Task 25; Property 23; Req 20.1-20.3.

/** Slots de mensagem musical. */
const SLOTS_MM = new Set(['mm_es', 'mm_culto', 'mm_domingo']);

/** Um ocupante está preenchido? (id de pessoa, 'grupo:<chave>' ou nome). */
function preenchido(valor) {
  if (valor == null || valor === '') return false;
  if (typeof valor === 'string' && valor.trim() === '') return false;
  return true;
}

/**
 * Calcula o progresso da escala.
 *
 * @param {object[]} cultos - CultoMontagem[] (com `slots` do modelo)
 * @param {object} [opts] - { tamanhoEquipe = 5 }
 * @returns {{ preenchidas: number, pendentes: number, total: number, completos: Set<string> }}
 */
export function calcularProgresso(cultos, opts = {}) {
  const tamanhoEquipe = opts.tamanhoEquipe || 5;
  const lista = Array.isArray(cultos) ? cultos : [];

  let preenchidas = 0;
  let total = 0;
  const completos = new Set();

  for (const culto of lista) {
    const tipo = culto.tipo || '';
    if (tipo !== 'louvor') continue;

    // Culto assumido por grupo: completo, sem vagas pendentes. Conta como o
    // conjunto de funções do modelo, todas preenchidas.
    const slots = Array.isArray(culto.slots) ? culto.slots : [];

    // Total de vagas do culto.
    let vagasCulto = 0;
    for (const slot of slots) {
      if (slot === 'equipe') vagasCulto += tamanhoEquipe;
      else vagasCulto += 1;
    }
    total += vagasCulto;

    if (culto.assumidoPor) {
      preenchidas += vagasCulto;
      completos.add(culto.data);
      continue;
    }

    let preenchidasCulto = 0;
    for (const slot of slots) {
      if (slot === 'regente') {
        if (preenchido(culto.regente)) preenchidasCulto += 1;
      } else if (slot === 'equipe') {
        const n = (culto.equipe || []).filter(preenchido).length;
        preenchidasCulto += Math.min(n, tamanhoEquipe);
      } else if (SLOTS_MM.has(slot)) {
        const v = (culto.mm || {})[slot];
        if (preenchido(v)) preenchidasCulto += 1;
      }
    }
    preenchidas += preenchidasCulto;
    if (preenchidasCulto >= vagasCulto && vagasCulto > 0) completos.add(culto.data);
  }

  return { preenchidas, pendentes: total - preenchidas, total, completos };
}
