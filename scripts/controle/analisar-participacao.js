#!/usr/bin/env node
/**
 * analisar-participacao.js
 *
 * Calcula o índice de participação de cada membro escalável a partir do
 * rascunho mensal, conforme RF027 e agents/escala.md:
 *
 *   % Participação = dias escalado / dias disponível no mês
 *   Carga Real     = dias escalado / total de cultos próprios do mês
 *   ICR            = dias escalado / média ideal (~3 dias)
 *
 * Alertas:
 *   ICR > 2.0            → sobrecarregado (propor alívio)
 *   ICR = 0 e disponível → esquecido (propor inclusão)
 *
 * Escopo: considera apenas cultos próprios de louvor (sábados e domingos).
 * Quartas-feiras (sem louvor) e cultos departamentais (RF010/RF015, onde os
 * campos de louvor recebem o nome do departamento) são excluídos da contagem,
 * pois não escalam membros individuais.
 *
 * Uso:
 *   node scripts/controle/analisar-participacao.js --mes=YYYY-MM
 *   node scripts/controle/analisar-participacao.js escalas/2026/09/rascunho.md
 *
 * Saída:
 *   escalas/AAAA/MM/participacao-icr.md
 *
 * Exit codes:
 *   0 = sucesso
 *   1 = erro fatal
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { carregarPessoas } from '../lib/cadastro.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const MEDIA_IDEAL = 3;
const ICR_SOBRECARGA = 2.0;
// Fração mínima de cultos disponíveis para uma pessoa zerada ser considerada
// "esquecida" (evita sinalizar quem mal tinha disponibilidade no mês).
const ESQUECIDO_DISPONIBILIDADE_MINIMA = 0.5;

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// Departamentos reconhecidos (RF015) — quando aparecem nos campos de louvor,
// o culto é departamental e não escala membros individuais.
const DEPARTAMENTOS = new Set([
  'JOVENS', 'AVENTUREIROS', 'DESBRAVADORES', 'DORCAS',
  'M. MULHER', 'QUARTETO', 'MELHOR IDADE',
]);

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      args[key] = rest.length > 0 ? rest.join('=') : true;
    } else if (!args._pos) {
      args._pos = arg;
    }
  }
  return args;
}

function resolveRascunhoPath(args) {
  if (args._pos) return resolve(ROOT, args._pos);
  if (args.mes) {
    const m = String(args.mes).match(/^(\d{4})-(\d{2})$/);
    if (!m) {
      console.error('Erro: --mes deve estar no formato YYYY-MM (ex: 2026-09)');
      process.exit(1);
    }
    return resolve(ROOT, `escalas/${m[1]}/${m[2]}/rascunho.md`);
  }
  console.error('Erro: informe --mes=YYYY-MM ou o caminho do rascunho.');
  process.exit(1);
}

function parseRows(mdContent) {
  return mdContent
    .split(/\r?\n/)
    .filter((line) => /^\|\s\d{2}\/\d{2}\/\d{4}\s\|/.test(line))
    .map((line) => line.split('|').map((part) => part.trim()));
}

function toIsoDate(brDate) {
  const [dd, mm, yyyy] = (brDate || '').split('/');
  if (!dd || !mm || !yyyy) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function splitNames(raw) {
  if (!raw) return [];
  return raw.split(',').map((n) => n.trim().toUpperCase()).filter(Boolean);
}

function ehDepartamental(...campos) {
  return campos.some((c) => {
    const v = (c || '').trim().toUpperCase();
    return DEPARTAMENTOS.has(v);
  });
}

function main() {
  const args = parseArgs(process.argv);
  const rascunhoPath = resolveRascunhoPath(args);

  if (!existsSync(rascunhoPath)) {
    console.error(`Erro fatal: rascunho não encontrado: ${rascunhoPath}`);
    process.exit(1);
  }

  const mesDir = dirname(rascunhoPath);
  const vinculadaPath = resolve(mesDir, 'insumos', 'indisponibilidade-cantores-vinculada.json');

  // Cadastro
  let cadastro;
  try {
    cadastro = carregarPessoas();
  } catch (err) {
    console.error(`Erro fatal ao carregar cadastro: ${err.message}`);
    process.exit(1);
  }
  const { pessoas, porNome } = cadastro;

  // Indisponibilidade vinculada (opcional, mas recomendada)
  let indisponibilidade = { datas: [], indisponiveis_mes_inteiro: { nomes: [] } };
  if (existsSync(vinculadaPath)) {
    try {
      indisponibilidade = JSON.parse(readFileSync(vinculadaPath, 'utf8'));
    } catch (err) {
      console.warn(`AVISO: falha ao ler indisponibilidade vinculada: ${err.message}`);
    }
  } else {
    console.warn(`AVISO: indisponibilidade vinculada não encontrada (${vinculadaPath}). %Participação usará todos os cultos como disponíveis.`);
  }

  const mesInteiro = new Set((indisponibilidade.indisponiveis_mes_inteiro?.nomes) || []);
  const indispPorData = new Map();
  for (const d of indisponibilidade.datas || []) {
    if (!d?.data_referencia) continue;
    indispPorData.set(
      d.data_referencia,
      new Set((d.indisponiveis_nomes || []).map((n) => String(n).toUpperCase()))
    );
  }

  // Ler rascunho e coletar cultos próprios (exclui departamentais; quartas já não estão no rascunho)
  const rows = parseRows(readFileSync(rascunhoPath, 'utf8'));
  const cultosProprios = [];
  const escaladoCount = new Map(); // nome canônico → contagem

  for (const row of rows) {
    // colunas: | DATA | DIA | ANCIÃO | PREGADOR | AV | REGENTE | EQUIPE | MM | OBS |
    const dataBR = row[1];
    const pregador = row[4];
    const regente = row[6];
    const equipeRaw = row[7];
    const mmRaw = row[8];

    if (ehDepartamental(pregador, regente, equipeRaw)) continue; // culto departamental → ignora

    const isoDate = toIsoDate(dataBR);
    cultosProprios.push(isoDate);

    const nomesNoCulto = [
      ...splitNames(regente),
      ...splitNames(equipeRaw),
      ...splitNames(mmRaw),
    ];
    for (const nome of nomesNoCulto) {
      const pessoa = porNome.get(nome);
      if (!pessoa) continue; // nomes textuais (ex: CORAL INFANTIL) não contam como pessoa
      escaladoCount.set(pessoa.nome, (escaladoCount.get(pessoa.nome) || 0) + 1);
    }
  }

  const totalCultos = cultosProprios.length;
  if (totalCultos === 0) {
    console.error('Erro fatal: nenhum culto próprio encontrado no rascunho.');
    process.exit(1);
  }

  function diasDisponiveis(nomeCanonico) {
    if (mesInteiro.has(nomeCanonico.toUpperCase())) return 0;
    let d = 0;
    for (const data of cultosProprios) {
      const indisp = indispPorData.get(data) || new Set();
      if (!indisp.has(nomeCanonico.toUpperCase())) d += 1;
    }
    return d;
  }

  // Universo escalável: ativos habilitados para equipe ou regente
  const universo = pessoas.filter((p) => p.ativo && (p.habilitacoes?.equipe || p.habilitacoes?.regente));

  const linhas = universo.map((p) => {
    const esc = escaladoCount.get(p.nome) || 0;
    const disp = diasDisponiveis(p.nome);
    const pct = disp > 0 ? esc / disp : null;
    const cargaReal = esc / totalCultos;
    const icr = esc / MEDIA_IDEAL;
    let alerta = '';
    if (icr > ICR_SOBRECARGA) alerta = 'SOBRECARGA';
    else if (esc === 0 && disp >= Math.ceil(totalCultos * ESQUECIDO_DISPONIBILIDADE_MINIMA)) alerta = 'ESQUECIDO';
    return { nome: p.nome, esc, disp, pct, cargaReal, icr, alerta };
  });

  linhas.sort((a, b) => b.icr - a.icr || b.esc - a.esc || a.nome.localeCompare(b.nome));

  const sobrecarregados = linhas.filter((l) => l.alerta === 'SOBRECARGA');
  const esquecidos = linhas.filter((l) => l.alerta === 'ESQUECIDO');

  // --- Gerar Markdown ---
  const mesRef = cultosProprios[0]?.slice(0, 7) || '';
  const fmtPct = (v) => (v === null ? 'n/d' : `${(v * 100).toFixed(0)}%`);

  const md = [];
  md.push(`# Índice de Participação (ICR) — ${mesRef}`);
  md.push('');
  md.push('> Gerado por `scripts/controle/analisar-participacao.js` (RF027).');
  md.push('> Considera apenas cultos próprios de louvor (sábados e domingos). Quartas e cultos departamentais são excluídos.');
  md.push('');
  md.push(`- Total de cultos próprios: **${totalCultos}**`);
  md.push(`- Média ideal por pessoa: **${MEDIA_IDEAL}**`);
  md.push(`- Universo escalável (ativos habilitados): **${universo.length}**`);
  md.push('');
  md.push('**Fórmulas:** % Participação = escalado ÷ disponível · Carga Real = escalado ÷ total de cultos · ICR = escalado ÷ média ideal');
  md.push('');
  md.push('| Nome | Escalado | Disponível | % Part. | Carga Real | ICR | Alerta |');
  md.push('|------|----------|------------|---------|------------|-----|--------|');
  for (const l of linhas) {
    if (l.esc === 0 && l.disp === 0) continue; // pula indisponíveis totais sem interesse
    md.push(`| ${l.nome} | ${l.esc} | ${l.disp} | ${fmtPct(l.pct)} | ${l.cargaReal.toFixed(2)} | ${l.icr.toFixed(2)} | ${l.alerta} |`);
  }
  md.push('');
  md.push('## Desequilíbrios');
  md.push('');
  if (sobrecarregados.length === 0) {
    md.push('- **Sobrecarga (ICR > 2.0):** nenhum.');
  } else {
    md.push('- **Sobrecarga (ICR > 2.0):**');
    for (const l of sobrecarregados) md.push(`  - ${l.nome} (ICR ${l.icr.toFixed(2)}) — propor alívio`);
  }
  if (esquecidos.length === 0) {
    md.push('- **Esquecidos (disponíveis, ICR 0):** nenhum.');
  } else {
    md.push('- **Esquecidos (disponíveis, ICR 0):**');
    for (const l of esquecidos) md.push(`  - ${l.nome} (disponível em ${l.disp} culto(s)) — avaliar inclusão`);
  }
  md.push('');

  const outPath = resolve(mesDir, 'participacao-icr.md');
  writeFileSync(outPath, md.join('\n'), 'utf8');

  // --- Resumo no console ---
  console.log(`\n${BOLD}=== Índice de Participação (ICR) — ${mesRef} ===${RESET}`);
  console.log(`Cultos próprios: ${totalCultos} | Média ideal: ${MEDIA_IDEAL} | Universo: ${universo.length}\n`);
  console.log('NOME'.padEnd(18) + 'ESC'.padStart(4) + 'DISP'.padStart(6) + '%PART'.padStart(7) + 'ICR'.padStart(7) + '  ALERTA');
  console.log('-'.repeat(52));
  for (const l of linhas) {
    if (l.esc === 0 && l.disp === 0) continue;
    const cor = l.alerta === 'SOBRECARGA' ? RED : l.alerta === 'ESQUECIDO' ? YELLOW : '';
    const reset = cor ? RESET : '';
    console.log(
      cor + l.nome.padEnd(18) + String(l.esc).padStart(4) + String(l.disp).padStart(6) +
      fmtPct(l.pct).padStart(7) + l.icr.toFixed(2).padStart(7) + '  ' + l.alerta + reset
    );
  }
  console.log('');
  if (sobrecarregados.length > 0) {
    console.log(`${RED}⚠ Sobrecarregados: ${sobrecarregados.map((l) => l.nome).join(', ')}${RESET}`);
  }
  if (esquecidos.length > 0) {
    console.log(`${YELLOW}⚠ Esquecidos (disponíveis): ${esquecidos.map((l) => l.nome).join(', ')}${RESET}`);
  }
  if (sobrecarregados.length === 0 && esquecidos.length === 0) {
    console.log(`${GREEN}✓ Distribuição equilibrada: sem sobrecarga nem esquecidos.${RESET}`);
  }
  console.log(`\n✓ Tabela salva em: ${outPath}\n`);
}

main();
