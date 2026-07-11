#!/usr/bin/env node

/**
 * vincular-indisponibilidade.js
 *
 * CLI que resolve nomes informais da enquete WhatsApp para IDs numéricos
 * de pessoas.json via fuzzy match, propaga indisponibilidade entre casais
 * (vínculos sempre_junto), e gera arquivo vinculado por ID.
 *
 * Uso:
 *   node scripts/vincular-indisponibilidade.js --mes=2026-07 [--input=PATH] [--output=PATH] [--threshold=0.6] [--auto] [--verbose]
 *
 * Exit codes:
 *   0 = sucesso
 *   1 = erro fatal
 *   2 = incompleto (nomes não resolvidos)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { carregarPessoas } from '../lib/cadastro.js';
import { resolverPessoaPorNome } from '../lib/fuzzy-match.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

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
const threshold = args.threshold ? parseFloat(args.threshold) : 0.6;
const verbose = !!args.verbose;
const autoMode = !!args.auto;

const defaultInputPath = resolve(ROOT, `escalas/${ano}/${mes}/insumos/indisponibilidade-cantores.json`);
const defaultOutputPath = resolve(ROOT, `escalas/${ano}/${mes}/insumos/indisponibilidade-cantores-vinculada.json`);

const inputPath = args.input ? resolve(args.input) : defaultInputPath;
const outputPath = args.output ? resolve(args.output) : defaultOutputPath;

// --- Helper functions ---

function log(msg) {
  if (verbose) {
    console.log(`[vincular] ${msg}`);
  }
}

function getDiaSemana(dataISO) {
  const dias = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const date = new Date(dataISO + 'T12:00:00Z');
  return dias[date.getUTCDay()];
}

// --- Main execution ---

function main() {
  // 1. Load pessoas.json
  log('Carregando pessoas.json...');
  let cadastro;
  try {
    cadastro = carregarPessoas();
  } catch (err) {
    console.error(`Erro fatal ao carregar cadastro: ${err.message}`);
    process.exit(1);
  }
  const { pessoas, porId, porNome } = cadastro;
  log(`Cadastro carregado: ${pessoas.length} pessoas`);

  // 2. Load input (enquete data)
  log(`Carregando enquete: ${inputPath}`);
  let enquete;
  try {
    const conteudo = readFileSync(inputPath, 'utf8');
    enquete = JSON.parse(conteudo);
  } catch (err) {
    console.error(`Erro fatal ao carregar enquete: ${err.message}`);
    process.exit(1);
  }

  // 3. Process all names from the survey
  const mapeamentos = new Map(); // nome_enquete → { pessoa_id, nome_canonico, confianca }
  const nomesNaoResolvidos = [];

  // Collect all unique names from the survey
  const todosNomes = new Set();
  for (const entrada of enquete.datas || []) {
    const nomes = entrada.indisponiveis || entrada.indisponiveis_tempo_indeterminado || [];
    for (const nome of nomes) {
      if (nome && nome.trim()) {
        todosNomes.add(nome.trim());
      }
    }
  }
  // Also collect from indisponiveis_mes_inteiro if at top level
  if (Array.isArray(enquete.indisponiveis_mes_inteiro)) {
    for (const nome of enquete.indisponiveis_mes_inteiro) {
      if (nome && nome.trim()) {
        todosNomes.add(nome.trim());
      }
    }
  }

  log(`Nomes únicos na enquete: ${todosNomes.size}`);

  // Resolve each name
  for (const nomeEnquete of todosNomes) {
    const resultado = resolverPessoaPorNome(nomeEnquete, porNome, threshold);

    if (resultado) {
      mapeamentos.set(nomeEnquete, {
        pessoa_id: resultado.pessoa.id,
        nome_canonico: resultado.pessoa.nome,
        confianca: Math.round(resultado.confianca * 100) / 100,
      });
      log(`  ✓ "${nomeEnquete}" → ${resultado.pessoa.nome} (ID ${resultado.pessoa.id}, confiança ${(resultado.confianca * 100).toFixed(0)}%)`);
    } else {
      nomesNaoResolvidos.push(nomeEnquete);
      log(`  ✗ "${nomeEnquete}" → NÃO RESOLVIDO`);
    }
  }

  if (nomesNaoResolvidos.length > 0) {
    console.warn(`\nAVISO: ${nomesNaoResolvidos.length} nome(s) não resolvido(s):`);
    for (const nome of nomesNaoResolvidos) {
      console.warn(`  - "${nome}"`);
    }
  }

  // 4. Build propagation list (sempre_junto couples)
  const propagacoes = [];
  const propagacaoSet = new Set(); // Track "deId→paraId" to avoid duplicates

  // For each mapped person, check if they have sempre_junto links
  for (const [, mapping] of mapeamentos) {
    const pessoa = porId.get(mapping.pessoa_id);
    if (!pessoa || !pessoa.vinculos) continue;

    for (const vinculo of pessoa.vinculos) {
      if (vinculo.tipo === 'sempre_junto') {
        const chave = `${pessoa.id}→${vinculo.com_id}`;
        const chaveInversa = `${vinculo.com_id}→${pessoa.id}`;

        // Only add if not already tracked (avoid A→B and B→A both appearing)
        if (!propagacaoSet.has(chave) && !propagacaoSet.has(chaveInversa)) {
          const parceiro = porId.get(vinculo.com_id);
          if (parceiro) {
            propagacaoSet.add(chave);
            propagacoes.push({
              de_id: pessoa.id,
              para_id: vinculo.com_id,
              motivo: `vinculo sempre_junto (casal ${pessoa.nome}↔${parceiro.nome})`,
            });
            log(`  ↔ Propagação: ${pessoa.nome} (ID ${pessoa.id}) → ${parceiro.nome} (ID ${vinculo.com_id})`);
          }
        }
      }
    }
  }

  // 5. Build output dates with IDs
  const datasOutput = [];

  for (const entrada of enquete.datas || []) {
    // Skip the "geral" entry - it maps to indisponiveis_mes_inteiro
    if (entrada.data_referencia === 'geral') continue;

    const nomesData = entrada.indisponiveis || [];
    const idsSet = new Set();
    const nomesResolvidosData = [];

    for (const nome of nomesData) {
      if (!nome || !nome.trim()) continue;
      const mapping = mapeamentos.get(nome.trim());
      if (mapping) {
        idsSet.add(mapping.pessoa_id);
        nomesResolvidosData.push(mapping.nome_canonico);
      }
    }

    // Propagate sempre_junto: if person A is unavailable, add partner B
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
            log(`  ↔ Data ${entrada.data_referencia}: propagando ${pessoa.nome} → ${parceiro.nome}`);
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

  // 6. Build indisponiveis_mes_inteiro
  let indisponiveisMesInteiro = null;

  // Check for "geral" entry in datas array
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
      const mapping = mapeamentos.get(nome.trim());
      if (mapping) {
        idsMesInteiro.add(mapping.pessoa_id);
        nomesMesInteiroResolvidos.push(mapping.nome_canonico);
      }
    }

    // Propagate sempre_junto for month-wide unavailability
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
            log(`  ↔ Mês inteiro: propagando ${pessoa.nome} → ${parceiro.nome}`);
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

  // 7. Build mapeamentos_aplicados array for output
  const mapeamentosOutput = [];
  for (const [nomeEnquete, mapping] of mapeamentos) {
    mapeamentosOutput.push({
      nome_enquete: nomeEnquete,
      pessoa_id: mapping.pessoa_id,
      nome_canonico: mapping.nome_canonico,
      confianca: mapping.confianca,
    });
  }
  // Sort by nome_enquete for deterministic output
  mapeamentosOutput.sort((a, b) => a.nome_enquete.localeCompare(b.nome_enquete));

  // 8. Assemble final output
  const relativeFonte = inputPath.startsWith(ROOT)
    ? inputPath.slice(ROOT.length + 1).replace(/\\/g, '/')
    : inputPath.replace(/\\/g, '/');

  const output = {
    contexto: `Indisponibilidade vinculada - ${capitalize(getMesNome(parseInt(mes)))} ${ano}`,
    gerado_em: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    gerado_por: 'vincular-indisponibilidade.js',
    fonte: relativeFonte,
    mapeamentos_aplicados: mapeamentosOutput,
    propagacoes,
    datas: datasOutput,
  };

  if (indisponiveisMesInteiro) {
    output.indisponiveis_mes_inteiro = indisponiveisMesInteiro;
  }

  // 9. Write output
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
    console.log(`\n✓ Arquivo vinculado gerado: ${outputPath}`);
    console.log(`  Mapeamentos: ${mapeamentosOutput.length}`);
    console.log(`  Propagações (casais): ${propagacoes.length}`);
    console.log(`  Datas processadas: ${datasOutput.length}`);
    if (indisponiveisMesInteiro) {
      console.log(`  Indisponíveis mês inteiro: ${indisponiveisMesInteiro.ids.length}`);
    }
    if (nomesNaoResolvidos.length > 0) {
      console.log(`  Nomes não resolvidos: ${nomesNaoResolvidos.length}`);
    }
  } catch (err) {
    console.error(`Erro fatal ao escrever saída: ${err.message}`);
    process.exit(1);
  }

  // 10. Exit code
  if (nomesNaoResolvidos.length > 0) {
    process.exit(2); // Incompleto
  }
  process.exit(0); // Sucesso
}

// --- Utilities ---

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

// --- Run ---

main();
