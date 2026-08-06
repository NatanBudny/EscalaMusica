import { readFileSync } from 'fs';
import normalizar from './normalizar.js';

/**
 * Nomes que devem ser ignorados na contagem do histórico.
 * São departamentos, indicadores de indefinição ou entradas não-pessoais.
 */
const IGNORAR = new Set([
  '',
  '-',
  'NAO',
  'INDEFINIDO',
  'PG - DEFINIDO NA HORA',
  'PG- DEFINIDO NA HORA',
  'JOVENS',
  'AVENTUREIROS',
  'QUARTETO',
  'MELHOR IDADE',
]);

/**
 * Converte data no formato DD/MM/YYYY para ISO YYYY-MM-DD.
 * @param {string} dataBR - Data no formato brasileiro
 * @returns {string|null} Data ISO ou null se inválida
 */
function converterParaISO(dataBR) {
  if (!dataBR || typeof dataBR !== 'string') return null;
  const partes = dataBR.trim().split('/');
  if (partes.length !== 3) return null;
  const [dia, mes, ano] = partes;
  if (!dia || !mes || !ano) return null;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

/**
 * Normaliza o nome do dia da semana para comparação (sem acentos, lowercase).
 * @param {string} dia - Valor do campo "DIA SEMANA"
 * @returns {string} Dia normalizado (ex: "sabado", "domingo", "quarta-feira")
 */
function normalizarDia(dia) {
  return String(dia || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Extrai e normaliza partes de um campo com múltiplos nomes.
 * Separa por vírgula e por " E " (conjunção).
 * @param {string} campo - Valor do campo (ex: "Nilsinho, Dani Herreira, Raissa")
 * @returns {string[]} Array de nomes normalizados
 */
function splitNomes(campo) {
  const bruto = String(campo || '').trim();
  if (!bruto) return [];

  return bruto
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .flatMap((parte) => (parte.toUpperCase().includes(' E ') ? parte.split(/\s+[eE]\s+/) : [parte]))
    .map((nome) => normalizar(nome))
    .filter((nome) => nome && !IGNORAR.has(nome));
}

/**
 * Resolve um nome normalizado para o ID da pessoa via porNome map.
 * @param {string} nomeNorm - Nome já normalizado
 * @param {Map<string, object>} porNome - Mapa nome/alias → Pessoa
 * @returns {number|null} ID da pessoa ou null se não encontrado
 */
function resolverParaId(nomeNorm, porNome) {
  if (!nomeNorm || IGNORAR.has(nomeNorm)) return null;
  const pessoa = porNome.get(nomeNorm);
  return pessoa ? pessoa.id : null;
}

/**
 * Retorna o valor mais recente entre duas datas ISO (ou a não-null).
 * @param {string|null} atual - Data atual armazenada
 * @param {string|null} nova - Nova data candidata
 * @returns {string|null}
 */
function maxData(atual, nova) {
  if (!nova) return atual;
  if (!atual) return nova;
  return nova > atual ? nova : atual;
}

/**
 * Filtra os caminhos de períodos antigos para considerar apenas
 * os meses dentro da janela definida (últimos N meses a partir da data mais recente em pathAtual).
 *
 * @param {string[]} pathsOld - Caminhos para arquivos old/*.json
 * @param {string} pathAtual - Caminho para atual.json
 * @param {number} meses - Janela em meses
 * @returns {{ rotulo: string, dados: object[] }[]} Períodos carregados dentro da janela
 */
function coletarPeriodosRecentes(pathsOld, pathAtual, meses) {
  const periodos = [];

  // Carregar atual.json
  let dadosAtual = [];
  try {
    dadosAtual = JSON.parse(readFileSync(pathAtual, 'utf8'));
  } catch {
    // Se não puder ler, segue sem ele
  }

  if (dadosAtual.length > 0) {
    periodos.push({ rotulo: 'atual', dados: dadosAtual });
  }

  // Carregar old files
  for (const pathOld of pathsOld) {
    try {
      const dados = JSON.parse(readFileSync(pathOld, 'utf8'));
      periodos.push({ rotulo: pathOld, dados });
    } catch {
      // Arquivo ilegível, skip
    }
  }

  // Determinar data mais recente entre todos os períodos
  let dataMaxGlobal = null;
  for (const periodo of periodos) {
    for (const linha of periodo.dados) {
      const iso = converterParaISO(linha.DATA);
      if (iso) {
        dataMaxGlobal = maxData(dataMaxGlobal, iso);
      }
    }
  }

  if (!dataMaxGlobal) return periodos; // Sem dados, retorna tudo

  // Calcular data de corte: N meses antes da data mais recente
  const dataMax = new Date(dataMaxGlobal + 'T00:00:00');
  const dataCorte = new Date(dataMax);
  dataCorte.setMonth(dataCorte.getMonth() - meses);
  const corteISO = dataCorte.toISOString().slice(0, 10);

  // Filtrar dados dentro da janela em cada período
  const periodosRecentes = [];
  for (const periodo of periodos) {
    const dadosFiltrados = periodo.dados.filter((linha) => {
      const iso = converterParaISO(linha.DATA);
      return iso && iso >= corteISO;
    });
    if (dadosFiltrados.length > 0) {
      periodosRecentes.push({ rotulo: periodo.rotulo, dados: dadosFiltrados });
    }
  }

  return periodosRecentes;
}

/**
 * Carrega o histórico de escalas a partir dos JSONs antigos e do atual,
 * resolvendo nomes para IDs do cadastro unificado.
 *
 * @param {{ pessoas: object[], porId: Map<number, object>, porNome: Map<string, object> }} cadastro - from carregarPessoas()
 * @param {string[]} pathsOld - Caminhos para arquivos old/*.json
 * @param {string} pathAtual - Caminho para atual.json
 * @param {number} [meses=4] - Janela de meses a considerar (lookback window)
 * @returns {Map<number, object>} Map<pessoa_id, HistoricoPessoa>
 */
export function carregarHistorico(cadastro, pathsOld, pathAtual, meses = 4) {
  const { pessoas, porNome } = cadastro;
  const historico = new Map();

  // Inicializar contadores zerados para todas as pessoas
  for (const pessoa of pessoas) {
    historico.set(pessoa.id, {
      regencias: 0,
      escalas_equipe: 0,
      mm_es: 0,
      mm_culto: 0,
      mm_domingo: 0,
      ultima_regencia: null,
      ultima_equipe: null,
      ultima_mm: null,
      datas_escalado: [],
    });
  }

  // Coletar períodos recentes dentro da janela
  const periodos = coletarPeriodosRecentes(pathsOld, pathAtual, meses);

  // Processar cada período
  for (const periodo of periodos) {
    for (const linha of periodo.dados) {
      const dia = normalizarDia(linha['DIA SEMANA']);

      // Ignorar quartas-feiras (sem louvor escalado)
      if (dia === 'quarta-feira') continue;

      const dataISO = converterParaISO(linha.DATA);

      // === REGENTE LOUVOR ===
      const regenteNorm = normalizar(linha['REGENTE LOUVOR']);
      const regenteId = resolverParaId(regenteNorm, porNome);
      if (regenteId != null && historico.has(regenteId)) {
        const h = historico.get(regenteId);
        h.regencias += 1;
        h.ultima_regencia = maxData(h.ultima_regencia, dataISO);
        if (dataISO && !h.datas_escalado.includes(dataISO)) {
          h.datas_escalado.push(dataISO);
        }
      }

      // === EQUIPE LOUVOR ===
      const nomesEquipe = splitNomes(linha['EQUIPE LOUVOR']);
      for (const nomeNorm of nomesEquipe) {
        const id = resolverParaId(nomeNorm, porNome);
        if (id != null && historico.has(id)) {
          const h = historico.get(id);
          h.escalas_equipe += 1;
          h.ultima_equipe = maxData(h.ultima_equipe, dataISO);
          if (dataISO && !h.datas_escalado.includes(dataISO)) {
            h.datas_escalado.push(dataISO);
          }
        }
      }

      // === MENSAGEM MUSICAL ===
      const nomesMM = splitNomes(linha['MENSAGEM MUSICAL']);
      for (let indice = 0; indice < nomesMM.length; indice++) {
        const nomeNorm = nomesMM[indice];
        const id = resolverParaId(nomeNorm, porNome);
        if (id == null || !historico.has(id)) continue;

        const h = historico.get(id);
        let chave;

        if (dia === 'sabado' && nomesMM.length >= 2) {
          // Sábado com 2+ nomes: primeiro → mm_es, segundo → mm_culto
          chave = indice === 0 ? 'mm_es' : 'mm_culto';
        } else if (dia === 'domingo') {
          chave = 'mm_domingo';
        } else {
          // Outros dias ou sábado com 1 nome → mm_culto
          chave = 'mm_culto';
        }

        h[chave] += 1;
        h.ultima_mm = maxData(h.ultima_mm, dataISO);
        if (dataISO && !h.datas_escalado.includes(dataISO)) {
          h.datas_escalado.push(dataISO);
        }
      }
    }
  }

  return historico;
}
