#!/usr/bin/env node

/**
 * sugerir-rascunho.js
 *
 * Solver principal: gera sugestão determinística de escala mensal com justificativa.
 * Carrega insumos, processa cultos em ordem cronológica, aplica filtros duros e score.
 *
 * Uso:
 *   node scripts/sugerir-rascunho.js --mes=YYYY-MM [--pessoas=PATH] [--insumos=PATH]
 *
 * Exit codes:
 *   0 = sucesso
 *   1 = erro fatal
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { carregarPessoas } from '../lib/cadastro.js';
import { carregarHistorico } from '../lib/solver-historico.js';
import { sugerirCulto } from '../lib/solver-selecao.js';
import { diaDaSemana } from '../lib/solver-filtros.js';
import { formatarRascunhoMd, gerarJustificativa } from '../lib/solver-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// --- Departamentos reconhecidos (RF015) ---
const DEPARTAMENTOS = new Set([
  'JOVENS',
  'AVENTUREIROS',
  'DESBRAVADORES',
  'DORCAS',
  'M. MULHER',
  'QUARTETO',
  'MELHOR IDADE',
]);

// --- CLI argument parsing ---

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      const value = rest.length > 0 ? rest.join('=') : true;
      args[key] = value;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.mes) {
  console.error('Erro: --mes é obrigatório. Uso: --mes=YYYY-MM');
  process.exit(1);
}

const mesMatch = String(args.mes).match(/^(\d{4})-(\d{2})$/);
if (!mesMatch) {
  console.error('Erro: --mes deve estar no formato YYYY-MM (ex: 2026-07)');
  process.exit(1);
}

const [, ano, mes] = mesMatch;
const mesAlvo = `${ano}-${mes}`;

// Caminhos padrão
const pessoasPath = args.pessoas ? resolve(args.pessoas) : resolve(ROOT, 'pessoas.json');
const insumosBase = args.insumos
  ? resolve(args.insumos)
  : resolve(ROOT, `escalas/${ano}/${mes}/insumos`);

const vinculadaPath = resolve(insumosBase, 'indisponibilidade-cantores-vinculada.json');
const acionatoPath = resolve(insumosBase, 'acionato.json');
const atualPath = resolve(ROOT, 'atual.json');
const outputDir = resolve(ROOT, `escalas/${ano}/${mes}`);
const rascunhoPath = resolve(outputDir, 'rascunho.md');
const justificativaPath = resolve(outputDir, 'rascunho-justificativa.md');

// --- Helper: carregar JSON com fallback ---

function carregarJSON(caminho, descricao, obrigatorio = false) {
  if (!existsSync(caminho)) {
    if (obrigatorio) {
      console.error(`Erro fatal: ${descricao} não encontrado: ${caminho}`);
      process.exit(1);
    }
    console.warn(`AVISO: ${descricao} não encontrado: ${caminho} — continuando sem.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (err) {
    console.error(`Erro ao ler ${descricao}: ${err.message}`);
    if (obrigatorio) process.exit(1);
    return null;
  }
}

// --- Carregar acionato (suporta formato template e formato atual.json) ---

/**
 * Converte data no formato DD/MM/YYYY para ISO YYYY-MM-DD.
 */
function converterDataBR(dataBR) {
  if (!dataBR || typeof dataBR !== 'string') return null;
  const partes = dataBR.trim().split('/');
  if (partes.length !== 3) return null;
  const [dia, mesP, anoP] = partes;
  return `${anoP}-${mesP.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

/**
 * Normaliza o dia da semana para o formato interno (sem acentos, lowercase).
 */
function normalizarDiaSemana(dia) {
  return String(dia || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Carrega dados do acionato. Suporta dois formatos:
 * 1. Template: { itens: [{ data: "YYYY-MM-DD", dia, anciao, pregador }] }
 * 2. Formato atual.json: [{ DATA: "DD/MM/YYYY", "DIA SEMANA", ANCIÃO, PREGADOR, AUDIOVISUAL }]
 */
function carregarAcionato() {
  // Tentar formato template primeiro
  let dados = carregarJSON(acionatoPath, 'Acionato');

  if (dados) {
    // Formato template (tem campo "itens")
    if (dados.itens && Array.isArray(dados.itens)) {
      return dados.itens.map((item) => ({
        data: item.data,
        dia_semana: normalizarDiaSemana(item.dia || diaDaSemana(item.data)),
        anciao: item.anciao || '',
        pregador: item.pregador || '',
        audiovisual: item.audiovisual || '',
      }));
    }

    // Formato array (mesmo formato do atual.json)
    if (Array.isArray(dados)) {
      return extrairCultosDeArray(dados);
    }
  }

  // Fallback: tentar extrair do atual.json filtrando pelo mês
  console.warn('AVISO: Acionato não encontrado — tentando extrair cultos do atual.json');
  const atual = carregarJSON(atualPath, 'atual.json');
  if (atual && Array.isArray(atual)) {
    return extrairCultosDeArray(atual);
  }

  console.error('Erro fatal: impossível determinar cultos do mês — sem acionato nem atual.json');
  process.exit(1);
}

/**
 * Extrai e filtra cultos de um array no formato atual.json para o mês alvo.
 */
function extrairCultosDeArray(dados) {
  const cultos = [];

  for (const linha of dados) {
    const dataISO = converterDataBR(linha.DATA);
    if (!dataISO) continue;

    // Filtrar apenas cultos do mês alvo
    if (!dataISO.startsWith(mesAlvo)) continue;

    cultos.push({
      data: dataISO,
      dia_semana: normalizarDiaSemana(linha['DIA SEMANA'] || diaDaSemana(dataISO)),
      anciao: linha['ANCIÃO'] || linha.ANCIAO || '',
      pregador: linha.PREGADOR || '',
      audiovisual: linha.AUDIOVISUAL || '',
    });
  }

  return cultos;
}

// --- Coletar paths dos períodos históricos old ---

function coletarPathsOld() {
  const paths = [];

  // Procurar em old/YYYY/ por arquivos .json
  const oldBase = resolve(ROOT, 'old');
  if (!existsSync(oldBase)) return paths;

  try {
    const anos = readdirSync(oldBase);
    for (const anoDir of anos) {
      const anoPath = resolve(oldBase, anoDir);
      try {
        const arquivos = readdirSync(anoPath);
        for (const arquivo of arquivos) {
          if (arquivo.endsWith('.json')) {
            paths.push(resolve(anoPath, arquivo));
          }
        }
      } catch {
        // Diretório ilegível, skip
      }
    }
  } catch {
    // old/ ilegível, skip
  }

  return paths;
}

// --- Verificar se pregador é departamental (RF015) ---

function ehDepartamental(pregador) {
  if (!pregador) return false;
  const pregadorNorm = pregador
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  return DEPARTAMENTOS.has(pregadorNorm);
}

// --- Resolver IDs de externos para o contexto (audiovisual/pregador) ---

function resolverExternoParaId(nome, porNome) {
  if (!nome || !nome.trim()) return null;
  const nomeUpper = nome.toUpperCase().trim();
  const pessoa = porNome.get(nomeUpper);
  return pessoa ? pessoa.id : null;
}

// --- Main ---

function main() {
  console.log(`\n🎵 Solver de Escala — ${mesAlvo}`);
  console.log('─'.repeat(40));

  // 1. Carregar pessoas
  console.log('Carregando cadastro...');
  let cadastro;
  try {
    cadastro = carregarPessoas(pessoasPath);
  } catch (err) {
    console.error(`Erro fatal ao carregar cadastro: ${err.message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${cadastro.pessoas.length} pessoas carregadas`);

  // 2. Carregar indisponibilidade vinculada
  console.log('Carregando indisponibilidade vinculada...');
  const indisponibilidade = carregarJSON(vinculadaPath, 'Indisponibilidade vinculada') || {
    datas: [],
    indisponiveis_mes_inteiro: { ids: [], nomes: [] },
  };
  const qtdDatas = (indisponibilidade.datas || []).length;
  const qtdMesInteiro = (indisponibilidade.indisponiveis_mes_inteiro?.ids || []).length;
  console.log(`  ✓ ${qtdDatas} data(s) com indisponibilidade, ${qtdMesInteiro} indisponível(eis) mês inteiro`);

  // 3. Carregar histórico
  console.log('Carregando histórico...');
  const pathsOld = coletarPathsOld();
  const historico = carregarHistorico(cadastro, pathsOld, atualPath);
  console.log(`  ✓ Histórico carregado (${pathsOld.length} período(s) antigo(s) + atual.json)`);

  // 4. Carregar acionato / extrair cultos
  console.log('Carregando acionato...');
  const cultos = carregarAcionato();
  if (cultos.length === 0) {
    console.error('Erro fatal: nenhum culto encontrado para o mês alvo.');
    process.exit(1);
  }

  // Ordenar por data ASC
  cultos.sort((a, b) => a.data.localeCompare(b.data));
  console.log(`  ✓ ${cultos.length} culto(s) no mês`);

  // 5. Montar contexto do solver
  const contexto = {
    pessoas: cadastro,
    indisponibilidade,
    historico,
    escaladosNesteMes: new Map(),
    escaladosPorCulto: new Map(),
    externosPorCulto: new Map(),
    dataAnterior: null,
    grupoPreferencialRegente: null,
  };

  // 6. Processar cultos em ordem cronológica
  console.log('\nProcessando cultos...');
  const sugestoes = [];

  for (const culto of cultos) {
    const { data, dia_semana, anciao, pregador, audiovisual } = culto;

    // Resolver IDs de externos para este culto
    const externosCulto = { audiovisual: [], pregador: [] };
    const audiovisualId = resolverExternoParaId(audiovisual, cadastro.porNome);
    if (audiovisualId) externosCulto.audiovisual.push(audiovisualId);
    const pregadorId = resolverExternoParaId(pregador, cadastro.porNome);
    if (pregadorId && !ehDepartamental(pregador)) externosCulto.pregador.push(pregadorId);
    contexto.externosPorCulto.set(data, externosCulto);

    // RF005: Quarta-feira → skip (sem louvor)
    if (dia_semana === 'quarta-feira') {
      console.log(`  ${data} (${dia_semana}) → ⏭️ sem louvor`);
      sugestoes.push({
        data,
        dia_semana,
        tipo: 'quarta',
        anciao,
        pregador,
        audiovisual,
      });
      contexto.dataAnterior = data;
      continue;
    }

    // RF015: Departamental → preencher com nome do departamento
    if (ehDepartamental(pregador)) {
      const deptoNorm = pregador.toUpperCase().trim();
      console.log(`  ${data} (${dia_semana}) → 🏛️ departamental (${deptoNorm})`);
      sugestoes.push({
        data,
        dia_semana,
        tipo: 'departamental',
        departamento: deptoNorm,
        anciao,
        pregador,
        audiovisual,
      });
      contexto.dataAnterior = data;
      continue;
    }

    // Culto normal → solver
    console.log(`  ${data} (${dia_semana}) → 🎹 solver...`);

    const sugestao = sugerirCulto(
      { data, dia_semana, anciao, pregador, audiovisual },
      contexto
    );

    sugestoes.push({
      data,
      dia_semana,
      tipo: 'normal',
      regente: sugestao.regente,
      equipe: sugestao.equipe,
      mm: sugestao.mm,
      justificativas: sugestao.justificativas,
      anciao,
      pregador,
      audiovisual,
    });

    // Atualizar dataAnterior para o próximo culto (usado por penalConsecutivo)
    contexto.dataAnterior = data;

    const regNome = sugestao.regente ? sugestao.regente.nome : 'PENDENTE';
    const equipeQtd = sugestao.equipe.length;
    const mmQtd = sugestao.mm.length;
    console.log(`    Regente: ${regNome} | Equipe: ${equipeQtd} | MM: ${mmQtd}`);
  }

  // 7. Gerar saídas
  console.log('\nGerando saídas...');

  const rascunhoMd = formatarRascunhoMd(sugestoes);
  const justificativaMd = gerarJustificativa(sugestoes, contexto);

  // Garantir diretório de saída
  mkdirSync(outputDir, { recursive: true });

  writeFileSync(rascunhoPath, rascunhoMd, 'utf8');
  console.log(`  ✓ Rascunho: ${rascunhoPath}`);

  writeFileSync(justificativaPath, justificativaMd, 'utf8');
  console.log(`  ✓ Justificativa: ${justificativaPath}`);

  // 8. Resumo
  const normais = sugestoes.filter((s) => s.tipo === 'normal').length;
  const quartas = sugestoes.filter((s) => s.tipo === 'quarta').length;
  const deptos = sugestoes.filter((s) => s.tipo === 'departamental').length;

  console.log('\n─'.repeat(40));
  console.log(`✅ Concluído: ${sugestoes.length} culto(s) processado(s)`);
  console.log(`   Normais: ${normais} | Quartas: ${quartas} | Departamentais: ${deptos}`);
  console.log('');
}

main();
