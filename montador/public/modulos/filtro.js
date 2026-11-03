// Lógica pura de filtragem da lista do cadastro (ESM, sem DOM).
// Testada em tests/montador/.
//
// Feature: melhoras-domingao (B. Cadastro) — Property 10; Requisitos 7.4, 7.5.

/** Normaliza para busca: sem acento, maiúsculas, trim. */
function normalizarBusca(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

/** A pessoa casa com o termo de busca (nome ou apelido)? */
function casaBusca(pessoa, termo) {
  if (!termo) return true;
  const alvo = [pessoa.nome, ...(pessoa.aliases || [])].map(normalizarBusca).join(' ');
  return alvo.includes(termo);
}

/** A pessoa tem a função pedida (regente, equipe, mm, sonoplastia)? */
function temFuncao(pessoa, funcao) {
  const hab = pessoa.habilitacoes || {};
  if (funcao === 'regente') return hab.regente === true;
  if (funcao === 'equipe') return hab.equipe === true;
  if (funcao === 'sonoplastia') return hab.sonoplastia === true;
  if (funcao === 'mm') {
    const mm = hab.mensagem_musical || {};
    return mm.es === true || mm.culto === true || mm.domingo === true;
  }
  return true;
}

/**
 * Filtra a lista de pessoas pela busca (nome/apelido) e por todos os filtros
 * ativos. Devolve somente as pessoas que atendem à busca E a cada filtro ativo.
 *
 * @param {object[]} pessoas
 * @param {string} busca - termo (nome/apelido); vazio = sem filtro de busca
 * @param {{
 *   funcoes?: string[],        // 'regente' | 'equipe' | 'mm' | 'sonoplastia' (OR entre elas... ver abaixo)
 *   situacao?: 'ativo'|'inativo'|null,
 *   afastado?: boolean|null,   // true = só afastados; false = só não afastados; null = ignora
 *   dias?: string[],           // 'sabado' | 'domingo'; pessoa precisa ter o dia permitido
 *   perfil?: string|null,      // 'base' | 'participacao' | null
 * }} [filtros]
 * @returns {object[]}
 */
export function filtrarPessoas(pessoas, busca = '', filtros = {}) {
  const termo = normalizarBusca(busca);
  const {
    funcoes = [],
    situacao = null,
    afastado = null,
    dias = [],
    perfil = null,
  } = filtros || {};

  return (pessoas || []).filter((p) => {
    if (!casaBusca(p, termo)) return false;

    // Função: pessoa precisa ter TODAS as funções marcadas.
    for (const f of funcoes) {
      if (!temFuncao(p, f)) return false;
    }

    // Situação (ativo/inativo).
    if (situacao === 'ativo' && p.ativo === false) return false;
    if (situacao === 'inativo' && p.ativo !== false) return false;

    // Afastado.
    const estaAfastado = !!(p.afastado && p.afastado.ativo);
    if (afastado === true && !estaAfastado) return false;
    if (afastado === false && estaAfastado) return false;

    // Dias permitidos: a pessoa precisa permitir todos os dias pedidos. Uma
    // pessoa sem restrição (dias_permitidos null) permite qualquer dia.
    if (dias.length > 0) {
      const permitidos = p.dias_permitidos; // null = qualquer dia
      if (permitidos != null) {
        for (const d of dias) {
          if (!permitidos.includes(d)) return false;
        }
      }
    }

    // Perfil de canto.
    if (perfil != null && perfil !== '') {
      if ((p.perfil_canto || null) !== perfil) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Filtro por dia na montagem (Task 19) — lógica pura, sem DOM.
// Feature: melhoras-domingao (E. Montagem) — Requisitos 15.4, 15.5, 15.6.
// ---------------------------------------------------------------------------

/** Normaliza o dia da semana (sem acento, minúsculo, trim). */
function normalizarDiaFiltro(dia) {
  return String(dia == null ? '' : dia)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Converte o dia normalizado para a chave de chip ('sabado'|'domingo'|'quarta'). */
function chaveDia(dia) {
  const d = normalizarDiaFiltro(dia);
  if (d === 'sabado') return 'sabado';
  if (d === 'domingo') return 'domingo';
  if (d === 'quarta-feira' || d === 'quarta') return 'quarta';
  return d;
}

/**
 * Datas de cultos visíveis conforme o filtro por dia. O filtro combina:
 *  - dias: Set de chaves ('sabado'|'domingo'|'quarta'); vazio = todos os dias;
 *  - extraordinarios: true = inclui só os cultos extraordinários (OU com os dias);
 *  - data: se definida, restringe a essa data exata.
 *
 * Um culto é visível quando casa com os dias pedidos OU (quando
 * `extraordinarios` está ligado) é um Dia_Extraordinario; e, se `data` está
 * definida, apenas o culto dessa data é visível. Sem nenhum critério, todos os
 * cultos são visíveis.
 *
 * @param {object[]} cultos - CultoMontagem (data, dia_semana, extraordinario)
 * @param {{ dias?: Set<string>|string[], data?: string, extraordinarios?: boolean }} [filtro]
 * @returns {Set<string>} datas visíveis
 */
export function datasVisiveis(cultos, filtro = {}) {
  const lista = Array.isArray(cultos) ? cultos : [];
  const diasSet =
    filtro.dias instanceof Set
      ? filtro.dias
      : new Set(Array.isArray(filtro.dias) ? filtro.dias : []);
  const querExtra = filtro.extraordinarios === true;
  const dataExata = filtro.data || null;

  const temFiltroDia = diasSet.size > 0 || querExtra;

  const visiveis = new Set();
  for (const culto of lista) {
    // Restrição por data exata.
    if (dataExata && culto.data !== dataExata) continue;

    if (!temFiltroDia) {
      visiveis.add(culto.data);
      continue;
    }

    const casaDia = diasSet.has(chaveDia(culto.dia_semana || culto.dia));
    const casaExtra = querExtra && culto.extraordinario === true;
    if (casaDia || casaExtra) visiveis.add(culto.data);
  }
  return visiveis;
}
