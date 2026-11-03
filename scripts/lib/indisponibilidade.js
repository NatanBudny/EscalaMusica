/**
 * indisponibilidade.js
 *
 * Lógica pura de vinculação da enquete de indisponibilidade de cantores,
 * extraída de scripts/ciclo/vincular-indisponibilidade.js para ser reusada
 * tanto pelo CLI quanto pelo editor de escala (montador).
 *
 * - nomesDaEnquete(enquete): todos os nomes informais da enquete (datas +
 *   indisponiveis_tempo_indeterminado / indisponiveis_mes_inteiro).
 * - montarVinculada(enquete, cadastro, mapeamentos, opts): monta a saída
 *   vinculada por ID, idêntica à do script antigo (só varia `gerado_em`).
 *
 * `mapeamentos` é um Map<nomeEnquete, number | { pessoa_id, confianca }>.
 * O valor pode ser o ID da pessoa ou um objeto com id e confiança (usado pelo
 * CLI para preservar o campo `confianca` em mapeamentos_aplicados).
 *
 * Feature: melhoras-domingao (D. Mês e insumos) — Task 17; Requisitos 14.9 a 14.11.
 */

/** Dia da semana (minúsculo, sem acento) a partir de uma data ISO. */
function getDiaSemana(dataISO) {
  const dias = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const date = new Date(`${dataISO}T12:00:00Z`);
  return dias[date.getUTCDay()];
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getMesNome(mesNum) {
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  return meses[mesNum - 1] || `mês ${mesNum}`;
}

/**
 * Todos os nomes informais únicos da enquete (datas + geral).
 * @param {object} enquete
 * @returns {string[]}
 */
export function nomesDaEnquete(enquete) {
  const todos = new Set();
  for (const entrada of enquete.datas || []) {
    const nomes = entrada.indisponiveis || entrada.indisponiveis_tempo_indeterminado || [];
    for (const nome of nomes) {
      if (nome && nome.trim()) todos.add(nome.trim());
    }
  }
  if (Array.isArray(enquete.indisponiveis_mes_inteiro)) {
    for (const nome of enquete.indisponiveis_mes_inteiro) {
      if (nome && nome.trim()) todos.add(nome.trim());
    }
  }
  return [...todos];
}

/** Normaliza um valor de mapeamento para { pessoa_id, confianca }. */
function normalizarMapeamento(valor) {
  if (valor == null) return null;
  if (typeof valor === 'number') return { pessoa_id: valor, confianca: 1 };
  if (typeof valor === 'object') {
    const id = valor.pessoa_id != null ? valor.pessoa_id : valor.pessoaId;
    if (id == null) return null;
    return { pessoa_id: id, confianca: valor.confianca != null ? valor.confianca : 1 };
  }
  return null;
}

/**
 * Monta a indisponibilidade vinculada por ID, reproduzindo exatamente a saída
 * de vincular-indisponibilidade.js (exceto `gerado_em`).
 *
 * @param {object} enquete - conteúdo de indisponibilidade-cantores.json
 * @param {{ porId: Map<number, object> }} cadastro
 * @param {Map<string, number | { pessoa_id, confianca }>} mapeamentos
 * @param {{ fonte?: string, agora?: string, mes?: string }} [opts]
 * @returns {object} saída vinculada
 */
export function montarVinculada(enquete, cadastro, mapeamentos, { fonte = '', agora, mes } = {}) {
  const { porId } = cadastro;

  // Normaliza o Map para valores { pessoa_id, confianca }.
  const mapNorm = new Map();
  for (const [nome, valor] of mapeamentos) {
    const m = normalizarMapeamento(valor);
    if (m && porId.has(m.pessoa_id)) {
      mapNorm.set(nome, { ...m, nome_canonico: porId.get(m.pessoa_id).nome });
    }
  }

  // Propagações (casais sempre_junto) — ordem de inserção dos mapeamentos.
  const propagacoes = [];
  const propagacaoSet = new Set();
  for (const [, mapping] of mapNorm) {
    const pessoa = porId.get(mapping.pessoa_id);
    if (!pessoa || !pessoa.vinculos) continue;
    for (const vinculo of pessoa.vinculos) {
      if (vinculo.tipo === 'sempre_junto') {
        const chave = `${pessoa.id}→${vinculo.com_id}`;
        const chaveInversa = `${vinculo.com_id}→${pessoa.id}`;
        if (!propagacaoSet.has(chave) && !propagacaoSet.has(chaveInversa)) {
          const parceiro = porId.get(vinculo.com_id);
          if (parceiro) {
            propagacaoSet.add(chave);
            propagacoes.push({
              de_id: pessoa.id,
              para_id: vinculo.com_id,
              motivo: `vinculo sempre_junto (casal ${pessoa.nome}↔${parceiro.nome})`,
            });
          }
        }
      }
    }
  }

  // Datas com IDs (propaga sempre_junto por data).
  const datasOutput = [];
  for (const entrada of enquete.datas || []) {
    if (entrada.data_referencia === 'geral') continue;
    const nomesData = entrada.indisponiveis || [];
    const idsSet = new Set();
    const nomesResolvidosData = [];
    for (const nome of nomesData) {
      if (!nome || !nome.trim()) continue;
      const mapping = mapNorm.get(nome.trim());
      if (mapping) {
        idsSet.add(mapping.pessoa_id);
        nomesResolvidosData.push(mapping.nome_canonico);
      }
    }
    const idsParaPropagar = [...idsSet];
    for (const id of idsParaPropagar) {
      const pessoa = porId.get(id);
      if (!pessoa || !pessoa.vinculos) continue;
      for (const vinculo of pessoa.vinculos) {
        if (vinculo.tipo === 'sempre_junto' && !idsSet.has(vinculo.com_id)) {
          const parceiro = porId.get(vinculo.com_id);
          if (parceiro) {
            idsSet.add(vinculo.com_id);
            nomesResolvidosData.push(parceiro.nome);
          }
        }
      }
    }
    datasOutput.push({
      data_referencia: entrada.data_referencia,
      dia_semana: entrada.dia_semana || getDiaSemana(entrada.data_referencia),
      indisponiveis_ids: [...idsSet].sort((a, b) => a - b),
      indisponiveis_nomes: nomesResolvidosData.sort(),
    });
  }

  // Mês inteiro (geral).
  let indisponiveisMesInteiro = null;
  const entradaGeral = (enquete.datas || []).find((d) => d.data_referencia === 'geral');
  const nomesMesInteiro = entradaGeral
    ? entradaGeral.indisponiveis_tempo_indeterminado || entradaGeral.indisponiveis || []
    : Array.isArray(enquete.indisponiveis_mes_inteiro)
      ? enquete.indisponiveis_mes_inteiro
      : [];

  if (nomesMesInteiro.length > 0) {
    const idsMesInteiro = new Set();
    const nomesMesInteiroResolvidos = [];
    for (const nome of nomesMesInteiro) {
      if (!nome || !nome.trim()) continue;
      const mapping = mapNorm.get(nome.trim());
      if (mapping) {
        idsMesInteiro.add(mapping.pessoa_id);
        nomesMesInteiroResolvidos.push(mapping.nome_canonico);
      }
    }
    const idsParaPropagar = [...idsMesInteiro];
    for (const id of idsParaPropagar) {
      const pessoa = porId.get(id);
      if (!pessoa || !pessoa.vinculos) continue;
      for (const vinculo of pessoa.vinculos) {
        if (vinculo.tipo === 'sempre_junto' && !idsMesInteiro.has(vinculo.com_id)) {
          const parceiro = porId.get(vinculo.com_id);
          if (parceiro) {
            idsMesInteiro.add(vinculo.com_id);
            nomesMesInteiroResolvidos.push(parceiro.nome);
          }
        }
      }
    }
    if (idsMesInteiro.size > 0) {
      indisponiveisMesInteiro = {
        ids: [...idsMesInteiro].sort((a, b) => a - b),
        nomes: nomesMesInteiroResolvidos.sort(),
        motivo: 'indisponibilidade total declarada na enquete',
      };
    }
  }

  // Mapeamentos aplicados (ordenados por nome_enquete).
  const mapeamentosOutput = [];
  for (const [nomeEnquete, mapping] of mapNorm) {
    mapeamentosOutput.push({
      nome_enquete: nomeEnquete,
      pessoa_id: mapping.pessoa_id,
      nome_canonico: mapping.nome_canonico,
      confianca: mapping.confianca,
    });
  }
  mapeamentosOutput.sort((a, b) => a.nome_enquete.localeCompare(b.nome_enquete));

  // Contexto: mês por extenso (do mes informado ou da primeira data).
  let mesNum = null;
  let ano = null;
  if (mes) {
    const mm = String(mes).match(/^(\d{4})-(\d{2})$/);
    if (mm) {
      ano = mm[1];
      mesNum = Number(mm[2]);
    }
  }
  if (mesNum == null) {
    const primeira = (datasOutput[0] && datasOutput[0].data_referencia) || '';
    const mm = primeira.match(/^(\d{4})-(\d{2})/);
    if (mm) {
      ano = mm[1];
      mesNum = Number(mm[2]);
    }
  }
  const contexto =
    mesNum != null
      ? `Indisponibilidade vinculada - ${capitalize(getMesNome(mesNum))} ${ano}`
      : 'Indisponibilidade vinculada';

  const output = {
    contexto,
    gerado_em: agora || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    gerado_por: 'vincular-indisponibilidade.js',
    fonte,
    mapeamentos_aplicados: mapeamentosOutput,
    propagacoes,
    datas: datasOutput,
  };
  if (indisponiveisMesInteiro) {
    output.indisponiveis_mes_inteiro = indisponiveisMesInteiro;
  }
  return output;
}
