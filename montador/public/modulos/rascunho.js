// Rascunho automático da montagem (localStorage) e assinatura da escala.
// Lógica pura (ESM, sem DOM), testada em tests/montador/.
//
// O Rascunho guarda só os IDs de pessoa e 'grupo:<chave>' (nunca nomes), além
// de acomp (Banda/PB), obs, assumidoPor e excedentes. Assim, renomear uma
// pessoa no cadastro não altera as atribuições recuperadas, e um ID ausente do
// cadastro aparece em `foraDoCadastro` (nunca é descartado em silêncio).
//
// Feature: melhoras-domingao (E. Montagem) — Tasks 24, 25, 26, 27;
// Properties 21, 22.

/** Chave de localStorage do rascunho de um mês. */
export const chaveRascunho = (mes) => `escala:rascunho:${mes}`;

/** Slots de mensagem musical, em ordem canônica. */
const SLOTS_MM = ['mm_es', 'mm_culto', 'mm_domingo'];

/** Serializa um ocupante (id de pessoa, 'grupo:<chave>' ou null). */
function ocupanteSerial(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string') {
    if (valor.startsWith('grupo:')) return valor;
    // número em string → número; outro texto não é um ID válido.
    if (/^\d+$/.test(valor)) return Number(valor);
    return null;
  }
  return null;
}

/** mm (objeto por slot) serializado só com ocupantes válidos. */
function mmSerial(mm) {
  const out = {};
  if (!mm || Array.isArray(mm) || typeof mm !== 'object') return out;
  for (const slot of Object.keys(mm)) {
    const oc = ocupanteSerial(mm[slot]);
    if (oc != null) out[slot] = oc;
  }
  return out;
}

/**
 * Serializa a escala do mês em texto JSON (versão 1), só com IDs e grupos.
 *
 * @param {string} mes - 'AAAA-MM'
 * @param {object[]} cultos - CultoMontagem[]
 * @returns {string}
 */
export function serializarRascunho(mes, cultos) {
  const lista = Array.isArray(cultos) ? cultos : [];
  const dados = {
    versao: 1,
    mes,
    salvo_em: new Date().toISOString(),
    cultos: lista.map((c) => ({
      data: c.data,
      acomp: c.acomp || null,
      obs: c.obs != null ? c.obs : '',
      regente: ocupanteSerial(c.regente),
      equipe: (c.equipe || []).map(ocupanteSerial).filter((x) => x != null),
      mm: mmSerial(c.mm),
      assumidoPor: c.assumidoPor || null,
      excedentes: (c.excedentes || []).map((e) => ({
        campo: e.campo,
        nome: e.nome != null ? e.nome : null,
        ocupante: e.ocupante != null ? ocupanteSerial(e.ocupante) : null,
      })),
    })),
  };
  return JSON.stringify(dados);
}

/** Resolve um ocupante serializado para o valor em memória + fora do cadastro. */
function resolver(ocupante, pessoasPorId, gruposPorChave, fora, ctx) {
  if (ocupante == null) return null;
  if (typeof ocupante === 'number') {
    if (!pessoasPorId || !pessoasPorId.has(ocupante)) {
      fora.push({ ...ctx, id: ocupante });
    }
    return ocupante; // o ID é preservado mesmo fora do cadastro
  }
  if (typeof ocupante === 'string' && ocupante.startsWith('grupo:')) {
    const chave = ocupante.slice('grupo:'.length);
    if (!gruposPorChave || !gruposPorChave.has(chave)) {
      fora.push({ ...ctx, id: ocupante });
    }
    return ocupante;
  }
  return null;
}

/**
 * Desserializa o rascunho de volta para CultoMontagem (ocupantes por ID /
 * 'grupo:<chave>'), reportando IDs/grupos ausentes do cadastro em
 * `foraDoCadastro` (nunca descartados).
 *
 * @param {string} texto
 * @param {Map<number,object>} pessoasPorId
 * @param {Map<string,object>} gruposPorChave
 * @returns {{ cultos: object[], foraDoCadastro: object[] }}
 */
export function desserializarRascunho(texto, pessoasPorId, gruposPorChave) {
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    return { cultos: [], foraDoCadastro: [] };
  }
  const fora = [];
  const cultos = (dados && Array.isArray(dados.cultos) ? dados.cultos : []).map((c) => {
    const mm = {};
    for (const slot of SLOTS_MM) {
      if (c.mm && c.mm[slot] != null) {
        mm[slot] = resolver(c.mm[slot], pessoasPorId, gruposPorChave, fora, { data: c.data, slot });
      }
    }
    return {
      data: c.data,
      acomp: c.acomp || null,
      obs: c.obs != null ? c.obs : '',
      regente: resolver(c.regente, pessoasPorId, gruposPorChave, fora, { data: c.data, slot: 'regente' }),
      equipe: (c.equipe || []).map((e) =>
        resolver(e, pessoasPorId, gruposPorChave, fora, { data: c.data, slot: 'equipe' }),
      ),
      mm,
      assumidoPor: c.assumidoPor
        ? resolver(c.assumidoPor, pessoasPorId, gruposPorChave, fora, { data: c.data, slot: 'assumidoPor' })
        : null,
      excedentes: (c.excedentes || []).map((e) => ({
        campo: e.campo,
        nome: e.nome != null ? e.nome : null,
        ocupante: e.ocupante != null
          ? resolver(e.ocupante, pessoasPorId, gruposPorChave, fora, { data: c.data, slot: 'excedente' })
          : null,
      })),
    };
  });
  return { cultos, foraDoCadastro: fora };
}

// ---------------------------------------------------------------------------
// Assinatura da escala (indicador "não sincronizado")
// ---------------------------------------------------------------------------

/** Chave canônica de um ocupante para a assinatura. */
function ocAssinatura(valor) {
  const oc = ocupanteSerial(valor);
  return oc == null ? '' : String(oc);
}

/**
 * Assinatura canônica da escala: cobre as atribuições dos cultos de louvor
 * (regente, equipe, mm por slot, assumidoPor, acomp) e a OBS de TODOS os cultos
 * (inclusive quartas). Duas escalas com as mesmas atribuições, Banda/PB e OBS
 * têm a mesma assinatura; mudar qualquer um deles muda a assinatura.
 *
 * @param {object[]} cultos - CultoMontagem[]
 * @returns {string}
 */
export function assinatura(cultos) {
  const lista = Array.isArray(cultos) ? cultos : [];
  const ordenados = [...lista].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const partes = ordenados.map((c) => {
    const ehLouvor = (c.tipo || '') === 'louvor' || c.regente != null || (c.equipe && c.equipe.length) || c.assumidoPor;
    const mmStr = SLOTS_MM.map((s) => `${s}=${ocAssinatura((c.mm || {})[s])}`).join('|');
    const equipeStr = (c.equipe || []).map(ocAssinatura).filter(Boolean).sort().join('+');
    const louvor = ehLouvor
      ? `R:${ocAssinatura(c.regente)};E:${equipeStr};M:${mmStr};A:${c.assumidoPor || ''};ACOMP:${c.acomp || ''}`
      : '';
    return `${c.data}{${louvor}}OBS:${c.obs != null ? c.obs : ''}`;
  });
  return partes.join('\n');
}
