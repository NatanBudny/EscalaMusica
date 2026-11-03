// Painel de participação: ajuda o líder a enxergar quem está cantando pouco e
// quem está cantando muito nos últimos meses, SEM penalizar quem votou que não
// podia participar.
//
// Ideia (simples e justa): para cada pessoa olhamos os cultos de louvor
// (sábados e domingos) de uma janela recente e contamos, SEPARANDO POR TIPO:
//   - regencia: vezes como REGENTE LOUVOR.
//   - louvor:   vezes na EQUIPE LOUVOR.
//   - mensagem: vezes em MENSAGEM MUSICAL.
// Além do total e de quantos cultos a pessoa PODIA participar (desconta quem
// votou indisponível). A leitura é "participou X de Y cultos em que podia".
//
// Tudo é DETERMINÍSTICO (sem IA): mesmas entradas => mesma saída. Os "insights"
// (alertas inteligentes) são regras puras, fáceis de estender (ver INSIGHTS).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './regras.mjs';
import normalizar from '../../scripts/lib/normalizar.js';

const IGNORAR = new Set([
  '', '-', 'NAO', 'INDEFINIDO', 'JOVENS', 'AVENTUREIROS', 'QUARTETO',
  'MELHOR IDADE', 'DESBRAVADORES', 'DORCAS', 'M. MULHER', 'MIN. JOVEM',
  'PG - DEFINIDO NA HORA', 'PG- DEFINIDO NA HORA', 'BANDA',
]);

/** Tipos de participação contados separadamente. */
export const TIPOS = ['regencia', 'louvor', 'mensagem'];

function converterParaISO(dataBR) {
  const p = String(dataBR || '').trim().split('/');
  if (p.length !== 3) return null;
  const [d, m, a] = p;
  return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function normalizarDia(dia) {
  return String(dia || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function splitNomes(campo) {
  const bruto = String(campo || '').trim();
  if (!bruto || bruto === '-') return [];
  return bruto
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((p) => (p.toUpperCase().includes(' E ') ? p.split(/\s+[eE]\s+/) : [p]))
    .map((n) => normalizar(n))
    .filter((n) => n && !IGNORAR.has(n));
}

/** Carrega todas as escalas (arrays de cultos) de old/ + atual.json. */
function carregarEscalasConhecidas() {
  const escalas = [];
  const atualPath = resolve(ROOT, 'atual.json');
  if (existsSync(atualPath)) {
    try {
      const d = JSON.parse(readFileSync(atualPath, 'utf8'));
      if (Array.isArray(d)) escalas.push(...d);
    } catch { /* ignora */ }
  }
  const oldBase = resolve(ROOT, 'old');
  if (existsSync(oldBase)) {
    for (const anoDir of readdirSync(oldBase)) {
      if (!/^\d{4}$/.test(anoDir)) continue;
      const anoPath = resolve(oldBase, anoDir);
      try {
        for (const arq of readdirSync(anoPath)) {
          if (!arq.endsWith('.json')) continue;
          try {
            const d = JSON.parse(readFileSync(resolve(anoPath, arq), 'utf8'));
            if (Array.isArray(d)) escalas.push(...d);
          } catch { /* ignora */ }
        }
      } catch { /* ignora */ }
    }
  }
  return escalas;
}

/** Lê a indisponibilidade vinculada de um mês (ids por data). */
function carregarIndispMes(mesYYYYMM) {
  const [ano, mes] = mesYYYYMM.split('-');
  const p = resolve(ROOT, `escalas/${ano}/${mes}/insumos/indisponibilidade-cantores-vinculada.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Calcula o resumo de participação por pessoa para o painel lateral.
 *
 * @param {object} base - contexto de carregarContexto (cadastro, indisponibilidade, cultos, mesAlvo)
 * @param {object[]} cultosAtuais - cultos do mês em montagem COM as atribuições atuais da tela
 * @param {number} [janelaMeses=4] - meses considerados (inclui o mês em montagem)
 * @returns {{ itens: object[], janela: string[], mediaPorTipo: object }}
 */
export function resumoParticipacao(base, cultosAtuais, janelaMeses = 4) {
  const { cadastro } = base;
  const janelaN = Math.max(1, Math.min(12, Number(janelaMeses) || 4));

  const escalasConhecidas = carregarEscalasConhecidas();

  // A janela cobre o mês em montagem + os (janelaN-1) meses MAIS RECENTES que
  // realmente têm escala publicada (evita meses futuros vazios).
  const mesesComDados = new Set();
  for (const linha of escalasConhecidas) {
    const iso = converterParaISO(linha.DATA);
    const dia = normalizarDia(linha['DIA SEMANA']);
    if (iso && (dia === 'sabado' || dia === 'domingo')) mesesComDados.add(iso.slice(0, 7));
  }
  const anterioresComDados = [...mesesComDados]
    .filter((m) => m < base.mesAlvo)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, Math.max(0, janelaN - 1));
  const janela = [base.mesAlvo, ...anterioresComDados];
  const janelaSet = new Set(janela);

  // 1) Reunir os cultos da janela: histórico (old+atual) + o mês em montagem.
  const historicos = escalasConhecidas.filter((linha) => {
    const iso = converterParaISO(linha.DATA);
    return iso && janelaSet.has(iso.slice(0, 7));
  });

  const doMesMontagem = (cultosAtuais || [])
    .filter((c) => c.dia_semana !== 'quarta-feira')
    .map((c) => ({
      DATA: c.data.includes('/') ? c.data : converterBrDeIso(c.data),
      _iso: c.data.includes('/') ? converterParaISO(c.data) : c.data,
      'DIA SEMANA': c.dia_semana,
      'REGENTE LOUVOR': Array.isArray(c.regente) ? c.regente.join(', ') : c.regente || '',
      'EQUIPE LOUVOR': Array.isArray(c.equipe) ? c.equipe.join(', ') : c.equipe || '',
      'MENSAGEM MUSICAL': Array.isArray(c.mm) ? c.mm.filter(Boolean).join(', ') : c.mm || '',
    }));

  const isoMontagem = new Set(doMesMontagem.map((c) => c._iso));
  const historicosFiltrados = historicos.filter((c) => {
    const iso = converterParaISO(c.DATA);
    return !isoMontagem.has(iso);
  });

  const todosCultos = [...historicosFiltrados, ...doMesMontagem].filter((c) => {
    const dia = normalizarDia(c['DIA SEMANA']);
    return dia === 'sabado' || dia === 'domingo';
  });

  // 2) Indisponibilidade por data e mês inteiro.
  const indispPorData = new Map(); // iso -> Set(ids)
  const indispMesInteiro = new Map(); // 'YYYY-MM' -> Set(ids)
  for (const mesY of janela) {
    const vinc = carregarIndispMes(mesY) || base.indisponibilidade;
    if (!vinc) continue;
    for (const d of vinc.datas || []) {
      const iso = d.data_referencia;
      if (!iso) continue;
      if (!indispPorData.has(iso)) indispPorData.set(iso, new Set());
      for (const id of d.indisponiveis_ids || []) indispPorData.get(iso).add(id);
    }
    const mi = vinc.indisponiveis_mes_inteiro?.ids || [];
    if (mi.length) indispMesInteiro.set(mesY, new Set(mi));
  }
  for (const d of base.indisponibilidade?.datas || []) {
    const iso = d.data_referencia;
    if (!iso) continue;
    if (!indispPorData.has(iso)) indispPorData.set(iso, new Set());
    for (const id of d.indisponiveis_ids || []) indispPorData.get(iso).add(id);
  }

  // 3) Para cada pessoa ativa habilitada, contar por tipo.
  const cantores = cadastro.pessoas.filter(
    (p) => p.ativo && (p.habilitacoes?.equipe || p.habilitacoes?.regente ||
      p.habilitacoes?.mensagem_musical?.es || p.habilitacoes?.mensagem_musical?.culto ||
      p.habilitacoes?.mensagem_musical?.domingo),
  );

  const porNome = cadastro.porNome;
  const itens = [];

  for (const pessoa of cantores) {
    let disponivel = 0;
    let votouFora = 0;
    const porTipo = { regencia: 0, louvor: 0, mensagem: 0 };
    const datasPorTipo = { regencia: [], louvor: [], mensagem: [] };

    for (const culto of todosCultos) {
      const iso = converterParaISO(culto.DATA) || culto._iso;
      if (!iso) continue;
      const mesY = iso.slice(0, 7);

      const indispData = indispPorData.get(iso) || new Set();
      const indispMes = indispMesInteiro.get(mesY) || new Set();
      const foraPorVoto = indispData.has(pessoa.id) || indispMes.has(pessoa.id);
      const afastada = pessoa.afastado && pessoa.afastado.ativo === true;

      const papeis = papeisDaPessoaNoCulto(culto, pessoa, porNome);

      if (foraPorVoto) {
        votouFora += 1;
      } else if (!afastada) {
        disponivel += 1;
      }

      if (papeis.size > 0) {
        const [a, m, d] = iso.split('-');
        const label = `${d}/${m}`;
        for (const papel of papeis) {
          porTipo[papel] += 1;
          datasPorTipo[papel].push({ iso, label });
        }
      }
    }

    for (const t of TIPOS) datasPorTipo[t].sort((x, y) => x.iso.localeCompare(y.iso));

    const participou = porTipo.regencia + porTipo.louvor + porTipo.mensagem;
    const taxa = disponivel > 0 ? participou / disponivel : null;

    itens.push({
      id: pessoa.id,
      nome: pessoa.nome,
      ehRegente: pessoa.habilitacoes?.regente === true,
      participou,
      porTipo,
      datasPorTipo: {
        regencia: datasPorTipo.regencia.map((x) => x.label),
        louvor: datasPorTipo.louvor.map((x) => x.label),
        mensagem: datasPorTipo.mensagem.map((x) => x.label),
      },
      disponivel,
      votouFora,
      taxa,
    });
  }

  // 4) Médias por tipo (entre quem teve oportunidade) — base para faixas/insights.
  const comOportunidade = itens.filter((i) => i.disponivel > 0);
  const mediaPorTipo = { regencia: 0, louvor: 0, mensagem: 0, total: 0 };
  if (comOportunidade.length > 0) {
    for (const t of TIPOS) {
      mediaPorTipo[t] =
        comOportunidade.reduce((s, i) => s + i.porTipo[t], 0) / comOportunidade.length;
    }
    mediaPorTipo.total =
      comOportunidade.reduce((s, i) => s + i.participou, 0) / comOportunidade.length;
  }

  // 5) Classificar em faixas simples.
  classificar(itens, mediaPorTipo);

  // 6) Gerar insights determinísticos por pessoa (alertas inteligentes).
  for (const i of itens) i.insights = gerarInsights(i, mediaPorTipo);

  // Ordena: inativos primeiro, depois pouco, ativos, e por fim fora.
  const ordem = { inativo: 0, pouco: 1, ativo: 2, fora: 3 };
  itens.sort((a, b) => {
    if (ordem[a.faixa] !== ordem[b.faixa]) return ordem[a.faixa] - ordem[b.faixa];
    if (a.participou !== b.participou) return a.participou - b.participou;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  return { itens, janela, mediaPorTipo };
}

function converterBrDeIso(iso) {
  const [a, m, d] = String(iso).split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Retorna um Set com os papéis em que a pessoa aparece NESTE culto
 * ('regencia' | 'louvor' | 'mensagem'). Uma pessoa pode, teoricamente, aparecer
 * em mais de um campo; contamos cada papel.
 */
function papeisDaPessoaNoCulto(culto, pessoa, porNome) {
  const papeis = new Set();
  const bate = (campo) =>
    splitNomes(campo).some((n) => {
      const encontrada = porNome.get(n);
      return encontrada && encontrada.id === pessoa.id;
    });
  if (bate(culto['REGENTE LOUVOR'])) papeis.add('regencia');
  if (bate(culto['EQUIPE LOUVOR'])) papeis.add('louvor');
  if (bate(culto['MENSAGEM MUSICAL'])) papeis.add('mensagem');
  return papeis;
}

/**
 * Faixa (vocabulário simples): fora / inativo / pouco / ativo.
 * Baseada no total de participações x média de quem pôde participar.
 */
function classificar(itens, mediaPorTipo) {
  const media = mediaPorTipo.total || 0;
  for (const i of itens) {
    if (i.disponivel === 0) {
      i.faixa = 'fora';
      i.rotulo = i.votouFora > 0 ? 'Votou indisponível no período' : 'Sem disponibilidade no período';
      continue;
    }
    if (i.participou === 0) {
      i.faixa = 'inativo';
      i.rotulo = 'Sem escalas no período';
    } else if (i.participou < Math.max(1, media * 0.75)) {
      i.faixa = 'pouco';
      i.rotulo = 'Participando pouco';
    } else {
      i.faixa = 'ativo';
      i.rotulo = 'Participando bem';
    }
  }
}

// --------------------------------------------------------------------------
// INSIGHTS DETERMINÍSTICOS (sem IA)
//
// Cada insight é uma regra pura: recebe os dados já calculados de UMA pessoa
// (+ as médias do grupo) e devolve um alerta curto { tipo, texto } ou null.
// Para adicionar um novo insight, basta criar uma função e incluí-la na lista
// INSIGHTS abaixo. Nada mais precisa mudar.
// --------------------------------------------------------------------------

/** Dominante em um tipo: foi muito escalada num papel específico. */
function insightDominante(i, media) {
  const entradas = [
    ['mensagem', 'mensagem musical'],
    ['regencia', 'regência'],
    ['louvor', 'louvor'],
  ];
  for (const [tipo, label] of entradas) {
    const m = media[tipo] || 0;
    // Dispara quando a pessoa está claramente acima da média naquele papel.
    if (i.porTipo[tipo] >= 2 && i.porTipo[tipo] >= Math.ceil(m * 1.5 + 0.5)) {
      return { tipo: 'muito-' + tipo, texto: `Muito escalada em ${label} (${i.porTipo[tipo]}x)` };
    }
  }
  return null;
}

/** Regente que não está regendo: lembrar de usar na regência. */
function insightRegenteOcioso(i) {
  if (i.ehRegente && i.disponivel > 0 && i.porTipo.regencia === 0 && i.participou > 0) {
    return { tipo: 'regente-sem-reger', texto: 'Regente, mas não regeu no período' };
  }
  return null;
}

/** Concentração: participa, mas sempre no mesmo papel (pouca variedade). */
function insightConcentrado(i) {
  if (i.participou >= 3) {
    const usados = TIPOS.filter((t) => i.porTipo[t] > 0);
    if (usados.length === 1) {
      const nomes = { regencia: 'regência', louvor: 'louvor', mensagem: 'mensagem musical' };
      return { tipo: 'so-um-papel', texto: `Só em ${nomes[usados[0]]} no período` };
    }
  }
  return null;
}

/** Nunca fez mensagem musical mas poderia (habilitada) — oportunidade. */
// (Exemplo de insight fácil de ligar depois; mantido desligado por padrão.)

const INSIGHTS = [insightDominante, insightRegenteOcioso, insightConcentrado];

function gerarInsights(item, media) {
  const out = [];
  for (const regra of INSIGHTS) {
    const r = regra(item, media);
    if (r) out.push(r);
  }
  return out;
}
